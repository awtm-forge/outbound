// Lighthouse accessibility score for every admin screen (plus the sign-in page), desktop preset.
// usage: node lh.mjs <jsonOut>
import { execFileSync } from 'node:child_process'; import { writeFileSync } from 'node:fs';
import { B, ids, screens } from './ids.mjs';
const i = await ids(); const out = {};
const login = await fetch(B + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.99.0.1' }, body: JSON.stringify({ user: 'rahul', password: 'ui-audit-pass-1' }) });
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
for (const [name, path, roles] of screens(i)) {
  if (!roles.includes('admin') && name !== 'login') continue;
  const headers = name === 'login' ? '{}' : JSON.stringify({ Cookie: cookie });
  try {
    const raw = execFileSync(new URL('./node/node_modules/.bin/lighthouse', import.meta.url).pathname, [B + path, '--only-categories=accessibility', '--preset=desktop', '--quiet', '--output=json', '--max-wait-for-load=12000',
      `--extra-headers=${headers}`, '--chrome-flags=--headless=new --no-sandbox --disable-gpu'], { env: { ...process.env, CHROME_PATH: '/opt/pw-browsers/chromium' }, maxBuffer: 64 << 20, timeout: 90000 });
    const r = JSON.parse(raw.toString()); const a = r.categories.accessibility;
    out[name] = { score: Math.round(a.score * 100), failing: a.auditRefs.filter((x) => r.audits[x.id].score === 0 && x.weight > 0).map((x) => x.id) };
  } catch (e) { out[name] = { error: String(e.message).slice(0, 160) }; }
  console.log(name, JSON.stringify(out[name]));
}
writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
