import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api.ts';
import { useLoad } from '../../ui/hooks.ts';
import { Icon } from '../../ui/icons.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Failure, Skeleton, Spinner, ago } from '../../ui/kit.tsx';
import { useConfirm, useFocusTrap } from '../../ui/overlay.tsx';
import { useMe, useTeam } from '../../session.tsx';
import { accentVars } from '../../ui/color.tsx';
import { Avatar, PRIORITY, STATUS_ORDER, StatusDot, TASK_STATUS, describe, fileSize, shortDay, type Column, type Task } from './shared.tsx';

type Ctx = { columns?: Column[]; milestones?: any[]; tasks?: Task[] };
const TABS = ['Details', 'Subtasks', 'Comments', 'Files', 'Activity'] as const;

// The whole of one task, beside the board or list it was opened from. Every change saves on its own.
export function TaskDrawer({ taskId, onClose, onChanged, onOpen, ctx = {}, color }: { taskId: string; onClose: () => void; onChanged: () => void; onOpen?: (id: string) => void; ctx?: Ctx; color?: string | null }) {
  const toast = useToast(); const ask = useConfirm(); const team = useTeam();
  const { data: t, error, loading, reload, setData } = useLoad(() => api.get(`/api/tasks/${taskId}`), [taskId]);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Details');
  const ref = useRef<HTMLElement>(null);
  // Escape in a field leaves the field first (fields save on blur), a second Escape closes; Tab stays inside
  useFocusTrap(ref, () => { const a = document.activeElement as HTMLElement | null; if (a?.matches('input, textarea, select') && ref.current?.contains(a)) ref.current!.focus(); else onClose(); }, ref);
  const save = async (patch: object) => {
    const before = t; setData({ ...t, ...patch });
    try { await api.patch(`/api/tasks/${taskId}`, patch); onChanged(); reload(true); } catch (e: any) { setData(before); toast(e.message, { err: true }); }
  };
  const remove = async () => {
    if (!(await ask({ title: `Delete “${t.title}”?`, body: `Its comments${t.subtasks ? ', its subtasks' : ''} and file links go with it. This cannot be undone. Archive it instead to keep it.`, confirm: 'Delete task', tone: 'danger' }))) return;
    try { await api.del(`/api/tasks/${taskId}`); onChanged(); onClose(); toast('Task deleted.'); } catch (e: any) { toast(e.message, { err: true }); }
  };
  return createPortal(
    <>
      <div className="drawer-back" onClick={onClose} />
      <section ref={ref} className="drawer wide tdrawer" role="dialog" aria-modal="true" aria-labelledby="td-title" tabIndex={-1} style={accentVars(color ?? t?.project_color)}>
        {loading && !t ? <div className="td-body"><Skeleton h={28} w="70%" /><Skeleton h={200} /></div> : error ? <div className="td-body"><Failure error={error} retry={reload} /><button className="btn" onClick={onClose}>Close</button></div> : <>
          <header className="td-head">
            <button type="button" className={`td-check${t.status === 'DONE' ? ' on' : ''}`} onClick={() => save({ status: t.status === 'DONE' ? 'TODO' : 'DONE' })} aria-pressed={t.status === 'DONE'} aria-label={t.status === 'DONE' ? 'Mark not done' : 'Mark done'}><Icon.check size={14} /></button>
            <h2 id="td-title" className="sr">{t.title}</h2>
            <TitleInput value={t.title} onSave={(title) => save({ title })} />
            <button className="btn sm ghost" onClick={() => save({ archived: !t.archived_at })} title={t.archived_at ? 'Put it back on the board' : 'Hide it from the board, keep its history'}><Icon.archive size={14} />{t.archived_at ? 'Restore' : 'Archive'}</button>
            <button className="btn sm ghost danger" onClick={remove}><Icon.trash size={14} />Delete</button>
            <button className="btn sm ghost icon-only" onClick={onClose} aria-label="Close"><Icon.x size={16} /></button>
          </header>
          {t.parent_title && <button type="button" className="td-parent" onClick={() => onOpen?.(t.parent_id)}><Icon.back size={13} />Subtask of {t.parent_title}</button>}
          <div className="td-tabs" role="tablist" aria-label="Task">{TABS.map((x) => {
            const n = x === 'Subtasks' ? t.subtasks.length : x === 'Comments' ? t.comments : x === 'Files' ? t.file_list.length : null;
            return <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{x}{n ? <span className="n">{n}</span> : null}</button>; })}</div>
          <div className="td-body" role="tabpanel" aria-label={tab}>
            {tab === 'Details' && <Details t={t} ctx={ctx} team={team} save={save} reload={() => { reload(true); onChanged(); }} onOpen={onOpen} />}
            {tab === 'Subtasks' && <Subtasks t={t} reload={() => { reload(true); onChanged(); }} onOpen={onOpen} />}
            {tab === 'Comments' && <Comments taskId={taskId} onChanged={() => { reload(true); onChanged(); }} />}
            {tab === 'Files' && <TaskFiles t={t} reload={() => { reload(true); onChanged(); }} />}
            {tab === 'Activity' && <ul className="act-list">{t.activity.length ? t.activity.map((a: any, i: number) => { const d = describe(a); const I = Icon[d.icon]; return (
              <li key={i}><span className={`f-ic tone-${d.tone}`}><I size={13} /></span><div><b>{a.actor_name ?? 'Someone'}</b> {d.verb}{d.note ? ` ${d.note}` : ''}<span className="when">{ago(a.created_at)}</span></div></li>); })
              : <li className="faint">Nothing recorded yet. Changes from now on show here.</li>}</ul>}
          </div>
        </>}
      </section>
    </>, document.body,
  );
}

