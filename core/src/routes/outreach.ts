// Outreach: the Saleshandy screens' data and actions. Signed-in staff only (no client-facing view reads any of this).
// Data routes answer from the mirror, with when it was last synced; actions go through the write gateway.
import { route, type Ctx } from '../lib/http.ts';
import { q, one } from '../lib/db.ts';
import { HttpError } from '../pipeline.ts';
import { parse, z } from '../lib/validate.ts';
import { enqueue } from '../jobs.ts';
import { shConfig, SH_APP } from '../saleshandy/config.ts';
import { runSync, refreshThread, refreshNotes, linkProspects } from '../saleshandy/sync.ts';
import { execute, cancel, monthSpend, creditBalance, type Actor } from '../saleshandy/gateway.ts';
import { receive, replay, replayFailed } from '../saleshandy/webhook.ts';
import { read } from '../saleshandy/client.ts';
import { readChecks, testSequenceCheck } from '../saleshandy/livecheck.ts';

const STALE_MS = 2 * 60 * 60_000;
const on = () => { if (!shConfig().integration) throw new HttpError(409, 'The Saleshandy integration is switched off.'); };
const actorOf = (c: Ctx): Actor => ({ kind: 'user', id: c.user!.id, name: c.user!.name, role: c.user!.role as 'admin' | 'member' });
async function synced(resource: string) {
  const r = await one(`select max(started_at) t from sh_sync_runs where status in ('success','partial') and counts ? $1`, [resource]);
  const t = r?.t ? new Date(r.t) : null; return { last_synced: t, stale: !t || Date.now() - t.getTime() > STALE_MS };
}

// ---------- status ----------
route('GET', '/api/sh/status', 'user', async () => {
  const c = shConfig();
  const [runs, webhooks, failedHooks, audit, counts, spent, lastBalance, resources] = await Promise.all([
    q(`select id, kind, status, counts, errors, started_at, finished_at from sh_sync_runs order by started_at desc limit 15`),
    q(`select id, event_type, status, attempts, last_error, received_at from sh_webhook_inbox order by received_at desc limit 30`),
    one(`select count(*)::int n from sh_webhook_inbox where status='failed'`),
    q(`select id, actor, action, risk, targets->>'label' label, outcome, reason, created_at, send_at from sh_write_audit order by created_at desc limit 50`),
    one(`select (select count(*) from sh_sequences)::int sequences, (select count(*) from sh_prospects)::int prospects, (select count(*) from sh_threads)::int threads,
      (select count(*) from sh_tasks)::int tasks, (select count(*) from sh_dnc_items)::int dnc_items, (select count(*) from sh_email_accounts)::int mailboxes,
      (select count(*) from sh_prospects where link_method is null)::int unlinked, (select count(*) from sh_write_audit where outcome='sending' and updated_at < now() - interval '5 minutes')::int stuck`),
    monthSpend(), one(`select balance_after from sh_credit_spend where balance_after is not null order by created_at desc limit 1`),
    Promise.all(['sequences', 'prospects', 'inbox', 'tasks', 'dnc_items', 'mailboxes', 'lookups'].map(async (r) => ({ resource: r, ...(await synced(r)) }))),
  ]);
  return { flags: { integration: c.integration, live: c.live, production: c.production, writes: c.writes, ...c.risk, allowlist: c.allowlist, test_sequence_set: !!c.testSequenceId, credit_cap: c.creditCap, webhook_secret_set: !!process.env.SALESHANDY_WEBHOOK_SECRET },
    resources, runs, webhooks, failed_webhooks: failedHooks!.n, audit, counts, spend: { spent, cap: c.creditCap, last_balance: lastBalance?.balance_after ?? null }, app_url: SH_APP };
});
// live checks, run here on the server that reaches Saleshandy; the browser waits on the job for the report
route('POST', '/api/sh/live-check', 'admin', async () => { on(); const job = enqueue('Saleshandy read checks', () => readChecks()); return { job_id: job.id, status: job.status }; });
route('POST', '/api/sh/test-sequence-check', 'admin', async (c) => { on(); const actor = actorOf(c); const job = enqueue('Saleshandy test sequence check', () => testSequenceCheck(actor)); return { job_id: job.id, status: job.status }; });
route('POST', '/api/sh/sync', 'admin', async (c) => {
  on(); const b = parse(z.object({ kind: z.enum(['full', 'incremental']).default('incremental') }), c.body);
  const job = enqueue(`Saleshandy ${b.kind} sync`, () => runSync(b.kind)); return { job_id: job.id, status: job.status };
});

