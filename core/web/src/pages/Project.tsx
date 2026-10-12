import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useLoad } from '../ui/hooks.ts';
import { Icon } from '../ui/icons.tsx';
import { useToast } from '../ui/toast.tsx';
import { Failure, Loading, Spinner, ago, dayLabel, initials, isLate } from '../ui/kit.tsx';
import { useTeam } from '../session.tsx';
import { PRIORITY, PROJECT_STATUS, TASK_STATUS } from './Projects.tsx';

const COLUMNS = ['TODO', 'DOING', 'REVIEW', 'DONE'] as const;

export function Project({ id }: { id: string }) {
  const toast = useToast(); const team = useTeam(); const { search, go } = useRouter();
  const { data, error, loading, reload, setData } = useLoad(() => api.get(`/api/projects/${id}`), [id]);
  const [drag, setDrag] = useState<string | null>(null); const [over, setOver] = useState<string | null>(null);
  const open = search.get('task');
  const setOpen = (taskId: string | null) => go(`/projects/${id}${taskId ? `?task=${taskId}` : ''}`, true);
  if (loading && !data) return <div className="page"><Loading rows={5} /></div>;
  if (error) return <div className="page"><Failure error={error} retry={reload} /></div>;
  const tasks: any[] = data.task_list;
  // optimistic: the card moves at once and snaps back if the server says no
  const move = async (taskId: string, status: string) => {
    const before = data; const t = tasks.find((x) => x.id === taskId); if (!t || t.status === status) return;
    setData({ ...data, task_list: tasks.map((x) => (x.id === taskId ? { ...x, status } : x)) });
    try { await api.patch(`/api/tasks/${taskId}`, { status }); reload(true); } catch (e: any) { setData(before); toast(e.message, { err: true }); }
  };
  const saveProject = async (patch: object) => { try { await api.patch(`/api/projects/${id}`, patch); reload(true); } catch (e: any) { toast(e.message, { err: true }); } };
  return (
    <div className="page" style={{ maxWidth: 1500 }}>
      <div className="head">
        <div className="grow"><Link to="/projects" className="kick" style={{ textDecoration: 'none' }}>← Projects</Link>
          <h1 style={{ marginTop: 6 }}>{data.name}</h1>{data.description && <p className="prose">{data.description}</p>}</div>
        <div className="row wrap">
          <label className="field"><span>Status</span><select value={data.status} onChange={(e) => saveProject({ status: e.target.value })}>{Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Owner</span><select value={data.owner_id ?? ''} onChange={(e) => saveProject({ owner_id: e.target.value || null })}><option value="">Nobody</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="field"><span>Due</span><input type="date" value={data.due_date ?? ''} onChange={(e) => saveProject({ due_date: e.target.value })} /></label>
        </div>
      </div>
      <div className="board">{COLUMNS.map((col) => {
        const list = tasks.filter((t) => t.status === col);
        return (
          <section key={col} className={`column${over === col ? ' over' : ''}`} aria-label={TASK_STATUS[col]}
            onDragOver={(e) => { e.preventDefault(); setOver(col); }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); setDrag(null); const tid = e.dataTransfer.getData('text/plain'); if (tid) move(tid, col); }}>
            <div className="row between"><span className="kick">{TASK_STATUS[col]}</span><span className="faint mono" style={{ fontSize: 11 }}>{list.length}</span></div>
            {list.map((t) => <button key={t.id} className={`tcard${drag === t.id ? ' dragging' : ''}${t.status === 'DONE' ? ' done' : ''}`} draggable
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); setDrag(t.id); }} onDragEnd={() => setDrag(null)} onClick={() => setOpen(t.id)}>
              <span className="ttl" style={{ fontWeight: 600 }}>{t.title}</span>
              <span className="meta">
                {t.priority === 'HIGH' && <span className="tag ember">High</span>}
                {t.due_date && <span className={isLate(t.due_date) && t.status !== 'DONE' ? 'late' : ''}>{dayLabel(t.due_date)}</span>}
                {t.comments > 0 && <span>{t.comments} {t.comments === 1 ? 'comment' : 'comments'}</span>}
                {t.assignee_name && <span className="avatar right" style={{ width: 22, height: 22, fontSize: 10 }} title={t.assignee_name}>{initials(t.assignee_name)}</span>}
              </span>
            </button>)}
            <QuickAdd projectId={id} status={col} onAdded={() => reload(true)} />
          </section>);
      })}</div>
      {open && <TaskDrawer key={open} taskId={open} task={tasks.find((t) => t.id === open)} onClose={() => setOpen(null)} onChanged={() => reload(true)} />}
    </div>
  );
}

