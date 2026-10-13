// The unread counter, the way a messaging app shows it: unread chat messages from others plus notifications meant for
// you (a task given to you, a mention). It goes on the tab title as "(5)", on the tab icon as a red badge, on the app
// icon when the site is installed, and, once someone turns them on, as desktop alerts for anything new while the tab
// is in the background. All counts come from the server; nothing here is guessed.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { useChat } from './chat.tsx';
import { isActive, onActiveChange } from './active.ts';
import ICON from '../public/favicon.svg?raw';

export type Summary = {
  total: number; chat: number; notifications: number; tasks: number; mentions: number;
  latest: { id: string; kind: string; title: string; link: string | null; created_at: string }[];
  messages: { id: string; channel_id: string; kind: string; channel_name: string | null; author_name: string | null; body: string; created_at: string }[];
};
type Ctx = { s: Summary | null; reload: () => void; alerts: 'unsupported' | 'blocked' | 'off' | 'on'; enable: () => Promise<void>; disable: () => void };
const UnreadCtx = createContext<Ctx>({ s: null, reload: () => {}, alerts: 'unsupported', enable: async () => {}, disable: () => {} });
export const useUnread = () => useContext(UnreadCtx);
export const unreadBus = new EventTarget(); // poke after reading something so the counter drops at once
export const unreadChanged = () => unreadBus.dispatchEvent(new Event('changed'));

const PREF = 'forge.alerts';
const pref = { get: () => { try { return localStorage.getItem(PREF); } catch { return null; } }, set: (v: string) => { try { localStorage.setItem(PREF, v); } catch { /* private window */ } } };
const supported = () => typeof window !== 'undefined' && 'Notification' in window;
const alertState = (): Ctx['alerts'] => !supported() ? 'unsupported' : Notification.permission === 'denied' ? 'blocked' : Notification.permission === 'granted' && pref.get() !== 'off' ? 'on' : 'off';
// in the background the counter keeps up once a minute while the person is still in their working session; after
// three hours without anyone touching the app it stops, so a tab left open overnight lets the database sleep
const SESSION_MS = 3 * 60 * 60_000; let lastTouch = Date.now();
for (const ev of ['pointerdown', 'keydown', 'focus']) addEventListener(ev, () => { lastTouch = Date.now(); }, { passive: true });

const BASE_TITLE = document.title;
const badgeIcon = (n: number) => {
  if (!n) return '/favicon.svg';
  const label = n > 99 ? '99+' : String(n); const r = label.length > 2 ? 330 : 290;
  const badge = `<g><circle cx="${1350 - r}" cy="${-30 + r}" r="${r}" fill="#EF4444" stroke="#fff" stroke-width="40"/><text x="${1350 - r}" y="${-30 + r}" dy="0.36em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${label.length > 2 ? 300 : label.length > 1 ? 380 : 440}" fill="#fff">${label}</text></g>`;
  return 'data:image/svg+xml,' + encodeURIComponent(ICON.replace('</svg>', `${badge}</svg>`));
};
function paint(n: number) {
  document.title = n ? `(${n > 99 ? '99+' : n}) ${BASE_TITLE}` : BASE_TITLE;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]'); if (link) link.href = badgeIcon(n);
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try { if (n) void nav.setAppBadge?.(n).catch(() => {}); else void nav.clearAppBadge?.().catch(() => {}); } catch { /* not installed */ }
}

