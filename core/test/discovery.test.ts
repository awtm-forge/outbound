process.env.DISCOVERY_SOURCE = 'google_cse'; process.env.GOOGLE_CSE_KEY = 'k'; process.env.GOOGLE_CSE_CX = 'cx'; process.env.DISCOVERY_DAILY_QUOTA = '3';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>; let D: typeof import('../src/discovery.ts'); let db: typeof import('../src/lib/db.ts');
const fixture = readFileSync(new URL('../fixtures/demo-electronics.html', import.meta.url), 'utf8');
const site = (name: string, extra = '') => `<html><head><title>${name} | Smart Home Devices India</title><meta name="viewport" content="width=device-width"></head><body><h1>${name}</h1><a href="/pages/contact">Contact</a><a class="btn" href="/collections/all">Shop now</a>
  <footer>Reach us: hello@${name.toLowerCase()}.in or +91 98451 20376. ${name} Pvt Ltd, Bengaluru. GSTIN 29ABCDE1234F1Z5 <a href="https://www.linkedin.com/company/${name.toLowerCase()}">LinkedIn</a>${extra}</footer><script src="//cdn.shopify.com/s/x.js"></script></body></html>`;
// Stubbed network: Google returns three sites, each site serves HTML; one is Wix, one unreachable.
const googleHits = [{ link: 'https://www.volthome.in/', title: 'VoltHome | Smart Home Devices India', snippet: 'Smart plugs' }, { link: 'https://brightwix.in/shop', title: 'BrightWix', snippet: 'wix store' }, { link: 'https://dead.example.net/', title: 'Dead', snippet: '' }, { link: 'https://www.amazon.in/s?k=plugs', title: 'Amazon', snippet: '' }];
const calls: string[] = [];
const fetchStub = (async (input: any) => { const u = String(input instanceof URL ? input.href : input.url ?? input); calls.push(u);
  if (u.startsWith('https://www.googleapis.com/')) return new Response(JSON.stringify({ items: new URL(u).searchParams.get('start') === '1' ? googleHits : [] }));
  if (u.includes('volthome.in')) return new Response(u.includes('contact') ? '<p>Founder: sales@volthome.in</p>' : site('VoltHome'));
  if (u.includes('brightwix.in')) return new Response(site('BrightWix').replace('cdn.shopify.com', 'static.wixstatic.com'));
  throw new Error('ECONNREFUSED'); }) as typeof fetch;
before(async () => { t = await bootstrap(); D = await import('../src/discovery.ts'); db = await import('../src/lib/db.ts'); });
after(async () => { await t.teardown(); });

