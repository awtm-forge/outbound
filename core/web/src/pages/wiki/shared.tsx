// Wiki pieces used by both the dashboard and a page: icons, the new-page dialog, the template library, categories,
// moving a page, quick links, and the actions a page's menu offers.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.ts';
import { useRouter } from '../../router.tsx';
import { useLoad } from '../../ui/hooks.ts';
import { Icon } from '../../ui/icons.tsx';
import { MenuItem } from '../../ui/menu.tsx';
import { Modal, useConfirm } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Empty, Failure, Skeleton, Spinner } from '../../ui/kit.tsx';
import { isAdmin, useMe } from '../../session.tsx';
import { BLANK, WIKI_TEMPLATES, type Template } from './templates.ts';

export type Cat = { id: string; name: string; icon: string | null; color: string | null; position: number; pages: number };
export type TreeRow = { id: string; slug: string; title: string; icon: string | null; parent_id: string | null; category_id: string | null; position: number; starred: boolean };
export type Card = { id: string; slug: string; title: string; icon: string | null; description: string; excerpt: string; parent_id: string | null; category_id: string | null; category: string | null; category_color: string | null; category_icon: string | null;
  is_template: boolean; archived_at: string | null; created_at: string; updated_at: string; created_by: string | null; created_by_name: string | null; updated_by_name: string | null; starred: boolean; views_30d: number; position: number };

export const CAT_ICONS = ['rocket', 'layers', 'send', 'handshake', 'file', 'settings', 'people', 'book', 'folder', 'wiki', 'chart', 'target', 'shield', 'code', 'globe', 'chat', 'calendar', 'star', 'bolt', 'trophy'] as const;
export const CAT_COLORS = ['#3B82F6', '#F43F5E', '#22C55E', '#F59E0B', '#A855F7', '#FF922E', '#06B6D4', '#EC4899', '#64748B'];
export const EMOJI = ['📄', '🎯', '📝', '🗓️', '📈', '🛠️', '📬', '🤝', '📋', '🗞️', '🔁', '❓', '🚀', '💡', '📦', '🔒', '🌐', '⚙️', '📊', '✅', '📚', '🧭', '🧩', '💬'];
const hexRgb = (hex?: string | null) => { const h = (hex ?? '#FF922E').replace('#', ''); return `${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}`; };
export const toneOf = (color?: string | null) => ({ '--wk-rgb': hexRgb(color) } as React.CSSProperties);
export const untitled = (t?: string | null) => t?.trim() || 'Untitled';

export function CatGlyph({ icon, size = 15 }: { icon?: string | null; size?: number }) {
  const I = (icon && (Icon as any)[icon]) || Icon.folder; return <I size={size} />;
}
// a page's own emoji, else its category's icon in the category colour
export function PageGlyph({ p, size = 'md' }: { p: { icon: string | null; category_icon?: string | null; category_color?: string | null; is_template?: boolean }; size?: 'sm' | 'md' }) {
  return <span className={`wk-glyph ${size}`} style={toneOf(p.category_color)} aria-hidden="true">{p.icon ? <span className="wk-emoji">{p.icon}</span> : p.is_template ? <Icon.copy size={size === 'sm' ? 14 : 20} /> : <CatGlyph icon={p.category_icon ?? 'file'} size={size === 'sm' ? 14 : 20} />}</span>;
}

// the pages a page may sit inside: anything but itself and its own sub-pages
export function parentOptions(tree: TreeRow[], self?: string) {
  const kids = new Map<string | null, TreeRow[]>(); for (const t of tree) kids.set(t.parent_id, [...(kids.get(t.parent_id) ?? []), t]);
  const out: { id: string; label: string }[] = [];
  const walk = (parent: string | null, depth: number) => { for (const t of (kids.get(parent) ?? []).sort((a, b) => a.position - b.position)) { if (t.id === self) continue; out.push({ id: t.id, label: `${'  '.repeat(depth)}${depth ? '└ ' : ''}${untitled(t.title)}` }); walk(t.id, depth + 1); } };
  const ids = new Set(tree.map((t) => t.id)); for (const t of tree) if (t.parent_id && !ids.has(t.parent_id)) kids.set(null, [...(kids.get(null) ?? []), t]);
  walk(null, 0); return out;
}