// ---------- overview and sequences ----------
route('GET', '/api/sh/sequences', 'user', async () => {
  on();
  const rows = await q(`select s.*, (select count(*)::int from sh_prospect_sequences m where m.sequence_id=s.id) prospects from sh_sequences s order by s.active desc nulls last, s.title`);
  return { ...(await synced('sequences')), rows };
});
route('GET', '/api/sh/sequences/:id', 'user', async (c) => {
  on(); const s = await one(`select * from sh_sequences where id=$1`, [c.params.id]); if (!s) throw new HttpError(404, 'That sequence is not in the synced data.');
  const [steps, members, schedules] = await Promise.all([
    q(`select * from sh_sequence_steps where sequence_id=$1 order by number`, [s.id]),
    q(`select m.*, p.email::text email, p.first_name, p.last_name, p.company_name, p.contact_id, p.company_id from sh_prospect_sequences m join sh_prospects p on p.id=m.prospect_id where m.sequence_id=$1 order by p.email limit 1000`, [s.id]),
    q(`select id, data from sh_lookups where kind='schedule' order by data->>'name'`),
  ]);
  // settings and subsequences are read live, so they are never stale; if Saleshandy is unreachable the screen says so
  let settings: any = null, subsequences: any[] = [], live_error: string | null = null;
  try { [settings, subsequences] = await Promise.all([read.get(`/api/open-api/v1/sequences/${encodeURIComponent(s.id)}/settings`), read.get(`/api/open-api/v1/sequences/${encodeURIComponent(s.id)}/subsequences`).then((x: any) => (Array.isArray(x) ? x : []))]); }
  catch (e: any) { live_error = e.message; }
  return { ...(await synced('sequences')), sequence: s, steps, members, schedules, settings, subsequences, live_error, edit_url: `${SH_APP}/sequence/${encodeURIComponent(s.id)}/steps` };
});

