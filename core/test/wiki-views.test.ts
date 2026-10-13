// The wiki dashboard: categories, editor pages, the page browser, stars, quick links, archive, templates, views, comments, files, activity.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>;
before(async () => { t = await bootstrap(); });
after(async () => { await t.teardown(); });
const doc = (...lines: string[]) => ({ type: 'doc', content: lines.map((x) => ({ type: 'paragraph', content: [{ type: 'text', text: x }] })) });

test('wiki: categories, editor pages, the browser, stars, archive and the summary', async () => {
  const m = await t.person('rhea'); const k = await t.person('kunal');
  const cats = (await m.call('GET', '/api/wiki/categories')).body; assert.equal(cats.length, 7, 'the starting categories');
  const sales = cats.find((c: any) => c.name === 'Sales & Outreach');
  const made = await m.call('POST', '/api/wiki/categories', { name: 'Finance', color: '22c55e', icon: 'dollar' }); assert.equal(made.status, 201); assert.equal(made.body.color, '#22C55E');
  assert.equal((await m.call('POST', '/api/wiki/categories', { name: 'Finance' })).status, 409, 'names are unique');
  const a = await m.call('POST', '/api/wiki', { title: 'Cold email rules', icon: '📬', description: 'How we write the first email.', category_id: sales.id, content: { ...doc('Short subject lines. One ask.'), content: [...doc('Short subject lines. One ask.').content, { type: 'paragraph', content: [{ type: 'text', text: 'x' }], attrs: { onclick: 'alert(1)' } }, { type: 'script' }] } });
  assert.equal(a.status, 201);
  const page = (await m.call('GET', `/api/wiki/${a.body.id}`)).body;
  assert.equal(page.slug, 'cold-email-rules'); assert.equal(page.category, 'Sales & Outreach'); assert.match(page.body, /One ask/, 'the text is kept for search');
  assert.ok(!JSON.stringify(page.content).includes('script'), 'unknown nodes are dropped');
  assert.equal((await m.call('GET', '/api/wiki?q=subject')).body[0].title, 'Cold email rules', 'search reads editor pages');
  const child = (await k.call('POST', '/api/wiki', { title: 'Follow-up timing', parent_id: a.body.id, category_id: sales.id, content: doc('Day 3, day 7.') })).body;
  assert.deepEqual((await k.call('GET', `/api/wiki/${child.slug}`)).body.breadcrumbs.map((b: any) => b.title), ['Cold email rules']);
  assert.equal((await m.call('PATCH', `/api/wiki/${a.body.id}`, { parent_id: child.id })).status, 400, 'no loops');
  // the browser
  await m.call('POST', '/api/wiki', { title: 'Leave policy', content: doc('Twelve days a year.') });
  let all = (await m.call('GET', '/api/wiki/pages')).body; assert.equal(all.total, 3);
  assert.equal((await m.call('GET', `/api/wiki/pages?category=${sales.id}`)).body.total, 2);
  assert.equal((await m.call('GET', '/api/wiki/pages?category=none')).body.rows[0].title, 'Leave policy');
  assert.equal((await m.call('GET', `/api/wiki/pages?author=${k.id}`)).body.rows[0].title, 'Follow-up timing');
  assert.deepEqual((await m.call('GET', '/api/wiki/pages?sort=title')).body.rows.map((r: any) => r.title), ['Cold email rules', 'Follow-up timing', 'Leave policy']);
  assert.equal((await m.call('GET', '/api/wiki/pages?q=twelve')).body.rows[0].title, 'Leave policy', 'the browser searches page text');
  // stars are each person's own
  await m.call('PATCH', `/api/wiki/${a.body.id}`, { starred: true });
  assert.equal((await m.call('GET', '/api/wiki/pages?view=starred')).body.total, 1); assert.equal((await k.call('GET', '/api/wiki/pages?view=starred')).body.total, 0);
  // archive hides a page everywhere but the archive, and restores
  await m.call('PATCH', `/api/wiki/${child.id}`, { archived: true });
  assert.equal((await m.call('GET', '/api/wiki/pages')).body.total, 2); assert.equal((await m.call('GET', '/api/wiki/pages?view=archive')).body.total, 1);
  assert.ok(!(await m.call('GET', '/api/wiki/tree')).body.some((r: any) => r.id === child.id));
  await m.call('PATCH', `/api/wiki/${child.id}`, { archived: false }); assert.equal((await m.call('GET', '/api/wiki/pages')).body.total, 3);
  const s = (await m.call('GET', '/api/wiki/summary')).body;
  assert.equal(s.pages, 3); assert.equal(s.pages_week, 3); assert.equal(s.contributors, 2); assert.equal(s.categories, 8);
  // deleting a category keeps its pages
  await m.call('DELETE', `/api/wiki/categories/${sales.id}`); assert.equal((await m.call('GET', `/api/wiki/${a.body.id}`)).body.category, null);
  // a member cannot reach the browser with the API key
  assert.equal((await t.api('GET', '/api/wiki/pages')).status, 403);
});