// ---------- new page ----------
export type NewInit = { parent_id?: string | null; category_id?: string | null; template?: string };
export function NewPage({ cats, tree, init, onClose, onCreated }: { cats: Cat[]; tree: TreeRow[]; init: NewInit; onClose: () => void; onCreated: (p: { id: string; slug: string }) => void }) {
  const toast = useToast();
  const custom = useLoad<{ rows: Card[] }>(() => api.get('/api/wiki/pages?view=templates&size=100&sort=title'));
  const [tpl, setTpl] = useState(init.template ?? 'blank');
  const builtIn = [BLANK, ...WIKI_TEMPLATES].find((t) => t.id === tpl);
  const [title, setTitle] = useState(builtIn && builtIn.id !== 'blank' ? builtIn.title : '');
  const [icon, setIcon] = useState<string | null>(builtIn && builtIn.id !== 'blank' ? builtIn.icon : null);
  const [cat, setCat] = useState<string>(init.category_id ?? (builtIn?.category ? cats.find((c) => c.name === builtIn.category)?.id ?? '' : ''));
  const [parent, setParent] = useState<string>(init.parent_id ?? ''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const pickTpl = (id: string) => {
    setTpl(id); const b = [BLANK, ...WIKI_TEMPLATES].find((t) => t.id === id); const c = custom.data?.rows.find((r) => r.id === id);
    if (b && b.id !== 'blank') { if (!title.trim() || [...WIKI_TEMPLATES].some((t) => t.title === title)) setTitle(b.title); setIcon(b.icon); if (!init.category_id) setCat(cats.find((x) => x.name === b.category)?.id ?? cat); }
    if (c) { if (!title.trim()) setTitle(c.title); setIcon(c.icon); if (!init.category_id && c.category_id) setCat(c.category_id); }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!title.trim()) { setErr('Give the page a title.'); return; } setBusy(true); setErr('');
    try {
      const c = custom.data?.rows.find((r) => r.id === tpl);
      let made: any;
      if (c) { made = await api.post(`/api/wiki/${c.id}/duplicate`, { as_page: true, title: title.trim() }); await api.patch(`/api/wiki/${made.id}`, { icon, category_id: cat || null, parent_id: parent || null }); }
      else made = await api.post('/api/wiki', { title: title.trim(), icon, category_id: cat || null, parent_id: parent || null, content: (builtIn ?? BLANK).content() });
      toast('Page created.'); onCreated(made);
    } catch (x: any) { setErr(x.message); setBusy(false); }
  };
  return <Modal title={init.parent_id ? 'New sub-page' : 'New page'} onClose={onClose} wide>
    <form className="wk-new" onSubmit={submit}>
      <div className="wk-new-fields">
        <div className="wk-title-row">
          <IconPicker value={icon} onChange={setIcon} />
          <label className="field grow"><span>Title</span><input autoFocus required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What is this page about?" /></label>
        </div>
        <div className="wk-2">
          <label className="field"><span>Category</span><select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">No category</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="field"><span>Inside</span><select value={parent} onChange={(e) => setParent(e.target.value)}><option value="">Top level</option>{parentOptions(tree).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
        </div>
        {err && <p className="form-err" role="alert">{err}</p>}
      </div>
      <fieldset className="wk-tpls"><legend>Start from</legend>
        <div className="tpl-grid">{[BLANK, ...WIKI_TEMPLATES].map((t) => <TplButton key={t.id} t={t} on={tpl === t.id} pick={() => pickTpl(t.id)} />)}
          {(custom.data?.rows ?? []).map((c) => <button key={c.id} type="button" className={`tpl${tpl === c.id ? ' on' : ''}`} aria-pressed={tpl === c.id} onClick={() => pickTpl(c.id)}><span className="tpl-ic" aria-hidden="true">{c.icon ?? '🧩'}</span><b>{untitled(c.title)}</b><small>Your team’s template</small></button>)}</div>
      </fieldset>
      <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy && <Spinner />}Create page</button></div>
    </form>
  </Modal>;
}
function TplButton({ t, on, pick }: { t: Template; on: boolean; pick: () => void }) {
  return <button type="button" className={`tpl${on ? ' on' : ''}`} aria-pressed={on} onClick={pick}><span className="tpl-ic" aria-hidden="true">{t.icon}</span><b>{t.title}</b><small>{t.hint}</small></button>;
}
export function IconPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return <div className="wk-iconpick" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
    <button type="button" className="wk-iconbtn" aria-label={value ? `Icon ${value}. Change icon` : 'Choose an icon'} aria-expanded={open} onClick={() => setOpen(!open)}>{value ?? <Icon.image size={18} />}</button>
    {open && <div className="emoji-grid wk-emoji-pop" role="dialog" aria-label="Icons">{EMOJI.map((e) => <button key={e} type="button" onClick={() => { onChange(e); setOpen(false); }} aria-label={`Icon ${e}`}>{e}</button>)}
      <button type="button" className="btn tiny" onClick={() => { onChange(null); setOpen(false); }}>No icon</button></div>}
  </div>;
}

