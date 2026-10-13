import { useState } from 'react';
import { api, type Me } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useLoad } from '../ui/hooks.ts';
import { Icon, Dots } from '../ui/icons.tsx';
import { Menu, MenuItem } from '../ui/menu.tsx';
import { Failure, Skeleton, ago, pct } from '../ui/kit.tsx';
import { Todos } from './Todos.tsx';
import { Rail } from './TodayRail.tsx';

type IconName = keyof typeof Icon;
const STAGES: { label: string; statuses: string[]; icon: IconName; color: string }[] = [
  { label: 'Researching', statuses: ['NEW', 'QUALIFYING', 'RESEARCHING', 'RESEARCH_FURTHER'], icon: 'find', color: 'linear-gradient(90deg, #FDBA74, #FF8A2A)' },
  { label: 'Qualified', statuses: ['QUALIFIED', 'EMAIL_DRAFTED'], icon: 'user', color: '#C084FC' },
  { label: 'In review', statuses: ['PENDING_APPROVAL'], icon: 'file', color: '#38BDF8' },
  { label: 'Approved', statuses: ['APPROVED', 'SYNCED'], icon: 'checkCircle', color: '#4ADE80' },
  { label: 'Contacted', statuses: ['CONTACTED'], icon: 'send', color: '#38BDF8' },
  { label: 'Replied', statuses: ['REPLIED'], icon: 'message', color: '#FF8A2A' },
  { label: 'In a deal', statuses: ['MEETING', 'PROPOSAL'], icon: 'handshake', color: '#FACC15' },
  { label: 'Won', statuses: ['WON'], icon: 'trophy', color: '#4ADE80' },
];
// what each recorded event means, how it is drawn, and in which colour
const EVENTS: Record<string, { text: string; icon: IconName; tone: string }> = {
  created: { text: 'came into the pipeline', icon: 'plus', tone: 'g' }, researched: { text: 'was researched', icon: 'find', tone: 'o' }, qualified: { text: 'was scored', icon: 'target', tone: 'o' },
  suppressed: { text: 'was suppressed', icon: 'shield', tone: 'y' }, decision_maker_added: { text: 'got a decision maker', icon: 'user', tone: 'p' }, drafted: { text: 'got an email draft', icon: 'file', tone: 'c' },
  approve: { text: 'email approved', icon: 'checkCircle', tone: 'g' }, edit: { text: 'email edited and approved', icon: 'checkCircle', tone: 'g' }, reject: { text: 'email rejected', icon: 'x', tone: 'y' },
  research_more: { text: 'sent back for research', icon: 'redo', tone: 'y' }, synced: { text: 'queued in Saleshandy', icon: 'send', tone: 'c' }, classified: { text: 'replied, and the reply was read', icon: 'reply', tone: 'p' },
  handled: { text: 'reply handled', icon: 'check', tone: 'g' }, analysed: { text: 'meeting notes analysed', icon: 'sparkle', tone: 'c' }, research_failed: { text: 'research stopped on an error', icon: 'x', tone: 'y' },
};
// Decorative curves under each KPI. They are drawn shapes, not data: there is no history series to plot.
const SPARKS = ['M0 22 C14 22 22 21 34 21 S56 17 66 18 S90 12 100 9 S114 6 120 1', 'M0 23 C16 23 26 22 38 22 S58 19 70 16 S92 8 104 7 S116 3 120 1',
  'M0 22 C18 22 28 21 40 21 S60 18 72 19 S92 14 102 13 S114 8 120 4', 'M0 23 C14 23 26 22 40 22 S62 20 74 19 S94 13 106 10 S116 6 120 3', 'M0 22 C20 22 30 21 44 21 S66 19 80 17 S100 13 110 11 S118 8 120 7'];

