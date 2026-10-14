import { useEffect, useState } from 'react';
import { isActive, onActiveChange } from '../active.ts';

// A tab keeps running the app it loaded, so after a redeploy it would go on showing the old screens (and a lazily
// loaded screen can fail outright, its old file being gone). This compares the app file this tab runs with the one
// the server now serves (index.html is never cached) and, when they differ, offers a reload. It checks every 5
// minutes while the tab is in use, and when someone comes back to it.
const BUNDLE = /\/assets\/index-[\w-]+\.js/;
const running = () => (document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.src.match(BUNDLE)?.[0] ?? null);

export function NewVersion() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const mine = running(); if (!mine) return () => {}; // the dev server has no built files to compare
    let stop = false;
    const check = async () => {
      if (stop || !isActive()) return;
      try { const html = await (await fetch('/', { cache: 'no-store', credentials: 'same-origin' })).text(); const now = html.match(BUNDLE)?.[0]; if (now && now !== mine) setReady(true); } catch { /* offline or restarting: the next check tries again */ }
    };
    // a screen that loads its own file finds it gone after a deploy: that is a new version too
    const failed = (e: Event) => { e.preventDefault(); setReady(true); };
    const t = setInterval(check, 5 * 60_000); const off = onActiveChange(check);
    addEventListener('vite:preloadError', failed); addEventListener('focus', check);
    return () => { stop = true; clearInterval(t); off(); removeEventListener('vite:preloadError', failed); removeEventListener('focus', check); };
  }, []);
  if (!ready) return null;
  return <div className="toasts" role="status" aria-live="polite" style={{ bottom: 88 }}><div className="toast"><span>A new version of awtm forge is ready.</span><button className="btn sm primary" onClick={() => location.reload()}>Reload</button></div></div>;
}
