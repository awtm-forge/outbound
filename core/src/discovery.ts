// Prospect discovery: a search source finds candidate sites, we fingerprint each site ourselves and pull public contact details,
// then selected candidates are handed to the pipeline (ingest -> run-chain). Sources are adapters: google_cse today, apify next.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { env } from './lib/env.ts';
import { q, one, audit } from './lib/db.ts';
import { log } from './lib/log.ts';
import { normalizeDomain } from './lib/normalize.ts';
import { snapshotFromHtml } from './lib/website.ts';
import { HttpError, ingest, runChain } from './pipeline.ts';

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
export class MockSource implements DiscoverySource {
  readonly name = 'mock';
  async search(qry: Query, page: number): Promise<Hit[]> {
    if (page > 0) return [];
    const stem = (qry.industry ?? qry.keywords ?? 'demo').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '') || 'demo';
    return [1, 2, 3].map((n) => ({ url: `https://${stem}-${n}.example/`, title: `${qry.industry ?? 'Demo'} store ${n}`, snippet: `Mock result ${n} for ${buildQuery(qry)}` }));
  }
}
export function source(fetchImpl?: typeof fetch): DiscoverySource { return env.discoverySource === 'google_cse' ? new GoogleCse(fetchImpl) : new MockSource(); }

export async function takeQuota(src: string) {
  const r = await one(`insert into source_calls(source,day,n) values($1,current_date,1) on conflict (source,day) do update set n=source_calls.n+1 returning n`, [src]);
  if (r!.n > env.discoveryDailyQuota) throw new HttpError(429, `daily quota for ${src} exhausted (${env.discoveryDailyQuota})`);
}
export const quotaUsed = async (src: string) => Number((await one('select n from source_calls where source=$1 and day=current_date', [src]))?.n ?? 0);

