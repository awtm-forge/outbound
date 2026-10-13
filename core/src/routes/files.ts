// Project files. The bytes arrive as the request body (the browser sends the file as is, with its type), are checked
// for size and type, and are stored apart from the list. Downloads are only for signed-in people, and anything that
// could run in a browser (HTML, SVG, scripts) is only ever sent as a download, never shown inline.
import { route, type Ctx } from '../lib/http.ts';
import { q, one, tx, audit } from '../lib/db.ts';
import { HttpError } from '../pipeline.ts';
import { parse, z, text, needUuid, isUuid } from '../lib/validate.ts';
import { act, needProject } from './projects.ts';
import { env } from '../lib/env.ts';
import { mentions } from './projects.ts';

export const MAX_FILE = 10_000_000;
const ALLOWED: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'application/pdf': 'pdf',
  'text/plain': 'txt', 'text/csv': 'csv', 'text/markdown': 'md', 'application/json': 'json', 'application/zip': 'zip', 'video/mp4': 'mp4',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/octet-stream': '',
};
// shown in the browser; everything else downloads
const INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'video/mp4']);
// what the first bytes say the file is, so a renamed program cannot pass as a picture
const MAGIC: [string, number[]][] = [['image/png', [0x89, 0x50, 0x4e, 0x47]], ['image/jpeg', [0xff, 0xd8, 0xff]], ['image/gif', [0x47, 0x49, 0x46]], ['application/pdf', [0x25, 0x50, 0x44, 0x46]]];
export const safeName = (s: string) => s.replace(/[\u0000-\u001f\u007f/\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'file';

// the uploaded bytes, checked: allowed type, signature matching the type, a clean name
export function readUpload(c: Ctx) {
  const data: Buffer = c.body;
  if (!Buffer.isBuffer(data) || !data.length) throw new HttpError(400, 'The file is empty.');
  const mime = String(c.req.headers['content-type'] ?? 'application/octet-stream').split(';')[0]!.trim().toLowerCase();
  if (!(mime in ALLOWED)) throw new HttpError(415, 'That kind of file cannot be uploaded here. Images, PDFs, documents, spreadsheets, text and zip files can.');
  const magic = MAGIC.find(([m]) => m === mime); if (magic && !magic[1].every((b, i) => data[i] === b)) throw new HttpError(415, 'The file does not match its type.');
  return { data, mime, name: safeName(c.url.searchParams.get('name') ?? 'file') };
}
export function storeFile(owner: { project_id?: string | null; task_id?: string | null; page_id?: string | null; wiki_page_id?: string | null; employee_id?: string | null; folder_id?: string | null }, up: ReturnType<typeof readUpload>, userId: string) {
  return tx(async (db) => {
    const f = (await db.query('insert into project_files(project_id,task_id,page_id,wiki_page_id,employee_id,folder_id,name,mime,size,uploaded_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *',
      [owner.project_id ?? null, owner.task_id ?? null, owner.page_id ?? null, owner.wiki_page_id ?? null, owner.employee_id ?? null, owner.folder_id ?? null, up.name, up.mime, up.data.length, userId])).rows[0];
    await db.query('insert into file_blobs(file_id,data) values($1,$2)', [f.id, up.data]);
    return f;
  });
}
route('POST', '/api/projects/:id/files', 'user', async (c) => {
  const p = await needProject(c.params.id); const up = readUpload(c); const name = up.name;
  const sp = c.url.searchParams; const taskId = sp.get('task_id'); const pageId = sp.get('page_id');
  if (taskId && !(isUuid(taskId) && await one('select 1 from tasks where id=$1 and project_id=$2', [taskId, p.id]))) throw new HttpError(400, 'That task is not on this project.');
  if (pageId && !(isUuid(pageId) && await one('select 1 from pages where id=$1 and project_id=$2', [pageId, p.id]))) throw new HttpError(400, 'That page is not in this project.');
  const folderId = sp.get('folder_id');
  if (folderId && !(isUuid(folderId) && await one('select 1 from project_folders where id=$1 and project_id=$2', [folderId, p.id]))) throw new HttpError(400, 'That folder is not in this project.');
  await checkQuota(p.id, up.data.length);
  // the same name in the same folder gets " (2)", " (3)" ... unless the person asked to keep both under one name
  up.name = await freeName(p.id, folderId || null, up.name);
  const f = await storeFile({ project_id: p.id, task_id: taskId || null, page_id: pageId || null, folder_id: folderId || null }, up, c.user!.id);
  await act(p.id, c, 'file_uploaded', { file_id: f.id, name: up.name, task_id: taskId || null, title: up.name, size: up.data.length, mime: up.mime });
  return { created: true, ...f, uploaded_by_name: c.user!.name, renamed: up.name !== name ? up.name : null };
}, { raw: MAX_FILE });
route('GET', '/api/projects/:id/files', 'user', async (c) => {
  const p = await needProject(c.params.id); const sp = c.url.searchParams; const term = (sp.get('q') ?? '').trim().slice(0, 100);
  return q(`select f.id, f.name, f.mime, f.size, f.task_id, f.page_id, f.folder_id, f.description, f.version, f.created_at, f.updated_at, f.uploaded_by, u.name uploaded_by_name, t.title task_title, g.title page_title
    from project_files f left join users u on u.id=f.uploaded_by left join tasks t on t.id=f.task_id left join pages g on g.id=f.page_id
    where f.project_id=$1 and ($2 = '' or f.name ilike '%' || $2 || '%') order by f.updated_at desc limit 2000`, [p.id, term.replace(/[\\%_]/g, (m) => '\\' + m)]);
});
route('GET', '/api/files/:id/content', 'user', async (c) => {
  const f = await one('select f.name, f.mime, f.size, f.project_id, b.data from project_files f join file_blobs b on b.file_id=f.id where f.id=$1', [needUuid(c.params.id, 'file')]);
  if (!f) throw new HttpError(404, 'file not found');
  const inline = INLINE.has(f.mime) && c.url.searchParams.get('download') !== '1';
  if (!inline && f.project_id) await act(f.project_id, c, 'file_downloaded', { file_id: c.params.id, name: f.name, title: f.name });
  c.res.writeHead(200, {
    'content-type': inline ? f.mime : 'application/octet-stream', 'content-length': String(f.data.length),
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=3600', 'referrer-policy': 'no-referrer',
    // sandboxed so nothing in a file can act as the app; the browser's PDF viewer cannot run sandboxed, and a PDF cannot reach the app's cookies or pages
    'content-security-policy': `default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'${f.mime === 'application/pdf' && inline ? '' : '; sandbox'}`,
  });
  c.res.end(f.data);
});
route('PATCH', '/api/files/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'file');
  const b = parse(z.object({ name: text(200).min(1).optional(), task_id: z.string().uuid().nullable().optional(), page_id: z.string().uuid().nullable().optional(), folder_id: z.string().uuid().nullable().optional(), description: z.string().max(2000).optional() }), c.body);
  const f = await one('select * from project_files where id=$1', [id]); if (!f) throw new HttpError(404, 'file not found');
  if (b.task_id && !(await one('select 1 from tasks where id=$1 and project_id=$2', [b.task_id, f.project_id]))) throw new HttpError(400, 'That task is not on this project.');
  if (b.page_id && !(await one('select 1 from pages where id=$1 and project_id=$2', [b.page_id, f.project_id]))) throw new HttpError(400, 'That page is not in this project.');
  if (b.folder_id && !(await one('select 1 from project_folders where id=$1 and project_id=$2', [b.folder_id, f.project_id]))) throw new HttpError(400, 'That folder is not in this project.');
  const set: Record<string, unknown> = {};
  if (b.name) set.name = safeName(b.name);
  for (const k of ['task_id', 'page_id', 'folder_id', 'description'] as const) if (b[k] !== undefined) set[k] = b[k];
  const keys = Object.keys(set); if (!keys.length) return f;
  const n = await one(`update project_files set ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() where id=$1 returning *`, [id, ...keys.map((k) => set[k])]);
  if (b.name && n!.name !== f.name) await act(f.project_id, c, 'file_renamed', { file_id: id, from: f.name, to: n!.name, title: n!.name });
  if (b.folder_id !== undefined && b.folder_id !== f.folder_id) { const fo = b.folder_id ? await one('select name from project_folders where id=$1', [b.folder_id]) : null; await act(f.project_id, c, 'file_moved', { file_id: id, title: n!.name, to: fo?.name ?? 'Project files' }); }
  return n;
});
route('DELETE', '/api/files/:id', 'user', async (c) => {
  const f = await one('select * from project_files where id=$1', [needUuid(c.params.id, 'file')]); if (!f) throw new HttpError(404, 'file not found');
  if (c.user!.role !== 'admin' && f.uploaded_by !== c.user!.id) throw new HttpError(403, 'Only the person who uploaded this file, or an admin, can delete it.');
  await q('delete from project_files where id=$1', [f.id]);
  await act(f.project_id, c, 'file_removed', { name: f.name, title: f.name });
  if (f.wiki_page_id) await audit('wiki', f.wiki_page_id, 'file_removed', c.actor, { name: f.name, user_id: c.user?.id ?? null });
  return { deleted: true };
});

// ---------- helpers: free names, storage use ----------
export async function freeName(projectId: string, folderId: string | null, name: string) {
  const taken = new Set((await q('select lower(name) n from project_files where project_id=$1 and folder_id is not distinct from $2', [projectId, folderId])).map((r) => r.n));
  if (!taken.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.'); const stem = dot > 0 ? name.slice(0, dot) : name; const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; i < 1000; i++) { const n = `${stem} (${i})${ext}`.slice(-200); if (!taken.has(n.toLowerCase())) return n; }
  return `${stem} ${Date.now()}${ext}`;
}
export async function usage(projectId: string) {
  return Number((await one(`select coalesce((select sum(size) from project_files where project_id=$1),0) + coalesce((select sum(v.size) from file_versions v join project_files f on f.id=v.file_id where f.project_id=$1),0) n`, [projectId]))!.n);
}
async function checkQuota(projectId: string, adding: number) {
  if (!env.projectStorageLimitMb) return;
  const limit = env.projectStorageLimitMb * 1_000_000; const used = await usage(projectId);
  if (used + adding > limit) throw new HttpError(413, `This project has used ${Math.round(used / 1e6)} MB of its ${env.projectStorageLimitMb} MB. Delete old files or versions to make room.`);
}
route('GET', '/api/projects/:id/files/usage', 'user', async (c) => {
  const p = await needProject(c.params.id);
  const n = await one('select count(*)::int files from project_files where project_id=$1', [p.id]);
  return { used: await usage(p.id), limit: env.projectStorageLimitMb ? env.projectStorageLimitMb * 1_000_000 : null, max_file: MAX_FILE, files: n!.files };
});

// ---------- folders ----------
const HEXC = z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/).transform((v) => '#' + v.replace('#', '').toUpperCase());
route('GET', '/api/projects/:id/folders', 'user', async (c) => {
  const p = await needProject(c.params.id);
  return q(`select fo.*, (select count(*)::int from project_files f where f.folder_id=fo.id) files, (select coalesce(sum(size),0)::bigint::text from project_files f where f.folder_id=fo.id) size
    from project_folders fo where fo.project_id=$1 order by fo.position, lower(fo.name)`, [p.id]);
});
route('POST', '/api/projects/:id/folders', 'user', async (c) => {
  const p = await needProject(c.params.id); const b = parse(z.object({ name: text(120).min(1), color: HEXC.nullable().optional(), parent_id: z.string().uuid().nullable().optional() }), c.body);
  if (b.parent_id && !(await one('select 1 from project_folders where id=$1 and project_id=$2', [b.parent_id, p.id]))) throw new HttpError(400, 'That folder is not in this project.');
  if (await one('select 1 from project_folders where project_id=$1 and parent_id is not distinct from $2 and lower(name)=lower($3)', [p.id, b.parent_id ?? null, b.name])) throw new HttpError(409, `There is already a folder called ${b.name} here.`);
  const fo = (await one(`insert into project_folders(project_id,parent_id,name,color,position,created_by) values($1,$2,$3,$4,(select coalesce(max(position),0)+1 from project_folders where project_id=$1),$5) returning *`, [p.id, b.parent_id ?? null, b.name, b.color ?? null, c.user!.id]))!;
  await act(p.id, c, 'folder_added', { folder_id: fo.id, title: fo.name });
  return { created: true, ...fo, files: 0, size: '0' };
});
route('PATCH', '/api/folders/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'folder'); const b = parse(z.object({ name: text(120).min(1).optional(), color: HEXC.nullable().optional(), parent_id: z.string().uuid().nullable().optional(), position: z.number().finite().optional() }), c.body);
  const fo = await one('select * from project_folders where id=$1', [id]); if (!fo) throw new HttpError(404, 'folder not found');
  if (b.parent_id) {
    if (!(await one('select 1 from project_folders where id=$1 and project_id=$2', [b.parent_id, fo.project_id]))) throw new HttpError(400, 'That folder is not in this project.');
    if (await one(`with recursive up(id, parent_id) as (select id, parent_id from project_folders where id=$1 union select f.id, f.parent_id from project_folders f join up on f.id=up.parent_id) select 1 from up where id=$2`, [b.parent_id, id])) throw new HttpError(409, 'A folder cannot go inside itself or one of its own folders.');
  }
  const set: Record<string, unknown> = {}; for (const k of ['name', 'color', 'parent_id', 'position'] as const) if (b[k] !== undefined) set[k] = b[k];
  const keys = Object.keys(set); if (!keys.length) return fo;
  const parent = b.parent_id !== undefined ? b.parent_id : fo.parent_id; const name = b.name ?? fo.name;
  if ((b.name || b.parent_id !== undefined) && await one('select 1 from project_folders where project_id=$1 and parent_id is not distinct from $2 and lower(name)=lower($3) and id<>$4', [fo.project_id, parent, name, id])) throw new HttpError(409, `There is already a folder called ${name} there.`);
  const n = await one(`update project_folders set ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')} where id=$1 returning *`, [id, ...keys.map((k) => set[k])]);
  if (b.name && b.name !== fo.name) await act(fo.project_id, c, 'folder_renamed', { folder_id: id, from: fo.name, title: b.name });
  return n;
});
// a folder goes; what was in it moves up to its parent, so no file is lost
route('DELETE', '/api/folders/:id', 'user', async (c) => {
  const fo = await one('select * from project_folders where id=$1', [needUuid(c.params.id, 'folder')]); if (!fo) throw new HttpError(404, 'folder not found');
  const moved = await tx(async (db) => {
    const r = await db.query('update project_files set folder_id=$2 where folder_id=$1', [fo.id, fo.parent_id]);
    await db.query('update project_folders set parent_id=$2 where parent_id=$1', [fo.id, fo.parent_id]);
    await db.query('delete from project_folders where id=$1', [fo.id]);
    return r.rowCount ?? 0;
  });
  await act(fo.project_id, c, 'folder_removed', { title: fo.name, files: moved });
  return { deleted: true, moved };
});

