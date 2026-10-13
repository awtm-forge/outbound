import { useEffect, useState } from 'react';
import { Node, Extension, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Icon } from '../../../ui/icons.tsx';
import { fileSize } from '../shared.tsx';

// Notes blocks the starter kit does not have. Each one stores only plain attributes, which the server checks again.
// Navigation inside NodeViews goes through this hook so a click on a page or task link opens it in the app.
export type LinkedTask = { id: string; title: string; status: string; priority: string; assignee_name: string | null; due_date: string | null };
export const nav: { page: (id: string) => void; task: (id: string) => void; tasks: () => LinkedTask[]; pickTask: () => Promise<{ id: string; title: string } | null>; newTask: () => Promise<{ id: string } | null> } =
  { page: () => {}, task: () => {}, tasks: () => [], pickTask: async () => null, newTask: async () => null };
// the project's tasks change outside the editor; linked-task tables listen for this to redraw
export const tasksChanged = new EventTarget();

export const Callout = Node.create({
  name: 'callout', group: 'block', content: 'block+', defining: true,
  addAttributes: () => ({ tone: { default: 'info', parseHTML: (el) => el.getAttribute('data-tone') ?? 'info', renderHTML: (a) => ({ 'data-tone': a.tone }) } }),
  parseHTML: () => [{ tag: 'div[data-callout]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'nb-callout' }), 0],
  addNodeView() { return ReactNodeViewRenderer(CalloutView); },
});
const TONES = { info: ['💡', 'Note'], goal: ['🎯', 'Objective'], ask: ['❓', 'Open questions'], warn: ['⚠️', 'Watch out'], ok: ['✅', 'Decision'], idea: ['✨', 'Idea'] } as const;
function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const t = (node.attrs.tone in TONES ? node.attrs.tone : 'info') as keyof typeof TONES;
  return <NodeViewWrapper className={`nb-callout tone-${t}`} data-callout="">
    <button type="button" className="nb-callout-ic" contentEditable={false} disabled={!editor.isEditable} title="Change the callout kind"
      onClick={() => { const keys = Object.keys(TONES) as (keyof typeof TONES)[]; updateAttributes({ tone: keys[(keys.indexOf(t) + 1) % keys.length] }); }} aria-label={`${TONES[t][1]} callout, change kind`}>{TONES[t][0]}</button>
    <NodeViewContent className="nb-callout-body" /></NodeViewWrapper>;
}

export const PageRef = Node.create({
  name: 'pageRef', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes: () => ({ id: { default: null }, title: { default: 'Page' } }),
  parseHTML: () => [{ tag: 'a[data-page-ref]', getAttrs: (el) => ({ id: (el as HTMLElement).getAttribute('data-page-ref'), title: (el as HTMLElement).textContent }) }],
  renderHTML: ({ node }) => ['a', { 'data-page-ref': node.attrs.id, class: 'nb-ref page' }, `↗ ${node.attrs.title}`],
  renderText: ({ node }) => node.attrs.title,
  addNodeView() { return ReactNodeViewRenderer(({ node }: NodeViewProps) => <NodeViewWrapper as="span" className="nb-ref page"><button type="button" contentEditable={false} onClick={() => nav.page(node.attrs.id)}><Icon.wiki size={13} />{node.attrs.title || 'Untitled'}</button></NodeViewWrapper>); },
});
export const TaskRef = Node.create({
  name: 'taskRef', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes: () => ({ id: { default: null }, title: { default: 'Task' } }),
  parseHTML: () => [{ tag: 'a[data-task-ref]', getAttrs: (el) => ({ id: (el as HTMLElement).getAttribute('data-task-ref'), title: (el as HTMLElement).textContent }) }],
  renderHTML: ({ node }) => ['a', { 'data-task-ref': node.attrs.id, class: 'nb-ref task' }, node.attrs.title],
  renderText: ({ node }) => node.attrs.title,
  addNodeView() { return ReactNodeViewRenderer(({ node }: NodeViewProps) => <NodeViewWrapper as="span" className="nb-ref task"><button type="button" contentEditable={false} onClick={() => nav.task(node.attrs.id)}><Icon.checkSquare size={13} />{node.attrs.title}</button></NodeViewWrapper>); },
});
export const Mention = Node.create({
  name: 'mention', group: 'inline', inline: true, atom: true, selectable: false,
  addAttributes: () => ({ id: { default: null }, label: { default: '' } }),
  parseHTML: () => [{ tag: 'span[data-mention]', getAttrs: (el) => ({ id: (el as HTMLElement).getAttribute('data-mention'), label: (el as HTMLElement).textContent?.replace(/^@/, '') }) }],
  renderHTML: ({ node }) => ['span', { 'data-mention': node.attrs.id, class: 'nb-mention' }, `@${node.attrs.label}`],
  renderText: ({ node }) => `@${node.attrs.label}`,
});
export const Bookmark = Node.create({
  name: 'bookmark', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({ url: { default: '' }, title: { default: '' } }),
  parseHTML: () => [{ tag: 'div[data-bookmark]', getAttrs: (el) => ({ url: (el as HTMLElement).getAttribute('data-bookmark') }) }],
  renderHTML: ({ node }) => ['div', { 'data-bookmark': node.attrs.url, class: 'nb-bookmark' }, node.attrs.title || node.attrs.url],
  addNodeView() { return ReactNodeViewRenderer(({ node }: NodeViewProps) => { let host = ''; try { host = new URL(node.attrs.url).host; } catch { /* kept as typed */ }
    return <NodeViewWrapper className="nb-bookmark" data-drag-handle=""><a href={node.attrs.url} target="_blank" rel="noreferrer noopener" contentEditable={false}><span className="bk-ic"><Icon.link size={16} /></span><span><b>{node.attrs.title || host || node.attrs.url}</b><small>{node.attrs.url}</small></span><Icon.out size={14} /></a></NodeViewWrapper>; }); },
});
export const FileAttachment = Node.create({
  name: 'fileAttachment', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({ id: { default: null }, name: { default: 'file' }, size: { default: 0 } }),
  parseHTML: () => [{ tag: 'div[data-file]' }],
  renderHTML: ({ node }) => ['div', { 'data-file': node.attrs.id, class: 'nb-file' }, node.attrs.name],
  addNodeView() { return ReactNodeViewRenderer(({ node }: NodeViewProps) => <NodeViewWrapper className="nb-file"><a href={`/api/files/${node.attrs.id}/content?download=1`} contentEditable={false}><Icon.file size={18} /><span><b>{node.attrs.name}</b><small>{fileSize(node.attrs.size)}</small></span><Icon.download size={15} /></a></NodeViewWrapper>); },
});
// a live list of the page's headings
export const Toc = Node.create({
  name: 'toc', group: 'block', atom: true,
  parseHTML: () => [{ tag: 'nav[data-toc]' }], renderHTML: () => ['nav', { 'data-toc': '', class: 'nb-toc' }],
  addNodeView() { return ReactNodeViewRenderer(TocView); },
});
function TocView({ editor }: NodeViewProps) {
  const heads: { level: number; text: string; pos: number }[] = [];
  editor.state.doc.descendants((n, pos) => { if (n.type.name === 'heading') heads.push({ level: n.attrs.level, text: n.textContent, pos }); });
  return <NodeViewWrapper className="nb-toc" contentEditable={false}><b>Contents</b>{heads.length ? <ol>{heads.map((h) => <li key={h.pos} style={{ paddingLeft: (h.level - 1) * 14 }}>
    <button type="button" onClick={() => { editor.chain().focus().setTextSelection(h.pos + 1).run(); editor.view.domAtPos(h.pos + 1).node.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }}>{h.text || 'Untitled heading'}</button></li>)}</ol> : <p>Headings on this page appear here.</p>}</NodeViewWrapper>;
}

// Alt+Shift+Up / Down moves the block the cursor is in; Mod+Shift+D duplicates it.
export const BlockMoves = Extension.create({
  name: 'blockMoves',
  addKeyboardShortcuts() {
    const move = (dir: -1 | 1) => () => {
      const { state, view } = this.editor; const $from = state.selection.$from; if ($from.depth < 1) return false;
      const start = $from.before(1); const node = state.doc.nodeAt(start); if (!node) return false;
      const idx = $from.index(0); const sib = dir < 0 ? (idx > 0 ? state.doc.child(idx - 1) : null) : (idx < state.doc.childCount - 1 ? state.doc.child(idx + 1) : null); if (!sib) return true;
      const tr = state.tr; const offset = state.selection.from - start;
      if (dir < 0) { const to = start - sib.nodeSize; tr.delete(start, start + node.nodeSize).insert(to, node); tr.setSelection(TextSelection.near(tr.doc.resolve(to + offset))); }
      else { const after = start + node.nodeSize; tr.delete(after, after + sib.nodeSize).insert(start, sib); const np = start + sib.nodeSize; tr.setSelection(TextSelection.near(tr.doc.resolve(np + offset))); }
      view.dispatch(tr.scrollIntoView()); return true;
    };
    return {
      'Alt-Shift-ArrowUp': move(-1), 'Alt-Shift-ArrowDown': move(1),
      'Mod-Shift-d': () => { const { state, view } = this.editor; const $from = state.selection.$from; if ($from.depth < 1) return false; const start = $from.before(1); const node = state.doc.nodeAt(start)!; view.dispatch(state.tr.insert(start + node.nodeSize, node.copy(node.content))); return true; },
    };
  },
});
export { NodeSelection };

// A table of project tasks inside a page: the tasks themselves, live, not a copy. Link one, add a new one, open one.
const ST: Record<string, [string, string]> = { TODO: ['To do', '#3B82F6'], DOING: ['In progress', '#FF922E'], REVIEW: ['In review', '#A855F7'], DONE: ['Done', '#22C55E'] };
const PR: Record<string, [string, string]> = { URGENT: ['Urgent', '#F43F5E'], HIGH: ['High', '#F87171'], MEDIUM: ['Medium', '#F59E0B'], LOW: ['Low', '#94A3B8'], NONE: ['No priority', '#64748B'] };
export const LinkedTasks = Node.create({
  name: 'linkedTasks', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({ ids: { default: '' } }),
  parseHTML: () => [{ tag: 'div[data-linked-tasks]', getAttrs: (el) => ({ ids: (el as HTMLElement).getAttribute('data-linked-tasks') ?? '' }) }],
  renderHTML: ({ node }) => ['div', { 'data-linked-tasks': node.attrs.ids, class: 'nb-ltasks' }, 'Linked tasks'],
  addNodeView() { return ReactNodeViewRenderer(LinkedTasksView); },
});
function LinkedTasksView({ node, updateAttributes, editor }: NodeViewProps) {
  const [, setN] = useState(0);
  useEffect(() => { const h = () => setN((n) => n + 1); tasksChanged.addEventListener('changed', h); return () => tasksChanged.removeEventListener('changed', h); }, []);
  const ids: string[] = String(node.attrs.ids ?? '').split(',').filter(Boolean);
  const all = nav.tasks(); const rows = ids.map((id) => all.find((t) => t.id === id) ?? { id, title: '', status: '', priority: '', assignee_name: null, due_date: null, gone: true } as LinkedTask & { gone?: boolean });
  const add = (id: string) => { if (!ids.includes(id)) updateAttributes({ ids: [...ids, id].join(',') }); };
  const today = new Date().toLocaleDateString('en-CA'); const can = editor.isEditable;
  return <NodeViewWrapper className="nb-ltasks" data-linked-tasks={node.attrs.ids} contentEditable={false}>
    <div className="lt-h"><b><Icon.link size={15} />Linked tasks</b>{can && <span className="row" style={{ gap: 6 }}><button type="button" className="btn tiny" onClick={async () => { const t = await nav.pickTask(); if (t) add(t.id); }}>Link a task</button>
      <button type="button" className="btn tiny" onClick={async () => { const t = await nav.newTask(); if (t) add(t.id); }}><Icon.plus size={12} />New task</button></span>}</div>
    {rows.length ? <table className="lt-t"><thead><tr><th>Task</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Due date</th>{can && <th><span className="sr">Remove</span></th>}</tr></thead>
      <tbody>{rows.map((t: any) => t.gone ? <tr key={t.id}><td colSpan={5} className="faint">A task that was deleted or archived.</td>{can && <td><button type="button" className="icon-btn" onClick={() => updateAttributes({ ids: ids.filter((x) => x !== t.id).join(',') })} aria-label="Remove it from this table"><Icon.x size={13} /></button></td>}</tr>
        : <tr key={t.id} className={t.status === 'DONE' ? 'done' : ''}><td><button type="button" className="link-btn" onClick={() => nav.task(t.id)}>{t.title}<Icon.out size={12} /></button></td>
          <td><span className="lt-st" style={{ '--s': ST[t.status]?.[1] } as React.CSSProperties}><i />{ST[t.status]?.[0] ?? t.status}</span></td>
          <td><span className="lt-pr" style={{ color: PR[t.priority]?.[1] }}><i style={{ background: PR[t.priority]?.[1] }} />{PR[t.priority]?.[0] ?? ''}</span></td>
          <td>{t.assignee_name ?? <span className="faint">Unassigned</span>}</td>
          <td className={t.due_date && t.due_date < today && t.status !== 'DONE' ? 'late' : ''}>{t.due_date ? new Date(t.due_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : <span className="faint">No date</span>}</td>
          {can && <td><button type="button" className="icon-btn" onClick={() => updateAttributes({ ids: ids.filter((x) => x !== t.id).join(',') })} aria-label={`Unlink ${t.title}`}><Icon.x size={13} /></button></td>}</tr>)}</tbody></table>
      : <p className="faint lt-empty">No tasks linked yet. Link an existing task or add a new one; it shows on the board and the list too.</p>}
  </NodeViewWrapper>;
}
