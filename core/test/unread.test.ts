// The unread counter: chat messages from others plus notifications for you, and opening a task clears its alerts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>;
before(async () => { t = await bootstrap(); });
after(async () => { await t.teardown(); });

test('unread summary: messages and tasks counted, own actions never, opening a task clears it', async () => {
  const a = await t.person('uma'); const b = await t.person('victor');
  const base = (await b.call('GET', '/api/notifications/summary')).body;
  const p = (await a.call('POST', '/api/projects', { name: 'QC lobby counter' })).body;
  const task = (await a.call('POST', `/api/projects/${p.id}/tasks`, { title: 'Fix the lobby header', assignee_id: b.id })).body;
  const dm = (await a.call('POST', '/api/chat/direct', { user_id: b.id })).body;
  const msg = (await a.call('POST', `/api/chat/channels/${dm.id}/messages`, { body: 'Can you look at the header today?' })).body;
  const s = (await b.call('GET', '/api/notifications/summary')).body;
  assert.equal(s.tasks - base.tasks, 1, 'a task given to you counts');
  assert.equal(s.chat - base.chat, 1, 'a message from someone else counts');
  assert.equal(s.total, s.chat + s.notifications);
  assert.ok(s.latest.some((x: any) => x.kind === 'task_assigned' && x.title.includes('Fix the lobby header')));
  assert.ok(s.messages.some((x: any) => x.body === 'Can you look at the header today?' && x.author_name === 'Uma'));
  const mine = (await a.call('GET', '/api/notifications/summary')).body;
  assert.ok(!mine.messages.some((x: any) => x.body === 'Can you look at the header today?'), 'your own message is not unread for you');
  // opening the task clears the alert that pointed at it, and only that one
  const r = (await b.call('POST', '/api/notifications/read', { task_id: task.id })).body; assert.equal(r.read, 1);
  assert.equal((await b.call('GET', '/api/notifications/summary')).body.tasks, base.tasks);
  await b.call('POST', `/api/chat/channels/${dm.id}/read`, { seq: msg.seq });
  assert.equal((await b.call('GET', '/api/notifications/summary')).body.chat, base.chat);
});
