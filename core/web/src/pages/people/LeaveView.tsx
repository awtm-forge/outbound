// Leave and availability: who is out today, what is coming up, what is waiting for a decision, and what has passed,
// as a list or a month calendar. Kinds and reasons reach only the person and admins (the server leaves them out for
// everyone else). Asking, approving, declining and cancelling use the HR endpoints that already exist.
import { useMemo, useState } from 'react';
import { api } from '../../api.ts';
import { useLoad } from '../../ui/hooks.ts';
import { Icon } from '../../ui/icons.tsx';
import { useConfirm } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Empty, Failure, Skeleton, Spinner, ago, todayIST } from '../../ui/kit.tsx';
import { AvailPill, KIND, LEAVE_STATUS, PAvatar, days, span, type Person } from './shared.tsx';

type L = { id: string; employee_id: string; full_name: string; avatar_file_id: string | null; department: string | null; start_date: string; end_date: string; half_day: boolean; days: string; status: string;
  kind: string | null; reason: string | null; mine: boolean; decided_by_name: string | null; decided_at: string | null; created_at: string };
type View = 'upcoming' | 'pending' | 'past';
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function LeaveView({ people, person, onPerson, onChanged }: { people: Person[]; person: string; onPerson: (id: string) => void; onChanged: () => void }) {
  const toast = useToast(); const ask = useConfirm();
  const [month, setMonth] = useState(() => todayIST().slice(0, 7));
  const range = useMemo(() => { const [y, m] = month.split('-').map(Number) as [number, number]; return { from: `${month}-01`, to: ymd(new Date(Date.UTC(y, m, 0))) }; }, [month]);
  const { data, error, loading, reload } = useLoad<{ today: L[]; upcoming: L[]; pending: L[]; past: L[]; calendar: L[]; my_employee_id: string | null; can_decide: boolean }>(() => api.get(`/api/people/leave?from=${range.from}&to=${range.to}`), [range.from]);
  const [view, setView] = useState<View>('upcoming'); const [mode, setMode] = useState<'list' | 'calendar'>('list'); const [who, setWho] = useState(person);
  const [asking, setAsking] = useState(false);
  const refresh = () => { reload(true); onChanged(); };
  const decide = async (l: L, action: 'APPROVE' | 'REJECT') => {
    if (action === 'REJECT' && !(await ask({ title: `Decline ${l.full_name}’s leave on ${span(l)}?`, body: 'They see it as declined and can ask again.', confirm: 'Decline', tone: 'danger' }))) return;
    try { await api.post(`/api/hr/leave/${l.id}/decision`, { action }); toast(action === 'APPROVE' ? 'Leave approved.' : 'Leave declined.'); refresh(); } catch (e: any) { toast(e.message, { err: true }); }
  };
  const cancel = async (l: L) => {
    if (!(await ask({ title: `Cancel leave on ${span(l)}?`, body: 'The days go back. To take them later, ask again.', confirm: 'Cancel leave', cancel: 'Keep it', tone: 'danger' }))) return;
    try { await api.post(`/api/hr/leave/${l.id}/cancel`, {}); toast('Leave cancelled.'); refresh(); } catch (e: any) { toast(e.message, { err: true }); }
  };
  if (loading && !data) return <div className="pp-leave-grid"><Skeleton h={300} /><Skeleton h={300} /></div>;
  if (error) return <Failure error={error} retry={() => reload()} />;
  const d = data!;
  const list = (view === 'upcoming' ? [...d.today, ...d.upcoming] : view === 'pending' ? d.pending : d.past).filter((l) => !who || l.employee_id === who);
  const active = people.filter((p) => p.status !== 'EXITED');
  const out = active.filter((p) => p.availability === 'on_leave');
  const row = (l: L) => (
    <li key={l.id} className="pp-lrow">
      <button type="button" className="pp-lwho" onClick={() => onPerson(l.employee_id)}><PAvatar p={l} size={32} /><span><b>{l.full_name}</b><small>{l.department ?? ''}</small></span></button>
      <span className="pp-ldates"><b>{span(l)}</b><small>{days(l.days)}{l.kind ? ` · ${KIND[l.kind]}` : ''}</small></span>
      <span className="pp-lreason">{l.reason ? <><Icon.message size={13} />{l.reason}</> : null}</span>
      <span className={`pp-lst s-${l.status}`}>{LEAVE_STATUS[l.status]}</span>
      <span className="pp-lact">
        {d.can_decide && l.status === 'PENDING' && <><button type="button" className="btn tiny" onClick={() => decide(l, 'APPROVE')}><Icon.check size={13} />Approve</button><button type="button" className="btn tiny ghost" onClick={() => decide(l, 'REJECT')}>Decline</button></>}
        {(l.mine || d.can_decide) && ['PENDING', 'APPROVED'].includes(l.status) && l.end_date >= todayIST() && <button type="button" className="btn tiny ghost" onClick={() => cancel(l)}>Cancel</button>}
        {l.decided_by_name && l.status !== 'PENDING' && <small className="faint">{l.decided_by_name}, {ago(l.decided_at)}</small>}
      </span>
    </li>);
  return (
    <div className="pp-leave-grid">
      <div className="col" style={{ gap: 14, minWidth: 0 }}>
        <section className="panel pp-today" aria-labelledby="pp-today-h">
          <div className="pp-sec-h"><h3 id="pp-today-h">Availability today</h3><span className="faint">{active.length - out.length} of {active.length} working · {out.length} on leave</span></div>
          <ul className="pp-avail-list">{active.map((p) => <li key={p.id}><button type="button" onClick={() => onPerson(p.id)}><PAvatar p={p} size={28} /><span>{p.full_name}</span><AvailPill p={p} /></button></li>)}</ul>
          <p className="faint pp-legend">Active means AWTM Forge was open in the last five minutes. There is no calendar link yet, so nobody is shown as in a meeting.</p>
        </section>
        <section className="panel" aria-labelledby="pp-lv-h">
          <div className="pp-lv-tools"><h3 id="pp-lv-h" className="sr">Leave</h3>
            <div className="pp-chips" role="tablist" aria-label="Which leave">{([['upcoming', `Today and upcoming (${d.today.length + d.upcoming.length})`], ['pending', `Waiting (${d.pending.length})`], ['past', 'Past']] as const).map(([k, l]) =>
              <button key={k} role="tab" type="button" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => { setView(k); setMode('list'); }}>{l}</button>)}</div>
            <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Person"><option value="">Everyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
            <div className="pp-seg sm" role="group" aria-label="Show as"><button type="button" aria-pressed={mode === 'list'} className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}><Icon.list size={14} />List</button>
              <button type="button" aria-pressed={mode === 'calendar'} className={mode === 'calendar' ? 'on' : ''} onClick={() => setMode('calendar')}><Icon.calendar size={14} />Calendar</button></div>
          </div>
          {mode === 'calendar' ? <Calendar month={month} setMonth={setMonth} items={d.calendar.filter((l) => !who || l.employee_id === who)} onPerson={onPerson} />
            : list.length ? <ul className="pp-lrows">{list.map(row)}</ul>
            : <Empty title={view === 'pending' ? 'Nothing waiting for a decision' : view === 'past' ? 'No past leave' : 'Nobody has leave coming up'}>{view === 'pending' ? (d.can_decide ? 'New requests show here for you to approve or decline.' : 'Your own requests show here until an admin decides.') : who ? 'Try Everyone.' : 'Approved leave shows here as soon as it is approved.'}</Empty>}
        </section>
      </div>
      <aside className="col" style={{ gap: 14 }}>
        <section className="panel pp-ask"><div className="pp-sec-h"><h3>Ask for leave</h3></div>
          {d.my_employee_id ? (asking ? <AskForm onDone={(ok) => { setAsking(false); if (ok) refresh(); }} /> : <><p className="muted">An admin approves or declines. Your reason is only seen by you and admins.</p><button type="button" className="btn primary" onClick={() => setAsking(true)}><Icon.plus size={15} />New request</button></>)
            : <p className="muted">You are not in the directory yet, so you cannot ask for leave here. An admin adds you and links your sign-in.</p>}</section>
        <section className="panel"><div className="pp-sec-h"><h3>Out today</h3></div>{d.today.length ? <ul className="pp-lmini">{d.today.map((l) => <li key={l.id}><button type="button" onClick={() => onPerson(l.employee_id)}><PAvatar p={l} size={26} /><span><b>{l.full_name}</b><small>until {span({ ...l, start_date: l.end_date })}</small></span></button></li>)}</ul> : <p className="faint">Everyone is in today.</p>}</section>
      </aside>
    </div>
  );
}

