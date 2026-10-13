import { route } from '../lib/http.ts';
import { q, one, pool, audit, TODAY_IST } from '../lib/db.ts';
import { suppress, isSuppressed } from '../lib/suppression.ts';
import { saleshandy } from '../adapters/saleshandy.ts';
import { scoringConfig } from '../lib/config.ts';
import { env } from '../lib/env.ts';
import { firstName, emailDomain } from '../lib/normalize.ts';
import * as P from '../pipeline.ts';
import { HttpError } from '../pipeline.ts';
import { enqueue, getJob } from '../jobs.ts';
import type { Ctx } from '../lib/http.ts';

// AI work: a signed-in browser (or a caller sending Prefer: respond-async) gets a job id at once and polls /api/jobs/:id,
// because Hostinger's proxy cuts requests at 60 s. n8n and scripts on the same machine keep the synchronous answer.
const wantsAsync = (c: Ctx) => !!c.user || /respond-async/i.test(String(c.req.headers.prefer ?? ''));
const ai = (method: string, path: string, label: (c: Ctx) => string, fn: (c: Ctx) => Promise<unknown>) =>
  route(method, path, 'api', async (c) => { if (!wantsAsync(c)) return fn(c); const j = enqueue(label(c), () => fn(c)); return { job_id: j.id, status: j.status }; });
route('GET', '/api/jobs/:id', 'api', async (c) => { const j = getJob(c.params.id); if (!j) throw new HttpError(404, 'That job is gone. It may have finished more than an hour ago, or the app restarted.'); return { id: j.id, label: j.label, status: j.status, result: j.status === 'done' ? j.result : undefined, error: j.error, run_id: j.run_id, waited_ms: (j.started ?? Date.now()) - j.created }; });

// ---------------- health, metrics ----------------
route('GET', '/health', 'none', async () => {
  const t0 = Date.now(); let db = 'ok'; try { await pool.query('select 1'); } catch (e: any) { db = 'fail: ' + e.message; }
  const failed = db === 'ok' ? Number((await one(`select count(*) n from workflow_runs where status='FAILED' and started_at > now() - interval '24 hours'`))?.n ?? 0) : null;
  const pending = db === 'ok' ? Number((await one(`select count(*) n from email_drafts where status='PENDING_APPROVAL'`))?.n ?? 0) : null;
  return { status: db === 'ok' ? 'ok' : 'degraded', db, db_ms: Date.now() - t0, ai_provider: env.aiProvider, saleshandy: env.saleshandyMode, failed_workflows_24h: failed, pending_approvals: pending, time: new Date().toISOString() };
});
route('GET', '/metrics', 'api', async () => {
  const m = await P.campaignMetrics(); const lines: string[] = [];
  for (const c of m as any[]) for (const [k, v] of Object.entries(c)) if (typeof v === 'number') lines.push(`awtm_${k}{campaign="${c.code}"} ${v}`);
  const h = await one(`select (select count(*) from workflow_runs where status='FAILED') f, (select count(*) from ai_runs where not valid) a, (select count(*) from email_drafts where status='PENDING_APPROVAL') p`);
  lines.push(`awtm_workflow_failed_total ${h!.f}`, `awtm_ai_runs_invalid_total ${h!.a}`, `awtm_pending_approvals ${h!.p}`);
  return lines.join('\n') + '\n';
});

// sign in, sign out, /api/me and people: routes/users.ts

// ---------------- workflow run bookkeeping (n8n) ----------------
route('POST', '/api/workflow-runs', 'api', async (c) => one(`insert into workflow_runs(workflow,external_execution_id,entity_type,entity_id,detail) values($1,$2,$3,$4,$5) returning id`, [c.body.workflow, c.body.execution_id ?? null, c.body.entity_type ?? null, c.body.entity_id ?? null, c.body.detail ?? {}]));
route('POST', '/api/workflow-runs/:id/finish', 'api', async (c) => one(`update workflow_runs set status=$2, error=$3, detail=detail||$4, finished_at=now() where id=$1 returning id,status`, [c.params.id, c.body.status ?? 'SUCCESS', c.body.error ?? null, c.body.detail ?? {}]));
route('POST', '/api/workflow-runs/log-error', 'api', async (c) => one(`insert into workflow_runs(workflow,external_execution_id,entity_type,entity_id,status,error,detail,finished_at) values($1,$2,$3,$4,'FAILED',$5,$6,now()) returning id`, [c.body.workflow ?? 'unknown', c.body.execution_id ?? null, c.body.entity_type ?? null, c.body.entity_id ?? null, String(c.body.error ?? 'unknown').slice(0, 2000), c.body.detail ?? {}]));

