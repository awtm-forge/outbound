import { route, redirect } from '../lib/http.ts';
import { q, one, pool } from '../lib/db.ts';
import { suppress, isSuppressed } from '../lib/suppression.ts';
import { saleshandy } from '../adapters/saleshandy.ts';
import { env } from '../lib/env.ts';
import * as P from '../pipeline.ts';

route('GET', '/health', 'none', async () => {
  const t0 = Date.now(); let db = 'ok'; try { await pool.query('select 1'); } catch (e: any) { db = 'fail: ' + e.message; }
  const failed = db === 'ok' ? Number((await one(`select count(*) n from workflow_runs where status='FAILED' and started_at > now() - interval '24 hours'`))?.n ?? 0) : null;
  const pending = db === 'ok' ? Number((await one(`select count(*) n from email_drafts where status='PENDING_APPROVAL'`))?.n ?? 0) : null;
  return { status: db === 'ok' ? 'ok' : 'degraded', db, db_ms: Date.now() - t0, ai_provider: env.aiProvider, saleshandy: env.saleshandyMode, failed_workflows_24h: failed, pending_approvals: pending, time: new Date().toISOString() };
});
route('GET', '/metrics', 'api', async () => { // basic prometheus-style text
  const m = await P.campaignMetrics(); const lines: string[] = [];
  for (const c of m as any[]) for (const [k, v] of Object.entries(c)) if (typeof v === 'number') lines.push(`awtm_${k}{campaign="${c.code}"} ${v}`);
  const h = await one(`select (select count(*) from workflow_runs where status='FAILED') f, (select count(*) from ai_runs where not valid) a, (select count(*) from email_drafts where status='PENDING_APPROVAL') p`);
  lines.push(`awtm_workflow_failed_total ${h!.f}`, `awtm_ai_runs_invalid_total ${h!.a}`, `awtm_pending_approvals ${h!.p}`);
  return lines.join('\n') + '\n';
});

// ---- workflow run bookkeeping (n8n calls these around each run) ----
route('POST', '/api/workflow-runs', 'api', async (c) => one(`insert into workflow_runs(workflow,external_execution_id,entity_type,entity_id,detail) values($1,$2,$3,$4,$5) returning id`, [c.body.workflow, c.body.execution_id ?? null, c.body.entity_type ?? null, c.body.entity_id ?? null, c.body.detail ?? {}]));
route('POST', '/api/workflow-runs/:id/finish', 'api', async (c) => one(`update workflow_runs set status=$2, error=$3, detail=detail||$4, finished_at=now() where id=$1 returning id,status`, [c.params.id, c.body.status ?? 'SUCCESS', c.body.error ?? null, c.body.detail ?? {}]));
route('POST', '/api/workflow-runs/log-error', 'api', async (c) => one(`insert into workflow_runs(workflow,external_execution_id,entity_type,entity_id,status,error,detail,finished_at) values($1,$2,$3,$4,'FAILED',$5,$6,now()) returning id`, [c.body.workflow ?? 'unknown', c.body.execution_id ?? null, c.body.entity_type ?? null, c.body.entity_id ?? null, String(c.body.error ?? 'unknown').slice(0, 2000), c.body.detail ?? {}]));

