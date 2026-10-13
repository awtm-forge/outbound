import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { api } from '../../api.ts';
import { unreadChanged } from '../../unread.tsx';
import { Link, useRouter } from '../../router.tsx';
import { useLoad, useMedia } from '../../ui/hooks.ts';
import { Icon, Dots } from '../../ui/icons.tsx';
import { Menu, MenuItem } from '../../ui/menu.tsx';
import { Modal } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Failure, Skeleton, Spinner, ago, isLate, todayIST } from '../../ui/kit.tsx';
import { Crumbs } from '../../ui/chrome.tsx';
import { useTeam } from '../../session.tsx';
import { ColorPicker, ProjectMark, accentVars } from '../../ui/color.tsx';
import { Avatar, PRIORITY, PROJECT_STATUS, daysFrom, shortDay, type Column, type Task } from './shared.tsx';
import { TaskDrawer } from './TaskDrawer.tsx';
import { TaskPanel } from './TaskPanel.tsx';
import { Overview, Rail } from './Overview.tsx';
import { Board } from './Board.tsx';
import { ListView } from './ListView.tsx';
import { Timeline } from './Timeline.tsx';
import { Files } from './Files.tsx';
import { ActivityView } from './ActivityView.tsx';
import { Settings } from './Settings.tsx';
// the editor is the heaviest part of the app, so it loads when Notes is opened
const Notes = lazy(() => import('./Notes.tsx'));

export type Project = {
  id: string; name: string; description: string; status: string; owner_id: string | null; owner_name: string | null; due_date: string | null; color: string | null; created_at: string;
  tasks: number; done: number; overdue: number; doing: number; task_list: Task[]; columns: Column[]; milestones: any[]; members: any[]; links: any[];
  counts: { review: number; blocked: number; due_today: number }; last_updated: { created_at: string; name: string | null } | null;
};
export type WS = { p: Project; reload: () => void; setP: (p: Project) => void; openTask: (id: string | null, tab?: string) => void; addTask: (preset?: Partial<Task>) => void };
const VIEWS = [['', 'Overview', 'home'], ['board', 'Board', 'projects'], ['list', 'List', 'list'], ['timeline', 'Timeline', 'calendar'], ['notes', 'Notes', 'wiki'], ['files', 'Files', 'file'], ['activity', 'Activity', 'today'], ['settings', 'Settings', 'settings']] as const;

