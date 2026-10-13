import { useState } from 'react';
import { api } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useLoad } from '../ui/hooks.ts';
import { Icon } from '../ui/icons.tsx';
import { useToast } from '../ui/toast.tsx';
import { Badge, Empty, Failure, Loading, Spinner, ago, dayLabel, initials, inr, todayIST, toPaise, type Tone } from '../ui/kit.tsx';
import { Crumbs } from '../ui/chrome.tsx';
import { useConfirm } from '../ui/overlay.tsx';
import { isAdmin, useMe, useTeam } from '../session.tsx';

const TYPE: Record<string, string> = { FULL_TIME: 'Full time', PART_TIME: 'Part time', CONTRACTOR: 'Contractor', INTERN: 'Intern' };
const STATUS: Record<string, string> = { ACTIVE: 'Active', ON_LEAVE: 'On leave', EXITED: 'Left' };
const KIND: Record<string, string> = { CASUAL: 'Casual', SICK: 'Sick', EARNED: 'Earned', UNPAID: 'Unpaid', OTHER: 'Other' };
const LEAVE_STATUS: Record<string, string> = { PENDING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Declined', CANCELLED: 'Cancelled' };
const STATUS_TONE: Record<string, Tone> = { ACTIVE: 'success', ON_LEAVE: 'warning', EXITED: 'neutral' };
const LEAVE_TONE: Record<string, Tone> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'neutral', CANCELLED: 'neutral' };
const days = (d: string) => { const n = Number(d); return `${n} ${n === 1 ? 'day' : 'days'}`; };
const span = (l: any) => (l.start_date === l.end_date ? dayLabel(l.start_date) + (l.half_day ? ', half day' : '') : `${dayLabel(l.start_date)} to ${dayLabel(l.end_date)}`);
// pay is shown monthly, with the year beside it; arithmetic in BigInt paise
export function payLine(p: { amount_paise: string; period: string; currency: string }) {
  const a = BigInt(p.amount_paise); const monthly = p.period === 'MONTHLY' ? a : a / 12n; const annual = p.period === 'ANNUAL' ? a : a * 12n;
  const fmt = (v: bigint) => (p.currency === 'INR' ? inr(v.toString()) : `${p.currency} ${(v / 100n).toLocaleString('en-IN')}`);
  return `${fmt(monthly)} a month · ${fmt(annual)} a year`;
}

export function People() {
  const { search, go } = useRouter(); const tab = search.get('tab') ?? 'directory'; const me = useMe();
  return (
    <div className="page">
      <div className="head"><div><h1>People</h1><p>Who is on the team, who they report to, and who is out.{isAdmin(me) ? ' Pay is shown to admins only.' : ''}</p></div>
        <div className="tabs" role="tablist">{[['directory', 'Directory'], ['leave', 'Leave']].map(([k, l]) =>
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => go(k === 'directory' ? '/people' : `/people?tab=${k}`, true)}>{l}</button>)}</div></div>
      {tab === 'leave' ? <Leave /> : <Directory />}
    </div>
  );
}

