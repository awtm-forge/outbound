// CRM screens: paged, filtered tables over the same companies, contacts and opportunities the outbound side uses; the
// header numbers; follow-ups (tasks linked to a company); recent CRM events; grouped search; top campaigns for a period;
// and bulk changes. Registered before routes/crm.ts so /api/crm/companies/table is not read as a company id.
import { route, type Ctx } from '../lib/http.ts';
import { q, one, audit, TODAY_IST } from '../lib/db.ts';
import { HttpError, setStatus } from '../pipeline.ts';
import { parse, z, uuid, text, day, needUuid } from '../lib/validate.ts';
import { notify } from './notifications.ts';

const like = (s: string | null) => (s && s.trim() ? '%' + s.trim().replace(/[\\%_]/g, (m) => '\\' + m) + '%' : null);
const list = (s: string | null) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : null);
const page = (c: Ctx) => { const sp = c.url.searchParams; const size = Math.min(100, Math.max(5, Number(sp.get('size')) || 20)); return { size, offset: Math.max(0, (Number(sp.get('page')) || 1) - 1) * size }; };
const STATUS_ORDER = ['NEW', 'QUALIFYING', 'RESEARCHING', 'RESEARCH_FURTHER', 'QUALIFIED', 'EMAIL_DRAFTED', 'PENDING_APPROVAL', 'APPROVED', 'SYNCED', 'CONTACTED', 'REPLIED', 'MEETING', 'PROPOSAL', 'WON', 'LOST', 'REJECTED', 'SUPPRESSED'];
const STAGES = ['REPLIED', 'MEETING_BOOKED', 'MEETING_HELD', 'PROPOSAL_SENT', 'NEGOTIATION', 'WON', 'LOST'];

// the newest event on a company, across the company itself, its prospects and its opportunities
const LAST_ACTIVITY = `left join lateral (select * from (
    (select a.created_at, a.action, a.entity_type, a.actor from activities a where a.entity_type='company' and a.entity_id=co.id order by a.created_at desc limit 1)
    union all (select a.created_at, a.action, a.entity_type, a.actor from activities a join prospects p2 on p2.id=a.entity_id where a.entity_type='prospect' and p2.company_id=co.id order by a.created_at desc limit 1)
    union all (select a.created_at, a.action, a.entity_type, a.actor from activities a join opportunities o2 on o2.id=a.entity_id where a.entity_type='opportunity' and o2.company_id=co.id order by a.created_at desc limit 1)
  ) x order by created_at desc limit 1) la on true`;

// ---------- companies ----------
route('GET', '/api/crm/companies/table', 'user', async (c) => {
  const sp = c.url.searchParams; const { size, offset } = page(c);
  const sort = sp.get('sort') ?? 'activity';
  const order = ({ name: 'lower(co.name)', status: `array_position($9::text[], lp.status) nulls last, lower(co.name)`, activity: 'coalesce(la.created_at, co.updated_at) desc', value: 'op.value_paise desc nulls last, lower(co.name)', updated: 'co.updated_at desc', created: 'co.created_at desc' } as Record<string, string>)[sort] ?? 'coalesce(la.created_at, co.updated_at) desc';
  const owner = sp.get('owner'); const stage = list(sp.get('stage')); const status = list(sp.get('status'));
  const rows = await q(`select co.id, co.name, co.domain, co.website, co.city, co.country, co.vertical, co.industry, co.platform, co.updated_at, co.created_at, co.archived_at,
      co.owner_id, u.name owner_name, lp.id prospect_id, lp.status, lp.suppressed, lp.account_score, ca.code campaign, ca.vertical campaign_name,
      op.id opportunity_id, op.stage, op.value_paise::text value_paise, op.expected_close,
      (select count(*)::int from contacts ct where ct.company_id=co.id) contacts,
      (select coalesce(json_agg(x.full_name), '[]') from (select coalesce(ct.full_name, ct.email::text) full_name from contacts ct where ct.company_id=co.id order by ct.is_decision_maker desc, ct.created_at limit 3) x) people,
      la.created_at last_at, la.action last_action, la.entity_type last_type,
      count(*) over()::int total
    from companies co
    left join users u on u.id=co.owner_id
    left join lateral (select p.* from prospects p where p.company_id=co.id order by p.updated_at desc limit 1) lp on true
    left join campaigns ca on ca.id=lp.campaign_id
    left join lateral (select o.* from opportunities o where o.company_id=co.id order by (o.stage in ('WON','LOST')), o.updated_at desc limit 1) op on true
    ${LAST_ACTIVITY}
    where $9::text[] is not null and (($8 and co.archived_at is not null) or (not $8 and co.archived_at is null))
      and ($1::text is null or co.name ilike $1 or co.domain ilike $1 or exists (select 1 from contacts ct where ct.company_id=co.id and (ct.full_name ilike $1 or ct.email ilike $1)))
      and ($2::text[] is null or ('NONE' = any($2) and lp.id is null) or lp.status = any($2))
      and ($3::text is null or ca.code = $3)
      and ($4::text is null or ($4 = 'none' and co.owner_id is null) or co.owner_id::text = $4)
      and ($5::text[] is null or ('NONE' = any($5) and op.id is null) or op.stage = any($5))
      and ($6::text is null or co.vertical = $6 or co.industry = $6)
      and ($7::text is null or ($7 = 'deal' and op.id is not null and op.stage not in ('WON','LOST')) or ($7 = 'people' and exists (select 1 from contacts ct where ct.company_id=co.id)) or ($7 = 'nopeople' and not exists (select 1 from contacts ct where ct.company_id=co.id)))
    order by ${order} limit $10 offset $11`,
    [like(sp.get('q')), status, sp.get('campaign') || null, owner || null, stage, sp.get('vertical') || null, sp.get('has') || null, sp.get('archived') === '1', STATUS_ORDER, size, offset]);
  return { total: rows[0]?.total ?? 0, page: offset / size + 1, size, rows: rows.map(({ total, ...r }) => r) };
});

