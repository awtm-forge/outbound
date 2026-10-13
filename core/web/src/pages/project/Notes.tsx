import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../../api.ts';
import { Link, useRouter } from '../../router.tsx';
import { useLoad } from '../../ui/hooks.ts';
import { Icon, Dots } from '../../ui/icons.tsx';
import { Menu, MenuItem } from '../../ui/menu.tsx';
import { Modal, useConfirm } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Empty, Failure, Skeleton, Spinner, ago } from '../../ui/kit.tsx';
import { useMe, useTeam } from '../../session.tsx';
import { NoteEditor, type Hooks } from './editor/Editor.tsx';
import { nav } from './editor/nodes.tsx';
import { TEMPLATES } from './editor/templates.ts';
import { Avatar, StatusDot } from './shared.tsx';
import type { WS } from './Workspace.tsx';

type PageRow = { id: string; parent_id: string | null; title: string; icon: string | null; position: number; archived_at: string | null; updated_at: string; updated_by_name: string | null; starred: boolean; created_by: string };
const EMOJI = ['📄', '🎯', '📝', '🗓️', '📈', '🛠️', '🐞', '🔁', '💬', '📋', '🧾', '🚀', '🎨', '💡', '📦', '🔒', '🌐', '⚙️', '📊', '✅'];
const untitled = (t?: string | null) => t || 'Untitled';

export default function Notes({ ws, pageId }: { ws: WS; pageId?: string }) {
  const { p } = ws; const { go, search } = useRouter(); const toast = useToast();
  const pages = useLoad<PageRow[]>(() => api.get(`/api/projects/${p.id}/pages`), [p.id]);
  const [choose, setChoose] = useState<{ parent: string | null } | null>(search.get('new') === '1' ? { parent: null } : null);
  useEffect(() => { if (search.get('new') === '1') { setChoose({ parent: null }); go(`/projects/${p.id}/notes${pageId ? '/' + pageId : ''}`, true); } }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  nav.page = (id) => go(`/projects/${p.id}/notes/${id}`); nav.task = (id) => ws.openTask(id);
  const create = async (parent: string | null, tpl: (typeof TEMPLATES)[number]) => {
    try { const g = await api.post(`/api/projects/${p.id}/pages`, { parent_id: parent, title: tpl.id === 'blank' ? '' : tpl.title, icon: tpl.id === 'blank' ? null : tpl.icon, content: tpl.content() });
      setChoose(null); pages.reload(true); go(`/projects/${p.id}/notes/${g.id}`); } catch (e: any) { toast(e.message, { err: true }); }
  };
  const list = pages.data ?? [];
  return (
    <div className="notes">
      <Tree ws={ws} pages={list} loading={pages.loading && !pages.data} error={pages.error} reload={() => pages.reload(true)} current={pageId} onNew={(parent) => setChoose({ parent })} />
      <div className="notes-main">
        {pageId ? <PageView key={pageId} ws={ws} id={pageId} pages={list} onTreeChange={() => pages.reload(true)} onNew={(parent) => setChoose({ parent })} />
          : <NotesHome ws={ws} pages={list} loading={pages.loading && !pages.data} onNew={() => setChoose({ parent: null })} />}
      </div>
      {choose && <Modal title={choose.parent ? 'New page inside this one' : 'New page'} onClose={() => setChoose(null)} wide>
        <div className="tpl-grid">{TEMPLATES.map((t) => <button key={t.id} type="button" className="tpl" onClick={() => create(choose.parent, t)}><span className="tpl-ic" aria-hidden="true">{t.icon}</span><b>{t.title}</b><small>{t.hint}</small></button>)}</div></Modal>}
    </div>
  );
}

function NotesHome({ ws, pages, loading, onNew }: { ws: WS; pages: PageRow[]; loading: boolean; onNew: () => void }) {
  const recent = [...pages].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6); const starred = pages.filter((g) => g.starred);
  if (loading) return <Skeleton h={300} />;
  if (!pages.length) return <div className="panel" style={{ padding: 8 }}><Empty title="No pages yet" action={<button className="btn primary" onClick={onNew}><Icon.plus size={16} />New page</button>}>Briefs, meeting notes, specs and checklists for this project, as pages inside pages. Start from a template or a blank page.</Empty></div>;
  const card = (g: PageRow) => <Link key={g.id} to={`/projects/${ws.p.id}/notes/${g.id}`} className="note-card"><span className="nc-ic" aria-hidden="true">{g.icon ?? '📄'}</span><b>{untitled(g.title)}</b><small>Edited {ago(g.updated_at)}{g.updated_by_name ? ` by ${g.updated_by_name}` : ''}</small></Link>;
  return <div className="col" style={{ gap: 18 }}>
    {starred.length > 0 && <section aria-labelledby="st-h"><h2 id="st-h" className="notes-h"><Icon.star size={15} />Starred</h2><div className="note-cards">{starred.map(card)}</div></section>}
    <section aria-labelledby="rc-h"><h2 id="rc-h" className="notes-h"><Icon.clock size={15} />Recently edited</h2><div className="note-cards">{recent.map(card)}</div></section>
  </div>;
}

