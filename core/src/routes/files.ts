// Project files. The bytes arrive as the request body (the browser sends the file as is, with its type), are checked
// for size and type, and are stored apart from the list. Downloads are only for signed-in people, and anything that
// could run in a browser (HTML, SVG, scripts) is only ever sent as a download, never shown inline.
import { route } from '../lib/http.ts';
import { q, one, tx } from '../lib/db.ts';
import { HttpError } from '../pipeline.ts';
import { parse, z, text, needUuid, isUuid } from '../lib/validate.ts';
import { act, needProject } from './projects.ts';

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
const safeName = (s: string) => s.replace(/[\u0000-\u001f\u007f/\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'file';

route('POST', '/api/projects/:id/files', 'user', async (c) => {
  const p = await needProject(c.params.id); const data: Buffer = c.body;
  if (!Buffer.isBuffer(data) || !data.length) throw new HttpError(400, 'The file is empty.');
  const mime = String(c.req.headers['content-type'] ?? 'application/octet-stream').split(';')[0]!.trim().toLowerCase();
  if (!(mime in ALLOWED)) throw new HttpError(415, 'That kind of file cannot be uploaded here. Images, PDFs, documents, spreadsheets, text and zip files can.');
  const magic = MAGIC.find(([m]) => m === mime); if (magic && !magic[1].every((b, i) => data[i] === b)) throw new HttpError(415, 'The file does not match its type.');
  const sp = c.url.searchParams; const name = safeName(sp.get('name') ?? 'file');
  const taskId = sp.get('task_id'); const pageId = sp.get('page_id');
  if (taskId && !(isUuid(taskId) && await one('select 1 from tasks where id=$1 and project_id=$2', [taskId, p.id]))) throw new HttpError(400, 'That task is not on this project.');
  if (pageId && !(isUuid(pageId) && await one('select 1 from pages where id=$1 and project_id=$2', [pageId, p.id]))) throw new HttpError(400, 'That page is not in this project.');
  const f = await tx(async (db) => {
    const f = (await db.query('insert into project_files(project_id,task_id,page_id,name,mime,size,uploaded_by) values($1,$2,$3,$4,$5,$6,$7) returning *', [p.id, taskId || null, pageId || null, name, mime, data.length, c.user!.id])).rows[0];
    await db.query('insert into file_blobs(file_id,data) values($1,$2)', [f.id, data]);
    return f;
  });
  await act(p.id, c, 'file_uploaded', { file_id: f.id, name, task_id: taskId || null, title: name });
  return { created: true, ...f, uploaded_by_name: c.user!.name };
}, { raw: MAX_FILE });
route('GET', '/api/projects/:id/files', 'user', async (c) => {
  const p = await needProject(c.params.id); const sp = c.url.searchParams; const term = (sp.get('q') ?? '').trim().slice(0, 100);
  return q(`select f.id, f.name, f.mime, f.size, f.task_id, f.page_id, f.created_at, f.uploaded_by, u.name uploaded_by_name, t.title task_title, g.title page_title
    from project_files f left join users u on u.id=f.uploaded_by left join tasks t on t.id=f.task_id left join pages g on g.id=f.page_id
    where f.project_id=$1 and ($2 = '' or f.name ilike '%' || $2 || '%') order by f.created_at desc limit 300`, [p.id, term.replace(/[\\%_]/g, (m) => '\\' + m)]);
});
route('GET', '/api/files/:id/content', 'user', async (c) => {
  const f = await one('select f.name, f.mime, f.size, b.data from project_files f join file_blobs b on b.file_id=f.id where f.id=$1', [needUuid(c.params.id, 'file')]);
  if (!f) throw new HttpError(404, 'file not found');
  const inline = INLINE.has(f.mime) && c.url.searchParams.get('download') !== '1';
  c.res.writeHead(200, {
    'content-type': inline ? f.mime : 'application/octet-stream', 'content-length': String(f.data.length),
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=3600', 'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
  });
  c.res.end(f.data);
});
route('PATCH', '/api/files/:id', 'user', async (c) => {
  const id = needUuid(c.params.id, 'file'); const b = parse(z.object({ name: text(200).min(1).optional(), task_id: z.string().uuid().nullable().optional() }), c.body);
  const f = await one('select * from project_files where id=$1', [id]); if (!f) throw new HttpError(404, 'file not found');
  if (b.task_id && !(await one('select 1 from tasks where id=$1 and project_id=$2', [b.task_id, f.project_id]))) throw new HttpError(400, 'That task is not on this project.');
  const n = await one('update project_files set name=coalesce($2,name), task_id=case when $3::boolean then $4 else task_id end where id=$1 returning *', [id, b.name ? safeName(b.name) : null, b.task_id !== undefined, b.task_id ?? null]);
  if (b.name && b.name !== f.name) await act(f.project_id, c, 'file_renamed', { file_id: id, from: f.name, to: n!.name, title: n!.name });
  return n;
});
route('DELETE', '/api/files/:id', 'user', async (c) => {
  const f = await one('select * from project_files where id=$1', [needUuid(c.params.id, 'file')]); if (!f) throw new HttpError(404, 'file not found');
  if (c.user!.role !== 'admin' && f.uploaded_by !== c.user!.id) throw new HttpError(403, 'Only the person who uploaded this file, or an admin, can delete it.');
  await q('delete from project_files where id=$1', [f.id]);
  await act(f.project_id, c, 'file_removed', { name: f.name, title: f.name });
  return { deleted: true };
});
