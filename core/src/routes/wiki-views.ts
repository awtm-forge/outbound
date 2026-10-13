// Wiki: the dashboard numbers, categories, the page browser, page metadata (move, reorder, archive, star, template),
// quick links, comments, views (one per person per page per day), files, and the activity feed. Registered before
// routes/wiki.ts so these paths are not read as a page slug.
import { route, type Ctx } from '../lib/http.ts';
import { q, one, audit } from '../lib/db.ts';
import { HttpError } from '../pipeline.ts';
import { parse, z, uuid, text, needUuid } from '../lib/validate.ts';
import { readUpload, storeFile, MAX_FILE } from './files.ts';
import { mentions } from './projects.ts';

// Same rule as the app's slugify (web/src/ui/markdown.tsx), so a [[Wiki link]] finds the page it names.
export const slugify = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '') || 'page';
export const wikiAct = (c: Ctx, id: string, action: string, detail: Record<string, unknown> = {}) => audit('wiki', id, action, c.actor, { ...detail, user_id: c.user?.id ?? null });
async function needPage(id: string) { const p = await one('select * from wiki_pages where id=$1', [needUuid(id, 'page')]); if (!p) throw new HttpError(404, 'page not found'); return p; }
const HEX = z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/, 'use a colour like #3B82F6').transform((v) => '#' + v.replace('#', '').toUpperCase());

route('GET', '/api/wiki/summary', 'user', async () => ({ ...(await one(`select
    (select count(*) from wiki_pages where archived_at is null and not is_template)::int pages,
    (select count(*) from wiki_pages where archived_at is null and not is_template and created_at >= now() - interval '7 days')::int pages_week,
    (select count(distinct author_id) from wiki_revisions where author_id is not null)::int contributors,
    (select count(distinct author_id) from wiki_revisions where author_id is not null and created_at >= now() - interval '30 days')::int contributors_month,
    (select count(*) from wiki_categories)::int categories,
    (select count(distinct page_id) from wiki_views where day >= current_date - 30)::int viewed_pages,
    (select count(*) from wiki_views where day >= current_date - 30)::int views_30d,
    (select count(*) from wiki_views where day >= current_date - 60 and day < current_date - 30)::int views_prev_30d,
    (select count(*) from wiki_pages where archived_at is not null)::int archived,
    (select count(*) from wiki_pages where is_template and archived_at is null)::int templates`)),
  // the last eight weeks, oldest first: pages that existed by the end of the week, people who saved, views
  series: await q(`select w.wk::date week,
      (select count(*) from wiki_pages p where not p.is_template and p.created_at < w.wk + interval '7 days' and (p.archived_at is null or p.archived_at >= w.wk + interval '7 days'))::int pages,
      (select count(distinct author_id) from wiki_revisions r where r.created_at >= w.wk and r.created_at < w.wk + interval '7 days')::int contributors,
      (select count(*) from wiki_views v where v.day >= w.wk::date and v.day < (w.wk + interval '7 days')::date)::int views
    from generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') w(wk) order by w.wk`) }));

// ---------- categories ----------
const CatIn = z.object({ name: text(60).min(1), icon: z.string().max(30).nullable().optional(), color: HEX.nullable().optional(), position: z.number().finite().optional() });
route('GET', '/api/wiki/categories', 'user', async () => q(`select c.*, (select count(*)::int from wiki_pages w where w.category_id=c.id and w.archived_at is null and not w.is_template) pages
  from wiki_categories c order by c.position, c.name`));
route('POST', '/api/wiki/categories', 'user', async (c) => {
  const b = parse(CatIn, c.body);
  const r = await one(`insert into wiki_categories(name,icon,color,position,created_by) values($1,$2,$3,coalesce($4,(select coalesce(max(position),0)+1 from wiki_categories)),$5) returning *`, [b.name, b.icon ?? null, b.color ?? null, b.position ?? null, c.user!.id]);
  return { created: true, ...r };
});
route('PATCH', '/api/wiki/categories/:id', 'user', async (c) => {
  const b = parse(CatIn.partial(), c.body); const keys = Object.keys(b).filter((k) => (b as any)[k] !== undefined);
  if (!keys.length) throw new HttpError(400, 'nothing to change');
  const r = await one(`update wiki_categories set ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')} where id=$1 returning *`, [needUuid(c.params.id, 'category'), ...keys.map((k) => (b as any)[k])]);
  if (!r) throw new HttpError(404, 'category not found'); return r;
});
// its pages stay, without a category
route('DELETE', '/api/wiki/categories/:id', 'user', async (c) => {
  const r = await one('delete from wiki_categories where id=$1 returning name', [needUuid(c.params.id, 'category')]); if (!r) throw new HttpError(404, 'category not found');
  return { deleted: true };
});

