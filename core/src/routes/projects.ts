// Workspace: projects, their board columns, tasks with subtasks and dependencies, milestones, links, members, saved
// views, and a project activity timeline. Signed-in people only; everyone signed in sees every project.
import { route, type Ctx } from '../lib/http.ts';
import { q, one, tx, audit, TODAY_IST, type Row } from '../lib/db.ts';
import { HttpError } from '../pipeline.ts';
import { parse, z, uuid, day, text, needUuid } from '../lib/validate.ts';
import { patchRow } from '../lib/patch.ts';
import { notify } from './notifications.ts';

const PROJECT_STATUS = z.enum(['ACTIVE', 'ON_HOLD', 'DONE', 'ARCHIVED']);
const TASK_STATUS = z.enum(['TODO', 'DOING', 'REVIEW', 'DONE']);
const PRIORITY = z.enum(['LOW', 'MEDIUM', 'HIGH']);
// any colour, as #RRGGBB; stored upper case. null puts the project back on the theme's orange.
export const HEX = z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/, 'use a colour like #3B82F6').transform((v) => '#' + v.replace('#', '').toUpperCase());
const ProjectIn = z.object({
  name: text(120).min(1), description: text(5000).optional(), status: PROJECT_STATUS.optional(),
  owner_id: uuid.nullable().optional(), company_id: uuid.nullable().optional(), due_date: day, color: HEX.nullable().optional(),
});
const label = z.string().trim().min(1).max(30);
const hours = z.number().min(0).max(9999).nullable().optional();
const TaskIn = z.object({
  title: text(200).min(1), description: text(10000).optional(), status: TASK_STATUS.optional(), priority: PRIORITY.optional(),
  assignee_id: uuid.nullable().optional(), due_date: day, start_date: day, parent_id: uuid.nullable().optional(), milestone_id: uuid.nullable().optional(),
  labels: z.array(label).max(12).optional(), estimate_hours: hours, actual_hours: hours,
  column_id: uuid.optional(), position: z.number().finite().optional(), collaborator_ids: z.array(uuid).max(20).optional(),
});
const DEFAULT_COLUMNS: [string, string][] = [['To do', 'TODO'], ['In progress', 'DOING'], ['In review', 'REVIEW'], ['Done', 'DONE']];
const STATUS_WORD: Record<string, string> = { TODO: 'To do', DOING: 'In progress', REVIEW: 'In review', DONE: 'Done' };

// Every project event lands on the activities table against the project, with the person's id for their name.
export const act = (pid: string | null | undefined, c: Ctx, action: string, detail: Row = {}) => pid ? audit('project', pid, action, c.actor, { ...detail, user_id: c.user?.id ?? null }) : Promise.resolve();
export async function needProject(id: string) { const p = await one('select id, name from projects where id=$1', [needUuid(id, 'project')]); if (!p) throw new HttpError(404, 'project not found'); return p; }

const PROJECT_LIST = `select p.*, u.name owner_name, c.name company_name,
    count(t.id) filter (where t.archived_at is null)::int tasks, count(t.id) filter (where t.status='DONE' and t.archived_at is null)::int done,
    count(t.id) filter (where t.status<>'DONE' and t.archived_at is null and t.due_date < ${TODAY_IST})::int overdue,
    count(t.id) filter (where t.status='DOING' and t.archived_at is null)::int doing
  from projects p left join users u on u.id=p.owner_id left join companies c on c.id=p.company_id left join tasks t on t.project_id=p.id`;
route('GET', '/api/projects', 'user', async (c) => {
  const s = c.url.searchParams.get('status');
  const rows = await q(`${PROJECT_LIST} where ($1::text is null and p.status <> 'ARCHIVED') or p.status = $1 group by p.id, u.name, c.name
    order by case p.status when 'ACTIVE' then 0 when 'ON_HOLD' then 1 when 'DONE' then 2 else 3 end, p.due_date nulls last, p.updated_at desc`, [s || null]);
  if (!rows.length) return rows;
  // the latest event and the team of each, for the cards
  const ids = rows.map((r) => r.id);
  const [last, members] = await Promise.all([
    q(`select distinct on (a.entity_id) a.entity_id, a.action, a.detail, a.created_at, u.name actor_name from activities a left join users u on u.id = (a.detail->>'user_id')::uuid
      where a.entity_type='project' and a.entity_id = any($1) order by a.entity_id, a.created_at desc`, [ids]),
    q(`select m.project_id, u.id, u.name from project_members m join users u on u.id=m.user_id where m.project_id = any($1) order by m.added_at`, [ids]),
  ]);
  return rows.map((r) => ({ ...r, last_activity: last.find((a) => a.entity_id === r.id) ?? null, members: members.filter((m) => m.project_id === r.id).map(({ id, name }) => ({ id, name })) }));
});
// how many projects are in each state, for the cards at the top of Projects
route('GET', '/api/projects/summary', 'user', async () => one(`select count(*) filter (where status='ACTIVE')::int active, count(*) filter (where status='ON_HOLD')::int on_hold,
  count(*) filter (where status='DONE')::int done, count(*) filter (where status='ARCHIVED')::int archived from projects`));