// change many companies at once: owner, archive or restore, or mark their outbound status not a fit
route('POST', '/api/crm/companies/bulk', 'user', async (c) => {
  const b = parse(z.object({ ids: z.array(uuid).min(1).max(200), action: z.enum(['assign', 'archive', 'restore', 'not_fit']), owner_id: uuid.nullable().optional() }), c.body);
  const found = await q('select id, name from companies where id = any($1)', [b.ids]); if (found.length !== new Set(b.ids).size) throw new HttpError(400, 'Some of those companies do not exist.');
  if (b.action === 'assign') {
    if (b.owner_id && !(await one('select 1 from users where id=$1 and active', [b.owner_id]))) throw new HttpError(400, 'That person is not on the team.');
    await q('update companies set owner_id=$2 where id = any($1)', [b.ids, b.owner_id ?? null]);
    for (const co of found) await audit('company', co.id, 'owner_changed', c.actor, { owner_id: b.owner_id ?? null, user_id: c.user!.id });
    if (b.owner_id) await notify(b.owner_id, c.user!.id, 'crm_assigned', `${c.user!.name} gave you ${found.length === 1 ? found[0]!.name : `${found.length} companies`} in the CRM`, found.length === 1 ? `/crm/companies/${found[0]!.id}` : '/crm?owner=' + b.owner_id);
  } else if (b.action === 'not_fit') {
    let n = 0;
    for (const co of found) { const p = await one('select id from prospects where company_id=$1 order by updated_at desc limit 1', [co.id]); if (!p) continue; await setStatus(p.id, 'REJECTED', { close: true }); await audit('prospect', p.id, 'marked_not_fit', c.actor, { user_id: c.user!.id }); n++; }
    return { done: n, skipped: found.length - n };
  } else {
    await q(`update companies set archived_at=${b.action === 'archive' ? 'now()' : 'null'} where id = any($1)`, [b.ids]);
    for (const co of found) await audit('company', co.id, b.action === 'archive' ? 'archived' : 'restored', c.actor, { user_id: c.user!.id });
  }
  return { done: found.length };
});

// the two status changes a person makes by hand; everything else moves with the outbound work itself
route('POST', '/api/crm/companies/:id/status', 'user', async (c) => {
  const id = needUuid(c.params.id, 'company'); const b = parse(z.object({ status: z.enum(['REJECTED', 'RESEARCH_FURTHER']) }), c.body);
  const p = await one('select id, status from prospects where company_id=$1 order by updated_at desc limit 1', [id]);
  if (!p) throw new HttpError(409, 'This company is not in outbound yet, so it has no outbound status.');
  await setStatus(p.id, b.status, { close: b.status === 'REJECTED' });
  const after = (await one('select status from prospects where id=$1', [p.id]))!.status;
  if (after !== b.status) throw new HttpError(409, after === 'SUPPRESSED' ? 'This company is on the do-not-contact list.' : 'It has already been contacted, so it cannot go back to research.');
  await audit('prospect', p.id, b.status === 'REJECTED' ? 'marked_not_fit' : 'marked_research_further', c.actor, { from: p.status, user_id: c.user!.id });
  return { status: after };
});

