// Import a task list from a PDF, a CSV, a Markdown plan or pasted text. Three steps: choose, check, create. Reading creates nothing;
// the preview shows every task with the status the document gives it, and only the rows kept are created.
import { useMemo, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { Icon } from '../../ui/icons.tsx';
import { Modal } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Spinner } from '../../ui/kit.tsx';
import { STATUS_COLOR, shortDay } from './shared.tsx';
import { useRouter } from '../../router.tsx';
import type { WS } from './Workspace.tsx';

type Row = { line: number; title: string; status: Status | null; status_text: string | null; flag: string | null; assignee: string | null; assignee_id: string | null;
  start_date: string | null; due_date: string | null; priority: string | null; section: string | null; notes: string | null; exists: boolean };
type Status = 'TODO' | 'DOING' | 'REVIEW' | 'DONE';
type Read = { mode: 'table' | 'lines' | 'ai'; header: string[] | null; ignored: number; total: number; rows: Row[] };
const ORDER: Status[] = ['DONE', 'DOING', 'REVIEW', 'TODO'];
const LABEL: Record<Status, string> = { DONE: 'Done', DOING: 'In progress', REVIEW: 'Under review', TODO: 'Pending' };
const PAGE = 100;
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '0%');

export function ImportTasks({ ws, onClose }: { ws: WS; onClose: () => void }) {
  const { p } = ws; const toast = useToast(); const { go } = useRouter();
  const [step, setStep] = useState<'choose' | 'check' | 'done'>('choose');
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState('');
  const [source, setSource] = useState(''); const [paste, setPaste] = useState('');
  const [read, setRead] = useState<Read | null>(null); const [rows, setRows] = useState<Row[]>([]);
  const [plain, setPlain] = useState<string[]>([]); // the document as text lines, for the AI reader
  const [keep, setKeep] = useState<Set<number>>(new Set()); const [noStatus, setNoStatus] = useState<'skip' | 'TODO'>('skip');
  const [skipExisting, setSkipExisting] = useState(true); const [labels, setLabels] = useState(true);
  const [show, setShow] = useState<Status | 'NONE' | 'ALL'>('ALL'); const [page, setPage] = useState(0);
  const [result, setResult] = useState<any>(null);
  const input = useRef<HTMLInputElement>(null);

  const took = (r: Read, name: string, lines: string[]) => {
    setRead(r); setRows(r.rows); setSource(name); setPlain(lines); setPage(0); setShow('ALL');
    setKeep(new Set(r.rows.filter((x) => x.status && !x.exists).map((x) => x.line)));
    setStep('check');
  };
  const choose = async (f: File) => {
    setErr(''); const ext = f.name.split('.').pop()!.toLowerCase();
    if (f.size > 40_000_000) { setErr('That file is over 40 MB. Split it, or export the list as CSV.'); return; }
    try {
      if (ext === 'pdf' || f.type === 'application/pdf') {
        setBusy('Opening the PDF');
        const { pdfLines } = await import('./pdfText.ts');
        const { lines, pages, chars } = await pdfLines(await f.arrayBuffer(), (n, of) => setBusy(`Reading page ${n} of ${of}`));
        if (chars < 20) { setErr(`This PDF has ${pages === 1 ? 'one page' : `${pages} pages`} but no text in it, so it is probably a scan (pictures of text). Export the list again from the app it came from, as a PDF with text or as CSV.`); setBusy(null); return; }
        setBusy('Finding the tasks');
        const asText = lines.map((l) => l.map((c) => c.t).join('\t'));
        const body = JSON.stringify({ lines }).length < 1_800_000 ? { lines } : { text: asText.join('\n') };
        took(await api.post(`/api/projects/${p.id}/import/parse`, body), f.name, asText);
      } else if (ext === 'csv' || f.type === 'text/csv') {
        setBusy('Reading the CSV'); const csv = await f.text();
        took(await api.post(`/api/projects/${p.id}/import/parse`, { csv }), f.name, csv.split('\n'));
      } else if (ext === 'txt' || ext === 'md' || ext === 'markdown' || f.type.startsWith('text/')) {
        setBusy('Reading the file'); const text = await f.text();
        took(await api.post(`/api/projects/${p.id}/import/parse`, { text }), f.name, text.split('\n'));
      } else if (ext === 'xlsx' || ext === 'xls') {
        setErr('Excel files cannot be read here yet. In Excel, use File, Save As, and choose CSV (or PDF), then import that file.');
      } else setErr('Choose a PDF, a CSV, a Markdown or a text file.');
    } catch (e: any) { setErr(e.message || 'The file could not be read.'); }
    setBusy(null);
  };
  const fromPaste = async () => {
    if (!paste.trim()) return; setErr(''); setBusy('Finding the tasks');
    try { took(await api.post(`/api/projects/${p.id}/import/parse`, { text: paste }), 'pasted text', paste.split('\n')); } catch (e: any) { setErr(e.message); }
    setBusy(null);
  };
  const withAi = async () => {
    setErr(''); setBusy('The AI is reading the document. Long lists take a minute or two.');
    try { const r = await api.run<Read>(`/api/projects/${p.id}/import/ai`, { lines: plain.map((l) => l.slice(0, 2000)).filter((l) => l.trim()).slice(0, 20_000) }); took(r, source, plain); toast(`The AI found ${r.total} tasks. Check them before creating.`); }
    catch (e: any) { setErr(e.message); }
    setBusy(null);
  };

  // what will be created, with the choices made in the preview
  const final = useMemo(() => rows.filter((r) => keep.has(r.line) && !(skipExisting && r.exists) && (r.status || noStatus === 'TODO')), [rows, keep, noStatus, skipExisting]);
  const pickNoStatus = (v: 'skip' | 'TODO') => { setNoStatus(v); setKeep((k) => { const n = new Set(k); for (const r of rows) if (!r.status && !r.exists) { if (v === 'TODO') n.add(r.line); else n.delete(r.line); } return n; }); };
  const statusOf = (r: Row): Status | null => r.status ?? (noStatus === 'TODO' ? 'TODO' : null);
  const counts = useMemo(() => { const c: Record<string, number> = { DONE: 0, DOING: 0, REVIEW: 0, TODO: 0 }; for (const r of final) { const s = statusOf(r); if (s) c[s]!++; } return c; }, [final, noStatus]); // eslint-disable-line react-hooks/exhaustive-deps
  const found = useMemo(() => { const c: Record<string, number> = { DONE: 0, DOING: 0, REVIEW: 0, TODO: 0, NONE: 0 }; for (const r of rows) c[r.status ?? 'NONE']!++; return c; }, [rows]);
  const existing = rows.filter((r) => r.exists).length;
  const unmatched = [...new Set(rows.filter((r) => r.assignee && !r.assignee_id).map((r) => r.assignee!))];
  const dated = final.filter((r) => r.due_date || r.start_date).length;
  const visible = rows.filter((r) => show === 'ALL' || (show === 'NONE' ? !r.status : r.status === show));
  const pageRows = visible.slice(page * PAGE, page * PAGE + PAGE);
  const setStatus = (line: number, s: Status | '') => { setRows((rs) => rs.map((r) => (r.line === line ? { ...r, status: s || null } : r))); setKeep((k) => { const n = new Set(k); if (s) n.add(line); else n.delete(line); return n; }); };
  const toggle = (line: number) => setKeep((k) => { const n = new Set(k); if (n.has(line)) n.delete(line); else n.add(line); return n; });
  const setAll = (on: boolean) => setKeep((k) => { const n = new Set(k); for (const r of visible) if ((r.status || noStatus === 'TODO') && !(r.exists && skipExisting)) { if (on) n.add(r.line); else n.delete(r.line); } return n; });
  const create = async () => {
    setErr(''); setBusy(`Creating ${final.length} tasks`);
    try {
      const body = { source: source.slice(0, 200), skip_existing: skipExisting, section_labels: labels, rows: final.map((r) => ({ title: r.title, status: statusOf(r)!, flag: r.flag, assignee: r.assignee, start_date: r.start_date, due_date: r.due_date, priority: r.priority, section: r.section, notes: r.notes })) };
      const out = await api.post(`/api/projects/${p.id}/import`, body); setResult(out); setStep('done'); ws.reload();
    } catch (e: any) { setErr(e.message); }
    setBusy(null);
  };

  return <Modal title={step === 'done' ? 'Tasks imported' : `Import tasks into ${p.name}`} onClose={busy ? () => {} : onClose} wide>
    <div className="imp">
      {step === 'choose' && <>
        <p className="imp-lead">Upload your task list and every task is created with its status: done, in progress, under review or pending. You check everything before anything is created.</p>
        <button type="button" className="imp-drop" onClick={() => input.current?.click()} disabled={!!busy}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void choose(f); }}>
          <span><Icon.upload size={22} /></span><b>{busy ?? 'Choose a PDF, CSV or Markdown file, or drop it here'}</b>
          <small>{busy ? <Spinner /> : 'The PDF is read in your browser and is not stored. Excel: save as CSV or PDF first.'}</small>
        </button>
        <input ref={input} type="file" accept=".pdf,.csv,.txt,.md,.markdown,application/pdf,text/csv,text/plain,text/markdown" className="sr" tabIndex={-1} aria-label="Choose a task list" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void choose(f); }} />
        <details className="imp-paste"><summary>Or paste the list</summary>
          <textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Charger map on website - Completed\nBattery swap booking - In progress\nRFID onboarding - Under review\nFleet dashboard - Pending'} aria-label="Paste the task list" />
          <button type="button" className="btn tiny" onClick={fromPaste} disabled={!paste.trim() || !!busy}>Read the list</button>
        </details>
        <p className="faint imp-how">Works best with a table that has a Status column (and a Task column). Status words it understands: Completed, Done, Closed; In progress, In process, Ongoing, WIP; Under review, In review, Testing, Pending approval; Pending, Not started, To do, On hold, Blocked. A percentage works too (100% is done, 0% is pending). Markdown plans: every table with a Status column, and checklists (- [x] is done, - [ ] is pending, - [~] is in progress); headings become sections.</p>
      </>}

      {step === 'check' && read && <>
        <div className="imp-sum">
          <div><b>{read.total}</b><span>tasks found in {source}</span><small>{read.mode === 'table' ? `Read as a table: ${read.header?.filter(Boolean).join(', ')}` : read.mode === 'ai' ? 'Read by the AI' : 'Read line by line'}{read.ignored ? ` · ${read.ignored} lines skipped (headers, notes, page numbers)` : ''}</small></div>
          <div className="imp-bars" role="group" aria-label="Show tasks by status">
            <button type="button" className={show === 'ALL' ? 'on' : ''} onClick={() => { setShow('ALL'); setPage(0); }}>All <b>{rows.length}</b></button>
            {ORDER.map((s) => <button key={s} type="button" className={show === s ? 'on' : ''} style={{ '--sc': STATUS_COLOR[s] } as React.CSSProperties} onClick={() => { setShow(s); setPage(0); }}><i />{LABEL[s]} <b>{found[s]}</b><small>{pct(found[s]!, rows.length)}</small></button>)}
            {found.NONE! > 0 && <button type="button" className={`warn${show === 'NONE' ? ' on' : ''}`} onClick={() => { setShow('NONE'); setPage(0); }}><Icon.info size={13} />No status <b>{found.NONE}</b></button>}
          </div>
        </div>
        {(read.total === 0 || found.NONE! > rows.length * 0.3) && <div className="imp-note"><Icon.sparkle size={15} /><span>{read.total === 0 ? 'No tasks were found with the rules.' : `${found.NONE} rows have no status the rules could read.`} The AI reader can try: it reads the whole document and returns a preview the same way.</span><button type="button" className="btn tiny" onClick={withAi} disabled={!!busy}>Read with AI</button></div>}
        <div className="imp-opts">
          {found.NONE! > 0 && <label><span>Rows with no status</span><select value={noStatus} onChange={(e) => pickNoStatus(e.target.value as 'skip' | 'TODO')}><option value="skip">Leave them out</option><option value="TODO">Add them as Pending</option></select></label>}
          <label className="chk"><input type="checkbox" checked={skipExisting} onChange={(e) => setSkipExisting(e.target.checked)} />Skip tasks already in this project{existing ? ` (${existing})` : ''}</label>
          {rows.some((r) => r.section || r.flag) && <label className="chk"><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />Use sections (and On hold, Blocked) as labels</label>}
        </div>
        {unmatched.length > 0 && <p className="imp-warn"><Icon.info size={14} />{unmatched.length === 1 ? 'One owner is' : `${unmatched.length} owners are`} not on the team: {unmatched.slice(0, 6).join(', ')}{unmatched.length > 6 ? ` and ${unmatched.length - 6} more` : ''}. Their tasks are created unassigned, with the name kept in the task.</p>}
        <div className="imp-table" role="table" aria-label="Tasks to import">
          <div className="imp-r imp-h" role="row"><span role="columnheader"><input type="checkbox" aria-label="Keep every task shown" checked={visible.length > 0 && visible.every((r) => keep.has(r.line) || (!r.status && noStatus === 'skip') || (r.exists && skipExisting))} onChange={(e) => setAll(e.target.checked)} /></span><span role="columnheader">Task</span><span role="columnheader">Status</span><span role="columnheader">Owner</span><span role="columnheader">Dates</span></div>
          {pageRows.map((r) => <div key={r.line} role="row" className={`imp-r${r.exists && skipExisting ? ' gone' : ''}`}>
            <span role="cell"><input type="checkbox" aria-label={`Keep ${r.title}`} checked={keep.has(r.line) && !(r.exists && skipExisting) && !(!r.status && noStatus === 'skip')} disabled={(!r.status && noStatus === 'skip') || (r.exists && skipExisting)} onChange={() => toggle(r.line)} /></span>
            <span role="cell" className="imp-t"><b title={r.title}>{r.title}</b><small>{[r.section, r.exists ? 'already in this project' : '', r.status_text && r.status_text.toLowerCase() !== LABEL[r.status ?? 'TODO'].toLowerCase() ? `"${r.status_text}"` : ''].filter(Boolean).join(' · ')}</small></span>
            <span role="cell"><select className="imp-st" value={r.status ?? ''} onChange={(e) => setStatus(r.line, e.target.value as Status | '')} style={{ '--sc': r.status ? STATUS_COLOR[r.status] : '#858D9A' } as React.CSSProperties} aria-label={`Status of ${r.title}`}>
              <option value="">No status</option>{ORDER.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}</select></span>
            <span role="cell" className={r.assignee && !r.assignee_id ? 'faint' : ''}>{r.assignee ?? ''}{r.assignee && r.assignee_id ? <Icon.check size={12} /> : null}</span>
            <span role="cell">{r.start_date ? `${shortDay(r.start_date)} to ` : ''}{r.due_date ? shortDay(r.due_date) : ''}</span>
          </div>)}
          {!pageRows.length && <p className="faint" style={{ padding: 12 }}>Nothing here.</p>}
        </div>
        {visible.length > PAGE && <div className="imp-pager"><button type="button" className="btn tiny" disabled={!page} onClick={() => setPage(page - 1)}>Previous</button><span>{page * PAGE + 1} to {Math.min(visible.length, page * PAGE + PAGE)} of {visible.length}</span><button type="button" className="btn tiny" disabled={(page + 1) * PAGE >= visible.length} onClick={() => setPage(page + 1)}>Next</button></div>}
        {err && <p className="err" role="alert">{err}</p>}
        <div className="imp-foot">
          <span><b>{final.length}</b> to create: {ORDER.filter((s) => counts[s]).map((s) => `${counts[s]} ${LABEL[s].toLowerCase()}`).join(', ') || 'none'}{final.length ? ` · ${dated ? `${dated} with dates, shown on the Timeline` : 'no dates in the file, so the Timeline lists them as unscheduled'}` : ''}</span>
          <button type="button" className="btn ghost" onClick={() => { setStep('choose'); setRead(null); }} disabled={!!busy}>Choose another file</button>
          <button type="button" className="btn primary" onClick={create} disabled={!final.length || !!busy}>{busy ? <><Spinner />{busy}</> : `Create ${final.length} ${final.length === 1 ? 'task' : 'tasks'}`}</button>
        </div>
      </>}

      {step === 'done' && result && <div className="imp-done">
        <span className="imp-ok"><Icon.checkCircle size={28} /></span>
        <h3>{result.created} {result.created === 1 ? 'task' : 'tasks'} created in {p.name}</h3>
        <ul>{ORDER.filter((s) => result.counts[s]).map((s) => <li key={s}><i style={{ background: STATUS_COLOR[s] }} />{result.counts[s]} {LABEL[s].toLowerCase()} <span className="faint">({pct(result.counts[s], result.created)})</span></li>)}</ul>
        {result.skipped_existing > 0 && <p className="faint">{result.skipped_existing} were already in the project and were skipped.</p>}
        {result.unmatched.length > 0 && <p className="faint">Not on the team, kept in each task's description: {result.unmatched.slice(0, 8).join(', ')}{result.unmatched.length > 8 ? ' and more' : ''}.</p>}
        <div className="row"><button type="button" className="btn" onClick={() => { onClose(); go(`/projects/${p.id}/timeline`); }}><Icon.calendar size={14} />Open the Timeline</button>
          <button type="button" className="btn primary right" onClick={() => { onClose(); go(`/projects/${p.id}/list`); }}><Icon.list size={14} />Open the List</button></div>
      </div>}
      {err && step !== 'check' && <p className="err" role="alert">{err}</p>}
    </div>
  </Modal>;
}
