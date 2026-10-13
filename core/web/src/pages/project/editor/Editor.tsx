import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Extension, type Range } from '@tiptap/core';
import { PluginKey, NodeSelection } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
import { Icon } from '../../../ui/icons.tsx';
import { Bookmark, BlockMoves, Callout, FileAttachment, Mention, PageRef, TaskRef, Toc } from './nodes.tsx';

const lowlight = createLowlight(common);
export type Hooks = {
  pickPage: () => Promise<{ id: string; title: string } | null>;
  pickTask: () => Promise<{ id: string; title: string } | null>;
  upload: (f: File) => Promise<{ id: string; name: string; size: number; mime: string } | null>;
  askLink: () => Promise<string | null>;
  people: { id: string; name: string; username?: string }[];
};
type Item = { title: string; hint: string; icon: keyof typeof Icon; keys: string; run: (e: Editor, r: Range) => void | Promise<void> };
const pickFile = (accept: string) => new Promise<File | null>((ok) => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => ok(i.files?.[0] ?? null); i.click(); });

function slashItems(h: { current: Hooks }): Item[] {
  const set = (fn: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => (e: Editor, r: Range) => { fn(e.chain().focus().deleteRange(r)).run(); };
  return [
    { title: 'Text', hint: 'Plain paragraph', icon: 'edit', keys: 'text paragraph p', run: set((c) => c.setParagraph()) },
    { title: 'Heading 1', hint: 'Big section title', icon: 'heading', keys: 'heading h1 title', run: set((c) => c.setHeading({ level: 1 })) },
    { title: 'Heading 2', hint: 'Medium section title', icon: 'heading', keys: 'heading h2 subtitle', run: set((c) => c.setHeading({ level: 2 })) },
    { title: 'Heading 3', hint: 'Small section title', icon: 'heading', keys: 'heading h3', run: set((c) => c.setHeading({ level: 3 })) },
    { title: 'Bulleted list', hint: 'A simple list', icon: 'list', keys: 'bullet list ul', run: set((c) => c.toggleBulletList()) },
    { title: 'Numbered list', hint: 'A list with numbers', icon: 'listOl', keys: 'numbered ordered list ol', run: set((c) => c.toggleOrderedList()) },
    { title: 'To-do list', hint: 'Things to tick off', icon: 'checkSquare', keys: 'todo task checklist check', run: set((c) => c.toggleTaskList()) },
    { title: 'Toggle list', hint: 'Hide details under a line', icon: 'toggle', keys: 'toggle details collapse', run: set((c) => c.setDetails()) },
    { title: 'Quote', hint: 'Someone’s words', icon: 'quote', keys: 'quote blockquote', run: set((c) => c.toggleBlockquote()) },
    { title: 'Callout', hint: 'A note that stands out', icon: 'info', keys: 'callout note info warning', run: set((c) => c.insertContent({ type: 'callout', attrs: { tone: 'info' }, content: [{ type: 'paragraph' }] })) },
    { title: 'Divider', hint: 'A line between sections', icon: 'minus', keys: 'divider hr line rule', run: set((c) => c.setHorizontalRule()) },
    { title: 'Code', hint: 'Code with highlighting', icon: 'code', keys: 'code snippet pre', run: set((c) => c.toggleCodeBlock()) },
    { title: 'Table', hint: 'Rows and columns', icon: 'table', keys: 'table grid', run: set((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true })) },
    { title: 'Table of contents', hint: 'The page’s headings', icon: 'list', keys: 'toc contents', run: set((c) => c.insertContent({ type: 'toc' })) },
    { title: 'Image', hint: 'Upload a picture', icon: 'image', keys: 'image picture photo', run: async (e, r) => { e.chain().focus().deleteRange(r).run(); const f = await pickFile('image/png,image/jpeg,image/gif,image/webp'); if (!f) return; const u = await h.current.upload(f); if (u) e.chain().focus().setImage({ src: `/api/files/${u.id}/content`, alt: u.name }).run(); } },
    { title: 'File', hint: 'Attach a file', icon: 'file', keys: 'file attachment upload pdf', run: async (e, r) => { e.chain().focus().deleteRange(r).run(); const f = await pickFile(''); if (!f) return; const u = await h.current.upload(f); if (u) e.chain().focus().insertContent({ type: 'fileAttachment', attrs: { id: u.id, name: u.name, size: u.size } }).run(); } },
    { title: 'Link', hint: 'A web page as a card', icon: 'link', keys: 'link bookmark url web', run: async (e, r) => { e.chain().focus().deleteRange(r).run(); const url = await h.current.askLink(); if (url) e.chain().focus().insertContent({ type: 'bookmark', attrs: { url, title: '' } }).run(); } },
    { title: 'Page link', hint: 'Link another page here', icon: 'wiki', keys: 'page link reference', run: async (e, r) => { e.chain().focus().deleteRange(r).run(); const p = await h.current.pickPage(); if (p) e.chain().focus().insertContent([{ type: 'pageRef', attrs: p }, { type: 'text', text: ' ' }]).run(); } },
    { title: 'Task', hint: 'Refer to a task', icon: 'checkSquare', keys: 'task reference ticket', run: async (e, r) => { e.chain().focus().deleteRange(r).run(); const t = await h.current.pickTask(); if (t) e.chain().focus().insertContent([{ type: 'taskRef', attrs: t }, { type: 'text', text: ' ' }]).run(); } },
  ];
}

