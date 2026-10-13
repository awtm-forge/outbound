import { Fragment, type ReactNode } from 'react';
import { Link } from '../router.tsx';
// A small Markdown renderer that builds React elements: no HTML string is ever injected, so a page cannot carry a
// script whatever is typed into it. Covers what a team wiki uses: headings, paragraphs, lists and checklists,
// quotes, code, tables, rules, bold, italic, inline code, links, bare URLs and [[Wiki links]].

export const slugify = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '') || 'page';
const safeHref = (u: string) => /^(https?:|mailto:)/i.test(u) || /^\/(?![\/\\])/.test(u) || u.startsWith('#') ? u : null;

function A({ href, children }: { href: string; children: ReactNode }) {
  const h = safeHref(href.trim()); if (!h) return <>{children}</>;
  if (h.startsWith('/')) return <Link to={h}>{children}</Link>;
  return <a href={h} target="_blank" rel="noopener noreferrer">{children}</a>;
}

// earliest match wins; each rule turns its match into an element
const INLINE: { re: RegExp; render: (m: RegExpExecArray, k: number) => ReactNode }[] = [
  { re: /`([^`]+)`/, render: (m, k) => <code key={k}>{m[1]}</code> },
  { re: /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/, render: (m, k) => <Link key={k} to={`/wiki/${slugify(m[1]!)}`} className="wikilink">{m[2] ?? m[1]}</Link> },
  { re: /\[([^\]]+)\]\(([^)\s]+)\)/, render: (m, k) => <A key={k} href={m[2]!}>{inline(m[1]!)}</A> },
  { re: /\*\*([^*]+)\*\*/, render: (m, k) => <strong key={k}>{inline(m[1]!)}</strong> },
  { re: /(?<![\w*])\*([^*\s][^*]*?)\*(?!\w)|(?<![\w_])_([^_\s][^_]*?)_(?!\w)/, render: (m, k) => <em key={k}>{inline((m[1] ?? m[2])!)}</em> },
  { re: /~~([^~]+)~~/, render: (m, k) => <del key={k}>{inline(m[1]!)}</del> },
  { re: /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/, render: (m, k) => <A key={k} href={m[0]}>{m[0]}</A> },
];
export function inline(s: string): ReactNode[] {
  const out: ReactNode[] = []; let rest = s; let k = 0;
  while (rest) {
    let best: { m: RegExpExecArray; r: (typeof INLINE)[number] } | null = null;
    for (const r of INLINE) { const m = r.re.exec(rest); if (m && (!best || m.index < best.m.index)) best = { m, r }; }
    if (!best) { out.push(rest); break; }
    if (best.m.index) out.push(rest.slice(0, best.m.index));
    out.push(best.r.render(best.m, k++)); rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

const isBlockStart = (l: string) => /^(#{1,4}\s|```|>|\s*[-*+]\s|\s*\d+[.)]\s|(-{3,}|\*{3,})\s*$)/.test(l);
const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n'); const out: ReactNode[] = []; let i = 0; let k = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (!l.trim()) { i++; continue; }
    if (l.startsWith('```')) {
      const body: string[] = []; i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) body.push(lines[i++]!);
      i++; out.push(<pre key={k++}><code>{body.join('\n')}</code></pre>); continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) { const Tag = (`h${Math.min(h[1]!.length + 1, 5)}`) as 'h2'; out.push(<Tag key={k++} id={slugify(h[2]!)}>{inline(h[2]!)}</Tag>); i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(l)) { out.push(<hr key={k++} />); i++; continue; }
    if (l.startsWith('>')) {
      const body: string[] = []; while (i < lines.length && lines[i]!.startsWith('>')) body.push(lines[i++]!.replace(/^>\s?/, ''));
      out.push(<blockquote key={k++}><Markdown text={body.join('\n')} /></blockquote>); continue;
    }
    const ul = /^\s*[-*+]\s/.test(l); const ol = /^\s*\d+[.)]\s/.test(l);
    if (ul || ol) {
      const items: string[] = [];
      while (i < lines.length && (ul ? /^\s*[-*+]\s/ : /^\s*\d+[.)]\s/).test(lines[i]!)) items.push(lines[i++]!.replace(ul ? /^\s*[-*+]\s+/ : /^\s*\d+[.)]\s+/, ''));
      const li = items.map((t, j) => { const c = /^\[([ xX])\]\s+(.*)$/.exec(t); return <li key={j} className={c ? 'todo' : undefined}>{c ? <><input type="checkbox" checked={c[1] !== ' '} disabled readOnly aria-label={c[1] !== ' ' ? 'done' : 'not done'} /> {inline(c[2]!)}</> : inline(t)}</li>; });
      out.push(ul ? <ul key={k++}>{li}</ul> : <ol key={k++}>{li}</ol>); continue;
    }
    if (l.includes('|') && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1] ?? '')) {
      const head = cells(l); i += 2; const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) rows.push(cells(lines[i++]!));
      out.push(<div key={k++} className="scrollx"><table className="t md-table"><thead><tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
        <tbody>{rows.map((r, j) => <tr key={j}>{head.map((_, x) => <td key={x}>{inline(r[x] ?? '')}</td>)}</tr>)}</tbody></table></div>); continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !(para.length && isBlockStart(lines[i]!))) para.push(lines[i++]!);
    out.push(<p key={k++}>{para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p)}</Fragment>)}</p>);
  }
  return <div className="md">{out}</div>;
}