// ---------- the page browser ----------
const ROW = `w.id, w.slug, w.title, w.icon, w.description, w.parent_id, w.category_id, w.position, w.is_template, w.archived_at, w.created_at, w.updated_at, w.version,
  left(regexp_replace(w.body, '[#*_>\`\\[\\]-]+', ' ', 'g'), 220) excerpt, cat.name category, cat.color category_color, cat.icon category_icon,
  cu.name created_by_name, uu.name updated_by_name, w.created_by, (s.user_id is not null) starred,
  (select count(*)::int from wiki_views v where v.page_id=w.id and v.day >= current_date - 30) views_30d`;
const FROM = `from wiki_pages w left join wiki_categories cat on cat.id=w.category_id left join users cu on cu.id=w.created_by left join users uu on uu.id=w.updated_by
  left join wiki_stars s on s.page_id=w.id and s.user_id=$1`;
route('GET', '/api/wiki/pages', 'user', async (c) => {
  const sp = c.url.searchParams; const view = sp.get('view') ?? 'all'; const size = Math.min(100, Math.max(6, Number(sp.get('size')) || 24)); const offset = Math.max(0, (Number(sp.get('page')) || 1) - 1) * size;
  const term = (sp.get('q') ?? '').trim().slice(0, 100); const like = term ? '%' + term.replace(/[\\%_]/g, (m) => '\\' + m) + '%' : null;
  const sort = ({ updated: 'w.updated_at desc', created: 'w.created_at desc', title: 'lower(w.title)', popular: 'views_30d desc, w.updated_at desc' } as Record<string, string>)[sp.get('sort') ?? 'updated'] ?? 'w.updated_at desc';
  const cat = sp.get('category'); const author = sp.get('author');
  const rows = await q(`select ${ROW}, count(*) over()::int total ${FROM}
    where (($2 = 'archive' and w.archived_at is not null) or ($2 <> 'archive' and w.archived_at is null))
      and (($2 = 'templates' and w.is_template) or ($2 <> 'templates' and not w.is_template) or $2 = 'archive')
      and ($2 <> 'starred' or s.user_id is not null)
      and ($2 <> 'recent' or w.updated_at >= now() - interval '14 days')
      and ($3::text is null or ($3 = 'none' and w.category_id is null) or w.category_id::text = $3)
      and ($4::uuid is null or w.created_by = $4 or w.updated_by = $4)
      and ($5::text is null or w.title ilike $5 or w.description ilike $5 or cat.name ilike $5 or w.search @@ websearch_to_tsquery('simple', $6))
    order by ${sort} limit $7 offset $8`, [c.user!.id, view, cat || null, author && /^[0-9a-f-]{36}$/i.test(author) ? author : null, like, term || 'x', size, offset]);
  return { total: rows[0]?.total ?? 0, rows: rows.map(({ total, ...r }) => r) };
});
// the whole tree for the side panel: titles only
route('GET', '/api/wiki/tree', 'user', async (c) => q(`select w.id, w.slug, w.title, w.icon, w.parent_id, w.category_id, w.position, (s.user_id is not null) starred
  from wiki_pages w left join wiki_stars s on s.page_id=w.id and s.user_id=$1 where w.archived_at is null and not w.is_template order by w.position, lower(w.title)`, [c.user!.id]));
route('GET', '/api/wiki/popular', 'user', async () => q(`select w.id, w.slug, w.title, w.icon, count(*)::int views from wiki_views v join wiki_pages w on w.id=v.page_id
  where v.day >= current_date - 30 and w.archived_at is null group by w.id order by views desc, w.title limit 5`));