function Directory() {
  const me = useMe(); const { go } = useRouter(); const [all, setAll] = useState(false); const [adding, setAdding] = useState(false);
  const { data, error, loading, reload } = useLoad(() => api.get<any[]>(`/api/hr/employees${all ? '?all=1' : ''}`), [all]);
  const admin = isAdmin(me);
  return (
    <>
      <div className="row wrap"><label className="row" style={{ gap: 8 }}><input type="checkbox" className="check" checked={all} onChange={(e) => setAll(e.target.checked)} />Include people who have left</label>
        {admin && <button className="btn right" onClick={() => setAdding(!adding)}><Icon.plus size={16} />Add a person</button>}</div>
      {adding && <EmployeeForm onDone={(id) => { setAdding(false); if (id) go(`/people/${id}`); else reload(true); }} />}
      {loading && !data ? <Loading kind="table" rows={5} /> : error ? <Failure error={error} retry={reload} /> : !data!.length ? <div className="card"><Empty title="Nobody here yet">{admin ? 'Add the team, starting with yourself.' : 'An admin adds people here.'}</Empty></div> :
        <div className="card flush scrollx"><table className="t stack">
          <thead><tr><th>Person</th><th>Role</th><th>Reports to</th><th>Joined</th><th>Status</th>{admin && <th>Pay</th>}</tr></thead>
          <tbody>{data!.map((e) => <tr key={e.id} className="click" onClick={() => go(`/people/${e.id}`)}>
            <td data-label="Person"><div className="row"><div className="avatar" aria-hidden="true">{initials(e.full_name)}</div><div><Link to={`/people/${e.id}`} style={{ fontWeight: 600, textDecoration: 'none' }} onClick={(x) => x.stopPropagation()}>{e.full_name}</Link><div className="sub">{e.work_email ?? e.location ?? ''}</div></div></div></td>
            <td data-label="Role">{e.job_title ?? <span className="sub">No title</span>}<div className="sub">{[e.department, TYPE[e.employment_type]].filter(Boolean).join(' · ')}</div></td>
            <td data-label="Reports to" className="sub">{e.manager_name ?? 'Nobody'}</td><td data-label="Joined" className="sub">{e.start_date ? dayLabel(e.start_date) : 'Not set'}</td>
            <td data-label="Status"><Badge tone={STATUS_TONE[e.status]}>{STATUS[e.status]}</Badge></td>
            {admin && <td data-label="Pay" className="sub num">{e.pay ? payLine(e.pay).split(' · ')[0] : 'Not set'}</td>}</tr>)}</tbody></table></div>}
    </>
  );
}

function EmployeeForm({ e, onDone }: { e?: any; onDone: (id?: string) => void }) {
  const toast = useToast(); const team = useTeam(); const people = useLoad(() => api.get<any[]>('/api/hr/employees'));
  const keys = ['full_name', 'user_id', 'work_email', 'phone', 'job_title', 'department', 'location', 'employment_type', 'status', 'start_date', 'end_date', 'manager_id'] as const;
  const [f, setF] = useState<Record<string, string>>(Object.fromEntries(keys.map((k) => [k, e?.[k] ?? ({ employment_type: 'FULL_TIME', status: 'ACTIVE' } as any)[k] ?? ''])));
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (x: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: x.target.value });
  const save = async (x: React.FormEvent) => {
    x.preventDefault(); setBusy(true);
    const body = { ...f, user_id: f.user_id || null, manager_id: f.manager_id || null };
    try { if (e) { await api.patch(`/api/hr/employees/${e.id}`, body); toast('Details saved.'); onDone(); } else { const r = await api.post('/api/hr/employees', body); toast(`Added ${r.full_name}.`); onDone(r.id); } }
    catch (err: any) { toast(err.message, { err: true }); setBusy(false); }
  };
  return (
    <form className="card col" onSubmit={save}><h2>{e ? 'Edit details' : 'Add a person'}</h2>
      <div className="grid-form">
        <label className="field"><span>Full name</span><input required minLength={2} value={f.full_name} onChange={set('full_name')} /></label>
        <label className="field"><span>Job title</span><input value={f.job_title} onChange={set('job_title')} /></label>
        <label className="field"><span>Department</span><input value={f.department} onChange={set('department')} /></label>
        <label className="field"><span>Reports to</span><select value={f.manager_id} onChange={set('manager_id')}><option value="">Nobody</option>{(people.data ?? []).filter((p) => p.id !== e?.id).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
        <label className="field"><span>Work email</span><input type="email" value={f.work_email} onChange={set('work_email')} /></label>
        <label className="field"><span>Phone</span><input value={f.phone} onChange={set('phone')} /></label>
        <label className="field"><span>Location</span><input value={f.location} onChange={set('location')} /></label>
        <label className="field"><span>Sign-in</span><select value={f.user_id} onChange={set('user_id')}><option value="">None</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}</select></label>
        <label className="field"><span>Type</span><select value={f.employment_type} onChange={set('employment_type')}>{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>Status</span><select value={f.status} onChange={set('status')}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>Joined</span><input type="date" value={f.start_date} onChange={set('start_date')} /></label>
        <label className="field"><span>Left</span><input type="date" value={f.end_date} onChange={set('end_date')} /></label>
      </div>
      <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>Linking a sign-in lets the person ask for leave and see their own record.</p>
      <div className="row"><button className="btn primary" disabled={busy}>{busy && <Spinner />}{e ? 'Save details' : 'Add'}</button><button type="button" className="btn ghost" onClick={() => onDone()}>Cancel</button></div>
    </form>
  );
}

