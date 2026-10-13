import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useKeys, useLoad } from '../ui/hooks.ts';
import { Icon } from '../ui/icons.tsx';
import { useToast } from '../ui/toast.tsx';
import { Badge, Empty, Failure, Loading, Spinner, Status, ago, inr, rowOpen, type Tone } from '../ui/kit.tsx';
import { actorLabel } from '../ui/chrome.tsx';
import { useConfirm } from '../ui/overlay.tsx';

export const STAGE: Record<string, string> = { REPLIED: 'Replied', MEETING_BOOKED: 'Meeting booked', MEETING_HELD: 'Meeting held', PROPOSAL_SENT: 'Proposal sent', NEGOTIATION: 'Negotiating', WON: 'Won', LOST: 'Lost' };
export const stageTone = (s: string): Tone => (s === 'WON' ? 'success' : s === 'LOST' ? 'neutral' : 'info');
const DEAL_STATUS: Record<string, string> = { OPEN: 'Open', DELIVERING: 'Delivering', COMPLETE: 'Complete', CANCELLED: 'Cancelled' };
const VERIFY: Record<string, string> = { VALID: 'Verified', UNVERIFIED: 'Not verified yet', INVALID: 'Bounced', RISKY: 'Risky', CATCH_ALL: 'Accepts any address', UNKNOWN: 'Unclear' };
// Asks why a deal was lost; the server refuses LOST without a reason, so the answer is required. Resolves to the reason, or null if cancelled.
export function useLostReason() {
  const ask = useConfirm();
  return async (company: string) => { const r = await ask({ title: `Mark ${company} as lost?`, body: 'The weekly review learns from the reason, so say what happened.', confirm: 'Mark lost', tone: 'danger', input: { label: 'Why was it lost', placeholder: 'Chose another studio, no budget, went quiet', required: true } }); return typeof r === 'string' && r.trim() ? r : null; };
}

// The people and companies we deal with: everything the outbound side found, plus what is added here by hand.
export function Crm() {
  const { search, go } = useRouter(); const tab = search.get('tab') ?? 'companies';
  return (
    <div className="page">
      <div className="head"><div><h1>CRM</h1><p>Every company and person outbound has touched, the deals in play, and the notes that go with them.</p></div>
        <div className="tabs" role="tablist">{[['companies', 'Companies'], ['contacts', 'People'], ['opportunities', 'Opportunities']].map(([k, l]) =>
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => go(k === 'companies' ? '/crm' : `/crm?tab=${k}`, true)}>{l}</button>)}</div></div>
      {tab === 'contacts' ? <Contacts /> : tab === 'opportunities' ? <Opportunities /> : <Companies />}
    </div>
  );
}
function useSearch() {
  // a search can arrive in the address (?q=), from the top bar's search box
  const urlQ = useRouter().search.get('q') ?? '';
  const [term, setTerm] = useState(urlQ); const [q, setQ] = useState(urlQ.trim());
  useEffect(() => { if (urlQ) setTerm(urlQ); }, [urlQ]);
  useEffect(() => { const t = setTimeout(() => setQ(term.trim()), 220); return () => clearTimeout(t); }, [term]);
  const ref = useRef<HTMLInputElement>(null); useKeys({ '/': () => ref.current?.focus() });
  return { term, setTerm, q, ref };
}

