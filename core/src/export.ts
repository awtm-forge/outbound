// One row per company, for a spreadsheet: node src/export.ts > prospects.csv
import { q, pool } from './lib/db.ts';
const esc = (v: unknown) => { const s = v == null ? '' : Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const rows = await q(`select c.name, c.domain, ca.code campaign, p.status, p.screen_score, p.screen->>'can_pay' can_pay, p.screen->>'has_problem' has_problem, p.screen->>'reason' screen_reason,
    c.email company_email, c.phone company_phone, p.account_score, p.primary_problem, p.specific_observation, p.business_consequence, c.platform, c.city, c.metadata->>'gstin' gstin,
    ct.full_name person, ct.job_title person_title, ct.email person_email, ct.email_verification_status email_status, ct.email_source_url, ct.phone person_phone, ct.phone_source_url, ct.linkedin_url,
    (select count(*) from contacts x where x.company_id=c.id and x.full_name is not null) people_found,
    (select string_agg(e, '; ') from unnest(coalesce((select array_agg(x.email) from contacts x where x.company_id=c.id and x.email is not null and x.full_name is null), '{}')) e) site_emails,
    (select d.subject_original from email_drafts d where d.prospect_id=p.id order by d.created_at desc limit 1) draft_subject,
    (select d.status from email_drafts d where d.prospect_id=p.id order by d.created_at desc limit 1) draft_status,
    'https://ops.awtmforge.com/prospects/' || p.id link
  from prospects p join companies c on c.id=p.company_id left join campaigns ca on ca.id=p.campaign_id left join contacts ct on ct.id=p.contact_id
  where p.campaign_id is not null and c.domain not like '%.example' order by p.screen_score desc nulls last, p.account_score desc nulls last, c.name`);
const cols = Object.keys(rows[0] ?? {});
process.stdout.write(cols.join(',') + '\n' + rows.map((r) => cols.map((k) => esc(r[k])).join(',')).join('\n') + '\n');
await pool.end();
