import { useState } from 'react';
import { api } from '../../api.ts';
import { Link, match, useRouter } from '../../router.tsx';
import { useLoad } from '../../ui/hooks.ts';
import { Icon } from '../../ui/icons.tsx';
import { Modal } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { useMe, isAdmin } from '../../session.tsx';
import { Badge, Empty, Failure, Loading, Spinner, ago, when } from '../../ui/kit.tsx';
import { Crumbs } from '../../ui/chrome.tsx';
import { useShWrite } from '../../ui/shwrite.tsx';
import { AppLink, Off, OutreachNav, ShStatus, SyncedLine, isOff, personName, rate, seqStatus } from './common.tsx';
import { ShInbox } from './Inbox.tsx';
import { Prospects, Unlinked, ProspectDrawer } from './Prospects.tsx';
import { Tasks, Lists, Mailboxes, Enrich } from './Work.tsx';

// Outreach: what is happening in Saleshandy, read from the synced copy, with the actions the write gateway allows.
export function Outreach() {
  const { path } = useRouter(); const me = useMe(); let m;
  let body: React.ReactNode; let title = 'Outreach'; let lede = 'Sequences, replies and prospects from Saleshandy. Saleshandy stays the source of truth; this is a synced copy.';
  if ((m = match('/outreach/sequences/:id', path))) return <div className="page"><Sequence id={m.id} key={m.id} /></div>;
  if (path.startsWith('/outreach/inbox')) { title = 'Outreach inbox'; lede = 'Replies from every mailbox, as Saleshandy has them.'; body = <ShInbox />; }
  else if (path.startsWith('/outreach/prospects')) { title = 'Prospects'; lede = 'Everyone in Saleshandy, linked to our companies and contacts where we can tell.'; body = <Prospects />; }
  else if (path.startsWith('/outreach/tasks')) { title = 'Outreach tasks'; lede = 'Calls, LinkedIn steps and other manual tasks from sequences.'; body = <Tasks />; }
  else if (path.startsWith('/outreach/lists')) { title = 'Do not contact'; lede = 'Emails and domains Saleshandy will never write to.'; body = <Lists />; }
  else if (path.startsWith('/outreach/mailboxes')) { title = 'Mailbox health'; lede = 'Read only. Connecting, warming up and settings stay in Saleshandy.'; body = <Mailboxes />; }
  else if (path.startsWith('/outreach/enrich') && isAdmin(me)) { title = 'Enrichment'; lede = 'Find emails and company details. Every request spends credits and is checked against the monthly cap.'; body = <Enrich />; }
  else if (path.startsWith('/outreach/unlinked')) { title = 'Not linked yet'; lede = 'Saleshandy prospects we could not match to one of our companies or contacts. Link them by hand; a sync never changes a link made by a person.'; body = <Unlinked />; }
  else if (path.startsWith('/outreach/status')) { title = 'Integration status'; lede = 'Syncs, webhooks, every write and the switches that allow them.'; body = <Status />; }
  else body = <Overview />;
  return <div className="page">
    <div className="head"><div><h1>{title}</h1><p>{lede}</p></div></div>
    <OutreachNav />
    {body}
  </div>;
}