test('query builder adds tech footprint and excludes marketplaces', () => {
  const qs = D.buildQuery({ industry: 'consumer electronics brand', location: 'India', technology: 'Shopify' });
  assert.match(qs, /consumer electronics brand India/); assert.match(qs, /powered by shopify/); assert.match(qs, /-site:amazon\.in/);
});
test('enrichment pulls platform, public emails, phone, GSTIN and links from the site and its contact page', async () => {
  const e = await D.enrichSite('https://www.volthome.in/', fetchStub);
  assert.equal(e.fetched, true); assert.equal(e.platform, 'Shopify'); assert.deepEqual(e.emails.sort(), ['hello@volthome.in', 'sales@volthome.in']);
  assert.deepEqual(e.phones, ['+919845120376']); assert.equal(e.gstin, '29ABCDE1234F1Z5'); assert.equal(e.country_guess, 'IN'); assert.match(e.linkedin_url!, /linkedin\.com\/company\/volthome/);
  const d = await D.enrichSite('https://dead.example.net/', fetchStub); assert.equal(d.fetched, false);
  const f = await D.enrichSite('https://demo-electronics.example/', fetchStub); assert.equal(f.platform, 'Shopify'); assert.equal(f.gstin, null);
  assert.ok(fixture.includes('Shopify'));
});
test('google search: hits enriched, marketplaces skipped, unreachable kept but unenriched, tech filter uses our fingerprint, repeat is cached', async () => {
  const s = await D.runSearch({ industry: 'smart home devices', location: 'India', pages: 2 }, 'tester', { fetchImpl: fetchStub });
  assert.equal(s.status, 'DONE'); assert.equal(s.source, 'google_cse');
  const domains = s.candidates.map((c: any) => c.domain).sort(); assert.deepEqual(domains, ['brightwix.in', 'dead.example.net', 'volthome.in']);
  const volt = s.candidates.find((c: any) => c.domain === 'volthome.in'); assert.equal(volt.platform, 'Shopify'); assert.ok(volt.emails.includes('sales@volthome.in'));
  assert.equal(s.candidates.find((c: any) => c.domain === 'dead.example.net').enriched_at, null);
  assert.equal(await D.quotaUsed('google_cse'), 1); // fewer than 10 hits on page 1, so page 2 is never requested
  const again = await D.runSearch({ industry: 'smart home devices', location: 'India', pages: 2 }, 'tester', { fetchImpl: fetchStub }); assert.equal(again.cached, true); assert.equal(again.id, s.id);
  assert.equal(await D.quotaUsed('google_cse'), 1);
  const wix = await D.runSearch({ industry: 'smart home devices', location: 'India', technology: 'wix', pages: 1 }, 'tester', { fetchImpl: fetchStub });
  assert.deepEqual(wix.candidates.map((c: any) => c.domain), ['brightwix.in', 'dead.example.net']); // unknown platform is not excluded
  assert.equal((await db.one(`select count(*) n from discovery_candidates where domain='volthome.in'`))!.n, '1');
});
test('serper adapter posts the built query with India locale and maps organic results', async () => {
  process.env.SERPER_API_KEY = 'sk-test'; const { env } = await import('../src/lib/env.ts'); (env as any).serperKey = 'sk-test';
  const seen: any[] = [];
  const stub = (async (u: any, init: any) => { seen.push({ u: String(u), init }); return new Response(JSON.stringify({ organic: [{ link: 'https://www.volthome.in/', title: 'VoltHome', snippet: 's' }] })); }) as typeof fetch;
  const hits = await new D.Serper(stub).search({ industry: 'smart plugs', location: 'India', technology: 'shopify' }, 1);
  assert.deepEqual(hits, [{ url: 'https://www.volthome.in/', title: 'VoltHome', snippet: 's' }]);
  assert.equal(seen[0].u, 'https://google.serper.dev/search'); assert.equal(seen[0].init.headers['X-API-KEY'], 'sk-test');
  const body = JSON.parse(seen[0].init.body); assert.equal(body.page, 2); assert.equal(body.gl, 'in'); assert.match(body.q, /powered by shopify/);
  assert.equal(await D.quotaUsed('serper'), 1);
});
test('daily quota is enforced per source', async () => {
  await D.runSearch({ industry: 'kitchen appliances', pages: 1 }, 'tester', { fetchImpl: fetchStub }); // 3rd query
  await assert.rejects(D.runSearch({ industry: 'water purifiers', pages: 1 }, 'tester', { fetchImpl: fetchStub }), /quota/);
  assert.equal((await db.one(`select status from discovery_searches order by created_at desc limit 1`))!.status, 'FAILED');
});
test('add to campaign: ingests with public email, runs chain, blocks a nameless draft, dedupes on re-add', async () => {
  const volt = await db.one(`select id from discovery_candidates where domain='volthome.in'`);
  const r = await D.addCandidates([volt!.id], 'IND-WEB-ELECTRONICS', 'tester', { run_chain: true });
  const a = r.added[0] as any; assert.ok(a.prospect_id); assert.equal(a.created, true); assert.equal(a.generic_email_only, true); // hello@ is a shared inbox, flagged for the operator
  assert.ok(['QUALIFIED', 'RESEARCH_FURTHER'].includes(a.chain.verdict)); assert.equal(a.chain.draft, null); // a clean stub site scores lower; no named contact so no draft either way
  const P = await import('../src/pipeline.ts'); const p = await P.loadProspect(a.prospect_id); assert.equal(p.status, a.chain.verdict); assert.equal(p.company.platform, 'Shopify'); assert.equal(p.company.vertical, 'DTC ecommerce: electronics'); // operator chose the campaign, so the company inherits its vertical
  assert.equal(p.score_breakdown.target_vertical_fit, 18); assert.equal(p.contact.email, 'hello@volthome.in');
  await assert.rejects(P.generateEmail(a.prospect_id, { force: true }), /no name/);
  await db.q(`update contacts set full_name='Meera Iyer', first_name='Meera', job_title='Founder' where id=$1`, [p.contact.id]);
  const em: any = await P.generateEmail(a.prospect_id, { force: true }); assert.match(em.body, /Hi Meera/);
  const again = await D.addCandidates([volt!.id], 'IND-WEB-ELECTRONICS', 'tester'); assert.equal((again.added[0] as any).created, false);
  assert.equal((await db.one(`select status from discovery_candidates where id=$1`, [volt!.id]))!.status, 'ADDED');
  const viaApi = await t.api('POST', '/api/discovery/candidates/add', { candidate_ids: [], campaign_code: 'IND-WEB-B2B' }); assert.equal(viaApi.status, 400);
});
test('discovery UI pages render and the results page shows candidates and pipeline state', async () => {
  const auth = { authorization: 'Basic ' + Buffer.from('tester:test-pass').toString('base64') };
  const list = await fetch(t.url + '/ui/discovery', { headers: auth }); assert.equal(list.status, 200); const h = await list.text(); assert.match(h, /smart home devices/); assert.match(h, /of 3 queries used today/);
  const s = await db.one(`select id from discovery_searches where status='DONE' order by created_at limit 1`);
  const res = await fetch(t.url + `/ui/discovery/${s!.id}`, { headers: auth }); const rh = await res.text();
  assert.match(rh, /volthome\.in/); assert.match(rh, /in pipeline/); assert.match(rh, /sales@volthome\.in/); assert.match(rh, /find founder/); assert.match(rh, /IND-WEB-ELECTRONICS/);
  assert.equal((await t.api('GET', '/api/discovery/quota')).body.used_today, 4);
});
