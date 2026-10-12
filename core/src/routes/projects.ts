// Workspace: projects, tasks on a board, comments on tasks. Signed-in people only.
import { route } from '../lib/http.ts';
import { q, one, TODAY_IST } from '../lib/db.ts';
import { HttpError } from '../pipeline.ts';
import { parse, z, uuid, day, text, needUuid } from '../lib/validate.ts';
import { patchRow } from '../lib/patch.ts';

const PROJECT_STATUS = z.enum(['ACTIVE', 'ON_HOLD', 'DONE', 'ARCHIVED']);
const TASK_STATUS = z.enum(['TODO', 'DOING', 'REVIEW', 'DONE']);
const PRIORITY = z.enum(['LOW', 'MEDIUM', 'HIGH']);
const ProjectIn = z.object({
  name: text(120).min(1), description: text(5000).optional(), status: PROJECT_STATUS.optional(),
  owner_id: uuid.nullable().optional(), company_id: uuid.nullable().optional(), due_date: day,
});
const TaskIn = z.object({
  title: text(200).min(1), description: text(10000).optional(), status: TASK_STATUS.optional(), priority: PRIORITY.optional(),
  assignee_id: uuid.nullable().optional(), due_date: day,
});

const PROJECT_LIST = `select p.*, u.name owner_name, c.name company_name,
    count(t.id)::int tasks, count(t.id) filter (where t.status='DONE')::int done,
    count(t.id) filter (where t.status<>'DONE' and t.due_date < ${TODAY_IST})::int overdue
  from projects p left join users u on u.id=p.owner_id left join companies c on c.id=p.company_id left join tasks t on t.project_id=p.id`;
route('GET', '/api/projects', 'user', async (c) => {
  const s = c.url.searchParams.get('status');
  return q(`${PROJECT_LIST} where ($1::text is null and p.status <> 'ARCHIVED') or p.status = $1 group by p.id, u.name, c.name
    order by case p.status when 'ACTIVE' then 0 when 'ON_HOLD' then 1 when 'DONE' then 2 else 3 end, p.due_date nulls last, p.updated_at desc`, [s || null]);
});
route('POST', '/api/projects', 'user', async (c) => {
  const b = parse(ProjectIn, c.body);
  const p = (await one(`insert into projects(name,description,status,owner_id,company_id,due_date,created_by) values($1,$2,$3,$4,$5,$6,$7) returning *`,
    [b.name, b.description ?? '', b.status ?? 'ACTIVE', b.owner_id === undefined ? c.user!.id : b.owner_id, b.company_id ?? null, b.due_date ?? null, c.user!.id]))!;
  return { created: true, ...p };
});
route('GET', '/api/projects/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'project');
  const p = await one(`${PROJECT_LIST} where p.id=$1 group by p.id, u.name, c.name`, [id]); if (!p) throw new HttpError(404, 'project not found');
  const tasks = await q(`select t.*, u.name assignee_name, (select count(*)::int from task_comments k where k.task_id=t.id) comments
    from tasks t left join users u on u.id=t.assignee_id where t.project_id=$1
    order by case t.priority when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end, t.due_date nulls last, t.created_at`, [id]);
  return { ...p, task_list: tasks };
});
route('PATCH', '/api/projects/:id', 'user', async (c) => {
  const b = parse(ProjectIn.partial(), c.body);
  const p = await patchRow('projects', needUuid(c.params.id, 'project'), b); if (!p) throw new HttpError(404, 'project not found');
  return p;
});

// ---------- tasks ----------
route('GET', '/api/tasks', 'user', async (c) => {
  // ?mine=1: what is on my plate across every project, not done, soonest first
  const mine = c.url.searchParams.get('mine') === '1';
  return q(`select t.*, p.name project_name, u.name assignee_name from tasks t join projects p on p.id=t.project_id left join users u on u.id=t.assignee_id
    where t.status <> 'DONE' and p.status in ('ACTIVE','ON_HOLD') and ($1::uuid is null or t.assignee_id=$1)
    order by t.due_date nulls last, case t.priority when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end, t.created_at limit 300`, [mine ? c.user!.id : null]);
});
route('POST', '/api/projects/:id/tasks', 'user', async (c) => {
  const pid = needUuid(c.params.id, 'project'); const b = parse(TaskIn, c.body);
  if (!(await one('select 1 from projects where id=$1', [pid]))) throw new HttpError(404, 'project not found');
  const status = b.status ?? 'TODO';
  const t = (await one(`insert into tasks(project_id,title,description,status,priority,assignee_id,due_date,completed_at,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [pid, b.title, b.description ?? '', status, b.priority ?? 'MEDIUM', b.assignee_id ?? null, b.due_date ?? null, status === 'DONE' ? new Date() : null, c.user!.id]))!;
  return { created: true, ...t };
});
route('PATCH', '/api/tasks/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'task'); const b = parse(TaskIn.partial(), c.body);
  const before = await one('select status from tasks where id=$1', [id]); if (!before) throw new HttpError(404, 'task not found');
  const extra = b.status && b.status !== before.status ? { completed_at: b.status === 'DONE' ? new Date() : null } : {};
  return patchRow('tasks', id, { ...b, ...extra });
});
route('DELETE', '/api/tasks/:id', 'user', async (c) => {
  const r = await one('delete from tasks where id=$1 returning id', [needUuid(c.params.id, 'task')]); if (!r) throw new HttpError(404, 'task not found');
  return { deleted: true };
});
route('GET', '/api/tasks/:id/comments', 'user', async (c) => q(`select k.id, k.body, k.created_at, k.author_id, u.name author_name from task_comments k left join users u on u.id=k.author_id where k.task_id=$1 order by k.created_at`, [needUuid(c.params.id, 'task')]));
route('POST', '/api/tasks/:id/comments', 'user', async (c) => {
  const id = needUuid(c.params.id, 'task'); const b = parse(z.object({ body: text(5000).min(1) }), c.body);
  if (!(await one('select 1 from tasks where id=$1', [id]))) throw new HttpError(404, 'task not found');
  const k = (await one('insert into task_comments(task_id,author_id,body) values($1,$2,$3) returning id, body, created_at, author_id', [id, c.user!.id, b.body]))!;
  return { created: true, ...k, author_name: c.user!.name };
});
