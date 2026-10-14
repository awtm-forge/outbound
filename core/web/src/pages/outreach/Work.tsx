import { useState } from 'react';
import { api } from '../../api.ts';
import { useRouter } from '../../router.tsx';
import { useLoad } from '../../ui/hooks.ts';
import { Modal } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Empty, Failure, Loading, Spinner, dayLabel, isLate } from '../../ui/kit.tsx';
import { useShWrite } from '../../ui/shwrite.tsx';
import { AppLink, Off, ShStatus, SyncedLine, isOff } from './common.tsx';
import { ProspectDrawer } from './Prospects.tsx';

// ---------- tasks ----------
const TASK_FILTERS: [string, string][] = [['', 'All'], ['overdue', 'Overdue'], ['dueToday', 'Due today'], ['upcoming', 'Upcoming'], ['completed', 'Completed'], ['skipped', 'Skipped']];
// tomorrow at 10 in the morning, India time, as an ISO time with offset
const tomorrow10 = () => { const d = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); return `${d}T10:00`; };
const istIso = (local: string) => `${local}:00+05:30`;
export function Tasks() {
  const { search, go } = useRouter(); const status = search.get('status') ?? '';
  const { data, error, loading, reload } = useLoad(() => api.get(`/api/sh/tasks${status ? `?status=${status}` : ''}`), [status]);
  const w = useShWrite(() => reload(true));
  const [sel, setSel] = useState<Set<string>>(new Set()); const [snooze, setSnooze] = useState<string[] | null>(null); const [editing, setEditing] = useState<any>(null); const [open, setOpen] = useState<string | null>(null);
  if (isOff(error)) return <Off />;
  const rows: any[] = data?.rows ?? []; const openRows = rows.filter((t) => !['completed', 'skipped'].includes(String(t.status)));
  const flip = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const who = (t: any) => t.prospect_name || t.email || 'this prospect';
  return <>
    <div className="chip-row" role="group" aria-label="Show">{TASK_FILTERS.map(([k, l]) => <button key={k} type="button" className="filter-chip" aria-pressed={status === k} onClick={() => { setSel(new Set()); go(`/outreach/tasks${k ? `?status=${k}` : ''}`, true); }}>{l}</button>)}</div>
    <SyncedLine s={data} reload={reload} />
    {sel.size > 0 && <div className="banner"><span>{sel.size} chosen</span>
      <button className="btn sm" disabled={w.busy} onClick={async () => { const ids = [...sel]; if (await w.run({ action: 'task.bulk', input: { taskIds: ids, op: 'skip' }, risk: 'low', target: `${ids.length} tasks`, done: `Skipping ${ids.length} tasks` })) setSel(new Set()); }}>Skip</button>
      <button className="btn sm" onClick={() => setSnooze([...sel])}>Snooze</button><button className="btn sm ghost right" onClick={() => setSel(new Set())}>Clear</button></div>}
    {loading && !data ? <Loading kind="table" rows={5} /> : error ? <Failure error={error} retry={reload} />
      : !rows.length ? <div className="card"><Empty title={status ? 'No tasks with this status' : 'No tasks synced'}>{status ? 'Try another filter.' : 'Tasks from sequences appear here after a sync.'}</Empty></div>
        : <div className="card flush"><div className="scrollx"><table className="t">
          <thead><tr><th><input type="checkbox" aria-label="Choose every open task" checked={!!openRows.length && openRows.every((t) => sel.has(t.id))} onChange={(e) => setSel(e.target.checked ? new Set(openRows.map((t) => t.id)) : new Set())} /></th><th>Task</th><th>Prospect</th><th>Due</th><th>Status</th><th><span className="sr">Actions</span></th></tr></thead>
          <tbody>{rows.map((t) => { const done = ['completed', 'skipped'].includes(String(t.status)); return <tr key={t.id}>
            <td>{!done && <input type="checkbox" aria-label={`Choose the task for ${who(t)}`} checked={sel.has(t.id)} onChange={() => flip(t.id)} />}</td>
            <td><b style={{ fontWeight: 600 }}>{t.type ? String(t.type).replace(/_/g, ' ') : 'Task'}</b>{t.note && <div className="sub">{t.note}</div>}{t.sequence_name && <div className="sub">{t.sequence_name}</div>}</td>
            <td>{t.prospect_id ? <button className="link-btn" onClick={() => setOpen(t.prospect_id)}>{who(t)}</button> : who(t)}</td>
            <td className={isLate(t.due_date) && !done ? 'late' : ''}>{t.due_date ? dayLabel(String(t.due_date).slice(0, 10)) : <span className="faint">None</span>}</td>
            <td><ShStatus s={t.status} /></td>
            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{!done && <>
              <button className="btn sm" disabled={w.busy} onClick={() => w.run({ action: 'task.complete', input: { taskId: t.id }, risk: 'low', target: `the task for ${who(t)}`, done: 'Completing the task' })}>Done</button>{' '}
              <button className="btn sm ghost" disabled={w.busy} onClick={() => w.run({ action: 'task.skip', input: { taskId: t.id }, risk: 'low', target: `the task for ${who(t)}`, done: 'Skipping the task' })}>Skip</button>{' '}
              <button className="btn sm ghost" onClick={() => setSnooze([t.id])}>Snooze</button>{' '}
              <button className="btn sm ghost" onClick={() => setEditing(t)}>Note</button></>}</td></tr>; })}</tbody></table></div></div>}
    {snooze && <SnoozeModal n={snooze.length} close={() => setSnooze(null)} go={async (until) => { const ids = snooze; setSnooze(null);
      const ok = ids.length === 1 ? await w.run({ action: 'task.snooze', input: { taskId: ids[0], until }, risk: 'low', target: 'the task', done: 'Snoozing the task' })
        : await w.run({ action: 'task.bulk', input: { taskIds: ids, op: 'snooze', until }, risk: 'low', target: `${ids.length} tasks`, done: `Snoozing ${ids.length} tasks` });
      if (ok) setSel(new Set()); }} />}
    {editing && <NoteModal task={editing} close={() => setEditing(null)} save={(note) => { setEditing(null); void w.run({ action: 'task.note', input: { taskId: editing.id, note }, risk: 'low', target: 'the task note', done: 'Saving the note' }); }} />}
    {open && <ProspectDrawer id={open} close={() => setOpen(null)} />}
    {w.ui}
  </>;
}
function SnoozeModal({ n, close, go }: { n: number; close: () => void; go: (until: string) => void }) {
  const [at, setAt] = useState(tomorrow10());
  return <Modal title={n === 1 ? 'Snooze the task' : `Snooze ${n} tasks`} onClose={close}>
    <form className="col" onSubmit={(e) => { e.preventDefault(); go(istIso(at)); }}>
      <label className="field"><span>Until (India time)</span><input data-autofocus type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} required /></label>
      <div className="dialog-actions"><button type="button" className="btn" onClick={close}>Cancel</button><button className="btn primary">Snooze</button></div></form>
  </Modal>;
}
function NoteModal({ task, close, save }: { task: any; close: () => void; save: (note: string) => void }) {
  const [note, setNote] = useState(task.note ?? '');
  return <Modal title="Task note" onClose={close}>
    <form className="col" onSubmit={(e) => { e.preventDefault(); save(note); }}>
      <label className="field"><span>Note</span><textarea data-autofocus rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={3000} /></label>
      <div className="dialog-actions"><button type="button" className="btn" onClick={close}>Cancel</button><button className="btn primary">Save</button></div></form>
  </Modal>;
}