// ---------- enrichment: fingerprint + public contact details, from the site itself ----------
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_RE = /(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}\b/g;
const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/;
const linkOf = (html: string, host: string) => html.match(new RegExp(`https?://(?:www\\.)?${host}/[A-Za-z0-9_./-]+`, 'i'))?.[0];
export type Enriched = { platform: string | null; platform_signals: string[]; emails: string[]; phones: string[]; gstin: string | null; linkedin_url?: string; instagram_url?: string; facebook_url?: string; country_guess: string; size_estimate: string; signals: Record<string, unknown>; fetched: boolean };
export async function enrichSite(url: string, fetchImpl: typeof fetch = fetch): Promise<Enriched> {
  const domain = normalizeDomain(url);
  const get = async (u: string) => {
    // ponytail: .example hosts are served from the fixture so mock discovery works offline; real hosts are fetched
    if (domain.endsWith('.example')) return readFileSync(new URL('../fixtures/demo-electronics.html', import.meta.url), 'utf8');
    try { const r = await fetchImpl(u, { redirect: 'follow', signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; awtm-research/1.0; +https://awtmforge.com)' } }); return r.ok ? (await r.text()).slice(0, 600_000) : ''; } catch { return ''; }
  };
  const home = await get(/^https?:\/\//.test(url) ? url : `https://${domain}`);
  if (!home) return { platform: null, platform_signals: [], emails: [], phones: [], gstin: null, country_guess: domain.endsWith('.in') ? 'IN' : 'UNKNOWN', size_estimate: 'UNKNOWN', signals: {}, fetched: false };
  const snap = snapshotFromHtml(url, home);
  const contactPaths = [...new Set([...home.matchAll(/href=["']([^"']*(?:contact|about|reach-us|support)[^"']*)["']/gi)].map((m) => m[1]).filter((h) => !/^(mailto|tel|#|javascript)/i.test(h)).slice(0, 2))];
  const extra = (await Promise.all(contactPaths.map((p) => { try { return get(new URL(p, `https://${domain}/`).href); } catch { return ''; } }))).join('\n');
  const all = home + '\n' + extra;
  const emails = [...new Set((all.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()).filter((e) => !/\.(png|jpg|jpeg|gif|svg|webp|css|js)$/.test(e) && !/sentry|wixpress|example\.com|schema\.org|w3\.org/.test(e)))].slice(0, 10);
  const phones = [...new Set((all.replace(/<[^>]+>/g, ' ').match(PHONE_RE) ?? []).map((p) => p.replace(/[\s-]/g, '')))].filter((p) => p.length >= 10).slice(0, 5);
  const text = all.replace(/<[^>]+>/g, ' ');
  const country_guess = domain.endsWith('.in') || /\+91|india|gstin|pvt\.? ltd/i.test(text) ? 'IN' : 'UNKNOWN';
  const size_estimate = snap.word_count > 2500 && snap.image_count > 40 ? 'LARGE_CATALOGUE' : snap.word_count > 800 ? 'MID' : 'SMALL';
  return { platform: snap.platform_signals.find((s) => !/Google Tag|Meta Pixel|Razorpay|Shiprocket/.test(s)) ?? null, platform_signals: snap.platform_signals, emails, phones, gstin: text.match(GSTIN_RE)?.[0] ?? null,
    linkedin_url: linkOf(all, 'linkedin\\.com'), instagram_url: linkOf(all, 'instagram\\.com'), facebook_url: linkOf(all, 'facebook\\.com'), country_guess, size_estimate,
    signals: { title: snap.title, h1: snap.h1, description: !!snap.description, forms: snap.forms, has_viewport_meta: snap.has_viewport_meta, trust_signals: snap.trust_signals, word_count: snap.word_count, image_count: snap.image_count, cta_texts: snap.cta_texts, site_snapshot: snap }, fetched: true };
}

// ---------- the search itself ----------
const hash = (o: unknown) => createHash('sha256').update(JSON.stringify(o)).digest('hex');
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
    const seen = new Set<string>(); const unique = hits.map((h) => ({ ...h, domain: normalizeDomain(h.url) })).filter((h) => h.domain.includes('.') && !SKIP_HOSTS.test(h.domain) && !seen.has(h.domain) && seen.add(h.domain));
    let rank = 0;
    // ponytail: 5 concurrent site fetches; raise if searches feel slow, lower if sites start blocking us
    for (let i = 0; i < unique.length; i += 5) await Promise.all(unique.slice(i, i + 5).map(async (h) => {
      const existing = await one('select id, enriched_at from discovery_candidates where domain=$1', [h.domain]);
      let id = existing?.id;
      if (!existing || !existing.enriched_at || opts.force) {
        const e = await enrichSite(h.url, opts.fetchImpl);
        id = (await one(`insert into discovery_candidates(domain,url,title,snippet,platform,platform_signals,emails,phones,gstin,linkedin_url,instagram_url,facebook_url,country_guess,size_estimate,signals,enriched_at)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,case when $16 then now() else null end)
          on conflict (domain) do update set title=coalesce(excluded.title,discovery_candidates.title), snippet=coalesce(excluded.snippet,discovery_candidates.snippet), platform=coalesce(excluded.platform,discovery_candidates.platform), platform_signals=excluded.platform_signals, emails=excluded.emails, phones=excluded.phones, gstin=coalesce(excluded.gstin,discovery_candidates.gstin), linkedin_url=coalesce(excluded.linkedin_url,discovery_candidates.linkedin_url), instagram_url=coalesce(excluded.instagram_url,discovery_candidates.instagram_url), facebook_url=coalesce(excluded.facebook_url,discovery_candidates.facebook_url), country_guess=excluded.country_guess, size_estimate=excluded.size_estimate, signals=excluded.signals, enriched_at=excluded.enriched_at returning id`,
          [h.domain, h.url, h.title ?? null, h.snippet ?? null, e.platform, e.platform_signals, e.emails, e.phones, e.gstin, e.linkedin_url ?? null, e.instagram_url ?? null, e.facebook_url ?? null, e.country_guess, e.size_estimate, JSON.stringify(e.signals), e.fetched]))!.id;
      }
      await q('insert into discovery_search_candidates(search_id,candidate_id,rank) values($1,$2,$3) on conflict do nothing', [s.id, id, ++rank]);
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
  return { ...(s as Record<string, any>), cached, candidates };
}
export const listSearches = () => q('select id, query, source, status, result_count, actor, created_at from discovery_searches order by created_at desc limit 50');

// ---------- hand-off to the pipeline ----------
export async function addCandidates(ids: string[], campaign_code: string, actor: string, opts: { run_chain?: boolean; html?: string } = {}) {
  if (!ids.length) throw new HttpError(400, 'no candidates selected');
  const out = [];
  for (const id of ids) {
    const c = await one('select * from discovery_candidates where id=$1', [id]); if (!c) { out.push({ id, error: 'not found' }); continue; }
    const email = c.emails.find((e: string) => !/^(noreply|no-reply|unsubscribe)/.test(e)) ?? null;
    try {
      const r = await ingest({ company: { name: c.company_name ?? titleToName(c.title, c.domain), website: c.url, domain: c.domain, country: c.country_guess === 'IN' ? 'IN' : undefined, platform: c.platform ?? undefined, company_size: c.size_estimate === 'UNKNOWN' ? undefined : c.size_estimate, metadata: { discovery_candidate_id: c.id, site_snapshot: c.signals?.site_snapshot ?? undefined, public_emails: c.emails, phones: c.phones, gstin: c.gstin, linkedin_url: c.linkedin_url, instagram_url: c.instagram_url } },
        contact: email ? { email, job_title: null as any } : undefined, campaign_code, source: 'discovery', owner: actor }, actor);
      await q(`update discovery_candidates set status='ADDED', company_id=$2 where id=$1`, [c.id, r.company.id]);
      let chain: any = null;
      if (opts.run_chain) { try { chain = await runChain(r.prospect.id, { html: opts.html }); } catch (e: any) { chain = { error: e.message }; } }
      out.push({ id, prospect_id: r.prospect.id, created: r.created, suppressed: r.prospect.suppressed, generic_email_only: !!email && /^(info|hello|contact|support|sales|care|help|admin|team|enquiry|enquiries)@/.test(email), chain: chain && { verdict: chain.qualify?.verdict, score: chain.qualify?.score, draft: chain.email?.draft_id ?? null, error: chain.error } });
    } catch (e: any) { out.push({ id, error: e.message }); }
  }
  return { added: out };
}
const titleToName = (title: string | null, domain: string) => (title ?? '').split(/[|\-–:]/)[0].trim().slice(0, 80) || domain.split('.')[0];
