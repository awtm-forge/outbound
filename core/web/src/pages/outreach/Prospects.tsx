import { useState } from 'react';
import { api } from '../../api.ts';
import { Link, useRouter } from '../../router.tsx';
import { useLoad } from '../../ui/hooks.ts';
import { Icon } from '../../ui/icons.tsx';
import { Drawer, Modal } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { useMe, isAdmin } from '../../session.tsx';
import { Badge, Empty, Failure, Loading, Spinner, ago } from '../../ui/kit.tsx';
import { useShWrite } from '../../ui/shwrite.tsx';
import { Off, ShStatus, SyncedLine, isOff, personName } from './common.tsx';
import { NewTask } from './Inbox.tsx';

const LINK_WORDS: Record<string, string> = { email: 'Matched by email', domain: 'Matched by domain', manual: 'Linked by hand' };
const EVENT_WORDS: Record<string, string> = { 'email-sent': 'Email sent', 'reply-received': 'Replied', 'email-bounced': 'Bounced', 'prospect-unsubscribed': 'Unsubscribed', 'email-opened': 'Opened', 'email-link-clicked': 'Clicked a link', 'prospect-finished': 'Finished the sequence', 'prospect-added': 'Added to a sequence' };

// ---------- the list ----------
export function Prospects() {
  const { search, go } = useRouter();
  const term = search.get('q') ?? ''; const status = search.get('status') ?? ''; const linked = search.get('linked') ?? ''; const page = Number(search.get('page') ?? 0) || 0; const open = search.get('id');
  const [typed, setTyped] = useState(term);
  const { data, error, loading, reload } = useLoad(() => api.get(`/api/sh/prospects?q=${encodeURIComponent(term)}&status=${status}&linked=${linked}&page=${page}`), [term, status, linked, page]);
  const set = (k: string, v: string | null) => { const s = new URLSearchParams(search); if (v) s.set(k, v); else s.delete(k); if (k !== 'page' && k !== 'id') s.delete('page'); go(`/outreach/prospects${s.toString() ? `?${s}` : ''}`, true); };
  if (isOff(error)) return <Off />;
  const rows: any[] = data?.rows ?? []; const total = data?.total ?? 0;
  return <>
    <div className="row wrap">
      <form className="grow" onSubmit={(e) => { e.preventDefault(); set('q', typed.trim() || null); }}><input className="input" placeholder="Search by name, email or company" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Search prospects" /></form>
      <select className="input" style={{ maxWidth: 200 }} value={status} onChange={(e) => set('status', e.target.value || null)} aria-label="Status in a sequence"><option value="">Any status</option>{['active', 'paused', 'finished', 'replied', 'unsubscribed', 'bounced'].map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}</select>
      <select className="input" style={{ maxWidth: 200 }} value={linked} onChange={(e) => set('linked', e.target.value || null)} aria-label="Linked to our records"><option value="">Linked or not</option><option value="yes">Linked</option><option value="no">Not linked</option></select>
    </div>
    <SyncedLine s={data} reload={reload} />
    {loading && !data ? <Loading kind="table" rows={6} /> : error ? <Failure error={error} retry={reload} />
      : !rows.length ? <div className="card"><Empty title={term || status || linked ? 'Nobody matches' : 'No prospects synced'}>{term || status || linked ? 'Try a different search or filter.' : 'Prospects appear here after the first sync.'}</Empty></div>
        : <div className="card flush"><div className="scrollx"><table className="t">
          <thead><tr><th>Prospect</th><th>Sequences</th><th>Our record</th><th>Last activity</th></tr></thead>
          <tbody>{rows.map((p) => <tr key={p.id} className="click" tabIndex={0} onClick={() => set('id', p.id)} onKeyDown={(e) => { if (e.key === 'Enter') set('id', p.id); }}>
            <td><b style={{ fontWeight: 600 }}>{personName(p)}</b>{p.dnc && <span style={{ marginLeft: 8 }}><Badge tone="danger">Do not contact</Badge></span>}<div className="sub">{p.email}{p.company_name ? ` · ${p.company_name}` : ''}</div></td>
            <td>{(p.sequences ?? []).map((m: any) => <div key={m.sequence_id} className="row" style={{ gap: 6 }}><ShStatus s={m.status} /><span className="sub ellipsis">{m.title ?? m.sequence_id}</span></div>)}{!p.sequences?.length && <span className="faint">None</span>}</td>
            <td>{p.linked_company ? <><span>{p.linked_company}</span><div className="sub">{LINK_WORDS[p.link_method]}</div></> : <span className="faint">Not linked</span>}</td>
            <td>{p.last_activity_at ? ago(p.last_activity_at) : <span className="faint">None</span>}</td></tr>)}</tbody></table></div>
          <div className="row between" style={{ padding: '10px 16px' }}><span className="faint" style={{ fontSize: 'var(--fs-0)' }}>{page * 50 + 1} to {page * 50 + rows.length} of {total}</span>
            <div className="row"><button className="btn sm" disabled={!page} onClick={() => set('page', page - 1 ? String(page - 1) : null)}>Previous</button><button className="btn sm" disabled={(page + 1) * 50 >= total} onClick={() => set('page', String(page + 1))}>Next</button></div></div>
        </div>}
    {open && <ProspectDrawer id={open} close={() => { set('id', null); reload(true); }} />}
  </>;
}

