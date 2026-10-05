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

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    api.get<Me>('/api/me').then(setMe).catch(() => setMe(null));
    const f = () => setMe(null); onUnauthorized.addEventListener('401', f); return () => onUnauthorized.removeEventListener('401', f);
  }, []);
  if (me === undefined) return null;
  return <RouterProvider><ToastProvider>{me ? <Shell me={me} onSignOut={() => setMe(null)} /> : <Login onIn={() => api.get<Me>('/api/me').then(setMe)} />}</ToastProvider></RouterProvider>;
}

type Counts = { drafts: number; replies: number; teardowns: number; needs_contact: number; meetings: number; proposals: number; replies_high: number };
export const countsBus = new EventTarget(); // pages poke this after an action so the sidebar badges stay true
function Shell({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const { path } = useRouter();
  const [counts, setCounts] = useState<Counts | null>(null);
  useEffect(() => {
    const load = () => api.get<{ counts: Counts }>('/api/overview').then((o) => setCounts(o.counts)).catch(() => {});
    load(); const t = setInterval(load, 60_000); countsBus.addEventListener('changed', load);
    return () => { clearInterval(t); countsBus.removeEventListener('changed', load); };
  }, []);
  const nav: { to: string; label: string; icon: keyof typeof Icon; n?: number; quiet?: boolean; on: (p: string) => boolean }[] = [
    { to: '/', label: 'Today', icon: 'today', on: (p) => p === '/' },
    { to: '/find', label: 'Find companies', icon: 'find', on: (p) => p.startsWith('/find') },
    { to: '/review', label: 'Review emails', icon: 'review', n: counts?.drafts, on: (p) => p.startsWith('/review') },
    { to: '/inbox', label: 'Inbox', icon: 'inbox', n: (counts?.replies ?? 0) + (counts?.teardowns ?? 0), on: (p) => p.startsWith('/inbox') },
    { to: '/pipeline', label: 'Pipeline', icon: 'pipeline', n: counts?.needs_contact, quiet: true, on: (p) => p.startsWith('/pipeline') || p.startsWith('/prospects') },
    { to: '/deals', label: 'Meetings and deals', icon: 'deals', n: (counts?.meetings ?? 0) + (counts?.proposals ?? 0), quiet: true, on: (p) => p.startsWith('/deals') },
    { to: '/campaigns', label: 'Campaigns', icon: 'campaigns', on: (p) => p.startsWith('/campaigns') },
  ];
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
  else page = <div className="page"><div className="head"><div><h1>Nothing here</h1><p>This address does not lead anywhere. <Link to="/">Back to today</Link>.</p></div></div></div>;
  const mode = (v: string, live: string) => <b className={v === live ? 'live' : ''}>{v}</b>;
  return (
    <div className="app">
      <aside className="side">
        <Link to="/" className="brand" aria-label="awtm forge outbound, today"><div className="mark">awtm <b>forge</b></div><span className="kick">Outbound</span></Link>
        <nav className="nav" aria-label="Main">{nav.map((n) => { const I = Icon[n.icon]; return (
          <Link key={n.to} to={n.to} className={n.on(path) ? 'on' : ''} aria-current={n.on(path) ? 'page' : undefined}><I /><span>{n.label}</span>{!!n.n && <span className={`count${n.quiet ? ' quiet' : ''}`}>{n.n}</span>}</Link>); })}</nav>
        <div className="side-foot">
          <Working />
          <div className="modes" title="What is live and what is simulated">
            <div className="mode"><span>AI</span>{mode(me.ai_provider, 'anthropic')}</div>
            <div className="mode"><span>Sending</span>{mode(me.saleshandy, 'real')}</div>
            <div className="mode"><span>Search</span>{mode(me.discovery_source, 'serper')}</div>
          </div>
          <div className="who"><span>{me.user}</span><button className="btn sm ghost" onClick={signOut}>Sign out</button></div>
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
    load(); const t = setInterval(load, 5000); return () => { live = false; clearInterval(t); };
  }, []);
  if (!q || (!q.running && !q.waiting)) return null;
  const n = (q.running ? 1 : 0) + q.waiting;
  return <div className="modes" style={{ borderColor: 'var(--accent-line)' }} aria-live="polite"><div className="mode" style={{ alignItems: 'center', gap: 8 }}><span className="spinner" style={{ width: 12, height: 12, color: 'var(--accent)' }} /><b className="live" style={{ marginRight: 'auto' }}>AI working</b><span>{n} {n === 1 ? 'task' : 'tasks'}</span></div></div>;
}
