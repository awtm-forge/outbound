// Live checks, run from the app by an admin, on the server that can reach Saleshandy. Each returns a report of steps.
//   readChecks: one read of every resource the sync uses (reads only), the rate limit headers Saleshandy sends, and the
//     credit balance. Nothing is written anywhere.
//   testSequenceCheck: the write flows against SALESHANDY_TEST_SEQUENCE_ID only, through the write gateway, on one
//     prospect of that sequence whose email is at a SALESHANDY_TEST_ALLOWLIST domain. It is built only from those two
//     settings, so even in production it touches nothing else. Every write is in the audit log like any other.
import { randomUUID } from 'node:crypto';
import { q, one } from '../lib/db.ts';
import { shConfig } from './config.ts';
import { probe } from './client.ts';
import { itemsOf } from './pagination.ts';
import { execute, creditBalance, UNDO_MS, type Actor } from './gateway.ts';
import { refreshSequenceList, runSync } from './sync.ts';

type Step = { name: string; ok: boolean | null; detail: string };
export type Report = { mode: 'live' | 'fake'; started_at: string; steps: Step[]; summary: string };
const P = '/api/open-api/v1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const modeOf = (): Report['mode'] => (shConfig().live ? 'live' : 'fake');

const READS: [string, 'GET' | 'POST', string, Record<string, unknown> | undefined, unknown][] = [
  ['Sequences', 'GET', `${P}/sequences`, { page: 1, pageSize: 1 }, undefined],
  ['Prospects', 'GET', `${P}/contacts`, { page: 1, pageSize: 1 }, undefined],
  ['Inbox', 'POST', `${P}/unified-inbox/emails`, undefined, { page: 1, limit: 1 }],
  ['Tasks', 'GET', `${P}/tasks`, { page: 1, pageSize: 1 }, undefined],
  ['Do not contact lists', 'GET', '/v1/dnc', { page: 1, pageSize: 1 }, undefined],
  ['Mailboxes', 'POST', `${P}/email-accounts`, undefined, { page: 1, pageSize: 1 }],
  ['Schedules', 'GET', `${P}/schedules`, undefined, undefined],
  ['Tags', 'GET', `${P}/contacts/tags`, undefined, undefined],
  ['Fields', 'GET', `${P}/fields`, { systemFields: true }, undefined],
  ['Inbox outcomes', 'GET', `${P}/unified-inbox/outcome`, { page: 1, pageSize: 1 }, undefined],
  ['Team', 'GET', `${P}/user/team-member-list`, undefined, undefined],
];

export async function readChecks(): Promise<Report> {
  const started_at = new Date().toISOString(); const steps: Step[] = []; let limits: Record<string, string> = {};
  for (const [name, method, path, query, body] of READS) {
    const r = await probe(method, path, { query, body });
    if (Object.keys(r.limits).length) limits = { ...limits, ...r.limits };
    const n = itemsOf(r.data).length;
    steps.push({ name, ok: r.ok, detail: r.ok ? `Answered ${r.status} in ${r.ms} ms${Array.isArray(r.data) || n ? `, ${n} ${n === 1 ? 'item' : 'items'} on the first page` : ''}.` : `${r.error} (status ${r.status || 'none'}).` });
  }
  steps.push({ name: 'Rate limit headers', ok: Object.keys(limits).length ? true : null, detail: Object.keys(limits).length ? Object.entries(limits).map(([k, v]) => `${k}: ${v}`).join(', ') : 'Saleshandy sent no rate limit headers. The client keeps its own 1 second gap between calls.' });
  try { const b = await creditBalance(); steps.push({ name: 'Credit balance', ok: b != null, detail: b != null ? `${b} credits reported.` : 'The credits endpoint answered, but no balance could be read from it.' }); }
  catch (e: any) { steps.push({ name: 'Credit balance', ok: false, detail: e.message }); }
  const failed = steps.filter((s) => s.ok === false).length;
  return { mode: modeOf(), started_at, steps, summary: failed ? `${failed} of ${steps.length} checks failed.` : `All ${steps.length} checks passed.` };
}

// a write through the gateway; high risk ones are held 10 seconds, so this waits for the hold and reads the result
async function write(actor: Actor, name: string, action: string, input: unknown, steps: Step[]) {
  const o = await execute(actor, action, input, `livecheck:${randomUUID()}`);
  let outcome = o.outcome; let reason = o.reason ?? null;
  if (outcome === 'pending') {
    await sleep(UNDO_MS + 2500);
    const r = await one(`select outcome, reason from sh_write_audit where id=$1`, [o.audit_id]); outcome = r?.outcome ?? outcome; reason = r?.reason ?? reason;
  }
  steps.push({ name, ok: outcome === 'sent', detail: outcome === 'sent' ? 'Sent and accepted by Saleshandy.' : `${outcome[0]!.toUpperCase()}${outcome.slice(1)}${reason ? `: ${reason}` : '.'}` });
  return { ok: outcome === 'sent', response: o.response };
}

