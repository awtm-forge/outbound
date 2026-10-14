// Mirrors Saleshandy into the sh_ tables. Every write is an upsert keyed by the Saleshandy id that only touches a row
// when something changed, so a repeated run changes nothing. A record that does not parse is logged in the run and
// skipped; it never fails the run. A full run removes rows Saleshandy no longer returns, but only for a resource whose
// scan finished without an error, so a failed page never deletes anything.
import { z } from 'zod';
import { q, one, pool } from '../lib/db.ts';
import { log } from '../lib/log.ts';
import { suppress } from '../lib/suppression.ts';
import { read } from './client.ts';
import { pageQuery, pageBodyLimit, pageBodySize, pageBodyNum, skipTake, collect, itemsOf } from './pagination.ts';

const P = '/api/open-api/v1';
// ---------- loose parsing: ids become strings, unknown fields are ignored ----------
const id = z.union([z.string().min(1), z.number()]).transform(String);
const str = z.union([z.string(), z.number()]).transform(String).nullish().transform((v) => (v === undefined || v === null || v === '' ? null : v));
const num = z.union([z.number(), z.string()]).nullish().transform((v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)));
const bool = z.union([z.boolean(), z.number(), z.string()]).nullish().transform((v) => (v === null || v === undefined ? null : v === true || v === 1 || v === '1' || v === 'true' || v === 'active'));
const date = z.union([z.string(), z.number()]).nullish().transform((v) => { if (v === null || v === undefined || v === '') return null; const d = new Date(v as any); return Number.isNaN(d.getTime()) ? null : d.toISOString(); });
const SeqIn = z.object({ id, title: str, name: str, active: bool, progress: str, status: str, clientId: str, scheduleId: str });
const StepIn = z.object({ id, number: num, type: str, executionType: str, relativeDays: num, status: str, variantCount: num, subject: str });
const MemberIn = z.object({ sequenceId: id.optional(), id: id.optional(), status: str, progress: str, stepId: str, outcome: str });
const ProspectIn = z.object({ id, email: z.string().email().transform((e) => e.toLowerCase()), firstName: str, lastName: str, company: str, companyName: str, verificationStatus: str, createdAt: date,
  tags: z.array(z.union([z.string(), z.object({ name: z.string() }).passthrough()])).nullish(), sequences: z.array(z.any()).nullish() });
const ThreadIn = z.object({ emailThreadId: id, emailId: str, subject: str, from: str, sequenceId: str, emailAccountId: str, isRead: bool, sentiment: str, category: str, outcome: str,
  receivedAt: date, lastEmailAt: date, updatedAt: date, createdAt: date });
const MessageIn = z.object({ emailId: id, from: str, to: z.union([z.array(z.string()), z.string()]).nullish(), sentAt: date, date: date, subject: str, content: str, body: str, direction: str });
const TaskIn = z.object({ id, type: str, status: str, priority: str, prospectId: str, prospectName: str, sequenceId: str, sequenceName: str, dueDate: date, note: str, taskNote: str, assignee: str });
const NoteIn = z.object({ id, content: str, visibility: str, status: str, createdAt: date });
const DncListIn = z.object({ id, name: str, itemCount: num, total: num, updatedAt: date });
const DncItemIn = z.object({ id, value: z.string().min(1).transform((v) => v.toLowerCase()), type: str });
const AccountIn = z.object({ id, fromEmail: str, email: str, fromName: str, status: str, emailServiceProvider: str, healthScore: num, remainingQuota: num, dailySendingLimit: num });

export type Counts = { seen: number; upserted: number; removed: number; skipped: number };
type RunCtx = { errors: { resource: string; id?: string; error: string }[] };
function parseAll<S extends z.ZodTypeAny>(schema: S, raw: any[], resource: string, ctx: RunCtx, c: Counts): z.output<S>[] {
  const out: z.output<S>[] = [];
  for (const r of raw) {
    c.seen++;
    const p = schema.safeParse(r);
    if (p.success) out.push(p.data);
    else { c.skipped++; ctx.errors.push({ resource, id: r && typeof r === 'object' ? String(r.id ?? r.emailThreadId ?? '') || undefined : undefined, error: p.error.issues.slice(0, 2).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }); }
  }
  return out;
}
const blank = (): Counts => ({ seen: 0, upserted: 0, removed: 0, skipped: 0 });

