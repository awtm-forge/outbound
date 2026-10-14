// Reading a task list out of a document. The browser turns a PDF (or a CSV, or pasted text) into lines, with a tab
// between table columns; this file turns those lines into tasks. Every status comes from words in the document
// (Completed, In progress, Under review, Pending ...); a line with no such word is never given one, it is listed apart
// so a person decides. Nothing here guesses a date, an owner or a status.
export type Status = 'TODO' | 'DOING' | 'REVIEW' | 'DONE';
export type ImportRow = {
  line: number; title: string; status: Status | null; status_text: string | null; flag: string | null;
  assignee: string | null; start_date: string | null; due_date: string | null; priority: string | null; section: string | null; notes: string | null;
};
export type Parsed = { rows: ImportRow[]; mode: 'table' | 'lines'; header: string[] | null; ignored: number; date_order: 'dmy' | 'mdy' };

// longer phrases first, so "pending approval" is a review and not just "pending"
const WORDS: [Status, string, string | null][] = [
  ['REVIEW', 'pending approval', null], ['REVIEW', 'awaiting approval', null], ['REVIEW', 'waiting for approval', null], ['REVIEW', 'for approval', null], ['REVIEW', 'sent for approval', null],
  ['REVIEW', 'under review', null], ['REVIEW', 'in review', null], ['REVIEW', 'for review', null], ['REVIEW', 'ready for review', null], ['REVIEW', 'pending review', null],
  ['REVIEW', 'in testing', null], ['REVIEW', 'under testing', null], ['REVIEW', 'client review', null], ['REVIEW', 'reviewing', null], ['REVIEW', 'review', null],
  ['REVIEW', 'testing', null], ['REVIEW', 'uat', null], ['REVIEW', 'qa', null], ['REVIEW', 'verification', null],
  ['DOING', 'work in progress', null], ['DOING', 'in progress', null], ['DOING', 'in-progress', null], ['DOING', 'inprogress', null], ['DOING', 'in process', null], ['DOING', 'in-process', null],
  ['DOING', 'under process', null], ['DOING', 'under progress', null], ['DOING', 'under development', null], ['DOING', 'in development', null], ['DOING', 'partially done', null], ['DOING', 'partially completed', null],
  ['DOING', 'ongoing', null], ['DOING', 'on going', null], ['DOING', 'on-going', null], ['DOING', 'wip', null], ['DOING', 'started', null], ['DOING', 'working', null], ['DOING', 'doing', null], ['DOING', 'running', null],
  ['DONE', 'completed', null], ['DONE', 'complete', null], ['DONE', 'done', null], ['DONE', 'finished', null], ['DONE', 'closed', null], ['DONE', 'delivered', null], ['DONE', 'resolved', null],
  ['DONE', 'approved', null], ['DONE', 'deployed', null], ['DONE', 'live', null], ['DONE', 'submitted', null],
  ['TODO', 'not started', null], ['TODO', 'yet to start', null], ['TODO', 'yet to be started', null], ['TODO', 'to be started', null], ['TODO', 'to do', null], ['TODO', 'to-do', null], ['TODO', 'todo', null],
  ['TODO', 'on hold', 'On hold'], ['TODO', 'on-hold', 'On hold'], ['TODO', 'blocked', 'Blocked'], ['TODO', 'pending', null], ['TODO', 'open', null], ['TODO', 'new', null],
  ['TODO', 'planned', null], ['TODO', 'backlog', null], ['TODO', 'upcoming', null], ['TODO', 'waiting', null], ['TODO', 'not done', null], ['TODO', 'incomplete', null],
];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PHRASES = WORDS.map(([status, w, flag]) => ({ status, w, flag, re: new RegExp(`(^|[^a-z])${esc(w)}(?=$|[^a-z])`, 'i') }));
// a cell that is only a status word (with a dot, a tick or a bracket around it)
const statusOfCell = (cell: string) => { const c = cell.toLowerCase().replace(/[^a-z\- ]/g, ' ').replace(/\s+/g, ' ').trim(); return c ? PHRASES.find((p) => p.w === c) ?? null : null; };
// everyday words count as a status only at the end of the line or set apart ("- Done", "(Review)", "| New"), so
// "Review the homepage copy - Pending" is pending; of the rest, the one nearest the end of the line wins
const WEAK = new Set(['new', 'open', 'live', 'review', 'reviewing', 'testing', 'working', 'running', 'started', 'done', 'qa', 'uat', 'closed', 'submitted', 'approved', 'waiting', 'planned',
  'doing', 'backlog', 'upcoming', 'verification', 'delivered', 'deployed', 'resolved', 'finished', 'complete', 'blocked']);
