import { z } from 'zod';
import type { AgentDef } from '../lib/ai.ts';
import { Tag, Claim, Confidence, Evidence, ProblemEnum, DomainEnum, CompanyCtx, ProofAsset, CampaignCtx, PROBLEMS_TEXT, DOMAINS_TEXT, j } from './common.ts';

// ---------------- 1. Account Research Agent ----------------
const SiteSnapshot = z.object({
  fetched: z.boolean(), url: z.string().optional(), title: z.string().optional(), site_name: z.string().optional(), description: z.string().optional(), h1: z.array(z.string()).default([]),
  nav_links: z.array(z.string()).default([]), cta_texts: z.array(z.string()).default([]), forms: z.number().default(0), has_viewport_meta: z.boolean().default(false),
  platform_signals: z.array(z.string()).default([]), script_count: z.number().default(0), image_count: z.number().default(0), word_count: z.number().default(0),
  has_https: z.boolean().default(false), trust_signals: z.array(z.string()).default([]), text_excerpt: z.string().default(''), error: z.string().optional(),
});
export type SiteSnapshotT = z.infer<typeof SiteSnapshot>;
const ResearchIn = z.object({ company: CompanyCtx, site: SiteSnapshot });
const ResearchOut = z.object({
  company_summary: z.string(), what_they_sell: Claim, target_customer: Claim, business_model: Claim, vertical: Claim, market: Claim,
  company_size_estimate: Claim, technology_signals: z.array(Claim), growth_signals: z.array(Claim), recent_triggers: z.array(Claim),
  potential_problems: z.array(z.object({ problem: ProblemEnum, note: z.string(), tag: Tag })), evidence: Evidence, confidence: Confidence,
});
export type ResearchOutT = z.infer<typeof ResearchOut>;
export const accountResearch: AgentDef<z.infer<typeof ResearchIn>, ResearchOutT> = {
  name: 'account_research', version: '1.0.0', input: ResearchIn, output: ResearchOut,
  system: `You are the Account Research Agent for awtm forge, a Bengaluru design, engineering and growth studio. You summarise a prospect company strictly from the supplied metadata and website snapshot. Schema: {company_summary, what_they_sell{value,tag}, target_customer{value,tag}, business_model{value,tag}, vertical{value,tag}, market{value,tag}, company_size_estimate{value,tag}, technology_signals[{value,tag}], growth_signals[{value,tag}], recent_triggers[{value,tag}], potential_problems[{problem: one of ${PROBLEMS_TEXT}, note, tag}], evidence[strings quoting what you saw], confidence 0..1}.`,
  user: (i) => `COMPANY METADATA:\n${j(i.company)}\n\nWEBSITE SNAPSHOT:\n${j(i.site)}`,
  mock: (i) => {
    const seen = i.site.fetched;
    const t = (v: string, obs = seen): z.infer<typeof Claim> => ({ value: v, tag: obs ? 'OBSERVED' : 'INFERRED' });
    return {
      company_summary: `${i.company.name} (${i.company.domain}) appears to be a ${i.company.vertical ?? i.company.industry ?? 'UNKNOWN'} business${i.company.city ? ' based in ' + i.company.city : ''}.`,
      what_they_sell: t(i.site.title ? `Per the site title: ${i.site.title}` : 'UNKNOWN', !!i.site.title),
      target_customer: { value: i.company.vertical?.includes('DTC') ? 'Indian consumers buying online' : 'UNKNOWN', tag: 'INFERRED' },
      business_model: { value: i.company.vertical?.includes('ecommerce') ? 'Direct to consumer online retail' : 'UNKNOWN', tag: 'INFERRED' },
      vertical: { value: i.company.vertical ?? 'UNKNOWN', tag: i.company.vertical ? 'OBSERVED' : 'UNKNOWN' },
      market: { value: i.company.country ?? 'UNKNOWN', tag: i.company.country ? 'OBSERVED' : 'UNKNOWN' },
      company_size_estimate: { value: i.company.company_size ?? 'UNKNOWN', tag: i.company.company_size ? 'OBSERVED' : 'UNKNOWN' },
      technology_signals: i.site.platform_signals.map((s) => t(s)),
      growth_signals: [], recent_triggers: [],
      potential_problems: [
        ...(i.site.fetched && !i.site.has_viewport_meta ? [{ problem: 'UX' as const, note: 'No viewport meta tag; mobile rendering likely poor', tag: 'OBSERVED' as const }] : []),
        ...(i.site.fetched && i.site.cta_texts.length === 0 ? [{ problem: 'CONVERSION' as const, note: 'No clear call to action text found on the home page', tag: 'OBSERVED' as const }] : []),
        ...(i.site.fetched && !i.site.description ? [{ problem: 'SEO' as const, note: 'Home page has no meta description', tag: 'OBSERVED' as const }] : []),
      ],
      evidence: seen ? [`title: ${i.site.title ?? ''}`, `h1: ${i.site.h1.join(' | ')}`, `platform: ${i.site.platform_signals.join(',') || 'none detected'}`] : ['website not fetched'],
      confidence: seen ? 0.6 : 0.2,
    };
  },
};