// ---- prospects ----
route('POST', '/api/prospects', 'api', async (c) => { const r = await P.ingest(c.body, c.actor); return { created: r.created, prospect_id: r.prospect.id, company_id: r.company.id, contact_id: r.contact?.id ?? null, status: r.prospect.status, suppressed: r.prospect.suppressed }; });
route('POST', '/api/prospects/bulk', 'api', async (c) => { const out = []; for (const i of c.body.prospects ?? []) { try { const r = await P.ingest(i, c.actor); out.push({ ok: true, prospect_id: r.prospect.id, created: r.created }); } catch (e: any) { out.push({ ok: false, error: e.message, input: i.company?.domain ?? i.company?.website }); } } return { results: out }; });
route('GET', '/api/prospects', 'api', async (c) => q(`select p.id,p.status,p.account_score,p.primary_problem,p.suppressed,c.name,c.domain,ca.code campaign,ct.email from prospects p join companies c on c.id=p.company_id left join campaigns ca on ca.id=p.campaign_id left join contacts ct on ct.id=p.contact_id where ($1::text is null or p.status=$1) order by p.updated_at desc limit 200`, [c.url.searchParams.get('status')]));
route('GET', '/api/prospects/:id', 'api', async (c) => { const p = await P.loadProspect(c.params.id); const research = await q('select kind,data,confidence,created_at from research where prospect_id=$1 order by created_at', [p.id]); const drafts = await q('select * from email_drafts where prospect_id=$1 order by created_at', [p.id]); return { ...p, research, drafts }; });
const stage = (name: string, fn: (id: string, o: any) => Promise<unknown>) => route('POST', `/api/prospects/:id/${name}`, 'api', async (c) => fn(c.params.id, { workflowRunId: c.body.workflow_run_id, force: !!c.body.force, html: c.body.html }));
stage('research', P.research); stage('analyze-website', P.analyzeWebsite); stage('decision-maker', P.identifyDecisionMaker); stage('identify-problem', P.identifyProblem); stage('qualify', P.qualify); stage('generate-email', P.generateEmail); stage('run-chain', P.runChain);
route('POST', '/api/prospects/:id/meeting', 'api', async (c) => P.createMeeting(c.params.id, c.body.scheduled_at));
route('POST', '/api/contacts/:id/verification', 'api', async (c) => one(`update contacts set email_verification_status=$2 where id=$1 returning id,email_verification_status`, [c.params.id, c.body.status]));

// ---- approval gate (JSON from n8n/API, or form from the dashboard) ----
route('POST', '/api/drafts/:id/decision', 'api', async (c) => P.decideDraft(c.params.id, c.body.action, c.actor, { subject: c.body.subject, body: c.body.body, reason: c.body.reason }));
route('POST', '/ui/drafts/:id/decision', 'dashboard', async (c) => { await P.decideDraft(c.params.id, c.body.action, c.actor, { subject: c.body.subject, body: c.body.body, reason: c.body.reason }); redirect(c, '/'); });
route('GET', '/api/drafts', 'api', async (c) => q(`select d.*, co.name company, ca.code campaign from email_drafts d join prospects p on p.id=d.prospect_id join companies co on co.id=p.company_id left join campaigns ca on ca.id=d.campaign_id where d.status=$1 order by d.created_at`, [c.url.searchParams.get('status') ?? 'PENDING_APPROVAL']));
route('POST', '/api/drafts/:id/sync', 'api', async (c) => P.syncToSaleshandy(c.params.id));
route('POST', '/ui/drafts/:id/sync', 'dashboard', async (c) => { await P.syncToSaleshandy(c.params.id); redirect(c, '/'); });
route('POST', '/api/sync/approved', 'api', async () => { const rows = await q(`select id from email_drafts where status='APPROVED' order by approved_at limit 50`); const out = []; for (const r of rows) { try { out.push(await P.syncToSaleshandy(r.id)); } catch (e: any) { out.push({ draft_id: r.id, error: e.message }); } } return { synced: out }; });

