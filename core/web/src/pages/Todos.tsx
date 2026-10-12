import { useState } from 'react';
import { api } from '../api.ts';
import { Link } from '../router.tsx';
import { useLoad } from '../ui/hooks.ts';
import { Icon } from '../ui/icons.tsx';
import { useToast } from '../ui/toast.tsx';
import { Failure, Spinner, dayLabel, initials, isLate, todayIST } from '../ui/kit.tsx';
import { useMe, useTeam } from '../session.tsx';
import { countsBus } from '../App.tsx';
import { TaskDrawer } from './Project.tsx';

// What the two of you have to do: quick to-dos that need no project, and your project tasks, in one list on Today.
export function Todos() {
  const me = useMe(); const team = useTeam(); const toast = useToast();
  const [who, setWho] = useState<'me' | 'all'>('me');
  const { data, error, loading, reload, setData } = useLoad(() => api.get<any[]>(`/api/todos${who === 'all' ? '?who=all' : ''}`), [who]);
  const [f, setF] = useState({ title: '', assignee_id: me.id, due_date: '' }); const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const changed = () => { reload(true); countsBus.dispatchEvent(new Event('changed')); };
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); if (!f.title.trim()) return; setBusy(true);
    try { await api.post('/api/todos', f); setF({ ...f, title: '', due_date: '', assignee_id: me.id }); changed(); } catch (x: any) { toast(x.message, { err: true }); } finally { setBusy(false); }
  };
  // ticks at once; snaps back if the server says no
  const toggle = async (t: any) => {
    const status = t.status === 'DONE' ? 'TODO' : 'DONE'; const before = data;
    setData((data ?? []).map((x) => (x.id === t.id ? { ...x, status } : x)));
    try { await api.patch(`/api/tasks/${t.id}`, { status }); changed(); } catch (x: any) { setData(before); toast(x.message, { err: true }); }
  };
  const list = data ?? []; const openCount = list.filter((t) => t.status !== 'DONE').length;
  const today = todayIST();
  return (
    <section className="section" aria-label="To-dos">
      <div className="row between wrap"><h2 className="section-title" style={{ fontSize: 'var(--fs-3)' }}>To-dos{openCount ? <span className="faint mono" style={{ fontSize: 13, marginLeft: 10 }}>{openCount} open</span> : null}</h2>
        <div className="tabs" role="tablist">{(['me', 'all'] as const).map((k) => <button key={k} role="tab" aria-selected={who === k} className={who === k ? 'on' : ''} onClick={() => setWho(k)}>{k === 'me' ? 'Mine' : 'Everyone'}</button>)}</div></div>
      <div className="card flush">
        <form className="todo-add" onSubmit={add}>
          <input className="input" placeholder="Add a to-do, then Enter" aria-label="New to-do" value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <select className="input" aria-label="For" value={f.assignee_id} onChange={(e) => setF({ ...f, assignee_id: e.target.value })}>{team.map((u) => <option key={u.id} value={u.id}>{u.id === me.id ? 'Me' : u.name}</option>)}</select>
          <input className="input" type="date" aria-label="Due" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
          <button className="btn primary" disabled={busy || !f.title.trim()}>{busy ? <Spinner /> : <Icon.plus size={16} />}Add</button>
        </form>
        {error ? <div style={{ padding: 'var(--s-4)' }}><Failure error={error} retry={reload} /></div>
          : loading && !data ? null
          : !list.length ? <p className="muted" style={{ padding: 'var(--s-5)' }}>{who === 'me' ? 'Nothing on your list. Add the next thing above.' : 'Nothing on anyone\'s list.'}</p>
          : <ul className="todos">{list.map((t) => {
            const done = t.status === 'DONE'; const late = !done && isLate(t.due_date); const dueToday = !done && t.due_date === today;
            return <li key={t.id} className={done ? 'done' : ''}>
              <input type="checkbox" className="check" checked={done} onChange={() => toggle(t)} aria-label={done ? `Mark ${t.title} not done` : `Mark ${t.title} done`} />
              <button className="todo-title" onClick={() => setOpen(t.id)}>{t.title}</button>
              <span className="todo-meta">
                {t.priority === 'HIGH' && !done && <span className="tag ember">High</span>}
                {t.project_id && <Link className="tag" to={`/projects/${t.project_id}?task=${t.id}`}>{t.project_name}</Link>}
                {t.comments > 0 && <span className="faint">{t.comments} {t.comments === 1 ? 'comment' : 'comments'}</span>}
                {t.due_date && !done && <span className={late ? 'late' : dueToday ? 'kick ember' : 'faint'}>{late ? `Late, ${dayLabel(t.due_date)}` : dueToday ? 'Today' : dayLabel(t.due_date)}</span>}
                {(who === 'all' || t.assignee_id !== me.id) && <span className="avatar sm" title={t.assignee_name ?? 'Nobody'}>{initials(t.assignee_name)}</span>}
              </span>
            </li>; })}</ul>}
      </div>
      {open && <TaskDrawer key={open} taskId={open} task={list.find((t) => t.id === open)} onClose={() => setOpen(null)} onChanged={changed} />}
    </section>
  );
}
