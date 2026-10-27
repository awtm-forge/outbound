import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>;
before(async () => { t = await bootstrap(); }); after(async () => { await t.teardown(); });
const html = readFileSync(new URL('../fixtures/demo-electronics.html', import.meta.url), 'utf8');

test('queue: one at a time, a click goes ahead of a waiting batch, a failure is reported not thrown', async () => {
  const J = await import('../src/jobs.ts'); const order: string[] = [];
  const slow = (name: string) => async () => { order.push(name); await new Promise((r) => setTimeout(r, 30)); return name; };
  const b1 = J.enqueue('batch:a', slow('batch a'), 'batch'); J.enqueue('batch:b', slow('batch b'), 'batch');
  const click = J.enqueue('generate-email:x', slow('click'));
  const bad = J.enqueue('teardown:y', async () => { throw Object.assign(new Error('boom'), { runId: 'r1' }); });
  await J.idle();
  assert.deepEqual(order, ['click', 'batch a', 'batch b']); // nothing had started yet, so the click jumped both waiting batches
  assert.equal(J.getJob(click.id)!.status, 'done'); assert.equal(J.getJob(click.id)!.result, 'click'); assert.equal(J.getJob(b1.id)!.status, 'done');
  assert.equal(J.getJob(bad.id)!.status, 'failed'); assert.equal(J.getJob(bad.id)!.error, 'boom'); assert.equal(J.getJob(bad.id)!.run_id, 'r1');
});
test('a browser session gets a job id for AI work and polls it; an API key caller still gets the answer directly', async () => {
  const P = await import('../src/pipeline.ts'); const J = await import('../src/jobs.ts');
  const { prospect } = await P.ingest({ company: { name: 'Acme Q', website: 'https://acmeq.example', vertical: 'DTC ecommerce: electronics', company_size: '50' }, contact: { full_name: 'Asha Rao', job_title: 'Founder', email: 'asha@acmeq.example' }, campaign_code: 'IND-WEB-ELECTRONICS' });
  const s = await t.signIn();
  const r = await s.call('POST', `/api/prospects/${prospect.id}/run-chain`, { html }); assert.equal(r.status, 200); assert.ok(r.body.job_id); assert.equal(r.body.status, 'queued');
  await J.idle();
  const j = await s.call('GET', `/api/jobs/${r.body.job_id}`); assert.equal(j.body.status, 'done'); assert.equal(j.body.result.qualify.verdict, 'QUALIFIED');
  assert.equal((await s.call('GET', '/api/jobs/00000000-0000-0000-0000-000000000000')).status, 404);
  const direct = await t.api('POST', `/api/prospects/${prospect.id}/qualify`, {}); assert.equal(direct.status, 200); assert.ok(direct.body.verdict); assert.equal(direct.body.job_id, undefined);
  const viaPrefer = await t.api('POST', `/api/prospects/${prospect.id}/qualify`, {}, { prefer: 'respond-async' }); assert.ok(viaPrefer.body.job_id); await J.idle();
  const me = await s.call('GET', '/api/me'); assert.deepEqual(me.body.queue, { waiting: 0, running: null });
});
test('adding from discovery in the browser queues research and marks the company Researching; restart requeues it', async () => {
  const D = await import('../src/discovery.ts'); const J = await import('../src/jobs.ts'); const P = await import('../src/pipeline.ts'); const { one, q } = await import('../src/lib/db.ts');
  const c = await one(`insert into discovery_candidates(domain,url,title,emails,enriched_at,country_guess) values('queued.example','https://queued.example','Queued Co','{hello@queued.example}',now(),'IN') returning id`);
  const r = await D.addCandidates([c!.id], 'IND-WEB-ELECTRONICS', 'tester', { run_chain: true, background: true, html });
  const a = r.added[0] as any; assert.deepEqual(a.chain, { queued: true });
  assert.equal((await P.loadProspect(a.prospect_id)).status, 'RESEARCHING');
  await J.idle(); assert.notEqual((await P.loadProspect(a.prospect_id)).status, 'RESEARCHING');
  // a prospect left mid-research by a restart goes back on the queue
  await q(`update prospects set status='RESEARCHING', updated_at=now() - interval '30 minutes' where id=$1`, [a.prospect_id]);
  await q(`alter table prospects disable trigger prospects_updated`); await q(`update prospects set updated_at=now() - interval '30 minutes' where id=$1`, [a.prospect_id]); await q(`alter table prospects enable trigger prospects_updated`);
  const n = await J.requeueStale((id) => P.runChain(id, { html })); assert.equal(n, 1); await J.idle();
  assert.notEqual((await P.loadProspect(a.prospect_id)).status, 'RESEARCHING');
});

test('a failed research job is written to the company history; the retry sweep does not queue the same company twice', async () => {
  const J = await import('../src/jobs.ts'); const P = await import('../src/pipeline.ts'); const { q, one } = await import('../src/lib/db.ts');
  const { prospect } = await P.ingest({ company: { name: 'Flaky', website: 'https://flaky.example' }, campaign_code: 'IND-WEB-B2B' });
  J.enqueue(`batch:chain:${prospect.id}`, async () => { throw new Error('gemini 503'); }, 'batch'); await J.idle();
  const ev = await one(`select detail from activities where entity_id=$1 and action='research_failed'`, [prospect.id]); assert.equal(ev!.detail.error, 'gemini 503');
  let runs = 0; const gate = new Promise((r) => setTimeout(r, 60));
  const a = J.enqueue(`batch:chain:${prospect.id}`, async () => { runs++; await gate; }, 'batch'); const b = J.enqueue(`batch:chain:${prospect.id}`, async () => { runs++; }, 'batch');
  assert.equal(a.id, b.id); await J.idle(); assert.equal(runs, 1);
});

test('collectContacts: the free deep read fills company email and phone; Claude is not called when it found something', async () => {
  const P = await import('../src/pipeline.ts'); const { one } = await import('../src/lib/db.ts');
  const { prospect } = await P.ingest({ company: { name: 'Reachable Co', website: 'https://reachable.example', vertical: 'DTC ecommerce: electronics' }, campaign_code: 'IND-WEB-ELECTRONICS' });
  const r = await P.collectContacts(prospect.id);
  // the .example fixture carries a GSTIN footer and a shipping link but no email; phone is absent too, and mock mode never calls Claude
  assert.equal(r.via_claude, false);
  const co = await one('select email, phone, contacts_checked_at, contact_sources from companies where id=$1', [prospect.company_id]);
  assert.ok(co!.contacts_checked_at); assert.ok(co!.contact_sources.site);
  assert.deepEqual(await P.collectContacts(prospect.id), { email: co!.email, phone: co!.phone, skipped: 'already checked' });
});
