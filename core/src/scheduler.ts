// The timed jobs, inside the core, for hosts where n8n cannot run (Hostinger Cloud). Same work as n8n 08, 15 and 16.
// Each run takes a Postgres advisory lock for its job, so n8n, a second app process and this can overlap safely.
import { tx, q } from './lib/db.ts';
import { log } from './lib/log.ts';
import * as P from './pipeline.ts';
import { requeueStale } from './jobs.ts';
import { lastActivity } from './lib/activity.ts';
import { shConfig } from './saleshandy/config.ts';

// whenUsed: run only if someone used the app in the last quarter hour. Nothing new can be waiting otherwise, and
// skipping lets the database sleep through nights and weekends instead of waking every 15 minutes.
type Job = { name: string; due: (t: Ist) => boolean; run: () => Promise<unknown>; whenUsed?: boolean };
type Ist = { minute: number; hour: number; weekday: number; slot: string };
export function ist(d = new Date()): Ist {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { minute: Number(p.minute), hour: Number(p.hour) % 24, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), slot: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` };
}

// Keeps the free database under its 1 GB: raw model text and replay records age out; prospects, emails and replies never do.
export async function prune() {
  const a = await q(`update ai_runs set raw_output = null, input = '{}'::jsonb where created_at < now() - interval '30 days' and (raw_output is not null or input <> '{}'::jsonb) returning id`);
  const b = await q(`delete from idempotency_keys where created_at < now() - interval '7 days' returning key`);
  const c = await q(`delete from activities where action='daily_snapshot' and created_at < now() - interval '180 days' returning id`);
  return { ai_runs_trimmed: a.length, idempotency_keys_deleted: b.length, old_snapshots_deleted: c.length };
}

export const JOBS: Job[] = [
  // approvals and stalled research only come from someone using the app, so this waits for that
  { name: 'core:sync_to_saleshandy', due: (t) => t.minute % 15 === 0, whenUsed: true, run: async () => {
    const rows = await q(`select id from email_drafts where status='APPROVED' order by approved_at limit 50`);
    const out = []; for (const r of rows) { try { out.push(await P.syncToSaleshandy(r.id)); } catch (e: any) { out.push({ draft_id: r.id, error: e.message }); } }
    // research a provider outage interrupted goes back on the queue; it runs after this, in the background
    const requeued = await requeueStale((id) => P.runChain(id));
    return { synced: out.filter((x: any) => !x.error).length, failed: out.filter((x: any) => x.error).length, requeued };
  } },
  { name: 'core:daily_metrics', due: (t) => t.hour === 8 && t.minute === 0, run: async () => {
    const m = await P.campaignMetrics();
    await q(`insert into activities(entity_type,entity_id,action,actor,detail) values('metrics','00000000-0000-0000-0000-000000000000','daily_snapshot','system',$1)`, [{ campaigns: m }]);
    return { campaigns: m.length, pruned: await prune() };
  } },
  // Saleshandy: the 30 minute sync while someone uses the app, the full run every night, and high risk writes whose
  // 10 second undo window ended while the process was restarting (writes are only ever queued by someone using the app)
  { name: 'core:sh_sync_incremental', due: (t) => t.minute % 30 === 7 && shConfig().integration, whenUsed: true, run: async () => (await import('./saleshandy/sync.ts')).runSync('incremental') },
  { name: 'core:sh_sync_full', due: (t) => t.hour === 2 && t.minute === 30 && shConfig().integration, run: async () => (await import('./saleshandy/sync.ts')).runSync('full') },
  { name: 'core:sh_send_due', due: (t) => t.minute % 5 === 0 && shConfig().integration, whenUsed: true, run: async () => ({ sent: await (await import('./saleshandy/gateway.ts')).sendDue() }) },
  { name: 'core:weekly_analysis', due: (t) => t.weekday === 1 && t.hour === 9 && t.minute === 0, run: async () => (await P.weeklyAnalysis()).recommendations?.length ?? 0 },
];

export const USED_WITHIN_MS = 16 * 60_000;
export const wanted = (job: Job, t: Ist, now = Date.now(), last = lastActivity()) => job.due(t) && (!job.whenUsed || now - last < USED_WITHIN_MS);
const lockKey = (name: string) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0; return h; };
export async function runJob(job: Job, slot: string) {
  return tx(async (c) => {
    const got = (await c.query('select pg_try_advisory_xact_lock($1) ok', [lockKey(job.name)])).rows[0].ok;
    if (!got) return { skipped: 'another process is running it' };
    // one run per slot, even if two processes tick in the same minute one after the other
    const done = (await c.query(`select 1 from workflow_runs where workflow=$1 and external_execution_id=$2 limit 1`, [job.name, slot])).rowCount;
    if (done) return { skipped: 'already ran this slot' };
    const run = (await c.query(`insert into workflow_runs(workflow, external_execution_id) values($1,$2) returning id`, [job.name, slot])).rows[0];
    try {
      const detail = await job.run();
      await c.query(`update workflow_runs set status='SUCCESS', finished_at=now(), detail=$2 where id=$1`, [run.id, JSON.stringify({ result: detail })]);
      return detail;
    } catch (e: any) {
      await c.query(`update workflow_runs set status='FAILED', finished_at=now(), error=$2 where id=$1`, [run.id, String(e.message).slice(0, 2000)]);
      log.error('scheduled job failed', { job: job.name, err: e.message });
      return { error: e.message };
    }
  });
}

// ponytail: minute ticks with exact-minute matches; a minute when the process is down is skipped, not caught up.
// Fine for these jobs (the next sync picks up everything waiting). Add catch-up if a missed daily run ever matters.
export function startScheduler() {
  let last = '';
  const tick = async () => {
    const t = ist(); if (t.slot === last) return; last = t.slot;
    for (const job of JOBS) if (wanted(job, t)) {
      try { const r = await runJob(job, t.slot); log.info('scheduled job', { job: job.name, slot: t.slot, result: r }); }
      catch (e: any) { log.error('scheduled job could not start', { job: job.name, err: e.message }); }
    }
  };
  const timer = setInterval(() => { tick(); }, 20_000); timer.unref();
  log.info('scheduler on', { jobs: JOBS.map((j) => j.name) });
  return () => clearInterval(timer);
}
export const lastRuns = () => q(`select distinct on (workflow) workflow, status, started_at, error from workflow_runs where workflow like 'core:%' order by workflow, started_at desc`);