function TitleInput({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value); useEffect(() => setV(value), [value]);
  return <input className="td-title" aria-label="Title" value={v} maxLength={200} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} onBlur={() => { if (v.trim() && v !== value) onSave(v.trim()); else setV(value); }} />;
}

function Details({ t, ctx, team, save, reload, onOpen }: { t: any; ctx: Ctx; team: any[]; save: (p: object) => void; reload: () => void; onOpen?: (id: string) => void }) {
  const toast = useToast();
  const [desc, setDesc] = useState(t.description ?? ''); useEffect(() => setDesc(t.description ?? ''), [t.description]);
  const [label, setLabel] = useState(''); const [dep, setDep] = useState(''); const [depKind, setDepKind] = useState<'BLOCKS' | 'RELATES'>('BLOCKS');
  const inProject = !!t.project_id;
  const others = (ctx.tasks ?? []).filter((x) => x.id !== t.id);
  const addDep = async () => { if (!dep) return; try { await api.post(`/api/tasks/${t.id}/dependencies`, { depends_on_id: dep, kind: depKind }); setDep(''); reload(); } catch (e: any) { toast(e.message, { err: true }); } };
  const delDep = async (other: string, fromOther = false) => { try { await api.del(fromOther ? `/api/tasks/${other}/dependencies/${t.id}` : `/api/tasks/${t.id}/dependencies/${other}`); reload(); } catch (e: any) { toast(e.message, { err: true }); } };
  const addLabel = () => { const l = label.trim(); if (!l) return; if (!t.labels.includes(l)) save({ labels: [...t.labels, l] }); setLabel(''); };
  const blockedBy = t.blocked_by.filter((d: any) => d.kind === 'BLOCKS'); const related = [...t.blocked_by.filter((d: any) => d.kind === 'RELATES'), ...t.blocks.filter((d: any) => d.kind === 'RELATES')];
  const blocks = t.blocks.filter((d: any) => d.kind === 'BLOCKS');
  return (
    <div className="td-grid">
      <div className="td-main">
        <div className="td-fields">
          <label className="field"><span>Status</span>{inProject && ctx.columns?.length
            ? <select value={t.column_id ?? ''} onChange={(e) => save({ column_id: e.target.value })}>{ctx.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            : <select value={t.status} onChange={(e) => save({ status: e.target.value })}>{STATUS_ORDER.map((c) => <option key={c} value={c}>{TASK_STATUS[c]}</option>)}</select>}</label>
          <label className="field"><span>Priority</span><select value={t.priority} onChange={(e) => save({ priority: e.target.value })}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Assignee</span><select value={t.assignee_id ?? ''} onChange={(e) => save({ assignee_id: e.target.value || null })}><option value="">Nobody</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        </div>
        <label className="field"><span>Description</span><textarea rows={6} maxLength={10000} value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== (t.description ?? '') && save({ description: desc })} placeholder="What done looks like, links, notes" /></label>
        {t.blocked && <p className="td-blocked" role="status"><Icon.lock size={14} />Waiting on {blockedBy.filter((d: any) => d.status !== 'DONE').map((d: any) => `“${d.title}”`).join(', ')}.</p>}
        {inProject && <div className="td-sec"><h3>Dependencies</h3>
          {[['Waiting on', blockedBy, false], ['Holding up', blocks, true], ['Related', related, false]].map(([l, list, rev]: any) => list.length > 0 && <div key={l} className="dep-group"><span className="faint">{l}</span>
            {list.map((d: any) => <span key={d.id} className="dep"><StatusDot s={d.status} /><button type="button" className="link-btn" onClick={() => onOpen?.(d.id)}>{d.title}</button>
              <button type="button" className="x" onClick={() => delDep(d.id, rev || (l === 'Related' && t.blocks.some((b: any) => b.id === d.id)))} aria-label={`Remove the link to ${d.title}`}><Icon.x size={12} /></button></span>)}</div>)}
          {others.length > 0 && <div className="dep-add"><select value={depKind} onChange={(e) => setDepKind(e.target.value as any)} aria-label="Kind of link"><option value="BLOCKS">Waits on</option><option value="RELATES">Related to</option></select>
            <select value={dep} onChange={(e) => setDep(e.target.value)} aria-label="Task"><option value="">Choose a task</option>{others.filter((x) => !x.archived_at).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
            <button type="button" className="btn tiny" onClick={addDep} disabled={!dep}>Add</button></div>}</div>}
      </div>
      <aside className="td-side" aria-label="Properties">
        <label className="field"><span>Start</span><input type="date" value={t.start_date ?? ''} onChange={(e) => save({ start_date: e.target.value })} disabled={!inProject} /></label>
        <label className="field"><span>Due</span><input type="date" value={t.due_date ?? ''} onChange={(e) => save({ due_date: e.target.value })} /></label>
        {inProject && <>
          <div className="field"><span>Labels</span><div className="labels">{t.labels.map((l: string) => <span key={l} className="lbl">{l}<button type="button" onClick={() => save({ labels: t.labels.filter((x: string) => x !== l) })} aria-label={`Remove label ${l}`}><Icon.x size={11} /></button></span>)}
            <input value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLabel(); } }} onBlur={addLabel} placeholder="Add label" maxLength={30} aria-label="Add a label" /></div></div>
          <label className="field"><span>Parent task</span><select value={t.parent_id ?? ''} onChange={(e) => save({ parent_id: e.target.value || null })}><option value="">None</option>{others.filter((x) => !x.archived_at).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label>
          {(ctx.milestones?.length ?? 0) > 0 && <label className="field"><span>Milestone</span><select value={t.milestone_id ?? ''} onChange={(e) => save({ milestone_id: e.target.value || null })}><option value="">None</option>{ctx.milestones!.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
          <div className="field"><span>Collaborators</span><div className="collab">{team.filter((u) => u.id !== t.assignee_id).map((u) => { const on = t.collaborator_ids.includes(u.id); return (
            <button key={u.id} type="button" className={`collab-p${on ? ' on' : ''}`} aria-pressed={on} onClick={() => save({ collaborator_ids: on ? t.collaborator_ids.filter((x: string) => x !== u.id) : [...t.collaborator_ids, u.id] })}><Avatar name={u.name} size="xs" />{u.name.split(' ')[0]}</button>); })}</div></div>
          <div className="grid2"><label className="field"><span>Estimate (h)</span><NumberInput value={t.estimate_hours} onSave={(v) => save({ estimate_hours: v })} label="Estimated hours" /></label>
            <label className="field"><span>Actual (h)</span><NumberInput value={t.actual_hours} onSave={(v) => save({ actual_hours: v })} label="Actual hours" /></label></div>
        </>}
        <p className="faint td-meta">Added {ago(t.created_at)}{t.completed_at ? ` · done ${ago(t.completed_at)}` : ''}{t.due_date ? ` · due ${shortDay(t.due_date)}` : ''}</p>
      </aside>
    </div>
  );
}
function NumberInput({ value, onSave, label }: { value: string | null; onSave: (v: number | null) => void; label: string }) {
  const [v, setV] = useState(value ?? ''); useEffect(() => setV(value ?? ''), [value]);
  return <input type="number" min={0} step={0.5} inputMode="decimal" aria-label={label} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { const n = v === '' ? null : Number(v); if (n !== (value == null ? null : Number(value)) && (n === null || n >= 0)) onSave(n); }} />;
}

