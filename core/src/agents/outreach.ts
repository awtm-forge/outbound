import { z } from 'zod';
import type { AgentDef } from '../lib/ai.ts';
import { Confidence, CompanyCtx, CampaignCtx, ProofAsset, j } from './common.ts';
import { ProbOut, CapOut, WebOut } from './research.ts';
import { firstName } from '../lib/normalize.ts';

// ---------------- 7. Email Generation Agent ----------------
const EmailIn = z.object({ company: CompanyCtx, contact: z.object({ full_name: z.string().nullable(), job_title: z.string().nullable() }), campaign: CampaignCtx, problem: ProbOut, capability: CapOut, proof_assets: z.array(ProofAsset), sender_name: z.string(), sender_title: z.string() });
const EmailOut = z.object({ subject: z.string().max(80), body: z.string(), word_count: z.number().int(), claims_used: z.array(z.string()), proof_ids_used: z.array(z.string()), confidence: Confidence });
export type EmailOutT = z.infer<typeof EmailOut>;
export const emailGeneration: AgentDef<z.infer<typeof EmailIn>, EmailOutT> = {
  name: 'email_generation', version: '1.0.0', input: EmailIn, output: EmailOut,
  system: `You are the Email Generation Agent for awtm forge. Write ONE plain-text cold email: short (under the campaign max_words), one specific observation (from problem.specific_observation, OBSERVED only), one commercial implication, one line on why awtm forge is relevant (capability.one_line, plus proof text ONLY from the supplied proof_assets, verbatim or shorter, never stronger), one low-friction reply CTA (campaign.config.cta). No attachment, no links, no generic agency intro, no compliment, no invented personalization, no exclamation marks, no em dashes. End with the campaign's unsubscribe_text on its own line if provided, then the sender signature "{sender_name}\\n{sender_title}, awtm forge". Schema: {subject (<=80 chars, lowercase conversational, no clickbait), body, word_count, claims_used[], proof_ids_used[], confidence}.`,
  user: (i) => j(i),
  mock: (i) => {
    const fn = firstName(i.contact.full_name);
    const proof = i.proof_assets.filter((p) => i.capability.proof_ids.includes(p.id) && p.label === 'VERIFIED')[0];
    const unsub = i.campaign.compliance?.unsubscribe_text ? `\n\n${i.campaign.compliance.unsubscribe_text}` : '';
    const body = `Hi ${fn},\n\n${i.problem.specific_observation}\n\n${i.problem.business_consequence}\n\n${i.capability.one_line}${proof ? ' ' + proof.text : ''}\n\nI noticed two things worth looking at on ${i.company.domain}. ${i.campaign.config?.cta ?? 'Worth sending them over?'}${unsub}\n\n${i.sender_name}\n${i.sender_title}, awtm forge`;
    return { subject: `${i.company.name.toLowerCase()} on mobile`, body, word_count: body.split(/\s+/).length, claims_used: [i.problem.specific_observation], proof_ids_used: proof ? [proof.id] : [], confidence: 0.6 };
  },
};

