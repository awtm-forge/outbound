// One file, on the right: a preview when the browser can show it safely, the details that can be changed (name,
// description, folder, task, page), a new version with the old ones kept, comments and what happened to it.
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api.ts';
import { useLoad } from '../../ui/hooks.ts';
import { Icon } from '../../ui/icons.tsx';
import { useConfirm, useFocusTrap } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Failure, Skeleton, ago, when } from '../../ui/kit.tsx';
import { accentVars } from '../../ui/color.tsx';
import { useMe } from '../../session.tsx';
import { Avatar, describe, fileSize } from './shared.tsx';
import { FileGlyph, KIND, flatTree, kindOf, limitSize, previewable, type Folder } from './Files.tsx';
import type { WS } from './Workspace.tsx';

const TABS = ['Details', 'Comments', 'Versions', 'Activity'] as const;
export function FileDrawer({ id, ws, folders, onClose, onChanged, onDeleted }: { id: string; ws: WS; folders: Folder[]; onClose: () => void; onChanged: () => void; onDeleted: () => void }) {
  const { p } = ws; const toast = useToast(); const ask = useConfirm(); const me = useMe();
  const { data: f, error, loading, reload, setData } = useLoad<any>(() => api.get(`/api/files/${id}`), [id]) as any;
  const pages = useLoad<any[]>(() => api.get(`/api/projects/${p.id}/pages`), [p.id]);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Details');
  const [up, setUp] = useState<number | null>(null); const replaceInput = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLElement>(null);
  useFocusTrap(ref, () => { const a = document.activeElement as HTMLElement | null; if (a?.matches('input, textarea, select') && ref.current?.contains(a)) ref.current!.focus(); else onClose(); }, ref);
  const save = async (patch: Record<string, unknown>) => {
    const before = f; setData?.({ ...f, ...patch });
    try { await api.patch(`/api/files/${id}`, patch); reload(true); onChanged(); if ('task_id' in patch) ws.reload(); } catch (e: any) { setData?.(before); toast(e.message, { err: true }); }
  };
  const replace = async (file: File) => {
    const max = 10_000_000; if (file.size > max) { toast(`${file.name} is ${fileSize(file.size)}. The limit is ${limitSize(max)} for one file.`, { err: true }); return; }
    setUp(0);
    try { const r = await api.upload(`/api/files/${id}/replace`, file, (x) => setUp(x)); toast(`Version ${r.version} uploaded. The earlier version is kept.`); reload(true); onChanged(); setTab('Versions'); }
    catch (e: any) { toast(e.message, { err: true }); }
    setUp(null);
  };
  const del = async () => {
    if (!(await ask({ title: `Delete ${f.name}?`, body: `The file${f.versions.length ? `, its ${f.versions.length} earlier ${f.versions.length === 1 ? 'version' : 'versions'}` : ''} and its comments are removed for everyone. This cannot be undone.`, confirm: 'Delete file', tone: 'danger' }))) return;
    try { await api.del(`/api/files/${id}`); toast('File deleted.'); onDeleted(); } catch (e: any) { toast(e.message, { err: true }); }
  };
  const link = () => navigator.clipboard?.writeText(`${location.origin}/projects/${p.id}/files?file=${id}`).then(() => toast('Link copied.'), () => toast('The browser did not allow copying.', { err: true }));
  const k = f ? kindOf(f.mime) : 'other';
  return createPortal(
    <>
      <div className="drawer-back" onClick={onClose} />
      <section ref={ref} className="drawer fdrawer" role="dialog" aria-modal="true" aria-labelledby="fd-title" tabIndex={-1} style={accentVars(p.color)}>
        {loading && !f ? <div className="fd-body"><Skeleton h={28} w="70%" /><Skeleton h={220} /></div> : error ? <div className="fd-body"><Failure error={error} retry={reload} /><button className="btn" onClick={onClose}>Close</button></div> : <>
          <header className="fd-head">
            <FileGlyph f={f} size="sm" />
            <h2 id="fd-title" className="sr">{f.name}</h2>
            <NameInput value={f.name} onSave={(name) => save({ name })} />
            <button type="button" className="icon-btn fd-close" onClick={onClose} aria-label="Close"><Icon.x size={18} /></button>
          </header>
          <div className="fd-body">
            <div className="fd-preview">
              {!previewable(f.mime) ? <div className="fd-nopre"><FileGlyph f={f} size="lg" /><p>{KIND[k]![0]} files cannot be previewed here. Download it to open it.</p></div>
                : f.mime.startsWith('image/') ? <img src={`/api/files/${id}/content?v=${f.version}`} alt={f.description || f.name} />
                  : f.mime === 'video/mp4' ? <video src={`/api/files/${id}/content?v=${f.version}`} controls />
                    : f.mime === 'text/plain' ? <TextPreview id={id} version={f.version} />
                      : <iframe src={`/api/files/${id}/content?v=${f.version}`} title={`Preview of ${f.name}`} />}
            </div>
            <div className="fd-actions">
              <a className="btn tiny primary" href={`/api/files/${id}/content?download=1`} download={f.name}><Icon.download size={14} />Download</a>
              <button type="button" className="btn tiny" onClick={() => replaceInput.current?.click()} disabled={up !== null}><Icon.upload size={14} />{up !== null ? `Uploading ${Math.round(up * 100)}%` : 'Upload new version'}</button>
              <input ref={replaceInput} type="file" className="sr" tabIndex={-1} aria-label="Choose the new version" onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ''; if (x) void replace(x); }} />
              <button type="button" className="btn tiny ghost" onClick={link}><Icon.link size={14} />Copy link</button>
              {(f.uploaded_by === me.id || me.role === 'admin') && <button type="button" className="btn tiny ghost danger right" onClick={del}><Icon.trash size={14} />Delete</button>}
            </div>
            {up !== null && <span className="pbar"><i style={{ width: `${up * 100}%` }} /></span>}
            <div className="tp-tabs" role="tablist" aria-label="File">{TABS.map((x) => <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>
              {x}{x === 'Comments' && f.comments.length ? ` ${f.comments.length}` : ''}{x === 'Versions' ? ` ${f.versions.length + 1}` : ''}</button>)}</div>
            <div role="tabpanel" aria-label={tab} className="fd-panel">
              {tab === 'Details' && <>
                <label className="field"><span>Description</span><Described value={f.description} onSave={(description) => save({ description })} /></label>
                <dl className="fd-facts">
                  <dt>Type</dt><dd>{KIND[k]![0]} <span className="faint">({f.mime})</span></dd>
                  <dt>Size</dt><dd>{fileSize(f.size)}</dd>
                  <dt>Version</dt><dd>{f.version}</dd>
                  <dt>Uploaded by</dt><dd>{f.uploaded_by_name ?? 'Someone no longer here'}</dd>
                  <dt>Added</dt><dd>{when(f.created_at)}</dd>
                  <dt>Last updated</dt><dd>{when(f.updated_at)}</dd>
                </dl>
                <label className="field"><span>Folder</span><select value={f.folder_id ?? ''} onChange={(e) => save({ folder_id: e.target.value || null })}>
                  <option value="">Project files (top level)</option>{flatTree(folders).map(({ f: fo, depth }) => <option key={fo.id} value={fo.id}>{' '.repeat(depth * 3)}{fo.name}</option>)}</select></label>
                <div className="field"><label htmlFor="fd-task">Linked task</label><div className="row">
                  <select id="fd-task" value={f.task_id ?? ''} onChange={(e) => save({ task_id: e.target.value || null })}><option value="">No task</option>{p.task_list.filter((t) => !t.archived_at || t.id === f.task_id).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
                  {f.task_id && <button type="button" className="btn tiny ghost" onClick={() => { onClose(); ws.openTask(f.task_id); }}>Open task</button>}</div></div>
                <div className="field"><label htmlFor="fd-page">Linked note</label><div className="row">
                  <select id="fd-page" value={f.page_id ?? ''} onChange={(e) => save({ page_id: e.target.value || null })} disabled={!pages.data}><option value="">No note</option>{(pages.data ?? []).filter((g) => g.kind !== 'folder').map((g) => <option key={g.id} value={g.id}>{g.title || 'Untitled'}</option>)}</select>
                  {f.page_id && <a className="btn tiny ghost" href={`/projects/${p.id}/notes/${f.page_id}`}>Open note</a>}</div></div>
              </>}
              {tab === 'Comments' && <Comments f={f} meId={me.id} admin={me.role === 'admin'} onChanged={() => reload(true)} />}
              {tab === 'Versions' && <ol className="fd-vers">
                <li className="now"><b>Version {f.version}</b><span>Current · {fileSize(f.size)} · {f.uploaded_by_name ?? 'Someone'} · {ago(f.updated_at)}</span><a className="btn tiny ghost" href={`/api/files/${id}/content?download=1`} download={f.name}><Icon.download size={13} />Download</a></li>
                {f.versions.map((v: any) => <li key={v.version}><b>Version {v.version}</b><span>{fileSize(v.size)} · {v.uploaded_by_name ?? 'Someone'} · {ago(v.created_at)}</span><a className="btn tiny ghost" href={`/api/files/${id}/versions/${v.version}/content`} download><Icon.download size={13} />Download</a></li>)}
                {!f.versions.length && <li className="faint">No earlier versions. Upload a new version to keep this one in the history.</li>}
              </ol>}
              {tab === 'Activity' && (f.activity.length ? <ul className="fd-act">{f.activity.map((a: any, i: number) => { const d = describe(a); const I = Icon[d.icon]; return (
                <li key={i}><span className={`f-ic tone-${d.tone}`} aria-hidden="true"><I size={13} /></span><div><span><b>{a.actor_name ?? 'Someone'}</b> {d.verb}{d.note ? ` ${d.note}` : ''}</span><small>{ago(a.created_at)}</small></div></li>); })}</ul>
                : <p className="faint">Nothing recorded for this file yet.</p>)}
            </div>
          </div>
        </>}
      </section>
    </>, document.body);
}