function Subtasks({ t, reload, onOpen }: { t: any; reload: () => void; onOpen?: (id: string) => void }) {
  const toast = useToast(); const [title, setTitle] = useState(''); const [busy, setBusy] = useState(false);
  const done = t.subtasks.filter((s: any) => s.status === 'DONE').length;
  const add = async (e: React.FormEvent) => { e.preventDefault(); if (!title.trim() || !t.project_id) return; setBusy(true);
    try { await api.post(`/api/projects/${t.project_id}/tasks`, { title, parent_id: t.id }); setTitle(''); reload(); } catch (x: any) { toast(x.message, { err: true }); } finally { setBusy(false); } };
  const toggle = async (s: any) => { try { await api.patch(`/api/tasks/${s.id}`, { status: s.status === 'DONE' ? 'TODO' : 'DONE' }); reload(); } catch (x: any) { toast(x.message, { err: true }); } };
  if (!t.project_id) return <p className="faint">A to-do has no subtasks. Put it on a project to break it down.</p>;
  return (
    <div className="col">
      {t.subtasks.length > 0 && <div className="sub-prog"><span className="pbar"><i style={{ width: `${(done / t.subtasks.length) * 100}%` }} /></span><span>{done} of {t.subtasks.length} done</span></div>}
      <ul className="sub-list">{t.subtasks.map((s: any) => <li key={s.id}>
        <input type="checkbox" className="check" checked={s.status === 'DONE'} onChange={() => toggle(s)} aria-label={`${s.title} done`} />
        <button type="button" className={`link-btn${s.status === 'DONE' ? ' done' : ''}`} onClick={() => onOpen?.(s.id)}>{s.title}</button>
        {s.assignee_name && <Avatar name={s.assignee_name} size="xs" />}{s.due_date && <span className="faint">{shortDay(s.due_date)}</span>}</li>)}</ul>
      <form className="row" onSubmit={add}><input className="input grow" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a subtask" maxLength={200} aria-label="Add a subtask" />
        <button className="btn sm" disabled={busy || !title.trim()}>{busy ? <Spinner /> : <Icon.plus size={14} />}Add</button></form>
    </div>
  );
}

