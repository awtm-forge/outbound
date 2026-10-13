import { useEffect, useRef, useState } from 'react';
import { api, type Me } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useLoad } from '../ui/hooks.ts';
import { Icon } from '../ui/icons.tsx';
import { useToast } from '../ui/toast.tsx';
import { initials, todayIST } from '../ui/kit.tsx';
import { useTeam } from '../session.tsx';
import { useChat } from '../chat.tsx';

const IST = 'Asia/Kolkata';
const ymd = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: IST });

// The right-hand column of Today: the month and the calls in it, the assistant, shortcuts, and the team.
export function Rail({ me, focusAssistant }: { me: Me; focusAssistant: boolean }) {
  const deals = useLoad(() => api.get<{ meetings: any[] }>('/api/deals'));
  return (
    <aside className="dash-rail" aria-label="Your day">
      <CalendarPanel meetings={deals.data?.meetings} loading={deals.loading && !deals.data} error={deals.error} />
      <Assistant focus={focusAssistant} />
      <QuickActions />
      <TeamPanel me={me} />
    </aside>
  );
}

function CalendarPanel({ meetings, loading, error }: { meetings?: any[]; loading: boolean; error: string | null }) {
  const today = todayIST();
  // one week, Sunday to Saturday; the arrows move a week at a time
  const sunday = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d; };
  const [start, setStart] = useState(() => sunday(today));
  const cells = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); return { label: d.getUTCDate(), key: d.toISOString().slice(0, 10), out: false }; });
  const mid = new Date(start); mid.setUTCDate(mid.getUTCDate() + 3);
  const booked = new Set((meetings ?? []).filter((x) => x.scheduled_at).map((x) => ymd(new Date(x.scheduled_at))));
  const upcoming = (meetings ?? []).filter((x) => !x.held && x.scheduled_at && new Date(x.scheduled_at).getTime() > Date.now() - 3600_000)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)).slice(0, 3);
  const unscheduled = (meetings ?? []).filter((x) => !x.held && !x.scheduled_at).length;
  const title = mid.toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const shift = (n: number) => setStart((d) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n * 7); return x; });
  const DOTS = ['var(--info)', 'var(--success)', 'var(--warning)'];
  return (
    <section className="panel cal" aria-labelledby="cal-h">
      <div className="cal-head"><h2 id="cal-h" aria-live="polite">{title}</h2>
        <button type="button" className="cal-nav" onClick={() => shift(-1)} aria-label="Previous week"><Icon.left size={16} /></button>
        <button type="button" className="cal-nav" onClick={() => shift(1)} aria-label="Next week"><Icon.right size={16} /></button>
        <Link to="/deals" className="link-accent">View all</Link></div>
      <div className="cal-grid" role="grid" aria-label={`Week of ${cells[0]!.label} ${title}`}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <span key={d} className="dow" role="columnheader">{d}</span>)}
        {cells.map((c) => <span key={c.key} role="gridcell" className={`day${c.out ? ' out' : ''}${c.key === today ? ' today' : ''}${!c.out && booked.has(c.key) ? ' has' : ''}`}
          aria-current={c.key === today ? 'date' : undefined} aria-label={!c.out && booked.has(c.key) ? `${c.label}, a meeting` : undefined}><span>{c.label}</span></span>)}
      </div>
      {loading ? <p className="cal-empty">Loading meetings…</p>
        : error ? <p className="cal-empty">Meetings could not be loaded. {error}</p>
        : upcoming.length ? <ul className="cal-events">{upcoming.map((x, i) => { const at = new Date(x.scheduled_at); return (
          <li key={x.id}><span className="dot2" style={{ background: DOTS[i % 3] }} aria-hidden="true" />
            <span className="when">{at.toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit' }).toUpperCase()}
              <small>{ymd(at) === today ? 'Today' : at.toLocaleDateString('en-IN', { timeZone: IST, weekday: 'short', day: 'numeric', month: 'short' })}</small></span>
            <Link to="/deals" className="what"><b>{x.company}</b><small>{x.contact_name ? `With ${x.contact_name}` : 'Call'}{x.brief ? ' · brief ready' : ''}</small></Link></li>); })}</ul>
        : <p className="cal-empty">No calls booked.{unscheduled ? ` ${unscheduled} ${unscheduled === 1 ? 'meeting has' : 'meetings have'} no time set yet.` : ' When a reply turns into a call, mark it from the Inbox.'}</p>}
    </section>
  );
}