// ---------- prospects ----------
route('GET', '/api/sh/prospects', 'user', async (c) => {
  on(); const sp = c.url.searchParams; const term = (sp.get('q') ?? '').trim().slice(0, 100); const page = Math.max(0, Number(sp.get('page') ?? 0) || 0);
  const seq = sp.get('sequence') || null; const status = sp.get('status') || null; const linked = sp.get('linked');
  const rows = await q(`select p.id, p.email::text email, p.first_name, p.last_name, p.company_name, p.verification_status, p.tags, p.link_method, p.contact_id, p.company_id, p.last_activity_at,
      co.name linked_company, (select json_agg(json_build_object('sequence_id', m.sequence_id, 'status', m.status, 'title', s.title)) from sh_prospect_sequences m left join sh_sequences s on s.id=m.sequence_id where m.prospect_id=p.id) sequences,
      exists (select 1 from sh_dnc_items d where d.value = p.email or d.value = split_part(p.email::text,'@',2)) dnc, count(*) over()::int total
    from sh_prospects p left join companies co on co.id=p.company_id
    where ($1 = '' or p.email::text ilike '%'||$1||'%' or concat_ws(' ', p.first_name, p.last_name, p.company_name) ilike '%'||$1||'%')
      and ($2::text is null or exists (select 1 from sh_prospect_sequences m where m.prospect_id=p.id and m.sequence_id=$2))
      and ($3::text is null or exists (select 1 from sh_prospect_sequences m where m.prospect_id=p.id and m.status=$3))
      and ($4::text is null or ($4 = 'yes') = (p.link_method is not null))
    order by p.last_activity_at desc nulls last, p.sh_created_at desc nulls last limit 50 offset $5`, [term.replace(/[\\%_]/g, (m) => '\\' + m), seq, status, linked === 'yes' || linked === 'no' ? linked : null, page * 50]);
  return { ...(await synced('prospects')), rows, total: rows[0]?.total ?? 0, page };
});
route('GET', '/api/sh/prospects/:id', 'user', async (c) => {
  on(); const p = await one(`select p.*, p.email::text email, co.name company_label, co.id linked_company_id, ct.full_name contact_label from sh_prospects p left join companies co on co.id=p.company_id left join contacts ct on ct.id=p.contact_id where p.id=$1`, [c.params.id]);
  if (!p) throw new HttpError(404, 'That prospect is not in the synced data.');
  // notes are read fresh when the panel opens; the mirror answers if Saleshandy cannot be reached
  let notes_error: string | null = null; try { await refreshNotes(p.id); } catch (e: any) { notes_error = e.message; }
  const domain = p.email.split('@')[1];
  const [memberships, events, notes, tasks, threads, dnc, ours] = await Promise.all([
    q(`select m.*, s.title, s.active, (select id from sh_sequence_steps st where st.sequence_id=m.sequence_id order by number limit 1) first_step from sh_prospect_sequences m left join sh_sequences s on s.id=m.sequence_id where m.prospect_id=$1 order by s.title`, [p.id]),
    q(`select id, kind, sequence_id, occurred_at, reliable from sh_events where prospect_id=$1 or email=$2 order by occurred_at desc limit 100`, [p.id, p.email]),
    q(`select * from sh_notes where prospect_id=$1 order by sh_created_at desc nulls last`, [p.id]),
    q(`select * from sh_tasks where prospect_id=$1 order by due_date desc nulls last`, [p.id]),
    q(`select id, subject, last_message_at, is_read, sentiment from sh_threads where prospect_email=$1 order by last_message_at desc nulls last limit 20`, [p.email]),
    q(`select d.value::text value, d.type, l.name list from sh_dnc_items d join sh_dnc_lists l on l.id=d.list_id where d.value = $1 or d.value = $2`, [p.email, domain]),
    one(`select reason, source from suppression_list where email=$1 or domain=$2 limit 1`, [p.email, domain]),
  ]);
  return { ...(await synced('prospects')), prospect: p, memberships, events, notes, notes_error, tasks, threads, dnc, our_suppression: ours, fields: await q(`select id, data from sh_lookups where kind='field' order by data->>'label'`),
    tags: await q(`select id, data from sh_lookups where kind='tag' order by data->>'name'`), dnc_lists: await q(`select id, name from sh_dnc_lists order by name`) };
});
// the prospect panel on our company and prospect pages
route('GET', '/api/sh/linked', 'user', async (c) => {
  if (!shConfig().integration) return { enabled: false, rows: [] };
  const sp = c.url.searchParams; const company = sp.get('company_id'); const contact = sp.get('contact_id');
  if (!company && !contact) throw new HttpError(400, 'company_id or contact_id is required');
  const rows = await q(`select p.id, p.email::text email, p.first_name, p.last_name, p.link_method, p.last_activity_at,
      (select json_agg(json_build_object('sequence_id', m.sequence_id, 'status', m.status, 'title', s.title)) from sh_prospect_sequences m left join sh_sequences s on s.id=m.sequence_id where m.prospect_id=p.id) sequences,
      (select count(*)::int from sh_threads t where t.prospect_email=p.email) threads, (select count(*)::int from sh_tasks t where t.prospect_id=p.id and t.status not in ('completed','skipped')) open_tasks
    from sh_prospects p where ($1::uuid is not null and p.company_id=$1) or ($2::uuid is not null and p.contact_id=$2) order by p.last_activity_at desc nulls last limit 50`, [company, contact]);
  return { enabled: true, ...(await synced('prospects')), rows };
});
route('GET', '/api/sh/unlinked', 'user', async () => {
  on(); const rows = await q(`select id, email::text email, first_name, last_name, company_name, sh_created_at from sh_prospects where link_method is null order by sh_created_at desc nulls last limit 500`);
  return { ...(await synced('prospects')), rows };
});
// a person links by hand; a later sync never changes it
route('POST', '/api/sh/prospects/:id/link', 'user', async (c) => {
  on(); const b = parse(z.object({ contact_id: z.string().uuid().nullable().optional(), company_id: z.string().uuid().nullable().optional() }), c.body);
  let company = b.company_id ?? null;
  if (b.contact_id) { const ct = await one(`select company_id from contacts where id=$1`, [b.contact_id]); if (!ct) throw new HttpError(400, 'That contact does not exist.'); company = ct.company_id; }
  if (company && !(await one(`select 1 from companies where id=$1`, [company]))) throw new HttpError(400, 'That company does not exist.');
  const linked = !!(b.contact_id || company);
  const r = await one(`update sh_prospects set contact_id=$2, company_id=$3, link_method=$4, updated_at=now() where id=$1 returning id`, [c.params.id, b.contact_id ?? null, company, linked ? 'manual' : null]);
  if (!r) throw new HttpError(404, 'That prospect is not in the synced data.');
  if (!linked) await linkProspects();
  return { ok: true };
});
route('GET', '/api/sh/link-search', 'user', async (c) => {
  const t = (c.url.searchParams.get('q') ?? '').trim().slice(0, 100); if (t.length < 2) return [];
  return q(`select 'company' kind, id, name label, domain detail from companies where name ilike '%'||$1||'%' or domain ilike '%'||$1||'%'
    union all select 'contact', ct.id, coalesce(ct.full_name, ct.email::text), co.name from contacts ct join companies co on co.id=ct.company_id where ct.full_name ilike '%'||$1||'%' or ct.email::text ilike '%'||$1||'%' limit 20`, [t.replace(/[\\%_]/g, (m) => '\\' + m)]);
});

