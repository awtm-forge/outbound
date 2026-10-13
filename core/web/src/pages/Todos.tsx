import { useState } from 'react';
import { api, type Me } from '../api.ts';
import { Link } from '../router.tsx';
import { useLoad } from '../ui/hooks.ts';
import { Icon, Dots } from '../ui/icons.tsx';
import { useToast } from '../ui/toast.tsx';
import { Failure, Spinner, Skeleton, dayLabel, initials, isLate, todayIST } from '../ui/kit.tsx';
import { Menu, MenuItem } from '../ui/menu.tsx';
import { Modal, useConfirm } from '../ui/overlay.tsx';
import { useTeam } from '../session.tsx';
import { countsBus } from '../App.tsx';
import { TaskDrawer } from './project/TaskDrawer.tsx';

type Filter = 'all' | 'HIGH' | 'MEDIUM' | 'done';
const PRIO: Record<string, string> = { URGENT: 'Urgent', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low', NONE: 'No priority' };

// Today's tasks: quick to-dos that need no project, and your project tasks, in one list. Filters run in the browser.
export function Todos({ me }: { me: Me }) {
  const team = useTeam(); const toast = useToast(); const ask = useConfirm();
  const [who, setWho] = useState<'me' | 'all'>('me'); const [filter, setFilter] = useState<Filter>('all');
  const { data, error, loading, reload, setData } = useLoad(() => api.get<any[]>(`/api/todos${who === 'all' ? '?who=all' : ''}`), [who]);
  const [open, setOpen] = useState<string | null>(null); const [adding, setAdding] = useState(false);
  const changed = () => { reload(true); countsBus.dispatchEvent(new Event('changed')); };
  // ticks at once; snaps back if the server says no
  const toggle = async (t: any) => {
    const status = t.status === 'DONE' ? 'TODO' : 'DONE'; const before = data;
    setData((data ?? []).map((x) => (x.id === t.id ? { ...x, status } : x)));
    try { await api.patch(`/api/tasks/${t.id}`, { status }); changed(); } catch (x: any) { setData(before); toast(x.message, { err: true }); }
  };
  const remove = async (t: any) => {
    if (!(await ask({ title: `Delete “${t.title}”?`, body: 'Its comments go with it. This cannot be undone.', confirm: 'Delete task', tone: 'danger' }))) return;
    try { await api.del(`/api/tasks/${t.id}`); toast('Task deleted.'); changed(); } catch (x: any) { toast(x.message, { err: true }); }
  };
  const list = data ?? []; const openList = list.filter((t) => t.status !== 'DONE');
  const count = { all: openList.length, HIGH: openList.filter((t) => t.priority === 'HIGH').length, MEDIUM: openList.filter((t) => t.priority === 'MEDIUM').length, done: list.length - openList.length };
  const shown = filter === 'all' ? list : filter === 'done' ? list.filter((t) => t.status === 'DONE') : openList.filter((t) => t.priority === filter);
  const today = todayIST();
  const filters: [Filter, string][] = [['all', `All (${count.all})`], ['HIGH', `High (${count.HIGH})`], ['MEDIUM', `Medium (${count.MEDIUM})`], ['done', count.done ? `Completed (${count.done})` : 'Completed']];
  return (
    <section className="panel" aria-labelledby="tasks-h">
      <div className="panel-head">
        <h2 id="tasks-h"><span className="ic"><Icon.file size={20} /></span>Today’s tasks</h2>
        <span className="meta"><Icon.sparkle size={12} />{count.all} open</span>
        <div className="seg compact" role="radiogroup" aria-label="Whose tasks">{(['me', 'all'] as const).map((k) =>
          <button key={k} type="button" role="radio" aria-checked={who === k} className={who === k ? 'on' : ''} onClick={() => setWho(k)}>{k === 'me' ? 'Mine' : 'Everyone'}</button>)}</div>
        <div className="right">
          <div className="row" role="group" aria-label="Filter tasks" style={{ gap: 6 }}>{filters.map(([k, l]) => <button key={k} type="button" className="filter-chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}</div>
          <button type="button" className="btn primary tiny glow" onClick={() => setAdding(true)}><Icon.plus size={14} />Add task</button>
        </div>
      </div>
      {error ? <div style={{ padding: '0 16px 16px' }}><Failure error={error} retry={reload} /></div>
        : loading && !data ? <div className="col" style={{ padding: '4px 16px 16px', gap: 8 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={34} />)}</div>
        : !shown.length ? <p className="task-empty">{filter === 'done' ? 'Nothing completed today yet.' : filter !== 'all' ? `No ${PRIO[filter]!.toLowerCase()} priority tasks open.` : who === 'me' ? 'Nothing on your list. Add the next thing with Add task.' : 'Nothing on anyone’s list.'}</p>
        : <ul className="task-list">{shown.map((t) => {
          const done = t.status === 'DONE'; const late = !done && isLate(t.due_date); const dueToday = !done && t.due_date === today;
          const mine = t.assignee_id === me.id;
          return <li key={t.id} className={`task-row${done ? ' done' : ''}`}>
            <input type="checkbox" className="check" checked={done} onChange={() => toggle(t)} aria-label={done ? `Mark ${t.title} not done` : `Mark ${t.title} done`} />
            <button type="button" className="t-title" onClick={() => setOpen(t.id)}>{t.title}</button>
            <span className="t-prio">{t.priority && <span className={`prio ${t.priority}`}>{PRIO[t.priority]}</span>}</span>
            <span className="t-proj">{t.project_id ? <Link className="proj-tag" to={`/projects/${t.project_id}?task=${t.id}`} title={t.project_name}>{t.project_name}</Link> : null}</span>
            <span className={`t-due${late ? ' late' : dueToday ? ' today' : ''}`}>{t.due_date ? <><Icon.calendar size={14} />{late ? `Late, ${dayLabel(t.due_date)}` : dueToday ? 'Due today' : `Due ${dayLabel(t.due_date)}`}</> : <span className="faint">No date</span>}</span>
            <span className="t-who"><span className="av xs" aria-hidden="true">{initials(t.assignee_name)}</span>{mine ? 'Me' : t.assignee_name?.split(' ')[0] ?? 'Nobody'}</span>
            <span className="t-menu"><Menu label={`Actions for ${t.title}`} className="icon-btn" button={<Dots vertical size={16} />}>{(close) => <>
              <MenuItem onSelect={() => { close(); setOpen(t.id); }}><Icon.edit size={15} />Open</MenuItem>
              <MenuItem onSelect={() => { close(); toggle(t); }}><Icon.check size={15} />{done ? 'Mark not done' : 'Mark done'}</MenuItem>
              <div className="menu-sep" />
              <MenuItem onSelect={() => { close(); remove(t); }}><Icon.trash size={15} />Delete</MenuItem></>}</Menu></span>
          </li>; })}</ul>}
      {adding && <AddTask me={me} team={team} onClose={() => setAdding(false)} onAdded={changed} />}
      {open && <TaskDrawer key={open} taskId={open} onClose={() => setOpen(null)} onChanged={changed} />}
    </section>
  );
}

function AddTask({ me, team, onClose, onAdded }: { me: Me; team: { id: string; name: string }[]; onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ title: '', priority: 'MEDIUM', assignee_id: me.id, due_date: '' }); const [busy, setBusy] = useState(false); const [touched, setTouched] = useState(false);
  const bad = !f.title.trim();
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setTouched(true); if (bad) return; setBusy(true);
    try {
      await api.post('/api/todos', f);
      toast(f.assignee_id === me.id ? 'Task added.' : `Task added for ${team.find((u) => u.id === f.assignee_id)?.name ?? 'them'}. It is on their list.`);
      onAdded(); onClose();
    } catch (x: any) { toast(x.message, { err: true }); setBusy(false); }
  };
  return (
    <Modal title="Add a task" onClose={onClose} wide>
      <form onSubmit={add} noValidate>
        <label className="field"><span>Task</span><input data-autofocus value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} onBlur={() => setTouched(true)}
          aria-invalid={touched && bad} aria-describedby={touched && bad ? 'task-err' : undefined} placeholder="What needs doing?" />
          {touched && bad && <span id="task-err" className="field-err">Write what needs doing.</span>}</label>
        <div className="grid2">
          <label className="field"><span>Priority</span><select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{Object.entries(PRIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>For</span><select value={f.assignee_id} onChange={(e) => setF({ ...f, assignee_id: e.target.value })}>{team.map((u) => <option key={u.id} value={u.id}>{u.id === me.id ? 'Me' : u.name}</option>)}</select></label>
        </div>
        <label className="field" style={{ marginTop: 12 }}><span>Due date (optional)</span><input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></label>
        <p className="faint" style={{ fontSize: 12, margin: '10px 0 0' }}>A quick to-do with no project. Tasks for a project are added on its board.</p>
        <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? <Spinner /> : <Icon.plus size={16} />}Add task</button></div>
      </form>
    </Modal>
  );
}