export function UnreadProvider({ children }: { children: React.ReactNode }) {
  const chat = useChat();
  const [s, setS] = useState<Summary | null>(null); const [alerts, setAlerts] = useState(alertState);
  const seen = useRef<Set<string> | null>(null); const busy = useRef(false);
  const load = useCallback(async () => {
    if (busy.current) return; busy.current = true;
    try {
      const r = await api.get<Summary>('/api/notifications/summary'); setS(r); paint(r.total);
      const ids = [...r.latest.map((x) => 'n' + x.id), ...r.messages.map((x) => 'm' + x.id)];
      if (seen.current === null) seen.current = new Set(ids); // what was already there when the app opened is not news
      else { const fresh = ids.filter((id) => !seen.current!.has(id)); fresh.forEach((id) => seen.current!.add(id)); if (fresh.length) alert(r, new Set(fresh)); }
    } catch { /* the counter keeps what it had; the next round tries again */ }
    busy.current = false;
  }, []);
  // a chat message arriving (the chat feed is live) or the chat list changing re-reads the counter at once
  useEffect(() => { void load(); }, [chat.unread, load]);
  const listen = chat.listen; useEffect(() => listen(() => { void load(); }), [listen, load]);
  useEffect(() => {
    let lastBg = 0;
    const t = setInterval(() => {
      if (isActive()) { void load(); return; }
      if (Date.now() - lastTouch < SESSION_MS && Date.now() - lastBg >= 60_000) { lastBg = Date.now(); void load(); }
    }, 20_000);
    const back = () => { if (isActive()) void load(); }; const off = onActiveChange(back);
    unreadBus.addEventListener('changed', load); addEventListener('focus', back);
    return () => { clearInterval(t); off(); unreadBus.removeEventListener('changed', load); removeEventListener('focus', back); };
  }, [load]);
  useEffect(() => () => paint(0), []);
  const enable = async () => {
    if (!supported()) return; pref.set('on');
    if (Notification.permission === 'default') await Notification.requestPermission();
    setAlerts(alertState());
    if (Notification.permission === 'granted') {
      const opts = { body: 'New messages and tasks for you show here while awtm forge is open.', icon: '/icons/icon-192.png', tag: 'forge-alerts-on' };
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) void navigator.serviceWorker.ready.then((r) => r.showNotification('Alerts are on', opts)).catch(() => {});
      else { try { new Notification('Alerts are on', opts); } catch { /* service-worker-only browser */ } }
    }
  };
  const disable = () => { pref.set('off'); setAlerts(alertState()); };
  return <UnreadCtx.Provider value={{ s, reload: load, alerts, enable, disable }}>{children}</UnreadCtx.Provider>;
}

// a system alert for each new thing (or one summary when several land at once), only while the tab is not in front
function alert(r: Summary, fresh: Set<string>) {
  if (alertState() !== 'on' || (document.visibilityState === 'visible' && document.hasFocus())) return;
  const notes = r.latest.filter((x) => fresh.has('n' + x.id)); const msgs = r.messages.filter((x) => fresh.has('m' + x.id));
  const show = (title: string, body: string, link: string, tag: string) => {
    // phones only allow alerts through the service worker, which also opens the screen when one is tapped
    const opts = { body, icon: '/icons/icon-192.png', badge: '/icons/icon-maskable-192.png', tag, data: { url: link } };
    const viaPage = () => { try { const n = new Notification(title, opts); n.onclick = () => { window.focus(); history.pushState(null, '', link); dispatchEvent(new PopStateEvent('popstate')); n.close(); }; } catch { /* this browser only shows alerts from a service worker */ } };
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then((r) => r.showNotification(title, opts)).catch(viaPage); else viaPage();
  };
  if (notes.length + msgs.length > 3) { show(`${notes.length + msgs.length} new in awtm forge`, [msgs.length ? `${msgs.length} ${msgs.length === 1 ? 'message' : 'messages'}` : '', notes.length ? `${notes.length} for you` : ''].filter(Boolean).join(', '), msgs.length ? '/chat' : notes[0]!.link ?? '/', 'forge-many'); return; }
  for (const x of notes) show(x.kind === 'task_assigned' ? 'New task for you' : x.kind === 'mentioned' ? 'You were mentioned' : 'awtm forge', x.title, x.link ?? '/', 'n' + x.id);
  for (const m of msgs) show(m.kind === 'DIRECT' ? m.author_name ?? 'New message' : `${m.author_name ?? 'Someone'} in #${m.channel_name}`, m.body || 'Sent a message', `/chat/${m.channel_id}`, 'm' + m.id);
}
