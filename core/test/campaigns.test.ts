import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>; let db: typeof import('../src/lib/db.ts');
before(async () => { t = await bootstrap(); db = await import('../src/lib/db.ts'); });
after(async () => { await t.teardown(); });

const body = { code: 'ind-web-saas', name: 'India / Web / SaaS sites', country: 'IN', service_domain: 'WEB', vertical: 'SaaS', problem: 'CONVERSION', offer: 'Two-point teardown of the signup path', buyer_titles: ['Founder', 'Head of Growth'],
  sender: 'ayush@awtmforge.com', compliance: { country: 'IN', unsubscribe_text: "Reply 'no' and I will not write again." }, config: { cta: 'Worth sending them over?', max_words: 110 } };

test('campaigns: created from the app, code uppercased and unique, each change audited', async () => {
  const m = await t.signIn();
  const made = await m.call('POST', '/api/campaigns', body); assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.code, 'IND-WEB-SAAS'); assert.equal(made.body.managed_by, 'app'); assert.equal(made.body.status, 'ACTIVE');
  assert.equal((await m.call('POST', '/api/campaigns', body)).status, 409, 'same code again is refused');
  assert.equal((await m.call('POST', '/api/campaigns', { ...body, code: 'bad code!' })).status, 400);
  assert.equal((await m.call('POST', '/api/campaigns', { ...body, code: 'IND-X', problem: 'NOT-A-PROBLEM' })).status, 400);
  assert.equal((await t.api('POST', '/api/campaigns', { ...body, code: 'IND-KEY' })).status, 201, 'the API key can add one too');
  const paused = await m.call('PATCH', '/api/campaigns/IND-WEB-SAAS', { status: 'PAUSED' }); assert.equal(paused.status, 200); assert.equal(paused.body.status, 'PAUSED');
  const edited = await m.call('PATCH', '/api/campaigns/ind-web-saas', { offer: 'A shorter teardown', config: { cta: 'Shall I send it?', max_words: 90 } }); assert.equal(edited.body.offer, 'A shorter teardown'); assert.equal(edited.body.config.max_words, 90);
  assert.equal((await m.call('PATCH', '/api/campaigns/NOPE', { status: 'PAUSED' })).status, 404);
  const acts = await db.q(`select action, actor from activities where entity_type='campaign' and entity_id=$1 order by created_at`, [made.body.id]);
  assert.deepEqual(acts.map((a) => a.action), ['created', 'status_paused', 'updated']); assert.equal(acts[0]!.actor, 'tester');
  assert.ok((await m.call('GET', '/api/campaigns')).body.campaigns.some((c: any) => c.code === 'IND-WEB-SAAS'), 'listed with the config campaigns');
});

test('campaigns: the seed on boot leaves app-made and app-edited campaigns alone', async () => {
  const m = await t.signIn();
  const ed = await m.call('PATCH', '/api/campaigns/IND-WEB-ELECTRONICS', { offer: 'Edited in the app' }); assert.equal(ed.status, 200); assert.equal(ed.body.managed_by, 'app');
  await db.q(`update campaigns set offer='Edited in the file' where code='IND-WEB-BATHROOM'`); // a config campaign that drifted: the seed puts it back
  const { seed } = await import('../src/seed.ts'); await seed();
  assert.equal((await db.one(`select offer from campaigns where code='IND-WEB-ELECTRONICS'`))!.offer, 'Edited in the app');
  assert.equal((await db.one(`select offer from campaigns where code='IND-WEB-BATHROOM'`))!.offer, 'Two-point teardown of product discovery and enquiry flow');
  assert.ok(await db.one(`select 1 from campaigns where code='IND-WEB-SAAS'`), 'an app-made campaign survives the seed');
});

test('campaigns: a programme is not editable', async () => {
  const m = await t.signIn();
  const r = await m.call('PATCH', '/api/campaigns/MASS-PROSPECTING', { status: 'PAUSED' }); assert.equal(r.status, 400); assert.match(r.body.error ?? JSON.stringify(r.body), /programme/);
  assert.equal((await db.one(`select status, managed_by from campaigns where code='MASS-PROSPECTING'`))!.managed_by, 'config');
});
