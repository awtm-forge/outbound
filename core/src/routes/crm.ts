// Workspace: CRM screens over the outbound tables (companies, contacts, prospects, opportunities, deals). No tables of
// its own: notes are activities on the company, and an opportunity's stage moves its prospect through the same
// forward-only setStatus the pipeline uses. X-Api-Key works here like the rest of the outbound API.
import { route } from '../lib/http.ts';
import { q, one, audit } from '../lib/db.ts';
import { HttpError, setStatus, ingest } from '../pipeline.ts';
import { isSuppressed } from '../lib/suppression.ts';
import { normalizeDomain, firstName, emailDomain } from '../lib/normalize.ts';
import { parse, z, text, optText, day, needUuid, uuid } from '../lib/validate.ts';
import { patchRow } from '../lib/patch.ts';

// integer paise, as a number or a string of digits; never a float
const paise = z.union([z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^\d{1,16}$/, 'whole paise')]).transform(String);
const STAGES = ['REPLIED', 'MEETING_BOOKED', 'MEETING_HELD', 'PROPOSAL_SENT', 'NEGOTIATION', 'WON', 'LOST'] as const;
const PROSPECT_FOR_STAGE: Record<string, string> = { REPLIED: 'REPLIED', MEETING_BOOKED: 'MEETING', MEETING_HELD: 'MEETING', PROPOSAL_SENT: 'PROPOSAL', NEGOTIATION: 'PROPOSAL', WON: 'WON', LOST: 'LOST' };
// deals.signed_at is a timestamp; people sign on a day, so it goes in and comes out as an India calendar day
const SIGNED = `($5::date)::timestamp at time zone 'Asia/Kolkata'`;
const SIGNED_DAY = `to_char(signed_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;
const email = z.string().trim().toLowerCase().regex(/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i, 'that email does not look right').nullable().optional().or(z.literal('').transform(() => null));

// ---------- companies ----------
route('GET', '/api/crm/companies', 'api', async (c) => {
  const sp = c.url.searchParams; const term = (sp.get('q') ?? '').trim();
  const like = term ? '%' + term.replace(/[\\%_]/g, (m) => '\\' + m) + '%' : null;
  return q(`select co.id, co.name, co.domain, co.city, co.country, co.vertical, co.platform, co.company_size, co.source, co.updated_at,
      (select count(*)::int from contacts ct where ct.company_id=co.id) contacts,
      (select json_build_object('status', p.status, 'id', p.id, 'suppressed', p.suppressed) from prospects p where p.company_id=co.id order by p.updated_at desc limit 1) prospect,
      (select json_build_object('id', o.id, 'stage', o.stage, 'value_paise', o.value_paise::text) from opportunities o where o.company_id=co.id order by (o.stage in ('WON','LOST')), o.updated_at desc limit 1) opportunity
    from companies co
    where ($1::text is null or co.name ilike $1 or co.domain ilike $1 or exists (select 1 from contacts ct where ct.company_id=co.id and (ct.full_name ilike $1 or ct.email ilike $1)))
      and ($2::text is null or co.vertical = $2)
      and ($3::text is null or ($3 = 'deals' and exists (select 1 from opportunities o where o.company_id=co.id and o.stage not in ('WON','LOST'))) or ($3 = 'won' and exists (select 1 from opportunities o where o.company_id=co.id and o.stage='WON')))
    order by co.updated_at desc limit 500`, [like, sp.get('vertical') || null, sp.get('has') || null]);
});
route('POST', '/api/crm/companies', 'api', async (c) => {
  const b = parse(z.object({ name: text(160).min(1), website: text(300).min(3), city: optText(80), country: optText(2), vertical: optText(120), industry: optText(120), company_size: optText(40),
    owner_id: uuid.nullable().optional(), campaign_code: optText(60), note: optText(5000) }), c.body);
  const domain = normalizeDomain(b.website); if (!domain.includes('.')) throw new HttpError(400, 'website: give the site address, like acme.in');
  const existing = await one('select id, name, archived_at from companies where domain=$1', [domain]);
  if (existing) throw new HttpError(409, `${existing.name} already has ${domain}${existing.archived_at ? ', archived' : ''}. Open it instead of adding it twice.`);
  if (b.owner_id && !(await one('select 1 from users where id=$1 and active', [b.owner_id]))) throw new HttpError(400, 'owner_id: that person is not on the team.');
  if (b.campaign_code && !(await one('select 1 from campaigns where code=$1', [b.campaign_code]))) throw new HttpError(400, `campaign_code: there is no campaign ${b.campaign_code}.`);
  const owner = b.owner_id === undefined ? c.user?.id ?? null : b.owner_id;
  const co = (await one(`insert into companies(name,domain,website,city,country,vertical,industry,company_size,source,owner_id) values($1,$2,$3,$4,$5,$6,$7,$8,'crm',$9) returning id, name, domain`,
    [b.name, domain, /^https?:\/\//.test(b.website) ? b.website : `https://${domain}`, b.city ?? null, b.country?.toUpperCase() ?? null, b.vertical ?? null, b.industry ?? null, b.company_size ?? null, owner]))!;
  await audit('company', co.id, 'created', c.actor, { user_id: c.user?.id ?? null });
  // into a campaign the same way discovery and n8n add one: a new prospect, which the outbound work picks up from there
  if (b.campaign_code) await ingest({ company: { name: b.name, domain }, campaign_code: b.campaign_code, source: 'crm', owner: c.actor } as any, c.actor);
  if (b.note) await q(`insert into activities(entity_type,entity_id,action,actor,detail) values('company',$1,'note',$2,$3)`, [co.id, c.actor, { text: b.note, user_id: c.user?.id ?? null }]);
  return { created: true, ...co };
});
route('GET', '/api/crm/companies/:id', 'api', async (c) => {
  const id = needUuid(c.params.id, 'company');
  const co = await one('select co.*, u.name owner_name from companies co left join users u on u.id=co.owner_id where co.id=$1', [id]); if (!co) throw new HttpError(404, 'company not found');
  const [contacts, prospects, opportunities, notes, activity, projects, research, emails, meetings, follow_ups] = await Promise.all([
    q(`select id, full_name, job_title, email::text, phone, linkedin_url, is_decision_maker, email_verification_status, source, created_at from contacts where company_id=$1 order by is_decision_maker desc, created_at`, [id]),
    q(`select p.id, p.status, p.account_score, p.primary_problem, p.specific_observation, p.suppressed, p.owner, p.updated_at, ca.code campaign, ct.full_name contact_name
      from prospects p left join campaigns ca on ca.id=p.campaign_id left join contacts ct on ct.id=p.contact_id where p.company_id=$1 order by p.updated_at desc`, [id]),
    q(`select o.id, o.prospect_id, o.stage, o.value_paise::text value_paise, o.owner, o.lost_reason, o.expected_close, o.next_action, o.next_action_on, o.created_at, o.updated_at,
        (select count(*)::int from meetings m where m.opportunity_id=o.id) meetings,
        (select json_agg(json_build_object('id', pr.id, 'status', pr.status, 'created_at', pr.created_at) order by pr.created_at desc) from proposals pr where pr.opportunity_id=o.id) proposals,
        (select row_to_json(d) from (select id, revenue_paise::text revenue_paise, cost_paise::text cost_paise, gross_profit_paise::text gross_profit_paise, status, ${SIGNED_DAY} signed_at from deals where opportunity_id=o.id order by created_at desc limit 1) d) deal
      from opportunities o where o.company_id=$1 order by o.created_at desc`, [id]),
    q(`select id, actor, detail->>'text' text, created_at from activities where entity_type='company' and entity_id=$1 and action='note' order by created_at desc`, [id]),
    q(`select a.action, a.actor, a.created_at, a.entity_type from activities a where (a.entity_type='prospect' and a.entity_id in (select id from prospects where company_id=$1))
        or (a.entity_type='opportunity' and a.entity_id in (select id from opportunities where company_id=$1)) or (a.entity_type='company' and a.entity_id=$1 and a.action<>'note')
      order by a.created_at desc limit 40`, [id]),
    // client work in the workspace; the API key sees the outbound side only
    c.user ? q(`select id, name, status, color from projects where company_id=$1 order by updated_at desc`, [id]) : Promise.resolve([]),
    // the latest finding of each kind: what research and the website audit said
    q(`select distinct on (kind) kind, data, confidence, created_at from research where company_id=$1 order by kind, created_at desc`, [id]),
    q(`(select 'draft' kind, d.id, coalesce(d.subject_final, d.subject_original) subject, d.status, d.created_at at_time, null classification from email_drafts d join prospects p on p.id=d.prospect_id where p.company_id=$1)
       union all (select 'reply' kind, r.id, r.subject, null status, r.received_at at_time, r.classification from replies r join prospects p on p.id=r.prospect_id where p.company_id=$1)
       order by at_time desc limit 20`, [id]),
    q(`select m.id, m.scheduled_at, m.held, m.opportunity_id from meetings m join opportunities o on o.id=m.opportunity_id where o.company_id=$1 order by m.scheduled_at desc nulls first limit 20`, [id]),
    c.user ? q(`select t.id, t.title, t.priority, t.status, t.due_date, t.completed_at, u.name assignee_name, t.opportunity_id from tasks t left join users u on u.id=t.assignee_id
      where t.company_id=$1 and t.archived_at is null order by t.status='DONE', t.due_date nulls last limit 50`, [id]) : Promise.resolve([]),
  ]);
  return { ...co, contacts, prospects, opportunities, notes, activity, projects, research, emails, meetings, follow_ups };
});
route('PATCH', '/api/crm/companies/:id', 'api', async (c) => {
  // the domain is how the outbound side dedupes, so it is not edited here
  const b = parse(z.object({ name: text(160).min(1), website: optText(300), city: optText(80), country: optText(2), industry: optText(120), vertical: optText(120), company_size: optText(40), platform: optText(60),
    owner_id: uuid.nullable(), archived: z.boolean() }).partial(), c.body);
  if (b.owner_id && !(await one('select 1 from users where id=$1 and active', [b.owner_id]))) throw new HttpError(400, 'owner_id: that person is not on the team.');
  const { archived, ...fields } = b;
  const r = await patchRow('companies', needUuid(c.params.id, 'company'), { ...fields, ...(archived !== undefined ? { archived_at: archived ? new Date() : null } : {}) }); if (!r) throw new HttpError(404, 'company not found');
  const action = archived !== undefined ? (archived ? 'archived' : 'restored') : b.owner_id !== undefined && Object.keys(b).length === 1 ? 'owner_changed' : 'updated';
  await audit('company', r.id, action, c.actor, { fields: Object.keys(b), user_id: c.user?.id ?? null });
  return r;
});
route('POST', '/api/crm/companies/:id/notes', 'api', async (c) => {
  const id = needUuid(c.params.id, 'company'); const b = parse(z.object({ text: text(5000).min(1) }), c.body);
  if (!(await one('select 1 from companies where id=$1', [id]))) throw new HttpError(404, 'company not found');
  const n = (await one(`insert into activities(entity_type,entity_id,action,actor,detail) values('company',$1,'note',$2,$3) returning id, actor, detail->>'text' text, created_at`, [id, c.actor, { text: b.text, user_id: c.user?.id ?? null }]))!;
  return { created: true, ...n };
});

