// The task panel docked beside the list and the timeline on wide screens: details, subtasks and activity of one task,
// with a comment box. It edits the same task record as the board, the full task view and the timeline.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { useLoad } from '../../ui/hooks.ts';
import { Icon, Dots } from '../../ui/icons.tsx';
import { Menu, MenuItem } from '../../ui/menu.tsx';
import { useConfirm } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Failure, Skeleton, Spinner, ago } from '../../ui/kit.tsx';
import { useMe, useTeam } from '../../session.tsx';
import { Avatar, PRIORITY, STATUS_COLOR, describe, type Column, type Task } from './shared.tsx';
import { Subtasks } from './TaskDrawer.tsx';

const TABS = ['Details', 'Subtasks', 'Activity'] as const;
type Tab = (typeof TABS)[number];
const PRIO_COLOR: Record<string, string> = { URGENT: '#F43F5E', HIGH: '#F87171', MEDIUM: '#F59E0B', LOW: '#94A3B8', NONE: '#64748B' };
const hue = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h) % 360; };
const stamp = (ts: string) => new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function TaskPanel({ taskId, tab: tab0, columns, milestones, tasks, onClose, onChanged, onOpen, onFull, onDuplicate }: {
  taskId: string; tab?: string | null; columns: Column[]; milestones: any[]; tasks: Task[]; onClose: () => void; onChanged: () => void; onOpen: (id: string) => void; onFull: () => void; onDuplicate: (id: string) => void }) {
  const toast = useToast(); const ask = useConfirm(); const team = useTeam(); const me = useMe();
  const { data: t, error, loading, reload, setData } = useLoad<any>(() => api.get(`/api/tasks/${taskId}`), [taskId]);
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(tab0 ?? '') ? (tab0 as Tab) : 'Details');
  const [desc, setDesc] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  const dirty = desc !== null && desc !== (t?.description ?? '');
  const close = async () => { if (dirty && !(await ask({ title: 'Discard your description changes?', body: 'The description you were editing has not been saved.', confirm: 'Discard', tone: 'danger' }))) return; onClose(); };
  useEffect(() => { if (!dirty) return; const h = (e: BeforeUnloadEvent) => e.preventDefault(); addEventListener('beforeunload', h); return () => removeEventListener('beforeunload', h); }, [dirty]);
  const save = async (patch: Record<string, unknown>) => {
    const before = t; setData({ ...t, ...patch }); setSaving(true);
    try { await api.patch(`/api/tasks/${taskId}`, patch); onChanged(); await reload(true); } catch (e: any) { setData(before); toast(e.message, { err: true }); } finally { setSaving(false); }
  };
  if (loading && !t) return <aside className="tpanel" aria-label="Task"><Skeleton h={24} w="70%" /><Skeleton h={30} w="40%" /><Skeleton h={220} /></aside>;
  if (error || !t) return <aside className="tpanel" aria-label="Task"><Failure error={error ?? 'Task not found'} retry={() => reload()} /><button className="btn" onClick={onClose}>Close</button></aside>;
  const others = tasks.filter((x) => x.id !== t.id && !x.archived_at);
  const lastBy = t.activity[0]?.actor_name;
  return (
    <aside className="tpanel" aria-labelledby="tp-title" style={{ '--s': STATUS_COLOR[t.status] } as React.CSSProperties}>
      <header className="tp-head">
        <TitleField value={t.title} onSave={(title) => save({ title })} />
        <button type="button" className="icon-btn" onClick={close} aria-label="Close task"><Icon.x size={16} /></button>
      </header>
      <div className="tp-status-row">
        <span className="chip-sel st big" style={{ '--s': STATUS_COLOR[t.status] } as React.CSSProperties}><i aria-hidden="true" />{columns.find((c) => c.id === t.column_id)?.name ?? t.status}<Icon.down size={12} />
          <select value={t.column_id ?? ''} onChange={(e) => save({ column_id: e.target.value })} aria-label="Status">{columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></span>
        {saving && <span className="tp-saving" role="status"><Spinner />Saving</span>}
        {t.blocked && <span className="chip-blocked"><Icon.lock size={10} />Blocked</span>}
      </div>
      <div className="tp-tabs" role="tablist" aria-label="Task">{TABS.map((x) => <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>
        {x === 'Subtasks' ? `Subtasks (${t.subtasks.filter((s: any) => s.status === 'DONE').length}/${t.subtasks.length})` : x}</button>)}</div>
      <div className="tp-body" role="tabpanel" aria-label={tab}>
        {tab === 'Details' && <>
          <section className="tp-desc"><div className="tp-row-h"><h3>Description</h3>{desc === null ? <button type="button" className="btn tiny" onClick={() => setDesc(t.description ?? '')}>Edit</button>
            : <span className="row" style={{ gap: 4 }}><button type="button" className="btn tiny primary" onClick={async () => { await save({ description: desc }); setDesc(null); }}>Save</button><button type="button" className="btn tiny ghost" onClick={() => setDesc(null)}>Cancel</button></span>}</div>
            {desc === null ? (t.description ? <p className="tp-desc-text">{t.description}</p> : <p className="faint">No description yet.</p>)
              : <textarea className="textarea" rows={6} autoFocus maxLength={10000} value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Description" placeholder="What done looks like, links, notes" />}</section>
          <dl className="tp-props">
            <dt>Assignee</dt><dd><span className="tp-sel">{t.assignee_name ? <Avatar name={t.assignee_name} size="xs" /> : null}<span>{t.assignee_name ?? 'Unassigned'}</span><Icon.down size={12} />
              <select value={t.assignee_id ?? ''} onChange={(e) => save({ assignee_id: e.target.value || null })} aria-label="Assignee"><option value="">Unassigned</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></span></dd>
            <dt>Priority</dt><dd><span className="tp-sel"><i className="pdot" style={{ background: PRIO_COLOR[t.priority] }} aria-hidden="true" /><span>{PRIORITY[t.priority]}</span><Icon.down size={12} />
              <select value={t.priority} onChange={(e) => save({ priority: e.target.value })} aria-label="Priority">{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></span></dd>
            <dt>Start date</dt><dd><DateField value={t.start_date} label="Start date" onChange={(v) => save({ start_date: v })} /></dd>
            <dt>Due date</dt><dd><DateField value={t.due_date} label="Due date" onChange={(v) => save({ due_date: v })} /></dd>
            <dt>Labels</dt><dd><Labels value={t.labels} all={[...new Set(tasks.flatMap((x) => x.labels))]} onChange={(labels) => save({ labels })} /></dd>
            <dt>Parent task</dt><dd><span className="tp-sel"><span>{t.parent_title ?? 'None'}</span><Icon.down size={12} />
              <select value={t.parent_id ?? ''} onChange={(e) => save({ parent_id: e.target.value || null })} aria-label="Parent task"><option value="">None</option>{others.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></span>
              {t.parent_id && <button type="button" className="icon-btn" onClick={() => onOpen(t.parent_id)} aria-label={`Open ${t.parent_title}`}><Icon.right size={13} /></button>}</dd>
            {milestones.length > 0 && <><dt>Milestone</dt><dd><span className="tp-sel"><span>{milestones.find((m) => m.id === t.milestone_id)?.name ?? 'None'}</span><Icon.down size={12} />
              <select value={t.milestone_id ?? ''} onChange={(e) => save({ milestone_id: e.target.value || null })} aria-label="Milestone"><option value="">None</option>{milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></span></dd></>}
          </dl>
          <dl className="tp-meta"><dt>Created</dt><dd>{stamp(t.created_at)}{t.created_by_name ? ` by ${t.created_by_name}` : ''}</dd>
            <dt>Last updated</dt><dd>{stamp(t.updated_at)}{lastBy ? ` by ${lastBy}` : ''}</dd></dl>
        </>}
        {tab === 'Subtasks' && <Subtasks t={t} reload={() => { reload(true); onChanged(); }} onOpen={onOpen} />}
        {tab === 'Activity' && <Activity t={t} me={me} reload={() => reload(true)} />}
      </div>
      <div className="tp-foot">
        <button type="button" className="btn" onClick={() => { setTab('Subtasks'); setTimeout(() => (document.querySelector('.tpanel [aria-label="Add a subtask"]') as HTMLElement | null)?.focus(), 30); }}><Icon.plus size={14} />Add subtask</button>
        <Menu label="More for this task" className="btn tp-more" button={<Dots size={16} />} place="up left">{(c) => <>
          <MenuItem onSelect={() => { c(); onFull(); }}><Icon.edit size={15} />Open full view</MenuItem>
          <MenuItem onSelect={() => { c(); onDuplicate(t.id); }}><Icon.copy size={15} />Duplicate</MenuItem>
          <MenuItem onSelect={async () => { c(); try { await navigator.clipboard.writeText(`${location.origin}/projects/${t.project_id}/list?task=${t.id}`); toast('Link copied.'); } catch { toast('Could not copy the link.', { err: true }); } }}><Icon.link size={15} />Copy task link</MenuItem>
          <MenuItem onSelect={() => { c(); save({ archived: !t.archived_at }); }}><Icon.archive size={15} />{t.archived_at ? 'Restore' : 'Archive'}</MenuItem>
          <MenuItem onSelect={async () => { c(); if (!(await ask({ title: `Delete “${t.title}”?`, body: 'Its comments and subtasks go with it. This cannot be undone. Archive keeps it.', confirm: 'Delete task', tone: 'danger' }))) return; try { await api.del(`/api/tasks/${t.id}`); onChanged(); onClose(); toast('Task deleted.'); } catch (e: any) { toast(e.message, { err: true }); } }}><Icon.trash size={15} /><span className="danger-text">Delete</span></MenuItem></>}</Menu>
      </div>
      <Composer t={t} onPosted={() => { setTab('Activity'); reload(true); onChanged(); }} />
    </aside>
  );
}

function TitleField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value); useEffect(() => setV(value), [value]);
  return <textarea id="tp-title" className="tp-title" rows={1} aria-label="Task title" value={v} maxLength={200} onChange={(e) => setV(e.target.value.replace(/\n/g, ''))}
    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } if (e.key === 'Escape') { setV(value); } }} onBlur={() => { if (v.trim() && v !== value) onSave(v.trim()); else setV(value); }} />;
}
function DateField({ value, label, onChange }: { value: string | null; label: string; onChange: (v: string | null) => void }) {
  return <span className="tp-date"><Icon.calendar size={14} /><input type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label={label} />
    {value && <button type="button" className="icon-btn" onClick={() => onChange(null)} aria-label={`Clear the ${label.toLowerCase()}`}><Icon.x size={12} /></button>}</span>;
}
function Labels({ value, all, onChange }: { value: string[]; all: string[]; onChange: (l: string[]) => void }) {
  const [v, setV] = useState(''); const [adding, setAdding] = useState(false);
  const add = () => { const x = v.trim().slice(0, 30); if (x && !value.includes(x)) onChange([...value, x]); setV(''); setAdding(false); };
  return <span className="tp-labels">{value.map((l) => <span key={l} className="lbl sm hued" style={{ '--l-h': hue(l) } as React.CSSProperties}>{l}<button type="button" onClick={() => onChange(value.filter((x) => x !== l))} aria-label={`Remove label ${l}`}><Icon.x size={10} /></button></span>)}
    {adding ? <input autoFocus className="tp-lbl-in" value={v} list="tp-labels" maxLength={30} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } if (e.key === 'Escape') { setV(''); setAdding(false); } }} onBlur={add} aria-label="New label" />
      : <button type="button" className="icon-btn" onClick={() => setAdding(true)} aria-label="Add a label"><Icon.plus size={14} /></button>}
    <datalist id="tp-labels">{all.filter((l) => !value.includes(l)).map((l) => <option key={l} value={l} />)}</datalist></span>;
}
// comments and recorded changes together, newest first
function Activity({ t, me, reload }: { t: any; me: any; reload: () => void }) {
  const toast = useToast(); const ask = useConfirm();
  const comments = useLoad<any[]>(() => api.get(`/api/tasks/${t.id}/comments`), [t.id, t.comments]);
  const items = [...(comments.data ?? []).map((k) => ({ kind: 'c' as const, at: k.created_at, k })), ...t.activity.filter((a: any) => a.action !== 'comment_added').map((a: any) => ({ kind: 'a' as const, at: a.created_at, a }))].sort((x, y) => y.at.localeCompare(x.at));
  if (comments.loading && !comments.data) return <Skeleton h={120} />;
  if (!items.length) return <p className="faint">Nothing has happened on this task yet. Comments and changes show here.</p>;
  return <ul className="tp-act">{items.map((it, i) => it.kind === 'c'
    ? <li key={'c' + it.k.id} className="tp-comment"><Avatar name={it.k.author_name} size="xs" /><div><div className="who-line"><b>{it.k.author_name ?? 'Former teammate'}</b><span className="faint">{ago(it.k.created_at)}{it.k.edited_at ? ' · edited' : ''}</span>
      {(it.k.author_id === me.id || me.role === 'admin') && <button type="button" className="btn tiny ghost right" onClick={async () => { if (!(await ask({ title: 'Delete this comment?', confirm: 'Delete', tone: 'danger' }))) return; try { await api.del(`/api/comments/${it.k.id}`); comments.reload(true); reload(); } catch (e: any) { toast(e.message, { err: true }); } }}>Delete</button>}</div><p className="prose">{it.k.body}</p></div></li>
    : (() => { const d = describe(it.a); const I = Icon[d.icon]; return <li key={'a' + i}><span className={`f-ic tone-${d.tone}`}><I size={12} /></span><div><b>{it.a.actor_name ?? 'Someone'}</b> {d.verb}{d.note ? ` ${d.note}` : ''}<span className="when">{ago(it.a.created_at)}</span></div></li>; })())}</ul>;
}
function Composer({ t, onPosted }: { t: any; onPosted: () => void }) {
  const toast = useToast(); const [v, setV] = useState(''); const [busy, setBusy] = useState(false); const file = useRef<HTMLInputElement>(null); const [pct, setPct] = useState<number | null>(null);
  const post = async (e: React.FormEvent) => { e.preventDefault(); if (!v.trim() || busy) return; setBusy(true); try { await api.post(`/api/tasks/${t.id}/comments`, { body: v.trim() }); setV(''); onPosted(); } catch (x: any) { toast(x.message, { err: true }); } finally { setBusy(false); } };
  const upload = async (f?: File | null) => { if (!f || !t.project_id) return; if (f.size > 10_000_000) { toast('That file is over 10 MB.', { err: true }); return; } setPct(0);
    try { await api.upload(`/api/projects/${t.project_id}/files?name=${encodeURIComponent(f.name)}&task_id=${t.id}`, f, setPct); toast(`${f.name} attached to the task.`); onPosted(); } catch (x: any) { toast(x.message, { err: true }); } finally { setPct(null); } };
  return <form className="tp-compose" onSubmit={post}>
    <span className="tp-cin"><input value={v} onChange={(e) => setV(e.target.value)} placeholder={pct !== null ? `Uploading ${Math.round(pct * 100)}%` : 'Add a comment...'} aria-label="Add a comment. @name tells that person." maxLength={5000} />
      {t.project_id && <button type="button" className="icon-btn" onClick={() => file.current?.click()} aria-label="Attach a file to this task" disabled={pct !== null}><Icon.link size={14} /></button>}</span>
    <button className="btn primary tp-send" disabled={busy || !v.trim()} aria-label="Send comment">{busy ? <Spinner /> : <Icon.send size={15} />}</button>
    <input ref={file} type="file" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
  </form>;
}
