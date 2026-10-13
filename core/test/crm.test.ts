import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>; let P: typeof import('../src/pipeline.ts'); let db: typeof import('../src/lib/db.ts');
before(async () => { t = await bootstrap(); P = await import('../src/pipeline.ts'); db = await import('../src/lib/db.ts'); });
after(async () => { await t.teardown(); });

test('crm: companies from outbound show up with their prospect; edits leave unsent fields alone; the domain is not editable', async () => {
  const { company, prospect } = await P.ingest({ company: { name: 'Kaveri Foods', website: 'https://kaverifoods.in', city: 'Mysuru', vertical: 'D2C food' }, contact: { full_name: 'Anil Rao', email: 'anil@kaverifoods.in' }, campaign_code: 'IND-WEB-ELECTRONICS' });
  const m = await t.person('meera');
  const list = await m.call('GET', '/api/crm/companies?q=kaveri'); assert.equal(list.body.length, 1); assert.equal(list.body[0].prospect.id, prospect.id); assert.equal(list.body[0].contacts, 1);
  assert.equal((await t.api('GET', '/api/crm/companies?q=anil')).body[0].id, company.id, 'the API key reads the CRM too, and contacts are searchable');
  const ed = await m.call('PATCH', `/api/crm/companies/${company.id}`, { city: 'Bengaluru', domain: 'evil.example' }); assert.equal(ed.status, 200);
  assert.equal(ed.body.city, 'Bengaluru'); assert.equal(ed.body.vertical, 'D2C food', 'not sent, not touched'); assert.equal(ed.body.domain, 'kaverifoods.in');
  const cleared = await m.call('PATCH', `/api/crm/companies/${company.id}`, { platform: '' }); assert.equal(cleared.body.platform, null);
  const dup = await m.call('POST', '/api/crm/companies', { name: 'Kaveri', website: 'www.KaveriFoods.in/about' }); assert.equal(dup.status, 409);
  const made = await m.call('POST', '/api/crm/companies', { name: 'Tara Studio', website: 'tarastudio.co' }); assert.equal(made.status, 201); assert.equal(made.body.domain, 'tarastudio.co');
  assert.equal((await db.one('select count(*)::int n from prospects where company_id=$1', [made.body.id]))!.n, 0, 'adding a company in the CRM does not put it in the outbound pipeline');
  const note = await m.call('POST', `/api/crm/companies/${company.id}/notes`, { text: 'Met Anil at the Mysuru meetup.' }); assert.equal(note.status, 201);
  const detail = await m.call('GET', `/api/crm/companies/${company.id}`); assert.equal(detail.body.notes[0].text, 'Met Anil at the Mysuru meetup.'); assert.equal(detail.body.notes[0].actor, 'meera');
  assert.equal(detail.body.prospects[0].campaign, 'IND-WEB-ELECTRONICS'); assert.deepEqual(detail.body.projects, []);
  const proj = await m.call('POST', '/api/projects', { name: 'Kaveri storefront', company_id: company.id });
  assert.equal((await m.call('GET', `/api/crm/companies/${company.id}`)).body.projects[0].id, proj.body.id, 'client work links back to the company');
});

test('crm: contacts respect the do-not-contact list; a changed email goes back to unverified', async () => {
  const m = await t.signIn();
  const co = (await m.call('POST', '/api/crm/companies', { name: 'Nila Crafts', website: 'nilacrafts.in' })).body;
  await db.q(`insert into suppression_list(domain,reason,source) values('blocked-crm.example','test','test')`);
  assert.equal((await m.call('POST', `/api/crm/companies/${co.id}/contacts`, { full_name: 'Bo', email: 'bo@blocked-crm.example' })).status, 409);
  assert.equal((await m.call('POST', `/api/crm/companies/${co.id}/contacts`, { full_name: 'Priya Nair', email: 'not-an-email' })).status, 400);
  const ct = await m.call('POST', `/api/crm/companies/${co.id}/contacts`, { full_name: 'Priya Nair', job_title: 'Founder', email: 'Priya@NilaCrafts.in', is_decision_maker: true }); assert.equal(ct.status, 201);
  assert.equal((await m.call('POST', `/api/crm/companies/${co.id}/contacts`, { full_name: 'Priya Again', email: 'priya@nilacrafts.in' })).status, 409, 'one contact per email');
  await db.q(`update contacts set email_verification_status='VALID' where id=$1`, [ct.body.id]);
  const same = await m.call('PATCH', `/api/crm/contacts/${ct.body.id}`, { job_title: 'CEO' }); assert.equal(same.body.email_verification_status, 'VALID'); assert.equal(same.body.email, 'priya@nilacrafts.in');
  const moved = await m.call('PATCH', `/api/crm/contacts/${ct.body.id}`, { email: 'priya.n@nilacrafts.in', full_name: 'Priya S Nair' }); assert.equal(moved.body.email_verification_status, 'UNVERIFIED');
  assert.equal((await db.one('select last_name from contacts where id=$1', [ct.body.id]))!.last_name, 'S Nair');
  assert.equal((await m.call('GET', '/api/crm/contacts?q=nila')).body[0].company, 'Nila Crafts');
});

