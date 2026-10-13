// The project workspace: colours, columns, subtasks, dependencies, bulk changes, saved views, notes, files, activity.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';

let t: Awaited<ReturnType<typeof bootstrap>>;
before(async () => { t = await bootstrap(); });
after(async () => { await t.teardown(); });

test('each project keeps its own colour, checked as a hex value, and editing other fields leaves it alone', async () => {
  const m = await t.person('kiran');
  const a = await m.call('POST', '/api/projects', { name: 'QC Lobby', color: '#3b82f6' });
  const b = await m.call('POST', '/api/projects', { name: 'VRG EV' });
  assert.equal(a.status, 201); assert.equal(a.body.color, '#3B82F6', 'stored upper case'); assert.equal(b.body.color, null, 'no colour means the theme default');
  assert.equal((await m.call('PATCH', `/api/projects/${b.body.id}`, { color: 'A855F7' })).body.color, '#A855F7', 'the # is optional');
  assert.equal((await m.call('PATCH', `/api/projects/${b.body.id}`, { color: 'purple' })).status, 400, 'not a hex colour');
  assert.equal((await m.call('PATCH', `/api/projects/${b.body.id}`, { color: '#12345' })).status, 400, 'too short');
  await m.call('PATCH', `/api/projects/${a.body.id}`, { name: 'QC Lobby v2', description: 'New site', due_date: '2026-12-01', status: 'ON_HOLD' });
  const list = (await m.call('GET', '/api/projects?status=ON_HOLD')).body.concat((await m.call('GET', '/api/projects')).body);
  assert.equal(list.find((p: any) => p.id === a.body.id).color, '#3B82F6', 'a name, description, date and status change keep the colour');
  assert.equal(list.find((p: any) => p.id === b.body.id).color, '#A855F7', 'changing one never changes another');
  assert.equal((await m.call('PATCH', `/api/projects/${a.body.id}`, { color: null })).body.color, null, 'reset to the default');
  const p = (await m.call('GET', `/api/projects/${b.body.id}`)).body;
  assert.deepEqual(p.columns.map((c: any) => c.name), ['To do', 'In progress', 'In review', 'Done'], 'a new project gets the four columns');
  assert.ok(p.members.some((x: any) => x.id === m.id), 'the person who made it is on its team');
});

