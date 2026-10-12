// Shared test bootstrap: a private database per test process, migrated and seeded, server on a random port.
process.env.AI_PROVIDER ??= 'mock'; process.env.SALESHANDY_MODE = 'mock';
process.env.CORE_API_KEY = 'test-api-key'; process.env.DASHBOARD_USER = 'tester'; process.env.DASHBOARD_PASSWORD = 'test-pass'; process.env.SALESHANDY_WEBHOOK_SECRET = 'test-webhook-secret'; process.env.SESSION_SECRET = 'test-session-secret'; process.env.AI_RETRY_BASE_MS = '5';
process.env.WEB_DIST = new URL('./fixtures/webdist', import.meta.url).pathname;
process.env.CONFIG_DIR = new URL('../config/', import.meta.url).pathname; process.env.SCHEDULER = 'off';
import pg from 'pg';
const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://awtm:awtm@127.0.0.1:55460/awtm_outbound';
const dbName = 'awtm_test_' + process.pid;
export async function bootstrap() {
  const admin = new pg.Client({ connectionString: base }); await admin.connect();
  await admin.query(`drop database if exists ${dbName}`); await admin.query(`create database ${dbName}`); await admin.end();
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/' + dbName);
  const { migrate } = await import('../src/migrate.ts'); await migrate(); await migrate(); // twice: idempotent
  const { seed } = await import('../src/seed.ts'); await seed();
  const { server } = await import('../src/server.ts');
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as any).port;
  const url = `http://127.0.0.1:${port}`;
  const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(url + path, { method, headers: { 'content-type': 'application/json', 'x-api-key': 'test-api-key', 'idempotency-key': crypto.randomUUID(), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text(); let json: any; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  };
  const teardown = async () => {
    const { pool } = await import('../src/lib/db.ts'); await new Promise<void>((r) => server.close(() => r())); await pool.end();
    const a = new pg.Client({ connectionString: base }); await a.connect(); await a.query(`drop database if exists ${dbName}`); await a.end();
  };
  // Signs in like the ops app does and returns a fetch bound to that session cookie.
  const signIn = async (user = 'tester', password = 'test-pass') => {
    // a fresh address per sign-in: the per-address throttle is tested on its own, not tripped by the suite
    const r = await fetch(url + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify({ user, password }) });
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
    const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const res = await fetch(url + path, { method, headers: { cookie, 'content-type': 'application/json', ...(method === 'GET' ? {} : { 'idempotency-key': crypto.randomUUID() }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text(); let json: any; try { json = JSON.parse(text); } catch { json = text; }
      return { status: res.status, body: json, headers: res.headers };
    };
    return { status: r.status, cookie, setCookie: r.headers.get('set-cookie') ?? '', call };
  };
  // A new person created by the admin, signed in, with their own password chosen (so nothing is held back from them).
  let adminSession: Awaited<ReturnType<typeof signIn>> | undefined;
  const person = async (username: string, role: 'admin' | 'member' = 'member', name = username[0]!.toUpperCase() + username.slice(1)) => {
    const admin = (adminSession ??= await signIn());
    const made = await admin.call('POST', '/api/users', { username, name, role, password: 'temporary-pass-1' });
    if (made.status !== 201) throw new Error(`could not create ${username}: ${JSON.stringify(made.body)}`);
    const first = await signIn(username, 'temporary-pass-1');
    const changed = await first.call('POST', '/api/me/password', { current: 'temporary-pass-1', next: `${username}-own-password` });
    if (changed.status !== 200) throw new Error('password change failed');
    return { id: made.body.id as string, ...(await signIn(username, `${username}-own-password`)) };
  };
  return { url, api, signIn, person, teardown };
}
