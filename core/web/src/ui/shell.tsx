import type { Me } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { Icon, Dots } from './icons.tsx';
import { Menu, MenuItem } from './menu.tsx';
import { ThemeSwitch, openSearch } from './chrome.tsx';
import { initials } from './kit.tsx';

export type Counts = { drafts: number; replies: number; teardowns: number; needs_contact: number; meetings: number; proposals: number; replies_high: number; todos_due: number };
const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform);

// The top bar: today's date on Today, then search, what is waiting, and you.
export function Workbar({ me, counts, unread, today }: { me: Me; counts: Counts | null; unread: number; today: boolean }) {
  const date = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' }).replace(/^(\w+) /, '$1, ');
  return (
    <div className="workbar">
      {today && <p className="eyebrow">{date}</p>}
      <div className="tools">
        <button type="button" className="search-box" onClick={() => openSearch()} aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
          onKeyDown={(e) => { if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); openSearch(e.key); } }}>
          <Icon.find size={16} /><span>Search companies, emails, pages…</span>{isMac ? <><kbd>⌘</kbd><kbd>K</kbd></> : <><kbd>Ctrl</kbd><kbd>K</kbd></>}
        </button>
        <Notifications counts={counts} unread={unread} />
        <Link to="/account" className="av" title="Your account" aria-label={`Your account, ${me.name}`}>{initials(me.name)}</Link>
      </div>
    </div>
  );
}

// What is waiting for someone, from the same counts the sidebar shows. Nothing here is a new feed.
function Notifications({ counts, unread }: { counts: Counts | null; unread: number }) {
  const { go } = useRouter();
  const c = counts;
  const rows = c ? [
    { n: c.drafts, label: c.drafts === 1 ? 'email to review' : 'emails to review', to: '/review' },
    { n: c.replies, label: c.replies === 1 ? 'reply to answer' : 'replies to answer', to: '/inbox' },
    { n: c.teardowns, label: c.teardowns === 1 ? 'teardown to approve' : 'teardowns to approve', to: '/inbox?tab=teardowns' },
    { n: unread, label: unread === 1 ? 'unread chat message' : 'unread chat messages', to: '/chat' },
    { n: c.todos_due, label: c.todos_due === 1 ? 'to-do due or late' : 'to-dos due or late', to: '/' },
    { n: c.proposals, label: c.proposals === 1 ? 'proposal to decide' : 'proposals to decide', to: '/deals' },
  ].filter((r) => r.n > 0) : [];
  const total = rows.reduce((a, r) => a + r.n, 0);
  return (
    <Menu label={total ? `Notifications, ${total} waiting` : 'Notifications, nothing waiting'} button={<><Icon.bell size={19} />{total > 0 && <span className="ping" aria-hidden="true" />}</>}>
      {(close) => <>
        <div className="menu-note">{total ? 'Waiting for you' : 'Nothing is waiting for you.'}</div>
        {rows.map((r) => <MenuItem key={r.to + r.label} onSelect={() => { close(); go(r.to); }}><span>{r.label.charAt(0).toUpperCase() + r.label.slice(1)}</span><span className="n">{r.n}</span></MenuItem>)}
      </>}
    </Menu>
  );
}

// The sidebar's AI card: it opens the assistant on Today.
export function AiPromo() {
  const { go } = useRouter();
  return (
    <div className="ai-promo">
      <span className="ic"><Icon.bolt size={20} /></span>
      <h2>AI Assistant</h2>
      <p>Search, draft, and automate your ops work.</p>
      <button type="button" className="btn sm outline-accent" onClick={() => go('/?assistant=1')}><Icon.bolt size={14} />Try AI</button>
    </div>
  );
}

// You, at the foot of the sidebar: account, theme, what is live, sign out.
export function Profile({ me, onSignOut, modes }: { me: Me; onSignOut: () => void; modes: { label: string; value: string }[] }) {
  const { go } = useRouter();
  return (
    <div className="profile">
      <span className="av" aria-hidden="true">{initials(me.name)}</span>
      <Link to="/account" className="who-text"><b>{me.name}</b><span>{me.email ?? me.user}</span></Link>
      <Menu label="Account menu" className="icon-btn" place="up" button={<Dots vertical />}>
        {(close) => <>
          <MenuItem onSelect={() => { close(); go('/account'); }}><Icon.user size={16} />Your account</MenuItem>
          <div className="menu-sep" />
          <div className="menu-note">Theme</div>
          <ThemeSwitch compact />
          <div className="menu-sep" />
          {modes.map((m) => <div key={m.label} className="menu-note" style={{ display: 'flex' }}>{m.label}<b style={{ marginLeft: 'auto', color: 'var(--ink-muted)', fontWeight: 600 }}>{m.value}</b></div>)}
          <div className="menu-sep" />
          <MenuItem onSelect={() => { close(); onSignOut(); }}><Icon.out size={16} />Sign out</MenuItem>
        </>}
      </Menu>
    </div>
  );
}
