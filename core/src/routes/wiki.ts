// Workspace: the wiki. Signed-in people read and write every page; deleting is for admins and the page's author.
import { route } from '../lib/http.ts';
import { q, one, tx } from '../lib/db.ts';
import { HttpError } from '../pipeline.ts';
import { parse, z, uuid, text, needUuid } from '../lib/validate.ts';

// Same rule as the app's slugify (web/src/ui/markdown.tsx), so a [[Wiki link]] finds the page it names.
export const slugify = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '') || 'page';
const HL_START = '\u0001', HL_STOP = '\u0002'; // search highlight markers: never typed by a person, so never confused with page text

const PageIn = z.object({ title: text(160).min(1), body: text(200_000).default(''), parent_id: uuid.nullable().optional() });
const PAGE = `select w.id, w.slug, w.title, w.body, w.parent_id, w.version, w.created_at, w.updated_at, w.created_by, cu.name created_by_name, uu.name updated_by_name,
    pp.slug parent_slug, pp.title parent_title
  from wiki_pages w left join users cu on cu.id=w.created_by left join users uu on uu.id=w.updated_by left join wiki_pages pp on pp.id=w.parent_id`;

async function checkParent(id: string | null, parent: string | null | undefined) {
  if (!parent) return;
  if (id && parent === id) throw new HttpError(400, 'A page cannot sit inside itself.');
  if (!(await one('select 1 from wiki_pages where id=$1', [parent]))) throw new HttpError(400, 'That parent page does not exist.');
  // the new parent must not be one of this page's own descendants
  if (id && await one(`with recursive up as (select id, parent_id from wiki_pages where id=$1 union all select w.id, w.parent_id from wiki_pages w join up on w.id=up.parent_id) select 1 from up where id=$2`, [parent, id]))
    throw new HttpError(400, 'A page cannot sit inside one of its own sub-pages.');
}

route('GET', '/api/wiki', 'user', async (c) => {
  const term = (c.url.searchParams.get('q') ?? '').trim().slice(0, 200);
  if (!term) return q(`select w.id, w.slug, w.title, w.parent_id, w.updated_at, u.name updated_by_name from wiki_pages w left join users u on u.id=w.updated_by order by lower(w.title)`);
  const like = '%' + term.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
  return q(`select w.id, w.slug, w.title, w.parent_id, w.updated_at, u.name updated_by_name,
      ts_headline('simple', w.body, websearch_to_tsquery('simple', $1), 'StartSel=${HL_START}, StopSel=${HL_STOP}, MaxWords=28, MinWords=12, MaxFragments=1') snippet
    from wiki_pages w left join users u on u.id=w.updated_by
    where w.search @@ websearch_to_tsquery('simple', $1) or w.title ilike $2
    order by (w.title ilike $2) desc, ts_rank(w.search, websearch_to_tsquery('simple', $1)) desc, w.updated_at desc limit 50`, [term, like]);
});
route('GET', '/api/wiki/:slug', 'user', async (c) => {
  const p = await one(`${PAGE} where w.slug=$1`, [c.params.slug]); if (!p) throw new HttpError(404, 'page not found');
  const children = await q('select id, slug, title from wiki_pages where parent_id=$1 order by lower(title)', [p.id]);
  return { ...p, children };
});
route('POST', '/api/wiki', 'user', async (c) => {
  const b = parse(PageIn, c.body); await checkParent(null, b.parent_id);
  return tx(async (db) => {
    // a title that is already a slug gets -2, -3 ... ; the slug never changes after this
    const base = slugify(b.title); const taken = new Set((await db.query(`select slug from wiki_pages where slug = $1 or slug ~ ('^' || $1 || '-[0-9]+$')`, [base])).rows.map((r) => r.slug));
    let slug = base; for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
    const p = (await db.query(`insert into wiki_pages(slug,title,body,parent_id,created_by,updated_by) values($1,$2,$3,$4,$5,$5) returning id, slug, version`, [slug, b.title, b.body, b.parent_id ?? null, c.user!.id])).rows[0];
    await db.query('insert into wiki_revisions(page_id,version,title,body,author_id) values($1,1,$2,$3,$4)', [p.id, b.title, b.body, c.user!.id]);
    return { created: true, ...p };
  });
});
route('PUT', '/api/wiki/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'page');
  const b = parse(PageIn.extend({ base_version: z.number().int().positive() }), c.body); await checkParent(id, b.parent_id);
  return tx(async (db) => {
    const r = (await db.query(`update wiki_pages set title=$3, body=$4, parent_id=$5, version=version+1, updated_by=$6 where id=$1 and version=$2 returning id, slug, version`,
      [id, b.base_version, b.title, b.body, b.parent_id ?? null, c.user!.id])).rows[0];
    if (!r) {
      const now = (await db.query(`select u.name updated_by_name from wiki_pages w left join users u on u.id=w.updated_by where w.id=$1`, [id])).rows[0];
      if (!now) throw new HttpError(404, 'page not found');
      throw new HttpError(409, `${now.updated_by_name ?? 'Someone'} saved this page while you were editing. Your text is still in the editor; copy what you need, reload, and merge.`);
    }
    await db.query('insert into wiki_revisions(page_id,version,title,body,author_id) values($1,$2,$3,$4,$5)', [id, r.version, b.title, b.body, c.user!.id]);
    return r;
  });
});
route('DELETE', '/api/wiki/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'page');
  const p = await one('select created_by from wiki_pages where id=$1', [id]); if (!p) throw new HttpError(404, 'page not found');
  if (c.user!.role !== 'admin' && p.created_by !== c.user!.id) throw new HttpError(403, 'Only an admin or the person who started the page can delete it.');
  await q('delete from wiki_pages where id=$1', [id]);
  return { deleted: true };
});
route('GET', '/api/wiki/:id/revisions', 'user', async (c) => q(`select r.version, r.title, r.created_at, u.name author_name, length(r.body) chars from wiki_revisions r left join users u on u.id=r.author_id where r.page_id=$1 order by r.version desc`, [needUuid(c.params.id, 'page')]));
route('GET', '/api/wiki/:id/revisions/:version', 'user', async (c) => {
  const r = await one(`select r.version, r.title, r.body, r.created_at, u.name author_name from wiki_revisions r left join users u on u.id=r.author_id where r.page_id=$1 and r.version=$2`, [needUuid(c.params.id, 'page'), Number(c.params.version) || 0]);
  if (!r) throw new HttpError(404, 'revision not found'); return r;
});
