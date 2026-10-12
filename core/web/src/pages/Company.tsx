import { useState } from 'react';
import { api } from '../api.ts';
import { Link } from '../router.tsx';
import { useLoad } from '../ui/hooks.ts';
import { Icon } from '../ui/icons.tsx';
import { useToast } from '../ui/toast.tsx';
import { Empty, Failure, Loading, Spinner, Status, ago, dayLabel, initials, inr, toPaise, toRupees } from '../ui/kit.tsx';
import { STAGE, stageTone } from './Crm.tsx';
import { PROJECT_STATUS } from './Projects.tsx';

export function Company({ id }: { id: string }) {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api.get(`/api/crm/companies/${id}`), [id]);
  const [editing, setEditing] = useState(false); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  if (loading && !data) return <div className="page"><Loading rows={6} /></div>;
  if (error) return <div className="page"><Failure error={error} retry={reload} /></div>;
  const c = data;
  const addNote = async (e: React.FormEvent) => {
    e.preventDefault(); if (!note.trim()) return; setBusy(true);
    try { await api.post(`/api/crm/companies/${id}/notes`, { text: note }); setNote(''); reload(true); } catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(false); }
  };
  const openDeal = async () => { try { await api.post(`/api/crm/companies/${id}/opportunities`, { stage: 'REPLIED' }); toast('Opportunity opened.'); reload(true); } catch (e: any) { toast(e.message, { err: true }); } };
  const hasOpen = c.opportunities.some((o: any) => !['WON', 'LOST'].includes(o.stage));
  return (
    <div className="page">
      <div className="head">
        <div className="grow"><Link to="/crm" className="kick" style={{ textDecoration: 'none' }}>← CRM</Link>
          <h1 style={{ marginTop: 6 }}>{c.name}</h1>
          <div className="co-meta"><a className="tag" href={c.website ?? `https://${c.domain}`} target="_blank" rel="noopener noreferrer">{c.domain} <Icon.out size={11} /></a>
            {[c.city, c.country].filter(Boolean).length > 0 && <span className="tag">{[c.city, c.country].filter(Boolean).join(', ')}</span>}
            {c.vertical && <span className="tag">{c.vertical}</span>}{c.platform && <span className="tag">{c.platform}</span>}{c.company_size && <span className="tag">{c.company_size} people</span>}</div></div>
        <div className="row"><button className="btn" onClick={() => setEditing(!editing)}><Icon.edit size={15} />Edit details</button>{!hasOpen && <button className="btn primary" onClick={openDeal}><Icon.plus size={15} />Open a deal</button>}</div>
      </div>
      {editing && <EditCompany c={c} onDone={() => { setEditing(false); reload(true); }} />}
      <div className="prospect-grid">
        <div className="col" style={{ gap: 'var(--s-5)' }}>
          {c.opportunities.length > 0 && <section className="section"><h2 className="section-title">Deals</h2>{c.opportunities.map((o: any) => <Opportunity key={o.id} o={o} reload={() => reload(true)} />)}</section>}
          <section className="section"><h2 className="section-title">Outbound</h2>
            {c.prospects.length ? <div className="card flush"><table className="t"><tbody>{c.prospects.map((p: any) => <tr key={p.id}>
              <td><Link to={`/prospects/${p.id}`} style={{ fontWeight: 600, textDecoration: 'none' }}>{p.campaign ?? 'Outside any campaign'}</Link><div className="sub">{p.contact_name ?? 'No person yet'}{p.account_score != null ? ` · score ${p.account_score}` : ''}</div></td>
              <td><Status s={p.status} /></td><td className="sub">{ago(p.updated_at)}</td></tr>)}</tbody></table></div>
              : <div className="card"><p className="muted">Not in any outbound campaign.</p></div>}</section>
          <section className="section"><h2 className="section-title">Notes</h2>
            <form className="card col" onSubmit={addNote}><textarea className="textarea" rows={3} placeholder="What happened, what was said, what is next" value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} />
              <div><button className="btn sm primary" disabled={busy || !note.trim()}>{busy && <Spinner />}Add note</button></div></form>
            {c.notes.map((n: any) => <div key={n.id} className="card comment"><div className="avatar">{initials(n.actor)}</div><div><div className="who-line" style={{ display: 'flex', gap: 8, fontSize: 'var(--fs-0)' }}><b style={{ fontWeight: 600 }}>{n.actor}</b><span className="faint">{ago(n.created_at)}</span></div><p className="prose">{n.text}</p></div></div>)}
          </section>
        </div>
        <div className="col" style={{ gap: 'var(--s-5)' }}>
          <People c={c} reload={() => reload(true)} />
          {c.projects.length > 0 && <section className="card col"><h2>Projects</h2>{c.projects.map((p: any) => <Link key={p.id} to={`/projects/${p.id}`} className="row between" style={{ textDecoration: 'none' }}><span>{p.name}</span><span className="tag">{PROJECT_STATUS[p.status]}</span></Link>)}</section>}
          <section className="card col"><h2>Activity</h2>{c.activity.length ? <div className="timeline">{c.activity.map((a: any, i: number) => <div key={i} className="ev"><span className="dot" /><span>{a.action.replace(/_/g, ' ')} <span className="faint">· {a.actor}</span></span><span className="faint mono" style={{ fontSize: 11 }}>{ago(a.created_at)}</span></div>)}</div> : <p className="faint">Nothing yet.</p>}</section>
        </div>
      </div>
    </div>
  );
}