route('POST', '/api/projects', 'user', async (c) => {
  const b = parse(ProjectIn, c.body);
  const owner = b.owner_id === undefined ? c.user!.id : b.owner_id;
  const p = await tx(async (db) => {
    const p = (await db.query(`insert into projects(name,description,status,owner_id,company_id,due_date,color,created_by) values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [b.name, b.description ?? '', b.status ?? 'ACTIVE', owner, b.company_id ?? null, b.due_date ?? null, b.color ?? null, c.user!.id])).rows[0];
    for (const [i, [name, status]] of DEFAULT_COLUMNS.entries()) await db.query('insert into board_columns(project_id,name,status,position) values($1,$2,$3,$4)', [p.id, name, status, i + 1]);
    for (const uid of new Set([owner, c.user!.id].filter(Boolean))) await db.query('insert into project_members(project_id,user_id,added_by) values($1,$2,$3) on conflict do nothing', [p.id, uid, c.user!.id]);
    return p;
  });
  await act(p.id, c, 'project_created', { name: p.name });
  return { created: true, ...p };
});

const TASK_COLS = `t.*, u.name assignee_name,
  (select count(*)::int from task_comments k where k.task_id=t.id) comments,
  (select count(*)::int from project_files f where f.task_id=t.id) files,
  (select count(*)::int from tasks s where s.parent_id=t.id and s.archived_at is null) subtasks,
  (select count(*)::int from tasks s where s.parent_id=t.id and s.archived_at is null and s.status='DONE') subtasks_done,
  exists (select 1 from task_dependencies d join tasks b on b.id=d.depends_on_id where d.task_id=t.id and d.kind='BLOCKS' and b.status<>'DONE') blocked,
  coalesce((select array_agg(x.user_id) from task_collaborators x where x.task_id=t.id), '{}') collaborator_ids`;
route('GET', '/api/projects/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'project'); const archived = c.url.searchParams.get('archived') === '1';
  const p = await one(`${PROJECT_LIST} where p.id=$1 group by p.id, u.name, c.name`, [id]); if (!p) throw new HttpError(404, 'project not found');
  const [tasks, columns, milestones, members, links, counts, updated, dependencies] = await Promise.all([
    q(`select ${TASK_COLS} from tasks t left join users u on u.id=t.assignee_id where t.project_id=$1 and ($2 or t.archived_at is null)
      order by case t.priority when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end, t.due_date nulls last, t.created_at`, [id, archived]),
    q('select * from board_columns where project_id=$1 order by position, created_at', [id]),
    q(`select m.*, u.name owner_name, (select count(*)::int from tasks t where t.milestone_id=m.id and t.archived_at is null) tasks,
        (select count(*)::int from tasks t where t.milestone_id=m.id and t.archived_at is null and t.status='DONE') done from milestones m left join users u on u.id=m.owner_id
      where m.project_id=$1 order by m.status, m.target_date nulls last, m.created_at`, [id]),
    q(`select u.id, u.name, u.role, m.added_at, (u.id = $2::uuid) owner from project_members m join users u on u.id=m.user_id where m.project_id=$1 order by (u.id = $2::uuid) desc, m.added_at`, [id, p.owner_id]),
    q('select * from project_links where project_id=$1 order by position, created_at', [id]),
    one(`select count(*) filter (where status='REVIEW')::int review,
        count(*) filter (where status<>'DONE' and exists (select 1 from task_dependencies d join tasks b on b.id=d.depends_on_id where d.task_id=t.id and d.kind='BLOCKS' and b.status<>'DONE'))::int blocked,
        count(*) filter (where status<>'DONE' and due_date = ${TODAY_IST})::int due_today
      from tasks t where project_id=$1 and archived_at is null`, [id]),
    one(`select a.created_at, u.name from activities a left join users u on u.id = (a.detail->>'user_id')::uuid where a.entity_type='project' and a.entity_id=$1 order by a.created_at desc limit 1`, [id]),
    q('select d.task_id, d.depends_on_id, d.kind from task_dependencies d join tasks t on t.id=d.task_id where t.project_id=$1', [id]),
  ]);
  return { ...p, task_list: tasks, columns, milestones, members, links, counts, last_updated: updated ?? null, dependencies };
});
route('PATCH', '/api/projects/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'project'); const b = parse(ProjectIn.partial(), c.body);
  const before = await one('select * from projects where id=$1', [id]); if (!before) throw new HttpError(404, 'project not found');
  const p = await patchRow('projects', id, b);
  const changed = Object.keys(b).filter((k) => (b as any)[k] !== undefined && String((b as any)[k] ?? '') !== String(before[k] ?? ''));
  if (b.owner_id) await q('insert into project_members(project_id,user_id,added_by) values($1,$2,$3) on conflict do nothing', [id, b.owner_id, c.user!.id]);
  if (changed.length) await act(id, c, changed.includes('status') ? 'project_status' : changed.length === 1 && changed[0] === 'color' ? 'project_color' : 'project_updated',
    { fields: changed, ...(changed.includes('status') ? { from: before.status, to: b.status } : {}), ...(changed.includes('color') ? { color: b.color ?? null } : {}) });
  return p;
});

// ---------- members and links ----------
route('POST', '/api/projects/:id/members', 'user', async (c) => {
  const p = await needProject(c.params.id); const b = parse(z.object({ user_id: uuid }), c.body);
  const u = await one('select id, name from users where id=$1 and active', [b.user_id]); if (!u) throw new HttpError(400, 'That person is not on the team.');
  const r = await one('insert into project_members(project_id,user_id,added_by) values($1,$2,$3) on conflict do nothing returning user_id', [p.id, u.id, c.user!.id]);
  if (r) { await act(p.id, c, 'member_added', { member: u.name }); await notify(u.id, c.user!.id, 'project_added', `${c.user!.name} added you to ${p.name}`, `/projects/${p.id}`); }
  return { created: !!r, id: u.id, name: u.name };
});
route('DELETE', '/api/projects/:id/members/:uid', 'user', async (c) => {
  const p = await needProject(c.params.id);
  const u = await one('delete from project_members m using users u where m.project_id=$1 and m.user_id=$2 and u.id=m.user_id returning u.name', [p.id, needUuid(c.params.uid, 'person')]);
  if (!u) throw new HttpError(404, 'not a member');
  await act(p.id, c, 'member_removed', { member: u.name }); return { deleted: true };
});
route('POST', '/api/projects/:id/links', 'user', async (c) => {
  const p = await needProject(c.params.id);
  const b = parse(z.object({ title: text(120).min(1), url: z.string().trim().max(2000).regex(/^https?:\/\/\S+$/i, 'use a web address starting with https://') }), c.body);
  const l = await one('insert into project_links(project_id,title,url,position,created_by) values($1,$2,$3,(select coalesce(max(position),0)+1 from project_links where project_id=$1),$4) returning *', [p.id, b.title, b.url, c.user!.id]);
  await act(p.id, c, 'link_added', { title: b.title }); return { created: true, ...l };
});
route('DELETE', '/api/links/:id', 'user', async (c) => {
  const l = await one('delete from project_links where id=$1 returning project_id, title', [needUuid(c.params.id, 'link')]); if (!l) throw new HttpError(404, 'link not found');
  await act(l.project_id, c, 'link_removed', { title: l.title }); return { deleted: true };
});

// ---------- board columns ----------
const ColumnIn = z.object({ name: text(60).min(1), status: TASK_STATUS, wip_limit: z.number().int().min(1).max(999).nullable().optional(), position: z.number().finite().optional() });
route('POST', '/api/projects/:id/columns', 'user', async (c) => {
  const p = await needProject(c.params.id); const b = parse(ColumnIn, c.body);
  const col = await one(`insert into board_columns(project_id,name,status,wip_limit,position) values($1,$2,$3,$4,coalesce($5,(select coalesce(max(position),0)+1 from board_columns where project_id=$1))) returning *`,
    [p.id, b.name, b.status, b.wip_limit ?? null, b.position ?? null]);
  await act(p.id, c, 'column_added', { column: b.name }); return { created: true, ...col };
});
route('PATCH', '/api/columns/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'column'); const b = parse(ColumnIn.omit({ status: true }).partial(), c.body);
  const before = await one('select * from board_columns where id=$1', [id]); if (!before) throw new HttpError(404, 'column not found');
  const col = await patchRow('board_columns', id, b);
  if (b.name && b.name !== before.name) await act(before.project_id, c, 'column_renamed', { from: before.name, to: b.name });
  return col;
});
// a column with tasks in it hands them to another column first; each status keeps at least one column
route('DELETE', '/api/columns/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'column'); const b = parse(z.object({ move_to: uuid.optional() }), c.body);
  const col = await one('select * from board_columns where id=$1', [id]); if (!col) throw new HttpError(404, 'column not found');
  const same = await one('select count(*)::int n from board_columns where project_id=$1 and status=$2', [col.project_id, col.status]);
  if (same!.n <= 1) throw new HttpError(409, `This is the only ${STATUS_WORD[col.status]} column. Add another ${STATUS_WORD[col.status]} column before removing it.`);
  const n = (await one('select count(*)::int n from tasks where column_id=$1', [id]))!.n;
  if (n) {
    if (!b.move_to) throw new HttpError(409, `This column has ${n} ${n === 1 ? 'task' : 'tasks'}. Choose where they go.`);
    const to = await one('select * from board_columns where id=$1 and project_id=$2 and id<>$3', [b.move_to, col.project_id, id]); if (!to) throw new HttpError(400, 'Move them to another column of this project.');
    await q(`update tasks set column_id=$2, status=$3, completed_at = case when $3='DONE' then coalesce(completed_at, now()) else null end where column_id=$1`, [id, to.id, to.status]);
  }
  await q('delete from board_columns where id=$1', [id]);
  await act(col.project_id, c, 'column_removed', { column: col.name, moved: n }); return { deleted: true };
});

// ---------- milestones ----------
const MilestoneIn = z.object({ name: text(120).min(1), description: text(2000).optional(), target_date: day, owner_id: uuid.nullable().optional(), status: z.enum(['OPEN', 'DONE']).optional() });
route('POST', '/api/projects/:id/milestones', 'user', async (c) => {
  const p = await needProject(c.params.id); const b = parse(MilestoneIn, c.body);
  const m = await one('insert into milestones(project_id,name,description,target_date,owner_id,status,created_by) values($1,$2,$3,$4,$5,$6,$7) returning *',
    [p.id, b.name, b.description ?? '', b.target_date ?? null, b.owner_id === undefined ? c.user!.id : b.owner_id, b.status ?? 'OPEN', c.user!.id]);
  await act(p.id, c, 'milestone_added', { milestone: b.name, target_date: b.target_date ?? null }); return { created: true, ...m };
});
route('PATCH', '/api/milestones/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'milestone'); const b = parse(MilestoneIn.partial(), c.body);
  const before = await one('select * from milestones where id=$1', [id]); if (!before) throw new HttpError(404, 'milestone not found');
  const m = await patchRow('milestones', id, b);
  await act(before.project_id, c, b.status === 'DONE' && before.status !== 'DONE' ? 'milestone_done' : 'milestone_updated', { milestone: m!.name, fields: Object.keys(b) });
  return m;
});
route('DELETE', '/api/milestones/:id', 'user', async (c) => {
  const m = await one('delete from milestones where id=$1 returning project_id, name', [needUuid(c.params.id, 'milestone')]); if (!m) throw new HttpError(404, 'milestone not found');
  await act(m.project_id, c, 'milestone_removed', { milestone: m.name }); return { deleted: true };
});

// ---------- tasks ----------
route('GET', '/api/tasks', 'user', async (c) => {
  // ?mine=1: what is on my plate across every project, not done, soonest first
  const mine = c.url.searchParams.get('mine') === '1';
  return q(`select t.*, p.name project_name, p.color project_color, u.name assignee_name from tasks t left join projects p on p.id=t.project_id left join users u on u.id=t.assignee_id
    where t.status <> 'DONE' and t.archived_at is null and (p.id is null or p.status in ('ACTIVE','ON_HOLD')) and ($1::uuid is null or t.assignee_id=$1)
    order by t.due_date nulls last, case t.priority when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end, t.created_at limit 300`, [mine ? c.user!.id : null]);
});

// where a task sits: a column of this project, which decides its status; without one, the first column of the status
async function placeFor(pid: string, columnId: string | undefined, status: string | undefined) {
  if (columnId) { const col = await one('select id, status from board_columns where id=$1 and project_id=$2', [columnId, pid]); if (!col) throw new HttpError(400, 'That column is not on this project.'); return col; }
  return (await one('select id, status from board_columns where project_id=$1 and status=$2 order by position limit 1', [pid, status ?? 'TODO'])) ?? { id: null, status: status ?? 'TODO' };
}
async function checkParent(pid: string, taskId: string | null, parentId: string) {
  const parent = await one('select project_id from tasks where id=$1', [parentId]);
  if (!parent || parent.project_id !== pid) throw new HttpError(400, 'A subtask belongs under a task of the same project.');
  if (taskId) {
    const loop = await one(`with recursive up(id, parent_id) as (select id, parent_id from tasks where id=$1 union select t.id, t.parent_id from tasks t join up on t.id=up.parent_id) select 1 from up where id=$2`, [parentId, taskId]);
    if (loop) throw new HttpError(409, 'That would put the task inside itself.');
  }
}
async function checkMilestone(pid: string, milestoneId?: string | null) {
  if (milestoneId && !(await one('select 1 from milestones where id=$1 and project_id=$2', [milestoneId, pid]))) throw new HttpError(400, 'That milestone is not on this project.');
}
async function setCollaborators(taskId: string, ids: string[]) {
  await q('delete from task_collaborators where task_id=$1', [taskId]);
  if (ids.length) await q('insert into task_collaborators(task_id,user_id) select $1, unnest($2::uuid[]) on conflict do nothing', [taskId, [...new Set(ids)]]);
}
const cleanLabels = (l?: string[]) => (l ? [...new Set(l.map((x) => x.trim()).filter(Boolean))] : undefined);

route('POST', '/api/projects/:id/tasks', 'user', async (c) => {
  const p = await needProject(c.params.id); const b = parse(TaskIn, c.body);
  const place = await placeFor(p.id, b.column_id, b.status);
  if (b.parent_id) await checkParent(p.id, null, b.parent_id);
  await checkMilestone(p.id, b.milestone_id);
  if (b.start_date && b.due_date && b.start_date > b.due_date) throw new HttpError(400, 'The start date is after the due date.');
  const t = (await one(`insert into tasks(project_id,title,description,status,priority,assignee_id,due_date,start_date,parent_id,milestone_id,labels,estimate_hours,actual_hours,column_id,position,completed_at,created_by)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,coalesce($15,(select coalesce(max(position),0)+1 from tasks where project_id=$1)),$16,$17) returning *`,
    [p.id, b.title, b.description ?? '', place.status, b.priority ?? 'MEDIUM', b.assignee_id ?? null, b.due_date ?? null, b.start_date ?? null, b.parent_id ?? null, b.milestone_id ?? null,
      cleanLabels(b.labels) ?? [], b.estimate_hours ?? null, b.actual_hours ?? null, place.id, b.position ?? null, place.status === 'DONE' ? new Date() : null, c.user!.id]))!;
  if (b.collaborator_ids) await setCollaborators(t.id, b.collaborator_ids);
  if (t.assignee_id) await q('insert into project_members(project_id,user_id,added_by) values($1,$2,$3) on conflict do nothing', [p.id, t.assignee_id, c.user!.id]);
  await act(p.id, c, b.parent_id ? 'subtask_created' : 'task_created', { task_id: t.id, title: t.title, parent_id: b.parent_id ?? null });
  if (t.assignee_id) await notify(t.assignee_id, c.user!.id, 'task_assigned', `${c.user!.name} gave you “${t.title}” in ${p.name}`, `/projects/${p.id}?task=${t.id}`);
  return { created: true, ...t };
});

// One update, shared by the task drawer, the board, the list's inline edits and bulk changes.
async function updateTask(c: Ctx, id: string, b: Row) {
  const before = await one('select t.*, p.name project_name from tasks t left join projects p on p.id=t.project_id where t.id=$1', [id]); if (!before) throw new HttpError(404, 'task not found');
  const pid: string | null = before.project_id;
  const fields: Row = { ...b }; delete fields.collaborator_ids; delete fields.column_id; delete fields.archived;
  if (b.labels) fields.labels = cleanLabels(b.labels);
  if (pid) {
    if (b.column_id && b.column_id !== before.column_id) { const col = await placeFor(pid, b.column_id, undefined); fields.column_id = col.id; fields.status = col.status; }
    else if (b.status && b.status !== before.status) {
      const cur = before.column_id ? await one('select status from board_columns where id=$1', [before.column_id]) : null;
      if (cur?.status !== b.status) { const col = await placeFor(pid, undefined, b.status); fields.column_id = col.id; if (b.position === undefined) fields.position = (await one('select coalesce(max(position),0)+1 p from tasks where project_id=$1', [pid]))!.p; }
    }
    if (b.parent_id) await checkParent(pid, id, b.parent_id);
    await checkMilestone(pid, b.milestone_id);
  } else if (b.column_id || b.parent_id || b.milestone_id) throw new HttpError(400, 'A to-do has no project, so it has no columns, parent or milestone.');
  const status = fields.status ?? before.status;
  if (status !== before.status) fields.completed_at = status === 'DONE' ? new Date() : null;
  const s = fields.start_date !== undefined ? fields.start_date : before.start_date; const d = fields.due_date !== undefined ? fields.due_date : before.due_date;
  if (s && d && s > d) throw new HttpError(400, 'The start date is after the due date.');
  const t = (await patchRow('tasks', id, fields))!;
  if (b.collaborator_ids) await setCollaborators(id, b.collaborator_ids);
  // a CRM follow-up done or reopened shows on the company's history
  if (before.company_id && status !== before.status && (status === 'DONE' || before.status === 'DONE')) await audit('company', before.company_id, status === 'DONE' ? 'follow_up_done' : 'follow_up_reopened', c.actor, { task_id: id, title: t.title, user_id: c.user?.id ?? null });
  // what changed, in the project's timeline
  if (pid) {
    const ref = { task_id: id, title: t.title };
    if (status !== before.status) await act(pid, c, status === 'DONE' ? 'task_completed' : 'task_moved', { ...ref, from: STATUS_WORD[before.status], to: STATUS_WORD[status] });
    if (b.assignee_id !== undefined && b.assignee_id !== before.assignee_id) {
      const who = b.assignee_id ? await one('select name from users where id=$1', [b.assignee_id]) : null;
      await act(pid, c, 'task_assigned', { ...ref, to: who?.name ?? null });
      if (b.assignee_id) { await q('insert into project_members(project_id,user_id,added_by) values($1,$2,$3) on conflict do nothing', [pid, b.assignee_id, c.user!.id]); await notify(b.assignee_id, c.user!.id, 'task_assigned', `${c.user!.name} gave you “${t.title}” in ${before.project_name}`, `/projects/${pid}?task=${id}`); }
    }
    if (b.due_date !== undefined && String(b.due_date ?? '') !== String(before.due_date ?? '')) await act(pid, c, 'task_due', { ...ref, from: before.due_date, to: b.due_date ?? null });
    if (b.archived !== undefined) await act(pid, c, b.archived ? 'task_archived' : 'task_restored', ref);
    const other = ['title', 'description', 'priority', 'labels', 'start_date', 'estimate_hours', 'actual_hours', 'parent_id', 'milestone_id']
      .filter((k) => b[k] !== undefined && JSON.stringify(k === 'labels' ? fields.labels : b[k]) !== JSON.stringify(before[k] ?? (k === 'labels' ? [] : k === 'description' ? '' : null)));
    if (other.length) await act(pid, c, 'task_updated', { ...ref, fields: other });
  }
  return t;
}
route('GET', '/api/tasks/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'task');
  const t = await one(`select ${TASK_COLS}, p.name project_name, p.color project_color, par.title parent_title from tasks t left join users u on u.id=t.assignee_id left join projects p on p.id=t.project_id left join tasks par on par.id=t.parent_id where t.id=$1`, [id]);
  if (!t) throw new HttpError(404, 'task not found');
  const [subtasks, blocked_by, blocks, files, activity] = await Promise.all([
    q('select t.id, t.title, t.status, t.assignee_id, u.name assignee_name, t.due_date from tasks t left join users u on u.id=t.assignee_id where t.parent_id=$1 and t.archived_at is null order by t.position, t.created_at', [id]),
    q('select d.kind, b.id, b.title, b.status from task_dependencies d join tasks b on b.id=d.depends_on_id where d.task_id=$1 order by d.created_at', [id]),
    q('select d.kind, b.id, b.title, b.status from task_dependencies d join tasks b on b.id=d.task_id where d.depends_on_id=$1 order by d.created_at', [id]),
    q('select f.id, f.name, f.mime, f.size, f.created_at, u.name uploaded_by_name from project_files f left join users u on u.id=f.uploaded_by where f.task_id=$1 order by f.created_at desc', [id]),
    t.project_id ? q(`select a.action, a.detail, a.created_at, u.name actor_name from activities a left join users u on u.id = (a.detail->>'user_id')::uuid
      where a.entity_type='project' and a.entity_id=$1 and a.detail->>'task_id' = $2 order by a.created_at desc limit 50`, [t.project_id, id]) : [],
  ]);
  return { ...t, subtasks, blocked_by, blocks, file_list: files, activity };
});
const TaskPatch = TaskIn.partial().extend({ archived: z.boolean().optional() });
route('PATCH', '/api/tasks/:id', 'user', async (c) => {
  const b: Row = parse(TaskPatch, c.body);
  if (b.archived !== undefined) b.archived_at = b.archived ? new Date() : null;
  return updateTask(c, needUuid(c.params.id, 'task'), b);
});
route('DELETE', '/api/tasks/:id', 'user', async (c) => {
  const r = await one('delete from tasks where id=$1 returning id, project_id, title', [needUuid(c.params.id, 'task')]); if (!r) throw new HttpError(404, 'task not found');
  await act(r.project_id, c, 'task_deleted', { title: r.title });
  return { deleted: true };
});
// change many at once: status, priority, assignee, labels, or archive / delete. Only tasks of this project are touched.
route('POST', '/api/projects/:id/tasks/bulk', 'user', async (c) => {
  const p = await needProject(c.params.id);
  const b = parse(z.object({ ids: z.array(uuid).min(1).max(200), action: z.enum(['update', 'archive', 'restore', 'delete']),
    set: z.object({ status: TASK_STATUS.optional(), priority: PRIORITY.optional(), assignee_id: uuid.nullable().optional(), add_labels: z.array(label).max(12).optional(), remove_labels: z.array(label).max(12).optional() }).optional() }), c.body);
  const own = await q('select id, labels from tasks where project_id=$1 and id = any($2)', [p.id, b.ids]);
  if (own.length !== new Set(b.ids).size) throw new HttpError(400, 'Some of those tasks are not on this project.');
  if (b.action === 'delete') { await q('delete from tasks where id = any($1)', [own.map((t) => t.id)]); await act(p.id, c, 'tasks_deleted', { count: own.length }); return { done: own.length }; }
  for (const t of own) {
    const s = b.set ?? {};
    const labels = s.add_labels || s.remove_labels ? [...new Set([...(t.labels ?? []), ...(s.add_labels ?? [])])].filter((l) => !(s.remove_labels ?? []).includes(l)) : undefined;
    await updateTask(c, t.id, b.action === 'update' ? { status: s.status, priority: s.priority, assignee_id: s.assignee_id, labels } : { archived_at: b.action === 'archive' ? new Date() : null, archived: b.action === 'archive' });
  }
  return { done: own.length };
});

// ---------- dependencies ----------
route('POST', '/api/tasks/:id/dependencies', 'user', async (c) => {
  const id = needUuid(c.params.id, 'task'); const b = parse(z.object({ depends_on_id: uuid, kind: z.enum(['BLOCKS', 'RELATES']).optional() }), c.body);
  if (b.depends_on_id === id) throw new HttpError(400, 'A task cannot depend on itself.');
  const [t, o] = await Promise.all([one('select project_id, title from tasks where id=$1', [id]), one('select project_id, title from tasks where id=$1', [b.depends_on_id])]);
  if (!t || !o) throw new HttpError(404, 'task not found');
  if (!t.project_id || t.project_id !== o.project_id) throw new HttpError(400, 'Both tasks must be on the same project.');
  const kind = b.kind ?? 'BLOCKS';
  if (kind === 'BLOCKS') {
    // would the other task, through what it waits on, end up waiting on this one?
    const loop = await one(`with recursive up(id) as (select depends_on_id from task_dependencies where task_id=$1 and kind='BLOCKS'
      union select d.depends_on_id from task_dependencies d join up on d.task_id=up.id where d.kind='BLOCKS') select 1 from up where id=$2`, [b.depends_on_id, id]);
    if (loop) throw new HttpError(409, `“${o.title}” already waits on this task, directly or through others, so this would be a loop.`);
  }
  await q('insert into task_dependencies(task_id,depends_on_id,kind,created_by) values($1,$2,$3,$4) on conflict (task_id,depends_on_id) do update set kind=excluded.kind', [id, b.depends_on_id, kind, c.user!.id]);
  await act(t.project_id, c, kind === 'BLOCKS' ? 'dependency_added' : 'relation_added', { task_id: id, title: t.title, other: o.title });
  return { created: true };
});
route('DELETE', '/api/tasks/:id/dependencies/:other', 'user', async (c) => {
  const r = await one('delete from task_dependencies d using tasks t where d.task_id=$1 and d.depends_on_id=$2 and t.id=d.task_id returning t.project_id, t.title', [needUuid(c.params.id, 'task'), needUuid(c.params.other, 'task')]);
  if (!r) throw new HttpError(404, 'no such link');
  await act(r.project_id, c, 'dependency_removed', { task_id: c.params.id, title: r.title }); return { deleted: true };
});

// ---------- comments ----------
route('GET', '/api/tasks/:id/comments', 'user', async (c) => q(`select k.id, k.body, k.created_at, k.edited_at, k.author_id, u.name author_name from task_comments k left join users u on u.id=k.author_id where k.task_id=$1 order by k.created_at`, [needUuid(c.params.id, 'task')]));
route('POST', '/api/tasks/:id/comments', 'user', async (c) => {
  const id = needUuid(c.params.id, 'task'); const b = parse(z.object({ body: text(5000).min(1) }), c.body);
  const t = await one('select t.project_id, t.title from tasks t where t.id=$1', [id]); if (!t) throw new HttpError(404, 'task not found');
  const k = (await one('insert into task_comments(task_id,author_id,body) values($1,$2,$3) returning id, body, created_at, author_id', [id, c.user!.id, b.body]))!;
  await act(t.project_id, c, 'comment_added', { task_id: id, title: t.title, excerpt: b.body.slice(0, 140) });
  await mentions(b.body, c, `${c.user!.name} mentioned you on “${t.title}”`, t.project_id ? `/projects/${t.project_id}?task=${id}` : '/');
  return { created: true, ...k, author_name: c.user!.name };
});
route('PATCH', '/api/comments/:id', 'user', async (c) => {
  const b = parse(z.object({ body: text(5000).min(1) }), c.body);
  const k = await one('update task_comments set body=$2, edited_at=now() where id=$1 and author_id=$3 returning id, body, created_at, edited_at, author_id', [needUuid(c.params.id, 'comment'), b.body, c.user!.id]);
  if (!k) throw new HttpError(403, 'Only the person who wrote a comment can edit it.');
  return k;
});
route('DELETE', '/api/comments/:id', 'user', async (c) => {
  const k = await one(`delete from task_comments where id=$1 and (author_id=$2 or $3) returning id`, [needUuid(c.params.id, 'comment'), c.user!.id, c.user!.role === 'admin']);
  if (!k) throw new HttpError(403, 'Only the person who wrote a comment, or an admin, can delete it.');
  return { deleted: true };
});
// @username in a comment tells that person
export async function mentions(body: string, c: Ctx, title: string, link: string) {
  const names = [...new Set([...body.matchAll(/@([a-z0-9._-]{2,40})/gi)].map((m) => m[1]!.toLowerCase()))]; if (!names.length) return;
  for (const u of await q('select id from users where lower(username) = any($1) and active', [names])) await notify(u.id, c.user!.id, 'mentioned', title, link);
}

// ---------- saved views over the same task records ----------
const ViewIn = z.object({ name: text(60).min(1), layout: z.enum(['list', 'board', 'timeline']).optional(), config: z.record(z.any()).optional(), shared: z.boolean().optional() });
route('GET', '/api/projects/:id/views', 'user', async (c) => q('select * from project_views where project_id=$1 and (user_id is null or user_id=$2) order by created_at', [(await needProject(c.params.id)).id, c.user!.id]));
route('POST', '/api/projects/:id/views', 'user', async (c) => {
  const p = await needProject(c.params.id); const b = parse(ViewIn, c.body);
  if (JSON.stringify(b.config ?? {}).length > 20_000) throw new HttpError(400, 'That view is too large.');
  return { created: true, ...(await one('insert into project_views(project_id,user_id,name,layout,config) values($1,$2,$3,$4,$5) returning *', [p.id, b.shared ? null : c.user!.id, b.name, b.layout ?? 'list', b.config ?? {}])) };
});
route('PATCH', '/api/views/:id', 'user', async (c) => {
  const b = parse(ViewIn.partial(), c.body); const { shared, ...rest } = b;
  const v = await one('select * from project_views where id=$1 and (user_id is null or user_id=$2)', [needUuid(c.params.id, 'view'), c.user!.id]); if (!v) throw new HttpError(404, 'view not found');
  return patchRow('project_views', v.id, { ...rest, ...(shared !== undefined ? { user_id: shared ? null : c.user!.id } : {}) });
});
route('DELETE', '/api/views/:id', 'user', async (c) => {
  const v = await one('delete from project_views where id=$1 and (user_id is null or user_id=$2) returning id', [needUuid(c.params.id, 'view'), c.user!.id]); if (!v) throw new HttpError(404, 'view not found');
  return { deleted: true };
});

// ---------- activity and search ----------
const KINDS: Record<string, string[]> = {
  tasks: ['task_created', 'subtask_created', 'task_moved', 'task_completed', 'task_assigned', 'task_due', 'task_updated', 'task_deleted', 'tasks_deleted', 'task_archived', 'task_restored', 'dependency_added', 'dependency_removed', 'relation_added'],
  comments: ['comment_added', 'page_comment'], files: ['file_uploaded', 'file_removed', 'file_renamed'], pages: ['page_created', 'page_edited', 'page_moved', 'page_archived', 'page_restored', 'page_deleted'],
  project: ['project_created', 'project_updated', 'project_status', 'project_color', 'member_added', 'member_removed', 'link_added', 'link_removed', 'column_added', 'column_renamed', 'column_removed', 'milestone_added', 'milestone_updated', 'milestone_done', 'milestone_removed'],
};
route('GET', '/api/projects/:id/activity', 'user', async (c) => {
  const p = await needProject(c.params.id); const sp = c.url.searchParams;
  const kind = sp.get('kind'); const user = sp.get('user'); const before = sp.get('before');
  return q(`select a.id, a.action, a.detail, a.created_at, a.actor, u.name actor_name, u.id actor_id from activities a left join users u on u.id = (a.detail->>'user_id')::uuid
    where a.entity_type='project' and a.entity_id=$1 and ($2::text[] is null or a.action = any($2)) and ($3::uuid is null or u.id=$3) and ($4::timestamptz is null or a.created_at < $4)
    order by a.created_at desc limit 60`, [p.id, kind ? KINDS[kind] ?? [kind] : null, user && /^[0-9a-f-]{36}$/i.test(user) ? user : null, before || null]);
});
route('GET', '/api/projects/:id/search', 'user', async (c) => {
  const p = await needProject(c.params.id); const term = (c.url.searchParams.get('q') ?? '').trim().slice(0, 100); if (term.length < 2) return [];
  const like = `%${term.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
  const [tasks, pages, files, comments] = await Promise.all([
    q(`select 'task' kind, id, title, status detail from tasks where project_id=$1 and archived_at is null and (title ilike $2 or description ilike $2) order by updated_at desc limit 10`, [p.id, like]),
    q(`select 'page' kind, id, coalesce(nullif(title,''),'Untitled') title, left(text_content, 120) detail from pages where project_id=$1 and archived_at is null and (title ilike $2 or search @@ plainto_tsquery('simple', $3)) order by updated_at desc limit 10`, [p.id, like, term]),
    q(`select 'file' kind, id, name title, mime detail from project_files where project_id=$1 and name ilike $2 order by created_at desc limit 10`, [p.id, like]),
    q(`select 'comment' kind, t.id, t.title, left(k.body, 120) detail from task_comments k join tasks t on t.id=k.task_id where t.project_id=$1 and k.body ilike $2 order by k.created_at desc limit 10`, [p.id, like]),
  ]);
  return [...tasks, ...pages, ...files, ...comments];
});

// ---------- to-dos: tasks with no project, for the day-to-day ----------
// The list on Today: open to-dos and open project tasks, for you or for everyone, soonest and most urgent first, plus
// what was ticked off today so it does not vanish the moment it is done.
route('GET', '/api/todos', 'user', async (c) => {
  const mine = c.url.searchParams.get('who') !== 'all';
  return q(`select t.id, t.project_id, t.title, t.description, t.status, t.priority, t.assignee_id, t.due_date, t.completed_at, t.created_at, t.created_by,
      p.name project_name, p.color project_color, u.name assignee_name, (select count(*)::int from task_comments k where k.task_id=t.id) comments
    from tasks t left join projects p on p.id=t.project_id left join users u on u.id=t.assignee_id
    where (p.id is null or p.status in ('ACTIVE','ON_HOLD')) and t.archived_at is null and ($1::uuid is null or t.assignee_id=$1)
      and (t.status <> 'DONE' or (t.completed_at at time zone 'Asia/Kolkata')::date = ${TODAY_IST})
      and (t.project_id is null or t.assignee_id is not null)
    order by t.status = 'DONE', t.due_date nulls last, case t.priority when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end, t.created_at limit 300`, [mine ? c.user!.id : null]);
});
route('POST', '/api/todos', 'user', async (c) => {
  const b = parse(TaskIn.pick({ title: true, priority: true, due_date: true, assignee_id: true }), c.body);
  // yours unless you hand it to someone
  const t = (await one(`insert into tasks(project_id,title,priority,assignee_id,due_date,created_by) values(null,$1,$2,$3,$4,$5) returning *`,
    [b.title, b.priority ?? 'MEDIUM', b.assignee_id === undefined ? c.user!.id : b.assignee_id, b.due_date ?? null, c.user!.id]))!;
  return { created: true, ...t };
});
