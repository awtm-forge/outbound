import { z } from 'zod';
import type { AgentDef } from '../lib/ai.ts';
import { Confidence, CompanyCtx, CampaignCtx, j } from './common.ts';
import { ResearchOut, WebOut } from './research.ts';

// ---------------- 2. Qualification Agent ----------------
// Awards points per configured criterion; the deterministic scoring engine (lib/scoring.ts) clamps, sums and applies thresholds.
const QualIn = z.object({
  company: CompanyCtx, campaign: CampaignCtx, research: ResearchOut.nullable(), website: WebOut.nullable(),
  has_decision_maker: z.boolean(), has_relevant_proof: z.boolean(),
  criteria: z.array(z.object({ key: z.string(), label: z.string(), max: z.number() })),
});
const QualOut = z.object({ scores: z.record(z.number()), rationale: z.record(z.string()), red_flags: z.array(z.string()), confidence: Confidence });
export type QualOutT = z.infer<typeof QualOut>;
export const qualification: AgentDef<z.infer<typeof QualIn>, QualOutT> = {
  name: 'qualification', version: '1.0.0', tier: 'cheap', input: QualIn, output: QualOut,
  system: `You are the Qualification Agent for awtm forge outbound. Award points for each supplied criterion, 0 up to its max, from the evidence only. Unknown evidence earns low points, never generous assumptions. Schema: {scores{criterion_key: points}, rationale{criterion_key: one sentence}, red_flags[], confidence}.`,
  user: (i) => `CRITERIA:\n${j(i.criteria)}\nCOMPANY:\n${j(i.company)}\nCAMPAIGN:\n${j(i.campaign)}\nRESEARCH:\n${j(i.research)}\nWEBSITE:\n${j(i.website)}\nhas_decision_maker=${i.has_decision_maker} has_relevant_proof=${i.has_relevant_proof}`,
  mock: (i) => {
    const fit = (i.company.vertical ?? '').toLowerCase().split(':')[0] === i.campaign.vertical.toLowerCase().split(':')[0];
    const findings = i.website?.findings.length ?? 0;
    const sizeKnown = !!i.company.company_size && i.company.company_size !== 'UNKNOWN';
    const raw: Record<string, number> = {
      target_vertical_fit: fit ? 18 : 6, business_maturity: sizeKnown ? 11 : 6, digital_importance: (i.company.vertical ?? '').includes('ecommerce') ? 14 : 8,
      visible_problem: Math.min(15, findings * 5), commercial_fit: sizeKnown ? 11 : 7, proof_relevance: i.has_relevant_proof ? 8 : 2,
      decision_maker_accessibility: i.has_decision_maker ? 5 : 1, timing_trigger: (i.research?.recent_triggers.length ?? 0) > 0 ? 4 : 1,
    };
    const scores: Record<string, number> = {}, rationale: Record<string, string> = {};
    for (const c of i.criteria) { scores[c.key] = Math.min(c.max, raw[c.key] ?? 0); rationale[c.key] = `mock heuristic for ${c.label}`; }
    return { scores, rationale, red_flags: i.research ? [] : ['no research available'], confidence: 0.5 };
  },
};
