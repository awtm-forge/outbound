import { useEffect, useState } from 'react';
// The person's theme choice: follow the system, or always light, or always dark. Kept in this browser only.
export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'awtm-theme';
const read = (): ThemeChoice => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; } };
const bus = new EventTarget();
export function setTheme(t: ThemeChoice) {
  try { if (t === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* private mode: still applies for this page */ }
  if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  bus.dispatchEvent(new Event('change'));
}
export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [t, setT] = useState<ThemeChoice>(read);
  useEffect(() => { const f = () => setT(read()); bus.addEventListener('change', f); return () => bus.removeEventListener('change', f); }, []);
  return [t, setTheme];
}
