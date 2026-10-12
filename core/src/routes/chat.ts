// Workspace: chat. Channels everyone reads, direct conversations between two people, and a long-poll that answers
// the moment something new is visible to the asker (or after 25 s with nothing, inside Hostinger's 60 s limit).
import { route } from '../lib/http.ts';
import { q, one, tx } from '../lib/db.ts';
import { HttpError } from '../pipeline.ts';
import { parse, z, uuid, text, needUuid } from '../lib/validate.ts';
import { waitForWake, wakeAll } from '../lib/wakeup.ts';
import type { PoolClient } from 'pg';

const MAX_WAIT_S = 25;
// what one person can see: every open channel, and the direct conversations they are in
const VISIBLE = (ch: string, user: string) => `(${ch}.kind = 'CHANNEL' or exists (select 1 from chat_members vm where vm.channel_id = ${ch}.id and vm.user_id = ${user}))`;
const MESSAGE = `m.id, m.seq::text seq, m.channel_id, m.author_id, u.name author_name, case when m.deleted_at is null then m.body else '' end body,
  m.created_at, m.edited_at, m.deleted_at is not null deleted`;

async function visibleChannel(id: string, userId: string) {
  const ch = await one(`select c.* from chat_channels c where c.id=$1 and ${VISIBLE('c', '$2')}`, [needUuid(id, 'conversation'), userId]);
  if (!ch) throw new HttpError(404, 'conversation not found');
  return ch;
}
// Every write that takes a seq holds this lock until it commits, so seqs become visible in order and a reader that has
// seen seq N has seen everything below it. Chat writes are a few a minute; the queue this makes is never felt.
async function inSeqOrder<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const r = await tx(async (db) => { await db.query(`select pg_advisory_xact_lock(hashtext('chat_messages.seq'))`); return fn(db); });
  wakeAll(); return r;
}
const nextSeq = `nextval(pg_get_serial_sequence('chat_messages', 'seq'))`;

route('GET', '/api/chat/channels', 'user', async (c) => q(`
  select c.id, c.kind, c.name, c.topic, c.archived, c.created_by,
    case when c.kind = 'DIRECT' then (select json_build_object('id', ou.id, 'name', ou.name, 'username', ou.username::text, 'active', ou.active)
      from chat_members om join users ou on ou.id = om.user_id where om.channel_id = c.id and om.user_id <> $1 limit 1) end other,
    coalesce(me.last_read_seq, 0)::text last_read_seq,
    (select count(*)::int from chat_messages x where x.channel_id = c.id and x.seq > coalesce(me.last_read_seq, 0) and x.deleted_at is null and x.author_id is distinct from $1) unread,
    (select max(x.created_at) from chat_messages x where x.channel_id = c.id) last_at
  from chat_channels c left join chat_members me on me.channel_id = c.id and me.user_id = $1
  where ${VISIBLE('c', '$1')}
  order by c.kind, c.archived, case when c.name = 'general' then 0 else 1 end, c.name, last_at desc nulls last`, [c.user!.id]));

route('POST', '/api/chat/channels', 'user', async (c) => {
  const b = parse(z.object({ name: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'lower-case letters, numbers and dashes, 2 to 40'), topic: text(200).default('') }), c.body);
  if (await one(`select 1 from chat_channels where kind='CHANNEL' and name=$1`, [b.name])) throw new HttpError(409, `#${b.name} already exists.`);
  const ch = (await one(`insert into chat_channels(kind,name,topic,created_by) values('CHANNEL',$1,$2,$3) returning id, kind, name, topic`, [b.name, b.topic, c.user!.id]))!;
  return { created: true, ...ch };
});
route('PATCH', '/api/chat/channels/:id', 'user', async (c) => {
  const ch = await visibleChannel(c.params.id, c.user!.id);
  if (ch.kind !== 'CHANNEL') throw new HttpError(400, 'A direct conversation has no topic or archive.');
  if (c.user!.role !== 'admin' && ch.created_by !== c.user!.id) throw new HttpError(403, 'Only an admin or the person who made the channel can change it.');
  if (ch.name === 'general' && c.body.archived) throw new HttpError(400, '#general stays open.');
  const b = parse(z.object({ topic: text(200).optional(), archived: z.boolean().optional() }), c.body);
  return one(`update chat_channels set topic=coalesce($2,topic), archived=coalesce($3,archived) where id=$1 returning id, name, topic, archived`, [ch.id, b.topic ?? null, b.archived ?? null]);
});
// One conversation per pair, found or made.
route('POST', '/api/chat/direct', 'user', async (c) => {
  const other = parse(z.object({ user_id: uuid }), c.body).user_id;
  if (other === c.user!.id) throw new HttpError(400, 'Pick someone else.');
  if (!(await one('select 1 from users where id=$1 and active', [other]))) throw new HttpError(404, 'person not found');
  const key = [c.user!.id, other].sort().join(':');
  return tx(async (db) => {
    const ch = (await db.query(`insert into chat_channels(kind,direct_key,created_by) values('DIRECT',$1,$2) on conflict (direct_key) do update set direct_key=excluded.direct_key returning id`, [key, c.user!.id])).rows[0];
    await db.query(`insert into chat_members(channel_id,user_id) values($1,$2),($1,$3) on conflict do nothing`, [ch.id, c.user!.id, other]);
    return { id: ch.id };
  });
});

