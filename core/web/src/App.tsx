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
import { Project } from './pages/Project.tsx';
import { Wiki, WikiPage } from './pages/Wiki.tsx';
import { Chat } from './pages/Chat.tsx';
import { Crm } from './pages/Crm.tsx';
import { Company } from './pages/Company.tsx';
import { People, Person } from './pages/People.tsx';
import { ChatProvider, useChat } from './chat.tsx';
import { isActive, onActiveChange } from './active.ts';
import { MeContext } from './session.tsx';

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    api.get<Me>('/api/me').then(setMe).catch(() => setMe(null));
    const f = () => setMe(null); onUnauthorized.addEventListener('401', f); return () => onUnauthorized.removeEventListener('401', f);
  }, []);
  if (me === undefined) return null;
  const refresh = () => api.get<Me>('/api/me').then(setMe).catch(() => setMe(null));
  return <RouterProvider><ToastProvider><MeContext.Provider value={me}>{!me ? <Login onIn={refresh} /> : me.must_change_password ? <Account me={me} forced onChanged={refresh} /> : <ChatProvider><Shell me={me} onSignOut={() => setMe(null)} onMeChanged={refresh} /></ChatProvider>}</MeContext.Provider></ToastProvider></RouterProvider>;
}

type Counts = { drafts: number; replies: number; teardowns: number; needs_contact: number; meetings: number; proposals: number; replies_high: number; todos_due: number };
export const countsBus = new EventTarget(); // pages poke this after an action so the sidebar badges stay true
function Shell({ me, onSignOut, onMeChanged }: { me: Me; onSignOut: () => void; onMeChanged: () => void }) {
  const { path } = useRouter(); const chat = useChat();
  const [counts, setCounts] = useState<Counts | null>(null);
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
    { to: '/review', label: 'Review emails', icon: 'review', n: counts?.drafts, on: (p) => p.startsWith('/review') },
    { to: '/inbox', label: 'Inbox', icon: 'inbox', n: (counts?.replies ?? 0) + (counts?.teardowns ?? 0), on: (p) => p.startsWith('/inbox') },
    { to: '/pipeline', label: 'Pipeline', icon: 'pipeline', n: counts?.needs_contact, quiet: true, on: (p) => p.startsWith('/pipeline') || p.startsWith('/prospects') },
    { to: '/deals', label: 'Meetings and deals', icon: 'deals', n: (counts?.meetings ?? 0) + (counts?.proposals ?? 0), quiet: true, on: (p) => p.startsWith('/deals') },
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
  const groups = [{ title: 'Outbound', items: outbound }, { title: 'Workspace', items: workspace }].filter((g) => g.items.length);
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
  else if ((m = match('/projects/:id', path))) page = <Project id={m.id} key={m.id} />;
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
  else page = <div className="page"><div className="head"><div><h1>Nothing here</h1><p>This address does not lead anywhere. <Link to="/">Back to today</Link>.</p></div></div></div>;
  const mode = (v: string, live: string) => <b className={v === live ? 'live' : ''}>{v}</b>;
  return (
    <div className="app">
      <aside className="side">
        <Link to="/" className="brand" aria-label="awtm forge ops, today"><div className="mark">awtm <b>forge</b></div><span className="kick">Ops</span></Link>
        <nav className="nav" aria-label="Main">{groups.map((g) => <div key={g.title} className="nav-group" role="group" aria-label={g.title}><span className="nav-title">{g.title}</span>{g.items.map((n) => { const I = Icon[n.icon]; return (
          <Link key={n.to} to={n.to} className={n.on(path) ? 'on' : ''} aria-current={n.on(path) ? 'page' : undefined}><I /><span>{n.label}</span>{!!n.n && <span className={`count${n.quiet ? ' quiet' : ''}`}>{n.n}</span>}</Link>); })}</div>)}</nav>
        <div className="side-foot">
          <Working />
          <div className="modes" title="What is live and what is simulated">
            <div className="mode"><span>AI</span>{mode(me.ai_provider, 'anthropic')}</div>
            <div className="mode"><span>Sending</span>{mode(me.saleshandy, 'real')}</div>
            <div className="mode"><span>Search</span>{mode(me.discovery_source, 'serper')}</div>
          </div>
          <div className="who"><Link to="/account" className={path.startsWith('/account') ? 'on' : ''} title="Your account">{me.name}</Link><button className="btn sm ghost" onClick={signOut}>Sign out</button></div>
        </div>
      </aside>
      <main className="main" id="main">{page}</main>
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
  return <div className="modes" style={{ borderColor: 'var(--accent-line)' }} aria-live="polite"><div className="mode" style={{ alignItems: 'center', gap: 8 }}><span className="spinner" style={{ width: 12, height: 12, color: 'var(--accent)' }} /><b className="live" style={{ marginRight: 'auto' }}>AI working</b><span>{n} {n === 1 ? 'task' : 'tasks'}</span></div></div>;
}