function Comments({ taskId, onChanged }: { taskId: string; onChanged: () => void }) {
  const toast = useToast(); const me = useMe(); const ask = useConfirm();
  const { data, reload } = useLoad(() => api.get<any[]>(`/api/tasks/${taskId}/comments`), [taskId]);
  const [reply, setReply] = useState(''); const [busy, setBusy] = useState(false); const [edit, setEdit] = useState<{ id: string; body: string } | null>(null);
  const post = async (e: React.FormEvent) => { e.preventDefault(); if (!reply.trim()) return; setBusy(true);
    try { await api.post(`/api/tasks/${taskId}/comments`, { body: reply }); setReply(''); reload(true); onChanged(); } catch (x: any) { toast(x.message, { err: true }); } finally { setBusy(false); } };
  const saveEdit = async () => { if (!edit?.body.trim()) return; try { await api.patch(`/api/comments/${edit.id}`, { body: edit.body }); setEdit(null); reload(true); } catch (x: any) { toast(x.message, { err: true }); } };
  const del = async (id: string) => { if (!(await ask({ title: 'Delete this comment?', confirm: 'Delete', tone: 'danger' }))) return; try { await api.del(`/api/comments/${id}`); reload(true); onChanged(); } catch (x: any) { toast(x.message, { err: true }); } };
  return (
    <div className="col">
      {(data ?? []).map((k) => <div key={k.id} className="comment"><Avatar name={k.author_name} /><div className="grow">
        <div className="who-line"><b>{k.author_name ?? 'Former teammate'}</b><span className="faint">{ago(k.created_at)}{k.edited_at ? ' · edited' : ''}</span>
          {(k.author_id === me.id || me.role === 'admin') && <span className="right row" style={{ gap: 2 }}>{k.author_id === me.id && <button className="btn tiny ghost" onClick={() => setEdit({ id: k.id, body: k.body })}>Edit</button>}<button className="btn tiny ghost" onClick={() => del(k.id)}>Delete</button></span>}</div>
        {edit && edit.id === k.id ? <div className="col"><textarea className="textarea" rows={3} value={edit.body} onChange={(e) => setEdit({ id: k.id, body: e.target.value })} aria-label="Edit comment" /><div className="row"><button className="btn tiny primary" onClick={saveEdit}>Save</button><button className="btn tiny" onClick={() => setEdit(null)}>Cancel</button></div></div>
          : <p className="prose">{k.body}</p>}</div></div>)}
      {data && !data.length && <p className="faint">No comments yet.</p>}
      <form className="col" onSubmit={post}><textarea className="textarea" rows={3} aria-label="Write a comment" placeholder="Write a comment. @name tells that person." value={reply} onChange={(e) => setReply(e.target.value)} maxLength={5000} />
        <div><button className="btn sm primary" disabled={busy || !reply.trim()}>{busy && <Spinner />}Comment</button></div></form>
    </div>
  );
}