function AskForm({ onDone }: { onDone: (ok: boolean) => void }) {
  const toast = useToast(); const [f, setF] = useState({ kind: 'CASUAL', start_date: todayIST(), end_date: todayIST(), half_day: false, reason: '' }); const [busy, setBusy] = useState(false);
  return <form className="col" style={{ gap: 10 }} onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { const r = await api.post('/api/hr/leave', { ...f, end_date: f.half_day ? f.start_date : f.end_date }); toast(`Asked for ${days(r.days)} of leave. An admin decides.`); onDone(true); } catch (x: any) { toast(x.message, { err: true }); setBusy(false); } }}>
    <label className="field"><span>Kind</span><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <div className="pp-grid"><label className="field"><span>From</span><input type="date" required value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: e.target.value > f.end_date ? e.target.value : f.end_date })} /></label>
      {!f.half_day && <label className="field"><span>To</span><input type="date" required min={f.start_date} value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></label>}</div>
    <label className="row" style={{ gap: 8 }}><input type="checkbox" className="check" checked={f.half_day} onChange={(e) => setF({ ...f, half_day: e.target.checked })} />Half a day</label>
    <label className="field"><span>Reason (optional, private)</span><input maxLength={1000} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
    <div className="row"><button className="btn primary" disabled={busy}>{busy && <Spinner />}Ask for leave</button><button type="button" className="btn ghost" onClick={() => onDone(false)}>Cancel</button></div>
  </form>;
}

