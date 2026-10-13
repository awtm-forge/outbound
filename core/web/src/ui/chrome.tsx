import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useRouter } from '../router.tsx';
import { Icon } from './icons.tsx';
import { useFocusTrap } from './overlay.tsx';
import { useTheme, type ThemeChoice } from './theme.ts';

// Where you are, as a trail: every item but the last is a link.
export function Crumbs({ items }: { items: { to?: string; label: string }[] }) {
  return <nav className="crumbs" aria-label="Breadcrumb"><ol>{items.map((c, i) => <li key={i}>{c.to && i < items.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</li>)}</ol></nav>;
}

// System, light or dark, as one control.
export function ThemeSwitch({ compact }: { compact?: boolean }) {
  const [t, set] = useTheme();
  const opts: [ThemeChoice, string][] = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];
  return <div className={`seg${compact ? ' compact' : ''}`} role="radiogroup" aria-label="Theme">{opts.map(([v, l]) =>
    <button key={v} type="button" role="radio" aria-checked={t === v} className={t === v ? 'on' : ''} onClick={() => set(v)}>{l}</button>)}</div>;
}

// Cmd/Ctrl+K: jump to any screen by typing part of its name. It filters a fixed list in the browser and fetches nothing.
export type PaletteItem = { label: string; to: string; group: string; hint?: string };
export function CommandPalette({ items }: { items: PaletteItem[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); } };
    const ext = () => setOpen(true);
    addEventListener('keydown', k); addEventListener('open-palette', ext);
    return () => { removeEventListener('keydown', k); removeEventListener('open-palette', ext); };
  }, []);
  return open ? <Palette items={items} close={() => setOpen(false)} /> : null;
}
function Palette({ items, close }: { items: PaletteItem[]; close: () => void }) {
  const { go } = useRouter(); const box = useRef<HTMLDivElement>(null); const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState(''); const [i, setI] = useState(0);
  useFocusTrap(box, close, input);
  const shown = useMemo(() => { const t = q.trim().toLowerCase(); return t ? items.filter((x) => (x.label + ' ' + (x.hint ?? '')).toLowerCase().includes(t)) : items; }, [q, items]);
  useEffect(() => setI(0), [q]);
  const pick = (x?: PaletteItem) => { if (!x) return; close(); go(x.to); };
  return (
    <div className="overlay top" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={box} className="palette" role="dialog" aria-modal="true" aria-label="Go to">
        <div className="palette-in"><Icon.find size={16} /><input ref={input} role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={shown[i] ? `pal-${i}` : undefined}
          placeholder="Go to a screen" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Go to a screen"
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setI((n) => Math.min(shown.length - 1, n + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setI((n) => Math.max(0, n - 1)); } if (e.key === 'Enter') { e.preventDefault(); pick(shown[i]); } }} />
          <kbd>Esc</kbd></div>
        <ul id="palette-list" role="listbox" aria-label="Screens">{shown.length ? shown.map((x, n) => <li key={x.to + x.label} id={`pal-${n}`} role="option" aria-selected={n === i} className={n === i ? 'on' : ''}
          onMouseEnter={() => setI(n)} onMouseDown={(e) => { e.preventDefault(); pick(x); }}><span>{x.label}</span><span className="faint">{x.group}</span></li>) : <li className="none">Nothing matches</li>}</ul>
      </div>
    </div>
  );
}

// Who did something, in people's words: service accounts become what they are; sign-in names get a capital.
const SERVICE: Record<string, string> = { system: 'Automation', n8n: 'Automation', saleshandy: 'Saleshandy', demo: 'Demo data', anonymous: 'Someone' };
export const actorLabel = (a?: string | null) => (!a ? 'Someone' : SERVICE[a] ?? a.charAt(0).toUpperCase() + a.slice(1));
