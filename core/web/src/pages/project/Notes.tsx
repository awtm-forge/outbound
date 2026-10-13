// Project notes: a page list (pinned, folders and pages, recent, archived, search) beside a document editor with a
// formatting toolbar, linked tasks, comments with replies, version history and an AI assistant whose suggestions are
// previews until someone chooses to add them. Everyone signed in can read and edit project notes, as with tasks.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { api, ApiError } from '../../api.ts';
import { Link, useRouter } from '../../router.tsx';
import { useLoad, useMedia } from '../../ui/hooks.ts';
import { Icon, Dots } from '../../ui/icons.tsx';
import { Menu, MenuItem } from '../../ui/menu.tsx';
import { Modal, useConfirm } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Empty, Failure, Skeleton, Spinner, ago } from '../../ui/kit.tsx';
import { isAdmin, useMe, useTeam } from '../../session.tsx';
import { FixedToolbar, NoteEditor, type Hooks } from './editor/Editor.tsx';
import { nav, tasksChanged } from './editor/nodes.tsx';
import { TEMPLATES } from './editor/templates.ts';
import { Avatar, PRIORITY, StatusDot } from './shared.tsx';
import type { WS } from './Workspace.tsx';

type PageRow = { id: string; parent_id: string | null; title: string; icon: string | null; kind: 'page' | 'folder'; position: number; archived_at: string | null; created_at: string; updated_at: string; updated_by_name: string | null; starred: boolean; created_by: string };
type Sort = 'manual' | 'title' | 'created' | 'updated';
const EMOJI = ['📄', '🎯', '📝', '🗓️', '📈', '🛠️', '🐞', '🔁', '💬', '📋', '🧾', '🚀', '🎨', '💡', '📦', '🔒', '🌐', '⚙️', '📊', '✅', '🔎', '📁'];
const FIRST = ['blank', 'meeting', 'brief', 'spec', 'requirements', 'retro', 'research', 'checklist'];
const ORDERED = [...TEMPLATES].sort((a, b) => (FIRST.indexOf(a.id) + 1 || 99) - (FIRST.indexOf(b.id) + 1 || 99));
const untitled = (t?: string | null) => t || 'Untitled';
// the server stores documents as jsonb, which reorders keys; compare with the keys sorted
const canon = (o: unknown) => JSON.stringify(o, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
const glyph = (g: { icon: string | null; kind?: string }) => g.icon ?? (g.kind === 'folder' ? '📁' : '📄');
const AI: { id: string; label: string; hint: string }[] = [
  { id: 'summarize', label: 'Summarize this page', hint: 'A short summary and key points' }, { id: 'improve', label: 'Improve the writing', hint: 'Clearer and shorter, same meaning' },
  { id: 'action_items', label: 'Turn notes into action items', hint: 'What the notes say needs doing' }, { id: 'extract_tasks', label: 'Extract tasks', hint: 'Work described here, as task titles' },
  { id: 'brief', label: 'Draft a project brief', hint: 'From the project’s own details' }, { id: 'checklist', label: 'Checklist from the spec', hint: 'Verifiable items' },
];

export default function Notes({ ws, pageId }: { ws: WS; pageId?: string }) {
  const { p } = ws; const { go, search } = useRouter(); const toast = useToast(); const ask = useConfirm();
  const pages = useLoad<PageRow[]>(() => api.get(`/api/projects/${p.id}/pages`), [p.id]);
  const [choose, setChoose] = useState<{ parent: string | null } | null>(search.get('new') === '1' ? { parent: null } : null);
  const [drawer, setDrawer] = useState(false); const narrow = useMedia('(max-width: 900px)');
  useEffect(() => { if (search.get('new') === '1') { setChoose({ parent: null }); go(`/projects/${p.id}/notes${pageId ? '/' + pageId : ''}`, true); } }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDrawer(false); }, [pageId]);
  // what the editor's page links, task links and linked-task tables reach
  nav.page = (id) => go(`/projects/${p.id}/notes/${id}`); nav.task = (id) => ws.openTask(id);
  nav.tasks = () => p.task_list.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, assignee_name: t.assignee_name, due_date: t.due_date }));
  useEffect(() => { tasksChanged.dispatchEvent(new Event('changed')); }, [p.task_list]);
  const create = async (parent: string | null, body: object) => {
    try { const g = await api.post(`/api/projects/${p.id}/pages`, { parent_id: parent, ...body }); setChoose(null); pages.reload(true); go(`/projects/${p.id}/notes/${g.id}`); } catch (e: any) { toast(e.message, { err: true }); }
  };
  const newFolder = async (parent: string | null) => { const n = await ask({ title: 'New folder', input: { label: 'Folder name', required: true, max: 200 }, confirm: 'Create folder' }); if (typeof n === 'string' && n) create(parent, { title: n, kind: 'folder' }); };
  const list = pages.data ?? [];
  const side = <Sidebar ws={ws} pages={list} loading={pages.loading && !pages.data} error={pages.error} reload={() => pages.reload(true)} current={pageId} onNew={(parent) => setChoose({ parent })} onFolder={newFolder} />;
  return (
    <div className="notes2">
      {narrow ? <button type="button" className="btn nside-tog" onClick={() => setDrawer(true)}><Icon.list size={15} />Pages</button> : side}
      {narrow && drawer && <Modal title="Pages" onClose={() => setDrawer(false)}>{side}</Modal>}
      <div className="ndoc-wrap">
        {pageId ? <PageView key={pageId} ws={ws} id={pageId} pages={list} onTreeChange={() => pages.reload(true)} onNew={(parent) => setChoose({ parent })} />
          : <NotesHome ws={ws} pages={list} loading={pages.loading && !pages.data} onNew={() => setChoose({ parent: null })} />}
      </div>
      {choose && <NewPage parent={choose.parent} onClose={() => setChoose(null)} onCreate={(body) => create(choose.parent, body)} onFolder={() => { const parent = choose.parent; setChoose(null); newFolder(parent); }} />}
    </div>
  );
}