// ---------- template library ----------
export function TemplateLibrary({ onClose, onUse, onChanged }: { onClose: () => void; onUse: (template: string) => void; onChanged: () => void }) {
  const { go } = useRouter(); const toast = useToast();
  const custom = useLoad<{ rows: Card[] }>(() => api.get('/api/wiki/pages?view=templates&size=100&sort=title'));
  const make = async () => {
    try { const t = await api.post('/api/wiki', { title: 'New template', icon: '🧩', is_template: true, content: BLANK.content() }); onChanged(); go(`/wiki/${t.slug}`); }
    catch (e: any) { toast(e.message, { err: true }); }
  };
  return <Modal title="Templates" onClose={onClose} wide>
    <p className="muted wk-lede">Each template starts an ordinary page that you can change however you like.</p>
    <h3 className="wk-sub">Built in</h3>
    <div className="tpl-grid">{WIKI_TEMPLATES.map((t) => <button key={t.id} type="button" className="tpl" onClick={() => onUse(t.id)}><span className="tpl-ic" aria-hidden="true">{t.icon}</span><b>{t.title}</b><small>{t.hint}</small></button>)}</div>
    <div className="row between wk-sub-row"><h3 className="wk-sub">Your team’s templates</h3><button type="button" className="btn tiny" onClick={make}><Icon.plus size={13} />New template</button></div>
    {custom.loading && !custom.data ? <Skeleton h={80} /> : custom.error ? <Failure error={custom.error} retry={() => custom.reload()} /> : custom.data!.rows.length
      ? <div className="tpl-grid">{custom.data!.rows.map((c) => <div key={c.id} className="tpl tpl-custom"><span className="tpl-ic" aria-hidden="true">{c.icon ?? '🧩'}</span><b>{untitled(c.title)}</b><small>{c.description || `By ${c.created_by_name ?? 'a former teammate'}`}</small>
          <span className="row"><button type="button" className="btn tiny primary" onClick={() => onUse(c.id)}>Use</button><button type="button" className="btn tiny ghost" onClick={() => go(`/wiki/${c.slug}`)}>Edit</button></span></div>)}</div>
      : <p className="faint">None yet. Use New template, or open any page and choose Save as template from its menu.</p>}
  </Modal>;
}

