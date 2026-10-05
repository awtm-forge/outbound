import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>; let P: typeof import('../src/pipeline.ts'); let db: typeof import('../src/lib/db.ts');
const html = readFileSync(new URL('../fixtures/demo-electronics.html', import.meta.url), 'utf8');
before(async () => { t = await bootstrap(); P = await import('../src/pipeline.ts'); db = await import('../src/lib/db.ts'); });
after(async () => { await t.teardown(); });

const company = (n = 1) => ({ company: { name: `Acme ${n}`, website: `https://www.acme${n}.example/`, country: 'IN', vertical: 'DTC ecommerce: electronics', company_size: '50' }, contact: { full_name: 'Asha Rao', job_title: 'Founder', email: `asha@acme${n}.example` }, campaign_code: 'IND-WEB-ELECTRONICS' });

test('migrations applied once and schema has every required table', async () => {
  const rows = await db.q(`select table_name from information_schema.tables where table_schema='public'`); const names = rows.map((r) => r.table_name);
  for (const n of ['companies','contacts','prospects','research','campaigns','campaign_memberships','email_events','replies','opportunities','meetings','proposals','deals','activities','suppression_list','proof_assets','ai_runs','workflow_runs']) assert.ok(names.includes(n), n);
  assert.equal((await db.q('select * from schema_migrations')).length, 2);
});
test('prospect creation dedupes on normalized domain and (company, campaign)', async () => {
  const a = await P.ingest(company()); const b = await P.ingest({ ...company(), company: { ...company().company, website: 'acme1.example' } });
  assert.equal(a.created, true); assert.equal(b.created, false); assert.equal(a.prospect.id, b.prospect.id);
  assert.equal((await db.q(`select count(*) n from companies where domain='acme1.example'`))[0].n, '1');
  const viaApi = await t.api('POST', '/api/prospects', company()); assert.equal(viaApi.status, 200); assert.equal(viaApi.body.created, false);
});
test('database constraints: status enum, score range, suppression needs email or domain, deals profit is generated', async () => {
  const { prospect: pr } = await P.ingest(company(99));
  await assert.rejects(db.q(`update prospects set status='BOGUS' where id=$1`, [pr.id]), /check/);
  await assert.rejects(db.q(`update prospects set account_score=101 where id=$1`, [pr.id]), /check/);
  await assert.rejects(P.ingest({ ...company(99), contact: { ...company(99).contact, email: 'other@acme99.example' } }).then(() => db.q(`insert into prospects(company_id,campaign_id) values($1,$2)`, [pr.company_id, pr.campaign_id])), /unique|duplicate/);
  await assert.rejects(db.q(`insert into suppression_list(reason,source) values('x','y')`), /check/);
  const p = (await db.q('select id, company_id, campaign_id from prospects limit 1'))[0];
  const o = (await db.one(`insert into opportunities(prospect_id,company_id,campaign_id,stage) values($1,$2,$3,'WON') returning id`, [p.id, p.company_id, p.campaign_id]))!;
  const d = (await db.one(`insert into deals(opportunity_id,revenue_paise,cost_paise) values($1,500000,120000) returning gross_profit_paise`, [o.id]))!;
  assert.equal(d.gross_profit_paise, '380000');
  await assert.rejects(db.q('delete from opportunities where id=$1', [o.id]), /foreign key/); await db.q('delete from deals where opportunity_id=$1', [o.id]); await db.q('delete from opportunities where id=$1', [o.id]);
});
test('scoring engine is config driven: clamps per criterion and applies thresholds', async () => {
  const { score } = await import('../src/lib/scoring.ts');
  const full = score({ target_vertical_fit: 99, business_maturity: 15, digital_importance: 15, visible_problem: 15, commercial_fit: 15, proof_relevance: 10, decision_maker_accessibility: 5, timing_trigger: 5 });
  assert.equal(full.total, 100); assert.equal(full.breakdown.target_vertical_fit, 20); assert.equal(full.verdict, 'QUALIFIED');
  assert.equal(score({ target_vertical_fit: 20, business_maturity: 15, digital_importance: 15, visible_problem: 5 }).verdict, 'RESEARCH_FURTHER');
  assert.equal(score({ target_vertical_fit: 20 }).verdict, 'REJECTED');
});
test('agent runner validates output, records failures, and caches identical inputs', async () => {
  const { runAgent, AgentError, parseJson } = await import('../src/lib/ai.ts'); const { z } = await import('zod');
  const bad = { name: 'bad_agent', version: '0', input: z.object({ a: z.number() }), output: z.object({ b: z.string() }), system: '', user: () => '', mock: () => ({ b: 42 as any }) };
  await assert.rejects(runAgent(bad, { a: 1 }), AgentError);
  const row = await db.one(`select valid, error from ai_runs where agent='bad_agent'`); assert.equal(row!.valid, false); assert.match(row!.error, /Expected string/);
  const good = { ...bad, name: 'good_agent', mock: () => ({ b: 'ok' }) };
  const r1 = await runAgent(good, { a: 1 }); const r2 = await runAgent(good, { a: 1 }); const r3 = await runAgent(good, { a: 2 });
  assert.equal(r1.cached, false); assert.equal(r2.cached, true); assert.equal(r3.cached, false);
  assert.deepEqual(parseJson('```json\n{"x":1}\n```'), { x: 1 }); assert.deepEqual(parseJson('Sure: {"x":[1]} done'), { x: [1] });
});
test('research → problem → qualify → email → approval → sync, with proof guard and status gates', async () => {
  const { prospect } = await P.ingest(company(2)); const id = prospect.id;
  await assert.rejects(P.generateEmail(id), /not QUALIFIED/);
  await assert.rejects(P.identifyProblem(id), /run research first/);
  const r = await P.research(id, { html }); assert.equal(r.site.fetched, true); assert.ok(r.site.platform_signals.includes('Shopify'));
  await P.analyzeWebsite(id); const pr = await P.identifyProblem(id);
  const labels = await db.q('select id,label from proof_assets'); for (const pid of pr.capability.proof_ids) assert.equal(labels.find((l) => l.id === pid)!.label, 'VERIFIED');
  assert.ok(!pr.capability.proof_ids.includes('qclobby-app'));
  const qf = await P.qualify(id); assert.equal(qf.verdict, 'QUALIFIED'); assert.ok(qf.score >= 70);
  const em: any = await P.generateEmail(id); assert.ok(em.draft_id); assert.match(em.body, /Hi Asha/); assert.doesNotMatch(em.body, /40%|\$5,000|qclobby/i);
  const again: any = await P.generateEmail(id); assert.equal(again.reused, true);
  assert.equal((await P.loadProspect(id)).status, 'PENDING_APPROVAL');
  await assert.rejects(P.syncToSaleshandy(em.draft_id), /only APPROVED/);
  const edited = await P.decideDraft(em.draft_id, 'EDIT', 'rahul', { body: 'Hi Asha, edited body.\n\nAyush' }); assert.equal(edited.status, 'APPROVED');
  const d = await db.one('select * from email_drafts where id=$1', [em.draft_id]); assert.equal(d!.body_final, 'Hi Asha, edited body.\n\nAyush'); assert.match(d!.body_original, /Hi Asha,\n/); assert.equal(d!.approver, 'rahul');
  await assert.rejects(P.decideDraft(em.draft_id, 'APPROVE', 'x'), /draft is APPROVED/);
  const sync = await P.syncToSaleshandy(em.draft_id); assert.equal(sync.mode, 'mock');
  const { saleshandy } = await import('../src/adapters/saleshandy.ts'); const sent = (saleshandy() as any).sent; assert.equal(sent.at(-1).body, 'Hi Asha, edited body.\n\nAyush');
  const twice = await P.syncToSaleshandy(em.draft_id); assert.equal((twice as any).already, true); assert.equal(sent.length, 1);
  const acts = await db.q(`select action from activities where entity_id=$1 order by created_at`, [em.draft_id]); assert.deepEqual(acts.map((a) => a.action), ['drafted', 'edit', 'synced']);
});
test('reject and research-more paths move the prospect', async () => {
  const { prospect } = await P.ingest(company(3)); await P.runChain(prospect.id, { html });
  const d = await db.one(`select id from email_drafts where prospect_id=$1`, [prospect.id]);
  await P.decideDraft(d!.id, 'RESEARCH_MORE', 'ayush', { reason: 'need the product page' }); assert.equal((await P.loadProspect(prospect.id)).status, 'RESEARCH_FURTHER');
  const em: any = await P.generateEmail(prospect.id, { force: true }); await P.decideDraft(em.draft_id, 'REJECT', 'ayush', { reason: 'not a fit' }); assert.equal((await P.loadProspect(prospect.id)).status, 'LOST');
});
test('webhook: secret required, events deduped, unsubscribe and bounce suppress and cascade', async () => {
  const { prospect, contact } = await P.ingest(company(4)); await P.runChain(prospect.id, { html });
  const d = await db.one(`select id from email_drafts where prospect_id=$1`, [prospect.id]); await P.decideDraft(d!.id, 'APPROVE', 'ayush'); await P.syncToSaleshandy(d!.id);
  const noSecret = await fetch(t.url + '/webhooks/saleshandy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.equal(noSecret.status, 401);
  const post = (b: unknown) => fetch(t.url + '/webhooks/saleshandy', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': 'test-webhook-secret' }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const sent = await post({ event: 'email_sent', event_id: 'ev-1', email: contact.email }); assert.equal(sent.status, 200); assert.equal(sent.body.processed[0].event_type, 'SENT');
  const dup = await post({ event: 'email_sent', event_id: 'ev-1', email: contact.email }); assert.equal(dup.body.processed[0].duplicate, true);
  assert.equal((await P.loadProspect(prospect.id)).status, 'CONTACTED');
  const unsub = await post({ event: 'unsubscribed', event_id: 'ev-2', email: contact.email }); assert.equal(unsub.status, 200);
  const p = await P.loadProspect(prospect.id); assert.equal(p.suppressed, true); assert.equal(p.status, 'SUPPRESSED');
  assert.equal((await db.one(`select status from campaign_memberships where prospect_id=$1`, [prospect.id]))!.status, 'SUPPRESSED');
  const { isSuppressed } = await import('../src/lib/suppression.ts'); assert.equal((await isSuppressed(contact.email)).suppressed, true);
  // re-ingest after opt-out: lands suppressed, never re-added to a sequence
  const re = await P.ingest({ ...company(4), campaign_code: 'IND-WEB-BATHROOM' }); assert.equal(re.prospect.suppressed, true);
  await assert.rejects(P.research(re.prospect.id, { html }), /suppressed/);
  const { prospect: p5, contact: c5 } = await P.ingest(company(5));
  await post({ event: 'bounced', event_id: 'ev-3', email: c5.email });
  assert.equal((await db.one('select email_verification_status s from contacts where id=$1', [c5.id]))!.s, 'INVALID'); assert.equal((await P.loadProspect(p5.id)).suppressed, true);
});
test('reply classification: value request opens opportunity, unsubscribe wording suppresses', async () => {
  const { prospect, contact } = await P.ingest(company(6)); await P.runChain(prospect.id, { html });
  const d = await db.one(`select id from email_drafts where prospect_id=$1`, [prospect.id]); await P.decideDraft(d!.id, 'APPROVE', 'ayush'); await P.syncToSaleshandy(d!.id);
  const r1 = await P.ingestWebhook({ event: 'replied', event_id: 'r-1', email: contact.email, body: 'Sure, send them over.' });
  const c1 = await P.classifyReply(r1.reply_id!); assert.equal(c1.classification, 'VALUE_REQUEST'); assert.equal(c1.priority, 'HIGH');
  assert.ok(await db.one('select id from opportunities where prospect_id=$1', [prospect.id]));
  const td: any = await P.generateTeardown(r1.reply_id!); assert.equal(td.findings.length, 2); assert.equal((await P.generateTeardown(r1.reply_id!) as any).reused, true);
  const r2 = await P.ingestWebhook({ event: 'replied', event_id: 'r-2', email: contact.email, body: 'Please remove me from your list.' });
  const c2 = await P.classifyReply(r2.reply_id!); assert.equal(c2.classification, 'UNSUBSCRIBE'); assert.equal((await P.loadProspect(prospect.id)).suppressed, true);
});
test('proposal never invents price or deadline; integer paise enforced', async () => {
  const { prospect } = await P.ingest(company(7)); const m = await P.createMeeting(prospect.id);
  await assert.rejects(P.draftProposal(m.meeting_id), /post-meeting/);
  await P.postMeeting(m.meeting_id, 'Pain: slow site. Goal: faster. Scope: home page. Timeline: a month. Next step: proposal.');
  await assert.rejects(P.draftProposal(m.meeting_id, { price_paise: 1.5 }), /integer/);
  const p = await P.draftProposal(m.meeting_id, {}); assert.equal(p.draft.investment, 'TO BE CONFIRMED BY FOUNDERS'); assert.equal(p.draft.timeline, 'TO BE CONFIRMED'); assert.deepEqual(p.draft.deliverables, ['TO BE CONFIRMED']);
  const p2 = await P.draftProposal(m.meeting_id, { price_paise: 25000000, deadline: '15 Dec 2026' }); assert.match(p2.draft.investment, /2,50,000/); assert.equal(p2.draft.timeline, '15 Dec 2026');
});
test('HTTP: auth, idempotency replay, missing key, 404, dashboard basic auth, health, metrics', async () => {
  assert.equal((await fetch(t.url + '/api/prospects')).status, 401);
  assert.equal((await t.api('POST', '/api/prospects', company(8), { 'idempotency-key': '' })).status, 400);
  const key = crypto.randomUUID(); const a = await t.api('POST', '/api/prospects', company(9), { 'idempotency-key': key }); const b = await t.api('POST', '/api/prospects', company(9), { 'idempotency-key': key });
  assert.equal(a.status, 201); assert.equal(b.status, 201); assert.equal(b.headers.get('idempotent-replay'), 'true'); assert.deepEqual(a.body, b.body);
  assert.equal((await t.api('GET', '/api/prospects/00000000-0000-0000-0000-000000000000')).status, 404);
  assert.equal((await fetch(t.url + '/')).status, 401);
  const dash = await fetch(t.url + '/', { headers: { authorization: 'Basic ' + Buffer.from('tester:test-pass').toString('base64') } }); assert.equal(dash.status, 200); const htmlOut = await dash.text(); assert.match(htmlOut, /Emails awaiting approval/); assert.match(htmlOut, /Replies awaiting action/); assert.match(htmlOut, /Teardowns awaiting approval/); assert.match(htmlOut, /Meeting briefs/); assert.match(htmlOut, /Campaign summary/);
  const h = await (await fetch(t.url + '/health')).json(); assert.equal(h.status, 'ok'); assert.equal(h.db, 'ok');
  const m = await t.api('GET', '/api/metrics/campaigns'); assert.equal(m.status, 200); assert.ok(m.body.find((c: any) => c.code === 'IND-WEB-ELECTRONICS').accounts_found >= 1);
  const wf = await t.api('POST', '/api/workflow-runs/log-error', { workflow: '03_research_account', error: 'boom' }); assert.equal(wf.status, 200);
  const f = await t.api('GET', '/api/ops/failures'); assert.equal(f.body.workflows.length, 1);
});
test('dashboard form approval posts work and are audited with the basic-auth user as approver', async () => {
  const { prospect } = await P.ingest(company(10)); await P.runChain(prospect.id, { html });
  const d = await db.one(`select id from email_drafts where prospect_id=$1`, [prospect.id]);
  const res = await fetch(t.url + `/ui/drafts/${d!.id}/decision`, { method: 'POST', redirect: 'manual', headers: { authorization: 'Basic ' + Buffer.from('tester:test-pass').toString('base64'), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ action: 'APPROVE', subject: 's', body: 'b' }) });
  assert.equal(res.status, 303); assert.equal((await db.one('select approver from email_drafts where id=$1', [d!.id]))!.approver, 'tester');
});
test('end-to-end demo runs clean and twice (idempotent)', async () => {
  const { demo } = await import('../src/demo.ts');
  const r1 = await demo(true); const r2 = await demo(true); assert.equal(r1.prospect_id, r2.prospect_id);
  assert.equal((await db.one(`select count(*) n from companies where domain='demo-electronics.example'`))!.n, '1');
});
