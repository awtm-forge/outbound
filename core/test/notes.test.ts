// Project notes: folders, templates, renames without a version bump, comment replies and edits, content search,
// linked-task tables and the notes assistant (mock provider: a preview, never written into the page).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>;
before(async () => { t = await bootstrap(); });
after(async () => { await t.teardown(); });
const doc = (...lines: string[]) => ({ type: 'doc', content: lines.map((x) => ({ type: 'paragraph', content: [{ type: 'text', text: x }] })) });
const job = async (call: any, id: string) => { for (let i = 0; i < 50; i++) { const j = (await call('GET', `/api/jobs/${id}`)).body; if (j.status === 'done' || j.status === 'failed') return j; await new Promise((r) => setTimeout(r, 50)); } throw new Error('job never finished'); };

test('notes: folders, rename, templates, comments, search, linked tasks, assistant', async () => {
  const m = await t.person('tara'); const o = await t.person('omar');
  const p = (await m.call('POST', '/api/projects', { name: 'QC lobby', description: 'Changes to the existing site.' })).body;
  const folder = (await m.call('POST', `/api/projects/${p.id}/pages`, { title: 'Development', kind: 'folder' })).body; assert.equal(folder.kind, 'folder');
  const task = (await m.call('POST', `/api/projects/${p.id}/tasks`, { title: 'Set up analytics tracking' })).body;
  const brief = (await m.call('POST', `/api/projects/${p.id}/pages`, { title: 'Project brief', parent_id: folder.id, content: { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Improve the lobby website. Fix the checkout bug.' }] },
    { type: 'linkedTasks', attrs: { ids: `${task.id},not-a-task` } }] } })).body;
  const got = (await m.call('GET', `/api/pages/${brief.id}`)).body;
  assert.equal(got.content.content[1].attrs.ids, task.id, 'only real task ids are kept'); assert.equal(got.task_refs[0].id, task.id, 'a linked task counts as a reference');
  // rename from the page list leaves the version alone
  await m.call('PATCH', `/api/pages/${brief.id}`, { title: 'QC Lobby brief', icon: '🚀' });
  const r = (await m.call('GET', `/api/pages/${brief.id}`)).body; assert.equal(r.title, 'QC Lobby brief'); assert.equal(r.icon, '🚀'); assert.equal(r.version, 1);
  // templates: saved from a page, hidden from the page list, used to start a page in another project
  const tpl = await m.call('POST', `/api/pages/${brief.id}/duplicate`, { as_template: true, title: 'Brief template' }); assert.equal(tpl.body.is_template, true);
  assert.ok(!(await m.call('GET', `/api/projects/${p.id}/pages`)).body.some((g: any) => g.id === tpl.body.id), 'templates are not pages');
  assert.ok((await o.call('GET', '/api/page-templates')).body.some((g: any) => g.title === 'Brief template'));
  const p2 = (await o.call('POST', '/api/projects', { name: 'Other' })).body;
  const used = (await o.call('POST', `/api/projects/${p2.id}/pages`, { from_template: tpl.body.id })).body; assert.equal(used.title, 'Brief template'); assert.equal(used.icon, '🚀');
  // search finds words in the text and marks them
  const hits = (await m.call('GET', `/api/projects/${p.id}/pages/search?q=checkout`)).body; assert.equal(hits[0].id, brief.id); assert.match(hits[0].snippet, /\u0001checkout\u0002/i);
  // comments: replies and edits
  const c1 = (await m.call('POST', `/api/pages/${brief.id}/comments`, { body: 'Is GA4 in scope?' })).body;
  const c2 = await o.call('POST', `/api/pages/${brief.id}/comments`, { body: 'Yes, @tara', parent_id: c1.id }); assert.equal(c2.status, 201);
  assert.equal((await o.call('POST', `/api/pages/${brief.id}/comments`, { body: 'deep', parent_id: c2.body.id })).status, 400, 'replies are one level deep');
  assert.equal((await o.call('PATCH', `/api/page-comments/${c1.id}`, { body: 'changed' })).status, 403, 'only the writer edits');
  assert.equal((await m.call('PATCH', `/api/page-comments/${c1.id}`, { body: 'Is GA4 in scope for launch?' })).status, 200);
  const list = (await m.call('GET', `/api/pages/${brief.id}/comments`)).body; assert.equal(list.find((k: any) => k.id === c2.body.id).parent_id, c1.id); assert.ok(list.find((k: any) => k.id === c1.id).edited_at);
  // the assistant: a job with a preview; the page is unchanged
  const a = await m.call('POST', `/api/pages/${brief.id}/assist`, { action: 'extract_tasks' }); assert.ok(a.body.job_id);
  const done = await job(m.call, a.body.job_id); assert.equal(done.status, 'done'); assert.ok(done.result.sections[0].items.some((x: string) => /Fix the checkout bug/.test(x)));
  assert.equal((await m.call('GET', `/api/pages/${brief.id}`)).body.version, 1, 'nothing written into the page');
  const b2 = await job(m.call, (await m.call('POST', `/api/pages/${brief.id}/assist`, { action: 'brief' })).body.job_id);
  assert.equal(b2.result.sections[0].text, 'Changes to the existing site.', 'the brief uses what the project says');
  assert.equal((await m.call('POST', `/api/pages/${brief.id}/assist`, { action: 'write_a_poem' })).status, 400);
});