route('GET', '/api/wiki/activity', 'user', async (c) => {
  const n = Math.min(50, Number(c.url.searchParams.get('limit')) || 8);
  return q(`select a.id, a.action, a.detail, a.created_at, u.name actor_name, w.slug, coalesce(w.title, a.detail->>'title') title, w.id page_id
    from activities a left join users u on u.id = (a.detail->>'user_id')::uuid left join wiki_pages w on w.id=a.entity_id
    where a.entity_type='wiki' order by a.created_at desc limit $1`, [n]);
});

// ---------- quick links: each person's own, in order ----------
route('GET', '/api/wiki/quick-links', 'user', async (c) => q(`select w.id, w.slug, w.title, w.icon, w.is_template, cat.name category, cat.color category_color from wiki_quick_links l join wiki_pages w on w.id=l.page_id
  left join wiki_categories cat on cat.id=w.category_id where l.user_id=$1 and w.archived_at is null order by l.position`, [c.user!.id]));
route('PUT', '/api/wiki/quick-links', 'user', async (c) => {
  const b = parse(z.object({ page_ids: z.array(uuid).max(20) }), c.body);
  const ids = [...new Set(b.page_ids)];
  if (ids.length && (await q('select id from wiki_pages where id = any($1)', [ids])).length !== ids.length) throw new HttpError(400, 'Some of those pages do not exist.');
  await q('delete from wiki_quick_links where user_id=$1', [c.user!.id]);
  for (const [i, id] of ids.entries()) await q('insert into wiki_quick_links(user_id,page_id,position) values($1,$2,$3)', [c.user!.id, id, i]);
  return { saved: ids.length };
});

