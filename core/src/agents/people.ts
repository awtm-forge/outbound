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
  phone: z.string().nullable().default(null), phone_source_url: Url.nullable().default(null),
  source_urls: z.array(Url).min(1), confidence: Confidence,
});
const PeopleOut = z.object({ people: z.array(Person).max(5), searched_for: z.array(z.string()), notes: z.string() });
export type PeopleOutT = z.infer<typeof PeopleOut>;
export const findPeople: AgentDef<z.infer<typeof PeopleIn>, PeopleOutT> = {
  name: 'people_finder', version: '1.2.0', effort: 'medium', webSearch: { maxUses: 5 }, input: PeopleIn, output: PeopleOut,
  system: `You are the People Finder for awtm forge, a Bengaluru design and engineering studio. Use web search to find who at this company owns the problem the campaign is about: usually the founder, CEO, or head of ecommerce, marketing or digital. Search the company site (About, Team, Contact), press coverage, funding news, MCA or startup databases, and LinkedIn as it appears in search results. Do not try to log in anywhere.
Hard rules:
- Include a person only when at least one source URL names them together with this company. Put those URLs in source_urls.
- Include an email only when you saw that exact address published on a public page; give that page as email_source_url. Never build an email from a name pattern. Otherwise email is null.
- Include a phone only when published for that person (a press contact line, a company page, a directory listing); give the page as phone_source_url. Otherwise null.
- Prefer current roles; skip people who have clearly left.
- job_title is the bare title, for example "Co-Founder". Put evidence in notes, never in job_title or full_name.
- If you find nobody, return an empty people list and say what you searched. An empty answer is better than a guess.
Schema: {people[{full_name, job_title, linkedin_url|null, email|null, email_source_url|null, phone|null, phone_source_url|null, source_urls[], confidence 0..1}], searched_for[], notes}. Best match first.`,
  user: (i) => `COMPANY:\n${j(i.company)}\nCAMPAIGN:\n${j(i.campaign)}\nTITLES THAT OWN THIS PROBLEM: ${i.buyer_titles.join(', ') || 'Founder, CEO'}\nEMAILS ALREADY ON THEIR SITE: ${i.public_emails.join(', ') || 'none'}`,
  mock: () => ({ people: [], searched_for: [], notes: 'mock provider: no web search' }),
};

// ---------------- Contact finder (cheap, 3 searches) ----------------
// For a company where our own site check found no email or phone: the company's published channels, and the
// registered email and phone from public company records (MCA master data as shown on Zauba, Tofler, IndiaFilings),
// directory listings (IndiaMART, JustDial), and the Google Business listing. No person-hunting here.
const ContactIn = z.object({ company: CompanyCtx, known_emails: z.array(z.string()).default([]), known_phones: z.array(z.string()).default([]) });
const Channel = z.object({ value: z.string().min(5), source_url: Url, kind: z.enum(['website', 'company_records', 'directory', 'google_business', 'social', 'press', 'other']), belongs_to: z.string().default('company') });
const ContactOut = z.object({ emails: z.array(Channel).max(6), phones: z.array(Channel).max(6), registered_entity: z.string().nullable(), notes: z.string() });
export type ContactOutT = z.infer<typeof ContactOut>;
export const contactFinder: AgentDef<z.infer<typeof ContactIn>, ContactOutT> = {
  name: 'contact_finder', version: '1.0.0', tier: 'cheap', effort: 'low', webSearch: { maxUses: 3 }, input: ContactIn, output: ContactOut,
  system: `You find how to reach an Indian company: an email address and a phone number, from public pages only. Try, in order: the company's own site (contact, about, policy pages, WhatsApp links), Indian company records as published by Zauba Corp, Tofler or IndiaFilings (the registered email and the registered office phone), directory listings (IndiaMART, JustDial, TradeIndia), the Google Business listing, press contacts. Three searches at most; stop early once you have an email and a phone.
Hard rules: copy each value exactly as published, with the page it came from as source_url. Never construct or guess an address or number. belongs_to names the person if the page ties the channel to one, else "company". Indian phones only (+91 or 1800). Schema: {emails[{value, source_url, kind, belongs_to}], phones[{value, source_url, kind, belongs_to}], registered_entity|null, notes}.`,
  user: (i) => `COMPANY:\n${j(i.company)}\nALREADY KNOWN emails: ${i.known_emails.join(', ') || 'none'}; phones: ${i.known_phones.join(', ') || 'none'}`,
  mock: () => ({ emails: [], phones: [], registered_entity: null, notes: 'mock provider: no web search' }),
};
