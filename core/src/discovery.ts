// Prospect discovery: a search source finds candidate sites, we fingerprint each site ourselves and pull public contact details,
// then selected candidates are handed to the pipeline (ingest -> run-chain). Sources are adapters: serper (default real source), google_cse (legacy), apify next.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { env } from './lib/env.ts';
import { q, one, audit } from './lib/db.ts';
import { log } from './lib/log.ts';
import { normalizeDomain } from './lib/normalize.ts';
import { snapshotFromHtml } from './lib/website.ts';
import { HttpError, ingest, runChain, setStatus } from './pipeline.ts';
import { enqueue } from './jobs.ts';

export type Query = { industry?: string; location?: string; technology?: string; keywords?: string; pages?: number };
export type Hit = { url: string; title?: string; snippet?: string };
export interface DiscoverySource { readonly name: string; search(qry: Query, page: number): Promise<Hit[]> }

const TECH_FOOTPRINT: Record<string, string> = { shopify: '"powered by shopify" OR inurl:collections', wix: '"wix.com" OR wixsite', woocommerce: 'woocommerce OR "add to cart"', wordpress: '"wp-content"', framer: 'framer', webflow: 'webflow', magento: 'magento' };
export function buildQuery(qry: Query): string {
  const parts = [qry.keywords, qry.industry, qry.location].filter(Boolean) as string[];
  const tech = qry.technology?.toLowerCase().trim(); if (tech && TECH_FOOTPRINT[tech]) parts.push(TECH_FOOTPRINT[tech]);
  parts.push('-site:amazon.in -site:flipkart.com -site:indiamart.com -site:justdial.com -site:linkedin.com -site:facebook.com -site:instagram.com -site:youtube.com -site:wikipedia.org');
  return parts.join(' ');
}

export class GoogleCse implements DiscoverySource {
  readonly name = 'google_cse';
  private fetchImpl: typeof fetch;
  constructor(fetchImpl: typeof fetch = fetch) { this.fetchImpl = fetchImpl; }
  async search(qry: Query, page: number): Promise<Hit[]> {
    if (!env.googleCseKey || !env.googleCseCx) throw new HttpError(503, 'GOOGLE_CSE_KEY / GOOGLE_CSE_CX not set');
    await takeQuota(this.name);
    const u = new URL('https://www.googleapis.com/customsearch/v1');
    u.search = new URLSearchParams({ key: env.googleCseKey, cx: env.googleCseCx, q: buildQuery(qry), num: '10', start: String(page * 10 + 1), gl: 'in', ...(/(india|^in$)/i.test(qry.location ?? '') ? { cr: 'countryIN' } : {}) }).toString();
    const res = await this.fetchImpl(u, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) { const t = await res.text(); log.error('google cse error', { status: res.status }); throw new HttpError(502, `google cse ${res.status}: ${t.slice(0, 200)}`); }
    const j: any = await res.json();
    return (j.items ?? []).map((i: any) => ({ url: i.link, title: i.title, snippet: i.snippet }));
  }
}
// Serper.dev: Google results over a simple POST. Key in SERPER_API_KEY. One query = one page of up to 10 organic results.
export class Serper implements DiscoverySource {
  readonly name = 'serper';
  private fetchImpl: typeof fetch;
  constructor(fetchImpl: typeof fetch = fetch) { this.fetchImpl = fetchImpl; }
  async search(qry: Query, page: number): Promise<Hit[]> {
    if (!env.serperKey) throw new HttpError(503, 'SERPER_API_KEY not set');
    await takeQuota(this.name);
    const india = /(india|^in$)/i.test(qry.location ?? '');
    const res = await this.fetchImpl('https://google.serper.dev/search', { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json', 'X-API-KEY': env.serperKey },
      body: JSON.stringify({ q: buildQuery(qry), num: 10, page: page + 1, ...(india ? { gl: 'in', hl: 'en' } : {}) }) });
    if (!res.ok) { log.error('serper error', { status: res.status }); throw new HttpError(502, `serper ${res.status}: ${(await res.text()).slice(0, 200)}`); }
    const j: any = await res.json();
    return (j.organic ?? []).map((i: any) => ({ url: i.link, title: i.title, snippet: i.snippet }));
  }
}
export class MockSource implements DiscoverySource {
  readonly name = 'mock';
  async search(qry: Query, page: number): Promise<Hit[]> {
    if (page > 0) return [];
    const stem = (qry.industry ?? qry.keywords ?? 'demo').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '') || 'demo';
    return [1, 2, 3].map((n) => ({ url: `https://${stem}-${n}.example/`, title: `${qry.industry ?? 'Demo'} store ${n}`, snippet: `Mock result ${n} for ${buildQuery(qry)}` }));
  }
}
export function source(fetchImpl?: typeof fetch): DiscoverySource {
  if (env.discoverySource === 'serper') return new Serper(fetchImpl);
  if (env.discoverySource === 'google_cse') return new GoogleCse(fetchImpl); // closed to new customers, shut down 1 Jan 2027
  return new MockSource();
}