function TaskFiles({ t, reload }: { t: any; reload: () => void }) {
  const toast = useToast(); const [pct, setPct] = useState<number | null>(null); const input = useRef<HTMLInputElement>(null);
  const up = async (f: File) => { setPct(0); try { await api.upload(`/api/projects/${t.project_id}/files?name=${encodeURIComponent(f.name)}&task_id=${t.id}`, f, setPct); toast(`${f.name} uploaded.`); reload(); } catch (e: any) { toast(e.message, { err: true }); } finally { setPct(null); } };
  if (!t.project_id) return <p className="faint">Files belong to a project. Put this to-do on a project to attach files.</p>;
  return (
    <div className="col">
      <ul className="tfiles">{t.file_list.map((f: any) => <li key={f.id}><Icon.file size={16} /><a href={`/api/files/${f.id}/content`} target="_blank" rel="noreferrer">{f.name}</a><span className="faint">{fileSize(f.size)} · {f.uploaded_by_name ?? 'someone'} · {ago(f.created_at)}</span>
        <a className="icon-btn" href={`/api/files/${f.id}/content?download=1`} aria-label={`Download ${f.name}`}><Icon.download size={15} /></a></li>)}</ul>
      {!t.file_list.length && <p className="faint">No files on this task yet.</p>}
      <input ref={input} type="file" className="sr" onChange={(e) => { const f = e.target.files?.[0]; if (f) up(f); e.target.value = ''; }} aria-label="Choose a file" />
      <div>{pct !== null ? <span className="upl"><Spinner />Uploading {Math.round(pct * 100)}%</span> : <button className="btn sm" onClick={() => input.current?.click()}><Icon.upload size={14} />Attach a file</button>}<span className="faint" style={{ marginLeft: 10, fontSize: 12 }}>Up to 10 MB</span></div>
    </div>
  );
}