test('columns decide status, tasks reorder, subtasks and dependencies refuse loops, bulk changes stay in the project', async () => {
  const m = await t.person('farah');
  const p = (await m.call('POST', '/api/projects', { name: 'Site rebuild' })).body;
  const cols = (await m.call('GET', `/api/projects/${p.id}`)).body.columns;
  const qa = await m.call('POST', `/api/projects/${p.id}/columns`, { name: 'QA', status: 'REVIEW', wip_limit: 2 });
  assert.equal(qa.status, 201);
  const t1 = (await m.call('POST', `/api/projects/${p.id}/tasks`, { title: 'Audit', labels: ['Website', 'Website', ' UTM '], start_date: '2026-10-01', due_date: '2026-10-10' })).body;
  assert.deepEqual(t1.labels, ['Website', 'UTM']); assert.equal(t1.column_id, cols[0].id, 'lands in To do');
  const moved = await m.call('PATCH', `/api/tasks/${t1.id}`, { column_id: qa.body.id, position: 0.5 });
  assert.equal(moved.body.status, 'REVIEW', 'the column gives the status'); assert.equal(moved.body.position, 0.5);
  const done = await m.call('PATCH', `/api/tasks/${t1.id}`, { status: 'DONE' });
  assert.equal(done.body.column_id, cols[3].id, 'a status change moves it to that status column'); assert.ok(done.body.completed_at);
  assert.equal((await m.call('PATCH', `/api/tasks/${t1.id}`, { start_date: '2026-11-01' })).status, 400, 'start after due');

  const parent = (await m.call('POST', `/api/projects/${p.id}/tasks`, { title: 'Tracking' })).body;
  const child = (await m.call('POST', `/api/projects/${p.id}/tasks`, { title: 'Script', parent_id: parent.id })).body;
  assert.equal((await m.call('PATCH', `/api/tasks/${parent.id}`, { parent_id: child.id })).status, 409, 'a task cannot go under its own subtask');
  const other = (await m.call('POST', '/api/projects', { name: 'Other' })).body;
  const foreign = (await m.call('POST', `/api/projects/${other.id}/tasks`, { title: 'Elsewhere' })).body;
  assert.equal((await m.call('PATCH', `/api/tasks/${child.id}`, { parent_id: foreign.id })).status, 400, 'parent from another project');

  // child waits on t1; t1 cannot then wait on child
  assert.equal((await m.call('POST', `/api/tasks/${child.id}/dependencies`, { depends_on_id: parent.id })).status, 201);
  const c3 = (await m.call('POST', `/api/projects/${p.id}/tasks`, { title: 'Verify' })).body;
  assert.equal((await m.call('POST', `/api/tasks/${parent.id}/dependencies`, { depends_on_id: c3.id })).status, 201);
  const loop = await m.call('POST', `/api/tasks/${c3.id}/dependencies`, { depends_on_id: child.id });
  assert.equal(loop.status, 409, 'Verify -> Script -> Tracking -> Verify is a loop');
  assert.equal((await m.call('POST', `/api/tasks/${c3.id}/dependencies`, { depends_on_id: foreign.id })).status, 400, 'across projects');
  const detail = (await m.call('GET', `/api/tasks/${parent.id}`)).body;
  assert.equal(detail.subtasks.length, 1); assert.equal(detail.blocked_by[0].id, c3.id); assert.equal(detail.blocks[0].id, child.id); assert.equal(detail.blocked, true);
  const board = (await m.call('GET', `/api/projects/${p.id}`)).body;
  assert.equal(board.counts.blocked, 2, 'Tracking and Script are both waiting');
  assert.equal(board.task_list.find((x: any) => x.id === parent.id).subtasks, 1);

  const bulk = await m.call('POST', `/api/projects/${p.id}/tasks/bulk`, { ids: [parent.id, c3.id], action: 'update', set: { priority: 'HIGH', add_labels: ['Launch'] } });
  assert.equal(bulk.body.done, 2);
  const after = (await m.call('GET', `/api/projects/${p.id}`)).body.task_list;
  assert.ok(after.filter((x: any) => [parent.id, c3.id].includes(x.id)).every((x: any) => x.priority === 'HIGH' && x.labels.includes('Launch')));
  assert.equal((await m.call('POST', `/api/projects/${p.id}/tasks/bulk`, { ids: [parent.id, foreign.id], action: 'archive' })).status, 400, 'a task of another project is refused');
  await m.call('POST', `/api/projects/${p.id}/tasks/bulk`, { ids: [c3.id], action: 'archive' });
  assert.ok(!(await m.call('GET', `/api/projects/${p.id}`)).body.task_list.some((x: any) => x.id === c3.id), 'archived tasks leave the board');
  assert.ok((await m.call('GET', `/api/projects/${p.id}?archived=1`)).body.task_list.some((x: any) => x.id === c3.id), 'and can be shown');

  // the last column of a status stays; a column with tasks needs somewhere to send them
  const reviewCols = (await m.call('GET', `/api/projects/${p.id}`)).body.columns.filter((c: any) => c.status === 'REVIEW');
  await m.call('PATCH', `/api/tasks/${child.id}`, { column_id: qa.body.id });
  assert.equal((await m.call('DELETE', `/api/columns/${qa.body.id}`, {})).status, 409, 'has a task');
  assert.equal((await m.call('DELETE', `/api/columns/${qa.body.id}`, { move_to: reviewCols[0].id })).status, 200);
  assert.equal((await m.call('DELETE', `/api/columns/${reviewCols[0].id}`, { move_to: cols[0].id })).status, 409, 'the only In review column');

  const view = await m.call('POST', `/api/projects/${p.id}/views`, { name: 'High priority', config: { filters: { priority: ['HIGH'] } } });
  assert.equal(view.status, 201);
  const k = await t.person('kabir');
  assert.equal((await k.call('GET', `/api/projects/${p.id}/views`)).body.length, 0, 'a personal view is only yours');
  await m.call('PATCH', `/api/views/${view.body.id}`, { shared: true });
  assert.equal((await k.call('GET', `/api/projects/${p.id}/views`)).body.length, 1, 'a shared one is everyone’s');

  const act = (await m.call('GET', `/api/projects/${p.id}/activity`)).body.map((a: any) => a.action);
  for (const a of ['project_created', 'column_added', 'task_created', 'task_moved', 'task_completed', 'subtask_created', 'dependency_added', 'task_archived', 'column_removed']) assert.ok(act.includes(a), `activity has ${a}`);
  assert.ok((await m.call('GET', `/api/projects/${p.id}/activity?kind=tasks`)).body.every((a: any) => !a.action.startsWith('column')));
});

