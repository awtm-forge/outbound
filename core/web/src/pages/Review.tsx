import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useKeys, useLoad } from '../ui/hooks.ts';
import { Icon } from '../ui/icons.tsx';
import { useToast } from '../ui/toast.tsx';
import { Empty, Failure, Loading, Ring, ScoreBars, Spinner, ProofTag, problemLabel, capLabel, ago } from '../ui/kit.tsx';
import { countsBus } from '../App.tsx';

type Item = any;
const DIM: Record<string, string> = { VALUE_PROPOSITION: 'Value proposition', NAVIGATION: 'Navigation', CTA: 'Call to action', MOBILE_UX: 'On a phone', PRODUCT_DISCOVERY: 'Finding products', TRUST: 'Trust', SOCIAL_PROOF: 'Social proof',
  FORMS: 'Forms', CONVERSION_FRICTION: 'Friction', CONTENT: 'Content', SEO_BASICS: 'Search basics', TECHNICAL_SIGNALS: 'Technical', PERFORMANCE_SIGNALS: 'Speed signals', INFORMATION_ARCHITECTURE: 'Structure' };

export function Review() {
  const { search, go } = useRouter();
  const tab = search.get('tab') === 'approved' ? 'APPROVED' : 'PENDING_APPROVAL';
  const { data, error, loading, reload } = useLoad(() => api.get(`/api/queue/drafts?status=${tab}`), [tab]);
  const items: Item[] = data?.items ?? [];
  const [idx, setIdx] = useState(0);
  useEffect(() => { if (idx >= items.length) setIdx(Math.max(0, items.length - 1)); }, [items.length, idx]);
  const item = items[idx];
  const setTab = (t: string) => go(t === 'APPROVED' ? '/review?tab=approved' : '/review', true);

  return (
    <div className="page">
      <div className="head">
        <div><h1>Review emails</h1><p>Every cold email stops here. Read it against what we found, change anything, then approve. Nothing is sent until you do.</p></div>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'PENDING_APPROVAL'} className={tab === 'PENDING_APPROVAL' ? 'on' : ''} onClick={() => setTab('PENDING_APPROVAL')}>To review</button>
          <button role="tab" aria-selected={tab === 'APPROVED'} className={tab === 'APPROVED' ? 'on' : ''} onClick={() => setTab('APPROVED')}>Approved, not sent</button>
        </div>
      </div>
      {loading && !data ? <Loading rows={5} /> : error ? <Failure error={error} retry={reload} /> : !item ? (
        tab === 'APPROVED'
          ? <div className="card"><Empty title="Nothing approved is waiting">Approved emails go to Saleshandy every 15 minutes, or when you send them from here.</Empty></div>
          : <div className="card"><Empty title="You are all caught up" action={<div className="row"><Link className="btn primary" to="/find">Find companies</Link><Link className="btn" to="/pipeline?view=needs_contact">Add decision makers</Link></div>}>
              New drafts appear here when a company scores 70 or more and has a named person to write to.</Empty></div>
      ) : (
        <Draft key={item.id} item={item} criteria={data.criteria} pos={idx} total={items.length} approvedTab={tab === 'APPROVED'}
          prev={() => setIdx((i) => Math.max(0, i - 1))} next={() => setIdx((i) => Math.min(items.length - 1, i + 1))}
          done={() => { countsBus.dispatchEvent(new Event('changed')); reload(true); }} />
      )}
    </div>
  );
}

