// Workspace: HR. Everyone signed in sees the directory and who is out; people ask for leave; admins manage records,
// decide leave and are the only ones who ever see pay. The API key opens none of it.
//
// Pay is kept out by construction: DIRECTORY names its columns and never touches employee_compensation; only the
// admin branches below and the 'admin' routes read that table.
import { route } from '../lib/http.ts';
import { q, one, audit, TODAY_IST } from '../lib/db.ts';
import { HttpError } from '../pipeline.ts';
import { parse, z, uuid, text, optText, day, needUuid } from '../lib/validate.ts';
import { patchRow } from '../lib/patch.ts';
import type { Ctx } from '../lib/http.ts';

const DIRECTORY = `e.id, e.user_id, e.full_name, e.work_email::text, e.phone, e.job_title, e.department, e.employment_type, e.status, e.start_date, e.end_date,
  e.manager_id, m.full_name manager_name, e.location`;
const CURRENT_PAY = `(select row_to_json(x) from (select c.amount_paise::text amount_paise, c.period, c.currency, c.effective_from from employee_compensation c
  where c.employee_id = e.id and c.effective_from <= ${TODAY_IST} order by c.effective_from desc, c.created_at desc limit 1) x)`;
const isAdmin = (c: Ctx) => c.user?.role === 'admin';
const EmployeeIn = z.object({
  full_name: text(120).min(2), user_id: uuid.nullable().optional(),
  work_email: z.string().trim().toLowerCase().email().max(200).nullable().optional().or(z.literal('').transform(() => null)),
  phone: optText(40), job_title: optText(120), department: optText(80), location: optText(120),
  employment_type: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'INTERN']).optional(), status: z.enum(['ACTIVE', 'ON_LEAVE', 'EXITED']).optional(),
  start_date: day, end_date: day, manager_id: uuid.nullable().optional(),
});

route('GET', '/api/hr/employees', 'user', async (c) => {
  const all = c.url.searchParams.get('all') === '1';
  return q(`select ${DIRECTORY}${isAdmin(c) ? `, ${CURRENT_PAY} pay` : ''} from employees e left join employees m on m.id = e.manager_id
    where $1 or e.status <> 'EXITED' order by e.status = 'EXITED', lower(e.full_name)`, [all]);
});
route('GET', '/api/hr/me', 'user', async (c) => (await one(`select ${DIRECTORY} from employees e left join employees m on m.id = e.manager_id where e.user_id = $1`, [c.user!.id])) ?? null);
route('GET', '/api/hr/employees/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'person');
  const e = await one(`select ${DIRECTORY} from employees e left join employees m on m.id = e.manager_id where e.id = $1`, [id]); if (!e) throw new HttpError(404, 'person not found');
  const reports = await q(`select id, full_name, job_title from employees where manager_id = $1 and status <> 'EXITED' order by full_name`, [id]);
  const own = e.user_id === c.user!.id;
  // leave: the person and admins see the requests; everyone else sees nothing here (who is out is on the calendar)
  const leave = own || isAdmin(c) ? await q(`select id, kind, start_date, end_date, half_day, days::text days, reason, status, decided_at from leave_requests where employee_id = $1 order by start_date desc limit 50`, [id]) : [];
  if (!isAdmin(c)) return { ...e, reports, leave };
  const compensation = await q(`select c.id, c.amount_paise::text amount_paise, c.period, c.currency, c.effective_from, c.note, c.created_at, u.name created_by_name
    from employee_compensation c left join users u on u.id = c.created_by where c.employee_id = $1 order by c.effective_from desc, c.created_at desc`, [id]);
  return { ...e, reports, leave, compensation };
});
route('POST', '/api/hr/employees', 'admin', async (c) => {
  const b = parse(EmployeeIn, c.body);
  const e = (await one(`insert into employees(full_name,user_id,work_email,phone,job_title,department,location,employment_type,status,start_date,end_date,manager_id)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id, full_name`,
    [b.full_name, b.user_id ?? null, b.work_email ?? null, b.phone ?? null, b.job_title ?? null, b.department ?? null, b.location ?? null, b.employment_type ?? 'FULL_TIME', b.status ?? 'ACTIVE', b.start_date ?? null, b.end_date ?? null, b.manager_id ?? null]))!;
  await audit('employee', e.id, 'created', c.actor);
  return { created: true, ...e };
});
route('PATCH', '/api/hr/employees/:id', 'admin', async (c) => {
  const id = needUuid(c.params.id, 'person'); const b = parse(EmployeeIn.partial(), c.body);
  if (b.manager_id === id) throw new HttpError(400, 'Someone cannot report to themselves.');
  if (b.manager_id && await one(`with recursive up as (select id, manager_id from employees where id=$1 union all select e.id, e.manager_id from employees e join up on e.id=up.manager_id) select 1 from up where id=$2`, [b.manager_id, id]))
    throw new HttpError(400, 'That would make a loop: the new manager reports to this person.');
  const r = await patchRow('employees', id, b, 'id, full_name, status'); if (!r) throw new HttpError(404, 'person not found');
  await audit('employee', id, 'updated', c.actor, { fields: Object.keys(b) });
  return r;
});

