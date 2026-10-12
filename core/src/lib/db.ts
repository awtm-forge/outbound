import pg from 'pg';
import { env } from './env.ts';
// A calendar date stays the string Postgres gave (2026-12-01); as a JS Date it would shift by the server's time zone.
pg.types.setTypeParser(1082, (v: string) => v);
// Small pool: Neon's free tier and its pooler are shared, and this app never needs more than a handful at once.
export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: env.dbPoolMax, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000 });
pool.on('error', (e) => console.error('pg pool error', e.message));
export type Row = Record<string, any>;
export const q = async <T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> => (await pool.query(text, params)).rows as T[];
export const one = async <T extends Row = Row>(text: string, params: unknown[] = []): Promise<T | undefined> => (await q<T>(text, params))[0];
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r; }
  catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
export async function audit(entity_type: string, entity_id: string, action: string, actor = 'system', detail: Row = {}) {
  await q('insert into activities(entity_type,entity_id,action,actor,detail) values($1,$2,$3,$4,$5)', [entity_type, entity_id, action, actor, detail]);
}