export async function takeQuota(src: string) {
  // counts only calls that are allowed through, so a refused search never shows as spent
  const r = await one(`insert into source_calls(source,day,n) select $1,current_date,1 where $2 > 0 on conflict (source,day) do update set n=source_calls.n+1 where source_calls.n < $2 returning n`, [src, env.discoveryDailyQuota]);
  if (!r) throw new HttpError(429, `Today's ${src} searches are used up (${env.discoveryDailyQuota}). The count resets at midnight.`);
}
export const quotaUsed = async (src: string) => Number((await one('select n from source_calls where source=$1 and day=current_date', [src]))?.n ?? 0);

// ---------- enrichment: fingerprint + public contact details, from the site itself ----------
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_RE = /(?<!\d|\d\.)(?:\+91[\s-]?|0091[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d|\.\d)|1800[\s-]?\d{3}[\s-]?\d{3,4}/g;
const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/;
const FREE_MAIL = /@(gmail|yahoo|outlook|hotmail|rediffmail|icloud|proton(mail)?)\./;
export const isRealEmail = (e: string) => /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(e) && !/\.(png|jpe?g|gif|svg|webp|css|js|avif)$/.test(e)
  && !/^(x+|test|user|name|email|your(name|email)?|someone|abc)@/.test(e) && !/@(x+\.x+|example\.|domain\.|email\.com|sentry|wixpress|schema\.org|w3\.org|.*\.sentry\.io)/.test(e);
// same-company addresses first, then free-mail (small Indian brands often run on gmail), then anything else
const registrable = (d: string) => d.split('.').slice(-3).join('.').replace(/^(www|shop|store|home)\./, '');
export function rankEmails(emails: string[], domain: string) {
  const base = registrable(domain).split('.')[0];
  const score = (e: string) => { const ed = e.split('@')[1]; return ed === domain || ed.endsWith('.' + registrable(domain)) || registrable(domain).endsWith(ed) || ed.split('.')[0] === base ? 0 : FREE_MAIL.test(e) ? 1 : 2; };
  return [...emails].sort((a, b) => score(a) - score(b));
}
// Indian numbers only, normalised to +91XXXXXXXXXX; rejects runs of one digit and obvious sequences
export function normPhone(raw: string): string | null {
  let d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('+91')) d = d.slice(3); else if (d.startsWith('0091')) d = d.slice(4); else if (d.length === 12 && d.startsWith('91')) d = d.slice(2); else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d) && !/^(1800\d{6,7})$/.test(d) && !/^(11|20|22|33|40|44|79|80)\d{8}$/.test(d)) return null; // mobiles, toll free, metro landlines
  if (/^(\d)\1{5,}/.test(d) || /(\d)\1{6,}/.test(d) || /0123456|1234567|9876543/.test(d)) return null;
  return d.startsWith('1800') ? d : '+91' + d; // landlines come back as +91 followed by STD code and number
}
const linkOf = (html: string, host: string) => html.match(new RegExp(`https?://(?:www\\.)?${host}/[A-Za-z0-9_./-]+`, 'i'))?.[0];
export type Enriched = { sources?: Record<string, unknown>; platform: string | null; platform_signals: string[]; emails: string[]; phones: string[]; gstin: string | null; linkedin_url?: string; instagram_url?: string; facebook_url?: string; country_guess: string; size_estimate: string; signals: Record<string, unknown>; fetched: boolean };
export async function enrichSite(url: string, fetchImpl: typeof fetch = fetch, opts: { deep?: boolean } = {}): Promise<Enriched> {
  const domain = normalizeDomain(url);
  const get = async (u: string) => {
    // ponytail: .example hosts are served from the fixture so mock discovery works offline; real hosts are fetched
    if (domain.endsWith('.example')) return readFileSync(new URL('../fixtures/demo-electronics.html', import.meta.url), 'utf8');
    try { const r = await fetchImpl(u, { redirect: 'follow', signal: AbortSignal.timeout(env.discoveryFetchTimeoutMs), headers: { 'user-agent': 'Mozilla/5.0 (compatible; awtm-research/1.0; +https://awtmforge.com)' } }); return r.ok ? (await r.text()).slice(0, 600_000) : ''; } catch { return ''; }
  };
  const home = await get(/^https?:\/\//.test(url) ? url : `https://${domain}`);
  if (!home) return { platform: null, platform_signals: [], emails: [], phones: [], gstin: null, country_guess: domain.endsWith('.in') ? 'IN' : 'UNKNOWN', size_estimate: 'UNKNOWN', signals: {}, fetched: false };
  const snap = snapshotFromHtml(url, home);
  // pages that carry contact details: contact and about first, then the policy pages Indian stores must publish (phone and email live there)
  const linked = [...home.matchAll(/href=["']([^"']*(?:contact|about|reach-us|support|privacy|terms|shipping|refund|return|policies|legal|impressum)[^"']*)["']/gi)].map((m) => m[1]).filter((h) => !/^(mailto|tel|#|javascript)/i.test(h));
  const contactPaths = [...new Set([...linked, '/pages/contact', '/contact', '/contact-us', '/pages/contact-us', '/policies/contact-information', '/policies/privacy-policy', '/pages/about-us'].map((p) => { try { return new URL(p, `https://${domain}/`).href; } catch { return ''; } }).filter(Boolean))].slice(0, opts.deep ? 7 : 2);
  const pages = await Promise.all(contactPaths.map((u) => get(u).then((h) => [u, h] as const)));
  const extra = pages.map(([, h]) => h).join('\n');
  const all = (home + '\n' + extra).replace(/\\u003[ce]/gi, ' ').replace(/\\\//g, '/');
  // visible text only: script and style bodies are full of ids and json that look like phones and emails
  const text = all.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ');
  // structured data (schema.org Organization/LocalBusiness) and WhatsApp links are the most reliable sources on a store
  const ld = [...all.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
  const ldPhones = [...ld.matchAll(/"telephone"\s*:\s*"([^"]+)"/g)].map((m) => m[1]); const ldEmails = [...ld.matchAll(/"email"\s*:\s*"([^"]+)"/g)].map((m) => m[1].replace(/^mailto:/i, ''));
  const wa = [...all.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\?[^"']*phone=|whatsapp:\/\/send\?[^"']*phone=)\+?(\d{10,13})/gi)].map((m) => m[1]);
  const mailtos = [...all.matchAll(/mailto:([^"'?\s>]+)/gi)].map((m) => decodeURIComponent(m[1])).concat(ldEmails);
  const emails = rankEmails([...new Set([...mailtos, ...(text.match(EMAIL_RE) ?? [])].map((e) => e.toLowerCase().replace(/^[^a-z0-9]+/, '')))].filter(isRealEmail), domain).slice(0, 6);
  const tels = [...all.matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => m[1]).concat(ldPhones, wa.map((w) => '+' + w));
  const phones = [...new Set([...tels, ...(text.match(PHONE_RE) ?? [])].map(normPhone).filter((p): p is string => !!p))].slice(0, 4);
  const country_guess = domain.endsWith('.in') || /\+91|india|gstin|pvt\.? ltd/i.test(text) ? 'IN' : 'UNKNOWN';
  const size_estimate = snap.word_count > 2500 && snap.image_count > 40 ? 'LARGE_CATALOGUE' : snap.word_count > 800 ? 'MID' : 'SMALL';
  const where = (needle: string) => (pages.find(([, h]) => h.includes(needle)) ?? [home.includes(needle) ? (/^https?:/.test(url) ? url : `https://${domain}`) : null])[0] ?? null;
  const sources = { emails: Object.fromEntries(emails.map((e) => [e, where(e) ?? where(e.split('@')[0])])), phones: Object.fromEntries(phones.map((p) => [p, where(p.replace(/^\+91/, '').slice(-10)) ?? null])), whatsapp: wa.length > 0, structured_data: ldPhones.length + ldEmails.length > 0, pages_checked: contactPaths.length + 1 };
  return { sources, platform: snap.platform_signals.find((s) => !/Google Tag|Meta Pixel|Razorpay|Shiprocket/.test(s)) ?? null, platform_signals: snap.platform_signals, emails, phones, gstin: text.match(GSTIN_RE)?.[0] ?? null,
    linkedin_url: linkOf(all, 'linkedin\\.com'), instagram_url: linkOf(all, 'instagram\\.com'), facebook_url: linkOf(all, 'facebook\\.com'), country_guess, size_estimate,
    signals: { title: snap.title, h1: snap.h1, description: !!snap.description, forms: snap.forms, has_viewport_meta: snap.has_viewport_meta, trust_signals: snap.trust_signals, word_count: snap.word_count, image_count: snap.image_count, cta_texts: snap.cta_texts, site_snapshot: snap }, fetched: true };
}

// ---------- the search itself ----------
const hash = (o: unknown) => createHash('sha256').update(JSON.stringify(o)).digest('hex');
const PLATFORM_HOSTS = /(^|\.)(shopify|wix|wordpress|webflow|squarespace|bigcommerce|framer|godaddy|hostinger|medium|quora|reddit|blogspot|substack|zoho|hubspot)\.(com|in|co|io|org)$/;
// what kind of result this is; only COMPANY rows are pre-ticked for the pipeline
export function classifyHit(url: string, title = '', snippet = ''): 'COMPANY' | 'ARTICLE' | 'AGENCY' | 'PLATFORM' {
  const u = new URL(/^https?:/.test(url) ? url : 'https://' + url); const host = u.hostname.replace(/^www\./, '');
  if (PLATFORM_HOSTS.test(host)) return 'PLATFORM';
  const t = `${title} ${snippet}`;
  if (/\b(agency|agencies|shopify (plus )?partners?|web design (company|studio)|digital marketing (company|agency)|development company|we build (websites|stores))\b/i.test(t)) return 'AGENCY';
  if (/\/(blog|blogs|news|article|articles|post|posts|guides?|insights|resources)\//i.test(u.pathname) || /^(top|best|\d+ best|how to|why|what is|\d+ (ways|tips|reasons))\b|\bvs\.? /i.test(title.trim())) return 'ARTICLE';
  return 'COMPANY';
}
const SKIP_HOSTS = /amazon|flipkart|indiamart|justdial|linkedin|facebook|instagram|youtube|wikipedia|myntra|meesho|nykaa|snapdeal|tradeindia|exportersindia|glassdoor|crunchbase|zaubacorp|tofler/i;
export async function runSearch(qry: Query, actor: string, opts: { src?: DiscoverySource; fetchImpl?: typeof fetch; force?: boolean } = {}) {
  if (!qry.industry && !qry.keywords) throw new HttpError(400, 'industry or keywords required');
  const src = opts.src ?? source(opts.fetchImpl); const pages = Math.max(1, Math.min(qry.pages ?? env.discoveryMaxPages, 10));
  const query = { industry: qry.industry ?? null, location: qry.location ?? null, technology: qry.technology ?? null, keywords: qry.keywords ?? null, pages };
  const query_hash = hash(query);
  if (!opts.force) { const prev = await one(`select id from discovery_searches where query_hash=$1 and source=$2 and status='DONE' and created_at > now() - interval '7 days' order by created_at desc limit 1`, [query_hash, src.name]); if (prev) return getSearch(prev.id, true); }
  const s = (await one('insert into discovery_searches(query,query_hash,source,actor) values($1,$2,$3,$4) returning id', [query, query_hash, src.name, actor]))!;
  try {
    const hits: Hit[] = [];
    for (let p = 0; p < pages; p++) { const h = await src.search(qry, p); hits.push(...h); if (h.length < 10) break; }
    const seen = new Set<string>(); const unique = hits.map((h) => ({ ...h, domain: normalizeDomain(h.url), kind: classifyHit(h.url, h.title, h.snippet) })).filter((h) => h.domain.includes('.') && !SKIP_HOSTS.test(h.domain) && h.kind !== 'PLATFORM' && !seen.has(h.domain) && seen.add(h.domain));
    // ponytail: 5 concurrent site fetches; raise if searches feel slow, lower if sites start blocking us
    const C = env.discoveryConcurrency;
    for (let i = 0; i < unique.length; i += C) await Promise.all(unique.slice(i, i + C).map(async (h, j) => {
      const existing = await one('select id, enriched_at from discovery_candidates where domain=$1', [h.domain]);
      let id = existing?.id;
      if (!existing || !existing.enriched_at || opts.force) {
        const e = await enrichSite(h.url, opts.fetchImpl);
        id = (await one(`insert into discovery_candidates(domain,url,title,snippet,platform,platform_signals,emails,phones,gstin,linkedin_url,instagram_url,facebook_url,country_guess,size_estimate,signals,enriched_at)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,case when $16 then now() else null end)
          on conflict (domain) do update set title=coalesce(excluded.title,discovery_candidates.title), snippet=coalesce(excluded.snippet,discovery_candidates.snippet), platform=coalesce(excluded.platform,discovery_candidates.platform), platform_signals=excluded.platform_signals, emails=excluded.emails, phones=excluded.phones, gstin=coalesce(excluded.gstin,discovery_candidates.gstin), linkedin_url=coalesce(excluded.linkedin_url,discovery_candidates.linkedin_url), instagram_url=coalesce(excluded.instagram_url,discovery_candidates.instagram_url), facebook_url=coalesce(excluded.facebook_url,discovery_candidates.facebook_url), country_guess=excluded.country_guess, size_estimate=excluded.size_estimate, signals=excluded.signals, enriched_at=excluded.enriched_at returning id`,
          [h.domain, h.url, h.title ?? null, h.snippet ?? null, e.platform, e.platform_signals, e.emails, e.phones, e.gstin, e.linkedin_url ?? null, e.instagram_url ?? null, e.facebook_url ?? null, e.country_guess, e.size_estimate, JSON.stringify({ ...e.signals, kind: h.kind }), e.fetched]))!.id;
      }
      if (existing && existing.enriched_at && !opts.force) await q(`update discovery_candidates set signals = signals || $2 where id=$1`, [id, JSON.stringify({ kind: h.kind })]);
      await q('insert into discovery_search_candidates(search_id,candidate_id,rank) values($1,$2,$3) on conflict do nothing', [s.id, id, i + j + 1]); // search position, not fetch-completion order
    }));
    // technology filter is applied on what we fingerprinted, not on what the search engine guessed
    if (qry.technology) await q(`delete from discovery_search_candidates sc using discovery_candidates c where sc.search_id=$1 and c.id=sc.candidate_id and c.enriched_at is not null and c.platform_signals::text not ilike $2`, [s.id, `%${qry.technology}%`]);
    const n = Number((await one('select count(*) n from discovery_search_candidates where search_id=$1', [s.id]))!.n);
    await q(`update discovery_searches set status='DONE', result_count=$2, finished_at=now() where id=$1`, [s.id, n]);
    await audit('discovery_search', s.id, 'searched', actor, { source: src.name, hits: hits.length, unique: unique.length, kept: n });
  } catch (e: any) { await q(`update discovery_searches set status='FAILED', error=$2, finished_at=now() where id=$1`, [s.id, String(e.message).slice(0, 1000)]); throw e; }
  return getSearch(s.id);
}
export async function getSearch(id: string, cached = false): Promise<Record<string, any>> {
  const s = await one('select * from discovery_searches where id=$1', [id]); if (!s) throw new HttpError(404, 'search not found');
  const candidates = await q(`select c.*, sc.rank, co.name as company_name, p.status as prospect_status, p.account_score from discovery_search_candidates sc join discovery_candidates c on c.id=sc.candidate_id
    left join companies co on co.domain=c.domain left join lateral (select status, account_score from prospects where company_id=co.id order by updated_at desc limit 1) p on true where sc.search_id=$1 order by sc.rank`, [id]);
  return { ...(s as Record<string, any>), cached, candidates: candidates.map((c) => ({ ...c, display_name: c.company_name ?? companyName(c.title, c.domain, c.signals?.site_snapshot?.site_name) })) };
}
export const listSearches = () => q('select id, query, source, status, result_count, actor, created_at from discovery_searches order by created_at desc limit 50');

// ---------- hand-off to the pipeline ----------
export async function addCandidates(ids: string[], campaign_code: string, actor: string, opts: { run_chain?: boolean; html?: string; background?: boolean; source?: string } = {}) {
  if (!ids.length) throw new HttpError(400, 'no candidates selected');
  const campaign = await one('select vertical from campaigns where code=$1', [campaign_code]); if (!campaign) throw new HttpError(400, `unknown campaign ${campaign_code}`);
  const out = [];
  for (const id of ids) {
    const c = await one('select * from discovery_candidates where id=$1', [id]); if (!c) { out.push({ id, error: 'not found' }); continue; }
    const email = c.emails.find((e: string) => !/^(noreply|no-reply|unsubscribe)/.test(e)) ?? null;
    try {
      const r = await ingest({ company: { name: c.company_name ?? companyName(c.title, c.domain, c.signals?.site_snapshot?.site_name), website: c.url, domain: c.domain, country: c.country_guess === 'IN' ? 'IN' : undefined, platform: c.platform ?? undefined, vertical: campaign.vertical, company_size: c.size_estimate === 'UNKNOWN' ? undefined : c.size_estimate, metadata: { discovery_candidate_id: c.id, site_snapshot: c.signals?.site_snapshot ?? undefined, public_emails: c.emails, phones: c.phones, gstin: c.gstin, linkedin_url: c.linkedin_url, instagram_url: c.instagram_url } },
        contact: email ? { email, job_title: null as any } : undefined, campaign_code, source: opts.source ?? 'discovery', owner: actor }, actor);
      await q(`update discovery_candidates set status='ADDED', company_id=$2 where id=$1`, [c.id, r.company.id]);
      let chain: any = null;
      if (opts.run_chain && opts.background && !r.prospect.suppressed) {
        // research runs on the AI queue; the company shows as Researching in the pipeline until it is scored
        await setStatus(r.prospect.id, 'RESEARCHING'); const pid = r.prospect.id;
        enqueue(`batch:chain:${pid}`, () => runChain(pid, { html: opts.html }), 'batch'); chain = { queued: true };
      } else if (opts.run_chain) { try { chain = await runChain(r.prospect.id, { html: opts.html }); } catch (e: any) { chain = { error: e.message }; } }
      out.push({ id, prospect_id: r.prospect.id, created: r.created, suppressed: r.prospect.suppressed, generic_email_only: !!email && /^(info|hello|contact|support|sales|care|help|admin|team|enquiry|enquiries)@/.test(email), chain: chain && (chain.queued ? { queued: true } : { verdict: chain.qualify?.verdict, score: chain.qualify?.score, draft: chain.email?.draft_id ?? null, error: chain.error }) });
    } catch (e: any) { out.push({ id, error: e.message }); }
  }
  return { added: out };
}
// A company's name, not its page tagline: the site's declared name, else the title segment that matches the domain,
// else the domain itself. "Buy Smart TVs & ACs Online | Shop Sansui Electronics" on sansuiworld.com gives "Sansui Electronics".
const decode = (t: string) => t.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
export function companyName(title: string | null | undefined, domain: string, siteName?: string | null): string {
  const stem = domain.replace(/^(www|shop|store|home)\./, '').split('.')[0].toLowerCase();
  const letters = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const clean = (x: string) => decode(x).replace(/\s*(\.{3}|…)$/, '').replace(/^(shop|buy|welcome to|official( website| site| store)?( of)?)\s+/i, '').replace(/\s+(official )?(online store|website|official site)$/i, '').trim();
  if (siteName && siteName.length <= 60 && !/^(home|shop|store)$/i.test(siteName.trim())) return clean(siteName);
  const parts = decode(title ?? '').split(/\s[|–—:-]\s|\s?\|\s?|:\s/).map((x) => x.trim()).filter(Boolean);
  const hit = parts.find((part) => { const l = letters(part); return l === stem || l.includes(stem) || stem.includes(l) || part.split(/\s+/).some((w) => letters(w).length >= 4 && stem.includes(letters(w))); });
  if (hit) return clean(hit).slice(0, 80);
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

// Companies named by the Claude company finder: enriched like search hits, marked found_by 'claude'. Returns candidate ids.
export async function addFoundCompanies(found: { name: string; domain: string; what_they_sell: string; city: string | null; source_url: string | null }[], fetchImpl?: typeof fetch): Promise<string[]> {
  const ids: string[] = []; const C = env.discoveryConcurrency;
  const rows = found.map((f) => ({ ...f, domain: normalizeDomain(f.domain) })).filter((f) => f.domain.includes('.') && !SKIP_HOSTS.test(f.domain) && !PLATFORM_HOSTS.test(f.domain));
  for (let i = 0; i < rows.length; i += C) await Promise.all(rows.slice(i, i + C).map(async (f) => {
    const existing = await one('select id, enriched_at from discovery_candidates where domain=$1', [f.domain]);
    if (existing?.enriched_at) { ids.push(existing.id); return; }
    const e = await enrichSite(`https://${f.domain}`, fetchImpl);
    const r = await one(`insert into discovery_candidates(domain,url,title,snippet,platform,platform_signals,emails,phones,gstin,linkedin_url,instagram_url,facebook_url,country_guess,size_estimate,signals,enriched_at,found_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,case when $16 then now() else null end,'claude')
      on conflict (domain) do update set title=coalesce(discovery_candidates.title, excluded.title), platform=coalesce(excluded.platform,discovery_candidates.platform), platform_signals=excluded.platform_signals, emails=excluded.emails, phones=excluded.phones, gstin=coalesce(excluded.gstin,discovery_candidates.gstin), country_guess=excluded.country_guess, size_estimate=excluded.size_estimate, signals=excluded.signals, enriched_at=excluded.enriched_at returning id`,
      [f.domain, `https://${f.domain}`, f.name, f.what_they_sell, e.platform, e.platform_signals, e.emails, e.phones, e.gstin, e.linkedin_url ?? null, e.instagram_url ?? null, e.facebook_url ?? null, e.country_guess === 'UNKNOWN' ? 'IN' : e.country_guess, e.size_estimate, JSON.stringify({ ...e.signals, kind: 'COMPANY', claude_city: f.city, claude_source: f.source_url }), e.fetched]);
    if (r) ids.push(r.id);
  }));
  return ids;
}