// ---------------- 3. Decision-Maker Agent ----------------
const DmIn = z.object({ company: CompanyCtx, campaign: CampaignCtx, known_contacts: z.array(z.object({ full_name: z.string().nullable(), job_title: z.string().nullable(), email: z.string().nullable(), linkedin_url: z.string().nullable() })) });
const DmOut = z.object({
  recommended_titles: z.array(z.string()), best_known_contact_index: z.number().int().nullable(), rationale: z.string(),
  search_queries: z.array(z.string()), accessibility: z.enum(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']), confidence: Confidence,
});
export const decisionMaker: AgentDef<z.infer<typeof DmIn>, z.infer<typeof DmOut>> = {
  name: 'decision_maker', version: '1.0.0', tier: 'cheap', input: DmIn, output: DmOut,
  system: `You are the Decision-Maker Agent. Given a company, a campaign (service domain, problem, buyer titles) and known contacts, decide which title owns this problem and which known contact (by index) is the best entry point, or null. Never invent names or emails. Schema: {recommended_titles[], best_known_contact_index|null, rationale, search_queries[] (LinkedIn search strings), accessibility HIGH|MEDIUM|LOW|UNKNOWN, confidence}.`,
  user: (i) => `COMPANY:\n${j(i.company)}\nCAMPAIGN:\n${j(i.campaign)}\nKNOWN CONTACTS:\n${j(i.known_contacts)}`,
  mock: (i) => {
    const idx = i.known_contacts.findIndex((c) => c.job_title && /founder|ceo|director|head|cto|coo|owner/i.test(c.job_title));
    return { recommended_titles: ['Founder', 'CEO', 'Head of Ecommerce'], best_known_contact_index: idx >= 0 ? idx : null,
      rationale: idx >= 0 ? `Known contact holds a title that owns ${i.campaign.problem}` : 'No known contact with an owning title',
      search_queries: [`${i.company.name} founder`, `${i.company.name} head of ecommerce`], accessibility: idx >= 0 ? 'HIGH' : 'MEDIUM', confidence: idx >= 0 ? 0.7 : 0.4 };
  },
};

// ---------------- 4. Website Analysis Agent ----------------
const WebIn = z.object({ company: CompanyCtx, site: SiteSnapshot, campaign_problem: z.string().optional() });
const Dimension = z.enum(['VALUE_PROPOSITION','NAVIGATION','CTA','MOBILE_UX','PRODUCT_DISCOVERY','TRUST','SOCIAL_PROOF','FORMS','CONVERSION_FRICTION','CONTENT','SEO_BASICS','TECHNICAL_SIGNALS','PERFORMANCE_SIGNALS','INFORMATION_ARCHITECTURE']);
const Finding = z.object({ dimension: Dimension, observation: z.string(), evidence: z.string(), likely_consequence: z.string(), confidence: Confidence, recommended_test: z.string(), tag: Tag });
const WebOut = z.object({ findings: z.array(Finding), strongest_finding_index: z.number().int().nullable(), overall_note: z.string(), confidence: Confidence });
export type WebOutT = z.infer<typeof WebOut>;
export const websiteAnalysis: AgentDef<z.infer<typeof WebIn>, WebOutT> = {
  name: 'website_analysis', version: '1.0.0', input: WebIn, output: WebOut,
  system: `You are the Website Analysis Agent. From a structural snapshot of a public website, produce specific, commercially useful findings a founder would recognise, across: VALUE_PROPOSITION NAVIGATION CTA MOBILE_UX PRODUCT_DISCOVERY TRUST SOCIAL_PROOF FORMS CONVERSION_FRICTION CONTENT SEO_BASICS TECHNICAL_SIGNALS PERFORMANCE_SIGNALS INFORMATION_ARCHITECTURE. No generic SEO filler. Never claim precise performance metrics (load time, scores) because none were measured; say what signals suggest. Schema: {findings[{dimension, observation, evidence (quote the snapshot), likely_consequence, confidence, recommended_test, tag}], strongest_finding_index|null, overall_note, confidence}. If the site was not fetched, return an empty findings list and say so.`,
  user: (i) => `COMPANY:\n${j(i.company)}\nCAMPAIGN PROBLEM FOCUS: ${i.campaign_problem ?? 'none'}\nSNAPSHOT:\n${j(i.site)}`,
  mock: (i) => {
    if (!i.site.fetched) return { findings: [], strongest_finding_index: null, overall_note: 'Website not fetched; nothing can be observed.', confidence: 0 };
    const f: z.infer<typeof Finding>[] = [];
    if (!i.site.has_viewport_meta) f.push({ dimension: 'MOBILE_UX', observation: 'The home page ships without a viewport meta tag.', evidence: 'has_viewport_meta=false', likely_consequence: 'Phones render the desktop layout zoomed out; most Indian DTC traffic is mobile, so tapping and reading cost effort before the first product is seen.', confidence: 0.8, recommended_test: 'Open the home page on a mid-range Android and count taps to the first product.', tag: 'OBSERVED' });
    if (i.site.cta_texts.length === 0) f.push({ dimension: 'CTA', observation: 'No call-to-action text was found above the fold.', evidence: 'cta_texts=[]', likely_consequence: 'Visitors arriving from ads have no obvious next step, which usually shows up as a high bounce on paid landing traffic.', confidence: 0.7, recommended_test: 'Add one primary CTA near the hero and compare add-to-cart rate for a week.', tag: 'OBSERVED' });
    if (i.site.trust_signals.length === 0) f.push({ dimension: 'TRUST', observation: 'No trust signals (reviews, guarantees, payment badges, policies) were detected on the home page.', evidence: 'trust_signals=[]', likely_consequence: 'For a first-time buyer of electronics, missing warranty and return information is a common reason to leave at the product page.', confidence: 0.6, recommended_test: 'Surface warranty and return policy on product pages and watch product-to-cart rate.', tag: 'OBSERVED' });
    if (!i.site.description) f.push({ dimension: 'SEO_BASICS', observation: 'The home page has no meta description.', evidence: 'description missing', likely_consequence: 'Google writes its own snippet, usually weaker than a written one; a small but free click-through loss.', confidence: 0.7, recommended_test: 'Write descriptions for the top 20 pages and watch Search Console CTR.', tag: 'OBSERVED' });
    if (i.site.forms === 0) f.push({ dimension: 'FORMS', observation: 'No enquiry or newsletter form on the home page.', evidence: 'forms=0', likely_consequence: 'Visitors who are not ready to buy leave without any way to be reached again.', confidence: 0.5, recommended_test: 'Add a low-friction capture and measure weekly sign-ups.', tag: 'OBSERVED' });
    if (f.length === 0) f.push({ dimension: 'CONTENT', observation: 'Home page structure looks complete at the snapshot level.', evidence: j(i.site).slice(0, 200), likely_consequence: 'UNKNOWN', confidence: 0.3, recommended_test: 'Manual review of product pages.', tag: 'INFERRED' });
    return { findings: f, strongest_finding_index: 0, overall_note: `${f.length} structural findings from the home page snapshot; no performance metrics were measured.`, confidence: 0.6 };
  },
};

// ---------------- 5. Problem Detection Agent ----------------
const ProbIn = z.object({ company: CompanyCtx, research: ResearchOut, website: WebOut.nullable(), campaign: CampaignCtx });
const ProbOut = z.object({
  primary_problem: ProblemEnum, tied_primary: z.array(ProblemEnum).default([]), secondary_problems: z.array(ProblemEnum),
  problem_angle: z.string(), specific_observation: z.string(), business_consequence: z.string(), trigger: z.string(),
  problem_score: z.number().int().min(0).max(100), commercial_score: z.number().int().min(0).max(100), evidence: Evidence, confidence: Confidence,
});
export type ProbOutT = z.infer<typeof ProbOut>;
export const problemDetection: AgentDef<z.infer<typeof ProbIn>, ProbOutT> = {
  name: 'problem_detection', version: '1.0.0', input: ProbIn, output: ProbOut,
  system: `You are the Problem Detection Agent. From account research and website findings, assign exactly ONE primary problem from ${PROBLEMS_TEXT}. Only list tied_primary when confidence is genuinely tied. specific_observation must be one concrete, verifiable thing (OBSERVED), written so the founder recognises their own site. Write these as plain sentences for an email: never start them with a tag such as "OBSERVED:". business_consequence is the commercial implication. trigger is "UNKNOWN" if there is no real trigger. problem_score = how visible and real the problem is; commercial_score = how much money plausibly rides on it. Schema: {primary_problem, tied_primary[], secondary_problems[], problem_angle, specific_observation, business_consequence, trigger, problem_score, commercial_score, evidence[], confidence}.`,
  user: (i) => `COMPANY:\n${j(i.company)}\nCAMPAIGN:\n${j(i.campaign)}\nACCOUNT RESEARCH:\n${j(i.research)}\nWEBSITE FINDINGS:\n${j(i.website)}`,
  mock: (i) => {
    const top = i.website?.findings[i.website.strongest_finding_index ?? 0];
    const map: Record<string, z.infer<typeof ProblemEnum>> = { MOBILE_UX: 'UX', CTA: 'CONVERSION', TRUST: 'CONVERSION', SEO_BASICS: 'SEO', FORMS: 'CONVERSION', CONTENT: 'WEBSITE' };
    const primary = top ? map[top.dimension] ?? 'WEBSITE' : (i.research.potential_problems[0]?.problem ?? 'OTHER');
    const secondary = [...new Set([...(i.website?.findings.map((f) => map[f.dimension] ?? 'WEBSITE') ?? []), ...i.research.potential_problems.map((p) => p.problem)])].filter((p) => p !== primary);
    return { primary_problem: primary, tied_primary: [], secondary_problems: secondary.slice(0, 3),
      problem_angle: top ? `${top.dimension.toLowerCase().replace('_', ' ')} on the home page` : 'UNKNOWN',
      specific_observation: top?.observation ?? 'UNKNOWN', business_consequence: top?.likely_consequence ?? 'UNKNOWN', trigger: 'UNKNOWN',
      problem_score: top ? Math.round(top.confidence * 80) : 20, commercial_score: i.company.vertical?.includes('ecommerce') ? 70 : 50,
      evidence: top ? [top.evidence] : [], confidence: top?.confidence ?? 0.3 };
  },
};

// ---------------- 6. Capability Matching Agent ----------------
const CapIn = z.object({ problem: ProbOut, campaign: CampaignCtx, capabilities: z.record(z.object({ name: z.string(), items: z.array(z.string()), problems: z.array(z.string()) })), proof_assets: z.array(ProofAsset) });
const CapOut = z.object({ domain: DomainEnum, capability_items: z.array(z.string()).max(3), one_line: z.string(), proof_ids: z.array(z.string()).max(2), proof_rationale: z.string(), confidence: Confidence });
export type CapOutT = z.infer<typeof CapOut>;
export const capabilityMatching: AgentDef<z.infer<typeof CapIn>, CapOutT> = {
  name: 'capability_matching', version: '1.0.0', tier: 'cheap', input: CapIn, output: CapOut,
  system: `You are the Capability Matching Agent. Map the primary problem to the SMALLEST relevant awtm forge capability (one domain, at most three items), never the whole catalogue. Choose at most two proof assets from the supplied list whose label is VERIFIED and whose problems or verticals overlap; never choose STATED, TO_CONFIRM, PRIVATE or SHOWCASE. If none fit, proof_ids is empty. Schema: {domain ${DOMAINS_TEXT}, capability_items[], one_line (how we help, no hype), proof_ids[], proof_rationale, confidence}.`,
  user: (i) => `PROBLEM:\n${j(i.problem)}\nCAMPAIGN:\n${j(i.campaign)}\nCAPABILITIES:\n${j(i.capabilities)}\nPROOF ASSETS:\n${j(i.proof_assets)}`,
  mock: (i) => {
    const p = i.problem.primary_problem;
    const entry = Object.entries(i.capabilities).find(([, v]) => v.problems.includes(p));
    const domain = (entry?.[0] ?? 'UNKNOWN') as z.infer<typeof DomainEnum>;
    const items = entry ? entry[1].items.filter((x) => /ux|ecommerce|landing|seo|automation|saas|web app|brand/i.test(x)).slice(0, 2) : [];
    const proofs = i.proof_assets.filter((a) => a.label === 'VERIFIED' && (a.problems.includes(p) || a.verticals.some((v) => (i.campaign.vertical || '').toLowerCase().includes(v.split(':')[0].toLowerCase())))).slice(0, 2);
    return { domain, capability_items: items.length ? items : entry?.[1].items.slice(0, 2) ?? [], one_line: `We help ${i.campaign.vertical} businesses fix ${p.toLowerCase()} problems in the buying journey.`,
      proof_ids: proofs.map((a) => a.id), proof_rationale: proofs.length ? 'VERIFIED assets with matching problem or vertical' : 'No VERIFIED asset matches; email will carry no proof claim', confidence: entry ? 0.7 : 0.2 };
  },
};
export { SiteSnapshot, ResearchOut, WebOut, ProbOut, CapOut };
