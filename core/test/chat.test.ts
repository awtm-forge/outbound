import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>; let db: typeof import('../src/lib/db.ts');
before(async () => { t = await bootstrap(); db = await import('../src/lib/db.ts'); });
after(async () => { await t.teardown(); });
const general = async (s: any) => (await s.call('GET', '/api/chat/channels')).body.find((c: any) => c.name === 'general');

test('chat: a message reaches a waiting poll well inside a second', async () => {
  const a = await t.person('asha'); const b = await t.person('bilal');
  const g = await general(b); assert.ok(g, '#general exists from the start');
  const start = await b.call('GET', '/api/chat/poll'); assert.ok(start.body.cursor); assert.deepEqual(start.body.messages, []);
  const t0 = Date.now(); const waiting = b.call('GET', `/api/chat/poll?after=${start.body.cursor}&wait=10`);
  await new Promise((r) => setTimeout(r, 300));
  const sentAt = Date.now(); const sent = await a.call('POST', `/api/chat/channels/${g.id}/messages`, { body: 'Standup in 5, @bilal  \n' }); assert.equal(sent.status, 201);
  const got = await waiting; const latency = Date.now() - sentAt;
  assert.equal(got.body.messages.length, 1); assert.equal(got.body.messages[0].body, 'Standup in 5, @bilal'); assert.equal(got.body.messages[0].author_name, 'Asha');
  assert.ok(latency < 1000, `delivered in ${latency} ms`); assert.ok(Date.now() - t0 >= 300, 'the poll did wait');
  assert.equal(got.body.cursor, got.body.messages[0].seq);
  // unread: one for the reader, none for the writer; reading clears it
  assert.equal((await general(b)).unread, 1); assert.equal((await general(a)).unread, 0);
  await b.call('POST', `/api/chat/channels/${g.id}/read`, { seq: got.body.cursor }); assert.equal((await general(b)).unread, 0);
  // an empty wait answers on time with the same cursor
  const quiet = await b.call('GET', `/api/chat/poll?after=${got.body.cursor}&wait=1`); assert.deepEqual(quiet.body.messages, []); assert.equal(quiet.body.cursor, got.body.cursor);
});

test('chat: a message written by another process (straight into the database) arrives through the once-a-second check', async () => {
  const b = await t.signIn(); const g = await general(b);
  const { cursor } = (await b.call('GET', '/api/chat/poll')).body;
  const waiting = b.call('GET', `/api/chat/poll?after=${cursor}&wait=10`); await new Promise((r) => setTimeout(r, 200));
  const sentAt = Date.now(); await db.q(`insert into chat_messages(channel_id, body) values($1, 'from elsewhere')`, [g.id]);
  const got = await waiting; assert.equal(got.body.messages[0].body, 'from elsewhere'); assert.ok(Date.now() - sentAt < 1600, `${Date.now() - sentAt} ms`);
});

test('chat: direct conversations are private, and the cursor steps past what you cannot see', async () => {
  const a = await t.person('chen'); const b = await t.person('dev'); const outsider = await t.person('eve');
  const dm = await a.call('POST', '/api/chat/direct', { user_id: b.id }); assert.ok(dm.body.id);
  assert.equal((await b.call('POST', '/api/chat/direct', { user_id: a.id })).body.id, dm.body.id, 'one conversation per pair');
  assert.equal((await a.call('POST', '/api/chat/direct', { user_id: a.id })).status, 400);
  const c0 = (await outsider.call('GET', '/api/chat/poll')).body.cursor;
  const w = outsider.call('GET', `/api/chat/poll?after=${c0}&wait=1`);
  await a.call('POST', `/api/chat/channels/${dm.body.id}/messages`, { body: 'salary chat, private' });
  const seen = await w; assert.deepEqual(seen.body.messages, [], 'nothing private leaks to the outsider'); assert.ok(BigInt(seen.body.cursor) > BigInt(c0), 'but their cursor moved on');
  assert.equal((await outsider.call('GET', `/api/chat/channels/${dm.body.id}/messages`)).status, 404);
  assert.equal((await outsider.call('POST', `/api/chat/channels/${dm.body.id}/messages`, { body: 'hi' })).status, 404);
  assert.ok(!(await outsider.call('GET', '/api/chat/channels')).body.some((c: any) => c.id === dm.body.id));
  const bView = (await b.call('GET', '/api/chat/channels')).body.find((c: any) => c.id === dm.body.id); assert.equal(bView.other.name, 'Chen'); assert.equal(bView.unread, 1);
  const hist = await b.call('GET', `/api/chat/channels/${dm.body.id}/messages`); assert.equal(hist.body.messages[0].body, 'salary chat, private');
  const msgId = hist.body.messages[0].id;
  assert.equal((await outsider.call('PATCH', `/api/chat/messages/${msgId}`, { body: 'x' })).status, 404);
  assert.equal((await t.api('GET', '/api/chat/poll')).status, 403, 'the API key does not read chat');
});

