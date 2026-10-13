// Fixture data for the UI audit, created through the app's own API only. Names and companies are made up.
import { readFileSync } from 'node:fs';
const B = 'http://localhost:8099'; const html = readFileSync('/home/user/outbound-ui/core/fixtures/demo-electronics.html', 'utf8');
const key = { 'x-api-key': 'ui-audit-key' };
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const api = async (m, p, b, h = {}) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(), ...key, ...h }, body: b && JSON.stringify(b) }); const o = await j(r); if (!r.ok) throw new Error(`${m} ${p} ${r.status} ${JSON.stringify(o)}`); return o; };
let ipn = 1;
async function session(user, pw) {
  const r = await fetch(B + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.77.0.${ipn++}` }, body: JSON.stringify({ user, password: pw }) });
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  const call = async (m, p, b) => { const x = await fetch(B + p, { method: m, headers: { cookie, 'content-type': 'application/json', ...(m === 'GET' ? {} : { 'idempotency-key': crypto.randomUUID() }) }, body: b && JSON.stringify(b) }); const o = await j(x); if (!x.ok) throw new Error(`${m} ${p} ${x.status} ${JSON.stringify(o)}`); return o; };
  return { call };
}
// outbound: prospects through the mock AI chain
const cos = [
  ['Kaveri Foods', 'kaverifoods.in', 'Mysuru', 'Anil Rao', 'Founder', 'IND-WEB-ELECTRONICS'],
  ['Tara Home Studio', 'tarahome.in', 'Bengaluru', 'Priya Nair', 'Co-founder', 'IND-WEB-ELECTRONICS'],
  ['Nila Crafts', 'nilacrafts.in', 'Chennai', 'Kavya Iyer', 'Founder', 'IND-WEB-ELECTRONICS'],
  ['Ruhi Wellness', 'ruhiwellness.in', 'Pune', 'Sana Shaikh', 'CEO', 'IND-WEB-ELECTRONICS'],
  ['Mitra Logistics', 'mitralogistics.in', 'Hyderabad', 'Vikram Reddy', 'Director', 'IND-AI-SME'],
  ['Saffron Trails', 'saffrontrails.in', 'Jaipur', null, null, 'IND-WEB-ELECTRONICS'],
  ['Udaan Fitness', 'udaanfit.in', 'Mumbai', null, null, 'IND-WEB-ELECTRONICS'],
];
const ids = [];
for (const [name, domain, city, person, title, camp] of cos) {
  const r = await api('POST', '/api/prospects', { company: { name, website: `https://${domain}`, city, country: 'IN', vertical: 'DTC ecommerce', company_size: '20-50' }, contact: person ? { full_name: person, job_title: title, email: `${person.split(' ')[0].toLowerCase()}@${domain}` } : undefined, campaign_code: camp });
  ids.push(r.prospect_id); await api('POST', `/api/prospects/${r.prospect_id}/run-chain`, { html }).catch((e) => console.log('chain', name, e.message.slice(0, 80)));
}
const drafts = await api('GET', '/api/drafts');
console.log('drafts pending', drafts.length);
if (drafts[0]) await api('POST', `/api/drafts/${drafts[0].id}/decision`, { action: 'APPROVE' }, { 'x-actor': 'rahul' });
// a reply comes in for the approved one
const p0 = drafts[0] && (await api('GET', `/api/prospects/${drafts[0].prospect_id}`));
if (p0?.contact?.email) { const w = await api('POST', '/webhooks/saleshandy', { event: 'replied', event_id: 'ui-r1', email: p0.contact.email, body: 'Thanks, this is timely. Could you send the two things you noticed? We are planning a site refresh next quarter.' }, { 'x-webhook-secret': 'ui-audit-hook' }); const rid = w.processed?.[0]?.reply_id; if (rid) await api('POST', `/api/replies/${rid}/classify`, {}); }
await api('POST', '/api/discovery/searches', { industry: 'home decor', location: 'Bengaluru', technology: 'Shopify', pages: 1 }).catch((e) => console.log('search', e.message.slice(0, 120)));
// people
const admin = await session('rahul', 'ui-audit-pass-1');
await admin.call('POST', '/api/me/profile', { name: 'Rahul', email: 'rahul@awtmforge.example' });
const mk = async (username, name, role) => { const u = await admin.call('POST', '/api/users', { username, name, role, password: 'temporary-pass-1' }); const s = await session(username, 'temporary-pass-1'); await s.call('POST', '/api/me/password', { current: 'temporary-pass-1', next: `${username}-ui-pass-1` }); return { id: u.id, s: await session(username, `${username}-ui-pass-1`) }; };
const ayush = await mk('ayush', 'Ayush', 'admin'); const meera = await mk('meera', 'Meera Shah', 'member');
const me = await admin.call('GET', '/api/me');
// projects and to-dos
const proj = await admin.call('POST', '/api/projects', { name: 'Kaveri storefront rebuild', description: 'Move the storefront off the old Shopify theme and fix the checkout drop-off.', due_date: '2026-11-28' });
const proj2 = await ayush.s.call('POST', '/api/projects', { name: 'Studio website refresh', description: 'New case studies and a faster home page.' });
for (const [t, st, pr, who, due] of [['Audit the current theme', 'DONE', 'MEDIUM', me.id, null], ['Write the brief for Anil', 'DOING', 'HIGH', me.id, '2026-10-15'], ['Set up staging store', 'TODO', 'MEDIUM', ayush.id, '2026-10-20'], ['Checkout funnel teardown', 'REVIEW', 'HIGH', meera.id, '2026-10-10'], ['Collect product photography', 'TODO', 'LOW', null, null]])
  await admin.call('POST', `/api/projects/${proj.id}/tasks`, { title: t, status: st, priority: pr, assignee_id: who, due_date: due ?? '' });
await ayush.s.call('POST', `/api/projects/${proj2.id}/tasks`, { title: 'Pick three case studies', assignee_id: meera.id });
await admin.call('POST', '/api/todos', { title: 'Send Kaveri the revised quote', due_date: '2026-10-13', priority: 'HIGH' });
await admin.call('POST', '/api/todos', { title: 'Renew the awtmforge.com domain', assignee_id: ayush.id, due_date: '2026-10-25' });
await admin.call('POST', '/api/todos', { title: 'File GST for September', due_date: '2026-10-20' });
await meera.s.call('POST', '/api/todos', { title: 'Moodboard for Tara Home', due_date: '2026-10-16' });
// wiki
const w1 = await admin.call('POST', '/api/wiki', { title: 'How we run a project', body: '# Kickoff\nEvery project starts with a **brief** and a call. Leave policy is in [[Leave policy]].\n\n- [x] Brief written\n- [ ] Staging set up\n\n| Step | Owner |\n|---|---|\n| Brief | Rahul |\n| Build | Ayush |\n\n> Ship small, ship often.' });
await ayush.s.call('POST', '/api/wiki', { title: 'Leave policy', body: 'Twelve days of casual leave a year, plus sick leave as needed. Ask in **People, Leave**.' });
await meera.s.call('POST', '/api/wiki', { title: 'Brand guidelines', body: '## Colour\nEmber is the only loud colour.\n\n## Type\nBricolage Grotesque for reading, IBM Plex Mono for short metadata.', parent_id: w1.id });
// chat
const chans = await admin.call('GET', '/api/chat/channels'); const general = chans.find((c) => c.name === 'general');
await admin.call('POST', `/api/chat/channels/${general.id}/messages`, { body: 'Morning. Kaveri replied, they want the two findings. @ayush can you take the teardown?' });
await ayush.s.call('POST', `/api/chat/channels/${general.id}/messages`, { body: 'On it. Will have it in review by 3.' });
await meera.s.call('POST', `/api/chat/channels/${general.id}/messages`, { body: 'Moodboard for Tara is in the project board.' });
await admin.call('POST', '/api/chat/channels', { name: 'client-kaveri', topic: 'Kaveri Foods storefront rebuild' });
const dm = await admin.call('POST', '/api/chat/direct', { user_id: ayush.id });
await ayush.s.call('POST', `/api/chat/channels/${dm.id}/messages`, { body: 'Can we talk pricing for Kaveri before the call?' });
// CRM
const companies = await api('GET', '/api/crm/companies'); const kav = companies.find((c) => c.name === 'Kaveri Foods');
await admin.call('POST', `/api/crm/companies/${kav.id}/notes`, { text: 'Called Anil. Wants a quote for the checkout rebuild by Friday.' });
await admin.call('PATCH', `/api/projects/${proj.id}`, { company_id: kav.id });
const tara = companies.find((c) => c.name === 'Tara Home Studio');
const opp = await admin.call('POST', `/api/crm/companies/${tara.id}/opportunities`, { stage: 'PROPOSAL_SENT', value_paise: '25000000' });
await admin.call('POST', '/api/crm/companies', { name: 'Referral: Bloom Bakery', website: 'bloombakery.in', city: 'Bengaluru' });
// HR
const eR = await admin.call('POST', '/api/hr/employees', { full_name: 'Rahul', user_id: me.id, job_title: 'Co-founder, design', department: 'Studio', start_date: '2024-04-01', location: 'Bengaluru' });
const eA = await admin.call('POST', '/api/hr/employees', { full_name: 'Ayush', user_id: ayush.id, job_title: 'Co-founder, engineering', department: 'Studio', start_date: '2024-04-01', location: 'Bengaluru' });
const eM = await admin.call('POST', '/api/hr/employees', { full_name: 'Meera Shah', user_id: meera.id, job_title: 'Product designer', department: 'Design', start_date: '2026-06-01', manager_id: eR.id, work_email: 'meera@awtmforge.example', location: 'Bengaluru' });
await admin.call('POST', `/api/hr/employees/${eM.id}/compensation`, { amount_paise: '9000000', period: 'MONTHLY', effective_from: '2026-06-01', note: 'Joining' });
const lv = await meera.s.call('POST', '/api/hr/leave', { kind: 'CASUAL', start_date: '2026-10-22', end_date: '2026-10-23', reason: 'Family function' });
await ayush.s.call('POST', '/api/hr/leave', { kind: 'CASUAL', start_date: '2026-10-27', end_date: '2026-10-27' }).then((x) => admin.call('POST', `/api/hr/leave/${x.id}/decision`, { action: 'APPROVE' }));
console.log(JSON.stringify({ ok: true, prospects: ids.length, project: proj.id, wiki: 'how-we-run-a-project', company: kav.id, person: eM.id, dm: dm.id, general: general.id }));