// ---------- people ----------
route('GET', '/api/crm/contacts/table', 'user', async (c) => {
  const sp = c.url.searchParams; const { size, offset } = page(c); const sort = sp.get('sort') ?? 'added';
  const order = ({ name: 'lower(coalesce(ct.full_name, ct.email::text))', company: 'lower(co.name)', added: 'ct.created_at desc', contacted: 'last_contacted desc nulls last' } as Record<string, string>)[sort] ?? 'ct.created_at desc';
  const rows = await q(`select ct.id, ct.full_name, ct.job_title, ct.email::text, ct.phone, ct.linkedin_url, ct.is_decision_maker, ct.email_verification_status, ct.created_at,
      co.id company_id, co.name company, co.domain, co.owner_id, u.name owner_name, lp.status, lp.id prospect_id,
      greatest(lp.last_contacted_at, (select max(e.occurred_at) from email_events e where e.contact_id=ct.id and e.event_type='SENT'), (select max(r.received_at) from replies r where r.contact_id=ct.id)) last_contacted,
      (select min(t.due_date) from tasks t where t.company_id=co.id and t.status<>'DONE' and t.archived_at is null) next_follow_up,
      count(*) over()::int total
    from contacts ct join companies co on co.id=ct.company_id left join users u on u.id=co.owner_id
    left join lateral (select p.* from prospects p where p.contact_id=ct.id order by p.updated_at desc limit 1) lp on true
    where co.archived_at is null
      and ($1::text is null or ct.full_name ilike $1 or ct.email ilike $1 or ct.job_title ilike $1 or co.name ilike $1 or ct.phone ilike $1)
      and ($2::uuid is null or co.id = $2)
      and ($3::text is null or ($3 = 'none' and co.owner_id is null) or co.owner_id::text = $3)
      and ($4::text[] is null or ('NONE' = any($4) and lp.id is null) or lp.status = any($4))
      and ($5::text is null or ($5 = 'email' and ct.email is not null) or ($5 = 'noemail' and ct.email is null) or ($5 = 'decides' and ct.is_decision_maker))
    order by ${order} limit $6 offset $7`, [like(sp.get('q')), sp.get('company') || null, sp.get('owner') || null, list(sp.get('status')), sp.get('has') || null, size, offset]);
  return { total: rows[0]?.total ?? 0, page: offset / size + 1, size, rows: rows.map(({ total, ...r }) => r) };
});

// ---------- opportunities ----------
route('GET', '/api/crm/opportunities/table', 'user', async (c) => {
  const sp = c.url.searchParams; const { size, offset } = page(c); const sort = sp.get('sort') ?? 'stage';
  const order = ({ stage: `array_position($6::text[], o.stage), o.updated_at desc`, value: 'o.value_paise desc nulls last', close: 'o.expected_close nulls last', updated: 'o.updated_at desc', company: 'lower(co.name)' } as Record<string, string>)[sort] ?? 'o.updated_at desc';
  const state = sp.get('state');
  const rows = await q(`select o.id, o.stage, o.value_paise::text value_paise, o.owner, o.lost_reason, o.expected_close, o.next_action, o.next_action_on, o.created_at, o.updated_at,
      co.id company_id, co.name company, co.domain, ct.full_name contact_name, ca.code campaign, ou.name owner_name,
      (select row_to_json(d) from (select revenue_paise::text revenue_paise, status from deals where opportunity_id=o.id order by created_at desc limit 1) d) deal,
      count(*) over()::int total
    from opportunities o join companies co on co.id=o.company_id join prospects p on p.id=o.prospect_id left join contacts ct on ct.id=p.contact_id
    left join campaigns ca on ca.id=o.campaign_id left join users ou on ou.username=o.owner
    where $6::text[] is not null and ($1::text is null or co.name ilike $1 or co.domain ilike $1 or ct.full_name ilike $1 or o.next_action ilike $1)
      and ($2::text[] is null or o.stage = any($2))
      and ($3::text is null or ($3 = 'open' and o.stage not in ('WON','LOST')) or ($3 = 'won' and o.stage='WON') or ($3 = 'lost' and o.stage='LOST'))
      and ($4::text is null or ($4 = 'none' and o.owner is null) or o.owner = $4)
      and ($5::text is null or ca.code = $5)
    order by ${order} limit $7 offset $8`, [like(sp.get('q')), list(sp.get('stage')), state || null, sp.get('owner') || null, sp.get('campaign') || null, STAGES, size, offset]);
  return { total: rows[0]?.total ?? 0, page: offset / size + 1, size, rows: rows.map(({ total, ...r }) => r) };
});

