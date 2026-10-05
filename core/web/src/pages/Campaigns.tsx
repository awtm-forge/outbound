import { useState } from 'react';
import { api } from '../api.ts';
import { Link } from '../router.tsx';
import { useLoad } from '../ui/hooks.ts';
import { Icon } from '../ui/icons.tsx';
import { useToast } from '../ui/toast.tsx';
import { Failure, Loading, Spinner, ago, inr, pct } from '../ui/kit.tsx';

const DECISION: Record<string, string> = { STOP: 'Stop', CONTINUE: 'Keep going', SCALE: 'Scale up', TEST: 'Test a change', RESEARCH_MORE: 'Research more' };
export function Campaigns() {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api.get('/api/campaigns'));
  const [busy, setBusy] = useState(false);
  const analyse = async () => { setBusy(true); try { await api.post('/api/analytics/weekly'); toast('Read the numbers again. Recommendations are updated.'); reload(true); } catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(false); } };
  if (loading && !data) return <div className="page"><Loading rows={5} /></div>;
  if (error) return <div className="page"><Failure error={error} retry={reload} /></div>;
  return (
    <div className="page">
      <div className="head"><div><h1>Campaigns</h1><p>One market, one buyer, one problem, one offer each. Judged on replies, meetings and money, never on opens. Recommendations only: nothing here changes how much is sent.</p></div>
        <button className="btn" onClick={analyse} disabled={busy}>{busy ? <Spinner /> : <Icon.spark size={16} />}Read the numbers {data.analysed_at ? <span className="faint mono" style={{ fontSize: 11 }}>last {ago(data.analysed_at)}</span> : null}</button></div>
      <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
        {(data.campaigns as any[]).map((c) => { const m = c.metrics ?? {}; const r = c.recommendation;
          return <div key={c.code} className="card col" style={{ gap: 'var(--s-4)' }}>
            <div className="row between"><div><div className="kick ember">{c.code}</div><div style={{ fontWeight: 650, fontSize: 'var(--fs-2)', marginTop: 6 }}>{c.vertical}</div></div><span className={`tag ${c.status === 'ACTIVE' ? 'ember' : 'dim'}`}>{c.status.toLowerCase()}</span></div>
            <p className="muted" style={{ fontSize: 'var(--fs-0)' }}>{c.offer}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--s-3)' }}>{([['Found', m.accounts_found], ['Sent', m.emails_sent], ['Replies', m.replies], ['Meetings', m.meetings_booked]] as const).map(([k, v]) =>
              <div key={k}><div className="kick">{k}</div><div style={{ fontSize: 'var(--fs-4)', fontWeight: 700 }} className="num">{v ?? 0}</div></div>)}</div>
            <div className="row wrap" style={{ fontSize: 'var(--fs-0)' }}><span className="muted">Reply rate <b className="num" style={{ color: 'var(--ink)' }}>{pct(m.reply_rate)}</b></span><span className="muted">Positive <b className="num" style={{ color: 'var(--ink)' }}>{pct(m.positive_reply_rate)}</b></span><span className="muted">Bounce <b className="num" style={{ color: 'var(--ink)' }}>{pct(m.bounce_rate)}</b></span><span className="muted">Won <b className="num" style={{ color: 'var(--ink)' }}>{m.wins ?? 0}{m.wins ? ` · ${inr(m.revenue_paise)}` : ''}</b></span></div>
            {r && <div className="proof"><div className="row"><span className="tag solid">{DECISION[r.decision] ?? r.decision}</span></div><span className="muted" style={{ fontSize: 'var(--fs-0)' }}>{r.reason}{r.suggested_test ? ` ${r.suggested_test}` : ''}</span></div>}
            <div className="row" style={{ marginTop: 'auto' }}><Link className="btn sm ghost" to={`/pipeline?campaign=${c.code}&view=active`}>Companies <Icon.arrow size={14} /></Link><span className="faint mono right" style={{ fontSize: 11 }}>{c.country} · {c.sender ?? 'no sender'}</span></div>
          </div>; })}
      </div>
      <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>Campaigns are defined in core/config/campaigns.json. Add one there and restart the core; no code changes.</p>
      <Suppression />
    </div>
  );
}
function Suppression() {
  const toast = useToast(); const { data, reload } = useLoad(() => api.get<any[]>('/api/suppression'));
  const [v, setV] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); const val = v.trim().toLowerCase(); if (!val) return; setBusy(true);
    try { const r = await api.post('/api/suppression', val.includes('@') ? { email: val, reason: reason || 'manual' } : { domain: val.replace(/^https?:\/\/(www\.)?/, '').split('/')[0], reason: reason || 'manual' }); toast(r.already ? 'Already on the list.' : `Added. ${r.prospects_affected} prospect${r.prospects_affected === 1 ? '' : 's'} stopped.`); setV(''); setReason(''); reload(true); }
    catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(false); }
  };
  return (
    <section className="section">
      <div><h2 className="section-title" style={{ fontSize: 'var(--fs-3)' }}>Do not contact</h2><p className="muted" style={{ marginTop: 4 }}>Anyone here is never written to again, in any campaign. Unsubscribes and hard bounces land here on their own. Nothing is ever taken off automatically.</p></div>
      <form className="card row wrap" onSubmit={add}><input className="input grow" style={{ minWidth: 240 }} placeholder="name@company.com or company.com" value={v} onChange={(e) => setV(e.target.value)} aria-label="Email or domain" />
        <input className="input" style={{ width: 240 }} placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" /><button className="btn" disabled={busy}>{busy && <Spinner />}<Icon.shield size={16} />Add</button></form>
      {data && data.length > 0 && <div className="card flush"><table className="t"><thead><tr><th>Email or domain</th><th>Reason</th><th>Source</th><th>Since</th></tr></thead>
        <tbody>{data.map((s) => <tr key={s.id}><td className="mono" style={{ fontSize: 13 }}>{s.email ?? s.domain}</td><td>{s.reason}</td><td className="sub">{s.source}</td><td className="sub">{ago(s.created_at)}</td></tr>)}</tbody></table></div>}
    </section>
  );
}