test('assigning and mentioning reach the person as notifications, never yourself', async () => {
  const a = await t.person('anita'); const b = await t.person('bilal');
  const p = (await a.call('POST', '/api/projects', { name: 'Notify' })).body;
  const task = (await a.call('POST', `/api/projects/${p.id}/tasks`, { title: 'Hand over', assignee_id: b.id })).body;
  await a.call('POST', `/api/tasks/${task.id}/comments`, { body: 'Over to you @bilal, and a note to myself @anita' });
  const nb = (await b.call('GET', '/api/notifications')).body;
  assert.equal(nb.unread, 2); assert.deepEqual(nb.items.map((n: any) => n.kind).sort(), ['mentioned', 'task_assigned']);
  assert.equal((await a.call('GET', '/api/notifications')).body.unread, 0, 'not told about your own mention');
  await b.call('POST', '/api/notifications/read', {});
  assert.equal((await b.call('GET', '/api/notifications')).body.unread, 0);
  const own = await b.call('PATCH', `/api/comments/${(await a.call('GET', `/api/tasks/${task.id}/comments`)).body[0].id}`, { body: 'changed' });
  assert.equal(own.status, 403, 'only the author edits a comment');
});

test('notes: a page tree, cleaned content, conflict-safe saves, history, backlinks and task references', async () => {
  const m = await t.person('nisha'); const o = await t.person('omar');
  const p = (await m.call('POST', '/api/projects', { name: 'Docs' })).body;
  const task = (await m.call('POST', `/api/projects/${p.id}/tasks`, { title: 'Ship it' })).body;
  const brief = (await m.call('POST', `/api/projects/${p.id}/pages`, { title: 'Project brief' })).body;
  const design = (await m.call('POST', `/api/projects/${p.id}/pages`, { title: 'Design', parent_id: brief.id })).body;
  const home = (await m.call('POST', `/api/projects/${p.id}/pages`, { title: 'Homepage', parent_id: design.id })).body;
  assert.equal((await m.call('PATCH', `/api/pages/${brief.id}`, { parent_id: home.id })).status, 409, 'a page cannot go under its own child');
  const doc = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Goals' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'See ', marks: [{ type: 'bold' }] }, { type: 'pageRef', attrs: { id: home.id, title: 'Homepage' } }, { type: 'taskRef', attrs: { id: task.id, title: 'Ship it' } },
      { type: 'text', text: 'bad link', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
    { type: 'script', content: [{ type: 'text', text: 'x' }] },
    { type: 'image', attrs: { src: 'http://tracker.example/x.png' } },
  ] };
  const s1 = await m.call('PUT', `/api/pages/${brief.id}`, { content: doc, base_version: 1 });
  assert.equal(s1.status, 200); assert.equal(s1.body.version, 2);
  const g = (await m.call('GET', `/api/pages/${brief.id}`)).body;
  assert.equal(g.content.content.length, 2, 'unknown nodes and unsafe images are dropped');
  assert.equal(g.content.content[1].content[3].marks, undefined, 'a javascript: link loses its link');
  assert.equal(g.task_refs[0].id, task.id);
  assert.match(g.text_content, /Goals/);
  assert.deepEqual((await m.call('GET', `/api/pages/${home.id}`)).body.backlinks.map((x: any) => x.id), [brief.id], 'Homepage knows the brief links to it');
  assert.deepEqual((await m.call('GET', `/api/pages/${home.id}`)).body.breadcrumbs.map((x: any) => x.title), ['Project brief', 'Design']);
  const ping = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: o.id, label: 'omar' } }] }] };
  const before = (await o.call('GET', '/api/notifications')).body.unread;
  await m.call('PUT', `/api/pages/${home.id}`, { content: ping, base_version: 1 });
  await m.call('PUT', `/api/pages/${home.id}`, { content: ping, base_version: 2 });
  assert.equal((await o.call('GET', '/api/notifications')).body.unread, before + 1, 'a mention in a page tells the person once, not on every save');
  const stale = await o.call('PUT', `/api/pages/${brief.id}`, { title: 'Mine', base_version: 1 });
  assert.equal(stale.status, 409, 'a save from an old version is refused, not merged over'); assert.match(stale.body.error, /Nisha saved a newer version/);
  assert.equal((await o.call('PUT', `/api/pages/${brief.id}`, { title: 'Brief', base_version: 2 })).status, 200);
  const revs = (await m.call('GET', `/api/pages/${brief.id}/revisions`)).body;
  assert.ok(revs.length >= 2, 'a different person saving makes a snapshot');
  const v1 = (await m.call('GET', `/api/pages/${brief.id}/revisions/1`)).body; assert.equal(v1.title, 'Project brief');
  assert.equal((await m.call('GET', `/api/projects/${p.id}/search?q=goals`)).body[0].id, brief.id, 'the page is found by its words');
  await m.call('PATCH', `/api/pages/${design.id}`, { archived: true, starred: true });
  assert.ok(!(await m.call('GET', `/api/projects/${p.id}/pages`)).body.some((x: any) => x.id === design.id));
  assert.ok((await m.call('GET', `/api/projects/${p.id}/pages?archived=1`)).body.some((x: any) => x.id === design.id && x.starred));
  await m.call('PATCH', `/api/pages/${design.id}`, { archived: false });
  const dup = await m.call('POST', `/api/pages/${brief.id}/duplicate`, {}); assert.equal(dup.body.title, 'Brief (copy)');
  assert.equal((await o.call('DELETE', `/api/pages/${brief.id}`, {})).status, 403, 'only its maker or an admin deletes');
  assert.equal((await m.call('DELETE', `/api/pages/${brief.id}`, {})).body.deleted, 3, 'the page and the two inside it');
});

