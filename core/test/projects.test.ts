import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>;
before(async () => { t = await bootstrap(); });
after(async () => { await t.teardown(); });

test('projects: create, tasks across the board, done stamps a time, my tasks, comments', async () => {
  const admin = await t.signIn(); const m = await t.person('meera');
  assert.equal((await t.api('GET', '/api/projects')).status, 403, 'the API key does not open the workspace');
  assert.equal((await m.call('POST', '/api/projects', { name: '' })).status, 400);
  const p = await m.call('POST', '/api/projects', { name: 'Acme site rebuild', description: 'Shopify to headless', due_date: '2026-12-01' });
  assert.equal(p.status, 201); assert.equal(p.body.owner_id, m.id, 'the creator owns it unless told otherwise');
  assert.equal((await m.call('POST', `/api/projects/${p.body.id}/tasks`, { title: 'x', assignee_id: '00000000-0000-0000-0000-000000000000' })).status, 400);
  assert.equal((await m.call('POST', `/api/projects/${p.body.id}/tasks`, { title: 'x', due_date: '1 Dec' })).status, 400);
  const t1 = await m.call('POST', `/api/projects/${p.body.id}/tasks`, { title: 'Audit the theme', priority: 'HIGH', assignee_id: m.id, due_date: '2026-10-01' });
  const t2 = await admin.call('POST', `/api/projects/${p.body.id}/tasks`, { title: 'Write the brief' }); assert.equal(t2.status, 201);
  assert.equal(t1.body.status, 'TODO');
  const done = await m.call('PATCH', `/api/tasks/${t1.body.id}`, { status: 'DONE' }); assert.ok(done.body.completed_at);
  const reopened = await m.call('PATCH', `/api/tasks/${t1.body.id}`, { status: 'DOING', due_date: '' }); assert.equal(reopened.body.completed_at, null); assert.equal(reopened.body.due_date, null);
  assert.equal(reopened.body.title, 'Audit the theme', 'fields not sent are left alone');
  const mine = await m.call('GET', '/api/tasks?mine=1'); assert.deepEqual(mine.body.map((x: any) => x.id), [t1.body.id]); assert.equal(mine.body[0].project_name, 'Acme site rebuild');
  const k = await admin.call('POST', `/api/tasks/${t1.body.id}/comments`, { body: 'Theme is Dawn 9, heavily edited.' }); assert.equal(k.status, 201);
  const ks = await m.call('GET', `/api/tasks/${t1.body.id}/comments`); assert.equal(ks.body[0].author_name, 'Tester');
  const detail = await m.call('GET', `/api/projects/${p.body.id}`); assert.equal(detail.body.tasks, 2); assert.equal(detail.body.task_list[0].priority, 'HIGH'); assert.equal(detail.body.task_list[0].comments, 1);
  await m.call('PATCH', `/api/projects/${p.body.id}`, { status: 'ARCHIVED' });
  assert.equal((await m.call('GET', '/api/projects')).body.length, 0, 'archived projects are out of the default list');
  assert.equal((await m.call('GET', '/api/projects?status=ARCHIVED')).body.length, 1);
  assert.equal((await m.call('DELETE', `/api/tasks/${t2.body.id}`)).status, 200);
  assert.equal((await m.call('GET', '/api/projects/not-a-uuid')).status, 404);
});

test('to-dos: no project needed, yours by default, can be handed over, Today lists them with project tasks, and the badge counts what is due', async () => {
  const r = await t.person('rahul'); const a = await t.person('ayush');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const mine = await r.call('POST', '/api/todos', { title: 'Send Acme the revised quote', due_date: today, priority: 'HIGH' });
  assert.equal(mine.status, 201); assert.equal(mine.body.project_id, null); assert.equal(mine.body.assignee_id, r.id);
  const handed = await r.call('POST', '/api/todos', { title: 'Renew the domain', assignee_id: a.id }); assert.equal(handed.body.assignee_id, a.id);
  assert.equal((await r.call('POST', '/api/todos', { title: '' })).status, 400);
  const p = await r.call('POST', '/api/projects', { name: 'Site' });
  const pt = await r.call('POST', `/api/projects/${p.body.id}/tasks`, { title: 'Fix the footer', assignee_id: r.id, due_date: '2020-01-01' });
  const list = await r.call('GET', '/api/todos'); assert.deepEqual(list.body.map((x: any) => x.title), ['Fix the footer', 'Send Acme the revised quote'], 'late first, then due today');
  assert.equal(list.body[0].project_name, 'Site');
  assert.ok((await r.call('GET', '/api/todos?who=all')).body.some((x: any) => x.title === 'Renew the domain'));
  assert.ok((await a.call('GET', '/api/todos')).body.some((x: any) => x.id === handed.body.id), 'it lands on their list');
  assert.equal((await r.call('GET', '/api/overview')).body.counts.todos_due, 2);
  assert.equal((await t.api('GET', '/api/overview')).body.counts.todos_due, 0, 'the API key has no to-dos');
  // ticked off: still on today's list, crossed out, and out of the badge; comments and edits work as for any task
  await r.call('PATCH', `/api/tasks/${mine.body.id}`, { status: 'DONE' });
  const after = await r.call('GET', '/api/todos'); assert.equal(after.body.at(-1).id, mine.body.id); assert.equal(after.body.at(-1).status, 'DONE');
  assert.equal((await r.call('GET', '/api/overview')).body.counts.todos_due, 1);
  assert.equal((await a.call('POST', `/api/tasks/${handed.body.id}/comments`, { body: 'Done on GoDaddy' })).status, 201);
  assert.ok((await r.call('GET', '/api/tasks?mine=1')).body.some((x: any) => x.id === pt.body.id));
  assert.ok((await a.call('GET', '/api/tasks?mine=1')).body.some((x: any) => x.id === handed.body.id), 'My tasks includes to-dos');
  assert.equal((await t.api('GET', '/api/todos')).status, 403);
});