type Menu = { items: any[]; index: number; rect: DOMRect | null; command: (it: any) => void; kind: 'slash' | 'mention' } | null;
// one suggestion popup, shared by "/" commands and "@" mentions
function suggest(name: string, char: string, items: (q: string) => any[], kind: 'slash' | 'mention', menu: { set: (m: Menu) => void; get: () => Menu }) {
  return Extension.create({
    name,
    addProseMirrorPlugins() {
      return [Suggestion({
        editor: this.editor, char, pluginKey: new PluginKey(name), allowSpaces: false, startOfLine: false,
        items: ({ query }) => items(query),
        command: ({ editor, range, props }) => (props as any).run(editor, range),
        render: () => ({
          onStart: (p) => menu.set({ items: p.items, index: 0, rect: p.clientRect?.() ?? null, command: (it) => p.command(it), kind }),
          onUpdate: (p) => menu.set({ items: p.items, index: 0, rect: p.clientRect?.() ?? null, command: (it) => p.command(it), kind }),
          onKeyDown: ({ event }) => {
            const m = menu.get(); if (!m) return false;
            if (event.key === 'Escape') { menu.set(null); return true; }
            if (event.key === 'ArrowDown') { menu.set({ ...m, index: (m.index + 1) % Math.max(1, m.items.length) }); return true; }
            if (event.key === 'ArrowUp') { menu.set({ ...m, index: (m.index - 1 + m.items.length) % Math.max(1, m.items.length) }); return true; }
            if (event.key === 'Enter' || event.key === 'Tab') { const it = m.items[m.index]; if (it) { m.command(it); menu.set(null); return true; } }
            return false;
          },
          onExit: () => menu.set(null),
        }),
      })];
    },
  });
}

