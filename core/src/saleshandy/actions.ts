// Every write the portal can make to Saleshandy, with its risk class, its request, the people and sequences it touches
// (resolved from our mirror, for the environment guard and the confirmation text), the state before it, and what to
// refresh afterwards. Only the write gateway runs these. Paths follow Saleshandy's official client; bodies marked
// "unverified" are the best reading of that client and are confirmed on the first live call.
import { z } from 'zod';
import { q, one } from '../lib/db.ts';
import type { Risk } from './config.ts';
import { refreshProspect, refreshNotes, refreshTask, refreshThread, refreshSequenceList, syncDnc } from './sync.ts';

const P = '/api/open-api/v1';
const ids = z.array(z.string().min(1).max(200)).min(1).max(1000);
const sid = z.string().min(1).max(200);
export type Targets = { emails: string[]; domains: string[]; sequenceIds: string[]; createsSequence?: boolean; unresolved?: boolean; prospectIds?: string[]; label: string };
export type ActionDef<I = any> = {
  input: z.ZodType<I>;
  risk: (i: I) => Risk;
  request: (i: I) => { method: 'POST' | 'PATCH'; path: string; body: unknown };
  targets: (i: I) => Promise<Targets>;
  before?: (i: I) => Promise<unknown>;
  refresh?: (i: I, response: any) => Promise<unknown>;
  credits?: (i: I) => Promise<number>;
  systemAllowed?: boolean; // the approved draft pipeline may run it with no person behind it
};

