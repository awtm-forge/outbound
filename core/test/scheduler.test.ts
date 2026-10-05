import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>;
before(async () => { t = await bootstrap(); }); after(async () => { await t.teardown(); });
test('a job runs once per slot even when two processes tick together; a failing job is recorded, not thrown', async () => {
  const S = await import('../src/scheduler.ts'); const { q } = await import('../src/lib/db.ts');
  let n = 0; const job = { name: 'core:test_job', due: () => true, run: async () => { n++; await new Promise((r) => setTimeout(r, 150)); return { ok: true }; } };
  const [a, b] = await Promise.all([S.runJob(job, '2026-10-05T10:15'), S.runJob(job, '2026-10-05T10:15')]);
  assert.equal(n, 1, JSON.stringify([a, b])); assert.ok([a, b].some((r: any) => r.skipped));
  assert.deepEqual(await S.runJob(job, '2026-10-05T10:15'), { skipped: 'already ran this slot' });
  await S.runJob(job, '2026-10-05T10:30'); assert.equal(n, 2);
  const bad = { name: 'core:test_bad', due: () => true, run: async () => { throw new Error('boom'); } };
  assert.deepEqual(await S.runJob(bad, '2026-10-05T10:15'), { error: 'boom' });
  const rows = await q(`select workflow, status, error from workflow_runs where workflow like 'core:test%' order by started_at`);
  assert.deepEqual(rows.map((r) => r.status), ['SUCCESS', 'SUCCESS', 'FAILED']); assert.equal(rows[2].error, 'boom');
});
test('schedule: sync every 15 minutes, metrics at 08:00 IST, analysis Monday 09:00 IST', async () => {
  const S = await import('../src/scheduler.ts');
  const due = (iso: string) => S.JOBS.filter((j) => j.due(S.ist(new Date(iso)))).map((j) => j.name);
  assert.deepEqual(due('2026-10-05T02:30:00Z'), ['core:sync_to_saleshandy', 'core:daily_metrics']); // 08:00 IST Monday is not 09:00
  assert.deepEqual(due('2026-10-05T03:30:00Z'), ['core:sync_to_saleshandy', 'core:weekly_analysis']); // Monday 09:00 IST
  assert.deepEqual(due('2026-10-05T03:37:00Z'), []);
  assert.equal(S.ist(new Date('2026-10-05T18:29:00Z')).slot, '2026-10-05T23:59');
});
test('prune trims old model text and replay keys, never prospects, drafts or replies', async () => {
  const S = await import('../src/scheduler.ts'); const { q, one } = await import('../src/lib/db.ts');
  await q(`insert into ai_runs(agent,prompt_version,provider,model,input,input_hash,raw_output,valid,created_at) values('x','1','mock','mock','{"a":1}','h','long text',true, now() - interval '40 days'), ('y','1','mock','mock','{"a":2}','h2','keep me',true, now())`);
  await q(`insert into idempotency_keys(key,method,path,status,response,created_at) values('old','POST','/x',200,'{}', now() - interval '8 days'), ('new','POST','/x',200,'{}', now())`);
  const r = await S.prune(); assert.equal(r.ai_runs_trimmed, 1); assert.equal(r.idempotency_keys_deleted, 1);
  assert.equal((await one(`select raw_output from ai_runs where agent='x'`))!.raw_output, null); assert.equal((await one(`select raw_output from ai_runs where agent='y'`))!.raw_output, 'keep me');
  assert.ok(await one(`select 1 from idempotency_keys where key='new'`));
});
