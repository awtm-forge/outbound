import { useState } from 'react';
import { api } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useLoad } from '../ui/hooks.ts';
import { Icon } from '../ui/icons.tsx';
import { useToast } from '../ui/toast.tsx';
import { Badge, Failure, Loading, Ring, ScoreBars, Spinner, Status, ProofTag, ago, initials, problemLabel, capLabel, classLabel } from '../ui/kit.tsx';
import { Crumbs, actorLabel } from '../ui/chrome.tsx';
import { DIM } from './Review.tsx';
import { countsBus } from '../App.tsx';
import { SaleshandyPanel } from './outreach/Prospects.tsx';

export const EVENT: Record<string, string> = { research_failed: 'Research stopped on an AI error; it retries up to 3 times, then waits for Research again', created: 'Added to the pipeline', researched: 'Website and company researched', qualified: 'Scored', suppressed: 'Put on the do-not-contact list', decision_maker_added: 'Decision maker added',
  drafted: 'Email drafted', approve: 'Email approved', edit: 'Email edited and approved', reject: 'Email rejected', research_more: 'Sent back for research', synced: 'Queued in Saleshandy', classified: 'Reply read', handled: 'Reply handled', analysed: 'Meeting notes analysed' };
export function Prospect({ id }: { id: string }) {
  const toast = useToast(); const { go } = useRouter();
  const { data: p, error, loading, reload } = useLoad(() => api.get(`/api/prospects/${id}`), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (what: 'chain' | 'email') => {
    setBusy(what);
    try {
      if (what === 'chain') { const r = await api.run(`/api/prospects/${id}/run-chain`, { force: true }); toast(`Researched again.${r.qualify?.score != null ? ` Score: ${r.qualify.score}.` : ''}${r.email?.draft_id ? ' An email is waiting for review.' : ''}`); }
      if (what === 'email') { await api.run(`/api/prospects/${id}/generate-email`, { force: true }); toast('Email written. It waits in Review.', { action: { label: 'Review it', run: () => go('/review') } }); }
      countsBus.dispatchEvent(new Event('changed')); reload(true);
    } catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(null); }
  };
  if (loading && !p) return <div className="page"><Loading rows={6} /></div>;
  if (error || !p) return <div className="page"><Crumbs items={[{ to: '/pipeline', label: 'Pipeline' }, { label: 'Company' }]} /><Failure error={error ?? 'Not found'} retry={reload} /></div>;
  const r = Object.fromEntries((p.research as any[]).map((x) => [x.kind, x.data]));
  const acc = r.ACCOUNT, web = r.WEBSITE, prob = r.PROBLEM, dm = r.DECISION_MAKER;
  const named = p.contact && (p.contact.full_name || p.contact.first_name);
  const pending = (p.drafts as any[]).find((d) => d.status === 'PENDING_APPROVAL');
  const b = p.score_breakdown ?? {};
  return (
    <div className="page">
      <Crumbs items={[{ to: '/pipeline', label: 'Pipeline' }, { label: p.company.name }]} />
      <div className="head" style={{ alignItems: 'center' }}>
        <div className="row" style={{ gap: 'var(--s-5)' }}><Ring value={p.account_score} />
          <div><div className="co-name">{p.company.name}</div>
            <div className="co-meta"><Status s={p.status} /><a className="tag" href={p.company.website ?? `https://${p.company.domain}`} target="_blank" rel="noreferrer">{p.company.domain} <Icon.out size={12} /></a>
              {p.company.platform && <span className="tag">{p.company.platform}</span>}{p.campaign && <span className="tag" title={p.campaign.code}>{p.campaign.vertical || p.campaign.code}</span>}</div></div></div>
        <div className="row wrap">
          {pending ? <Link className="btn primary" to="/review"><Icon.review size={16} />Review the email</Link>
            : named && ['QUALIFIED', 'RESEARCH_FURTHER'].includes(p.status) ? <button className="btn primary" onClick={() => run('email')} disabled={!!busy}>{busy === 'email' ? <Spinner /> : <Icon.spark size={16} />}Write the email</button> : null}
          <button className="btn" onClick={() => run('chain')} disabled={!!busy || p.suppressed}>{busy === 'chain' ? <Spinner /> : <Icon.redo size={16} />}Research again</button>
        </div>
      </div>
      {p.suppressed && <div className="banner err"><Icon.shield />On the do-not-contact list: {p.suppression_reason}. Nothing will be drafted or sent.</div>}
      <div className="prospect-grid">
        <div className="col" style={{ gap: 'var(--s-5)' }}>
          {p.specific_observation && p.specific_observation !== 'UNKNOWN' && <div className="notice"><p className="kick ember" style={{ marginBottom: 10 }}>What we noticed · {problemLabel(p.primary_problem)}</p><p className="obs">{p.specific_observation}</p><p className="why">{p.business_consequence}</p>
            {p.secondary_problems?.length > 0 && <div className="row wrap" style={{ marginTop: 12 }}><span className="faint" style={{ fontSize: 'var(--fs-0)' }}>Also:</span>{p.secondary_problems.map((s: string) => <span key={s} className="tag">{problemLabel(s)}</span>)}</div>}</div>}
          {acc && <div className="card col"><h2>The company</h2><p>{acc.company_summary}</p>
            <dl className="kv">{([['Sells', acc.what_they_sell], ['Sells to', acc.target_customer], ['Model', acc.business_model], ['Size', acc.company_size_estimate], ['Market', acc.market]] as const).map(([k, v]: any) => v && <Frag key={k} k={k} v={v} />)}</dl>
            {acc.technology_signals?.length > 0 && <div className="row wrap">{acc.technology_signals.map((t: any) => <span key={t.value} className="tag">{t.value}</span>)}</div>}</div>}
          {web?.findings?.length > 0 && <div className="card col"><div className="row between"><h2>On their site</h2><span className="faint" style={{ fontSize: 'var(--fs-0)' }}>{web.overall_note}</span></div>
            <div className="findings">{web.findings.map((f: any, i: number) => <div key={i} className="finding"><span className="kick" style={{ paddingTop: 3 }}>{DIM[f.dimension] ?? f.dimension.replace(/_/g, ' ').toLowerCase()}</span>
              <div><div>{f.observation}</div><div className="muted" style={{ fontSize: 'var(--fs-0)', marginTop: 4 }}>{f.likely_consequence}</div><div className="faint" style={{ fontSize: 'var(--fs-0)', marginTop: 4 }}>Would test: {f.recommended_test}</div></div></div>)}</div></div>}
          {(p.drafts as any[]).length > 0 && <div className="card col"><h2>Emails</h2>{(p.drafts as any[]).map((d) => <details key={d.id} open={d.status === 'PENDING_APPROVAL'} className="proof"><summary className="row" style={{ cursor: 'pointer' }}><b style={{ fontWeight: 600 }} className="grow ellipsis">{d.subject_final ?? d.subject_original}</b><Status s={d.status === 'SENT_TO_SEQUENCER' ? 'SYNCED' : d.status === 'RESEARCH_MORE' ? 'RESEARCH_FURTHER' : d.status} /><span className="faint" style={{ fontSize: 'var(--fs-0)' }}>{ago(d.created_at)}</span></summary>
            <div className="prose muted" style={{ marginTop: 10, fontSize: 'var(--fs-0)' }}>{d.body_final ?? d.body_original}</div>{d.approver && <div className="faint" style={{ fontSize: 'var(--fs-0)', marginTop: 8 }}>{d.status === 'REJECTED' ? 'Rejected' : 'Approved'} by {actorLabel(d.approver)}{d.rejection_reason ? `: ${d.rejection_reason}` : ''}</div>}</details>)}</div>}
          {(p.replies as any[]).length > 0 && <div className="card col"><h2>Replies</h2>{(p.replies as any[]).map((x) => <div key={x.id} className="col" style={{ gap: 6 }}><div className="row"><Badge tone="info">{classLabel(x.classification)}</Badge><span className="faint right" style={{ fontSize: 'var(--fs-0)' }}>{ago(x.received_at)}</span></div><div className="quote">{x.body}</div></div>)}</div>}
        </div>
        <div className="col" style={{ gap: 'var(--s-5)' }}>
          <People p={p} dm={dm} reload={() => { reload(true); countsBus.dispatchEvent(new Event('changed')); }} />
          <div className="card col"><h2>Score</h2><ScoreBars criteria={p.criteria} values={b} />
            <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>{p.thresholds.campaign_ready} or more gets an email. {p.thresholds.research_further} to {p.thresholds.campaign_ready - 1} needs more research. Below that is not a fit.</p></div>
          <div className="card col"><div className="row between"><h2>Why awtm forge</h2><span className="tag">{capLabel(p.relevant_capability)}</span></div>
            {(p.proofs as any[]).length ? (p.proofs as any[]).map((x) => <div key={x.id} className="proof"><div className="row between"><b style={{ fontWeight: 600 }}>{x.title}</b><ProofTag label={x.label} /></div><span className="muted" style={{ fontSize: 'var(--fs-0)' }}>{x.text}</span></div>) : <p className="muted">No verified proof matches yet.</p>}
            {prob?.trigger && prob.trigger !== 'UNKNOWN' && <p className="muted" style={{ fontSize: 'var(--fs-0)' }}>Trigger: {prob.trigger}</p>}</div>
          <div className="card col"><h2>History</h2><div className="timeline">{(p.activity as any[]).map((a, i) => <div key={i} className="ev"><span className="dot" aria-hidden="true" /><span>{EVENT[a.action] ?? a.action.replace(/_/g, ' ')}{a.actor !== 'system' ? <span className="faint"> by {actorLabel(a.actor)}</span> : ''}</span><span className="faint" style={{ fontSize: 'var(--fs-0)', whiteSpace: 'nowrap' }}>{ago(a.created_at)}</span></div>)}</div></div>
          <SaleshandyPanel companyId={p.company.id} />
        </div>
      </div>
    </div>
  );
}
function Frag({ k, v }: { k: string; v: { value: string; tag: string } }) {
  return <><dt>{k}</dt><dd>{v.value === 'UNKNOWN' ? <span className="faint">Not known</span> : v.value}{v.tag === 'INFERRED' && <span className="faint" style={{ fontSize: 12 }}> · inferred</span>}</dd></>;
}
function People({ p, dm, reload }: { p: any; dm: any; reload: () => void }) {
  const toast = useToast(); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ full_name: '', job_title: '', email: '', linkedin_url: '' });
  const named = (p.contacts as any[]).filter((c) => c.full_name);
  const generic = (p.contacts as any[]).filter((c) => !c.full_name && c.email);
  const company = p.company.name.split(/[|:–-]/)[0].trim();
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await api.post(`/api/prospects/${p.id}/contact`, f); toast(`Saved. ${f.full_name} is now the person we write to.`); setOpen(false); setF({ full_name: '', job_title: '', email: '', linkedin_url: '' }); reload(); }
    catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(false); }
  };
  return (
    <div className="card col">
      <div className="row between"><h2>Who we write to</h2>{!open && named.length > 0 && <button className="btn sm" onClick={() => setOpen(true)}>Add another</button>}</div>
      {named.map((c) => <div key={c.id} className="person"><div className="avatar">{initials(c.full_name)}</div><div className="grow"><div style={{ fontWeight: 600 }}>{c.full_name}{p.contact_id === c.id && <span style={{ marginLeft: 8 }}><Badge tone="success">Writing to</Badge></span>}</div><div className="muted" style={{ fontSize: 'var(--fs-0)' }}>{c.job_title ?? 'Title unknown'}</div><div className="mono faint" style={{ fontSize: 12 }}>{c.email ?? 'No email yet'}</div></div>{c.linkedin_url && <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="btn sm ghost" aria-label={`${c.full_name} on LinkedIn`}><Icon.out size={14} /></a>}</div>)}
      {!named.length && !open && <div className="callout"><b style={{ fontWeight: 600 }}>No named person yet</b><span className="muted" style={{ fontSize: 'var(--fs-0)' }}>We only write to a person, never to a shared inbox. Find the founder or whoever owns the website, then add them here.</span>
        {dm?.recommended_titles?.length > 0 && <span className="faint" style={{ fontSize: 'var(--fs-0)' }}>Look for: {dm.recommended_titles.join(', ')}</span>}
        <div className="row wrap"><a className="btn sm" href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(company + ' founder')}`} target="_blank" rel="noreferrer"><Icon.find size={14} />Search LinkedIn</a><button className="btn sm primary" onClick={() => setOpen(true)}><Icon.user size={14} />Add a person</button></div></div>}
      {open && <form className="col" onSubmit={save}>
        <label className="field"><span>Name</span><input autoFocus required value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} placeholder="Full name" /></label>
        <label className="field"><span>Role</span><input value={f.job_title} onChange={(e) => setF({ ...f, job_title: e.target.value })} placeholder="Founder, Head of Ecommerce" /></label>
        <label className="field"><span>Work email</span><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder={`name@${p.company.domain}`} /></label>
        <label className="field"><span>LinkedIn</span><input value={f.linkedin_url} onChange={(e) => setF({ ...f, linkedin_url: e.target.value })} placeholder="https://www.linkedin.com/in/..." /></label>
        <div className="row"><button className="btn primary" disabled={busy}>{busy && <Spinner />}Save person</button><button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button></div></form>}
      {generic.length > 0 && <div className="faint" style={{ fontSize: 'var(--fs-0)' }}>Shared inboxes on their site: {generic.map((c) => c.email).join(', ')}</div>}
      {p.company.metadata?.phones?.length > 0 && <div className="faint mono" style={{ fontSize: 12 }}>{p.company.metadata.phones.join(' · ')}</div>}
    </div>
  );
}