export async function testSequenceCheck(actor: Actor): Promise<Report> {
  const started_at = new Date().toISOString(); const steps: Step[] = []; const c = shConfig();
  const done = (summary: string): Report => ({ mode: modeOf(), started_at, steps, summary });
  if (!c.testSequenceId) { steps.push({ name: 'Test sequence', ok: false, detail: 'SALESHANDY_TEST_SEQUENCE_ID is not set, so there is nothing safe to test against.' }); return done('Not run.'); }
  if (!c.allowlist.length) { steps.push({ name: 'Test allowlist', ok: false, detail: 'SALESHANDY_TEST_ALLOWLIST is not set, so no prospect is safe to write to.' }); return done('Not run.'); }
  // the copy of the test sequence and its people, fresh
  try { await runSync('incremental'); } catch { /* the steps below say what is missing */ }
  const seq = await one(`select id, title, active, status from sh_sequences where id=$1`, [c.testSequenceId]);
  if (!seq) { steps.push({ name: 'Test sequence', ok: false, detail: `Sequence ${c.testSequenceId} was not found in Saleshandy. Check the id.` }); return done('Not run.'); }
  steps.push({ name: 'Test sequence', ok: true, detail: `"${seq.title}", ${seq.active ? 'active' : 'paused'}.` });
  const people = await q(`select p.id, p.email::text email from sh_prospects p join sh_prospect_sequences m on m.prospect_id=p.id where m.sequence_id=$1 order by p.email`, [seq.id]);
  const pr = people.find((x) => c.allowlist.includes(String(x.email).split('@')[1]!.toLowerCase()));
  // 1. the sequence: pause and resume only when it was running, so a paused sequence never starts sending
  if (seq.active) {
    const paused = await write(actor, 'Pause the test sequence (medium risk)', 'sequence.set_status', { sequenceIds: [seq.id], status: 'paused' }, steps);
    if (paused.ok) {
      await write(actor, 'Resume it (high risk, after the 10 second hold)', 'sequence.set_status', { sequenceIds: [seq.id], status: 'active' }, steps);
      await refreshSequenceList();
      const now = await one(`select active from sh_sequences where id=$1`, [seq.id]);
      steps.push({ name: 'Sequence back as it was', ok: !!now?.active, detail: now?.active ? 'Active again, as before the check.' : 'Not active. Resume it in Saleshandy.' });
    }
  } else steps.push({ name: 'Pause and resume', ok: null, detail: 'Skipped: the test sequence is paused, and resuming it would start sending.' });
  // 2. a prospect at an allowlisted domain: note, tag on and off, a task
  if (!pr) {
    steps.push({ name: 'Test prospect', ok: false, detail: `No one in "${seq.title}" has an email at ${c.allowlist.join(', ')}. Add one such prospect to the test sequence in Saleshandy and run this again.` });
    return done(summarise(steps));
  }
  steps.push({ name: 'Test prospect', ok: true, detail: `${pr.email}.` });
  await write(actor, 'Add a note (low risk)', 'note.create', { prospectIds: [pr.id], content: 'Live check from the ops portal. Safe to delete.' }, steps);
  const tag = await one(`select id, data->>'name' name from sh_lookups where kind='tag' order by id limit 1`);
  if (tag) {
    const on = await write(actor, `Tag "${tag.name}" (low risk)`, 'prospect.tags', { prospectIds: [pr.id], tagId: tag.id, op: 'assign' }, steps);
    if (on.ok) await write(actor, 'Remove the tag again (low risk)', 'prospect.tags', { prospectIds: [pr.id], tagId: tag.id, op: 'unassign' }, steps);
  } else steps.push({ name: 'Tags', ok: null, detail: 'Skipped: the account has no tags.' });
  const task = await write(actor, 'Create a task (medium risk)', 'task.create', { prospectIds: [pr.id], taskType: '9', priority: '4', note: 'Live check from the ops portal. Safe to delete.' }, steps);
  const taskId = (task.response as any)?.results?.[0]?.taskId ?? (task.response as any)?.taskId;
  if (task.ok && taskId) await write(actor, 'Skip that task (low risk)', 'task.skip', { taskId: String(taskId) }, steps);
  else if (task.ok) steps.push({ name: 'Skip that task', ok: null, detail: 'Saleshandy did not return the new task id, so the task is left; it says it is safe to delete.' });
  return done(summarise(steps));
}
const summarise = (steps: Step[]) => { const failed = steps.filter((s) => s.ok === false).length; const passed = steps.filter((s) => s.ok).length; return failed ? `${failed} failed, ${passed} passed.` : `All ${passed} passed.`; };