test('crm: opportunities move their prospect forward only, lost needs a reason, money is whole paise, one deal per opportunity', async () => {
  const m = await t.signIn();
  const { company, prospect } = await P.ingest({ company: { name: 'Ruhi Home', website: 'ruhihome.in' }, campaign_code: 'IND-WEB-ELECTRONICS' });
  assert.equal((await m.call('POST', `/api/crm/companies/${company.id}/opportunities`, { value_paise: 12.5 })).status, 400);
  const o = await m.call('POST', `/api/crm/companies/${company.id}/opportunities`, { stage: 'MEETING_BOOKED', value_paise: '15000000' }); assert.equal(o.status, 201);
  assert.equal(o.body.prospect_id, prospect.id, 'uses the company\'s prospect'); assert.equal((await P.loadProspect(prospect.id)).status, 'MEETING');
  assert.equal((await m.call('POST', `/api/crm/companies/${company.id}/opportunities`, {})).status, 409, 'one open opportunity per company');
  const prop = await m.call('PATCH', `/api/crm/opportunities/${o.body.id}`, { stage: 'PROPOSAL_SENT' }); assert.equal(prop.body.value_paise, '15000000');
  assert.equal((await P.loadProspect(prospect.id)).status, 'PROPOSAL');
  await m.call('PATCH', `/api/crm/opportunities/${o.body.id}`, { stage: 'MEETING_HELD' });
  assert.equal((await P.loadProspect(prospect.id)).status, 'PROPOSAL', 'the prospect never moves back');
  assert.equal((await m.call('PATCH', `/api/crm/opportunities/${o.body.id}`, { stage: 'LOST' })).status, 400);
  const won = await m.call('PATCH', `/api/crm/opportunities/${o.body.id}`, { stage: 'WON' }); assert.equal(won.body.stage, 'WON'); assert.equal((await P.loadProspect(prospect.id)).status, 'WON');
  assert.equal((await m.call('PUT', `/api/crm/opportunities/${o.body.id}/deal`, { revenue_paise: 100.5 })).status, 400);
  const d1 = await m.call('PUT', `/api/crm/opportunities/${o.body.id}/deal`, { revenue_paise: '15000000', cost_paise: 4000000, signed_at: '2026-10-10' });
  assert.equal(d1.body.gross_profit_paise, '11000000'); assert.equal(d1.body.signed_at, '2026-10-10');
  const d2 = await m.call('PUT', `/api/crm/opportunities/${o.body.id}/deal`, { revenue_paise: '16000000', cost_paise: '4000000', status: 'DELIVERING' }); assert.equal(d2.body.id, d1.body.id);
  assert.equal((await db.one('select count(*)::int n from deals where opportunity_id=$1', [o.body.id]))!.n, 1);
  // a company with no prospect gets one outside any campaign
  const solo = (await m.call('POST', '/api/crm/companies', { name: 'Referral Co', website: 'referral.example' })).body;
  const o2 = await m.call('POST', `/api/crm/companies/${solo.id}/opportunities`, { stage: 'REPLIED', owner: 'rahul' }); assert.equal(o2.status, 201);
  const pr = await db.one('select campaign_id, status, source from prospects where id=$1', [o2.body.prospect_id]); assert.equal(pr!.campaign_id, null); assert.equal(pr!.source, 'crm'); assert.equal(pr!.status, 'REPLIED');
  const lost = await m.call('PATCH', `/api/crm/opportunities/${o2.body.id}`, { stage: 'LOST', lost_reason: 'Went with an in-house team' }); assert.equal(lost.body.lost_reason, 'Went with an in-house team');
  assert.equal((await P.loadProspect(o2.body.prospect_id)).status, 'LOST');
  const all = await m.call('GET', '/api/crm/opportunities'); assert.equal(all.body.find((x: any) => x.id === o.body.id).deal.revenue_paise, '16000000');
  const acts = await db.q(`select action from activities where entity_type='opportunity' and entity_id=$1 order by created_at`, [o.body.id]);
  assert.deepEqual(acts.map((a) => a.action), ['opened', 'stage_changed', 'stage_changed', 'stage_changed', 'deal_recorded', 'deal_updated']);
});

test('one opportunity per prospect: a reply then a booked meeting, or two meetings, never make a second', async () => {
  const { company, prospect } = await P.ingest({ company: { name: 'Once Co', website: 'once.example' }, campaign_code: 'IND-WEB-ELECTRONICS' });
  await db.q(`insert into opportunities(prospect_id,company_id,campaign_id,stage) values($1,$2,$3,'REPLIED')`, [prospect.id, company.id, prospect.campaign_id]);
  const m1 = await P.createMeeting(prospect.id); const m2 = await P.createMeeting(prospect.id);
  assert.equal(m1.opportunity_id, m2.opportunity_id);
  const opps = await db.q('select stage from opportunities where prospect_id=$1', [prospect.id]); assert.equal(opps.length, 1); assert.equal(opps[0].stage, 'MEETING_BOOKED');
  assert.equal((await db.q('select 1 from meetings where opportunity_id=$1', [m1.opportunity_id])).length, 2, 'both meetings sit on the one opportunity');
  await assert.rejects(db.q(`insert into opportunities(prospect_id,company_id,stage) values($1,$2,'REPLIED')`, [prospect.id, company.id]), /unique|duplicate/);
});
test('adding a decision maker checks the email\'s own domain against the do-not-contact list, not only the company\'s', async () => {
  const s = await t.signIn();
  await db.q(`insert into suppression_list(domain,reason,source) values('gone-elsewhere.example','test','test') on conflict do nothing`);
  const { prospect } = await P.ingest({ company: { name: 'Fresh Co', website: 'fresh.example' }, campaign_code: 'IND-WEB-ELECTRONICS' });
  assert.equal((await s.call('POST', `/api/prospects/${prospect.id}/contact`, { full_name: 'Moved Person', email: 'moved@gone-elsewhere.example' })).status, 409);
  assert.equal((await s.call('POST', `/api/prospects/${prospect.id}/contact`, { full_name: 'Fine Person', email: 'fine@fresh.example' })).status, 200);
});