type Hit = (typeof PHRASES)[number] & { start: number; end: number };
function statusIn(text: string): Hit | null {
  let best: (Hit & { score: number }) | null = null;
  for (const p of PHRASES) for (const m of text.matchAll(new RegExp(p.re.source, 'gi'))) {
    const start = m.index! + m[1]!.length; const end = start + p.w.length;
    const atEnd = !text.slice(end).replace(/[\s.)\]|:–\-!]+$/, '').length; const setApart = /[(\[|:–\-]\s*$/.test(text.slice(0, start)) || !text.slice(0, start).trim();
    if (WEAK.has(p.w) && !atEnd && !setApart) continue;
    const score = end * 10 + p.w.length; if (!best || score > best.score) best = { ...p, start, end, score };
  }
  return best;
}
const cut = (text: string, h: Hit) => text.slice(0, h.start) + ' ' + text.slice(h.end);
// some lists say how far along a task is instead of a word
const fromPercent = (cell: string): Status | null => { const m = /^(\d{1,3})\s*%$/.exec(cell.trim()); if (!m) return null; const n = Number(m[1]); return n >= 100 ? 'DONE' : n <= 0 ? 'TODO' : 'DOING'; };

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const NUMERIC_DATE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/;
const ISO_DATE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/;
const WORD_DATE = /\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{2,4})\b|\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/;
const pad = (n: number) => String(n).padStart(2, '0');
const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
const valid = (y: number, m: number, d: number) => { if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return null; const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return d > last ? null : `${y}-${pad(m)}-${pad(d)}`; };
export function parseDate(s: string | null | undefined, order: 'dmy' | 'mdy' = 'dmy'): string | null {
  if (!s) return null; let m;
  if ((m = ISO_DATE.exec(s))) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = WORD_DATE.exec(s))) {
    const [d, mon, y] = m[1] ? [m[1], m[2]!, m[3]!] : [m[5]!, m[4]!, m[6]!]; const mo = MONTHS[mon.slice(0, 4).toLowerCase()] ?? MONTHS[mon.slice(0, 3).toLowerCase()];
    return mo ? valid(year(y), mo, Number(d)) : null;
  }
  if ((m = NUMERIC_DATE.exec(s))) { const a = Number(m[1]), b = Number(m[2]); const [d, mo] = a > 12 ? [a, b] : b > 12 ? [b, a] : order === 'dmy' ? [a, b] : [b, a]; return valid(year(m[3]!), mo, d); }
  return null;
}
// 03/14/2026 can only be month first; if the document has any of those, all its dates are read that way
const dateOrder = (lines: string[]): 'dmy' | 'mdy' => { let dmy = 0, mdy = 0; for (const l of lines) for (const m of l.matchAll(new RegExp(NUMERIC_DATE, 'g'))) { if (Number(m[1]) > 12) dmy++; else if (Number(m[2]) > 12) mdy++; } return mdy > dmy ? 'mdy' : 'dmy'; };

