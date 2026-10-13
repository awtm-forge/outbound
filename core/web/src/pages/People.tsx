import { useState } from 'react';
import { api } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useLoad } from '../ui/hooks.ts';
import { Icon } from '../ui/icons.tsx';
import { useToast } from '../ui/toast.tsx';
import { Badge, Failure, Loading, Spinner, dayLabel, initials, inr, todayIST, toPaise, type Tone } from '../ui/kit.tsx';
import { Crumbs } from '../ui/chrome.tsx';
import { useConfirm } from '../ui/overlay.tsx';
import { isAdmin, useMe } from '../session.tsx';

const TYPE: Record<string, string> = { FULL_TIME: 'Full time', PART_TIME: 'Part time', CONTRACTOR: 'Contractor', INTERN: 'Intern' };
const STATUS: Record<string, string> = { ACTIVE: 'Active', ON_LEAVE: 'On leave', EXITED: 'Left' };
const KIND: Record<string, string> = { CASUAL: 'Casual', SICK: 'Sick', EARNED: 'Earned', UNPAID: 'Unpaid', OTHER: 'Other' };
export { People } from './people/PeoplePage.tsx';
const LEAVE_STATUS: Record<string, string> = { PENDING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Declined', CANCELLED: 'Cancelled' };
const LEAVE_TONE: Record<string, Tone> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'neutral', CANCELLED: 'neutral' };
const days = (d: string) => { const n = Number(d); return `${n} ${n === 1 ? 'day' : 'days'}`; };
const span = (l: any) => (l.start_date === l.end_date ? dayLabel(l.start_date) + (l.half_day ? ', half day' : '') : `${dayLabel(l.start_date)} to ${dayLabel(l.end_date)}`);
// pay is shown monthly, with the year beside it; arithmetic in BigInt paise
export function payLine(p: { amount_paise: string; period: string; currency: string }) {
  const a = BigInt(p.amount_paise); const monthly = p.period === 'MONTHLY' ? a : a / 12n; const annual = p.period === 'ANNUAL' ? a : a * 12n;
  const fmt = (v: bigint) => (p.currency === 'INR' ? inr(v.toString()) : `${p.currency} ${(v / 100n).toLocaleString('en-IN')}`);
  return `${fmt(monthly)} a month · ${fmt(annual)} a year`;
}

export function Person({ id }: { id: string }) {
  const me = useMe(); const toast = useToast(); const ask = useConfirm(); const admin = isAdmin(me);
  const { data, error, loading, reload } = useLoad(() => api.get(`/api/hr/employees/${id}`), [id]);
  const { go } = useRouter();
  if (loading && !data) return <div className="page"><Loading rows={5} /></div>;
  if (error) return <div className="page"><Crumbs items={[{ to: '/people', label: 'People' }, { label: 'Person' }]} /><Failure error={error} retry={reload} /></div>;
  const e = data;
  const cancel = async (l: any) => { if (!(await ask({ title: `Cancel leave on ${span(l)}?`, body: 'The days go back. To take them later, ask again.', confirm: 'Cancel leave', cancel: 'Keep it', tone: 'danger' }))) return; try { await api.post(`/api/hr/leave/${l.id}/cancel`); toast('Leave cancelled.'); reload(true); } catch (x: any) { toast(x.message, { err: true }); } };
  return (
    <div className="page">
      <div className="head"><div className="row" style={{ alignItems: 'flex-end', gap: 'var(--s-4)' }}><div className="avatar" aria-hidden="true" style={{ width: 56, height: 56, fontSize: 20 }}>{initials(e.full_name)}</div>
        <div><Crumbs items={[{ to: '/people', label: 'People' }, { label: e.full_name }]} /><h1 style={{ marginTop: 6 }}>{e.full_name}</h1><p>{[e.job_title, e.department].filter(Boolean).join(', ') || 'No role set'}</p></div></div>
        {(admin || e.user_id === me.id) && <button className="btn" onClick={() => go(`/people?person=${e.id}&edit=1`)}><Icon.edit size={15} />Edit profile</button>}</div>
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
