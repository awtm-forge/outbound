// Workspace: the wiki. Signed-in people read and write every page; deleting is for admins and the page's author.
// A page is either an editor document (content) or, for pages written before the editor, Markdown (body). Saving in
// the editor stores the document and keeps body as its plain text, so search keeps working for both.
import { route } from '../lib/http.ts';
import { q, one, tx } from '../lib/db.ts';
import { HttpError } from '../pipeline.ts';
import { parse, z, uuid, text, needUuid, isUuid } from '../lib/validate.ts';
import { clean } from './pages.ts';
import { notify } from './notifications.ts';
import { wikiAct, slugify } from './wiki-views.ts';
export { slugify };

const HL_START = '\u0001', HL_STOP = '\u0002'; // search highlight markers: never typed by a person, so never confused with page text

const Meta = { icon: z.string().max(16).nullable().optional(), description: text(300).optional(), category_id: uuid.nullable().optional(), content: z.any().optional() };
const PageIn = z.object({ title: text(160).min(1), body: text(200_000).optional(), parent_id: uuid.nullable().optional(), is_template: z.boolean().optional(), ...Meta });
const PAGE = `select w.id, w.slug, w.title, w.body, w.content, w.icon, w.description, w.category_id, w.parent_id, w.position, w.archived_at, w.is_template, w.version, w.created_at, w.updated_at, w.created_by,
    cu.name created_by_name, uu.name updated_by_name, pp.slug parent_slug, pp.title parent_title, cat.name category, cat.color category_color, cat.icon category_icon
  from wiki_pages w left join users cu on cu.id=w.created_by left join users uu on uu.id=w.updated_by left join wiki_pages pp on pp.id=w.parent_id left join wiki_categories cat on cat.id=w.category_id`;

async function checkParent(id: string | null, parent: string | null | undefined) {
  if (!parent) return;
  if (id && parent === id) throw new HttpError(400, 'A page cannot sit inside itself.');
  if (!(await one('select 1 from wiki_pages where id=$1', [parent]))) throw new HttpError(400, 'That parent page does not exist.');
  // the new parent must not be one of this page's own descendants
  if (id && await one(`with recursive up as (select id, parent_id from wiki_pages where id=$1 union all select w.id, w.parent_id from wiki_pages w join up on w.id=up.parent_id) select 1 from up where id=$2`, [parent, id]))
    throw new HttpError(400, 'A page cannot sit inside one of its own sub-pages.');
}
async function checkCategory(id: string | null | undefined) {
  if (id && !(await one('select 1 from wiki_categories where id=$1', [id]))) throw new HttpError(400, 'That category does not exist.');
}
function document(content: unknown) {
  if (content === undefined) return null;
  const d = clean(content);
  if (JSON.stringify(d.doc).length > 1_500_000) throw new HttpError(413, 'That page is too large to save. Split it into smaller pages.');
  return d;
}

