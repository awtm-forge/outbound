import { z } from 'zod';
import type { AgentDef } from '../lib/ai.ts';
import { Confidence, CompanyCtx, ProofAsset, j } from './common.ts';
import { ProbOut, CapOut, ResearchOut } from './research.ts';

// ---------------- 10. Meeting Intelligence Agent ----------------
const MbIn = z.object({ company: CompanyCtx, research: ResearchOut.nullable(), problem: ProbOut.nullable(), capability: CapOut.nullable(), proof_assets: z.array(ProofAsset), reply_thread: z.array(z.object({ direction: z.enum(['OUT', 'IN']), body: z.string() })) });
const MbOut = z.object({ company_context: z.string(), why_they_replied: z.string(), original_observation: z.string(), likely_problem: z.string(), questions_to_ask: z.array(z.string()).min(3), relevant_proof: z.array(z.string()), possible_solution: z.string(), potential_objections: z.array(z.string()), confidence: Confidence });
export type MbOutT = z.infer<typeof MbOut>;
export const meetingIntelligence: AgentDef<z.infer<typeof MbIn>, MbOutT> = {
  name: 'meeting_intelligence', version: '1.0.0', input: MbIn, output: MbOut,
  system: `You are the Meeting Intelligence Agent. Produce a meeting brief for a 25-minute discovery call. relevant_proof lists proof asset ids from the supplied list that are VERIFIED only, with a note on permission if the asset notes say naming needs permission. Questions must be specific to the observation and the reply thread. Schema: {company_context, why_they_replied, original_observation, likely_problem, questions_to_ask[], relevant_proof[], possible_solution, potential_objections[], confidence}.`,
  user: (i) => j(i),
  mock: (i) => ({
    company_context: i.research?.company_summary ?? 'UNKNOWN', why_they_replied: i.reply_thread.filter((m) => m.direction === 'IN').at(-1)?.body.slice(0, 160) ?? 'UNKNOWN',
    original_observation: i.problem?.specific_observation ?? 'UNKNOWN', likely_problem: i.problem?.primary_problem ?? 'UNKNOWN',
    questions_to_ask: ['What share of your orders come from phones today, and do you know the mobile conversion rate separately?', 'When a visitor leaves without buying, where in the journey do you think it happens?', 'Who owns the website internally, and what did the last change to it look like?', 'What would make this quarter a success for the online store?'],
    relevant_proof: i.proof_assets.filter((p) => p.label === 'VERIFIED' && (i.capability?.proof_ids ?? []).includes(p.id)).map((p) => p.id),
    possible_solution: i.capability?.one_line ?? 'UNKNOWN', potential_objections: ['We already have an agency', 'No budget this quarter', 'We plan to rebuild on another platform'], confidence: i.problem ? 0.6 : 0.2,
  }),
};

