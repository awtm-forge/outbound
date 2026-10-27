// The Claude funnel, run from this Mac against the live database. Three stages, each restartable:
//   --find    Claude (web search) and Serper name companies per segment; our own site check follows, free
//   --screen  one cheap Claude call per company: can they pay, is there a problem we solve -> screen_score 0..9
//   --deep    full research, the person to write to, the draft; best screen_score first, until AI_SPEND_CAP_USD
//   node src/burst.ts --find --screen --deep --target 1000 --concurrency 8
import { q, one, pool } from './lib/db.ts';
import { env } from './lib/env.ts';
import { runAgent, SpendCapReached, spentMicros } from './lib/ai.ts';
import * as P from './pipeline.ts';
import * as D from './discovery.ts';
import * as A from './agents/index.ts';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : (process.argv[i + 1] === undefined || process.argv[i + 1].startsWith('--') ? 'true' : process.argv[i + 1]); };
const on = (k: string) => arg(k) === 'true';
const CONC = Number(arg('concurrency', '8')); const TARGET = Number(arg('target', '1000')); const DEEP_MAX = Number(arg('deep-max', '400')); const MIN_SCREEN = Number(arg('min-screen', '4'));
const usd = (m: number) => `$${(m / 1e6).toFixed(2)}`;
const log = (s: string) => process.stdout.write(s + '\n');

// Segments per campaign. Claude searches each with its own query variations; Serper gets the same words plus the platform.
const SEGMENTS: Record<string, string[]> = {
  'IND-WEB-ELECTRONICS': ['wireless earbuds and headphones brands', 'power bank and charger brands', 'smartwatch and fitness band brands', 'bluetooth speaker and home audio brands', 'smart home device brands', 'mobile accessories brands', 'small kitchen appliance brands', 'air purifier and water purifier brands', 'gaming accessory brands', 'personal care appliance brands (trimmers, dryers)', 'camera and dashcam accessory brands', 'computer peripheral brands (keyboards, mice)', 'EV scooter accessory brands', 'LED lighting and smart lighting brands'],
  'IND-WEB-BATHROOM': ['bathroom fittings and faucet brands', 'sanitaryware brands', 'shower and bath accessory brands', 'bathroom vanity and mirror brands', 'kitchen sink and tap brands', 'water heater and geyser brands', 'tile and bathroom surface brands', 'modular kitchen brands selling online'],
  'IND-WEB-B2B': ['industrial equipment manufacturers with websites', 'packaging companies', 'third party logistics companies', 'interior design and fit-out firms', 'architecture firms', 'chartered accountancy and compliance firms', 'staffing and recruitment agencies', 'corporate gifting companies', 'commercial printing companies', 'facility management companies', 'security services companies', 'event management companies'],
  'IND-PROD-SAAS': ['B2B SaaS startups', 'HR tech startups', 'fintech startups for SMEs', 'edtech startups', 'healthtech startups', 'logistics and supply chain software startups', 'retail tech startups', 'proptech startups', 'legal tech startups', 'agritech software startups'],
  'IND-AI-SME': ['mid-sized manufacturers', 'FMCG distributors', 'export houses', 'textile and garment manufacturers', 'auto component manufacturers', 'pharma distributors', 'building material dealers', 'agro processing companies'],
  'IND-OPS-CPO': ['EV charging network operators', 'EV charging station companies', 'fleet EV charging providers', 'EV charger manufacturers that operate networks'],
};
const CITIES = ['Bengaluru', 'Mumbai', 'Delhi NCR', 'Hyderabad', 'Chennai', 'Pune', 'Ahmedabad', 'Jaipur', 'Kolkata', 'Surat'];

