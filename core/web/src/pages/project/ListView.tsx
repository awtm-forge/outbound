// The list: every task of the project as a dense table. Views (built in, and saved ones that are personal or shared)
// are filters, sort, grouping and columns over the same tasks; nothing is copied. Inline edits, bulk changes and the
// task panel all write through the same task API the board and timeline use.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { useRouter } from '../../router.tsx';
import { useLoad } from '../../ui/hooks.ts';
import { Icon, Dots } from '../../ui/icons.tsx';
import { Menu, MenuItem } from '../../ui/menu.tsx';
import { useConfirm } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Empty, ago } from '../../ui/kit.tsx';
import { useMe, useTeam } from '../../session.tsx';
import { Avatar, PRIORITY, PRIORITY_RANK, STATUS_COLOR, STATUS_ORDER, TASK_STATUS, StatusDot, addDays, type Task } from './shared.tsx';
import type { WS } from './Workspace.tsx';

type SortKey = { key: string; dir: 1 | -1 };
type Config = { q: string; status: string[]; priority: string[]; assignee: string[]; labels: string[]; due: string; done: string; milestone: string; level: string; group: string; sort: SortKey[]; cols: string[]; widths: Record<string, number> };
const COLS: Record<string, string> = { status: 'Status', priority: 'Priority', assignee: 'Assignee', due: 'Due date', labels: 'Labels', subtasks: 'Subtasks', collaborators: 'Collaborators', start: 'Start',
  milestone: 'Milestone', parent: 'Parent', deps: 'Dependencies', estimate: 'Estimate', actual: 'Actual time', created: 'Created', updated: 'Updated' };
const DEFAULT: Config = { q: '', status: [], priority: [], assignee: [], labels: [], due: '', done: '', milestone: '', level: '', group: '', sort: [], cols: ['status', 'priority', 'assignee', 'due', 'labels', 'subtasks'], widths: {} };
const DUE: Record<string, string> = { overdue: 'Overdue', today: 'Due today', week: 'Next 7 days', later: 'Later', none: 'No due date' };
const GROUPS: Record<string, string> = { status: 'Status', priority: 'Priority', assignee: 'Assignee', due: 'Due date', milestone: 'Milestone', label: 'Label' };
export const PRIO_COLOR: Record<string, string> = { URGENT: '#F43F5E', HIGH: '#F87171', MEDIUM: '#F59E0B', LOW: '#94A3B8', NONE: '#64748B' };
// the date filters use the viewer's own calendar day
const localToday = () => new Date().toLocaleDateString('en-CA');
const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const BUILT_IN: { id: string; name: string; config: (me: string) => Partial<Config> }[] = [
  { id: 'all', name: 'All tasks', config: () => ({}) }, { id: 'mine', name: 'My tasks', config: (me) => ({ assignee: [me], done: 'open' }) },
  { id: 'overdue', name: 'Overdue', config: () => ({ due: 'overdue' }) }, { id: 'high', name: 'High priority', config: () => ({ priority: ['URGENT', 'HIGH'], done: 'open' }) },
  { id: 'review', name: 'Waiting for review', config: () => ({ status: ['REVIEW'] }) }, { id: 'month', name: 'Completed this month', config: () => ({ done: 'month' }) },
];
const storeKey = (pid: string) => `awtm-list-${pid}`;
export const hue = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h) % 360; };

function dueBucket(t: Task, today: string) { if (!t.due_date) return 'none'; if (t.status !== 'DONE' && t.due_date < today) return 'overdue'; if (t.due_date === today) return 'today'; if (t.due_date <= addDays(today, 7)) return 'week'; return 'later'; }
function matches(t: Task, c: Config, today: string) {
  const q = c.q.trim().toLowerCase(); const month = today.slice(0, 7);
  return (!q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.labels.some((l) => l.toLowerCase().includes(q)) || (t.assignee_name ?? '').toLowerCase().includes(q))
    && (!c.status.length || c.status.includes(t.status)) && (!c.priority.length || c.priority.includes(t.priority))
    && (!c.assignee.length || c.assignee.includes(t.assignee_id ?? 'none')) && (!c.labels.length || c.labels.some((l) => t.labels.includes(l)))
    && (!c.due || (c.due === 'overdue' ? t.status !== 'DONE' && !!t.due_date && t.due_date < today : dueBucket(t, today) === c.due))
    && (!c.done || (c.done === 'open' ? t.status !== 'DONE' : c.done === 'done' ? t.status === 'DONE' : t.status === 'DONE' && !!t.completed_at && new Date(t.completed_at).toLocaleDateString('en-CA').slice(0, 7) === month))
    && (!c.milestone || (c.milestone === 'none' ? !t.milestone_id : t.milestone_id === c.milestone))
    && (!c.level || (c.level === 'top' ? !t.parent_id : !!t.parent_id));
}