// ---------------- today ----------------
const NEEDS_CONTACT = `p.status in ('QUALIFIED','RESEARCH_FURTHER') and not p.suppressed and (p.contact_id is null or not exists (select 1 from contacts x where x.id=p.contact_id and (x.full_name is not null or x.first_name is not null)))`;
route('GET', '/api/overview', 'api', async (c) => {
  const counts = await one(`select
    (select count(*) from email_drafts where status='PENDING_APPROVAL')::int drafts,
    (select count(*) from email_drafts where status='APPROVED')::int approved_unsynced,
    (select count(*) from replies where status in ('NEW','CLASSIFIED'))::int replies,
    (select count(*) from replies where status in ('NEW','CLASSIFIED') and priority='HIGH')::int replies_high,
    (select count(*) from teardowns where status='PENDING_APPROVAL')::int teardowns,
    (select count(*) from prospects p where ${NEEDS_CONTACT})::int needs_contact,
    (select count(*) from meetings where not held and (scheduled_at is null or scheduled_at > now() - interval '1 day'))::int meetings,
    (select count(*) from proposals where status in ('DRAFT','PENDING_APPROVAL'))::int proposals,
    (select count(*) from workflow_runs where status='FAILED' and started_at > now() - interval '7 days')::int failures,
    (select count(*) from ai_runs where not valid and created_at > now() - interval '7 days')::int ai_failures`);
  const stages = await q(`select status, count(*)::int n from prospects group by status`);
  // every activity resolves to its prospect, whichever table the event was recorded against
  const recent = await q(`select a.action, a.actor, a.created_at, a.entity_type, a.entity_id, c.name company, p.id prospect_id from activities a
    left join email_drafts d on a.entity_type='email_draft' and d.id=a.entity_id left join replies r on a.entity_type='reply' and r.id=a.entity_id
    left join teardowns t on a.entity_type='teardown' and t.id=a.entity_id left join meetings m on a.entity_type='meeting' and m.id=a.entity_id left join opportunities o on o.id=m.opportunity_id
    left join prospects p on p.id = case a.entity_type when 'prospect' then a.entity_id when 'email_draft' then d.prospect_id when 'reply' then r.prospect_id when 'teardown' then t.prospect_id when 'meeting' then o.prospect_id end
    left join companies c on c.id=p.company_id
    where a.entity_type in ('prospect','email_draft','teardown','reply','meeting') order by a.created_at desc limit 12`);
  const disc = await one(`select count(*)::int n from discovery_candidates where status='NEW' and enriched_at is not null`);
  // a person's own to-dos and tasks that are due today or late, for the badge on Today
  const todos = c.user ? (await one(`select count(*)::int n from tasks t left join projects p on p.id=t.project_id where t.assignee_id=$1 and t.status<>'DONE' and t.due_date <= ${TODAY_IST} and (p.id is null or p.status in ('ACTIVE','ON_HOLD'))`, [c.user.id]))!.n : 0;
  return { counts: { ...counts, new_candidates: disc!.n, todos_due: todos }, stages, recent, campaigns: await P.campaignMetrics() };
});