// ---- webhook (Saleshandy -> here, or Saleshandy -> n8n -> here) ----
route('POST', '/webhooks/saleshandy', 'webhook', async (c) => {
  const b = c.body; const events = Array.isArray(b) ? b : Array.isArray(b.events) ? b.events : [b];
  const out = []; for (const e of events) out.push(await P.ingestWebhook({ event: e.event ?? e.event_type ?? e.type, event_id: e.event_id ?? e.id, email: e.email ?? e.prospect_email ?? e.to, sequence_id: e.sequence_id, prospect_id: e.prospect_id, occurred_at: e.occurred_at ?? e.timestamp, subject: e.subject, body: e.body ?? e.reply_body ?? e.message, reply_from: e.reply_from ?? e.from }));
  return { processed: out };
});
// ---- replies ----
route('GET', '/api/replies', 'api', async (c) => q(`select r.*, co.name company from replies r left join prospects p on p.id=r.prospect_id left join companies co on co.id=p.company_id where r.status=$1 order by r.received_at`, [c.url.searchParams.get('status') ?? 'NEW']));
route('POST', '/api/replies/:id/classify', 'api', async (c) => P.classifyReply(c.params.id, { workflowRunId: c.body.workflow_run_id }));
route('POST', '/api/replies/:id/teardown', 'api', async (c) => P.generateTeardown(c.params.id, { workflowRunId: c.body.workflow_run_id, force: !!c.body.force }));
route('POST', '/ui/replies/:id/teardown', 'dashboard', async (c) => { await P.generateTeardown(c.params.id); redirect(c, '/'); });
route('POST', '/ui/replies/:id/done', 'dashboard', async (c) => { await q(`update replies set status='ACTIONED' where id=$1`, [c.params.id]); redirect(c, '/'); });
route('POST', '/api/teardowns/:id/decision', 'api', async (c) => P.decideTeardown(c.params.id, c.body.action, c.actor, c.body.body));
route('POST', '/ui/teardowns/:id/decision', 'dashboard', async (c) => { await P.decideTeardown(c.params.id, c.body.action, c.actor, c.body.body); redirect(c, '/'); });
// ---- meetings / proposals ----
route('POST', '/api/meetings/:id/brief', 'api', async (c) => P.meetingBrief(c.params.id, { workflowRunId: c.body.workflow_run_id, force: !!c.body.force }));
route('POST', '/api/meetings/:id/post-meeting', 'api', async (c) => P.postMeeting(c.params.id, c.body.notes, { workflowRunId: c.body.workflow_run_id }));
route('POST', '/api/meetings/:id/proposal', 'api', async (c) => P.draftProposal(c.params.id, c.body.business_inputs ?? {}, { workflowRunId: c.body.workflow_run_id }));
route('POST', '/api/proposals/:id/decision', 'api', async (c) => one(`update proposals set status=$2, approver=$3, approved_at=now() where id=$1 returning id,status`, [c.params.id, c.body.action === 'APPROVE' ? 'APPROVED' : 'DECLINED', c.actor]));
// ---- suppression ----
route('POST', '/api/suppression', 'api', async (c) => suppress({ email: c.body.email, domain: c.body.domain, reason: c.body.reason ?? 'manual', source: c.body.source ?? c.actor, actor: c.actor, expires_at: c.body.expires_at }));
route('GET', '/api/suppression/check', 'api', async (c) => isSuppressed(c.url.searchParams.get('email'), c.url.searchParams.get('domain')));
route('GET', '/api/suppression', 'api', async () => q('select * from suppression_list order by created_at desc limit 500'));
// ---- analytics ----
route('GET', '/api/metrics/campaigns', 'api', async () => P.campaignMetrics());
route('POST', '/api/analytics/weekly', 'api', async (c) => P.weeklyAnalysis({ workflowRunId: c.body.workflow_run_id }));
route('POST', '/api/metrics/daily-snapshot', 'api', async () => { const m = await P.campaignMetrics(); await q(`insert into activities(entity_type,entity_id,action,actor,detail) values('metrics','00000000-0000-0000-0000-000000000000','daily_snapshot','system',$1)`, [{ campaigns: m }]); return { campaigns: m.length }; });
// ---- ops ----
route('GET', '/api/ops/failures', 'api', async () => ({ workflows: await q(`select * from workflow_runs where status='FAILED' order by started_at desc limit 50`), ai_runs: await q(`select id,agent,error,created_at from ai_runs where not valid order by created_at desc limit 50`) }));
route('GET', '/api/ops/saleshandy', 'api', async () => { const sh = saleshandy(); return { mode: sh.mode, accounts: await sh.listEmailAccounts(), sequences: await sh.listSequences() }; });
route('GET', '/api/campaigns', 'api', async () => q('select * from campaigns order by code'));
route('GET', '/api/proof-assets', 'api', async () => q('select * from proof_assets order by label, id'));
