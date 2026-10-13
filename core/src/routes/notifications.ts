// In-app notifications: something someone else did that you should know about (a task given to you, a mention).
// Each one points at a real event; the bell reads them, and opening one marks it read.
import { route } from '../lib/http.ts';
import { q, one } from '../lib/db.ts';
import { parse, z, uuid } from '../lib/validate.ts';
import { VISIBLE } from './chat.ts';

export async function notify(userId: string, actorId: string | null, kind: string, title: string, link: string | null) {
  if (!userId || userId === actorId) return; // nobody is told about their own action
  await q('insert into notifications(user_id,actor_id,kind,title,link) values($1,$2,$3,$4,$5)', [userId, actorId, kind, title.slice(0, 300), link]);
}

route('GET', '/api/notifications', 'user', async (c) => {
  const [items, unread] = await Promise.all([
    q(`select n.id, n.kind, n.title, n.link, n.read_at, n.created_at, u.name actor_name from notifications n left join users u on u.id=n.actor_id
      where n.user_id=$1 order by n.created_at desc limit 30`, [c.user!.id]),
    one('select count(*)::int n from notifications where user_id=$1 and read_at is null', [c.user!.id]),
  ]);
  return { unread: unread!.n, items };
});
route('POST', '/api/notifications/read', 'user', async (c) => {
  // ids: those ones; task_id: everything that pointed at a task the person has now opened; neither: all
  const b = parse(z.object({ ids: z.array(uuid).max(100).optional(), task_id: uuid.optional() }), c.body);
  const r = await q(`update notifications set read_at=now() where user_id=$1 and read_at is null and ($2::uuid[] is null or id = any($2))
    and ($3::text is null or link like '%task=' || $3) returning id`, [c.user!.id, b.ids ?? null, b.task_id ?? null]);
  return { read: r.length };
});

// The unread counters for the tab title, the app icon and desktop alerts, in one light call: notifications by kind,
// chat messages from others not yet read (archived channels left out, as in the sidebar), and the newest few of each.
const TASK_KINDS = ['task_assigned', 'project_added'];
route('GET', '/api/notifications/summary', 'user', async (c) => {
  const me = c.user!.id;
  const [kinds, latest, chat, messages] = await Promise.all([
    q('select kind, count(*)::int n from notifications where user_id=$1 and read_at is null group by kind', [me]),
    q('select id, kind, title, link, created_at from notifications where user_id=$1 and read_at is null order by created_at desc limit 5', [me]),
    one(`select count(*)::int n from chat_messages x join chat_channels ch on ch.id = x.channel_id left join chat_members mm on mm.channel_id = ch.id and mm.user_id = $1
      where ${VISIBLE('ch', '$1')} and not ch.archived and x.deleted_at is null and x.author_id is distinct from $1 and coalesce(x.first_seq, x.seq) > coalesce(mm.last_read_seq, 0)`, [me]),
    q(`select x.id, x.channel_id, ch.kind, ch.name channel_name, u.name author_name, left(x.body, 140) body, x.created_at
      from chat_messages x join chat_channels ch on ch.id = x.channel_id left join chat_members mm on mm.channel_id = ch.id and mm.user_id = $1 left join users u on u.id = x.author_id
      where ${VISIBLE('ch', '$1')} and not ch.archived and x.deleted_at is null and x.author_id is distinct from $1 and coalesce(x.first_seq, x.seq) > coalesce(mm.last_read_seq, 0)
      order by x.seq desc limit 5`, [me]),
  ]);
  const by: Record<string, number> = Object.fromEntries(kinds.map((k) => [k.kind, k.n]));
  const notifications = kinds.reduce((a, k) => a + k.n, 0);
  const tasks = TASK_KINDS.reduce((a, k) => a + (by[k] ?? 0), 0);
  return { total: notifications + chat!.n, chat: chat!.n, notifications, tasks, mentions: by.mentioned ?? 0, latest, messages };
});
