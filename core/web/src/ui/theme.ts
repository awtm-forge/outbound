import { useEffect, useState } from 'react';
// The person's theme choice: dark (the default), light, or follow the system. Kept in this browser only.
export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'awtm-theme';
const read = (): ThemeChoice => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'system' ? v : 'dark'; } catch { return 'dark'; } };
const bus = new EventTarget();
export function setTheme(t: ThemeChoice) {
  try { localStorage.setItem(KEY, t); } catch { /* private mode: still applies for this page */ }
  document.documentElement.setAttribute('data-theme', t);
  bus.dispatchEvent(new Event('change'));
}
export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [t, setT] = useState<ThemeChoice>(read);
  useEffect(() => { const f = () => setT(read()); bus.addEventListener('change', f); return () => bus.removeEventListener('change', f); }, []);
  return [t, setTheme];
}