export function Person({ id }: { id: string }) {
  const me = useMe(); const toast = useToast(); const ask = useConfirm(); const admin = isAdmin(me);
  const { data, error, loading, reload } = useLoad(() => api.get(`/api/hr/employees/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  if (loading && !data) return <div className="page"><Loading rows={5} /></div>;
  if (error) return <div className="page"><Crumbs items={[{ to: '/people', label: 'People' }, { label: 'Person' }]} /><Failure error={error} retry={reload} /></div>;
  const e = data;
  const cancel = async (l: any) => { if (!(await ask({ title: `Cancel leave on ${span(l)}?`, body: 'The days go back. To take them later, ask again.', confirm: 'Cancel leave', cancel: 'Keep it', tone: 'danger' }))) return; try { await api.post(`/api/hr/leave/${l.id}/cancel`); toast('Leave cancelled.'); reload(true); } catch (x: any) { toast(x.message, { err: true }); } };
  return (
    <div className="page">
      <div className="head"><div className="row" style={{ alignItems: 'flex-end', gap: 'var(--s-4)' }}><div className="avatar" aria-hidden="true" style={{ width: 56, height: 56, fontSize: 20 }}>{initials(e.full_name)}</div>
        <div><Crumbs items={[{ to: '/people', label: 'People' }, { label: e.full_name }]} /><h1 style={{ marginTop: 6 }}>{e.full_name}</h1><p>{[e.job_title, e.department].filter(Boolean).join(', ') || 'No role set'}</p></div></div>
        {admin && <button className="btn" onClick={() => setEditing(!editing)}><Icon.edit size={15} />Edit details</button>}</div>
      {editing && <EmployeeForm e={e} onDone={() => { setEditing(false); reload(true); }} />}
      <div className="prospect-grid">
        <div className="col" style={{ gap: 'var(--s-5)' }}>
          <section className="card"><dl className="kv">
            <dt>Status</dt><dd>{STATUS[e.status]}</dd><dt>Type</dt><dd>{TYPE[e.employment_type]}</dd>
            <dt>Reports to</dt><dd>{e.manager_id ? <Link to={`/people/${e.manager_id}`}>{e.manager_name}</Link> : 'Nobody'}</dd>
            <dt>Joined</dt><dd>{e.start_date ? dayLabel(e.start_date) : 'Not set'}</dd>{e.end_date && <><dt>Left</dt><dd>{dayLabel(e.end_date)}</dd></>}
            <dt>Email</dt><dd>{e.work_email ? <a href={`mailto:${e.work_email}`}>{e.work_email}</a> : 'Not set'}</dd><dt>Phone</dt><dd>{e.phone ?? 'Not set'}</dd><dt>Location</dt><dd>{e.location ?? 'Not set'}</dd>
          </dl></section>
          {e.reports.length > 0 && <section className="card col"><h2>Reports to {e.full_name.split(' ')[0]}</h2><div className="chips">{e.reports.map((r: any) => <Link key={r.id} className="chip" to={`/people/${r.id}`}>{r.full_name}</Link>)}</div></section>}
          {(admin || e.user_id === me.id) && <section className="card col"><h2>Leave</h2>{e.leave.length ? e.leave.map((l: any) => <div key={l.id} className="row between wrap" style={{ padding: '6px 0', borderBottom: '1px solid var(--hairline-soft)' }}>
            <span>{span(l)} <span className="faint">· {KIND[l.kind]} · {days(l.days)}</span></span>
            <span className="row"><Badge tone={LEAVE_TONE[l.status]}>{LEAVE_STATUS[l.status]}</Badge>{['PENDING', 'APPROVED'].includes(l.status) && l.end_date >= todayIST() && <button className="btn sm ghost" onClick={() => cancel(l)}>Cancel leave</button>}</span></div>) : <p className="faint">No leave asked for.</p>}</section>}
        </div>
        {admin && <Pay e={e} reload={() => reload(true)} />}
      </div>
    </div>
  );
}

// Admins only: the server sends no pay to anyone else, and this panel is not drawn for them either.
function Pay({ e, reload }: { e: any; reload: () => void }) {
  const toast = useToast(); const ask = useConfirm(); const [f, setF] = useState({ amount: '', period: 'MONTHLY', effective_from: todayIST(), note: '' }); const [busy, setBusy] = useState(false);
  const list: any[] = e.compensation ?? []; const current = list.find((c) => c.effective_from <= todayIST());
  const add = async (x: React.FormEvent) => {
    x.preventDefault(); const amount_paise = toPaise(f.amount); if (!amount_paise || amount_paise === 'invalid' || amount_paise === '0') return toast('Write the amount in rupees, like 45,000.', { err: true });
    setBusy(true);
    try { await api.post(`/api/hr/employees/${e.id}/compensation`, { amount_paise, period: f.period, effective_from: f.effective_from, note: f.note }); setF({ ...f, amount: '', note: '' }); toast('Pay recorded.'); reload(); }
    catch (err: any) { toast(err.message, { err: true }); } finally { setBusy(false); }
  };
  const remove = async (c: any) => { if (!(await ask({ title: `Remove the pay record from ${dayLabel(c.effective_from)}?`, body: `${payLine(c).split(' · ')[0]}. Use this for mistakes only; a change in pay should be recorded as a new row.`, confirm: 'Remove record', tone: 'danger' }))) return; try { await api.del(`/api/hr/compensation/${c.id}`); toast('Pay record removed.'); reload(); } catch (err: any) { toast(err.message, { err: true }); } };
  return (
    <section className="card col" aria-label="Pay, admins only">
      <div className="row between"><h2>Pay</h2><Badge tone="warning">Admins only</Badge></div>
      {current ? <div className="notice" style={{ padding: 'var(--s-4)' }}><p className="kick">Current, from {dayLabel(current.effective_from)}</p><p style={{ fontSize: 'var(--fs-3)', fontWeight: 700, marginTop: 4 }} className="num">{payLine(current).split(' · ')[0]}</p><p className="faint num">{payLine(current).split(' · ')[1]}</p></div>
        : <p className="faint">No pay recorded yet.</p>}
      {list.length > 0 && <div className="timeline">{list.map((c) => <div key={c.id} className="ev"><span className={`dot ${c === current ? 'hot' : ''}`} aria-hidden="true" /><span><span className="num">{payLine(c).split(' · ')[0]}</span> <span className="faint">from {dayLabel(c.effective_from)}{c.effective_from > todayIST() ? ' (upcoming)' : ''}{c.note ? ` · ${c.note}` : ''}</span></span>
        <button className="btn sm ghost" onClick={() => remove(c)} aria-label={`Remove pay record from ${dayLabel(c.effective_from)}`}><Icon.x size={13} /></button></div>)}</div>}
      <form className="col" onSubmit={add}><div className="grid-form">
        <label className="field"><span>Amount, ₹</span><input inputMode="decimal" required value={f.amount} onChange={(x) => setF({ ...f, amount: x.target.value })} /></label>
        <label className="field"><span>Per</span><select value={f.period} onChange={(x) => setF({ ...f, period: x.target.value })}><option value="MONTHLY">Month</option><option value="ANNUAL">Year</option></select></label>
        <label className="field"><span>From</span><input type="date" required value={f.effective_from} onChange={(x) => setF({ ...f, effective_from: x.target.value })} /></label>
      </div><label className="field"><span>Note</span><input value={f.note} onChange={(x) => setF({ ...f, note: x.target.value })} placeholder="Joining, annual review, promotion" /></label>
        <div><button className="btn primary" disabled={busy}>{busy && <Spinner />}Record pay</button></div></form>
      <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>Each change is a new row; history is kept. The activity log records that pay changed, never the amount.</p>
    </section>
  );
}

function Leave() {
  const me = useMe(); const toast = useToast(); const admin = isAdmin(me);
  const mine = useLoad(() => api.get<any[]>('/api/hr/leave?mine=1'));
  const all = useLoad(() => (admin ? api.get<any[]>('/api/hr/leave') : Promise.resolve([] as any[])), [admin]);
  const out = useLoad(() => api.get<any[]>('/api/hr/out'));
  const record = useLoad(() => api.get<any>('/api/hr/me'));
  const [f, setF] = useState({ kind: 'CASUAL', start_date: todayIST(), end_date: todayIST(), half_day: false, reason: '' }); const [busy, setBusy] = useState(false);
  const reloadAll = () => { mine.reload(true); all.reload(true); out.reload(true); };
  const ask = async (x: React.FormEvent) => {
    x.preventDefault(); setBusy(true);
    try { const r = await api.post('/api/hr/leave', { ...f, end_date: f.half_day ? f.start_date : f.end_date }); toast(`Asked for ${days(r.days)} of leave. An admin decides.`); reloadAll(); }
    catch (err: any) { toast(err.message, { err: true }); } finally { setBusy(false); }
  };
  const decide = async (id: string, action: 'APPROVE' | 'REJECT') => { try { await api.post(`/api/hr/leave/${id}/decision`, { action }); toast(action === 'APPROVE' ? 'Leave approved.' : 'Leave declined.'); reloadAll(); } catch (err: any) { toast(err.message, { err: true }); } };
  const pending = (all.data ?? []).filter((l) => l.status === 'PENDING');
  return (
    <div className="prospect-grid">
      <div className="col" style={{ gap: 'var(--s-5)' }}>
        {admin && <section className="section"><h2 className="section-title">Waiting for a decision</h2>{pending.length ? <div className="card flush"><table className="t"><tbody>{pending.map((l) => <tr key={l.id}>
          <td><Link to={`/people/${l.employee_id}`} style={{ fontWeight: 600, textDecoration: 'none' }}>{l.full_name}</Link><div className="sub">{span(l)} · {KIND[l.kind]} · {days(l.days)}{l.reason ? ` · ${l.reason}` : ''}</div></td>
          <td><div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn sm" onClick={() => decide(l.id, 'APPROVE')}><Icon.check size={14} />Approve</button><button className="btn sm ghost" onClick={() => decide(l.id, 'REJECT')}>Decline</button></div></td></tr>)}</tbody></table></div>
          : <div className="card"><p className="faint">Nothing waiting.</p></div>}</section>}
        <section className="section"><h2 className="section-title">Your leave</h2>
          {record.data === null && !record.loading ? <div className="card"><p className="muted">You have no HR record yet, so you cannot ask for leave here. An admin adds you under People and links your sign-in.</p></div> :
          <form className="card col" onSubmit={ask}><div className="grid-form">
            <label className="field"><span>Kind</span><select value={f.kind} onChange={(x) => setF({ ...f, kind: x.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field"><span>From</span><input type="date" required value={f.start_date} onChange={(x) => setF({ ...f, start_date: x.target.value, end_date: x.target.value > f.end_date ? x.target.value : f.end_date })} /></label>
            {!f.half_day && <label className="field"><span>To</span><input type="date" required min={f.start_date} value={f.end_date} onChange={(x) => setF({ ...f, end_date: x.target.value })} /></label>}
          </div>
            <label className="row" style={{ gap: 8 }}><input type="checkbox" className="check" checked={f.half_day} onChange={(x) => setF({ ...f, half_day: x.target.checked })} />Half a day</label>
            <label className="field"><span>Note for the approver (optional)</span><input value={f.reason} maxLength={1000} onChange={(x) => setF({ ...f, reason: x.target.value })} /></label>
            <div><button className="btn primary" disabled={busy}>{busy && <Spinner />}Ask for leave</button></div></form>}
          {(mine.data ?? []).map((l) => <div key={l.id} className="card row between wrap" style={{ padding: 'var(--s-3) var(--s-4)' }}><span>{span(l)} <span className="faint">· {KIND[l.kind]} · {days(l.days)}</span></span>
            <span className="row"><Badge tone={LEAVE_TONE[l.status]}>{LEAVE_STATUS[l.status]}</Badge>{l.decided_by_name && <span className="faint" style={{ fontSize: 'var(--fs-0)' }}>{l.decided_by_name}, {ago(l.decided_at)}</span>}</span></div>)}
        </section>
      </div>
      <section className="card col"><h2>Out in the next 30 days</h2>{out.data?.length ? out.data.map((l, i) => <div key={i} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--hairline-soft)' }}>
        <span className="row"><span className="avatar sm" aria-hidden="true">{initials(l.full_name)}</span><Link to={`/people/${l.employee_id}`} style={{ textDecoration: 'none' }}>{l.full_name}</Link></span><span className="faint" style={{ fontSize: 'var(--fs-0)' }}>{span(l)}{admin && l.kind ? ` · ${KIND[l.kind]}` : ''}</span></div>)
        : <p className="faint">Nobody has leave in the next 30 days.</p>}</section>
    </div>
  );
}
