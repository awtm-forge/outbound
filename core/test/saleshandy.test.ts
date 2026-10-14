// Saleshandy integration: the client (paging, retries, 429), the sync (idempotent upserts, bad records skipped,
// linking, deletions), the webhook receiver (secret, duplicates, replay) and the write gateway (permission, kill
// switches, the environment guard, the spend cap, idempotency, audit). All against the fake fixture account; nothing
// here reaches Saleshandy.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';
process.env.SALESHANDY_MIN_INTERVAL_MS = '0'; process.env.SALESHANDY_BACKOFF_MS = '1';
let t: Awaited<ReturnType<typeof bootstrap>>;
before(async () => { t = await bootstrap(); });
after(async () => { await t.teardown(); });

const FLAGS = ['SALESHANDY_INTEGRATION_ENABLED', 'SALESHANDY_WRITES_ENABLED', 'SALESHANDY_WRITES_LOW', 'SALESHANDY_WRITES_MEDIUM', 'SALESHANDY_WRITES_HIGH', 'SALESHANDY_WRITES_SPEND'];
const allOn = () => { for (const f of FLAGS) process.env[f] = 'true'; };
beforeEach(async () => {
  for (const f of FLAGS) delete process.env[f];
  delete process.env.SALESHANDY_TEST_ALLOWLIST; delete process.env.SALESHANDY_TEST_SEQUENCE_ID; delete process.env.SALESHANDY_MONTHLY_CREDIT_CAP; process.env.NODE_ENV = 'test';
  const { setTransport } = await import('../src/saleshandy/client.ts'); setTransport(null);
  (await import('../src/saleshandy/mock.ts')).resetMock();
});
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ status, headers, text: JSON.stringify(body) });

test('client: one adapter per paging style, each stopping at a short page', async () => {
  const { setTransport } = await import('../src/saleshandy/client.ts');
  const pg = await import('../src/saleshandy/pagination.ts');
  const seen: { url: URL; body: any }[] = [];
  const five = [1, 2, 3, 4, 5].map((n) => ({ id: n }));
  setTransport(async (r) => {
    const url = new URL(r.url); const body = r.body ? JSON.parse(r.body) : {}; seen.push({ url, body });
    const page = Number(url.searchParams.get('page') ?? body.page ?? body.pageNum ?? 0); const size = Number(url.searchParams.get('pageSize') ?? body.limit ?? body.pageSize ?? body.pageLimit ?? url.searchParams.get('take'));
    const skip = url.searchParams.has('skip') ? Number(url.searchParams.get('skip')) : (page - 1) * size;
    return json(200, { payload: url.pathname.endsWith('/emails') ? { items: five.slice(skip, skip + size) } : five.slice(skip, skip + size) });
  });
  const ids = (a: any[]) => a.map((x) => x.id);
  assert.deepEqual(ids(await pg.collect(pg.pageQuery('/api/open-api/v1/contacts', {}, 2))), [1, 2, 3, 4, 5]);
  assert.deepEqual(seen.map((s) => [s.url.searchParams.get('page'), s.url.searchParams.get('pageSize')]), [['1', '2'], ['2', '2'], ['3', '2']], 'query page and pageSize');
  seen.length = 0; assert.deepEqual(ids(await pg.collect(pg.pageBodyLimit('/api/open-api/v1/unified-inbox/emails', { startDate: 'x' }, 2, 'items'))), [1, 2, 3, 4, 5]);
  assert.deepEqual(seen.map((s) => [s.body.page, s.body.limit, s.body.startDate]), [[1, 2, 'x'], [2, 2, 'x'], [3, 2, 'x']], 'body page and limit');
  seen.length = 0; assert.equal((await pg.collect(pg.pageBodySize('/api/open-api/v1/email-accounts', {}, 5))).length, 5);
  assert.equal(seen.length, 2, 'a full page asks once more; an empty page ends it'); assert.equal(seen[0]!.body.pageSize, 5);
  seen.length = 0; await pg.collect(pg.pageBodyNum('/api/open-api/v1/analytics/consolidated-stats', {}, 10));
  assert.deepEqual([seen[0]!.body.pageNum, seen[0]!.body.pageLimit], [1, 10], 'body pageNum and pageLimit'); assert.equal(seen.length, 1);
  seen.length = 0; assert.deepEqual(ids(await pg.collect(pg.skipTake('/api/open-api/v1/prospects/x/notes', {}, 3))), [1, 2, 3, 4, 5]);
  assert.deepEqual(seen.map((s) => [s.url.searchParams.get('skip'), s.url.searchParams.get('take')]), [['0', '3'], ['3', '3']], 'skip and take');
  assert.deepEqual(pg.itemsOf({ dncList: [1] }, 'dncList'), [1]); assert.deepEqual(pg.itemsOf(null), []);
});

