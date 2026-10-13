import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useKeys, useLoad } from '../ui/hooks.ts';
import { Icon } from '../ui/icons.tsx';
import { useToast } from '../ui/toast.tsx';
import { Empty, Failure, Loading, Spinner, ago } from '../ui/kit.tsx';
import { Markdown } from '../ui/markdown.tsx';
import { isAdmin, useMe } from '../session.tsx';
import { Crumbs } from '../ui/chrome.tsx';
import { useConfirm } from '../ui/overlay.tsx';

const SAVE_KEY = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘S' : 'Ctrl S';

type PageRow = { id: string; slug: string; title: string; parent_id: string | null; updated_at: string; updated_by_name: string | null; snippet?: string };

// ---------- index: search and the page tree ----------
export function Wiki() {
  const [term, setTerm] = useState(''); const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(term.trim()), 220); return () => clearTimeout(t); }, [term]);
  const { data, error, loading, reload } = useLoad(() => api.get<PageRow[]>(`/api/wiki${q ? `?q=${encodeURIComponent(q)}` : ''}`), [q]);
  const ref = useRef<HTMLInputElement>(null); useKeys({ '/': () => ref.current?.focus() });
  return (
    <div className="page">
      <div className="head"><div><h1>Wiki</h1><p>How we work, written down once. Link pages with [[Page title]].</p></div>
        <div className="row wrap"><input ref={ref} className="input" style={{ width: 280, maxWidth: '100%' }} placeholder="Search every page" aria-keyshortcuts="/" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search the wiki" />
          <Link className="btn primary" to="/wiki/new"><Icon.plus size={16} />New page</Link></div></div>
      {loading && !data ? <Loading rows={5} /> : error ? <Failure error={error} retry={reload} /> : !data!.length ?
        <div className="card"><Empty title={q ? `Nothing matches “${q}”` : 'The wiki is empty'} action={q ? <button className="btn" onClick={() => { setTerm(''); ref.current?.focus(); }}>Clear the search</button> : undefined}>{q ? 'Search reads titles and page text. Try fewer words.' : 'Use New page to start. How a project runs, or how to onboard someone, are good first pages.'}</Empty></div>
        : q ? <div className="card flush">{data!.map((p) => <Link key={p.id} to={`/wiki/${p.slug}`} className="wiki-hit"><b>{p.title}</b>{p.snippet && <span className="muted"><Highlight s={p.snippet} /></span>}<span className="faint" style={{ fontSize: 'var(--fs-0)' }}>{ago(p.updated_at)}</span></Link>)}</div>
        : <div className="card"><Tree pages={data!} /></div>}
    </div>
  );
}
// \u0001 and \u0002 wrap each search hit (server side); everything else is plain text
function Highlight({ s }: { s: string }) {
  return <>{s.split(/(\u0001[^\u0002]*\u0002)/).map((part, i) => part.startsWith('\u0001') ? <mark key={i}>{part.slice(1, -1)}</mark> : part)}</>;
}
function Tree({ pages }: { pages: PageRow[] }) {
  const kids = useMemo(() => { const m = new Map<string | null, PageRow[]>(); for (const p of pages) { const k = pages.some((x) => x.id === p.parent_id) ? p.parent_id : null; m.set(k, [...(m.get(k) ?? []), p]); } return m; }, [pages]);
  const level = (parent: string | null, depth: number): React.ReactNode => <ul className="tree" style={{ paddingLeft: depth ? 18 : 0 }}>{(kids.get(parent) ?? []).map((p) =>
    <li key={p.id}><Link to={`/wiki/${p.slug}`}><Icon.wiki size={14} /><span>{p.title}</span><span className="faint right" style={{ fontSize: 'var(--fs-0)' }}>{ago(p.updated_at)}</span></Link>{kids.has(p.id) && level(p.id, depth + 1)}</li>)}</ul>;
  return <>{level(null, 0)}</>;
}