// ---------- one batched upsert that only changes rows whose data changed ----------
type Col = [name: string, type: string];
async function upsert(table: string, key: string[], cols: Col[], rows: Record<string, unknown>[]): Promise<number> {
  let changed = 0;
  const data = cols.filter(([n]) => !key.includes(n)).map(([n]) => n);
  for (let i = 0; i < rows.length; i += 500) {
    const part = rows.slice(i, i + 500);
    const r = await q(`insert into ${table} (${cols.map(([n]) => n).join(',')}, synced_at)
      select ${cols.map(([n]) => `r.${n}`).join(',')}, now() from jsonb_to_recordset($1::jsonb) as r(${cols.map(([n, t]) => `${n} ${t}`).join(',')})
      on conflict (${key.join(',')}) do update set ${data.map((n) => `${n}=excluded.${n}`).join(',')}, updated_at=now(), synced_at=now()
      where (${data.map((n) => `${table}.${n}`).join(',')}) is distinct from (${data.map((n) => `excluded.${n}`).join(',')})
      returning 1`, [JSON.stringify(part)]);
    changed += r.length;
    // rows that did not change were still seen: mark them, so a full run does not remove them
    if (key.length === 1) await q(`update ${table} set synced_at=now() where ${key[0]} = any($1::text[])`, [part.map((x) => String(x[key[0]!]))]);
  }
  return changed;
}

// ---------- resources ----------
export async function syncSequences(full: boolean, ctx: RunCtx) {
  const c = blank(); const runStart = new Date();
  const seqs = parseAll(SeqIn, await collect(pageQuery(`${P}/sequences`, { sort: 'DESC', sortBy: 'sequence.createdAt' }, 1000)), 'sequences', ctx, c);
  c.upserted += await upsert('sh_sequences', ['id'], [['id', 'text'], ['title', 'text'], ['active', 'boolean'], ['status', 'text'], ['progress', 'text'], ['client_id', 'text']],
    seqs.map((s) => ({ id: s.id, title: s.title ?? s.name ?? '', active: s.active, status: s.status ?? s.progress, progress: s.progress, client_id: s.clientId })));
  // totals for every sequence in one paged call
  if (seqs.length) {
    try {
      const stats = await collect(pageBodyNum(`${P}/analytics/consolidated-stats`, { sequenceIds: seqs.map((s) => s.id), startDate: '2020-01-01', endDate: new Date().toISOString().slice(0, 10) }, 500));
      for (const st of stats) {
        const sid = String(st.sequenceId ?? st.id ?? ''); if (!sid) continue;
        const totals = { sent: Number(st.sent ?? st.total ?? 0), opened: Number(st.open ?? st.opened ?? 0), replied: Number(st.replied ?? 0), clicked: Number(st.clicked ?? 0), bounced: Number(st.bounced ?? 0), unsubscribed: Number(st.unsubscribed ?? 0) };
        await q(`update sh_sequences set totals=$2, totals_at=now() where id=$1 and totals is distinct from $2::jsonb`, [sid, JSON.stringify(totals)]);
        await q(`insert into sh_analytics_snapshots(day,scope,scope_id,numbers) values((now() at time zone 'Asia/Kolkata')::date,'sequence',$1,$2) on conflict (day,scope,scope_id) do update set numbers=excluded.numbers, updated_at=now() where sh_analytics_snapshots.numbers is distinct from excluded.numbers`, [sid, totals]);
      }
    } catch (e: any) { ctx.errors.push({ resource: 'sequence totals', error: e.message }); }
  }
  // steps, read only
  const stepCounts = blank(); let stepsComplete = true;
  for (const s of seqs) {
    try {
      const steps = parseAll(StepIn, itemsOf(await read.get(`${P}/sequences/${s.id}/steps`)), 'sequence steps', ctx, stepCounts);
      stepCounts.upserted += await upsert('sh_sequence_steps', ['id'], [['id', 'text'], ['sequence_id', 'text'], ['number', 'int'], ['type', 'text'], ['execution_type', 'text'], ['relative_days', 'int'], ['status', 'text'], ['variant_count', 'int'], ['subject', 'text']],
        steps.map((x) => ({ id: x.id, sequence_id: s.id, number: x.number, type: x.type, execution_type: x.executionType, relative_days: x.relativeDays, status: x.status, variant_count: x.variantCount, subject: x.subject })));
    } catch (e: any) { stepsComplete = false; ctx.errors.push({ resource: 'sequence steps', id: s.id, error: e.message }); }
  }
  if (full) {
    c.removed += (await q(`delete from sh_sequences where synced_at < $1 returning id`, [runStart])).length;
    if (stepsComplete) stepCounts.removed += (await q(`delete from sh_sequence_steps where synced_at < $1 returning id`, [runStart])).length;
  }
  return { sequences: c, steps: stepCounts };
}

