// People: the team directory on top of the HR records (routes/hr.ts). Everyone signed in reads the directory, the org
// chart and who is out; a person edits their own contact details and skills; admins edit everything else and add
// people, with or without a sign-in. Pay never appears here: it stays on the admin-only HR routes.
//
// Availability is only what the data supports: on leave (approved leave covering today, or marked on leave), active
// (used the app in the last five minutes), active today, or the last time they used it. Nothing is guessed.
import { route, type Ctx } from '../lib/http.ts';
import { q, one, tx, audit, TODAY_IST } from '../lib/db.ts';
import { HttpError } from '../pipeline.ts';
import { parse, z, uuid, text, optText, day, needUuid } from '../lib/validate.ts';
import { hashPassword, checkPassword } from '../lib/auth.ts';
import { readUpload, storeFile } from './files.ts';

const isAdmin = (c: Ctx) => c.user?.role === 'admin';
const AVAIL = `case when e.status = 'EXITED' then 'former'
    when e.status = 'ON_LEAVE' or lv.end_date is not null then 'on_leave'
    when u.id is null or not u.active then 'no_signin'
    when u.last_seen_at >= now() - interval '5 minutes' then 'active'
    when u.last_seen_at >= (${TODAY_IST})::timestamp at time zone 'Asia/Kolkata' then 'today'
    when u.last_seen_at is not null then 'away' else 'never' end`;
const ROW = `e.id, e.user_id, e.full_name, e.work_email::text, e.phone, e.job_title, e.department, e.employment_type, e.status, e.start_date, e.end_date, e.manager_id,
  m.full_name manager_name, e.location, e.linkedin_url, e.skills, e.avatar_file_id, e.created_at, u.username::text username, u.role access, u.active signin_active,
  u.last_seen_at, lv.end_date leave_until, lv.half_day leave_half, ${AVAIL} availability`;
const FROM = `from employees e left join employees m on m.id = e.manager_id left join users u on u.id = e.user_id
  left join lateral (select l.end_date, l.half_day from leave_requests l where l.employee_id = e.id and l.status = 'APPROVED' and ${TODAY_IST} between l.start_date and l.end_date order by l.end_date desc limit 1) lv on true`;

route('GET', '/api/people', 'user', async (c) => q(`select ${ROW} ${FROM} where $1 or e.status <> 'EXITED' order by e.status = 'EXITED', lower(e.full_name)`, [c.url.searchParams.get('former') === '1']));
route('GET', '/api/people/summary', 'user', async () => {
  const rows = await q(`select e.status, e.department, coalesce(e.start_date, e.created_at::date)::text joined, (u.id is not null and u.active) has_signin, ${AVAIL} availability ${FROM} where e.status <> 'EXITED'`);
  const month = (await one(`select date_trunc('month', ${TODAY_IST})::date::text m`))!.m as string;
  const depts = new Map<string, number>(); for (const r of rows) if (r.department) depts.set(r.department, (depts.get(r.department) ?? 0) + 1);
  return {
    members: rows.length,
    added_month: rows.filter((r) => r.joined >= month).length,
    with_signin: rows.filter((r) => r.has_signin).length,
    active_today: rows.filter((r) => r.availability === 'active' || r.availability === 'today').length,
    active_now: rows.filter((r) => r.availability === 'active').length,
    on_leave: rows.filter((r) => r.availability === 'on_leave').length,
    departments: [...depts].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })),
  };
});