// ---------- one page: read, edit, history ----------
const guessTitle = (slug: string) => { const s = slug.replace(/-/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
export function WikiPage({ slug }: { slug: string }) {
  const { search, go } = useRouter(); const me = useMe(); const toast = useToast(); const ask = useConfirm();
  const isNew = slug === 'new';
  const { data, error, loading, reload } = useLoad(async () => {
    if (isNew) return null;
    try { return await api.get(`/api/wiki/${encodeURIComponent(slug)}`); } catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
  }, [slug]);
  const mode = isNew ? 'edit' : search.get('edit') ? 'edit' : search.get('history') ? 'history' : 'read';
  if (loading && !data) return <div className="page"><Loading rows={6} /></div>;
  if (error) return <div className="page"><Crumbs items={[{ to: '/wiki', label: 'Wiki' }, { label: 'Page' }]} /><Failure error={error} retry={reload} /></div>;
  if (!data && !isNew) return <div className="page"><Crumbs items={[{ to: '/wiki', label: 'Wiki' }, { label: guessTitle(slug) }]} /><div className="card"><Empty title="No page here yet" action={<Link className="btn primary" to={`/wiki/new?title=${encodeURIComponent(guessTitle(slug))}`}>Write it</Link>}>A link points to “{guessTitle(slug)}”, but nobody has written it.</Empty></div></div>;
  if (mode === 'edit') return <Editor page={data} initialTitle={search.get('title') ?? ''} parentId={search.get('parent')} onSaved={(s) => { reload(true); go(`/wiki/${s}`, true); }} onCancel={() => go(data ? `/wiki/${data.slug}` : '/wiki', true)} />;
  if (mode === 'history') return <History page={data} onRestored={() => { reload(true); go(`/wiki/${data.slug}`, true); }} />;
  const remove = async () => {
    if (!(await ask({ title: `Delete “${data.title}”?`, body: 'Its history goes with it. Pages inside it stay, and move to the top level.', confirm: 'Delete page', tone: 'danger' }))) return;
    try { await api.del(`/api/wiki/${data.id}`); toast('Page deleted.'); go('/wiki'); } catch (e: any) { toast(e.message, { err: true }); }
  };
  const canDelete = isAdmin(me) || data.created_by === me.id;
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="head">
        <div className="grow"><Crumbs items={[{ to: '/wiki', label: 'Wiki' }, ...(data.parent_slug ? [{ to: `/wiki/${data.parent_slug}`, label: data.parent_title }] : []), { label: data.title }]} />
          <h1 style={{ marginTop: 6 }}>{data.title}</h1><p className="faint" style={{ fontSize: 'var(--fs-0)' }}>Last edited by {data.updated_by_name ?? 'a former teammate'}, {ago(data.updated_at)} · version {data.version}</p></div>
        <div className="row"><Link className="btn primary" to={`/wiki/${data.slug}?edit=1`}><Icon.edit size={15} />Edit</Link><Link className="btn ghost" to={`/wiki/${data.slug}?history=1`}>History</Link>
          <Link className="btn ghost" to={`/wiki/new?parent=${data.id}`}><Icon.plus size={15} />Sub-page</Link>{canDelete && <button className="btn ghost danger" onClick={remove}><Icon.trash size={15} />Delete</button>}</div>
      </div>
      <article className="card">{data.body.trim() ? <Markdown text={data.body} /> : <p className="faint">This page is empty. <Link to={`/wiki/${data.slug}?edit=1`}>Write something</Link>.</p>}</article>
      {data.children.length > 0 && <section className="section"><span className="kick">Pages inside</span><div className="chips">{data.children.map((c: any) => <Link key={c.id} className="chip" to={`/wiki/${c.slug}`}>{c.title}</Link>)}</div></section>}
    </div>
  );
}

function Editor({ page, initialTitle, parentId, onSaved, onCancel }: { page: any | null; initialTitle: string; parentId: string | null; onSaved: (slug: string) => void; onCancel: () => void }) {
  const toast = useToast(); const ask = useConfirm();
  const [title, setTitle] = useState(page?.title ?? initialTitle); const [body, setBody] = useState(page?.body ?? '');
  const [parent, setParent] = useState<string>(page ? page.parent_id ?? '' : parentId ?? '');
  const [view, setView] = useState<'write' | 'preview'>('write'); const [busy, setBusy] = useState(false); const [conflict, setConflict] = useState<string | null>(null);
  const all = useLoad(() => api.get<PageRow[]>('/api/wiki'));
  const dirty = title !== (page?.title ?? initialTitle) || body !== (page?.body ?? '') || parent !== (page ? page.parent_id ?? '' : parentId ?? '');
  useEffect(() => { if (!dirty) return; const h = (e: BeforeUnloadEvent) => { e.preventDefault(); }; addEventListener('beforeunload', h); return () => removeEventListener('beforeunload', h); }, [dirty]);
  const save = async () => {
    if (!title.trim() || busy) return; setBusy(true); setConflict(null);
    try {
      const r = page ? await api.put(`/api/wiki/${page.id}`, { title, body, parent_id: parent || null, base_version: page.version }) : await api.post('/api/wiki', { title, body, parent_id: parent || null });
      toast(page ? 'Page saved.' : 'Page created.'); onSaved(r.slug);
    } catch (e: any) { if (e instanceof ApiError && e.status === 409) setConflict(e.message); else toast(e.message, { err: true }); } finally { setBusy(false); }
  };
  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); } }; addEventListener('keydown', h); return () => removeEventListener('keydown', h); });
  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="head"><div><Crumbs items={[{ to: '/wiki', label: 'Wiki' }, ...(page ? [{ to: `/wiki/${page.slug}`, label: page.title }] : []), { label: page ? 'Editing' : 'New page' }]} /><h1 style={{ marginTop: 6 }}>{title || 'Untitled'}</h1></div>
        <div className="row"><button className="btn ghost" onClick={async () => { if (!dirty || (await ask({ title: 'Discard your changes?', body: 'What you changed here has not been saved.', confirm: 'Discard changes', tone: 'danger' }))) onCancel(); }}>Cancel</button><button className="btn primary" onClick={save} disabled={busy || !title.trim()} aria-keyshortcuts={SAVE_KEY === '⌘S' ? 'Meta+S' : 'Control+S'}>{busy && <Spinner />}Save <kbd>{SAVE_KEY}</kbd></button></div></div>
      {conflict && <div className="banner err" role="alert">{conflict}</div>}
      <div className="grid-form">
        <label className="field" style={{ gridColumn: 'span 2' }}><span>Title</span><input autoFocus={!page} required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field"><span>Inside</span><select value={parent} onChange={(e) => setParent(e.target.value)}><option value="">Top level</option>{(all.data ?? []).filter((p) => p.id !== page?.id).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
      </div>
      <div className="tabs" role="tablist"><button role="tab" aria-selected={view === 'write'} className={view === 'write' ? 'on' : ''} onClick={() => setView('write')}>Write</button><button role="tab" aria-selected={view === 'preview'} className={view === 'preview' ? 'on' : ''} onClick={() => setView('preview')}>Preview</button></div>
      {view === 'write'
        ? <textarea className="textarea mono-ish" aria-label="Page text" value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 460, fieldSizing: 'content', lineHeight: 1.6 } as any}
            placeholder={'# A heading\n\nPlain paragraphs, **bold**, *italic*, `code`.\n\n- a list\n- [ ] a checklist item\n\nLink another page: [[Leave policy]]. Link the web: [text](https://example.com)'} />
        : <article className="card">{body.trim() ? <Markdown text={body} /> : <p className="faint">Nothing to preview.</p>}</article>}
    </div>
  );
}

