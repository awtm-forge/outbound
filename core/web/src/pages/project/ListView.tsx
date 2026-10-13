import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { useRouter } from '../../router.tsx';
import { useLoad } from '../../ui/hooks.ts';
import { Icon, Dots } from '../../ui/icons.tsx';
import { Menu, MenuItem } from '../../ui/menu.tsx';
import { useConfirm } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Empty, ago, todayIST } from '../../ui/kit.tsx';
import { useMe, useTeam } from '../../session.tsx';
import { Avatar, PRIORITY, PRIORITY_RANK, STATUS_ORDER, TASK_STATUS, StatusDot, addDays, shortDay, type Task } from './shared.tsx';
import type { WS } from './Workspace.tsx';

type SortKey = { key: string; dir: 1 | -1 };
type Config = { q: string; status: string[]; priority: string[]; assignee: string[]; label: string; due: string; done: string; group: string; sort: SortKey[]; cols: string[]; widths: Record<string, number> };
const COLS: Record<string, string> = { status: 'Status', priority: 'Priority', assignee: 'Assignee', collaborators: 'Collaborators', start: 'Start', due: 'Due date', labels: 'Labels', parent: 'Parent', subtasks: 'Subtasks', deps: 'Dependencies', estimate: 'Estimate', actual: 'Actual time', created: 'Created', updated: 'Updated' };
const DEFAULT: Config = { q: '', status: [], priority: [], assignee: [], label: '', due: '', done: '', group: '', sort: [], cols: ['status', 'priority', 'assignee', 'due', 'labels', 'subtasks'], widths: {} };
const PAGE = 50;
// the views every project has; saved views sit beside them, over the same tasks
const BUILT_IN: { id: string; name: string; config: (me: string) => Partial<Config> }[] = [
  { id: 'all', name: 'All tasks', config: () => ({}) }, { id: 'mine', name: 'My tasks', config: (me) => ({ assignee: [me] }) },
  { id: 'overdue', name: 'Overdue', config: () => ({ due: 'overdue' }) }, { id: 'high', name: 'High priority', config: () => ({ priority: ['HIGH'], done: 'open' }) },
  { id: 'review', name: 'Waiting for review', config: () => ({ status: ['REVIEW'] }) }, { id: 'month', name: 'Completed this month', config: () => ({ done: 'month' }) },
];
const key = (pid: string) => `awtm-list-${pid}`;