// ---------- do not contact ----------
export function Lists() {
  const { data, error, loading, reload } = useLoad(() => api.get('/api/sh/lists'));
  const w = useShWrite(() => reload(true)); const [adding, setAdding] = useState<any>(null); const [term, setTerm] = useState('');
  if (isOff(error)) return <Off />;
  if (loading && !data) return <Loading kind="table" rows={4} />;
  if (error) return <Failure error={error} retry={reload} />;
  const lists: any[] = data.lists; const t = term.trim().toLowerCase();
  return <>
    <SyncedLine s={data} reload={reload} />
    {!lists.length ? <div className="card"><Empty title="No lists synced">Do not contact lists appear after a sync. They are created in Saleshandy.</Empty></div> : <>
      <input className="input" placeholder="Find an email or domain" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Find an email or domain" style={{ maxWidth: 360 }} />
      {lists.map((l) => { const items = (data.items as any[]).filter((i) => i.list_id === l.id && (!t || i.value.includes(t))); return <div key={l.id} className="card col">
        <div className="row between wrap"><div><h2>{l.name}</h2><p className="faint" style={{ fontSize: 'var(--fs-0)' }}>{l.item_count ?? items.length} entries</p></div>
          <div className="row"><button className="btn sm primary" onClick={() => setAdding(l)}>Add</button><AppLink to="/settings/do-not-contact">Remove in Saleshandy</AppLink></div></div>
        {!items.length ? <p className="muted">{t ? 'No match in this list.' : 'Empty.'}</p> : <div className="row wrap" style={{ gap: 6 }}>{items.slice(0, 300).map((i) => <span key={i.id} className="tag">{i.value}</span>)}{items.length > 300 && <span className="faint">and {items.length - 300} more</span>}</div>}
      </div>; })}</>}
    {adding && <AddDnc list={adding} close={() => setAdding(null)} go={(items) => { const l = adding; setAdding(null); void w.run({ action: 'dnc.add', input: { listId: l.id, items }, risk: 'medium', count: items.length, target: `"${l.name}" (${items.length} ${items.length === 1 ? 'entry' : 'entries'}; Saleshandy will never write to them)`, verb: `Add ${items.length}`, done: `Added ${items.length} to "${l.name}"` }); }} />}
    {w.ui}
  </>;
}
function AddDnc({ list, close, go }: { list: any; close: () => void; go: (items: string[]) => void }) {
  const [text, setText] = useState('');
  const items = [...new Set(text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 3 && s.includes('.')))];
  return <Modal title={`Add to "${list.name}"`} onClose={close}>
    <form className="col" onSubmit={(e) => { e.preventDefault(); if (items.length) go(items); }}>
      <label className="field"><span>Emails or domains, one per line</span><textarea data-autofocus rows={6} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>{items.length} to add</p>
      <div className="dialog-actions"><button type="button" className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!items.length || items.length > 1000}>Continue</button></div></form>
  </Modal>;
}