// ---------------- 8. Reply Classification Agent ----------------
export const Classification = z.enum(['POSITIVE','VALUE_REQUEST','PRICE','TIMING','WRONG_PERSON','REFERRAL','OBJECTION','NOT_INTERESTED','UNSUBSCRIBE','OTHER']);
const ReplyIn = z.object({ company: CompanyCtx, campaign: CampaignCtx.nullable(), original_email: z.object({ subject: z.string(), body: z.string() }).nullable(), reply: z.object({ from_email: z.string().nullable(), subject: z.string().nullable(), body: z.string() }) });
const ReplyOut = z.object({ classification: Classification, confidence: Confidence, recommended_next_action: z.string(), suggested_reply: z.string(), priority: z.enum(['HIGH','MEDIUM','LOW']), owner: z.string(), reasoning: z.string() });
export type ReplyOutT = z.infer<typeof ReplyOut>;
export const replyClassification: AgentDef<z.infer<typeof ReplyIn>, ReplyOutT> = {
  name: 'reply_classification', version: '1.0.0', tier: 'cheap', input: ReplyIn, output: ReplyOut,
  system: `You are the Reply Classification Agent. Classify an email reply into exactly one of POSITIVE VALUE_REQUEST PRICE TIMING WRONG_PERSON REFERRAL OBJECTION NOT_INTERESTED UNSUBSCRIBE OTHER. Any request to stop, remove, unsubscribe or "do not contact" is UNSUBSCRIBE. A reply asking to see the two things / the observations / details is VALUE_REQUEST. Draft a short suggested_reply a human will edit; nothing is sent automatically. owner is "ayush" for commercial replies, "rahul" for design or scope questions. Schema: {classification, confidence, recommended_next_action, suggested_reply, priority HIGH|MEDIUM|LOW, owner, reasoning}.`,
  user: (i) => j(i),
  mock: (i) => {
    const b = i.reply.body.toLowerCase();
    const pick = (): z.infer<typeof Classification> =>
      /unsubscribe|remove me|stop emailing|do not contact|don't contact|\bno\b\.?$/.test(b) ? 'UNSUBSCRIBE'
      : /not interested|no thanks|not for us/.test(b) ? 'NOT_INTERESTED'
      : /send (them|it|those) over|share (them|the)|what (are|did) you (see|notice)|sure,? send|yes,? please|go ahead/.test(b) ? 'VALUE_REQUEST'
      : /how much|price|pricing|cost|budget/.test(b) ? 'PRICE'
      : /not the right person|speak to|forward(ed)? to|talk to my/.test(b) ? (/forward|talk to|speak to/.test(b) ? 'REFERRAL' : 'WRONG_PERSON')
      : /next quarter|later|busy|not now|revisit|in a few months/.test(b) ? 'TIMING'
      : /call|meet|chat|interested|let'?s talk/.test(b) ? 'POSITIVE'
      : /already have|we use|in-house|agency/.test(b) ? 'OBJECTION' : 'OTHER';
    const c = pick();
    const next: Record<string, [string, string, 'HIGH'|'MEDIUM'|'LOW']> = {
      UNSUBSCRIBE: ['Suppress email and domain immediately; no reply needed.', '', 'HIGH'],
      VALUE_REQUEST: ['Generate two-point teardown for human approval.', `Thanks ${firstName(null)}. Sending the two things over in a short note today.`, 'HIGH'],
      POSITIVE: ['Propose two 25-minute slots this week.', 'Great. Would Tuesday 11:00 or Wednesday 16:00 IST work for 25 minutes on Google Meet?', 'HIGH'],
      PRICE: ['Do not quote by email; offer a 20-minute scoping call.', 'Depends on what we find is worth fixing. Happy to give a range after a 20-minute call. Would this week work?', 'HIGH'],
      TIMING: ['Set next_action_at per their timeline; one courteous reply.', 'Understood. I will check back then. If it helps before that, the two observations stand on their own.', 'LOW'],
      REFERRAL: ['Create a contact for the referred person; new draft for approval.', 'Thank you for pointing me to the right person. I will write to them directly and keep it short.', 'MEDIUM'],
      WRONG_PERSON: ['Ask who owns the website; do not re-send.', 'Appreciate it. Who would be the right person for the website on your side?', 'MEDIUM'],
      OBJECTION: ['One short reply addressing the objection; then stop.', 'Fair enough. If the two observations are useful to your current team, happy to send them with no follow-up from me.', 'LOW'],
      NOT_INTERESTED: ['Mark lost; no further emails in this campaign.', '', 'LOW'],
      OTHER: ['Human review.', '', 'MEDIUM'],
    };
    const [action, reply, priority] = next[c];
    return { classification: c, confidence: c === 'OTHER' ? 0.3 : 0.75, recommended_next_action: action, suggested_reply: reply, priority, owner: /PRICE|POSITIVE|OBJECTION/.test(c) ? 'ayush' : 'rahul', reasoning: `keyword match on reply body for ${c}` };
  },
};

// ---------------- 9. Teardown Agent ----------------
const TdIn = z.object({ company: CompanyCtx, campaign: CampaignCtx.nullable(), problem: ProbOut, website: WebOut.nullable(), capability: CapOut, proof_assets: z.array(ProofAsset), reply_body: z.string(), sender_name: z.string() });
const TdFinding = z.object({ observation: z.string(), evidence: z.string(), why_it_matters: z.string(), what_we_would_test: z.string() });
const TdOut = z.object({ findings: z.array(TdFinding).length(2), capability: z.string(), proof_ids: z.array(z.string()), body: z.string(), confidence: Confidence });
export type TdOutT = z.infer<typeof TdOut>;
export const teardown: AgentDef<z.infer<typeof TdIn>, TdOutT> = {
  name: 'teardown', version: '1.0.0', input: TdIn, output: TdOut,
  system: `You are the Teardown Agent. The prospect asked to see the two things. Produce exactly two findings, each with observation (OBSERVED from website findings only), evidence, why_it_matters, what_we_would_test. Then a plain-text reply body under 220 words that presents both findings, names the one relevant awtm forge capability, and includes proof ONLY from the supplied VERIFIED proof_assets, verbatim. No pricing, no guarantees, no links. End with a one-line offer of a 25-minute call. Schema: {findings[2], capability, proof_ids[], body, confidence}.`,
  user: (i) => j(i),
  mock: (i) => {
    const fs = (i.website?.findings ?? []).slice(0, 2);
    while (fs.length < 2) fs.push({ dimension: 'CONTENT', observation: 'UNKNOWN', evidence: 'UNKNOWN', likely_consequence: 'UNKNOWN', confidence: 0, recommended_test: 'Manual review needed', tag: 'UNKNOWN' });
    const findings = fs.map((f) => ({ observation: f.observation, evidence: f.evidence, why_it_matters: f.likely_consequence, what_we_would_test: f.recommended_test }));
    const proof = i.proof_assets.filter((p) => i.capability.proof_ids.includes(p.id) && p.label === 'VERIFIED');
    const body = `Thanks for asking. Here are the two things we noticed on ${i.company.domain}.\n\n1. ${findings[0].observation}\nWhy it matters: ${findings[0].why_it_matters}\nWhat we would test: ${findings[0].what_we_would_test}\n\n2. ${findings[1].observation}\nWhy it matters: ${findings[1].why_it_matters}\nWhat we would test: ${findings[1].what_we_would_test}\n\n${i.capability.one_line}${proof[0] ? ' ' + proof[0].text : ''}\n\nIf useful, 25 minutes on a call and I can walk through both on your site.\n\n${i.sender_name}`;
    return { findings, capability: i.capability.domain, proof_ids: proof.map((p) => p.id), body, confidence: i.website ? 0.6 : 0.2 };
  },
};
