// The CRM screens: paged and filtered tables, header numbers, follow-ups, bulk changes, manual status, grouped search.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>; let P: typeof import('../src/pipeline.ts'); let db: typeof import('../src/lib/db.ts');
before(async () => { t = await bootstrap(); P = await import('../src/pipeline.ts'); db = await import('../src/lib/db.ts'); });
after(async () => { await t.teardown(); });

test('crm table: filters combine, pages hold, sorting works, and the API key cannot read it', async () => {
  const m = await t.person('rhea'); const k = await t.person('kunal');
  await P.ingest({ company: { name: 'Born Creators', website: 'borncreators.com', vertical: 'SME operations' }, contact: { full_name: 'Asha Rao', email: 'asha@borncreators.com' }, campaign_code: 'IND-AI-SME' });
  const { prospect } = await P.ingest({ company: { name: 'Wishlink', website: 'wishlink.com' }, contact: { full_name: 'Vik Shah', email: 'vik@wishlink.com' }, campaign_code: 'IND-AI-SME' });
  await db.q(`update prospects set status='QUALIFIED' where id=$1`, [prospect.id]);
  for (let i = 0; i < 23; i++) await m.call('POST', '/api/crm/companies', { name: `Filler ${String(i).padStart(2, '0')}`, website: `filler${i}.example.com`, owner_id: k.id });
  assert.equal((await t.api('GET', '/api/crm/companies/table')).status, 403, 'personal sign-in only');
  const all = await m.call('GET', '/api/crm/companies/table?size=10&sort=name');
  assert.equal(all.body.total, 25); assert.equal(all.body.rows.length, 10); assert.equal(all.body.rows[0].name, 'Born Creators');
  const p3 = await m.call('GET', '/api/crm/companies/table?size=10&page=3&sort=name'); assert.equal(p3.body.rows.length, 5);
  const q = await m.call('GET', '/api/crm/companies/table?q=asha'); assert.deepEqual(q.body.rows.map((r: any) => r.name), ['Born Creators'], 'a person’s name finds their company');
  const st = await m.call('GET', '/api/crm/companies/table?status=QUALIFIED'); assert.deepEqual(st.body.rows.map((r: any) => r.name), ['Wishlink']);
  const none = await m.call('GET', '/api/crm/companies/table?status=NONE'); assert.equal(none.body.total, 23, 'not in outbound');
  const mix = await m.call('GET', `/api/crm/companies/table?campaign=IND-AI-SME&owner=none`); assert.equal(mix.body.total, 2);
  const owned = await m.call('GET', `/api/crm/companies/table?owner=${k.id}&q=filler 0`); assert.equal(owned.body.total, 10);
  assert.equal(all.body.rows[0].campaign, 'IND-AI-SME'); assert.deepEqual(all.body.rows[0].people, ['Asha Rao']);
  assert.ok((await m.call('GET', '/api/crm/companies/table?sort=activity')).body.rows[0].last_at, 'the newest event is on the row');
});

test('crm: add with owner, campaign and note; duplicates refused by name; bulk assign and archive; manual status', async () => {
  const m = await t.person('sara'); const o = await t.person('omkar');
  const made = await m.call('POST', '/api/crm/companies', { name: 'Oye Creators', website: 'https://oyecreators.com', campaign_code: 'IND-AI-SME', note: 'Warm intro from Tara.' });
  assert.equal(made.status, 201);
  const d = (await m.call('GET', `/api/crm/companies/${made.body.id}`)).body;
  assert.equal(d.owner_id, m.id, 'the person adding it owns it'); assert.equal(d.prospects[0].campaign, 'IND-AI-SME', 'it joined the campaign as a prospect'); assert.equal(d.notes[0].text, 'Warm intro from Tara.');
  const dup = await m.call('POST', '/api/crm/companies', { name: 'Oye again', website: 'oyecreators.com' }); assert.equal(dup.status, 409); assert.match(dup.body.error, /Oye Creators already has oyecreators.com/);
  assert.equal((await m.call('POST', '/api/crm/companies', { name: 'X', website: 'x-co.example', campaign_code: 'NOPE' })).status, 400);
  const second = (await m.call('POST', '/api/crm/companies', { name: 'Monk-e', website: 'monk-e.in' })).body;
  const as = await m.call('POST', '/api/crm/companies/bulk', { ids: [made.body.id, second.id], action: 'assign', owner_id: o.id }); assert.equal(as.body.done, 2);
  assert.equal((await o.call('GET', '/api/notifications')).body.unread, 1, 'the new owner hears once');
  assert.equal((await m.call('GET', `/api/crm/companies/${second.id}`)).body.owner_name, 'Omkar');
  await m.call('POST', '/api/crm/companies/bulk', { ids: [second.id], action: 'archive' });
  assert.ok(!(await m.call('GET', '/api/crm/companies/table?q=monk')).body.rows.length, 'archived companies leave the list');
  assert.equal((await m.call('GET', '/api/crm/companies/table?archived=1&q=monk')).body.rows.length, 1, 'and can be shown');
  assert.equal((await m.call('POST', `/api/crm/companies/${second.id}/status`, { status: 'REJECTED' })).status, 409, 'not in outbound, no status to change');
  assert.equal((await m.call('POST', `/api/crm/companies/${made.body.id}/status`, { status: 'REJECTED' })).body.status, 'REJECTED');
  assert.equal((await m.call('POST', `/api/crm/companies/${made.body.id}/status`, { status: 'RESEARCH_FURTHER' })).body.status, 'RESEARCH_FURTHER', 'not a fit can go back to research');
  await db.q(`update prospects set status='CONTACTED' where company_id=$1`, [made.body.id]);
  assert.equal((await m.call('POST', `/api/crm/companies/${made.body.id}/status`, { status: 'RESEARCH_FURTHER' })).status, 409, 'once contacted it does not go back to research');
});