// ---------------- 11. Post-Meeting Agent ----------------
const PmIn = z.object({ company: CompanyCtx, brief: MbOut.nullable(), notes: z.string().min(10) });
const PmOut = z.object({
  pain: z.array(z.string()), goal: z.array(z.string()), requirements: z.array(z.string()), scope: z.string(), budget_signal: z.string(), timeline: z.string(),
  decision_makers: z.array(z.string()), objections: z.array(z.string()), next_step: z.string(),
  crm_update: z.object({ stage: z.enum(['MEETING_HELD', 'PROPOSAL_SENT', 'LOST']), summary: z.string() }), follow_up_draft: z.string(), proposal_brief: z.string(), tasks: z.array(z.string()), confidence: Confidence,
});
export type PmOutT = z.infer<typeof PmOut>;
export const postMeeting: AgentDef<z.infer<typeof PmIn>, PmOutT> = {
  name: 'post_meeting', version: '1.0.0', input: PmIn, output: PmOut,
  system: `You are the Post-Meeting Intelligence Agent. From meeting notes or a transcript, extract only what was said: pain, goal, requirements, scope, budget_signal ("UNKNOWN" if not discussed), timeline, decision_makers, objections, next_step. Then produce crm_update, a follow_up_draft (plain text, confirms what was heard, no pricing unless the notes state agreed numbers), a proposal_brief (one paragraph for the proposal agent) and tasks. Schema as named.`,
  user: (i) => j(i),
  mock: (i) => {
    const n = i.notes; const grab = (re: RegExp) => n.match(new RegExp(re.source.replace('(.+)', '(.+?)(?=\\.?\\s+[A-Z][a-z -]*:|$)'), re.flags))?.[1]?.trim() ?? 'UNKNOWN';
    return { pain: [grab(/pain[:\-]\s*(.+)/i)], goal: [grab(/goal[:\-]\s*(.+)/i)], requirements: [grab(/requirements?[:\-]\s*(.+)/i)], scope: grab(/scope[:\-]\s*(.+)/i), budget_signal: grab(/budget[:\-]\s*(.+)/i), timeline: grab(/timeline[:\-]\s*(.+)/i),
      decision_makers: [grab(/decision[- ]makers?[:\-]\s*(.+)/i)], objections: [grab(/objections?[:\-]\s*(.+)/i)], next_step: grab(/next[- ]step[:\-]\s*(.+)/i),
      crm_update: { stage: 'MEETING_HELD', summary: `Discovery call held with ${i.company.name}; proposal requested: ${grab(/next[- ]step[:\-]\s*(.+)/i)}` },
      follow_up_draft: `Hi,\n\nThanks for the time today. What I heard: ${grab(/pain[:\-]\s*(.+)/i)}. The goal is ${grab(/goal[:\-]\s*(.+)/i)}.\n\nNext step on our side: ${grab(/next[- ]step[:\-]\s*(.+)/i)}.\n\nAyush`,
      proposal_brief: `Problem: ${grab(/pain[:\-]\s*(.+)/i)}. Goal: ${grab(/goal[:\-]\s*(.+)/i)}. Scope discussed: ${grab(/scope[:\-]\s*(.+)/i)}. Timeline: ${grab(/timeline[:\-]\s*(.+)/i)}.`,
      tasks: ['Send follow-up after approval', 'Draft proposal', 'Confirm decision makers for proposal review'], confidence: 0.5 };
  },
};

// ---------------- 12. Proposal Draft Agent ----------------
const PrIn = z.object({ company: CompanyCtx, analysis: PmOut, capability: CapOut.nullable(), proof_assets: z.array(ProofAsset), business_inputs: z.object({ price_paise: z.number().int().nullable(), deadline: z.string().nullable(), guarantees: z.array(z.string()).default([]), deliverables: z.array(z.string()).default([]), sla: z.string().nullable() }) });
const PrOut = z.object({ problem: z.string(), diagnosis: z.string(), recommended_solution: z.string(), scope: z.array(z.string()), deliverables: z.array(z.string()), milestones: z.array(z.object({ name: z.string(), description: z.string() })), assumptions: z.array(z.string()), exclusions: z.array(z.string()), timeline: z.string(), investment: z.string(), next_steps: z.array(z.string()), confidence: Confidence });
export type PrOutT = z.infer<typeof PrOut>;
export const proposalDraft: AgentDef<z.infer<typeof PrIn>, PrOutT> = {
  name: 'proposal_draft', version: '1.0.0', effort: 'high', input: PrIn, output: PrOut,
  system: `You are the Proposal Draft Agent. Draft a proposal from approved post-meeting analysis. HARD RULES: price, deadline, guarantees, deliverables and SLA come ONLY from business_inputs. If business_inputs.price_paise is null, investment is exactly "TO BE CONFIRMED BY FOUNDERS". If deadline is null, timeline is "TO BE CONFIRMED" with milestones described relatively (week 1, week 2). deliverables come from business_inputs.deliverables; if empty, list "TO BE CONFIRMED". Never invent a guarantee or SLA. Schema: {problem, diagnosis, recommended_solution, scope[], deliverables[], milestones[{name,description}], assumptions[], exclusions[], timeline, investment, next_steps[], confidence}.`,
  user: (i) => j(i),
  mock: (i) => ({
    problem: i.analysis.pain.join('; '), diagnosis: i.analysis.proposal_brief, recommended_solution: i.capability?.one_line ?? 'UNKNOWN', scope: [i.analysis.scope],
    deliverables: i.business_inputs.deliverables.length ? i.business_inputs.deliverables : ['TO BE CONFIRMED'],
    milestones: [{ name: 'Diagnose', description: 'Journey review and agreed priorities (week 1)' }, { name: 'Fix', description: 'Design and build of the agreed scope (weeks 2 onward)' }, { name: 'Measure', description: 'Before and after tracking where analytics exist' }],
    assumptions: ['Client provides analytics and platform access by format or masked example, never live credentials', 'One point of contact for sign-off'], exclusions: ['Paid media management', 'Content writing beyond agreed pages'],
    timeline: i.business_inputs.deadline ?? 'TO BE CONFIRMED', investment: i.business_inputs.price_paise != null ? `INR ${(i.business_inputs.price_paise / 100).toLocaleString('en-IN')} (ex GST)` : 'TO BE CONFIRMED BY FOUNDERS',
    next_steps: ['Review this draft on a 20-minute call', 'Confirm scope and investment', 'Sign-off via dashboard.awtmforge.com'], confidence: 0.5,
  }),
};