// ---------- mailboxes: read only ----------
export function Mailboxes() {
  const { data, error, loading, reload } = useLoad(() => api.get('/api/sh/mailboxes'));
  if (isOff(error)) return <Off />;
  if (loading && !data) return <Loading kind="table" rows={3} />;
  if (error) return <Failure error={error} retry={reload} />;
  const rows: any[] = data.rows;
  return <>
    <SyncedLine s={data} reload={reload} />
    {!rows.length ? <div className="card"><Empty title="No mailboxes synced">Sending mailboxes appear after a sync. They are connected in Saleshandy.</Empty></div>
      : <div className="card flush"><div className="row between" style={{ padding: '12px 16px' }}><h2>Sending mailboxes</h2><AppLink to={data.app_url}>Manage in Saleshandy</AppLink></div><div className="scrollx"><table className="t">
        <thead><tr><th>Mailbox</th><th>Provider</th><th>Status</th><th className="num">Health score</th><th className="num">Left today</th><th className="num">Daily limit</th></tr></thead>
        <tbody>{rows.map((m) => <tr key={m.id}><td><b style={{ fontWeight: 600 }}>{m.from_email}</b>{m.from_name && <div className="sub">{m.from_name}</div>}</td><td>{m.provider ?? <span className="faint">Not known</span>}</td><td><ShStatus s={m.status} /></td>
          <td className="num">{m.health?.health_score ?? '·'}</td><td className="num">{m.health?.remaining_quota ?? '·'}</td><td className="num">{m.health?.daily_limit ?? '·'}</td></tr>)}</tbody></table></div></div>}
    <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>Warm-up, reconnecting and sending settings are changed in Saleshandy only.</p>
  </>;
}

