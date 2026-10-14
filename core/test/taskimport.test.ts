// Importing a task list: read (rules and the AI reader), then create in bulk with the statuses kept, owners matched to
// the team, names the team does not have kept in the description, and a second import of the same list skipped.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';
import { parseTaskLines, parseDate } from '../src/lib/taskimport.ts';
let t: Awaited<ReturnType<typeof bootstrap>>;
before(async () => { t = await bootstrap(); });
after(async () => { await t.teardown(); });
const job = async (call: any, id: string) => { for (let i = 0; i < 100; i++) { const j = (await call('GET', `/api/jobs/${id}`)).body; if (j.status === 'done' || j.status === 'failed') return j; await new Promise((r) => setTimeout(r, 50)); } throw new Error('job never finished'); };

test('reader: statuses from the words used, wrapped rows joined, dates both ways, nothing guessed', () => {
  const X = (...c: [number, string][]) => c.map(([x, t]) => ({ x, t }));
  const r = parseTaskLines([
    X([40, 'S.No'], [90, 'Task'], [330, 'Owner'], [420, 'Due Date'], [500, 'Status']),
    X([42, '1'], [90, 'Charger map'], [330, 'Ayush'], [420, '20/10/2026'], [495, 'Completed']),
    X([42, '2'], [90, 'Fleet dashboard with'], [500, 'In Process']), X([90, 'live alerts']),
    X([42, '3'], [90, 'RFID onboarding']), X([492, 'Under Review']),
    X([42, '4'], [90, 'Pricing page']), // no status anywhere: left without one
    X([200, 'Page 2 of 9']),
  ]);
  assert.equal(r.mode, 'table');
  assert.deepEqual(r.rows.map((x) => [x.title, x.status]), [['Charger map', 'DONE'], ['Fleet dashboard with live alerts', 'DOING'], ['RFID onboarding', 'REVIEW'], ['Pricing page', null]]);
  assert.equal(r.rows[0]!.due_date, '2026-10-20');
  const l = parseTaskLines(['Review the homepage copy - Pending', 'Stakeholder interviews (Done)', 'Speed audit: pending approval', 'Admin panel - On hold']);
  assert.deepEqual(l.rows.map((x) => [x.title, x.status, x.flag]), [['Review the homepage copy', 'TODO', null], ['Stakeholder interviews', 'DONE', null], ['Speed audit', 'REVIEW', null], ['Admin panel', 'TODO', 'On hold']]);
  assert.equal(parseDate('03/14/2026', 'mdy'), '2026-03-14'); assert.equal(parseDate('14/03/2026'), '2026-03-14'); assert.equal(parseDate('12 Oct 2026'), '2026-10-12'); assert.equal(parseDate('31/02/2026'), null);
});

test('import: 1101 tasks, 30% done, 30% in progress, 40% pending, owners matched, nothing twice', async () => {
  const m = await t.person('kavya'); const o = await t.person('nikhil', 'member', 'Nikhil Rao');
  const p = (await m.call('POST', '/api/projects', { name: 'VRG eEV import' })).body;
  // a task already there, moved on the board so its position is between two others
  const first = (await m.call('POST', `/api/projects/${p.id}/tasks`, { title: 'Kick-off call' })).body; await m.call('PATCH', `/api/tasks/${first.id}`, { position: 3.5 });
  const status = (i: number) => (i < 330 ? 'Completed' : i < 660 ? 'In Process' : 'Pending');
  const csv = 'Task,Owner,Status,Due Date\n' + Array.from({ length: 1101 }, (_, i) => `"Task ${i + 1}, part ${i % 7}",${i % 3 === 0 ? 'Nikhil' : i % 3 === 1 ? 'Kavya' : 'Priya Sharma'},${status(i)},${i % 10 === 0 ? '30/11/2026' : ''}`).join('\n');
  const read = (await m.call('POST', `/api/projects/${p.id}/import/parse`, { csv })).body;
  assert.equal(read.total, 1101); assert.deepEqual(read.counts, { DONE: 330, DOING: 330, REVIEW: 0, TODO: 441, NONE: 0 });
  assert.equal(read.rows[0].assignee_id, o.id, 'a first name the team has once matches'); assert.equal(read.rows[2].assignee_id, null, 'a name the team does not have stays unmatched');
  const rows = read.rows.map((r: any) => ({ title: r.title, status: r.status, assignee: r.assignee, due_date: r.due_date }));
  const made = await m.call('POST', `/api/projects/${p.id}/import`, { source: 'tracker.pdf', rows });
  assert.equal(made.status, 201); assert.equal(made.body.created, 1101); assert.deepEqual(made.body.unmatched, ['Priya Sharma']);
  const ws = (await m.call('GET', `/api/projects/${p.id}`)).body;
  assert.equal(ws.task_list.length, 1102);
  const by = (s: string) => ws.task_list.filter((x: any) => x.status === s && x.title !== 'Kick-off call');
  assert.equal(by('DONE').length, 330); assert.equal(by('DOING').length, 330); assert.equal(by('TODO').length, 441);
  assert.ok(by('DONE').every((x: any) => x.completed_at), 'done tasks are marked completed');
  const col = (s: string) => ws.columns.find((c: any) => c.status === s).id;
  assert.ok(by('DOING').every((x: any) => x.column_id === col('DOING')), 'each task sits in the column for its status');
  const priya = ws.task_list.find((x: any) => x.title === 'Task 3, part 2');
  assert.match(priya.description, /Owner in tracker.pdf: Priya Sharma/); assert.equal(priya.assignee_id, null);
  assert.equal(ws.task_list.filter((x: any) => x.due_date).length, 111);
  // the people given tasks hear once each, not once per task
  const notes = (await o.call('GET', '/api/notifications')).body.items.filter((n: any) => n.kind === 'tasks_imported');
  assert.equal(notes.length, 1); assert.match(notes[0].title, /367 tasks for you/);
  // the same list again: everything already there is skipped
  const again = (await m.call('POST', `/api/projects/${p.id}/import`, { source: 'tracker.pdf', rows })).body;
  assert.equal(again.created, 0); assert.equal(again.skipped_existing, 1101);
  const act = (await m.call('GET', `/api/projects/${p.id}/activity`)).body;
  assert.ok(JSON.stringify(act).includes('tasks_imported'));
});

test('import: the AI reader returns a preview and writes nothing', async () => {
  const m = await t.person('farah');
  const p = (await m.call('POST', '/api/projects', { name: 'QC lobby import' })).body;
  const r = (await m.call('POST', `/api/projects/${p.id}/import/ai`, { lines: ['Lobby signage - Done', 'Reception wiring: in progress', 'Paint touch-ups pending'] })).body;
  const j = await job(m.call, r.job_id); assert.equal(j.status, 'done');
  assert.deepEqual(j.result.rows.map((x: any) => x.status), ['DONE', 'DOING', 'TODO']);
  assert.equal((await m.call('GET', `/api/projects/${p.id}`)).body.task_list.length, 0, 'reading creates nothing');
  assert.equal((await m.call('POST', `/api/projects/${p.id}/import`, { source: 'x', rows: [{ title: 'Bad', status: 'MAYBE' }] })).status, 400);
});
