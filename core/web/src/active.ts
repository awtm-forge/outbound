import { useEffect, useState } from 'react';
// Whether someone is actually here. Live updates (chat, counts, the AI indicator) pause when the tab has been hidden
// for 2 minutes or nobody has touched it for 30, and resume the moment someone comes back. A tab left open overnight
// then stops reaching the database, so Neon's compute can suspend and its free hours last the month.
const HIDDEN_GRACE_MS = 2 * 60_000; const IDLE_MS = 30 * 60_000;
let lastInput = Date.now(); let hiddenSince: number | null = document.hidden ? Date.now() : null;
const bus = new EventTarget();
export const isActive = () => (hiddenSince === null || Date.now() - hiddenSince < HIDDEN_GRACE_MS) && Date.now() - lastInput < IDLE_MS;
let was = isActive();
const check = () => { const now = isActive(); if (now !== was) { was = now; bus.dispatchEvent(new Event('change')); } };
document.addEventListener('visibilitychange', () => { hiddenSince = document.hidden ? Date.now() : null; if (!document.hidden) lastInput = Date.now(); check(); });
let throttle = 0;
for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'focus']) addEventListener(ev, () => {
  const now = Date.now(); if (now - throttle < 1000) return; throttle = now; lastInput = now; check();
}, { passive: true });
setInterval(check, 15_000);

export const onActiveChange = (fn: () => void) => { bus.addEventListener('change', fn); return () => bus.removeEventListener('change', fn); };
// Resolves at once if someone is here, otherwise when they come back.
export const whenActive = () => new Promise<void>((resolve) => { if (isActive()) return resolve(); const off = onActiveChange(() => { if (isActive()) { off(); resolve(); } }); });
export function useActive() { const [a, setA] = useState(isActive()); useEffect(() => onActiveChange(() => setA(isActive())), []); return a; }
