import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { useRouter } from '../../router.tsx';
import { useLoad } from '../../ui/hooks.ts';
import { Icon, Dots } from '../../ui/icons.tsx';
import { Menu, MenuItem } from '../../ui/menu.tsx';
import { Modal, useConfirm } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Empty, Failure, Skeleton, ago, cardOpen } from '../../ui/kit.tsx';
import { useMe } from '../../session.tsx';
import { fileSize } from './shared.tsx';
import { FileDrawer } from './FileDrawer.tsx';
import type { WS } from './Workspace.tsx';

// ---------- what a file is, for the glyph, the filter and the sort ----------
export const kindOf = (mime: string) => mime.startsWith('image/') ? 'image' : mime === 'application/pdf' ? 'pdf' : /sheet|excel|csv/.test(mime) ? 'sheet' : /presentation|powerpoint/.test(mime) ? 'slides'
  : /word|document|text\/|markdown|json/.test(mime) ? 'doc' : mime.startsWith('video/') ? 'video' : mime === 'application/zip' ? 'zip' : 'other';
export const KIND: Record<string, [string, string]> = { image: ['Image', '#38BDF8'], pdf: ['PDF', '#F87171'], doc: ['Document', '#60A5FA'], sheet: ['Spreadsheet', '#4ADE80'], slides: ['Slides', '#FBBF24'], video: ['Video', '#C084FC'], zip: ['Archive', '#F472B6'], other: ['File', '#A3A9B5'] };
export const previewable = (mime: string) => /^image\/(png|jpeg|gif|webp)$/.test(mime) || mime === 'application/pdf' || mime === 'text/plain' || mime === 'video/mp4';
export const extOf = (name: string, mime: string) => { const k = kindOf(mime); const e = name.includes('.') ? name.split('.').pop()!.slice(0, 4).toUpperCase() : ''; return e || (k === 'other' ? 'FILE' : KIND[k]![0].slice(0, 4).toUpperCase()); };
export function FileGlyph({ f, size = 'md' }: { f: { id: string; name: string; mime: string }; size?: 'sm' | 'md' | 'lg' }) {
  const k = kindOf(f.mime); const color = KIND[k]![1];
  if (k === 'image' && f.mime !== 'image/svg+xml') return <img className={size === 'sm' ? 'fg-thumb' : 'fg-img'} src={`/api/files/${f.id}/content`} alt="" loading="lazy" />;
  return <span className={`fg fg-${size}`} style={{ '--fc': color } as React.CSSProperties} aria-hidden="true"><Icon.file size={size === 'sm' ? 15 : 22} /><b>{extOf(f.name, f.mime)}</b></span>;
}
export type Folder = { id: string; parent_id: string | null; name: string; color: string | null; position: number; files: number; size: string };
export type FileRow = { id: string; name: string; mime: string; size: number; task_id: string | null; page_id: string | null; folder_id: string | null; description: string; version: number; created_at: string; updated_at: string; uploaded_by: string; uploaded_by_name: string | null; task_title: string | null; page_title: string | null };
export const FOLDER_COLORS = ['#FF922E', '#38BDF8', '#22D3EE', '#4ADE80', '#A78BFA', '#F472B6', '#FBBF24', '#F87171'];
const SORTS: Record<string, [string, (a: FileRow, b: FileRow) => number]> = {
  updated: ['Last updated', (a, b) => (a.updated_at < b.updated_at ? 1 : -1)],
  name: ['Name', (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })],
  size: ['Size', (a, b) => b.size - a.size],
  type: ['Type', (a, b) => kindOf(a.mime).localeCompare(kindOf(b.mime)) || a.name.localeCompare(b.name)],
};
const PAGE = 48;
// limits are set in whole decimal megabytes (10 MB = 10,000,000 bytes), so they read as set
export const limitSize = (n: number) => (n % 1_000_000 === 0 ? `${n / 1_000_000} MB` : fileSize(n));
const pref = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } } };
// a folder with every folder under it, so nothing is moved into itself
export const below = (folders: Folder[], id: string): Set<string> => { const out = new Set([id]); let grew = true; while (grew) { grew = false; for (const f of folders) if (f.parent_id && out.has(f.parent_id) && !out.has(f.id)) { out.add(f.id); grew = true; } } return out; };
export const pathOf = (folders: Folder[], id: string | null) => { const out: Folder[] = []; let cur = id; const seen = new Set<string>(); while (cur && !seen.has(cur)) { seen.add(cur); const f = folders.find((x) => x.id === cur); if (!f) break; out.unshift(f); cur = f.parent_id; } return out; };
// the folder tree flattened with depth, for pickers
export const flatTree = (folders: Folder[], skip = new Set<string>()) => { const out: { f: Folder; depth: number }[] = []; const walk = (parent: string | null, depth: number) => { for (const f of folders.filter((x) => x.parent_id === parent).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))) { if (skip.has(f.id)) continue; out.push({ f, depth }); walk(f.id, depth + 1); } }; walk(null, 0); return out; };