function NewPage({ parent, onClose, onCreate, onFolder }: { parent: string | null; onClose: () => void; onCreate: (b: object) => void; onFolder: () => void }) {
  const custom = useLoad<any[]>(() => api.get('/api/page-templates'));
  return <Modal title={parent ? 'New page inside this one' : 'New page'} onClose={onClose} wide>
    <div className="tpl-grid">{ORDERED.map((t) => <button key={t.id} type="button" className="tpl" onClick={() => onCreate({ title: t.id === 'blank' ? '' : t.title, icon: t.id === 'blank' ? null : t.icon, content: t.content() })}><span className="tpl-ic" aria-hidden="true">{t.icon}</span><b>{t.title}</b><small>{t.hint}</small></button>)}
      <button type="button" className="tpl" onClick={onFolder}><span className="tpl-ic" aria-hidden="true">📁</span><b>Folder</b><small>Group pages together</small></button></div>
    <h3 className="ntpl-h">Your team’s templates</h3>
    {custom.loading && !custom.data ? <Skeleton h={60} /> : custom.data?.length ? <div className="tpl-grid">{custom.data.map((t) => <button key={t.id} type="button" className="tpl" onClick={() => onCreate({ from_template: t.id })}><span className="tpl-ic" aria-hidden="true">{t.icon ?? '🧩'}</span><b>{untitled(t.title)}</b><small>{t.created_by_name ?? 'Someone'} · {t.project_name}</small></button>)}</div>
      : <p className="faint">None yet. Open any page and choose Save as template from its menu.</p>}
  </Modal>;
}

function NotesHome({ ws, pages, loading, onNew }: { ws: WS; pages: PageRow[]; loading: boolean; onNew: () => void }) {
  const recent = [...pages].filter((g) => g.kind === 'page').sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 8); const starred = pages.filter((g) => g.starred);
  if (loading) return <Skeleton h={300} />;
  if (!pages.length) return <div className="panel ndoc-empty"><Empty title="No pages yet" action={<button className="btn primary" onClick={onNew}><Icon.plus size={16} />New page</button>}>Briefs, meeting notes, specs and checklists for this project, in folders and pages inside pages. Start from a template or a blank page.</Empty></div>;
  const card = (g: PageRow) => <Link key={g.id} to={`/projects/${ws.p.id}/notes/${g.id}`} className="note-card"><span className="nc-ic" aria-hidden="true">{glyph(g)}</span><b>{untitled(g.title)}</b><small>Edited {ago(g.updated_at)}{g.updated_by_name ? ` by ${g.updated_by_name}` : ''}</small></Link>;
  return <div className="panel ndoc-home">
    {starred.length > 0 && <section aria-labelledby="st-h"><h2 id="st-h" className="notes-h"><Icon.star size={15} />Pinned</h2><div className="note-cards">{starred.map(card)}</div></section>}
    <section aria-labelledby="rc-h"><h2 id="rc-h" className="notes-h"><Icon.clock size={15} />Recently edited</h2>{recent.length ? <div className="note-cards">{recent.map(card)}</div> : <p className="faint">Only folders so far. Add a page inside one.</p>}</section>
  </div>;
}