function EditCompany({ c, onDone }: { c: any; onDone: () => void }) {
  const toast = useToast(); const fields = ['name', 'website', 'city', 'country', 'industry', 'vertical', 'company_size', 'platform'] as const;
  const [f, setF] = useState<Record<string, string>>(Object.fromEntries(fields.map((k) => [k, c[k] ?? ''])));
  const labels: Record<string, string> = { name: 'Name', website: 'Website', city: 'City', country: 'Country (2 letters)', industry: 'Industry', vertical: 'Vertical', company_size: 'Size', platform: 'Platform' };
  const save = async (e: React.FormEvent) => { e.preventDefault(); try { await api.patch(`/api/crm/companies/${c.id}`, f); toast('Saved.'); onDone(); } catch (e: any) { toast(e.message, { err: true }); } };
  return <form className="card col" onSubmit={save}><div className="grid-form">{fields.map((k) => <label key={k} className="field"><span>{labels[k]}</span><input value={f[k]} required={k === 'name'} maxLength={k === 'country' ? 2 : 300} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}</div>
    <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>The domain ({c.domain}) is how outbound recognises the company, so it stays as it is.</p>
    <div className="row"><button className="btn primary">Save</button><button type="button" className="btn ghost" onClick={onDone}>Cancel</button></div></form>;
}

function Opportunity({ o, reload }: { o: any; reload: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState(toRupees(o.value_paise)); const [dealOpen, setDealOpen] = useState(false);
  const patch = async (body: object, done: string) => { try { await api.patch(`/api/crm/opportunities/${o.id}`, body); toast(done); reload(); } catch (e: any) { toast(e.message, { err: true }); } };
  const setStage = (stage: string) => {
    if (stage === 'LOST') { const r = prompt('Why was it lost? The weekly review learns from this.'); if (!r?.trim()) return; return patch({ stage, lost_reason: r }, 'Marked lost.'); }
    patch({ stage }, `Moved to ${STAGE[stage]}.`);
  };
  const saveValue = () => { const p = toPaise(value); if (p === 'invalid') return toast('Write the value in rupees, like 1,50,000.', { err: true }); if (p !== o.value_paise) patch({ value_paise: p }, 'Value saved.'); };
  return (
    <div className="card col">
      <div className="row wrap">
        <span className={`tag ${stageTone(o.stage)}`}>{STAGE[o.stage]}</span>
        <select className="input" style={{ width: 'auto' }} value={o.stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">{Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <label className="row" style={{ gap: 6 }}><span className="faint">₹</span><input className="input num" style={{ width: 150 }} inputMode="decimal" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} onBlur={saveValue} aria-label="Value in rupees" /></label>
        <span className="faint right" style={{ fontSize: 'var(--fs-0)' }}>{o.meetings} {o.meetings === 1 ? 'meeting' : 'meetings'} · opened {ago(o.created_at)}</span>
      </div>
      {o.stage === 'LOST' && o.lost_reason && <p className="muted">Lost: {o.lost_reason}</p>}
      {o.deal ? <div className="notice" style={{ padding: 'var(--s-4)' }}><div className="row between wrap"><div><p className="kick ember">Signed{o.deal.signed_at ? ` ${dayLabel(o.deal.signed_at)}` : ''} · {o.deal.status.toLowerCase()}</p>
          <p style={{ fontSize: 'var(--fs-3)', fontWeight: 700, marginTop: 4 }} className="num">{inr(o.deal.revenue_paise)}</p><p className="faint num" style={{ fontSize: 'var(--fs-0)' }}>Cost {inr(o.deal.cost_paise)} · gross profit {inr(o.deal.gross_profit_paise)}</p></div>
          <button className="btn sm" onClick={() => setDealOpen(!dealOpen)}>Update</button></div></div>
        : o.stage === 'WON' && !dealOpen && <button className="btn" onClick={() => setDealOpen(true)}>Record the signed deal</button>}
      {dealOpen && <DealForm o={o} onDone={() => { setDealOpen(false); reload(); }} />}
    </div>
  );
}
function DealForm({ o, onDone }: { o: any; onDone: () => void }) {
  const toast = useToast(); const d = o.deal;
  const [f, setF] = useState({ revenue: toRupees(d?.revenue_paise ?? o.value_paise), cost: toRupees(d?.cost_paise ?? '0'), status: d?.status ?? 'OPEN', signed_at: d?.signed_at ?? '' });
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); const revenue_paise = toPaise(f.revenue); const cost_paise = toPaise(f.cost) ?? '0';
    if (!revenue_paise || revenue_paise === 'invalid' || cost_paise === 'invalid') return toast('Write amounts in rupees, like 1,50,000.', { err: true });
    try { await api.put(`/api/crm/opportunities/${o.id}/deal`, { revenue_paise, cost_paise, status: f.status, signed_at: f.signed_at }); toast('Deal saved.'); onDone(); } catch (e: any) { toast(e.message, { err: true }); }
  };
  return <form className="col" onSubmit={save}><div className="grid-form">
    <label className="field"><span>Revenue, ₹</span><input inputMode="decimal" required value={f.revenue} onChange={(e) => setF({ ...f, revenue: e.target.value })} /></label>
    <label className="field"><span>Our cost, ₹</span><input inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></label>
    <label className="field"><span>Status</span><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{['OPEN', 'DELIVERING', 'COMPLETE', 'CANCELLED'].map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select></label>
    <label className="field"><span>Signed on</span><input type="date" value={f.signed_at} onChange={(e) => setF({ ...f, signed_at: e.target.value })} /></label>
  </div><div className="row"><button className="btn primary">Save deal</button><button type="button" className="btn ghost" onClick={onDone}>Cancel</button></div></form>;
}

function People({ c, reload }: { c: any; reload: () => void }) {
  const toast = useToast(); const [adding, setAdding] = useState(false); const [editing, setEditing] = useState<string | null>(null);
  const blank = { full_name: '', job_title: '', email: '', linkedin_url: '', is_decision_maker: false };
  const [f, setF] = useState(blank);
  const start = (p?: any) => { setF(p ? { full_name: p.full_name ?? '', job_title: p.job_title ?? '', email: p.email ?? '', linkedin_url: p.linkedin_url ?? '', is_decision_maker: p.is_decision_maker } : blank); setEditing(p?.id ?? null); setAdding(!p); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try { if (editing) await api.patch(`/api/crm/contacts/${editing}`, f); else await api.post(`/api/crm/companies/${c.id}/contacts`, f); setAdding(false); setEditing(null); toast('Saved.'); reload(); } catch (e: any) { toast(e.message, { err: true }); }
  };
  const form = <form className="col" onSubmit={save} style={{ padding: 'var(--s-3)', border: '1px solid var(--hairline)', borderRadius: 'var(--r-1)' }}>
    <label className="field"><span>Name</span><input required minLength={2} autoFocus value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></label>
    <label className="field"><span>Title</span><input value={f.job_title} onChange={(e) => setF({ ...f, job_title: e.target.value })} /></label>
    <label className="field"><span>Email</span><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
    <label className="field"><span>LinkedIn</span><input value={f.linkedin_url} onChange={(e) => setF({ ...f, linkedin_url: e.target.value })} /></label>
    <label className="row" style={{ gap: 8 }}><input type="checkbox" className="check" checked={f.is_decision_maker} onChange={(e) => setF({ ...f, is_decision_maker: e.target.checked })} />Makes the decision</label>
    <div className="row"><button className="btn sm primary">Save</button><button type="button" className="btn sm ghost" onClick={() => { setAdding(false); setEditing(null); }}>Cancel</button></div></form>;
  return (
    <section className="card col"><div className="row between"><h2>People</h2>{!adding && <button className="btn sm" onClick={() => start()}><Icon.plus size={14} />Add</button>}</div>
      {adding && form}
      {!c.contacts.length && !adding ? <Empty title="Nobody yet">Add the person who decides.</Empty> : c.contacts.map((p: any) => editing === p.id ? <div key={p.id}>{form}</div> :
        <div key={p.id} className="person"><div className="avatar">{initials(p.full_name)}</div><div className="grow"><div style={{ fontWeight: 600 }}>{p.full_name ?? 'No name'}{p.is_decision_maker && <span className="tag ember" style={{ marginLeft: 8 }}>Decides</span>}</div>
          <div className="sub muted" style={{ fontSize: 'var(--fs-0)' }}>{[p.job_title, p.email].filter(Boolean).join(' · ') || 'No details'}</div></div>
          {p.linkedin_url && /^https?:\/\//.test(p.linkedin_url) && <a className="btn sm ghost" href={p.linkedin_url} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn"><Icon.out size={14} /></a>}
          <button className="btn sm ghost" onClick={() => start(p)} aria-label={`Edit ${p.full_name}`}><Icon.edit size={14} /></button></div>)}
    </section>
  );
}