export function Today({ me }: { me: Me }) {
  const { search } = useRouter();
  const overview = useLoad(() => api.get('/api/overview'));
  const camps = useLoad(() => api.get('/api/campaigns'));
  const hour = Number(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const data = overview.data; const c = data?.counts;
  const waiting = c ? c.drafts + c.replies + c.teardowns : 0;
  return (
    <div className="dash">
      <div className="dash-main">
        <div className="hello-row">
          <div><h1>{greet}, {me.name.split(' ')[0]}.</h1>
            <p className="lede">{c && !waiting ? 'Nothing in outbound is waiting on you today.' : 'Here’s what needs your attention today.'}</p></div>
          <figure className="quote-card" style={{ margin: 0 }}><span className="qm" aria-hidden="true">“</span><blockquote style={{ margin: 0 }}><p>“Consistent outreach today creates bigger opportunities tomorrow.”</p></blockquote></figure>
        </div>
        {c && (c.failures > 0 || c.ai_failures > 0) && <div className="banner err"><Icon.shield /><span>{c.failures} workflow failure{c.failures === 1 ? '' : 's'} and {c.ai_failures} failed AI run{c.ai_failures === 1 ? '' : 's'} in the last 7 days. The operations guide says where to look.</span></div>}
        <Todos me={me} />
        {overview.error && !data ? <Failure error={overview.error} retry={overview.reload} /> : <>
          <Kpis c={c} />
          <Pipeline stages={data?.stages} />
          <div className="dash-split">
            <Campaigns data={camps.data} error={camps.error} retry={camps.reload} />
            <Activity recent={data?.recent} />
          </div>
        </>}
      </div>
      <Rail me={me} focusAssistant={search.get('assistant') === '1'} />
    </div>
  );
}

function Kpis({ c }: { c?: any }) {
  const cards = [
    { tone: 'orange', icon: 'mail' as IconName, n: c?.drafts, label: 'Emails to review', hint: c?.drafts ? 'Read, edit if needed, approve' : 'Nothing drafted is waiting', to: '/review' },
    { tone: 'purple', icon: 'reply' as IconName, n: c?.replies, label: c?.replies_high ? `Replies, ${c.replies_high} hot` : 'Replies to answer', hint: c?.replies ? 'Highest priority first' : 'No replies waiting', to: '/inbox' },
    { tone: 'cyan', icon: 'file' as IconName, n: c?.teardowns, label: 'Teardowns to approve', hint: c?.teardowns ? 'Two findings, ready to send' : 'None waiting', to: '/inbox?tab=teardowns' },
    { tone: 'green', icon: 'people' as IconName, n: c?.needs_contact, label: 'Need a decision maker', hint: c?.needs_contact ? 'Qualified, but no named person yet' : 'Every qualified company has one', to: '/pipeline?view=needs_contact' },
    { tone: 'gray', icon: 'calendar' as IconName, n: c?.meetings, label: 'Meetings coming up', hint: c?.meetings ? 'Briefs are ready to read' : 'None booked', to: '/deals' },
  ];
  return (
    <section className="kpis" aria-label="What needs you">
      {cards.map((k, i) => { const I = Icon[k.icon]; return (
        <Link key={k.to} to={k.to} className={`kpi ${k.tone}`}>
          <span className="k-ic"><I size={24} /></span><span className="k-go" aria-hidden="true"><Icon.arrow size={14} /></span>
          {c ? <span className="k-n">{k.n}</span> : <span className="k-n"><Skeleton h={30} w={36} /></span>}
          <span className="k-l">{k.label}</span><span className="k-h">{c ? k.hint : ' '}</span>
          <svg className="k-spark" viewBox="0 0 120 26" preserveAspectRatio="none" aria-hidden="true"><path d="M0 24H120" stroke="currentColor" strokeOpacity="0.14" fill="none" /><path d={SPARKS[i]} stroke="currentColor" strokeWidth="1.6" fill="none" vectorEffect="non-scaling-stroke" /></svg>
        </Link>); })}
    </section>
  );
}

function Pipeline({ stages }: { stages?: any[] }) {
  const by = Object.fromEntries((stages ?? []).map((s) => [s.status, s.n]));
  const n = STAGES.map((s) => s.statuses.reduce((a, k) => a + (by[k] ?? 0), 0)); const max = Math.max(1, ...n);
  return (
    <section className="panel" aria-labelledby="pipe-h">
      <div className="panel-head"><h2 id="pipe-h"><span className="ic"><Icon.sparkle size={20} /></span>Where everyone is</h2>
        <div className="right"><Link to="/pipeline" className="btn tiny">View pipeline <Icon.arrow size={14} /></Link></div></div>
      <div className="stages">{STAGES.map((s, i) => { const I = Icon[s.icon]; return (
        <Link key={s.label} to={`/pipeline?status=${s.statuses.join(',')}`} className="stage-chev" aria-label={`${s.label}: ${stages ? n[i] : 'loading'}`}>
          <span className="in"><span className="s-top"><I size={16} /><span>{s.label}</span></span><span className="s-n">{stages ? n[i] : '·'}</span>
            <span className="s-bar"><i style={{ width: `${stages ? Math.max(n[i]! ? 8 : 0, (n[i]! / max) * 100) : 0}%`, background: s.color }} /></span></span>
        </Link>); })}</div>
    </section>
  );
}

const CAMPAIGN_ICON = (x: any): IconName => { const t = `${x.code} ${x.vertical ?? ''}`.toUpperCase(); return t.includes('-AI-') || t.includes(' AI') ? 'chip' : t.includes('SAAS') ? 'layers' : t.includes('INTERIOR') ? 'home' : t.includes('WEB') ? 'globe' : 'campaigns'; };
function Campaigns({ data, error, retry }: { data?: any; error?: string | null; retry: () => void }) {
  const { go } = useRouter();
  const list = ((data?.campaigns ?? []) as any[]).filter((x) => x.status === 'ACTIVE' || x.status === 'PAUSED' || (x.metrics?.accounts_found ?? 0) > 0);
  return (
    <section className="panel" aria-labelledby="camp-h">
      <div className="panel-head"><h2 id="camp-h">Campaigns</h2><div className="right"><Link to="/campaigns" className="link-accent">All campaigns <Icon.arrow size={14} /></Link></div></div>
      {error && !data ? <div style={{ padding: '0 16px 16px' }}><Failure error={error} retry={retry} /></div>
        : !data ? <div style={{ padding: '0 16px 16px' }} className="col">{[0, 1, 2].map((i) => <Skeleton key={i} h={38} />)}</div>
        : !list.length ? <p className="task-empty">No campaign is active yet. <Link to="/find">Find companies</Link> and add them to a campaign to see numbers here.</p>
        : <div className="scrollx"><table className="ctable">
          <thead><tr><th>Campaign</th><th className="num">Found</th><th className="num">Sent</th><th className="num">Replies</th><th className="num">Positive</th><th className="num">Meetings</th><th className="num">Won</th><th>Status</th><th><span className="sr">Actions</span></th></tr></thead>
          <tbody>{list.map((x, i) => { const m = x.metrics ?? {}; const I = Icon[CAMPAIGN_ICON(x)]; return (
            <tr key={x.code}>
              <td><div className="c-name"><span className={`c-ic${i % 2 ? ' o' : ''}`} aria-hidden="true"><I size={15} /></span><div><b>{x.code}</b><span title={x.vertical}>{x.vertical}</span></div></div></td>
              <td className="num">{m.accounts_found ?? 0}</td><td className="num">{m.emails_sent ?? 0}</td>
              <td className="num">{m.replies ?? 0}{m.emails_sent > 0 && m.reply_rate != null && <span style={{ color: 'var(--ink-faint)' }}> ({pct(m.reply_rate).toLowerCase()})</span>}</td>
              <td className="num">{m.positive_replies ?? 0}</td><td className="num">{m.meetings_booked ?? 0}</td><td className="num">{m.wins ?? 0}</td>
              <td><span className={`state ${x.status}`}>{x.status.charAt(0) + x.status.slice(1).toLowerCase()}</span></td>
              <td><Menu label={`Actions for ${x.code}`} className="icon-btn" button={<Dots vertical size={16} />}>{(close) => <>
                <MenuItem onSelect={() => { close(); go(`/pipeline?campaign=${x.code}&view=active`); }}><Icon.funnel size={15} />Open its companies</MenuItem>
                <MenuItem onSelect={() => { close(); go('/campaigns'); }}><Icon.campaigns size={15} />Open campaign numbers</MenuItem></>}</Menu></td>
            </tr>); })}</tbody></table></div>}
    </section>
  );
}

function Activity({ recent }: { recent?: any[] }) {
  const [all, setAll] = useState(false);
  const list = recent ?? []; const shown = all ? list : list.slice(0, 8); const more = list.length - shown.length;
  return (
    <section className="panel" aria-labelledby="act-h">
      <div className="panel-head"><h2 id="act-h">Recent activity</h2>{list.length > 8 && <div className="right"><button type="button" className="link-accent" onClick={() => setAll(!all)} aria-expanded={all}>{all ? 'Show less' : 'View all'} <Icon.arrow size={14} /></button></div>}</div>
      {!recent ? <div style={{ padding: '0 16px 16px' }} className="col">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={22} />)}</div>
        : !list.length ? <p className="task-empty">Nothing has happened yet. Research, drafts and replies show up here as they happen.</p>
        : <ul className="feed2">{shown.map((r, i) => {
          const e = EVENTS[r.action] ?? { text: String(r.action).replace(/_/g, ' '), icon: 'today' as IconName, tone: 'c' }; const I = Icon[e.icon];
          const body = <><span className={`f-ic tone-${e.tone}`} aria-hidden="true"><I size={12} /></span><span className="f-txt"><b>{r.company ?? 'A company'}</b> {e.text}</span><span className="f-when">{ago(r.created_at)}</span></>;
          return <li key={i}>{r.prospect_id ? <Link to={`/prospects/${r.prospect_id}`}>{body}</Link> : <div>{body}</div>}</li>; })}</ul>}
      {more > 0 && <button type="button" className="feed-more" onClick={() => setAll(true)}><Icon.down size={14} />+{more} more {more === 1 ? 'activity' : 'activities'}</button>}
    </section>
  );
}