test('client: retries 5xx, 429 and network errors with Retry-After honoured; never retries other 4xx; never leaks the key', async () => {
  const { setTransport, read, ShError, retryAfterMs } = await import('../src/saleshandy/client.ts');
  process.env.SALESHANDY_API_KEY = 'sk-test-0000-secret';
  try {
    let calls = 0; const headersSeen: Record<string, string>[] = [];
    setTransport(async (r) => { calls++; headersSeen.push(r.headers); return calls === 1 ? json(503, { code: 503, message: 'busy' }) : json(200, { payload: [{ id: 1 }] }); });
    assert.deepEqual(await read.get('/api/open-api/v1/sequences'), [{ id: 1 }]); assert.equal(calls, 2);
    assert.equal(headersSeen[0]!['x-api-key'], 'sk-test-0000-secret'); assert.equal(headersSeen[0]!['sh-application'], 'open-api');
    calls = 0; const t0 = Date.now();
    setTransport(async () => (++calls === 1 ? json(429, { message: 'slow down' }, { 'retry-after': '1' }) : json(200, { payload: { ok: true } })));
    assert.deepEqual(await read.get('/api/open-api/v1/sequences'), { ok: true }); assert.ok(Date.now() - t0 >= 900, 'waited for Retry-After');
    calls = 0; setTransport(async () => { calls++; return json(400, { statusCode: 400, message: ['title should not be empty'] }); });
    await assert.rejects(read.get('/api/open-api/v1/sequences'), (e: any) => e instanceof ShError && e.status === 400 && /title should not be empty/.test(e.message) && !e.message.includes('sk-test'));
    assert.equal(calls, 1, 'a 400 is not retried');
    calls = 0; setTransport(async () => { if (++calls < 3) throw new TypeError('fetch failed'); return json(200, { payload: 7 }); });
    assert.equal(await read.get('/api/open-api/v1/credits'), 7); assert.equal(calls, 3);
    calls = 0; setTransport(async () => { calls++; return json(500, { message: 'down' }); });
    await assert.rejects(read.get('/api/open-api/v1/credits'), (e: any) => e.status === 500); assert.equal(calls, 5, 'gives up after five tries');
    assert.equal(retryAfterMs('2'), 2000); assert.equal(retryAfterMs(undefined), null);
    assert.throws(() => read.post('/api/open-api/v1/notes', {}), /not a read/, 'a write cannot go through the read path');
    const { takeWriter } = await import('../src/saleshandy/client.ts'); await import('../src/saleshandy/gateway.ts');
    assert.throws(() => takeWriter(), /belongs to the write gateway/, 'only the gateway holds the writer');
  } finally { delete process.env.SALESHANDY_API_KEY; }
});

