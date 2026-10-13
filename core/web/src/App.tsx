import { useEffect, useState } from 'react';
import { api, onUnauthorized, type Me } from './api.ts';
import { RouterProvider, useRouter, Link, match } from './router.tsx';
import { ToastProvider } from './ui/toast.tsx';
import { Icon } from './ui/icons.tsx';
import { Login } from './pages/Login.tsx';
import { Today } from './pages/Today.tsx';
import { Find } from './pages/Find.tsx';
import { Review } from './pages/Review.tsx';
import { Inbox } from './pages/Inbox.tsx';
import { Pipeline } from './pages/Pipeline.tsx';
import { Prospect } from './pages/Prospect.tsx';
import { Deals } from './pages/Deals.tsx';
import { Campaigns } from './pages/Campaigns.tsx';
import { Account } from './pages/Account.tsx';
import { Team } from './pages/Team.tsx';
import { Projects } from './pages/Projects.tsx';
import { Workspace } from './pages/project/Workspace.tsx';
import { Wiki, WikiPage } from './pages/Wiki.tsx';
import { Chat } from './pages/Chat.tsx';
import { Crm } from './pages/Crm.tsx';
import { Company } from './pages/Company.tsx';
import { People, Person } from './pages/People.tsx';
import { ChatProvider, useChat } from './chat.tsx';
import { isActive, onActiveChange } from './active.ts';
import { MeContext } from './session.tsx';
import { ConfirmProvider } from './ui/overlay.tsx';
import { CommandPalette, openSearch, type PaletteItem } from './ui/chrome.tsx';
import { AiPromo, Profile, Workbar, type Counts } from './ui/shell.tsx';

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    api.get<Me>('/api/me').then(setMe).catch(() => setMe(null));
    const f = () => setMe(null); onUnauthorized.addEventListener('401', f); return () => onUnauthorized.removeEventListener('401', f);
  }, []);
  if (me === undefined) return null;
  const refresh = () => api.get<Me>('/api/me').then(setMe).catch(() => setMe(null));
  return <RouterProvider><ToastProvider><ConfirmProvider><MeContext.Provider value={me}>{!me ? <Login onIn={refresh} /> : me.must_change_password ? <Account me={me} forced onChanged={refresh} /> : <ChatProvider><Shell me={me} onSignOut={() => setMe(null)} onMeChanged={refresh} /></ChatProvider>}</MeContext.Provider></ConfirmProvider></ToastProvider></RouterProvider>;
}

