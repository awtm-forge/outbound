// People: the directory, profiles, who may edit what, adding people with or without a sign-in, photos, leave privacy, availability.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>; let db: typeof import('../src/lib/db.ts');
before(async () => { t = await bootstrap(); db = await import('../src/lib/db.ts'); });
after(async () => { await t.teardown(); });
const leaksPay = (body: unknown) => /amount_paise|"pay"|compensation|salary/i.test(JSON.stringify(body));
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const plus = (d: number) => new Date(Date.now() + d * 86400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

test('people: add with a new sign-in, link, edit rights, loops, duplicates, skills and LinkedIn', async () => {
  const admin = await t.signIn(); const m = await t.person('ritika');
  // a directory entry with a new sign-in, in one step; the password is temporary
  const lead = await admin.call('POST', '/api/people', { full_name: 'Ayush Sharma', work_email: 'ayush@awtm.example', job_title: 'Co-founder', department: 'Leadership', signin: { username: 'ayush', role: 'admin', password: 'temporary-pass-1' } });
  assert.equal(lead.status, 201); assert.ok(lead.body.user_id);
  const u = await db.one('select must_change_password, role, email::text from users where id=$1', [lead.body.user_id]); assert.equal(u!.must_change_password, true); assert.equal(u!.role, 'admin'); assert.equal(u!.email, 'ayush@awtm.example');
  assert.equal((await admin.call('POST', '/api/people', { full_name: 'Again', signin: { username: 'ayush', password: 'temporary-pass-1' } })).status, 409, 'username taken');
  assert.match((await admin.call('POST', '/api/people', { full_name: 'Copy', work_email: 'ayush@awtm.example' })).body.error, /Ayush Sharma already uses/);
  // a member linked to an existing sign-in, and a directory-only person
  const rv = (await admin.call('POST', '/api/people', { full_name: 'Ritika Verma', user_id: m.id, job_title: 'Web Developer', department: 'Engineering', manager_id: lead.body.id })).body;
  assert.equal((await admin.call('POST', '/api/people', { full_name: 'Second', user_id: m.id })).status, 409, 'one record per sign-in');
  const km = (await admin.call('POST', '/api/people', { full_name: 'Karan Malhotra', department: 'Design', manager_id: rv.id })).body;
  assert.equal((await m.call('POST', '/api/people', { full_name: 'Sneaky' })).status, 403, 'members do not add people');
  // the person edits their own contact details and skills; not their title, and not anyone else
  const own = await m.call('PATCH', `/api/people/${rv.id}`, { phone: '+91 98765 43210', location: 'Remote', linkedin_url: 'linkedin.com/in/ritika', skills: ['React', 'react', ' Node '] });
  assert.equal(own.status, 200);
  const p = (await m.call('GET', `/api/people/${rv.id}`)).body;
  assert.deepEqual(p.skills, ['React', 'Node'], 'trimmed, no repeats'); assert.equal(p.linkedin_url, 'https://www.linkedin.com/in/ritika'); assert.equal(p.manager_name, 'Ayush Sharma'); assert.equal(p.can_edit, true); assert.equal(p.can_admin, false);
  assert.equal((await m.call('PATCH', `/api/people/${rv.id}`, { job_title: 'CTO' })).status, 403, 'title is an admin change');
  assert.equal((await m.call('PATCH', `/api/people/${km.id}`, { phone: '1' })).status, 403, 'not someone else');
  assert.equal((await m.call('PATCH', `/api/people/${rv.id}`, { linkedin_url: 'https://evil.example/in/x' })).status, 400);
  // loops in reporting lines are refused
  assert.match((await admin.call('PATCH', `/api/people/${lead.body.id}`, { manager_id: km.id })).body.error, /loop/);
  assert.equal((await admin.call('PATCH', `/api/people/${km.id}`, { manager_id: km.id })).status, 400);
  assert.equal((await admin.call('PATCH', `/api/people/${km.id}`, { job_title: 'Designer', skills: ['Figma'] })).status, 200);
  // the directory, with no pay in it for anyone
  const list = (await m.call('GET', '/api/people')).body; assert.equal(list.length, 3); assert.ok(!leaksPay(list));
  assert.equal(list.find((r: any) => r.id === km.id).availability, 'no_signin', 'no sign-in, so no activity is claimed');
  await admin.call('PATCH', `/api/people/${km.id}`, { status: 'EXITED', end_date: today() });
  assert.equal((await m.call('GET', '/api/people')).body.length, 2); assert.equal((await m.call('GET', '/api/people?former=1')).body.length, 3);
  // projects come from project membership, with the project's own colour
  const proj = (await m.call('POST', '/api/projects', { name: 'Outbound engine' })).body; await m.call('PATCH', `/api/projects/${proj.id}`, { color: '#22C55E' });
  const withP = (await admin.call('GET', `/api/people/${rv.id}`)).body; assert.equal(withP.projects[0].name, 'Outbound engine'); assert.equal(withP.projects[0].color, '#22C55E'); assert.equal(withP.projects[0].is_owner, true);
  assert.deepEqual((await admin.call('GET', `/api/people/${lead.body.id}`)).body.reports.map((r: any) => r.full_name), ['Ritika Verma']);
});

test('people: availability is only what the data says, leave reasons stay private, summary counts, photos', async () => {
  const admin = await t.signIn(); const a = await t.person('sneha'); const b = await t.person('mohit');
  const sa = (await admin.call('POST', '/api/people', { full_name: 'Sneha Kapoor', user_id: a.id, department: 'Marketing' })).body;
  const sb = (await admin.call('POST', '/api/people', { full_name: 'Mohit Arora', user_id: b.id, department: 'Operations' })).body;
  // Mohit is on approved leave today; Sneha has a pending request with a private reason
  const l1 = (await b.call('POST', '/api/hr/leave', { kind: 'SICK', start_date: today(), end_date: plus(1), reason: 'doctor visit' })).body;
  await admin.call('POST', `/api/hr/leave/${l1.id}/decision`, { action: 'APPROVE' });
  await a.call('POST', '/api/hr/leave', { kind: 'CASUAL', start_date: plus(10), end_date: plus(10), reason: 'family wedding' });
  const list = (await a.call('GET', '/api/people')).body;
  assert.equal(list.find((r: any) => r.id === sb.id).availability, 'on_leave');
  assert.equal(list.find((r: any) => r.id === sa.id).availability, 'active', 'Sneha just used the app');
  // what Sneha sees of the leave board: Mohit is out, but not why
  const lv = (await a.call('GET', '/api/people/leave')).body;
  const mohit = lv.today.find((x: any) => x.full_name === 'Mohit Arora'); assert.ok(mohit); assert.equal(mohit.kind, null); assert.equal(mohit.reason, null);
  assert.equal(lv.pending.length, 1, 'her own request only'); assert.equal(lv.pending[0].reason, 'family wedding'); assert.equal(lv.can_decide, false);
  const al = (await admin.call('GET', '/api/people/leave')).body; assert.equal(al.today.find((x: any) => x.full_name === 'Mohit Arora').reason, 'doctor visit'); assert.equal(al.can_decide, true);
  assert.equal((await a.call('GET', `/api/people/${sb.id}`)).body.leave[0].reason, null, 'a profile does not show someone else’s reason');
  const s = (await a.call('GET', '/api/people/summary')).body;
  assert.ok(s.members >= 2); assert.ok(s.on_leave >= 1); assert.ok(s.departments.some((d: any) => d.name === 'Marketing'));
  // photos: an image only, by the person or an admin
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const up = (who: { cookie: string }, id: string, body: Buffer | string, type: string) => fetch(`${t.url}/api/people/${id}/avatar?name=me.png`, { method: 'POST', headers: { cookie: who.cookie, 'content-type': type, 'idempotency-key': crypto.randomUUID() }, body: body as any });
  assert.equal((await up(a, sb.id, png, 'image/png')).status, 403);
  assert.equal((await up(a, sa.id, '%PDF-1.4', 'application/pdf')).status, 415);
  const ok = await up(a, sa.id, png, 'image/png'); assert.equal(ok.status, 201); const f = await ok.json();
  assert.equal((await fetch(`${t.url}/api/files/${f.avatar_file_id}/content`, { headers: { cookie: b.cookie } })).status, 200);
  const again = await (await up(a, sa.id, png, 'image/png')).json();
  assert.equal((await fetch(`${t.url}/api/files/${f.avatar_file_id}/content`, { headers: { cookie: b.cookie } })).status, 404, 'the old photo is removed');
  assert.equal((await a.call('DELETE', `/api/people/${sa.id}/avatar`)).status, 200);
  assert.equal((await fetch(`${t.url}/api/files/${again.avatar_file_id}/content`, { headers: { cookie: b.cookie } })).status, 404);
});
