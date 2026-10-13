import { useState } from 'react';
import { api } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useLoad } from '../ui/hooks.ts';
import { Icon, Dots } from '../ui/icons.tsx';
import { Menu, MenuItem } from '../ui/menu.tsx';
import { Modal } from '../ui/overlay.tsx';
import { useToast } from '../ui/toast.tsx';
import { Badge, Empty, Failure, Skeleton, Spinner, ago, dayLabel, isLate, rowOpen, cardOpen, type Tone } from '../ui/kit.tsx';
import { useMe, useTeam } from '../session.tsx';
import { countsBus } from '../App.tsx';
import { ColorPicker, ProjectMark, accentVars } from '../ui/color.tsx';
import { TaskDrawer } from './project/TaskDrawer.tsx';
import { Avatar, PROJECT_STATUS, PROJECT_TONE, describe } from './project/shared.tsx';

export { PROJECT_STATUS };
export const TASK_STATUS: Record<string, string> = { TODO: 'To do', DOING: 'In progress', REVIEW: 'In review', DONE: 'Done' };
export const PRIORITY: Record<string, string> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
const TASK_TONE: Record<string, Tone> = { TODO: 'neutral', DOING: 'info', REVIEW: 'warning', DONE: 'success' };

export function Projects() {
  const { search, go } = useRouter(); const view = search.get('view') ?? 'projects';
  const summary = useLoad(() => api.get('/api/projects/summary'));
  const mine = useLoad(() => api.get<any[]>('/api/tasks?mine=1'));
  const [adding, setAdding] = useState(search.get('new') === '1');
  const s = summary.data; const date = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' });
  const tabs: [string, string, number | undefined][] = [['projects', 'All projects', s ? s.active + s.on_hold + s.done : undefined], ['mine', 'My tasks', mine.data?.length], ['archived', 'Archived', s?.archived]];
  return (
    <div className="dash-main">
      <div className="hero-row">
        <div className="hero-text"><p className="hero-eyebrow">{date}</p><h1>Projects</h1><p className="lede">Client work and internal work, each with its own board, notes and files.</p></div>
        <div className="quote-card"><span className="qm" aria-hidden="true">“</span><p>Organise the work today. Scale the outcomes tomorrow.</p></div>
        <div className="pstats" aria-label="Projects by state">
          {([['Active projects', s?.active, 'projects', '255, 146, 46'], ['On hold', s?.on_hold, 'clock', '168, 85, 247'], ['Archived', s?.archived, 'archive', '56, 189, 248']] as const).map(([l, n, ic, rgb]) => { const I = Icon[ic]; return (
            <div key={l} className="pstat" style={{ '--tone-rgb': rgb } as React.CSSProperties}><span className="ps-ic" aria-hidden="true"><I size={18} /></span><div><b>{n ?? '·'}</b><span>{l}</span></div></div>); })}
        </div>
      </div>
      <div className="ptabs-row">
        <div className="ptabs" role="tablist" aria-label="Show">{tabs.map(([k, l, n]) =>
          <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => go(k === 'projects' ? '/projects' : `/projects?view=${k}`, true)}>{l}{n != null ? ` (${n})` : ''}</button>)}</div>
        <button className="btn primary glow" onClick={() => setAdding(true)}><Icon.plus size={16} />New project</button>
      </div>
      {view === 'mine' ? <MyTasks /> : <ProjectList archived={view === 'archived'} onNew={() => setAdding(true)} onChanged={() => summary.reload(true)} />}
      {adding && <NewProject onClose={() => setAdding(false)} />}
    </div>
  );
}

function ProjectList({ archived, onNew, onChanged }: { archived: boolean; onNew: () => void; onChanged: () => void }) {
  const { data, error, loading, reload, setData } = useLoad(() => api.get<any[]>(`/api/projects${archived ? '?status=ARCHIVED' : ''}`), [archived]);
  if (loading && !data) return <div className="pgrid">{[0, 1].map((i) => <div key={i} className="pcard2"><Skeleton h={44} w={44} /><Skeleton h={18} w="60%" /><Skeleton h={120} /></div>)}</div>;
  if (error) return <Failure error={error} retry={reload} />;
  if (!data!.length) return <div className="panel" style={{ padding: 8 }}><Empty title={archived ? 'Nothing archived' : 'No projects yet'} action={archived ? undefined : <button className="btn primary" onClick={onNew}><Icon.plus size={16} />New project</button>}>
    {archived ? 'Set a project to Archived from its page and it moves here, out of the way.' : 'Start one for the next piece of client work. Each project gets a board, notes, files and a timeline.'}</Empty></div>;
  const patched = (p: any) => { setData(data!.map((x) => (x.id === p.id ? { ...x, ...p } : x))); onChanged(); if (p.status && (p.status === 'ARCHIVED') !== archived) reload(true); };
  return <div className="pgrid">{data!.map((p) => <ProjectCard key={p.id} p={p} onPatched={patched} />)}</div>;
}