// ---------- the page list ----------
function Sidebar({ ws, pages, loading, error, reload, current, onNew, onFolder }: { ws: WS; pages: PageRow[]; loading: boolean; error: string | null; reload: () => void; current?: string; onNew: (parent: string | null) => void; onFolder: (parent: string | null) => void }) {
  const toast = useToast(); const ask = useConfirm(); const me = useMe(); const { go } = useRouter();
  const key = `awtm-tree-${ws.p.id}`;
  const [open, setOpenState] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]')); } catch { return new Set(); } });
  const setOpen = (s: Set<string>) => { setOpenState(s); try { localStorage.setItem(key, JSON.stringify([...s])); } catch { /* */ } };
  const [sort, setSortS] = useState<Sort>(() => { try { return (localStorage.getItem('awtm-notes-sort') as Sort) || 'manual'; } catch { return 'manual'; } });
  const setSort = (s: Sort) => { setSortS(s); try { localStorage.setItem('awtm-notes-sort', s); } catch { /* */ } };
  const [shut, setShut] = useState<Set<string>>(new Set());
  const [q, setQ] = useState(''); const [hits, setHits] = useState<any[] | null>(null); const [archived, setArchived] = useState<PageRow[] | null>(null);
  const [drag, setDrag] = useState<string | null>(null); const [over, setOver] = useState<string | null>(null);
  useEffect(() => { if (q.trim().length < 2) { setHits(null); return; } const t = setTimeout(async () => { try { setHits(await api.get<any[]>(`/api/projects/${ws.p.id}/pages/search?q=${encodeURIComponent(q.trim())}`)); } catch { setHits([]); } }, 220); return () => clearTimeout(t); }, [q, ws.p.id]);
  useEffect(() => { if (!current) return; const s = new Set(open); let x = pages.find((g) => g.id === current); let changed = false; while (x?.parent_id) { if (!s.has(x.parent_id)) { s.add(x.parent_id); changed = true; } x = pages.find((g) => g.id === x!.parent_id); } if (changed) setOpen(s); }, [current, pages]); // eslint-disable-line react-hooks/exhaustive-deps
  const kids = useMemo(() => { const m = new Map<string | null, PageRow[]>(); for (const g of pages) m.set(g.parent_id, [...(m.get(g.parent_id) ?? []), g]);
    const cmp = (a: PageRow, b: PageRow) => sort === 'title' ? untitled(a.title).localeCompare(untitled(b.title)) : sort === 'created' ? b.created_at.localeCompare(a.created_at) : sort === 'updated' ? b.updated_at.localeCompare(a.updated_at) : a.position - b.position;
    for (const l of m.values()) l.sort((a, b) => (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1) || cmp(a, b)); return m; }, [pages, sort]);
  const patch = async (id: string, b: object, msg?: string) => { try { await api.patch(`/api/pages/${id}`, b); reload(); if (msg) toast(msg); } catch (e: any) { toast(e.message, { err: true }); } };
  const moveTo = (g: PageRow, parent: string | null) => patch(g.id, { parent_id: parent }, 'Page moved.');
  const reorder = (g: PageRow, dir: -1 | 1) => { const sib = (kids.get(g.parent_id) ?? []).slice().sort((a, b) => a.position - b.position); const i = sib.findIndex((x) => x.id === g.id); const a = sib[i + dir]; if (!a) return; const b = sib[i + 2 * dir]; patch(g.id, { position: b ? (a.position + b.position) / 2 : a.position + dir }); if (sort !== 'manual') setSort('manual'); };
  const loadArchived = async () => { try { setArchived(await api.get(`/api/projects/${ws.p.id}/pages?archived=1`)); } catch (e: any) { toast(e.message, { err: true }); } };
  const descendants = (id: string): Set<string> => { const s = new Set<string>([id]); let grew = true; while (grew) { grew = false; for (const g of pages) if (g.parent_id && s.has(g.parent_id) && !s.has(g.id)) { s.add(g.id); grew = true; } } return s; };
  const rename = async (g: PageRow) => { const n = await ask({ title: g.kind === 'folder' ? 'Rename folder' : 'Rename page', input: { label: 'Name', required: true, value: g.title, max: 200 }, confirm: 'Rename' }); if (typeof n === 'string' && n && n !== g.title) patch(g.id, { title: n }, 'Renamed.'); };
  const menu = (g: PageRow) => <Menu label={`${g.kind === 'folder' ? 'Folder' : 'Page'} ${untitled(g.title)}`} className="icon-btn tn-more" button={<Dots vertical size={14} />} place="left">{(close) => <>
    <MenuItem onSelect={() => { close(); onNew(g.id); }}><Icon.plus size={15} />New page inside</MenuItem>
    {g.kind === 'folder' && <MenuItem onSelect={() => { close(); onFolder(g.id); }}><Icon.folder size={15} />New folder inside</MenuItem>}
    <MenuItem onSelect={() => { close(); rename(g); }}><Icon.edit size={15} />Rename</MenuItem>
    <MenuItem onSelect={() => { close(); patch(g.id, { starred: !g.starred }, g.starred ? 'Unpinned.' : 'Pinned.'); }}><Icon.star size={15} />{g.starred ? 'Unpin' : 'Pin'}</MenuItem>
    {g.kind === 'page' && <MenuItem onSelect={async () => { close(); try { const d = await api.post(`/api/pages/${g.id}/duplicate`, {}); reload(); go(`/projects/${ws.p.id}/notes/${d.id}`); } catch (e: any) { toast(e.message, { err: true }); } }}><Icon.copy size={15} />Duplicate</MenuItem>}
    <MenuItem onSelect={() => { close(); reorder(g, -1); }}><Icon.left size={15} />Move up</MenuItem>
    <MenuItem onSelect={() => { close(); reorder(g, 1); }}><Icon.right size={15} />Move down</MenuItem>
    <div className="menu-item" role="none"><Icon.layers size={15} /><select aria-label={`Move ${untitled(g.title)} into`} value="" onClick={(e) => e.stopPropagation()} onChange={(e) => { close(); moveTo(g, e.target.value === 'root' ? null : e.target.value); }}>
      <option value="">Move into…</option>{g.parent_id && <option value="root">Top level</option>}{pages.filter((x) => !descendants(g.id).has(x.id) && x.id !== g.parent_id).map((x) => <option key={x.id} value={x.id}>{glyph(x)} {untitled(x.title)}</option>)}</select></div>
    <div className="menu-sep" /><MenuItem onSelect={() => { close(); patch(g.id, { archived: true }, 'Archived. Find it under Archived.'); if (current && descendants(g.id).has(current)) go(`/projects/${ws.p.id}/notes`); }}><Icon.archive size={15} />Archive</MenuItem></>}</Menu>;
  const node = (g: PageRow, depth: number): React.ReactNode => {
    const ch = kids.get(g.id) ?? []; const isOpen = open.has(g.id); const folder = g.kind === 'folder';
    return <li key={g.id} role="treeitem" aria-expanded={ch.length || folder ? isOpen : undefined} aria-selected={current === g.id} aria-level={depth + 1}>
      <div className={`tn${current === g.id ? ' on' : ''}${over === g.id ? ' over' : ''}${folder ? ' folder' : ''}`} style={{ paddingLeft: 4 + depth * 14 }} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', g.id); setDrag(g.id); }} onDragEnd={() => { setDrag(null); setOver(null); }}
        onDragOver={(e) => { if (drag && !descendants(drag).has(g.id)) { e.preventDefault(); setOver(g.id); } }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); setOver(null); if (drag && drag !== g.id) { const d = pages.find((x) => x.id === drag)!; moveTo(d, g.id); setOpen(new Set([...open, g.id])); } }}>
        <button type="button" className="tn-tog" onClick={() => { const s = new Set(open); isOpen ? s.delete(g.id) : s.add(g.id); setOpen(s); }} aria-label={isOpen ? `Collapse ${untitled(g.title)}` : `Expand ${untitled(g.title)}`} style={{ visibility: ch.length || folder ? 'visible' : 'hidden' }} tabIndex={ch.length || folder ? 0 : -1}><span className={`chev${isOpen ? ' open' : ''}`}><Icon.right size={11} /></span></button>
        {folder ? <button type="button" className="tn-link" onClick={() => go(`/projects/${ws.p.id}/notes/${g.id}`)}><span aria-hidden="true">{g.icon ?? <Icon.folder size={15} />}</span><span className="tn-t">{untitled(g.title)}</span></button>
          : <Link to={`/projects/${ws.p.id}/notes/${g.id}`} className="tn-link"><span aria-hidden="true">{g.icon ?? <Icon.file size={14} />}</span><span className="tn-t">{untitled(g.title)}</span></Link>}
        {g.starred && <Icon.star size={12} />}
        <button type="button" className="icon-btn tn-add" onClick={() => onNew(g.id)} aria-label={`New page inside ${untitled(g.title)}`}><Icon.plus size={13} /></button>
        {menu(g)}
      </div>
      {(ch.length > 0 || folder) && isOpen && <ul role="group">{ch.map((c) => node(c, depth + 1))}{!ch.length && <li className="tn-empty" style={{ paddingLeft: 30 + depth * 14 }}>Empty folder</li>}</ul>}
    </li>;
  };
  const sec = (k: string, label: string, children: React.ReactNode, extra?: React.ReactNode) => <section className="nsec"><div className="nsec-h"><h3>{label}</h3>{extra}<button type="button" className="icon-btn" aria-expanded={!shut.has(k)} aria-label={`${shut.has(k) ? 'Show' : 'Hide'} ${label.toLowerCase()}`} onClick={() => setShut((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })}>{shut.has(k) ? <Icon.plus size={12} /> : <Icon.minus size={12} />}</button></div>{!shut.has(k) && children}</section>;
  const recent = [...pages].filter((g) => g.kind === 'page').sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);
  return (
    <aside className="panel nside" aria-label="Pages">
      <div className="nside-head"><h2>Pages</h2><button type="button" className="btn tiny primary" onClick={() => onNew(null)}><Icon.plus size={13} />New page</button></div>
      <label className="tb-search"><Icon.find size={14} /><input placeholder="Search pages..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search pages and their text" /></label>
      {hits ? <ul className="ntree-hits" aria-label="Search results">{hits.length ? hits.map((x) => <li key={x.id}><Link to={`/projects/${ws.p.id}/notes/${x.id}`} onClick={() => setQ('')}><b>{x.icon ?? '📄'} <Mark s={x.title} term={q} /></b>{x.snippet && <small><Marked s={x.snippet} /></small>}<span className="faint">{ago(x.updated_at)}</span></Link></li>) : <li className="faint">No page has those words.</li>}</ul> : <>
        {pages.some((g) => g.starred) && sec('pinned', 'Pinned', <ul className="ntree-flat">{pages.filter((g) => g.starred).map((g) => <li key={g.id}><Link to={`/projects/${ws.p.id}/notes/${g.id}`} className={current === g.id ? 'on' : ''}><span aria-hidden="true">{glyph(g)}</span><span className="tn-t">{untitled(g.title)}</span><Icon.star size={12} /></Link></li>)}</ul>)}
        {sec('pages', 'Project pages', loading ? <Skeleton h={120} /> : error ? <Failure error={error} retry={reload} /> : <>
          <ul role="tree" aria-label="Pages and folders" className="ntree-list" onDragOver={(e) => { if (drag) e.preventDefault(); }} onDrop={(e) => { if (e.target === e.currentTarget && drag) { const d = pages.find((x) => x.id === drag)!; moveTo(d, null); } }}>{(kids.get(null) ?? []).map((g) => node(g, 0))}</ul>
          {!pages.length && <p className="faint ntree-tip">No pages yet.</p>}
          {drag && <p className="faint ntree-tip">Drop on a page or folder to put it inside, or on empty space for the top level.</p>}</>,
          <Menu label="Page list options" className="icon-btn" button={<Icon.sort size={13} />} place="left">{(close) => <>
            <MenuItem onSelect={() => { close(); onFolder(null); }}><Icon.folder size={15} />New folder</MenuItem><div className="menu-sep" />
            {([['manual', 'Your order'], ['title', 'Title'], ['created', 'Newest first'], ['updated', 'Last updated']] as const).map(([k, l]) => <MenuItem key={k} onSelect={() => { close(); setSort(k); }}>{sort === k ? <Icon.check size={15} /> : <span style={{ width: 15 }} />}Sort: {l}</MenuItem>)}</>}</Menu>)}
        {recent.length > 0 && sec('recent', 'Recent pages', <ul className="ntree-flat">{recent.map((g) => <li key={g.id}><Link to={`/projects/${ws.p.id}/notes/${g.id}`} className={current === g.id ? 'on' : ''}><Icon.clock size={13} /><span className="tn-t">{untitled(g.title)}</span><small className="faint">{ago(g.updated_at)}</small></Link></li>)}</ul>)}
        <section className="nsec"><div className="nsec-h"><h3>Archived</h3><button type="button" className="icon-btn" aria-expanded={!!archived} aria-label={archived ? 'Hide archived pages' : 'Show archived pages'} onClick={() => archived ? setArchived(null) : loadArchived()}>{archived ? <Icon.minus size={12} /> : <Icon.plus size={12} />}</button></div>
          {archived && <ul className="ntree-flat">{archived.length ? archived.map((g) => <li key={g.id} className="arch"><span><span aria-hidden="true">{glyph(g)}</span> {untitled(g.title)}</span>
            <button type="button" className="btn tiny ghost" onClick={async () => { await patch(g.id, { archived: false }, 'Restored.'); loadArchived(); }}>Restore</button>
            {(g.created_by === me.id || isAdmin(me)) && <button type="button" className="btn tiny ghost danger" onClick={async () => { if (!(await ask({ title: `Delete “${untitled(g.title)}” for good?`, body: 'Every page inside it goes too. This cannot be undone.', confirm: 'Delete', tone: 'danger' }))) return; try { const r = await api.del(`/api/pages/${g.id}`); toast(`${r.deleted} ${r.deleted === 1 ? 'page' : 'pages'} deleted.`); loadArchived(); } catch (e: any) { toast(e.message, { err: true }); } }}>Delete</button>}</li>) : <li className="faint">Nothing archived.</li>}</ul>}</section>
      </>}
    </aside>
  );
}
const Marked = ({ s }: { s: string }) => <>{s.split(/(\u0001[^\u0002]*\u0002)/).map((part, i) => part.startsWith('\u0001') ? <mark key={i}>{part.slice(1, -1)}</mark> : part)}</>;
function Mark({ s, term }: { s: string; term: string }) { const t = term.trim(); if (!t) return <>{s}</>; const i = s.toLowerCase().indexOf(t.toLowerCase()); if (i < 0) return <>{s}</>; return <>{s.slice(0, i)}<mark>{s.slice(i, i + t.length)}</mark>{s.slice(i + t.length)}</>; }