// ---------- one file: details, versions, comments ----------
route('GET', '/api/files/:id', 'user', async (c) => {
  const f = await one(`select f.id, f.project_id, f.name, f.mime, f.size, f.task_id, f.page_id, f.folder_id, f.description, f.version, f.created_at, f.updated_at, f.uploaded_by, u.name uploaded_by_name,
      t.title task_title, g.title page_title, p.name project_name, p.color project_color, fo.name folder_name
    from project_files f left join users u on u.id=f.uploaded_by left join tasks t on t.id=f.task_id left join pages g on g.id=f.page_id left join projects p on p.id=f.project_id left join project_folders fo on fo.id=f.folder_id
    where f.id=$1`, [needUuid(c.params.id, 'file')]);
  if (!f) throw new HttpError(404, 'file not found');
  const [versions, comments, activity] = await Promise.all([
    q('select v.version, v.name, v.mime, v.size, v.created_at, u.name uploaded_by_name from file_versions v left join users u on u.id=v.uploaded_by where v.file_id=$1 order by v.version desc', [f.id]),
    q('select k.id, k.body, k.created_at, k.author_id, u.name author_name from file_comments k left join users u on u.id=k.author_id where k.file_id=$1 order by k.created_at', [f.id]),
    f.project_id ? q(`select a.action, a.detail, a.created_at, u.name actor_name from activities a left join users u on u.id=(a.detail->>'user_id')::uuid where a.entity_type='project' and a.entity_id=$1 and a.detail->>'file_id'=$2 order by a.created_at desc limit 30`, [f.project_id, f.id]) : [],
  ]);
  return { ...f, versions, comments, activity };
});
// a new version of the same file: the current bytes are kept as the previous version
route('POST', '/api/files/:id/replace', 'user', async (c) => {
  const f = await one('select * from project_files where id=$1', [needUuid(c.params.id, 'file')]); if (!f) throw new HttpError(404, 'file not found');
  if (!f.project_id) throw new HttpError(400, 'Only project files have versions.');
  const up = readUpload(c); await checkQuota(f.project_id, up.data.length);
  const n = await tx(async (db) => {
    await db.query(`insert into file_versions(file_id,version,name,mime,size,uploaded_by,created_at,data) select f.id, f.version, f.name, f.mime, f.size, f.uploaded_by, f.updated_at, b.data from project_files f join file_blobs b on b.file_id=f.id where f.id=$1`, [f.id]);
    await db.query('update file_blobs set data=$2 where file_id=$1', [f.id, up.data]);
    return (await db.query('update project_files set mime=$2, size=$3, version=version+1, uploaded_by=$4, updated_at=now() where id=$1 returning *', [f.id, up.mime, up.data.length, c.user!.id])).rows[0];
  });
  await act(f.project_id, c, 'file_replaced', { file_id: f.id, title: f.name, version: n.version });
  return { ...n, uploaded_by_name: c.user!.name };
}, { raw: MAX_FILE });
route('GET', '/api/files/:id/versions/:v/content', 'user', async (c) => {
  const v = await one('select name, mime, data from file_versions where file_id=$1 and version=$2', [needUuid(c.params.id, 'file'), Number(c.params.v) || 0]); if (!v) throw new HttpError(404, 'version not found');
  c.res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(v.data.length), 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`v${c.params.v} ${v.name}`)}`,
    'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=3600', 'content-security-policy': "default-src 'none'; sandbox" });
  c.res.end(v.data);
});
route('POST', '/api/files/:id/comments', 'user', async (c) => {
  const f = await one('select id, project_id, name from project_files where id=$1', [needUuid(c.params.id, 'file')]); if (!f) throw new HttpError(404, 'file not found');
  const b = parse(z.object({ body: text(5000).min(1) }), c.body);
  const k = (await one('insert into file_comments(file_id,author_id,body) values($1,$2,$3) returning id, body, created_at, author_id', [f.id, c.user!.id, b.body]))!;
  if (f.project_id) { await act(f.project_id, c, 'file_comment', { file_id: f.id, title: f.name, excerpt: b.body.slice(0, 140) }); await mentions(b.body, c, `${c.user!.name} mentioned you on the file “${f.name}”`, `/projects/${f.project_id}/files?file=${f.id}`); }
  return { created: true, ...k, author_name: c.user!.name };
});
route('DELETE', '/api/file-comments/:id', 'user', async (c) => {
  const k = await one('delete from file_comments where id=$1 and (author_id=$2 or $3) returning id', [needUuid(c.params.id, 'comment'), c.user!.id, c.user!.role === 'admin']);
  if (!k) throw new HttpError(403, 'Only the person who wrote a comment, or an admin, can delete it.'); return { deleted: true };
});
