import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>; let db: typeof import('../src/lib/db.ts');
before(async () => { t = await bootstrap(); db = await import('../src/lib/db.ts'); });
after(async () => { await t.teardown(); });
// any key or value anywhere in a response that smells of pay
const leaksPay = (body: unknown) => /amount_paise|"pay"|compensation|salary|4500000|54000000/i.test(JSON.stringify(body));

test('hr: salary is visible to admins and to nobody else, by any route', async () => {
  const admin = await t.signIn(); const m = await t.person('meera');
  const e = await admin.call('POST', '/api/hr/employees', { full_name: 'Meera Shah', user_id: m.id, job_title: 'Designer', department: 'Brand', start_date: '2026-04-01', work_email: 'meera@awtm.example' });
  assert.equal(e.status, 201);
  assert.equal((await m.call('POST', '/api/hr/employees', { full_name: 'Sneaky' })).status, 403, 'members do not create records');
  assert.equal((await m.call('PATCH', `/api/hr/employees/${e.body.id}`, { job_title: 'Lead' })).status, 403);
  assert.equal((await admin.call('POST', `/api/hr/employees/${e.body.id}/compensation`, { amount_paise: 4500000.5, effective_from: '2026-04-01' })).status, 400, 'whole paise only');
  const pay = await admin.call('POST', `/api/hr/employees/${e.body.id}/compensation`, { amount_paise: '4500000', period: 'MONTHLY', effective_from: '2026-04-01', note: 'joining' });
  assert.equal(pay.status, 201); assert.ok(!leaksPay(pay.body), 'even the admin\'s create answer carries no amount');
  await admin.call('POST', `/api/hr/employees/${e.body.id}/compensation`, { amount_paise: 54000000, period: 'ANNUAL', effective_from: '2099-01-01' });
  // admin sees it
  const aList = await admin.call('GET', '/api/hr/employees'); assert.equal(aList.body[0].pay.amount_paise, '4500000', 'current pay is the latest already in effect');
  const aOne = await admin.call('GET', `/api/hr/employees/${e.body.id}`); assert.equal(aOne.body.compensation.length, 2);
  assert.equal((await admin.call('GET', `/api/hr/employees/${e.body.id}/compensation`)).body.length, 2);
  // the member, about themselves and about anyone: nothing, not even an empty field
  for (const path of ['/api/hr/employees', '/api/hr/employees?all=1', `/api/hr/employees/${e.body.id}`, '/api/hr/me', '/api/hr/out', '/api/hr/leave']) {
    const r = await m.call('GET', path); assert.equal(r.status, 200, path); assert.ok(!leaksPay(r.body), `${path} leaked pay: ${JSON.stringify(r.body)}`);
  }
  assert.equal((await m.call('GET', '/api/hr/employees')).body[0].job_title, 'Designer', 'but the directory itself is open');
  assert.equal((await m.call('GET', `/api/hr/employees/${e.body.id}/compensation`)).status, 403);
  assert.equal((await m.call('POST', `/api/hr/employees/${e.body.id}/compensation`, { amount_paise: 1, effective_from: '2026-01-01' })).status, 403);
  assert.equal((await m.call('DELETE', `/api/hr/compensation/${pay.body.id}`)).status, 403);
  // the API key opens no HR route at all
  for (const path of ['/api/hr/employees', `/api/hr/employees/${e.body.id}`, `/api/hr/employees/${e.body.id}/compensation`]) assert.equal((await t.api('GET', path)).status, 403, path);
  // replaying the admin's idempotency key as the member gets the member's own (refused) answer, not the admin's
  const key = crypto.randomUUID();
  await admin.call('POST', `/api/hr/employees/${e.body.id}/compensation`, { amount_paise: 100, effective_from: '2020-01-01' }, { 'idempotency-key': key });
  const replay = await m.call('POST', `/api/hr/employees/${e.body.id}/compensation`, { amount_paise: 100, effective_from: '2020-01-01' }, { 'idempotency-key': key });
  assert.equal(replay.status, 403); assert.equal(replay.headers.get('idempotent-replay'), null);
  // and the audit trail never holds an amount
  const acts = await db.q(`select detail from activities where entity_type='employee' and action='compensation_added'`); assert.ok(acts.length >= 2); assert.ok(!leaksPay(acts));
  // a promoted member sees it at once; demoted, they stop
  await admin.call('PATCH', `/api/users/${m.id}`, { role: 'admin' }); assert.ok((await m.call('GET', '/api/hr/employees')).body[0].pay);
  await admin.call('PATCH', `/api/users/${m.id}`, { role: 'member' }); assert.ok(!leaksPay((await m.call('GET', '/api/hr/employees')).body));
});