// after a write: the sequence list and totals only, without walking every sequence's steps
export async function refreshSequenceList(ctx: RunCtx = { errors: [] }) {
  const c = blank();
  const seqs = parseAll(SeqIn, await collect(pageQuery(`${P}/sequences`, { sort: 'DESC', sortBy: 'sequence.createdAt' }, 1000)), 'sequences', ctx, c);
  return upsert('sh_sequences', ['id'], [['id', 'text'], ['title', 'text'], ['active', 'boolean'], ['status', 'text'], ['progress', 'text'], ['client_id', 'text']],
    seqs.map((s) => ({ id: s.id, title: s.title ?? s.name ?? '', active: s.active, status: s.status ?? s.progress, progress: s.progress, client_id: s.clientId })));
}
const membershipsOf = (p: z.output<typeof ProspectIn>) => (p.sequences ?? []).map((m) => MemberIn.safeParse(m)).filter((m) => m.success).map((m) => m.data!)
  .map((m) => ({ sequence_id: m.sequenceId ?? m.id, status: (m.status ?? m.progress ?? '').toLowerCase() || null, step_id: m.stepId, outcome: m.outcome })).filter((m) => m.sequence_id);
async function storeProspects(list: z.output<typeof ProspectIn>[]) {
  const n = await upsert('sh_prospects', ['id'], [['id', 'text'], ['email', 'citext'], ['first_name', 'text'], ['last_name', 'text'], ['company_name', 'text'], ['verification_status', 'text'], ['tags', 'text[]'], ['sh_created_at', 'timestamptz']],
    list.map((p) => ({ id: p.id, email: p.email, first_name: p.firstName, last_name: p.lastName, company_name: p.company ?? p.companyName, verification_status: p.verificationStatus,
      tags: (p.tags ?? []).map((t) => (typeof t === 'string' ? t : t.name)), sh_created_at: p.createdAt })));
  const members = list.flatMap((p) => membershipsOf(p).map((m) => ({ prospect_id: p.id, ...m })));
  if (members.length) await upsert('sh_prospect_sequences', ['prospect_id', 'sequence_id'], [['prospect_id', 'text'], ['sequence_id', 'text'], ['step_id', 'text'], ['status', 'text'], ['outcome', 'text']], members);
  // unsubscribes and bounces in Saleshandy reach our own suppression list
  for (const m of members) if (m.status === 'unsubscribed' || m.status === 'bounced') {
    const p = list.find((x) => x.id === m.prospect_id)!;
    const has = await one(`select 1 from suppression_list where email=$1`, [p.email]);
    if (!has) await suppress({ email: p.email, reason: m.status === 'bounced' ? 'bounced in Saleshandy' : 'unsubscribed in Saleshandy', source: 'saleshandy_sync' });
  }
  return n;
}
export async function syncProspects(full: boolean, ctx: RunCtx) {
  const c = blank(); const runStart = new Date();
  if (full) {
    for await (const pageItems of pageQuery(`${P}/contacts`, { sort: 'asc', sortBy: 'createdAt' }, 100)) c.upserted += await storeProspects(parseAll(ProspectIn, pageItems, 'prospects', ctx, c));
    // gone from Saleshandy: remove from the mirror, with what hangs off it (our own records are never touched)
    const gone = await q(`delete from sh_prospects where synced_at < $1 returning id, email`, [runStart]);
    if (gone.length) {
      const ids = gone.map((g) => g.id); const emails = gone.map((g) => g.email);
      await q(`delete from sh_notes where prospect_id = any($1)`, [ids]); await q(`delete from sh_tasks where prospect_id = any($1)`, [ids]);
      await q(`delete from sh_events where prospect_id = any($1) or email = any($2::citext[])`, [ids, emails]);
      await q(`delete from sh_threads where prospect_email = any($1::citext[]) and not exists (select 1 from sh_prospects p where p.email = sh_threads.prospect_email)`, [emails]);
    }
    c.removed = gone.length;
  } else {
    // newest first, stopping at the first page that holds a prospect we already have
    for await (const pageItems of pageQuery(`${P}/contacts`, { sort: 'desc', sortBy: 'createdAt' }, 100)) {
      const list = parseAll(ProspectIn, pageItems, 'prospects', ctx, c);
      const known = list.length ? (await q(`select id from sh_prospects where id = any($1)`, [list.map((p) => p.id)])).length : 0;
      c.upserted += await storeProspects(list);
      if (known) break;
    }
  }
  await linkProspects();
  return c;
}