const HEAD: Record<string, RegExp> = {
  title: /^(task|tasks|task name|title|activity|activities|description|item|items|work|work item|particulars?|deliverables?|name|subject|issue|feature|requirement|scope|steps?|actions?|to-?dos?)\b/i,
  status: /^(status|state|current status|progress|stage of work|task status)\b/i,
  assignee: /^(assign(ed)?( to)?|assignee|owner|responsible|resource|person|done by|who|team member|poc|spoc|handled by|by)\b/i,
  due: /^(due|due date|deadline|end|end date|target|target date|finish|finish date|eta|completion date|planned end|to)\b/i,
  start: /^(start|start date|begin|from|planned start|commenced)\b/i,
  priority: /^(priority|prio|severity|importance)\b/i,
  section: /^(module|section|category|phase|area|group|milestone|component|epic|stage|department|page|screen)\b/i,
  notes: /^(remarks?|notes?|comments?|details?)\b/i,
  serial: /^(s\.?\s?no\.?|sr\.?\s?no\.?|sl\.?\s?no\.?|no\.?|#|id|task id|sn)$/i,
};
const cells = (line: string) => line.split('\t').map((c) => c.replace(/\s+/g, ' ').trim());
const isSerial = (c: string) => /^(#?\d{1,5}[.)]?|[a-z]{1,4}-\d{1,6})$/i.test(c);
const PRIORITY = /^(urgent|critical|high|medium|med|normal|low|p[0-4])$/i;
const priorityOf = (c: string | undefined) => { if (!c) return null; const v = c.trim().toLowerCase(); return /urgent|critical|p0/.test(v) ? 'URGENT' : /high|p1/.test(v) ? 'HIGH' : /med|normal|p2/.test(v) ? 'MEDIUM' : /low|p3|p4/.test(v) ? 'LOW' : null; };
const cleanTitle = (t: string) => t.replace(/^[\s\-*•●▪◦·>]+/, '').replace(/^(#?\d{1,5}[.)]\s+|#?\d{1,5}\s+-\s+)/, '').replace(/[\s\-–—:|,;]+$/, '').replace(/\s+/g, ' ').trim().slice(0, 300);
// page furniture a PDF repeats on every page
const NOISE = /^(page\s*\d+(\s*(of|\/)\s*\d+)?|\d+\s*(of|\/)\s*\d+|confidential|printed on .*|generated on .*)$/i;

// A line is text with a tab between cells (CSV, pasted text) or, from a PDF, its cells with where each starts on the
// page. Positions matter: a PDF leaves empty cells out, so a cell is put under the header it sits below.
export type Cell = { x: number; t: string };
export type Line = string | Cell[];
type L = { text: string; cs: string[]; xs: (number | null)[] };
const tidy = (t: string) => t.replace(/\r/g, '').replace(/[ \u00a0]+/g, ' ');
const toL = (l: Line): L => {
  if (typeof l === 'string') { const cs = tidy(l).split('\t').map((c) => c.trim()); while (cs.length && !cs[cs.length - 1]) cs.pop(); return { text: cs.filter(Boolean).join('\t'), cs, xs: cs.map(() => null) }; }
  const cells = l.map((c) => ({ x: Number(c.x) || 0, t: tidy(String(c.t ?? '')).trim() })).filter((c) => c.t).sort((p, q) => p.x - q.x);
  return { text: cells.map((c) => c.t).join('\t'), cs: cells.map((c) => c.t), xs: cells.map((c) => c.x) };
};

export function parseTaskLines(input: Line[]): Parsed {
  const all = input.slice(0, 20_000).map(toL);
  const lines = all.map((l) => l.text);
  const order = dateOrder(lines);
  // ---- a table with a header row: find the columns by their names ----
  let hi = -1; let map: Record<string, number> = {};
  for (let i = 0; i < Math.min(all.length, 60) && hi < 0; i++) {
    const cs = all[i]!.cs; if (cs.filter(Boolean).length < 2) continue;
    const m: Record<string, number> = {};
    cs.forEach((c, k) => { if (!c) return; for (const [key, re] of Object.entries(HEAD)) if (m[key] === undefined && re.test(c) && c.length <= 30) { m[key] = k; break; } });
    if (m.title !== undefined && m.status !== undefined) { hi = i; map = m; }
  }
  const rows: ImportRow[] = []; let ignored = 0; let section: string | null = null;
  const blank = (line: number, title: string): ImportRow => ({ line, title, status: null, status_text: null, flag: null, assignee: null, start_date: null, due_date: null, priority: null, section, notes: null });
  if (hi >= 0) {
    const head = all[hi]!; const header = head.cs; const headKey = head.text.toLowerCase(); const tails = new Set<string>();
    const byX = head.xs.every((x) => x !== null);
    // which header a cell belongs to: by position when the PDF gave positions, else by its place in the row
    const column = (l: L, k: number) => {
      const x = l.xs[k];
      if (!byX || x === null || x === undefined) return k;
      let best = 0; let d = Infinity; head.xs.forEach((hx, j) => { const dd = Math.abs((hx as number) - x); if (dd < d) { d = dd; best = j; } }); return best;
    };
    const setStatus = (r: ImportRow, cell: string) => {
      const st = statusOfCell(cell) ?? statusIn(cell); const pc = fromPercent(cell);
      if (st) { r.status = st.status; r.status_text = cell; r.flag = st.flag; } else if (pc) { r.status = pc; r.status_text = cell; }
    };
    for (let i = hi + 1; i < all.length; i++) {
      const l = all[i]!; const raw = l.text;
      if (!raw || NOISE.test(raw.replace(/\t/g, ' ')) || raw.toLowerCase() === headKey) { ignored++; continue; }
      const vals: Record<number, string> = {};
      l.cs.forEach((c, k) => { if (!c) return; const j = column(l, k); vals[j] = vals[j] ? `${vals[j]} ${c}` : c; });
      const at = (key: string) => (map[key] !== undefined ? vals[map[key]!] ?? '' : '');
      const filled = Object.keys(vals).length; const prev = rows[rows.length - 1];
      const one = l.cs.filter(Boolean);
      // a heading between rows ("WEBSITE", "Phase 2:") names the section of the rows under it
      if (one.length === 1 && !statusIn(one[0]!) && one[0]!.length <= 60 && (!prev || prev.status) && (one[0]!.endsWith(':') || (one[0] === one[0]!.toUpperCase() && /[A-Z]{2}/.test(one[0]!)))) { section = one[0]!.replace(/:$/, '').trim(); continue; }
      // a row that wrapped: the rest of its cells arrive on the next line, without a serial number (or without a title)
      // (without positions, a wrapped title lands in the first cell, where the serial number would be)
      const loose = map.serial !== undefined && !!at('serial') && !isSerial(at('serial')) && one.length === 1 && l.xs[0] === null;
      // a header that wrapped ("Assigned" over "To"): before the first row, a line with no task text is part of it
      if (!prev && !at('title') && !at('status')) { tails.add(raw.toLowerCase()); ignored++; continue; }
      if (tails.has(raw.toLowerCase()) && !at('title')) { ignored++; continue; } // the same wrapped header part, repeated under the header on each page
      const cont = !!prev && (loose || (map.serial !== undefined ? !at('serial') : (!at('title') || (!at('status') && filled <= Math.max(1, Math.floor(header.length / 2) - 1)))));
      if (cont) {
        const more = loose ? one[0]! : at('title');
        if (more) prev!.title = cleanTitle(`${prev!.title} ${more}`);
        if (!prev!.status && at('status')) setStatus(prev!, at('status'));
        if (at('assignee')) prev!.assignee = prev!.assignee ? `${prev!.assignee} ${at('assignee')}` : at('assignee');
        prev!.due_date ??= parseDate(at('due'), order); prev!.start_date ??= parseDate(at('start'), order);
        if (at('notes')) prev!.notes = prev!.notes ? `${prev!.notes} ${at('notes')}` : at('notes');
        continue;
      }
      const title = cleanTitle(at('title') || l.cs.filter((c, k) => c && column(l, k) !== map.status && !isSerial(c)).sort((p, q) => q.length - p.length)[0] || '');
      if (!title) { ignored++; continue; }
      const r = blank(i + 1, title); setStatus(r, at('status'));
      r.assignee = at('assignee') || null; r.due_date = parseDate(at('due'), order); r.start_date = parseDate(at('start'), order);
      r.priority = priorityOf(at('priority')); r.section = at('section') || section; r.notes = at('notes') || null;
      rows.push(r);
    }
    return { rows, mode: 'table', header, ignored, date_order: order };
  }
  // ---- no header: any line that names a status is a task; headings in between become the section ----
  const serials = lines.filter((l) => isSerial(cells(l)[0] ?? '') || /^#?\d{1,5}[.)]\s/.test(l)).length > lines.length * 0.3;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!; if (!raw || NOISE.test(raw)) { ignored++; continue; }
    const cs = cells(raw);
    const cellHit = cs.map((c) => statusOfCell(c)).findIndex(Boolean);
    const hit = cellHit >= 0 ? statusOfCell(cs[cellHit]!) : statusIn(raw);
    if (!hit) {
      const text = cs.join(' ');
      const heading = text.length <= 60 && !/[.;]$/.test(text) && (text.endsWith(':') || (text === text.toUpperCase() && /[A-Z]/.test(text)) || /^(phase|module|section|stage|milestone|week|sprint)\b/i.test(text));
      if (heading) { section = text.replace(/:$/, '').trim(); continue; }
      const startsNew = isSerial(cs[0] ?? '') || /^#?\d{1,5}[.)]\s/.test(raw) || /^[-*•●▪]/.test(raw);
      if (rows.length && serials && !startsNew) { rows[rows.length - 1]!.title = (rows[rows.length - 1]!.title + ' ' + text).slice(0, 300); continue; }
      const t = cleanTitle(text); if (t.length >= 3) rows.push(blank(i + 1, t)); else ignored++;
      continue;
    }
    let titleText: string;
    if (cs.length > 1) {
      // the task is the longest cell that is not the status, a serial, a date, a percentage or a priority
      const rest = cs.filter((c, k) => k !== cellHit && !isSerial(c) && !parseDate(c, order) && !/^\d{1,3}\s*%$/.test(c) && !PRIORITY.test(c));
      titleText = rest.sort((a, b) => b.length - a.length)[0] ?? '';
      if (cellHit < 0 && 'start' in hit) { const h2 = statusIn(titleText); if (h2) titleText = cut(titleText, h2); }
    } else titleText = (cellHit < 0 ? cut(raw, hit as Hit) : raw).replace(/[(\[]\s*[)\]]/g, ' ').replace(/\s[-–:|]\s*$/, '').replace(/^\s*[-–:|]\s*/, '');
    const title = cleanTitle(titleText.replace(NUMERIC_DATE, ' ').replace(ISO_DATE, ' ').replace(/\s[-–:|]\s*$/, ''));
    if (!title || title.length < 2) { ignored++; continue; }
    const r = blank(i + 1, title); r.status = hit.status; r.status_text = cellHit >= 0 ? cs[cellHit]! : hit.w; r.flag = hit.flag;
    const dates = cs.flatMap((c) => { const d = parseDate(c, order); return d ? [d] : []; });
    if (dates.length === 1) r.due_date = dates[0]!; else if (dates.length >= 2) { r.start_date = dates[0]!; r.due_date = dates[dates.length - 1]!; }
    r.priority = priorityOf(cs.find((c) => PRIORITY.test(c)));
    rows.push(r);
  }
  return { rows, mode: 'lines', header: null, ignored, date_order: order };
}

// ---- Markdown: a plan written as headings, tables and checklists ----
// Each table is read on its own with its own header row; the heading above it names the section. Outside tables only
// list items and lines that name a status are tasks, so the paragraphs that explain a plan never become tasks.
const MD_TABLE = /^\s*\|.*\|\s*$/;
const MD_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const MD_HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const MD_CHECK = /^\s*(?:[-*+]|\d{1,4}[.)])\s+\[([ xX~\/-])\]\s+(.*)$/;
const MD_ITEM = /^\s*(?:[-*+]|\d{1,4}[.)])\s+(.*)$/;
export const looksLikeMarkdown = (text: string) => {
  const ls = text.split('\n');
  return ls.some((l, i) => MD_TABLE.test(l) && MD_RULE.test(ls[i + 1] ?? '')) || ls.some((l) => MD_CHECK.test(l)) || ls.filter((l) => MD_HEADING.test(l)).length >= 2;
};
// status emoji written for people stand in for the words
const EMOJI: [RegExp, string][] = [[/[✅✔☑]️?/gu, ' Done '], [/[🔄⏳🟡🚧]️?/gu, ' In progress '], [/👀️?/gu, ' Under review '], [/[⬜☐]️?/gu, ' To do ']];
const mdText = (s: string) => {
  let t = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`([^`]*)`/g, '$1').replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[.,:;])/g, '$1$2').replace(/<[^>]+>/g, ' ');
  // the emoji stands in for the word only when the word is not already there ("✅ Done" is Done, not "Done Done")
  const bare = EMOJI.reduce((s, [re]) => s.replace(re, ' '), t);
  if (bare !== t && !statusIn(bare)) for (const [re, w] of EMOJI) t = t.replace(re, w); else t = bare;
  return t.replace(/\s+/g, ' ').trim();
};
const CHECK: Record<string, string> = { ' ': 'To do', x: 'Done', X: 'Done', '~': 'In progress', '/': 'In progress', '-': 'In progress' };

export function parseMarkdown(text: string): Parsed {
  const src = text.replace(/\r/g, '').split('\n').slice(0, 20_000);
  const rows: ImportRow[] = []; const headers: string[] = []; let ignored = 0; let heading: string | null = null; let fence = false;
  const loose: { line: number; text: string }[] = []; // list items and status lines, read together by the line rules
  for (let i = 0; i < src.length; i++) {
    const raw = src[i]!;
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; ignored++; continue; }
    if (fence || !raw.trim()) { ignored++; continue; }
    const h = MD_HEADING.exec(raw);
    if (h) { heading = mdText(h[1]!) || heading; if (heading) loose.push({ line: i + 1, text: `${heading}:` }); continue; }
    if (MD_TABLE.test(raw)) {
      // the whole table, read as its own document; line numbers are kept from the file
      const at: number[] = []; const lines: string[] = [];
      for (; i < src.length && MD_TABLE.test(src[i]!); i++) {
        if (MD_RULE.test(src[i]!)) { ignored++; continue; }
        const cs = src[i]!.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => mdText(c.replace(/\\\|/g, '|')));
        lines.push(cs.join('\t')); at.push(i + 1);
      }
      i--;
      // a table with a Status column but no Task column ("Phase | What it covers | Status"): its first column names the task
      const head = (lines[0] ?? '').split('\t');
      const named = head.some((c) => HEAD.title!.test(c) && c.length <= 30);
      const ti = named || !head.some((c) => HEAD.status!.test(c)) ? -1 : head.findIndex((c) => c && !HEAD.status!.test(c) && !HEAD.serial!.test(c));
      if (ti >= 0) lines[0] = head.map((c, k) => (k === ti ? 'Task' : c)).join('\t');
      const t = parseTaskLines(lines); ignored += t.ignored;
      if (t.mode === 'table' && t.header) headers.push(...t.header.map((x, k) => (k === ti ? head[ti]! : x)).filter((x) => x && !headers.includes(x)));
      for (const r of t.rows) rows.push({ ...r, line: at[r.line - 1] ?? r.line, section: r.section ?? heading });
      continue;
    }
    const c = MD_CHECK.exec(raw);
    if (c) { loose.push({ line: i + 1, text: `${mdText(c[2]!)}\t${CHECK[c[1]!]}` }); continue; }
    const li = MD_ITEM.exec(raw); const plain = mdText(raw.replace(/^\s*>\s?/, ''));
    if (li) { loose.push({ line: i + 1, text: `- ${mdText(li[1]!)}` }); continue; }
    // a paragraph is a task only when it says its status ("Charger map on the website - Done")
    // (at its end, so a sentence that mentions "not started" in passing stays a sentence)
    const st = plain.length <= 160 ? statusIn(plain) : null;
    if (st && !plain.slice(st.end).replace(/[\s.)\]|:–\-!]+$/, '').length) loose.push({ line: i + 1, text: plain }); else ignored++;
  }
  const l = parseTaskLines(loose.map((x) => x.text)); ignored += l.ignored;
  for (const r of l.rows) rows.push({ ...r, line: loose[r.line - 1]?.line ?? r.line });
  rows.sort((a, b) => a.line - b.line);
  return { rows, mode: headers.length ? 'table' : 'lines', header: headers.length ? headers : null, ignored, date_order: dateOrder(src) };
}

// a CSV file as lines with tabs between the cells (quoted cells may hold commas, quotes and line breaks)
export function csvToLines(text: string): string[] {
  const out: string[] = []; let row: string[] = []; let cell = ''; let q = false;
  const sep = (text.split('\n', 1)[0]!.match(/;/g)?.length ?? 0) > (text.split('\n', 1)[0]!.match(/,/g)?.length ?? 0) ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch === '\n' || ch === '\t' ? ' ' : ch; continue; }
    if (ch === '"') q = true; else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); out.push(row.join('\t')); row = []; cell = ''; } else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row.join('\t')); }
  return out.filter((l) => l.replace(/\t/g, '').trim());
}