export function Workspace({ id, view = '', sub }: { id: string; view?: string; sub?: string }) {
  const toast = useToast(); const team = useTeam(); const { search, go } = useRouter();
  const { data, error, loading, reload, setData } = useLoad<Project>(() => api.get(`/api/projects/${id}`), [id]);
  const [preview, setPreview] = useState<string | null | undefined>(undefined);
  const [adding, setAdding] = useState<Partial<Task> | null>(null);
  const open = search.get('task');
  const openTask = (tid: string | null, tab?: string) => { const p = new URLSearchParams(search); p.delete('tab'); if (tid) { p.set('task', tid); if (tab) p.set('tab', tab); } else p.delete('task'); go(`${location.pathname}${p.toString() ? '?' + p : ''}`, true); };
  const wide = useMedia('(min-width: 1200px)');
  // opening a task clears the alerts that pointed at it, so the counter only shows what is still new
  useEffect(() => { if (open) api.post('/api/notifications/read', { task_id: open }).then((r: any) => { if (r?.read) unreadChanged(); }).catch(() => {}); }, [open]);
  const ws: WS | null = useMemo(() => data ? { p: data, reload: () => reload(true), setP: setData, openTask, addTask: (preset = {}) => setAdding(preset) } : null, [data, search.toString()]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading && !data) return <div className="pws"><Skeleton h={60} w="50%" /><Skeleton h={90} /><Skeleton h={420} /></div>;
  if (error || !data || !ws) return <div className="pws"><Crumbs items={[{ to: '/projects', label: 'Projects' }, { label: 'Project' }]} /><Failure error={error ?? 'Project not found'} retry={reload} /></div>;
  const p = data; const color = preview === undefined ? p.color : preview;
  const save = async (patch: Partial<Project>, msg?: string) => { const before = p; setData({ ...p, ...patch }); try { await api.patch(`/api/projects/${id}`, patch); reload(true); if (msg) toast(msg); return true; } catch (e: any) { setData(before); toast(e.message, { err: true }); return false; } };
  const pct = p.tasks ? Math.round((p.done / p.tasks) * 100) : 0;
  const dueIn = p.due_date ? daysFrom(todayIST(), p.due_date) : null;
  const base = `/projects/${id}`;
  const withRail = view === '' || view === 'board';
  const tabParam = search.get('tab');
  const docked = !!open && wide && (view === 'list' || view === 'timeline') && tabParam !== 'full';
  return (
    <div className="pws" style={accentVars(color)}>
      <div className="pws-head">
        <div className="pws-id">
          <Crumbs items={[{ to: '/projects', label: 'Projects' }, { label: p.name }]} />
          <div className="pws-title">
            <Menu label={`Colour of ${p.name}`} className="pc-mark big" kind="dialog" place="left" button={<ProjectMark name={p.name} color={color} size={64} />}>{(close) =>
              <ColorPicker value={p.color} name={p.name} onPreview={setPreview} onCancel={() => { setPreview(undefined); close(); }}
                onApply={async (c) => { if (await save({ color: c }, c ? `Colour set to ${c}.` : 'Colour back to the default.')) { setPreview(undefined); close(); } }} />}</Menu>
            <div><h1>{p.name}</h1>{p.description && <p>{p.description}</p>}</div>
          </div>
        </div>
        <div className="pws-ctl">
          <label className="pf"><span>Status</span><span className={`pf-sel st-${p.status}`}><i aria-hidden="true" /><select value={p.status} onChange={(e) => save({ status: e.target.value })}>{Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></span></label>
          <label className="pf"><span>Owner</span><span className="pf-sel"><Avatar name={p.owner_name ?? '?'} size="xs" /><select value={p.owner_id ?? ''} onChange={(e) => save({ owner_id: e.target.value || null, owner_name: team.find((u) => u.id === e.target.value)?.name ?? null })}><option value="">Nobody</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></span></label>
          <label className="pf"><span>Due date</span><span className="pf-sel"><Icon.calendar size={15} /><input type="date" value={p.due_date ?? ''} onChange={(e) => save({ due_date: e.target.value || null })} /></span></label>
          <div className="btn-split">
            <button className="btn primary glow" onClick={() => setAdding({})}><Icon.plus size={16} />Add task</button>
            <Menu label="More to add" className="btn primary split-more" place="left" button={<Icon.down size={14} />}>{(close) => <>
              <MenuItem onSelect={() => { close(); go(`${base}?add=milestone`); }}><Icon.target size={15} />Add milestone</MenuItem>
              <MenuItem onSelect={() => { close(); go(`${base}/notes?new=1`); }}><Icon.wiki size={15} />New page</MenuItem>
              <MenuItem onSelect={() => { close(); go(`${base}/files?upload=1`); }}><Icon.upload size={15} />Upload a file</MenuItem></>}</Menu>
          </div>
          <Menu label="Project actions" className="icon-btn" button={<Dots vertical size={18} />}>{(close) => <>
            <MenuItem onSelect={async () => { close(); try { await navigator.clipboard.writeText(location.origin + base); toast('Link copied. Everyone signed in can open it.'); } catch { toast('Could not copy the link.', { err: true }); } }}><Icon.share size={15} />Copy link</MenuItem>
            <MenuItem onSelect={() => { close(); go(`${base}/settings`); }}><Icon.settings size={15} />Settings and colour</MenuItem>
            <div className="menu-sep" />
            {p.status !== 'ARCHIVED' ? <MenuItem onSelect={() => { close(); save({ status: 'ARCHIVED' }, `${p.name} archived.`); }}><Icon.archive size={15} />Archive project</MenuItem>
              : <MenuItem onSelect={() => { close(); save({ status: 'ACTIVE' }, `${p.name} is active again.`); }}><Icon.redo size={15} />Restore project</MenuItem>}</>}</Menu>
        </div>
      </div>

      <section className="pws-stats" aria-label="Project at a glance">
        <div className="pst"><span className="pst-ic"><Icon.list size={20} /></span><div><span>Tasks</span><b>{p.done} / {p.tasks}</b><small>completed</small></div></div>
        <div className="pst"><span className="pst-ring" aria-hidden="true"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="14" className="rt" /><circle cx="18" cy="18" r="14" className="rv" strokeDasharray={`${(pct / 100) * 88} 88`} transform="rotate(-90 18 18)" /></svg></span>
          <div className="grow"><span>Completion</span><b>{pct}%</b><span className="pbar" role="progressbar" aria-label="Completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></span></div></div>
        <div className="pst"><span className="pst-ic warm"><Icon.calendar size={20} /></span><div><span>{dueIn == null ? 'Due date' : dueIn < 0 ? 'Overdue by' : 'Due in'}</span>
          <b className={dueIn != null && dueIn < 0 && p.status !== 'DONE' ? 'late' : 'acc'}>{dueIn == null ? 'Not set' : `${Math.abs(dueIn)} ${Math.abs(dueIn) === 1 ? 'day' : 'days'}`}</b><small>{dueIn == null ? 'set one above' : dueIn === 0 ? 'due today' : shortDay(p.due_date)}</small></div></div>
        <div className="pst"><span className="pst-ic"><Icon.people size={20} /></span><div><span>Team</span><b>{p.members.length}</b><small>{p.members.length === 1 ? 'member' : 'members'}</small></div>
          {p.members.length > 0 && <span className="pst-avs" aria-label={p.members.map((m: any) => m.name).join(', ')}>{p.members.slice(0, 3).map((m: any) => <Avatar key={m.id} name={m.name} size="sm" title={m.name} />)}{p.members.length > 3 && <span className="pst-more">+{p.members.length - 3}</span>}</span>}</div>
        <div className="pst"><span className="pst-ic"><Icon.clock size={20} /></span><div><span>Last updated</span><b>{p.last_updated ? ago(p.last_updated.created_at) : 'Not yet'}</b><small>{p.last_updated?.name ? `by ${p.last_updated.name}` : 'no changes recorded'}</small></div></div>
      </section>

      <nav className="pws-tabs" aria-label="Project views">{VIEWS.map(([k, l, ic]) => { const I = Icon[ic]; return <Link key={k} to={k ? `${base}/${k}` : base} aria-current={view === k ? 'page' : undefined} className={view === k ? 'on' : ''}><I size={15} />{l}</Link>; })}</nav>

      <div className={withRail ? 'pws-split' : docked ? 'pws-dock' : 'pws-full'}>
        <div className="pws-main">
          {view === '' && <Overview ws={ws} />}
          {view === 'board' && <Board ws={ws} />}
          {view === 'list' && <ListView ws={ws} />}
          {view === 'timeline' && <Timeline ws={ws} />}
          {view === 'notes' && <Suspense fallback={<Skeleton h={480} />}><Notes ws={ws} pageId={sub} /></Suspense>}
          {view === 'files' && <Files ws={ws} />}
          {view === 'activity' && <ActivityView ws={ws} />}
          {view === 'settings' && <Settings ws={ws} onPreview={setPreview} />}
        </div>
        {withRail && <Rail ws={ws} />}
        {docked && <TaskPanel key={open} taskId={open!} tab={tabParam} columns={p.columns} milestones={p.milestones} tasks={p.task_list} onClose={() => openTask(null)} onChanged={() => reload(true)} onOpen={(t) => openTask(t)}
          onFull={() => openTask(open, 'full')} onDuplicate={async (tid) => { try { const d = await api.post(`/api/tasks/${tid}/duplicate`, {}); reload(true); toast('Task duplicated.'); openTask(d.id); } catch (e: any) { toast(e.message, { err: true }); } }} />}
      </div>
      {open && !docked && <TaskDrawer key={open} taskId={open} tab={tabParam} color={color} onClose={() => openTask(null)} onChanged={() => reload(true)} onOpen={(t) => openTask(t)} ctx={{ columns: p.columns, milestones: p.milestones, tasks: p.task_list }} />}
      {adding && <AddTask ws={ws} preset={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

// a task with the details that matter at the start; the drawer has the rest
function AddTask({ ws, preset, onClose }: { ws: WS; preset: Partial<Task>; onClose: () => void }) {
  const toast = useToast(); const team = useTeam(); const { p } = ws;
  const [f, setF] = useState({ title: '', description: '', column_id: preset.column_id ?? p.columns[0]?.id ?? '', priority: preset.priority ?? 'MEDIUM', assignee_id: '', due_date: preset.due_date ?? '', start_date: preset.start_date ?? '', milestone_id: preset.milestone_id ?? '', parent_id: preset.parent_id ?? '', labels: '' });
  const [busy, setBusy] = useState(false); const [more, setMore] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!f.title.trim()) return; setBusy(true);
    try {
      const labels = [...new Set(f.labels.split(',').map((l) => l.trim()).filter(Boolean))].slice(0, 12);
      const t = await api.post(`/api/projects/${p.id}/tasks`, { ...f, labels, assignee_id: f.assignee_id || null, milestone_id: f.milestone_id || null, parent_id: f.parent_id || null, column_id: f.column_id || undefined, due_date: f.due_date || null, start_date: f.start_date || null });
      toast('Task added.'); ws.reload();
      if (more) { setF({ ...f, title: '', description: '' }); setBusy(false); } else { onClose(); ws.openTask(t.id); }
    } catch (x: any) { toast(x.message, { err: true }); setBusy(false); }
  };
  return (
    <Modal title={f.parent_id ? `New subtask of “${p.task_list.find((t) => t.id === f.parent_id)?.title ?? 'a task'}”` : `New task in ${p.name}`} onClose={onClose} wide>
      <form className="col" onSubmit={submit}>
        <label className="field"><span>Title</span><input autoFocus required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="What needs doing" /></label>
        <label className="field"><span>Description (optional)</span><textarea rows={3} maxLength={10000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What done looks like, links, notes" /></label>
        <div className="grid2">
          <label className="field"><span>Column</span><select value={f.column_id} onChange={(e) => setF({ ...f, column_id: e.target.value })}>{p.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="field"><span>Priority</span><select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Assignee</span><select value={f.assignee_id} onChange={(e) => setF({ ...f, assignee_id: e.target.value })}><option value="">Nobody yet</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="field"><span>Due</span><input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></label>
          <label className="field"><span>Start (optional)</span><input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></label>
          <label className="field"><span>Labels (comma separated)</span><input value={f.labels} onChange={(e) => setF({ ...f, labels: e.target.value })} placeholder="Design, Website" list="add-labels" maxLength={300} /><datalist id="add-labels">{[...new Set(p.task_list.flatMap((t) => t.labels))].map((l) => <option key={l} value={l} />)}</datalist></label>
          <label className="field"><span>Parent task</span><select value={f.parent_id} onChange={(e) => setF({ ...f, parent_id: e.target.value })}><option value="">None, a top-level task</option>{p.task_list.filter((t) => !t.archived_at).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
          {p.milestones.length > 0 && <label className="field"><span>Milestone</span><select value={f.milestone_id} onChange={(e) => setF({ ...f, milestone_id: e.target.value })}><option value="">None</option>{p.milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
        </div>
        {f.due_date && isLate(f.due_date) && <p className="faint" role="status">That due date has already passed.</p>}
        <div className="row"><label className="row" style={{ gap: 8, fontSize: 13 }}><input type="checkbox" className="check" checked={more} onChange={(e) => setMore(e.target.checked)} />Add another after this</label>
          <span className="right row"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !f.title.trim()}>{busy && <Spinner />}Add task</button></span></div>
      </form>
    </Modal>
  );
}