type Up = { key: string; file: File; folder: string | null; pct: number; state: 'wait' | 'up' | 'done' | 'err' | 'cancel'; err?: string; renamed?: string | null; retry?: boolean };
const DRAG = 'application/x-forge-file';

export function Files({ ws }: { ws: WS }) {
  const { p } = ws; const toast = useToast(); const ask = useConfirm(); const me = useMe(); const { search, go } = useRouter();
  const base = `/projects/${p.id}/files`;
  const folderId = search.get('folder'); const openId = search.get('file');
  const files = useLoad<FileRow[]>(() => api.get(`/api/projects/${p.id}/files`), [p.id]);
  const fold = useLoad<Folder[]>(() => api.get(`/api/projects/${p.id}/folders`), [p.id]);
  const use = useLoad<{ used: number; limit: number | null; max_file: number; files: number }>(() => api.get(`/api/projects/${p.id}/files/usage`), [p.id]);
  const reloadAll = () => { files.reload(true); fold.reload(true); use.reload(true); };
  const [q, setQ] = useState(''); const [kind, setKind] = useState(''); const [sort, setSort] = useState(() => pref.get('files.sort') ?? 'updated');
  const [layout, setLayout] = useState<'grid' | 'list'>(() => (pref.get('files.layout') === 'list' ? 'list' : 'grid'));
  const [limit, setLimit] = useState(PAGE); const [sel, setSel] = useState<Set<string>>(new Set());
  const [over, setOver] = useState(false); const [dropOn, setDropOn] = useState<string | null>(null);
  const [folderForm, setFolderForm] = useState<{ edit?: Folder } | null>(null); const [moving, setMoving] = useState<{ files?: string[]; folder?: Folder } | null>(null);
  const [ups, setUps] = useState<Up[]>([]);
  const ctl = useRef(new Map<string, AbortController>()); const running = useRef(false); const queue = useRef<Up[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const maxFile = use.data?.max_file ?? 10_000_000;
  const folders = fold.data ?? []; const all = files.data ?? [];
  const cur = folderId && folders.find((f) => f.id === folderId) ? folderId : null;
  const trail = pathOf(folders, cur);
  useEffect(() => { if (search.get('upload') === '1') { input.current?.click(); go(base, true); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setLimit(PAGE); setSel(new Set()); }, [cur, q, kind]);
  const nav = (folder: string | null, extra = '') => go(`${base}${folder ? `?folder=${folder}` : ''}${extra ? (folder ? '&' : '?') + extra : ''}`);
  const openFile = (id: string | null) => { const s = new URLSearchParams(search); if (id) s.set('file', id); else s.delete('file'); const t = s.toString(); go(`${base}${t ? `?${t}` : ''}`, true); };

  // ---------- uploads: one at a time, each can be cancelled or tried again ----------
  const patchUp = (key: string, x: Partial<Up>) => setUps((u) => u.map((y) => (y.key === key ? { ...y, ...x } : y)));
  const pump = async () => {
    if (running.current) return; running.current = true;
    let any = false;
    while (queue.current.length) {
      const it = queue.current.shift()!; const c = new AbortController(); ctl.current.set(it.key, c);
      patchUp(it.key, { state: 'up', pct: 0, err: undefined });
      try {
        const r: any = await api.upload(`/api/projects/${p.id}/files?name=${encodeURIComponent(it.file.name)}${it.folder ? `&folder_id=${it.folder}` : ''}`, it.file, (pct) => patchUp(it.key, { pct }), c.signal);
        patchUp(it.key, { state: 'done', pct: 1, renamed: r?.renamed ?? null }); any = true;
      } catch (e: any) { patchUp(it.key, c.signal.aborted ? { state: 'cancel', err: 'Cancelled.' } : { state: 'err', err: e.message, retry: e.status !== 415 && e.status !== 413 }); }
      ctl.current.delete(it.key);
    }
    running.current = false;
    if (any) { reloadAll(); ws.reload(); }
  };
  const upload = (list: FileList | File[], folder: string | null = cur) => {
    const add: Up[] = [...list].map((file) => ({ key: crypto.randomUUID(), file, folder, pct: 0, state: 'wait' as const }));
    const ok: Up[] = [];
    for (const u of add) { if (u.file.size > maxFile) { u.state = 'err'; u.err = `${fileSize(u.file.size)} is over the ${limitSize(maxFile)} limit for one file.`; } else if (!u.file.size) { u.state = 'err'; u.err = 'The file is empty.'; } else ok.push(u); }
    setUps((x) => [...x, ...add]); queue.current.push(...ok); void pump();
  };
  const cancel = (u: Up) => { const c = ctl.current.get(u.key); if (c) c.abort(); else { queue.current = queue.current.filter((x) => x.key !== u.key); patchUp(u.key, { state: 'cancel', err: 'Cancelled.' }); } };
  const retry = (u: Up) => { patchUp(u.key, { state: 'wait', err: undefined, pct: 0 }); queue.current.push({ ...u, state: 'wait' }); void pump(); };
  const clearDone = () => setUps((u) => u.filter((x) => x.state === 'wait' || x.state === 'up'));

  // ---------- changes ----------
  const move = async (ids: string[], to: string | null) => {
    let n = 0; for (const id of ids) { try { await api.patch(`/api/files/${id}`, { folder_id: to }); n++; } catch (e: any) { toast(e.message, { err: true }); } }
    const name = to ? folders.find((f) => f.id === to)?.name : 'Project files';
    if (n) toast(`${n === 1 ? 'File' : `${n} files`} moved to ${name}.`); setSel(new Set()); reloadAll();
  };
  const canDelete = (f: FileRow) => f.uploaded_by === me.id || me.role === 'admin';
  const remove = async (list: FileRow[]) => {
    const mine = list.filter(canDelete); const skip = list.length - mine.length; if (!mine.length) { toast('Only the person who uploaded a file, or an admin, can delete it.', { err: true }); return; }
    if (!(await ask({ title: mine.length === 1 ? `Delete ${mine[0]!.name}?` : `Delete ${mine.length} files?`, body: `${mine.length === 1 ? 'The file and its earlier versions are' : 'These files and their earlier versions are'} removed for everyone. This cannot be undone.${skip ? ` ${skip} you did not upload will stay.` : ''}`, confirm: mine.length === 1 ? 'Delete file' : `Delete ${mine.length} files`, tone: 'danger' }))) return;
    let n = 0; for (const f of mine) { try { await api.del(`/api/files/${f.id}`); n++; } catch (e: any) { toast(e.message, { err: true }); } }
    if (n) toast(n === 1 ? 'File deleted.' : `${n} files deleted.`); setSel(new Set()); if (openId && mine.some((f) => f.id === openId)) openFile(null); reloadAll(); ws.reload();
  };
  const download = (list: FileRow[]) => { for (const f of list) { const a = document.createElement('a'); a.href = `/api/files/${f.id}/content?download=1`; a.download = f.name; document.body.append(a); a.click(); a.remove(); } };
  const rename = async (f: FileRow) => {
    const n = await ask({ title: 'Rename file', input: { label: 'Name', placeholder: f.name, value: f.name, required: true, max: 200 }, confirm: 'Rename' }); if (typeof n !== 'string' || !n.trim() || n.trim() === f.name) return;
    try { await api.patch(`/api/files/${f.id}`, { name: n.trim() }); files.reload(true); } catch (e: any) { toast(e.message, { err: true }); }
  };
  const removeFolder = async (fo: Folder) => {
    const inner = folders.filter((x) => x.parent_id === fo.id).length; const parent = fo.parent_id ? folders.find((x) => x.id === fo.parent_id)?.name : 'Project files';
    const what = [fo.files ? `${fo.files} ${fo.files === 1 ? 'file' : 'files'}` : '', inner ? `${inner} ${inner === 1 ? 'folder' : 'folders'}` : ''].filter(Boolean).join(' and ');
    if (!(await ask({ title: `Delete the folder ${fo.name}?`, body: what ? `Its ${what} move to ${parent}. No file is deleted.` : 'The folder is empty.', confirm: 'Delete folder', tone: 'danger' }))) return;
    try { const r = await api.del(`/api/folders/${fo.id}`); toast(r.moved ? `Folder deleted. ${r.moved} ${r.moved === 1 ? 'file' : 'files'} moved to ${parent}.` : 'Folder deleted.'); if (cur && below(folders, fo.id).has(cur)) nav(fo.parent_id); reloadAll(); } catch (e: any) { toast(e.message, { err: true }); }
  };

  // ---------- what is shown ----------
  const searching = !!q.trim();
  const sub = useMemo(() => folders.filter((f) => f.parent_id === cur).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)), [folders, cur]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return all.filter((f) => (searching ? f.name.toLowerCase().includes(t) || f.description.toLowerCase().includes(t) : f.folder_id === cur) && (!kind || kindOf(f.mime) === kind)).sort(SORTS[sort]?.[1] ?? SORTS.updated![1]);
  }, [all, q, kind, sort, cur, searching]);
  const recent = !cur && !searching && !kind && folders.length > 0 && all.length > 0 ? [...all].sort(SORTS.updated![1]).slice(0, 4) : [];
  const shown = list.slice(0, limit);
  const selected = all.filter((f) => sel.has(f.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const folderName = (id: string | null) => (id ? folders.find((f) => f.id === id)?.name ?? 'A folder' : 'Project files');
  const active = ups.filter((u) => u.state === 'wait' || u.state === 'up').length;

  // drag a file card onto a folder (or a breadcrumb) to move it there; drop files from the computer to upload there
  const dropTarget = (to: string | null, key: string) => ({
    onDragOver: (e: React.DragEvent) => { const t = e.dataTransfer.types; if (t.includes(DRAG) || t.includes('Files')) { e.preventDefault(); e.stopPropagation(); setDropOn(key); } },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOn((d) => (d === key ? null : d)); },
    onDrop: (e: React.DragEvent) => {
      setDropOn(null); setOver(false); const id = e.dataTransfer.getData(DRAG);
      if (id) { e.preventDefault(); e.stopPropagation(); const ids = sel.has(id) ? [...sel] : [id]; const moveIds = ids.filter((x) => all.find((f) => f.id === x)?.folder_id !== to); if (moveIds.length) void move(moveIds, to); }
      else if (e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); upload(e.dataTransfer.files, to); }
    },
  });
  const dragFile = (f: FileRow) => ({ draggable: true, onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData(DRAG, f.id); e.dataTransfer.effectAllowed = 'move'; } });

  const fileMenu = (f: FileRow) => (
    <Menu label={`Actions for ${f.name}`} className="icon-btn fmenu" button={<Dots vertical size={15} />} place="left">{(close) => <>
      <MenuItem onSelect={() => { close(); openFile(f.id); }}><Icon.eye size={15} />{previewable(f.mime) ? 'Preview and details' : 'Details'}</MenuItem>
      <MenuItem onSelect={() => { close(); download([f]); }}><Icon.download size={15} />Download</MenuItem>
      <MenuItem onSelect={() => { close(); rename(f); }}><Icon.edit size={15} />Rename</MenuItem>
      <MenuItem onSelect={() => { close(); setMoving({ files: [f.id] }); }}><Icon.folder size={15} />Move to folder</MenuItem>
      <MenuItem onSelect={() => { close(); void navigator.clipboard?.writeText(`${location.origin}${base}?file=${f.id}`).then(() => toast('Link copied.'), () => toast('The browser did not allow copying.', { err: true })); }}><Icon.link size={15} />Copy link</MenuItem>
      {canDelete(f) && <><div className="menu-sep" /><MenuItem onSelect={() => { close(); remove([f]); }}><Icon.trash size={15} />Delete</MenuItem></>}</>}</Menu>);
  const check = (f: FileRow) => <label className="fchk" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)} aria-label={`Select ${f.name}`} /></label>;
  const where = (f: FileRow) => (searching ? <button type="button" className="link-btn fwhere" onClick={() => { setQ(''); nav(f.folder_id); }}><Icon.folder size={12} />{folderName(f.folder_id)}</button> : null);

  if ((files.loading && !files.data) || (fold.loading && !fold.data)) return <div className="files"><Skeleton h={96} /><div className="fgrid">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={200} />)}</div></div>;
  if (files.error || fold.error) return <Failure error={(files.error ?? fold.error)!} retry={reloadAll} />;
  const u = use.data;
  return (
    <div className={`files${over ? ' over' : ''}`} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={(e) => { setOver(false); if (e.dataTransfer.files.length && !e.dataTransfer.getData(DRAG)) { e.preventDefault(); upload(e.dataTransfer.files); } }}>
      <section className="fhead">
        <span className="fhead-ic"><Icon.folder size={22} /></span>
        <div className="fhead-t"><h2>Project files</h2><p>All assets, references, and deliverables for this project.</p></div>
        <div className="fstore" aria-label="Storage used">
          {u ? <>
            <div className="fstore-n"><b>{fileSize(u.used)}</b>{u.limit ? <span> of {limitSize(u.limit)}</span> : <span> used</span>}</div>
            {u.limit ? <span className="pbar fstore-bar" role="progressbar" aria-valuenow={Math.round((u.used / u.limit) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Share of storage used"><i style={{ width: `${Math.min(100, (u.used / u.limit) * 100)}%` }} /></span> : null}
            <small>{u.files} {u.files === 1 ? 'file' : 'files'}{u.used > all.reduce((s, f) => s + f.size, 0) ? ', with earlier versions' : ''} · up to {limitSize(u.max_file)} each{u.limit ? '' : ' · no project limit set'}</small>
          </> : use.error ? <small>Storage use could not be read.</small> : <Skeleton h={34} w={160} />}
        </div>
      </section>

      <div className="ftools">
        <label className="tb-search grow"><Icon.find size={15} /><input type="search" placeholder="Search all files" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search all files" /></label>
        <select className="tb-select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type of file"><option value="">All types</option>{Object.entries(KIND).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="tb-select" value={sort} onChange={(e) => { setSort(e.target.value); pref.set('files.sort', e.target.value); }} aria-label="Sort by">{Object.entries(SORTS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        <div className="seg" role="group" aria-label="Layout">
          <button type="button" className={layout === 'grid' ? 'on' : ''} aria-pressed={layout === 'grid'} onClick={() => { setLayout('grid'); pref.set('files.layout', 'grid'); }} aria-label="Grid"><Icon.grid size={14} /></button>
          <button type="button" className={layout === 'list' ? 'on' : ''} aria-pressed={layout === 'list'} onClick={() => { setLayout('list'); pref.set('files.layout', 'list'); }} aria-label="List"><Icon.list size={14} /></button>
        </div>
        <button type="button" className="btn tiny" onClick={() => setFolderForm({})}><Icon.folder size={14} />New folder</button>
        <button type="button" className="btn tiny primary" onClick={() => input.current?.click()}><Icon.upload size={14} />Upload</button>
        <input ref={input} type="file" multiple className="sr" onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ''; }} aria-label="Choose files to upload" tabIndex={-1} />
      </div>

      <nav className="fcrumbs" aria-label="Folder">
        {searching ? <span>Results in all folders for “{q.trim()}”<button type="button" className="link-btn" onClick={() => setQ('')}>Clear search</button></span> : <>
          <button type="button" className={`fcrumb${dropOn === 'crumb:root' ? ' drop' : ''}`} onClick={() => nav(null)} aria-current={!cur ? 'page' : undefined} {...dropTarget(null, 'crumb:root')}><Icon.folder size={14} />Project files</button>
          {trail.map((f) => <span key={f.id} className="fcrumb-w"><Icon.right size={12} /><button type="button" className={`fcrumb${dropOn === `crumb:${f.id}` ? ' drop' : ''}`} onClick={() => nav(f.id)} aria-current={f.id === cur ? 'page' : undefined} {...dropTarget(f.id, `crumb:${f.id}`)}>{f.name}</button></span>)}
        </>}
      </nav>

      {ups.length > 0 && <section className="fups" aria-label="Uploads">
        <header><b>{active ? `Uploading ${active} ${active === 1 ? 'file' : 'files'}` : 'Uploads'}</b>{ups.some((x) => x.state !== 'wait' && x.state !== 'up') && <button type="button" className="link-btn" onClick={clearDone}>Clear finished</button>}</header>
        <ul aria-live="polite">{ups.map((x) => <li key={x.key} className={x.state}>
          <span className="fup-ic">{x.state === 'done' ? <Icon.check size={14} /> : x.state === 'err' ? <Icon.x size={14} /> : <Icon.file size={14} />}</span>
          <div className="fup-t"><b title={x.file.name}>{x.file.name}</b>
            <small>{x.state === 'done' ? <>{x.renamed ? `Saved as ${x.renamed}, because a file with that name is already in ${folderName(x.folder)}.` : `Uploaded to ${folderName(x.folder)}.`}</> : x.state === 'err' || x.state === 'cancel' ? x.err : x.state === 'wait' ? `Waiting · ${fileSize(x.file.size)}` : `${Math.round(x.pct * 100)}% of ${fileSize(x.file.size)}`}</small>
            {x.state === 'up' && <span className="pbar"><i style={{ width: `${x.pct * 100}%` }} /></span>}</div>
          {(x.state === 'wait' || x.state === 'up') && <button type="button" className="btn tiny ghost" onClick={() => cancel(x)} aria-label={`Cancel ${x.file.name}`}>Cancel</button>}
          {(x.state === 'cancel' || (x.state === 'err' && x.retry)) && <button type="button" className="btn tiny ghost" onClick={() => retry(x)}><Icon.redo size={13} />Try again</button>}
        </li>)}</ul>
      </section>}

      {sel.size > 0 && <div className="fbulk" role="region" aria-label="Selected files">
        <b>{sel.size} selected</b>
        <button type="button" className="btn tiny" onClick={() => setMoving({ files: [...sel] })}><Icon.folder size={14} />Move</button>
        <button type="button" className="btn tiny" onClick={() => download(selected)}><Icon.download size={14} />Download</button>
        <button type="button" className="btn tiny danger" onClick={() => remove(selected)}><Icon.trash size={14} />Delete</button>
        <button type="button" className="link-btn" onClick={() => setSel(new Set(list.map((f) => f.id)))}>Select all {list.length}</button>
        <button type="button" className="btn tiny ghost right" onClick={() => setSel(new Set())}>Clear</button>
      </div>}

      {!searching && (sub.length > 0 || !cur) && <section className="fsec" aria-label="Folders">
        <h3>Folders <span>{sub.length}</span></h3>
        <div className="ffolders">
          {sub.map((fo) => { const inner = folders.filter((x) => x.parent_id === fo.id).length; return (
            <article key={fo.id} className={`ffolder${dropOn === fo.id ? ' drop' : ''}`} style={{ '--fc': fo.color ?? '#FF922E' } as React.CSSProperties} {...cardOpen(() => nav(fo.id))} {...dropTarget(fo.id, fo.id)}>
              <span className="ffolder-ic"><Icon.folder size={20} /></span>
              <div className="ffolder-t"><button type="button" className="ffolder-n" onClick={() => nav(fo.id)}>{fo.name}</button>
                <small>{fo.files} {fo.files === 1 ? 'file' : 'files'}{inner ? ` · ${inner} ${inner === 1 ? 'folder' : 'folders'}` : ''}{Number(fo.size) ? ` · ${fileSize(Number(fo.size))}` : ''}</small></div>
              <Menu label={`Actions for the folder ${fo.name}`} className="icon-btn" button={<Dots vertical size={15} />} place="left">{(close) => <>
                <MenuItem onSelect={() => { close(); nav(fo.id); }}><Icon.folder size={15} />Open</MenuItem>
                <MenuItem onSelect={() => { close(); setFolderForm({ edit: fo }); }}><Icon.edit size={15} />Rename or colour</MenuItem>
                <MenuItem onSelect={() => { close(); setMoving({ folder: fo }); }}><Icon.right size={15} />Move</MenuItem>
                <div className="menu-sep" /><MenuItem onSelect={() => { close(); removeFolder(fo); }}><Icon.trash size={15} />Delete folder</MenuItem></>}</Menu>
            </article>); })}
          <button type="button" className="ffolder fnew" onClick={() => setFolderForm({})}><span className="ffolder-ic"><Icon.plus size={18} /></span><b>New folder</b></button>
        </div>
      </section>}

      {recent.length > 0 && <section className="fsec" aria-label="Recent files">
        <h3>Recent files</h3>
        <div className="frecent">{recent.map((f) => (
          <article key={f.id} className="frec" {...cardOpen(() => openFile(f.id))}>
            <FileGlyph f={f} size="sm" />
            <div><button type="button" className="frec-n" onClick={() => openFile(f.id)} title={f.name}>{f.name}</button><small>{f.folder_id ? `${folderName(f.folder_id)} · ` : ''}{ago(f.updated_at)}</small></div>
          </article>))}</div>
      </section>}

      <section className="fsec" aria-label="Files">
        <h3>{searching ? 'Matching files' : cur ? `Files in ${trail.at(-1)?.name}` : 'Files'} <span>{list.length}</span></h3>
        {list.length === 0 ? (
          searching || kind ? <p className="faint">No file matches{kind ? ` the type ${KIND[kind]![0]}` : ''}{searching ? ` “${q.trim()}”` : ''}.</p>
            : all.length === 0 && !folders.length ? <Empty title="No files yet">Upload designs, briefs, exports and screenshots for this project. They stay here for the whole team.</Empty>
              : <p className="faint">{cur ? 'This folder has no files yet.' : 'No files at the top level. Open a folder above or upload here.'}</p>
        ) : layout === 'grid' ? (
          <div className="fgrid">{shown.map((f) => { const k = kindOf(f.mime); return (
            <article key={f.id} className={`fcard${sel.has(f.id) ? ' sel' : ''}${openId === f.id ? ' open' : ''}`} {...cardOpen(() => openFile(f.id))} {...dragFile(f)}>
              {check(f)}
              <div className="fthumb">{k === 'image' && f.mime !== 'image/svg+xml' ? <FileGlyph f={f} /> : <FileGlyph f={f} size="lg" />}</div>
              <div className="fmeta"><button type="button" className="fname" onClick={() => openFile(f.id)} title={f.name}>{f.name}</button>
                <span>{KIND[k]![0]} · {fileSize(f.size)}{f.version > 1 ? ` · v${f.version}` : ''}</span>
                <span>{f.uploaded_by_name ?? 'Someone'} · {ago(f.updated_at)}</span>
                {where(f)}
                {f.task_title && <button type="button" className="link-btn ftask" onClick={() => ws.openTask(f.task_id)}><Icon.checkSquare size={12} />{f.task_title}</button>}</div>
              {fileMenu(f)}
            </article>); })}</div>
        ) : (
          <div className="flist" role="table" aria-label="Files">
            <div className="flist-h" role="row"><span role="columnheader"><span className="sr">Select</span></span><span role="columnheader">Name</span><span role="columnheader">Type</span><span role="columnheader">Size</span><span role="columnheader">Uploaded by</span><span role="columnheader">Updated</span><span role="columnheader"><span className="sr">Actions</span></span></div>
            {shown.map((f) => (
              <div key={f.id} role="row" className={`flist-r${sel.has(f.id) ? ' sel' : ''}${openId === f.id ? ' open' : ''}`} {...cardOpen(() => openFile(f.id))} {...dragFile(f)}>
                <span role="cell">{check(f)}</span>
                <span role="cell" className="flist-n"><FileGlyph f={f} size="sm" /><span><button type="button" className="fname" onClick={() => openFile(f.id)} title={f.name}>{f.name}</button>{(f.task_title || searching) && <small>{where(f)}{f.task_title && <button type="button" className="link-btn ftask" onClick={() => ws.openTask(f.task_id)}><Icon.checkSquare size={12} />{f.task_title}</button>}</small>}</span></span>
                <span role="cell">{KIND[kindOf(f.mime)]![0]}</span>
                <span role="cell">{fileSize(f.size)}{f.version > 1 ? ` · v${f.version}` : ''}</span>
                <span role="cell">{f.uploaded_by_name ?? 'Someone'}</span>
                <span role="cell">{ago(f.updated_at)}</span>
                <span role="cell">{fileMenu(f)}</span>
              </div>))}
          </div>
        )}
        {list.length > shown.length && <button type="button" className="btn tiny fmore" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, list.length - shown.length)} more of {list.length - shown.length} left</button>}
      </section>

      <button type="button" className={`fdrop${over || dropOn === 'zone' ? ' over' : ''}`} onClick={() => input.current?.click()} {...dropTarget(cur, 'zone')}>
        <span><Icon.upload size={22} /></span><b>Drop files here to upload{cur ? ` to ${trail.at(-1)?.name}` : ''}</b>
        <small>or click to choose · up to {limitSize(maxFile)} each · images, PDFs, documents, spreadsheets, slides, text, video and zip files</small>
      </button>

      {folderForm && <FolderForm projectId={p.id} parent={cur} edit={folderForm.edit} onClose={() => setFolderForm(null)} onDone={(fo, created) => { setFolderForm(null); fold.reload(true); toast(created ? `Folder ${fo.name} created.` : 'Folder saved.'); }} />}
      {moving && <MoveTo folders={folders} folder={moving.folder} count={moving.files?.length ?? 0} current={moving.folder ? moving.folder.parent_id : moving.files?.length === 1 ? all.find((f) => f.id === moving.files![0])?.folder_id ?? null : undefined}
        onClose={() => setMoving(null)} onPick={async (to) => {
          const m = moving; setMoving(null);
          if (m.files) await move(m.files, to);
          else if (m.folder) { try { await api.patch(`/api/folders/${m.folder.id}`, { parent_id: to }); toast(`Folder moved to ${folderName(to)}.`); fold.reload(true); } catch (e: any) { toast(e.message, { err: true }); } }
        }} />}
      {openId && <FileDrawer key={openId} id={openId} ws={ws} folders={folders} onClose={() => openFile(null)} onChanged={() => { reloadAll(); }} onDeleted={() => { openFile(null); reloadAll(); ws.reload(); }} />}
    </div>
  );
}

function FolderForm({ projectId, parent, edit, onClose, onDone }: { projectId: string; parent: string | null; edit?: Folder; onClose: () => void; onDone: (f: Folder, created: boolean) => void }) {
  const [name, setName] = useState(edit?.name ?? ''); const [color, setColor] = useState<string | null>(edit?.color ?? null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (!name.trim()) { setErr('Give the folder a name.'); return; } setBusy(true); setErr('');
    try { const r = edit ? await api.patch(`/api/folders/${edit.id}`, { name: name.trim(), color }) : await api.post(`/api/projects/${projectId}/folders`, { name: name.trim(), color, parent_id: parent }); onDone(r, !edit); }
    catch (x: any) { setErr(x.message); setBusy(false); }
  };
  return <Modal title={edit ? `Folder ${edit.name}` : 'New folder'} onClose={onClose}>
    <form onSubmit={save} className="stack">
      <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus placeholder="Design files" /></label>
      <fieldset className="field fcolors"><legend>Colour</legend>
        <label className={!color ? 'on' : ''}><input type="radio" name="fcolor" checked={!color} onChange={() => setColor(null)} className="sr" /><span style={{ '--fc': '#FF922E' } as React.CSSProperties} />Default</label>
        {FOLDER_COLORS.slice(1).map((c) => <label key={c} className={color === c ? 'on' : ''} title={c}><input type="radio" name="fcolor" checked={color === c} onChange={() => setColor(c)} className="sr" aria-label={`Colour ${c}`} /><span style={{ '--fc': c } as React.CSSProperties} /></label>)}
      </fieldset>
      {err && <p className="err" role="alert">{err}</p>}
      <div className="row"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary right" disabled={busy}>{edit ? 'Save' : 'Create folder'}</button></div>
    </form>
  </Modal>;
}

export function MoveTo({ folders, folder, count, current, onClose, onPick }: { folders: Folder[]; folder?: Folder; count: number; current?: string | null; onClose: () => void; onPick: (to: string | null) => void }) {
  const skip = folder ? below(folders, folder.id) : new Set<string>(); const tree = flatTree(folders, skip);
  const [to, setTo] = useState<string>(current === undefined ? '' : current ?? '');
  return <Modal title={folder ? `Move the folder ${folder.name}` : count === 1 ? 'Move file' : `Move ${count} files`} onClose={onClose}>
    <form onSubmit={(e) => { e.preventDefault(); onPick(to || null); }} className="stack">
      <div className="fmove" role="radiogroup" aria-label="Destination">
        <label className={to === '' ? 'on' : ''}><input type="radio" name="fdest" checked={to === ''} onChange={() => setTo('')} className="sr" /><Icon.folder size={15} />Project files (top level)</label>
        {tree.map(({ f, depth }) => <label key={f.id} className={to === f.id ? 'on' : ''} style={{ paddingLeft: 12 + depth * 18, '--fc': f.color ?? '#FF922E' } as React.CSSProperties}><input type="radio" name="fdest" checked={to === f.id} onChange={() => setTo(f.id)} className="sr" /><Icon.folder size={15} />{f.name}</label>)}
      </div>
      <div className="row"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary right" disabled={(current ?? '') === to && current !== undefined}>Move here</button></div>
    </form>
  </Modal>;
}
