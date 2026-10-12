import { useState } from 'react';
import { api } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useLoad } from '../ui/hooks.ts';
import { Icon } from '../ui/icons.tsx';
import { useToast } from '../ui/toast.tsx';
import { Empty, Failure, Loading, Spinner, dayLabel, isLate } from '../ui/kit.tsx';
import { useMe, useTeam } from '../session.tsx';

export const PROJECT_STATUS: Record<string, string> = { ACTIVE: 'Active', ON_HOLD: 'On hold', DONE: 'Done', ARCHIVED: 'Archived' };
export const TASK_STATUS: Record<string, string> = { TODO: 'To do', DOING: 'Doing', REVIEW: 'In review', DONE: 'Done' };
export const PRIORITY: Record<string, string> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };

export function Projects() {
  const { search, go } = useRouter(); const view = search.get('view') ?? 'projects';
  return (
    <div className="page">
      <div className="head"><div><h1>Projects</h1><p>Client work and internal work, each with its own board.</p></div>
        <div className="tabs" role="tablist">{[['projects', 'All projects'], ['mine', 'My tasks'], ['archived', 'Archived']].map(([k, l]) =>
          <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => go(k === 'projects' ? '/projects' : `/projects?view=${k}`, true)}>{l}</button>)}</div></div>
      {view === 'mine' ? <MyTasks /> : <ProjectList archived={view === 'archived'} />}
    </div>
  );
}

function ProjectList({ archived }: { archived: boolean }) {
  const { data, error, loading, reload } = useLoad(() => api.get<any[]>(`/api/projects${archived ? '?status=ARCHIVED' : ''}`), [archived]);
  const [adding, setAdding] = useState(false);
  if (loading && !data) return <Loading rows={4} />;
  if (error) return <Failure error={error} retry={reload} />;
  return (
    <>
      {!archived && (adding ? <NewProject onDone={() => { setAdding(false); reload(true); }} /> : <div><button className="btn primary" onClick={() => setAdding(true)}><Icon.plus size={16} />New project</button></div>)}
      {!data!.length ? <div className="card"><Empty title={archived ? 'Nothing archived' : 'No projects yet'}>{archived ? 'Archived projects land here.' : 'Start one for the next piece of client work.'}</Empty></div> :
        <div className="cards">{data!.map((p) => <Link key={p.id} to={`/projects/${p.id}`} className="pcard">
          <div className="row between"><h3 className="ellipsis">{p.name}</h3><span className={`tag ${p.status === 'ACTIVE' ? 'ember' : 'dim'}`}>{PROJECT_STATUS[p.status]}</span></div>
          {p.description && <p className="muted ellipsis">{p.description}</p>}
          <div className="progress" aria-label={`${p.done} of ${p.tasks} tasks done`}><i style={{ width: `${p.tasks ? (p.done / p.tasks) * 100 : 0}%` }} /></div>
          <div className="row between faint" style={{ fontSize: 'var(--fs-0)' }}>
            <span>{p.done}/{p.tasks} done{p.overdue ? <b className="late" style={{ fontWeight: 600 }}> · {p.overdue} late</b> : ''}</span>
            <span>{p.company_name ?? p.owner_name ?? ''}{p.due_date ? ` · due ${dayLabel(p.due_date)}` : ''}</span>
          </div>
        </Link>)}</div>}
    </>
  );
}

function NewProject({ onDone }: { onDone: () => void }) {
  const toast = useToast(); const team = useTeam(); const me = useMe(); const { go } = useRouter();
  const [f, setF] = useState({ name: '', description: '', owner_id: me.id, due_date: '' }); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { const p = await api.post('/api/projects', f); toast('Project started.'); onDone(); go(`/projects/${p.id}`); } catch (e: any) { toast(e.message, { err: true }); setBusy(false); }
  };
  return (
    <form className="card col" onSubmit={submit}>
      <h2>New project</h2>
      <div className="grid-form">
        <label className="field" style={{ gridColumn: 'span 2' }}><span>Name</span><input autoFocus required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span>Owner</span><select value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })}>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        <label className="field"><span>Due</span><input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></label>
      </div>
      <label className="field"><span>What it is</span><textarea rows={3} maxLength={5000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      <div className="row"><button className="btn primary" disabled={busy}>{busy && <Spinner />}Create</button><button type="button" className="btn ghost" onClick={onDone}>Cancel</button></div>
    </form>
  );
}

function MyTasks() {
  const { go } = useRouter();
  const { data, error, loading, reload } = useLoad(() => api.get<any[]>('/api/tasks?mine=1'));
  if (loading && !data) return <Loading rows={4} />;
  if (error) return <Failure error={error} retry={reload} />;
  if (!data!.length) return <div className="card"><Empty title="Nothing on your plate">Tasks assigned to you, across every project, show up here.</Empty></div>;
  return (
    <div className="card flush scrollx"><table className="t">
      <thead><tr><th>Task</th><th>Project</th><th>Status</th><th>Priority</th><th>Due</th></tr></thead>
      <tbody>{data!.map((t) => <tr key={t.id} className="click" onClick={() => go(`/projects/${t.project_id}?task=${t.id}`)}>
        <td style={{ fontWeight: 600 }}>{t.title}</td><td className="muted">{t.project_name}</td><td><span className="tag">{TASK_STATUS[t.status]}</span></td>
        <td><span className={`tag ${t.priority === 'HIGH' ? 'ember' : 'dim'}`}>{PRIORITY[t.priority]}</span></td>
        <td className={isLate(t.due_date) ? 'late' : 'sub'}>{dayLabel(t.due_date) || '·'}</td></tr>)}</tbody></table></div>
  );
}
