// The outbound pipeline: one function per stage, each idempotent on a prospect id. n8n and the dashboard call these over HTTP.
import { q, one, audit } from './lib/db.ts';
import { runAgent } from './lib/ai.ts';
import { score } from './lib/scoring.ts';
import { scoringConfig, capabilities, capabilityForProblem } from './lib/config.ts';
import { normalizeDomain, emailDomain, firstName } from './lib/normalize.ts';
import { fetchSnapshot, snapshotFromHtml } from './lib/website.ts';
import { isSuppressed, suppress } from './lib/suppression.ts';
import { saleshandy } from './adapters/saleshandy.ts';
import { env } from './lib/env.ts';
import * as A from './agents/index.ts';
import type { SiteSnapshotT } from './agents/research.ts';

export const untag = (t: string) => t.replace(/^\s*(OBSERVED|INFERRED)\s*[:\-–]\s*/i, '').trim() || t;
export class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }
const SENDER = { name: 'Ayush', title: 'Co-founder' };

// ---------- ingest ----------
export type IngestInput = { company: { name: string; website?: string; domain?: string; country?: string; city?: string; industry?: string; vertical?: string; company_size?: string; platform?: string; metadata?: any };
  contact?: { full_name?: string; first_name?: string; last_name?: string; job_title?: string; email?: string; linkedin_url?: string; is_decision_maker?: boolean }; campaign_code?: string; source?: string; owner?: string };
export async function ingest(i: IngestInput, actor = 'system') {
  const domain = normalizeDomain(i.company.domain ?? i.company.website ?? '');
  if (!domain || !domain.includes('.')) throw new HttpError(400, 'company.website or company.domain required');
  const c = i.company; const src = i.source ?? 'manual';
  const company = (await one(`insert into companies(name,domain,website,country,city,industry,vertical,company_size,platform,source,metadata) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    on conflict (domain) do update set name=coalesce(excluded.name,companies.name), website=coalesce(excluded.website,companies.website), country=coalesce(excluded.country,companies.country), city=coalesce(excluded.city,companies.city),
    industry=coalesce(excluded.industry,companies.industry), vertical=coalesce(companies.vertical,excluded.vertical), company_size=coalesce(excluded.company_size,companies.company_size), platform=coalesce(excluded.platform,companies.platform), metadata=companies.metadata||excluded.metadata
    returning *`, [c.name, domain, c.website ?? `https://${domain}`, c.country ?? null, c.city ?? null, c.industry ?? null, c.vertical ?? null, c.company_size ?? null, c.platform ?? null, src, c.metadata ?? {}]))!;
  let contact: any = null;
  if (i.contact?.email || i.contact?.full_name) {
    const ct = i.contact; const full = ct.full_name ?? ([ct.first_name, ct.last_name].filter(Boolean).join(' ') || null);
    const email = ct.email?.trim().toLowerCase() ?? null;
    contact = await one(`insert into contacts(company_id,first_name,last_name,full_name,job_title,email,linkedin_url,is_decision_maker,source) values($1,$2,$3,$4,$5,$6,$7,$8,$9)
      on conflict (company_id,email) do update set full_name=coalesce(excluded.full_name,contacts.full_name), job_title=coalesce(excluded.job_title,contacts.job_title), linkedin_url=coalesce(excluded.linkedin_url,contacts.linkedin_url), is_decision_maker=contacts.is_decision_maker or excluded.is_decision_maker returning *`,
      [company.id, ct.first_name ?? (full ? firstName(full) : null), ct.last_name ?? null, full, ct.job_title ?? null, email, ct.linkedin_url ?? null, ct.is_decision_maker ?? false, src]);
  }
  const campaign = i.campaign_code ? await one('select * from campaigns where code=$1', [i.campaign_code]) : null;
  if (i.campaign_code && !campaign) throw new HttpError(400, `unknown campaign ${i.campaign_code}`);
  const sup = await isSuppressed(contact?.email, domain);
  const prospect = (await one(`insert into prospects(company_id,contact_id,campaign_id,source,owner,suppressed,suppression_reason,status) values($1,$2,$3,$4,$5,$6,$7,$8)
    on conflict (company_id,campaign_id) do update set contact_id=coalesce(prospects.contact_id,excluded.contact_id), owner=coalesce(prospects.owner,excluded.owner) returning *, (xmax=0) as inserted`,
    [company.id, contact?.id ?? null, campaign?.id ?? null, src, i.owner ?? null, sup.suppressed, sup.reason ?? null, sup.suppressed ? 'SUPPRESSED' : 'NEW']))!;
  if (prospect.inserted) await audit('prospect', prospect.id, 'created', actor, { source: src, suppressed: sup.suppressed });
  if (campaign && prospect.inserted) await q(`insert into campaign_memberships(campaign_id,prospect_id,contact_id,status) values($1,$2,$3,$4) on conflict do nothing`, [campaign.id, prospect.id, contact?.id ?? null, sup.suppressed ? 'SUPPRESSED' : 'PENDING']);
  return { prospect, company, contact, campaign, created: !!prospect.inserted };
}

