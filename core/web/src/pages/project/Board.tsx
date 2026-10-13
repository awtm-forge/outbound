import { useMemo, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { Icon, Dots } from '../../ui/icons.tsx';
import { Menu, MenuItem } from '../../ui/menu.tsx';
import { Modal } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Spinner, isLate, todayIST } from '../../ui/kit.tsx';
import { useTeam } from '../../session.tsx';
import { Avatar, PRIORITY, PRIORITY_RANK, STATUS_COLOR, TASK_STATUS, StatusDot, shortDay, type Column, type Task } from './shared.tsx';
import type { WS } from './Workspace.tsx';

type Sort = 'manual' | 'priority' | 'due';
const PREF = 'awtm-board-prefs';
const readPrefs = () => { try { return JSON.parse(localStorage.getItem(PREF) ?? '{}'); } catch { return {}; } };

// The board: columns of the project, cards in their saved order. Drag a card, or focus it and use Alt with the arrow
// keys (or its menu) to move it; every move is saved and undone on screen if the server refuses it.
export function Board({ ws }: { ws: WS }) {
  const { p } = ws; const toast = useToast(); const team = useTeam();
  const [prefs, setPrefsState] = useState<{ compact?: boolean; sort?: Sort }>(readPrefs);
  const setPrefs = (x: object) => { const n = { ...prefs, ...x }; setPrefsState(n); try { localStorage.setItem(PREF, JSON.stringify(n)); } catch { /* private mode */ } };
  const [q, setQ] = useState(''); const [who, setWho] = useState(''); const [prio, setPrio] = useState(''); const [label, setLabel] = useState('');
  const [drag, setDrag] = useState<string | null>(null); const [drop, setDrop] = useState<{ col: string; index: number } | null>(null);
  const [say, setSay] = useState(''); const [addCol, setAddCol] = useState(false);
  const sort: Sort = prefs.sort ?? 'manual';
  const cols = p.columns;
  const colOf = (t: Task) => t.column_id && cols.some((c) => c.id === t.column_id) ? t.column_id : cols.find((c) => c.status === t.status)?.id ?? cols[0]?.id;
  const labels = useMemo(() => [...new Set(p.task_list.flatMap((t) => t.labels))].sort(), [p.task_list]);
  const visible = (t: Task) => !t.parent_id && (!q || t.title.toLowerCase().includes(q.toLowerCase())) && (!who || (who === 'none' ? !t.assignee_id : t.assignee_id === who)) && (!prio || t.priority === prio) && (!label || t.labels.includes(label));
  const order = (a: Task, b: Task) => sort === 'priority' ? PRIORITY_RANK[a.priority]! - PRIORITY_RANK[b.priority]! || a.position - b.position
    : sort === 'due' ? String(a.due_date ?? '9999').localeCompare(String(b.due_date ?? '9999')) || a.position - b.position : a.position - b.position;
  const inCol = (cid: string) => p.task_list.filter((t) => colOf(t) === cid).sort(order);
  const filtering = !!(q || who || prio || label);

  // a place between two neighbours; the server keeps the number
  const move = async (taskId: string, colId: string, index: number) => {
    const t = p.task_list.find((x) => x.id === taskId); const col = cols.find((c) => c.id === colId); if (!t || !col) return;
    const list = inCol(colId).filter((x) => x.id !== taskId); const before = list[index - 1]; const after = list[index];
    const position = before && after ? (before.position + after.position) / 2 : before ? before.position + 1 : after ? after.position - 1 : 1;
    if (t.column_id === colId && Math.abs(t.position - position) < 1e-9) return;
    const prev = p; ws.setP({ ...p, task_list: p.task_list.map((x) => (x.id === taskId ? { ...x, column_id: colId, status: col.status, position } : x)) });
    if (col.wip_limit && colOf(t) !== colId && inCol(colId).length >= col.wip_limit) toast(`${col.name} is over its limit of ${col.wip_limit}.`);
    try { await api.patch(`/api/tasks/${taskId}`, { column_id: colId, position }); setSay(`${t.title} moved to ${col.name}, position ${index + 1}.`); ws.reload(); }
    catch (e: any) { ws.setP(prev); toast(e.message, { err: true }); }
  };
  const keyMove = (e: React.KeyboardEvent, t: Task) => {
    if (!e.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault(); const ci = cols.findIndex((c) => c.id === colOf(t)); const list = inCol(cols[ci]!.id); const i = list.findIndex((x) => x.id === t.id);
    if (e.key === 'ArrowLeft' && ci > 0) move(t.id, cols[ci - 1]!.id, inCol(cols[ci - 1]!.id).length);
    if (e.key === 'ArrowRight' && ci < cols.length - 1) move(t.id, cols[ci + 1]!.id, inCol(cols[ci + 1]!.id).length);
    if (e.key === 'ArrowUp' && i > 0 && sort === 'manual') move(t.id, cols[ci]!.id, i - 1);
    if (e.key === 'ArrowDown' && i < list.length - 1 && sort === 'manual') move(t.id, cols[ci]!.id, i + 2);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-task="${t.id}"]`)?.focus());
  };
  const overCard = (e: React.DragEvent, colId: string) => {
    e.preventDefault(); const cards = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-task]')].filter((c) => c.dataset.task !== drag);
    const index = cards.findIndex((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    setDrop({ col: colId, index: index < 0 ? cards.length : index });
  };
  return (
    <div className="board2-wrap">
      <div className="bd-tools">
        <label className="tb-search grow"><Icon.find size={15} /><input placeholder="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tasks" /></label>
        <Menu label="Filters" className="btn tiny" button={<><Icon.funnel size={14} />Filters{[who, prio, label].filter(Boolean).length ? <span className="n">{[who, prio, label].filter(Boolean).length}</span> : null}</>} kind="dialog" place="left">{() =>
          <div className="filter-pop">
            <label className="field"><span>Assignee</span><select value={who} onChange={(e) => setWho(e.target.value)}><option value="">Anyone</option><option value="none">Nobody</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
            <label className="field"><span>Priority</span><select value={prio} onChange={(e) => setPrio(e.target.value)}><option value="">Any</option>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field"><span>Label</span><select value={label} onChange={(e) => setLabel(e.target.value)}><option value="">Any</option>{labels.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
            <button type="button" className="btn tiny" onClick={() => { setWho(''); setPrio(''); setLabel(''); }}>Clear filters</button></div>}</Menu>
        <Menu label="Sort" className="btn tiny" button={<><Icon.sort size={14} />Sort</>} place="left">{(close) => <>
          {([['manual', 'Board order'], ['priority', 'Priority'], ['due', 'Due date']] as const).map(([k, l]) => <MenuItem key={k} onSelect={() => { setPrefs({ sort: k }); close(); }}><span className="mcheck" aria-hidden="true">{sort === k ? <Icon.check size={13} /> : null}</span>{l}</MenuItem>)}
          {sort !== 'manual' && <p className="menu-note">Drag to reorder works in board order.</p>}</>}</Menu>
        <div className="seg layout-seg" role="group" aria-label="Card size">
          <button type="button" aria-pressed={!prefs.compact} onClick={() => setPrefs({ compact: false })} aria-label="Detailed cards"><Icon.grid size={15} /></button>
          <button type="button" aria-pressed={!!prefs.compact} onClick={() => setPrefs({ compact: true })} aria-label="Compact cards"><Icon.list size={15} /></button></div>
        <button type="button" className="btn tiny" onClick={() => setAddCol(true)}><Icon.plus size={14} />Add column</button>
      </div>
      <p className="sr" aria-live="polite">{say}</p>
      <p className="bd-hint faint">Drag cards, or focus one and press Alt with the arrow keys to move it.{filtering ? ' Some cards are hidden by filters.' : ''}</p>
      <div className={`board2${prefs.compact ? ' compact' : ''}`}>{cols.map((col, ci) => { const list = inCol(col.id); const shown = list.filter(visible); const over = col.wip_limit != null && list.length > col.wip_limit; return (
        <section key={col.id} className={`bcol${drop?.col === col.id ? ' over' : ''}`} style={{ '--sc': STATUS_COLOR[col.status] } as React.CSSProperties} aria-labelledby={`col-${col.id}`}
          onDragOver={(e) => overCard(e, col.id)} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null); }}
          onDrop={(e) => { e.preventDefault(); const tid = e.dataTransfer.getData('text/plain'); const at = drop?.index ?? list.length; setDrop(null); setDrag(null); if (tid) move(tid, col.id, sort === 'manual' ? at : list.length); }}>
          <header className="bcol-head"><StatusDot s={col.status} /><h3 id={`col-${col.id}`}>{col.name}</h3>
            <span className={`bcount${over ? ' over' : ''}`} title={col.wip_limit ? `Limit ${col.wip_limit}` : undefined}>{list.length}{col.wip_limit ? `/${col.wip_limit}` : ''}</span>
            <button type="button" className="icon-btn" onClick={() => ws.addTask({ column_id: col.id })} aria-label={`Add a task to ${col.name}`}><Icon.plus size={16} /></button>
            <ColumnMenu ws={ws} col={col} index={ci} /></header>
          <ol className="bcards">{shown.map((t, i) => <li key={t.id}>
            {drop?.col === col.id && drop.index === i && drag && <div className="drop-line" aria-hidden="true" />}
            <Card t={t} compact={!!prefs.compact} dragging={drag === t.id} onOpen={() => ws.openTask(t.id)} onKey={(e) => keyMove(e, t)}
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; setDrag(t.id); }} onDragEnd={() => { setDrag(null); setDrop(null); }}
              moveMenu={(close) => <>{cols.filter((c) => c.id !== col.id).map((c) => <MenuItem key={c.id} onSelect={() => { close(); move(t.id, c.id, inCol(c.id).length); }}><StatusDot s={c.status} />Move to {c.name}</MenuItem>)}
                {sort === 'manual' && i > 0 && <MenuItem onSelect={() => { close(); move(t.id, col.id, i - 1); }}><Icon.left size={15} />Move up</MenuItem>}
                {sort === 'manual' && i < shown.length - 1 && <MenuItem onSelect={() => { close(); move(t.id, col.id, i + 2); }}><Icon.right size={15} />Move down</MenuItem>}</>} /></li>)}
            {drop?.col === col.id && drop.index >= shown.length && drag && <li><div className="drop-line" aria-hidden="true" /></li>}</ol>
          {!list.length && <div className={`bempty s-${col.status}`}><span>{col.status === 'DONE' ? <Icon.check size={18} /> : <Icon.more size={18} />}</span><b>{col.status === 'REVIEW' ? 'Ready for review' : col.status === 'DONE' ? 'Nothing done yet' : 'Nothing here'}</b><p>{col.status === 'REVIEW' ? 'Move a task here when it is ready for feedback.' : 'Drag a task here or add one.'}</p></div>}
          {list.length > 0 && !shown.length && <p className="bempty-f">Every task here is hidden by the filters.</p>}
          <QuickAdd ws={ws} col={col} />
        </section>); })}</div>
      {addCol && <ColumnForm ws={ws} onClose={() => setAddCol(false)} />}
    </div>
  );
}

function Card({ t, compact, dragging, onOpen, onKey, onDragStart, onDragEnd, moveMenu }: {
  t: Task; compact: boolean; dragging: boolean; onOpen: () => void; onKey: (e: React.KeyboardEvent) => void; onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void; moveMenu: (close: () => void) => React.ReactNode;
}) {
  const late = t.status !== 'DONE' && isLate(t.due_date); const today = t.due_date === todayIST();
  return (
    <article className={`bcard${dragging ? ' dragging' : ''}${t.status === 'DONE' ? ' done' : ''}`} draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <button type="button" className="bc-open" data-task={t.id} onClick={onOpen} onKeyDown={onKey} aria-describedby={`bcm-${t.id}`}
        aria-label={`${t.title}. ${TASK_STATUS[t.status]}, ${PRIORITY[t.priority]} priority${t.due_date ? `, due ${shortDay(t.due_date)}` : ''}${t.blocked ? ', blocked' : ''}`}>
        <span className="bc-title">{t.status === 'DONE' && <Icon.checkCircle size={15} />}{t.title}</span>
        {!compact && t.description && <span className="bc-desc">{t.description}</span>}
      </button>
      <div className="bc-meta" id={`bcm-${t.id}`}>
        {t.blocked && <span className="chip-blocked"><Icon.lock size={11} />Blocked</span>}
        <span className={`prio ${t.priority}`}>{PRIORITY[t.priority]}</span>
        {t.due_date && <span className={`chip-date${late ? ' late' : today ? ' today' : ''}`}><Icon.calendar size={12} />{today ? 'Today' : shortDay(t.due_date)}</span>}
        {!compact && t.labels.slice(0, 2).map((l) => <span key={l} className="lbl sm">{l}</span>)}
      </div>
      {!compact && <div className="bc-foot">
        {t.subtasks > 0 && <span title="Subtasks done"><Icon.checkSquare size={13} />{t.subtasks_done}/{t.subtasks}</span>}
        {t.comments > 0 && <span title="Comments"><Icon.message size={13} />{t.comments}</span>}
        {t.files > 0 && <span title="Files"><Icon.file size={13} />{t.files}</span>}
        <span className="right">{t.assignee_name ? <Avatar name={t.assignee_name} size="xs" title={t.assignee_name} /> : null}</span>
        <Menu label={`Move ${t.title}`} className="icon-btn" button={<Dots vertical size={14} />} place="left">{moveMenu}</Menu>
      </div>}
    </article>
  );
}

function QuickAdd({ ws, col }: { ws: WS; col: Column }) {
  const [title, setTitle] = useState(''); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const toast = useToast(); const ref = useRef<HTMLInputElement>(null);
  const add = async (e: React.FormEvent) => { e.preventDefault(); if (!title.trim()) return; setBusy(true);
    try { await api.post(`/api/projects/${ws.p.id}/tasks`, { title, column_id: col.id }); setTitle(''); ws.reload(); ref.current?.focus(); } catch (x: any) { toast(x.message, { err: true }); } finally { setBusy(false); } };
  return open ? <form className="bq" onSubmit={add}><input ref={ref} autoFocus className="input" placeholder="Task title, then Enter" aria-label={`New task in ${col.name}`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }} />
    <div className="row"><button className="btn tiny primary" disabled={busy || !title.trim()}>{busy ? <Spinner /> : 'Add'}</button><button type="button" className="btn tiny ghost" onClick={() => setOpen(false)}>Done</button></div></form>
    : <button type="button" className="bq-btn" onClick={() => setOpen(true)}><Icon.plus size={14} />Add task</button>;
}

function ColumnMenu({ ws, col, index }: { ws: WS; col: Column; index: number }) {
  const toast = useToast(); const [edit, setEdit] = useState(false); const [del, setDel] = useState(false); const cols = ws.p.columns;
  // just past the neighbour in that direction
  const reorder = async (dir: -1 | 1) => { const a = cols[index + dir]; if (!a) return; const b = cols[index + 2 * dir]; const position = b ? (a.position + b.position) / 2 : a.position + dir;
    try { await api.patch(`/api/columns/${col.id}`, { position }); ws.reload(); } catch (e: any) { toast(e.message, { err: true }); } };
  return <>
    <Menu label={`Column ${col.name}`} className="icon-btn" button={<Dots vertical size={14} />} place="left">{(close) => <>
      <MenuItem onSelect={() => { close(); setEdit(true); }}><Icon.edit size={15} />Rename or set limit</MenuItem>
      {index > 0 && <MenuItem onSelect={() => { close(); reorder(-1); }}><Icon.left size={15} />Move left</MenuItem>}
      {index < cols.length - 1 && <MenuItem onSelect={() => { close(); reorder(1); }}><Icon.right size={15} />Move right</MenuItem>}
      <div className="menu-sep" /><MenuItem onSelect={() => { close(); setDel(true); }}><Icon.trash size={15} />Remove column</MenuItem></>}</Menu>
    {edit && <ColumnForm ws={ws} col={col} onClose={() => setEdit(false)} />}
    {del && <RemoveColumn ws={ws} col={col} onClose={() => setDel(false)} />}</>;
}
function ColumnForm({ ws, col, onClose }: { ws: WS; col?: Column; onClose: () => void }) {
  const toast = useToast(); const [f, setF] = useState({ name: col?.name ?? '', status: col?.status ?? 'DOING', wip: col?.wip_limit ? String(col.wip_limit) : '' }); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true);
    try { const wip_limit = f.wip ? Number(f.wip) : null; if (col) await api.patch(`/api/columns/${col.id}`, { name: f.name, wip_limit }); else await api.post(`/api/projects/${ws.p.id}/columns`, { name: f.name, status: f.status, wip_limit }); ws.reload(); onClose(); }
    catch (x: any) { toast(x.message, { err: true }); setBusy(false); } };
  return <Modal title={col ? `Column ${col.name}` : 'New column'} onClose={onClose}><form className="col" onSubmit={submit}>
    <label className="field"><span>Name</span><input autoFocus required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="QA" /></label>
    {!col && <label className="field"><span>Counts as</span><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{Object.entries(TASK_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <small className="faint">A task in this column has this status on Today, My tasks and everywhere else.</small></label>}
    <label className="field"><span>Work in progress limit (optional)</span><input type="number" min={1} max={999} value={f.wip} onChange={(e) => setF({ ...f, wip: e.target.value })} placeholder="No limit" /></label>
    <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !f.name.trim()}>{busy && <Spinner />}{col ? 'Save' : 'Add column'}</button></div>
  </form></Modal>;
}
function RemoveColumn({ ws, col, onClose }: { ws: WS; col: Column; onClose: () => void }) {
  const toast = useToast(); const others = ws.p.columns.filter((c) => c.id !== col.id); const n = ws.p.task_list.filter((t) => t.column_id === col.id).length;
  const [to, setTo] = useState(others.find((c) => c.status === col.status)?.id ?? others[0]?.id ?? ''); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await api.del(`/api/columns/${col.id}`, n ? { move_to: to } : {}); toast(`${col.name} removed.`); ws.reload(); onClose(); } catch (e: any) { toast(e.message, { err: true }); setBusy(false); } };
  return <Modal title={`Remove ${col.name}?`} onClose={onClose}><div className="col">
    {n ? <label className="field"><span>{n} {n === 1 ? 'task goes' : 'tasks go'} to</span><select value={to} onChange={(e) => setTo(e.target.value)}>{others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label> : <p className="muted">The column is empty.</p>}
    <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn danger" onClick={go} disabled={busy}>{busy && <Spinner />}Remove column</button></div></div></Modal>;
}