// ---------- one page ----------
type SaveState = 'saved' | 'saving' | 'unsaved' | 'error' | 'conflict';
function PageView({ ws, id, pages, onTreeChange, onNew }: { ws: WS; id: string; pages: PageRow[]; onTreeChange: () => void; onNew: (parent: string) => void }) {
  const toast = useToast(); const ask = useConfirm(); const team = useTeam(); const { go } = useRouter(); const me = useMe();
  const { data, error, loading, reload } = useLoad<any>(() => api.get(`/api/pages/${id}`), [id]);
  const [state, setState] = useState<SaveState>('saved'); const [errMsg, setErrMsg] = useState('');
  const [title, setTitle] = useState(''); const [icon, setIcon] = useState<string | null>(null); const [history, setHistory] = useState(false); const [editorKey, setEditorKey] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null); const [ai, setAi] = useState<{ action: string; result?: any; error?: string } | null>(null);
  const lastDoc = useRef(''); const version = useRef(1); const pending = useRef<{ content?: any; title?: string; icon?: string | null }>({}); const timer = useRef<number | undefined>(undefined); const inFlight = useRef(false);
  // set during render, before the editor mounts: the editor may report its first state straight away
  const lastFor = useRef(''); if (data && lastFor.current !== data.id) { lastFor.current = data.id; version.current = data.version; lastDoc.current = canon(data.content); }
  useEffect(() => { if (data) { setTitle(data.title); setIcon(data.icon); } }, [data?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const flush = useCallback(async () => {
    if (inFlight.current || !Object.keys(pending.current).length) return;
    const body = pending.current; pending.current = {}; inFlight.current = true; setState('saving');
    try {
      const r = await api.put(`/api/pages/${id}`, { ...body, base_version: version.current }); version.current = r.version;
      if (body.title !== undefined || body.icon !== undefined) onTreeChange();
      inFlight.current = false;
      if (Object.keys(pending.current).length) flush(); else setState('saved');
    } catch (e: any) {
      inFlight.current = false; pending.current = { ...body, ...pending.current };
      if (e instanceof ApiError && e.status === 409) { setState('conflict'); setErrMsg(e.message); } else { setState('error'); setErrMsg(e.message); }
    }
  }, [id, onTreeChange]);
  const queue = (x: object) => { pending.current = { ...pending.current, ...x }; if (state === 'conflict') return; setState('unsaved'); clearTimeout(timer.current); timer.current = window.setTimeout(flush, 900); };
  useEffect(() => { const w = (e: BeforeUnloadEvent) => { if (Object.keys(pending.current).length || inFlight.current) { e.preventDefault(); } }; addEventListener('beforeunload', w); return () => { removeEventListener('beforeunload', w); clearTimeout(timer.current); if (Object.keys(pending.current).length) flush(); }; }, [flush]);
  const [picker, setPicker] = useState<{ kind: 'page' | 'task'; resolve: (v: any) => void } | null>(null);
  const [newTask, setNewTask] = useState<{ resolve: (v: any) => void } | null>(null);
  const pick = (kind: 'page' | 'task') => new Promise<any>((resolve) => setPicker({ kind, resolve }));
  nav.pickTask = () => pick('task'); nav.newTask = () => new Promise((resolve) => setNewTask({ resolve }));
  const hooks: Hooks = {
    people: team.map((u: any) => ({ id: u.id, name: u.name, username: u.username })),
    upload: async (f) => { if (f.size > 10_000_000) { toast('That file is over 10 MB.', { err: true }); return null; } try { toast(`Uploading ${f.name}…`); return await api.upload(`/api/projects/${ws.p.id}/files?name=${encodeURIComponent(f.name)}&page_id=${id}`, f); } catch (e: any) { toast(e.message, { err: true }); return null; } },
    askLink: async () => { const v = await ask({ title: 'Add a link', input: { label: 'Web address', placeholder: 'https://', required: true }, confirm: 'Add link' }); if (typeof v !== 'string') return null; const u = v.trim(); return /^https?:\/\//i.test(u) ? u : u ? `https://${u}` : null; },
    pickPage: () => pick('page'), pickTask: () => pick('task'),
  };
  if (loading && !data) return <Skeleton h={480} />;
  if (error) return <Failure error={error} retry={reload} />;
  const g = data;
  if (g.kind === 'folder') return <FolderView ws={ws} g={g} pages={pages} onNew={onNew} onChanged={() => { reload(true); onTreeChange(); }} />;
  const resolveConflict = async (mine: boolean) => {
    if (mine) { const cur = await api.get(`/api/pages/${id}`); version.current = cur.version; setState('unsaved'); flush(); }
    else { pending.current = {}; setState('saved'); const fresh = await api.get(`/api/pages/${id}`); lastDoc.current = canon(fresh.content); await reload(true); setEditorKey((k) => k + 1); }
  };
  const runAi = async (action: string) => {
    if (Object.keys(pending.current).length || inFlight.current) { await flush(); }
    setAi({ action });
    try { const result = await api.run(`/api/pages/${id}/assist`, { action }); setAi({ action, result }); } catch (e: any) { setAi({ action, error: e.message }); }
  };
  const words = (editor?.getText() ?? g.text_content ?? '').trim().split(/\s+/).filter(Boolean).length;
  return (
    <div className="ndoc">
      <div className="panel ndoc-panel">
        <div className="ndoc-top">
          <nav className="crumbs" aria-label="Page path"><ol><li><Link to={`/projects/${ws.p.id}/notes`}>Notes</Link></li>{g.breadcrumbs.map((b: any) => <li key={b.id}><Link to={`/projects/${ws.p.id}/notes/${b.id}`}>{b.icon ?? ''} {untitled(b.title)}</Link></li>)}<li><span aria-current="page">{icon ?? '📄'} {untitled(title)}</span></li></ol></nav>
          <SaveBadge state={state} msg={errMsg} retry={() => { setState('unsaved'); flush(); }} />
          <Menu label="Share" className="btn tiny" kind="dialog" place="left" button={<><Icon.share size={14} />Share</>}>{(close) => <div className="filter-pop wide share-pop">
            <p><b>Who can open this page</b><br /><span className="muted">Everyone signed in to AWTM Forge, as with every project page. Everyone who can open it can edit and comment; only its author or an admin can delete it.</span></p>
            <button type="button" className="btn tiny primary" onClick={async () => { close(); try { await navigator.clipboard.writeText(`${location.origin}/projects/${ws.p.id}/notes/${id}`); toast('Link copied. Anyone on the team can open it.'); } catch { toast('Could not copy the link.', { err: true }); } }}><Icon.link size={13} />Copy link</button></div>}</Menu>
          <button type="button" className={`icon-btn star${g.starred ? ' on' : ''}`} aria-pressed={g.starred} onClick={async () => { await api.patch(`/api/pages/${id}`, { starred: !g.starred }); reload(true); onTreeChange(); }} aria-label={g.starred ? 'Unpin this page' : 'Pin this page'} title={g.starred ? 'Pinned' : 'Pin'}><Icon.star size={16} /></button>
          <Menu label="Page actions" className="icon-btn" button={<Dots size={16} />} place="left">{(close) => <>
            <MenuItem onSelect={() => { close(); onNew(id); }}><Icon.plus size={15} />New page inside</MenuItem>
            <MenuItem onSelect={() => { close(); setHistory(true); }}><Icon.history size={15} />Version history</MenuItem>
            <MenuItem onSelect={async () => { close(); try { const d = await api.post(`/api/pages/${id}/duplicate`, {}); onTreeChange(); go(`/projects/${ws.p.id}/notes/${d.id}`); } catch (e: any) { toast(e.message, { err: true }); } }}><Icon.copy size={15} />Duplicate</MenuItem>
            <MenuItem onSelect={async () => { close(); const n = await ask({ title: 'Save as a template', body: 'A copy becomes a template anyone can start a page from, in any project. This page stays as it is.', input: { label: 'Template name', required: true, value: title || 'Untitled', max: 200 }, confirm: 'Save template' }); if (typeof n !== 'string' || !n) return; try { await flush(); await api.post(`/api/pages/${id}/duplicate`, { as_template: true, title: n }); toast('Template saved. It shows under New page.'); } catch (e: any) { toast(e.message, { err: true }); } }}><Icon.copy size={15} />Save as template</MenuItem>
            <div className="menu-sep" /><MenuItem onSelect={async () => { close(); await api.patch(`/api/pages/${id}`, { archived: true }); toast('Page archived. Find it under Archived.'); onTreeChange(); go(`/projects/${ws.p.id}/notes`); }}><Icon.archive size={15} />Archive</MenuItem></>}</Menu>
        </div>
        <div className="ndoc-tools"><FixedToolbar editor={editor} hooks={hooks} />
          <Menu label="AI assistant" className="btn tiny ai-btn" place="left" button={<><Icon.bolt size={14} />AI</>}>{(close) => <>{AI.map((a) => <MenuItem key={a.id} onSelect={() => { close(); runAi(a.id); }}><Icon.sparkle size={15} /><span className="ai-mi"><b>{a.label}</b><small>{a.hint}</small></span></MenuItem>)}</>}</Menu></div>
        {state === 'conflict' && <div className="banner warn" role="alert"><span>{errMsg}</span><button className="btn tiny" onClick={() => resolveConflict(false)}>Load their version</button><button className="btn tiny" onClick={async () => { if (await ask({ title: 'Save your version over theirs?', body: 'Their changes stay in the version history, so they can be restored.', confirm: 'Save mine' })) resolveConflict(true); }}>Keep mine</button></div>}
        <div className="ndoc-body">
          <div className="pd-title">
            <Menu label="Page icon" className="pd-icon" kind="dialog" button={<span aria-hidden="true">{icon ?? '📄'}</span>}>{(close) => <div className="emoji-grid">{EMOJI.map((e) => <button key={e} type="button" onClick={() => { setIcon(e); queue({ icon: e }); close(); }} aria-label={`Icon ${e}`}>{e}</button>)}<button type="button" className="btn tiny" onClick={() => { setIcon(null); queue({ icon: null }); close(); }}>No icon</button></div>}</Menu>
            <textarea className="pd-h1" rows={1} value={title} placeholder="Untitled" aria-label="Page title" maxLength={200} onChange={(e) => { setTitle(e.target.value.replace(/\n/g, '')); queue({ title: e.target.value.replace(/\n/g, '') }); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editor?.commands.focus('start'); } }} />
          </div>
          <div className="pd-meta"><span className="pd-by"><Avatar name={g.created_by_name ?? '?'} size="xs" />{g.created_by_name ?? 'A former teammate'}</span><span>Updated {ago(g.updated_at)}{g.updated_by_name ? ` by ${g.updated_by_name}` : ''}</span><span>{words} {words === 1 ? 'word' : 'words'}</span><span>Version {version.current}</span></div>
          <NoteEditor key={editorKey} content={g.content} editable hooks={hooks} onEditor={setEditor} onChange={(doc) => { const j = canon(doc); if (j === lastDoc.current) return; lastDoc.current = j; queue({ content: doc }); }} />
          {g.children.length > 0 && <div className="pd-children"><h3>Pages inside</h3>{g.children.map((c: any) => <Link key={c.id} to={`/projects/${ws.p.id}/notes/${c.id}`} className="pd-child"><span aria-hidden="true">{c.icon ?? '📄'}</span>{untitled(c.title)}</Link>)}</div>}
          <Related ws={ws} g={g} />
          <Comments g={g} me={me} />
        </div>
      </div>
      {history && <History id={id} onClose={() => setHistory(false)} onRestore={async (rev) => { try { const r = await api.put(`/api/pages/${id}`, { content: rev.content, title: rev.title, base_version: version.current }); version.current = r.version; setHistory(false); await reload(true); setTitle(rev.title); setEditorKey((k) => k + 1); onTreeChange(); toast(`Restored version ${rev.version}.`); } catch (e: any) { toast(e.message, { err: true }); } }} />}
      {picker && <Picker ws={ws} kind={picker.kind} pages={pages.filter((x) => x.id !== id && x.kind === 'page')} onDone={(v) => { picker.resolve(v); setPicker(null); }} onNewPage={async () => { const n = await api.post(`/api/projects/${ws.p.id}/pages`, { parent_id: id, title: 'New page' }); onTreeChange(); picker.resolve({ id: n.id, title: 'New page' }); setPicker(null); }} />}
      {newTask && <QuickTask ws={ws} onDone={(v) => { newTask.resolve(v); setNewTask(null); }} />}
      {ai && <AiPreview ws={ws} ai={ai} editor={editor} onClose={() => setAi(null)} />}
    </div>
  );
}

function SaveBadge({ state, msg, retry }: { state: SaveState; msg: string; retry: () => void }) {
  // "Saved" only after the server has said so
  const text = { saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Not saved', conflict: 'Not saved: newer version' }[state];
  return <span className={`savestate s-${state}`} role="status" aria-live="polite" title={state === 'error' ? msg : undefined}>{state === 'saving' ? <Spinner /> : state === 'saved' ? <Icon.check size={13} /> : <Icon.clock size={13} />}{text}
    {state === 'error' && <button type="button" className="link-btn" onClick={retry}>Try again</button>}</span>;
}

function FolderView({ ws, g, pages, onNew, onChanged }: { ws: WS; g: any; pages: PageRow[]; onNew: (parent: string) => void; onChanged: () => void }) {
  const toast = useToast(); const ask = useConfirm(); const { go } = useRouter();
  const inside = pages.filter((x) => x.parent_id === g.id);
  return <div className="panel ndoc-panel folder-view">
    <div className="ndoc-top"><nav className="crumbs" aria-label="Folder path"><ol><li><Link to={`/projects/${ws.p.id}/notes`}>Notes</Link></li>{g.breadcrumbs.map((b: any) => <li key={b.id}><Link to={`/projects/${ws.p.id}/notes/${b.id}`}>{untitled(b.title)}</Link></li>)}<li><span aria-current="page">{untitled(g.title)}</span></li></ol></nav>
      <button type="button" className="btn tiny" onClick={async () => { const n = await ask({ title: 'Rename folder', input: { label: 'Name', required: true, value: g.title, max: 200 }, confirm: 'Rename' }); if (typeof n === 'string' && n) { try { await api.patch(`/api/pages/${g.id}`, { title: n }); onChanged(); } catch (e: any) { toast(e.message, { err: true }); } } }}><Icon.edit size={13} />Rename</button>
      <button type="button" className="btn tiny" onClick={async () => { await api.patch(`/api/pages/${g.id}`, { archived: true }); toast('Folder archived, with what is inside it.'); onChanged(); go(`/projects/${ws.p.id}/notes`); }}><Icon.archive size={13} />Archive</button>
      <button type="button" className="btn tiny primary" onClick={() => onNew(g.id)}><Icon.plus size={13} />New page here</button></div>
    <div className="ndoc-body"><h1 className="folder-h"><span aria-hidden="true">{g.icon ?? '📁'}</span>{untitled(g.title)}</h1>
      {inside.length ? <div className="note-cards">{inside.map((x) => <Link key={x.id} to={`/projects/${ws.p.id}/notes/${x.id}`} className="note-card"><span className="nc-ic" aria-hidden="true">{glyph(x)}</span><b>{untitled(x.title)}</b><small>Edited {ago(x.updated_at)}</small></Link>)}</div>
        : <Empty title="This folder is empty" action={<button className="btn primary" onClick={() => onNew(g.id)}><Icon.plus size={15} />New page here</button>}>Drag pages onto the folder in the list, or start a new one here.</Empty>}</div>
  </div>;
}

// backlinks and tasks this page mentions
function Related({ ws, g }: { ws: WS; g: any }) {
  if (!g.backlinks.length && !g.task_refs.length) return null;
  return <div className="nrel">
    {g.backlinks.length > 0 && <section><h3>Linked here from</h3><ul>{g.backlinks.map((b: any) => <li key={b.id}><Link to={`/projects/${ws.p.id}/notes/${b.id}`}>{b.icon ?? '📄'} {untitled(b.title)}</Link></li>)}</ul></section>}
    {g.task_refs.length > 0 && <section><h3>Tasks on this page</h3><ul>{g.task_refs.map((t: any) => <li key={t.id}><button type="button" className="link-btn" onClick={() => ws.openTask(t.id)}><StatusDot s={t.status} />{t.title}</button></li>)}</ul></section>}
  </div>;
}

function Comments({ g, me }: { g: any; me: any }) {
  const toast = useToast(); const ask = useConfirm();
  const { data, reload } = useLoad<any[]>(() => api.get(`/api/pages/${g.id}/comments`), [g.id]);
  const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const [reply, setReply] = useState<{ to: string; body: string } | null>(null); const [edit, setEdit] = useState<{ id: string; body: string } | null>(null);
  const post = async (text: string, parent: string | null) => { if (!text.trim()) return false; setBusy(true); try { await api.post(`/api/pages/${g.id}/comments`, { body: text.trim(), parent_id: parent }); reload(true); return true; } catch (x: any) { toast(x.message, { err: true }); return false; } finally { setBusy(false); } };
  const all = data ?? []; const tops = all.filter((k) => !k.parent_id);
  const one = (k: any, isReply = false) => <div key={k.id} className={`ncom${isReply ? ' reply' : ''}`}><Avatar name={k.author_name} size="xs" /><div className="grow">
    <div className="who-line"><b>{k.author_name ?? 'Former teammate'}</b><span className="faint" title={new Date(k.created_at).toLocaleString()}>{ago(k.created_at)}{k.edited_at ? ' · edited' : ''}</span>
      <span className="right row" style={{ gap: 2 }}>{!isReply && <button className="btn tiny ghost" onClick={() => setReply({ to: k.id, body: '' })}>Reply</button>}{k.author_id === me.id && <button className="btn tiny ghost" onClick={() => setEdit({ id: k.id, body: k.body })}>Edit</button>}
        {(k.author_id === me.id || me.role === 'admin') && <button className="btn tiny ghost" onClick={async () => { if (!(await ask({ title: 'Delete this comment?', body: isReply ? undefined : 'Its replies go with it.', confirm: 'Delete', tone: 'danger' }))) return; try { await api.del(`/api/page-comments/${k.id}`); reload(true); } catch (x: any) { toast(x.message, { err: true }); } }}>Delete</button>}</span></div>
    {edit?.id === k.id ? <form className="col" onSubmit={async (e) => { e.preventDefault(); try { await api.patch(`/api/page-comments/${k.id}`, { body: edit!.body }); setEdit(null); reload(true); } catch (x: any) { toast(x.message, { err: true }); } }}><textarea className="textarea" rows={2} value={edit!.body} onChange={(e) => setEdit({ id: k.id, body: e.target.value })} aria-label="Edit comment" /><div className="row"><button className="btn tiny primary">Save</button><button type="button" className="btn tiny" onClick={() => setEdit(null)}>Cancel</button></div></form>
      : <p className="prose">{k.body}</p>}
    {!isReply && all.filter((r) => r.parent_id === k.id).map((r) => one(r, true))}
    {reply?.to === k.id && <form className="ncom-reply" onSubmit={async (e) => { e.preventDefault(); if (await post(reply!.body, k.id)) setReply(null); }}><input autoFocus className="input" value={reply!.body} onChange={(e) => setReply({ to: k.id, body: e.target.value })} placeholder="Reply. @name tells that person." aria-label="Reply" maxLength={5000} /><button className="btn tiny primary" disabled={busy || !reply!.body.trim()}>Reply</button><button type="button" className="btn tiny ghost" onClick={() => setReply(null)}>Cancel</button></form>}
  </div></div>;
  return <section className="ncomments" aria-labelledby="nc-h"><h3 id="nc-h">Comments{tops.length ? <span className="faint"> {all.length}</span> : null}</h3>
    {tops.map((k) => one(k))}
    <form className="ncompose" onSubmit={async (e) => { e.preventDefault(); if (await post(body, null)) setBody(''); }}>
      <Avatar name={me.name} size="sm" /><input className="input" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment..." aria-label="Add a comment. @name tells that person." maxLength={5000} />
      <button className="btn primary ncompose-send" disabled={busy || !body.trim()} aria-label="Post comment">{busy ? <Spinner /> : <Icon.send size={15} />}</button></form>
  </section>;
}

// a task made from inside a page, then linked into it
function QuickTask({ ws, onDone }: { ws: WS; onDone: (v: { id: string } | null) => void }) {
  const toast = useToast(); const team = useTeam(); const [f, setF] = useState({ title: '', column_id: ws.p.columns[0]?.id ?? '', priority: 'MEDIUM', assignee_id: '', due_date: '' }); const [busy, setBusy] = useState(false);
  return <Modal title="New task, linked here" onClose={() => onDone(null)}><form className="col" onSubmit={async (e) => { e.preventDefault(); if (!f.title.trim()) return; setBusy(true);
    try { const t = await api.post(`/api/projects/${ws.p.id}/tasks`, { ...f, title: f.title.trim(), assignee_id: f.assignee_id || null, due_date: f.due_date || null, column_id: f.column_id || undefined }); ws.reload(); toast('Task added to the project and linked here.'); onDone({ id: t.id }); } catch (x: any) { toast(x.message, { err: true }); setBusy(false); } }}>
    <label className="field"><span>Title</span><input autoFocus required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
    <div className="grid2"><label className="field"><span>Status</span><select value={f.column_id} onChange={(e) => setF({ ...f, column_id: e.target.value })}>{ws.p.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="field"><span>Priority</span><select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="field"><span>Assignee</span><select value={f.assignee_id} onChange={(e) => setF({ ...f, assignee_id: e.target.value })}><option value="">Nobody yet</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label className="field"><span>Due</span><input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></label></div>
    <div className="dialog-actions"><button type="button" className="btn" onClick={() => onDone(null)}>Cancel</button><button className="btn primary" disabled={busy || !f.title.trim()}>{busy && <Spinner />}Add task</button></div></form></Modal>;
}

// The assistant's answer, as a preview. Adding it puts it at the end of the page; nothing on the page is replaced.
function AiPreview({ ws, ai, editor, onClose }: { ws: WS; ai: { action: string; result?: any; error?: string }; editor: Editor | null; onClose: () => void }) {
  const toast = useToast(); const label = AI.find((a) => a.id === ai.action)?.label ?? 'AI';
  const items: string[] = ai.result?.sections?.flatMap((s: any) => s.items) ?? [];
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(items.map((_, i) => i))); const [busy, setBusy] = useState(false);
  useEffect(() => { setChosen(new Set(items.map((_, i) => i))); }, [ai.result]); // eslint-disable-line react-hooks/exhaustive-deps
  const asTasks = ai.action === 'extract_tasks' || ai.action === 'action_items';
  const check = ai.action === 'checklist' || asTasks;
  const t = (x: string) => ({ type: 'text', text: x });
  const toDoc = () => (ai.result.sections as any[]).flatMap((s) => [{ type: 'heading', attrs: { level: 2 }, content: [t(s.heading)] },
    ...(s.text ? s.text.split(/\n+/).filter(Boolean).map((p: string) => ({ type: 'paragraph', content: [t(p)] })) : []),
    ...(s.items.length ? [check ? { type: 'taskList', content: s.items.map((x: string) => ({ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [t(x)] }] })) } : { type: 'bulletList', content: s.items.map((x: string) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [t(x)] }] })) }] : [])]);
  const insert = () => { if (!editor) return; editor.chain().focus('end').insertContentAt(editor.state.doc.content.size, toDoc()).run(); toast('Added at the end of the page.'); onClose(); };
  const createTasks = async () => {
    if (!editor) return; setBusy(true); const ids: string[] = [];
    try { for (const [i, x] of items.entries()) if (chosen.has(i)) ids.push((await api.post(`/api/projects/${ws.p.id}/tasks`, { title: x.slice(0, 200) })).id);
      ws.reload(); editor.chain().focus('end').insertContentAt(editor.state.doc.content.size, [{ type: 'heading', attrs: { level: 2 }, content: [t('Linked tasks')] }, { type: 'linkedTasks', attrs: { ids: ids.join(',') } }]).run();
      toast(`${ids.length} ${ids.length === 1 ? 'task' : 'tasks'} added to the project and linked here.`); onClose();
    } catch (e: any) { toast(`${ids.length} made before it stopped. ${e.message}`, { err: true }); ws.reload(); setBusy(false); }
  };
  return <Modal title={label} onClose={onClose} wide>
    <p className="ai-note"><Icon.sparkle size={14} />Suggested by AI from this page{ai.action === 'brief' ? ' and the project' : ''}. Nothing changes until you choose; check it before you use it.</p>
    {!ai.result && !ai.error && <div className="ai-wait"><Spinner />Reading the page…</div>}
    {ai.error && <Failure error={ai.error} />}
    {ai.result && <div className="ai-out">
      {ai.result.sections.map((s: any, si: number) => <section key={si}><h3>{s.heading}</h3>{s.text && <p className="prose">{s.text}</p>}
        {s.items.length > 0 && <ul>{s.items.map((x: string) => { const i = items.indexOf(x); return <li key={x}>{asTasks ? <label className="chk"><input type="checkbox" className="check" checked={chosen.has(i)} onChange={() => setChosen((c) => { const n = new Set(c); n.has(i) ? n.delete(i) : n.add(i); return n; })} />{x}</label> : x}</li>; })}</ul>}
        {!s.text && !s.items.length && <p className="faint">Nothing found.</p>}</section>)}
      {ai.result.missing?.length > 0 && <div className="banner warn"><span><b>Not in what it was given:</b> {ai.result.missing.join(' ')}</span></div>}
    </div>}
    <div className="dialog-actions">
      <button type="button" className="btn" onClick={onClose}>Discard</button>
      {ai.result && <button type="button" className="btn" onClick={async () => { try { await navigator.clipboard.writeText((ai.result.sections as any[]).map((s) => [s.heading, s.text, ...s.items.map((x: string) => `- ${x}`)].filter(Boolean).join('\n')).join('\n\n')); toast('Copied.'); } catch { toast('Could not copy.', { err: true }); } }}><Icon.copy size={14} />Copy</button>}
      {ai.result && asTasks && items.length > 0 && <button type="button" className="btn" disabled={busy || !chosen.size} onClick={createTasks}>{busy && <Spinner />}Create {chosen.size} {chosen.size === 1 ? 'task' : 'tasks'}</button>}
      {ai.result && <button type="button" className="btn primary" disabled={!editor} onClick={insert}>Add to the end of the page</button>}
    </div>
  </Modal>;
}