function QuickAdd({ projectId, status, onAdded }: { projectId: string; status: string; onAdded: () => void }) {
  const [title, setTitle] = useState(''); const [busy, setBusy] = useState(false); const toast = useToast();
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); if (!title.trim()) return; setBusy(true);
    try { await api.post(`/api/projects/${projectId}/tasks`, { title, status }); setTitle(''); onAdded(); } catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(false); }
  };
  return <form className="quickadd" onSubmit={add}><input className="input" placeholder="Add a task" aria-label={`Add a task to ${TASK_STATUS[status]}`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />{title && <button className="btn sm" disabled={busy}><Icon.plus size={14} /></button>}</form>;
}

export function TaskDrawer({ taskId, task, onClose, onChanged }: { taskId: string; task: any; onClose: () => void; onChanged: () => void }) {
  const toast = useToast(); const team = useTeam();
  const [f, setF] = useState(() => ({ title: task?.title ?? '', description: task?.description ?? '' }));
  const comments = useLoad(() => api.get<any[]>(`/api/tasks/${taskId}/comments`), [taskId]);
  const [reply, setReply] = useState(''); const [busy, setBusy] = useState(false);
  // Escape in a field leaves the field first (which saves it); a second Escape closes the drawer
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key !== 'Escape') return; const a = document.activeElement as HTMLElement | null; if (a?.matches('input, textarea, select')) a.blur(); else onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  if (!task) return null;
  const save = async (patch: object) => { try { await api.patch(`/api/tasks/${taskId}`, patch); onChanged(); } catch (e: any) { toast(e.message, { err: true }); } };
  const remove = async () => { if (!confirm('Delete this task and its comments?')) return; try { await api.del(`/api/tasks/${taskId}`); onChanged(); onClose(); toast('Task deleted.'); } catch (e: any) { toast(e.message, { err: true }); } };
  const comment = async (e: React.FormEvent) => {
    e.preventDefault(); if (!reply.trim()) return; setBusy(true);
    try { await api.post(`/api/tasks/${taskId}/comments`, { body: reply }); setReply(''); comments.reload(true); onChanged(); } catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="drawer-back" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Task">
        <header><span className="kick">Task</span><button className="btn sm ghost right danger" onClick={remove}><Icon.trash size={14} />Delete</button><button className="btn sm ghost" onClick={onClose} aria-label="Close"><Icon.x size={16} /></button></header>
        <div className="body">
          <input className="input" style={{ fontSize: 'var(--fs-3)', fontWeight: 650 }} aria-label="Title" value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} onBlur={() => f.title.trim() && f.title !== task.title && save({ title: f.title })} />
          <div className="grid-form">
            <label className="field"><span>Status</span><select value={task.status} onChange={(e) => save({ status: e.target.value })}>{COLUMNS.map((c) => <option key={c} value={c}>{TASK_STATUS[c]}</option>)}</select></label>
            <label className="field"><span>Priority</span><select value={task.priority} onChange={(e) => save({ priority: e.target.value })}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field"><span>Assignee</span><select value={task.assignee_id ?? ''} onChange={(e) => save({ assignee_id: e.target.value || null })}><option value="">Nobody</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
            <label className="field"><span>Due</span><input type="date" value={task.due_date ?? ''} onChange={(e) => save({ due_date: e.target.value })} /></label>
          </div>
          <label className="field"><span>Details</span><textarea rows={6} maxLength={10000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} onBlur={() => f.description !== task.description && save({ description: f.description })} placeholder="What done looks like, links, notes" /></label>
          <hr className="divider" />
          <div className="col">
            <span className="kick">Comments</span>
            {(comments.data ?? []).map((k) => <div key={k.id} className="comment"><div className="avatar">{initials(k.author_name)}</div><div><div className="who-line"><b style={{ fontWeight: 600 }}>{k.author_name ?? 'Former teammate'}</b><span className="faint">{ago(k.created_at)}</span></div><p className="prose">{k.body}</p></div></div>)}
            <form className="col" onSubmit={comment}><textarea className="textarea" rows={3} placeholder="Write a comment" value={reply} onChange={(e) => setReply(e.target.value)} maxLength={5000} />
              <div><button className="btn sm primary" disabled={busy || !reply.trim()}>{busy && <Spinner />}Comment</button></div></form>
          </div>
          <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>Added {ago(task.created_at)}{task.completed_at ? ` · done ${ago(task.completed_at)}` : ''}</p>
        </div>
      </aside>
    </>
  );
}
