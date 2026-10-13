// Quick look at a few screens in both themes while building. usage: node peek.mjs out screen1,screen2 [widths]
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { B, ROLES, ids, screens } from './ids.mjs';
const [out, names, w = '1440', role = 'admin'] = process.argv.slice(2); const i = await ids(); const list = screens(i).filter(([n]) => names.split(',').includes(n));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const theme of ['light', 'dark']) {
  const ctx = await b.newContext({ colorScheme: theme, extraHTTPHeaders: { 'x-forwarded-for': `10.44.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  if (role !== 'signed-out') { await p.goto(B); await p.locator('input[autocomplete=username]').fill(ROLES[role][0]); await p.locator('input[type=password]').fill(ROLES[role][1]); await p.keyboard.press('Enter'); await p.waitForSelector('button:has-text("Sign out")', { state: 'attached' }); }
  for (const [n, path] of list) for (const width of w.split(',').map(Number)) {
    await p.setViewportSize({ width, height: width < 500 ? 844 : 900 }); await p.goto(B + path); await p.waitForTimeout(1200);
    await p.screenshot({ path: `${out}/${n}.${width}.${theme}.png`, fullPage: false });
  }
  if (errs.length) console.log(theme, errs);
  await ctx.close();
}
await b.close(); console.log('ok');