function Tree({ ws, pages, loading, error, reload, current, onNew }: { ws: WS; pages: PageRow[]; loading: boolean; error: string | null; reload: () => void; current?: string; onNew: (parent: string | null) => void }) {
  const toast = useToast(); const ask = useConfirm(); const me = useMe(); const { go } = useRouter();
  const key = `awtm-tree-${ws.p.id}`;
  const [open, setOpenState] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]')); } catch { return new Set(); } });
  const setOpen = (s: Set<string>) => { setOpenState(s); try { localStorage.setItem(key, JSON.stringify([...s])); } catch { /* */ } };
  const [q, setQ] = useState(''); const [hits, setHits] = useState<any[] | null>(null); const [archived, setArchived] = useState<PageRow[] | null>(null);
  const [drag, setDrag] = useState<string | null>(null); const [over, setOver] = useState<string | null>(null);
  useEffect(() => { if (q.trim().length < 2) { setHits(null); return; } const t = setTimeout(async () => { try { setHits((await api.get<any[]>(`/api/projects/${ws.p.id}/search?q=${encodeURIComponent(q)}`)).filter((x) => x.kind === 'page')); } catch { setHits([]); } }, 250); return () => clearTimeout(t); }, [q, ws.p.id]);
  // keep the open page's parents expanded
  useEffect(() => { if (!current) return; const s = new Set(open); let x = pages.find((g) => g.id === current); let changed = false; while (x?.parent_id) { if (!s.has(x.parent_id)) { s.add(x.parent_id); changed = true; } x = pages.find((g) => g.id === x!.parent_id); } if (changed) setOpen(s); }, [current, pages]); // eslint-disable-line react-hooks/exhaustive-deps
  const kids = useMemo(() => { const m = new Map<string | null, PageRow[]>(); for (const g of pages) m.set(g.parent_id, [...(m.get(g.parent_id) ?? []), g]); for (const l of m.values()) l.sort((a, b) => a.position - b.position); return m; }, [pages]);
  const patch = async (id: string, b: object, msg?: string) => { try { await api.patch(`/api/pages/${id}`, b); reload(); if (msg) toast(msg); } catch (e: any) { toast(e.message, { err: true }); } };
  const moveTo = (g: PageRow, parent: string | null) => patch(g.id, { parent_id: parent }, 'Page moved.');
  const reorder = (g: PageRow, dir: -1 | 1) => { const sib = kids.get(g.parent_id) ?? []; const i = sib.findIndex((x) => x.id === g.id); const a = sib[i + dir]; if (!a) return; const b = sib[i + 2 * dir]; patch(g.id, { position: b ? (a.position + b.position) / 2 : a.position + dir }); };
  const loadArchived = async () => { try { setArchived(await api.get(`/api/projects/${ws.p.id}/pages?archived=1`)); } catch (e: any) { toast(e.message, { err: true }); } };
  const descendants = (id: string): Set<string> => { const s = new Set<string>([id]); let grew = true; while (grew) { grew = false; for (const g of pages) if (g.parent_id && s.has(g.parent_id) && !s.has(g.id)) { s.add(g.id); grew = true; } } return s; };
  const node = (g: PageRow, depth: number): React.ReactNode => {
    const ch = kids.get(g.id) ?? []; const isOpen = open.has(g.id);
    return <li key={g.id} role="treeitem" aria-expanded={ch.length ? isOpen : undefined} aria-selected={current === g.id} aria-level={depth + 1}>
      <div className={`tn${current === g.id ? ' on' : ''}${over === g.id ? ' over' : ''}`} style={{ paddingLeft: 6 + depth * 14 }} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', g.id); setDrag(g.id); }} onDragEnd={() => { setDrag(null); setOver(null); }}
        onDragOver={(e) => { if (drag && !descendants(drag).has(g.id)) { e.preventDefault(); setOver(g.id); } }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); setOver(null); if (drag && drag !== g.id) { const d = pages.find((x) => x.id === drag)!; moveTo(d, g.id); setOpen(new Set([...open, g.id])); } }}>
        <button type="button" className="tn-tog" onClick={() => { const s = new Set(open); isOpen ? s.delete(g.id) : s.add(g.id); setOpen(s); }} aria-label={isOpen ? `Collapse ${untitled(g.title)}` : `Expand ${untitled(g.title)}`} style={{ visibility: ch.length ? 'visible' : 'hidden' }} tabIndex={ch.length ? 0 : -1}><Icon.toggle size={12} /></button>
        <Link to={`/projects/${ws.p.id}/notes/${g.id}`} className="tn-link"><span aria-hidden="true">{g.icon ?? '📄'}</span><span className="tn-t">{untitled(g.title)}</span></Link>
        <button type="button" className="icon-btn tn-add" onClick={() => onNew(g.id)} aria-label={`New page inside ${untitled(g.title)}`}><Icon.plus size={13} /></button>
        <Menu label={`Page ${untitled(g.title)}`} className="icon-btn tn-more" button={<Dots size={14} />}>{(close) => <>
          <MenuItem onSelect={() => { close(); patch(g.id, { starred: !g.starred }, g.starred ? 'Unstarred.' : 'Starred.'); }}><Icon.star size={15} />{g.starred ? 'Unstar' : 'Star'}</MenuItem>
          <MenuItem onSelect={() => { close(); onNew(g.id); }}><Icon.plus size={15} />New page inside</MenuItem>
          <MenuItem onSelect={async () => { close(); try { const d = await api.post(`/api/pages/${g.id}/duplicate`, {}); reload(); go(`/projects/${ws.p.id}/notes/${d.id}`); } catch (e: any) { toast(e.message, { err: true }); } }}><Icon.copy size={15} />Duplicate</MenuItem>
          <MenuItem onSelect={() => { close(); reorder(g, -1); }}><Icon.left size={15} />Move up</MenuItem>
          <MenuItem onSelect={() => { close(); reorder(g, 1); }}><Icon.right size={15} />Move down</MenuItem>
          <div className="menu-item" role="none"><Icon.layers size={15} /><select aria-label={`Move ${untitled(g.title)} inside`} value="" onClick={(e) => e.stopPropagation()} onChange={(e) => { close(); moveTo(g, e.target.value === 'root' ? null : e.target.value); }}>
            <option value="">Move inside…</option>{g.parent_id && <option value="root">Top level</option>}{pages.filter((x) => !descendants(g.id).has(x.id) && x.id !== g.parent_id).map((x) => <option key={x.id} value={x.id}>{untitled(x.title)}</option>)}</select></div>
          <div className="menu-sep" /><MenuItem onSelect={() => { close(); patch(g.id, { archived: true }, 'Page archived. Find it under Archived.'); if (current && descendants(g.id).has(current)) go(`/projects/${ws.p.id}/notes`); }}><Icon.archive size={15} />Archive</MenuItem></>}</Menu>
      </div>
      {ch.length > 0 && isOpen && <ul role="group">{ch.map((c) => node(c, depth + 1))}</ul>}
    </li>;
  };
  return (
    <aside className="panel ntree" aria-label="Pages">
      <div className="ntree-head"><h2>Pages</h2><button type="button" className="btn tiny primary" onClick={() => onNew(null)}><Icon.plus size={13} />New page</button></div>
      <label className="tb-search"><Icon.find size={14} /><input placeholder="Search pages" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search pages" /></label>
      {hits ? <ul className="ntree-hits">{hits.length ? hits.map((x) => <li key={x.id}><Link to={`/projects/${ws.p.id}/notes/${x.id}`} onClick={() => setQ('')}><b>{x.title}</b>{x.detail && <small>{x.detail}</small>}</Link></li>) : <li className="faint">No page matches.</li>}</ul> : <>
        {pages.some((g) => g.starred) && <><h3 className="ntree-sub">Starred</h3><ul className="ntree-flat">{pages.filter((g) => g.starred).map((g) => <li key={g.id}><Link to={`/projects/${ws.p.id}/notes/${g.id}`} className={current === g.id ? 'on' : ''}><span aria-hidden="true">{g.icon ?? '📄'}</span>{untitled(g.title)}</Link></li>)}</ul></>}
        <h3 className="ntree-sub">All pages</h3>
        {loading ? <Skeleton h={120} /> : error ? <Failure error={error} retry={reload} /> : <ul role="tree" aria-label="Page tree" className="ntree-list" onDragOver={(e) => { if (drag) e.preventDefault(); }} onDrop={(e) => { if (e.target === e.currentTarget && drag) { const d = pages.find((x) => x.id === drag)!; moveTo(d, null); } }}>
          {(kids.get(null) ?? []).map((g) => node(g, 0))}</ul>}
        {drag && <p className="faint ntree-tip">Drop on a page to put it inside, or on empty space for the top level.</p>}
        <button type="button" className="ntree-arch" onClick={() => archived ? setArchived(null) : loadArchived()} aria-expanded={!!archived}><Icon.archive size={14} />Archived</button>
        {archived && <ul className="ntree-flat">{archived.length ? archived.map((g) => <li key={g.id} className="arch"><span>{g.icon ?? '📄'} {untitled(g.title)}</span>
          <button type="button" className="btn tiny ghost" onClick={async () => { await patch(g.id, { archived: false }, 'Page restored.'); loadArchived(); }}>Restore</button>
          {(g.created_by === me.id || me.role === 'admin') && <button type="button" className="btn tiny ghost danger" onClick={async () => { if (!(await ask({ title: `Delete “${untitled(g.title)}” for good?`, body: 'Every page inside it goes too. This cannot be undone.', confirm: 'Delete', tone: 'danger' }))) return; try { const r = await api.del(`/api/pages/${g.id}`); toast(`${r.deleted} ${r.deleted === 1 ? 'page' : 'pages'} deleted.`); loadArchived(); } catch (e: any) { toast(e.message, { err: true }); } }}>Delete</button>}</li>) : <li className="faint">Nothing archived.</li>}</ul>}
      </>}
    </aside>
  );
}