route('GET', '/api/people/leave', 'user', async (c) => {
  const admin = isAdmin(c); const sp = c.url.searchParams;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('from') ?? '') ? sp.get('from') : null; const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('to') ?? '') ? sp.get('to') : null;
  // the kind and the reason are for the person themselves and admins; everyone else sees names and days
  const cols = `l.id, l.employee_id, e.full_name, e.avatar_file_id, e.department, l.start_date, l.end_date, l.half_day, l.days::text days, l.status, l.created_at, l.decided_at, du.name decided_by_name,
    (e.user_id = $1) mine, case when $2 or e.user_id = $1 then l.kind end kind, case when $2 or e.user_id = $1 then l.reason end reason`;
  const base = `from leave_requests l join employees e on e.id = l.employee_id left join users du on du.id = l.decided_by`;
  const me = c.user!.id;
  const [today, upcoming, pending, past, calendar] = await Promise.all([
    q(`select ${cols} ${base} where l.status = 'APPROVED' and ${TODAY_IST} between l.start_date and l.end_date order by l.end_date`, [me, admin]),
    q(`select ${cols} ${base} where l.status = 'APPROVED' and l.start_date > ${TODAY_IST} order by l.start_date limit 100`, [me, admin]),
    q(`select ${cols} ${base} where l.status = 'PENDING' and ($2 or e.user_id = $1) order by l.start_date limit 100`, [me, admin]),
    q(`select ${cols} ${base} where l.end_date < ${TODAY_IST} and l.end_date >= ${TODAY_IST} - 365 and ($2 or e.user_id = $1 or l.status = 'APPROVED') order by l.start_date desc limit 150`, [me, admin]),
    q(`select ${cols} ${base} where (l.status = 'APPROVED' or (l.status = 'PENDING' and ($2 or e.user_id = $1)))
      and l.end_date >= coalesce($3::date, date_trunc('month', ${TODAY_IST})::date) and l.start_date <= coalesce($4::date, (date_trunc('month', ${TODAY_IST}) + interval '1 month - 1 day')::date) order by l.start_date`, [me, admin, from, to]),
  ]);
  const record = await one('select id from employees where user_id = $1', [me]);
  return { today, upcoming, pending, past, calendar, my_employee_id: record?.id ?? null, can_decide: admin };
});

route('GET', '/api/people/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'person');
  const e = await one(`select ${ROW} ${FROM} where e.id = $1`, [id]); if (!e) throw new HttpError(404, 'person not found');
  const own = !!e.user_id && e.user_id === c.user!.id; const admin = isAdmin(c);
  const [reports, projects, leave] = await Promise.all([
    q(`select id, full_name, job_title, avatar_file_id from employees where manager_id = $1 and status <> 'EXITED' order by lower(full_name)`, [id]),
    e.user_id ? q(`select p.id, p.name, p.color, p.status, (p.owner_id = $1) is_owner,
        (select count(*)::int from tasks t where t.project_id = p.id and t.assignee_id = $1 and t.status <> 'DONE' and t.archived_at is null) open_tasks
      from project_members pm join projects p on p.id = pm.project_id where pm.user_id = $1 order by p.status = 'ARCHIVED', p.status = 'DONE', p.updated_at desc`, [e.user_id]) : Promise.resolve([]),
    q(`select l.id, l.start_date, l.end_date, l.half_day, l.days::text days, l.status, case when $2 then l.kind end kind, case when $2 then l.reason end reason
      from leave_requests l where l.employee_id = $1 and l.end_date >= ${TODAY_IST} and (l.status = 'APPROVED' or ($2 and l.status = 'PENDING')) order by l.start_date limit 20`, [id, own || admin]),
  ]);
  return { ...e, reports, projects, leave, can_edit: own || admin, can_admin: admin };
});