// ---------------- review queue ----------------
route('GET', '/api/queue/drafts', 'api', async (c) => {
  const status = c.url.searchParams.get('status') ?? 'PENDING_APPROVAL';
  const rows = await q(`select d.id, d.status, d.subject_original, d.body_original, d.subject_final, d.body_final, d.created_at, d.approver, d.approved_at,
      p.id prospect_id, p.account_score, p.score_breakdown, p.primary_problem, p.secondary_problems, p.specific_observation, p.business_consequence, p.problem_angle, p.relevant_capability, p.relevant_proof_ids,
      co.name company, co.domain, co.website, co.platform, co.city, co.vertical, co.company_size, ca.code campaign, ca.name campaign_name,
      ct.full_name contact_name, ct.job_title contact_title, ct.email contact_email, ct.email_verification_status,
      (select data from research r where r.company_id=co.id and r.kind='WEBSITE' order by created_at desc limit 1) website
    from email_drafts d join prospects p on p.id=d.prospect_id join companies co on co.id=p.company_id left join campaigns ca on ca.id=d.campaign_id left join contacts ct on ct.id=p.contact_id
    where d.status=$1 order by d.created_at`, [status]);
  const proofs = Object.fromEntries((await q('select id,title,label,text,notes from proof_assets')).map((p) => [p.id, p]));
  return { criteria: scoringConfig().criteria, thresholds: scoringConfig().thresholds, items: rows.map((r) => ({ ...r, proofs: (r.relevant_proof_ids ?? []).map((id: string) => proofs[id]).filter(Boolean) })) };
});
route('POST', '/api/drafts/:id/decision', 'api', async (c) => P.decideDraft(c.params.id, c.body.action, c.actor, { subject: c.body.subject, body: c.body.body, reason: c.body.reason }));
route('GET', '/api/drafts', 'api', async (c) => q(`select d.*, co.name company, ca.code campaign from email_drafts d join prospects p on p.id=d.prospect_id join companies co on co.id=p.company_id left join campaigns ca on ca.id=d.campaign_id where d.status=$1 order by d.created_at`, [c.url.searchParams.get('status') ?? 'PENDING_APPROVAL']));
route('POST', '/api/drafts/:id/sync', 'api', async (c) => P.syncToSaleshandy(c.params.id));
route('POST', '/api/sync/approved', 'api', async () => { const rows = await q(`select d.id from email_drafts d left join campaigns c on c.id=d.campaign_id where d.status='APPROVED' and coalesce(c.config->>'delivery','sequencer')='sequencer' order by d.approved_at limit 50`); const out = []; for (const r of rows) { try { out.push(await P.syncToSaleshandy(r.id)); } catch (e: any) { out.push({ draft_id: r.id, error: e.message }); } } return { synced: out }; });

