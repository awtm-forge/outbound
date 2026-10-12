import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>;
before(async () => { t = await bootstrap(); });
after(async () => { await t.teardown(); });

test('wiki: slugs, revisions, conflicts, search, nesting, delete rights', async () => {
  const admin = await t.signIn(); const m = await t.person('meera'); const r = await t.person('ravi');
  assert.equal((await t.api('GET', '/api/wiki')).status, 403);
  const a = await m.call('POST', '/api/wiki', { title: 'Onboarding: Day One!', body: '# Welcome\nRead the **handbook** and [[Leave policy]].' });
  assert.equal(a.status, 201); assert.equal(a.body.slug, 'onboarding-day-one');
  const dup = await r.call('POST', '/api/wiki', { title: 'Onboarding — day one' }); assert.equal(dup.body.slug, 'onboarding-day-one-2', 'same slug gets a number');
  const page = await r.call('GET', '/api/wiki/onboarding-day-one'); assert.equal(page.body.version, 1); assert.equal(page.body.created_by_name, 'Meera');
  // two people open version 1; the second save is refused instead of silently overwriting
  const s1 = await m.call('PUT', `/api/wiki/${a.body.id}`, { title: 'Onboarding: Day One', body: 'v2 by Meera', base_version: 1 }); assert.equal(s1.status, 200); assert.equal(s1.body.version, 2);
  assert.equal(s1.body.slug, 'onboarding-day-one', 'renaming keeps the slug, so links keep working');
  const s2 = await r.call('PUT', `/api/wiki/${a.body.id}`, { title: 'x', body: 'v2 by Ravi', base_version: 1 }); assert.equal(s2.status, 409); assert.match(s2.body.error, /Meera saved this page/);
  const revs = await r.call('GET', `/api/wiki/${a.body.id}/revisions`); assert.deepEqual(revs.body.map((x: any) => x.version), [2, 1]);
  const v1 = await r.call('GET', `/api/wiki/${a.body.id}/revisions/1`); assert.match(v1.body.body, /handbook/);
  // nesting, and no loops
  const child = await r.call('POST', '/api/wiki', { title: 'Laptop setup', body: 'Install the VPN client.', parent_id: a.body.id });
  assert.equal((await r.call('GET', '/api/wiki/onboarding-day-one')).body.children[0].slug, 'laptop-setup');
  assert.equal((await m.call('PUT', `/api/wiki/${a.body.id}`, { title: 'Onboarding', body: '', parent_id: child.body.id, base_version: 2 })).status, 400);
  assert.equal((await m.call('PUT', `/api/wiki/${a.body.id}`, { title: 'Onboarding', body: '', parent_id: a.body.id, base_version: 2 })).status, 400);
  // search: words in the body, and a title fragment; markers come back around the hit; % in a search is literal
  const found = await m.call('GET', '/api/wiki?q=vpn'); assert.equal(found.body[0].slug, 'laptop-setup'); assert.match(found.body[0].snippet, /\u0001VPN\u0002/);
  assert.equal((await m.call('GET', '/api/wiki?q=lapt')).body[0].slug, 'laptop-setup');
  assert.equal((await m.call('GET', '/api/wiki?q=%25')).body.length, 0);
  assert.equal((await m.call('GET', '/api/wiki?q=' + encodeURIComponent('"unclosed OR -'))).status, 200, 'any typed search is safe');
  // delete: not someone else's page as a member; an admin can
  assert.equal((await r.call('DELETE', `/api/wiki/${a.body.id}`)).status, 403);
  assert.equal((await admin.call('DELETE', `/api/wiki/${a.body.id}`)).status, 200);
  assert.equal((await r.call('GET', '/api/wiki/laptop-setup')).body.parent_id, null, 'children survive their parent');
  assert.equal((await r.call('DELETE', `/api/wiki/${child.body.id}`)).status, 200, 'the author can delete their own page');
});