test('chat: edits and deletes reach everyone through the same cursor; only the author edits, author or admin deletes', async () => {
  const a = await t.person('farah'); const b = await t.person('gita'); const admin = await t.signIn(); const g = await general(a);
  const m = (await a.call('POST', `/api/chat/channels/${g.id}/messages`, { body: 'deploy at 6' })).body;
  const cur = (await b.call('GET', '/api/chat/poll')).body.cursor;
  assert.equal((await b.call('PATCH', `/api/chat/messages/${m.id}`, { body: 'hacked' })).status, 403);
  assert.equal((await b.call('DELETE', `/api/chat/messages/${m.id}`)).status, 403);
  const w = b.call('GET', `/api/chat/poll?after=${cur}&wait=5`);
  await a.call('PATCH', `/api/chat/messages/${m.id}`, { body: 'deploy at 7' });
  const edited = (await w).body; assert.equal(edited.messages[0].id, m.id); assert.equal(edited.messages[0].body, 'deploy at 7'); assert.ok(edited.messages[0].edited_at);
  const w2 = b.call('GET', `/api/chat/poll?after=${edited.cursor}&wait=5`);
  assert.equal((await admin.call('DELETE', `/api/chat/messages/${m.id}`)).status, 200);
  const del = (await w2).body.messages[0]; assert.equal(del.deleted, true); assert.equal(del.body, '');
  assert.equal((await a.call('PATCH', `/api/chat/messages/${m.id}`, { body: 'again' })).status, 409);
  assert.equal((await a.call('POST', `/api/chat/channels/${g.id}/messages`, { body: '   ' })).status, 400);
  assert.equal((await a.call('POST', `/api/chat/channels/${g.id}/messages`, { body: 'x'.repeat(4001) })).status, 400);
});

test('chat: channels are made by anyone, named once, archived by their maker or an admin', async () => {
  const a = await t.person('hari'); const b = await t.person('ira');
  assert.equal((await a.call('POST', '/api/chat/channels', { name: 'Bad Name!' })).status, 400);
  const ch = await a.call('POST', '/api/chat/channels', { name: 'Client-Acme', topic: 'Acme rebuild' }); assert.equal(ch.status, 201); assert.equal(ch.body.name, 'client-acme');
  assert.equal((await b.call('POST', '/api/chat/channels', { name: 'client-acme' })).status, 409);
  assert.equal((await b.call('PATCH', `/api/chat/channels/${ch.body.id}`, { archived: true })).status, 403);
  assert.equal((await a.call('PATCH', `/api/chat/channels/${ch.body.id}`, { archived: true })).status, 200);
  assert.equal((await b.call('POST', `/api/chat/channels/${ch.body.id}/messages`, { body: 'hi' })).status, 409);
  const g = await general(a); const admin = await t.signIn(); assert.equal((await admin.call('PATCH', `/api/chat/channels/${g.id}`, { archived: true })).status, 400);
});

test('chat: concurrent writers never let a reader skip a message', async () => {
  const people = await Promise.all(['jai', 'kiran', 'lena'].map((n) => t.person(n))); const reader = await t.signIn(); const g = await general(reader);
  let cursor = (await reader.call('GET', '/api/chat/poll')).body.cursor; const seen = new Set<string>();
  const writes = Promise.all(people.flatMap((p, i) => Array.from({ length: 10 }, (_, j) => p.call('POST', `/api/chat/channels/${g.id}/messages`, { body: `m-${i}-${j}` }))));
  const deadline = Date.now() + 8000;
  while (seen.size < 30 && Date.now() < deadline) { const r = (await reader.call('GET', `/api/chat/poll?after=${cursor}&wait=2`)).body; for (const m of r.messages) seen.add(m.body); cursor = r.cursor; }
  await writes; assert.equal(seen.size, 30);
});