function History({ id, onClose, onRestore }: { id: string; onClose: () => void; onRestore: (rev: any) => void }) {
  const list = useLoad<any[]>(() => api.get(`/api/pages/${id}/revisions`), [id]); const [view, setView] = useState<any>(null); const ask = useConfirm();
  const show = async (v: number) => setView(await api.get(`/api/pages/${id}/revisions/${v}`));
  return <Modal title="Version history" onClose={onClose} wide><div className="hist">
    <ul className="hist-list">{(list.data ?? []).map((r, i) => <li key={r.version}><button type="button" className={view?.version === r.version ? 'on' : ''} onClick={() => show(r.version)}><b>Version {r.version}{i === 0 ? ' · latest snapshot' : ''}</b><small>{r.author_name ?? 'Someone'} · {new Date(r.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</small></button></li>)}</ul>
    <div className="hist-view">{view ? <><div className="row"><b>{untitled(view.title)}</b><button className="btn tiny primary right" onClick={async () => { if (await ask({ title: `Restore version ${view.version}?`, body: 'It becomes the newest version. The current one stays in the history.', confirm: 'Restore' })) onRestore(view); }}>Restore this version</button></div>
      <div className="hist-doc"><NoteEditor key={view.version} content={view.content} editable={false} /></div></> : <p className="faint">Choose a version to see it. A snapshot is kept when someone else edits, or every ten minutes of editing.</p>}</div>
  </div></Modal>;
}

function Picker({ ws, kind, pages, onDone, onNewPage }: { ws: WS; kind: 'page' | 'task'; pages: PageRow[]; onDone: (v: any) => void; onNewPage: () => void }) {
  const [q, setQ] = useState('');
  const items = kind === 'page' ? pages.filter((g) => untitled(g.title).toLowerCase().includes(q.toLowerCase())).map((g) => ({ id: g.id, title: untitled(g.title), pre: g.icon ?? '📄' }))
    : ws.p.task_list.filter((t) => !t.archived_at && t.title.toLowerCase().includes(q.toLowerCase())).map((t) => ({ id: t.id, title: t.title, pre: <StatusDot s={t.status} /> }));
  return <Modal title={kind === 'page' ? 'Link a page' : 'Link a task'} onClose={() => onDone(null)}><div className="col">
    <input className="input" autoFocus placeholder={kind === 'page' ? 'Search pages' : 'Search tasks'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
    <ul className="pick-list">{items.slice(0, 50).map((x) => <li key={x.id}><button type="button" onClick={() => onDone({ id: x.id, title: x.title })}><span aria-hidden="true">{x.pre}</span>{x.title}</button></li>)}
      {!items.length && <li className="faint">Nothing matches.</li>}</ul>
    {kind === 'page' && <button type="button" className="btn tiny" onClick={onNewPage}><Icon.plus size={13} />New page inside this one, and link it</button>}
  </div></Modal>;
}