route('GET', '/api/chat/channels/:id/messages', 'user', async (c) => {
  const ch = await visibleChannel(c.params.id, c.user!.id);
  const before = c.url.searchParams.get('before'); const limit = Math.min(Math.max(Number(c.url.searchParams.get('limit')) || 60, 1), 200);
  const rows = await q(`select ${MESSAGE} from chat_messages m left join users u on u.id=m.author_id where m.channel_id=$1 and ($2::bigint is null or m.seq < $2) order by m.seq desc limit $3`,
    [ch.id, before && /^\d+$/.test(before) ? before : null, limit]);
  // oldest first, by when they were written; an edit moves seq on, not the message
  return { messages: rows.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)), more: rows.length === limit };
});
route('POST', '/api/chat/channels/:id/messages', 'user', async (c) => {
  const ch = await visibleChannel(c.params.id, c.user!.id);
  if (ch.archived) throw new HttpError(409, 'This channel is archived.');
  const body = parse(z.object({ body: z.string().max(4000, 'keep a message under 4,000 characters').refine((s) => s.trim().length > 0, 'write something first') }), c.body).body.replace(/\s+$/, '');
  const m = await inSeqOrder(async (db) => {
    const r = (await db.query(`insert into chat_messages(channel_id,author_id,body) values($1,$2,$3) returning id, seq`, [ch.id, c.user!.id, body])).rows[0];
    // what you write you have read
    await db.query(`insert into chat_members(channel_id,user_id,last_read_seq) values($1,$2,$3) on conflict (channel_id,user_id) do update set last_read_seq=greatest(chat_members.last_read_seq, excluded.last_read_seq)`, [ch.id, c.user!.id, r.seq]);
    return r;
  });
  return { created: true, ...(await one(`select ${MESSAGE} from chat_messages m left join users u on u.id=m.author_id where m.id=$1`, [m.id])) };
});
route('PATCH', '/api/chat/messages/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'message');
  const body = parse(z.object({ body: z.string().max(4000).refine((s) => s.trim().length > 0, 'write something first') }), c.body).body.replace(/\s+$/, '');
  const m = await one('select author_id, deleted_at, channel_id from chat_messages where id=$1', [id]); if (!m) throw new HttpError(404, 'message not found');
  await visibleChannel(m.channel_id, c.user!.id);
  if (m.author_id !== c.user!.id) throw new HttpError(403, 'Only the person who wrote it can edit a message.');
  if (m.deleted_at) throw new HttpError(409, 'That message was deleted.');
  await inSeqOrder((db) => db.query(`update chat_messages set body=$2, edited_at=now(), seq=${nextSeq} where id=$1`, [id, body]));
  return one(`select ${MESSAGE} from chat_messages m left join users u on u.id=m.author_id where m.id=$1`, [id]);
});
route('DELETE', '/api/chat/messages/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'message');
  const m = await one('select author_id, channel_id from chat_messages where id=$1', [id]); if (!m) throw new HttpError(404, 'message not found');
  await visibleChannel(m.channel_id, c.user!.id);
  if (m.author_id !== c.user!.id && c.user!.role !== 'admin') throw new HttpError(403, 'Only the person who wrote it, or an admin, can delete a message.');
  // the text goes; the row stays as "deleted" so everyone's view updates through the same cursor
  await inSeqOrder((db) => db.query(`update chat_messages set body='', deleted_at=coalesce(deleted_at, now()), seq=${nextSeq} where id=$1`, [id]));
  return { deleted: true };
});
route('POST', '/api/chat/channels/:id/read', 'user', async (c) => {
  const ch = await visibleChannel(c.params.id, c.user!.id);
  const seq = String(c.body.seq ?? ''); if (!/^\d{1,18}$/.test(seq)) throw new HttpError(400, 'seq: a message number');
  await q(`insert into chat_members(channel_id,user_id,last_read_seq) values($1,$2,$3) on conflict (channel_id,user_id) do update set last_read_seq=greatest(chat_members.last_read_seq, excluded.last_read_seq)`, [ch.id, c.user!.id, seq]);
  return { ok: true };
});

// The live feed. ?after=<cursor from the last answer>&wait=<seconds>. With no cursor it answers at once with the
// current one. Otherwise it answers as soon as anything after the cursor is visible to the asker: new messages, edits
// and deletes, in every conversation they can see. The cursor only ever moves past what this person may see.
route('GET', '/api/chat/poll', 'user', async (c) => {
  const sp = c.url.searchParams; const raw = sp.get('after');
  const deadline = Date.now() + Math.min(Math.max(Number(sp.get('wait')) || 0, 0), MAX_WAIT_S) * 1000;
  const gone = new Promise<void>((r) => c.res.once('close', () => r()));
  let after = raw && /^\d{1,18}$/.test(raw) ? raw : null;
  for (;;) {
    // one statement, one snapshot: the newest seq and the messages are read at the same instant, so moving the cursor
    // to that seq never steps over a message that was committing in between
    const rows = await q(`with t as (select coalesce(max(seq), 0)::text top from chat_messages)
      select t.top, x.* from t left join lateral (
        select ${MESSAGE} from chat_messages m join chat_channels ch on ch.id=m.channel_id left join users u on u.id=m.author_id
        where $2::bigint is not null and m.seq > $2 and ${VISIBLE('ch', '$1')} order by m.seq limit 200) x on true`, [c.user!.id, after]);
    const top: string = rows[0]!.top; const found = rows.filter((r) => r.id).map(({ top: _, ...m }) => m);
    if (after === null) return { cursor: top, messages: [] };
    if (found.length) return { cursor: found.length === 200 ? found.at(-1)!.seq : top, messages: found };
    // nothing for this person yet: what they cannot see is behind them now, so a wake for it is not a wake for them
    after = top;
    if (Date.now() >= deadline || c.res.destroyed) return { cursor: after, messages: [] };
    await waitForWake(Number(after), deadline - Date.now(), gone);
  }
});