test('wiki: autosave keeps history sparse, conflicts are caught, templates become pages, views count once a day', async () => {
  const m = await t.person('sara'); const o = await t.person('omkar');
  const p = (await m.call('POST', '/api/wiki', { title: 'Onboarding', content: doc('Step one.') })).body;
  let v = p.version;
  for (const x of ['Step one. Two.', 'Step one. Two. Three.']) v = (await m.call('PUT', `/api/wiki/${p.id}`, { content: doc(x), base_version: v })).body.version;
  assert.equal(v, 3); assert.equal((await m.call('GET', `/api/wiki/${p.id}/revisions`)).body.length, 1, 'quick saves by the same person do not each make a snapshot');
  const theirs = await o.call('PUT', `/api/wiki/${p.id}`, { content: doc('Omkar was here.'), base_version: v }); assert.equal(theirs.status, 200);
  assert.equal((await m.call('GET', `/api/wiki/${p.id}/revisions`)).body.length, 2, 'someone else saving keeps a snapshot');
  const stale = await m.call('PUT', `/api/wiki/${p.id}`, { content: doc('Mine.'), base_version: v }); assert.equal(stale.status, 409); assert.match(stale.body.error, /Omkar saved this page/);
  const rev = (await m.call('GET', `/api/wiki/${p.id}/revisions/1`)).body; assert.equal(rev.content.content[0].content[0].text, 'Step one.');
  // templates
  const before = (await m.call('GET', '/api/wiki/pages')).body.total;
  const tpl = (await m.call('POST', '/api/wiki', { title: 'Weekly update', is_template: true, content: doc('Done:', 'Next:') })).body;
  assert.equal((await m.call('GET', '/api/wiki/pages?view=templates')).body.total, 1); assert.equal((await m.call('GET', '/api/wiki/pages')).body.total, before, 'templates are not pages');
  const used = await m.call('POST', `/api/wiki/${tpl.id}/duplicate`, { as_page: true, title: 'Weekly update, week 42' }); assert.equal(used.status, 201);
  const page = (await m.call('GET', `/api/wiki/${used.body.id}`)).body; assert.equal(page.is_template, false); assert.equal(page.content.content[1].content[0].text, 'Next:');
  // views: one per person per day
  await m.call('POST', `/api/wiki/${p.id}/view`); await m.call('POST', `/api/wiki/${p.id}/view`); await o.call('POST', `/api/wiki/${p.id}/view`);
  const pop = (await m.call('GET', '/api/wiki/popular')).body; assert.equal(pop[0].title, 'Onboarding'); assert.equal(pop[0].views, 2);
  // quick links are each person's own and keep their order
  await m.call('PUT', '/api/wiki/quick-links', { page_ids: [used.body.id, p.id] });
  assert.deepEqual((await m.call('GET', '/api/wiki/quick-links')).body.map((r: any) => r.title), ['Weekly update, week 42', 'Onboarding']);
  assert.equal((await o.call('GET', '/api/wiki/quick-links')).body.length, 0);
  // comments: mention tells that person; only the writer or an admin deletes
  const c = await m.call('POST', `/api/wiki/${p.id}/comments`, { body: 'Can you check this @omkar?' }); assert.equal(c.status, 201);
  assert.equal((await o.call('GET', '/api/notifications')).body.unread, 1);
  assert.equal((await o.call('DELETE', `/api/wiki/comments/${c.body.id}`)).status, 403); assert.equal((await m.call('DELETE', `/api/wiki/comments/${c.body.id}`)).status, 200);
  // files on a page
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const up = await fetch(`${t.url}/api/wiki/${p.id}/files?name=chart.png`, { method: 'POST', headers: { cookie: m.cookie, 'content-type': 'image/png', 'idempotency-key': crypto.randomUUID() }, body: png });
  assert.equal(up.status, 201); const f = await up.json();
  assert.equal((await m.call('GET', `/api/wiki/${p.slug}`)).body.files[0].name, 'chart.png');
  assert.equal((await fetch(`${t.url}/api/files/${f.id}/content`, { headers: { cookie: o.cookie } })).status, 200);
  // the activity feed names who did what
  const feed = (await m.call('GET', '/api/wiki/activity?limit=50')).body;
  for (const a of ['created', 'edited', 'commented', 'file_uploaded', 'template_created']) assert.ok(feed.some((x: any) => x.action === a), a);
  assert.equal(feed.find((x: any) => x.action === 'commented').actor_name, 'Sara');
  // deleting the page takes its files with it
  await m.call('DELETE', `/api/wiki/${p.id}`); assert.equal((await fetch(`${t.url}/api/files/${f.id}/content`, { headers: { cookie: m.cookie } })).status, 404);
  assert.equal((await m.call('GET', '/api/wiki/activity')).body[0].title, 'Onboarding', 'a deleted page still has its name in the feed');
});
