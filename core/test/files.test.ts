// Project files: folders (nested, no loops, deleting moves contents up), names kept unique per folder, moving,
// replacing with versions kept, comments, storage use from the stored sizes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>;
before(async () => { t = await bootstrap(); });
after(async () => { await t.teardown(); });

test('files: folders, unique names, move, replace with versions, comments, usage', async () => {
  const m = await t.person('fatima'); const o = await t.person('oscar');
  const p = (await m.call('POST', '/api/projects', { name: 'Brand refresh' })).body;
  const up = (name: string, body: string, extra = '', path = `/api/projects/${p.id}/files?name=${encodeURIComponent(name)}${extra}`) =>
    fetch(t.url + path, { method: 'POST', headers: { cookie: m.cookie, 'content-type': 'text/plain', 'idempotency-key': crypto.randomUUID() }, body }).then(async (r) => ({ status: r.status, body: await r.json() }));

  // folders
  const design = (await m.call('POST', `/api/projects/${p.id}/folders`, { name: 'Design', color: '38bdf8' })).body;
  assert.equal(design.color, '#38BDF8');
  assert.equal((await m.call('POST', `/api/projects/${p.id}/folders`, { name: 'design' })).status, 409, 'no two folders with one name in one place');
  const icons = (await m.call('POST', `/api/projects/${p.id}/folders`, { name: 'Icons', parent_id: design.id })).body;
  assert.equal((await m.call('PATCH', `/api/folders/${design.id}`, { parent_id: icons.id })).status, 409, 'a folder cannot go inside its own folder');
  assert.equal((await m.call('PATCH', `/api/folders/${design.id}`, { parent_id: design.id })).status, 409);
  const other = (await m.call('POST', '/api/projects', { name: 'Elsewhere' })).body;
  assert.equal((await m.call('POST', `/api/projects/${other.id}/folders`, { name: 'X', parent_id: design.id })).status, 400, 'parent must be in the same project');

  // uploads into a folder; the same name gets a number
  const a = await up('logo.txt', 'first', `&folder_id=${design.id}`); assert.equal(a.status, 201); assert.equal(a.body.folder_id, design.id); assert.equal(a.body.renamed, null);
  const b = await up('Logo.txt', 'second', `&folder_id=${design.id}`); assert.equal(b.body.name, 'Logo (2).txt'); assert.equal(b.body.renamed, 'Logo (2).txt');
  const c = await up('logo.txt', 'root'); assert.equal(c.body.name, 'logo.txt', 'another folder is another place');
  assert.equal((await up('x.txt', 'x', `&folder_id=${other.id}`)).status, 400);
  const folders = (await m.call('GET', `/api/projects/${p.id}/folders`)).body;
  assert.equal(folders.find((f: any) => f.id === design.id).files, 2);

  // move and describe
  const mv = await m.call('PATCH', `/api/files/${c.body.id}`, { folder_id: icons.id, description: 'The root copy' });
  assert.equal(mv.body.folder_id, icons.id); assert.equal(mv.body.description, 'The root copy');

  // replace keeps the old bytes as version 1
  const rep = await fetch(`${t.url}/api/files/${a.body.id}/replace`, { method: 'POST', headers: { cookie: o.cookie, 'content-type': 'text/plain', 'idempotency-key': crypto.randomUUID() }, body: 'third and longer' }).then((r) => r.json());
  assert.equal(rep.version, 2); assert.equal(rep.size, 16); assert.equal(rep.uploaded_by_name, 'Oscar');
  assert.equal(await (await fetch(`${t.url}/api/files/${a.body.id}/content`, { headers: { cookie: m.cookie } })).text(), 'third and longer');
  const old = await fetch(`${t.url}/api/files/${a.body.id}/versions/1/content`, { headers: { cookie: m.cookie } });
  assert.equal(await old.text(), 'first'); assert.match(old.headers.get('content-disposition')!, /attachment/);
  assert.equal((await fetch(`${t.url}/api/files/${a.body.id}/versions/9/content`, { headers: { cookie: m.cookie } })).status, 404);

  // comments, with a mention
  const k = (await m.call('POST', `/api/files/${a.body.id}/comments`, { body: 'Looks right @oscar' })).body; assert.equal(k.author_name, 'Fatima');
  assert.equal((await o.call('DELETE', `/api/file-comments/${k.id}`, {})).status, 403, 'only the writer deletes');
  const note = (await o.call('GET', '/api/notifications')).body;
  assert.ok(JSON.stringify(note).includes('logo.txt'), 'the mentioned person is told');

  // details: versions, comments and this file's activity
  const d = (await m.call('GET', `/api/files/${a.body.id}`)).body;
  assert.equal(d.folder_name, 'Design'); assert.equal(d.versions.length, 1); assert.equal(d.versions[0].version, 1); assert.equal(d.comments.length, 1);
  assert.deepEqual(d.activity.map((x: any) => x.action).sort(), ['file_comment', 'file_replaced', 'file_uploaded']);

  // usage counts current files and kept versions, and says when there is no cap
  const u = (await m.call('GET', `/api/projects/${p.id}/files/usage`)).body;
  assert.equal(u.used, 16 + 6 + 4 + 5); assert.equal(u.files, 3); assert.equal(u.limit, null); assert.equal(u.max_file, 10_000_000);

  // deleting a folder moves its files and folders up, never deletes them
  const del = (await m.call('DELETE', `/api/folders/${design.id}`, {})).body; assert.equal(del.moved, 2);
  const files = (await m.call('GET', `/api/projects/${p.id}/files`)).body;
  assert.equal(files.length, 3); assert.equal(files.filter((f: any) => f.folder_id === null).length, 2);
  const left = (await m.call('GET', `/api/projects/${p.id}/folders`)).body; assert.equal(left.length, 1); assert.equal(left[0].parent_id, null, 'the inner folder moved up');

  // rename to a folder name already used there
  await m.call('POST', `/api/projects/${p.id}/folders`, { name: 'Exports' });
  assert.equal((await m.call('PATCH', `/api/folders/${icons.id}`, { name: 'exports' })).status, 409);
});
