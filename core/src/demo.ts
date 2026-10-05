// End-to-end demo with a synthetic company. Never sends email: AI provider and Saleshandy are whatever .env says (mock by default).
import { pool, q } from './lib/db.ts';
import { readFileSync } from 'node:fs';
import * as P from './pipeline.ts';
import { saleshandy } from './adapters/saleshandy.ts';
export async function demo(quiet = false) {
  const say = (s: string, o?: unknown) => !quiet && console.log(`\n== ${s}`, o === undefined ? '' : JSON.stringify(o, null, 1).slice(0, 900));
  const run = Date.now().toString(36);
  const html = readFileSync(new URL('../fixtures/demo-electronics.html', import.meta.url), 'utf8');
  const ing = await P.ingest({ company: { name: 'Demo Electronics India', website: 'https://demo-electronics.example', country: 'IN', city: 'Bengaluru', industry: 'Consumer electronics', vertical: 'DTC ecommerce: electronics', company_size: '20-50' },
    contact: { full_name: 'Priya Nair', job_title: 'Founder & CEO', email: 'priya@demo-electronics.example', is_decision_maker: true }, campaign_code: 'IND-WEB-ELECTRONICS', source: 'demo', owner: 'ayush' }, 'demo');
  const pid = ing.prospect.id;
  // The demo company is synthetic, so each run starts it from the beginning. Real companies only ever move forward.
  await q(`update prospects set status='NEW', suppressed=false, suppression_reason=null where id=$1`, [pid]);
  say('1 company + prospect created', { prospect_id: pid, created: ing.created });
  const r = await P.research(pid, { html }); say('2 research', { fetched: r.site.fetched, platform: r.site.platform_signals, summary: r.research.company_summary, confidence: r.research.confidence });
  const w = await P.analyzeWebsite(pid); say('3 website analysis', w.website.findings.map((f) => `${f.dimension}: ${f.observation}`));
  const dm = await P.identifyDecisionMaker(pid); say('4 decision maker', dm.decision_maker);
  const pr = await P.identifyProblem(pid); say('5 problem + capability', { primary: pr.problem.primary_problem, observation: pr.problem.specific_observation, capability: pr.capability.domain, proof_ids: pr.capability.proof_ids });
  const qf = await P.qualify(pid); say('6 qualification', qf);
  if (qf.verdict !== 'QUALIFIED') throw new Error(`demo prospect not qualified: ${qf.verdict} ${qf.score}`);
  const em = await P.generateEmail(pid); say('7 email draft (PENDING_APPROVAL)', { subject: em.subject, body: em.body });
  const dec = await P.decideDraft(em.draft_id!, 'APPROVE', 'ayush'); say('8 human approval', dec);
  const sync = await P.syncToSaleshandy(em.draft_id!); say('9 synced to Saleshandy', sync);
  await P.ingestWebhook({ event: 'sent', event_id: `demo-sent-${run}`, email: 'priya@demo-electronics.example' });
  const wh = await P.ingestWebhook({ event: 'replied', event_id: `demo-reply-${run}`, email: 'priya@demo-electronics.example', subject: 'Re: demo electronics india on mobile', body: 'Hi Ayush, sure, send them over. Curious what you noticed on mobile.' });
  say('10 simulated reply webhook', wh);
  const cl = await P.classifyReply(wh.reply_id!); say('11 reply classification', { classification: cl.classification, next: cl.recommended_next_action, priority: cl.priority, owner: cl.owner });
  const td: any = await P.generateTeardown(wh.reply_id!); say('12 two-point teardown (PENDING_APPROVAL)', { findings: td.findings, proof_ids: td.proof_ids });
  await P.decideTeardown(td.teardown_id!, 'APPROVE', 'ayush');
  const mt = await P.createMeeting(pid, new Date(Date.now() + 86400000 * 2).toISOString());
  const mb = await P.meetingBrief(mt.meeting_id); say('13 meeting brief', mb.brief);
  const pm = await P.postMeeting(mt.meeting_id, `Pain: mobile visitors leave before product pages. Goal: lift mobile conversion before Diwali. Requirements: keep Shopify. Scope: mobile home and product page redesign. Budget: not discussed. Timeline: six weeks. Decision makers: Priya and ops head Arjun. Objections: worried about downtime. Next step: proposal by Friday.`);
  say('14 post-meeting analysis', { pain: pm.analysis.pain, next: pm.analysis.next_step, stage: pm.analysis.crm_update.stage });
  const prop = await P.draftProposal(mt.meeting_id, { deliverables: ['Mobile home page redesign', 'Product page template'] }); say('15 proposal draft', { investment: prop.draft.investment, timeline: prop.draft.timeline, deliverables: prop.draft.deliverables });
  const m = await P.campaignMetrics(); say('16 metrics', (m as any[]).find((c) => c.code === 'IND-WEB-ELECTRONICS'));
  const wk = await P.weeklyAnalysis(); say('17 weekly recommendations', wk.recommendations);
  const sh = saleshandy(); const sent = sh.mode === 'mock' ? (sh as any).sent.length : 'n/a';
  const ai = await q(`select count(*) n, count(*) filter (where cached_from is not null) cached from ai_runs`);
  say('DONE', { mock_sends_recorded: sent, ai_runs: ai[0] });
  return { prospect_id: pid, draft_id: em.draft_id, reply_id: wh.reply_id, teardown_id: td.teardown_id, meeting_id: mt.meeting_id, proposal_id: prop.proposal_id };
}
if (/demo\.[jt]s$/.test(process.argv[1] ?? '')) demo().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