function ProjectCard({ p, onPatched }: { p: any; onPatched: (p: any) => void }) {
  const toast = useToast(); const { go } = useRouter();
  const [preview, setPreview] = useState<string | null | undefined>(undefined); const [busy, setBusy] = useState(false);
  const color = preview === undefined ? p.color : preview;
  const pct = p.tasks ? Math.round((p.done / p.tasks) * 100) : 0;
  const save = async (patch: object, msg: string) => { setBusy(true); try { const r = await api.patch(`/api/projects/${p.id}`, patch); onPatched(r); toast(msg); return true; } catch (e: any) { toast(e.message, { err: true }); return false; } finally { setBusy(false); } };
  const last = p.last_activity; const d = last ? describe(last) : null;
  return (
    <article className="pcard2" style={accentVars(color)} aria-labelledby={`pc-${p.id}`} {...cardOpen(`/projects/${p.id}`, go)}>
      <div className="pc-top">
        <Menu label={`Colour of ${p.name}`} className="pc-mark" kind="dialog" place="left" button={<ProjectMark name={p.name} color={color} size={48} />}>{(close) =>
          <ColorPicker value={p.color} name={p.name} busy={busy} onPreview={setPreview}
            onCancel={() => { setPreview(undefined); close(); }}
            onApply={async (c) => { if (await save({ color: c }, c ? `Colour set to ${c}.` : 'Colour back to the default.')) { setPreview(undefined); close(); } }} />}</Menu>
        <div className="pc-title"><h2 id={`pc-${p.id}`}><Link to={`/projects/${p.id}`}>{p.name}</Link></h2>{p.description && <p>{p.description}</p>}</div>
        <Badge tone={PROJECT_TONE[p.status]}>{PROJECT_STATUS[p.status]}</Badge>
        <Menu label={`Actions for ${p.name}`} className="icon-btn" button={<Dots vertical size={16} />}>{(close) => <>
          <MenuItem onSelect={() => { close(); go(`/projects/${p.id}`); }}><Icon.arrow size={15} />Open project</MenuItem>
          <MenuItem onSelect={() => { close(); go(`/projects/${p.id}/board`); }}><Icon.layers size={15} />Open board</MenuItem>
          <MenuItem onSelect={() => { close(); go(`/projects/${p.id}/settings`); }}><Icon.palette size={15} />Colour and settings</MenuItem>
          <div className="menu-sep" />
          {p.status !== 'ARCHIVED' ? <MenuItem onSelect={() => { close(); save({ status: 'ARCHIVED' }, `${p.name} archived.`); }}><Icon.archive size={15} />Archive</MenuItem>
            : <MenuItem onSelect={() => { close(); save({ status: 'ACTIVE' }, `${p.name} is active again.`); }}><Icon.redo size={15} />Restore</MenuItem>}</>}</Menu>
      </div>
      <div className="pc-progress"><span className="pbar" role="progressbar" aria-label={`${p.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></span>
        <span>{p.tasks ? `${p.done} of ${p.tasks} done` : 'No tasks yet'}</span></div>
      <div className="pc-tiles">
        <div className="pc-tile"><Icon.calendar size={20} /><div><span>Due date</span><b className={isLate(p.due_date) && p.status !== 'DONE' ? 'late' : 'acc'}>{p.due_date ? dayLabel(p.due_date) : 'None'}</b></div></div>
        <div className="pc-tile"><Icon.list size={20} /><div><span>Tasks</span><b>{p.done} / {p.tasks}{p.overdue ? <small className="late"> · {p.overdue} late</small> : null}</b></div></div>
        <div className="pc-tile"><Avatar name={p.owner_name ?? '?'} size="md" /><div><span>Owner</span><b>{p.owner_name ?? 'Nobody'}</b></div></div>
      </div>
      <div className="pc-activity"><h3>Recent activity</h3>
        {last ? <div className="pc-act"><span className="pc-dot" aria-hidden="true" /><div><b>{d!.verb[0]!.toUpperCase() + d!.verb.slice(1)}{d!.what ? ` “${d!.what}”` : ''}</b><span>{last.actor_name ?? 'Someone'} · {ago(last.created_at)}</span></div></div>
          : <p className="faint">Nothing recorded yet. Changes from now on show here.</p>}</div>
      <Link to={`/projects/${p.id}`} className="pc-open">Open project <Icon.arrow size={16} /></Link>
    </article>
  );
}

// A new project: the name, what it is, who owns it, when it is due, and its colour (optional).
function NewProject({ onClose }: { onClose: () => void }) {
  const toast = useToast(); const team = useTeam(); const me = useMe(); const { go } = useRouter();
  const [f, setF] = useState({ name: '', description: '', owner_id: me.id, due_date: '' }); const [color, setColor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [picking, setPicking] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!f.name.trim()) return; setBusy(true);
    try { const p = await api.post('/api/projects', { ...f, color }); toast('Project created.'); onClose(); go(`/projects/${p.id}`); } catch (e: any) { toast(e.message, { err: true }); setBusy(false); }
  };
  return (
    <Modal title="New project" onClose={onClose} wide>
      <form className="col" onSubmit={submit} style={accentVars(color)}>
        <div className="np-head"><ProjectMark name={f.name || 'New project'} color={color} size={48} />
          <label className="field grow"><span>Name</span><input autoFocus required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="QC Lobby" /></label></div>
        <label className="field"><span>What it is</span><textarea rows={3} maxLength={5000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Changes to the existing site" /></label>
        <div className="grid2">
          <label className="field"><span>Owner</span><select value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })}>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="field"><span>Due (optional)</span><input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></label>
        </div>
        <div className="field"><span>Colour (optional)</span>
          {picking ? <ColorPicker value={color} name={f.name} onPreview={setColor} onApply={(c) => { setColor(c); setPicking(false); }} onCancel={() => setPicking(false)} applyLabel="Use this colour" />
            : <button type="button" className="np-color" onClick={() => setPicking(true)}><span style={{ background: color ?? 'var(--accent)' }} />{color ?? 'Theme orange'}<span className="faint">Change</span></button>}</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !f.name.trim()}>{busy && <Spinner />}Create project</button></div>
      </form>
    </Modal>
  );
}

function MyTasks() {
  const { go } = useRouter(); const me = useMe(); const team = useTeam(); const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api.get<any[]>('/api/tasks?mine=1'));
  const projects = useLoad(() => api.get<any[]>('/api/projects'));
  const [f, setF] = useState({ title: '', project_id: '', assignee_id: me.id, due_date: '' }); const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const changed = () => { reload(true); countsBus.dispatchEvent(new Event('changed')); };
  // with a project it goes on that board; without one it is a plain to-do
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); if (!f.title.trim()) { (e.currentTarget as HTMLFormElement).querySelector('input')?.focus(); return; } setBusy(true);
    const body = { title: f.title, assignee_id: f.assignee_id || null, due_date: f.due_date };
    try {
      if (f.project_id) await api.post(`/api/projects/${f.project_id}/tasks`, body); else await api.post('/api/todos', body);
      if (f.assignee_id !== me.id) toast(`Added for ${team.find((u) => u.id === f.assignee_id)?.name ?? 'them'}. It is on their list.`);
      setF({ ...f, title: '', due_date: '', assignee_id: me.id }); changed();
    } catch (x: any) { toast(x.message, { err: true }); } finally { setBusy(false); }
  };
  const list = data ?? [];
  return (
    <>
      <form className="panel todo-add task-add" onSubmit={add} aria-label="Add a task" style={{ padding: 14 }}>
        <label className="field"><span>Task</span><input className="input" autoFocus placeholder="What needs doing? Then Enter" required value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="field"><span>Project</span><select className="input" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}>
          <option value="">No project (a to-do)</option>{(projects.data ?? []).filter((p) => p.status === 'ACTIVE' || p.status === 'ON_HOLD').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="field"><span>For</span><select className="input" value={f.assignee_id} onChange={(e) => setF({ ...f, assignee_id: e.target.value })}>{team.map((u) => <option key={u.id} value={u.id}>{u.id === me.id ? 'Me' : u.name}</option>)}</select></label>
        <label className="field"><span>Due date (optional)</span><input className="input" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></label>
        <button className="btn primary" disabled={busy}>{busy ? <Spinner /> : <Icon.plus size={16} />}Add</button>
      </form>
      {loading && !data ? <Skeleton h={200} /> : error ? <Failure error={error} retry={reload} /> : !list.length
        ? <div className="panel" style={{ padding: 8 }}><Empty title="Nothing on your plate">Add a task above. Tasks assigned to you, in any project or none, show up here.</Empty></div>
        : <div className="panel scrollx"><table className="ctable">
          <thead><tr><th>Task</th><th>Project</th><th>Status</th><th>Priority</th><th>Due</th></tr></thead>
          <tbody>{list.map((t) => <tr key={t.id} className="click" {...rowOpen(() => (t.project_id ? go(`/projects/${t.project_id}/board?task=${t.id}`) : setOpen(t.id)))}>
            <td style={{ fontWeight: 600, color: 'var(--ink)' }}>{t.title}</td>
            <td>{t.project_name ? <span className="proj-chip" style={accentVars(t.project_color)}><i />{t.project_name}</span> : <span className="faint">To-do</span>}</td><td><Badge tone={TASK_TONE[t.status]}>{TASK_STATUS[t.status]}</Badge></td>
            <td>{t.priority === 'HIGH' ? <Badge tone="warning">High</Badge> : <span className="muted">{PRIORITY[t.priority]}</span>}</td>
            <td className={isLate(t.due_date) && t.status !== 'DONE' ? 'late' : 'sub'}>{t.due_date ? (isLate(t.due_date) && t.status !== 'DONE' ? `Late, ${dayLabel(t.due_date)}` : dayLabel(t.due_date)) : 'No date'}</td></tr>)}</tbody></table></div>}
      {open && <TaskDrawer key={open} taskId={open} onClose={() => setOpen(null)} onChanged={changed} />}
    </>
  );
}