// ---------------- prospects ----------------
route('POST', '/api/prospects', 'api', async (c) => { const r = await P.ingest(c.body, c.actor); return { created: r.created, prospect_id: r.prospect.id, company_id: r.company.id, contact_id: r.contact?.id ?? null, status: r.prospect.status, suppressed: r.prospect.suppressed }; });
route('POST', '/api/prospects/bulk', 'api', async (c) => { const out = []; for (const i of c.body.prospects ?? []) { try { const r = await P.ingest(i, c.actor); out.push({ ok: true, prospect_id: r.prospect.id, created: r.created }); } catch (e: any) { out.push({ ok: false, error: e.message, input: i.company?.domain ?? i.company?.website }); } } return { results: out }; });
route('GET', '/api/prospects', 'api', async (c) => {
  const sp = c.url.searchParams; const view = sp.get('view');
  return q(`select p.id, p.status, p.account_score, p.primary_problem, p.suppressed, p.updated_at, p.specific_observation, c.name, c.domain, c.platform, c.city, ca.code campaign, ct.email, ct.full_name contact_name, ct.job_title contact_title,
      (${NEEDS_CONTACT}) needs_contact
    from prospects p join companies c on c.id=p.company_id left join campaigns ca on ca.id=p.campaign_id left join contacts ct on ct.id=p.contact_id
    where ($1::text is null or p.status = any(string_to_array($1, ','))) and ($2::text is null or ca.code=$2) and ($3::text is null or c.name ilike '%'||$3||'%' or c.domain ilike '%'||$3||'%' or ct.email ilike '%'||$3||'%')
      and ($4::text is null or ($4='needs_contact' and ${NEEDS_CONTACT}) or ($4='active' and p.status not in ('REJECTED','LOST','SUPPRESSED')))
    order by p.updated_at desc limit 500`, [sp.get('status'), sp.get('campaign'), sp.get('q') || null, view]);
});
route('GET', '/api/prospects/:id', 'api', async (c) => {
  const p = await P.loadProspect(c.params.id);
  const [research, drafts, replies, teardowns, opp, activity, contacts] = await Promise.all([
    q('select kind, data, confidence, created_at from research where id in (select distinct on (kind) id from research where company_id=$1 order by kind, created_at desc) order by kind', [p.company.id]),
    q('select * from email_drafts where prospect_id=$1 order by created_at desc', [p.id]),
    q('select * from replies where prospect_id=$1 order by received_at desc', [p.id]),
    q('select * from teardowns where prospect_id=$1 order by created_at desc', [p.id]),
    one(`select o.*, (select json_agg(m order by m.created_at desc) from meetings m where m.opportunity_id=o.id) meetings, (select json_agg(pr order by pr.created_at desc) from proposals pr where pr.opportunity_id=o.id) proposals from opportunities o where o.prospect_id=$1`, [p.id]),
    q(`select action, actor, detail, created_at, entity_type from activities where entity_id=$1 or entity_id in (select id from email_drafts where prospect_id=$1) or entity_id in (select id from teardowns where prospect_id=$1) order by created_at desc limit 60`, [p.id]),
    q('select id, full_name, job_title, email, linkedin_url, is_decision_maker, email_verification_status from contacts where company_id=$1 order by is_decision_maker desc, created_at', [p.company.id]),
  ]);
  const proofs = (await q('select id,title,label,text from proof_assets where id = any($1)', [p.relevant_proof_ids ?? []]));
  return { ...p, criteria: scoringConfig().criteria, thresholds: scoringConfig().thresholds, research, drafts, replies, teardowns, opportunity: opp ?? null, activity, contacts, proofs };
});
// The decision maker: name required, email optional. Becomes the prospect's contact; a draft can then be written.
route('POST', '/api/prospects/:id/contact', 'api', async (c) => {
  const p = await P.loadProspect(c.params.id);
  const full_name = String(c.body.full_name ?? '').trim(); if (full_name.length < 2) throw new HttpError(400, 'A name is needed.');
  const email = c.body.email ? String(c.body.email).trim().toLowerCase() : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new HttpError(400, 'That email does not look right.');
  // the address, its own domain, and the company's domain: any one on the list refuses it (same rule as the CRM)
  if (email && ((await isSuppressed(email, emailDomain(email))).suppressed || (await isSuppressed(null, p.company.domain)).suppressed)) throw new HttpError(409, 'This person or domain is on the suppression list.');
  const parts = full_name.split(/\s+/);
  const ct = email
    ? await one(`insert into contacts(company_id,first_name,last_name,full_name,job_title,email,linkedin_url,is_decision_maker,source) values($1,$2,$3,$4,$5,$6,$7,true,'manual')
        on conflict (company_id,email) do update set first_name=excluded.first_name,last_name=excluded.last_name,full_name=excluded.full_name,job_title=coalesce(excluded.job_title,contacts.job_title),linkedin_url=coalesce(excluded.linkedin_url,contacts.linkedin_url),is_decision_maker=true returning *`,
        [p.company.id, firstName(full_name), parts.length > 1 ? parts.slice(1).join(' ') : null, full_name, c.body.job_title || null, email, c.body.linkedin_url || null])
    : await one(`insert into contacts(company_id,first_name,last_name,full_name,job_title,linkedin_url,is_decision_maker,source) values($1,$2,$3,$4,$5,$6,true,'manual') returning *`,
        [p.company.id, firstName(full_name), parts.length > 1 ? parts.slice(1).join(' ') : null, full_name, c.body.job_title || null, c.body.linkedin_url || null]);
  await q('update prospects set contact_id=$2 where id=$1', [p.id, ct!.id]);
  await audit('prospect', p.id, 'decision_maker_added', c.actor, { name: full_name, title: c.body.job_title ?? null, has_email: !!email });
  return { contact_id: ct!.id };
});
const stage = (name: string, fn: (id: string, o: any) => Promise<unknown>) => ai('POST', `/api/prospects/:id/${name}`, (c) => `${name}:${c.params.id}`, async (c) => fn(c.params.id, { workflowRunId: c.body.workflow_run_id, force: !!c.body.force, html: c.body.html }));
stage('research', P.research); stage('analyze-website', P.analyzeWebsite); stage('decision-maker', P.identifyDecisionMaker); stage('identify-problem', P.identifyProblem); stage('qualify', P.qualify); stage('generate-email', P.generateEmail); stage('run-chain', P.runChain);
route('POST', '/api/prospects/:id/meeting', 'api', async (c) => P.createMeeting(c.params.id, c.body.scheduled_at));
route('POST', '/api/contacts/:id/verification', 'api', async (c) => one(`update contacts set email_verification_status=$2 where id=$1 returning id,email_verification_status`, [c.params.id, c.body.status]));

