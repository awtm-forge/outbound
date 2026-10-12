import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>; let db: typeof import('../src/lib/db.ts');
before(async () => { t = await bootstrap(); db = await import('../src/lib/db.ts'); });
after(async () => { await t.teardown(); });

test('the shared dashboard sign-in becomes the first admin, once, with a hashed password', async () => {
  const rows = await db.q('select username::text, role, password_hash from users');
  assert.equal(rows.length, 1); assert.equal(rows[0].username, 'tester'); assert.equal(rows[0].role, 'admin');
  assert.match(rows[0].password_hash, /^scrypt\$/); assert.doesNotMatch(rows[0].password_hash, /test-pass/);
  const { ensureFirstAdmin } = await import('../src/lib/auth.ts'); assert.equal(await ensureFirstAdmin(), false);
  const me = await (await t.signIn()).call('GET', '/api/me'); assert.equal(me.body.role, 'admin'); assert.equal(me.body.session, true); assert.ok(me.body.id);
});
test('X-Api-Key still opens the outbound API, but not personal or admin routes', async () => {
  const me = await t.api('GET', '/api/me'); assert.equal(me.status, 200); assert.equal(me.body.role, 'service'); assert.equal(me.body.user, 'n8n');
  assert.equal((await t.api('GET', '/api/prospects')).status, 200);
  assert.equal((await t.api('GET', '/api/users')).status, 403);
  assert.equal((await t.api('GET', '/api/team')).status, 403);
  assert.equal((await fetch(t.url + '/api/team')).status, 401);
});
test('admin creates a member; the temporary password must be replaced before anything else opens', async () => {
  const admin = await t.signIn();
  assert.equal((await admin.call('POST', '/api/users', { username: 'meera', name: 'Meera', password: 'short' })).status, 400);
  assert.equal((await admin.call('POST', '/api/users', { username: 'bad name!', name: 'X', password: 'long-enough-1' })).status, 400);
  const made = await admin.call('POST', '/api/users', { username: 'meera', name: 'Meera Shah', email: 'meera@awtm.example', password: 'temporary-pass-1' });
  assert.equal(made.status, 201); assert.equal(made.body.role, 'member');
  assert.equal((await admin.call('POST', '/api/users', { username: 'MEERA', name: 'Dup', password: 'temporary-pass-1' })).status, 409);
  const first = await t.signIn('meera@awtm.example', 'temporary-pass-1'); assert.equal(first.status, 200); // email works as the sign-in name
  const me = await first.call('GET', '/api/me'); assert.equal(me.body.must_change_password, true);
  const blocked = await first.call('GET', '/api/prospects'); assert.equal(blocked.status, 403); assert.equal(blocked.body.must_change_password, true);
  assert.equal((await first.call('POST', '/api/me/password', { current: 'wrong', next: 'meera-own-password' })).status, 400);
  const ch = await first.call('POST', '/api/me/password', { current: 'temporary-pass-1', next: 'meera-own-password' }); assert.equal(ch.status, 200);
  assert.equal((await first.call('GET', '/api/me')).status, 401, 'the old session ends when the password changes');
  const s = await t.signIn('meera', 'meera-own-password');
  assert.equal((await s.call('GET', '/api/prospects')).status, 200, 'members use the outbound screens');
  assert.equal((await s.call('GET', '/api/users')).status, 403, 'but cannot manage people');
  assert.equal((await s.call('POST', '/api/users', { username: 'x1', name: 'X', password: 'temporary-pass-1' })).status, 403);
  const team = await s.call('GET', '/api/team'); assert.deepEqual(team.body.map((u: any) => u.username).sort(), ['meera', 'tester']); assert.equal(team.body[0].password_hash, undefined);
});
test('deactivating or resetting a password ends that person\'s sessions; the last admin cannot be removed', async () => {
  const admin = await t.signIn(); const p = await t.person('ravi');
  assert.equal((await p.call('GET', '/api/me')).status, 200);
  assert.equal((await admin.call('POST', `/api/users/${p.id}/password`, { password: 'reset-by-admin-1' })).status, 200);
  assert.equal((await p.call('GET', '/api/me')).status, 401);
  const again = await t.signIn('ravi', 'reset-by-admin-1'); assert.equal((await again.call('GET', '/api/me')).body.must_change_password, true);
  assert.equal((await admin.call('PATCH', `/api/users/${p.id}`, { active: false })).status, 200);
  assert.equal((await again.call('GET', '/api/me')).status, 401); assert.equal((await t.signIn('ravi', 'reset-by-admin-1')).status, 401);
  const adminId = (await admin.call('GET', '/api/me')).body.id;
  assert.equal((await admin.call('PATCH', `/api/users/${adminId}`, { role: 'member' })).status, 409);
  assert.equal((await admin.call('PATCH', `/api/users/${adminId}`, { active: false })).status, 409);
  const second = await t.person('nisha', 'admin');
  assert.equal((await second.call('GET', '/api/users')).status, 200);
  assert.equal((await second.call('PATCH', `/api/users/${second.id}`, { role: 'member' })).status, 200);
  assert.equal((await second.call('GET', '/api/users')).status, 403, 'a role change applies at once');
});
test('a session cookie from before personal logins, or one naming a different version, is refused', async () => {
  const { createHmac } = await import('node:crypto');
  const sign = (o: object) => { const v = Buffer.from(JSON.stringify(o)).toString('base64url'); return `awtm_session=${v}.${createHmac('sha256', 'test-session-secret').update(v).digest('base64url')}`; };
  assert.equal((await fetch(t.url + '/api/me', { headers: { cookie: sign({ u: 'tester', exp: Date.now() + 1e6 }) } })).status, 401);
  const id = (await db.one(`select id, session_version from users where username='tester'`))!;
  assert.equal((await fetch(t.url + '/api/me', { headers: { cookie: sign({ uid: id.id, sv: id.session_version + 1, exp: Date.now() + 1e6 }) } })).status, 401);
  assert.equal((await fetch(t.url + '/api/me', { headers: { cookie: sign({ uid: id.id, sv: id.session_version, exp: Date.now() + 1e6 }) } })).status, 200);
});
test('idempotency keys belong to the person who sent them', async () => {
  const a = await t.person('arun'); const b = await t.person('bela'); const key = crypto.randomUUID();
  const ra = await a.call('POST', '/api/me/profile', { name: 'Arun K' }, { 'idempotency-key': key }); assert.equal(ra.status, 200);
  const rb = await b.call('POST', '/api/me/profile', { name: 'Bela S' }, { 'idempotency-key': key });
  assert.equal(rb.headers.get('idempotent-replay'), null);
  assert.equal((await b.call('GET', '/api/me')).body.name, 'Bela S');
});
test('login is the same failure for an unknown name and a wrong password', async () => {
  const a = await t.signIn('nobody-here', 'whatever-pass'); const b = await t.signIn('tester', 'wrong-pass-123');
  assert.equal(a.status, 401); assert.equal(b.status, 401);
});
test('sign-in throttles: ten tries per address, and twenty failures per account from any address', async () => {
  const from = (ip: string, user: string, password: string) => fetch(t.url + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ user, password }) });
  for (let i = 0; i < 10; i++) await from('10.200.0.1', 'nobody', 'x');
  assert.equal((await from('10.200.0.1', 'tester', 'test-pass')).status, 429);
  await t.person('target');
  for (let i = 0; i < 20; i++) assert.equal((await from(`10.201.0.${i}`, 'target', 'wrong')).status, 401);
  assert.equal((await from('10.202.0.1', 'target', 'target-own-password')).status, 429);
});
