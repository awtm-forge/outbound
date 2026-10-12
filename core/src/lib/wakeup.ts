// Wakes chat long-polls. A message posted through this process wakes every waiting poll at once. A message posted
// through another process (should the host ever run two) is caught by one shared check of the newest seq each second,
// made only while someone is waiting: one tiny indexed query a second for the whole team, not one per browser.
// No LISTEN/NOTIFY: Neon's pooled connection string does not carry it.
import { one } from './db.ts';
import { log } from './log.ts';

const waiters = new Map<() => void, number>(); // wake function -> the seq that poll has already seen
let ticking: NodeJS.Timeout | null = null; let closing = false;
export const TICK_MS = 1000;

export function wakeAll() { for (const w of [...waiters.keys()]) w(); }
function startTicker() {
  if (ticking) return;
  ticking = setInterval(async () => {
    if (!waiters.size) { clearInterval(ticking!); ticking = null; return; }
    try {
      const n = Number((await one('select coalesce(max(seq), 0) n from chat_messages'))!.n);
      for (const [w, seen] of [...waiters]) if (n > seen) w();
    } catch (e: any) { log.warn('chat tick failed', { err: e.message }); }
  }, TICK_MS);
  ticking.unref();
}
// Resolves on a wake, after ms, when the caller goes away, or when the server is shutting down.
export function waitForWake(seen: number, ms: number, gone: Promise<void>): Promise<void> {
  if (closing || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); waiters.delete(done); resolve(); };
    const t = setTimeout(done, ms); t.unref();
    waiters.set(done, seen); gone.then(done); startTicker();
  });
}
// SIGTERM: let every open poll answer now so the server can close.
export function releaseAll() { closing = true; wakeAll(); }
export const waiting = () => waiters.size;