// ---------------- inbox ----------------
route('GET', '/api/inbox', 'api', async () => ({
  replies: await q(`select r.*, co.name company, co.domain, p.id prospect_id, ct.full_name contact_name,
      (select id from teardowns t where t.reply_id=r.id order by created_at desc limit 1) teardown_id
    from replies r left join prospects p on p.id=r.prospect_id left join companies co on co.id=p.company_id left join contacts ct on ct.id=r.contact_id
    where r.status in ('NEW','CLASSIFIED') order by case r.priority when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end, r.received_at`),
  teardowns: await q(`select t.*, co.name company, co.domain, ct.full_name contact_name, r.body reply_body from teardowns t join prospects p on p.id=t.prospect_id join companies co on co.id=p.company_id
    left join contacts ct on ct.id=p.contact_id left join replies r on r.id=t.reply_id where t.status='PENDING_APPROVAL' order by t.created_at`),
}));
route('GET', '/api/replies', 'api', async (c) => q(`select r.*, co.name company from replies r left join prospects p on p.id=r.prospect_id left join companies co on co.id=p.company_id where r.status=$1 order by r.received_at`, [c.url.searchParams.get('status') ?? 'NEW']));
ai('POST', '/api/replies/:id/classify', (c) => `classify:${c.params.id}`, async (c) => P.classifyReply(c.params.id, { workflowRunId: c.body.workflow_run_id }));
ai('POST', '/api/replies/:id/teardown', (c) => `teardown:${c.params.id}`, async (c) => P.generateTeardown(c.params.id, { workflowRunId: c.body.workflow_run_id, force: !!c.body.force }));
route('POST', '/api/replies/:id/handled', 'api', async (c) => { const r = await one(`update replies set status='ACTIONED' where id=$1 returning id,status`, [c.params.id]); if (!r) throw new HttpError(404, 'reply not found'); await audit('reply', r.id, 'handled', c.actor); return r; });
route('POST', '/api/teardowns/:id/decision', 'api', async (c) => P.decideTeardown(c.params.id, c.body.action, c.actor, c.body.body));

// ---------------- deals ----------------
route('GET', '/api/deals', 'api', async () => ({
  meetings: await q(`select m.id, m.scheduled_at, m.held, m.brief, m.analysis, m.notes, m.created_at, o.id opportunity_id, o.stage, p.id prospect_id, co.name company, co.domain, ct.full_name contact_name
    from meetings m join opportunities o on o.id=m.opportunity_id join prospects p on p.id=o.prospect_id join companies co on co.id=p.company_id left join contacts ct on ct.id=p.contact_id order by m.held, m.scheduled_at nulls last, m.created_at desc`),
  proposals: await q(`select pr.*, co.name company, p.id prospect_id from proposals pr join opportunities o on o.id=pr.opportunity_id join prospects p on p.id=o.prospect_id join companies co on co.id=p.company_id order by pr.created_at desc`),
  opportunities: await q(`select o.stage, count(*)::int n, coalesce(sum(o.value_paise),0)::bigint value_paise from opportunities o group by o.stage`),
}));
ai('POST', '/api/meetings/:id/brief', (c) => `brief:${c.params.id}`, async (c) => P.meetingBrief(c.params.id, { workflowRunId: c.body.workflow_run_id, force: !!c.body.force }));
ai('POST', '/api/meetings/:id/post-meeting', (c) => `post_meeting:${c.params.id}`, async (c) => P.postMeeting(c.params.id, c.body.notes, { workflowRunId: c.body.workflow_run_id }));
ai('POST', '/api/meetings/:id/proposal', (c) => `proposal:${c.params.id}`, async (c) => P.draftProposal(c.params.id, c.body.business_inputs ?? {}, { workflowRunId: c.body.workflow_run_id }));
route('POST', '/api/proposals/:id/decision', 'api', async (c) => one(`update proposals set status=$2, approver=$3, approved_at=now() where id=$1 returning id,status`, [c.params.id, c.body.action === 'APPROVE' ? 'APPROVED' : 'DECLINED', c.actor]));