// ---------- loaders ----------
export async function loadProspect(id: string) {
  const p = await one(`select p.*, row_to_json(c.*) as company, row_to_json(ct.*) as contact, row_to_json(ca.*) as campaign from prospects p join companies c on c.id=p.company_id
    left join contacts ct on ct.id=p.contact_id left join campaigns ca on ca.id=p.campaign_id where p.id=$1`, [id]);
  if (!p) throw new HttpError(404, 'prospect not found');
  return p;
}
const latestResearch = async (companyId: string, kind: string) => (await one('select data, ai_run_id from research where company_id=$1 and kind=$2 order by created_at desc limit 1', [companyId, kind]))?.data ?? null;
async function saveResearch(companyId: string, prospectId: string, kind: string, data: any, runId: string, confidence?: number) {
  await q('insert into research(company_id,prospect_id,kind,data,confidence,ai_run_id,input_hash) values($1,$2,$3,$4,$5,$6,$7)', [companyId, prospectId, kind, data, confidence ?? null, runId, runId]);
}
const companyCtx = (c: any) => ({ name: c.name, domain: c.domain, website: c.website ?? undefined, country: c.country ?? undefined, city: c.city ?? undefined, industry: c.industry ?? undefined, vertical: c.vertical ?? undefined, company_size: c.company_size ?? undefined, platform: c.platform ?? undefined, metadata: c.metadata ?? {} });
const campaignCtx = (ca: any) => ca ? { code: ca.code, service_domain: ca.service_domain, vertical: ca.vertical, problem: ca.problem, offer: ca.offer, sender: ca.sender, config: ca.config ?? {}, compliance: ca.compliance ?? {} } : null;
const requireCampaign = (p: any) => { const c = campaignCtx(p.campaign); if (!c) throw new HttpError(409, 'prospect has no campaign'); return c; };
const proofAssets = async () => q(`select id,title,label,text,domains,problems,verticals,notes from proof_assets where label <> 'PRIVATE'`);
const guard = (p: any) => { if (p.suppressed) throw new HttpError(409, 'prospect is suppressed'); };
// Every stage change goes through here. Before any email is approved a company can move freely (research, score,
// reject, re-draft). After that it only moves forward, so re-running research or drafting a follow-up never pulls a
// company that has replied or is in a deal back to the start. Closing (LOST) and suppression are the exceptions.
const EARLY = ['NEW','QUALIFYING','RESEARCHING','RESEARCH_FURTHER','QUALIFIED','EMAIL_DRAFTED','PENDING_APPROVAL','REJECTED','LOST'];
const FORWARD = ['APPROVED','SYNCED','CONTACTED','REPLIED','MEETING','PROPOSAL','WON'];
export const setStatus = (id: string, status: string, opts: { close?: boolean } = {}) =>
  opts.close ? q('update prospects set status=$2 where id=$1 and status <> \'SUPPRESSED\'', [id, status])
  : FORWARD.includes(status)
    ? q(`update prospects set status=$2 where id=$1 and (status = any($3) or array_position($4::text[], status) < array_position($4::text[], $2))`, [id, status, EARLY, FORWARD])
    : q(`update prospects set status=$2 where id=$1 and status = any($3)`, [id, status, EARLY]);