test('sync: full and incremental runs, repeat changes nothing, bad records skipped, linking, deletions', async () => {
  const { runSync, linkProspects } = await import('../src/saleshandy/sync.ts');
  const db = await import('../src/lib/db.ts');
  // our own records: a company whose domain matches some fake prospects, and one exact contact
  const co = (await db.one(`insert into companies(name, domain) values('Brightlamp (fake)', 'brightlamp.example') returning id`))!;
  const ct = (await db.one(`insert into contacts(company_id, full_name, email) values($1,'Test Prospect One','test.one@brightlamp.example') returning id`, [co.id]))!;
  const first = await runSync('full') as any;
  assert.equal(first.status, 'success', JSON.stringify(first));
  assert.equal(first.counts.sequences.upserted, 4); assert.equal(first.counts.prospects.upserted, 12); assert.equal(first.counts.inbox.upserted, 5); assert.equal(first.counts.tasks.upserted, 5);
  assert.equal(first.counts.steps.upserted, 12); assert.equal(first.counts.dnc_items.upserted, 3); assert.equal(first.counts.mailboxes.upserted, 3);
  assert.equal((await db.one(`select count(*)::int n from sh_messages`))!.n, 10, 'messages of new threads fetched');
  const again = await runSync('full') as any;
  for (const [k, c] of Object.entries<any>(again.counts)) assert.equal(c.upserted, 0, `${k} unchanged on a repeat run`);
  const one = (await db.one(`select contact_id, company_id, link_method from sh_prospects where email='test.one@brightlamp.example'`))!;
  assert.deepEqual([one.contact_id, one.company_id, one.link_method], [ct.id, co.id, 'email'], 'exact email links to the contact');
  const seven = (await db.one(`select company_id, link_method from sh_prospects where email='test.seven@brightlamp.example'`))!;
  assert.deepEqual([seven.company_id, seven.link_method], [co.id, 'domain'], 'company domain links when no contact matches');
  assert.equal((await db.one(`select count(*)::int n from sh_prospects where link_method is null`))!.n, 10, 'the rest wait on the Not linked yet list');
  // a link made by hand survives later linking
  await db.q(`update sh_prospects set company_id=null, contact_id=null, link_method='manual' where email='test.seven@brightlamp.example'`); await linkProspects();
  assert.equal((await db.one(`select link_method from sh_prospects where email='test.seven@brightlamp.example'`))!.link_method, 'manual');
  // an unsubscribed prospect in Saleshandy reaches our suppression list
  assert.ok(await db.one(`select 1 from suppression_list where email='test.seven@brightlamp.example'`));
  // a malformed record is skipped and logged; the run still completes
  const { setTransport } = await import('../src/saleshandy/client.ts'); const { mockTransport } = await import('../src/saleshandy/mock.ts');
  setTransport(async (r) => (new URL(r.url).pathname.endsWith('/contacts') && new URL(r.url).searchParams.get('page') === '1'
    ? json(200, { payload: [{ id: 'prBroken1', email: 'not an email' }, { id: 'prNew0001', email: 'test.new@quietfern.example', firstName: 'Test', lastName: 'Prospect New' }] }) : mockTransport(r)));
  const inc = await runSync('incremental') as any;
  assert.equal(inc.status, 'partial'); assert.equal(inc.counts.prospects.skipped, 1); assert.ok(inc.errors >= 1);
  assert.ok(await db.one(`select 1 from sh_prospects where id='prNew0001'`), 'the good record in the same page is stored');
  const run = (await db.one(`select errors from sh_sync_runs where id=$1`, [inc.run_id]))!; assert.equal(run.errors[0].id, 'prBroken1');
  // a prospect gone from Saleshandy leaves the mirror on the next full run (our contact stays)
  setTransport(async (r) => { const u = new URL(r.url); if (u.pathname.endsWith('/contacts')) { const res = await mockTransport(r); const b = JSON.parse(res.text); b.payload = b.payload.filter((p: any) => p.email !== 'test.one@brightlamp.example'); return { ...res, text: JSON.stringify(b) }; } return mockTransport(r); });
  const full = await runSync('full') as any; assert.ok(full.counts.prospects.removed >= 1);
  assert.equal(await db.one(`select 1 from sh_prospects where email='test.one@brightlamp.example'`), undefined);
  assert.ok(await db.one(`select 1 from contacts where id=$1`, [ct.id]), 'our own contact is never touched');
});