// ---------- pay: admins only, every route ----------
route('GET', '/api/hr/employees/:id/compensation', 'admin', async (c) => q(`select id, amount_paise::text amount_paise, period, currency, effective_from, note, created_at from employee_compensation where employee_id=$1 order by effective_from desc, created_at desc`, [needUuid(c.params.id, 'person')]));
route('POST', '/api/hr/employees/:id/compensation', 'admin', async (c) => {
  const id = needUuid(c.params.id, 'person');
  const b = parse(z.object({
    amount_paise: z.union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^[1-9]\d{0,15}$/, 'whole paise')]).transform(String),
    period: z.enum(['MONTHLY', 'ANNUAL']).default('MONTHLY'), currency: z.string().regex(/^[A-Z]{3}$/).default('INR'),
    effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD'), note: optText(500),
  }), c.body);
  if (!(await one('select 1 from employees where id=$1', [id]))) throw new HttpError(404, 'person not found');
  const r = (await one(`insert into employee_compensation(employee_id,amount_paise,period,currency,effective_from,note,created_by) values($1,$2,$3,$4,$5,$6,$7) returning id`,
    [id, b.amount_paise, b.period, b.currency, b.effective_from, b.note ?? null, c.user!.id]))!;
  // the trail says that pay changed and who changed it, never the amount
  await audit('employee', id, 'compensation_added', c.actor, { effective_from: b.effective_from });
  return { created: true, id: r.id };
});
route('DELETE', '/api/hr/compensation/:id', 'admin', async (c) => {
  const r = await one('delete from employee_compensation where id=$1 returning employee_id', [needUuid(c.params.id, 'pay record')]); if (!r) throw new HttpError(404, 'pay record not found');
  await audit('employee', r.employee_id, 'compensation_removed', c.actor);
  return { deleted: true };
});