test('files: type and size checked, stored, downloaded only when signed in, never shown inline when they could run', async () => {
  const m = await t.person('rhea'); const o = await t.person('sahil');
  const p = (await m.call('POST', '/api/projects', { name: 'Assets' })).body;
  const up = (body: Buffer | string, type: string, name: string, cookie = m.cookie) => fetch(`${t.url}/api/projects/${p.id}/files?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { cookie, 'content-type': type, 'idempotency-key': crypto.randomUUID() }, body: body as any });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const r = await up(png, 'image/png', 'mock/up.png'); assert.equal(r.status, 201); const f = await r.json();
  assert.equal(f.name, 'mockup.png', 'slashes are taken out of names'); assert.equal(f.size, png.length);
  assert.equal((await up(Buffer.from('MZ program'), 'image/png', 'fake.png')).status, 415, 'the bytes must match the type');
  assert.equal((await up('<html>', 'text/html', 'x.html')).status, 415, 'html is not accepted');
  assert.equal((await up(Buffer.alloc(10_000_001, 1), 'application/zip', 'big.zip')).status, 413);
  const svg = await (await up('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>', 'image/svg+xml', 'logo.svg')).json();
  const got = await fetch(`${t.url}/api/files/${f.id}/content`, { headers: { cookie: m.cookie } });
  assert.equal(got.status, 200); assert.equal(got.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await got.arrayBuffer()), png);
  const s = await fetch(`${t.url}/api/files/${svg.id}/content`, { headers: { cookie: m.cookie } });
  assert.equal(s.headers.get('content-type'), 'application/octet-stream'); assert.match(s.headers.get('content-disposition')!, /^attachment/); assert.match(s.headers.get('content-security-policy')!, /sandbox/);
  assert.equal((await fetch(`${t.url}/api/files/${f.id}/content`)).status, 401, 'not without signing in');
  assert.equal((await m.call('GET', `/api/projects/${p.id}/files?q=mock`)).body.length, 1);
  assert.equal((await o.call('DELETE', `/api/files/${f.id}`, {})).status, 403, 'only the uploader or an admin deletes');
  assert.equal((await m.call('DELETE', `/api/files/${f.id}`, {})).status, 200);
});
