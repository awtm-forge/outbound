// The timeline: a Gantt of the project's dated tasks, with the task, its status and its assignee fixed on the left and
// the dates scrolling on the right. Bars move and resize by mouse, touch or keyboard and save through the same task
// API as the board and the list. Milestones are diamonds, dependencies are connector lines, and tasks without dates
// wait below until someone schedules them. Nothing is given a date it does not have.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { useRouter } from '../../router.tsx';
import { Icon } from '../../ui/icons.tsx';
import { Menu } from '../../ui/menu.tsx';
import { Modal, useConfirm } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { useTeam } from '../../session.tsx';
import { Avatar, PRIORITY, STATUS_COLOR, STATUS_ORDER, TASK_STATUS, addDays, daysFrom, type Task } from './shared.tsx';
import { MilestoneForm } from './Overview.tsx';
import type { WS } from './Workspace.tsx';

type Scale = 'day' | 'week' | 'month' | 'quarter';
const BASE: Record<Scale, { px: number; span: number; step: number }> = { day: { px: 72, span: 21, step: 7 }, week: { px: 38, span: 56, step: 14 }, month: { px: 13, span: 150, step: 30 }, quarter: { px: 4.5, span: 400, step: 91 } };
const ZOOMS = [50, 75, 100, 125, 150, 200];
const ROW = 32; const LANE = 40; const HEAD = 56;
const PRIO_COLOR: Record<string, string> = { URGENT: '#F43F5E', HIGH: '#F87171', MEDIUM: '#F59E0B', LOW: '#94A3B8', NONE: '#64748B' };
const hue = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h) % 360; };
// one calendar for everything here: the viewer's own day, as YYYY-MM-DD, with arithmetic done in UTC on those strings
const localToday = () => new Date().toLocaleDateString('en-CA');
const dow = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();
const isoWeek = (d: string) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7)); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); return 1 + Math.round(((t.getTime() - y.getTime()) / 864e5 - 3 + ((y.getUTCDay() + 6) % 7)) / 7); };
const mon = (d: string, y = false) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'short', ...(y ? { year: 'numeric' } : {}) });
const nice = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
type Drag = { kind: 'task' | 'ms'; id: string; mode: 'move' | 'start' | 'end'; x: number; s: string; e: string; ds: number; de: number; moved: boolean };
type Row = { kind: 'group'; key: string; label: string; n: number; t?: Task; s?: string; e?: string } | { kind: 'task'; t: Task; depth: number; kids: number };
const SCALES: Scale[] = ['day', 'week', 'month', 'quarter'];