test('webhook: secret header required, raw stored, duplicates ignored, failures kept for replay', async () => {
  const post = (b: unknown, headers: Record<string, string> = { 'x-webhook-secret': 'test-webhook-secret' }, path = '/webhooks/saleshandy') =>
    fetch(t.url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const ev = { event: 'email-opened', eventId: 'evTest001', timestamp: '2026-10-14T05:03:00.000Z', prospect: { id: 'prFake001', email: 'test.one@brightlamp.example' }, sequence: { id: 'seqFakeA01' } };
  assert.equal((await post(ev, {})).status, 401, 'no secret');
  assert.equal((await post(ev, { 'x-webhook-secret': 'wrong-secret-value' })).status, 401, 'wrong secret');
  assert.equal((await post(ev, {}, '/webhooks/saleshandy?token=test-webhook-secret')).status, 401, 'never in the URL');
  const ok = await post(ev); assert.equal(ok.status, 200); assert.equal(ok.body.stored, 1);
  const dup = await post(ev); assert.equal(dup.body.duplicates, 1); assert.equal(dup.body.stored, 0);
  const db = await import('../src/lib/db.ts');
  const e = (await db.one(`select reliable from sh_events where id='id:evTest001'`))!; assert.equal(e.reliable, false, 'opens are marked unreliable');
  // no event id: the body hash keys it, so an identical resend is still a duplicate
  const noId = { event: 'email-sent', email: 'test.two@quietfern.example' };
  assert.equal((await post(noId)).body.stored, 1); assert.equal((await post(noId)).body.duplicates, 1);
  // a payload that fails to process is kept with its error and can be replayed
  const bad = await post({ event: 'email-bounced', eventId: 'evTest002', timestamp: 'not-a-date', prospect: { id: 'prFake011', email: 'test.eleven@saltandsage.example' } });
  assert.equal(bad.status, 200, 'answered fast even when processing fails');
  const row = (await db.one(`select id, status, last_error, attempts from sh_webhook_inbox where event_key='id:evTest002'`))!;
  assert.equal(row.status, 'failed'); assert.ok(row.last_error);
  const admin = await t.signIn();
  await admin.call('POST', `/api/sh/webhooks/${row.id}/replay`, {});
  assert.equal((await db.one(`select attempts from sh_webhook_inbox where id=$1`, [row.id]))!.attempts, 2);
});

test('gateway: permission, every kill switch, environment guard, spend cap, idempotency, audit', async () => {
  const { execute, cancel, sendPending } = await import('../src/saleshandy/gateway.ts');
  const { runSync } = await import('../src/saleshandy/sync.ts');
  const { setTransport } = await import('../src/saleshandy/client.ts'); const { mockTransport } = await import('../src/saleshandy/mock.ts');
  const db = await import('../src/lib/db.ts');
  const writes: string[] = []; setTransport(async (r) => { if (r.method !== 'GET' && !r.url.includes('/unified-inbox/emails') || r.url.endsWith('/reply')) writes.push(`${r.method} ${new URL(r.url).pathname}`); return mockTransport(r); });
  await runSync('full'); writes.length = 0;
  const m = await t.person('shmember'); const a = await t.person('shadmin', 'admin');
  const member = { kind: 'user' as const, id: m.id, name: 'Shmember', role: 'member' as const }; const admin = { kind: 'user' as const, id: a.id, name: 'Shadmin', role: 'admin' as const };
  let k = 0; const key = () => `test-key-${++k}`;
  const note = { prospectIds: ['prFake001'], content: 'Fake note from a test' };
  // kill switches, one at a time
  let r = await execute(member, 'note.create', note, key()); assert.equal(r.outcome, 'refused'); assert.match(r.reason!, /SALESHANDY_INTEGRATION_ENABLED/);
  allOn(); process.env.SALESHANDY_WRITES_ENABLED = 'false';
  r = await execute(member, 'note.create', note, key()); assert.match(r.reason!, /SALESHANDY_WRITES_ENABLED/);
  allOn(); process.env.SALESHANDY_WRITES_LOW = 'false';
  r = await execute(member, 'note.create', note, key()); assert.match(r.reason!, /SALESHANDY_WRITES_LOW/);
  allOn(); process.env.SALESHANDY_WRITES_MEDIUM = 'false';
  r = await execute(member, 'dnc.add', { listId: 'dncFake1', items: ['test.two@quietfern.example'] }, key()); assert.match(r.reason!, /SALESHANDY_WRITES_MEDIUM/);
  allOn(); process.env.SALESHANDY_WRITES_HIGH = 'false';
  r = await execute(admin, 'sequence.create', { title: 'Fake new sequence' }, key()); assert.match(r.reason!, /SALESHANDY_WRITES_HIGH/);
  allOn(); process.env.SALESHANDY_WRITES_SPEND = 'false';
  r = await execute(admin, 'enrich.company', { domains: ['brightlamp.example'] }, key()); assert.match(r.reason!, /SALESHANDY_WRITES_SPEND/);
  allOn();
  // permission
  r = await execute(member, 'inbox.reply', { threadId: 'thFake001', emailId: 'emFake001', content: 'Fake reply', to: ['test.three@tinkerbay.example'] }, key());
  assert.equal(r.outcome, 'refused'); assert.match(r.reason!, /Only an admin/);
  r = await execute({ kind: 'system' }, 'note.create', note, key()); assert.match(r.reason!, /Only a person/);
  // environment guard: outside production only allowlisted addresses and the test sequence
  r = await execute(member, 'note.create', note, key()); assert.match(r.reason!, /test allowlist/, 'empty allowlist refuses');
  process.env.SALESHANDY_TEST_ALLOWLIST = 'awtmforge.com';
  r = await execute(member, 'note.create', note, key()); assert.match(r.reason!, /brightlamp\.example/, 'a non-allowlisted address is refused');
  process.env.SALESHANDY_TEST_ALLOWLIST = 'awtmforge.com, brightlamp.example';
  r = await execute(member, 'sequence.set_status', { sequenceIds: ['seqFakeA01'], status: 'paused' }, key()); assert.match(r.reason!, /SALESHANDY_TEST_SEQUENCE_ID/);
  process.env.SALESHANDY_TEST_SEQUENCE_ID = 'seqFakeD04';
  r = await execute(member, 'sequence.set_status', { sequenceIds: ['seqFakeA01'], status: 'paused' }, key()); assert.match(r.reason!, /only the test sequence/, 'a non-test sequence is refused');
  r = await execute(admin, 'sequence.create', { title: 'Fake new sequence' }, key()); assert.match(r.reason!, /creating a sequence is refused/);
  assert.equal(writes.length, 0, 'nothing refused reached the transport');
  // allowed: an allowlisted prospect, the test sequence
  const k1 = key(); r = await execute(member, 'note.create', note, k1); assert.equal(r.outcome, 'sent', r.reason ?? '');
  const again = await execute(member, 'note.create', note, k1); assert.equal(again.replay, true); assert.equal(again.outcome, 'sent');
  assert.equal(writes.filter((w) => w.endsWith('/notes')).length, 1, 'a repeated key sends once');
  assert.ok(await db.one(`select 1 from sh_notes where prospect_id='prFake001' and content='Fake note from a test'`), 'refreshed right after the write');
  r = await execute(member, 'sequence.set_status', { sequenceIds: ['seqFakeD04'], status: 'paused' }, key()); assert.equal(r.outcome, 'sent');
  const audit = (await db.one(`select * from sh_write_audit where idempotency_key=$1`, [k1]))!;
  assert.equal(audit.outcome, 'sent'); assert.equal(audit.actor, 'Shmember'); assert.equal(audit.request.path, '/api/open-api/v1/notes'); assert.ok(audit.response); assert.deepEqual(audit.targets.emails, ['test.one@brightlamp.example']);
  assert.ok(!JSON.stringify(audit).includes('x-api-key'), 'no secrets in the audit');
  // a failure is audited as failed with the reason
  setTransport(async (req) => (req.method === 'PATCH' ? json(400, { code: 400, type: 'general', message: 'Fake validation failure' }) : mockTransport(req)));
  const kf = key(); r = await execute(member, 'note.update', { noteId: 'ntFake001', content: 'x' }, kf);
  // ntFake001 belongs to prFake003 (tinkerbay.example), not allowlisted: refused before sending; use an allowlisted note instead
  assert.equal(r.outcome, 'refused');
  const myNote = (await db.one(`select id from sh_notes where prospect_id='prFake001' limit 1`))!.id;
  const kf2 = key(); r = await execute(member, 'note.update', { noteId: myNote, content: 'changed' }, kf2);
  assert.equal(r.outcome, 'failed'); assert.match(r.reason!, /Fake validation failure/);
  const fa = (await db.one(`select outcome, reason, response from sh_write_audit where idempotency_key=$1`, [kf2]))!; assert.equal(fa.outcome, 'failed'); assert.equal(fa.response.status, 400);
  setTransport(mockTransport);
  // high risk: held 10 seconds, can be undone, and the switches are checked again when it is sent
  r = await execute(admin, 'sequence.set_status', { sequenceIds: ['seqFakeD04'], status: 'active' }, key()); assert.equal(r.outcome, 'pending'); assert.ok(r.send_at);
  await assert.rejects(cancel(r.audit_id, member), /Only the person who started this/);
  assert.equal((await cancel(r.audit_id, admin)).outcome, 'cancelled');
  r = await execute(admin, 'sequence.set_status', { sequenceIds: ['seqFakeD04'], status: 'active' }, key());
  await db.q(`update sh_write_audit set send_at=now() where id=$1`, [r.audit_id]); process.env.SALESHANDY_WRITES_HIGH = 'false';
  assert.equal((await sendPending(r.audit_id))!.outcome, 'refused', 'switching off during the window stops it'); allOn();
  r = await execute(admin, 'sequence.set_status', { sequenceIds: ['seqFakeD04'], status: 'active' }, key());
  await db.q(`update sh_write_audit set send_at=now() where id=$1`, [r.audit_id]);
  assert.equal((await sendPending(r.audit_id))!.outcome, 'sent'); assert.equal(await sendPending(r.audit_id), null, 'sent once');
  // spend: always refused outside production; in production, the monthly cap
  r = await execute(admin, 'enrich.company', { domains: ['brightlamp.example'] }, key()); assert.match(r.reason!, /credit-spending calls are refused/);
  process.env.NODE_ENV = 'production';
  try {
    r = await execute(admin, 'enrich.company', { domains: ['a.example'] }, key()); assert.match(r.reason!, /No monthly credit cap/);
    process.env.SALESHANDY_MONTHLY_CREDIT_CAP = '5';
    r = await execute(admin, 'enrich.company', { domains: ['a.example', 'b.example', 'c.example', 'd.example', 'e.example', 'f.example'] }, key()); assert.match(r.reason!, /about 6 credits/);
    r = await execute(admin, 'enrich.company', { domains: ['a.example', 'b.example', 'c.example'] }, key()); assert.equal(r.outcome, 'sent');
    const spend = (await db.one(`select estimated, actual from sh_credit_spend order by created_at desc limit 1`))!; assert.equal(spend.estimated, 3); assert.equal(spend.actual, 3);
    r = await execute(admin, 'enrich.company', { domains: ['g.example', 'h.example', 'i.example'] }, key()); assert.match(r.reason!, /3 of the 5/);
  } finally { process.env.NODE_ENV = 'test'; }
  // through the HTTP route: the browser's idempotency key, and a member is refused a high risk action
  const mm = await t.signIn('shmember', 'shmember-own-password');
  const viaHttp = await mm.call('POST', '/api/sh/actions', { action: 'inbox.reply', input: { threadId: 'thFake001', emailId: 'emFake001', content: 'Fake', to: ['test.three@tinkerbay.example'] } }, { 'idempotency-key': 'http-key-1' });
  assert.equal(viaHttp.body.outcome, 'refused'); assert.match(viaHttp.body.reason, /Only an admin/);
  const status = await mm.call('GET', '/api/sh/status'); assert.equal(status.status, 200); assert.equal(status.body.flags.integration, true);
  assert.ok(!JSON.stringify(status.body).includes('sk-'), 'no key in the status payload');
});

test('live checks: reads report every resource without writing; the test sequence check touches only the test sequence and allowlisted people', async () => {
  const { readChecks, testSequenceCheck } = await import('../src/saleshandy/livecheck.ts');
  const { setTransport } = await import('../src/saleshandy/client.ts'); const { mockTransport } = await import('../src/saleshandy/mock.ts');
  const db = await import('../src/lib/db.ts');
  process.env.SALESHANDY_INTEGRATION_ENABLED = 'true';
  const sent: { method: string; path: string; body: any }[] = [];
  setTransport(async (r) => { sent.push({ method: r.method, path: new URL(r.url).pathname, body: r.body ? JSON.parse(r.body) : null }); const res = await mockTransport(r); return r.url.includes('/sequences?') ? { ...res, headers: { ...res.headers, 'x-ratelimit-remaining': '99', 'x-other': 'no' } } : res; });
  // reads: every resource answers, the rate limit headers are reported, nothing is written, the key never appears
  const r = await readChecks();
  assert.equal(r.mode, 'fake'); assert.equal(r.steps.filter((s) => s.ok === false).length, 0, r.steps.map((s) => s.detail).join(' | '));
  assert.match(r.steps.find((s) => s.name === 'Rate limit headers')!.detail, /x-ratelimit-remaining: 99/); assert.doesNotMatch(JSON.stringify(r), /x-other|x-api-key/);
  assert.ok(sent.every((s) => s.method === 'GET' || ['/api/open-api/v1/unified-inbox/emails', '/api/open-api/v1/email-accounts', '/api/open-api/v1/credits'].includes(s.path)), 'reads only');
  const a = await t.person('lcadmin', 'admin', 'Live Check Admin'); const admin = { kind: 'user' as const, id: a.id, name: 'Live Check Admin', role: 'admin' as const };
  // without the two settings it does not run
  assert.equal((await testSequenceCheck(admin)).summary, 'Not run.');
  // with writes off, every write shows as refused and nothing reaches Saleshandy
  process.env.SALESHANDY_TEST_SEQUENCE_ID = 'seqFakeA01'; process.env.SALESHANDY_TEST_ALLOWLIST = 'brightlamp.example';
  sent.length = 0; const off = await testSequenceCheck(admin);
  assert.ok(off.steps.filter((s) => /risk/.test(s.name)).every((s) => s.ok === false && /Refused/.test(s.detail)));
  assert.ok(sent.every((s) => s.method === 'GET' || s.path.endsWith('/emails') || s.path.endsWith('/email-accounts') || s.path.endsWith('/consolidated-stats')), 'no writes while switched off');
  // switched on: each write goes to the test sequence or the allowlisted prospect only, and the sequence ends as it began
  allOn(); sent.length = 0; const on = await testSequenceCheck(admin);
  assert.equal(on.steps.filter((s) => s.ok === false).length, 0, on.steps.map((s) => `${s.name}: ${s.detail}`).join(' | '));
  const writes = sent.filter((s) => s.method !== 'GET' && !s.path.endsWith('/emails') && !s.path.endsWith('/email-accounts') && !s.path.endsWith('/consolidated-stats'));
  assert.ok(writes.length >= 6, 'pause, resume, note, tag on, tag off, task');
  assert.ok(writes.every((w) => !JSON.stringify(w.body ?? {}).match(/seqFake(B|C|D)0|prFake0(0[2-9]|1)/)), 'nothing outside the test sequence and the allowlisted prospect');
  assert.equal((await db.one(`select active from sh_sequences where id='seqFakeA01'`))!.active, true, 'resumed after the pause');
  assert.ok(Number((await db.one(`select count(*)::int n from sh_write_audit where idempotency_key like 'livecheck:%' and outcome='sent'`))!.n) >= 6, 'every write is in the audit log');
  // a paused test sequence is never resumed (the fixture's 'ops portal test' is paused, with nobody in it)
  process.env.SALESHANDY_TEST_SEQUENCE_ID = 'seqFakeD04'; sent.length = 0; const paused = await testSequenceCheck(admin);
  assert.equal(paused.steps.find((s) => s.name === 'Pause and resume')!.ok, null);
  assert.ok(!sent.some((s) => s.path === '/v1/sequences/status'), 'no status change sent');
  assert.match(paused.steps.find((s) => s.name === 'Test prospect')!.detail, /Add one such prospect/);
});
