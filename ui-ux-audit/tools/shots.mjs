// Screenshots of every screen at four widths (and each theme), plus an axe scan of each screen at 1440.
// usage: node shots.mjs <outDir> <themes: dark|light,dark> <axeJsonOut>
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { AxeBuilder } from './node/node_modules/@axe-core/playwright/dist/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { B, ROLES, ids, screens } from './ids.mjs';
const [out, themesArg, axeOut] = process.argv.slice(2); const themes = themesArg.split(','); mkdirSync(out, { recursive: true });
const WIDTHS = [1440, 1024, 768, 390]; const i = await ids(); const list = screens(i);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const axe = {}; let n = 0;
for (const role of ['signed-out', 'admin', 'member']) for (const theme of themes) {
  const ctx = await browser.newContext({ colorScheme: theme, viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': `10.55.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });
  await ctx.addInitScript((t) => { try { localStorage.setItem('awtm-theme', t); } catch {} }, theme);
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  if (role !== 'signed-out') {
    await page.goto(B); await page.locator('input[autocomplete=username]').fill(ROLES[role][0]); await page.locator('input[type=password]').fill(ROLES[role][1]);
    await page.keyboard.press('Enter'); await page.waitForSelector('button:has-text("Sign out")');
  }
  for (const [name, path, roles] of list) {
    if (!roles.includes(role)) continue;
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 });
      await page.goto(B + path); await page.waitForLoadState('domcontentloaded');
      await page.waitForSelector('main h1, main .co-name, form h1, .login form, main .empty, [role=dialog]', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(700);
      const file = `${name}${role === 'admin' || role === 'signed-out' ? '' : '.' + role}.${w}.${theme}.jpg`;
      await page.screenshot({ path: `${out}/${file}`, fullPage: true, type: 'jpeg', quality: 55 }); n++;
      if (w === 1440 && axeOut) {
        const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        axe[`${name}${role === 'member' ? '.member' : ''}.${theme}`] = r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(' ') }));
      }
    }
  }
  if (errors.length) console.log(role, theme, 'page errors:', errors.slice(0, 3));
  await ctx.close();
}
if (axeOut) writeFileSync(axeOut, JSON.stringify(axe, null, 1));
console.log('screenshots', n);
await browser.close();
