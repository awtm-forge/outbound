// Importing a task list into a project: read (rules, or AI for documents the rules cannot read), preview, then create.
// Reading never writes anything. Creating writes only the rows the person kept, in one transaction, with the status
// each row was given in the preview.
import { route } from '../lib/http.ts';
import { q, tx } from '../lib/db.ts';
import { HttpError } from '../pipeline.ts';
import { parse, z } from '../lib/validate.ts';
import { act, needProject } from './projects.ts';
import { notify } from './notifications.ts';
import { enqueue } from '../jobs.ts';
import { runAgent } from '../lib/ai.ts';
import { parseTaskLines, parseMarkdown, looksLikeMarkdown, csvToLines, type ImportRow } from '../lib/taskimport.ts';
import { taskImportAi } from '../agents/taskimport.ts';

const CellIn = z.object({ x: z.number().finite(), t: z.string().max(2000) });
const LineIn = z.union([z.string().max(4000), z.array(CellIn).max(60)]);
const MAX_ROWS = 5000;

// the people on the team, to match the names a file uses ("Ayush", "ayush.k", "Ayush Kumar")
async function people() {
  const us = await q(`select id, name, username::text username from users where active`);
  const exact = new Map<string, string>(); const first = new Map<string, string[]>();
  for (const u of us) {
    exact.set(String(u.name).toLowerCase().trim(), u.id); exact.set(String(u.username).toLowerCase(), u.id);
    const f = String(u.name).toLowerCase().split(/\s+/)[0]!; first.set(f, [...(first.get(f) ?? []), u.id]);
  }
  return (name: string | null | undefined): string | null => {
    if (!name) return null; const n = name.toLowerCase().replace(/\s+/g, ' ').trim(); if (!n) return null;
    if (exact.has(n)) return exact.get(n)!;
    const f = first.get(n.split(' ')[0]!); return f && f.length === 1 ? f[0]! : null; // a first name only counts when one person has it
  };
}
async function annotate(projectId: string, rows: ImportRow[]) {
  const who = await people();
  const have = new Set((await q('select lower(title) t from tasks where project_id=$1 and archived_at is null', [projectId])).map((r) => r.t));
  return rows.map((r) => ({ ...r, assignee_id: who(r.assignee), exists: have.has(r.title.toLowerCase()) }));
}
const countOf = (rows: { status: string | null }[]) => { const n = (s: string | null) => rows.filter((r) => r.status === s).length; return { DONE: n('DONE'), DOING: n('DOING'), REVIEW: n('REVIEW'), TODO: n('TODO'), NONE: n(null) }; };

route('POST', '/api/projects/:id/import/parse', 'user', async (c) => {
  const p = await needProject(c.params.id);
  const b = parse(z.object({ lines: z.array(LineIn).max(20_000).optional(), csv: z.string().max(1_800_000).optional(), text: z.string().max(1_800_000).optional() }), c.body);
  const lines = b.csv !== undefined ? csvToLines(b.csv) : b.text !== undefined ? b.text.split('\n') : b.lines ?? [];
  if (!lines.length) throw new HttpError(400, 'The file has no text to read. If it is a scanned PDF, export it again as text or as a spreadsheet (CSV).');
  // a Markdown plan (headings, tables, checklists) is read table by table; everything else by the line rules
  const r = b.text !== undefined && looksLikeMarkdown(b.text) ? parseMarkdown(b.text) : parseTaskLines(lines);
  const rows = (await annotate(p.id, r.rows)).slice(0, MAX_ROWS);
  return { mode: r.mode, header: r.header, ignored: r.ignored, date_order: r.date_order, total: r.rows.length, counts: countOf(rows), rows };
});

// the AI reader: the document in slices of 250 lines, each read on its own, then joined in order
route('POST', '/api/projects/:id/import/ai', 'user', async (c) => {
  const p = await needProject(c.params.id);
  const b = parse(z.object({ lines: z.array(z.string().max(2000)).min(1).max(20_000) }), c.body);
  const lines = b.lines.map((l) => l.replace(/\t/g, ' | ').trim()).filter(Boolean);
  const slices: string[][] = []; for (let i = 0; i < lines.length; i += 250) slices.push(lines.slice(i, i + 250));
  const job = enqueue(`Reading a task list for ${p.name} (${slices.length} ${slices.length === 1 ? 'part' : 'parts'})`, async () => {
    const out: ImportRow[] = []; let n = 0;
    for (const s of slices) {
      const r = (await runAgent(taskImportAi, { project: p.name, lines: s })).output;
      for (const t of r.tasks) out.push({ line: ++n, title: t.title.trim().slice(0, 300), status: t.status, status_text: t.status_text, flag: /hold/i.test(t.status_text ?? '') ? 'On hold' : /block/i.test(t.status_text ?? '') ? 'Blocked' : null,
        assignee: t.assignee, start_date: t.start_date, due_date: t.due_date, priority: null, section: t.section, notes: null });
    }
    const rows = (await annotate(p.id, out.filter((r) => r.title))).slice(0, MAX_ROWS);
    return { mode: 'ai', header: null, ignored: 0, total: rows.length, counts: countOf(rows), rows };
  });
  return { job_id: job.id, status: job.status };
});

