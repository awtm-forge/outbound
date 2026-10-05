import { readdirSync, readFileSync } from 'node:fs';
import { pool } from './lib/db.ts';
const dir = new URL('../migrations/', import.meta.url).pathname;
export async function migrate() {
  await pool.query('create table if not exists schema_migrations(name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await pool.query('select name from schema_migrations')).rows.map((r) => r.name));
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const c = await pool.connect();
    try { await c.query('begin'); await c.query(readFileSync(dir + f, 'utf8')); await c.query('insert into schema_migrations(name) values($1)', [f]); await c.query('commit'); console.log('applied', f); }
    catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  }
}
if (process.argv[1]?.endsWith('migrate.ts')) migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
