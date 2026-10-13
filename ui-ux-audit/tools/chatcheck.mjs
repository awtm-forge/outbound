// Chat delete, then stay on the page for 5 seconds: records every write, to tell UI behaviour from harness timing.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { B, ROLES, ids } from './ids.mjs';
const i = await ids(); const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });
const p = await ctx.newPage(); const w = []; let mark = 'login';
p.on('dialog', (d) => d.accept());
p.on('request', (r) => { if (r.method() !== 'GET' && /\/api\//.test(r.url())) w.push(`${mark}: ${r.method()} ${new URL(r.url()).pathname.replace(/[0-9a-f-]{36}/g, ':id')}`); });
await p.goto(B); await p.locator('input[autocomplete=username]').fill(ROLES.admin[0]); await p.locator('input[type=password]').fill(ROLES.admin[1]); await p.keyboard.press('Enter'); await p.waitForSelector('button:has-text("Sign out")');
await p.goto(`${B}/chat/${i.general}`); await p.waitForTimeout(1500);
mark = 'send'; const box = p.getByLabel(/^Message #general/); await box.fill('Check delete'); await box.press('Enter'); await p.locator('.msg', { hasText: 'Check delete' }).first().waitFor(); await p.waitForTimeout(5000);
mark = 'delete'; const m = p.locator('.msg', { hasText: 'Check delete' }).first(); await m.hover(); await m.getByRole('button', { name: 'Delete' }).click();
const dlg = p.locator('[role=alertdialog]'); if (await dlg.isVisible({ timeout: 800 }).catch(() => false)) await dlg.locator('[data-confirm]').click();
await p.waitForTimeout(5000); console.log(w.filter((x) => !x.startsWith('login')).join('\n')); await b.close();
