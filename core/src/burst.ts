// One-off Claude burst from this Mac against the live database: find companies, research and score them, find the
// person to write to on the public web, draft the email. Stops at AI_SPEND_CAP_USD. Safe to stop and run again:
// finished companies are skipped and identical AI calls come from the cache.
//
//   node src/burst.ts --search --concurrency 8 --max 600
//   node src/burst.ts --only <prospect-id>          (one company, for a test)
import { q, pool } from './lib/db.ts';
import { env } from './lib/env.ts';
import { SpendCapReached, spentMicros } from './lib/ai.ts';
import * as P from './pipeline.ts';
import * as D from './discovery.ts';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : (process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? 'true' : process.argv[i + 1]); };
const CONCURRENCY = Number(arg('concurrency', '6')); const MAX = Number(arg('max', '500')); const PAGES = Number(arg('pages', '2'));
const usd = (m: number) => `$${(m / 1e6).toFixed(2)}`;

// What to search for, per campaign. Narrow product words find real brands; broad ones find blogs and marketplaces.
const SEARCHES: Record<string, { q: string; tech?: string }[]> = {
  'IND-WEB-ELECTRONICS': ['wireless earbuds brand', 'power bank brand', 'smartwatch brand', 'bluetooth speaker brand', 'smart home devices brand', 'mobile accessories brand', 'kitchen appliances brand', 'air purifier brand', 'gaming accessories brand', 'home audio brand'].map((q) => ({ q, tech: 'shopify' })),
  'IND-WEB-BATHROOM': ['bathroom fittings brand', 'sanitaryware brand', 'faucets and showers brand', 'bathroom vanity brand', 'kitchen sink brand', 'water heater geyser brand', 'tiles brand online'].map((q) => ({ q })),
  'IND-WEB-B2B': ['industrial equipment manufacturer', 'packaging solutions company', 'logistics company', 'interior design firm', 'architecture firm', 'CA firm', 'recruitment agency'].map((q) => ({ q })),
  'IND-PROD-SAAS': ['B2B SaaS startup', 'HR software startup', 'fintech startup', 'edtech startup', 'healthtech startup', 'logistics software startup'].map((q) => ({ q })),
  'IND-AI-SME': ['manufacturing company', 'distributor company', 'export house', 'textile manufacturer', 'auto parts manufacturer'].map((q) => ({ q })),
  'IND-OPS-CPO': ['EV charging network', 'EV charging station operator', 'electric vehicle charging company'].map((q) => ({ q })),
};

async function search(): Promise<number> {
  let added = 0;
  for (const [code, list] of Object.entries(SEARCHES)) for (const s of list) {
    if (added >= MAX) return added;
    try {
      const r = await D.runSearch({ industry: s.q, location: 'India', technology: s.tech, pages: PAGES }, 'burst');
      const ids = (r.candidates as any[]).filter((c) => c.status === 'NEW' && c.enriched_at && (c.signals?.kind ?? 'COMPANY') === 'COMPANY' && c.country_guess === 'IN').map((c) => c.id).slice(0, MAX - added);
      if (ids.length) { const a = await D.addCandidates(ids, code, 'burst', { run_chain: false }); added += a.added.filter((x: any) => x.created).length; }
      console.log(`search  ${code.padEnd(20)} ${s.q.padEnd(32)} ${r.candidates.length} found, ${ids.length} new, ${added} added so far`);
    } catch (e: any) { console.log(`search  ${code} ${s.q}: ${e.message}`); if (/used up/.test(e.message)) return added; }
  }
  return added;
}

// The work list: companies that still need research first, then qualified ones missing a person or a draft.
async function workList(): Promise<{ id: string; name: string }[]> {
  const only = arg('only'); if (only && only !== 'true') return (await q(`select p.id, c.name from prospects p join companies c on c.id=p.company_id where p.id=$1`, [only])).map((r) => ({ id: r.id, name: r.name }));
  return (await q(`select p.id, c.name from prospects p join companies c on c.id=p.company_id
    where not p.suppressed and p.campaign_id is not null and p.status in ('NEW','RESEARCHING','QUALIFYING','QUALIFIED','RESEARCH_FURTHER')
      and not exists (select 1 from email_drafts d where d.prospect_id=p.id and d.status in ('PENDING_APPROVAL','APPROVED','SENT_TO_SEQUENCER'))
      and not (p.status='RESEARCH_FURTHER' and p.account_score is not null)
    order by (p.status='QUALIFIED') desc, p.created_at limit $1`, [MAX])).map((r) => ({ id: r.id, name: r.name }));
}

async function one(id: string, name: string) {
  const out: string[] = [];
  let p = await P.loadProspect(id);
  if (p.account_score == null || ['NEW', 'RESEARCHING', 'QUALIFYING'].includes(p.status)) {
    const c = await P.runChain(id); out.push(`${c.qualify?.verdict ?? '?'} ${c.qualify?.score ?? ''}`); p = await P.loadProspect(id);
  } else out.push(`${p.status} ${p.account_score}`);
  if (p.status === 'QUALIFIED' || p.status === 'PENDING_APPROVAL') {
    if (!(p.contact && (p.contact.full_name || p.contact.first_name))) {
      const f = await P.findPeopleOnWeb(id); out.push(`${f.found} people`); p = await P.loadProspect(id);
    }
    if (p.contact && (p.contact.full_name || p.contact.first_name) && p.status === 'QUALIFIED') {
      try { await P.generateEmail(id); out.push('drafted'); } catch (e: any) { out.push(`no draft: ${e.message}`); }
    }
  }
  return `${name.slice(0, 34).padEnd(34)} ${out.join(' | ')}`;
}

async function main() {
  if (env.aiProvider !== 'anthropic') throw new Error('Set AI_PROVIDER=anthropic for the burst.');
  console.log(`Claude burst. Model ${env.aiModel}. Cap ${env.aiSpendCapUsd ? '$' + env.aiSpendCapUsd : 'none'}. Spent so far ${usd(await spentMicros())}.`);
  if (arg('search') === 'true') console.log(`added ${await search()} companies from search`);
  const list = await workList(); console.log(`${list.length} companies to work on, ${CONCURRENCY} at a time`);
  let next = 0, done = 0, stop = false;
  const worker = async () => {
    while (!stop && next < list.length) {
      const { id, name } = list[next++];
      try { const line = await one(id, name); done++; console.log(`[${done}/${list.length}] ${line}   spent ${usd(await spentMicros())}`); }
      catch (e: any) {
        if (e instanceof SpendCapReached || /spend cap reached/.test(e.message)) { stop = true; console.log(`STOP: ${e.message}`); }
        else { done++; console.log(`[${done}/${list.length}] ${name.slice(0, 34).padEnd(34)} error: ${String(e.message).slice(0, 160)}`); }
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const t = await q(`select count(*) filter (where status='QUALIFIED')::int qualified, count(*) filter (where status='PENDING_APPROVAL')::int drafts from prospects`);
  console.log(`done. spent ${usd(await spentMicros())}. qualified waiting ${t[0].qualified}, drafts to review ${t[0].drafts}`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
