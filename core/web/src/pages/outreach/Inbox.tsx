import { useEffect, useState } from 'react';
import { api } from '../../api.ts';
import { useRouter } from '../../router.tsx';
import { useLoad } from '../../ui/hooks.ts';
import { Icon } from '../../ui/icons.tsx';
import { Modal } from '../../ui/overlay.tsx';
import { useMe, isAdmin } from '../../session.tsx';
import { Empty, Failure, Loading, Spinner, ago, when } from '../../ui/kit.tsx';
import { useShWrite } from '../../ui/shwrite.tsx';
import { AppLink, Off, ShStatus, SyncedLine, isOff, personName } from './common.tsx';
import { ProspectDrawer } from './Prospects.tsx';

const FILTERS: [string, string][] = [['all', 'All'], ['unread', 'Unread'], ['positive', 'Positive'], ['neutral', 'Neutral'], ['negative', 'Negative']];

// The Saleshandy unified inbox, from the synced copy. A thread is read fresh from Saleshandy when it is opened.
export function ShInbox() {
  const { search, go } = useRouter();
  const filter = search.get('filter') ?? 'all'; const seq = search.get('sequence') ?? ''; const id = search.get('thread');
  const { data, error, loading, reload } = useLoad(() => api.get(`/api/sh/inbox?filter=${filter}${seq ? `&sequence=${encodeURIComponent(seq)}` : ''}`), [filter, seq]);
  const seqs = useLoad(() => api.get('/api/sh/sequences').catch(() => ({ rows: [] })));
  const set = (k: string, v: string | null) => { const s = new URLSearchParams(search); if (v) s.set(k, v); else s.delete(k); go(`/outreach/inbox${s.toString() ? `?${s}` : ''}`, true); };
  const rows: any[] = data?.rows ?? [];
  useEffect(() => { if (!id && rows[0] && matchMedia('(min-width: 900px)').matches) set('thread', rows[0].id); }, [rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (isOff(error)) return <Off />;
  return <>
    <div className="row wrap between">
      <div className="chip-row" role="group" aria-label="Show">{FILTERS.map(([k, l]) => <button key={k} type="button" className="filter-chip" aria-pressed={filter === k} onClick={() => set('filter', k === 'all' ? null : k)}>{l}</button>)}</div>
      <select className="input" style={{ maxWidth: 280 }} value={seq} onChange={(e) => set('sequence', e.target.value || null)} aria-label="Sequence"><option value="">Every sequence</option>{(seqs.data?.rows ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
    </div>
    <SyncedLine s={data} reload={reload} />
    {loading && !data ? <Loading kind="list" rows={6} /> : error ? <Failure error={error} retry={reload} />
      : !rows.length ? <div className="card"><Empty title={filter === 'all' && !seq ? 'No replies synced' : 'Nothing matches'}>{filter === 'all' && !seq ? 'Replies from Saleshandy appear here after a sync or a webhook.' : 'Try another filter.'}</Empty></div>
        : <div className="split">
          <div className="list" role="listbox" aria-label="Threads">{rows.map((t) => <button key={t.id} role="option" aria-selected={t.id === id} className={t.id === id ? 'on' : ''} onClick={() => set('thread', t.id)}>
            <div className="row"><span className={`dot ${t.is_read ? '' : 'hot'}`} aria-hidden="true" />{!t.is_read && <span className="sr">Unread</span>}<b className="grow ellipsis" style={{ fontWeight: 600 }}>{t.first_name ? personName(t) : t.prospect_email}</b><span className="when">{ago(t.last_message_at)}</span></div>
            <span className="ellipsis">{t.subject || 'No subject'}</span>
            <span className="row" style={{ gap: 6 }}>{t.sentiment && <ShStatus s={t.sentiment} />}{t.sequence_title && <span className="faint ellipsis" style={{ fontSize: 'var(--fs-0)' }}>{t.sequence_title}</span>}</span>
          </button>)}</div>
          {id ? <Thread id={id} key={id} changed={() => reload(true)} /> : <div className="card"><p className="muted">Choose a thread.</p></div>}
        </div>}
  </>;
}

function Thread({ id, changed }: { id: string; changed: () => void }) {
  const { data, error, loading, reload } = useLoad(() => api.get(`/api/sh/inbox/${encodeURIComponent(id)}`), [id]);
  const me = useMe(); const w = useShWrite(() => { reload(true); changed(); });
  const [reply, setReply] = useState(''); const [task, setTask] = useState(false); const [open, setOpen] = useState(false);
  if (loading && !data) return <Loading rows={3} />;
  if (error) return <Failure error={error} retry={reload} />;
  const t = data.thread; const msgs: any[] = data.messages;
  // direction is not always given: a message not from the prospect is ours
  const out = (m: any) => (m.direction ? /out|sent/i.test(m.direction) : String(m.from_email ?? '').toLowerCase() !== String(t.prospect_email ?? '').toLowerCase());
  const lastIn = [...msgs].reverse().find((m) => !out(m)) ?? msgs[msgs.length - 1];
  const send = async () => {
    if (!lastIn) return;
    const ok = await w.run({ action: 'inbox.reply', input: { threadId: t.id, emailId: lastIn.id, content: reply.trim(), to: [t.prospect_email] }, risk: 'high', target: `a reply to ${t.prospect_email}`, verb: 'Send the reply', phrase: 'send', done: `Reply to ${t.prospect_email}` });
    if (ok) setReply('');
  };
  return <div className="col" style={{ gap: 'var(--s-4)' }}>
    {data.live_error && <div className="banner warn"><span>Shown from the synced copy: Saleshandy could not be reached ({data.live_error}).</span></div>}
    <div className="card col">
      <div className="row between wrap"><div><div className="co-name" style={{ fontSize: 'var(--fs-4)' }}>{t.subject || 'No subject'}</div>
        <p className="muted" style={{ marginTop: 4 }}>{t.first_name ? `${personName(t)} · ` : ''}{t.prospect_email}{t.sequence_title ? ` · ${t.sequence_title}` : ''}</p></div>
        <div className="row">{t.prospect_id && <button className="btn sm ghost" onClick={() => setOpen(true)}>Prospect</button>}{t.prospect_id && <button className="btn sm" onClick={() => setTask(true)}><Icon.plus size={14} />Task</button>}
          <AppLink to="/unified-inbox">Set the outcome in Saleshandy <Icon.out size={13} /></AppLink></div></div>
      {!msgs.length ? <p className="muted">No messages synced in this thread yet.</p> : msgs.map((m) => <div key={m.id} className="col" style={{ gap: 6 }}>
        <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>{out(m) ? 'We wrote' : 'They wrote'} · {m.from_email} · {when(m.sent_at)}</p>
        <div className="quote" style={out(m) ? { borderLeftColor: 'var(--hairline)' } : undefined}>{m.body_text || <span className="faint">No text</span>}</div></div>)}
    </div>
    {isAdmin(me) ? <div className="composer">
      <div className="to"><span className="k">To</span><span className="grow">{t.prospect_email}</span></div>
      <textarea className="body" value={reply} onChange={(e) => setReply(e.target.value)} aria-label="Reply" placeholder="Write the reply. It goes from the mailbox this thread came through." maxLength={20000} />
      <div className="foot"><button className="btn primary" onClick={send} disabled={!reply.trim() || w.busy || !lastIn}>{w.busy ? <Spinner /> : <Icon.send size={16} />}Send</button>
        <span className="right faint" style={{ fontSize: 'var(--fs-0)' }}>Waits 10 seconds with Undo before it goes.</span></div>
    </div> : <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>Replying from here is for admins. Reply in Saleshandy, or ask an admin.</p>}
    {task && <NewTask prospectId={t.prospect_id} who={t.prospect_email} close={() => setTask(false)} run={w.run} />}
    {open && <ProspectDrawer id={t.prospect_id} close={() => setOpen(false)} />}
    {w.ui}
  </div>;
}

const TASK_TYPES: [string, string][] = [['2', 'Call'], ['3', 'Manual email'], ['4', 'LinkedIn connection request'], ['5', 'LinkedIn message'], ['6', 'LinkedIn view profile'], ['9', 'Custom task']];
export function NewTask({ prospectId, who, close, run }: { prospectId: string; who: string; close: () => void; run: ReturnType<typeof useShWrite>['run'] }) {
  const [type, setType] = useState('2'); const [due, setDue] = useState(''); const [note, setNote] = useState(''); const [priority, setPriority] = useState('3');
  return <Modal title="New task in Saleshandy" onClose={close}>
    <form className="col" onSubmit={async (e) => { e.preventDefault(); close(); await run({ action: 'task.create', input: { prospectIds: [prospectId], taskType: type, priority, ...(due ? { dueDate: due } : {}), ...(note.trim() ? { note: note.trim() } : {}) }, risk: 'medium', count: 1, target: `a ${TASK_TYPES.find((x) => x[0] === type)?.[1].toLowerCase()} task for ${who}`, verb: 'Create the task', done: 'Task created' }); }}>
      <label className="field"><span>Kind</span><select data-autofocus value={type} onChange={(e) => setType(e.target.value)}>{TASK_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="field"><span>Priority</span><select value={priority} onChange={(e) => setPriority(e.target.value)}><option value="1">Urgent</option><option value="2">High</option><option value="3">Normal</option><option value="4">Low</option></select></label>
      <label className="field"><span>Due (optional)</span><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      <label className="field"><span>Note (optional)</span><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={3000} /></label>
      <div className="dialog-actions"><button type="button" className="btn" onClick={close}>Cancel</button><button className="btn primary">Continue</button></div>
    </form>
  </Modal>;
}
