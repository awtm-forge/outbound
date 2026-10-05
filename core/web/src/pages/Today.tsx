import { api, type Me } from '../api.ts';
import { Link } from '../router.tsx';
import { useLoad } from '../ui/hooks.ts';
import { Icon } from '../ui/icons.tsx';
import { Loading, Failure, ago, pct, inr } from '../ui/kit.tsx';

const STAGES: { label: string; statuses: string[] }[] = [
  { label: 'Researching', statuses: ['NEW', 'QUALIFYING', 'RESEARCHING', 'RESEARCH_FURTHER'] },
  { label: 'Qualified', statuses: ['QUALIFIED', 'EMAIL_DRAFTED'] },
  { label: 'In review', statuses: ['PENDING_APPROVAL'] },
  { label: 'Approved', statuses: ['APPROVED', 'SYNCED'] },
  { label: 'Contacted', statuses: ['CONTACTED'] },
  { label: 'Replied', statuses: ['REPLIED'] },
  { label: 'In a deal', statuses: ['MEETING', 'PROPOSAL'] },
  { label: 'Won', statuses: ['WON'] },
];
const ACTION: Record<string, string> = { created: 'came into the pipeline', researched: 'was researched', qualified: 'was scored', suppressed: 'was suppressed', decision_maker_added: 'got a decision maker',
  drafted: 'got an email draft', approve: 'email approved', edit: 'email edited and approved', reject: 'email rejected', research_more: 'sent back for research', synced: 'queued in Saleshandy',
  classified: 'reply was read', handled: 'reply handled', analysed: 'meeting notes analysed' };

export function Today({ me }: { me: Me }) {
  const { data, error, loading, reload } = useLoad(() => api.get('/api/overview'));
  const hour = Number(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  if (loading && !data) return <div className="page"><Loading rows={5} /></div>;
  if (error || !data) return <div className="page"><Failure error={error ?? 'Could not load'} retry={reload} /></div>;
  const c = data.counts; const by = Object.fromEntries((data.stages as any[]).map((s) => [s.status, s.n]));
  const stageN = STAGES.map((s) => s.statuses.reduce((a, k) => a + (by[k] ?? 0), 0)); const max = Math.max(1, ...stageN);
  const waiting = c.drafts + c.replies + c.teardowns;
  const tiles = [
    { to: '/review', n: c.drafts, label: 'Emails to review', hint: c.drafts ? 'Read, edit if needed, approve' : 'Nothing drafted is waiting' },
    { to: '/inbox', n: c.replies, label: c.replies_high ? `Replies, ${c.replies_high} hot` : 'Replies to answer', hint: c.replies ? 'Highest priority first' : 'No replies waiting' },
    { to: '/inbox?tab=teardowns', n: c.teardowns, label: 'Teardowns to approve', hint: 'Two findings, ready to send' },
    { to: '/pipeline?view=needs_contact', n: c.needs_contact, label: 'Need a decision maker', hint: 'Qualified, but no named person yet' },
    { to: '/deals', n: c.meetings, label: 'Meetings coming up', hint: c.meetings ? 'Briefs are ready to read' : 'None booked' },
    { to: '/find', n: c.new_candidates, label: 'Found, not added', hint: 'From your searches' },
  ];
  const camps = (data.campaigns as any[]).filter((x) => x.accounts_found > 0);
  return (
    <div className="page">
      <div className="hello">
        <p className="kick ember">{new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1 style={{ marginTop: 10 }}>{greet}, {me.user}.<br />{waiting ? <><b>{waiting}</b> {waiting === 1 ? 'thing needs' : 'things need'} you.</> : <>Nothing is waiting on you.</>}</h1>
      </div>
      {(c.failures > 0 || c.ai_failures > 0) && <div className="banner err"><Icon.shield /><span>{c.failures} workflow failure{c.failures === 1 ? '' : 's'} and {c.ai_failures} failed AI run{c.ai_failures === 1 ? '' : 's'} in the last 7 days. The operations guide says where to look.</span></div>}
      <section className="tiles" aria-label="What needs you">
        {tiles.map((t) => <Link key={t.label} to={t.to} className={`tile${t.n ? (t.to === '/review' || t.to === '/inbox' ? ' hot' : '') : ' zero'}`}>
          <span className="go"><Icon.arrow /></span><span className="n">{t.n}</span><span className="lbl">{t.label}</span><span className="hint">{t.hint}</span></Link>)}
      </section>
      <section className="section">
        <div className="row between"><h2>Where everyone is</h2><Link to="/pipeline" className="btn sm ghost">Open pipeline <Icon.arrow size={14} /></Link></div>
        <div className="funnel">{STAGES.map((s, i) => <Link key={s.label} className="stage" to={`/pipeline?status=${s.statuses.join(',')}`}>
          <span className="kick">{s.label}</span><span className="n">{stageN[i]}</span><span className="bar"><i style={{ width: `${(stageN[i] / max) * 100}%` }} /></span></Link>)}</div>
      </section>
      <div className="prospect-grid">
        <section className="section">
          <div className="row between"><h2>Campaigns</h2><Link to="/campaigns" className="btn sm ghost">All campaigns <Icon.arrow size={14} /></Link></div>
          <div className="card flush scrollx">{camps.length ? <table className="t"><thead><tr><th>Campaign</th><th className="num">Found</th><th className="num">Sent</th><th className="num">Replies</th><th className="num">Positive</th><th className="num">Meetings</th><th className="num">Won</th></tr></thead>
            <tbody>{camps.map((x) => <tr key={x.code}><td><div style={{ fontWeight: 600 }}>{x.code}</div><div className="sub">{x.vertical}</div></td><td className="num">{x.accounts_found}</td><td className="num">{x.emails_sent}</td><td className="num">{x.replies} <span className="sub">{pct(x.reply_rate)}</span></td><td className="num">{x.positive_replies}</td><td className="num">{x.meetings_booked}</td><td className="num">{x.wins} <span className="sub">{x.wins ? inr(x.revenue_paise) : ''}</span></td></tr>)}</tbody></table>
            : <div className="empty"><h3>No campaign has companies yet</h3><p>Find companies and add them to a campaign to see numbers here.</p><Link className="btn primary" to="/find">Find companies</Link></div>}</div>
        </section>
        <section className="section">
          <h2 className="section-title" style={{ fontSize: 'var(--fs-3)' }}>Recently</h2>
          <div className="card"><div className="feed">{(data.recent as any[]).length ? (data.recent as any[]).map((r, i) => {
            const text = <><span className="ellipsis"><b style={{ fontWeight: 600 }}>{r.company ?? 'A company'}</b> <span className="muted">{ACTION[r.action] ?? r.action.replace(/_/g, ' ')}</span></span><span className="when">{ago(r.created_at)}</span></>;
            return r.prospect_id ? <Link key={i} to={`/prospects/${r.prospect_id}`}>{text}</Link> : <div key={i} className="item">{text}</div>; }) : <p className="muted">Nothing has happened yet.</p>}</div></div>
        </section>
      </div>
    </div>
  );
}