// exact email first, then company domain; never a free mail domain, never over a link a person made
const FREE_MAIL = ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'rediffmail.com', 'zoho.com', 'yandex.com', 'gmx.com'];
export async function linkProspects() {
  const a = await q(`update sh_prospects s set contact_id=c.id, company_id=c.company_id, link_method='email', updated_at=now()
    from contacts c where c.email = s.email and s.link_method is distinct from 'manual' and (s.contact_id is distinct from c.id or s.link_method is distinct from 'email') returning s.id`);
  const b = await q(`update sh_prospects s set company_id=co.id, link_method='domain', updated_at=now()
    from companies co where s.link_method is null and s.contact_id is null and co.domain = split_part(lower(s.email::text),'@',2)
      and split_part(lower(s.email::text),'@',2) <> all($1::text[]) returning s.id`, [FREE_MAIL]);
  return a.length + b.length;
}

const threadRow = (t: z.output<typeof ThreadIn>) => ({ id: t.emailThreadId, prospect_email: (t.from ?? '').toLowerCase().match(/[^<\s]+@[^>\s]+/)?.[0] ?? null, subject: t.subject, sequence_id: t.sequenceId, email_account_id: t.emailAccountId,
  last_message_at: t.receivedAt ?? t.lastEmailAt ?? t.updatedAt ?? t.createdAt, is_read: t.isRead, category: t.category, sentiment: t.sentiment, outcome: t.outcome });
