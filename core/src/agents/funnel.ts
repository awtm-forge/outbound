import { z } from 'zod';
import type { AgentDef } from '../lib/ai.ts';
import { CompanyCtx, CampaignCtx, Confidence, ProblemEnum, j } from './common.ts';

// ---------------- Company finder (Claude with web search) ----------------
// Finds real companies in a segment: name, domain, what they sell. Not people, not emails. Our own site check follows.
const FinderIn = z.object({ campaign: CampaignCtx, segment: z.string(), region: z.string().default('India'), known_domains: z.array(z.string()).default([]), want: z.number().int().min(5).max(60).default(40) });
const Found = z.object({ name: z.string().min(1), domain: z.string().min(4), what_they_sell: z.string(), city: z.string().nullable(), why_fit: z.string(), source_url: z.string().url().nullable() });
const FinderOut = z.object({ companies: z.array(Found), queries_used: z.array(z.string()), notes: z.string() });
export type FinderOutT = z.infer<typeof FinderOut>;
export const companyFinder: AgentDef<z.infer<typeof FinderIn>, FinderOutT> = {
  name: 'company_finder', version: '1.1.0', effort: 'medium', webSearch: { maxUses: 8 }, input: FinderIn, output: FinderOut,
  system: `You are the Company Finder for awtm forge, a Bengaluru design, engineering and growth studio selling to Indian businesses. Use web search to list real operating companies in the segment given, in the region given, that sell to customers through their own website. Vary your queries: product words, "brand", "official site", city names, "buy online", directories, press lists, "top 20" articles, funding news.
Hard rules:
- Each company must have its own website; give the bare domain (example: temptindia.com), never a marketplace, social or directory URL.
- Exclude marketplaces (Amazon, Flipkart, IndiaMART, JustDial), platforms, agencies, blogs, and anything already in known_domains.
- Indian-owned or India-operated companies only: a global brand's regional storefront (beatsbydre.com, apple.com/in) has no decision maker here, so leave it out.
- Prefer companies with signs of a paying business: a live product catalogue, many products, press mentions, funding, a GST-registered entity, offline stores, or a team.
- Do not invent domains. If unsure a domain is right, leave the company out.
Schema: {companies[{name, domain, what_they_sell, city|null, why_fit, source_url|null}], queries_used[], notes}. Return up to the number asked for.`,
  user: (i) => `CAMPAIGN:\n${j(i.campaign)}\nSEGMENT: ${i.segment}\nREGION: ${i.region}\nWANT: ${i.want} companies\nALREADY KNOWN (skip): ${i.known_domains.slice(0, 300).join(', ') || 'none'}`,
  mock: (i) => ({ companies: [1, 2, 3].map((n) => ({ name: `${i.segment} co ${n}`, domain: `${i.segment.toLowerCase().replace(/[^a-z]+/g, '-')}-${n}.example`, what_they_sell: i.segment, city: 'Bengaluru', why_fit: 'mock', source_url: null })), queries_used: ['mock'], notes: 'mock provider' }),
};

// ---------------- Screen (one cheap call per company) ----------------
// From what our own site check saw: can they pay, and is there a problem we solve? Decides who gets full research.
const Snap = z.object({ fetched: z.boolean(), title: z.string().optional(), description: z.string().optional(), h1: z.array(z.string()).default([]), nav_links: z.array(z.string()).default([]), cta_texts: z.array(z.string()).default([]),
  forms: z.number().default(0), has_viewport_meta: z.boolean().default(false), platform_signals: z.array(z.string()).default([]), image_count: z.number().default(0), word_count: z.number().default(0), trust_signals: z.array(z.string()).default([]), text_excerpt: z.string().default('') });
const ScreenIn = z.object({ company: CompanyCtx, campaign: CampaignCtx, site: Snap, has_public_email: z.boolean(), has_phone: z.boolean(), has_gstin: z.boolean(), size_estimate: z.string() });
// Tolerant on purpose: a cheap screen is not worth failing over a number written as a string, a long sentence, or an
// unknown problem label. The model's judgement is kept; the shape is tidied.
const n03 = z.coerce.number().transform((v) => Math.max(0, Math.min(3, Math.round(v))));
const ScreenOut = z.object({
  can_pay: n03, has_problem: n03, fits_campaign: z.coerce.boolean(),
  likely_problem: z.preprocess((v) => (ProblemEnum.options as string[]).includes(String(v).toUpperCase()) ? String(v).toUpperCase() : 'OTHER', ProblemEnum),
  reason: z.string().transform((t) => t.slice(0, 240)), red_flag: z.string().nullable().transform((t) => t && t.slice(0, 240)), confidence: z.coerce.number().transform((v) => Math.max(0, Math.min(1, v))),
});
export type ScreenOutT = z.infer<typeof ScreenOut>;
export const screen: AgentDef<z.infer<typeof ScreenIn>, ScreenOutT> = {
  name: 'screen', version: '1.1.0', tier: 'cheap', effort: 'low', input: ScreenIn, output: ScreenOut,
  system: `You are the Screen for awtm forge outbound. From a structural snapshot of a company's website, answer two things fast and honestly.
can_pay, 0 to 3: 0 hobby or dormant; 1 tiny or unclear; 2 an established business with a real catalogue, team or GST entity; 3 clearly mid-sized or funded, many products, offline presence or press.
has_problem, 0 to 3: how visible a problem is that a design, engineering or growth studio could fix: broken mobile setup, no calls to action, no trust signals, thin or template content, heavy pages, weak structure. 0 means the site looks strong.
fits_campaign: does this company belong in the campaign's vertical. likely_problem: one of WEBSITE CONVERSION UX SEO ANALYTICS PRODUCT MVP ENGINEERING AUTOMATION AI BRAND OTHER.
If the site was not fetched, can_pay and has_problem are 0 and reason says so. Schema: {can_pay, has_problem, fits_campaign, likely_problem, reason (one sentence), red_flag|null, confidence}.`,
  user: (i) => j(i),
  mock: (i) => ({ can_pay: i.site.fetched ? 2 : 0, has_problem: i.site.fetched ? (i.site.has_viewport_meta ? 1 : 3) : 0, fits_campaign: true, likely_problem: 'CONVERSION', reason: 'mock', red_flag: null, confidence: 0.5 }),
};