export const countsBus = new EventTarget(); // pages poke this after an action so the sidebar badges stay true
// pages that sit on the planet artwork, besides Today
const ART = ['/find', '/pipeline', '/campaigns', '/projects'];
function Shell({ me, onSignOut, onMeChanged }: { me: Me; onSignOut: () => void; onMeChanged: () => void }) {
  const { path } = useRouter(); const chat = useChat();
  const [counts, setCounts] = useState<Counts | null>(null);
  // phones: the navigation is a sheet behind a Menu button; it closes when a screen is chosen
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  useEffect(() => { if (!menu) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [menu]);
  useEffect(() => {
    const load = () => api.get<{ counts: Counts }>('/api/overview').then((o) => setCounts(o.counts)).catch(() => {});
    // paused while nobody is at the tab; fresh the moment they come back
    load(); const t = setInterval(() => { if (isActive()) load(); }, 60_000); countsBus.addEventListener('changed', load);
    const offActive = onActiveChange(() => { if (isActive()) load(); });
    return () => { clearInterval(t); offActive(); countsBus.removeEventListener('changed', load); };
  }, []);
  type Item = { to: string; label: string; icon: keyof typeof Icon; n?: number; quiet?: boolean; on: (p: string) => boolean };
  const outbound: Item[] = [
    { to: '/', label: 'Today', icon: 'today', n: counts?.todos_due, on: (p) => p === '/' },
    { to: '/find', label: 'Find companies', icon: 'find', on: (p) => p.startsWith('/find') },
    { to: '/review', label: 'Review emails', icon: 'mail', n: counts?.drafts, on: (p) => p.startsWith('/review') },
    { to: '/inbox', label: 'Inbox', icon: 'inbox', n: (counts?.replies ?? 0) + (counts?.teardowns ?? 0), on: (p) => p.startsWith('/inbox') },
    { to: '/pipeline', label: 'Pipeline', icon: 'funnel', n: counts?.needs_contact, quiet: true, on: (p) => p.startsWith('/pipeline') || p.startsWith('/prospects') },
    { to: '/deals', label: 'Meetings & deals', icon: 'calendar', n: (counts?.meetings ?? 0) + (counts?.proposals ?? 0), quiet: true, on: (p) => p.startsWith('/deals') },
    { to: '/campaigns', label: 'Campaigns', icon: 'campaigns', on: (p) => p.startsWith('/campaigns') },
  ];
  const workspace: Item[] = [
    { to: '/projects', label: 'Projects', icon: 'projects', on: (p) => p.startsWith('/projects') },
    { to: '/wiki', label: 'Wiki', icon: 'wiki', on: (p) => p.startsWith('/wiki') },
    { to: '/chat', label: 'Chat', icon: 'chat', n: chat.unread, on: (p) => p.startsWith('/chat') },
    { to: '/crm', label: 'CRM', icon: 'crm', on: (p) => p.startsWith('/crm') },
    { to: '/people', label: 'People', icon: 'people', on: (p) => p.startsWith('/people') },
    ...(me.role === 'admin' ? [{ to: '/team', label: 'Team', icon: 'user', on: (p: string) => p.startsWith('/team') } as Item] : []),
  ];
  const groups = [{ title: 'Operations', items: outbound }, { title: 'Workspace', items: workspace }].filter((g) => g.items.length);
  const signOut = async () => { await api.post('/auth/logout').catch(() => {}); onSignOut(); };
  let page: React.ReactNode; let m;
  if (path === '/') page = <Today me={me} />;
  else if (path.startsWith('/find')) page = <Find />;
  else if (path.startsWith('/review')) page = <Review />;
  else if (path.startsWith('/inbox')) page = <Inbox />;
  else if ((m = match('/prospects/:id', path))) page = <Prospect id={m.id} key={m.id} />;
  else if (path.startsWith('/pipeline')) page = <Pipeline />;
  else if (path.startsWith('/deals')) page = <Deals />;
  else if (path.startsWith('/campaigns')) page = <Campaigns />;
  else if ((m = match('/projects/:id/:view/:sub', path) ?? match('/projects/:id/:view', path) ?? match('/projects/:id', path))) page = <Workspace id={m.id} view={m.view ?? ''} sub={m.sub} key={m.id} />;
  else if (path.startsWith('/projects')) page = <Projects />;
  else if ((m = match('/wiki/:slug', path))) page = <WikiPage slug={m.slug} key={m.slug} />;
  else if (path.startsWith('/wiki')) page = <Wiki />;
  else if ((m = match('/chat/:id', path))) page = <Chat id={m.id} />;
  else if (path.startsWith('/chat')) page = <Chat />;
  else if ((m = match('/crm/companies/:id', path))) page = <Company id={m.id} key={m.id} />;
  else if (path.startsWith('/crm')) page = <Crm />;
  else if ((m = match('/people/:id', path))) page = <Person id={m.id} key={m.id} />;
  else if (path.startsWith('/people')) page = <People />;
  else if (path.startsWith('/account')) page = <Account me={me} onChanged={onMeChanged} />;
  else if (path.startsWith('/team') && me.role === 'admin') page = <Team />;
  else page = <div className="page"><div className="head"><div><h1>Nothing here</h1><p>This address does not lead to a screen{path.startsWith('/team') ? ' you can open; managing the team is for admins' : ''}.</p></div></div><div><Link className="btn" to="/">Go to Today</Link></div></div>;
  // what is live and what is simulated, in plain words
  const WORDS: Record<string, string> = { mock: 'Simulated', gemini: 'Gemini', anthropic: 'Claude', real: 'Live', serper: 'Live', google_cse: 'Live' };
  const modes = [{ label: 'AI', value: WORDS[me.ai_provider] ?? me.ai_provider }, { label: 'Sending', value: WORDS[me.saleshandy] ?? me.saleshandy }, { label: 'Search', value: WORDS[me.discovery_source] ?? me.discovery_source }];
  const here = groups.flatMap((g) => g.items).find((n) => n.on(path))?.label ?? (path.startsWith('/account') ? 'Your account' : 'awtm forge');
  const palette: PaletteItem[] = [...groups.flatMap((g) => g.items.map((n) => ({ label: n.label, to: n.to, group: g.title }))),
    { label: 'My tasks', to: '/projects?view=mine', group: 'Workspace', hint: 'to-dos' }, { label: 'New wiki page', to: '/wiki/new', group: 'Workspace', hint: 'write' },
    { label: 'Leave', to: '/people?tab=leave', group: 'Workspace', hint: 'holiday time off' }, { label: 'Opportunities', to: '/crm?tab=opportunities', group: 'Workspace', hint: 'deals' },
    { label: 'Your account', to: '/account', group: 'You', hint: 'password theme' }];
  return (
    <div className="app">
      <a href="#main" className="skip">Skip to content</a>
      <header className="topbar"><button className="btn sm" onClick={() => setMenu(true)} aria-expanded={menu} aria-controls="side-nav"><Icon.pipeline size={16} />Menu</button>
        <span className="where">{here}</span><button className="btn sm ghost icon-only" onClick={() => openSearch()} aria-label="Search, or go to a screen"><Icon.find size={16} /></button></header>
      {menu && <div className="side-scrim" onClick={() => setMenu(false)} />}
      <aside className={`side${menu ? ' open' : ''}`} id="side-nav">
        <Link to="/" className="brand" aria-label="awtm forge, Today"><span className="brand-mark" aria-hidden="true"><Icon.logo size={17} /></span><div className="mark">awtm <b>forge</b></div></Link>
        <nav className="nav" aria-label="Main">{groups.map((g) => <div key={g.title} className="nav-group" role="group" aria-label={g.title}><span className="nav-title">{g.title}</span>{g.items.map((n) => { const I = Icon[n.icon]; return (
          <Link key={n.to} to={n.to} className={n.on(path) ? 'on' : ''} aria-current={n.on(path) ? 'page' : undefined}><I /><span>{n.label}</span>{!!n.n && <span className={`count${n.quiet ? ' quiet' : ''}`}>{n.n}</span>}</Link>); })}</div>)}</nav>
        <div className="side-foot">
          <Working />
          <AiPromo />
          <Profile me={me} onSignOut={signOut} modes={modes} />
        </div>
      </aside>
      <div className={`workspace${path === '/' ? ' is-today' : ART.some((p) => path.startsWith(p)) ? ' is-art' : ''}`}>
        <Workbar me={me} counts={counts} unread={chat.unread} today={path === '/'} />
        <main className="main" id="main" tabIndex={-1}>{page}</main>
      </div>
      <CommandPalette items={palette} />
    </div>
  );
}

// What the AI queue is doing, checked every 5 s. Hidden when idle.
function Working() {
  const [q, setQ] = useState<{ waiting: number; running: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => api.get<Me>('/api/me').then((m) => { if (live) setQ(m.queue ?? null); }).catch(() => {});
    load(); const t = setInterval(() => { if (isActive()) load(); }, 5000); return () => { live = false; clearInterval(t); };
  }, []);
  if (!q || (!q.running && !q.waiting)) return null;
  const n = (q.running ? 1 : 0) + q.waiting;
  return <div className="modes" aria-live="polite"><div className="mode" style={{ alignItems: 'center', gap: 8 }}><span className="spinner" style={{ width: 12, height: 12, color: 'var(--ink-muted)' }} /><b style={{ marginRight: 'auto' }}>AI working</b><span>{n} {n === 1 ? 'task' : 'tasks'}</span></div></div>;
}
