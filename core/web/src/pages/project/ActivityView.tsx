import { useEffect, useState } from 'react';
import { api } from '../../api.ts';
import { Link } from '../../router.tsx';
import { Icon } from '../../ui/icons.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Empty, Failure, Skeleton, Spinner, ago } from '../../ui/kit.tsx';
import { Avatar, describe } from './shared.tsx';
import type { WS } from './Workspace.tsx';

const KINDS = [['', 'All activity'], ['tasks', 'Tasks'], ['comments', 'Comments'], ['files', 'Files'], ['pages', 'Notes'], ['project', 'Project']] as const;
const dayOf = (ts: string) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const dayName = (d: string) => { const t = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); const y = new Date(Date.now() - 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return d === t ? 'Today' : d === y ? 'Yesterday' : new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }); };

// Everything recorded on this project, newest first, by day. Only real events: each row was written when it happened.
export function ActivityView({ ws }: { ws: WS }) {
  const { p } = ws; const toast = useToast();
  const [kind, setKind] = useState(''); const [user, setUser] = useState('');
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState<string | null>(null); const [more, setMore] = useState(true); const [busy, setBusy] = useState(false);
  const load = async (before?: string) => {
    setBusy(true); setErr(null);
    try { const qs = new URLSearchParams(); if (kind) qs.set('kind', kind); if (user) qs.set('user', user); if (before) qs.set('before', before);
      const r = await api.get<any[]>(`/api/projects/${p.id}/activity?${qs}`); setRows((x) => (before ? [...(x ?? []), ...r] : r)); setMore(r.length === 60); }
    catch (e: any) { if (before) toast(e.message, { err: true }); else setErr(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { setRows(null); load(); }, [kind, user, p.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const days = new Map<string, any[]>(); for (const a of rows ?? []) days.set(dayOf(a.created_at), [...(days.get(dayOf(a.created_at)) ?? []), a]);
  const open = (a: any) => a.detail?.task_id ? <button type="button" className="link-btn" onClick={() => ws.openTask(a.detail.task_id)}>{describe(a).what}</button>
    : a.detail?.page_id && !a.action.endsWith('deleted') ? <Link to={`/projects/${p.id}/notes/${a.detail.page_id}`}>{describe(a).what}</Link> : <b>{describe(a).what}</b>;
  return (
    <div className="actv">
      <div className="bd-tools">
        <select className="tb-select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind of activity">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="tb-select" value={user} onChange={(e) => setUser(e.target.value)} aria-label="Person"><option value="">Everyone</option>{p.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      </div>
      {err ? <Failure error={err} retry={() => load()} /> : !rows ? <Skeleton h={300} /> : !rows.length ? <div className="panel" style={{ padding: 8 }}><Empty title="Nothing recorded">{kind || user ? 'Nothing matches these filters.' : 'Changes to tasks, notes, files and the project show here as they happen.'}</Empty></div> :
        <div className="panel actv-list">{[...days.entries()].map(([d, list]) => <section key={d} aria-label={dayName(d)}><h3>{dayName(d)}</h3>
          <ol>{list.map((a) => { const x = describe(a); const I = Icon[x.icon]; return (
            <li key={a.id}><span className={`f-ic tone-${x.tone}`} aria-hidden="true"><I size={13} /></span><Avatar name={a.actor_name ?? a.actor} />
              <div><p><b>{a.actor_name ?? a.actor}</b> {x.verb} {x.what ? open(a) : null}{x.note && !x.note.startsWith('“') ? ` ${x.note}` : ''}</p>{x.note?.startsWith('“') && <q>{x.note.slice(1, -1)}</q>}</div>
              <time dateTime={a.created_at} title={new Date(a.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}>{ago(a.created_at)}</time></li>); })}</ol></section>)}
          {more && <button type="button" className="feed-more" onClick={() => load(rows[rows.length - 1].created_at)} disabled={busy}>{busy ? <Spinner /> : <Icon.down size={14} />}Show earlier</button>}</div>}
    </div>
  );
}