// ---------- the header numbers and the side panels ----------
route('GET', '/api/crm/summary', 'user', async () => {
  // weekly running totals for the last eight weeks, from when each record was created
  const [nums, series, stages] = await Promise.all([
    one(`select
      (select count(*) from companies where archived_at is null)::int companies,
      (select count(*) from companies where archived_at is null and created_at < now() - interval '30 days')::int companies_before,
      (select count(*) from contacts)::int people,
      (select count(*) from contacts where created_at < now() - interval '30 days')::int people_before,
      (select count(*) from opportunities where stage not in ('WON','LOST'))::int open_opps,
      (select coalesce(sum(value_paise), 0) from opportunities where stage not in ('WON','LOST'))::text open_value_paise,
      (select count(*) from opportunities where created_at >= now() - interval '30 days')::int opened_30d,
      (select count(*) from opportunities where created_at >= now() - interval '60 days' and created_at < now() - interval '30 days')::int opened_prev_30d,
      (select count(*) from tasks where company_id is not null and status<>'DONE' and archived_at is null and due_date <= ${TODAY_IST})::int follow_ups_due,
      (select count(*) from tasks where company_id is not null and status<>'DONE' and archived_at is null and due_date < ${TODAY_IST})::int follow_ups_overdue,
      (select count(*) from tasks where company_id is not null and status<>'DONE' and archived_at is null and due_date > ${TODAY_IST} and due_date <= ${TODAY_IST} + 7)::int follow_ups_week`),
    q(`select w::date week, (select count(*) from companies where created_at < w + interval '7 days' and (archived_at is null or archived_at >= w + interval '7 days'))::int companies,
        (select count(*) from contacts where created_at < w + interval '7 days')::int people,
        (select count(*) from opportunities where created_at >= w and created_at < w + interval '7 days')::int opened
      from generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') w order by w`),
    q(`select stage, count(*)::int n, coalesce(sum(value_paise), 0)::text value_paise from opportunities group by stage`),
  ]);
  return { ...nums, series, stages: STAGES.map((s) => stages.find((x) => x.stage === s) ?? { stage: s, n: 0, value_paise: '0' }) };
});

// campaigns ranked by what they produced in the period: replies first, then meetings, then companies found
route('GET', '/api/crm/campaigns', 'user', async (c) => {
  const days = ({ '7d': 7, '30d': 30, '90d': 90 } as Record<string, number>)[c.url.searchParams.get('period') ?? '30d'] ?? null;
  return q(`select ca.code, ca.vertical, ca.status,
      (select count(*) from prospects p where p.campaign_id=ca.id and ($1::int is null or p.created_at >= now() - make_interval(days => $1)))::int found,
      (select count(distinct e.prospect_id) from email_events e where e.campaign_id=ca.id and e.event_type='SENT' and ($1::int is null or e.occurred_at >= now() - make_interval(days => $1)))::int sent,
      (select count(*) from replies r where r.campaign_id=ca.id and ($1::int is null or r.received_at >= now() - make_interval(days => $1)))::int replies,
      (select count(*) from replies r where r.campaign_id=ca.id and r.classification in ('POSITIVE','VALUE_REQUEST','PRICE','REFERRAL') and ($1::int is null or r.received_at >= now() - make_interval(days => $1)))::int positive,
      (select count(*) from meetings m join opportunities o on o.id=m.opportunity_id where o.campaign_id=ca.id and ($1::int is null or m.created_at >= now() - make_interval(days => $1)))::int meetings,
      (select count(*) from opportunities o where o.campaign_id=ca.id and o.stage='WON' and ($1::int is null or o.updated_at >= now() - make_interval(days => $1)))::int won
    from campaigns ca order by replies desc, meetings desc, found desc, ca.code`, [days]);
});