export function ListView({ ws }: { ws: WS }) {
  const { p } = ws; const me = useMe(); const team = useTeam(); const toast = useToast(); const ask = useConfirm(); const { search } = useRouter();
  const views = useLoad<any[]>(() => api.get(`/api/projects/${p.id}/views`), [p.id]);
  const [viewId, setViewId] = useState('all');
  const saved0 = useMemo(() => { try { return JSON.parse(localStorage.getItem(storeKey(p.id)) ?? '{}'); } catch { return {}; } }, [p.id]);
  const [c, setC] = useState<Config>(() => ({ ...DEFAULT, ...(saved0.config ?? {}), labels: saved0.config?.labels ?? [] }));
  const [size, setSize] = useState<number>(saved0.size ?? 50); const [dense, setDense] = useState<boolean>(saved0.dense ?? true);
  useEffect(() => { try { localStorage.setItem(storeKey(p.id), JSON.stringify({ config: c, size, dense })); } catch { /* private mode */ } }, [c, size, dense, p.id]);
  useEffect(() => { const l = search.get('label'); if (l) { setC((x) => ({ ...DEFAULT, cols: x.cols, widths: x.widths, labels: [l] })); setViewId(''); } }, [search]);
  const [sel, setSel] = useState<Set<string>>(new Set()); const [page, setPage] = useState(0); const [closed, setClosed] = useState<Set<string>>(new Set());
  const [term, setTerm] = useState(c.q);
  useEffect(() => { const t = setTimeout(() => { if (term !== c.q) { setC((x) => ({ ...x, q: term })); setPage(0); } }, 180); return () => clearTimeout(t); }, [term]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (x: Partial<Config>) => { setC({ ...c, ...x }); setPage(0); setViewId((v) => (BUILT_IN.some((b) => b.id === v) ? '' : v)); };
  const byId = useMemo(() => new Map(p.task_list.map((t) => [t.id, t])), [p.task_list]);
  const labels = useMemo(() => [...new Set(p.task_list.flatMap((t) => t.labels))].sort(), [p.task_list]);
  const today = localToday();
  const rows = useMemo(() => {
    const val = (t: Task, k: string): string | number => k === 'title' ? t.title.toLowerCase() : k === 'status' ? STATUS_ORDER.indexOf(t.status as any) : k === 'priority' ? PRIORITY_RANK[t.priority] ?? 9 : k === 'assignee' ? (t.assignee_name ?? '~').toLowerCase() : k === 'due' ? (t.due_date ?? '9999') : k === 'start' ? (t.start_date ?? '9999') : k === 'created' ? t.created_at : k === 'updated' ? t.updated_at : k === 'estimate' ? Number(t.estimate_hours ?? 1e9) : k === 'actual' ? Number(t.actual_hours ?? 1e9) : k === 'subtasks' ? t.subtasks : 0;
    const sorts = c.sort.length ? c.sort : [{ key: 'status', dir: 1 as const }, { key: 'priority', dir: 1 as const }];
    return p.task_list.filter((t) => matches(t, c, today)).sort((a, b) => { for (const s of sorts) { const x = val(a, s.key); const y = val(b, s.key); if (x < y) return -s.dir; if (x > y) return s.dir; } return a.position - b.position; });
  }, [p.task_list, c, today]);
  const counts = useMemo(() => Object.fromEntries(BUILT_IN.map((v) => [v.id, p.task_list.filter((t) => matches(t, { ...DEFAULT, ...v.config(me.id) }, today)).length])), [p.task_list, me.id, today]);
  const pages = Math.max(1, Math.ceil(rows.length / size)); const cur = Math.min(page, pages - 1);
  const pageList = useMemo(() => rows.slice(cur * size, cur * size + size), [rows, cur, size]); const pageIds = new Set(pageList.map((t) => t.id));
  const groups = useMemo((): [string, string, Task[]][] => {
    if (!c.group) return [['', '', pageList]];
    const m = new Map<string, [string, Task[]]>();
    const ms = (id: string | null) => p.milestones.find((x) => x.id === id);
    const keyOf = (t: Task): [string, string][] => c.group === 'label' ? (t.labels.length ? t.labels.map((l) => [l, l] as [string, string]) : [['~', 'No label']])
      : c.group === 'status' ? [[String(STATUS_ORDER.indexOf(t.status as any)), TASK_STATUS[t.status]!]] : c.group === 'priority' ? [[String(PRIORITY_RANK[t.priority]), PRIORITY[t.priority]!]]
      : c.group === 'assignee' ? [[t.assignee_name ? 'a' + t.assignee_name : '~', t.assignee_name ?? 'Unassigned']]
      : c.group === 'due' ? [[String(['overdue', 'today', 'week', 'later', 'none'].indexOf(dueBucket(t, today))), DUE[dueBucket(t, today)]!]]
      : [[t.milestone_id ? 'm' + (ms(t.milestone_id)?.target_date ?? '') + t.milestone_id : '~', ms(t.milestone_id)?.name ?? 'No milestone']];
    for (const t of pageList) for (const [k, l] of keyOf(t)) { const e = m.get(k) ?? [l, []]; e[1].push(t); m.set(k, e); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, [l, list]]) => [k, l, list]);
  }, [pageList, c.group, today, p.milestones]);
  useEffect(() => { setSel((s) => new Set([...s].filter((id) => byId.has(id)))); }, [byId]);

  // ---------- views ----------
  const applyView = (id: string, config: any) => { setViewId(id); setC({ ...DEFAULT, cols: c.cols, widths: c.widths, ...config, labels: config.labels ?? (config.label ? [config.label] : []) }); setTerm(config.q ?? ''); setPage(0); };
  const saveView = async () => {
    const name = await ask({ title: 'Save this view', body: 'The filters, grouping, sorting and columns are kept under this name. It shows the same tasks, never copies.', input: { label: 'Name', placeholder: 'Design work', required: true, max: 60 }, confirm: 'Save view' });
    if (typeof name !== 'string' || !name.trim()) return;
    const shared = await ask({ title: 'Share it with the team?', body: 'A shared view appears for everyone on this project. Otherwise it is only yours.', confirm: 'Share it', cancel: 'Just for me' });
    try { const v = await api.post(`/api/projects/${p.id}/views`, { name: name.trim(), config: c, shared: !!shared }); views.reload(true); setViewId(v.id); toast('View saved.'); } catch (e: any) { toast(e.message, { err: true }); }
  };
  const viewAct = async (v: any, act: 'update' | 'rename' | 'duplicate' | 'delete') => {
    try {
      if (act === 'update') { await api.patch(`/api/views/${v.id}`, { config: c }); toast(`“${v.name}” now uses these settings.`); }
      if (act === 'rename') { const n = await ask({ title: 'Rename view', input: { label: 'Name', required: true, value: v.name, max: 60 }, confirm: 'Rename' }); if (typeof n !== 'string' || !n || n === v.name) return; await api.patch(`/api/views/${v.id}`, { name: n }); toast('View renamed.'); }
      if (act === 'duplicate') { const d = await api.post(`/api/projects/${p.id}/views`, { name: `${v.name} (copy)`.slice(0, 60), config: v.config, shared: false }); setViewId(d.id); toast('Copy saved as your own view.'); }
      if (act === 'delete') { if (!(await ask({ title: `Delete the view “${v.name}”?`, body: 'Only the view goes. The tasks stay.', confirm: 'Delete view', tone: 'danger' }))) return; await api.del(`/api/views/${v.id}`); setViewId('all'); toast('View deleted.'); }
      views.reload(true);
    } catch (e: any) { toast(e.message, { err: true }); }
  };

  // ---------- edits ----------
  const patch = async (t: Task, b: Record<string, unknown>) => { const prev = p; ws.setP({ ...p, task_list: p.task_list.map((x) => (x.id === t.id ? { ...x, ...b } : x)) }); try { await api.patch(`/api/tasks/${t.id}`, b); ws.reload(); } catch (e: any) { ws.setP(prev); toast(e.message, { err: true }); } };
  const bulk = async (action: string, setB?: object, msg?: string) => {
    const ids = [...sel]; if (!ids.length) return;
    if (action === 'delete' && !(await ask({ title: `Delete ${ids.length} ${ids.length === 1 ? 'task' : 'tasks'}?`, body: 'Their comments and subtasks go with them. This cannot be undone. Archive keeps them.', confirm: 'Delete', tone: 'danger' }))) return;
    try { const r = await api.post(`/api/projects/${p.id}/tasks/bulk`, { ids, action, set: setB }); toast(msg ?? `${r.done} ${r.done === 1 ? 'task' : 'tasks'} ${action === 'delete' ? 'deleted' : action === 'archive' ? 'archived' : 'updated'}.`); setSel(new Set()); ws.reload(); }
    catch (e: any) { toast(`Nothing was changed. ${e.message}`, { err: true }); }
  };
  const rowAct = async (t: Task, act: string) => {
    try {
      if (act === 'duplicate') { const d = await api.post(`/api/tasks/${t.id}/duplicate`, {}); ws.reload(); toast('Task duplicated.'); ws.openTask(d.id); }
      if (act === 'subtask') ws.addTask({ parent_id: t.id, column_id: t.column_id, milestone_id: t.milestone_id });
      if (act === 'link') { await navigator.clipboard.writeText(`${location.origin}/projects/${p.id}/list?task=${t.id}`); toast('Link copied.'); }
      if (act === 'archive') { await api.patch(`/api/tasks/${t.id}`, { archived: true }); ws.reload(); toast('Task archived. It stays in the history.'); }
      if (act === 'delete') { if (!(await ask({ title: `Delete “${t.title}”?`, body: `Its comments${t.subtasks ? ' and subtasks' : ''} go with it. This cannot be undone. Archive keeps it.`, confirm: 'Delete task', tone: 'danger' }))) return; await api.del(`/api/tasks/${t.id}`); ws.reload(); toast('Task deleted.'); }
    } catch (e: any) { toast(e.message, { err: true }); }
  };
  const csv = () => {
    const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const head = ['Task', ...c.cols.map((k) => COLS[k])];
    const text = [head.map(esc).join(','), ...rows.map((t) => [t.title, ...c.cols.map((k) => plain(k, t, team, byId, p.milestones))].map(esc).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })); a.download = `${p.name.replace(/[^\w-]+/g, '-')}-tasks.csv`; a.click(); URL.revokeObjectURL(a.href);
    toast(`Exported ${rows.length} ${rows.length === 1 ? 'task' : 'tasks'}.`);
  };
  const sortBy = (k: string, add: boolean) => { const cs = c.sort.find((s) => s.key === k); const next: SortKey = { key: k, dir: cs?.dir === 1 ? -1 : 1 }; set({ sort: add ? [...c.sort.filter((s) => s.key !== k), next] : cs?.dir === -1 ? [] : [next] }); };
  const more = [c.labels.length, c.done, c.milestone, c.level].filter(Boolean).length;
  const nFilters = [c.status.length, c.priority.length, c.assignee.length, c.due, more].filter(Boolean).length;
  const multi = (k: 'status' | 'priority' | 'assignee' | 'labels', v: string) => set({ [k]: c[k].includes(v) ? c[k].filter((x) => x !== v) : [...c[k], v] } as Partial<Config>);
  const clearAll = () => { setC({ ...c, q: '', status: [], priority: [], assignee: [], labels: [], due: '', done: '', milestone: '', level: '' }); setTerm(''); setPage(0); setViewId('all'); };
  const savedList = views.data ?? []; const savedCur = savedList.find((v) => v.id === viewId);
  const allOnPage = pageList.length > 0 && pageList.every((t) => sel.has(t.id));
  const open = search.get('task');
  const nCols = c.cols.length + 3;
  return (
    <div className={`lv${dense ? ' dense' : ''}`}>
      <div className="lv-views" role="group" aria-label="Views">
        {BUILT_IN.map((v) => <button key={v.id} type="button" aria-pressed={viewId === v.id} className={viewId === v.id ? 'on' : ''} onClick={() => applyView(v.id, v.config(me.id))}>{v.name}<span className="n">{counts[v.id]}</span></button>)}
        {savedList.map((v) => <button key={v.id} type="button" aria-pressed={viewId === v.id} className={viewId === v.id ? 'on' : ''} onClick={() => applyView(v.id, v.config)} title={v.user_id ? 'Only you see this view' : 'Shared with everyone on the project'}>{v.user_id ? <Icon.user size={12} /> : <Icon.people size={12} />}{v.name}</button>)}
        <button type="button" className="lv-save" onClick={saveView}><Icon.plus size={13} />Save view</button>
        {savedCur && <Menu label={`View ${savedCur.name}`} className="icon-btn" button={<Dots vertical size={14} />} place="left">{(close) => <>
          <MenuItem onSelect={() => { close(); viewAct(savedCur, 'update'); }}><Icon.check size={15} />Update with current settings</MenuItem>
          <MenuItem onSelect={() => { close(); viewAct(savedCur, 'rename'); }}><Icon.edit size={15} />Rename</MenuItem>
          <MenuItem onSelect={() => { close(); viewAct(savedCur, 'duplicate'); }}><Icon.copy size={15} />Duplicate</MenuItem>
          <div className="menu-sep" /><MenuItem onSelect={() => { close(); viewAct(savedCur, 'delete'); }}><Icon.trash size={15} />Delete view</MenuItem></>}</Menu>}
      </div>

      <div className="lv-tools">
        <label className="tb-search"><Icon.find size={15} /><input placeholder="Search tasks..." value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search tasks" /></label>
        <Pick label="Status" n={c.status.length}>{STATUS_ORDER.map((s) => <label key={s} className="chk"><input type="checkbox" className="check" checked={c.status.includes(s)} onChange={() => multi('status', s)} /><StatusDot s={s} />{TASK_STATUS[s]}</label>)}</Pick>
        <Pick label="Priority" n={c.priority.length}>{Object.entries(PRIORITY).map(([k, v]) => <label key={k} className="chk"><input type="checkbox" className="check" checked={c.priority.includes(k)} onChange={() => multi('priority', k)} /><i className="pdot" style={{ background: PRIO_COLOR[k] }} />{v}</label>)}</Pick>
        <Pick label="Assignee" n={c.assignee.length}><PeopleFilter team={team} chosen={c.assignee} toggle={(id) => multi('assignee', id)} /></Pick>
        <Pick label="Due date" n={c.due ? 1 : 0}>{[['', 'Any date'], ...Object.entries(DUE)].map(([k, v]) => <label key={k} className="chk"><input type="radio" name="lv-due" checked={c.due === k} onChange={() => set({ due: k })} />{v}</label>)}</Pick>
        <Menu label="More filters" className={`btn tiny lv-more${more ? ' on' : ''}`} kind="dialog" button={<>More filters{more ? <span className="n hot">{more}</span> : null}</>}>{() => <div className="filter-pop wide">
          <div className="field"><span>Labels</span>{labels.length ? <div className="lv-lblpick">{labels.map((l) => <label key={l} className={`lbl sm hued${c.labels.includes(l) ? ' on' : ''}`} style={{ '--l-h': hue(l) } as React.CSSProperties}><input type="checkbox" className="sr" checked={c.labels.includes(l)} onChange={() => multi('labels', l)} />{l}</label>)}</div> : <small className="faint">No labels on this project yet.</small>}</div>
          <label className="field"><span>Done</span><select value={c.done} onChange={(e) => set({ done: e.target.value })}><option value="">Open and done</option><option value="open">Open only</option><option value="done">Done only</option><option value="month">Done this month</option></select></label>
          {p.milestones.length > 0 && <label className="field"><span>Milestone</span><select value={c.milestone} onChange={(e) => set({ milestone: e.target.value })}><option value="">Any</option>{p.milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}<option value="none">No milestone</option></select></label>}
          <label className="field"><span>Tasks and subtasks</span><select value={c.level} onChange={(e) => set({ level: e.target.value })}><option value="">Both</option><option value="top">Top-level tasks only</option><option value="sub">Subtasks only</option></select></label></div>}</Menu>
        {(nFilters > 0 || c.q) && <button type="button" className="btn tiny ghost" onClick={clearAll}>Clear all</button>}
        <span className="lv-gap" />
        <label className="tb-group"><span>Group</span><select value={c.group} onChange={(e) => { set({ group: e.target.value }); setClosed(new Set()); }} aria-label="Group by"><option value="">None</option>{Object.entries(GROUPS).filter(([k]) => k !== 'milestone' || p.milestones.length).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <Menu label="Columns" className="btn tiny" kind="dialog" place="left" button={<>Columns</>}>{() => <ColumnPicker c={c} set={set} dense={dense} setDense={setDense} />}</Menu>
        <button type="button" className="btn tiny" onClick={csv} disabled={!rows.length} title="Every task that matches the filters, not only this page">Export CSV</button>
        <button type="button" className="btn tiny primary" onClick={() => ws.addTask(c.status.length === 1 ? { column_id: p.columns.find((x) => x.status === c.status[0])?.id } : {})}><Icon.plus size={14} />Add task</button>
      </div>

      {sel.size > 0 && <div className="bulkbar" role="region" aria-label="Selected tasks"><b>{sel.size} selected</b>
        <select aria-label="Move to column" value="" onChange={(e) => e.target.value && bulk('update', { column_id: e.target.value })}><option value="">Status…</option>{p.columns.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select aria-label="Set priority" value="" onChange={(e) => e.target.value && bulk('update', { priority: e.target.value })}><option value="">Priority…</option>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select aria-label="Set assignee" value="" onChange={(e) => e.target.value && bulk('update', { assignee_id: e.target.value === 'none' ? null : e.target.value })}><option value="">Assign…</option><option value="none">Unassigned</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <label className="bb-date"><span>Due</span><input type="date" aria-label="Set the due date of the selected tasks" onChange={(e) => e.target.value && bulk('update', { due_date: e.target.value })} /></label>
        <button type="button" className="btn tiny ghost" onClick={() => bulk('update', { due_date: null }, 'Due dates cleared.')}>Clear due</button>
        {p.milestones.length > 0 && <select aria-label="Move to milestone" value="" onChange={(e) => e.target.value && bulk('update', { milestone_id: e.target.value === 'none' ? null : e.target.value })}><option value="">Milestone…</option><option value="none">No milestone</option>{p.milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
        <form onSubmit={(e) => { e.preventDefault(); const i = (e.currentTarget.elements.namedItem('l') as HTMLInputElement); if (i.value.trim()) { bulk('update', { add_labels: [i.value.trim()] }); i.value = ''; } }}><input name="l" placeholder="Add label" aria-label="Add a label to the selected tasks" maxLength={30} list="lv-labels" /></form>
        {labels.length > 0 && <select aria-label="Remove a label from the selected tasks" value="" onChange={(e) => e.target.value && bulk('update', { remove_labels: [e.target.value] })}><option value="">Remove label…</option>{labels.map((l) => <option key={l} value={l}>{l}</option>)}</select>}
        <datalist id="lv-labels">{labels.map((l) => <option key={l} value={l} />)}</datalist>
        <button type="button" className="btn tiny" onClick={() => bulk('archive')}><Icon.archive size={13} />Archive</button>
        <button type="button" className="btn tiny danger" onClick={() => bulk('delete')}><Icon.trash size={13} />Delete</button>
        <button type="button" className="btn tiny ghost" style={{ marginLeft: 'auto' }} onClick={() => setSel(new Set())}>Clear selection</button></div>}

      {!rows.length ? <div className="panel lv-empty"><Empty title={p.task_list.length ? 'No task matches' : 'No tasks yet'} action={p.task_list.length ? <button className="btn" onClick={clearAll}>Show all tasks</button> : <button className="btn primary" onClick={() => ws.addTask()}><Icon.plus size={14} />Add the first task</button>}>{p.task_list.length ? 'Nothing fits these filters and this search. Clear them to see every task.' : 'Tasks added here show on the board, the timeline and everyone’s lists.'}</Empty></div> :
      <div className="panel lv-table">
        <div className="scrollx"><table className="ctable ltable" aria-label="Tasks">
          <thead><tr><th className="lt-check"><input type="checkbox" className="check" aria-label="Select every task on this page" checked={allOnPage} onChange={(e) => setSel(e.target.checked ? new Set([...sel, ...pageIds]) : new Set([...sel].filter((x) => !pageIds.has(x))))} /></th>
            <Th k="title" label="Task" c={c} sortBy={sortBy} set={set} />{c.cols.map((k) => <Th key={k} k={k} label={COLS[k]!} c={c} sortBy={sortBy} set={set} />)}<th className="lt-act"><span className="sr">Actions</span></th></tr></thead>
          {groups.map(([gk, g, list]) => <tbody key={gk || 'all'}>
            {g && <tr className="grp"><th colSpan={nCols} scope="rowgroup"><button type="button" className="grp-tog" aria-expanded={!closed.has(gk)} onClick={() => setClosed((s) => { const n = new Set(s); n.has(gk) ? n.delete(gk) : n.add(gk); return n; })}>
              <span className={`chev${closed.has(gk) ? '' : ' open'}`} aria-hidden="true"><Icon.right size={12} /></span>{c.group === 'status' && <StatusDot s={STATUS_ORDER[Number(gk)]!} />}{g}<span className="n">{list.length}</span></button></th></tr>}
            {!closed.has(gk) && list.map((t) => { const late = t.status !== 'DONE' && !!t.due_date && t.due_date < today; return (
              <tr key={t.id} className={`${sel.has(t.id) ? 'sel' : ''}${open === t.id ? ' cur' : ''}${t.status === 'DONE' ? ' isdone' : ''}`}>
                <td className="lt-check"><input type="checkbox" className="check" aria-label={`Select ${t.title}`} checked={sel.has(t.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })} /></td>
                <td className="lt-title" style={c.widths.title ? { maxWidth: c.widths.title } : undefined}><button type="button" className="link-btn" onClick={() => ws.openTask(t.id)} title={t.title}>{t.parent_id && <span className="lt-sub" aria-label="Subtask">↳</span>}<span className="lt-t">{t.title}</span></button>{t.blocked && <span className="chip-blocked"><Icon.lock size={10} />Blocked</span>}</td>
                {c.cols.map((k) => <td key={k} className={`lc-${k}${k === 'due' && late ? ' late' : ''}`}><Cell k={k} t={t} ws={ws} team={team} byId={byId} patch={patch} late={late} labels={labels} /></td>)}
                <td className="lt-act">{t.status === 'DONE' && <span className="lt-done" title="Done"><Icon.check size={12} /></span>}
                  <Menu label={`Actions for ${t.title}`} className="icon-btn" button={<Dots size={16} />} place="left">{(close) => <>
                    <MenuItem onSelect={() => { close(); ws.openTask(t.id); }}><Icon.arrow size={15} />Open details</MenuItem>
                    <MenuItem onSelect={() => { close(); ws.openTask(t.id, 'full'); }}><Icon.edit size={15} />Edit in full view</MenuItem>
                    <MenuItem onSelect={() => { close(); rowAct(t, 'duplicate'); }}><Icon.copy size={15} />Duplicate</MenuItem>
                    <MenuItem onSelect={() => { close(); rowAct(t, 'subtask'); }}><Icon.plus size={15} />Create subtask</MenuItem>
                    <MenuItem onSelect={() => { close(); rowAct(t, 'link'); }}><Icon.link size={15} />Copy task link</MenuItem>
                    <div className="menu-sep" />
                    <MenuItem onSelect={() => { close(); rowAct(t, 'archive'); }}><Icon.archive size={15} />Archive</MenuItem>
                    <MenuItem onSelect={() => { close(); rowAct(t, 'delete'); }}><Icon.trash size={15} /><span className="danger-text">Delete</span></MenuItem></>}</Menu></td>
              </tr>); })}</tbody>)}
        </table></div>
        <Pager total={rows.length} page={cur} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(0); }} />
      </div>}
    </div>
  );
}