// ---------- enrichment (admins): every request spends credits ----------
export function Enrich() {
  const credits = useLoad(() => api.get('/api/sh/credits'));
  const toast = useToast(); const [requests, setRequests] = useState<{ id: string; label: string }[]>([]);
  const w = useShWrite(() => credits.reload(true));
  const [domains, setDomains] = useState(''); const [urls, setUrls] = useState(''); const [phone, setPhone] = useState(false);
  const [check, setCheck] = useState<{ id: string; busy: boolean; result?: any } | null>(null);
  if (isOff(credits.error)) return <Off />;
  const dl = [...new Set(domains.split(/[\s,;]+/).map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter((s) => s.includes('.')))];
  const ul = [...new Set(urls.split(/\s+/).map((s) => s.trim()).filter((s) => /^https:\/\/(www\.)?linkedin\.com\//i.test(s)))];
  const c = credits.data; const left = c?.cap ? c.cap - c.spent : null;
  const remember = (label: string) => (o: any) => { const id = o?.requestId ?? o?.request_id ?? o?.id; if (id) setRequests((r) => [{ id: String(id), label }, ...r]); };
  const lookup = async (id: string) => { setCheck({ id, busy: true }); try { setCheck({ id, busy: false, result: await api.get(`/api/sh/enrich/${encodeURIComponent(id)}`) }); } catch (e: any) { setCheck(null); toast(e.message, { err: true }); } };
  return <>
    <div className="card col"><h2>Credits</h2>
      {credits.loading && !c ? <Loading kind="list" rows={1} /> : credits.error ? <Failure error={credits.error} retry={credits.reload} /> : <dl className="kv">
        <dt>Balance</dt><dd>{c.balance ?? (c.error ? `Could not be read: ${c.error}` : 'Not known')}</dd>
        <dt>Spent this month</dt><dd>{c.spent}</dd>
        <dt>Monthly cap</dt><dd>{c.cap || 'Not set: every spend is refused'}</dd>
        <dt>Left under the cap</dt><dd>{left ?? 'None'}</dd></dl>}
      {c && !c.production && <div className="banner warn"><span>This is not production, so every credit-spending request is refused. Nothing here can spend credits.</span></div>}
    </div>
    <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
      <form className="card col" onSubmit={async (e) => { e.preventDefault(); if (await w.run({ action: 'enrich.company', input: { domains: dl }, risk: 'spend', target: `${dl.length} ${dl.length === 1 ? 'company' : 'companies'}`, estimate: dl.length, verb: 'Spend credits', done: 'Company enrichment sent', onSent: remember(`${dl.length} companies`) })) setDomains(''); }}>
        <h2>Companies</h2><label className="field"><span>Domains, one per line</span><textarea rows={5} value={domains} onChange={(e) => setDomains(e.target.value)} /></label>
        <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>{dl.length} domains · up to {dl.length} credits</p>
        <div><button className="btn primary" disabled={!dl.length || dl.length > 100 || w.busy}>Enrich</button></div></form>
      <form className="card col" onSubmit={async (e) => { e.preventDefault(); if (await w.run({ action: 'enrich.contact', input: { linkedinUrls: ul, revealPhone: phone }, risk: 'spend', target: `${ul.length} ${ul.length === 1 ? 'person' : 'people'}`, estimate: ul.length * (phone ? 2 : 1), verb: 'Spend credits', done: 'Contact enrichment sent', onSent: remember(`${ul.length} people`) })) setUrls(''); }}>
        <h2>People</h2><label className="field"><span>LinkedIn profile links, one per line</span><textarea rows={5} value={urls} onChange={(e) => setUrls(e.target.value)} /></label>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={phone} onChange={(e) => setPhone(e.target.checked)} />Phone numbers too (twice the credits)</label>
        <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>{ul.length} people · up to {ul.length * (phone ? 2 : 1)} credits</p>
        <div><button className="btn primary" disabled={!ul.length || ul.length > 100 || w.busy}>Enrich</button></div></form>
    </div>
    <div className="card col"><h2>Check a result</h2><p className="faint" style={{ fontSize: 'var(--fs-0)' }}>Enrichment runs in Saleshandy and takes a while. The request id is in the write log on Integration status.</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get('rid') ?? '').trim(); if (v) void lookup(v); }}><input name="rid" className="input grow" placeholder="Request id" aria-label="Request id" /><button className="btn sm">{check?.busy ? <Spinner /> : null}Check</button></form>
      {requests.map((r) => <button key={r.id} className="link-btn" onClick={() => lookup(r.id)}>{r.label}: {r.id}</button>)}
      {check?.result && <pre className="quote" style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 360, overflow: 'auto' }}>{JSON.stringify(check.result, null, 2)}</pre>}
    </div>
    {w.ui}
  </>;
}