// ---------- inbox ----------
route('GET', '/api/sh/inbox', 'user', async (c) => {
  on(); const sp = c.url.searchParams; const f = sp.get('filter') ?? 'all'; const seq = sp.get('sequence') || null;
  const rows = await q(`select t.*, p.id prospect_id, p.first_name, p.last_name, s.title sequence_title from sh_threads t left join sh_prospects p on p.email=t.prospect_email left join sh_sequences s on s.id=t.sequence_id
    where ($1 <> 'unread' or t.is_read is not true) and ($1 not in ('positive','negative','neutral') or t.sentiment=$1) and ($2::text is null or t.sequence_id=$2)
    order by t.last_message_at desc nulls last limit 200`, [f, seq]);
  return { ...(await synced('inbox')), rows };
});
route('GET', '/api/sh/inbox/:id', 'user', async (c) => {
  on(); let live_error: string | null = null;
  try { await refreshThread(c.params.id); } catch (e: any) { live_error = e.message; }
  const t = await one(`select t.*, p.id prospect_id, p.first_name, p.last_name, s.title sequence_title from sh_threads t left join sh_prospects p on p.email=t.prospect_email left join sh_sequences s on s.id=t.sequence_id where t.id=$1`, [c.params.id]);
  if (!t) throw new HttpError(404, live_error ? `That thread could not be loaded: ${live_error}` : 'That thread is not in the synced data.');
  return { thread: t, messages: await q(`select * from sh_messages where thread_id=$1 order by sent_at nulls first`, [t.id]), live_error, outcomes: await q(`select id, data from sh_lookups where kind='outcome'`) };
});

// ---------- tasks, lists, mailboxes, lookups ----------
route('GET', '/api/sh/tasks', 'user', async (c) => {
  on(); const st = c.url.searchParams.get('status') || null;
  const rows = await q(`select t.*, p.email::text email from sh_tasks t left join sh_prospects p on p.id=t.prospect_id where ($1::text is null or t.status=$1) order by case t.status when 'overdue' then 0 when 'dueToday' then 1 when 'upcoming' then 2 else 3 end, t.due_date nulls last limit 500`, [st]);
  return { ...(await synced('tasks')), rows };
});
route('GET', '/api/sh/lists', 'user', async () => {
  on(); const [lists, items] = await Promise.all([q(`select * from sh_dnc_lists order by name`), q(`select id, list_id, value::text value, type from sh_dnc_items order by value limit 2000`)]);
  return { ...(await synced('dnc_items')), lists, items };
});
route('GET', '/api/sh/mailboxes', 'user', async () => { on(); return { ...(await synced('mailboxes')), rows: await q(`select * from sh_email_accounts order by from_email`), app_url: `${SH_APP}/settings/email-accounts` }; });
route('GET', '/api/sh/lookups', 'user', async () => {
  on(); const rows = await q(`select kind, id, data from sh_lookups order by kind, id`);
  const by = (k: string) => rows.filter((r) => r.kind === k).map((r) => ({ id: r.id, ...r.data }));
  return { schedules: by('schedule'), tags: by('tag'), fields: by('field'), outcomes: by('outcome'), team: by('team'), categories: by('category') };
});
route('GET', '/api/sh/credits', 'user', async () => {
  on(); const c = shConfig(); let balance: number | null = null, error: string | null = null;
  try { balance = await creditBalance(); } catch (e: any) { error = e.message; }
  return { balance, error, spent: await monthSpend(), cap: c.creditCap, live: c.live, production: c.production };
});
route('GET', '/api/sh/enrich/:requestId', 'admin', async (c) => {
  on(); const id = encodeURIComponent(c.params.requestId);
  const status = await read.get(`/api/open-api/v1/enrich/status/${id}`);
  return { status, result: String(status?.status ?? '').toLowerCase() === 'completed' ? await read.get(`/api/open-api/v1/enrich/status/result/${id}`) : null };
});

// ---------- actions (every write goes through the gateway) ----------
route('POST', '/api/sh/actions', 'user', async (c) => {
  on(); const b = parse(z.object({ action: z.string().min(1).max(60), input: z.any() }), c.body);
  const key = String(c.req.headers['idempotency-key'] ?? '');
  return execute(actorOf(c), b.action, b.input, `u:${c.user!.id}:${key}`);
});
route('POST', '/api/sh/actions/:id/cancel', 'user', async (c) => cancel(c.params.id, actorOf(c)));
route('GET', '/api/sh/audit', 'user', async (c) => {
  const page = Math.max(0, Number(c.url.searchParams.get('page') ?? 0) || 0);
  return q(`select id, actor, action, risk, targets, before_state, request - 'input' request, response, outcome, reason, created_at, send_at, updated_at from sh_write_audit order by created_at desc limit 50 offset $1`, [page * 50]);
});

// ---------- webhooks ----------
// the secret header is checked by the router (auth 'webhook') before this runs
route('POST', '/webhooks/saleshandy', 'webhook', async (c) => receive(c.body));
route('POST', '/api/sh/webhooks/:id/replay', 'admin', async (c) => replay(c.params.id));
route('POST', '/api/sh/webhooks/replay-failed', 'admin', async () => ({ replayed: await replayFailed() }));