// ---------- overview ----------
function Overview() {
  const { data, error, loading, reload } = useLoad(() => api.get('/api/sh/sequences'));
  const w = useShWrite(() => reload(true)); const me = useMe(); const [creating, setCreating] = useState(false);
  if (loading && !data) return <Loading kind="table" rows={4} />;
  if (isOff(error)) return <Off />;
  if (error) return <Failure error={error} retry={reload} />;
  const rows: any[] = data.rows; const t = (s: any, k: string) => Number(s.totals?.[k] ?? 0);
  const sent = rows.reduce((a, s) => a + t(s, 'sent'), 0), replied = rows.reduce((a, s) => a + t(s, 'replied'), 0), bounced = rows.reduce((a, s) => a + t(s, 'bounced'), 0);
  const toggle = (s: any) => seqStatus(s) === 'active'
    ? w.run({ action: 'sequence.set_status', input: { sequenceIds: [s.id], status: 'paused' }, risk: 'medium', target: `the sequence "${s.title}"`, verb: 'Pause the sequence', done: `Paused "${s.title}"` })
    : w.run({ action: 'sequence.set_status', input: { sequenceIds: [s.id], status: 'active' }, risk: 'high', target: `the sequence "${s.title}" (emails start going out again)`, verb: 'Resume the sequence', phrase: 'resume', done: `Resuming "${s.title}"` });
  return <>
    <SyncedLine s={data} reload={reload} />
    <div className="tiles">
      <div className="tile"><span style={{ fontWeight: 600 }}>Active sequences</span><span className="n">{rows.filter((s) => seqStatus(s) === 'active').length}</span><span className="hint">of {rows.length}</span></div>
      <div className="tile"><span style={{ fontWeight: 600 }}>Emails sent</span><span className="n">{sent}</span><span className="hint">all sequences, all time</span></div>
      <div className="tile"><span style={{ fontWeight: 600 }}>Replies</span><span className="n">{replied}</span><span className="hint">reply rate {rate(replied, sent)}</span></div>
      <div className="tile"><span style={{ fontWeight: 600 }}>Bounces</span><span className="n">{bounced}</span><span className="hint">bounce rate {rate(bounced, sent)}</span></div>
    </div>
    <div className="card flush">
      <div className="row between wrap" style={{ padding: '12px 16px' }}><h2>Sequences</h2>
        <div className="row">{isAdmin(me) && <button className="btn sm" onClick={() => setCreating(true)}><Icon.plus size={14} />New sequence</button>}<AppLink to="/sequence">Open Saleshandy <Icon.out size={13} /></AppLink></div></div>
      {!rows.length ? <Empty title="No sequences yet">Sequences appear here after the first sync. They are written in Saleshandy.</Empty>
        : <div className="scrollx"><table className="t">
          <thead><tr><th>Sequence</th><th>Status</th><th className="num">Prospects</th><th className="num">Sent</th><th className="num">Replies</th><th className="num">Reply rate</th><th className="num">Bounces</th><th><span className="sr">Actions</span></th></tr></thead>
          <tbody>{rows.map((s) => <tr key={s.id}>
            <td><Link to={`/outreach/sequences/${encodeURIComponent(s.id)}`} style={{ fontWeight: 600 }}>{s.title || 'Untitled'}</Link>{s.totals_at && <div className="sub">numbers from {ago(s.totals_at)}</div>}</td>
            <td><ShStatus s={seqStatus(s)} /></td><td className="num">{s.prospects}</td><td className="num">{t(s, 'sent')}</td><td className="num">{t(s, 'replied')}</td><td className="num">{rate(t(s, 'replied'), t(s, 'sent'))}</td><td className="num">{t(s, 'bounced')}</td>
            <td style={{ textAlign: 'right' }}>{seqStatus(s) === 'draft' ? null : seqStatus(s) === 'active' ? <button className="btn sm" onClick={() => toggle(s)} disabled={w.busy}>Pause</button>
              : isAdmin(me) ? <button className="btn sm" onClick={() => toggle(s)} disabled={w.busy}>Resume</button> : <span className="faint" style={{ fontSize: 'var(--fs-0)' }}>An admin resumes</span>}</td></tr>)}</tbody></table></div>}
    </div>
    <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>Opens and clicks are left out on purpose: mail privacy features open and click on their own, so those numbers are not reliable.</p>
    {creating && <NewSequence close={() => setCreating(false)} run={w.run} />}
    {w.ui}
  </>;
}
function NewSequence({ close, run }: { close: () => void; run: ReturnType<typeof useShWrite>['run'] }) {
  const [title, setTitle] = useState('');
  return <Modal title="New sequence" onClose={close}>
    <form className="col" onSubmit={async (e) => { e.preventDefault(); close(); await run({ action: 'sequence.create', input: { title: title.trim() }, risk: 'high', target: `a new sequence "${title.trim()}"`, verb: 'Create the sequence', phrase: title.trim(), done: `Creating "${title.trim()}"` }); }}>
      <label className="field"><span>Name</span><input data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required /></label>
      <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>It is created empty. Steps, variants and settings are written in Saleshandy.</p>
      <div className="dialog-actions"><button type="button" className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!title.trim()}>Continue</button></div>
    </form>
  </Modal>;
}

