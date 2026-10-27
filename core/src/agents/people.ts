import { z } from 'zod';
import type { AgentDef } from '../lib/ai.ts';
import { CompanyCtx, CampaignCtx, Confidence, j } from './common.ts';

// ---------------- People finder (Claude with web search) ----------------
// Finds the person who owns the problem, from public sources only. A name needs a page that ties it to the company;
// an email needs a page where it is published. Nothing is constructed from a pattern.
const Url = z.string().url();
const PeopleIn = z.object({ company: CompanyCtx, campaign: CampaignCtx, buyer_titles: z.array(z.string()), public_emails: z.array(z.string()).default([]) });
const Person = z.object({
  full_name: z.string().min(2), job_title: z.string(), linkedin_url: Url.nullable(),
  email: z.string().email().nullable(), email_source_url: Url.nullable(),
  source_urls: z.array(Url).min(1), confidence: Confidence,
});
const PeopleOut = z.object({ people: z.array(Person).max(5), searched_for: z.array(z.string()), notes: z.string() });
export type PeopleOutT = z.infer<typeof PeopleOut>;
export const findPeople: AgentDef<z.infer<typeof PeopleIn>, PeopleOutT> = {
  name: 'people_finder', version: '1.1.0', effort: 'medium', webSearch: { maxUses: 5 }, input: PeopleIn, output: PeopleOut,
  system: `You are the People Finder for awtm forge, a Bengaluru design and engineering studio. Use web search to find who at this company owns the problem the campaign is about: usually the founder, CEO, or head of ecommerce, marketing or digital. Search the company site (About, Team, Contact), press coverage, funding news, MCA or startup databases, and LinkedIn as it appears in search results. Do not try to log in anywhere.
Hard rules:
- Include a person only when at least one source URL names them together with this company. Put those URLs in source_urls.
- Include an email only when you saw that exact address published on a public page; give that page as email_source_url. Never build an email from a name pattern. Otherwise email is null.
- Prefer current roles; skip people who have clearly left.
- job_title is the bare title, for example "Co-Founder". Put evidence in notes, never in job_title or full_name.
- If you find nobody, return an empty people list and say what you searched. An empty answer is better than a guess.
Schema: {people[{full_name, job_title, linkedin_url|null, email|null, email_source_url|null, source_urls[], confidence 0..1}], searched_for[], notes}. Best match first.`,
  user: (i) => `COMPANY:\n${j(i.company)}\nCAMPAIGN:\n${j(i.campaign)}\nTITLES THAT OWN THIS PROBLEM: ${i.buyer_titles.join(', ') || 'Founder, CEO'}\nEMAILS ALREADY ON THEIR SITE: ${i.public_emails.join(', ') || 'none'}`,
  mock: () => ({ people: [], searched_for: [], notes: 'mock provider: no web search' }),
};