// ---------- categories ----------
export function CategoryManager({ cats, onClose, onChanged }: { cats: Cat[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast(); const ask = useConfirm();
  const [name, setName] = useState(''); const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); onChanged(); if (msg) toast(msg); } catch (e: any) { toast(e.message, { err: true }); } };
  const sorted = [...cats].sort((a, b) => a.position - b.position);
  const swap = (i: number, j: number) => { const a = sorted[i], b = sorted[j]; if (!a || !b) return; run(async () => { await api.patch(`/api/wiki/categories/${a.id}`, { position: b.position }); await api.patch(`/api/wiki/categories/${b.id}`, { position: a.position }); }); };
  return <Modal title="Categories" onClose={onClose} wide>
    <p className="muted wk-lede">Categories group pages in the side panel. Deleting one keeps its pages; they move to No category.</p>
    <ul className="wk-cats">{sorted.map((c, i) => <li key={c.id} style={toneOf(c.color)}>
      <span className="wk-cat-ic"><CatGlyph icon={c.icon} /></span>
      <input className="input" defaultValue={c.name} aria-label={`Name of ${c.name}`} maxLength={60} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) run(() => api.patch(`/api/wiki/categories/${c.id}`, { name: v }), 'Category renamed.'); else e.target.value = c.name; }} />
      <select aria-label={`Icon of ${c.name}`} value={c.icon ?? 'folder'} onChange={(e) => run(() => api.patch(`/api/wiki/categories/${c.id}`, { icon: e.target.value }))}>{CAT_ICONS.filter((k) => (Icon as any)[k]).map((k) => <option key={k} value={k}>{k}</option>)}</select>
      <span className="wk-swatches" role="radiogroup" aria-label={`Colour of ${c.name}`}>{CAT_COLORS.map((x) => <button key={x} type="button" role="radio" aria-checked={c.color === x} aria-label={x} className={c.color === x ? 'on' : ''} style={{ background: x }} onClick={() => run(() => api.patch(`/api/wiki/categories/${c.id}`, { color: x }))} />)}</span>
      <span className="faint wk-cat-n">{c.pages} {c.pages === 1 ? 'page' : 'pages'}</span>
      <button type="button" className="icon-btn" disabled={i === 0} onClick={() => swap(i, i - 1)} aria-label={`Move ${c.name} up`}><Icon.left size={14} /></button>
      <button type="button" className="icon-btn" disabled={i === sorted.length - 1} onClick={() => swap(i, i + 1)} aria-label={`Move ${c.name} down`}><Icon.right size={14} /></button>
      <button type="button" className="icon-btn danger" aria-label={`Delete ${c.name}`} onClick={async () => { if (await ask({ title: `Delete the category “${c.name}”?`, body: c.pages ? `Its ${c.pages} ${c.pages === 1 ? 'page stays' : 'pages stay'}, with no category.` : 'It has no pages.', confirm: 'Delete category', tone: 'danger' })) run(() => api.del(`/api/wiki/categories/${c.id}`), 'Category deleted.'); }}><Icon.trash size={14} /></button>
    </li>)}</ul>
    <form className="row wk-cat-add" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; setBusy(true); await run(() => api.post('/api/wiki/categories', { name: name.trim(), icon: 'folder', color: CAT_COLORS[cats.length % CAT_COLORS.length] }), 'Category added.'); setName(''); setBusy(false); }}>
      <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" aria-label="New category name" maxLength={60} /><button className="btn primary" disabled={busy || !name.trim()}>{busy && <Spinner />}Add category</button></form>
  </Modal>;
}

// ---------- move ----------
export function MoveDialog({ page, cats, tree, onClose, onDone }: { page: { id: string; title: string; category_id: string | null; parent_id: string | null }; cats: Cat[]; tree: TreeRow[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast(); const [cat, setCat] = useState(page.category_id ?? ''); const [parent, setParent] = useState(page.parent_id ?? ''); const [busy, setBusy] = useState(false);
  const opts = useMemo(() => parentOptions(tree, page.id), [tree, page.id]);
  return <Modal title={`Move “${untitled(page.title)}”`} onClose={onClose}>
    <form className="col" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await api.patch(`/api/wiki/${page.id}`, { category_id: cat || null, parent_id: parent || null }); toast('Page moved.'); onDone(); } catch (x: any) { toast(x.message, { err: true }); setBusy(false); } }}>
      <label className="field"><span>Category</span><select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">No category</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="field"><span>Inside</span><select value={parent} onChange={(e) => setParent(e.target.value)}><option value="">Top level</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
      <p className="faint">Sub-pages move with it.</p>
      <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy && <Spinner />}Move</button></div>
    </form>
  </Modal>;
}

