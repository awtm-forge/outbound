import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useKeys, useLoad } from '../ui/hooks.ts';
import { Icon, Dots } from '../ui/icons.tsx';
import { Menu, MenuItem } from '../ui/menu.tsx';
import { useToast } from '../ui/toast.tsx';
import { Badge, Empty, Failure, Loading, Status, ago, initials, problemLabel } from '../ui/kit.tsx';

const VIEWS: { key: string; label: string; qs: string; statuses?: string[] }[] = [
  { key: 'active', label: 'Active', qs: 'view=active' },
  { key: 'needs_contact', label: 'Need a decision maker', qs: 'view=needs_contact' },
  { key: 'qualified', label: 'Qualified', qs: 'status=QUALIFIED', statuses: ['QUALIFIED'] },
  { key: 'review', label: 'Awaiting review', qs: 'status=PENDING_APPROVAL', statuses: ['PENDING_APPROVAL'] },
  { key: 'contacted', label: 'Contacted', qs: 'status=APPROVED,SYNCED,CONTACTED', statuses: ['APPROVED', 'SYNCED', 'CONTACTED'] },
  { key: 'replied', label: 'Replied and beyond', qs: 'status=REPLIED,MEETING,PROPOSAL,WON', statuses: ['REPLIED', 'MEETING', 'PROPOSAL', 'WON'] },
  { key: 'closed', label: 'Not a fit', qs: 'status=REJECTED,LOST,SUPPRESSED', statuses: ['REJECTED', 'LOST', 'SUPPRESSED'] },
  { key: 'all', label: 'Everything', qs: '' },
];
const CLOSED = ['REJECTED', 'LOST', 'SUPPRESSED'];
// the five cards: stages in the order a company moves through them
const CARDS: { label: string; statuses: string[]; icon: keyof typeof Icon; tone: string }[] = [
  { label: 'Researching', statuses: ['NEW', 'QUALIFYING', 'RESEARCHING', 'RESEARCH_FURTHER'], icon: 'find', tone: 'orange' },
  { label: 'Qualified', statuses: ['QUALIFIED', 'EMAIL_DRAFTED'], icon: 'target', tone: 'purple' },
  { label: 'Awaiting review', statuses: ['PENDING_APPROVAL'], icon: 'file', tone: 'cyan' },
  { label: 'Contacted', statuses: ['APPROVED', 'SYNCED', 'CONTACTED'], icon: 'send', tone: 'green' },
  { label: 'Replied and beyond', statuses: ['REPLIED', 'MEETING', 'PROPOSAL', 'WON'], icon: 'message', tone: 'gray' },
];
const COLS = [['score', 'Score'], ['problem', 'Problem we saw'], ['person', 'Person'], ['campaign', 'Campaign'], ['updated', 'Updated']] as const;
type Col = (typeof COLS)[number][0];
// which columns show is a per-browser preference
const COLS_KEY = 'awtm-pipeline-columns';
const readCols = (): Col[] => { try { const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null'); return Array.isArray(v) ? v : COLS.map((c) => c[0]); } catch { return COLS.map((c) => c[0]); } };
type Filters = { email: boolean; person: boolean; score70: boolean };
const NO_FILTERS: Filters = { email: false, person: false, score70: false };

export function Pipeline() {
  const { search, go } = useRouter(); const toast = useToast();
  const view = search.get('view'); const status = search.get('status'); const campaign = search.get('campaign') ?? '';
  const current = VIEWS.find((v) => (v.qs === `view=${view}` && view) || (status && v.qs === `status=${status}`)) ?? (status || view ? null : VIEWS[0]);
  // a search can arrive in the address (?q=), from the top bar's search box
  const urlQ = search.get('q') ?? '';
  const [term, setTerm] = useState(urlQ); const [q, setQ] = useState(urlQ.trim());
  useEffect(() => { if (urlQ) setTerm(urlQ); }, [urlQ]);
  useEffect(() => { const t = setTimeout(() => setQ(term), 220); return () => clearTimeout(t); }, [term]);
  const params = new URLSearchParams(); if (view) params.set('view', view); else if (status) params.set('status', status); else if (!current || current.key === 'active') params.set('view', 'active');
  if (campaign) params.set('campaign', campaign); if (q) params.set('q', q);
  const { data, error, loading, reload } = useLoad(() => api.get<any[]>(`/api/prospects?${params}`), [params.toString()]);
  const camps = useLoad(() => api.get('/api/campaigns'));
  const overview = useLoad(() => api.get('/api/overview'));
  const searchRef = useRef<HTMLInputElement>(null); useKeys({ '/': () => searchRef.current?.focus() });
  const vertical = (code?: string | null) => (camps.data?.campaigns ?? []).find((c: any) => c.code === code)?.vertical ?? code;
  const setFilter = (qs: string, c = campaign) => { const p = new URLSearchParams(qs); if (c) p.set('campaign', c); go(`/pipeline${p.toString() ? '?' + p : ''}`, true); };

  // client-side refinements of the loaded list, the visible columns, the page, and the selection
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [cols, setCols] = useState<Col[]>(readCols);
  const toggleCol = (c: Col) => setCols((l) => { const n = l.includes(c) ? l.filter((x) => x !== c) : [...l, c]; try { localStorage.setItem(COLS_KEY, JSON.stringify(n)); } catch { /* private mode */ } return n; });
  const [size, setSize] = useState(10); const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const rows = useMemo(() => (data ?? []).filter((p) => (!f.email || p.email) && (!f.person || p.needs_contact) && (!f.score70 || (p.account_score ?? 0) >= 70)), [data, f]);
  useEffect(() => { setPage(0); setSel(new Set()); }, [params.toString(), f]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = Math.max(1, Math.ceil(rows.length / size)); const shown = rows.slice(page * size, page * size + size);
  const nFilters = Object.values(f).filter(Boolean).length;
  const has = (c: Col) => cols.includes(c);

  // counts for the cards and the chips, straight from the stage totals
  const by: Record<string, number> = Object.fromEntries((overview.data?.stages ?? []).map((s: any) => [s.status, s.n]));
  const total = Object.values(by).reduce((a, n) => a + n, 0);
  const sum = (l: string[]) => l.reduce((a, k) => a + (by[k] ?? 0), 0);
  const active = total - sum(CLOSED);
  const chipN = (v: (typeof VIEWS)[number]) => !overview.data ? null : v.key === 'active' ? active : v.key === 'all' ? total : v.key === 'needs_contact' ? overview.data.counts.needs_contact : sum(v.statuses ?? []);

  const research = async (p: any) => {
    toast(`Researching ${p.name} again. This takes about a minute.`);
    try { const r = await api.run(`/api/prospects/${p.id}/run-chain`, { force: true }); toast(`${p.name} researched again.${r.qualify?.score != null ? ` Score: ${r.qualify.score}.` : ''}`); reload(true); overview.reload(true); }
    catch (e: any) { toast(e.message, { err: true }); }
  };
  const copy = async (text: string, msg: string) => { try { await navigator.clipboard.writeText(text); toast(msg); } catch { toast('Could not copy. The browser blocked the clipboard.', { err: true }); } };
  const selectedEmails = rows.filter((p) => sel.has(p.id) && p.email).map((p) => p.email);
  const date = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="dash-main">
      <div className="hero-row">
        <div className="hero-text"><p className="hero-eyebrow">{date}</p><h1>Pipeline</h1>
          <p className="lede">Every company you have added, where it stands, and what it is waiting for.</p></div>
        <div className="quote-card"><span className="qm" aria-hidden="true">“</span><p>A short list you work beats a long one you don’t.</p></div>
        <div className="quota-card"><span className="qc-ic" aria-hidden="true"><Icon.funnel size={20} /></span>
          <div className="qc-body"><span>{overview.data ? `${active} of ${total} active` : 'Active in pipeline'}</span><small>Not closed or on do not contact</small>
            <span className="qc-bar" role="progressbar" aria-label="Active in pipeline" aria-valuemin={0} aria-valuemax={total} aria-valuenow={active}><i style={{ width: `${total ? (active / total) * 100 : 0}%` }} /></span></div>
          <span className="qc-pct">{total ? Math.round((active / total) * 100) : 0}%</span></div>
      </div>

      <section className="kpis" aria-label="Companies at each stage">
        {CARDS.map((c) => { const I = Icon[c.icon]; const n = sum(c.statuses); return (
          <button key={c.label} type="button" className={`kpi stat ${c.tone}`} onClick={() => setFilter(`status=${c.statuses.join(',')}`)} aria-label={`${c.label}: ${overview.data ? n : 'loading'}. Show them`}>
            <span className="k-ic"><I size={24} /></span>
            <span className="k-n">{overview.data ? n : '·'}</span>
            <span className="k-l">{c.label}</span>
            {overview.data && total > 0 && <span className="k-week" title="Share of every company in the pipeline">{Math.round((n / total) * 100)}%</span>}
            <span className="k-bar" aria-hidden="true"><i style={{ width: `${total ? Math.max(n ? 4 : 0, (n / total) * 100) : 0}%` }} /></span>
          </button>); })}
      </section>

      <section className="panel" aria-label="Companies">
        <div className="toolbar">
          <div className="chip-row" role="group" aria-label="Filter">{VIEWS.map((v) => { const n = chipN(v); return (
            <button key={v.key} type="button" className="filter-chip" aria-pressed={current?.key === v.key} onClick={() => setFilter(v.qs)}>{v.label}{n != null && <span className="n" aria-hidden="true">{n}</span>}</button>); })}
            {!current && <span className="filter-chip" aria-current="true" style={{ cursor: 'default' }}>Filtered by stage</span>}</div>
        </div>
        <div className="toolbar tools2">
          <label className="tb-search"><Icon.find size={15} /><input ref={searchRef} placeholder="Search name, domain or email" aria-keyshortcuts="/" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search prospects" /><kbd aria-hidden="true">/</kbd></label>
          <select className="tb-select" value={campaign} onChange={(e) => setFilter(current?.qs ?? (status ? `status=${status}` : ''), e.target.value)} aria-label="Campaign"><option value="">All campaigns</option>{(camps.data?.campaigns ?? []).map((c: any) => <option key={c.code} value={c.code}>{c.vertical || c.code}</option>)}</select>
          <Menu label="Filters" className="btn tiny" button={<><Icon.funnel size={14} />Filters{nFilters ? <span className="n">{nFilters}</span> : null}</>}>{() => <>
            {([['email', 'Has an email'], ['person', 'Needs a person'], ['score70', 'Score 70 or more']] as const).map(([k, l]) =>
              <MenuItem key={k} onSelect={() => setF({ ...f, [k]: !f[k] })}><span className="mcheck" aria-hidden="true">{f[k] ? <Icon.check size={13} /> : null}</span>{l}<span className="sr">{f[k] ? ', on' : ', off'}</span></MenuItem>)}
            {nFilters > 0 && <><div className="menu-sep" /><MenuItem onSelect={() => setF(NO_FILTERS)}><Icon.x size={15} />Clear filters</MenuItem></>}
            <p className="menu-note">These narrow the companies already loaded.</p></>}</Menu>
          <Menu label="Columns" className="btn tiny" button={<><Icon.layers size={14} />Columns</>}>{() => <>
            {COLS.map(([k, l]) => <MenuItem key={k} onSelect={() => toggleCol(k)}><span className="mcheck" aria-hidden="true">{has(k) ? <Icon.check size={13} /> : null}</span>{l}<span className="sr">{has(k) ? ', shown' : ', hidden'}</span></MenuItem>)}</>}</Menu>
          <Link to="/find" className="btn primary tiny glow tb-add"><Icon.plus size={14} />Add company</Link>
        </div>

        {loading && !data ? <div style={{ padding: '0 16px 16px' }}><Loading kind="table" rows={6} /></div> : error ? <div style={{ padding: '0 16px 16px' }}><Failure error={error} retry={reload} /></div> : !rows.length ?
          <div style={{ padding: '0 16px 16px' }}>{q ? <Empty title={`Nothing matches “${q}”`} action={<button className="btn" onClick={() => { setTerm(''); searchRef.current?.focus(); }}>Clear the search</button>}>Search looks at company names, domains and email addresses in this view.</Empty>
            : nFilters ? <Empty title="No companies match these filters" action={<button className="btn" onClick={() => setF(NO_FILTERS)}>Clear filters</button>}>The filters narrow the companies in this view.</Empty>
            : <Empty title={view === 'needs_contact' ? 'Everyone qualified has a named person' : 'No companies here'} action={<Link className="btn primary" to="/find">Find companies</Link>}>Companies appear here once you add them from a search.</Empty>}</div> :
        <>
          {sel.size > 0 && <div className="bulkbar" role="region" aria-label="Selected companies">
            <b>{sel.size} selected</b>
            <button type="button" className="btn tiny" disabled={!selectedEmails.length} onClick={() => copy(selectedEmails.join(', '), `Copied ${selectedEmails.length} ${selectedEmails.length === 1 ? 'email' : 'emails'}.`)}><Icon.mail size={14} />Copy emails{selectedEmails.length ? ` (${selectedEmails.length})` : ''}</button>
            <button type="button" className="btn tiny" onClick={() => copy(rows.filter((p) => sel.has(p.id)).map((p) => p.domain).join('\n'), 'Copied the domains.')}><Icon.globe size={14} />Copy domains</button>
            <button type="button" className="btn tiny ghost" style={{ marginLeft: 'auto' }} onClick={() => setSel(new Set())}>Clear</button></div>}
          <div className="scrollx"><table className="ctable ptable">
            <thead><tr><th style={{ width: 36 }}><input type="checkbox" className="check" aria-label="Select all on this page" checked={shown.every((p) => sel.has(p.id))} onChange={(e) => setSel((s) => { const n = new Set(s); shown.forEach((p) => e.target.checked ? n.add(p.id) : n.delete(p.id)); return n; })} /></th>
              <th>Company</th><th>Status</th>{has('score') && <th>Score</th>}{has('problem') && <th>Problem we saw</th>}{has('person') && <th>Person</th>}{has('campaign') && <th>Campaign</th>}{has('updated') && <th>Updated</th>}<th className="num"><span className="sr">Actions</span></th></tr></thead>
            <tbody>{shown.map((p) => <tr key={p.id} className={`click${sel.has(p.id) ? ' sel' : ''}`} onClick={() => go(`/prospects/${p.id}`)}>
              <td onClick={(e) => e.stopPropagation()}><input type="checkbox" className="check" aria-label={`Select ${p.name}`} checked={sel.has(p.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })} /></td>
              <td><div className="c-name"><span className="co-av" aria-hidden="true">{initials(p.name)}</span><div><Link to={`/prospects/${p.id}`} onClick={(e) => e.stopPropagation()} style={{ textDecoration: 'none' }}><b>{p.name}</b></Link><span>{p.domain}{p.platform ? ` · ${p.platform}` : ''}</span></div></div></td>
              <td><Status s={p.status} /></td>
              {has('score') && <td>{p.account_score == null ? <span className="sub">Not scored</span> : <Ring n={p.account_score} />}</td>}
              {has('problem') && <td style={{ maxWidth: 300 }}><div style={{ color: 'var(--ink)' }}>{problemLabel(p.primary_problem)}</div>{p.specific_observation && p.specific_observation !== 'UNKNOWN' && <div className="sub ellipsis" style={{ maxWidth: 280 }}>{p.specific_observation}</div>}</td>}
              {has('person') && <td>{p.contact_name ? <div className="c-name"><span className="av xs" aria-hidden="true">{initials(p.contact_name)}</span><div><b style={{ fontWeight: 500 }}>{p.contact_name}</b><span>{p.contact_title ?? p.email}</span></div></div> : p.needs_contact ? <Badge tone="warning">Needs a person</Badge> : <span className="sub">{p.email ?? 'None'}</span>}</td>}
              {has('campaign') && <td>{p.campaign ? <span className="camp-tag" title={vertical(p.campaign) ?? undefined}>{p.campaign}</span> : <span className="sub">None</span>}</td>}
              {has('updated') && <td className="sub" style={{ whiteSpace: 'nowrap' }}>{ago(p.updated_at)}</td>}
              <td onClick={(e) => e.stopPropagation()}><div className="row-acts">
                {p.email ? <a className="icon-btn" href={`mailto:${p.email}`} aria-label={`Email ${p.contact_name ?? p.email}`} title={p.email}><Icon.mail size={15} /></a> : <span className="icon-btn" aria-hidden="true" style={{ visibility: 'hidden' }} />}
                <a className="icon-btn" href={`https://${p.domain}`} target="_blank" rel="noreferrer" aria-label={`Open ${p.domain} in a new tab`}><Icon.globe size={15} /></a>
                <Menu label={`Actions for ${p.name}`} className="icon-btn" button={<Dots vertical size={16} />}>{(close) => <>
                  <MenuItem onSelect={() => { close(); go(`/prospects/${p.id}`); }}><Icon.arrow size={15} />Open profile</MenuItem>
                  <MenuItem onSelect={() => { close(); research(p); }}><Icon.redo size={15} />Research again</MenuItem>
                  <MenuItem onSelect={() => { close(); copy(p.domain, `Copied ${p.domain}.`); }}><Icon.globe size={15} />Copy domain</MenuItem></>}</Menu>
              </div></td></tr>)}</tbody></table></div>
          <div className="pager">
            <span>{`${page * size + 1} to ${Math.min(rows.length, page * size + size)} of ${rows.length}`}{data && data.length >= 500 ? '. The first 500 only, so narrow it with a search or a filter.' : ''}</span>
            <label className="pg-size">Rows<select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}>{[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <nav className="pg-nav" aria-label="Pages">
              <button type="button" className="icon-btn" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"><Icon.left size={15} /></button>
              {Array.from({ length: pages }, (_, i) => i).filter((i) => i === 0 || i === pages - 1 || Math.abs(i - page) <= 1).map((i, k, l) => <span key={i} style={{ display: 'contents' }}>
                {k > 0 && i - l[k - 1]! > 1 && <span className="pg-gap" aria-hidden="true">…</span>}
                <button type="button" className={`pg-n${i === page ? ' on' : ''}`} aria-current={i === page ? 'page' : undefined} onClick={() => setPage(i)} aria-label={`Page ${i + 1}`}>{i + 1}</button></span>)}
              <button type="button" className="icon-btn" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page"><Icon.right size={15} /></button>
            </nav>
          </div>
        </>}
      </section>
    </div>
  );
}

// the account score as a ring: orange from 70, the qualifying line
function Ring({ n }: { n: number }) {
  const r = 13; const c = 2 * Math.PI * r; const v = Math.max(0, Math.min(100, n));
  return <span className={`ring${n >= 70 ? ' hi' : ''}`} role="img" aria-label={`Score ${n} of 100`}>
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r={r} className="rt" /><circle cx="17" cy="17" r={r} className="rv" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 17 17)" /></svg>
    <b aria-hidden="true">{n}</b></span>;
}