// ---------------- 13. Campaign Analytics Agent ----------------
const CaIn = z.object({ period: z.string(), campaigns: z.array(z.object({ code: z.string(), vertical: z.string(), problem: z.string(), offer: z.string(), sender: z.string().nullable(), metrics: z.record(z.number()) })) });
const CaOut = z.object({ recommendations: z.array(z.object({ campaign_code: z.string(), decision: z.enum(['STOP', 'CONTINUE', 'SCALE', 'TEST', 'RESEARCH_MORE']), reason: z.string(), suggested_test: z.string().nullable() })), cross_campaign_insights: z.array(z.string()), data_sufficiency: z.enum(['INSUFFICIENT', 'EARLY', 'ADEQUATE']), confidence: Confidence });
export type CaOutT = z.infer<typeof CaOut>;
export const campaignAnalytics: AgentDef<z.infer<typeof CaIn>, CaOutT> = {
  name: 'campaign_analytics', version: '1.0.0', input: CaIn, output: CaOut,
  system: `You are the Campaign Analytics Agent. Compare campaigns on reply quality, positive reply rate, meeting rate, close rate and revenue, never on open rate. With fewer than 50 sends per campaign say data_sufficiency INSUFFICIENT and prefer CONTINUE or TEST. You only recommend; you never change sending volume. Schema: {recommendations[{campaign_code, decision STOP|CONTINUE|SCALE|TEST|RESEARCH_MORE, reason, suggested_test|null}], cross_campaign_insights[], data_sufficiency, confidence}.`,
  user: (i) => j(i),
  mock: (i) => ({
    recommendations: i.campaigns.map((c) => { const sent = c.metrics.emails_sent ?? 0, pos = c.metrics.positive_replies ?? 0;
      return sent < 50 ? { campaign_code: c.code, decision: 'CONTINUE' as const, reason: `Only ${sent} sends; too early to judge.`, suggested_test: null }
        : pos / sent >= 0.03 ? { campaign_code: c.code, decision: 'SCALE' as const, reason: 'Positive reply rate at or above 3%.', suggested_test: null }
        : pos === 0 ? { campaign_code: c.code, decision: 'TEST' as const, reason: 'No positive replies at volume; angle or list is off.', suggested_test: 'Swap the observation type (mobile vs trust) for the next 50.' }
        : { campaign_code: c.code, decision: 'CONTINUE' as const, reason: 'Below target but non-zero.', suggested_test: 'Test a second subject line.' }; }),
    cross_campaign_insights: ['Mock run: insights require real volume.'], data_sufficiency: i.campaigns.every((c) => (c.metrics.emails_sent ?? 0) < 50) ? 'INSUFFICIENT' : 'EARLY', confidence: 0.4,
  }),
};