// The assistant points at what the AI already does in this app. What it cannot do yet says so, and does nothing.
function Assistant({ focus }: { focus: boolean }) {
  const { go } = useRouter(); const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (focus) { ref.current?.scrollIntoView({ block: 'center' }); ref.current?.querySelector<HTMLElement>('.assist-item')?.focus(); } }, [focus]);
  const items: { label: string; icon: keyof typeof Icon; to?: string; note: string }[] = [
    { label: 'Summarize unread emails', icon: 'sparkle', to: '/inbox', note: 'Every reply is read by AI: what it means and the next step' },
    { label: 'Find similar companies', icon: 'find', to: '/find', note: 'Search the web for companies like your best fits' },
    { label: 'Draft a follow up', icon: 'reply', to: '/inbox', note: 'Each reply comes with a suggested answer to copy' },
    { label: 'Update campaign status', icon: 'campaigns', note: 'Not available here yet: campaign status is set in the campaign configuration' },
  ];
  return (
    <section ref={ref} id="assistant" className="panel assist" aria-labelledby="ai-h">
      <div className="assist-head"><span style={{ color: 'var(--accent)', display: 'flex' }}><Icon.bolt size={18} /></span><h2 id="ai-h">AI Assistant</h2><span className="beta">BETA</span>
        <Link to="/inbox" className="icon-btn" style={{ marginLeft: 'auto', width: 28, height: 28 }} aria-label="Open the Inbox, where AI reads replies"><Icon.arrow size={14} /></Link></div>
      <p>What do you want to do today?</p>
      <div className="assist-list">{items.map((x) => { const I = Icon[x.icon]; return x.to
        ? <button key={x.label} type="button" className="assist-item" onClick={() => go(x.to!)} title={x.note}><I size={15} />{x.label}</button>
        : <button key={x.label} type="button" className="assist-item" aria-disabled="true" title={x.note} aria-describedby="ai-soon"><I size={15} />{x.label}<span className="soon">Not yet</span></button>; })}</div>
      <span id="ai-soon" className="sr">Not available yet: campaign status is set in the campaign configuration.</span>
    </section>
  );
}

function QuickActions() {
  const { go } = useRouter();
  const tiles: { label: string; icon: keyof typeof Icon; to?: string; note: string }[] = [
    { label: 'Add company', icon: 'crm', to: '/crm?new=1', note: 'Add a company to the CRM by hand' },
    { label: 'Send email', icon: 'mail', to: '/review', note: 'Emails are sent once you approve them in Review' },
    { label: 'New campaign', icon: 'send', note: 'Not available here yet: campaigns are set up in the campaign configuration' },
    { label: 'Log meeting', icon: 'calendar', to: '/inbox', note: 'Log a call from the reply that booked it, with They booked a call' },
  ];
  return (
    <section className="panel" aria-labelledby="qa-h">
      <div className="panel-head"><h2 id="qa-h">Quick actions</h2></div>
      <div className="quick">{tiles.map((t) => { const I = Icon[t.icon]; return t.to
        ? <button key={t.label} type="button" className="quick-tile" onClick={() => go(t.to!)} title={t.note}><I size={18} />{t.label}</button>
        : <button key={t.label} type="button" className="quick-tile" aria-disabled="true" title={t.note} aria-label={`${t.label}, not available yet`}><I size={18} />{t.label}</button>; })}</div>
    </section>
  );
}

// The team, with a message button. Who is online is not tracked, so it is not shown.
function TeamPanel({ me }: { me: Me }) {
  const team = useTeam(); const toast = useToast(); const { go } = useRouter(); const { reloadChannels } = useChat();
  const dm = async (id: string) => { try { const c = await api.post('/api/chat/direct', { user_id: id }); await reloadChannels(); go(`/chat/${c.id}`); } catch (e: any) { toast(e.message, { err: true }); } };
  return (
    <section className="panel" aria-labelledby="team-h">
      <div className="panel-head"><h2 id="team-h">Team</h2><span className="meta" style={{ marginLeft: 'auto' }}>{team.length} {team.length === 1 ? 'person' : 'people'}</span></div>
      <ul className="team-list">{team.map((u) => <li key={u.id}>
        <span className="av sm" aria-hidden="true">{initials(u.name)}</span>
        <span className="tm-name"><b>{u.name.split(' ')[0]}</b><span>{u.id === me.id ? 'You' : u.role === 'admin' ? 'Admin' : 'Member'}</span></span>
        {u.id !== me.id && <button type="button" className="icon-btn" onClick={() => dm(u.id)} aria-label={`Message ${u.name}`}><Icon.message size={16} /></button>}
      </li>)}</ul>
    </section>
  );
}
