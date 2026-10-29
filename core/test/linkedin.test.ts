import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>;
const html = readFileSync(new URL('../fixtures/demo-electronics.html', import.meta.url), 'utf8');
before(async () => { t = await bootstrap(); }); after(async () => { await t.teardown(); });
const co = (n: number, extra: any = {}) => ({ company: { name: `Linked ${n}`, website: `https://linked${n}.example`, vertical: 'DTC ecommerce: electronics', company_size: '50' }, contact: { full_name: `Person ${n}`, job_title: 'Founder', email: `p${n}@linked${n}.example`, ...extra }, campaign_code: 'IND-WEB-ELECTRONICS' });

test('build fills the day up to the cap, best first, a person with a profile before a company page, never twice', async () => {
  const P = await import('../src/pipeline.ts'); const L = await import('../src/linkedin.ts'); const { q } = await import('../src/lib/db.ts');
  const ids: string[] = [];
  for (let n = 1; n <= 4; n++) { const { prospect } = await P.ingest(co(n, n === 1 ? { linkedin_url: 'https://www.linkedin.com/in/person-1' } : {})); await P.runChain(prospect.id, { html }); ids.push(prospect.id); }
  await q(`update prospects set account_score=90 where id=$1`, [ids[3]]); // best score but no profile link
  const r = await L.build('ayush', 2);
  assert.equal(r.queued, 2); assert.equal(r.cap, L.DAILY_CAP);
  const today = await L.today('ayush'); const chosen = today.items.map((i: any) => i.company).sort();
  assert.deepEqual(chosen, ['Linked 1', 'Linked 4']); // the one with a profile link, then the best score; 2 and 3 wait
  assert.equal(today.items.find((i: any) => i.company === 'Linked 1')!.target_kind, 'PERSON'); assert.equal(today.items.find((i: any) => i.company === 'Linked 4')!.target_kind, 'SEARCH');
  assert.ok(today.items.every((i: any) => i.note.length <= 300));
  const again = await L.build('ayush', 2); assert.equal(again.queued, 0); assert.equal(again.already_today, 2);
  await assert.rejects(L.queueOne(ids[0], 'nobody'), /sender must be/);
  const dup = await L.queueOne(ids[0], 'ayush'); assert.equal((dup as any).reused, true);
});
test('status moves forward only; the follow-up goes after acceptance; a sent company is not queued for the other founder', async () => {
  const L = await import('../src/linkedin.ts'); const { one } = await import('../src/lib/db.ts');
  const item = (await L.today('ayush')).items[0];
  await assert.rejects(L.setStatus(item.id, 'ACCEPTED', 'tester'), /cannot go from QUEUED/);
  await assert.rejects(L.setStatus(item.id, 'SENT', 'tester', { follow_up_sent: true }), /only after they accept/);
  await L.setStatus(item.id, 'SENT', 'tester'); await L.setStatus(item.id, 'ACCEPTED', 'tester');
  assert.equal((await one('select last_contacted_at from prospects where id=$1', [item.prospect_id]))!.last_contacted_at != null, true);
  const fu = await L.setStatus(item.id, 'ACCEPTED', 'tester', { follow_up_sent: true }); assert.equal(fu.follow_up_sent, true);
  await assert.rejects(L.queueOne(item.prospect_id, 'rahul'), /already written to this company/);
  await L.setStatus(item.id, 'REPLIED', 'tester'); await assert.rejects(L.setStatus(item.id, 'SKIPPED', 'tester'), /cannot go from REPLIED/);
  const counts = (await L.today('ayush')).counts; assert.equal(counts.replied, 1);
});
test('pushy or over-long wording is refused, in edits too', async () => {
  const L = await import('../src/linkedin.ts');
  const item = (await L.today('ayush')).items.find((i: any) => i.status === 'QUEUED')!;
  await assert.rejects(L.editText(item.id, 'Quick call? Limited slots!'), /humane/);
  await assert.rejects(L.editText(item.id, 'x'.repeat(301)), /300 characters/);
  const ok = await L.editText(item.id, 'Hi Person, noticed the home page has no viewport tag. Building stores for Indian brands from Bengaluru, would like to follow how you grow. Ayush'); assert.ok(ok.id);
});
test('API: today, build and status through a session; nothing without auth', async () => {
  const s = await t.signIn();
  assert.equal((await fetch(t.url + '/api/linkedin/today?sender=rahul')).status, 401);
  const b = await s.call('POST', '/api/linkedin/build', { sender: 'rahul', count: 1 }); assert.ok(b.body.job_id); const J = await import('../src/jobs.ts'); await J.idle();
  const today = await s.call('GET', '/api/linkedin/today?sender=rahul'); assert.equal(today.status, 200); assert.equal(today.body.items.length, 1); assert.equal(today.body.sender.name, 'Rahul');
  const st = await s.call('POST', `/api/linkedin/${today.body.items[0].id}/status`, { status: 'SENT' }); assert.equal(st.body.status, 'SENT');
});