route('GET', '/api/wiki', 'user', async (c) => {
  const term = (c.url.searchParams.get('q') ?? '').trim().slice(0, 200);
  if (!term) return q(`select w.id, w.slug, w.title, w.icon, w.parent_id, w.updated_at, u.name updated_by_name from wiki_pages w left join users u on u.id=w.updated_by where w.archived_at is null and not w.is_template order by lower(w.title)`);
  const like = '%' + term.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
  return q(`select w.id, w.slug, w.title, w.icon, w.parent_id, w.updated_at, u.name updated_by_name, cat.name category,
      ts_headline('simple', w.body, websearch_to_tsquery('simple', $1), 'StartSel=${HL_START}, StopSel=${HL_STOP}, MaxWords=28, MinWords=12, MaxFragments=1') snippet
    from wiki_pages w left join users u on u.id=w.updated_by left join wiki_categories cat on cat.id=w.category_id
    where w.archived_at is null and (w.search @@ websearch_to_tsquery('simple', $1) or w.title ilike $2 or w.description ilike $2)
    order by (w.title ilike $2) desc, ts_rank(w.search, websearch_to_tsquery('simple', $1)) desc, w.updated_at desc limit 50`, [term, like]);
});
// a page by its slug, or by its id (editor page links carry the id)
route('GET', '/api/wiki/:slug', 'user', async (c) => {
  const key = c.params.slug;
  const p = await one(`${PAGE} where ${isUuid(key) ? 'w.id=$1::uuid' : 'w.slug=$1'}`, [key]); if (!p) throw new HttpError(404, 'page not found');
  const [children, crumbs, star, comments, views, files] = await Promise.all([
    q('select id, slug, title, icon from wiki_pages where parent_id=$1 and archived_at is null order by position, lower(title)', [p.id]),
    q(`with recursive up(id, parent_id, slug, title, icon, d) as (select id, parent_id, slug, title, icon, 0 from wiki_pages where id=$1
        union all select w.id, w.parent_id, w.slug, w.title, w.icon, up.d+1 from wiki_pages w join up on w.id=up.parent_id where up.d < 50)
      select id, slug, title, icon from up where id<>$1 order by d desc`, [p.id]),
    one('select 1 from wiki_stars where page_id=$1 and user_id=$2', [p.id, c.user!.id]),
    one('select count(*)::int n from wiki_comments where page_id=$1', [p.id]),
    one('select count(*)::int n from wiki_views where page_id=$1 and day >= current_date - 30', [p.id]),
    q('select f.id, f.name, f.size, f.mime, f.created_at, u.name uploaded_by_name from project_files f left join users u on u.id=f.uploaded_by where f.wiki_page_id=$1 order by f.created_at desc', [p.id]),
  ]);
  return { ...p, children, breadcrumbs: crumbs, starred: !!star, comments: comments!.n, views_30d: views!.n, files };
});
route('POST', '/api/wiki', 'user', async (c) => {
  const b = parse(PageIn, c.body); await checkParent(null, b.parent_id); await checkCategory(b.category_id);
  const d = document(b.content); const body = d ? d.text : b.body ?? '';
  const p = await tx(async (db) => {
    // a title that is already a slug gets -2, -3 ... ; the slug never changes after this
    const base = slugify(b.title); const taken = new Set((await db.query(`select slug from wiki_pages where slug = $1 or slug ~ ('^' || $1 || '-[0-9]+$')`, [base])).rows.map((r) => r.slug));
    let slug = base; for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
    const p = (await db.query(`insert into wiki_pages(slug,title,body,content,icon,description,category_id,parent_id,is_template,position,created_by,updated_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,(select coalesce(max(position),0)+1 from wiki_pages where parent_id is not distinct from $8),$10,$10) returning id, slug, version`,
      [slug, b.title, body, d?.doc ?? null, b.icon ?? null, b.description ?? '', b.category_id ?? null, b.parent_id ?? null, b.is_template ?? false, c.user!.id])).rows[0];
    await db.query('insert into wiki_revisions(page_id,version,title,body,content,author_id) values($1,1,$2,$3,$4,$5)', [p.id, b.title, body, d?.doc ?? null, c.user!.id]);
    return p;
  });
  await wikiAct(c, p.id, b.is_template ? 'template_created' : 'created', { title: b.title });
  if (d) await mentioned(d.people, [], c, b.title, p.slug);
  return { created: true, ...p };
});
async function mentioned(now: string[], before: string[], c: any, title: string, slug: string) {
  for (const uid of now.filter((x) => !before.includes(x) && x !== c.user!.id)) if (await one('select 1 from users where id=$1 and active', [uid]))
    await notify(uid, c.user!.id, 'mentioned', `${c.user!.name} mentioned you on the wiki page “${title}”`, `/wiki/${slug}`);
}
// a save, based on the version the editor loaded. Content (editor) or body (Markdown); parent only when given.
route('PUT', '/api/wiki/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'page');
  const b = parse(PageIn.partial({ title: true }).extend({ base_version: z.number().int().positive() }), c.body);
  if (b.parent_id !== undefined) await checkParent(id, b.parent_id); await checkCategory(b.category_id);
  const d = document(b.content);
  const out = await tx(async (db) => {
    const cur = (await db.query('select * from wiki_pages where id=$1 for update', [id])).rows[0]; if (!cur) throw new HttpError(404, 'page not found');
    if (cur.version !== b.base_version) {
      const by = (await db.query('select name from users where id=$1', [cur.updated_by])).rows[0]?.name ?? 'Someone';
      throw new HttpError(409, `${by} saved this page while you were editing. Your text is still in the editor; load theirs or keep yours.`);
    }
    const body = d ? d.text : b.body;
    const set: Record<string, unknown> = { version: cur.version + 1, updated_by: c.user!.id };
    if (b.title !== undefined) set.title = b.title;
    if (body !== undefined) set.body = body;
    if (d) set.content = d.doc;
    for (const k of ['icon', 'description', 'category_id', 'parent_id'] as const) if (b[k] !== undefined) set[k] = b[k];
    const keys = Object.keys(set);
    const r = (await db.query(`update wiki_pages set ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')} where id=$1 returning *`, [id, ...keys.map((k) => set[k])])).rows[0];
    // history: a snapshot when someone else saved last, ten minutes have passed, or the save is not from the editor's autosave
    const last = (await db.query('select author_id, created_at, title from wiki_revisions where page_id=$1 order by version desc limit 1', [id])).rows[0];
    const snap = !d || !last || last.author_id !== c.user!.id || Date.now() - new Date(last.created_at).getTime() > 10 * 60_000;
    if (snap) await db.query('insert into wiki_revisions(page_id,version,title,body,content,author_id) values($1,$2,$3,$4,$5,$6)', [id, r.version, r.title, r.body, r.content, c.user!.id]);
    return { r, snap, from: last?.title as string | undefined, before: d && cur.content ? clean(cur.content).people : [] };
  });
  if (out.snap && out.from && out.from !== out.r.title) await wikiAct(c, id, 'renamed', { title: out.r.title, from: out.from });
  else if (out.snap) await wikiAct(c, id, 'edited', { title: out.r.title });
  if (d) await mentioned(d.people, out.before, c, out.r.title, out.r.slug);
  return { id, slug: out.r.slug, version: out.r.version, title: out.r.title, updated_at: out.r.updated_at };
});
route('DELETE', '/api/wiki/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'page');
  const p = await one('select created_by, title from wiki_pages where id=$1', [id]); if (!p) throw new HttpError(404, 'page not found');
  if (c.user!.role !== 'admin' && p.created_by !== c.user!.id) throw new HttpError(403, 'Only an admin or the person who started the page can delete it.');
  await q('delete from wiki_pages where id=$1', [id]);
  await wikiAct(c, id, 'deleted', { title: p.title });
  return { deleted: true };
});
route('GET', '/api/wiki/:id/revisions', 'user', async (c) => q(`select r.version, r.title, r.created_at, u.name author_name, length(r.body) chars from wiki_revisions r left join users u on u.id=r.author_id where r.page_id=$1 order by r.version desc`, [needUuid(c.params.id, 'page')]));
route('GET', '/api/wiki/:id/revisions/:version', 'user', async (c) => {
  const r = await one(`select r.version, r.title, r.body, r.content, r.created_at, u.name author_name from wiki_revisions r left join users u on u.id=r.author_id where r.page_id=$1 and r.version=$2`, [needUuid(c.params.id, 'page'), Number(c.params.version) || 0]);
  if (!r) throw new HttpError(404, 'revision not found'); return r;
});