test('hr: leave counts working days, refuses overlaps, is decided by an admin, and the calendar shows names and days only', async () => {
  const admin = await t.signIn(); const r = await t.person('ravi'); const other = await t.person('sana');
  assert.equal((await r.call('POST', '/api/hr/leave', { start_date: '2026-11-02', end_date: '2026-11-03' })).status, 409, 'no HR record yet');
  const er = (await admin.call('POST', '/api/hr/employees', { full_name: 'Ravi Kumar', user_id: r.id })).body;
  const es = (await admin.call('POST', '/api/hr/employees', { full_name: 'Sana Iqbal', user_id: other.id, manager_id: er.id })).body;
  assert.equal((await admin.call('PATCH', `/api/hr/employees/${er.id}`, { manager_id: es.id })).status, 400, 'no reporting loops');
  // Fri 6 Nov to Tue 10 Nov 2026: Fri, Mon, Tue = 3 working days
  const l = await r.call('POST', '/api/hr/leave', { kind: 'SICK', start_date: '2026-11-06', end_date: '2026-11-10', reason: 'Dental surgery' }); assert.equal(l.status, 201); assert.equal(l.body.days, '3.0');
  assert.equal((await r.call('POST', '/api/hr/leave', { start_date: '2026-11-10', end_date: '2026-11-11' })).status, 409, 'overlap');
  assert.equal((await r.call('POST', '/api/hr/leave', { start_date: '2026-11-12', end_date: '2026-11-13', half_day: true })).status, 400);
  assert.equal((await r.call('POST', '/api/hr/leave', { start_date: '2026-11-12', end_date: '2026-11-12', half_day: true })).body.days, '0.5');
  assert.equal((await r.call('POST', '/api/hr/leave', { start_date: '2026-11-20', end_date: '2026-11-19' })).status, 400);
  assert.equal((await r.call('POST', '/api/hr/leave', { employee_id: es.id, start_date: '2026-12-01', end_date: '2026-12-01' })).status, 403, 'not for someone else');
  assert.equal((await r.call('POST', `/api/hr/leave/${l.body.id}/decision`, { action: 'APPROVE' })).status, 403, 'not your own approval');
  assert.equal((await admin.call('POST', `/api/hr/leave/${l.body.id}/decision`, { action: 'APPROVE' })).body.status, 'APPROVED');
  assert.equal((await admin.call('POST', `/api/hr/leave/${l.body.id}/decision`, { action: 'REJECT' })).status, 409);
  const out = await other.call('GET', '/api/hr/out?from=2026-11-01&to=2026-11-30');
  assert.equal(out.body.length, 1); assert.equal(out.body[0].full_name, 'Ravi Kumar'); assert.equal(out.body[0].kind, undefined); assert.doesNotMatch(JSON.stringify(out.body), /Dental|SICK/);
  assert.equal((await admin.call('GET', '/api/hr/out?from=2026-11-01&to=2026-11-30')).body[0].kind, 'SICK');
  const sanaSees = await other.call('GET', `/api/hr/employees/${er.id}`); assert.deepEqual(sanaSees.body.leave, [], 'someone else\'s requests are theirs');
  assert.equal((await r.call('GET', `/api/hr/employees/${er.id}`)).body.leave.length, 2);
  assert.equal((await other.call('POST', `/api/hr/leave/${l.body.id}/cancel`)).status, 403);
  assert.equal((await r.call('POST', `/api/hr/leave/${l.body.id}/cancel`)).body.status, 'CANCELLED');
  assert.equal((await other.call('GET', '/api/hr/out?from=2026-11-01&to=2026-11-30')).body.length, 0);
  const pending = await admin.call('GET', '/api/hr/leave'); assert.equal(pending.body[0].status, 'PENDING');
});
test('hr: "today" is the India calendar day whatever the database clock says', async () => {
  const admin = await t.signIn(); const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const e = (await admin.call('POST', '/api/hr/employees', { full_name: 'Tara Joshi' })).body;
  await admin.call('POST', `/api/hr/employees/${e.id}/compensation`, { amount_paise: 3000000, effective_from: today });
  assert.equal((await admin.call('GET', '/api/hr/employees')).body.find((x: any) => x.id === e.id).pay.effective_from, today);
  const { TODAY_IST } = await import('../src/lib/db.ts');
  assert.equal((await db.one(`select ${TODAY_IST}::text d`))!.d, today);
});
