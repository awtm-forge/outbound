// Shared test bootstrap: a private database per test process, migrated and seeded, server on a random port.
process.env.AI_PROVIDER ??= 'mock'; process.env.SALESHANDY_MODE = 'mock';
process.env.CORE_API_KEY = 'test-api-key'; process.env.DASHBOARD_USER = 'tester'; process.env.DASHBOARD_PASSWORD = 'test-pass'; process.env.SALESHANDY_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.CONFIG_DIR = new URL('../../config/', import.meta.url).pathname;
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
  return { url, api, teardown };
}