test('crm people and opportunities: phone, duplicate emails named, next action and close date, filters', async () => {
  const m = await t.person('nina');
  const co = (await m.call('POST', '/api/crm/companies', { name: 'Coherent Market Insights', website: 'coherentmarketinsights.com' })).body;
  const c1 = await m.call('POST', `/api/crm/companies/${co.id}/contacts`, { full_name: 'Ravi Kumar', email: 'ravi@cmi.example', phone: '+91 98450 12345', job_title: 'Founder' });
  assert.equal(c1.status, 201);
  assert.equal((await m.call('POST', `/api/crm/companies/${co.id}/contacts`, { full_name: 'Bad', phone: 'call me' })).status, 400);
  const dup = await m.call('POST', `/api/crm/companies/${co.id}/contacts`, { full_name: 'Ravi K', email: 'RAVI@cmi.example' }); assert.equal(dup.status, 409); assert.match(dup.body.error, /already Ravi Kumar at Coherent/);
  const people = await m.call('GET', '/api/crm/contacts/table?q=98450'); assert.equal(people.body.rows[0].full_name, 'Ravi Kumar'); assert.equal(people.body.rows[0].phone, '+91 98450 12345');
  const op = await m.call('POST', `/api/crm/companies/${co.id}/opportunities`, { stage: 'MEETING_BOOKED', value_paise: 800000000, expected_close: '2026-12-15', next_action: 'Send the research scope' });
  assert.equal(op.status, 201);
  const ops = await m.call('GET', '/api/crm/opportunities/table?state=open&q=research scope'); assert.equal(ops.body.rows[0].expected_close, '2026-12-15'); assert.equal(ops.body.rows[0].next_action, 'Send the research scope');
  await m.call('PATCH', `/api/crm/opportunities/${op.body.id}`, { next_action: 'Call Ravi', next_action_on: '2026-10-20' });
  assert.equal((await m.call('GET', '/api/crm/opportunities/table?stage=MEETING_BOOKED')).body.rows[0].next_action, 'Call Ravi');
  assert.equal((await m.call('GET', '/api/crm/opportunities/table?state=won')).body.total, 0);
  const s = (await m.call('GET', '/api/crm/search?q=ravi')).body; assert.equal(s.people[0].company, 'Coherent Market Insights');
  assert.equal((await m.call('GET', '/api/crm/search?q=coherent')).body.opportunities.length, 1);
});

test('crm follow-ups are tasks: due, late, done; they count in the header and show on the activity feed', async () => {
  const m = await t.person('dev');
  const co = (await m.call('POST', '/api/crm/companies', { name: 'THE UGC CREATORS', website: 'theugccreators.org' })).body;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const f1 = await m.call('POST', `/api/crm/companies/${co.id}/follow-ups`, { title: 'Share case study', due_date: today, priority: 'HIGH' });
  await m.call('POST', `/api/crm/companies/${co.id}/follow-ups`, { title: 'Check in', due_date: '2020-01-01' });
  assert.equal(f1.status, 201);
  const list = (await m.call('GET', '/api/crm/follow-ups?who=mine')).body;
  assert.deepEqual(list.map((x: any) => [x.title, x.overdue, x.today]), [['Check in', true, false], ['Share case study', false, true]]);
  assert.ok((await m.call('GET', '/api/todos')).body.some((x: any) => x.title === 'Share case study'), 'it is on Today as well');
  const sum = (await m.call('GET', '/api/crm/summary')).body;
  assert.ok(sum.follow_ups_due >= 2 && sum.follow_ups_overdue >= 1); assert.equal(sum.series.length, 8); assert.equal(sum.stages.length, 7);
  await m.call('PATCH', `/api/tasks/${f1.body.id}`, { status: 'DONE' });
  assert.ok(!(await m.call('GET', '/api/crm/follow-ups')).body.some((x: any) => x.id === f1.body.id), 'done follow-ups leave the list');
  const feed = (await m.call('GET', '/api/crm/activity?limit=20')).body.filter((a: any) => a.company_id === co.id).map((a: any) => a.action);
  for (const a of ['created', 'follow_up_added', 'follow_up_done']) assert.ok(feed.includes(a), `feed has ${a}`);
  const camps = (await m.call('GET', '/api/crm/campaigns?period=7d')).body; assert.ok(camps.length > 0 && 'replies' in camps[0]);
});