// ---------- the detail panel: timeline, notes, tasks, fields, tags, sequences, do not contact ----------
export function ProspectDrawer({ id, close }: { id: string; close: () => void }) {
  const { data, error, loading, reload } = useLoad(() => api.get(`/api/sh/prospects/${encodeURIComponent(id)}`), [id]);
  const w = useShWrite(() => reload(true)); const me = useMe();
  const [note, setNote] = useState(''); const [field, setField] = useState({ id: '', value: '' }); const [task, setTask] = useState(false); const [linking, setLinking] = useState(false); const [dncList, setDncList] = useState('');
  const p = data?.prospect;
  const title = p ? personName(p) : 'Prospect';
  return <Drawer label={title} onClose={close}>
    {loading && !data ? <div style={{ padding: 16 }}><Loading rows={4} /></div> : error ? <div style={{ padding: 16 }}>{isOff(error) ? <Off /> : <Failure error={error} retry={reload} />}</div> : <div className="col" style={{ gap: 'var(--s-5)', padding: 16 }}>
      <div className="col" style={{ gap: 4 }}>
        <p className="muted">{p.email}{p.company_name ? ` · ${p.company_name}` : ''}</p>
        <SyncedLine s={data} reload={reload} />
        <div className="row wrap" style={{ gap: 6 }}>
          {p.verification_status && <Badge tone={/valid/i.test(p.verification_status) && !/invalid/i.test(p.verification_status) ? 'success' : 'neutral'}>{p.verification_status}</Badge>}
          {data.dnc.length > 0 && <Badge tone="danger">Do not contact in Saleshandy</Badge>}
          {data.our_suppression && <Badge tone="danger">Suppressed here too</Badge>}
        </div>
      </div>

      <section className="col"><h2>Our record</h2>
        {p.linked_company_id ? <p><Link to={`/crm/companies/${p.linked_company_id}`}>{p.company_label}</Link>{p.contact_label ? ` · ${p.contact_label}` : ''} <span className="faint">({LINK_WORDS[p.link_method]})</span></p> : <p className="muted">Not linked to one of our companies.</p>}
        <div><button className="btn sm" onClick={() => setLinking(true)}>{p.linked_company_id ? 'Change the link' : 'Link it'}</button></div>
      </section>

      <section className="col"><h2>Sequences</h2>
        {!data.memberships.length ? <p className="muted">Not in a sequence.</p> : data.memberships.map((m: any) => { const st = String(m.status ?? '').toLowerCase(); const run = (status: string) => w.run({ action: 'prospect.set_status', input: { prospectId: p.id, sequenceId: m.sequence_id, status, ...(status === 'active' && m.step_id ? { stepId: m.step_id } : {}) },
          risk: status === 'active' ? 'high' : 'medium', target: `${title} in "${m.title ?? m.sequence_id}"`, verb: status === 'active' ? 'Resume this prospect' : status === 'paused' ? 'Pause this prospect' : 'Finish this prospect', phrase: 'resume', done: `${title}: ${status === 'active' ? 'resuming' : status}` });
          return <div key={m.sequence_id} className="row wrap between"><span className="row" style={{ gap: 8 }}><ShStatus s={m.status} /><Link to={`/outreach/sequences/${encodeURIComponent(m.sequence_id)}`}>{m.title ?? m.sequence_id}</Link></span>
            <span className="row">{st === 'active' && <><button className="btn sm" disabled={w.busy} onClick={() => run('paused')}>Pause</button><button className="btn sm ghost" disabled={w.busy} onClick={() => run('finished')}>Finish</button></>}
              {st === 'paused' && isAdmin(me) && <button className="btn sm" disabled={w.busy} onClick={() => run('active')}>Resume</button>}</span></div>; })}
      </section>

      <section className="col"><h2>Timeline</h2>
        {!data.events.length ? <p className="muted">Nothing recorded yet. Events arrive by webhook.</p> : <div className="timeline">{data.events.map((e: any) => <div key={e.id} className="ev"><span className="dot" aria-hidden="true" /><span>{EVENT_WORDS[e.kind] ?? e.kind.replace(/-/g, ' ')}{!e.reliable && <span className="faint"> · may be automatic, not a person</span>}</span><span className="faint" style={{ fontSize: 'var(--fs-0)', whiteSpace: 'nowrap' }}>{ago(e.occurred_at)}</span></div>)}</div>}
        {data.threads.length > 0 && <div className="col" style={{ gap: 4 }}>{data.threads.map((t: any) => <Link key={t.id} to={`/outreach/inbox?thread=${encodeURIComponent(t.id)}`}>{t.subject || 'No subject'} <span className="faint">· {ago(t.last_message_at)}</span></Link>)}</div>}
      </section>

      <section className="col"><h2>Notes</h2>
        {data.notes_error && <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>Shown from the synced copy: {data.notes_error}</p>}
        {data.notes.map((n: any) => <div key={n.id} className="quote">{n.content}<div className="faint" style={{ fontSize: 'var(--fs-0)', marginTop: 4 }}>{ago(n.sh_created_at)}</div></div>)}
        <form className="col" onSubmit={async (e) => { e.preventDefault(); const ok = await w.run({ action: 'note.create', input: { prospectIds: [p.id], content: note.trim() }, risk: 'low', target: title, done: 'Note saved in Saleshandy' }); if (ok) setNote(''); }}>
          <textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note, saved in Saleshandy" aria-label="New note" maxLength={5000} />
          <div><button className="btn sm primary" disabled={!note.trim() || w.busy}>Add note</button></div></form>
      </section>

      <section className="col"><div className="row between"><h2>Tasks</h2><button className="btn sm" onClick={() => setTask(true)}><Icon.plus size={14} />Task</button></div>
        {!data.tasks.length ? <p className="muted">No tasks.</p> : data.tasks.map((t: any) => <div key={t.id} className="row between"><span>{t.type ?? 'Task'}{t.note ? <span className="faint"> · {t.note}</span> : ''}</span><ShStatus s={t.status} /></div>)}
      </section>

      <section className="col"><h2>Tags</h2>
        <div className="row wrap" style={{ gap: 6 }}>{data.tags.map((t: any) => { const has = (p.tags ?? []).includes(t.data?.name); const op = has ? 'unassign' : 'assign';
          return <button key={t.id} type="button" className="filter-chip" aria-pressed={has} disabled={w.busy} onClick={() => w.run({ action: 'prospect.tags', input: { prospectIds: [p.id], tagId: t.id, op }, inverse: { action: 'prospect.tags', input: { prospectIds: [p.id], tagId: t.id, op: has ? 'assign' : 'unassign' } }, risk: 'low', target: title, done: has ? `Removed "${t.data?.name}"` : `Tagged "${t.data?.name}"` })}>{t.data?.name ?? t.id}</button>; })}
          {!data.tags.length && <p className="muted">No tags synced. Tags are made in Saleshandy.</p>}</div>
      </section>

      <section className="col"><h2>Field values</h2>
        <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>Only names and email are kept here, so current values are in Saleshandy. Set a value:</p>
        <form className="row wrap" onSubmit={async (e) => { e.preventDefault(); const f = data.fields.find((x: any) => x.id === field.id); const ok = await w.run({ action: 'prospect.set_fields', input: { prospectId: p.id, fields: [{ fieldId: field.id, value: field.value }] }, risk: 'low', target: title, done: `${f?.data?.label ?? 'Field'} saved` }); if (ok) setField({ id: '', value: '' }); }}>
          <select className="input" style={{ maxWidth: 180 }} value={field.id} onChange={(e) => setField({ ...field, id: e.target.value })} aria-label="Field"><option value="">Choose a field</option>{data.fields.map((f: any) => <option key={f.id} value={f.id}>{f.data?.label ?? f.id}</option>)}</select>
          <input className="input grow" value={field.value} onChange={(e) => setField({ ...field, value: e.target.value })} aria-label="Value" maxLength={5000} />
          <button className="btn sm" disabled={!field.id || w.busy}>Save</button></form>
      </section>

      <section className="col"><h2>Do not contact</h2>
        {data.dnc.map((d: any) => <p key={d.value}>{d.value} is on "{d.list}"</p>)}
        {!data.dnc.length && (data.dnc_lists.length ? <div className="row wrap"><select className="input" style={{ maxWidth: 220 }} value={dncList} onChange={(e) => setDncList(e.target.value)} aria-label="List"><option value="">Choose a list</option>{data.dnc_lists.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          <button className="btn sm danger" disabled={!dncList || w.busy} onClick={() => w.run({ action: 'dnc.add', input: { listId: dncList, items: [p.email] }, risk: 'medium', count: 1, target: `${p.email} to "${data.dnc_lists.find((l: any) => l.id === dncList)?.name}" so Saleshandy never writes to it`, verb: 'Add to do not contact', done: 'Added to do not contact' })}>Never contact</button></div>
          : <p className="muted">No lists synced.</p>)}
      </section>
    </div>}
    {task && p && <NewTask prospectId={p.id} who={p.email} close={() => setTask(false)} run={w.run} />}
    {linking && p && <LinkModal prospect={p} close={() => setLinking(false)} done={() => { setLinking(false); reload(true); }} />}
    {w.ui}
  </Drawer>;
}

// ---------- linking by hand ----------
export function LinkModal({ prospect, close, done }: { prospect: any; close: () => void; done: () => void }) {
  const toast = useToast(); const [term, setTerm] = useState(prospect.company_name ?? prospect.email.split('@')[1] ?? ''); const [busy, setBusy] = useState(false);
  const found = useLoad(() => api.get<any[]>(`/api/sh/link-search?q=${encodeURIComponent(term)}`), [term]);
  const link = async (body: object) => { setBusy(true); try { await api.post(`/api/sh/prospects/${encodeURIComponent(prospect.id)}/link`, body); toast('Linked. A sync will not change it.'); done(); } catch (e: any) { toast(e.message, { err: true }); setBusy(false); } };
  return <Modal title={`Link ${personName(prospect)}`} onClose={close}>
    <div className="col">
      <input className="input" data-autofocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search our companies and contacts" aria-label="Search our companies and contacts" />
      <div className="col" style={{ gap: 4, maxHeight: 300, overflow: 'auto' }}>
        {found.loading && !found.data ? <Loading kind="list" rows={3} /> : !(found.data ?? []).length ? <p className="muted">{term.trim().length < 2 ? 'Type at least two letters.' : 'Nothing found.'}</p>
          : found.data!.map((r) => <button key={r.kind + r.id} className="btn ghost" style={{ justifyContent: 'flex-start' }} disabled={busy} onClick={() => link(r.kind === 'company' ? { company_id: r.id } : { contact_id: r.id })}>
            <Badge>{r.kind === 'company' ? 'Company' : 'Contact'}</Badge><span className="ellipsis">{r.label}{r.detail ? <span className="faint"> · {r.detail}</span> : ''}</span></button>)}
      </div>
      <div className="dialog-actions">{prospect.link_method && <button className="btn ghost" disabled={busy} onClick={() => link({ company_id: null, contact_id: null })}>Remove the link</button>}<button className="btn" onClick={close}>Close</button></div>
    </div>
  </Modal>;
}

export function Unlinked() {
  const { data, error, loading, reload } = useLoad(() => api.get('/api/sh/unlinked'));
  const [pick, setPick] = useState<any>(null);
  if (isOff(error)) return <Off />;
  if (loading && !data) return <Loading kind="table" rows={5} />;
  if (error) return <Failure error={error} retry={reload} />;
  const rows: any[] = data.rows;
  return <>
    <SyncedLine s={data} reload={reload} />
    {!rows.length ? <div className="card"><Empty title="Everyone is linked">Every synced prospect matches one of our companies or contacts.</Empty></div>
      : <div className="card flush"><div className="scrollx"><table className="t"><thead><tr><th>Prospect</th><th>Company in Saleshandy</th><th>Added</th><th><span className="sr">Link</span></th></tr></thead>
        <tbody>{rows.map((p) => <tr key={p.id}><td><b style={{ fontWeight: 600 }}>{personName(p)}</b><div className="sub">{p.email}</div></td><td>{p.company_name ?? <span className="faint">None</span>}</td><td>{ago(p.sh_created_at)}</td>
          <td style={{ textAlign: 'right' }}><button className="btn sm" onClick={() => setPick(p)}>Link</button></td></tr>)}</tbody></table></div></div>}
    {pick && <LinkModal prospect={pick} close={() => setPick(null)} done={() => { setPick(null); reload(true); }} />}
  </>;
}

// ---------- on our company and prospect pages ----------
export function SaleshandyPanel({ companyId, contactId }: { companyId?: string; contactId?: string }) {
  const me = useMe();
  const qs = companyId ? `company_id=${companyId}` : `contact_id=${contactId}`;
  const { data, error, loading, reload } = useLoad(() => api.get(`/api/sh/linked?${qs}`), [qs]);
  const [open, setOpen] = useState<string | null>(null);
  if (!(me as any).saleshandy_integration || data?.enabled === false) return null;
  return <section className="card col" aria-labelledby="sh-panel">
    <div className="row between"><h2 id="sh-panel">In Saleshandy</h2>{data?.last_synced !== undefined && <span className="faint" style={{ fontSize: 'var(--fs-0)' }}>Last synced {data.last_synced ? ago(data.last_synced) : 'never'}</span>}</div>
    {loading && !data ? <Loading kind="list" rows={2} /> : error ? <Failure error={error} retry={reload} />
      : <>{data.stale && <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>This may be out of date until the next sync.</p>}
        {!data.rows.length ? <p className="muted">Nobody here is in Saleshandy yet.</p> : data.rows.map((p: any) => <div key={p.id} className="row between wrap">
          <div><button className="link-btn" style={{ fontWeight: 600 }} onClick={() => setOpen(p.id)}>{personName(p)}</button><div className="faint" style={{ fontSize: 'var(--fs-0)' }}>{p.email}{p.open_tasks ? ` · ${p.open_tasks} open tasks` : ''}{p.threads ? ` · ${p.threads} threads` : ''}</div></div>
          <div className="row wrap" style={{ gap: 6 }}>{(p.sequences ?? []).map((m: any) => <ShStatus key={m.sequence_id} s={m.status} />)}{!p.sequences?.length && <span className="faint" style={{ fontSize: 'var(--fs-0)' }}>No sequence</span>}</div></div>)}</>}
    {open && <ProspectDrawer id={open} close={() => { setOpen(null); reload(true); }} />}
    {loading && data && <Spinner />}
  </section>;
}