type SaveState = 'saved' | 'saving' | 'unsaved' | 'error' | 'conflict';
function PageView({ ws, id, pages, onTreeChange, onNew }: { ws: WS; id: string; pages: PageRow[]; onTreeChange: () => void; onNew: (parent: string) => void }) {
  const toast = useToast(); const ask = useConfirm(); const team = useTeam(); const { go } = useRouter();
  const { data, error, loading, reload } = useLoad<any>(() => api.get(`/api/pages/${id}`), [id]);
  const [state, setState] = useState<SaveState>('saved'); const [errMsg, setErrMsg] = useState('');
  const [title, setTitle] = useState(''); const [icon, setIcon] = useState<string | null>(null); const [history, setHistory] = useState(false); const [editorKey, setEditorKey] = useState(0);
  const version = useRef(1); const pending = useRef<{ content?: any; title?: string; icon?: string | null }>({}); const timer = useRef<number | undefined>(undefined); const inFlight = useRef(false);
  useEffect(() => { if (data) { version.current = data.version; setTitle(data.title); setIcon(data.icon); } }, [data?.id]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // leaving with unsaved changes asks first; switching pages saves first
  useEffect(() => { const w = (e: BeforeUnloadEvent) => { if (Object.keys(pending.current).length || inFlight.current) { e.preventDefault(); } }; addEventListener('beforeunload', w); return () => { removeEventListener('beforeunload', w); clearTimeout(timer.current); if (Object.keys(pending.current).length) flush(); }; }, [flush]);
  const hooks: Hooks = {
    people: team.map((u: any) => ({ id: u.id, name: u.name, username: u.username })),
    upload: async (f) => { if (f.size > 10_000_000) { toast('That file is over 10 MB.', { err: true }); return null; } try { toast(`Uploading ${f.name}…`); const r = await api.upload(`/api/projects/${ws.p.id}/files?name=${encodeURIComponent(f.name)}&page_id=${id}`, f); return r; } catch (e: any) { toast(e.message, { err: true }); return null; } },
    askLink: async () => { const v = await ask({ title: 'Add a link', input: { label: 'Web address', placeholder: 'https://', required: true }, confirm: 'Add link' }); if (typeof v !== 'string') return null; const u = v.trim(); return /^https?:\/\//i.test(u) ? u : u ? `https://${u}` : null; },
    pickPage: () => pick('page'), pickTask: () => pick('task'),
  };
  const [picker, setPicker] = useState<{ kind: 'page' | 'task'; resolve: (v: any) => void } | null>(null);
  const pick = (kind: 'page' | 'task') => new Promise<any>((resolve) => setPicker({ kind, resolve }));
  if (loading && !data) return <Skeleton h={480} />;
  if (error) return <Failure error={error} retry={reload} />;
  const g = data;
  const resolveConflict = async (mine: boolean) => {
    if (mine) { const cur = await api.get(`/api/pages/${id}`); version.current = cur.version; setState('unsaved'); flush(); }
    else { pending.current = {}; setState('saved'); await reload(true); setEditorKey((k) => k + 1); }
  };
  return (
    <div className="page-view">
      <article className="panel page-doc">
        <div className="pd-top">
          <nav className="crumbs" aria-label="Page path"><ol><li><Link to={`/projects/${ws.p.id}/notes`}>Notes</Link></li>{g.breadcrumbs.map((b: any) => <li key={b.id}><Link to={`/projects/${ws.p.id}/notes/${b.id}`}>{b.icon ?? ''} {untitled(b.title)}</Link></li>)}<li><span aria-current="page">{untitled(title)}</span></li></ol></nav>
          <SaveBadge state={state} msg={errMsg} retry={() => { setState('unsaved'); flush(); }} />
          <button type="button" className={`icon-btn${g.starred ? ' on' : ''}`} aria-pressed={g.starred} onClick={async () => { await api.patch(`/api/pages/${id}`, { starred: !g.starred }); reload(true); onTreeChange(); }} aria-label={g.starred ? 'Unstar' : 'Star'}><Icon.star size={16} /></button>
          <Menu label="Page actions" className="icon-btn" button={<Dots vertical size={16} />} place="left">{(close) => <>
            <MenuItem onSelect={() => { close(); onNew(id); }}><Icon.plus size={15} />New page inside</MenuItem>
            <MenuItem onSelect={() => { close(); setHistory(true); }}><Icon.history size={15} />Version history</MenuItem>
            <MenuItem onSelect={async () => { close(); try { await navigator.clipboard.writeText(`${location.origin}/projects/${ws.p.id}/notes/${id}`); toast('Link copied.'); } catch { toast('Could not copy the link.', { err: true }); } }}><Icon.link size={15} />Copy link</MenuItem>
            <MenuItem onSelect={async () => { close(); const d = await api.post(`/api/pages/${id}/duplicate`, {}); onTreeChange(); go(`/projects/${ws.p.id}/notes/${d.id}`); }}><Icon.copy size={15} />Duplicate</MenuItem>
            <div className="menu-sep" /><MenuItem onSelect={async () => { close(); await api.patch(`/api/pages/${id}`, { archived: true }); toast('Page archived.'); onTreeChange(); go(`/projects/${ws.p.id}/notes`); }}><Icon.archive size={15} />Archive</MenuItem></>}</Menu>
        </div>
        {state === 'conflict' && <div className="banner warn" role="alert"><span>{errMsg}</span><button className="btn tiny" onClick={() => resolveConflict(false)}>Load their version</button><button className="btn tiny" onClick={async () => { if (await ask({ title: 'Save your version over theirs?', body: 'Their changes stay in the version history, so they can be restored.', confirm: 'Save mine' })) resolveConflict(true); }}>Keep mine</button></div>}
        <div className="pd-title">
          <Menu label="Page icon" className="pd-icon" kind="dialog" button={<span aria-hidden="true">{icon ?? '📄'}</span>}>{(close) => <div className="emoji-grid">{EMOJI.map((e) => <button key={e} type="button" onClick={() => { setIcon(e); queue({ icon: e }); close(); }} aria-label={`Icon ${e}`}>{e}</button>)}<button type="button" className="btn tiny" onClick={() => { setIcon(null); queue({ icon: null }); close(); }}>No icon</button></div>}</Menu>
          <textarea className="pd-h1" rows={1} value={title} placeholder="Untitled" aria-label="Page title" maxLength={200} onChange={(e) => { setTitle(e.target.value); queue({ title: e.target.value }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (document.querySelector('.nb-doc') as HTMLElement | null)?.focus(); } }} />
        </div>
        <NoteEditor key={editorKey} content={g.content} editable hooks={hooks} onChange={(doc) => queue({ content: doc })} />
        {g.children.length > 0 && <div className="pd-children"><h3>Pages inside</h3>{g.children.map((c: any) => <Link key={c.id} to={`/projects/${ws.p.id}/notes/${c.id}`} className="pd-child"><span aria-hidden="true">{c.icon ?? '📄'}</span>{untitled(c.title)}</Link>)}</div>}
      </article>
      <PageSide ws={ws} g={g} pages={pages} />
      {history && <History id={id} onClose={() => setHistory(false)} onRestore={async (rev) => { try { const r = await api.put(`/api/pages/${id}`, { content: rev.content, title: rev.title, base_version: version.current }); version.current = r.version; setHistory(false); await reload(true); setTitle(rev.title); setEditorKey((k) => k + 1); onTreeChange(); toast(`Restored version ${rev.version}.`); } catch (e: any) { toast(e.message, { err: true }); } }} />}
      {picker && <Picker ws={ws} kind={picker.kind} pages={pages.filter((x) => x.id !== id)} onDone={(v) => { picker.resolve(v); setPicker(null); }} onNewPage={async () => { const n = await api.post(`/api/projects/${ws.p.id}/pages`, { parent_id: id, title: 'New page' }); onTreeChange(); picker.resolve({ id: n.id, title: 'New page' }); setPicker(null); }} />}
    </div>
  );
}

function SaveBadge({ state, msg, retry }: { state: SaveState; msg: string; retry: () => void }) {
  // "Saved" only after the server has said so
  const text = { saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Not saved', conflict: 'Not saved: newer version' }[state];
  return <span className={`savestate s-${state}`} role="status" aria-live="polite" title={state === 'error' ? msg : undefined}>{state === 'saving' ? <Spinner /> : state === 'saved' ? <Icon.check size={13} /> : <Icon.clock size={13} />}{text}
    {state === 'error' && <button type="button" className="link-btn" onClick={retry}>Try again</button>}</span>;
}

function PageSide({ ws, g, pages }: { ws: WS; g: any; pages: PageRow[] }) {
  const toast = useToast(); const me = useMe();
  const comments = useLoad<any[]>(() => api.get(`/api/pages/${g.id}/comments`), [g.id]);
  const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); void pages;
  const post = async (e: React.FormEvent) => { e.preventDefault(); if (!body.trim()) return; setBusy(true); try { await api.post(`/api/pages/${g.id}/comments`, { body }); setBody(''); comments.reload(true); } catch (x: any) { toast(x.message, { err: true }); } finally { setBusy(false); } };
  const del = async (k: any) => { try { await api.del(`/api/page-comments/${k.id}`); comments.reload(true); } catch (x: any) { toast(x.message, { err: true }); } };
  return (
    <aside className="page-side" aria-label="About this page">
      <section className="panel ps-sec"><h2>Page details</h2>
        <dl className="ps-dl"><dt>Created by</dt><dd>{g.created_by_name ?? 'Someone'}<small>{new Date(g.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</small></dd>
          <dt>Last edited</dt><dd>{ago(g.updated_at)}<small>{g.updated_by_name ? `by ${g.updated_by_name}` : ''} · version {g.version}</small></dd></dl></section>
      <section className="panel ps-sec"><h2>Linked here from</h2>{g.backlinks.length ? <ul className="ps-links">{g.backlinks.map((b: any) => <li key={b.id}><Link to={`/projects/${ws.p.id}/notes/${b.id}`}>{b.icon ?? '📄'} {untitled(b.title)}</Link></li>)}</ul> : <p className="faint">No page links here yet. Type / then Page link on another page.</p>}</section>
      {g.task_refs.length > 0 && <section className="panel ps-sec"><h2>Tasks on this page</h2><ul className="ps-links">{g.task_refs.map((t: any) => <li key={t.id}><button type="button" className="link-btn" onClick={() => ws.openTask(t.id)}><StatusDot s={t.status} />{t.title}</button></li>)}</ul></section>}
      <section className="panel ps-sec"><h2>Comments</h2>
        {(comments.data ?? []).map((k) => <div key={k.id} className="comment sm"><Avatar name={k.author_name} size="xs" /><div className="grow"><div className="who-line"><b>{k.author_name ?? 'Former teammate'}</b><span className="faint">{ago(k.created_at)}</span>{(k.author_id === me.id || me.role === 'admin') && <button className="btn tiny ghost right" onClick={() => del(k)}>Delete</button>}</div><p className="prose">{k.body}</p></div></div>)}
        <form className="col" onSubmit={post}><textarea className="textarea" rows={2} placeholder="Comment. @name tells that person." value={body} onChange={(e) => setBody(e.target.value)} aria-label="Write a comment on this page" maxLength={5000} /><div><button className="btn tiny primary" disabled={busy || !body.trim()}>{busy && <Spinner />}Comment</button></div></form></section>
    </aside>
  );
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
    : ws.p.task_list.filter((t) => t.title.toLowerCase().includes(q.toLowerCase())).map((t) => ({ id: t.id, title: t.title, pre: <StatusDot s={t.status} /> }));
  return <Modal title={kind === 'page' ? 'Link a page' : 'Refer to a task'} onClose={() => onDone(null)}><div className="col">
    <input className="input" autoFocus placeholder={kind === 'page' ? 'Search pages' : 'Search tasks'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
    <ul className="pick-list">{items.slice(0, 50).map((x) => <li key={x.id}><button type="button" onClick={() => onDone({ id: x.id, title: x.title })}><span aria-hidden="true">{x.pre}</span>{x.title}</button></li>)}
      {!items.length && <li className="faint">Nothing matches.</li>}</ul>
    {kind === 'page' && <button type="button" className="btn tiny" onClick={onNewPage}><Icon.plus size={13} />New page inside this one, and link it</button>}
  </div></Modal>;
}