function Pick({ label, n, children }: { label: string; n: number; children: React.ReactNode }) {
  return <Menu label={label} className={`btn tiny${n ? ' on' : ''}`} kind="dialog" button={<>{label}{n ? <span className="n">{n}</span> : null}<Icon.down size={12} /></>}>{() => <div className="filter-pop">{children}</div>}</Menu>;
}
function PeopleFilter({ team, chosen, toggle }: { team: any[]; chosen: string[]; toggle: (id: string) => void }) {
  const [q, setQ] = useState('');
  const list = [...team.map((u) => [u.id, u.name] as [string, string]), ['none', 'Unassigned'] as [string, string]].filter(([, n]) => n.toLowerCase().includes(q.toLowerCase()));
  return <><input className="input sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find someone" aria-label="Find someone" />
    {list.map(([id, n]) => <label key={id} className="chk"><input type="checkbox" className="check" checked={chosen.includes(id)} onChange={() => toggle(id)} />{id !== 'none' && <Avatar name={n} size="xs" />}{n}</label>)}
    {!list.length && <small className="faint">Nobody matches.</small>}</>;
}
function Pager({ total, page, size, onPage, onSize }: { total: number; page: number; size: number; onPage: (p: number) => void; onSize: (s: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const nums = Array.from({ length: pages }, (_, i) => i).filter((i) => i === 0 || i === pages - 1 || Math.abs(i - page) <= 1);
  return <div className="pager lv-pager"><span>Showing {page * size + 1} to {Math.min(total, page * size + size)} of {total} {total === 1 ? 'task' : 'tasks'}</span>
    <nav className="pg-nav" aria-label="Pages"><button type="button" className="icon-btn" disabled={page <= 0} onClick={() => onPage(page - 1)} aria-label="Previous page"><Icon.left size={15} /></button>
      {nums.map((n, i) => <span key={n} style={{ display: 'contents' }}>{i > 0 && n - nums[i - 1]! > 1 && <span className="pg-gap" aria-hidden="true">…</span>}<button type="button" className={`pg-n${n === page ? ' on' : ''}`} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>{n + 1}</button></span>)}
      <button type="button" className="icon-btn" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label="Next page"><Icon.right size={15} /></button></nav>
    <label className="pg-size">Rows per page<select value={size} onChange={(e) => onSize(Number(e.target.value))}>{[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select></label></div>;
}

function Th({ k, label, c, sortBy, set }: { k: string; label: string; c: Config; sortBy: (k: string, add: boolean) => void; set: (x: Partial<Config>) => void }) {
  const s = c.sort.findIndex((x) => x.key === k); const dir = s >= 0 ? c.sort[s]!.dir : 0; const sortable = !['labels', 'collaborators', 'parent', 'deps', 'milestone'].includes(k);
  const start = useRef<{ x: number; w: number } | null>(null);
  const w = c.widths[k];
  return <th style={w ? { width: w, minWidth: w } : undefined} aria-sort={dir ? (dir === 1 ? 'ascending' : 'descending') : undefined} className={k === 'title' ? 'lt-title' : undefined}>
    {sortable ? <button type="button" className="th-sort" onClick={(e) => sortBy(k, e.shiftKey)} title="Click to sort, Shift-click to add a second sort">{label}{dir ? <span aria-hidden="true">{dir === 1 ? ' ↑' : ' ↓'}{c.sort.length > 1 ? s + 1 : ''}</span> : null}</button> : label}
    <span className="th-resize" aria-hidden="true" onPointerDown={(e) => { const th = (e.currentTarget.parentElement as HTMLElement); start.current = { x: e.clientX, w: th.offsetWidth }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { if (start.current) set({ widths: { ...c.widths, [k]: Math.max(70, Math.min(600, start.current.w + e.clientX - start.current.x)) } }); }} onPointerUp={() => { start.current = null; }} /></th>;
}
function ColumnPicker({ c, set, dense, setDense }: { c: Config; set: (x: Partial<Config>) => void; dense: boolean; setDense: (b: boolean) => void }) {
  const move = (k: string, d: -1 | 1) => { const l = [...c.cols]; const i = l.indexOf(k); const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j]!, l[i]!]; set({ cols: l }); };
  const hidden = Object.keys(COLS).filter((k) => !c.cols.includes(k));
  return <div className="filter-pop colpick">
    <p className="menu-note">Rows</p><div className="seg" role="group" aria-label="Row density"><button type="button" aria-pressed={dense} className={dense ? 'on' : ''} onClick={() => setDense(true)}>Compact</button><button type="button" aria-pressed={!dense} className={!dense ? 'on' : ''} onClick={() => setDense(false)}>Comfortable</button></div>
    <p className="menu-note">Shown, in order</p>
    {c.cols.map((k, i) => <div key={k} className="cp-line"><label className="chk"><input type="checkbox" className="check" checked onChange={() => set({ cols: c.cols.filter((x) => x !== k) })} />{COLS[k]}</label>
      <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(k, -1)} aria-label={`Move ${COLS[k]} earlier`}><Icon.left size={13} /></button>
      <button type="button" className="icon-btn" disabled={i === c.cols.length - 1} onClick={() => move(k, 1)} aria-label={`Move ${COLS[k]} later`}><Icon.right size={13} /></button></div>)}
    {hidden.length > 0 && <><p className="menu-note">Hidden</p>{hidden.map((k) => <label key={k} className="chk"><input type="checkbox" className="check" checked={false} onChange={() => set({ cols: [...c.cols, k] })} />{COLS[k]}</label>)}</>}
    <button type="button" className="btn tiny" onClick={() => set({ cols: DEFAULT.cols, widths: {} })}>Back to the default columns</button></div>;
}
// what a cell says as text, for the CSV
function plain(k: string, t: Task, team: any[], byId: Map<string, Task>, milestones: any[]) {
  return k === 'status' ? TASK_STATUS[t.status] : k === 'priority' ? PRIORITY[t.priority] : k === 'assignee' ? t.assignee_name ?? 'Unassigned' : k === 'collaborators' ? t.collaborator_ids.map((id) => team.find((u) => u.id === id)?.name).filter(Boolean).join('; ')
    : k === 'start' ? t.start_date : k === 'due' ? t.due_date : k === 'labels' ? t.labels.join('; ') : k === 'parent' ? (t.parent_id ? byId.get(t.parent_id)?.title : '') : k === 'milestone' ? milestones.find((m) => m.id === t.milestone_id)?.name ?? ''
    : k === 'subtasks' ? `${t.subtasks_done}/${t.subtasks}` : k === 'deps' ? (t.blocked ? 'Blocked' : '') : k === 'estimate' ? t.estimate_hours : k === 'actual' ? t.actual_hours : k === 'created' ? t.created_at.slice(0, 10) : t.updated_at.slice(0, 10);
}

function Cell({ k, t, ws, team, byId, patch, late, labels }: { k: string; t: Task; ws: WS; team: any[]; byId: Map<string, Task>; patch: (t: Task, b: Record<string, unknown>) => void; late: boolean; labels: string[] }) {
  switch (k) {
    case 'status': return <span className="chip-sel st" style={{ '--s': STATUS_COLOR[t.status] } as React.CSSProperties}><i aria-hidden="true" />{TASK_STATUS[t.status]}
      <select value={t.column_id ?? ''} onChange={(e) => patch(t, { column_id: e.target.value, status: ws.p.columns.find((c) => c.id === e.target.value)?.status })} aria-label={`Status of ${t.title}`}>{ws.p.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></span>;
    case 'priority': return <span className="chip-sel pr" style={{ '--s': PRIO_COLOR[t.priority] } as React.CSSProperties}><i aria-hidden="true" />{PRIORITY[t.priority]}
      <select value={t.priority} onChange={(e) => patch(t, { priority: e.target.value })} aria-label={`Priority of ${t.title}`}>{Object.entries(PRIORITY).map(([kk, v]) => <option key={kk} value={kk}>{v}</option>)}</select></span>;
    case 'assignee': return <span className="chip-sel as">{t.assignee_name ? <Avatar name={t.assignee_name} size="xs" /> : <span className="av-un" aria-hidden="true">UN</span>}<span className="as-n">{t.assignee_name ?? 'Unassigned'}</span>
      <select value={t.assignee_id ?? ''} onChange={(e) => patch(t, { assignee_id: e.target.value || null, assignee_name: team.find((u) => u.id === e.target.value)?.name ?? null })} aria-label={`Assignee of ${t.title}`}><option value="">Unassigned</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></span>;
    case 'due': return <DateCell value={t.due_date} late={late} label={`Due date of ${t.title}`} onChange={(v) => patch(t, { due_date: v })} />;
    case 'start': return <DateCell value={t.start_date} late={false} label={`Start date of ${t.title}`} onChange={(v) => patch(t, { start_date: v })} />;
    case 'labels': return <LabelCell t={t} all={labels} onChange={(l) => patch(t, { labels: l })} />;
    case 'collaborators': return <span className="avs">{t.collaborator_ids.map((id) => { const u = team.find((x) => x.id === id); return u ? <Avatar key={id} name={u.name} size="xs" title={u.name} /> : null; })}</span>;
    case 'parent': return t.parent_id ? <button type="button" className="link-btn sub" onClick={() => ws.openTask(t.parent_id!)}>{byId.get(t.parent_id)?.title ?? 'Parent'}</button> : null;
    case 'milestone': return <span className="sub">{ws.p.milestones.find((m) => m.id === t.milestone_id)?.name ?? ''}</span>;
    case 'subtasks': return <button type="button" className={`lt-subs${t.subtasks && t.subtasks_done === t.subtasks ? ' all' : ''}`} onClick={() => ws.openTask(t.id, 'Subtasks')} aria-label={`${t.subtasks_done} of ${t.subtasks} subtasks done. Open the subtasks of ${t.title}`}>{t.subtasks_done}/{t.subtasks}</button>;
    case 'deps': return t.blocked ? <span className="chip-blocked"><Icon.lock size={10} />Waiting</span> : null;
    case 'estimate': return t.estimate_hours ? <>{Number(t.estimate_hours)} h</> : null;
    case 'actual': return t.actual_hours ? <>{Number(t.actual_hours)} h</> : null;
    case 'created': return <span className="sub">{ago(t.created_at)}</span>;
    case 'updated': return <span className="sub">{ago(t.updated_at)}</span>;
    default: return null;
  }
}
// a date that reads as text; a click opens the browser's date picker
function DateCell({ value, late, label, onChange }: { value: string | null; late: boolean; label: string; onChange: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return <span className={`date-cell${late ? ' late' : ''}`}><button type="button" className="dc-show" onClick={() => { try { ref.current?.showPicker(); } catch { ref.current?.focus(); } }} aria-label={`${label}: ${value ? fmt(value) : 'not set'}. Change`}>{value ? fmt(value) : <span className="faint">Set date</span>}</button>
    <input ref={ref} type="date" tabIndex={-1} aria-hidden="true" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />
    {value && <button type="button" className="dc-x" onClick={() => onChange(null)} aria-label={`Clear ${label.toLowerCase()}`}><Icon.x size={11} /></button>}</span>;
}
function LabelCell({ t, all, onChange }: { t: Task; all: string[]; onChange: (l: string[]) => void }) {
  const [v, setV] = useState('');
  const add = (l: string) => { const x = l.trim().slice(0, 30); if (x && !t.labels.includes(x)) onChange([...t.labels, x]); setV(''); };
  return <span className="lt-labels">{t.labels.map((l) => <span key={l} className="lbl sm hued" style={{ '--l-h': hue(l) } as React.CSSProperties}>{l}</span>)}
    <Menu label={`Labels of ${t.title}`} className="icon-btn lt-addlbl" kind="dialog" place="left" button={<Icon.plus size={12} />}>{() => <div className="filter-pop">
      {[...new Set([...all, ...t.labels])].map((l) => <label key={l} className="chk"><input type="checkbox" className="check" checked={t.labels.includes(l)} onChange={() => onChange(t.labels.includes(l) ? t.labels.filter((x) => x !== l) : [...t.labels, l])} /><span className="lbl sm hued" style={{ '--l-h': hue(l) } as React.CSSProperties}>{l}</span></label>)}
      <form onSubmit={(e) => { e.preventDefault(); add(v); }}><input className="input sm" value={v} onChange={(e) => setV(e.target.value)} placeholder="New label, then Enter" aria-label="New label" maxLength={30} /></form></div>}</Menu></span>;
}