function Companies() {
  const { go, search } = useRouter(); const s = useSearch(); const [has, setHas] = useState(''); const [adding, setAdding] = useState(search.get('new') === '1');
  const { data, error, loading, reload } = useLoad(() => api.get<any[]>(`/api/crm/companies?${new URLSearchParams({ ...(s.q ? { q: s.q } : {}), ...(has ? { has } : {}) })}`), [s.q, has]);
  return (
    <>
      <div className="row wrap">
        <input ref={s.ref} className="input" style={{ width: 300, maxWidth: '100%' }} placeholder="Company, domain, person or email" aria-keyshortcuts="/" value={s.term} onChange={(e) => s.setTerm(e.target.value)} aria-label="Search companies" />
        <div className="chips" role="group" aria-label="Filter">{[['', 'All'], ['deals', 'Open deals'], ['won', 'Won']].map(([k, l]) => <button key={k} className={`chip${has === k ? ' on' : ''}`} onClick={() => setHas(k)}>{l}</button>)}</div>
        <button className="btn right" onClick={() => setAdding(!adding)}><Icon.plus size={16} />Add a company</button>
      </div>
      {adding && <NewCompany onDone={(id) => { setAdding(false); if (id) go(`/crm/companies/${id}`); }} />}
      {loading && !data ? <Loading kind="table" rows={6} /> : error ? <Failure error={error} retry={reload} /> : !data!.length ? <div className="card"><Empty title={s.q ? `Nothing matches “${s.q}”` : has ? 'No companies with that filter' : 'No companies yet'} action={s.q ? <button className="btn" onClick={() => { s.setTerm(''); s.ref.current?.focus(); }}>Clear the search</button> : undefined}>{s.q ? 'Search looks at company names, domains, people and email addresses.' : 'Companies arrive from Find companies, or add one by hand.'}</Empty></div> :
        <><div className="card flush scrollx"><table className="t stack">
          <thead><tr><th>Company</th><th>Where</th><th>Outbound</th><th>Deal</th><th className="num">People</th><th>Updated</th></tr></thead>
          <tbody>{data!.map((c) => <tr key={c.id} className="click" onClick={() => go(`/crm/companies/${c.id}`)}>
            <td data-label="Company" style={{ minWidth: 220 }}><Link to={`/crm/companies/${c.id}`} style={{ fontWeight: 600, textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>{c.name}</Link><div className="sub">{c.domain}{c.vertical ? ` · ${c.vertical}` : ''}</div></td>
            <td data-label="Where" className="sub">{[c.city, c.country].filter(Boolean).join(', ') || 'Not known'}</td>
            <td data-label="Outbound">{c.prospect ? <Status s={c.prospect.status} /> : <span className="sub">Not in outbound</span>}</td>
            <td data-label="Deal">{c.opportunity ? <><Badge tone={stageTone(c.opportunity.stage)}>{STAGE[c.opportunity.stage]}</Badge>{c.opportunity.value_paise && <div className="sub num">{inr(c.opportunity.value_paise)}</div>}</> : <span className="sub">None</span>}</td>
            <td data-label="People" className="num">{c.contacts}</td><td data-label="Updated" className="sub">{ago(c.updated_at)}</td></tr>)}</tbody></table></div>
        {data!.length >= 500 && <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>Showing the first 500. The list may be cut off, so narrow it with a search or a filter.</p>}</>}
    </>
  );
}
function NewCompany({ onDone }: { onDone: (id?: string) => void }) {
  const toast = useToast(); const [f, setF] = useState({ name: '', website: '', city: '', vertical: '' }); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); try { const c = await api.post('/api/crm/companies', f); toast(`Added ${c.name}.`); onDone(c.id); } catch (e: any) { toast(e.message, { err: true }); setBusy(false); } };
  return <form className="card col" onSubmit={submit}><h2>Add a company</h2><p className="muted" style={{ fontSize: 'var(--fs-0)' }}>For referrals and warm leads. It does not enter the outbound pipeline unless you open a deal or add it to a campaign.</p>
    <div className="grid-form">
      <label className="field"><span>Name</span><input autoFocus required maxLength={160} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="field"><span>Website</span><input required placeholder="acme.in" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></label>
      <label className="field"><span>City</span><input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></label>
      <label className="field"><span>Vertical</span><input value={f.vertical} onChange={(e) => setF({ ...f, vertical: e.target.value })} /></label>
    </div>
    <div className="row"><button className="btn primary" disabled={busy}>{busy && <Spinner />}Add</button><button type="button" className="btn ghost" onClick={() => onDone()}>Cancel</button></div></form>;
}

function Contacts() {
  const { go } = useRouter(); const s = useSearch();
  const { data, error, loading, reload } = useLoad(() => api.get<any[]>(`/api/crm/contacts${s.q ? `?q=${encodeURIComponent(s.q)}` : ''}`), [s.q]);
  return (
    <>
      <input ref={s.ref} className="input" style={{ width: 300, maxWidth: '100%' }} placeholder="Name, title, email or company" aria-keyshortcuts="/" value={s.term} onChange={(e) => s.setTerm(e.target.value)} aria-label="Search people" />
      {loading && !data ? <Loading kind="table" rows={6} /> : error ? <Failure error={error} retry={reload} /> : !data!.length ? <div className="card"><Empty title={s.q ? `Nobody matches “${s.q}”` : 'Nobody here yet'}>{s.q ? 'Search looks at names, titles, email addresses and companies.' : 'People are added from a company page, or arrive with outbound research.'}</Empty></div> :
        <div className="card flush scrollx"><table className="t stack">
          <thead><tr><th>Person</th><th>Company</th><th>Email</th><th>Added</th></tr></thead>
          <tbody>{data!.map((c) => <tr key={c.id} className="click" {...rowOpen(() => go(`/crm/companies/${c.company_id}`))}>
            <td data-label="Person"><div style={{ fontWeight: 600 }}>{c.full_name ?? 'No name'}{c.is_decision_maker && <span style={{ marginLeft: 8 }}><Badge tone="success">Decides</Badge></span>}</div><div className="sub">{c.job_title ?? ''}</div></td>
            <td data-label="Company">{c.company}<div className="sub">{c.domain}</div></td>
            <td data-label="Email">{c.email ? <><span className="mono" style={{ fontSize: 'var(--fs-0)', overflowWrap: 'anywhere' }}>{c.email}</span><div className="sub">{VERIFY[c.email_verification_status] ?? 'Unclear'}</div></> : <span className="sub">None</span>}</td>
            <td data-label="Added" className="sub">{ago(c.created_at)}</td></tr>)}</tbody></table></div>}
    </>
  );
}