// ---------- contacts ----------
const phone = z.string().trim().max(40).regex(/^[+()\d][\d\s()+.-]{4,}$/, 'that phone number does not look right').nullable().optional().or(z.literal('').transform(() => null));
const ContactIn = z.object({ full_name: text(120).min(2), job_title: optText(120), email, phone, linkedin_url: optText(300), is_decision_maker: z.boolean().optional() });
// the address itself, its own domain, and the company's domain: any one on the list is enough to refuse
async function emailAllowed(e: string | null | undefined, domain: string) {
  if (e && ((await isSuppressed(e, emailDomain(e))).suppressed || (await isSuppressed(null, domain)).suppressed)) throw new HttpError(409, 'This person or domain is on the do-not-contact list.');
}
// one person per email address across the CRM; say who has it rather than fail on the database's unique index
async function noDuplicate(e: string | null | undefined, self?: string) {
  if (!e) return; const d = await one('select ct.full_name, co.name from contacts ct join companies co on co.id=ct.company_id where ct.email=$1 and ($2::uuid is null or ct.id<>$2)', [e, self ?? null]);
  if (d) throw new HttpError(409, `${e} is already ${d.full_name ?? 'a contact'} at ${d.name}.`);
}
route('GET', '/api/crm/contacts', 'api', async (c) => {
  const term = (c.url.searchParams.get('q') ?? '').trim(); const like = term ? '%' + term.replace(/[\\%_]/g, (m) => '\\' + m) + '%' : null;
  return q(`select ct.id, ct.full_name, ct.job_title, ct.email::text, ct.linkedin_url, ct.is_decision_maker, ct.email_verification_status, ct.created_at, co.id company_id, co.name company, co.domain
    from contacts ct join companies co on co.id=ct.company_id
    where $1::text is null or ct.full_name ilike $1 or ct.email ilike $1 or ct.job_title ilike $1 or co.name ilike $1
    order by ct.created_at desc limit 500`, [like]);
});
route('POST', '/api/crm/companies/:id/contacts', 'api', async (c) => {
  const id = needUuid(c.params.id, 'company'); const b = parse(ContactIn, c.body);
  const co = await one('select domain from companies where id=$1', [id]); if (!co) throw new HttpError(404, 'company not found');
  await emailAllowed(b.email, co.domain);
  await noDuplicate(b.email);
  const parts = b.full_name.split(/\s+/);
  const ct = (await one(`insert into contacts(company_id,first_name,last_name,full_name,job_title,email,phone,linkedin_url,is_decision_maker,source) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm') returning id`,
    [id, firstName(b.full_name), parts.length > 1 ? parts.slice(1).join(' ') : null, b.full_name, b.job_title ?? null, b.email ?? null, b.phone ?? null, b.linkedin_url ?? null, b.is_decision_maker ?? false]))!;
  await audit('company', id, 'contact_added', c.actor, { name: b.full_name });
  return { created: true, id: ct.id };
});
route('PATCH', '/api/crm/contacts/:id', 'api', async (c) => {
  const id = needUuid(c.params.id, 'contact'); const b = parse(ContactIn.partial(), c.body);
  const ct = await one('select ct.email, co.domain from contacts ct join companies co on co.id=ct.company_id where ct.id=$1', [id]); if (!ct) throw new HttpError(404, 'contact not found');
  if (b.email && b.email !== ct.email) { await emailAllowed(b.email, ct.domain); await noDuplicate(b.email, id); }
  const fields: Record<string, unknown> = { ...b };
  if (b.full_name) { const parts = b.full_name.split(/\s+/); fields.first_name = firstName(b.full_name); fields.last_name = parts.length > 1 ? parts.slice(1).join(' ') : null; }
  // a changed address has not been checked
  if (b.email !== undefined && b.email !== ct.email) fields.email_verification_status = 'UNVERIFIED';
  return patchRow('contacts', id, fields, 'id, full_name, job_title, email::text, phone, linkedin_url, is_decision_maker, email_verification_status');
});