async function find() {
  const target = TARGET; let added = 0;
  const count = async () => Number((await one(`select count(*)::int n from prospects where campaign_id is not null`))!.n);
  const start = await count(); log(`find: ${start} companies already; aiming for ${target}`);
  const camps = Object.fromEntries((await q('select code, service_domain, vertical, problem, offer, sender, config, compliance from campaigns')).map((c) => [c.code, c]));
  const campaignCtx = (c: any) => ({ code: c.code, service_domain: c.service_domain, vertical: c.vertical, problem: c.problem, offer: c.offer, sender: c.sender, config: c.config ?? {}, compliance: c.compliance ?? {} });
  // each (campaign, segment) is one unit of work: a Claude finder call, then a Serper page, then site checks
  const units: { code: string; segment: string; city?: string }[] = [];
  for (const [code, segs] of Object.entries(SEGMENTS)) for (const segment of segs) units.push({ code, segment });
  // second pass by city for the big verticals, used only if the first pass falls short
  for (const code of ['IND-WEB-ELECTRONICS', 'IND-WEB-B2B', 'IND-AI-SME', 'IND-WEB-BATHROOM']) for (const city of CITIES) for (const segment of SEGMENTS[code].slice(0, 4)) units.push({ code, segment, city });
  let next = 0, stop = false;
  const worker = async () => {
    while (!stop && next < units.length) {
      const u = units[next++]; const camp = camps[u.code]; if (!camp) continue;
      if ((await count()) >= target) { stop = true; break; }
      try {
        const known = (await q(`select domain from companies order by created_at desc limit 300`)).map((r) => r.domain);
        const f = await runAgent(A.companyFinder, { campaign: campaignCtx(camp), segment: u.segment, region: u.city ? `${u.city}, India` : 'India', known_domains: known, want: 40 });
        const ids = await D.addFoundCompanies(f.output.companies);
        let serperIds: string[] = [];
        try { const r = await D.runSearch({ industry: u.segment.replace(/ brands?$/, ''), location: u.city ?? 'India', pages: 1 }, 'burst'); serperIds = (r.candidates as any[]).filter((c) => c.status === 'NEW' && c.enriched_at && (c.signals?.kind ?? 'COMPANY') === 'COMPANY').map((c) => c.id); } catch (e: any) { if (!/used up/.test(e.message)) log(`  serper: ${e.message}`); }
        const all = [...new Set([...ids, ...serperIds])];
        const a = all.length ? await D.addCandidates(all, u.code, 'burst', { run_chain: false }) : { added: [] };
        const n = (a.added as any[]).filter((x) => x.created).length; added += n;
        log(`find  ${u.code.padEnd(20)} ${(u.segment + (u.city ? ' / ' + u.city : '')).slice(0, 48).padEnd(48)} claude ${f.output.companies.length}, serper ${serperIds.length}, new ${n}, total ${await count()}   spent ${usd(await spentMicros())}`);
      } catch (e: any) {
        if (e instanceof SpendCapReached || /spend cap/.test(e.message)) { stop = true; log(`STOP: ${e.message}`); }
        else log(`find  ${u.code} ${u.segment}: ${String(e.message).slice(0, 160)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONC, 6) }, worker));
  log(`find done: ${added} added this run, ${await count()} total`);
}

async function screenAll() {
  const rows = await q(`select p.id, c.name from prospects p join companies c on c.id=p.company_id where p.campaign_id is not null and p.screen_score is null and not p.suppressed and p.status in ('NEW','RESEARCH_FURTHER','QUALIFIED') order by p.created_at`);
  log(`screen: ${rows.length} companies, ${CONC} at a time`);
  let next = 0, done = 0, stop = false;
  const worker = async () => { while (!stop && next < rows.length) { const r = rows[next++]; try { const s = await P.screenProspect(r.id); done++; if (done % 25 === 0 || s.screen_score >= 6) log(`screen [${done}/${rows.length}] ${r.name.slice(0, 32).padEnd(32)} pay ${s.screen.can_pay} problem ${s.screen.has_problem} -> ${s.screen_score}   spent ${usd(await spentMicros())}`); }
    catch (e: any) { if (e instanceof SpendCapReached || /spend cap/.test(e.message)) { stop = true; log(`STOP: ${e.message}`); } else { done++; log(`screen ${r.name}: ${String(e.message).slice(0, 140)}`); } } } };
  await Promise.all(Array.from({ length: CONC }, worker));
  const d = await q(`select count(*) filter (where screen_score >= 6)::int strong, count(*) filter (where screen_score between 4 and 5)::int fair, count(*) filter (where screen_score < 4)::int weak from prospects where screen_score is not null`);
  log(`screen done: strong ${d[0].strong}, fair ${d[0].fair}, weak ${d[0].weak}`);
}

async function deepOne(id: string, name: string) {
  const out: string[] = []; let p = await P.loadProspect(id);
  if (p.account_score == null || ['NEW', 'RESEARCHING', 'QUALIFYING'].includes(p.status)) { const c = await P.runChain(id); out.push(`${c.qualify?.verdict ?? '?'} ${c.qualify?.score ?? ''}`); p = await P.loadProspect(id); } else out.push(`${p.status} ${p.account_score}`);
  if (['QUALIFIED', 'PENDING_APPROVAL'].includes(p.status)) {
    if (!(p.contact && (p.contact.full_name || p.contact.first_name))) { const f = await P.findPeopleOnWeb(id); out.push(`${f.found} people`); p = await P.loadProspect(id); }
    if (p.contact && (p.contact.full_name || p.contact.first_name) && p.status === 'QUALIFIED') { try { await P.generateEmail(id); out.push('drafted'); } catch (e: any) { out.push(`no draft: ${String(e.message).slice(0, 60)}`); } }
  }
  return `${name.slice(0, 34).padEnd(34)} ${out.join(' | ')}`;
}
async function deep() {
  const only = arg('only');
  const rows = only && only !== 'true' ? await q(`select p.id, c.name from prospects p join companies c on c.id=p.company_id where p.id=$1`, [only])
    : await q(`select p.id, c.name from prospects p join companies c on c.id=p.company_id where not p.suppressed and p.campaign_id is not null and coalesce(p.screen_score, 0) >= $2
        and p.status in ('NEW','QUALIFIED','RESEARCH_FURTHER') and not exists (select 1 from email_drafts d where d.prospect_id=p.id and d.status in ('PENDING_APPROVAL','APPROVED','SENT_TO_SEQUENCER'))
        and not (p.status='RESEARCH_FURTHER' and p.account_score is not null) order by p.screen_score desc nulls last, p.created_at limit $1`, [DEEP_MAX, MIN_SCREEN]);
  log(`deep: ${rows.length} companies with screen >= ${MIN_SCREEN}, best first, ${CONC} at a time`);
  let next = 0, done = 0, stop = false;
  const worker = async () => { while (!stop && next < rows.length) { const { id, name } = rows[next++]; try { const line = await deepOne(id, name); done++; log(`deep [${done}/${rows.length}] ${line}   spent ${usd(await spentMicros())}`); }
    catch (e: any) { if (e instanceof SpendCapReached || /spend cap/.test(e.message)) { stop = true; log(`STOP: ${e.message}`); } else { done++; log(`deep [${done}/${rows.length}] ${name.slice(0, 34).padEnd(34)} error: ${String(e.message).slice(0, 140)}`); } } } };
  await Promise.all(Array.from({ length: CONC }, worker));
}

async function main() {
  if (env.aiProvider !== 'anthropic') throw new Error('Set AI_PROVIDER=anthropic for the burst.');
  log(`Claude funnel. Model ${env.aiModel}. Cap ${env.aiSpendCapUsd ? '$' + env.aiSpendCapUsd : 'none'}. Spent so far ${usd(await spentMicros())}.`);
  if (on('find')) await find();
  if (on('screen')) await screenAll();
  if (on('deep')) await deep();
  const t = (await q(`select count(*)::int total, count(*) filter (where screen_score >= 6)::int strong, count(*) filter (where status='QUALIFIED')::int qualified, count(*) filter (where status='PENDING_APPROVAL')::int drafts,
    (select count(*) from contacts where source='claude_web_search')::int people from prospects where campaign_id is not null`))[0];
  log(`done. spent ${usd(await spentMicros())}. companies ${t.total}, strong screen ${t.strong}, qualified ${t.qualified}, drafts to review ${t.drafts}, people found ${t.people}`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