const RowIn = z.object({
  title: z.string().trim().min(1).max(300), status: z.enum(['TODO', 'DOING', 'REVIEW', 'DONE']), flag: z.string().max(40).nullable().optional(),
  assignee: z.string().max(120).nullable().optional(), start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  priority: z.enum(['URGENT', 'HIGH', 'MEDIUM', 'LOW', 'NONE']).nullable().optional(), section: z.string().max(120).nullable().optional(), notes: z.string().max(4000).nullable().optional(),
});
route('POST', '/api/projects/:id/import', 'user', async (c) => {
  const p = await needProject(c.params.id);
  const b = parse(z.object({ source: z.string().trim().min(1).max(200), rows: z.array(RowIn).min(1).max(MAX_ROWS), skip_existing: z.boolean().default(true), section_labels: z.boolean().default(true) }), c.body);
  const who = await people();
  const have = new Set((await q('select lower(title) t from tasks where project_id=$1 and archived_at is null', [p.id])).map((r) => r.t));
  const cols = await q('select id, status from board_columns where project_id=$1 order by position', [p.id]);
  const colFor = (s: string) => cols.find((x) => x.status === s)?.id ?? null;
  const unmatched = new Set<string>(); let skipped = 0;
  const recs = b.rows.flatMap((r) => {
    if (b.skip_existing && have.has(r.title.toLowerCase())) { skipped++; return []; }
    const assignee_id = who(r.assignee); if (r.assignee && !assignee_id) unmatched.add(r.assignee.trim());
    const labels = [...new Set([b.section_labels && r.section ? r.section.trim().slice(0, 40) : '', r.flag ? r.flag.slice(0, 40) : ''].filter(Boolean))];
    const start = r.start_date && r.due_date && r.start_date > r.due_date ? null : r.start_date ?? null;
    // a name the team does not have stays with the task, in its description, so nothing from the file is lost
    const description = [r.notes ?? '', r.assignee && !assignee_id ? `Owner in ${b.source}: ${r.assignee.trim()}` : ''].filter(Boolean).join('\n\n');
    return [{ title: r.title, description, status: r.status, priority: r.priority ?? 'MEDIUM', assignee_id, due_date: r.due_date ?? null, start_date: start, labels, column_id: colFor(r.status) }];
  });
  if (!recs.length) return { created: 0, skipped_existing: skipped, unmatched: [...unmatched], counts: countOf([]) };
  const ids = await tx(async (db) => {
    const base = Number((await db.query('select coalesce(max(position),0) m from tasks where project_id=$1', [p.id])).rows[0].m);
    const out: string[] = [];
    for (let i = 0; i < recs.length; i += 1000) {
      const part = recs.slice(i, i + 1000).map((r, k) => ({ ...r, n: i + k + 1 }));
      const res = await db.query(`insert into tasks(project_id,title,description,status,priority,assignee_id,due_date,start_date,labels,column_id,position,completed_at,created_by)
        select $1, r.title, r.description, r.status, r.priority, r.assignee_id, r.due_date, r.start_date, r.labels, r.column_id, $2::float8 + r.n, case when r.status='DONE' then now() end, $3
        from jsonb_to_recordset($4::jsonb) as r(n int, title text, description text, status text, priority text, assignee_id uuid, due_date date, start_date date, labels text[], column_id uuid)
        order by r.n returning id`, [p.id, base, c.user!.id, JSON.stringify(part)]);
      out.push(...res.rows.map((x) => x.id));
    }
    const owners = [...new Set(recs.map((r) => r.assignee_id).filter(Boolean))] as string[];
    if (owners.length) await db.query('insert into project_members(project_id,user_id,added_by) select $1, unnest($2::uuid[]), $3 on conflict do nothing', [p.id, owners, c.user!.id]);
    return out;
  });
  const counts = countOf(recs);
  await act(p.id, c, 'tasks_imported', { title: b.source, count: ids.length, counts, skipped });
  // one message per person, not one per task
  const per = new Map<string, number>(); for (const r of recs) if (r.assignee_id) per.set(r.assignee_id, (per.get(r.assignee_id) ?? 0) + 1);
  for (const [uid, n] of per) await notify(uid, c.user!.id, 'tasks_imported', `${c.user!.name} imported ${n} ${n === 1 ? 'task' : 'tasks'} for you into ${p.name}`, `/projects/${p.id}/list`);
  return { created: ids.length, skipped_existing: skipped, unmatched: [...unmatched], counts };
});
