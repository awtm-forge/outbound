// In-app notifications: something someone else did that you should know about (a task given to you, a mention).
// Each one points at a real event; the bell reads them, and opening one marks it read.
import { route } from '../lib/http.ts';
import { q, one } from '../lib/db.ts';
import { parse, z, uuid } from '../lib/validate.ts';

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
  const b = parse(z.object({ ids: z.array(uuid).max(100).optional() }), c.body);
  const r = await q('update notifications set read_at=now() where user_id=$1 and read_at is null and ($2::uuid[] is null or id = any($2)) returning id', [c.user!.id, b.ids ?? null]);
  return { read: r.length };
});