// ---------------- webhook ----------------
route('POST', '/webhooks/saleshandy', 'webhook', async (c) => {
  const b = c.body; const events = Array.isArray(b) ? b : Array.isArray(b.events) ? b.events : [b];
  const out = []; for (const e of events) out.push(await P.ingestWebhook({ event: e.event ?? e.event_type ?? e.type, event_id: e.event_id ?? e.id, email: e.email ?? e.prospect_email ?? e.to, sequence_id: e.sequence_id, prospect_id: e.prospect_id, occurred_at: e.occurred_at ?? e.timestamp, subject: e.subject, body: e.body ?? e.reply_body ?? e.message, reply_from: e.reply_from ?? e.from }));
  return { processed: out };
});

// ---------------- suppression ----------------
route('POST', '/api/suppression', 'api', async (c) => suppress({ email: c.body.email || null, domain: c.body.domain || null, reason: c.body.reason || 'manual', source: c.body.source ?? c.actor, actor: c.actor, expires_at: c.body.expires_at }));
route('GET', '/api/suppression/check', 'api', async (c) => isSuppressed(c.url.searchParams.get('email'), c.url.searchParams.get('domain')));
route('GET', '/api/suppression', 'api', async () => q('select * from suppression_list order by created_at desc limit 500'));

// ---------------- campaigns, analytics, ops ----------------
route('GET', '/api/metrics/campaigns', 'api', async () => P.campaignMetrics());
route('GET', '/api/campaigns', 'api', async () => {
  const [campaigns, metrics, latest] = await Promise.all([q('select * from campaigns order by code'), P.campaignMetrics(), one(`select detail, created_at from activities where action='weekly_analysis' order by created_at desc limit 1`)]);
  const recs = new Map(((latest?.detail?.recommendations ?? []) as any[]).map((r) => [r.campaign_code, r]));
  return { analysed_at: latest?.created_at ?? null, campaigns: campaigns.map((c) => ({ ...c, metrics: (metrics as any[]).find((m) => m.code === c.code), recommendation: recs.get(c.code) ?? null })) };
});
ai('POST', '/api/analytics/weekly', () => 'weekly_analysis', async (c) => P.weeklyAnalysis({ workflowRunId: c.body.workflow_run_id }));
route('POST', '/api/metrics/daily-snapshot', 'api', async () => { const m = await P.campaignMetrics(); await q(`insert into activities(entity_type,entity_id,action,actor,detail) values('metrics','00000000-0000-0000-0000-000000000000','daily_snapshot','system',$1)`, [{ campaigns: m }]); return { campaigns: m.length }; });
route('GET', '/api/ops/failures', 'api', async () => ({ workflows: await q(`select * from workflow_runs where status='FAILED' order by started_at desc limit 50`), ai_runs: await q(`select id,agent,error,created_at from ai_runs where not valid order by created_at desc limit 50`) }));
route('GET', '/api/ops/saleshandy', 'api', async () => { const sh = saleshandy(); return { mode: sh.mode, accounts: await sh.listEmailAccounts(), sequences: await sh.listSequences() }; });
route('GET', '/api/proof-assets', 'api', async () => q('select * from proof_assets order by label, id'));