// ---------- quick links ----------
export function QuickLinksEditor({ links, onClose, onSaved }: { links: { id: string; title: string; icon: string | null }[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const [list, setList] = useState(links); const [q, setQ] = useState(''); const [hits, setHits] = useState<Card[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setTimeout(async () => { try { const [p, tp] = await Promise.all([api.get(`/api/wiki/pages?size=8&sort=${q ? 'title' : 'updated'}${q ? `&q=${encodeURIComponent(q)}` : ''}`), api.get(`/api/wiki/pages?view=templates&size=6${q ? `&q=${encodeURIComponent(q)}` : ''}`)]); setHits([...p.rows, ...tp.rows]); } catch { setHits([]); } }, 200); return () => clearTimeout(t); }, [q]);
  const move = (i: number, d: number) => { const l = [...list]; const [x] = l.splice(i, 1); l.splice(i + d, 0, x!); setList(l); };
  return <Modal title="Quick links" onClose={onClose} wide>
    <p className="muted wk-lede">Your own shortcuts. Nobody else sees or changes them.</p>
    <div className="wk-ql-edit">
      <section><h3 className="wk-sub">Pinned ({list.length} of 20)</h3>
        {list.length ? <ol className="wk-ql-list">{list.map((l, i) => <li key={l.id}><span aria-hidden="true">{l.icon ?? '📄'}</span><span className="grow">{untitled(l.title)}</span>
          <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${untitled(l.title)} up`}><Icon.left size={14} /></button>
          <button type="button" className="icon-btn" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${untitled(l.title)} down`}><Icon.right size={14} /></button>
          <button type="button" className="icon-btn" onClick={() => setList(list.filter((x) => x.id !== l.id))} aria-label={`Remove ${untitled(l.title)}`}><Icon.x size={14} /></button></li>)}</ol>
          : <p className="faint">Nothing pinned yet. Add pages or templates from the right.</p>}</section>
      <section><h3 className="wk-sub">Add</h3>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages and templates" aria-label="Search pages and templates" />
        <ul className="wk-ql-list">{hits.filter((h) => !list.some((l) => l.id === h.id)).map((h) => <li key={h.id}><span aria-hidden="true">{h.icon ?? (h.is_template ? '🧩' : '📄')}</span><span className="grow">{untitled(h.title)}{h.is_template && <small className="faint"> template</small>}</span>
          <button type="button" className="btn tiny" disabled={list.length >= 20} onClick={() => setList([...list, { id: h.id, title: h.title, icon: h.icon }])}><Icon.plus size={13} />Add</button></li>)}</ul></section>
    </div>
    <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="button" className="btn primary" disabled={busy} onClick={async () => { setBusy(true); try { await api.put('/api/wiki/quick-links', { page_ids: list.map((l) => l.id) }); toast('Quick links saved.'); onSaved(); } catch (e: any) { toast(e.message, { err: true }); setBusy(false); } }}>{busy && <Spinner />}Save</button></div>
  </Modal>;
}