// ---------- leave ----------
// Monday to Friday between two calendar days, both counted; a half day is 0.5.
export function workingDays(start: string, end: string, half = false) {
  const a = Date.parse(start + 'T00:00:00Z'), b = Date.parse(end + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) throw new HttpError(400, 'The leave has to end on or after the day it starts.');
  if ((b - a) / 86400_000 > 366) throw new HttpError(400, 'Ask for at most a year at a time.');
  let n = 0; for (let t = a; t <= b; t += 86400_000) { const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) n++; }
  return half ? Math.min(n, 0.5) : n;
}
const LEAVE = `l.id, l.employee_id, e.full_name, l.kind, l.start_date, l.end_date, l.half_day, l.days::text days, l.reason, l.status, l.created_at, l.decided_at, du.name decided_by_name`;
route('GET', '/api/hr/leave', 'user', async (c) => {
  // admins: everything recent, pending first. Members: their own.
  if (isAdmin(c) && c.url.searchParams.get('mine') !== '1')
    return q(`select ${LEAVE} from leave_requests l join employees e on e.id=l.employee_id left join users du on du.id=l.decided_by
      where l.status = 'PENDING' or l.end_date >= ${TODAY_IST} - 90 order by l.status <> 'PENDING', l.start_date desc limit 300`);
  return q(`select ${LEAVE} from leave_requests l join employees e on e.id=l.employee_id left join users du on du.id=l.decided_by where e.user_id=$1 order by l.start_date desc limit 100`, [c.user!.id]);
});
// Who is out: approved leave overlapping the window. Names and days only; the kind and the reason stay with the person and admins.
route('GET', '/api/hr/out', 'user', async (c) => {
  const sp = c.url.searchParams; const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('from') ?? '') ? sp.get('from') : null; const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('to') ?? '') ? sp.get('to') : null;
  return q(`select l.employee_id, e.full_name, l.start_date, l.end_date, l.half_day${isAdmin(c) ? ', l.kind' : ''} from leave_requests l join employees e on e.id=l.employee_id
    where l.status='APPROVED' and l.end_date >= coalesce($1::date, ${TODAY_IST}) and l.start_date <= coalesce($2::date, ${TODAY_IST} + 30) order by l.start_date`, [from, to]);
});
route('POST', '/api/hr/leave', 'user', async (c) => {
  const b = parse(z.object({ employee_id: uuid.optional(), kind: z.enum(['CASUAL', 'SICK', 'EARNED', 'UNPAID', 'OTHER']).default('CASUAL'),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD'), end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD'), half_day: z.boolean().default(false), reason: optText(1000) }), c.body);
  // your own record; an admin may file for anyone
  const me = await one('select id from employees where user_id=$1', [c.user!.id]);
  const emp = b.employee_id && b.employee_id !== me?.id ? (isAdmin(c) ? b.employee_id : null) : me?.id;
  if (!emp) throw new HttpError(b.employee_id ? 403 : 409, b.employee_id ? 'You can ask for leave for yourself only.' : 'You have no HR record yet. Ask an admin to add you under People.');
  if (b.half_day && b.start_date !== b.end_date) throw new HttpError(400, 'A half day starts and ends on the same day.');
  const days = workingDays(b.start_date, b.end_date, b.half_day);
  if (await one(`select 1 from leave_requests where employee_id=$1 and status in ('PENDING','APPROVED') and start_date <= $3 and end_date >= $2`, [emp, b.start_date, b.end_date]))
    throw new HttpError(409, 'Those days overlap leave already asked for.');
  const r = (await one(`insert into leave_requests(employee_id,kind,start_date,end_date,half_day,days,reason,created_by) values($1,$2,$3,$4,$5,$6,$7,$8) returning id, status, days::text days`,
    [emp, b.kind, b.start_date, b.end_date, b.half_day, days, b.reason ?? null, c.user!.id]))!;
  return { created: true, ...r };
});
route('POST', '/api/hr/leave/:id/decision', 'admin', async (c) => {
  const action = parse(z.object({ action: z.enum(['APPROVE', 'REJECT']) }), c.body).action;
  const r = await one(`update leave_requests set status=$2, decided_by=$3, decided_at=now() where id=$1 and status='PENDING' returning id, status`, [needUuid(c.params.id, 'leave request'), action === 'APPROVE' ? 'APPROVED' : 'REJECTED', c.user!.id]);
  if (!r) throw new HttpError(409, 'That request is no longer waiting for a decision.');
  return r;
});
route('POST', '/api/hr/leave/:id/cancel', 'user', async (c) => {
  const l = await one(`select l.status, l.start_date, e.user_id from leave_requests l join employees e on e.id=l.employee_id where l.id=$1`, [needUuid(c.params.id, 'leave request')]);
  if (!l) throw new HttpError(404, 'leave request not found');
  if (l.user_id !== c.user!.id && !isAdmin(c)) throw new HttpError(403, 'Only the person or an admin can cancel leave.');
  if (!['PENDING', 'APPROVED'].includes(l.status)) throw new HttpError(409, `That request is already ${l.status.toLowerCase()}.`);
  return one(`update leave_requests set status='CANCELLED' where id=$1 returning id, status`, [c.params.id]);
});