// follow-ups are tasks linked to a company: open ones, soonest first, late ones on top
route('GET', '/api/crm/follow-ups', 'user', async (c) => {
  const mine = c.url.searchParams.get('who') === 'mine'; const company = c.url.searchParams.get('company');
  return q(`select t.id, t.title, t.priority, t.status, t.due_date, t.assignee_id, u.name assignee_name, t.company_id, co.name company, t.opportunity_id, t.project_id,
      (t.due_date < ${TODAY_IST}) overdue, (t.due_date = ${TODAY_IST}) today
    from tasks t join companies co on co.id=t.company_id left join users u on u.id=t.assignee_id
    where t.status<>'DONE' and t.archived_at is null and ($1::uuid is null or t.assignee_id=$1) and ($2::uuid is null or t.company_id=$2)
    order by t.due_date nulls last, case t.priority when 'URGENT' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 when 'LOW' then 3 else 4 end, t.created_at limit 100`, [mine ? c.user!.id : null, company && /^[0-9a-f-]{36}$/i.test(company) ? company : null]);
});
route('POST', '/api/crm/companies/:id/follow-ups', 'user', async (c) => {
  const id = needUuid(c.params.id, 'company');
  const b = parse(z.object({ title: text(200).min(1), due_date: day, priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(), assignee_id: uuid.nullable().optional(), opportunity_id: uuid.nullable().optional() }), c.body);
  const co = await one('select id, name from companies where id=$1', [id]); if (!co) throw new HttpError(404, 'company not found');
  if (b.opportunity_id && !(await one('select 1 from opportunities where id=$1 and company_id=$2', [b.opportunity_id, id]))) throw new HttpError(400, 'That opportunity is not this company’s.');
  const assignee = b.assignee_id === undefined ? c.user!.id : b.assignee_id;
  const t = (await one(`insert into tasks(project_id,company_id,opportunity_id,title,priority,assignee_id,due_date,created_by) values(null,$1,$2,$3,$4,$5,$6,$7) returning *`,
    [id, b.opportunity_id ?? null, b.title, b.priority ?? 'MEDIUM', assignee, b.due_date ?? null, c.user!.id]))!;
  await audit('company', id, 'follow_up_added', c.actor, { task_id: t.id, title: t.title, due_date: t.due_date, user_id: c.user!.id });
  if (assignee) await notify(assignee, c.user!.id, 'task_assigned', `${c.user!.name} gave you a follow-up with ${co.name}: “${t.title}”`, `/crm/companies/${id}`);
  return { created: true, ...t };
});

// what happened across the CRM lately, each event tied to its company
route('GET', '/api/crm/activity', 'user', async (c) => {
  const n = Math.min(50, Number(c.url.searchParams.get('limit')) || 12);
  return q(`select a.id, a.action, a.actor, a.created_at, a.entity_type, a.detail, coalesce(co1.id, co2.id, co3.id, co4.id, co5.id) company_id, coalesce(co1.name, co2.name, co3.name, co4.name, co5.name) company, u.name actor_name
    from activities a
    left join companies co1 on a.entity_type='company' and co1.id=a.entity_id
    left join prospects p on a.entity_type='prospect' and p.id=a.entity_id left join companies co2 on co2.id=p.company_id
    left join opportunities o on a.entity_type='opportunity' and o.id=a.entity_id left join companies co3 on co3.id=o.company_id
    left join replies r on a.entity_type='reply' and r.id=a.entity_id left join prospects rp on rp.id=r.prospect_id left join companies co4 on co4.id=rp.company_id
    left join meetings m on a.entity_type='meeting' and m.id=a.entity_id left join opportunities mo on mo.id=m.opportunity_id left join companies co5 on co5.id=mo.company_id
    left join users u on u.username=a.actor
    where a.entity_type in ('company','prospect','opportunity','reply','meeting') and a.action <> 'note'
    order by a.created_at desc limit $1`, [n]);
});

// one search box across companies, people and opportunities, grouped
route('GET', '/api/crm/search', 'user', async (c) => {
  const l = like(c.url.searchParams.get('q')); if (!l || l.length < 4) return { companies: [], people: [], opportunities: [] };
  const [companies, people, opportunities] = await Promise.all([
    q(`select id, name, domain from companies where archived_at is null and (name ilike $1 or domain ilike $1) order by lower(name) limit 6`, [l]),
    q(`select ct.id, ct.full_name, ct.job_title, ct.email::text, co.id company_id, co.name company from contacts ct join companies co on co.id=ct.company_id where ct.full_name ilike $1 or ct.email ilike $1 order by lower(ct.full_name) limit 6`, [l]),
    q(`select o.id, o.stage, o.value_paise::text value_paise, co.id company_id, co.name company from opportunities o join companies co on co.id=o.company_id where co.name ilike $1 or o.next_action ilike $1 order by o.updated_at desc limit 6`, [l]),
  ]);
  return { companies, people, opportunities };
});