// ---------- sequence detail ----------
function Sequence({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad(() => api.get(`/api/sh/sequences/${encodeURIComponent(id)}`), [id]);
  const w = useShWrite(() => reload(true)); const me = useMe(); const [adding, setAdding] = useState(false); const [open, setOpen] = useState<string | null>(null);
  const crumbs = <Crumbs items={[{ to: '/outreach', label: 'Outreach' }, { label: data?.sequence?.title ?? 'Sequence' }]} />;
  if (loading && !data) return <>{crumbs}<Loading rows={5} /></>;
  if (isOff(error)) return <>{crumbs}<Off /></>;
  if (error) return <>{crumbs}<Failure error={error} retry={reload} /></>;
  const s = data.sequence; const st = seqStatus(s); const t = (k: string) => Number(s.totals?.[k] ?? 0);
  const members: any[] = data.members; const firstStep = data.steps[0]?.id;
  const setProspect = (p: any, status: string) => w.run({ action: 'prospect.set_status', input: { prospectId: p.prospect_id, sequenceId: s.id, status, ...(status === 'active' && p.step_id ? { stepId: p.step_id } : {}) },
    risk: status === 'active' ? 'high' : 'medium', target: `${personName(p)} in "${s.title}"`, verb: status === 'active' ? 'Resume this prospect' : status === 'paused' ? 'Pause this prospect' : 'Finish this prospect', phrase: 'resume', done: `${personName(p)}: ${status === 'active' ? 'resuming' : status}` });
  return <>
    {crumbs}
    <div className="head"><div><h1>{s.title || 'Untitled'}</h1><p className="row wrap" style={{ gap: 8 }}><ShStatus s={st} /><span>{members.length} prospects · {t('sent')} sent · {t('replied')} replies ({rate(t('replied'), t('sent'))}) · {t('bounced')} bounces</span></p></div>
      <div className="row wrap">
        {st === 'active' ? <button className="btn" disabled={w.busy} onClick={() => w.run({ action: 'sequence.set_status', input: { sequenceIds: [s.id], status: 'paused' }, risk: 'medium', target: `the sequence "${s.title}"`, verb: 'Pause the sequence', done: `Paused "${s.title}"` })}>Pause</button>
          : st !== 'draft' && isAdmin(me) && <button className="btn" disabled={w.busy} onClick={() => w.run({ action: 'sequence.set_status', input: { sequenceIds: [s.id], status: 'active' }, risk: 'high', target: `the sequence "${s.title}" (emails start going out again)`, verb: 'Resume the sequence', phrase: 'resume', done: `Resuming "${s.title}"` })}>Resume</button>}
        {firstStep && <button className="btn primary" onClick={() => setAdding(true)}><Icon.plus size={15} />Add prospects</button>}
        {isAdmin(me) && <button className="btn" disabled={w.busy} onClick={() => w.run({ action: 'sequence.verify_prospects', input: { sequenceId: s.id }, risk: 'spend', target: `verifying the ${members.length} addresses in "${s.title}"`, estimate: Math.max(1, members.length), verb: 'Verify the addresses', done: 'Verification started' })}>Verify addresses</button>}
        <AppLink to={data.edit_url}>Edit in Saleshandy <Icon.out size={13} /></AppLink>
      </div></div>
    <SyncedLine s={data} reload={reload} />
    {data.live_error && <div className="banner warn"><span>Settings and subsequences are read live and Saleshandy could not be reached: {data.live_error}</span></div>}
    <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px' }}>
      <div className="card flush"><div style={{ padding: '12px 16px' }}><h2>Prospects in it</h2></div>
        {!members.length ? <Empty title="Nobody in this sequence yet">Add prospects, or add them in Saleshandy; they appear after the next sync.</Empty>
          : <div className="scrollx"><table className="t"><thead><tr><th>Prospect</th><th>Status</th><th>Our record</th><th><span className="sr">Actions</span></th></tr></thead>
            <tbody>{members.map((p) => { const ps = String(p.status ?? '').toLowerCase(); return <tr key={p.prospect_id}>
              <td><button className="link-btn" onClick={() => setOpen(p.prospect_id)} style={{ fontWeight: 600 }}>{personName(p)}</button><div className="sub">{p.email}{p.company_name ? ` · ${p.company_name}` : ''}</div></td>
              <td><ShStatus s={p.status} /></td><td>{p.company_id ? <Link to={`/crm/companies/${p.company_id}`}>Open company</Link> : <span className="faint">Not linked</span>}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {ps === 'active' && <><button className="btn sm" disabled={w.busy} onClick={() => setProspect(p, 'paused')}>Pause</button> <button className="btn sm ghost" disabled={w.busy} onClick={() => setProspect(p, 'finished')}>Finish</button></>}
                {ps === 'paused' && isAdmin(me) && <button className="btn sm" disabled={w.busy} onClick={() => setProspect(p, 'active')}>Resume</button>}
              </td></tr>; })}</tbody></table></div>}
      </div>
      <div className="col" style={{ gap: 'var(--s-4)' }}>
        <div className="card col"><div className="row between"><h2>Steps</h2><AppLink to={data.edit_url}>Edit</AppLink></div>
          {!data.steps.length ? <p className="muted">No steps synced.</p> : <ol className="col" style={{ gap: 8, paddingLeft: 18 }}>{data.steps.map((x: any) => <li key={x.id}><b style={{ fontWeight: 600 }}>{x.subject || (x.type ? String(x.type).replace(/_/g, ' ') : 'Step')}</b><div className="faint" style={{ fontSize: 'var(--fs-0)' }}>Day {x.relative_days ?? 0}{x.variant_count > 1 ? ` · ${x.variant_count} variants` : ''}{x.status ? ` · ${x.status}` : ''}</div></li>)}</ol>}
        </div>
        <div className="card col"><h2>Sending schedule</h2>
          {!data.schedules.length ? <p className="muted">No schedules synced. Schedules are created in Saleshandy.</p>
            : <label className="field"><span>Schedule</span><select value={s.schedule_id ?? ''} disabled={w.busy} onChange={(e) => { const sc = data.schedules.find((x: any) => x.id === e.target.value); if (sc) void w.run({ action: 'sequence.set_schedule', input: { sequenceId: s.id, scheduleId: sc.id }, risk: 'medium', target: `the schedule of "${s.title}" to "${sc.data?.name ?? sc.id}"`, verb: 'Change the schedule', done: 'Schedule changed' }); }}>
              {!s.schedule_id && <option value="">Not known</option>}{data.schedules.map((x: any) => <option key={x.id} value={x.id}>{x.data?.name ?? x.id}</option>)}</select></label>}
          <AppLink to="/settings/schedules">New schedule in Saleshandy</AppLink>
        </div>
        <div className="card col"><h2>Subsequences</h2>
          {!data.subsequences.length ? <p className="muted">{data.live_error ? 'Could not be read.' : 'None.'}</p> : data.subsequences.map((x: any) => <div key={x.id ?? x.title} className="row between"><span>{x.title ?? x.name ?? x.id}</span><ShStatus s={x.status ?? (x.active ? 'active' : 'paused')} /></div>)}
          <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>Conditions are set in Saleshandy.</p>
        </div>
      </div>
    </div>
    {adding && <AddProspects seq={s} stepId={firstStep} existing={new Set(members.map((p) => p.prospect_id))} close={() => setAdding(false)} run={w.run} />}
    {open && <ProspectDrawer id={open} close={() => { setOpen(null); reload(true); }} />}
    {w.ui}
  </>;
}
function AddProspects({ seq, stepId, existing, close, run }: { seq: any; stepId: string; existing: Set<string>; close: () => void; run: ReturnType<typeof useShWrite>['run'] }) {
  const [term, setTerm] = useState(''); const [picked, setPicked] = useState<Set<string>>(new Set());
  const found = useLoad(() => api.get(`/api/sh/prospects?q=${encodeURIComponent(term)}`), [term]);
  const rows: any[] = (found.data?.rows ?? []).filter((p: any) => !existing.has(p.id));
  const flip = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return <Modal title={`Add prospects to "${seq.title}"`} onClose={close} wide>
    <div className="col">
      <input className="input" data-autofocus placeholder="Search by name, email or company" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search prospects" />
      <div className="col" style={{ maxHeight: 320, overflow: 'auto', gap: 4 }}>
        {found.loading && !found.data ? <Loading kind="list" rows={4} /> : !rows.length ? <p className="muted">No prospects found{term ? ` for "${term}"` : ''}. New people are added to Saleshandy by the pipeline or in Saleshandy itself.</p>
          : rows.map((p) => <label key={p.id} className="row" style={{ gap: 10, padding: '6px 4px' }}><input type="checkbox" checked={picked.has(p.id)} onChange={() => flip(p.id)} /><span className="grow">{personName(p)}<span className="faint"> · {p.email}</span></span></label>)}
      </div>
      <div className="dialog-actions"><span className="faint grow" style={{ fontSize: 'var(--fs-0)' }}>{picked.size} chosen. They start at the first step.</span><button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={!picked.size} onClick={async () => { const ids = [...picked]; close(); await run({ action: 'sequence.add_prospects', input: { sequenceId: seq.id, stepId, prospectIds: ids }, risk: 'medium', count: ids.length, target: `"${seq.title}"`, verb: `Add ${ids.length} ${ids.length === 1 ? 'prospect' : 'prospects'}`, done: `Added ${ids.length} to "${seq.title}"` }); }}>Add</button></div>
    </div>
  </Modal>;
}

// ---------- integration status ----------
const FLAG_WORDS: [string, string][] = [['integration', 'Integration (SALESHANDY_INTEGRATION_ENABLED)'], ['live', 'Live calls to Saleshandy (otherwise the fake account)'], ['production', 'Production'], ['writes', 'Writes (SALESHANDY_WRITES_ENABLED)'],
  ['low', 'Low risk writes'], ['medium', 'Medium risk writes'], ['high', 'High risk writes'], ['spend', 'Credit-spending writes'], ['test_sequence_set', 'Test sequence set'], ['webhook_secret_set', 'Webhook secret set']];
const RESOURCE: Record<string, string> = { steps: 'Steps', dnc_lists: 'Do not contact lists', sequences: 'Sequences', prospects: 'Prospects', inbox: 'Inbox', tasks: 'Tasks', dnc_items: 'Do not contact', mailboxes: 'Mailboxes', lookups: 'Schedules, tags and fields' };
function Status() {
  const { data, error, loading, reload } = useLoad(() => api.get('/api/sh/status'));
  const me = useMe(); const toast = useToast(); const [busy, setBusy] = useState<string | null>(null);
  if (loading && !data) return <Loading rows={6} />;
  if (error) return <Failure error={error} retry={reload} />;
  const f = data.flags; const admin = isAdmin(me);
  const act = async (key: string, fn: () => Promise<any>, ok: (r: any) => string) => { setBusy(key); try { const r = await fn(); toast(ok(r)); reload(true); } catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(null); } };
  return <>
    <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
      <div className="card col"><h2>Switches</h2><p className="faint" style={{ fontSize: 'var(--fs-0)' }}>All off by default. They are server settings, changed where the app is hosted, not here.</p>
        <dl className="kv">{FLAG_WORDS.map(([k, l]) => <div key={k} style={{ display: 'contents' }}><dt>{l}</dt><dd>{f[k] ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}</dd></div>)}
          <dt>Test allowlist</dt><dd>{f.allowlist?.length ? f.allowlist.join(', ') : <span className="faint">Empty</span>}</dd>
          <dt>Monthly credit cap</dt><dd>{f.credit_cap || <span className="faint">Not set: nothing may spend</span>}</dd></dl></div>
      <div className="card col"><h2>Synced data</h2>
        <dl className="kv">{data.resources.map((r: any) => <div key={r.resource} style={{ display: 'contents' }}><dt>{RESOURCE[r.resource] ?? r.resource}</dt><dd>{r.last_synced ? ago(r.last_synced) : 'Never'}{r.stale && <span style={{ marginLeft: 8 }}><Badge tone="warning">Stale</Badge></span>}</dd></div>)}</dl>
        <p className="muted" style={{ fontSize: 'var(--fs-0)' }}>{data.counts.sequences} sequences · {data.counts.prospects} prospects ({data.counts.unlinked} not linked) · {data.counts.threads} threads · {data.counts.tasks} tasks · {data.counts.dnc_items} do not contact items · {data.counts.mailboxes} mailboxes</p>
        {data.counts.stuck > 0 && <div className="banner err"><span>{data.counts.stuck} writes have been "sending" for over 5 minutes. Check them in Saleshandy before trying again.</span></div>}
        {admin && <div className="row wrap"><button className="btn sm" disabled={!!busy || !f.integration} onClick={() => act('inc', () => api.run('/api/sh/sync', { kind: 'incremental' }), (r) => `Sync ${r?.status ?? 'finished'}.`)}>{busy === 'inc' && <Spinner />}Sync changes now</button>
          <button className="btn sm" disabled={!!busy || !f.integration} onClick={() => act('full', () => api.run('/api/sh/sync', { kind: 'full' }), (r) => `Full sync ${r?.status ?? 'finished'}.`)}>{busy === 'full' && <Spinner />}Full sync</button></div>}
        <h2 style={{ marginTop: 8 }}>Credits this month</h2>
        <p>{data.spend.spent} spent{data.spend.cap ? ` of ${data.spend.cap}` : ', no cap set'}{data.spend.last_balance != null ? ` · balance ${data.spend.last_balance} at the last spend` : ''}</p>
      </div>
    </div>
    {admin && <LiveChecks flags={f} after={() => reload(true)} />}
    <WebhookSetup secretSet={!!f.webhook_secret_set} received={data.webhooks.length} />
    <div className="card flush"><div style={{ padding: '12px 16px' }}><h2>Recent syncs</h2></div>
      {!data.runs.length ? <Empty title="No syncs yet">The first sync runs when the integration is switched on.</Empty>
        : <div className="scrollx"><table className="t"><thead><tr><th>Started</th><th>Kind</th><th>Status</th><th>Counts</th><th>Problems</th></tr></thead>
          <tbody>{data.runs.map((r: any) => <tr key={r.id}><td>{when(r.started_at)}</td><td>{r.kind}</td><td><ShStatus s={r.status} /></td>
            <td className="sub">{Object.entries(r.counts ?? {}).map(([k, c]: any) => `${RESOURCE[k] ?? k}: ${c.seen ?? 0} seen, ${c.upserted ?? 0} changed${c.skipped ? `, ${c.skipped} skipped` : ''}${c.removed ? `, ${c.removed} removed` : ''}`).join(' · ')}</td>
            <td className="sub">{(r.errors ?? []).slice(0, 3).map((e: any, i: number) => <div key={i}>{e.resource}{e.id ? ` ${e.id}` : ''}: {e.error}</div>)}{(r.errors ?? []).length > 3 && <div>and {(r.errors.length - 3)} more</div>}</td></tr>)}</tbody></table></div>}
    </div>
    <div className="card flush"><div className="row between wrap" style={{ padding: '12px 16px' }}><h2>Webhooks received</h2>
      {admin && data.failed_webhooks > 0 && <button className="btn sm" disabled={!!busy} onClick={() => act('all', () => api.post('/api/sh/webhooks/replay-failed'), (r) => `Replayed ${r.replayed}.`)}>{busy === 'all' && <Spinner />}Replay {data.failed_webhooks} failed</button>}</div>
      {!f.webhook_secret_set && <div style={{ padding: '0 16px 12px' }}><div className="banner warn"><span>No webhook secret is set, so every webhook is refused. Updates arrive through the scheduled syncs only.</span></div></div>}
      {!data.webhooks.length ? <Empty title="No webhooks yet">Once the webhook is registered in Saleshandy, each event shows here.</Empty>
        : <div className="scrollx"><table className="t"><thead><tr><th>Received</th><th>Event</th><th>Status</th><th>Tries</th><th>Error</th><th><span className="sr">Replay</span></th></tr></thead>
          <tbody>{data.webhooks.map((h: any) => <tr key={h.id}><td>{ago(h.received_at)}</td><td>{h.event_type.replace(/-/g, ' ')}</td><td><ShStatus s={h.status} /></td><td className="num">{h.attempts}</td><td className="sub">{h.last_error}</td>
            <td>{admin && h.status === 'failed' && <button className="btn sm" disabled={!!busy} onClick={() => act(h.id, () => api.post(`/api/sh/webhooks/${h.id}/replay`), () => 'Replayed.')}>Replay</button>}</td></tr>)}</tbody></table></div>}
    </div>
    <div className="card flush"><div style={{ padding: '12px 16px' }}><h2>Writes to Saleshandy</h2><p className="faint" style={{ fontSize: 'var(--fs-0)' }}>Every write, including the refused ones, with who asked and what happened.</p></div>
      {!data.audit.length ? <Empty title="No writes yet">Nothing has been sent to Saleshandy from here.</Empty>
        : <div className="scrollx"><table className="t"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Risk</th><th>Outcome</th></tr></thead>
          <tbody>{data.audit.map((a: any) => <tr key={a.id}><td>{ago(a.created_at)}</td><td>{a.actor}</td><td>{a.label ?? a.action}<div className="sub">{a.action}</div></td><td>{a.risk}</td><td><ShStatus s={a.outcome} />{a.reason && <div className="sub">{a.reason}</div>}</td></tr>)}</tbody></table></div>}
    </div>
  </>;
}