// ---------- 03 research ----------
export async function research(prospectId: string, opts: { workflowRunId?: string; force?: boolean; html?: string } = {}) {
  const p = await loadProspect(prospectId); guard(p);
  await setStatus(p.id, 'RESEARCHING');
  // reuse a snapshot discovery already took (same page, minutes ago) unless forced; otherwise fetch
  const site: SiteSnapshotT = opts.html ? snapshotFromHtml(p.company.website ?? p.company.domain, opts.html) : p.company.metadata?.site_snapshot?.fetched && !opts.force ? p.company.metadata.site_snapshot : await fetchSnapshot(p.company.website ?? p.company.domain);
  await q(`update companies set metadata = metadata || $2 where id=$1`, [p.company.id, { site_snapshot: site, platform_detected: site.platform_signals?.[0] ?? null }]);
  if (!p.company.platform && site.platform_signals?.[0]) await q('update companies set platform=$2 where id=$1', [p.company.id, site.platform_signals[0]]);
  const r = await runAgent(A.accountResearch, { company: companyCtx(p.company), site }, opts);
  await saveResearch(p.company.id, p.id, 'ACCOUNT', r.output, r.runId, r.output.confidence);
  await audit('prospect', p.id, 'researched', 'system', { runId: r.runId, cached: r.cached, site_fetched: site.fetched });
  return { research: r.output, site, runId: r.runId, cached: r.cached };
}
// ---------- 04 website ----------
export async function analyzeWebsite(prospectId: string, opts: { workflowRunId?: string; force?: boolean } = {}) {
  const p = await loadProspect(prospectId); guard(p);
  const site: SiteSnapshotT = p.company.metadata?.site_snapshot ?? { fetched: false, error: 'research not run' };
  const r = await runAgent(A.websiteAnalysis, { company: companyCtx(p.company), site, campaign_problem: p.campaign?.problem }, opts);
  await saveResearch(p.company.id, p.id, 'WEBSITE', r.output, r.runId, r.output.confidence);
  return { website: r.output, runId: r.runId, cached: r.cached };
}
// ---------- decision maker ----------
export async function identifyDecisionMaker(prospectId: string, opts: { workflowRunId?: string } = {}) {
  const p = await loadProspect(prospectId); guard(p);
  const contacts = await q('select full_name, job_title, email, linkedin_url, id from contacts where company_id=$1 order by created_at', [p.company.id]);
  const r = await runAgent(A.decisionMaker, { company: companyCtx(p.company), campaign: requireCampaign(p), known_contacts: contacts.map(({ id, ...c }) => c) }, opts);
  if (r.output.best_known_contact_index != null && contacts[r.output.best_known_contact_index]) {
    const c = contacts[r.output.best_known_contact_index];
    await q('update contacts set is_decision_maker=true where id=$1', [c.id]);
    if (!p.contact_id) await q('update prospects set contact_id=$2 where id=$1', [p.id, c.id]);
  }
  await saveResearch(p.company.id, p.id, 'DECISION_MAKER', r.output, r.runId, r.output.confidence);
  return { decision_maker: r.output, runId: r.runId };
}
// ---------- 05 problem + capability ----------
export async function identifyProblem(prospectId: string, opts: { workflowRunId?: string; force?: boolean } = {}) {
  const p = await loadProspect(prospectId); guard(p);
  const researchData = await latestResearch(p.company.id, 'ACCOUNT'); if (!researchData) throw new HttpError(409, 'run research first');
  const website = await latestResearch(p.company.id, 'WEBSITE');
  const campaign = requireCampaign(p);
  const pr = await runAgent(A.problemDetection, { company: companyCtx(p.company), research: researchData, website, campaign }, opts);
  // The evidence tags are for us, not for the email: a model sometimes writes them into the sentence itself.
  for (const k of ['specific_observation', 'business_consequence', 'problem_angle', 'trigger'] as const) pr.output[k] = untag(pr.output[k]);
  await saveResearch(p.company.id, p.id, 'PROBLEM', pr.output, pr.runId, pr.output.confidence);
  const cap = await runAgent(A.capabilityMatching, { problem: pr.output, campaign, capabilities: capabilities(), proof_assets: await proofAssets() }, opts);
  // Server-side proof guard: only VERIFIED ids survive regardless of what the model said.
  const verified = new Set((await q(`select id from proof_assets where label='VERIFIED'`)).map((r) => r.id));
  cap.output.proof_ids = cap.output.proof_ids.filter((id) => verified.has(id));
  if (cap.output.domain === 'UNKNOWN') cap.output.domain = capabilityForProblem(pr.output.primary_problem) as any;
  await saveResearch(p.company.id, p.id, 'CAPABILITY', cap.output, cap.runId, cap.output.confidence);
  await q(`update prospects set primary_problem=$2, secondary_problems=$3, problem_angle=$4, specific_observation=$5, business_consequence=$6, trigger_event=$7, problem_score=$8, commercial_score=$9, relevant_capability=$10, relevant_proof_ids=$11 where id=$1`,
    [p.id, pr.output.primary_problem, pr.output.secondary_problems, pr.output.problem_angle, pr.output.specific_observation, pr.output.business_consequence, pr.output.trigger, pr.output.problem_score, pr.output.commercial_score, cap.output.domain, cap.output.proof_ids]);
  return { problem: pr.output, capability: cap.output, runIds: [pr.runId, cap.runId] };
}
// ---------- 02 qualify (deterministic engine over agent sub-scores) ----------
export async function qualify(prospectId: string, opts: { workflowRunId?: string; force?: boolean } = {}) {
  const p = await loadProspect(prospectId); guard(p);
  await setStatus(p.id, 'QUALIFYING');
  const cfg = scoringConfig();
  const r = await runAgent(A.qualification, { company: companyCtx(p.company), campaign: requireCampaign(p), research: await latestResearch(p.company.id, 'ACCOUNT'), website: await latestResearch(p.company.id, 'WEBSITE'),
    has_decision_maker: !!p.contact?.is_decision_maker || !!p.contact?.job_title, has_relevant_proof: (p.relevant_proof_ids ?? []).length > 0, criteria: cfg.criteria }, opts);
  const s = score(r.output.scores);
  await q('update prospects set account_score=$2, score_breakdown=$3 where id=$1', [p.id, s.total, { ...s.breakdown, rationale: r.output.rationale, red_flags: r.output.red_flags, thresholds: cfg.thresholds }]);
  await setStatus(p.id, s.verdict);
  await audit('prospect', p.id, 'qualified', 'system', { total: s.total, verdict: s.verdict, runId: r.runId });
  return { score: s.total, breakdown: s.breakdown, verdict: s.verdict, runId: r.runId };
}
// ---------- 06 email ----------
export async function generateEmail(prospectId: string, opts: { workflowRunId?: string; force?: boolean } = {}) {
  const p = await loadProspect(prospectId); guard(p);
  if (!p.contact) throw new HttpError(409, 'prospect has no contact');
  if (!p.contact.full_name && !p.contact.first_name) throw new HttpError(409, 'contact has no name; identify the decision maker before drafting');
  if (!['QUALIFIED', 'EMAIL_DRAFTED', 'PENDING_APPROVAL', 'RESEARCH_FURTHER'].includes(p.status) && !opts.force) throw new HttpError(409, `prospect status ${p.status} is not QUALIFIED`);
  const problem = await latestResearch(p.company.id, 'PROBLEM'), capability = await latestResearch(p.company.id, 'CAPABILITY');
  if (!problem || !capability) throw new HttpError(409, 'run identify-problem first');
  const campaign = requireCampaign(p);
  const r = await runAgent(A.emailGeneration, { company: companyCtx(p.company), contact: { full_name: p.contact.full_name, job_title: p.contact.job_title }, campaign, problem, capability, proof_assets: await proofAssets(), sender_name: SENDER.name, sender_title: SENDER.title }, opts);
  const maxWords = campaign.config?.max_words ?? 130;
  if (r.output.word_count > maxWords * 1.3) throw new HttpError(422, `draft too long (${r.output.word_count} words)`);
  const existing = await one(`select id from email_drafts where prospect_id=$1 and status='PENDING_APPROVAL' and step=1`, [p.id]);
  if (existing && !opts.force) return { draft_id: existing.id, reused: true };
  const d = (await one('insert into email_drafts(prospect_id,campaign_id,step,subject_original,body_original,ai_run_id) values($1,$2,1,$3,$4,$5) returning id', [p.id, p.campaign_id, r.output.subject, r.output.body, r.runId]))!;
  // a new draft never moves a company backwards: one already contacted, replied or in a deal keeps its stage
  await setStatus(p.id, 'PENDING_APPROVAL');
  await audit('email_draft', d.id, 'drafted', 'system', { runId: r.runId, proof_ids_used: r.output.proof_ids_used });
  return { draft_id: d.id, subject: r.output.subject, body: r.output.body, runId: r.runId };
}
// ---------- 07 approval gate ----------
export async function decideDraft(draftId: string, action: 'APPROVE' | 'EDIT' | 'REJECT' | 'RESEARCH_MORE', actor: string, edit?: { subject?: string; body?: string; reason?: string }) {
  const d = await one('select * from email_drafts where id=$1', [draftId]); if (!d) throw new HttpError(404, 'draft not found');
  if (d.status !== 'PENDING_APPROVAL') throw new HttpError(409, `draft is ${d.status}`);
  if (action === 'APPROVE' || action === 'EDIT') {
    const subject = edit?.subject ?? d.subject_original, body = edit?.body ?? d.body_original;
    if (!body.trim()) throw new HttpError(400, 'empty body');
    await q(`update email_drafts set status='APPROVED', subject_final=$2, body_final=$3, approver=$4, approved_at=now() where id=$1`, [d.id, subject, body, actor]);
    await setStatus(d.prospect_id, 'APPROVED');
  } else if (action === 'REJECT') {
    await q(`update email_drafts set status='REJECTED', approver=$2, approved_at=now(), rejection_reason=$3 where id=$1`, [d.id, actor, edit?.reason ?? null]);
    await setStatus(d.prospect_id, 'LOST');
  } else {
    await q(`update email_drafts set status='RESEARCH_MORE', approver=$2, approved_at=now(), rejection_reason=$3 where id=$1`, [d.id, actor, edit?.reason ?? null]);
    await setStatus(d.prospect_id, 'RESEARCH_FURTHER');
  }
  await audit('email_draft', d.id, action.toLowerCase(), actor, { edited: action === 'EDIT', reason: edit?.reason ?? null });
  return { draft_id: d.id, status: action === 'APPROVE' || action === 'EDIT' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'RESEARCH_MORE' };
}
// ---------- 08 sync approved drafts to Saleshandy ----------
export async function syncToSaleshandy(draftId: string) {
  const d = await one(`select d.*, p.contact_id, p.suppressed, p.company_id from email_drafts d join prospects p on p.id=d.prospect_id where d.id=$1`, [draftId]);
  if (!d) throw new HttpError(404, 'draft not found');
  if (d.status === 'SENT_TO_SEQUENCER') return { already: true, draft_id: d.id };
  if (d.status !== 'APPROVED') throw new HttpError(409, `only APPROVED drafts sync (draft is ${d.status})`);
  const p = await loadProspect(d.prospect_id); if (!p.contact?.email) throw new HttpError(409, 'contact has no email');
  if (p.campaign?.config?.delivery === 'manual') throw new HttpError(409, 'campaign delivery is manual: copy the approved draft and send it from your own account');
  const sup = await isSuppressed(p.contact.email, p.company.domain); if (p.suppressed || sup.suppressed) throw new HttpError(409, 'suppressed; refusing to sync');
  if (!['VALID', 'CATCH_ALL', 'UNVERIFIED'].includes(p.contact.email_verification_status)) throw new HttpError(409, `email verification is ${p.contact.email_verification_status}`);
  let seqId = p.campaign?.sequence_ref as string | null;
  let r: { prospect_id: string | null }; let mode: string;
  if (env.saleshandyMode === 'real') {
    // live: through the write gateway, as the system, with every guard; a sequence is never created here (that needs an admin)
    if (!seqId) throw new HttpError(409, `Campaign ${p.campaign.code} has no Saleshandy sequence yet. Create it in Saleshandy or from Outreach, then set its id on the campaign.`);
    const { execute } = await import('./saleshandy/gateway.ts');
    const out = await execute({ kind: 'system' }, 'sequence.import_prospects', { sequenceId: seqId, prospects: [{ email: p.contact.email, firstName: p.contact.first_name ?? firstName(p.contact.full_name) ?? undefined, lastName: p.contact.last_name ?? undefined,
      company: p.company.name, jobTitle: p.contact.job_title ?? undefined, website: p.company.website ?? undefined, custom: { subject_1: d.subject_final, body_1: d.body_final } }] }, `draft-sync:${d.id}`);
    if (out.outcome !== 'sent') throw new HttpError(out.outcome === 'failed' ? 502 : 409, `Not sent to Saleshandy: ${out.reason ?? out.outcome}`);
    r = { prospect_id: null }; mode = 'real'; // the import answers with a request id; the prospect id arrives with the next sync
  } else {
    const sh = saleshandy(); mode = sh.mode;
    if (!seqId) { const s = await sh.createSequence(p.campaign.code); seqId = s.id; await q('update campaigns set sequence_ref=$2 where id=$1', [p.campaign.id, seqId]); }
    r = await sh.addProspectToSequence(seqId!, { email: p.contact.email, first_name: p.contact.first_name ?? firstName(p.contact.full_name), last_name: p.contact.last_name ?? undefined, company: p.company.name, job_title: p.contact.job_title ?? undefined, website: p.company.website ?? undefined }, { subject: d.subject_final, body: d.body_final });
  }
  await q(`update email_drafts set status='SENT_TO_SEQUENCER' where id=$1`, [d.id]);
  await q(`update campaign_memberships set status='ACTIVE', saleshandy_prospect_id=$3, saleshandy_sequence_id=$4, synced_at=now() where prospect_id=$1 and campaign_id=$2`, [p.id, p.campaign.id, r.prospect_id, seqId]);
  if (r.prospect_id) { await q(`update contacts set external_ref=$2 where id=$1`, [p.contact.id, r.prospect_id]); await q(`update prospects set external_ref=$2 where id=$1`, [p.id, r.prospect_id]); }
  await setStatus(p.id, 'SYNCED');
  await audit('email_draft', d.id, 'synced', 'system', { mode, sequence: seqId, sh_prospect: r.prospect_id });
  return { draft_id: d.id, sequence_id: seqId, saleshandy_prospect_id: r.prospect_id, mode };
}
// ---------- 09 webhook ingestion ----------
export type WebhookEvent = { event: string; event_id?: string; email: string; sequence_id?: string; prospect_id?: string; occurred_at?: string; subject?: string; body?: string; reply_from?: string; raw?: any };
const EVENT_MAP: Record<string, string> = { sent: 'SENT', email_sent: 'SENT', delivered: 'DELIVERED', opened: 'OPENED', email_opened: 'OPENED', clicked: 'CLICKED', link_clicked: 'CLICKED', bounced: 'BOUNCED', email_bounced: 'BOUNCED', replied: 'REPLIED', email_replied: 'REPLIED', unsubscribed: 'UNSUBSCRIBED', unsubscribe: 'UNSUBSCRIBED', failed: 'FAILED' };
export async function ingestWebhook(ev: WebhookEvent) {
  const type = EVENT_MAP[ev.event.toLowerCase()]; if (!type) throw new HttpError(400, `unknown event ${ev.event}`);
  const email = ev.email.trim().toLowerCase();
  const ctx = await one(`select ct.id as contact_id, p.id as prospect_id, p.campaign_id from contacts ct left join prospects p on p.contact_id=ct.id and p.status not in ('LOST') where ct.email=$1 order by p.updated_at desc nulls last limit 1`, [email]);
  const eventId = ev.event_id ?? `${type}:${email}:${ev.occurred_at ?? ''}:${(ev.body ?? '').length}`;
  const row = await one(`insert into email_events(prospect_id,contact_id,campaign_id,event_type,provider_event_id,occurred_at,payload) values($1,$2,$3,$4,$5,coalesce($6::timestamptz, now()),$7) on conflict (provider,provider_event_id) do nothing returning id`,
    [ctx?.prospect_id ?? null, ctx?.contact_id ?? null, ctx?.campaign_id ?? null, type, eventId, ev.occurred_at ?? null, { ...ev, body: undefined, raw: undefined }]);
  if (!row) return { duplicate: true, event_type: type };
  let reply_id: string | undefined;
  if (type === 'REPLIED') {
    const r = await one('insert into replies(prospect_id,contact_id,campaign_id,email_event_id,from_email,subject,body,received_at) values($1,$2,$3,$4,$5,$6,$7,coalesce($8::timestamptz,now())) returning id', [ctx?.prospect_id ?? null, ctx?.contact_id ?? null, ctx?.campaign_id ?? null, row.id, ev.reply_from ?? email, ev.subject ?? null, ev.body ?? '', ev.occurred_at ?? null]);
    reply_id = r!.id;
    if (ctx?.prospect_id) { await q(`update prospects set status='REPLIED', last_contacted_at=coalesce(last_contacted_at, now()) where id=$1 and status in ('SYNCED','CONTACTED','APPROVED')`, [ctx.prospect_id]); }
  }
  if (type === 'SENT' && ctx?.prospect_id) await q(`update prospects set status='CONTACTED', last_contacted_at=now() where id=$1 and status='SYNCED'`, [ctx.prospect_id]);
  if (type === 'UNSUBSCRIBED') await suppress({ email, reason: 'unsubscribed', source: 'saleshandy_webhook' });
  if (type === 'BOUNCED') { await q(`update contacts set email_verification_status='INVALID' where email=$1`, [email]); await suppress({ email, reason: 'hard bounce', source: 'saleshandy_webhook' }); }
  return { event_id: row.id, event_type: type, reply_id, prospect_id: ctx?.prospect_id ?? null };
}
// ---------- 10 classify reply ----------
export async function classifyReply(replyId: string, opts: { workflowRunId?: string } = {}) {
  const r = await one('select * from replies where id=$1', [replyId]); if (!r) throw new HttpError(404, 'reply not found');
  const p = r.prospect_id ? await loadProspect(r.prospect_id) : null;
  const orig = r.prospect_id ? await one(`select subject_final as subject, body_final as body from email_drafts where prospect_id=$1 and status='SENT_TO_SEQUENCER' order by created_at desc limit 1`, [r.prospect_id]) : null;
  const res = await runAgent(A.replyClassification, { company: p ? companyCtx(p.company) : { name: 'UNKNOWN', domain: emailDomain(r.from_email ?? 'x@unknown.invalid') }, campaign: p ? campaignCtx(p.campaign) : null, original_email: orig ? { subject: orig.subject, body: orig.body } : null, reply: { from_email: r.from_email, subject: r.subject, body: r.body } }, opts);
  const o = res.output;
  await q(`update replies set classification=$2, confidence=$3, recommended_next_action=$4, suggested_reply=$5, priority=$6, owner=$7, status='CLASSIFIED', ai_run_id=$8 where id=$1`, [r.id, o.classification, o.confidence, o.recommended_next_action, o.suggested_reply, o.priority, o.owner, res.runId]);
  if (o.classification === 'UNSUBSCRIBE' && r.from_email) { await suppress({ email: r.from_email, reason: 'reply asked to stop', source: 'reply_classification' }); await q(`update replies set status='ACTIONED' where id=$1`, [r.id]); }
  if (p && ['POSITIVE', 'VALUE_REQUEST', 'PRICE', 'REFERRAL'].includes(o.classification)) {
    await q(`insert into opportunities(prospect_id,company_id,campaign_id,stage,owner) values($1,$2,$3,'REPLIED',$4) on conflict (prospect_id) do nothing`, [p.id, p.company.id, p.campaign_id, o.owner]);
  }
  if (p && o.classification === 'NOT_INTERESTED') await setStatus(p.id, 'LOST', { close: true });
  await audit('reply', r.id, 'classified', 'system', { classification: o.classification, runId: res.runId });
  return { reply_id: r.id, ...o, runId: res.runId };
}
// ---------- 11 teardown ----------
export async function generateTeardown(replyId: string, opts: { workflowRunId?: string; force?: boolean } = {}) {
  const r = await one('select * from replies where id=$1', [replyId]); if (!r?.prospect_id) throw new HttpError(409, 'reply has no prospect');
  const p = await loadProspect(r.prospect_id); guard(p);
  const existing = await one(`select id from teardowns where reply_id=$1`, [r.id]); if (existing && !opts.force) return { teardown_id: existing.id, reused: true };
  const [problem, website, capability] = await Promise.all([latestResearch(p.company.id, 'PROBLEM'), latestResearch(p.company.id, 'WEBSITE'), latestResearch(p.company.id, 'CAPABILITY')]);
  if (!problem || !capability) throw new HttpError(409, 'no problem research for this prospect');
  const res = await runAgent(A.teardown, { company: companyCtx(p.company), campaign: campaignCtx(p.campaign), problem, website, capability, proof_assets: await proofAssets(), reply_body: r.body, sender_name: SENDER.name }, opts);
  const verified = new Set((await q(`select id from proof_assets where label='VERIFIED'`)).map((x) => x.id));
  const proof_ids = res.output.proof_ids.filter((id) => verified.has(id));
  const t = (await one('insert into teardowns(prospect_id,reply_id,findings,capability,proof_ids,body_original,ai_run_id) values($1,$2,$3,$4,$5,$6,$7) returning id', [p.id, r.id, JSON.stringify(res.output.findings), res.output.capability, proof_ids, res.output.body, res.runId]))!;
  await audit('teardown', t.id, 'drafted', 'system', { runId: res.runId });
  return { teardown_id: t.id, ...res.output, proof_ids };
}
export async function decideTeardown(id: string, action: 'APPROVE' | 'EDIT' | 'REJECT', actor: string, body?: string) {
  const t = await one('select * from teardowns where id=$1', [id]); if (!t) throw new HttpError(404, 'teardown not found');
  if (t.status !== 'PENDING_APPROVAL') throw new HttpError(409, `teardown is ${t.status}`);
  const status = action === 'REJECT' ? 'REJECTED' : 'APPROVED';
  await q('update teardowns set status=$2, body_final=$3, approver=$4, approved_at=now() where id=$1', [id, status, action === 'REJECT' ? null : (body ?? t.body_original), actor]);
  if (status === 'APPROVED') await q(`update replies set status='ACTIONED' where id=$1`, [t.reply_id]);
  await audit('teardown', id, action.toLowerCase(), actor);
  return { teardown_id: id, status };
}
// ---------- 12 meeting brief ----------
export async function createMeeting(prospectId: string, scheduled_at?: string) {
  const p = await loadProspect(prospectId);
  const opp = (await one(`insert into opportunities(prospect_id,company_id,campaign_id,stage,owner) values($1,$2,$3,'MEETING_BOOKED',$4) on conflict (prospect_id) do nothing returning id`, [p.id, p.company.id, p.campaign_id, p.owner])) ?? (await one('select id from opportunities where prospect_id=$1', [p.id]))!;
  await q(`update opportunities set stage='MEETING_BOOKED' where id=$1 and stage='REPLIED'`, [opp.id]);
  const m = (await one('insert into meetings(opportunity_id,scheduled_at) values($1,$2) returning id', [opp.id, scheduled_at ?? null]))!;
  await setStatus(p.id, 'MEETING');
  return { meeting_id: m.id, opportunity_id: opp.id };
}
export async function meetingBrief(meetingId: string, opts: { workflowRunId?: string; force?: boolean } = {}) {
  const m = await one('select m.*, o.prospect_id from meetings m join opportunities o on o.id=m.opportunity_id where m.id=$1', [meetingId]); if (!m) throw new HttpError(404, 'meeting not found');
  const p = await loadProspect(m.prospect_id);
  const thread = [
    ...(await q(`select 'OUT' as direction, body_final as body from email_drafts where prospect_id=$1 and status='SENT_TO_SEQUENCER'`, [p.id])),
    ...(await q(`select 'IN' as direction, body from replies where prospect_id=$1 order by received_at`, [p.id])),
    ...(await q(`select 'OUT' as direction, coalesce(body_final, body_original) as body from teardowns where prospect_id=$1 and status='APPROVED'`, [p.id])),
  ];
  const res = await runAgent(A.meetingIntelligence, { company: companyCtx(p.company), research: await latestResearch(p.company.id, 'ACCOUNT'), problem: await latestResearch(p.company.id, 'PROBLEM'), capability: await latestResearch(p.company.id, 'CAPABILITY'), proof_assets: await proofAssets(), reply_thread: thread }, opts);
  await q('update meetings set brief=$2, brief_ai_run_id=$3 where id=$1', [m.id, res.output, res.runId]);
  return { meeting_id: m.id, brief: res.output, runId: res.runId };
}
// ---------- 13 post meeting ----------
export async function postMeeting(meetingId: string, notes: string, opts: { workflowRunId?: string } = {}) {
  const m = await one('select m.*, o.prospect_id from meetings m join opportunities o on o.id=m.opportunity_id where m.id=$1', [meetingId]); if (!m) throw new HttpError(404, 'meeting not found');
  const p = await loadProspect(m.prospect_id);
  const res = await runAgent(A.postMeeting, { company: companyCtx(p.company), brief: m.brief, notes }, opts);
  await q('update meetings set notes=$2, analysis=$3, analysis_ai_run_id=$4, held=true where id=$1', [m.id, notes, res.output, res.runId]);
  await q(`update opportunities set stage=$2 where id=$1 and stage in ('REPLIED','MEETING_BOOKED')`, [m.opportunity_id, res.output.crm_update.stage === 'LOST' ? 'LOST' : 'MEETING_HELD']);
  await audit('meeting', m.id, 'analysed', 'system', { runId: res.runId });
  return { meeting_id: m.id, analysis: res.output, runId: res.runId };
}
// ---------- 14 proposal ----------
export async function draftProposal(meetingId: string, business_inputs: { price_paise?: number | null; deadline?: string | null; guarantees?: string[]; deliverables?: string[]; sla?: string | null } = {}, opts: { workflowRunId?: string } = {}) {
  const m = await one('select m.*, o.prospect_id from meetings m join opportunities o on o.id=m.opportunity_id where m.id=$1', [meetingId]); if (!m) throw new HttpError(404, 'meeting not found');
  if (!m.analysis) throw new HttpError(409, 'run post-meeting analysis first');
  if (business_inputs.price_paise != null && !Number.isInteger(business_inputs.price_paise)) throw new HttpError(400, 'price_paise must be an integer');
  const p = await loadProspect(m.prospect_id);
  const bi = { price_paise: business_inputs.price_paise ?? null, deadline: business_inputs.deadline ?? null, guarantees: business_inputs.guarantees ?? [], deliverables: business_inputs.deliverables ?? [], sla: business_inputs.sla ?? null };
  const res = await runAgent(A.proposalDraft, { company: companyCtx(p.company), analysis: m.analysis, capability: await latestResearch(p.company.id, 'CAPABILITY'), proof_assets: await proofAssets(), business_inputs: bi }, opts);
  const pr = (await one('insert into proposals(opportunity_id,meeting_id,draft,business_inputs,ai_run_id) values($1,$2,$3,$4,$5) returning id', [m.opportunity_id, m.id, res.output, bi, res.runId]))!;
  await setStatus(p.id, 'PROPOSAL');
  return { proposal_id: pr.id, draft: res.output, runId: res.runId };
}
// ---------- 15 metrics ----------
export async function campaignMetrics() {
  const rows = await q(`
    with ev as (select campaign_id, event_type, count(*) n from email_events group by 1,2),
    agg as (select c.id, c.code, c.vertical, c.problem, c.offer, c.sender,
      (select count(*) from prospects p where p.campaign_id=c.id) accounts_found,
      (select count(*) from prospects p where p.campaign_id=c.id and p.status not in ('NEW','QUALIFYING','REJECTED','RESEARCH_FURTHER','RESEARCHING')) accounts_qualified,
      (select count(*) from prospects p where p.campaign_id=c.id and p.contact_id is not null) contacts_found,
      (select count(*) from prospects p join contacts ct on ct.id=p.contact_id where p.campaign_id=c.id and ct.email_verification_status='VALID') emails_verified,
      (select count(distinct e.prospect_id) from email_events e where e.campaign_id=c.id and e.event_type='SENT') emails_sent,
      coalesce((select n from ev where ev.campaign_id=c.id and event_type='DELIVERED'),0) delivered,
      coalesce((select n from ev where ev.campaign_id=c.id and event_type='BOUNCED'),0) bounced,
      (select count(distinct coalesce(r.prospect_id::text, r.from_email::text)) from replies r where r.campaign_id=c.id) replies,
      (select count(distinct coalesce(r.prospect_id::text, r.from_email::text)) from replies r where r.campaign_id=c.id and r.classification in ('POSITIVE','VALUE_REQUEST','PRICE','REFERRAL')) positive_replies,
      (select count(*) from meetings m join opportunities o on o.id=m.opportunity_id where o.campaign_id=c.id) meetings_booked,
      (select count(*) from meetings m join opportunities o on o.id=m.opportunity_id where o.campaign_id=c.id and m.held) meetings_held,
      (select count(*) from proposals pr join opportunities o on o.id=pr.opportunity_id where o.campaign_id=c.id) proposals,
      (select count(*) from opportunities o where o.campaign_id=c.id and o.stage='WON') wins,
      coalesce((select sum(d.revenue_paise) from deals d join opportunities o on o.id=d.opportunity_id where o.campaign_id=c.id),0) revenue_paise,
      coalesce((select sum(d.gross_profit_paise) from deals d join opportunities o on o.id=d.opportunity_id where o.campaign_id=c.id),0) gross_profit_paise,
      coalesce((select sum(d.cost_paise) from deals d join opportunities o on o.id=d.opportunity_id where o.campaign_id=c.id),0) costs_paise
      from campaigns c)
    select * from agg order by code`);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 10000) / 100 : null);
  return rows.map((r) => { const n = (k: string) => Number(r[k]); return { ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v])),
    qualification_rate: pct(n('accounts_qualified'), n('accounts_found')), verification_rate: pct(n('emails_verified'), n('contacts_found')), bounce_rate: pct(n('bounced'), n('emails_sent')), reply_rate: pct(n('replies'), n('emails_sent')),
    positive_reply_rate: pct(n('positive_replies'), n('emails_sent')), meeting_rate: pct(n('meetings_booked'), n('positive_replies')), proposal_rate: pct(n('proposals'), n('meetings_held')), close_rate: pct(n('wins'), n('proposals')),
    revenue_per_1000_prospects_paise: n('accounts_found') ? Math.round((n('revenue_paise') * 1000) / n('accounts_found')) : null, gross_profit_per_1000_prospects_paise: n('accounts_found') ? Math.round((n('gross_profit_paise') * 1000) / n('accounts_found')) : null,
    cost_per_meeting_paise: n('meetings_held') ? Math.round(n('costs_paise') / n('meetings_held')) : null, cost_per_client_paise: n('wins') ? Math.round(n('costs_paise') / n('wins')) : null }; });
}
// ---------- 16 weekly analysis (recommendations only) ----------
export async function weeklyAnalysis(opts: { workflowRunId?: string } = {}) {
  const m = await campaignMetrics();
  const res = await runAgent(A.campaignAnalytics, { period: new Date().toISOString().slice(0, 10), campaigns: m.map((c: any) => ({ code: c.code, vertical: c.vertical, problem: c.problem, offer: c.offer, sender: c.sender, metrics: Object.fromEntries(Object.entries(c).filter(([, v]) => typeof v === 'number')) as Record<string, number> })) }, { ...opts, force: true });
  await audit('campaign', '00000000-0000-0000-0000-000000000000', 'weekly_analysis', 'system', { runId: res.runId, recommendations: res.output.recommendations });
  return { ...res.output, runId: res.runId };
}
// ---------- convenience: run the pre-approval chain ----------
// ---------------- people finder (Claude web search) ----------------
// Adds the people Claude found with sources; the best match becomes the person we write to if there is none yet.
// Emails from the web are marked UNKNOWN, which the Saleshandy sync refuses until a verifier says otherwise.
export async function findPeopleOnWeb(prospectId: string, opts: { workflowRunId?: string; force?: boolean } = {}) {
  const p = await loadProspect(prospectId); guard(p);
  if (env.aiProvider !== 'anthropic') throw new HttpError(409, 'Finding people on the web needs Claude (AI_PROVIDER=anthropic).');
  const campaign = requireCampaign(p);
  const r = await runAgent(A.findPeople, { company: companyCtx(p.company), campaign, buyer_titles: p.campaign?.buyer_titles ?? [], public_emails: p.company.metadata?.public_emails ?? [] }, opts);
  await saveResearch(p.company.id, p.id, 'PEOPLE', r.output, r.runId, r.output.people[0]?.confidence ?? 0);
  const added: string[] = [];
  for (const person of r.output.people) {
    const email = person.email && person.email_source_url ? person.email.toLowerCase() : null;
    if (email && (await isSuppressed(email, p.company.domain)).suppressed) continue;
    const exists = await one(`select id from contacts where company_id=$1 and (lower(full_name)=lower($2) or ($3::citext is not null and email=$3))`, [p.company.id, person.full_name, email]);
    if (exists) { added.push(exists.id); continue; }
    const parts = person.full_name.trim().split(/\s+/);
    const ct = await one(`insert into contacts(company_id,first_name,last_name,full_name,job_title,email,email_verification_status,linkedin_url,is_decision_maker,source)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,'claude_web_search') on conflict do nothing returning id`,
      [p.company.id, parts[0], parts.slice(1).join(' ') || null, person.full_name.trim(), person.job_title, email, email ? 'UNKNOWN' : 'UNVERIFIED', person.linkedin_url, added.length === 0]);
    if (ct) added.push(ct.id);
  }
  const named = p.contact && (p.contact.full_name || p.contact.first_name);
  if (!named && added[0]) await q('update prospects set contact_id=$2 where id=$1', [p.id, added[0]]);
  await audit('prospect', p.id, 'people_found', 'system', { found: r.output.people.length, added: added.length, runId: r.runId });
  return { found: r.output.people.length, contact_ids: added, notes: r.output.notes, runId: r.runId };
}

export async function runChain(prospectId: string, opts: { html?: string; workflowRunId?: string } = {}) {
  const out: any = {};
  out.research = await research(prospectId, opts); out.website = await analyzeWebsite(prospectId, opts);
  try { out.decision_maker = await identifyDecisionMaker(prospectId, opts); } catch (e: any) { out.decision_maker = { skipped: e.message }; }
  out.problem = await identifyProblem(prospectId, opts); out.qualify = await qualify(prospectId, opts);
  if (out.qualify.verdict === 'QUALIFIED') { try { out.email = await generateEmail(prospectId, opts); } catch (e: any) { if (e instanceof HttpError && e.status === 409) out.email = { skipped: e.message }; else throw e; } }
  return out;
}
