// WCAG 2.2 contrast for every token pair the design uses. Text needs 4.5 (3 for 18px+ or 14px bold), controls and focus 3.
const lum = (h) => { const c = h.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
export const themes = {
  dark: { ground: '#141110', surface: '#1b1715', raised: '#221d1a', sunken: '#100e0d', ink: '#ede7dc', muted: '#b4a89a', faint: '#9a8f82', accent: '#e08536', accentText: '#ec934b', onAccent: '#181008',
    border: '#2e2925', control: '#776c62', focus: '#ec934b', success: '#7cc49a', successBg: '#15241b', warning: '#e5b35c', warningBg: '#2a2112', danger: '#f0907a', dangerBg: '#2f1a15', info: '#9fb3c8', infoBg: '#18202a' },
  light: { ground: '#eff1f3', surface: '#ffffff', raised: '#f7f8f9', sunken: '#e6e9ec', ink: '#1c2024', muted: '#4a525b', faint: '#5f6770', accent: '#c2410c', accentText: '#b23c0b', onAccent: '#ffffff',
    border: '#dde1e5', control: '#848c95', focus: '#c2410c', success: '#1f6b43', successBg: '#e5f3ea', warning: '#8a5300', warningBg: '#fbf0dc', danger: '#b42318', dangerBg: '#fdecea', info: '#2c5a85', infoBg: '#e8f0f8' },
};
const checks = [];
for (const [name, t] of Object.entries(themes)) {
  for (const bg of ['ground', 'surface', 'raised']) for (const fg of ['ink', 'muted', 'faint', 'accentText', 'success', 'warning', 'danger', 'info']) checks.push([name, `${fg} on ${bg}`, ratio(t[fg], t[bg]), 4.5]);
  checks.push([name, 'onAccent on accent (button)', ratio(t.onAccent, t.accent), 4.5]);
  for (const s of ['success', 'warning', 'danger', 'info']) checks.push([name, `${s} on ${s}Bg (tag)`, ratio(t[s], t[s + 'Bg']), 4.5]);
  for (const bg of ['ground', 'surface', 'raised']) { checks.push([name, `control border vs ${bg}`, ratio(t.control, t[bg]), 3]); checks.push([name, `focus ring vs ${bg}`, ratio(t.focus, t[bg]), 3]); checks.push([name, `accent vs ${bg} (current marker)`, ratio(t.accent, t[bg]), 3]); }
}
let fail = 0; for (const [th, what, r, need] of checks) { const ok = r >= need; if (!ok) fail++; if (!ok || process.argv[2] === 'all') console.log(th.padEnd(6), what.padEnd(34), r.toFixed(2), ok ? 'pass' : `FAIL (needs ${need})`); }
console.log(`${checks.length} pairs checked, ${fail} failing`);
// the current dark tokens, for the record
const old = { ground: '#141110', surface: '#1b1715', raised: '#221d1a', muted: '#b0a496', faint: '#8a7f72', hairline: '#2e2925' };
console.log('before: faint on raised', ratio(old.faint, old.raised).toFixed(2), '| faint on surface', ratio(old.faint, old.surface).toFixed(2), '| input border (hairline) vs ground', ratio(old.hairline, old.ground).toFixed(2));