function Draft({ item, criteria, pos, total, prev, next, done, approvedTab }: { item: Item; criteria: any[]; pos: number; total: number; prev: () => void; next: () => void; done: () => void; approvedTab: boolean }) {
  const toast = useToast();
  const [subject, setSubject] = useState(item.subject_final ?? item.subject_original);
  const [body, setBody] = useState(item.body_final ?? item.body_original);
  const [reasonFor, setReasonFor] = useState<null | 'REJECT' | 'RESEARCH_MORE'>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const edited = subject !== item.subject_original || body !== item.body_original;
  const words = useMemo(() => body.trim().split(/\s+/).filter(Boolean).length, [body]);

  const decide = async (action: 'APPROVE' | 'EDIT' | 'REJECT' | 'RESEARCH_MORE') => {
    if ((action === 'REJECT' || action === 'RESEARCH_MORE') && reasonFor !== action) { setReasonFor(action); return; }
    setBusy(action);
    try {
      await api.post(`/api/drafts/${item.id}/decision`, { action: action === 'APPROVE' && edited ? 'EDIT' : action, subject, body, reason: reason || undefined });
      toast(action === 'REJECT' ? `Rejected. ${item.company} is closed.` : action === 'RESEARCH_MORE' ? `${item.company} goes back for more research.` : `Approved. ${item.company} will be queued in Saleshandy.`);
      done();
    } catch (e: any) { toast(e.message, { err: true }); setBusy(null); }
  };
  const sync = async () => { setBusy('SYNC'); try { const r = await api.post(`/api/drafts/${item.id}/sync`); toast(r.mode === 'mock' ? 'Queued in the Saleshandy simulator. Nothing was sent.' : 'Queued in Saleshandy.'); done(); } catch (e: any) { toast(e.message, { err: true }); setBusy(null); } };
  useKeys({ a: () => (approvedTab ? sync() : decide('APPROVE')), r: () => !approvedTab && decide('REJECT'), m: () => !approvedTab && decide('RESEARCH_MORE'), e: () => bodyRef.current?.focus(), j: next, k: prev, ArrowRight: next, ArrowLeft: prev }, !busy);

  const site = item.website; const b = item.score_breakdown ?? {};
  return (
    <div className="review">
      <div className="ctx">
        <div className="row between wrap">
          <div className="queue-nav"><button className="btn sm" onClick={prev} disabled={pos === 0} aria-label="Previous email"><Icon.left size={16} /></button><span className="pos">{pos + 1} of {total}</span><button className="btn sm" onClick={next} disabled={pos === total - 1} aria-label="Next email"><Icon.right size={16} /></button></div>
          <Link to={`/prospects/${item.prospect_id}`} className="btn sm ghost">Full profile <Icon.arrow size={14} /></Link>
        </div>
        <div>
          <div className="co-name">{item.company}</div>
          <div className="co-meta">
            <a className="tag" href={item.website ?? `https://${item.domain}`} target="_blank" rel="noreferrer">{item.domain} <Icon.out size={12} /></a>
            {item.platform && <span className="tag">{item.platform}</span>}{item.city && <span className="tag">{item.city}</span>}<span className="tag ember">{item.campaign}</span>
          </div>
        </div>
        <div className="notice">
          <p className="kick ember" style={{ marginBottom: 10 }}>What we noticed · {problemLabel(item.primary_problem)}</p>
          <p className="obs">{item.specific_observation}</p>
          <p className="why">{item.business_consequence}</p>
        </div>
        <div className="card">
          <div className="score"><Ring value={item.account_score} />
            <ScoreBars criteria={criteria} values={b} /></div>
          {b.rationale && <details style={{ marginTop: 14 }}><summary className="faint" style={{ cursor: 'pointer', fontSize: 'var(--fs-0)' }}>Why these points</summary>
            <div className="col" style={{ marginTop: 10, gap: 6, fontSize: 'var(--fs-0)' }}>{criteria.map((c: any) => b.rationale[c.key] && <div key={c.key}><span className="faint">{c.label}.</span> {b.rationale[c.key]}</div>)}</div></details>}
        </div>
        {site?.findings?.length > 0 && <div className="card"><h2 style={{ marginBottom: 14 }}>On their site</h2><div className="findings">{site.findings.slice(0, 4).map((f: any, i: number) =>
          <div key={i} className="finding"><span className="kick" style={{ paddingTop: 3 }}>{DIM[f.dimension] ?? f.dimension}</span><div><div>{f.observation}</div><div className="faint" style={{ fontSize: 'var(--fs-0)', marginTop: 4 }}>Would test: {f.recommended_test}</div></div></div>)}</div></div>}
        <div className="card col">
          <div className="row between"><h2>Why awtm forge</h2><span className="tag">{capLabel(item.relevant_capability)}</span></div>
          {item.proofs.length ? item.proofs.map((p: any) => <div key={p.id} className="proof"><div className="row between"><b style={{ fontWeight: 600 }}>{p.title}</b><ProofTag label={p.label} /></div><span className="muted" style={{ fontSize: 'var(--fs-0)' }}>{p.text}</span>{p.notes && <span className="faint" style={{ fontSize: 'var(--fs-0)' }}>{p.notes}</span>}</div>)
            : <p className="muted">No verified proof fits this company, so the email makes no claim about past work.</p>}
        </div>
      </div>

      <div className="composer" aria-label="Email draft">
        <div className="to"><span className="k">To</span><span className="grow">{item.contact_name ? <b style={{ fontWeight: 600 }}>{item.contact_name}</b> : <span className="faint">No name</span>}{item.contact_title && <span className="muted">, {item.contact_title}</span>}<br /><span className="mono faint" style={{ fontSize: 12 }}>{item.contact_email ?? 'no email yet'}</span></span>
          {item.email_verification_status && <span className={`tag ${item.email_verification_status === 'VALID' ? 'ember' : 'dim'}`}>{item.email_verification_status === 'VALID' ? 'Verified' : item.email_verification_status === 'UNVERIFIED' ? 'Not verified yet' : item.email_verification_status.toLowerCase()}</span>}</div>
        <label className="sr" htmlFor="subject">Subject</label>
        <input id="subject" className="subject" value={subject} onChange={(e) => setSubject(e.target.value)} readOnly={approvedTab} />
        <label className="sr" htmlFor="body">Email</label>
        <textarea id="body" ref={bodyRef} className="body" value={body} onChange={(e) => setBody(e.target.value)} readOnly={approvedTab} spellCheck />
        {reasonFor && <div className="reason"><input className="input" autoFocus placeholder={reasonFor === 'REJECT' ? 'Why is this not a fit? (optional)' : 'What should research look at? (optional)'} value={reason} onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') decide(reasonFor); if (e.key === 'Escape') setReasonFor(null); }} /><button className={`btn ${reasonFor === 'REJECT' ? 'danger' : ''}`} onClick={() => decide(reasonFor)}>{reasonFor === 'REJECT' ? 'Reject' : 'Send back'}</button><button className="btn ghost" onClick={() => setReasonFor(null)}>Cancel</button></div>}
        <div className="foot">
          {approvedTab ? <>
            <span className="faint" style={{ fontSize: 'var(--fs-0)' }}>Approved by {item.approver} · {ago(item.approved_at)}</span>
            <button className="btn primary right" onClick={sync} disabled={!!busy}>{busy === 'SYNC' ? <Spinner /> : <Icon.send size={16} />}Send to Saleshandy now <kbd>A</kbd></button>
          </> : <>
            <button className="btn primary" onClick={() => decide('APPROVE')} disabled={!!busy}>{busy === 'APPROVE' ? <Spinner /> : <Icon.check size={16} />}{edited ? 'Approve with my edits' : 'Approve'} <kbd>A</kbd></button>
            <button className="btn" onClick={() => decide('RESEARCH_MORE')} disabled={!!busy}><Icon.redo size={16} />Research again <kbd>M</kbd></button>
            <button className="btn danger" onClick={() => decide('REJECT')} disabled={!!busy}><Icon.x size={16} />Reject <kbd>R</kbd></button>
            <span className={`right mono ${words > 120 ? '' : 'faint'}`} style={{ fontSize: 11, color: words > 120 ? 'var(--danger)' : undefined }}>{words} words{edited ? ' · edited' : ''}</span>
          </>}
        </div>
      </div>
    </div>
  );
}