function Opportunities() {
  const { go } = useRouter(); const toast = useToast(); const lostReason = useLostReason();
  const { data, error, loading, reload } = useLoad(() => api.get<any[]>('/api/crm/opportunities'));
  if (loading && !data) return <Loading kind="table" rows={6} />;
  if (error) return <Failure error={error} retry={reload} />;
  if (!data!.length) return <div className="card"><Empty title="No opportunities yet">A reply that turns into a conversation opens one. You can also open one from a company page.</Empty></div>;
  const open = data!.filter((o) => !['WON', 'LOST'].includes(o.stage));
  const sum = (xs: any[]) => xs.reduce((n, o) => n + BigInt(o.value_paise ?? 0), 0n).toString();
  const setStage = async (o: any, stage: string) => {
    let lost_reason: string | undefined;
    if (stage === 'LOST') { const r = await lostReason(o.company); if (!r) return; lost_reason = r; }
    try { await api.patch(`/api/crm/opportunities/${o.id}`, { stage, lost_reason }); toast(stage === 'LOST' ? `Marked ${o.company} lost.` : `Moved ${o.company} to ${STAGE[stage]}.`); reload(true); } catch (e: any) { toast(e.message, { err: true }); }
  };
  return (
    <>
      <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))' }}>{['REPLIED', 'MEETING_BOOKED', 'MEETING_HELD', 'PROPOSAL_SENT', 'NEGOTIATION'].map((s) => { const xs = open.filter((o) => o.stage === s); return (
        <div key={s} className={`tile${xs.length ? '' : ' zero'}`} style={{ minHeight: 0 }}><span className="lbl">{STAGE[s]}</span><span className="n">{xs.length}</span><span className="hint num">{!xs.length ? 'None' : sum(xs) === '0' ? 'No value set' : inr(sum(xs))}</span></div>); })}</div>
      <div className="card flush scrollx"><table className="t stack">
        <thead><tr><th>Company</th><th>Stage</th><th className="num">Value</th><th>Owner</th><th>Deal</th><th>Moved</th></tr></thead>
        <tbody>{data!.map((o) => <tr key={o.id}>
          <td data-label="Company"><Link to={`/crm/companies/${o.company_id}`} style={{ fontWeight: 600, textDecoration: 'none' }}>{o.company}</Link><div className="sub">{o.contact_name ?? o.domain}{o.campaign ? <> · <span className="mono" style={{ fontSize: 11.5 }}>{o.campaign}</span></> : ''}</div></td>
          <td data-label="Stage"><select className="input" style={{ width: 'auto' }} value={o.stage} onChange={(e) => setStage(o, e.target.value)} aria-label={`Stage for ${o.company}`}>{Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            {o.stage === 'LOST' && o.lost_reason && <div className="sub" style={{ maxWidth: 220 }}>{o.lost_reason}</div>}</td>
          <td data-label="Value" className="num">{o.value_paise ? inr(o.value_paise) : <span className="sub">Not set</span>}</td>
          <td data-label="Owner" className="sub">{o.owner ? actorLabel(o.owner) : 'Nobody'}</td>
          <td data-label="Deal">{o.deal ? <><span className="num">{inr(o.deal.revenue_paise)}</span><div className="sub">{DEAL_STATUS[o.deal.status] ?? o.deal.status}</div></> : <span className="sub">Not signed</span>}</td>
          <td data-label="Moved" className="sub click" onClick={() => go(`/crm/companies/${o.company_id}`)}>{ago(o.updated_at)}</td></tr>)}</tbody></table></div>
    </>
  );
}
