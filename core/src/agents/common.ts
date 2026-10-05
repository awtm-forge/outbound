import { z } from 'zod';
export const Tag = z.enum(['OBSERVED', 'INFERRED', 'UNKNOWN']);
export const Claim = z.object({ value: z.string(), tag: Tag });
export const Confidence = z.number().min(0).max(1);
export const Evidence = z.array(z.string()).default([]);
export const ProblemEnum = z.enum(['WEBSITE','CONVERSION','UX','SEO','ANALYTICS','PRODUCT','MVP','ENGINEERING','AUTOMATION','AI','BRAND','OTHER']);
export const DomainEnum = z.enum(['WEB', 'PRODUCT', 'BRAND', 'UNKNOWN']);
export const CompanyCtx = z.object({
  name: z.string(), domain: z.string(), website: z.string().optional(), country: z.string().optional(), city: z.string().optional(),
  industry: z.string().optional(), vertical: z.string().optional(), company_size: z.string().optional(), platform: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});
export const ProofAsset = z.object({ id: z.string(), title: z.string(), label: z.string(), text: z.string(), domains: z.array(z.string()), problems: z.array(z.string()), verticals: z.array(z.string()) });
export const CampaignCtx = z.object({ code: z.string(), service_domain: z.string(), vertical: z.string(), problem: z.string(), offer: z.string(), sender: z.string().nullable().optional(), config: z.record(z.any()).default({}), compliance: z.record(z.any()).default({}) });
export const j = (o: unknown) => JSON.stringify(o, null, 1);