export function ListView({ ws }: { ws: WS }) {
  const { p } = ws; const me = useMe(); const team = useTeam(); const toast = useToast(); const ask = useConfirm(); const { search } = useRouter();
  const views = useLoad<any[]>(() => api.get(`/api/projects/${p.id}/views`), [p.id]);
  const [viewId, setViewId] = useState('all');
  const [c, setC] = useState<Config>(() => { try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(key(p.id)) ?? '{}') }; } catch { return DEFAULT; } });
  useEffect(() => { try { localStorage.setItem(key(p.id), JSON.stringify(c)); } catch { /* private mode */ } }, [c, p.id]);
  useEffect(() => { const l = search.get('label'); if (l) { setC((x) => ({ ...DEFAULT, cols: x.cols, widths: x.widths, label: l })); setViewId(''); } }, [search]);
  const set = (x: Partial<Config>) => { setC({ ...c, ...x }); setPage(0); };
  const [sel, setSel] = useState<Set<string>>(new Set()); const [page, setPage] = useState(0);
  const byId = useMemo(() => new Map(p.task_list.map((t) => [t.id, t])), [p.task_list]);
  const labels = useMemo(() => [...new Set(p.task_list.flatMap((t) => t.labels))].sort(), [p.task_list]);
  const today = todayIST(); const month = today.slice(0, 7);
  const rows = useMemo(() => {
    const q = c.q.trim().toLowerCase();
    const r = p.task_list.filter((t) => (!q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
      && (!c.status.length || c.status.includes(t.status)) && (!c.priority.length || c.priority.includes(t.priority))
      && (!c.assignee.length || c.assignee.includes(t.assignee_id ?? 'none')) && (!c.label || t.labels.includes(c.label))
      && (!c.due || (c.due === 'overdue' ? t.status !== 'DONE' && !!t.due_date && t.due_date < today : c.due === 'week' ? !!t.due_date && t.due_date >= today && t.due_date <= addDays(today, 7) : !t.due_date))
      && (!c.done || (c.done === 'open' ? t.status !== 'DONE' : c.done === 'done' ? t.status === 'DONE' : t.status === 'DONE' && (t.completed_at ?? '').slice(0, 7) === month)));
    const val = (t: Task, k: string): string | number => k === 'title' ? t.title.toLowerCase() : k === 'status' ? STATUS_ORDER.indexOf(t.status as any) : k === 'priority' ? PRIORITY_RANK[t.priority]! : k === 'assignee' ? (t.assignee_name ?? '~') : k === 'due' ? (t.due_date ?? '9999') : k === 'start' ? (t.start_date ?? '9999') : k === 'created' ? t.created_at : k === 'updated' ? t.updated_at : k === 'estimate' ? Number(t.estimate_hours ?? 1e9) : k === 'actual' ? Number(t.actual_hours ?? 1e9) : k === 'subtasks' ? t.subtasks : 0;
    const sorts = c.sort.length ? c.sort : [{ key: 'status', dir: 1 as const }, { key: 'priority', dir: 1 as const }];
    return r.sort((a, b) => { for (const s of sorts) { const x = val(a, s.key); const y = val(b, s.key); if (x < y) return -s.dir; if (x > y) return s.dir; } return a.position - b.position; });
  }, [p.task_list, c, today, month]);
  const groups = useMemo(() => {
    if (!c.group) return [['', rows]] as [string, Task[]][];
    const m = new Map<string, Task[]>();
    for (const t of rows) for (const g of c.group === 'label' ? (t.labels.length ? t.labels : ['No label']) : [c.group === 'status' ? TASK_STATUS[t.status]! : c.group === 'priority' ? PRIORITY[t.priority]! : t.assignee_name ?? 'Nobody']) m.set(g, [...(m.get(g) ?? []), t]);
    return [...m.entries()];
  }, [rows, c.group]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)); const pageRows = new Set(rows.slice(page * PAGE, page * PAGE + PAGE).map((t) => t.id));
  useEffect(() => { setSel((s) => new Set([...s].filter((id) => byId.has(id)))); }, [byId]);

  const applyView = (id: string, config: Partial<Config>) => { setViewId(id); setC({ ...DEFAULT, cols: c.cols, widths: c.widths, ...config }); setPage(0); };
  const saveView = async () => {
    const name = await ask({ title: 'Save this view', body: 'The filters, grouping, sorting and columns are kept under this name. It shows the same tasks, never copies.', input: { label: 'Name', placeholder: 'Design work' }, confirm: 'Save view' });
    if (typeof name !== 'string' || !name.trim()) return;
    const shared = await ask({ title: 'Share it with the team?', body: 'A shared view appears for everyone on this project. Otherwise it is only yours.', confirm: 'Share it', cancel: 'Just for me' });
    try { const v = await api.post(`/api/projects/${p.id}/views`, { name: name.trim(), config: c, shared: !!shared }); views.reload(true); setViewId(v.id); toast('View saved.'); } catch (e: any) { toast(e.message, { err: true }); }
  };
  const delView = async (v: any) => { if (!(await ask({ title: `Delete the view “${v.name}”?`, body: 'Only the view goes. The tasks stay.', confirm: 'Delete view', tone: 'danger' }))) return; try { await api.del(`/api/views/${v.id}`); views.reload(true); setViewId('all'); } catch (e: any) { toast(e.message, { err: true }); } };
  const updateView = async (v: any) => { try { await api.patch(`/api/views/${v.id}`, { config: c }); views.reload(true); toast(`“${v.name}” updated.`); } catch (e: any) { toast(e.message, { err: true }); } };

  const patch = async (t: Task, b: object) => { const prev = p; ws.setP({ ...p, task_list: p.task_list.map((x) => (x.id === t.id ? { ...x, ...b } : x)) }); try { await api.patch(`/api/tasks/${t.id}`, b); ws.reload(); } catch (e: any) { ws.setP(prev); toast(e.message, { err: true }); } };
  const bulk = async (action: string, setB?: object) => {
    const ids = [...sel]; if (!ids.length) return;
    if (action === 'delete' && !(await ask({ title: `Delete ${ids.length} ${ids.length === 1 ? 'task' : 'tasks'}?`, body: 'Their comments and subtasks go with them. This cannot be undone. Archive keeps them.', confirm: 'Delete', tone: 'danger' }))) return;
    try { const r = await api.post(`/api/projects/${p.id}/tasks/bulk`, { ids, action, set: setB }); toast(`${r.done} ${r.done === 1 ? 'task' : 'tasks'} ${action === 'delete' ? 'deleted' : action === 'archive' ? 'archived' : 'updated'}.`); setSel(new Set()); ws.reload(); } catch (e: any) { toast(e.message, { err: true }); }
  };
  const csv = () => {
    const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const head = ['Task', ...c.cols.map((k) => COLS[k])]; const cell = (t: Task, k: string) => k === 'status' ? TASK_STATUS[t.status] : k === 'priority' ? PRIORITY[t.priority] : k === 'assignee' ? t.assignee_name : k === 'collaborators' ? t.collaborator_ids.map((id) => team.find((u) => u.id === id)?.name).join('; ') : k === 'start' ? t.start_date : k === 'due' ? t.due_date : k === 'labels' ? t.labels.join('; ') : k === 'parent' ? (t.parent_id ? byId.get(t.parent_id)?.title : '') : k === 'subtasks' ? (t.subtasks ? `${t.subtasks_done}/${t.subtasks}` : '') : k === 'deps' ? (t.blocked ? 'Blocked' : '') : k === 'estimate' ? t.estimate_hours : k === 'actual' ? t.actual_hours : k === 'created' ? t.created_at.slice(0, 10) : t.updated_at.slice(0, 10);
    const text = [head.map(esc).join(','), ...rows.map((t) => [t.title, ...c.cols.map((k) => cell(t, k))].map(esc).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = `${p.name.replace(/[^\w-]+/g, '-')}-tasks.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const sortBy = (k: string, add: boolean) => {
    const cur = c.sort.find((s) => s.key === k); const next: SortKey = { key: k, dir: cur?.dir === 1 ? -1 : 1 };
    set({ sort: add ? [...c.sort.filter((s) => s.key !== k), next] : cur?.dir === -1 ? [] : [next] });
  };
  const nFilters = [c.status.length, c.priority.length, c.assignee.length, c.label, c.due, c.done].filter(Boolean).length;
  const multi = (k: 'status' | 'priority' | 'assignee', v: string) => set({ [k]: c[k].includes(v) ? c[k].filter((x) => x !== v) : [...c[k], v] } as any);
  const saved = views.data ?? []; const savedCur = saved.find((v) => v.id === viewId);
  return (
    <div className="lv">
      <div className="lv-views" role="group" aria-label="Views">
        {BUILT_IN.map((v) => <button key={v.id} type="button" aria-pressed={viewId === v.id} className={viewId === v.id ? 'on' : ''} onClick={() => applyView(v.id, v.config(me.id))}>{v.name}</button>)}
        {saved.map((v) => <button key={v.id} type="button" aria-pressed={viewId === v.id} className={viewId === v.id ? 'on' : ''} onClick={() => applyView(v.id, v.config)}>{v.user_id ? <Icon.user size={12} /> : <Icon.people size={12} />}{v.name}</button>)}
        <button type="button" className="lv-save" onClick={saveView}><Icon.plus size={13} />Save view</button>
        {savedCur && <Menu label={`View ${savedCur.name}`} className="icon-btn" button={<Dots vertical size={14} />} place="left">{(close) => <>
          <MenuItem onSelect={() => { close(); updateView(savedCur); }}><Icon.check size={15} />Update with current settings</MenuItem>
          <MenuItem onSelect={() => { close(); delView(savedCur); }}><Icon.trash size={15} />Delete view</MenuItem></>}</Menu>}
      </div>
      <div className="lv-tools">
        <label className="tb-search"><Icon.find size={15} /><input placeholder="Search tasks" value={c.q} onChange={(e) => set({ q: e.target.value })} aria-label="Search tasks" /></label>
        <Menu label="Status" className={`btn tiny${c.status.length ? ' on' : ''}`} kind="dialog" button={<>Status{c.status.length ? <span className="n">{c.status.length}</span> : null}<Icon.down size={12} /></>}>{() => <div className="filter-pop">{STATUS_ORDER.map((s) => <label key={s} className="chk"><input type="checkbox" className="check" checked={c.status.includes(s)} onChange={() => multi('status', s)} /><StatusDot s={s} />{TASK_STATUS[s]}</label>)}</div>}</Menu>
        <Menu label="Priority" className={`btn tiny${c.priority.length ? ' on' : ''}`} kind="dialog" button={<>Priority{c.priority.length ? <span className="n">{c.priority.length}</span> : null}<Icon.down size={12} /></>}>{() => <div className="filter-pop">{Object.entries(PRIORITY).map(([k, v]) => <label key={k} className="chk"><input type="checkbox" className="check" checked={c.priority.includes(k)} onChange={() => multi('priority', k)} />{v}</label>)}</div>}</Menu>
        <Menu label="Assignee" className={`btn tiny${c.assignee.length ? ' on' : ''}`} kind="dialog" button={<>Assignee{c.assignee.length ? <span className="n">{c.assignee.length}</span> : null}<Icon.down size={12} /></>}>{() => <div className="filter-pop">{[...team.map((u) => [u.id, u.name]), ['none', 'Nobody']].map(([id, n]) => <label key={id} className="chk"><input type="checkbox" className="check" checked={c.assignee.includes(id!)} onChange={() => multi('assignee', id!)} />{n}</label>)}</div>}</Menu>
        <Menu label="More filters" className={`btn tiny${c.due || c.done || c.label ? ' on' : ''}`} kind="dialog" button={<><Icon.funnel size={13} />More</>}>{() => <div className="filter-pop">
          <label className="field"><span>Due</span><select value={c.due} onChange={(e) => set({ due: e.target.value })}><option value="">Any</option><option value="overdue">Overdue</option><option value="week">Next 7 days</option><option value="none">No date</option></select></label>
          <label className="field"><span>Done</span><select value={c.done} onChange={(e) => set({ done: e.target.value })}><option value="">Open and done</option><option value="open">Open only</option><option value="done">Done only</option><option value="month">Done this month</option></select></label>
          <label className="field"><span>Label</span><select value={c.label} onChange={(e) => set({ label: e.target.value })}><option value="">Any</option>{labels.map((l) => <option key={l} value={l}>{l}</option>)}</select></label></div>}</Menu>
        {nFilters > 0 && <button type="button" className="btn tiny ghost" onClick={() => set({ status: [], priority: [], assignee: [], label: '', due: '', done: '' })}>Reset</button>}
        <span className="right" />
        <label className="tb-group"><span>Group</span><select value={c.group} onChange={(e) => set({ group: e.target.value })} aria-label="Group by"><option value="">None</option><option value="status">Status</option><option value="assignee">Assignee</option><option value="priority">Priority</option><option value="label">Label</option></select></label>
        <Menu label="Columns" className="btn tiny" kind="dialog" place="left" button={<><Icon.layers size={13} />Columns</>}>{() => <ColumnPicker c={c} set={set} />}</Menu>
        <button type="button" className="btn tiny" onClick={csv} disabled={!rows.length}><Icon.download size={13} />CSV</button>
        <button type="button" className="btn tiny primary" onClick={() => ws.addTask()}><Icon.plus size={13} />Add task</button>
      </div>
      {sel.size > 0 && <div className="bulkbar" role="region" aria-label="Selected tasks"><b>{sel.size} selected</b>
        <select aria-label="Set status" value="" onChange={(e) => e.target.value && bulk('update', { status: e.target.value })}><option value="">Status…</option>{STATUS_ORDER.map((s) => <option key={s} value={s}>{TASK_STATUS[s]}</option>)}</select>
        <select aria-label="Set priority" value="" onChange={(e) => e.target.value && bulk('update', { priority: e.target.value })}><option value="">Priority…</option>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select aria-label="Set assignee" value="" onChange={(e) => e.target.value && bulk('update', { assignee_id: e.target.value === 'none' ? null : e.target.value })}><option value="">Assignee…</option><option value="none">Nobody</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <form onSubmit={(e) => { e.preventDefault(); const i = (e.currentTarget.elements.namedItem('l') as HTMLInputElement); if (i.value.trim()) { bulk('update', { add_labels: [i.value.trim()] }); i.value = ''; } }}><input name="l" placeholder="Add label" aria-label="Add a label to the selected tasks" maxLength={30} /></form>
        <button type="button" className="btn tiny" onClick={() => bulk('archive')}><Icon.archive size={13} />Archive</button>
        <button type="button" className="btn tiny danger" onClick={() => bulk('delete')}><Icon.trash size={13} />Delete</button>
        <button type="button" className="btn tiny ghost" style={{ marginLeft: 'auto' }} onClick={() => setSel(new Set())}>Clear</button></div>}
      {!rows.length ? <div className="panel" style={{ padding: 8 }}><Empty title={p.task_list.length ? 'No task matches' : 'No tasks yet'} action={p.task_list.length ? <button className="btn" onClick={() => applyView('all', {})}>Show all tasks</button> : <button className="btn primary" onClick={() => ws.addTask()}>Add the first task</button>}>{p.task_list.length ? 'Change the filters or the search.' : 'Tasks added here show on the board, the timeline and everyone’s lists.'}</Empty></div> :
      <div className="panel scrollx"><table className="ctable ltable" aria-label="Tasks">
        <thead><tr><th style={{ width: 36 }}><input type="checkbox" className="check" aria-label="Select all shown" checked={rows.length > 0 && rows.filter((t) => pageRows.has(t.id)).every((t) => sel.has(t.id))} onChange={(e) => setSel(e.target.checked ? new Set([...sel, ...pageRows]) : new Set([...sel].filter((x) => !pageRows.has(x))))} /></th>
          <Th k="title" label="Task" c={c} sortBy={sortBy} set={set} />{c.cols.map((k) => <Th key={k} k={k} label={COLS[k]!} c={c} sortBy={sortBy} set={set} />)}<th><span className="sr">Open</span></th></tr></thead>
        {groups.map(([g, list]) => { const shown = list.filter((t) => pageRows.has(t.id)); return shown.length > 0 && <tbody key={g || 'all'}>
          {g && <tr className="grp"><th colSpan={c.cols.length + 3} scope="rowgroup">{g}<span>{list.length}</span></th></tr>}
          {shown.map((t) => <tr key={t.id} className={`${sel.has(t.id) ? 'sel' : ''}${t.status === 'DONE' ? ' isdone' : ''}`}>
            <td><input type="checkbox" className="check" aria-label={`Select ${t.title}`} checked={sel.has(t.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })} /></td>
            <td className="lt-title"><button type="button" className="link-btn" onClick={() => ws.openTask(t.id)}>{t.parent_id && <span className="lt-sub" aria-label="Subtask">↳</span>}{t.title}</button>{t.blocked && <span className="chip-blocked"><Icon.lock size={10} />Blocked</span>}</td>
            {c.cols.map((k) => <td key={k}><Cell k={k} t={t} ws={ws} team={team} byId={byId} patch={patch} /></td>)}
            <td><button type="button" className="icon-btn" onClick={() => ws.openTask(t.id)} aria-label={`Open ${t.title}`}><Icon.arrow size={14} /></button></td></tr>)}</tbody>; })}
      </table></div>}
      {rows.length > PAGE && <div className="pager"><span>{page * PAGE + 1} to {Math.min(rows.length, page * PAGE + PAGE)} of {rows.length}</span>
        <nav className="pg-nav" aria-label="Pages"><button type="button" className="icon-btn" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"><Icon.left size={15} /></button>
          {Array.from({ length: pages }, (_, i) => <button key={i} type="button" className={`pg-n${i === page ? ' on' : ''}`} aria-current={i === page ? 'page' : undefined} onClick={() => setPage(i)}>{i + 1}</button>)}
          <button type="button" className="icon-btn" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page"><Icon.right size={15} /></button></nav></div>}
    </div>
  );
}

function Th({ k, label, c, sortBy, set }: { k: string; label: string; c: Config; sortBy: (k: string, add: boolean) => void; set: (x: Partial<Config>) => void }) {
  const s = c.sort.findIndex((x) => x.key === k); const dir = s >= 0 ? c.sort[s]!.dir : 0; const sortable = !['labels', 'collaborators', 'parent', 'deps'].includes(k);
  const start = useRef<{ x: number; w: number } | null>(null);
  const w = c.widths[k];
  return <th style={w ? { width: w, minWidth: w } : undefined} aria-sort={dir ? (dir === 1 ? 'ascending' : 'descending') : undefined}>
    {sortable ? <button type="button" className="th-sort" onClick={(e) => sortBy(k, e.shiftKey)} title="Click to sort, Shift-click to add a second sort">{label}{dir ? <span aria-hidden="true">{dir === 1 ? ' ↑' : ' ↓'}{c.sort.length > 1 ? s + 1 : ''}</span> : null}</button> : label}
    <span className="th-resize" aria-hidden="true" onPointerDown={(e) => { const th = (e.currentTarget.parentElement as HTMLElement); start.current = { x: e.clientX, w: th.offsetWidth }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { if (start.current) set({ widths: { ...c.widths, [k]: Math.max(70, Math.min(600, start.current.w + e.clientX - start.current.x)) } }); }} onPointerUp={() => { start.current = null; }} /></th>;
}
function ColumnPicker({ c, set }: { c: Config; set: (x: Partial<Config>) => void }) {
  const move = (k: string, d: -1 | 1) => { const l = [...c.cols]; const i = l.indexOf(k); const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j]!, l[i]!]; set({ cols: l }); };
  const hidden = Object.keys(COLS).filter((k) => !c.cols.includes(k));
  return <div className="filter-pop colpick"><p className="menu-note">Shown, in order</p>
    {c.cols.map((k, i) => <div key={k} className="cp-line"><label className="chk"><input type="checkbox" className="check" checked onChange={() => set({ cols: c.cols.filter((x) => x !== k) })} />{COLS[k]}</label>
      <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(k, -1)} aria-label={`Move ${COLS[k]} earlier`}><Icon.left size={13} /></button>
      <button type="button" className="icon-btn" disabled={i === c.cols.length - 1} onClick={() => move(k, 1)} aria-label={`Move ${COLS[k]} later`}><Icon.right size={13} /></button></div>)}
    {hidden.length > 0 && <><p className="menu-note">Hidden</p>{hidden.map((k) => <label key={k} className="chk"><input type="checkbox" className="check" checked={false} onChange={() => set({ cols: [...c.cols, k] })} />{COLS[k]}</label>)}</>}
    <button type="button" className="btn tiny" onClick={() => set({ cols: DEFAULT.cols, widths: {} })}>Back to the default columns</button></div>;
}
function Cell({ k, t, ws, team, byId, patch }: { k: string; t: Task; ws: WS; team: any[]; byId: Map<string, Task>; patch: (t: Task, b: object) => void }) {
  switch (k) {
    case 'status': return <span className="cell-sel"><StatusDot s={t.status} /><select value={t.column_id ?? ''} onChange={(e) => patch(t, { column_id: e.target.value, status: ws.p.columns.find((c) => c.id === e.target.value)?.status })} aria-label={`Status of ${t.title}`}>{ws.p.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></span>;
    case 'priority': return <span className={`cell-sel prio-sel ${t.priority}`}><select value={t.priority} onChange={(e) => patch(t, { priority: e.target.value })} aria-label={`Priority of ${t.title}`}>{Object.entries(PRIORITY).map(([kk, v]) => <option key={kk} value={kk}>{v}</option>)}</select></span>;
    case 'assignee': return <span className="cell-sel">{t.assignee_name && <Avatar name={t.assignee_name} size="xs" />}<select value={t.assignee_id ?? ''} onChange={(e) => patch(t, { assignee_id: e.target.value || null, assignee_name: team.find((u) => u.id === e.target.value)?.name ?? null })} aria-label={`Assignee of ${t.title}`}><option value="">Nobody</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></span>;
    case 'due': return <input type="date" className={`cell-date${t.status !== 'DONE' && t.due_date && t.due_date < todayIST() ? ' late' : ''}`} value={t.due_date ?? ''} onChange={(e) => patch(t, { due_date: e.target.value || null })} aria-label={`Due date of ${t.title}`} />;
    case 'start': return <input type="date" className="cell-date" value={t.start_date ?? ''} onChange={(e) => patch(t, { start_date: e.target.value || null })} aria-label={`Start date of ${t.title}`} />;
    case 'labels': return <span className="labels">{t.labels.map((l) => <span key={l} className="lbl sm">{l}</span>)}</span>;
    case 'collaborators': return <span className="avs">{t.collaborator_ids.map((id) => { const u = team.find((x) => x.id === id); return u ? <Avatar key={id} name={u.name} size="xs" title={u.name} /> : null; })}</span>;
    case 'parent': return t.parent_id ? <button type="button" className="link-btn sub" onClick={() => ws.openTask(t.parent_id!)}>{byId.get(t.parent_id)?.title ?? 'Parent'}</button> : null;
    case 'subtasks': return t.subtasks ? <span className="subprog"><span className="pbar"><i style={{ width: `${(t.subtasks_done / t.subtasks) * 100}%` }} /></span>{t.subtasks_done}/{t.subtasks}</span> : null;
    case 'deps': return t.blocked ? <span className="chip-blocked"><Icon.lock size={10} />Waiting</span> : null;
    case 'estimate': return t.estimate_hours ? <>{Number(t.estimate_hours)} h</> : null;
    case 'actual': return t.actual_hours ? <>{Number(t.actual_hours)} h</> : null;
    case 'created': return <span className="sub">{ago(t.created_at)}</span>;
    case 'updated': return <span className="sub">{ago(t.updated_at)}</span>;
    default: return null;
  }
}
export { shortDay };