// ---------- one page: everything but its content ----------
route('PATCH', '/api/wiki/:id', 'user', async (c) => {
  const g = await needPage(c.params.id);
  const b = parse(z.object({ title: text(160).min(1).optional(), icon: z.string().max(16).nullable().optional(), description: text(300).optional(), category_id: uuid.nullable().optional(),
    parent_id: uuid.nullable().optional(), position: z.number().finite().optional(), archived: z.boolean().optional(), starred: z.boolean().optional(), is_template: z.boolean().optional() }), c.body);
  if (b.category_id && !(await one('select 1 from wiki_categories where id=$1', [b.category_id]))) throw new HttpError(400, 'That category does not exist.');
  if (b.parent_id) {
    if (b.parent_id === g.id) throw new HttpError(400, 'A page cannot sit inside itself.');
    if (!(await one('select 1 from wiki_pages where id=$1', [b.parent_id]))) throw new HttpError(400, 'That parent page does not exist.');
    if (await one(`with recursive up as (select id, parent_id from wiki_pages where id=$1 union all select w.id, w.parent_id from wiki_pages w join up on w.id=up.parent_id) select 1 from up where id=$2`, [b.parent_id, g.id]))
      throw new HttpError(400, 'A page cannot sit inside one of its own sub-pages.');
  }
  const set: Record<string, unknown> = {};
  for (const k of ['title', 'icon', 'description', 'category_id', 'parent_id', 'position', 'is_template'] as const) if (b[k] !== undefined) set[k] = b[k];
  if (b.parent_id !== undefined && b.position === undefined) set.position = (await one('select coalesce(max(position),0)+1 p from wiki_pages where parent_id is not distinct from $1', [b.parent_id]))!.p;
  if (b.archived !== undefined) set.archived_at = b.archived ? new Date() : null;
  const keys = Object.keys(set);
  // metadata changes do not bump the version, so they never collide with someone typing in the page
  if (keys.length) await q(`update wiki_pages set ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')} where id=$1`, [g.id, ...keys.map((k) => set[k])]);
  if (b.starred !== undefined) await q(b.starred ? 'insert into wiki_stars(page_id,user_id) values($1,$2) on conflict do nothing' : 'delete from wiki_stars where page_id=$1 and user_id=$2', [g.id, c.user!.id]);
  const title = b.title ?? g.title;
  if (b.title && b.title !== g.title) await wikiAct(c, g.id, 'renamed', { title, from: g.title });
  if ((b.parent_id !== undefined && b.parent_id !== g.parent_id) || (b.category_id !== undefined && b.category_id !== g.category_id)) await wikiAct(c, g.id, 'moved', { title });
  if (b.archived !== undefined && !!g.archived_at !== b.archived) await wikiAct(c, g.id, b.archived ? 'archived' : 'restored', { title });
  if (b.is_template && !g.is_template) await wikiAct(c, g.id, 'template_created', { title });
  return { ok: true };
});
route('POST', '/api/wiki/:id/duplicate', 'user', async (c) => {
  const g = await needPage(c.params.id);
  // as_page: a template used to start a real page; as_template: a page kept as a starting point for others
  const b = parse(z.object({ as_page: z.boolean().optional(), as_template: z.boolean().optional(), title: text(160).optional() }), c.body);
  if (b.as_page && b.as_template) throw new HttpError(400, 'Choose a page or a template, not both.');
  const title = b.title || (g.is_template && b.as_page ? g.title : `${g.title} (copy)`);
  const template = b.as_template ? true : b.as_page ? false : g.is_template;
  const base = slugify(title);
  const taken = new Set((await q(`select slug from wiki_pages where slug = $1 or slug ~ ('^' || $1 || '-[0-9]+$')`, [base])).map((r) => r.slug));
  let slug = base; for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  const d = (await one(`insert into wiki_pages(slug,title,body,content,icon,description,category_id,parent_id,position,is_template,created_by,updated_by)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) returning id, slug, title`, [slug, title, g.body, g.content, g.icon, g.description, g.category_id, b.as_page || b.as_template ? null : g.parent_id, g.position + 0.5, template, c.user!.id]))!;
  await q('insert into wiki_revisions(page_id,version,title,body,content,author_id) values($1,1,$2,$3,$4,$5)', [d.id, title, g.body, g.content, c.user!.id]);
  await wikiAct(c, d.id, template && !g.is_template ? 'template_created' : 'created', { title, from_template: g.is_template && !template ? g.title : null });
  return { created: true, ...d };
});
route('POST', '/api/wiki/:id/view', 'user', async (c) => {
  const g = await needPage(c.params.id);
  await q(`insert into wiki_views(page_id,user_id,day) values($1,$2,(now() at time zone 'Asia/Kolkata')::date) on conflict do nothing`, [g.id, c.user!.id]);
  return { ok: true };
});
route('GET', '/api/wiki/:id/comments', 'user', async (c) => q(`select k.id, k.body, k.created_at, k.author_id, u.name author_name from wiki_comments k left join users u on u.id=k.author_id where k.page_id=$1 order by k.created_at`, [(await needPage(c.params.id)).id]));
route('POST', '/api/wiki/:id/comments', 'user', async (c) => {
  const g = await needPage(c.params.id); const b = parse(z.object({ body: text(5000).min(1) }), c.body);
  const k = (await one('insert into wiki_comments(page_id,author_id,body) values($1,$2,$3) returning id, body, created_at, author_id', [g.id, c.user!.id, b.body]))!;
  await wikiAct(c, g.id, 'commented', { title: g.title, excerpt: b.body.slice(0, 140) });
  await mentions(b.body, c, `${c.user!.name} mentioned you on the wiki page “${g.title}”`, `/wiki/${g.slug}`);
  return { created: true, ...k, author_name: c.user!.name };
});
route('DELETE', '/api/wiki/comments/:id', 'user', async (c) => {
  const k = await one('delete from wiki_comments where id=$1 and (author_id=$2 or $3) returning id', [needUuid(c.params.id, 'comment'), c.user!.id, c.user!.role === 'admin']);
  if (!k) throw new HttpError(403, 'Only the person who wrote a comment, or an admin, can delete it.'); return { deleted: true };
});
route('POST', '/api/wiki/:id/files', 'user', async (c) => {
  const g = await needPage(c.params.id); const up = readUpload(c);
  const f = await storeFile({ wiki_page_id: g.id }, up, c.user!.id);
  await wikiAct(c, g.id, 'file_uploaded', { title: g.title, name: f.name });
  return { created: true, ...f };
}, { raw: MAX_FILE });
