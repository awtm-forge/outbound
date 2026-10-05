import { useState } from 'react';
import { api } from '../api.ts';
import { Link } from '../router.tsx';
import { useLoad } from '../ui/hooks.ts';
import { Icon } from '../ui/icons.tsx';
import { useToast } from '../ui/toast.tsx';
import { Empty, Failure, Loading, Spinner, inr, when, ago } from '../ui/kit.tsx';

export function Deals() {
  const { data, error, loading, reload } = useLoad(() => api.get('/api/deals'));
  const [open, setOpen] = useState<string | null>(null);
  if (loading && !data) return <div className="page"><Loading rows={5} /></div>;
  if (error) return <div className="page"><Failure error={error} retry={reload} /></div>;
  const meetings: any[] = data.meetings; const proposals: any[] = data.proposals;
  const upcoming = meetings.filter((m) => !m.held); const held = meetings.filter((m) => m.held);
  return (
    <div className="page">
      <div className="head"><div><h1>Meetings and deals</h1><p>A brief before every call, notes turned into next steps after it, and a proposal draft that never invents a price, a date or a promise.</p></div></div>
      <section className="section"><h2 className="section-title" style={{ fontSize: 'var(--fs-3)' }}>Coming up</h2>
        {upcoming.length ? upcoming.map((m) => <Meeting key={m.id} m={m} open={open === m.id} toggle={() => setOpen(open === m.id ? null : m.id)} reload={reload} />)
          : <div className="card"><Empty title="No calls booked">When a reply turns into a call, mark it from the inbox and the brief is written for you.</Empty></div>}</section>
      {held.length > 0 && <section className="section"><h2 className="section-title" style={{ fontSize: 'var(--fs-3)' }}>Held</h2>{held.map((m) => <Meeting key={m.id} m={m} open={open === m.id} toggle={() => setOpen(open === m.id ? null : m.id)} reload={reload} />)}</section>}
      <section className="section"><h2 className="section-title" style={{ fontSize: 'var(--fs-3)' }}>Proposals</h2>
        {proposals.length ? proposals.map((p) => <Proposal key={p.id} p={p} reload={reload} />) : <div className="card"><Empty title="No proposals yet">After a call, paste your notes and a proposal draft follows.</Empty></div>}</section>
    </div>
  );
}
function Meeting({ m, open, toggle, reload }: { m: any; open: boolean; toggle: () => void; reload: () => void }) {
  const toast = useToast(); const [notes, setNotes] = useState(m.notes ?? ''); const [busy, setBusy] = useState<string | null>(null);
  const b = m.brief; const a = m.analysis;
  const act = async (what: 'brief' | 'notes' | 'proposal') => {
    setBusy(what);
    try {
      if (what === 'brief') await api.post(`/api/meetings/${m.id}/brief`, { force: true });
      if (what === 'notes') await api.post(`/api/meetings/${m.id}/post-meeting`, { notes });
      if (what === 'proposal') await api.post(`/api/meetings/${m.id}/proposal`, { business_inputs: {} });
      toast(what === 'brief' ? 'Brief rewritten.' : what === 'notes' ? 'Notes read. Next steps are below.' : 'Proposal drafted. Price and dates stay blank until you set them.'); reload();
    } catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(null); }
  };
  return (
    <div className="card col">
      <button className="row" onClick={toggle} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }} aria-expanded={open}>
        <div className="avatar"><Icon.deals size={16} /></div>
        <div className="grow"><div style={{ fontWeight: 650, fontSize: 'var(--fs-2)' }}>{m.company}</div><div className="muted" style={{ fontSize: 'var(--fs-0)' }}>{m.contact_name ?? ''} · {when(m.scheduled_at)}</div></div>
        <span className={`tag ${m.held ? '' : 'ember'}`}>{m.held ? 'Held' : 'Brief ready'}</span><Icon.right />
      </button>
      {open && <div className="col" style={{ gap: 'var(--s-5)', marginTop: 'var(--s-3)' }}>
        {b && <div className="prospect-grid">
          <div className="col">
            <Block k="Why they replied" v={b.why_they_replied} /><Block k="What we noticed" v={b.original_observation} /><Block k="What we can do" v={b.possible_solution} /><Block k="The company" v={b.company_context} />
          </div>
          <div className="col">
            <div><p className="kick" style={{ marginBottom: 8 }}>Ask them</p><ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>{b.questions_to_ask.map((q: string) => <li key={q}>{q}</li>)}</ol></div>
            <div><p className="kick" style={{ marginBottom: 8 }}>They may say</p><div className="row wrap">{b.potential_objections.map((o: string) => <span key={o} className="tag">{o}</span>)}</div></div>
          </div></div>}
        <hr className="divider" />
        <label className="field"><span>Notes or transcript from the call</span><textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Pain: ... Goal: ... Scope: ... Budget: ... Timeline: ... Next step: ..." /></label>
        <div className="row wrap"><button className="btn primary" onClick={() => act('notes')} disabled={!!busy || notes.trim().length < 10}>{busy === 'notes' ? <Spinner /> : <Icon.spark size={16} />}Turn notes into next steps</button>
          <button className="btn" onClick={() => act('brief')} disabled={!!busy}>{busy === 'brief' && <Spinner />}Rewrite the brief</button>
          {a && <button className="btn" onClick={() => act('proposal')} disabled={!!busy}>{busy === 'proposal' && <Spinner />}Draft the proposal</button>}
          <Link className="btn ghost right" to={`/prospects/${m.prospect_id}`}>Profile <Icon.arrow size={14} /></Link></div>
        {a && <div className="prospect-grid"><div className="col"><Block k="Pain" v={a.pain.join('; ')} /><Block k="Goal" v={a.goal.join('; ')} /><Block k="Scope" v={a.scope} /><Block k="Timeline" v={a.timeline} /><Block k="Budget" v={a.budget_signal} /><Block k="Next step" v={a.next_step} /></div>
          <div className="col"><p className="kick">Follow-up, not sent</p><div className="quote">{a.follow_up_draft}</div><p className="kick">Tasks</p><ul style={{ margin: 0, paddingLeft: 18 }}>{a.tasks.map((t: string) => <li key={t}>{t}</li>)}</ul></div></div>}
      </div>}
    </div>
  );
}
const Block = ({ k, v }: { k: string; v?: string }) => !v || v === 'UNKNOWN' ? null : <div><p className="kick" style={{ marginBottom: 4 }}>{k}</p><p>{v}</p></div>;
function Proposal({ p, reload }: { p: any; reload: () => void }) {
  const toast = useToast(); const d = p.draft; const [busy, setBusy] = useState(false);
  const decide = async (action: 'APPROVE' | 'DECLINE') => { setBusy(true); try { await api.post(`/api/proposals/${p.id}/decision`, { action }); toast(action === 'APPROVE' ? 'Proposal approved.' : 'Proposal declined.'); reload(); } catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(false); } };
  const price = p.business_inputs?.price_paise;
  return (
    <div className="card col">
      <div className="row between wrap"><div><div style={{ fontWeight: 650, fontSize: 'var(--fs-2)' }}>{p.company}</div><div className="faint" style={{ fontSize: 'var(--fs-0)' }}>Drafted {ago(p.created_at)}</div></div>
        <div className="row"><span className={`tag ${p.status === 'APPROVED' ? 'solid' : ''}`}>{p.status.toLowerCase()}</span>{p.status === 'DRAFT' && <><button className="btn sm primary" onClick={() => decide('APPROVE')} disabled={busy}>Approve</button><button className="btn sm ghost" onClick={() => decide('DECLINE')} disabled={busy}>Decline</button></>}</div></div>
      <div className="prospect-grid">
        <div className="col"><Block k="Problem" v={d.problem} /><Block k="Diagnosis" v={d.diagnosis} /><Block k="What we recommend" v={d.recommended_solution} />
          <div><p className="kick" style={{ marginBottom: 6 }}>Milestones</p>{d.milestones.map((m: any) => <div key={m.name} style={{ marginBottom: 6 }}><b style={{ fontWeight: 600 }}>{m.name}.</b> <span className="muted">{m.description}</span></div>)}</div></div>
        <div className="col"><div className="notice" style={{ padding: 'var(--s-4)' }}><p className="kick ember">Investment</p><p style={{ fontSize: 'var(--fs-3)', fontWeight: 700, marginTop: 6 }}>{price != null ? inr(price) : d.investment}</p><p className="faint" style={{ fontSize: 'var(--fs-0)', marginTop: 4 }}>Timeline: {d.timeline}</p></div>
          <div><p className="kick" style={{ marginBottom: 6 }}>Deliverables</p><ul style={{ margin: 0, paddingLeft: 18 }}>{d.deliverables.map((x: string) => <li key={x}>{x}</li>)}</ul></div>
          <div><p className="kick" style={{ marginBottom: 6 }}>Not included</p><ul style={{ margin: 0, paddingLeft: 18 }} className="muted">{d.exclusions.map((x: string) => <li key={x}>{x}</li>)}</ul></div></div>
      </div>
    </div>
  );
}