// ---------- live checks: run on the server, which reaches Saleshandy ----------
type CheckReport = { mode: 'live' | 'fake'; started_at: string; steps: { name: string; ok: boolean | null; detail: string }[]; summary: string };
function LiveChecks({ flags, after }: { flags: any; after: () => void }) {
  const toast = useToast(); const [busy, setBusy] = useState<string | null>(null); const [reports, setReports] = useState<Record<string, CheckReport>>({});
  const run = async (key: string, path: string) => {
    setBusy(key);
    try { const r = await api.run<CheckReport>(path); setReports((x) => ({ ...x, [key]: r })); after(); } catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(null); }
  };
  const writesOn = flags.writes && flags.low && flags.medium && flags.high;
  return <div className="card col">
    <h2>Live checks</h2>
    <p className="muted" style={{ fontSize: 'var(--fs-0)' }}>These run on the server, against {flags.live ? 'the real Saleshandy account' : <b>the fake account: this server is not live (set SALESHANDY_MODE=real and SALESHANDY_API_KEY)</b>}.</p>
    <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
      <div className="col">
        <p><b style={{ fontWeight: 600 }}>Read checks.</b> <span className="muted">One read of everything the sync uses, the rate limit headers and the credit balance. Reads only; nothing is changed.</span></p>
        <div><button className="btn sm primary" disabled={!!busy} onClick={() => run('read', '/api/sh/live-check')}>{busy === 'read' && <Spinner />}Run read checks</button></div>
        {reports.read && <CheckList r={reports.read} />}
      </div>
      <div className="col">
        <p><b style={{ fontWeight: 600 }}>Test sequence check.</b> <span className="muted">Pauses and resumes the test sequence (only if it is running), then adds a note, a tag and a task to one prospect of it at {flags.allowlist?.length ? flags.allowlist.join(', ') : 'the allowlist'}. Every write goes through the gateway and is logged below. Takes about half a minute.</span></p>
        {(!flags.test_sequence_set || !flags.allowlist?.length) && <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>Needs SALESHANDY_TEST_SEQUENCE_ID and SALESHANDY_TEST_ALLOWLIST set on the server.</p>}
        {!writesOn && <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>Writes are off (SALESHANDY_WRITES_ENABLED, and _LOW, _MEDIUM, _HIGH), so each write will show as refused. That is a useful check of the switches too.</p>}
        <div><button className="btn sm" disabled={!!busy || !flags.test_sequence_set || !flags.allowlist?.length} onClick={() => run('seq', '/api/sh/test-sequence-check')}>{busy === 'seq' && <Spinner />}Run test sequence check</button></div>
        {reports.seq && <CheckList r={reports.seq} />}
      </div>
    </div>
  </div>;
}
function CheckList({ r }: { r: CheckReport }) {
  return <div className="col" style={{ gap: 6 }}>
    <p style={{ fontSize: 'var(--fs-0)' }}><b style={{ fontWeight: 600 }}>{r.summary}</b> <span className="faint">{r.mode === 'live' ? 'Real account' : 'Fake account'} · {ago(r.started_at)}</span></p>
    {r.steps.map((s, i) => <div key={i} className="row" style={{ gap: 8, alignItems: 'flex-start', fontSize: 'var(--fs-0)' }}>
      <Badge tone={s.ok === true ? 'success' : s.ok === false ? 'danger' : 'neutral'}>{s.ok === true ? 'Passed' : s.ok === false ? 'Failed' : 'Skipped'}</Badge>
      <span><b style={{ fontWeight: 600 }}>{s.name}.</b> <span className="muted">{s.detail}</span></span></div>)}
  </div>;
}

