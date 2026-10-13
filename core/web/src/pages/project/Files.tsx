import { useEffect, useRef, useState } from 'react';
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
import type { WS } from './Workspace.tsx';

const MAX = 10_000_000;
const kindOf = (mime: string) => mime.startsWith('image/') ? 'image' : mime === 'application/pdf' ? 'pdf' : /word|document|text\/|markdown|json/.test(mime) ? 'doc' : /sheet|excel|csv/.test(mime) ? 'sheet' : /presentation|powerpoint/.test(mime) ? 'slides' : mime.startsWith('video/') ? 'video' : 'other';
const KIND: Record<string, [string, string]> = { image: ['Image', '#38BDF8'], pdf: ['PDF', '#F87171'], doc: ['Document', '#60A5FA'], sheet: ['Sheet', '#4ADE80'], slides: ['Slides', '#FBBF24'], video: ['Video', '#C084FC'], other: ['File', '#A3A9B5'] };
const previewable = (mime: string) => /^image\/(png|jpeg|gif|webp)$/.test(mime) || mime === 'application/pdf' || mime === 'text/plain' || mime === 'video/mp4';

type Up = { name: string; pct: number; err?: string };
export function Files({ ws }: { ws: WS }) {
  const { p } = ws; const toast = useToast(); const ask = useConfirm(); const me = useMe(); const { search, go } = useRouter();
  const [q, setQ] = useState(''); const [kind, setKind] = useState('');
  const { data, error, loading, reload } = useLoad<any[]>(() => api.get(`/api/projects/${p.id}/files`), [p.id]);
  const [ups, setUps] = useState<Up[]>([]); const [over, setOver] = useState(false); const [view, setView] = useState<any>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (search.get('upload') === '1') { input.current?.click(); go(`/projects/${p.id}/files`, true); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const upload = async (files: FileList | File[]) => {
    for (const f of [...files]) {
      if (f.size > MAX) { toast(`${f.name} is ${fileSize(f.size)}. The limit is 10 MB.`, { err: true }); continue; }
      setUps((u) => [...u, { name: f.name, pct: 0 }]);
      try { await api.upload(`/api/projects/${p.id}/files?name=${encodeURIComponent(f.name)}`, f, (pct) => setUps((u) => u.map((x) => (x.name === f.name ? { ...x, pct } : x)))); setUps((u) => u.filter((x) => x.name !== f.name)); toast(`${f.name} uploaded.`); }
      catch (e: any) { setUps((u) => u.map((x) => (x.name === f.name ? { ...x, err: e.message } : x))); }
    }
    reload(true); ws.reload();
  };
  const rename = async (f: any) => { const n = await ask({ title: 'Rename file', input: { label: 'Name', placeholder: f.name, required: true }, confirm: 'Rename' }); if (typeof n !== 'string' || !n.trim()) return;
    try { await api.patch(`/api/files/${f.id}`, { name: n.trim() }); reload(true); } catch (e: any) { toast(e.message, { err: true }); } };
  const attach = async (f: any, taskId: string | null) => { try { await api.patch(`/api/files/${f.id}`, { task_id: taskId }); reload(true); ws.reload(); toast(taskId ? 'Attached to the task.' : 'Detached from the task.'); } catch (e: any) { toast(e.message, { err: true }); } };
  const del = async (f: any) => { if (!(await ask({ title: `Delete ${f.name}?`, body: 'The file is removed for everyone. This cannot be undone.', confirm: 'Delete file', tone: 'danger' }))) return;
    try { await api.del(`/api/files/${f.id}`); toast('File deleted.'); reload(true); ws.reload(); } catch (e: any) { toast(e.message, { err: true }); } };
  const list = (data ?? []).filter((f) => (!q || f.name.toLowerCase().includes(q.toLowerCase())) && (!kind || kindOf(f.mime) === kind));
  return (
    <div className="files" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); } }}>
      <div className="bd-tools">
        <label className="tb-search grow"><Icon.find size={15} /><input placeholder="Search files" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search files" /></label>
        <select className="tb-select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind of file"><option value="">All kinds</option>{Object.entries(KIND).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        <button type="button" className="btn tiny primary" onClick={() => input.current?.click()}><Icon.upload size={14} />Upload files</button>
        <input ref={input} type="file" multiple className="sr" onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ''; }} aria-label="Choose files to upload" />
      </div>
      {ups.length > 0 && <ul className="ups" aria-live="polite">{ups.map((u) => <li key={u.name} className={u.err ? 'err' : ''}><Icon.file size={14} /><span>{u.name}</span>{u.err ? <><span className="late">{u.err}</span><button className="btn tiny ghost" onClick={() => setUps((x) => x.filter((y) => y.name !== u.name))}>Dismiss</button></> : <><span className="pbar"><i style={{ width: `${u.pct * 100}%` }} /></span><span>{Math.round(u.pct * 100)}%</span></>}</li>)}</ul>}
      {loading && !data ? <div className="fgrid">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={190} />)}</div> : error ? <Failure error={error} retry={reload} /> :
        <div className={`fgrid${over ? ' over' : ''}`}>
          {list.map((f) => { const k = kindOf(f.mime); const [label, color] = KIND[k]!; return (
            <article key={f.id} className="fcard" {...cardOpen(() => previewable(f.mime) ? setView(f) : window.open(`/api/files/${f.id}/content?download=1`))}>
              <button type="button" className="fthumb" onClick={() => previewable(f.mime) ? setView(f) : window.open(`/api/files/${f.id}/content?download=1`)} aria-label={`${previewable(f.mime) ? 'Preview' : 'Download'} ${f.name}`}>
                {k === 'image' && f.mime !== 'image/svg+xml' ? <img src={`/api/files/${f.id}/content`} alt="" loading="lazy" /> : <span className="ftype" style={{ color, borderColor: color }}>{label === 'File' ? (f.name.split('.').pop() ?? 'FILE').slice(0, 4).toUpperCase() : label === 'Document' ? 'DOC' : label.toUpperCase()}</span>}</button>
              <div className="fmeta"><b title={f.name}>{f.name}</b><span>{label} · {fileSize(f.size)}</span><span>{f.uploaded_by_name ?? 'Someone'} · {ago(f.created_at)}</span>
                {f.task_title && <button type="button" className="link-btn ftask" onClick={() => ws.openTask(f.task_id)}><Icon.checkSquare size={12} />{f.task_title}</button>}</div>
              <Menu label={`Actions for ${f.name}`} className="icon-btn fmenu" button={<Dots vertical size={15} />} place="left">{(close) => <>
                {previewable(f.mime) && <MenuItem onSelect={() => { close(); setView(f); }}><Icon.eye size={15} />Preview</MenuItem>}
                <MenuItem onSelect={() => { close(); window.open(`/api/files/${f.id}/content?download=1`); }}><Icon.download size={15} />Download</MenuItem>
                <MenuItem onSelect={() => { close(); rename(f); }}><Icon.edit size={15} />Rename</MenuItem>
                {f.task_id ? <MenuItem onSelect={() => { close(); attach(f, null); }}><Icon.x size={15} />Detach from task</MenuItem>
                  : p.task_list.length > 0 && <AttachTo ws={ws} onPick={(tid) => { close(); attach(f, tid); }} />}
                {(f.uploaded_by === me.id || me.role === 'admin') && <><div className="menu-sep" /><MenuItem onSelect={() => { close(); del(f); }}><Icon.trash size={15} />Delete</MenuItem></>}</>}</Menu>
            </article>); })}
          <button type="button" className="fdrop" onClick={() => input.current?.click()}><span><Icon.upload size={20} /></span><b>Upload files</b><small>or drag and drop here · up to 10 MB each</small></button>
        </div>}
      {data && !data.length && !ups.length && <Empty title="No files yet">Designs, briefs, exports and screenshots for this project. Images, PDFs, documents, sheets, text and zip files.</Empty>}
      {data && data.length > 0 && !list.length && <p className="faint">No file matches.</p>}
      {view && <Modal title={view.name} onClose={() => setView(null)} wide><div className="fview">
        {view.mime.startsWith('image/') ? <img src={`/api/files/${view.id}/content`} alt={view.name} /> : view.mime === 'video/mp4' ? <video src={`/api/files/${view.id}/content`} controls /> : <iframe src={`/api/files/${view.id}/content`} title={view.name} {...(view.mime === 'application/pdf' ? {} : { sandbox: '' })} />}
        <div className="row"><a className="btn" href={`/api/files/${view.id}/content?download=1`}><Icon.download size={14} />Download</a><button className="btn ghost right" onClick={() => setView(null)}>Close</button></div></div></Modal>}
    </div>
  );
}
function AttachTo({ ws, onPick }: { ws: WS; onPick: (id: string) => void }) {
  return <div className="menu-item" role="none"><Icon.checkSquare size={15} /><select aria-label="Attach to a task" defaultValue="" onChange={(e) => e.target.value && onPick(e.target.value)} onClick={(e) => e.stopPropagation()}><option value="">Attach to a task…</option>{ws.p.task_list.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></div>;
}