// text is read as text and shown as text (never run); long files show their start
function TextPreview({ id, version }: { id: string; version: number }) {
  const { data, error } = useLoad<string>(async () => { const r = await fetch(`/api/files/${id}/content?v=${version}`, { credentials: 'same-origin' }); if (!r.ok) throw new Error('The file could not be read.'); const t = await r.text(); return t.length > 100_000 ? t.slice(0, 100_000) + '\n\n… (the rest is in the download)' : t; }, [id, version]);
  return error ? <p className="faint">{error}</p> : data === null ? <Skeleton h={160} /> : <pre className="fd-text" tabIndex={0} aria-label="File text">{data || '(empty)'}</pre>;
}
function NameInput({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value); const [last, setLast] = useState(value); if (value !== last) { setLast(value); setV(value); }
  const done = () => { const t = v.trim(); if (t && t !== value) onSave(t); else setV(value); };
  return <input className="fd-name" value={v} onChange={(e) => setV(e.target.value)} onBlur={done} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} maxLength={200} aria-label="File name" />;
}
function Described({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value); const [last, setLast] = useState(value); if (value !== last) { setLast(value); setV(value); }
  return <textarea rows={3} value={v} maxLength={2000} placeholder="What this file is, which version the client approved, where it is used" onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== value) onSave(v); }} />;
}
function Comments({ f, meId, admin, onChanged }: { f: any; meId: string; admin: boolean; onChanged: () => void }) {
  const toast = useToast(); const [body, setBody] = useState(''); const [busy, setBusy] = useState(false);
  const post = async () => { if (!body.trim()) return; setBusy(true); try { await api.post(`/api/files/${f.id}/comments`, { body: body.trim() }); setBody(''); onChanged(); } catch (e: any) { toast(e.message, { err: true }); } setBusy(false); };
  const del = async (cid: string) => { try { await api.del(`/api/file-comments/${cid}`); onChanged(); } catch (e: any) { toast(e.message, { err: true }); } };
  return <div className="fd-comments">
    {f.comments.length ? <ul>{f.comments.map((c: any) => <li key={c.id}><Avatar name={c.author_name} size="sm" /><div><span><b>{c.author_name ?? 'Someone'}</b><small>{ago(c.created_at)}</small>
      {(c.author_id === meId || admin) && <button type="button" className="link-btn" onClick={() => del(c.id)} aria-label="Delete comment">Delete</button>}</span><p>{c.body}</p></div></li>)}</ul>
      : <p className="faint">No comments yet. Feedback on this file goes here; @username lets someone know.</p>}
    <form onSubmit={(e) => { e.preventDefault(); void post(); }}>
      <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment" aria-label="Add a comment" maxLength={5000} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void post(); } }} />
      <button className="btn tiny primary" disabled={busy || !body.trim()}>Comment</button>
    </form>
  </div>;
}
