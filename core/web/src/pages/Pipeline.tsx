import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useKeys, useLoad } from '../ui/hooks.ts';
import { Badge, Empty, Failure, Loading, Status, ago, problemLabel } from '../ui/kit.tsx';

const VIEWS: { key: string; label: string; qs: string }[] = [
  { key: 'active', label: 'Active', qs: 'view=active' },
  { key: 'needs_contact', label: 'Need a decision maker', qs: 'view=needs_contact' },
  { key: 'qualified', label: 'Qualified', qs: 'status=QUALIFIED' },
  { key: 'review', label: 'Awaiting review', qs: 'status=PENDING_APPROVAL' },
  { key: 'contacted', label: 'Contacted', qs: 'status=APPROVED,SYNCED,CONTACTED' },
  { key: 'replied', label: 'Replied and beyond', qs: 'status=REPLIED,MEETING,PROPOSAL,WON' },
  { key: 'closed', label: 'Not a fit', qs: 'status=REJECTED,LOST,SUPPRESSED' },
  { key: 'all', label: 'Everything', qs: '' },
];
export function Pipeline() {
  const { search, go } = useRouter();
  const view = search.get('view'); const status = search.get('status'); const campaign = search.get('campaign') ?? '';
  const current = VIEWS.find((v) => (v.qs === `view=${view}` && view) || (status && v.qs === `status=${status}`)) ?? (status || view ? null : VIEWS[0]);
  const [term, setTerm] = useState(''); const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(term), 220); return () => clearTimeout(t); }, [term]);
  const params = new URLSearchParams(); if (view) params.set('view', view); else if (status) params.set('status', status); else if (!current || current.key === 'active') params.set('view', 'active');
  if (campaign) params.set('campaign', campaign); if (q) params.set('q', q);
  const { data, error, loading, reload } = useLoad(() => api.get<any[]>(`/api/prospects?${params}`), [params.toString()]);
  const camps = useLoad(() => api.get('/api/campaigns'));
  const searchRef = useRef<HTMLInputElement>(null); useKeys({ '/': () => searchRef.current?.focus() });
  const vertical = (code?: string | null) => (camps.data?.campaigns ?? []).find((c: any) => c.code === code)?.vertical ?? code;
  const setFilter = (qs: string, c = campaign) => { const p = new URLSearchParams(qs); if (c) p.set('campaign', c); go(`/pipeline${p.toString() ? '?' + p : ''}`, true); };
  return (
    <div className="page">
      <div className="head"><div><h1>Pipeline</h1><p>Every company you have added, where it stands, and what it is waiting for.</p></div>
        <div className="row"><input ref={searchRef} className="input" style={{ width: 260 }} placeholder="Search name, domain or email" aria-keyshortcuts="/" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search prospects" />
          <select className="input" style={{ width: 'auto' }} value={campaign} onChange={(e) => setFilter(current?.qs ?? (status ? `status=${status}` : ''), e.target.value)} aria-label="Campaign"><option value="">All campaigns</option>{(camps.data?.campaigns ?? []).map((c: any) => <option key={c.code} value={c.code}>{c.vertical || c.code}</option>)}</select></div></div>
      <div className="chips" role="group" aria-label="Filter">{VIEWS.map((v) => <button key={v.key} className={`chip${current?.key === v.key ? ' on' : ''}`} onClick={() => setFilter(v.qs)}>{v.label}</button>)}
        {!current && <span className="chip on">Filtered by stage</span>}</div>
      {loading && !data ? <Loading kind="table" rows={6} /> : error ? <Failure error={error} retry={reload} /> : !data?.length ?
        <div className="card">{q ? <Empty title={`Nothing matches “${q}”`} action={<button className="btn" onClick={() => { setTerm(''); searchRef.current?.focus(); }}>Clear the search</button>}>Search looks at company names, domains and email addresses in this view.</Empty>
          : <Empty title={view === 'needs_contact' ? 'Everyone qualified has a named person' : 'No companies here'} action={<Link className="btn primary" to="/find">Find companies</Link>}>Companies appear here once you add them from a search.</Empty>}</div> :
      <>
      <div className="card flush scrollx"><table className="t stack">
        <thead><tr><th>Company</th><th>Stage</th><th className="num">Score</th><th>Problem we saw</th><th>Person</th><th>Campaign</th><th>Updated</th></tr></thead>
        <tbody>{data.map((p) => <tr key={p.id} className="click" onClick={() => go(`/prospects/${p.id}`)}>
          <td data-label="Company" style={{ minWidth: 220 }}><Link to={`/prospects/${p.id}`} style={{ fontWeight: 600, textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>{p.name}</Link><div className="sub">{p.domain}{p.platform ? ` · ${p.platform}` : ''}</div></td>
          <td data-label="Stage"><Status s={p.status} /></td>
          <td data-label="Score" className="num">{p.account_score == null ? <span className="sub">Not scored</span> : <b style={{ fontWeight: 650, color: p.account_score >= 70 ? 'var(--accent-text)' : undefined }}>{p.account_score}</b>}</td>
          <td data-label="Problem" style={{ maxWidth: 320 }}><div>{problemLabel(p.primary_problem)}</div>{p.specific_observation && p.specific_observation !== 'UNKNOWN' && <div className="sub ellipsis" style={{ maxWidth: 300 }}>{p.specific_observation}</div>}</td>
          <td data-label="Person">{p.contact_name ? <><div>{p.contact_name}</div><div className="sub">{p.contact_title ?? p.email}</div></> : p.needs_contact ? <Badge tone="warning">Needs a person</Badge> : <span className="sub">{p.email ?? 'None'}</span>}</td>
          <td data-label="Campaign">{p.campaign ? <span title={p.campaign}>{vertical(p.campaign)}</span> : <span className="sub">None</span>}</td>
          <td data-label="Updated" className="sub">{ago(p.updated_at)}</td></tr>)}</tbody></table></div>
      {data.length >= 500 && <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>Showing the first 500. The list may be cut off, so narrow it with a search or a filter.</p>}</>}
    </div>
  );
}