function Calendar({ month, setMonth, items, onPerson }: { month: string; setMonth: (m: string) => void; items: L[]; onPerson: (id: string) => void }) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1)); const lead = (first.getUTCDay() + 6) % 7; const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Array.from({ length: Math.ceil((lead + n) / 7) * 7 }, (_, i) => { const day = i - lead + 1; return day >= 1 && day <= n ? `${month}-${String(day).padStart(2, '0')}` : null; });
  const shift = (k: number) => { const d = new Date(Date.UTC(y, m - 1 + k, 1)); setMonth(d.toISOString().slice(0, 7)); };
  const today = todayIST();
  return <div className="pp-cal">
    <div className="pp-cal-head"><button type="button" className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month"><Icon.left size={15} /></button>
      <b>{first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</b>
      <button type="button" className="icon-btn" onClick={() => shift(1)} aria-label="Next month"><Icon.right size={15} /></button>
      <button type="button" className="btn tiny" onClick={() => setMonth(today.slice(0, 7))}>This month</button></div>
    <div className="pp-cal-grid" role="grid" aria-label="Leave this month">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="pp-cal-dow" role="columnheader">{d}</span>)}
      {cells.map((c, i) => { const here = c ? items.filter((l) => l.start_date <= c && l.end_date >= c) : []; const we = i % 7 >= 5;
        return <div key={i} role="gridcell" className={`pp-cal-day${c ? '' : ' blank'}${c === today ? ' today' : ''}${we ? ' we' : ''}`} aria-label={c ? `${c}: ${here.length ? here.map((l) => l.full_name).join(', ') + ' out' : 'nobody out'}` : undefined}>
          {c && <span className="pp-cal-n">{Number(c.slice(8))}</span>}
          {here.slice(0, 3).map((l) => <button key={l.id} type="button" className={`pp-cal-ev s-${l.status}`} onClick={() => onPerson(l.employee_id)} title={`${l.full_name}: ${span(l)}${l.status === 'PENDING' ? ' (waiting)' : ''}`}>{l.full_name.split(' ')[0]}</button>)}
          {here.length > 3 && <small className="faint">+{here.length - 3} more</small>}</div>; })}</div>
    <p className="faint pp-legend">Approved leave is solid; requests still waiting for a decision are dashed.</p>
  </div>;
}
