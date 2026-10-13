import { useMemo, useState } from 'react';
import { api } from '../../api.ts';
import { Icon } from '../../ui/icons.tsx';
import { Menu } from '../../ui/menu.tsx';
import { useToast } from '../../ui/toast.tsx';
import { todayIST } from '../../ui/kit.tsx';
import { useTeam } from '../../session.tsx';
import { STATUS_COLOR, STATUS_ORDER, TASK_STATUS, StatusDot, addDays, daysFrom, shortDay, type Task } from './shared.tsx';
import { MilestoneForm } from './Overview.tsx';
import type { WS } from './Workspace.tsx';

const ZOOM = { day: { px: 40, span: 28 }, week: { px: 16, span: 84 }, month: { px: 5, span: 240 } } as const;
type Zoom = keyof typeof ZOOM;
const ROW = 40;

// Tasks with dates as bars, milestones as diamonds, dependencies as lines, today as a line. Tasks without dates are
// listed apart; nothing is given a date it does not have. Drag a bar (or focus it and use the arrow keys) to reschedule.
export function Timeline({ ws }: { ws: WS }) {
  const { p } = ws; const toast = useToast(); const team = useTeam(); const today = todayIST();
  const [zoom, setZoom] = useState<Zoom>(() => { try { return (localStorage.getItem('awtm-tl-zoom') as Zoom) || 'week'; } catch { return 'week'; } });
  const z = ZOOM[zoom];
  const [from, setFrom] = useState(() => addDays(today, -Math.round(z.span / 5)));
  const [who, setWho] = useState(''); const [st, setSt] = useState(''); const [addMs, setAddMs] = useState(false);
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'start' | 'end'; x: number; s: string; e: string; ds: number; de: number } | null>(null);
  const to = addDays(from, z.span);
  const setZ = (k: Zoom) => { setZoom(k); try { localStorage.setItem('awtm-tl-zoom', k); } catch { /* */ } setFrom(addDays(today, -Math.round(ZOOM[k].span / 5))); };
  const x = (d: string) => daysFrom(from, d) * z.px;
  const keep = (t: Task) => (!who || t.assignee_id === who) && (!st || t.status === st);
  const dated = p.task_list.filter((t) => (t.start_date || t.due_date) && keep(t));
  const undated = p.task_list.filter((t) => !t.start_date && !t.due_date && t.status !== 'DONE' && keep(t));
  // rows: one group per milestone (by date), then the rest
  const rows = useMemo(() => {
    const out: ({ kind: 'group'; m: any | null; n: number } | { kind: 'task'; t: Task })[] = [];
    const ms = [...p.milestones].sort((a, b) => String(a.target_date ?? '9').localeCompare(String(b.target_date ?? '9')));
    for (const m of [...ms, null]) {
      const list = dated.filter((t) => (m ? t.milestone_id === m.id : !t.milestone_id || !p.milestones.some((x) => x.id === t.milestone_id))).sort((a, b) => String(a.start_date ?? a.due_date).localeCompare(String(b.start_date ?? b.due_date)));
      if (!m && !list.length) continue;
      out.push({ kind: 'group', m, n: list.length }); for (const t of list) out.push({ kind: 'task', t });
    }
    return out;
  }, [dated, p.milestones]);
  const span = (t: Task) => { const s = t.start_date ?? t.due_date!; const e = t.due_date ?? t.start_date!; return drag?.id === t.id ? { s: addDays(drag.s, drag.ds), e: addDays(drag.e, drag.de) } : { s, e }; };
  const save = async (t: Task, s: string, e: string) => {
    const body: any = t.start_date || s !== e ? { start_date: s, due_date: e } : { due_date: e };
    if (!t.start_date && t.due_date && s === e) delete body.start_date;
    const prev = p; ws.setP({ ...p, task_list: p.task_list.map((y) => (y.id === t.id ? { ...y, ...body } : y)) });
    try { await api.patch(`/api/tasks/${t.id}`, body); ws.reload(); } catch (err: any) { ws.setP(prev); toast(err.message, { err: true }); }
  };
  const down = (e: React.PointerEvent, t: Task, mode: 'move' | 'start' | 'end') => { e.preventDefault(); e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); const { s, e: en } = span(t); setDrag({ id: t.id, mode, x: e.clientX, s, e: en, ds: 0, de: 0 }); };
  const moveP = (e: React.PointerEvent) => { if (!drag) return; const d = Math.round((e.clientX - drag.x) / z.px);
    if (drag.mode === 'move') setDrag({ ...drag, ds: d, de: d }); else if (drag.mode === 'start') setDrag({ ...drag, ds: Math.min(d, daysFrom(drag.s, drag.e)) }); else setDrag({ ...drag, de: Math.max(d, -daysFrom(drag.s, drag.e)) }); };
  const up = () => { if (!drag) return; const t = p.task_list.find((y) => y.id === drag.id); const d = drag; setDrag(null);
    if (t && (d.ds || d.de)) save(t, addDays(d.s, d.ds), addDays(d.e, d.de)); else if (t) ws.openTask(t.id); };
  const key = (e: React.KeyboardEvent, t: Task) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!dir) { if (e.key === 'Enter') ws.openTask(t.id); return; }
    e.preventDefault(); const { s, e: en } = span(t);
    if (e.shiftKey) { if (daysFrom(s, addDays(en, dir)) >= 0) save(t, s, addDays(en, dir)); } else save(t, addDays(s, dir), addDays(en, dir));
  };
  // day labels across the top: every day, Mondays, or the 1st of the month
  const ticks = Array.from({ length: z.span + 1 }, (_, i) => addDays(from, i)).filter((d) => zoom === 'day' || (zoom === 'week' ? new Date(d + 'T00:00:00Z').getUTCDay() === 1 : d.endsWith('-01')));
  const width = z.span * z.px;
  const rowIndex = new Map<string, number>(); rows.forEach((r, i) => { if (r.kind === 'task') rowIndex.set(r.t.id, i); });
  const deps = ((p as any).dependencies ?? []).filter((d: any) => d.kind === 'BLOCKS' && rowIndex.has(d.task_id) && rowIndex.has(d.depends_on_id));
  const title = new Date(addDays(from, Math.round(z.span / 2)) + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'short', year: 'numeric' });
  return (
    <div className="tl">
      <div className="tl-tools">
        <button type="button" className="btn tiny" onClick={() => setFrom(addDays(today, -Math.round(z.span / 5)))}>Today</button>
        <button type="button" className="icon-btn" onClick={() => setFrom(addDays(from, -Math.round(z.span / 2)))} aria-label="Earlier"><Icon.left size={15} /></button>
        <b className="tl-title" aria-live="polite">{title}</b>
        <button type="button" className="icon-btn" onClick={() => setFrom(addDays(from, Math.round(z.span / 2)))} aria-label="Later"><Icon.right size={15} /></button>
        <span className="right" />
        <div className="seg layout-seg tl-zoom" role="group" aria-label="Zoom">{(['day', 'week', 'month'] as const).map((k) => <button key={k} type="button" aria-pressed={zoom === k} onClick={() => setZ(k)}>{k[0]!.toUpperCase() + k.slice(1)}</button>)}</div>
        <Menu label="Filter" className="btn tiny" kind="dialog" place="left" button={<><Icon.funnel size={13} />Filter{who || st ? <span className="n">{[who, st].filter(Boolean).length}</span> : null}</>}>{() => <div className="filter-pop">
          <label className="field"><span>Assignee</span><select value={who} onChange={(e) => setWho(e.target.value)}><option value="">Anyone</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="field"><span>Status</span><select value={st} onChange={(e) => setSt(e.target.value)}><option value="">Any</option>{STATUS_ORDER.map((s) => <option key={s} value={s}>{TASK_STATUS[s]}</option>)}</select></label></div>}</Menu>
        <button type="button" className="btn tiny" onClick={() => setAddMs(true)}><Icon.target size={13} />Milestone</button>
        <button type="button" className="btn tiny primary" onClick={() => ws.addTask()}><Icon.plus size={13} />Add task</button>
      </div>
      <p className="bd-hint faint">Drag a bar to move it, or its ends to change the dates. With a bar focused, the arrow keys move it a day; Shift with an arrow changes the end.</p>
      <div className="panel tl-frame">
        <div className="tl-scroll" onPointerMove={moveP} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
          <div className="tl-grid" style={{ width: width + 260 }}>
            <div className="tl-head"><div className="tl-lab">Tasks</div><div className="tl-axis" style={{ width }}>
              {ticks.map((d) => <span key={d} style={{ left: x(d) }}>{zoom === 'month' ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'short' }) : zoom === 'day' ? new Date(d + 'T00:00:00Z').getUTCDate() : shortDay(d)}</span>)}</div></div>
            <div className="tl-body" style={{ height: Math.max(rows.length, 3) * ROW }}>
              <div className="tl-lines" style={{ left: 260, width }} aria-hidden="true">{ticks.map((d) => <i key={d} style={{ left: x(d) }} />)}
                {today >= from && today <= to && <b className="tl-today" style={{ left: x(today) + z.px / 2 }}><span>Today</span></b>}</div>
              <svg className="tl-deps" style={{ left: 260, width, height: rows.length * ROW }} aria-hidden="true">{deps.map((d: any) => {
                const a = p.task_list.find((t) => t.id === d.depends_on_id)!; const b = p.task_list.find((t) => t.id === d.task_id)!;
                const x1 = x(span(a).e) + z.px; const y1 = rowIndex.get(a.id)! * ROW + ROW / 2; const x2 = x(span(b).s); const y2 = rowIndex.get(b.id)! * ROW + ROW / 2;
                return <path key={d.task_id + d.depends_on_id} d={`M${x1} ${y1} C${x1 + 18} ${y1} ${x2 - 18} ${y2} ${x2} ${y2}`} />; })}</svg>
              {rows.map((r, i) => r.kind === 'group'
                ? <div key={r.m?.id ?? 'none'} className="tl-row grp" style={{ top: i * ROW }}><div className="tl-lab"><span className={`ms-dia${r.m?.status === 'DONE' ? ' done' : ''}`} aria-hidden="true" /><div><b>{r.m?.name ?? 'Not in a milestone'}</b><small>{r.n} {r.n === 1 ? 'task' : 'tasks'}{r.m?.target_date ? ` · ${shortDay(r.m.target_date)}` : ''}</small></div></div>
                    {r.m?.target_date && r.m.target_date >= from && r.m.target_date <= to && <span className={`tl-ms${r.m.status === 'DONE' ? ' done' : ''}`} style={{ left: 260 + x(r.m.target_date) + z.px / 2 }} title={`${r.m.name}, ${shortDay(r.m.target_date)}`}><i /><span>{r.m.name}</span></span>}</div>
                : (() => { const t = r.t; const { s, e } = span(t); const left = x(s); const w = (daysFrom(s, e) + 1) * z.px; const vis = e >= from && s <= to; return (
                  <div key={t.id} className="tl-row" style={{ top: i * ROW }}>
                    <div className="tl-lab task"><StatusDot s={t.status} /><button type="button" className="link-btn" onClick={() => ws.openTask(t.id)}>{t.title}</button></div>
                    {vis && <div className={`tl-bar${t.blocked ? ' blocked' : ''}${t.status === 'DONE' ? ' done' : ''}${drag?.id === t.id ? ' dragging' : ''}`} style={{ left: 260 + Math.max(left, -z.px), width: Math.max(w + Math.min(left, 0), z.px), '--sc': STATUS_COLOR[t.status] } as React.CSSProperties}
                      role="button" tabIndex={0} aria-label={`${t.title}, ${shortDay(s)} to ${shortDay(e)}. Arrow keys move it, Shift with an arrow changes the end, Enter opens it.`}
                      onPointerDown={(ev) => down(ev, t, 'move')} onKeyDown={(ev) => key(ev, t)}>
                      <span className="h l" onPointerDown={(ev) => down(ev, t, 'start')} /><span className="tl-bar-t">{t.title}</span><span className="h r" onPointerDown={(ev) => down(ev, t, 'end')} /></div>}
                  </div>); })())}
              {!rows.length && <p className="tl-empty">No task has dates yet. Give a task a start or due date and it appears here.</p>}
            </div>
          </div>
        </div>
      </div>
      {undated.length > 0 && <section className="panel tl-undated" aria-labelledby="und-h"><h2 id="und-h">Not scheduled <span className="faint">{undated.length}</span></h2>
        <ul>{undated.map((t) => <li key={t.id}><StatusDot s={t.status} /><button type="button" className="link-btn" onClick={() => ws.openTask(t.id)}>{t.title}</button>
          <button type="button" className="btn tiny" onClick={() => save(t, today, today)}>Schedule for today</button></li>)}</ul></section>}
      {addMs && <MilestoneForm ws={ws} onClose={() => setAddMs(false)} />}
    </div>
  );
}