// ---------- add and edit ----------
const skills = z.array(z.string().trim().min(1).max(40)).max(30).transform((l) => { const seen = new Set<string>(); return l.filter((s) => { const k = s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); });
const linkedin = z.string().trim().max(300).nullable().optional().transform((v, ctx) => {
  if (v === undefined) return undefined; if (!v) return null;
  const url = /^https?:\/\//i.test(v) ? v.replace(/^http:/i, 'https:') : `https://${v.replace(/^\/+/, '')}`;
  if (!/^https:\/\/([a-z]{2,3}\.)?linkedin\.com\//i.test(url)) { ctx.addIssue({ code: 'custom', message: 'use a LinkedIn address, like linkedin.com/in/name' }); return z.NEVER; }
  return url.replace(/^https:\/\/linkedin\.com/i, 'https://www.linkedin.com');
});
const email = z.string().trim().toLowerCase().email('that email does not look right').max(200).nullable().optional().or(z.literal('').transform(() => null));
const SELF = { phone: optText(40), location: optText(120), linkedin_url: linkedin, skills: skills.optional() };
const ADMIN = { full_name: text(120).min(2), work_email: email, job_title: optText(120), department: optText(80), manager_id: uuid.nullable().optional(), user_id: uuid.nullable().optional(),
  employment_type: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'INTERN']).optional(), status: z.enum(['ACTIVE', 'ON_LEAVE', 'EXITED']).optional(), start_date: day, end_date: day };
const SELF_KEYS = Object.keys(SELF);

async function checkManager(id: string | null, manager: string | null | undefined) {
  if (!manager) return;
  if (id && manager === id) throw new HttpError(400, 'Someone cannot report to themselves.');
  if (!(await one('select 1 from employees where id = $1', [manager]))) throw new HttpError(400, 'That manager is not in the directory.');
  if (id && await one(`with recursive up as (select id, manager_id from employees where id = $1 union all select e.id, e.manager_id from employees e join up on e.id = up.manager_id) select 1 from up where id = $2`, [manager, id]))
    throw new HttpError(400, 'That would make a loop: the new manager already reports to this person.');
}
async function checkUnique(id: string | null, b: { work_email?: string | null; user_id?: string | null }) {
  if (b.work_email) { const d = await one('select full_name from employees where work_email = $1 and id is distinct from $2', [b.work_email, id]); if (d) throw new HttpError(409, `${d.full_name} already uses ${b.work_email}.`); }
  if (b.user_id) {
    if (!(await one('select 1 from users where id = $1', [b.user_id]))) throw new HttpError(400, 'That sign-in does not exist.');
    const d = await one('select full_name from employees where user_id = $1 and id is distinct from $2', [b.user_id, id]); if (d) throw new HttpError(409, `That sign-in already belongs to ${d.full_name}.`);
  }
}

route('PATCH', '/api/people/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'person');
  const e = await one('select id, user_id, full_name from employees where id = $1', [id]); if (!e) throw new HttpError(404, 'person not found');
  const own = !!e.user_id && e.user_id === c.user!.id;
  if (!own && !isAdmin(c)) throw new HttpError(403, 'Only the person or an admin can change this profile.');
  const raw = (c.body ?? {}) as Record<string, unknown>;
  // anything beyond contact details and skills is an admin's call, checked here and not only in the form
  if (!isAdmin(c) && Object.keys(raw).some((k) => !SELF_KEYS.includes(k))) throw new HttpError(403, 'Only an admin can change the title, team, manager or status.');
  const b = parse(z.object({ ...SELF, ...ADMIN }).partial(), raw);
  if (b.manager_id !== undefined) await checkManager(id, b.manager_id);
  await checkUnique(id, b);
  const keys = Object.keys(b).filter((k) => (b as any)[k] !== undefined);
  if (!keys.length) throw new HttpError(400, 'nothing to change');
  const r = await one(`update employees set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning id, full_name`, [id, ...keys.map((k) => (b as any)[k])]);
  await audit('employee', id, 'updated', c.actor, { fields: keys, user_id: c.user!.id });
  return r;
});

const NewPerson = z.object({ ...ADMIN, ...SELF,
  // optional: also make a sign-in, with a temporary password the person changes the first time they sign in
  signin: z.object({ username: z.string().trim().regex(/^[A-Za-z0-9._-]{2,40}$/, 'letters, numbers, dot, dash or underscore, 2 to 40 of them'), role: z.enum(['admin', 'member']).default('member'), password: z.string() }).optional() });