export function Timeline({ ws }: { ws: WS }) {
  const { p } = ws; const openId = useRouter().search.get('task'); const toast = useToast(); const ask = useConfirm(); const team = useTeam(); const today = localToday();
  const pref = useMemo(() => { try { return JSON.parse(localStorage.getItem('awtm-tl') ?? '{}'); } catch { return {}; } }, []);
  const [scale, setScaleS] = useState<Scale>(SCALES.includes(pref.scale) ? pref.scale : 'week'); const [zoom, setZoom] = useState<number>(ZOOMS.includes(pref.zoom) ? pref.zoom : 100);
  const [showMs, setShowMs] = useState<boolean>(pref.ms ?? true); const [showDeps, setShowDeps] = useState<boolean>(pref.deps ?? true);
  const [group, setGroup] = useState<string>(pref.group ?? 'parent');
  useEffect(() => { try { localStorage.setItem('awtm-tl', JSON.stringify({ scale, zoom, ms: showMs, deps: showDeps, group })); } catch { /* */ } }, [scale, zoom, showMs, showDeps, group]);
  const px = BASE[scale].px * (zoom / 100); const span = Math.round(BASE[scale].span * (100 / zoom));
  const [from, setFrom] = useState(() => addDays(today, -Math.round(BASE[scale].span / 6)));
  const to = addDays(from, span);
  const setScale = (s: Scale) => { setScaleS(s); const seenS = Math.max(1, Math.floor((frameW - LW) / (BASE[s].px * zoom / 100))); setFrom(addDays(today, -Math.max(1, Math.floor(seenS / 4)))); };
  const [f, setF] = useState({ status: [] as string[], priority: [] as string[], who: [] as string[], labels: [] as string[], overdue: false, hideDone: false, milestone: '' });
  const nF = [f.status.length, f.priority.length, f.who.length, f.labels.length, f.overdue, f.hideDone, f.milestone].filter(Boolean).length;
  const [closed, setClosed] = useState<Set<string>>(new Set()); const [unOpen, setUnOpen] = useState(true);
  const [drag, setDragS] = useState<Drag | null>(null); const dragRef = useRef<Drag | null>(null);
  // the drag lives in a ref too, so a quick click that ends before a re-render still sees how it started
  const setDrag = (d: Drag | null) => { dragRef.current = d; setDragS(d); }; const [link, setLink] = useState<{ from: string; x: number; y: number } | null>(null);
  const saving = useRef<Set<string>>(new Set()); const [, force] = useState(0);
  const [msForm, setMsForm] = useState<{ m?: any } | null>(null); const [sched, setSched] = useState<Task | null>(null);
  const scroller = useRef<HTMLDivElement>(null); const frameW = useWidth(scroller); const LW = frameW < 640 ? 170 : frameW < 1150 ? 300 : 460;
  const labels = useMemo(() => [...new Set(p.task_list.flatMap((t) => t.labels))].sort(), [p.task_list]);
  const byId = useMemo(() => new Map(p.task_list.map((t) => [t.id, t])), [p.task_list]);

  const keep = (t: Task) => (!f.status.length || f.status.includes(t.status)) && (!f.priority.length || f.priority.includes(t.priority)) && (!f.who.length || f.who.includes(t.assignee_id ?? 'none'))
    && (!f.labels.length || f.labels.some((l) => t.labels.includes(l))) && (!f.overdue || (t.status !== 'DONE' && !!t.due_date && t.due_date < today)) && (!f.hideDone || t.status !== 'DONE')
    && (!f.milestone || t.milestone_id === f.milestone);
  const dates = (t: Task) => { const s = t.start_date ?? t.due_date; const e = t.due_date ?? t.start_date; if (!s || !e) return null; return drag?.kind === 'task' && drag.id === t.id ? { s: addDays(drag.s, drag.ds), e: addDays(drag.e, drag.de) } : { s, e }; };
  const dated = p.task_list.filter((t) => (t.start_date || t.due_date) && keep(t));
  const undated = p.task_list.filter((t) => !t.start_date && !t.due_date && t.status !== 'DONE' && keep(t));

  // rows: parents with their children (the default), groups by status, assignee or milestone, or one flat list
  const rows = useMemo((): Row[] => {
    const out: Row[] = []; const by = (a: Task, b: Task) => String(dates(a)?.s).localeCompare(String(dates(b)?.s)) || a.position - b.position;
    if (group === 'parent') {
      const kids = new Map<string, Task[]>(); for (const t of dated) if (t.parent_id && byId.has(t.parent_id)) kids.set(t.parent_id, [...(kids.get(t.parent_id) ?? []), t]);
      const tops = [...dated.filter((t) => !t.parent_id || !byId.has(t.parent_id)), ...[...kids.keys()].map((id) => byId.get(id)!).filter((t) => !dated.includes(t) && (!t.parent_id || !byId.has(t.parent_id)))]
        .sort((a, b) => String(dates(a)?.s ?? 'z').localeCompare(String(dates(b)?.s ?? 'z')));
      for (const t of tops) {
        const ch = (kids.get(t.id) ?? []).sort(by);
        if (ch.length && !dates(t)) { const ss = ch.map((c) => dates(c)!); out.push({ kind: 'group', key: t.id, label: t.title, n: ch.length, t, s: ss.map((y) => y.s).sort()[0], e: ss.map((y) => y.e).sort().at(-1) }); }
        else out.push({ kind: 'task', t, depth: 0, kids: ch.length });
        if (!closed.has(t.id)) for (const c of ch) out.push({ kind: 'task', t: c, depth: 1, kids: 0 });
      }
      return out;
    }
    if (!group) return [...dated].sort(by).map((t) => ({ kind: 'task', t, depth: 0, kids: 0 }));
    const m = new Map<string, [string, Task[]]>();
    for (const t of dated) { const ms = p.milestones.find((y) => y.id === t.milestone_id);
      const [k, l] = group === 'status' ? [String(STATUS_ORDER.indexOf(t.status as any)), TASK_STATUS[t.status]!] : group === 'assignee' ? [t.assignee_name ? 'a' + t.assignee_name : '~', t.assignee_name ?? 'Unassigned'] : [ms ? 'm' + (ms.target_date ?? '') + ms.id : '~', ms?.name ?? 'No milestone'];
      const e: [string, Task[]] = m.get(k) ?? [l, []]; e[1].push(t); m.set(k, e); }
    for (const [k, [l, list]] of [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))) { out.push({ kind: 'group', key: k, label: l, n: list.length }); if (!closed.has(k)) for (const t of list.sort(by)) out.push({ kind: 'task', t, depth: 0, kids: 0 }); }
    return out;
  }, [dated, group, closed, drag, p.milestones]); // eslint-disable-line react-hooks/exhaustive-deps

  const x = (d: string) => daysFrom(from, d) * px;
  const width = span * px; const lane = showMs ? LANE : 0;
  const rowIndex = new Map<string, number>(); rows.forEach((r, i) => { if (r.kind === 'task') rowIndex.set(r.t.id, i); });
  const deps = ((p as any).dependencies ?? []).filter((d: any) => d.kind === 'BLOCKS' && rowIndex.has(d.task_id) && rowIndex.has(d.depends_on_id));
  const conflict = (d: any) => { const a = dates(byId.get(d.depends_on_id)!); const b = dates(byId.get(d.task_id)!); return !!a && !!b && b.s <= a.e; };
  const msDate = (m: any): string => (drag?.kind === 'ms' && drag.id === m.id ? addDays(drag.s, drag.ds) : m.target_date);

  // ---------- saving ----------
  const saveTask = async (t: Task, s: string, e: string) => {
    if (saving.current.has(t.id)) return; // one write per task at a time
    const body: Record<string, string | null> = t.start_date || s !== e ? { start_date: s, due_date: e } : { due_date: e };
    const prev = p; ws.setP({ ...p, task_list: p.task_list.map((y) => (y.id === t.id ? { ...y, ...body } : y)) });
    saving.current.add(t.id); force((n) => n + 1);
    try { await api.patch(`/api/tasks/${t.id}`, body); ws.reload(); } catch (err: any) { ws.setP(prev); toast(`Not saved. ${err.message}`, { err: true }); }
    finally { saving.current.delete(t.id); force((n) => n + 1); }
  };
  const saveMs = async (m: any, patch: object, msg?: string) => { const prev = p; ws.setP({ ...p, milestones: p.milestones.map((y) => (y.id === m.id ? { ...y, ...patch } : y)) });
    try { await api.patch(`/api/milestones/${m.id}`, patch); ws.reload(); if (msg) toast(msg); } catch (err: any) { ws.setP(prev); toast(err.message, { err: true }); } };
  // ---------- pointer: move, resize, and drawing a dependency ----------
  const at = (ev: { clientX: number; clientY: number }) => { const r = scroller.current!.getBoundingClientRect(); return { x: ev.clientX - r.left + scroller.current!.scrollLeft, y: ev.clientY - r.top + scroller.current!.scrollTop }; };
  const down = (ev: React.PointerEvent, kind: 'task' | 'ms', id: string, mode: Drag['mode'], s: string, e: string) => {
    if (ev.button !== 0) return; ev.preventDefault(); ev.stopPropagation(); (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    setDrag({ kind, id, mode, x: ev.clientX, s, e, ds: 0, de: 0, moved: false });
  };
  const move = (ev: React.PointerEvent) => {
    if (link) { setLink({ ...link, ...at(ev) }); return; }
    const drag = dragRef.current; if (!drag) return; const d = Math.round((ev.clientX - drag.x) / px); const len = daysFrom(drag.s, drag.e);
    const moved = drag.moved || Math.abs(ev.clientX - drag.x) > 3;
    if (drag.mode === 'move') setDrag({ ...drag, ds: d, de: d, moved }); else if (drag.mode === 'start') setDrag({ ...drag, ds: Math.min(d, len), moved }); else setDrag({ ...drag, de: Math.max(d, -len), moved });
  };
  const finishLink = async (fromId: string, toId: string) => {
    if (fromId === toId) return;
    try { await api.post(`/api/tasks/${toId}/dependencies`, { depends_on_id: fromId, kind: 'BLOCKS' }); ws.reload(); toast(`“${byId.get(toId)?.title}” now waits on “${byId.get(fromId)?.title}”.`); } catch (e: any) { toast(e.message, { err: true }); }
  };
  const up = (ev: React.PointerEvent) => {
    if (link) { const { y } = at(ev); const i = Math.floor((y - HEAD - lane) / ROW); const r = rows[i]; const fromId = link.from; setLink(null); if (r?.kind === 'task') finishLink(fromId, r.t.id); return; }
    const d = dragRef.current; if (!d) return; setDrag(null);
    if (d.kind === 'ms') { const m = p.milestones.find((y) => y.id === d.id); if (m && d.ds) saveMs(m, { target_date: addDays(d.s, d.ds) }, `${m.name} moved to ${nice(addDays(d.s, d.ds))}.`); else if (m && !d.moved) setMsForm({ m }); return; }
    const t = byId.get(d.id); if (!t) return;
    if (d.ds || d.de) saveTask(t, addDays(d.s, d.ds), addDays(d.e, d.de)); else if (!d.moved) ws.openTask(t.id);
  };
  const cancel = () => { setDrag(null); setLink(null); };
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && (drag || link)) cancel(); }; addEventListener('keydown', h); return () => removeEventListener('keydown', h); }, [drag, link]);
  const removeDep = async (d: any) => {
    if (!(await ask({ title: 'Remove this dependency?', body: `“${byId.get(d.task_id)?.title}” will no longer wait on “${byId.get(d.depends_on_id)?.title}”.`, confirm: 'Remove', tone: 'danger' }))) return;
    try { await api.del(`/api/tasks/${d.task_id}/dependencies/${d.depends_on_id}`); ws.reload(); } catch (e: any) { toast(e.message, { err: true }); }
  };
  const key = (ev: React.KeyboardEvent, t: Task) => {
    if (ev.key === 'Enter') { ws.openTask(t.id); return; }
    const dir = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0; if (!dir) return;
    ev.preventDefault(); const dd = dates(t)!;
    if (ev.shiftKey) { if (daysFrom(dd.s, addDays(dd.e, dir)) >= 0) saveTask(t, dd.s, addDays(dd.e, dir)); }
    else if (ev.altKey) { if (daysFrom(addDays(dd.s, dir), dd.e) >= 0) saveTask(t, addDays(dd.s, dir), dd.e); }
    else saveTask(t, addDays(dd.s, dir), addDays(dd.e, dir));
  };
  // a task dropped from the unscheduled list lands on the day under the pointer
  const dropDay = (ev: React.DragEvent) => { const { x: px0 } = at(ev); return px0 < LW ? null : addDays(from, Math.floor((px0 - LW) / px)); };

  // ---------- the date header ----------
  const days = Array.from({ length: span + 1 }, (_, i) => addDays(from, i));
  const top: { d: string; label: string; wk: boolean }[] = []; const bottom: { d: string; w: number; label: string; we?: boolean }[] = [];
  if (scale === 'day' || scale === 'week') {
    const firsts = days.filter((d) => d.endsWith('-01') || d === from);
    for (const d of days) { if (dow(d) === 1 && !firsts.some((m) => Math.abs(daysFrom(m, d)) * px < 70)) top.push({ d, label: `W${isoWeek(d)}`, wk: true }); if (firsts.includes(d) && !(d === from && firsts.some((m) => m !== from && daysFrom(from, m) * px < 80))) top.push({ d, label: mon(d, true), wk: false });
      bottom.push({ d, w: px, label: scale === 'day' ? `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow(d)]} ${Number(d.slice(8))}` : String(Number(d.slice(8))), we: dow(d) === 0 || dow(d) === 6 }); }
  } else if (scale === 'month') {
    for (const d of days) { if (d.endsWith('-01') || d === from) top.push({ d, label: mon(d, true), wk: false }); if (dow(d) === 1) bottom.push({ d, w: 7 * px, label: `W${isoWeek(d)}` }); }
  } else {
    for (const d of days) { if ((d.endsWith('-01') && ['01', '04', '07', '10'].includes(d.slice(5, 7))) || d === from) top.push({ d, label: `Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1} ${d.slice(0, 4)}`, wk: false }); if (d.endsWith('-01')) bottom.push({ d, w: 30 * px, label: mon(d) }); }
  }
  const seen = Math.max(1, Math.floor((frameW - LW) / px)); const mid = addDays(from, Math.floor(seen / 2)); const last = addDays(from, seen);
  const goToday = () => setFrom(addDays(today, -Math.max(1, Math.floor(seen / 4))));
  const placed = useRef(false); useEffect(() => { if (!placed.current && frameW > 0 && frameW !== 1200) { placed.current = true; goToday(); } }, [frameW]); // eslint-disable-line react-hooks/exhaustive-deps
  const rangeLabel = scale === 'day' || scale === 'week' ? mon(mid, true) : `${mon(from, true)} to ${mon(last, true)}`;
  const visible = (s: string, e: string) => e >= from && s <= to;
  const toggleF = (k: 'status' | 'priority' | 'who' | 'labels', v: string) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((y) => y !== v) : [...f[k], v] });
  const bodyH = Math.max(rows.length, 3) * ROW + lane;
  const msShown = showMs ? p.milestones.filter((m) => m.target_date && visible(msDate(m), msDate(m)) && (!f.milestone || m.id === f.milestone)) : [];
  const linkFrom = link ? byId.get(link.from) : null; const linkD = linkFrom ? dates(linkFrom) : null;

  return (
    <div className="tl">
      <div className="tl-tools">
        <button type="button" className="btn tiny" onClick={goToday}>Today</button>
        <button type="button" className="icon-btn bx" onClick={() => setFrom(addDays(from, -BASE[scale].step))} aria-label="Earlier"><Icon.left size={15} /></button>
        <button type="button" className="icon-btn bx" onClick={() => setFrom(addDays(from, BASE[scale].step))} aria-label="Later"><Icon.right size={15} /></button>
        <label className="tl-range" title="Jump to a month"><b aria-live="polite">{rangeLabel}</b><Icon.calendar size={14} /><input type="month" aria-label="Jump to a month" value={addDays(from, Math.round(span / 6)).slice(0, 7)} onChange={(e) => e.target.value && setFrom(addDays(e.target.value + '-01', -2))} /></label>
        <span className="tl-gap" />
        <div className="seg tl-scale" role="group" aria-label="Time scale">{SCALES.map((k) => <button key={k} type="button" aria-pressed={scale === k} className={scale === k ? 'on' : ''} onClick={() => setScale(k)}>{k[0]!.toUpperCase() + k.slice(1)}</button>)}</div>
        <Menu label="Filter" className={`btn tiny${nF ? ' on' : ''}`} kind="dialog" place="left" button={<><Icon.funnel size={13} />Filter{nF ? <span className="n hot">{nF}</span> : null}</>}>{() => <div className="filter-pop wide tl-filter">
          <div className="field"><span>Status</span><div className="chips">{STATUS_ORDER.map((s) => <label key={s} className={`fchip${f.status.includes(s) ? ' on' : ''}`}><input type="checkbox" className="sr" checked={f.status.includes(s)} onChange={() => toggleF('status', s)} /><i style={{ background: STATUS_COLOR[s] }} />{TASK_STATUS[s]}</label>)}</div></div>
          <div className="field"><span>Priority</span><div className="chips">{Object.entries(PRIORITY).map(([k, v]) => <label key={k} className={`fchip${f.priority.includes(k) ? ' on' : ''}`}><input type="checkbox" className="sr" checked={f.priority.includes(k)} onChange={() => toggleF('priority', k)} /><i style={{ background: PRIO_COLOR[k] }} />{v}</label>)}</div></div>
          <div className="field"><span>Assignee</span><div className="chips">{[...team.map((u) => [u.id, u.name] as [string, string]), ['none', 'Unassigned'] as [string, string]].map(([id, n]) => <label key={id} className={`fchip${f.who.includes(id) ? ' on' : ''}`}><input type="checkbox" className="sr" checked={f.who.includes(id)} onChange={() => toggleF('who', id)} />{n}</label>)}</div></div>
          {labels.length > 0 && <div className="field"><span>Labels</span><div className="chips">{labels.map((l) => <label key={l} className={`lbl sm hued fl${f.labels.includes(l) ? ' on' : ''}`} style={{ '--l-h': hue(l) } as React.CSSProperties}><input type="checkbox" className="sr" checked={f.labels.includes(l)} onChange={() => toggleF('labels', l)} />{l}</label>)}</div></div>}
          {p.milestones.length > 0 && <label className="field"><span>Milestone</span><select value={f.milestone} onChange={(e) => setF({ ...f, milestone: e.target.value })}><option value="">Any</option>{p.milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
          <label className="chk"><input type="checkbox" className="check" checked={f.overdue} onChange={(e) => setF({ ...f, overdue: e.target.checked })} />Overdue only</label>
          <label className="chk"><input type="checkbox" className="check" checked={f.hideDone} onChange={(e) => setF({ ...f, hideDone: e.target.checked })} />Hide completed tasks</label>
          <label className="field"><span>Group by</span><select value={group} onChange={(e) => { setGroup(e.target.value); setClosed(new Set()); }}><option value="parent">Parent task</option><option value="status">Status</option><option value="assignee">Assignee</option><option value="milestone">Milestone</option><option value="">No grouping</option></select></label>
          {nF > 0 && <button type="button" className="btn tiny" onClick={() => setF({ status: [], priority: [], who: [], labels: [], overdue: false, hideDone: false, milestone: '' })}>Reset filters</button>}</div>}</Menu>
        <Menu label="Milestones" className={`btn tiny${showMs ? ' on' : ''}`} kind="dialog" place="left" button={<><span className="ms-ic" aria-hidden="true" />Milestones</>}>{(close) => <div className="filter-pop wide">
          <label className="chk"><input type="checkbox" className="check" checked={showMs} onChange={(e) => setShowMs(e.target.checked)} />Show milestones on the timeline</label>
          <ul className="tl-mslist">{p.milestones.map((m) => <li key={m.id}><span className={`ms-ic${m.status === 'DONE' ? ' done' : ''}`} aria-hidden="true" /><button type="button" className="link-btn" onClick={() => { close(); setMsForm({ m }); }}>{m.name}</button><small className="faint">{m.target_date ? nice(m.target_date) : 'No date'}</small>
            <button type="button" className="btn tiny ghost" onClick={() => saveMs(m, { status: m.status === 'DONE' ? 'OPEN' : 'DONE' }, m.status === 'DONE' ? `${m.name} reopened.` : `${m.name} marked done.`)}>{m.status === 'DONE' ? 'Reopen' : 'Done'}</button>
            <button type="button" className="icon-btn" aria-label={`Delete ${m.name}`} onClick={async () => { if (!(await ask({ title: `Delete the milestone “${m.name}”?`, body: 'Its tasks stay; they are no longer in a milestone.', confirm: 'Delete', tone: 'danger' }))) return; try { await api.del(`/api/milestones/${m.id}`); ws.reload(); } catch (e: any) { toast(e.message, { err: true }); } }}><Icon.trash size={13} /></button></li>)}
            {!p.milestones.length && <li className="faint">No milestones yet.</li>}</ul>
          <button type="button" className="btn tiny" onClick={() => { close(); setMsForm({}); }}><Icon.plus size={13} />Add milestone</button></div>}</Menu>
        <button type="button" className={`btn tiny${showDeps ? ' on' : ''}`} aria-pressed={showDeps} onClick={() => setShowDeps(!showDeps)}><Icon.link size={13} />Dependencies</button>
        <div className="tl-zoom" role="group" aria-label="Zoom"><button type="button" className="icon-btn" disabled={zoom <= ZOOMS[0]!} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)]!)} aria-label="Zoom out"><Icon.minus size={14} /></button>
          <span aria-live="polite">{zoom}%</span><button type="button" className="icon-btn" disabled={zoom >= ZOOMS.at(-1)!} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)]!)} aria-label="Zoom in"><Icon.plus size={14} /></button></div>
        <button type="button" className="btn tiny primary" onClick={() => ws.addTask()}><Icon.plus size={14} />Add task</button>
      </div>

      <div className="panel tl-frame">
        <div className={`tl-scroll${link ? ' linking' : ''}`} ref={scroller} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onDragOver={(e) => { if (e.dataTransfer.types.includes('text/task')) e.preventDefault(); }}
          onDrop={(e) => { const id = e.dataTransfer.getData('text/task'); const d = dropDay(e); const t = byId.get(id); if (t && d) { e.preventDefault(); saveTask(t, d, d); toast(`“${t.title}” scheduled for ${nice(d)}.`); } }}>
          <div className={`tl-grid${LW < 400 ? ' narrow' : ''}${LW < 200 ? ' tiny' : ''}`} style={{ width: width + LW, '--lw': `${LW}px` } as React.CSSProperties}>
            <div className="tl-head">
              <div className="tl-lab tl-cols"><span className="c-t">Task</span><span className="c-st">Status</span><span className="c-as">Assignee</span></div>
              <div className="tl-axis" style={{ width }}>
                <div className="tl-ax-top">{top.map((t, i) => <span key={t.d + i} style={{ left: x(t.d) }} className={t.wk ? 'wk' : 'mo'}>{t.label}</span>)}</div>
                <div className="tl-ax-bot">{bottom.map((b) => <span key={b.d} className={`${b.we ? 'we' : ''}${b.d === today ? ' now' : ''}`} style={{ left: x(b.d), width: b.w }}>{b.label}</span>)}</div>
              </div>
            </div>
            <div className="tl-body" style={{ height: bodyH }}>
              <div className="tl-lines" style={{ left: LW, width }} aria-hidden="true">
                {(scale === 'day' || scale === 'week') && days.filter((d) => dow(d) === 6).map((d) => <i key={'w' + d} style={{ left: x(d), width: 2 * px }} />)}
                {days.filter((d) => (scale === 'quarter' ? d.endsWith('-01') : scale === 'month' ? dow(d) === 1 : true)).map((d) => <b key={d} className={(scale === 'week' || scale === 'day') && dow(d) === 1 ? 'strong' : ''} style={{ left: x(d) }} />)}
                {msShown.map((m) => <u key={m.id} className={m.status === 'DONE' ? 'done' : ''} style={{ left: x(msDate(m)) + px / 2 }} />)}
                {visible(today, today) && <em className="tl-today" style={{ left: x(today) + px / 2 }}><span>Today</span></em>}
              </div>
              {showMs && <div className="tl-lane" style={{ height: LANE }}><div className="tl-lab tl-lane-lab">Milestones</div>
                {msShown.map((m) => { const d = msDate(m); return <button key={m.id} type="button" className={`tl-ms${m.status === 'DONE' ? ' done' : ''}${d < today && m.status !== 'DONE' ? ' late' : ''}`} style={{ left: LW + x(d) + px / 2 }}
                  onPointerDown={(e) => down(e, 'ms', m.id, 'move', m.target_date, m.target_date)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setMsForm({ m }); } const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (dir) { e.preventDefault(); saveMs(m, { target_date: addDays(m.target_date, dir) }); } }}
                  aria-label={`Milestone ${m.name}, ${nice(m.target_date)}${m.status === 'DONE' ? ', done' : ''}. Drag or use the arrow keys to move it, Enter to edit it.`}><i /><span><b>{m.name}</b><small>{nice(d)}</small></span></button>; })}
                {!msShown.length && <span className="tl-lane-empty" style={{ left: LW + 12 }}>{p.milestones.length ? 'No milestone in this range.' : 'No milestones yet. Add one from Milestones.'}</span>}</div>}
              {showDeps && <svg className="tl-deps" style={{ left: LW, top: lane, width, height: Math.max(rows.length, 1) * ROW }} aria-hidden="true">
                <defs><marker id="tl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8z" fill="context-stroke" /></marker></defs>
                {deps.map((d: any) => { const a = byId.get(d.depends_on_id)!; const b = byId.get(d.task_id)!; const da = dates(a)!; const db = dates(b)!;
                  const x1 = x(da.e) + px; const y1 = rowIndex.get(a.id)! * ROW + ROW / 2; const x2 = x(db.s); const y2 = rowIndex.get(b.id)! * ROW + ROW / 2;
                  // forward: one elbow; backward (it starts before the other ends): out, down between the rows, back, in
                  const path = x2 - 12 > x1 + 8 ? `M${x1} ${y1} H${x2 - 12} V${y2} H${x2 - 1}` : `M${x1} ${y1} H${x1 + 10} V${y1 + (y2 > y1 ? ROW / 2 : -ROW / 2)} H${x2 - 12} V${y2} H${x2 - 1}`;
                  const bad = conflict(d);
                  return <g key={d.task_id + d.depends_on_id} className={`dep${bad ? ' bad' : ''}`}><path d={path} markerEnd="url(#tl-arrow)" />
                    <path className="hit" d={path} onClick={() => removeDep(d)}><title>{`${b.title} waits on ${a.title}.${bad ? ' It starts before that ends.' : ''} Click to remove.`}</title></path></g>; })}
                {link && linkD && <path className="dep drawing" d={`M${x(linkD.e) + px} ${rowIndex.get(link.from)! * ROW + ROW / 2} L${link.x - LW} ${link.y - HEAD - lane}`} />}
              </svg>}
              {rows.map((r, i) => { const top0 = lane + i * ROW;
                if (r.kind === 'group') return <div key={'g' + r.key} className="tl-row grp" style={{ top: top0 }}>
                  <div className="tl-lab tl-cols"><span className="c-t"><button type="button" className="tl-tog" aria-expanded={!closed.has(r.key)} aria-label={`${closed.has(r.key) ? 'Show' : 'Hide'} ${r.label}`} onClick={() => setClosed((s) => { const n = new Set(s); n.has(r.key) ? n.delete(r.key) : n.add(r.key); return n; })}>
                    <span className={`chev${closed.has(r.key) ? '' : ' open'}`} aria-hidden="true"><Icon.right size={11} /></span></button>{r.t ? <button type="button" className="link-btn grp-t" onClick={() => ws.openTask(r.t!.id)} title={r.label}>{r.label}</button> : <b className="grp-t">{r.label}</b>}<small className="faint">{r.n}</small></span>
                    {r.t ? <span className="c-st"><span className="tl-st" style={{ '--s': STATUS_COLOR[r.t.status] } as React.CSSProperties}><i />{TASK_STATUS[r.t.status]}</span></span> : <span className="c-st" />}<span className="c-as">{r.t?.assignee_name ? <><Avatar name={r.t.assignee_name} size="xs" /><span>{r.t.assignee_name.split(' ')[0]}</span></> : null}</span></div>
                  {r.s && r.e && visible(r.s, r.e) && <span className="tl-sum" style={{ left: LW + x(r.s), width: (daysFrom(r.s, r.e) + 1) * px }} title={`${r.label}: ${nice(r.s)} to ${nice(r.e)}, from its subtasks`} />}</div>;
                const t = r.t; const dd = dates(t)!; const left = x(dd.s); const w = (daysFrom(dd.s, dd.e) + 1) * px; const late = t.status !== 'DONE' && !!t.due_date && t.due_date < today;
                const clash = deps.some((d: any) => d.task_id === t.id && conflict(d));
                return <div key={t.id} className={`tl-row${drag?.id === t.id ? ' active' : ''}${openId === t.id ? ' cur' : ''}`} style={{ top: top0 }}>
                  <div className="tl-lab tl-cols"><span className={`c-t${r.depth ? ' sub' : ''}`}>{r.kids ? <button type="button" className="tl-tog" aria-expanded={!closed.has(t.id)} aria-label={`${closed.has(t.id) ? 'Show' : 'Hide'} the subtasks of ${t.title}`} onClick={() => setClosed((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })}><span className={`chev${closed.has(t.id) ? '' : ' open'}`} aria-hidden="true"><Icon.right size={11} /></span></button> : <span className="tl-tog-sp" />}
                    <button type="button" className="link-btn" onClick={() => ws.openTask(t.id)} title={t.title}>{t.title}</button></span>
                    <span className="c-st"><span className="tl-st" style={{ '--s': STATUS_COLOR[t.status] } as React.CSSProperties}><i />{TASK_STATUS[t.status]}</span></span>
                    <span className="c-as">{t.assignee_name ? <><Avatar name={t.assignee_name} size="xs" /><span>{t.assignee_name.split(' ')[0]}</span></> : <span className="faint">Nobody</span>}</span></div>
                  {visible(dd.s, dd.e) && <div className={`tl-bar${late || clash ? ' warn' : ''}${t.blocked ? ' blocked' : ''}${t.status === 'DONE' ? ' done' : ''}${drag?.id === t.id ? ' dragging' : ''}${saving.current.has(t.id) ? ' saving' : ''}`}
                    style={{ left: LW + Math.max(left, -px), width: Math.max(w + Math.min(left, 0), 12), '--sc': STATUS_COLOR[t.status] } as React.CSSProperties}
                    role="button" tabIndex={0} aria-label={`${t.title}, ${TASK_STATUS[t.status]}, ${nice(dd.s)} to ${nice(dd.e)}${late ? ', overdue' : ''}${clash ? ', starts before what it waits on ends' : ''}. Arrow keys move it a day, Shift with an arrow changes the end, Alt the start. Enter opens it.`}
                    title={`${t.title}: ${nice(dd.s)} to ${nice(dd.e)}${late ? ' (overdue)' : ''}${clash ? ' (starts before what it waits on ends)' : ''}`}
                    onPointerDown={(ev) => down(ev, 'task', t.id, 'move', dd.s, dd.e)} onKeyDown={(ev) => key(ev, t)}>
                    <span className="h l" onPointerDown={(ev) => down(ev, 'task', t.id, 'start', dd.s, dd.e)} />
                    <span className="tl-bar-t">{t.status === 'DONE' && <Icon.check size={12} />}{w > 90 ? t.title : ''}</span>
                    <span className="h r" onPointerDown={(ev) => down(ev, 'task', t.id, 'end', dd.s, dd.e)} />
                    {showDeps && <span className="tl-link" title="Drag onto another task to make it wait on this one" onPointerDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); setLink({ from: t.id, ...at(ev) }); }} />}
                  </div>}
                  {visible(dd.s, dd.e) && t.assignee_name && <span className="tl-av" style={{ left: LW + left + w + 4 }}><Avatar name={t.assignee_name} size="xs" title={t.assignee_name} /></span>}
                </div>; })}
              {!rows.length && <p className="tl-empty" style={{ top: lane + 16, left: LW + 16 }}>{p.task_list.some((t) => t.start_date || t.due_date) && nF ? 'No dated task matches the filters.' : 'No task has dates yet. Schedule one from the list below, or give a task a start or due date.'}</p>}
            </div>
          </div>
        </div>
      </div>
      <p className="bd-hint faint">Drag a bar to move it, or its ends to change the dates{showDeps ? '; drag the dot at its end onto another task to make that task wait on it, and click a line to remove it' : ''}. A focused bar moves with the arrow keys; Shift changes the end, Alt the start. Escape cancels a drag.</p>

      <section className="panel tl-undated" aria-labelledby="und-h">
        <h2 id="und-h"><button type="button" className="grp-tog" aria-expanded={unOpen} onClick={() => setUnOpen(!unOpen)}><span className={`chev${unOpen ? ' open' : ''}`} aria-hidden="true"><Icon.right size={12} /></span>Not scheduled<span className="n">{undated.length}</span></button></h2>
        {unOpen && (undated.length ? <div className="scrollx"><table className="ctable tl-untable"><thead><tr><th>Task</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Labels</th><th><span className="sr">Schedule</span></th></tr></thead>
          <tbody>{undated.map((t) => <tr key={t.id} draggable onDragStart={(e) => { e.dataTransfer.setData('text/task', t.id); e.dataTransfer.effectAllowed = 'move'; }} title="Drag onto the timeline to schedule it on that day">
            <td><span className="grip" aria-hidden="true"><Icon.grip size={13} /></span><button type="button" className="link-btn" onClick={() => ws.openTask(t.id)}>{t.title}</button></td>
            <td><span className="tl-st" style={{ '--s': STATUS_COLOR[t.status] } as React.CSSProperties}><i />{TASK_STATUS[t.status]}</span></td>
            <td><span className="pr-t" style={{ color: PRIO_COLOR[t.priority] }}><i className="pdot" style={{ background: PRIO_COLOR[t.priority] }} />{PRIORITY[t.priority]}</span></td>
            <td>{t.assignee_name ?? <span className="faint">Nobody</span>}</td>
            <td><span className="lt-labels">{t.labels.map((l) => <span key={l} className="lbl sm hued" style={{ '--l-h': hue(l) } as React.CSSProperties}>{l}</span>)}</span></td>
            <td className="num"><button type="button" className="btn tiny" onClick={() => setSched(t)}>Schedule</button></td></tr>)}</tbody></table></div>
          : <p className="faint tl-alldone">Every open task has a date.</p>)}
      </section>
      {sched && <Schedule t={sched} today={today} onClose={() => setSched(null)} onSave={(s, e) => { saveTask(sched, s, e); setSched(null); }} />}
      {msForm && <MilestoneForm ws={ws} m={msForm.m} onClose={() => setMsForm(null)} />}
    </div>
  );
}

function Schedule({ t, today, onClose, onSave }: { t: Task; today: string; onClose: () => void; onSave: (s: string, e: string) => void }) {
  const [s, setS] = useState(today); const [e, setE] = useState(today);
  return <Modal title={`Schedule “${t.title}”`} onClose={onClose}>
    <form className="col" onSubmit={(ev) => { ev.preventDefault(); if (e >= s) onSave(s, e); }}>
      <div className="grid2"><label className="field"><span>Start</span><input type="date" autoFocus required value={s} onChange={(ev) => { setS(ev.target.value); if (ev.target.value > e) setE(ev.target.value); }} /></label>
        <label className="field"><span>Due</span><input type="date" required min={s} value={e} onChange={(ev) => setE(ev.target.value)} /></label></div>
      <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!s || !e || e < s}>Schedule</button></div></form></Modal>;
}
// the width of the timeline frame, so the fixed columns narrow when the task panel or a small screen takes room
function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [w, setW] = useState(1200);
  useEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(([e]) => setW(Math.round(e!.contentRect.width))); ro.observe(el); return () => ro.disconnect(); }, [ref]);
  return w;
}