function History({ page, onRestored }: { page: any; onRestored: () => void }) {
  const toast = useToast(); const ask = useConfirm();
  const revs = useLoad(() => api.get<any[]>(`/api/wiki/${page.id}/revisions`), [page.id]);
  const [open, setOpen] = useState<any | null>(null);
  const show = async (v: number) => { try { setOpen(await api.get(`/api/wiki/${page.id}/revisions/${v}`)); } catch (e: any) { toast(e.message, { err: true }); } };
  const restore = async () => {
    if (!open) return;
    if (!(await ask({ title: `Restore version ${open.version} of “${page.title}”?`, body: 'It becomes the newest version. Nothing is lost: the current text stays in the history.', confirm: 'Restore version', tone: 'primary' }))) return;
    try { await api.put(`/api/wiki/${page.id}`, { title: open.title, body: open.body, parent_id: page.parent_id, base_version: page.version }); toast(`Version ${open.version} is the current page again.`); onRestored(); }
    catch (e: any) { toast(e.message, { err: true }); }
  };
  return (
    <div className="page" style={{ maxWidth: 1200 }}>
      <div className="head"><div><Crumbs items={[{ to: '/wiki', label: 'Wiki' }, { to: `/wiki/${page.slug}`, label: page.title }, { label: 'History' }]} /><h1 style={{ marginTop: 6 }}>History</h1><p>Every save is kept. Restoring saves an old version as the newest one; nothing is lost.</p></div></div>
      <div className="split">
        <div className="list" aria-label="Versions">{revs.loading && !revs.data ? <div style={{ padding: 12 }}><Loading kind="list" rows={3} /></div> : null}{(revs.data ?? []).map((r) => <button key={r.version} className={open?.version === r.version ? 'on' : ''} aria-pressed={open?.version === r.version} onClick={() => show(r.version)}>
          <div className="row between"><b style={{ fontWeight: 600 }}>Version {r.version}{r.version === page.version && <span className="faint"> · current</span>}</b><span className="when">{ago(r.created_at)}</span></div>
          <span className="muted" style={{ fontSize: 'var(--fs-0)' }}>{r.author_name ?? 'Former teammate'} · {r.title}</span></button>)}</div>
        <div className="col">{open ? <><div className="row between"><h2 style={{ fontSize: 'var(--fs-3)' }}>{open.title}</h2>{open.version !== page.version && <button className="btn primary" onClick={restore}>Restore this version</button>}</div><article className="card"><Markdown text={open.body} /></article></>
          : <div className="card"><Empty title="Pick a version">Its text shows here.</Empty></div>}</div>
      </div>
    </div>
  );
}