route('POST', '/api/people', 'admin', async (c) => {
  const b = parse(NewPerson, c.body);
  if (b.signin && b.user_id) throw new HttpError(400, 'Link an existing sign-in or make a new one, not both.');
  await checkManager(null, b.manager_id); await checkUnique(null, b);
  let pw: string | null = null;
  if (b.signin) {
    pw = checkPassword(b.signin.password);
    if (await one('select 1 from users where username = $1', [b.signin.username])) throw new HttpError(409, 'That username is taken.');
    if (b.work_email && await one('select 1 from users where email = $1', [b.work_email])) throw new HttpError(409, 'A sign-in already uses that email. Link it instead of making a new one.');
  }
  const hash = pw ? await hashPassword(pw) : null;
  const made = await tx(async (db) => {
    let userId = b.user_id ?? null;
    if (b.signin) {
      userId = (await db.query(`insert into users(username,name,email,role,password_hash,must_change_password,created_by) values($1,$2,$3,$4,$5,true,$6) returning id`,
        [b.signin.username, b.full_name, b.work_email ?? null, b.signin.role, hash, c.actor])).rows[0].id;
    }
    const e = (await db.query(`insert into employees(full_name,user_id,work_email,phone,job_title,department,location,employment_type,status,start_date,end_date,manager_id,linkedin_url,skills)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id, full_name`,
      [b.full_name, userId, b.work_email ?? null, b.phone ?? null, b.job_title ?? null, b.department ?? null, b.location ?? null, b.employment_type ?? 'FULL_TIME', b.status ?? 'ACTIVE',
        b.start_date ?? null, b.end_date ?? null, b.manager_id ?? null, b.linkedin_url ?? null, b.skills ?? []])).rows[0];
    return { ...e, user_id: userId };
  });
  if (b.signin) await audit('user', made.user_id!, 'user_created', c.actor, { username: b.signin.username, role: b.signin.role });
  await audit('employee', made.id, 'created', c.actor, { signin: b.signin ? 'new' : b.user_id ? 'linked' : 'none' });
  return { created: true, ...made };
});

// ---------- photo ----------
route('POST', '/api/people/:id/avatar', 'user', async (c) => {
  const id = needUuid(c.params.id, 'person');
  const e = await one('select id, user_id, avatar_file_id from employees where id = $1', [id]); if (!e) throw new HttpError(404, 'person not found');
  if (!(e.user_id === c.user!.id || isAdmin(c))) throw new HttpError(403, 'Only the person or an admin can change this photo.');
  const up = readUpload(c);
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(up.mime)) throw new HttpError(415, 'Use a PNG, JPEG or WebP picture.');
  if (up.data.length > 2_000_000) throw new HttpError(413, 'Use a picture under 2 MB.');
  const f = await storeFile({ employee_id: id }, up, c.user!.id);
  await q('update employees set avatar_file_id = $2 where id = $1', [id, f.id]);
  if (e.avatar_file_id) await q('delete from project_files where id = $1', [e.avatar_file_id]);
  await audit('employee', id, 'photo_changed', c.actor, { user_id: c.user!.id });
  return { created: true, avatar_file_id: f.id };
}, { raw: 2_100_000 });
route('DELETE', '/api/people/:id/avatar', 'user', async (c) => {
  const id = needUuid(c.params.id, 'person');
  const e = await one('select id, user_id, avatar_file_id from employees where id = $1', [id]); if (!e) throw new HttpError(404, 'person not found');
  if (!(e.user_id === c.user!.id || isAdmin(c))) throw new HttpError(403, 'Only the person or an admin can change this photo.');
  if (e.avatar_file_id) { await q('update employees set avatar_file_id = null where id = $1', [id]); await q('delete from project_files where id = $1', [e.avatar_file_id]); }
  return { deleted: true };
});
