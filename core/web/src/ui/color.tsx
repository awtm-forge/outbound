import { useEffect, useId, useState, type CSSProperties } from 'react';
import { Icon } from './icons.tsx';

// Project accents. Any colour can be chosen; these are shortcuts. Every tint, border, glow and readable text colour is
// worked out from the one saved value, so there is no style per colour.
export const DEFAULT_ACCENT = '#FF922E';
export const SWATCHES: [string, string][] = [
  ['Orange', '#FF922E'], ['Blue', '#3B82F6'], ['Violet', '#A855F7'], ['Emerald', '#10B981'], ['Cyan', '#06B6D4'],
  ['Rose', '#F43F5E'], ['Red', '#EF4444'], ['Amber', '#F59E0B'], ['Green', '#22C55E'], ['Pink', '#EC4899'],
];
export const normHex = (v: string): string | null => { const m = v.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i); if (!m) return null; const h = m[1]!.length === 3 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!; return '#' + h.toUpperCase(); };
const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const; };
const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase();
const lum = ([r, g, b]: readonly number[]) => { const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!); };
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
// the colour, moved toward white (on dark surfaces) or black (on light ones) just until it reads at 4.5:1
function readable(hex: string, on: string, toward: 255 | 0) {
  const c = rgb(hex); const bg = lum(rgb(on));
  for (let t = 0; t <= 1.0001; t += 0.05) { const m = c.map((x) => x + (toward - x) * t); if (contrast(lum(m), bg) >= 4.5) return toHex(m[0]!, m[1]!, m[2]!); }
  return toward ? '#FFFFFF' : '#000000';
}
const cache = new Map<string, CSSProperties>();
// CSS custom properties for one project: --pa (the colour), --pa-rgb (for tints), --pa-text (readable on dark),
// --pa-text-l (readable on light), --pa-ink (text on a solid fill of the colour)
export function accentVars(color?: string | null): CSSProperties {
  const hex = normHex(color ?? '') ?? DEFAULT_ACCENT;
  let v = cache.get(hex);
  if (!v) {
    const c = rgb(hex);
    v = { '--pa': hex, '--pa-rgb': c.join(', '), '--pa-text': readable(hex, '#0D1117', 255), '--pa-text-l': readable(hex, '#FFFFFF', 0), '--pa-ink': lum(c) > 0.3 ? '#14100C' : '#FFFFFF' } as CSSProperties;
    cache.set(hex, v);
  }
  return v;
}
export const projectInitials = (name: string) => (name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?');

// The project's tile: initials on a tint of its colour.
export function ProjectMark({ name, color, size = 44 }: { name: string; color?: string | null; size?: number }) {
  return <span className="pmark" style={{ ...accentVars(color), width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">{projectInitials(name)}</span>;
}

// Shortcuts, any colour from the system picker, or a typed hex value. Changes preview at once; Apply keeps them.
export function ColorPicker({ value, name, onPreview, onApply, onCancel, applyLabel = 'Apply', busy }: {
  value: string | null; name: string; onPreview?: (c: string | null) => void; onApply: (c: string | null) => void; onCancel?: () => void; applyLabel?: string; busy?: boolean;
}) {
  const [cur, setCur] = useState<string | null>(value); const [typed, setTyped] = useState(value ?? '');
  const id = useId(); const hex = normHex(typed); const bad = typed.trim() !== '' && !hex;
  useEffect(() => { onPreview?.(cur); }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (c: string | null) => { setCur(c); setTyped(c ?? ''); };
  const shown = cur ?? DEFAULT_ACCENT;
  return (
    <div className="cpick" style={accentVars(cur)}>
      <div className="cp-preview" aria-hidden="true"><ProjectMark name={name || 'New project'} color={cur} size={40} /><div><b>{name || 'New project'}</b><span className="cp-bar"><i /></span></div></div>
      <fieldset className="cp-swatches"><legend className="sr">Quick colours</legend>
        {SWATCHES.map(([label, c]) => <label key={c} className="cp-sw" title={`${label} ${c}`} style={{ background: c }}>
          <input type="radio" name={id} className="sr" checked={cur === c} onChange={() => pick(c)} aria-label={`${label}, ${c}`} />{cur === c && <Icon.check size={14} />}</label>)}
      </fieldset>
      <div className="cp-row">
        <label className="cp-native" title="Pick any colour"><input type="color" value={shown.toLowerCase()} onChange={(e) => pick(normHex(e.target.value))} aria-label="Pick any colour" /><span style={{ background: shown }} /></label>
        <label className="cp-hex"><span className="sr">Hex colour</span><span aria-hidden="true">HEX</span>
          <input value={typed} placeholder={DEFAULT_ACCENT} maxLength={7} spellCheck={false} aria-invalid={bad} aria-describedby={bad ? `${id}-err` : undefined}
            onChange={(e) => { setTyped(e.target.value); const h = normHex(e.target.value); if (h) setCur(h); }} onBlur={() => { if (hex) setTyped(hex); }} /></label>
        <button type="button" className="btn tiny ghost" onClick={() => pick(null)} disabled={cur === null} title="Back to the theme's orange">Reset</button>
      </div>
      {bad && <p className="cp-err" id={`${id}-err`} role="alert">Use six hex digits, like #3B82F6.</p>}
      <div className="cp-actions">{onCancel && <button type="button" className="btn tiny" onClick={() => { onPreview?.(value); onCancel(); }}>Cancel</button>}
        <button type="button" className="btn tiny primary" disabled={bad || busy} onClick={() => onApply(cur)}>{applyLabel}</button></div>
    </div>
  );
}
