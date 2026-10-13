// Replays user flows on every screen and records the network contract: per step, the ordered mutations
// (method, path, query keys and values, body field names) and the set of reads. Run on a fresh fixture database.
// usage: node flows.mjs <outDir>
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { B, ROLES, ids } from './ids.mjs';
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const i = await ids();
const BACKGROUND = /^\/api\/(me|overview|chat\/poll|chat\/channels|jobs\/:id)$/; // timer-driven or poll-driven: compared as a set per flow
const norm = (u) => { const url = new URL(u); const path = url.pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ':id').replace(/\/\d+(?=\/|$)/g, '/:n');
  const q = [...url.searchParams.entries()].map(([k, v]) => `${k}=${/^\d+$/.test(v) ? '#' : v}`).sort().join('&'); return { path, q }; };
const keys = (o, pre = '') => !o || typeof o !== 'object' || Array.isArray(o) ? [] : Object.keys(o).sort().flatMap((k) => [pre + k, ...keys(o[k], pre + k + '.')]);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function flow(name, role, steps) {
  if (process.env.ONLY && !process.env.ONLY.split(',').includes(name)) return; // re-run some flows only
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'], extraHTTPHeaders: { 'x-forwarded-for': `10.66.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });
  const page = await ctx.newPage(); let cur = null; const rec = { flow: name, role, steps: [], background: new Set() }; let inflight = 0;
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Chose another studio' : undefined));
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(B) || !/\/(api|auth)\//.test(u)) return; const { path, q } = norm(u);
    if (!/chat\/poll/.test(path)) inflight++;
    let body = []; try { body = keys(JSON.parse(r.postData() ?? 'null')); } catch {}
    const e = `${r.method()} ${path}${q ? '?' + q : ''}${body.length ? ' {' + body.join(',') + '}' : ''}`;
    if (r.method() === 'GET' && BACKGROUND.test(path)) rec.background.add(e); else if (cur) (r.method() === 'GET' ? cur.reads : cur.writes).push(e); });
  const done = () => { inflight = Math.max(0, inflight - 1); };
  page.on('requestfinished', (r) => { if (/\/(api|auth)\//.test(r.url()) && !/chat\/poll/.test(r.url())) done(); });
  page.on('requestfailed', (r) => { if (/\/(api|auth)\//.test(r.url()) && !/chat\/poll/.test(r.url())) done(); });
  const quiet = async () => { let calm = 0; for (let t = 0; t < 200 && calm < 8; t++) { await page.waitForTimeout(100); calm = inflight === 0 ? calm + 1 : 0; } };
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const step = async (label, fn) => { cur = { step: label, writes: [], reads: [] }; try { await fn(page); await quiet(); } catch (e) { cur.error = String(e.message).split('\n')[0]; } cur.reads = [...new Set(cur.reads)].sort(); rec.steps.push(cur); cur = null; };
  if (role !== 'signed-out') {
    await page.goto(B); await page.locator('input[autocomplete=username]').fill(ROLES[role][0]); await page.locator('input[type=password]').fill(ROLES[role][1]);
    await page.keyboard.press('Enter'); await page.waitForSelector('button:has-text("Sign out")'); await quiet();
  }
  for (const [label, fn] of steps) await step(label, fn);
  rec.background = [...rec.background].sort(); if (errors.length) rec.page_errors = errors;
  writeFileSync(`${out}/${name}.json`, JSON.stringify(rec, null, 1)); await ctx.close();
  const failed = rec.steps.filter((s) => s.error); console.log(name.padEnd(16), rec.steps.length, 'steps', failed.length ? 'FAILED: ' + failed.map((s) => `${s.step}: ${s.error}`).join(' | ') : 'ok');
}
// in-app confirm (after the redesign) or the browser's own confirm/prompt (before): both end in the same request
const confirmIt = async (page, text) => {
  const dlg = page.locator('[role=alertdialog], [role=dialog][aria-modal=true]').last();
  if (await dlg.isVisible({ timeout: 800 }).catch(() => false)) { if (text) await dlg.locator('input, textarea').first().fill(text); await dlg.locator('[data-confirm]').click(); }
};
const go = (p) => async (page) => { await page.goto(B + p); };
const btn = (page, name) => page.getByRole('button', { name }).first();

await flow('login', 'signed-out', [['open', go('/')], ['sign in', async (p) => { await p.locator('input[autocomplete=username]').fill('rahul'); await p.locator('input[type=password]').fill('ui-audit-pass-1'); await p.keyboard.press('Enter'); await p.waitForSelector('button:has-text("Sign out")'); }]]);
await flow('today', 'admin', [['open', go('/')],
  ['add a to-do', async (p) => { const f = p.locator('section[aria-label="To-dos"] form'); await f.locator('input').first().fill('Call the printer'); await f.locator('input').first().press('Enter'); await p.getByText('Call the printer').first().waitFor(); }],
  ['tick it', async (p) => { await p.locator('li', { hasText: 'Call the printer' }).getByRole('checkbox').click(); }],
  ['show everyone', async (p) => { await p.getByRole('tab', { name: 'Everyone' }).click(); }]]);
await flow('review', 'admin', [['open', go('/review')],
  ['approve', async (p) => { await btn(p, /^Approve/).click(); }],
  ['reject with a reason', async (p) => { await btn(p, /^Reject/).click(); await p.getByPlaceholder(/not a fit/i).fill('Too small'); await p.locator('.reason, [data-reason]').getByRole('button', { name: /^Reject/ }).click(); }],
  ['send back for research', async (p) => { await btn(p, /^Research again/).click(); await p.getByPlaceholder(/research look at/i).fill('Product pages'); await p.getByRole('button', { name: /^Send back/ }).click(); }],
  ['approved tab', async (p) => { await p.getByRole('tab', { name: /Approved/ }).click(); }],
  ['send to saleshandy', async (p) => { await btn(p, /Saleshandy/).click(); }]]);
await flow('inbox', 'admin', [['open', go('/inbox')],
  ['draft the teardown', async (p) => { await btn(p, /teardown/i).click(); await p.waitForTimeout(2500); }],
  ['teardowns tab', async (p) => { await p.getByRole('tab', { name: /Teardowns/ }).click(); }],
  ['approve teardown', async (p) => { await btn(p, /^Approve/).click(); }],
  ['replies tab', async (p) => { await p.getByRole('tab', { name: /Replies/ }).click(); }],
  ['mark handled', async (p) => { await btn(p, /^(Handled|Mark handled)/).click(); }]]);
await flow('find', 'admin', [['open', go('/find')],
  ['open earlier search', async (p) => { await p.locator('main table tbody tr').first().click(); await p.locator('main table tbody tr').first().waitFor(); }],
  ['select one and add', async (p) => { const boxes = p.locator('tbody input[type=checkbox]:not([disabled])'); if (!(await p.locator('[aria-label="Add selected"], [data-actionbar]').isVisible().catch(() => false))) await boxes.first().check(); await btn(p, /Add to pipeline/).click(); }],
  ['new search', async (p) => { await p.goto(B + '/find'); await p.getByLabel('What they sell').fill('handmade soap'); await btn(p, /^Search$/).click(); await p.waitForURL(/s=/); }]]);
await flow('pipeline', 'admin', [['open', go('/pipeline')], ['filter qualified', async (p) => { await p.getByRole('button', { name: 'Qualified', exact: true }).click(); }],
  ['search', async (p) => { await p.getByLabel('Search prospects').fill('kav'); await p.waitForTimeout(600); }], ['open a company', async (p) => { await p.getByRole('button', { name: 'Everything', exact: true }).click(); await p.getByLabel('Search prospects').fill(''); await p.locator('main tbody tr').first().click(); await p.waitForURL(/prospects/); }]]);
await flow('prospect', 'admin', [['open', go(`/prospects/${i.prospectNoContact}`)],
  ['add a person', async (p) => { await btn(p, /Add (a person|another)/).click(); await p.getByLabel('Name', { exact: true }).fill('Arjun Mehra'); await p.getByLabel('Work email').fill('arjun@saffrontrails.in'); await btn(p, /^Save person/).click(); }],
  ['research again', async (p) => { await btn(p, /^Research again/).click(); await p.waitForTimeout(2500); }]]);
await flow('deals', 'admin', [['open', go('/deals')], ['open a meeting', async (p) => { await p.locator('main button[aria-expanded]').first().click(); }],
  ['rewrite the brief', async (p) => { await btn(p, /Rewrite the brief/).click(); await p.waitForTimeout(2500); }],
  ['approve proposal', async (p) => { const b = p.getByRole('button', { name: /^Approve/ }); if (await b.count()) await b.first().click(); }]]);
await flow('campaigns', 'admin', [['open', go('/campaigns')], ['read the numbers', async (p) => { await btn(p, /Read the numbers/).click(); await p.waitForTimeout(2500); }],
  ['do not contact', async (p) => { await p.getByLabel('Email or domain').fill('spam.example'); await p.getByLabel('Reason').fill('Asked us to stop'); await p.getByLabel('Reason').press('Enter'); }]]);
await flow('projects', 'admin', [['open', go('/projects')],
  ['new project', async (p) => { await btn(p, /New project/).click(); await p.getByLabel('Name', { exact: true }).fill('Bloom Bakery menu site'); await btn(p, /^Create/).click(); await p.waitForURL(/projects\/[0-9a-f-]{36}/); }],
  ['quick add task', async (p) => { const i = p.getByLabel(/Add a task to To do/); await i.fill('Gather the menu'); await i.press('Enter'); await p.getByText('Gather the menu').first().waitFor(); }],
  ['open task', async (p) => { await p.getByText('Gather the menu').first().click(); await p.locator('aside[role=dialog]').waitFor(); }],
  ['set status doing', async (p) => { await p.locator('aside[role=dialog]').getByLabel('Status').selectOption('DOING'); }],
  ['comment', async (p) => { const d = p.locator('aside[role=dialog]'); await d.getByPlaceholder(/comment/i).fill('Asked for the PDF'); await d.getByRole('button', { name: /^Comment/ }).click(); await d.getByText('Asked for the PDF').waitFor(); }],
  ['delete task', async (p) => { await p.locator('aside[role=dialog]').getByRole('button', { name: /Delete/ }).click(); await confirmIt(p); }],
  ['project status', async (p) => { await p.getByLabel('Status').first().selectOption('ON_HOLD'); }]]);
await flow('my-tasks', 'admin', [['open', go('/projects?view=mine')], ['add task', async (p) => { await p.getByLabel('Task', { exact: true }).fill('Send invoice'); await p.getByLabel('Task', { exact: true }).press('Enter'); await p.getByText('Send invoice').first().waitFor(); }],
  ['open a to-do', async (p) => { await p.getByText('Send invoice').first().click(); }]]);
await flow('wiki', 'admin', [['open', go('/wiki')], ['search', async (p) => { await p.getByLabel('Search the wiki').fill('leave'); await p.waitForTimeout(600); }],
  ['new page', async (p) => { await p.goto(B + '/wiki/new'); await p.getByLabel('Title').fill('Invoicing'); await p.getByLabel('Page text').fill('Send on the 1st.'); await btn(p, /^Save/).click(); await p.waitForURL(/wiki\/invoicing$/); }],
  ['edit and save', async (p) => { await p.goto(B + '/wiki/invoicing?edit=1'); await p.getByLabel('Page text').fill('Send on the 1st. Net 15.'); await btn(p, /^Save/).click(); await p.waitForURL(/wiki\/invoicing$/); }],
  ['history and restore', async (p) => { await p.goto(B + '/wiki/invoicing?history=1'); await p.getByRole('button', { name: /Version 1/ }).click(); await btn(p, /Restore/).click(); await confirmIt(p); await p.waitForURL(/wiki\/invoicing$/); }],
  // before the redesign this button had no name, so it is found by its class as a fallback
  ['delete page', async (p) => { await p.getByRole('button', { name: /Delete/ }).or(p.locator('main .head button.danger')).first().click(); await confirmIt(p); await p.waitForURL(/\/wiki$/); }]]);
await flow('chat', 'admin', [['open', go(`/chat/${i.general}`)],
  ['send', async (p) => { const box = p.getByLabel(/^Message #general/); await box.fill('Lunch at 1?'); await box.press('Enter'); await p.locator('.msg', { hasText: 'Lunch at 1?' }).first().waitFor(); }],
  ['edit own', async (p) => { const m = p.locator('.msg', { hasText: 'Lunch at 1?' }).first(); await m.hover(); await m.getByRole('button', { name: 'Edit' }).click(); const ed = p.locator('.msg textarea').first(); await ed.fill('Lunch at 1.30?'); await ed.press('Enter'); await p.getByText('Lunch at 1.30?').waitFor(); }],
  ['delete own', async (p) => { const m = p.locator('.msg', { hasText: 'Lunch at 1.30?' }).first(); await m.hover(); await m.getByRole('button', { name: 'Delete' }).click(); await confirmIt(p); await p.waitForTimeout(6000); /* let the live feed deliver the deletion, which marks the channel read */ }],
  ['new channel', async (p) => { await p.getByRole('button', { name: 'New channel' }).click(); await p.getByLabel('New channel name').fill('client-bloom'); await p.getByLabel('New channel name').press('Enter'); await p.waitForURL(/chat\//); }],
  ['message someone', async (p) => { await p.getByRole('button', { name: 'Message someone' }).first().click(); await p.locator('select[aria-label="Message someone"]').selectOption({ label: 'Meera Shah' }); await p.waitForTimeout(800); }]]);
await flow('crm', 'admin', [['open', go('/crm')],
  ['add company', async (p) => { await btn(p, /Add a company/).click(); await p.getByLabel('Name', { exact: true }).fill('Pinecone Coffee'); await p.getByLabel('Website').fill('pineconecoffee.in'); await btn(p, /^Add$/).click(); await p.waitForURL(/crm\/companies\//); }],
  ['add note', async (p) => { await p.getByPlaceholder(/What happened/).fill('Met at the expo.'); await btn(p, /Add note/).click(); await p.getByText('Met at the expo.').waitFor(); }],
  ['open a deal', async (p) => { await btn(p, /Open a deal/).click(); await p.getByLabel('Stage').first().waitFor(); }],
  ['set value', async (p) => { await p.getByLabel('Value in rupees').first().fill('1,20,000'); await p.getByLabel('Value in rupees').first().blur(); }],
  ['mark lost', async (p) => { await p.getByLabel('Stage').first().selectOption('LOST'); await confirmIt(p, 'Chose another studio'); }],
  ['add contact', async (p) => { await p.locator('section', { hasText: 'People' }).getByRole('button', { name: /^Add/ }).first().click(); await p.getByLabel('Name', { exact: true }).fill('Ira Das'); await btn(p, /^Save$/).click(); await p.getByText('Ira Das').first().waitFor(); }],
  ['opportunities tab', async (p) => { await p.goto(B + '/crm?tab=opportunities'); }], ['people tab', async (p) => { await p.goto(B + '/crm?tab=contacts'); }]]);
await flow('people', 'admin', [['open', go('/people')],
  ['add a person', async (p) => { await btn(p, /Add a person/).click(); await p.getByLabel('Full name').fill('Dev Patel'); await p.getByLabel('Job title').fill('Developer'); await btn(p, /^Add$/).click(); await p.waitForURL(/people\/[0-9a-f-]{36}/); }],
  ['record pay', async (p) => { await p.getByLabel(/Amount/).fill('75,000'); await btn(p, /Record pay/).click(); await p.waitForTimeout(500); }],
  ['leave tab approve', async (p) => { await p.goto(B + '/people?tab=leave'); await btn(p, /^Approve/).click(); }]]);
await flow('people-member', 'member', [['open leave', go('/people?tab=leave')],
  ['ask for leave', async (p) => { await p.getByLabel('From').fill('2026-11-02'); await p.getByLabel('To', { exact: true }).fill('2026-11-03'); await btn(p, /Ask for leave/).click(); await p.waitForTimeout(500); }],
  ['own record', async (p) => { await p.goto(B + `/people/${i.meera}`); }],
  ['cancel leave', async (p) => { await p.getByRole('button', { name: 'Cancel' }).first().click(); await confirmIt(p); }]]);
await flow('team', 'admin', [['open', go('/team')],
  ['add someone', async (p) => { await p.getByLabel('Full name').fill('Isha Rao'); await p.getByLabel('Sign-in name').fill('isha'); await p.getByLabel('Temporary password').last().fill('temporary-pass-9'); await btn(p, /Add to the team/).click(); await p.getByText('isha').first().waitFor(); }],
  ['make admin', async (p) => { await p.getByLabel('Role for Isha Rao').selectOption('admin'); }],
  ['reset password', async (p) => { await p.locator('tr', { hasText: 'Isha Rao' }).getByRole('button', { name: /Reset password/ }).click(); await p.getByPlaceholder('Temporary password').fill('another-temp-9'); await p.getByRole('button', { name: /^Set/ }).click(); }],
  ['switch off', async (p) => { await p.locator('tr', { hasText: 'Isha Rao' }).getByRole('button', { name: /Switch off/ }).click(); await confirmIt(p); }]]);
await flow('account', 'admin', [['open', go('/account')], ['save profile', async (p) => { await p.getByLabel('Name people see').fill('Rahul K'); await btn(p, /^Save/).click(); }]]);
await flow('member-today', 'member', [['open', go('/')], ['team is admin only', go('/team')], ['crm', go('/crm')]]);
await browser.close();
