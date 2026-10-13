// Pages written before the editor are Markdown. This turns one into an editor document the first time it is opened,
// covering what the old wiki renderer understood: headings, paragraphs, lists and checklists, quotes, code, rules,
// tables, bold, italic, code, links and [[Wiki links]]. The page itself only changes when someone edits it.
import { slugify } from '../../ui/markdown.tsx';

type Mark = { type: string; attrs?: Record<string, unknown> };
const INLINE = /(\[\[([^\]|]+)(?:\|([^\]]+))?\]\])|(\[([^\]]+)\]\(((?:https?:\/\/|mailto:|\/)[^)\s]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)|(_([^_]+)_)/;

export function inline(s: string, marks: Mark[] = []): any[] {
  const out: any[] = [];
  while (s) {
    const m = s.match(INLINE);
    if (!m || m.index === undefined) { out.push(text(s, marks)); break; }
    if (m.index) out.push(text(s.slice(0, m.index), marks));
    if (m[1]) out.push(text(m[3] ?? m[2]!, [...marks, { type: 'link', attrs: { href: `/wiki/${slugify(m[2]!)}` } }]));
    else if (m[4]) out.push(...inline(m[5]!, [...marks, { type: 'link', attrs: { href: m[6]!, target: /^https?:/i.test(m[6]!) ? '_blank' : null } }]));
    else if (m[7]) out.push(...inline(m[8]!, [...marks, { type: 'bold' }]));
    else if (m[9]) out.push(text(m[10]!, [...marks, { type: 'code' }]));
    else if (m[11]) out.push(...inline(m[12]!, [...marks, { type: 'italic' }]));
    else if (m[13]) out.push(...inline(m[14]!, [...marks, { type: 'italic' }]));
    s = s.slice(m.index + m[0].length);
  }
  return out.filter((n) => n.text);
}
const text = (t: string, marks: Mark[]) => (marks.length ? { type: 'text', text: t, marks } : { type: 'text', text: t });
const para = (s: string) => ({ type: 'paragraph', content: inline(s) });
const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function fromMarkdown(md: string) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n'); const out: any[] = []; let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^```\s*([\w+-]*)/);
    if (fence) { const body: string[] = []; i++; while (i < lines.length && !/^```/.test(lines[i]!)) body.push(lines[i++]!); i++; out.push({ type: 'codeBlock', attrs: { language: fence[1] || null }, content: body.length ? [{ type: 'text', text: body.join('\n') }] : [] }); continue; }
    const hd = line.match(/^(#{1,3})\s+(.*)$/);
    if (hd) { out.push({ type: 'heading', attrs: { level: hd[1]!.length }, content: inline(hd[2]!) }); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push({ type: 'horizontalRule' }); i++; continue; }
    if (/^>\s?/.test(line)) { const body: string[] = []; while (i < lines.length && /^>\s?/.test(lines[i]!)) body.push(lines[i++]!.replace(/^>\s?/, '')); out.push({ type: 'blockquote', content: [para(body.join(' '))] }); continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]!)) {
      const head = cells(line); i += 2; const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      const cell = (type: string, s: string) => ({ type, content: [para(s)] });
      out.push({ type: 'table', content: [{ type: 'tableRow', content: head.map((c) => cell('tableHeader', c)) }, ...rows.map((r) => ({ type: 'tableRow', content: head.map((_, k) => cell('tableCell', r[k] ?? '')) }))] });
      continue;
    }
    if (/^\s*[-*]\s+\[[ xX]\]\s/.test(line)) {
      const items: any[] = [];
      while (i < lines.length && /^\s*[-*]\s+\[[ xX]\]\s/.test(lines[i]!)) { const m = lines[i++]!.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/)!; items.push({ type: 'taskItem', attrs: { checked: m[1] !== ' ' }, content: [para(m[2]!)] }); }
      out.push({ type: 'taskList', content: items }); continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: any[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!) && !/^\s*[-*]\s+\[[ xX]\]\s/.test(lines[i]!)) items.push({ type: 'listItem', content: [para(lines[i++]!.replace(/^\s*[-*]\s+/, ''))] });
      out.push({ type: 'bulletList', content: items }); continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: any[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) items.push({ type: 'listItem', content: [para(lines[i++]!.replace(/^\s*\d+[.)]\s+/, ''))] });
      out.push({ type: 'orderedList', content: items }); continue;
    }
    // a paragraph runs until a blank line or the start of another block
    const body: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,3}\s|```|>|\s*[-*]\s+|\s*\d+[.)]\s+|\s*\|)/.test(lines[i]!)) body.push(lines[i++]!.trim());
    if (!body.length) body.push(lines[i++]!.trim());
    out.push(para(body.join(' ')));
  }
  return { type: 'doc', content: out.length ? out : [{ type: 'paragraph' }] };
}