// ---------- resolving targets from the mirror ----------
const prospectsById = async (pids: string[]) => q(`select id, email::text email, first_name, last_name from sh_prospects where id = any($1)`, [pids]);
const nameOf = (p: any) => [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
async function forProspects(pids: string[], what: string, sequenceIds: string[] = []): Promise<Targets> {
  const rows = await prospectsById(pids);
  if (rows.length !== new Set(pids).size) throw new Error('One or more prospects are not in the synced data yet. Sync, then try again.');
  return { emails: rows.map((r) => r.email), domains: [], sequenceIds, prospectIds: pids, label: `${what} ${rows.length === 1 ? nameOf(rows[0]) : `${rows.length} prospects`}` };
}
async function forTasks(tids: string[], what: string): Promise<Targets> {
  const rows = await q(`select t.id, t.prospect_id, t.sequence_id, p.email::text email from sh_tasks t left join sh_prospects p on p.id=t.prospect_id where t.id = any($1)`, [tids]);
  if (rows.length !== new Set(tids).size) throw new Error('One or more tasks are not in the synced data yet. Sync, then try again.');
  return { emails: rows.map((r) => r.email).filter(Boolean), domains: [], sequenceIds: [], prospectIds: rows.map((r) => r.prospect_id).filter(Boolean), label: `${what} ${rows.length === 1 ? 'a task' : `${rows.length} tasks`}`,
    unresolved: rows.some((r) => !r.email) };
}
const seqTitle = async (id: string) => (await one(`select title from sh_sequences where id=$1`, [id]))?.title ?? id;

// typed per action from its input schema
const def = <S extends z.ZodTypeAny>(d: Omit<ActionDef<z.output<S>>, 'input'> & { input: S }) => d as unknown as ActionDef;
export const ACTIONS: Record<string, ActionDef> = {
  // ---------------- low ----------------
  'prospect.set_fields': def({
    input: z.object({ prospectId: sid, fields: z.array(z.object({ fieldId: sid, value: z.string().max(5000) })).min(1).max(50) }),
    risk: () => 'low',
    request: (i) => ({ method: 'POST', path: `${P}/prospects/${i.prospectId}/attribute`, body: { attributes: i.fields.map((f) => ({ fieldId: f.fieldId, attributeValue: f.value })) } }),
    targets: (i) => forProspects([i.prospectId], 'Change fields of'),
    refresh: async (i) => { const p = await one(`select email::text email from sh_prospects where id=$1`, [i.prospectId]); if (p) await refreshProspect(p.email); },
  }),
  'prospect.tags': def({
    // unverified: the un-assign body; the official client passes it through as given
    input: z.object({ prospectIds: ids, tagId: sid, op: z.enum(['assign', 'unassign']) }),
    risk: () => 'low',
    request: (i) => i.op === 'assign' ? { method: 'POST', path: `${P}/contacts/tags/assign`, body: { prospects: i.prospectIds.map((p) => ({ prospectId: p, tagId: i.tagId })) } }
      : { method: 'POST', path: `${P}/contacts/tags/un-assign`, body: [{ tagId: i.tagId, prospects: i.prospectIds }] },
    targets: (i) => forProspects(i.prospectIds, i.op === 'assign' ? 'Tag' : 'Remove a tag from'),
    before: async (i) => q(`select id, tags from sh_prospects where id = any($1)`, [i.prospectIds]),
    refresh: async (i) => { for (const p of await prospectsById(i.prospectIds.slice(0, 25))) await refreshProspect(p.email); },
  }),
  'task.complete': def({ input: z.object({ taskId: sid, callOutcome: z.string().max(100).optional() }), risk: () => 'low',
    request: (i) => ({ method: 'POST', path: `${P}/tasks/${i.taskId}/complete`, body: i.callOutcome ? { callOutcome: i.callOutcome } : {} }),
    targets: (i) => forTasks([i.taskId], 'Complete'), before: (i) => one(`select status from sh_tasks where id=$1`, [i.taskId]), refresh: (i) => refreshTask(i.taskId) }),
  'task.skip': def({ input: z.object({ taskId: sid }), risk: () => 'low',
    request: (i) => ({ method: 'POST', path: `${P}/tasks/${i.taskId}/skip`, body: {} }),
    targets: (i) => forTasks([i.taskId], 'Skip'), before: (i) => one(`select status from sh_tasks where id=$1`, [i.taskId]), refresh: (i) => refreshTask(i.taskId) }),
  'task.snooze': def({ input: z.object({ taskId: sid, until: z.string().datetime({ offset: true }) }), risk: () => 'low',
    request: (i) => ({ method: 'POST', path: `${P}/tasks/${i.taskId}/snooze`, body: { snoozeUntil: i.until } }),
    targets: (i) => forTasks([i.taskId], 'Snooze'), before: (i) => one(`select status, due_date from sh_tasks where id=$1`, [i.taskId]), refresh: (i) => refreshTask(i.taskId) }),
  'task.note': def({ input: z.object({ taskId: sid, note: z.string().max(3000) }), risk: () => 'low',
    request: (i) => ({ method: 'PATCH', path: `${P}/tasks/${i.taskId}/note`, body: { note: i.note } }),
    targets: (i) => forTasks([i.taskId], 'Change the note on'), before: (i) => one(`select note from sh_tasks where id=$1`, [i.taskId]), refresh: (i) => refreshTask(i.taskId) }),
  'task.bulk': def({ input: z.object({ taskIds: ids.max(100), op: z.enum(['skip', 'snooze']), until: z.string().datetime({ offset: true }).optional() }).refine((i) => i.op === 'skip' || !!i.until, 'Choose when to snooze until.'), risk: () => 'low',
    request: (i) => i.op === 'skip' ? { method: 'POST', path: `${P}/tasks/bulk-skip`, body: { taskIds: i.taskIds } } : { method: 'POST', path: `${P}/tasks/bulk-snooze`, body: { taskIds: i.taskIds, snoozeUntil: i.until } },
    targets: (i) => forTasks(i.taskIds, i.op === 'skip' ? 'Skip' : 'Snooze'), before: (i) => q(`select id, status, due_date from sh_tasks where id = any($1)`, [i.taskIds]),
    refresh: async (i) => { for (const t of i.taskIds.slice(0, 25)) await refreshTask(t); } }),
  'note.create': def({ input: z.object({ prospectIds: ids.max(100), content: z.string().trim().min(1).max(5000), visibility: z.enum(['1', '2']).default('1') }), risk: () => 'low',
    request: (i) => ({ method: 'POST', path: `${P}/notes`, body: { prospectIds: i.prospectIds, content: i.content, visibility: i.visibility, status: '1' } }),
    targets: (i) => forProspects(i.prospectIds, 'Add a note to'),
    refresh: async (i) => { for (const p of i.prospectIds.slice(0, 25)) await refreshNotes(p); } }),
  'note.update': def({ input: z.object({ noteId: sid, content: z.string().max(5000).optional(), visibility: z.enum(['1', '2']).optional(), status: z.enum(['0', '1']).optional() }), risk: () => 'low',
    request: (i) => ({ method: 'PATCH', path: `${P}/notes/${i.noteId}`, body: Object.fromEntries(Object.entries({ content: i.content, visibility: i.visibility, status: i.status }).filter(([, v]) => v !== undefined)) }),
    targets: async (i) => { const n = await one(`select prospect_id from sh_notes where id=$1`, [i.noteId]); if (!n) throw new Error('That note is not in the synced data yet.'); return forProspects([n.prospect_id], 'Change a note on'); },
    before: (i) => one(`select content, visibility, status from sh_notes where id=$1`, [i.noteId]),
    refresh: async (i) => { const n = await one(`select prospect_id from sh_notes where id=$1`, [i.noteId]); if (n) await refreshNotes(n.prospect_id); } }),
  // ---------------- medium ----------------
  'prospect.set_status': def({
    input: z.object({ prospectId: sid, sequenceId: sid, stepId: sid.optional(), status: z.enum(['paused', 'finished', 'replied', 'unsubscribed', 'active']) }),
    risk: (i) => (i.status === 'active' ? 'high' : 'medium'),
    request: (i) => ({ method: 'PATCH', path: `${P}/contacts/status`, body: { prospectId: i.prospectId, sequenceId: i.sequenceId, stepId: i.stepId, status: i.status } }),
    targets: async (i) => { const t = await forProspects([i.prospectId], `Set to ${i.status} in "${await seqTitle(i.sequenceId)}":`, [i.sequenceId]); return t; },
    before: (i) => one(`select status, step_id from sh_prospect_sequences where prospect_id=$1 and sequence_id=$2`, [i.prospectId, i.sequenceId]),
    refresh: async (i) => { const p = await one(`select email::text email from sh_prospects where id=$1`, [i.prospectId]); if (p) await refreshProspect(p.email); await q(`update sh_prospect_sequences set status=$3, updated_at=now() where prospect_id=$1 and sequence_id=$2`, [i.prospectId, i.sequenceId, i.status]); },
  }),
  'sequence.add_prospects': def({
    input: z.object({ sequenceId: sid, stepId: sid, prospectIds: ids }), risk: () => 'medium',
    request: (i) => ({ method: 'POST', path: `${P}/sequences/${i.sequenceId}/contacts`, body: { stepId: i.stepId, contactIds: i.prospectIds } }),
    targets: async (i) => forProspects(i.prospectIds, `Add to "${await seqTitle(i.sequenceId)}":`, [i.sequenceId]),
    refresh: async (i) => { for (const p of await prospectsById(i.prospectIds.slice(0, 25))) await refreshProspect(p.email); },
  }),
  'sequence.import_prospects': def({
    // unverified body: the official client sends a JSON file as given; this is the shape its field-name import implies
    input: z.object({ sequenceId: sid, stepId: sid.optional(), prospects: z.array(z.object({ email: z.string().email(), firstName: z.string().max(200).optional(), lastName: z.string().max(200).optional(), company: z.string().max(300).optional(), jobTitle: z.string().max(300).optional(), website: z.string().max(500).optional(), custom: z.record(z.string().max(10_000)).optional() })).min(1).max(1000) }),
    risk: () => 'medium', systemAllowed: true,
    request: (i) => ({ method: 'POST', path: `${P}/sequences/prospects/import-with-field-name`, body: { sequenceId: i.sequenceId, ...(i.stepId ? { stepId: i.stepId } : {}), prospects: i.prospects.map((p) => ({ email: p.email, firstName: p.firstName, lastName: p.lastName, company: p.company, jobTitle: p.jobTitle, website: p.website, ...(p.custom ?? {}) })) } }),
    targets: async (i) => ({ emails: i.prospects.map((p) => p.email.toLowerCase()), domains: [], sequenceIds: [i.sequenceId], label: `Add ${i.prospects.length === 1 ? i.prospects[0]!.email : `${i.prospects.length} people`} to "${await seqTitle(i.sequenceId)}"` }),
    refresh: async (i) => { for (const p of i.prospects.slice(0, 10)) await refreshProspect(p.email); },
  }),
  'sequence.set_status': def({
    input: z.object({ sequenceIds: ids.max(50), status: z.enum(['paused', 'active']) }),
    risk: (i) => (i.status === 'active' ? 'high' : 'medium'),
    request: (i) => ({ method: 'POST', path: `${P}/sequences/status`, body: { sequenceIds: i.sequenceIds, status: i.status } }),
    targets: async (i) => ({ emails: [], domains: [], sequenceIds: i.sequenceIds, label: `${i.status === 'active' ? 'Resume' : 'Pause'} ${i.sequenceIds.length === 1 ? `"${await seqTitle(i.sequenceIds[0]!)}"` : `${i.sequenceIds.length} sequences`}` }),
    before: (i) => q(`select id, status, active from sh_sequences where id = any($1)`, [i.sequenceIds]),
    refresh: () => refreshSequenceList(),
  }),
  'sequence.set_schedule': def({
    input: z.object({ sequenceId: sid, scheduleId: sid }), risk: () => 'medium',
    request: (i) => ({ method: 'PATCH', path: `${P}/sequences/${i.sequenceId}/schedule`, body: { scheduleId: i.scheduleId } }),
    targets: async (i) => ({ emails: [], domains: [], sequenceIds: [i.sequenceId], label: `Change the schedule of "${await seqTitle(i.sequenceId)}"` }),
    before: (i) => one(`select schedule_id from sh_sequences where id=$1`, [i.sequenceId]),
    refresh: async (i) => { await q(`update sh_sequences set schedule_id=$2, updated_at=now() where id=$1`, [i.sequenceId, i.scheduleId]); },
  }),
  'dnc.add': def({
    input: z.object({ listId: sid, items: z.array(z.string().trim().toLowerCase().min(3).max(320)).min(1).max(1000) }), risk: () => 'medium',
    request: (i) => ({ method: 'POST', path: '/v1/dnc', body: { dncListId: i.listId, items: i.items } }),
    targets: async (i) => ({ emails: i.items.filter((x) => x.includes('@')), domains: i.items.filter((x) => !x.includes('@')), sequenceIds: [], label: `Add ${i.items.length === 1 ? i.items[0] : `${i.items.length} entries`} to Do Not Contact` }),
    refresh: () => syncDnc(false, { errors: [] }),
  }),
  'task.create': def({
    input: z.object({ prospectIds: ids.max(100), taskType: z.enum(['2', '3', '4', '5', '6', '9', '11', '12', '13', '14', '15', '16', '17', '18']), priority: z.enum(['1', '2', '3', '4']).default('3'), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), note: z.string().max(3000).optional() }),
    risk: () => 'medium',
    request: (i) => ({ method: 'POST', path: `${P}/tasks/create`, body: { prospectIds: i.prospectIds, taskType: i.taskType, priority: i.priority, ...(i.dueDate ? { dueDate: i.dueDate } : {}), ...(i.note ? { taskNote: i.note } : {}) } }),
    targets: (i) => forProspects(i.prospectIds, 'Create a task for'),
    refresh: async (_i, res) => { for (const r of (res?.results ?? []).slice(0, 25)) if (r?.taskId) await refreshTask(String(r.taskId)); },
  }),
  // ---------------- high ----------------
  'sequence.create': def({
    input: z.object({ title: z.string().trim().min(1).max(200), emailAccountIds: z.array(sid).max(50).optional(), scheduleId: sid.optional() }), risk: () => 'high',
    request: (i) => ({ method: 'POST', path: `${P}/sequences`, body: { title: i.title, ...(i.emailAccountIds?.length ? { emailAccountIds: i.emailAccountIds } : {}), ...(i.scheduleId ? { scheduleId: i.scheduleId } : {}) } }),
    targets: async (i) => ({ emails: [], domains: [], sequenceIds: [], createsSequence: true, label: `Create the sequence "${i.title}" (steps are written in Saleshandy)` }),
    refresh: () => refreshSequenceList(),
  }),
  'inbox.reply': def({
    input: z.object({ threadId: sid, emailId: sid, content: z.string().trim().min(1).max(20_000), to: z.array(z.string().email()).min(1).max(20), cc: z.array(z.string().email()).max(20).optional(), bcc: z.array(z.string().email()).max(20).optional() }),
    risk: () => 'high',
    request: (i) => ({ method: 'POST', path: `${P}/unified-inbox/emails/reply`, body: { emailThreadId: i.threadId, emailId: i.emailId, content: i.content, to: i.to, ...(i.cc?.length ? { cc: i.cc } : {}), ...(i.bcc?.length ? { bcc: i.bcc } : {}) } }),
    targets: async (i) => { const all = [...i.to, ...(i.cc ?? []), ...(i.bcc ?? [])].map((e) => e.toLowerCase()); return { emails: all, domains: [], sequenceIds: [], label: `Send a reply to ${all.join(', ')}` }; },
    refresh: (i) => refreshThread(i.threadId),
  }),
  // ---------------- spend ----------------
  'enrich.contact': def({
    input: z.object({ linkedinUrls: z.array(z.string().url().max(500)).min(1).max(100), revealPhone: z.boolean().default(false) }), risk: () => 'spend',
    request: (i) => ({ method: 'POST', path: `${P}/enrich/contact`, body: { linkedin_url: i.linkedinUrls, reveal_phone: i.revealPhone } }),
    targets: async (i) => ({ emails: [], domains: [], sequenceIds: [], label: `Enrich ${i.linkedinUrls.length} ${i.linkedinUrls.length === 1 ? 'contact' : 'contacts'}` }),
    credits: async (i) => i.linkedinUrls.length * (i.revealPhone ? 2 : 1),
  }),
  'enrich.company': def({
    input: z.object({ domains: z.array(z.string().trim().toLowerCase().min(3).max(253)).min(1).max(100) }), risk: () => 'spend',
    request: (i) => ({ method: 'POST', path: `${P}/enrich/company`, body: { company_domain: i.domains } }),
    targets: async (i) => ({ emails: [], domains: i.domains, sequenceIds: [], label: `Enrich ${i.domains.length} ${i.domains.length === 1 ? 'company' : 'companies'}` }),
    credits: async (i) => i.domains.length,
  }),
  'sequence.verify_prospects': def({
    input: z.object({ sequenceId: sid }), risk: () => 'spend',
    request: (i) => ({ method: 'POST', path: `${P}/sequences/${i.sequenceId}/verify-prospects`, body: {} }),
    targets: async (i) => ({ emails: [], domains: [], sequenceIds: [i.sequenceId], label: `Verify the email addresses in "${await seqTitle(i.sequenceId)}"` }),
    credits: async (i) => Number((await one(`select count(*)::int n from sh_prospect_sequences where sequence_id=$1`, [i.sequenceId]))!.n) || 1,
  }),
};
export const actionNames = Object.keys(ACTIONS);