const THREAD_COLS: Col[] = [['id', 'text'], ['prospect_email', 'citext'], ['subject', 'text'], ['sequence_id', 'text'], ['email_account_id', 'text'], ['last_message_at', 'timestamptz'], ['is_read', 'boolean'], ['category', 'text'], ['sentiment', 'text'], ['outcome', 'text']];
const toText = (html: string | null) => (html ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();
export async function syncInbox(since: Date | null, ctx: RunCtx) {
  const c = blank();
  const body: Record<string, unknown> = since ? { startDate: since.toISOString() } : {};
  const list = parseAll(ThreadIn, await collect(pageBodyLimit(`${P}/unified-inbox/emails`, body, 50, 'items')), 'inbox threads', ctx, c);
  const before = new Map((await q(`select id, last_message_at from sh_threads where id = any($1)`, [list.map((t) => t.emailThreadId)])).map((r) => [r.id, r.last_message_at?.toISOString?.() ?? null]));
  c.upserted += await upsert('sh_threads', ['id'], THREAD_COLS, list.map(threadRow));
  // new or newer threads get their messages (at most 100 a run, so a big backlog spreads over a few runs)
  const fresh = list.filter((t) => { const was = before.get(t.emailThreadId); const now = t.receivedAt ?? t.lastEmailAt ?? t.updatedAt; return was === undefined || (now && now !== was); }).slice(0, 100);
  for (const t of fresh) { try { await refreshThread(t.emailThreadId, ctx); } catch (e: any) { ctx.errors.push({ resource: 'inbox messages', id: t.emailThreadId, error: e.message }); } }
  return c;
}
export async function refreshThread(threadId: string, ctx: RunCtx = { errors: [] }) {
  const t = await read.get(`${P}/unified-inbox/emails/${encodeURIComponent(threadId)}`);
  const head = ThreadIn.safeParse({ emailThreadId: threadId, ...t });
  if (head.success) await upsert('sh_threads', ['id'], THREAD_COLS, [threadRow(head.data)]);
  const c = blank();
  const msgs = parseAll(MessageIn, itemsOf(t, 'emails'), 'inbox messages', ctx, c);
  await upsert('sh_messages', ['id'], [['id', 'text'], ['thread_id', 'text'], ['direction', 'text'], ['from_email', 'citext'], ['to_emails', 'text[]'], ['sent_at', 'timestamptz'], ['subject', 'text'], ['body_text', 'text']],
    msgs.map((m) => ({ id: m.emailId, thread_id: threadId, direction: m.direction ?? null, from_email: (m.from ?? '').match(/[^<\s]+@[^>\s]+/)?.[0] ?? null,
      to_emails: (Array.isArray(m.to) ? m.to : m.to ? [m.to] : []), sent_at: m.sentAt ?? m.date, subject: m.subject, body_text: toText(m.content ?? m.body) })));
  return c;
}

const taskRow = (t: z.output<typeof TaskIn>) => ({ id: t.id, type: t.type, status: t.status, priority: t.priority, prospect_id: t.prospectId, prospect_name: t.prospectName, sequence_id: t.sequenceId, sequence_name: t.sequenceName,
  due_date: t.dueDate ? t.dueDate.slice(0, 10) : null, note: t.note ?? t.taskNote, assignee: t.assignee });
const TASK_COLS: Col[] = [['id', 'text'], ['type', 'text'], ['status', 'text'], ['priority', 'text'], ['prospect_id', 'text'], ['prospect_name', 'text'], ['sequence_id', 'text'], ['sequence_name', 'text'], ['due_date', 'date'], ['note', 'text'], ['assignee', 'text']];
export async function syncTasks(full: boolean, ctx: RunCtx) {
  const c = blank(); const runStart = new Date();
  const list = parseAll(TaskIn, await collect(pageQuery(`${P}/tasks`, {}, 100, 'task')), 'tasks', ctx, c);
  c.upserted += await upsert('sh_tasks', ['id'], TASK_COLS, list.map(taskRow));
  if (full) c.removed += (await q(`delete from sh_tasks where synced_at < $1 returning id`, [runStart])).length;
  return c;
}
export async function refreshTask(taskId: string) {
  const t = TaskIn.safeParse(await read.get(`${P}/tasks/${encodeURIComponent(taskId)}`));
  if (t.success) await upsert('sh_tasks', ['id'], TASK_COLS, [taskRow(t.data)]);
}
export async function refreshNotes(prospectId: string, ctx: RunCtx = { errors: [] }) {
  const c = blank(); const runStart = new Date();
  const list = parseAll(NoteIn, await collect(skipTake(`${P}/prospects/${encodeURIComponent(prospectId)}/notes`, {}, 50, 'notes')), 'notes', ctx, c);
  c.upserted += await upsert('sh_notes', ['id'], [['id', 'text'], ['prospect_id', 'text'], ['content', 'text'], ['visibility', 'text'], ['status', 'text'], ['sh_created_at', 'timestamptz']],
    list.map((n) => ({ id: n.id, prospect_id: prospectId, content: n.content ?? '', visibility: n.visibility, status: n.status, sh_created_at: n.createdAt })));
  c.removed += (await q(`delete from sh_notes where prospect_id=$1 and synced_at < $2 returning id`, [prospectId, runStart])).length;
  return c;
}
// there is no "get one prospect" endpoint, so a refresh searches by email
export async function refreshProspect(email: string, ctx: RunCtx = { errors: [] }) {
  const c = blank();
  const list = parseAll(ProspectIn, itemsOf(await read.get(`${P}/contacts`, { search: email, page: 1, pageSize: 25 })), 'prospects', ctx, c).filter((p) => p.email === email.toLowerCase());
  await storeProspects(list); await linkProspects();
  return list[0]?.id ?? null;
}
export async function syncDnc(full: boolean, ctx: RunCtx) {
  const lists = blank(); const items = blank(); const runStart = new Date(); let complete = true;
  const raw = parseAll(DncListIn, await collect(pageQuery('/v1/dnc', {}, 100)), 'do not contact lists', ctx, lists);
  lists.upserted += await upsert('sh_dnc_lists', ['id'], [['id', 'text'], ['name', 'text'], ['item_count', 'int'], ['sh_updated_at', 'timestamptz']], raw.map((l) => ({ id: l.id, name: l.name ?? '', item_count: l.itemCount ?? l.total, sh_updated_at: l.updatedAt })));
  for (const l of raw) {
    try {
      const its = parseAll(DncItemIn, await collect(pageQuery(`/v1/dnc/${encodeURIComponent(l.id)}`, { type: 'all' }, 100, 'dncList')), 'do not contact items', ctx, items);
      items.upserted += await upsert('sh_dnc_items', ['id'], [['id', 'text'], ['list_id', 'text'], ['value', 'citext'], ['type', 'text']], its.map((i) => ({ id: i.id, list_id: l.id, value: i.value, type: i.type ?? (i.value.includes('@') ? 'email' : 'domain') })));
    } catch (e: any) { complete = false; ctx.errors.push({ resource: 'do not contact items', id: l.id, error: e.message }); }
  }
  if (full) {
    lists.removed += (await q(`delete from sh_dnc_lists where synced_at < $1 returning id`, [runStart])).length;
    if (complete) items.removed += (await q(`delete from sh_dnc_items where synced_at < $1 returning id`, [runStart])).length;
  }
  return { lists, items };
}
export async function syncMailboxes(full: boolean, ctx: RunCtx) {
  const c = blank(); const runStart = new Date();
  const list = parseAll(AccountIn, await collect(pageBodySize(`${P}/email-accounts`, { sort: 'DESC', sortByKey: 'health-score' }, 100, 'emails')), 'mailboxes', ctx, c);
  c.upserted += await upsert('sh_email_accounts', ['id'], [['id', 'text'], ['from_email', 'citext'], ['from_name', 'text'], ['status', 'text'], ['provider', 'text'], ['health', 'jsonb']],
    list.map((a) => ({ id: a.id, from_email: a.fromEmail ?? a.email, from_name: a.fromName, status: a.status, provider: a.emailServiceProvider, health: { health_score: a.healthScore, remaining_quota: a.remainingQuota, daily_limit: a.dailySendingLimit } })));
  if (full) c.removed += (await q(`delete from sh_email_accounts where synced_at < $1 returning id`, [runStart])).length;
  return c;
}
// the small reference lists: schedules, tags, fields, outcomes, inbox categories, team members, clients
export async function syncLookups(ctx: RunCtx) {
  const c = blank();
  const sources: [string, () => Promise<any[]>, (x: any) => string][] = [
    ['schedule', async () => itemsOf(await read.get(`${P}/schedules`)), (x) => String(x.id)],
    ['tag', async () => itemsOf(await read.get(`${P}/contacts/tags`)), (x) => String(x.id)],
    ['field', async () => itemsOf(await read.get(`${P}/fields`, { systemFields: true })), (x) => String(x.id)],
    ['outcome', async () => collect(pageQuery(`${P}/unified-inbox/outcome`, {}, 100, 'items')), (x) => String(x.id)],
    ['category', async () => itemsOf(await read.get(`${P}/unibox/categories`)), (x) => String(x.key ?? x.id)],
    ['team', async () => { const t = await read.get(`${P}/user/team-member-list`); const flat = itemsOf(t); return flat.flatMap((x: any) => Array.isArray(x.members) ? x.members.map((m: any) => ({ ...m, teamName: x.teamName ?? x.name })) : [x]); }, (x) => String(x.id)],
    ['client', async () => collect(pageQuery('/v1/clients', {}, 100)), (x) => String(x.id)],
  ];
  for (const [kind, fetchList, idOf] of sources) {
    try {
      const runStart = new Date();
      const rows = (await fetchList()).filter((x) => x && typeof x === 'object' && idOf(x) !== 'undefined');
      c.seen += rows.length;
      c.upserted += await upsert('sh_lookups', ['kind', 'id'], [['kind', 'text'], ['id', 'text'], ['data', 'jsonb']], rows.map((x) => ({ kind, id: idOf(x), data: x })));
      await q(`update sh_lookups set synced_at=now() where kind=$1 and id = any($2::text[])`, [kind, rows.map(idOf)]);
      c.removed += (await q(`delete from sh_lookups where kind=$1 and synced_at < $2 returning id`, [kind, runStart])).length;
    } catch (e: any) { ctx.errors.push({ resource: `lookups: ${kind}`, error: e.message }); }
  }
  return c;
}

// ---------- runs ----------
const LOCK = 7_310_001; // one Saleshandy sync at a time across processes
export async function runSync(kind: 'full' | 'incremental') {
  const client = await pool.connect();
  try {
    const got = (await client.query('select pg_try_advisory_lock($1) ok', [LOCK])).rows[0].ok;
    if (!got) return { skipped: 'another Saleshandy sync is running' };
    const run = (await one(`insert into sh_sync_runs(kind) values($1) returning id`, [kind]))!;
    const ctx: RunCtx = { errors: [] }; const counts: Record<string, Counts> = {}; let failed = 0;
    const full = kind === 'full';
    const lastInbox = await one(`select max(started_at) t from sh_sync_runs where status in ('success','partial') and (counts ? 'inbox')`);
    const steps: [string, () => Promise<unknown>][] = [
      ['sequences', async () => { const r = await syncSequences(full, ctx); counts.sequences = r.sequences; counts.steps = r.steps; }],
      ['prospects', async () => { counts.prospects = await syncProspects(full, ctx); }],
      ['inbox', async () => { counts.inbox = await syncInbox(full || !lastInbox?.t ? null : new Date(new Date(lastInbox.t).getTime() - 60 * 60_000), ctx); }],
      ['tasks', async () => { counts.tasks = await syncTasks(full, ctx); }],
      ['dnc', async () => { const r = await syncDnc(full, ctx); counts.dnc_lists = r.lists; counts.dnc_items = r.items; }],
      ['mailboxes', async () => { counts.mailboxes = await syncMailboxes(full, ctx); }],
      ...(full ? [['lookups', async () => { counts.lookups = await syncLookups(ctx); }] as [string, () => Promise<unknown>]] : []),
    ];
    for (const [name, fn] of steps) {
      try { await fn(); } catch (e: any) { failed++; ctx.errors.push({ resource: name, error: e.message }); log.warn('saleshandy sync step failed', { step: name, err: e.message }); }
    }
    const status = failed === steps.length ? 'failed' : failed || ctx.errors.length ? 'partial' : 'success';
    await q(`update sh_sync_runs set status=$2, counts=$3, errors=$4, finished_at=now() where id=$1`, [run.id, status, counts, JSON.stringify(ctx.errors.slice(0, 200))]);
    if (full) await prune();
    return { run_id: run.id, status, counts, errors: ctx.errors.length };
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK]).catch(() => {}); client.release();
  }
}

// retention (see DECISIONS-NEEDED.md): 12 months of mirrored mail and events, 3 years of audit
export async function prune() {
  await q(`delete from sh_messages where coalesce(sent_at, created_at) < now() - interval '12 months'`);
  await q(`delete from sh_events where occurred_at < now() - interval '12 months'`);
  await q(`delete from sh_threads where coalesce(last_message_at, created_at) < now() - interval '12 months'`);
  await q(`delete from sh_webhook_inbox where status in ('processed','ignored') and received_at < now() - interval '90 days'`);
  await q(`delete from sh_sync_runs where started_at < now() - interval '90 days'`);
  await q(`delete from sh_write_audit where created_at < now() - interval '3 years'`);
}
