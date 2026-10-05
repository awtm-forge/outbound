// One worker for everything that calls the AI. Hostinger's proxy drops any request longer than 60 s and a single
// Gemini call can take that long, so AI work runs here and the browser polls GET /api/jobs/:id. One at a time also
// keeps us inside the provider's per-minute limits. Something a person clicked goes ahead of a batch.
import { randomUUID } from 'node:crypto';
import { q } from './lib/db.ts';
import { log } from './lib/log.ts';

export type Job = { id: string; label: string; status: 'queued' | 'running' | 'done' | 'failed'; result?: unknown; error?: string; run_id?: string; created: number; started?: number; finished?: number };
const jobs = new Map<string, Job>();
const work = new Map<string, () => Promise<unknown>>();
const queue: string[] = [];
let busy = false;

// ponytail: in memory. A restart loses queued jobs; chains are re-queued at boot from prospects left mid-research (requeueStale).
// Move to a table if anything else ever needs to survive a restart.
export function enqueue(label: string, fn: () => Promise<unknown>, priority: 'now' | 'batch' = 'now'): Job {
  const job: Job = { id: randomUUID(), label, status: 'queued', created: Date.now() };
  jobs.set(job.id, job); work.set(job.id, fn);
  if (priority === 'now') { const firstBatch = queue.findIndex((id) => jobs.get(id)?.label.startsWith('batch:')); queue.splice(firstBatch < 0 ? queue.length : firstBatch, 0, job.id); }
  else queue.push(job.id);
  setImmediate(drain);
  return job;
}
async function drain() {
  if (busy) return; busy = true;
  try {
    while (queue.length) {
      const id = queue.shift()!; const job = jobs.get(id)!; const fn = work.get(id)!;
      job.status = 'running'; job.started = Date.now();
      try { job.result = await fn(); job.status = 'done'; }
      catch (e: any) { job.status = 'failed'; job.error = e?.message ?? String(e); job.run_id = e?.runId; log.warn('job failed', { label: job.label, err: job.error }); }
      job.finished = Date.now(); work.delete(id);
    }
  } finally { busy = false; }
  // forget finished jobs after an hour
  const cutoff = Date.now() - 3600_000; for (const [id, j] of jobs) if (j.finished && j.finished < cutoff) jobs.delete(id);
}
export const getJob = (id: string) => jobs.get(id);
export const queueState = () => ({ waiting: queue.length, running: busy ? [...jobs.values()].find((j) => j.status === 'running')?.label ?? null : null });
export async function idle() { while (busy || queue.length) await new Promise((r) => setTimeout(r, 20)); }

// Prospects caught mid-research by a restart go back on the queue.
export async function requeueStale(runChain: (id: string) => Promise<unknown>) {
  const rows = await q(`select id from prospects where status in ('RESEARCHING','QUALIFYING') and updated_at < now() - interval '2 minutes' and not suppressed order by updated_at limit 200`);
  for (const r of rows) enqueue(`batch:chain:${r.id}`, () => runChain(r.id), 'batch');
  return rows.length;
}