// ---------- opportunities and deals ----------
route('GET', '/api/crm/opportunities', 'api', async () => q(`
  select o.id, o.stage, o.value_paise::text value_paise, o.owner, o.lost_reason, o.created_at, o.updated_at, o.prospect_id,
    co.id company_id, co.name company, co.domain, ct.full_name contact_name, ca.code campaign,
    (select max(m.scheduled_at) from meetings m where m.opportunity_id=o.id) last_meeting,
    (select row_to_json(d) from (select revenue_paise::text revenue_paise, gross_profit_paise::text gross_profit_paise, status from deals where opportunity_id=o.id order by created_at desc limit 1) d) deal
  from opportunities o join companies co on co.id=o.company_id join prospects p on p.id=o.prospect_id left join contacts ct on ct.id=p.contact_id left join campaigns ca on ca.id=o.campaign_id
  order by array_position(array['NEGOTIATION','PROPOSAL_SENT','MEETING_HELD','MEETING_BOOKED','REPLIED','WON','LOST'], o.stage), o.updated_at desc limit 500`));

// An opportunity hangs off a prospect. From the CRM, use the company's latest prospect, or start one outside any campaign.
route('POST', '/api/crm/companies/:id/opportunities', 'api', async (c) => {
  const id = needUuid(c.params.id, 'company');
  const b = parse(z.object({ stage: z.enum(STAGES).default('REPLIED'), value_paise: paise.nullable().optional(), owner: optText(80), expected_close: day, next_action: optText(300), next_action_on: day }), c.body);
  const co = await one('select id from companies where id=$1', [id]); if (!co) throw new HttpError(404, 'company not found');
  let p = await one(`select p.id, p.campaign_id, p.suppressed from prospects p where p.company_id=$1 and not exists (select 1 from opportunities o where o.prospect_id=p.id) order by p.updated_at desc limit 1`, [id]);
  if (!p && await one('select 1 from opportunities where company_id=$1 and stage not in (\'WON\',\'LOST\')', [id])) throw new HttpError(409, 'This company already has an open opportunity. Move that one instead.');
  if (!p) p = (await one(`insert into prospects(company_id,source,owner,status) values($1,'crm',$2,'NEW') returning id, campaign_id, suppressed`, [id, b.owner ?? c.actor]))!;
  if (p.suppressed) throw new HttpError(409, 'This company is on the do-not-contact list.');
  const o = (await one(`insert into opportunities(prospect_id,company_id,campaign_id,stage,value_paise,owner,expected_close,next_action,next_action_on) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, stage`,
    [p.id, id, p.campaign_id, b.stage, b.value_paise ?? null, b.owner ?? c.actor, b.expected_close ?? null, b.next_action ?? null, b.next_action_on ?? null]))!;
  await setStatus(p.id, PROSPECT_FOR_STAGE[b.stage]!, { close: b.stage === 'LOST' });
  await audit('opportunity', o.id, 'opened', c.actor, { stage: b.stage });
  return { created: true, ...o, prospect_id: p.id };
});
route('PATCH', '/api/crm/opportunities/:id', 'api', async (c) => {
  const id = needUuid(c.params.id, 'opportunity');
  const b = parse(z.object({ stage: z.enum(STAGES).optional(), value_paise: paise.nullable().optional(), owner: optText(80), lost_reason: optText(500), expected_close: day, next_action: optText(300), next_action_on: day }), c.body);
  const o = await one('select * from opportunities where id=$1', [id]); if (!o) throw new HttpError(404, 'opportunity not found');
  if (b.stage === 'LOST' && !(b.lost_reason ?? o.lost_reason)) throw new HttpError(400, 'lost_reason: say why it was lost; it is what the weekly review learns from.');
  const r = (await patchRow('opportunities', id, { ...b, lost_reason: b.stage && b.stage !== 'LOST' ? null : b.lost_reason }, 'id, stage, value_paise::text value_paise, owner, lost_reason, expected_close, next_action, next_action_on'))!;
  const changed = (['value_paise', 'owner', 'expected_close', 'next_action'] as const).filter((k) => b[k] !== undefined && String(b[k] ?? '') !== String(o[k] ?? ''));
  if (changed.length) await audit('opportunity', id, 'updated', c.actor, { fields: changed });
  if (b.stage && b.stage !== o.stage) {
    await setStatus(o.prospect_id, PROSPECT_FOR_STAGE[b.stage]!, { close: b.stage === 'LOST' });
    await audit('opportunity', id, 'stage_changed', c.actor, { from: o.stage, to: b.stage });
  }
  return r;
});
// One deal per opportunity: the money once it is signed. Gross profit is computed by the database.
route('PUT', '/api/crm/opportunities/:id/deal', 'api', async (c) => {
  const id = needUuid(c.params.id, 'opportunity');
  const b = parse(z.object({ revenue_paise: paise, cost_paise: paise.default('0'), status: z.enum(['OPEN', 'DELIVERING', 'COMPLETE', 'CANCELLED']).default('OPEN'), signed_at: day }), c.body);
  if (!(await one('select 1 from opportunities where id=$1', [id]))) throw new HttpError(404, 'opportunity not found');
  const existing = await one('select id from deals where opportunity_id=$1 order by created_at desc limit 1', [id]);
  const d = existing
    ? await one(`update deals set revenue_paise=$2, cost_paise=$3, status=$4, signed_at=${SIGNED} where id=$1 returning id`, [existing.id, b.revenue_paise, b.cost_paise, b.status, b.signed_at ?? null])
    : await one(`insert into deals(opportunity_id,revenue_paise,cost_paise,status,signed_at) values($1,$2,$3,$4,${SIGNED}) returning id`, [id, b.revenue_paise, b.cost_paise, b.status, b.signed_at ?? null]);
  await audit('opportunity', id, existing ? 'deal_updated' : 'deal_recorded', c.actor, { revenue_paise: b.revenue_paise, status: b.status });
  return one(`select id, revenue_paise::text revenue_paise, cost_paise::text cost_paise, gross_profit_paise::text gross_profit_paise, status, ${SIGNED_DAY} signed_at from deals where id=$1`, [d!.id]);
});
