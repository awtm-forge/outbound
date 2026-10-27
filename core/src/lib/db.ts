import pg from 'pg';
import { env } from './env.ts';
// A calendar date stays the string Postgres gave (2026-12-01); as a JS Date it would shift by the server's time zone.
pg.types.setTypeParser(1082, (v: string) => v);
// Some home routers refuse to resolve Neon's long hostnames. DB_HOST_ADDRS (comma-separated addresses, looked up with a
// public resolver by whoever starts the process) makes connections by address while TLS keeps the hostname for SNI and
// the certificate check, which Neon's pooler needs. Each new connection takes the next address. Unset on servers.
function poolConfig(): pg.PoolConfig {
  const base: pg.PoolConfig = { max: env.dbPoolMax, idleTimeoutMillis: 30_000, connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15_000) };
  const addrs = (process.env.DB_HOST_ADDRS ?? '').split(',').map((a) => a.trim()).filter(Boolean);
  if (!addrs.length) return { ...base, connectionString: env.databaseUrl };
  const u = new URL(env.databaseUrl); let i = 0;
  return { ...base, get host() { return addrs[i++ % addrs.length]; }, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1), ssl: { rejectUnauthorized: true, servername: u.hostname } } as pg.PoolConfig;
}
// Transient network failures (a dropped TLS record, a connect timeout, a DNS blip) are retried a few times before a
// query is given up on. Anything else, including every SQL error, surfaces at once.
const TRANSIENT = /EPROTO|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timeout exceeded when trying to connect|Connection terminated|terminating connection|server closed the connection|socket hang up/i;
async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); }
    catch (e: any) { if (attempt >= tries || !TRANSIENT.test(String(e?.message))) throw e; await new Promise((r) => setTimeout(r, 400 * attempt * attempt)); }
  }
}
// Small pool: Neon's free tier and its pooler are shared, and this app never needs more than a handful at once.
export const pool = new pg.Pool(poolConfig());
pool.on('error', (e) => console.error('pg pool error', e.message));
export type Row = Record<string, any>;
// Today as a calendar day in India. current_date follows the database's time zone (UTC on Neon), which is a day behind
// until 05:30 IST; a session SET would not survive Neon's transaction pooler, so say it in the query instead.
export const TODAY_IST = `(now() at time zone 'Asia/Kolkata')::date`;
export const q = async <T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> => (await withRetry(() => pool.query(text, params))).rows as T[];
export const one = async <T extends Row = Row>(text: string, params: unknown[] = []): Promise<T | undefined> => (await q<T>(text, params))[0];
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await withRetry(() => pool.connect());
  try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r; }
  catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
export async function audit(entity_type: string, entity_id: string, action: string, actor = 'system', detail: Row = {}) {
  await q('insert into activities(entity_type,entity_id,action,actor,detail) values($1,$2,$3,$4,$5)', [entity_type, entity_id, action, actor, detail]);
}