export function NoteEditor({ content, editable, onChange, hooks, onEditor }: { content: any; editable: boolean; onChange?: (doc: any) => void; hooks?: Hooks; onEditor?: (e: Editor) => void }) {
  const h = useRef<Hooks>(hooks!); h.current = hooks!;
  const [menu, setMenuState] = useState<Menu>(null); const menuRef = useRef<Menu>(null);
  const menuApi = useMemo(() => ({ set: (m: Menu) => { menuRef.current = m; setMenuState(m); }, get: () => menuRef.current }), []);
  const items = useMemo(() => slashItems(h), []);
  const extensions = useMemo(() => [
    StarterKit.configure({ codeBlock: false, link: { openOnClick: false, autolink: true, defaultProtocol: 'https', isAllowedUri: (url, ctx) => /^(https?:|mailto:|\/)/i.test(url) && ctx.defaultValidate(url) } }),
    TaskList, TaskItem.configure({ nested: true }), TableKit.configure({ table: { resizable: false } }),
    Details.configure({ persist: true, HTMLAttributes: { class: 'nb-details' } }), DetailsSummary, DetailsContent,
    Highlight.configure({ multicolor: true }), TextStyle, Color, Image.configure({ allowBase64: false }),
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    Placeholder.configure({ placeholder: ({ node }) => node.type.name === 'heading' ? 'Heading' : 'Type / for blocks, @ for people', includeChildren: false }),
    Callout, PageRef, TaskRef, Mention, Bookmark, FileAttachment, Toc, BlockMoves,
    suggest('slash', '/', (q) => items.filter((i) => !q || i.title.toLowerCase().includes(q.toLowerCase()) || i.keys.includes(q.toLowerCase())).slice(0, 12), 'slash', menuApi),
    suggest('mentionSuggest', '@', (q) => (h.current?.people ?? []).filter((u) => u.name.toLowerCase().includes(q.toLowerCase()) || (u.username ?? '').includes(q.toLowerCase())).slice(0, 8)
      .map((u) => ({ title: u.name, hint: u.username ? `@${u.username}` : '', icon: 'user', run: (e: Editor, r: Range) => e.chain().focus().deleteRange(r).insertContent([{ type: 'mention', attrs: { id: u.id, label: u.username ?? u.name } }, { type: 'text', text: ' ' }]).run() })), 'mention', menuApi),
  ], []); // eslint-disable-line react-hooks/exhaustive-deps
  const editor = useEditor({
    extensions, content, editable, immediatelyRender: true,
    editorProps: { attributes: { class: 'nb-doc', 'aria-label': 'Page content', role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor: e }) => onChange?.(e.getJSON()),
  });
  useEffect(() => { if (editor) onEditor?.(editor); }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { editor?.setEditable(editable); }, [editable, editor]);
  if (!editor) return null;
  return (
    <div className="nb-wrap">
      {editable && <Toolbar editor={editor} hooks={h} />}
      {editable && <DragHandle editor={editor} />}
      <EditorContent editor={editor} />
      {menu && menu.items.length > 0 && menu.rect && createPortal(<div className="nb-menu" role="listbox" aria-label={menu.kind === 'slash' ? 'Blocks' : 'People'} style={{ top: Math.min(menu.rect.bottom + 6, innerHeight - 340), left: Math.max(8, Math.min(menu.rect.left, innerWidth - 300)) }}>
        {menu.items.map((it, i) => { const I = Icon[it.icon as keyof typeof Icon] ?? Icon.edit; return (
          <button key={it.title} type="button" role="option" aria-selected={i === menu.index} className={i === menu.index ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); menu.command(it); menuApi.set(null); }} onMouseEnter={() => menuApi.set({ ...menu, index: i })}>
            <span className="nb-menu-ic"><I size={16} /></span><span><b>{it.title}</b><small>{it.hint}</small></span></button>); })}</div>, document.body)}
    </div>
  );
}