// ---------- the webhook: a person registers it in Saleshandy; this says how, and whether events are arriving ----------
const WEBHOOK_EVENTS = ['Reply received', 'Email bounced', 'Prospect unsubscribed', 'Prospect finished', 'Prospect outcome updated', 'Sequence paused', 'Email sent', 'Email account disconnected', 'Email account paused', 'Task created', 'Task updated', 'Bulk task updated', 'Call task updated', 'LinkedIn task updated', 'Custom task updated', 'WhatsApp task updated'];
function WebhookSetup({ secretSet, received }: { secretSet: boolean; received: number }) {
  const toast = useToast(); const url = `${location.origin}/webhooks/saleshandy`;
  const copyIt = async (t: string) => toast((await navigator.clipboard.writeText(t).then(() => true, () => false)) ? 'Copied.' : 'Could not copy.');
  const done = secretSet && received > 0;
  return <details className="card col" open={!done}>
    <summary style={{ cursor: 'pointer' }}><h2 style={{ display: 'inline' }}>Webhook setup</h2> <span style={{ marginLeft: 8 }}>{done ? <Badge tone="success">Receiving events</Badge> : secretSet ? <Badge tone="warning">Secret set, no events yet</Badge> : <Badge tone="warning">Not set up</Badge>}</span></summary>
    <ol className="col" style={{ gap: 10, paddingLeft: 18, marginTop: 12 }}>
      <li><b style={{ fontWeight: 600 }}>Make a secret</b> on your own computer. In Terminal: <code>openssl rand -hex 32</code>. Keep it in your password manager; do not paste it anywhere else.</li>
      <li><b style={{ fontWeight: 600 }}>Give it to the server.</b> In Hostinger, set <code>SALESHANDY_WEBHOOK_SECRET</code> to it, then press Redeploy. {secretSet ? <Badge tone="success">Set</Badge> : <Badge tone="warning">Not set yet</Badge>}</li>
      <li><b style={{ fontWeight: 600 }}>Create the webhook in Saleshandy</b> (its Settings, under Integrations or Webhooks):
        <dl className="kv" style={{ marginTop: 8 }}>
          <dt>Name</dt><dd>ops portal</dd>
          <dt>URL</dt><dd><code>{url}</code> <button className="link-btn" onClick={() => copyIt(url)}>Copy</button></dd>
          <dt>Custom header</dt><dd>Name <code>X-Webhook-Secret</code> <button className="link-btn" onClick={() => copyIt('X-Webhook-Secret')}>Copy</button>, value: the secret from step 1</dd>
          <dt>Events</dt><dd>{WEBHOOK_EVENTS.join(', ')}. Email opened and link clicked are optional: they are kept but marked unreliable.</dd>
        </dl></li>
      <li><b style={{ fontWeight: 600 }}>Test it.</b> Use Saleshandy's test button if it has one, or reply to a test email. The event should appear under Webhooks received below within seconds. {received > 0 ? <Badge tone="success">{received} received</Badge> : <Badge>None yet</Badge>}</li>
    </ol>
    <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>Never put the secret in the URL; it goes in the header only. If events do not arrive, check the header name and value match exactly; a wrong secret is refused and never reaches this page.</p>
  </details>;
}
