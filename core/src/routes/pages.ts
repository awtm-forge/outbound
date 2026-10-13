// Project notes: a tree of pages per project. Content is the editor's JSON document, checked and cleaned here before it
// is stored; links to other pages and to tasks are read out of it on every save, for backlinks. Saves carry the version
// they were based on, so two people editing at once never silently overwrite each other.
import { route } from '../lib/http.ts';
import { q, one, tx, type Row } from '../lib/db.ts';
import { HttpError } from '../pipeline.ts';
import { parse, z, uuid, text, needUuid, isUuid } from '../lib/validate.ts';
import { act, needProject, mentions } from './projects.ts';

const NODES = new Set(['doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote', 'codeBlock', 'horizontalRule', 'hardBreak',
  'image', 'table', 'tableRow', 'tableHeader', 'tableCell', 'details', 'detailsSummary', 'detailsContent', 'callout', 'pageRef', 'taskRef', 'mention', 'bookmark', 'fileAttachment', 'toc', 'mathBlock', 'mathInline']);
const MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'link', 'highlight', 'textStyle', 'subscript', 'superscript']);
const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/))/i;
const FILE_SRC = /^\/api\/files\/[0-9a-f-]{36}\/content$/i;
const COLOR = /^(#[0-9a-f]{3,8}|var\(--[a-z0-9-]+\))$/i;
export const EMPTY_DOC = { type: 'doc', content: [] };

// Keeps only the nodes and marks the editor knows, with safe links and image sources, and gathers what the page refers to.
export function clean(doc: any) {
  const text: string[] = []; const pages = new Set<string>(); const tasks = new Set<string>(); let count = 0;
  const walk = (n: any, depth: number): any => {
    if (!n || typeof n !== 'object' || typeof n.type !== 'string' || !NODES.has(n.type) || depth > 60 || ++count > 50_000) return null;
    const out: any = { type: n.type };
    if (n.attrs && typeof n.attrs === 'object') {
      const a: Row = {};
      for (const [k, v] of Object.entries(n.attrs)) if (/^[a-zA-Z]{1,30}$/.test(k) && (v === null || ['string', 'number', 'boolean'].includes(typeof v))) a[k] = typeof v === 'string' ? v.slice(0, 2000) : v;
      if (n.type === 'image' && !(typeof a.src === 'string' && (FILE_SRC.test(a.src) || /^https:\/\//i.test(a.src)))) return null;
      if (n.type === 'bookmark' && !(typeof a.url === 'string' && /^https?:\/\//i.test(a.url))) return null;
      if ((n.type === 'pageRef' || n.type === 'taskRef' || n.type === 'fileAttachment') && !(typeof a.id === 'string' && isUuid(a.id))) return null;
      if (n.type === 'pageRef') pages.add(a.id); if (n.type === 'taskRef') tasks.add(a.id);
      out.attrs = a;
    }
    if (n.type === 'text') { if (typeof n.text !== 'string' || !n.text) return null; out.text = n.text.slice(0, 20_000); text.push(out.text); }
    if (Array.isArray(n.marks)) {
      const marks = n.marks.filter((m: any) => m && MARKS.has(m.type)).map((m: any) => {
        if (m.type === 'link') { const href = String(m.attrs?.href ?? ''); if (!SAFE_URL.test(href)) return null; const pm = href.match(/\/projects\/[0-9a-f-]{36}\/notes\/([0-9a-f-]{36})/i); if (pm) pages.add(pm[1]!); return { type: 'link', attrs: { href: href.slice(0, 2000), target: /^https?:/i.test(href) ? '_blank' : null } }; }
        if (m.type === 'highlight' || m.type === 'textStyle') { const color = String(m.attrs?.color ?? ''); return COLOR.test(color) ? { type: m.type, attrs: { color } } : m.type === 'highlight' ? { type: 'highlight' } : null; }
        return { type: m.type };
      }).filter(Boolean);
      if (marks.length) out.marks = marks;
    }
    if (Array.isArray(n.content)) { out.content = n.content.map((x: any) => walk(x, depth + 1)).filter(Boolean); if (['paragraph', 'heading', 'listItem', 'taskItem'].includes(n.type) || n.type.startsWith('table')) text.push('\n'); }
    if (n.type === 'mathBlock' || n.type === 'mathInline' || n.type === 'bookmark' || n.type === 'pageRef' || n.type === 'taskRef') text.push(String(out.attrs?.latex ?? out.attrs?.title ?? out.attrs?.url ?? ''));
    return out;
  };
  const d = walk(doc, 0);
  if (!d || d.type !== 'doc') throw new HttpError(400, 'That is not a page document.');
  return { doc: d, text: text.join(' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, 200_000), pages: [...pages], tasks: [...tasks] };
}
async function needPage(id: string) { const p = await one('select * from pages where id=$1', [needUuid(id, 'page')]); if (!p) throw new HttpError(404, 'page not found'); return p; }
async function relink(pageId: string, projectId: string, pages: string[], tasks: string[]) {
  await q('delete from page_links where from_page=$1', [pageId]); await q('delete from page_task_refs where page_id=$1', [pageId]);
  // only references within the same project count
  if (pages.length) await q('insert into page_links(from_page,to_page) select $1, id from pages where id = any($2) and project_id=$3 and id<>$1 on conflict do nothing', [pageId, pages, projectId]);
  if (tasks.length) await q('insert into page_task_refs(page_id,task_id) select $1, id from tasks where id = any($2) and project_id=$3 on conflict do nothing', [pageId, tasks, projectId]);
}

const PageIn = z.object({ title: text(200).optional(), icon: z.string().max(16).nullable().optional(), parent_id: uuid.nullable().optional(), content: z.any().optional() });
route('GET', '/api/projects/:id/pages', 'user', async (c) => {
  const p = await needProject(c.params.id); const archived = c.url.searchParams.get('archived') === '1';
  return q(`select g.id, g.parent_id, g.title, g.icon, g.position, g.archived_at, g.updated_at, g.created_by, u.name updated_by_name, (s.user_id is not null) starred
    from pages g left join users u on u.id=g.updated_by left join page_stars s on s.page_id=g.id and s.user_id=$2
    where g.project_id=$1 and (g.archived_at is null) = not $3 order by g.position, g.created_at`, [p.id, c.user!.id, archived]);
});
route('POST', '/api/projects/:id/pages', 'user', async (c) => {
  const p = await needProject(c.params.id); const b = parse(PageIn, c.body);
  if (b.parent_id && !(await one('select 1 from pages where id=$1 and project_id=$2', [b.parent_id, p.id]))) throw new HttpError(400, 'The parent page is not in this project.');
  const body = b.content ? clean(b.content) : { doc: EMPTY_DOC, text: '', pages: [], tasks: [] };
  if (JSON.stringify(body.doc).length > 1_500_000) throw new HttpError(413, 'That page is too large.');
  const g = await tx(async (db) => {
    const g = (await db.query(`insert into pages(project_id,parent_id,title,icon,content,text_content,position,created_by,updated_by)
      values($1,$2,$3,$4,$5,$6,(select coalesce(max(position),0)+1 from pages where project_id=$1 and parent_id is not distinct from $2),$7,$7) returning *`,
      [p.id, b.parent_id ?? null, b.title ?? '', b.icon ?? null, body.doc, body.text, c.user!.id])).rows[0];
    await db.query('insert into page_revisions(page_id,version,title,content,author_id) values($1,1,$2,$3,$4)', [g.id, g.title, g.content, c.user!.id]);
    return g;
  });
  await relink(g.id, p.id, body.pages, body.tasks);
  await act(p.id, c, 'page_created', { page_id: g.id, title: g.title || 'Untitled' });
  return { created: true, ...g };
});
route('GET', '/api/pages/:id', 'user', async (c) => {
  const g = await needPage(c.params.id);
  const [crumbs, children, backlinks, task_refs, who, star, comments] = await Promise.all([
    q(`with recursive up(id, parent_id, title, icon, d) as (select id, parent_id, title, icon, 0 from pages where id=$1 union all select p.id, p.parent_id, p.title, p.icon, up.d+1 from pages p join up on p.id=up.parent_id where up.d < 50)
      select id, title, icon from up where id<>$1 order by d desc`, [g.id]),
    q('select id, title, icon from pages where parent_id=$1 and archived_at is null order by position, created_at', [g.id]),
    q('select p.id, p.title, p.icon from page_links l join pages p on p.id=l.from_page where l.to_page=$1 and p.archived_at is null order by p.title', [g.id]),
    q('select t.id, t.title, t.status from page_task_refs r join tasks t on t.id=r.task_id where r.page_id=$1 order by t.title', [g.id]),
    one('select a.name created_by_name, b.name updated_by_name from pages g left join users a on a.id=g.created_by left join users b on b.id=g.updated_by where g.id=$1', [g.id]),
    one('select 1 from page_stars where page_id=$1 and user_id=$2', [g.id, c.user!.id]),
    one('select count(*)::int n from page_comments where page_id=$1', [g.id]),
  ]);
  return { ...g, search: undefined, breadcrumbs: crumbs, children, backlinks, task_refs, ...who, starred: !!star, comments: comments!.n };
});
// a save: title, icon and content, based on the version the editor loaded
route('PUT', '/api/pages/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'page');
  const b = parse(PageIn.omit({ parent_id: true }).extend({ base_version: z.number().int().min(1) }), c.body);
  const body = b.content !== undefined ? clean(b.content) : null;
  if (body && JSON.stringify(body.doc).length > 1_500_000) throw new HttpError(413, 'That page is too large to save. Split it into smaller pages.');
  const out = await tx(async (db) => {
    const cur = (await db.query('select * from pages where id=$1 for update', [id])).rows[0]; if (!cur) throw new HttpError(404, 'page not found');
    if (cur.version !== b.base_version) {
      const by = (await db.query('select name from users where id=$1', [cur.updated_by])).rows[0]?.name ?? 'someone';
      throw new HttpError(409, `${by} saved a newer version of this page while you were editing. Your changes are kept on screen; reload to see theirs.`);
    }
    const g = (await db.query(`update pages set title=coalesce($2,title), icon=case when $3::boolean then $4 else icon end, content=coalesce($5,content), text_content=coalesce($6,text_content),
      version=version+1, updated_by=$7 where id=$1 returning *`, [id, b.title ?? null, b.icon !== undefined, b.icon ?? null, body?.doc ?? null, body?.text ?? null, c.user!.id])).rows[0];
    // history: a snapshot when someone else last saved, or ten minutes have passed since the last one
    const last = (await db.query('select author_id, created_at from page_revisions where page_id=$1 order by version desc limit 1', [id])).rows[0];
    const snap = !last || last.author_id !== c.user!.id || Date.now() - new Date(last.created_at).getTime() > 10 * 60_000;
    if (snap) await db.query('insert into page_revisions(page_id,version,title,content,author_id) values($1,$2,$3,$4,$5)', [id, g.version, g.title, g.content, c.user!.id]);
    return { g, snap };
  });
  if (body) await relink(id, out.g.project_id, body.pages, body.tasks);
  if (out.snap) await act(out.g.project_id, c, 'page_edited', { page_id: id, title: out.g.title || 'Untitled' });
  return { id, version: out.g.version, title: out.g.title, icon: out.g.icon, updated_at: out.g.updated_at };
});
// move (new parent, new place among siblings), archive and restore, star
route('PATCH', '/api/pages/:id', 'user', async (c) => {
  const g = await needPage(c.params.id);
  const b = parse(z.object({ parent_id: uuid.nullable().optional(), position: z.number().finite().optional(), archived: z.boolean().optional(), starred: z.boolean().optional() }), c.body);
  if (b.parent_id) {
    if (!(await one('select 1 from pages where id=$1 and project_id=$2', [b.parent_id, g.project_id]))) throw new HttpError(400, 'The new parent is not in this project.');
    const loop = await one(`with recursive up(id, parent_id) as (select id, parent_id from pages where id=$1 union select p.id, p.parent_id from pages p join up on p.id=up.parent_id) select 1 from up where id=$2`, [b.parent_id, g.id]);
    if (loop) throw new HttpError(409, 'A page cannot go inside itself or one of its own pages.');
  }
  if (b.parent_id !== undefined || b.position !== undefined) {
    await q('update pages set parent_id=$2, position=coalesce($3, (select coalesce(max(position),0)+1 from pages where project_id=$4 and parent_id is not distinct from $2)) where id=$1',
      [g.id, b.parent_id === undefined ? g.parent_id : b.parent_id, b.position ?? null, g.project_id]);
    if (b.parent_id !== undefined && b.parent_id !== g.parent_id) await act(g.project_id, c, 'page_moved', { page_id: g.id, title: g.title || 'Untitled' });
  }
  if (b.archived !== undefined) {
    await q('update pages set archived_at=$2 where id=$1', [g.id, b.archived ? new Date() : null]);
    await act(g.project_id, c, b.archived ? 'page_archived' : 'page_restored', { page_id: g.id, title: g.title || 'Untitled' });
  }
  if (b.starred !== undefined) await q(b.starred ? 'insert into page_stars(page_id,user_id) values($1,$2) on conflict do nothing' : 'delete from page_stars where page_id=$1 and user_id=$2', [g.id, c.user!.id]);
  return { ok: true };
});
route('POST', '/api/pages/:id/duplicate', 'user', async (c) => {
  const g = await needPage(c.params.id);
  const d = (await one(`insert into pages(project_id,parent_id,title,icon,content,text_content,position,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$8) returning *`,
    [g.project_id, g.parent_id, `${g.title || 'Untitled'} (copy)`, g.icon, g.content, g.text_content, g.position + 0.5, c.user!.id]))!;
  await q('insert into page_revisions(page_id,version,title,content,author_id) values($1,1,$2,$3,$4)', [d.id, d.title, d.content, c.user!.id]);
  await q('insert into page_links(from_page,to_page) select $1, to_page from page_links where from_page=$2 on conflict do nothing', [d.id, g.id]);
  await q('insert into page_task_refs(page_id,task_id) select $1, task_id from page_task_refs where page_id=$2 on conflict do nothing', [d.id, g.id]);
  await act(g.project_id, c, 'page_created', { page_id: d.id, title: d.title });
  return { created: true, ...d };
});
// for good, with every page inside it: the person who made it, or an admin
route('DELETE', '/api/pages/:id', 'user', async (c) => {
  const g = await needPage(c.params.id);
  if (c.user!.role !== 'admin' && g.created_by !== c.user!.id) throw new HttpError(403, 'Only the person who made this page, or an admin, can delete it. You can archive it instead.');
  const n = (await one(`with recursive down(id) as (select $1::uuid union select p.id from pages p join down on p.parent_id=down.id) select count(*)::int n from down`, [g.id]))!.n;
  await q('delete from pages where id=$1', [g.id]);
  await act(g.project_id, c, 'page_deleted', { title: g.title || 'Untitled', pages: n });
  return { deleted: n };
});
route('GET', '/api/pages/:id/revisions', 'user', async (c) => q(`select r.version, r.title, r.created_at, u.name author_name from page_revisions r left join users u on u.id=r.author_id where r.page_id=$1 order by r.version desc limit 100`, [(await needPage(c.params.id)).id]));
route('GET', '/api/pages/:id/revisions/:v', 'user', async (c) => {
  const r = await one('select r.*, u.name author_name from page_revisions r left join users u on u.id=r.author_id where r.page_id=$1 and r.version=$2', [needUuid(c.params.id, 'page'), Number(c.params.v) || 0]);
  if (!r) throw new HttpError(404, 'revision not found'); return r;
});
route('GET', '/api/pages/:id/comments', 'user', async (c) => q('select k.id, k.body, k.created_at, k.author_id, u.name author_name from page_comments k left join users u on u.id=k.author_id where k.page_id=$1 order by k.created_at', [(await needPage(c.params.id)).id]));
route('POST', '/api/pages/:id/comments', 'user', async (c) => {
  const g = await needPage(c.params.id); const b = parse(z.object({ body: text(5000).min(1) }), c.body);
  const k = (await one('insert into page_comments(page_id,author_id,body) values($1,$2,$3) returning id, body, created_at, author_id', [g.id, c.user!.id, b.body]))!;
  await act(g.project_id, c, 'page_comment', { page_id: g.id, title: g.title || 'Untitled', excerpt: b.body.slice(0, 140) });
  await mentions(b.body, c, `${c.user!.name} mentioned you on the page “${g.title || 'Untitled'}”`, `/projects/${g.project_id}/notes/${g.id}`);
  return { created: true, ...k, author_name: c.user!.name };
});
route('DELETE', '/api/page-comments/:id', 'user', async (c) => {
  const k = await one('delete from page_comments where id=$1 and (author_id=$2 or $3) returning id', [needUuid(c.params.id, 'comment'), c.user!.id, c.user!.role === 'admin']);
  if (!k) throw new HttpError(403, 'Only the person who wrote a comment, or an admin, can delete it.');
  return { deleted: true };
});