const COLORS = [['Default', ''], ['Orange', '#FB923C'], ['Blue', '#60A5FA'], ['Violet', '#C084FC'], ['Green', '#4ADE80'], ['Red', '#F87171'], ['Grey', '#9CA3AF']];
const MARKS = [['Yellow', '#FDE68A55'], ['Orange', '#FDBA7455'], ['Blue', '#93C5FD55'], ['Green', '#86EFAC55'], ['Pink', '#F9A8D455']];
function Toolbar({ editor, hooks }: { editor: Editor; hooks: { current: Hooks } }) {
  const btn = (label: string, I: keyof typeof Icon, on: boolean, run: () => void) => <button type="button" className={on ? 'on' : ''} aria-pressed={on} aria-label={label} title={label} onMouseDown={(e) => e.preventDefault()} onClick={run}>{(() => { const C = Icon[I]; return <C size={15} />; })()}</button>;
  const c = () => editor.chain().focus();
  return (
    <BubbleMenu editor={editor} className="nb-bubble" shouldShow={({ editor: e, state }) => e.isEditable && !state.selection.empty && !(state.selection instanceof NodeSelection)}>
      <select aria-label="Turn into" value={editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : editor.isActive('bulletList') ? 'ul' : editor.isActive('orderedList') ? 'ol' : editor.isActive('taskList') ? 'todo' : editor.isActive('blockquote') ? 'quote' : 'p'}
        onChange={(e) => { const v = e.target.value; const ch = c(); (v === 'p' ? ch.setParagraph() : v === 'h1' ? ch.setHeading({ level: 1 }) : v === 'h2' ? ch.setHeading({ level: 2 }) : v === 'h3' ? ch.setHeading({ level: 3 }) : v === 'ul' ? ch.toggleBulletList() : v === 'ol' ? ch.toggleOrderedList() : v === 'todo' ? ch.toggleTaskList() : ch.toggleBlockquote()).run(); }}>
        <option value="p">Text</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="ul">Bulleted</option><option value="ol">Numbered</option><option value="todo">To-do</option><option value="quote">Quote</option></select>
      {btn('Bold', 'bold', editor.isActive('bold'), () => c().toggleBold().run())}
      {btn('Italic', 'italic', editor.isActive('italic'), () => c().toggleItalic().run())}
      {btn('Underline', 'underline', editor.isActive('underline'), () => c().toggleUnderline().run())}
      {btn('Strikethrough', 'strike', editor.isActive('strike'), () => c().toggleStrike().run())}
      {btn('Inline code', 'code', editor.isActive('code'), () => c().toggleCode().run())}
      {btn('Link', 'link', editor.isActive('link'), async () => { if (editor.isActive('link')) { c().unsetLink().run(); return; } const url = await hooks.current.askLink(); if (url) c().extendMarkRange('link').setLink({ href: url }).run(); })}
      <select aria-label="Text colour" value="" onChange={(e) => { const v = e.target.value; if (v === 'none') c().unsetColor().run(); else if (v) c().setColor(v).run(); }}><option value="">A</option>{COLORS.map(([l, v]) => <option key={l} value={v || 'none'}>{l}</option>)}</select>
      <select aria-label="Highlight" value="" onChange={(e) => { const v = e.target.value; if (v === 'none') c().unsetHighlight().run(); else if (v) c().setHighlight({ color: v }).run(); }}><option value="">Mark</option>{MARKS.map(([l, v]) => <option key={l} value={v}>{l}</option>)}<option value="none">None</option></select>
    </BubbleMenu>
  );
}

// a grip beside the block under the pointer: drag it to move the block, click it to select the block
function DragHandle({ editor }: { editor: Editor }) {
  const [at, setAt] = useState<{ top: number; pos: number } | null>(null); const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    const move = (e: MouseEvent) => {
      const r = dom.getBoundingClientRect(); const hit = editor.view.posAtCoords({ left: r.left + 24, top: e.clientY }); if (!hit) return;
      const $p = editor.state.doc.resolve(hit.pos); if ($p.depth < 1 && !editor.state.doc.nodeAt(hit.pos)) return;
      const pos = $p.depth >= 1 ? $p.before(1) : hit.pos; const node = editor.view.nodeDOM(pos) as HTMLElement | null; if (!node || !node.getBoundingClientRect) return;
      const host = wrap.current?.parentElement?.getBoundingClientRect(); if (!host) return;
      setAt({ top: node.getBoundingClientRect().top - host.top + 2, pos });
    };
    const leave = (e: MouseEvent) => { if (!wrap.current?.contains(e.relatedTarget as Node)) setAt(null); };
    dom.addEventListener('mousemove', move); dom.addEventListener('mouseleave', leave);
    return () => { dom.removeEventListener('mousemove', move); dom.removeEventListener('mouseleave', leave); };
  }, [editor]);
  const select = () => { if (!at) return; editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, at.pos))); editor.view.focus(); };
  return <div ref={wrap} className="nb-grip" style={{ top: at?.top ?? 0, opacity: at ? 1 : 0 }} draggable aria-hidden="true" title="Drag to move, click to select. Alt+Shift+Up or Down moves the block from the keyboard."
    onClick={select}
    onDragStart={(e) => { if (!at) return; select(); const sel = editor.state.selection as NodeSelection; (editor.view as any).dragging = { slice: sel.content(), move: true };
      const node = editor.view.nodeDOM(at.pos) as HTMLElement; if (node) e.dataTransfer.setDragImage(node, 0, 0); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); }}>
    <Icon.grip size={16} /></div>;
}