// ---------- a page's actions, for menus on cards, tree rows and the page itself ----------
type Target = { id: string; slug: string; title: string; starred: boolean; is_template: boolean; archived_at: string | null; created_by: string | null; category_id: string | null; parent_id: string | null };
export function usePageActions(onChanged: () => void) {
  const toast = useToast(); const ask = useConfirm(); const me = useMe(); const { go } = useRouter();
  const [moving, setMoving] = useState<Target | null>(null);
  const run = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); onChanged(); if (msg) toast(msg); return true; } catch (e: any) { toast(e.message, { err: true }); return false; } };
  const a = {
    star: (p: Target) => run(() => api.patch(`/api/wiki/${p.id}`, { starred: !p.starred }), p.starred ? 'Removed from starred.' : 'Starred.'),
    rename: async (p: Target) => { const v = await ask({ title: 'Rename page', input: { label: 'Title', required: true, value: p.title, max: 160 }, confirm: 'Rename' }); if (typeof v === 'string' && v && v !== p.title) await run(() => api.patch(`/api/wiki/${p.id}`, { title: v }), 'Page renamed.'); },
    duplicate: async (p: Target) => { try { const d = await api.post(`/api/wiki/${p.id}/duplicate`, {}); onChanged(); toast('Copy made.'); go(`/wiki/${d.slug}`); } catch (e: any) { toast(e.message, { err: true }); } },
    useTemplate: async (p: Target) => { try { const d = await api.post(`/api/wiki/${p.id}/duplicate`, { as_page: true }); onChanged(); go(`/wiki/${d.slug}`); } catch (e: any) { toast(e.message, { err: true }); } },
    saveAsTemplate: async (p: Target) => { const v = await ask({ title: 'Save as a template', body: 'A copy becomes a template for everyone. This page stays as it is.', input: { label: 'Template name', required: true, value: p.title, max: 160 }, confirm: 'Save template' }); if (typeof v === 'string' && v) await run(() => api.post(`/api/wiki/${p.id}/duplicate`, { as_template: true, title: v }), 'Template saved. Find it under Templates.'); },
    copyLink: async (p: Target) => { try { await navigator.clipboard.writeText(`${location.origin}/wiki/${p.slug}`); toast('Link copied.'); } catch { toast('Could not copy the link. Your browser blocked it.', { err: true }); } },
    pin: async (p: Target) => { try { const cur = await api.get<any[]>('/api/wiki/quick-links'); if (cur.some((x) => x.id === p.id)) { toast('Already in your quick links.'); return; } await api.put('/api/wiki/quick-links', { page_ids: [...cur.map((x) => x.id), p.id] }); onChanged(); toast('Added to your quick links.'); } catch (e: any) { toast(e.message, { err: true }); } },
    archive: (p: Target) => run(() => api.patch(`/api/wiki/${p.id}`, { archived: true }), 'Archived. Find it under Archive.'),
    restore: (p: Target) => run(() => api.patch(`/api/wiki/${p.id}`, { archived: false }), 'Page restored.'),
    remove: async (p: Target) => { if (await ask({ title: `Delete “${untitled(p.title)}” for good?`, body: 'Its history, comments and files go with it. Pages inside it move to the top level. This cannot be undone.', confirm: 'Delete page', tone: 'danger' })) return run(() => api.del(`/api/wiki/${p.id}`), 'Page deleted.'); return false; },
    move: (p: Target) => setMoving(p),
    canDelete: (p: Target) => isAdmin(me) || p.created_by === me.id,
  };
  const items = (p: Target, close: () => void, extra?: { open?: boolean }) => <>
    {extra?.open && <MenuItem onSelect={() => { close(); go(`/wiki/${p.slug}`); }}><Icon.arrow size={15} />Open</MenuItem>}
    {p.is_template && !p.archived_at && <MenuItem onSelect={() => { close(); a.useTemplate(p); }}><Icon.plus size={15} />Use template</MenuItem>}
    {!p.archived_at && <>
      <MenuItem onSelect={() => { close(); a.star(p); }}><Icon.star size={15} />{p.starred ? 'Unstar' : 'Star'}</MenuItem>
      <MenuItem onSelect={() => { close(); a.rename(p); }}><Icon.edit size={15} />Rename</MenuItem>
      <MenuItem onSelect={() => { close(); a.duplicate(p); }}><Icon.copy size={15} />Duplicate</MenuItem>
      {!p.is_template && <MenuItem onSelect={() => { close(); a.move(p); }}><Icon.layers size={15} />Move</MenuItem>}
      <MenuItem onSelect={() => { close(); a.copyLink(p); }}><Icon.link size={15} />Copy link</MenuItem>
      <MenuItem onSelect={() => { close(); a.pin(p); }}><Icon.bolt size={15} />Add to quick links</MenuItem>
      {!p.is_template && <MenuItem onSelect={() => { close(); a.saveAsTemplate(p); }}><Icon.copy size={15} />Save as template</MenuItem>}
      <div className="menu-sep" /><MenuItem onSelect={() => { close(); a.archive(p); }}><Icon.archive size={15} />Archive</MenuItem></>}
    {p.archived_at && <MenuItem onSelect={() => { close(); a.restore(p); }}><Icon.history size={15} />Restore</MenuItem>}
    {a.canDelete(p) && <MenuItem onSelect={() => { close(); a.remove(p); }}><Icon.trash size={15} /><span className="danger-text">Delete</span></MenuItem>}
  </>;
  return { a, items, moving, setMoving };
}

export function NotFound({ slug }: { slug: string }) {
  const title = slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const { go } = useRouter();
  return <div className="panel"><Empty title="No page here yet" action={<button className="btn primary" onClick={() => go(`/wiki?new=${encodeURIComponent(title)}`)}><Icon.plus size={15} />Write it</button>}>A link points to “{title}”, but nobody has written it, or it was deleted.</Empty></div>;
}
