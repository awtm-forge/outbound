import { useEffect, useState } from 'react';
import { api } from '../../api.ts';
import { Icon } from '../../ui/icons.tsx';
import { Modal } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Spinner, statusLabel, toPaise, toRupees } from '../../ui/kit.tsx';
import { useMe, useTeam } from '../../session.tsx';

export const STAGE: Record<string, string> = { REPLIED: 'Replied', MEETING_BOOKED: 'Meeting booked', MEETING_HELD: 'Meeting held', PROPOSAL_SENT: 'Proposal sent', NEGOTIATION: 'Negotiating', WON: 'Won', LOST: 'Lost' };
export const OPEN_STAGES = ['REPLIED', 'MEETING_BOOKED', 'MEETING_HELD', 'PROPOSAL_SENT', 'NEGOTIATION'];
export const STAGE_COLOR: Record<string, string> = { REPLIED: '#38BDF8', MEETING_BOOKED: '#A855F7', MEETING_HELD: '#C084FC', PROPOSAL_SENT: '#3B82F6', NEGOTIATION: '#FF922E', WON: '#22C55E', LOST: '#F87171' };
// the outbound statuses, grouped the way the filter offers them; each group keeps the statuses' own meaning
export const STATUS_GROUPS: [string, string, string[]][] = [
  ['research', 'Research', ['NEW', 'QUALIFYING', 'RESEARCHING', 'RESEARCH_FURTHER']], ['qualified', 'Qualified', ['QUALIFIED', 'EMAIL_DRAFTED', 'PENDING_APPROVAL']],
  ['approved', 'Approved', ['APPROVED', 'SYNCED']], ['contacted', 'Contacted', ['CONTACTED']], ['replied', 'Replied and beyond', ['REPLIED', 'MEETING', 'PROPOSAL', 'WON']],
  ['notfit', 'Not a fit', ['REJECTED', 'LOST', 'SUPPRESSED']], ['none', 'Not in outbound', ['NONE']],
];
const TONE: Record<string, string> = {
  NEW: 'amber', QUALIFYING: 'amber', RESEARCHING: 'amber', RESEARCH_FURTHER: 'amber', QUALIFIED: 'blue', EMAIL_DRAFTED: 'blue', PENDING_APPROVAL: 'blue',
  APPROVED: 'green', SYNCED: 'green', CONTACTED: 'green', REPLIED: 'green', WON: 'green', MEETING: 'violet', PROPOSAL: 'violet', REJECTED: 'red', LOST: 'red', SUPPRESSED: 'red',
};
export const OutStatus = ({ s }: { s?: string | null }) => s ? <span className={`ostat ${TONE[s] ?? 'amber'}`}><i aria-hidden="true" />{statusLabel(s)}</span> : <span className="ostat none">Not in outbound</span>;
export const StagePill = ({ s }: { s: string }) => <span className="stage-pill" style={{ '--sc': STAGE_COLOR[s] } as React.CSSProperties}>{STAGE[s] ?? s}</span>;
const HUES = [24, 210, 265, 150, 340, 190, 45, 290];
const hue = (s: string) => HUES[[...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % HUES.length]!;
const two = (name: string) => name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
// a generated mark from the name: no logo service is called, so nothing about the company leaves the app
export const CoMark = ({ name, size = 36 }: { name: string; size?: number }) => { const h = hue(name); return <span className="comark" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(150deg, hsl(${h} 85% 55%), hsl(${h + 20} 80% 42%))` }}>{two(name)}</span>; };
export const PersonDot = ({ name }: { name: string }) => <span className="pdot" title={name} style={{ background: `hsl(${hue(name)} 45% 30%)` }}>{two(name)}</span>;
export const siteUrl = (c: { website?: string | null; domain?: string | null }) => { const u = c.website || (c.domain ? `https://${c.domain}` : ''); return /^https?:\/\/[^\s/]+\.[^\s]+/i.test(u) ? u : null; };
// what a CRM event says
export const EVENT: Record<string, string> = {
  created: 'was added', updated: 'was edited', owner_changed: 'new owner', archived: 'was archived', restored: 'was restored', contact_added: 'has a new contact',
  follow_up_added: 'has a new follow-up', follow_up_done: 'follow-up done', follow_up_reopened: 'follow-up reopened', researched: 'was researched', research_failed: 'research stopped on an error',
  qualified: 'was scored', suppressed: 'went on do-not-contact', decision_maker_added: 'decision maker added', drafted: 'email drafted', approve: 'email approved', edit: 'email edited and approved',
  reject: 'email rejected', research_more: 'sent back for research', synced: 'queued to send', classified: 'reply read', handled: 'reply handled', analysed: 'meeting notes analysed',
  opened: 'opportunity opened', stage_changed: 'opportunity moved', deal_recorded: 'deal recorded', deal_updated: 'deal updated', marked_not_fit: 'marked not a fit', marked_research_further: 'sent back to research',
};
export const EVENT_ICON = (action: string): [keyof typeof Icon, string] =>
  /reply|classified|handled/.test(action) ? ['reply', 'g'] : /meeting|analysed/.test(action) ? ['calendar', 'p'] : /not_fit|suppressed|failed|reject|archived/.test(action) ? ['x', 'r']
  : /stage|deal|opened/.test(action) ? ['handshake', 'y'] : /follow_up/.test(action) ? ['checkCircle', 'c'] : /draft|approve|synced|edit/.test(action) ? ['mail', 'o'] : ['crm', 'c'];

export function OwnerSelect({ value, onChange, label = 'Owner', none = 'Nobody', byUsername }: { value: string; onChange: (v: string) => void; label?: string; none?: string; byUsername?: boolean }) {
  const team = useTeam();
  return <label className="field"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}><option value="">{none}</option>{team.map((u) => <option key={u.id} value={byUsername ? u.username : u.id}>{u.name}</option>)}</select></label>;
}

// add or edit a company; adding can also put it into a campaign, which starts outbound on it
export function CompanyForm({ c, campaigns, onClose, onSaved }: { c?: any; campaigns?: any[]; onClose: () => void; onSaved: (co: any) => void }) {
  const toast = useToast(); const me = useMe();
  const [f, setF] = useState({ name: c?.name ?? '', website: c?.website ?? c?.domain ?? '', industry: c?.industry ?? '', vertical: c?.vertical ?? '', city: c?.city ?? '', country: c?.country ?? 'IN', company_size: c?.company_size ?? '',
    owner_id: c ? c.owner_id ?? '' : me.id, campaign_code: '', note: '' });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    const body: any = { name: f.name, industry: f.industry, vertical: f.vertical, city: f.city, country: f.country, company_size: f.company_size, owner_id: f.owner_id || null };
    try {
      const r = c ? await api.patch(`/api/crm/companies/${c.id}`, { ...body, website: f.website }) : await api.post('/api/crm/companies', { ...body, website: f.website, campaign_code: f.campaign_code || undefined, note: f.note || undefined });
      toast(c ? 'Company saved.' : `Added ${r.name}.`); onSaved(r);
    } catch (x: any) { setErr(x.message); setBusy(false); }
  };
  return <Modal title={c ? `Edit ${c.name}` : 'Add a company'} onClose={onClose} wide><form className="col" onSubmit={submit}>
    {err && <div className="banner err" role="alert">{err}</div>}
    <div className="grid2">
      <label className="field"><span>Company name</span><input autoFocus required maxLength={160} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="field"><span>Website</span><input required={!c} maxLength={300} placeholder="acme.in" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} disabled={!!c && false} />
        {c && <small className="faint">The domain ({c.domain}) stays as it is: it is how outbound recognises the company.</small>}</label>
      <label className="field"><span>Industry</span><input maxLength={120} value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })} placeholder="Ecommerce" /></label>
      <label className="field"><span>Vertical</span><input maxLength={120} value={f.vertical} onChange={(e) => setF({ ...f, vertical: e.target.value })} placeholder="SME operations" /></label>
      <label className="field"><span>City</span><input maxLength={80} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></label>
      <label className="field"><span>Country (2 letters)</span><input maxLength={2} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })} /></label>
      <OwnerSelect value={f.owner_id} onChange={(v) => setF({ ...f, owner_id: v })} />
      {!c && <label className="field"><span>Campaign (optional)</span><select value={f.campaign_code} onChange={(e) => setF({ ...f, campaign_code: e.target.value })}><option value="">Not in outbound</option>{(campaigns ?? []).filter((x) => x.status === 'ACTIVE').map((x) => <option key={x.code} value={x.code}>{x.vertical} ({x.code})</option>)}</select>
        <small className="faint">{f.campaign_code ? 'It joins the campaign as new: outbound researches and scores it next.' : 'It stays out of outbound until you add it to a campaign.'}</small></label>}
    </div>
    {!c && <label className="field"><span>Note (optional)</span><textarea rows={2} maxLength={5000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="How we know them, who introduced us" /></label>}
    <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !f.name.trim()}>{busy && <Spinner />}{c ? 'Save company' : 'Add company'}</button></div>
  </form></Modal>;
}

// pick a company by typing; used where a contact or opportunity needs one
export function CompanyPicker({ value, onPick }: { value: { id: string; name: string } | null; onPick: (c: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState(''); const [hits, setHits] = useState<any[]>([]);
  useEffect(() => { if (q.trim().length < 2) { setHits([]); return; } const t = setTimeout(async () => { try { setHits((await api.get(`/api/crm/search?q=${encodeURIComponent(q)}`)).companies); } catch { setHits([]); } }, 220); return () => clearTimeout(t); }, [q]);
  if (value) return <div className="field"><span>Company</span><div className="picked"><b>{value.name}</b><button type="button" className="btn tiny ghost" onClick={() => onPick(null)}>Change</button></div></div>;
  return <div className="field picker"><label htmlFor="co-pick">Company</label><input id="co-pick" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a company name" autoComplete="off" />
    {hits.length > 0 && <ul className="pick-list" role="listbox" aria-label="Companies">{hits.map((h) => <li key={h.id}><button type="button" role="option" aria-selected="false" onClick={() => onPick({ id: h.id, name: h.name })}><CoMark name={h.name} size={22} />{h.name}<span className="faint">{h.domain}</span></button></li>)}</ul>}
    {q.trim().length >= 2 && !hits.length && <small className="faint">No company matches. Add the company first.</small>}</div>;
}

export function ContactForm({ company, p, onClose, onSaved }: { company?: { id: string; name: string } | null; p?: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const [co, setCo] = useState(company ?? null);
  const [f, setF] = useState({ full_name: p?.full_name ?? '', job_title: p?.job_title ?? '', email: p?.email ?? '', phone: p?.phone ?? '', linkedin_url: p?.linkedin_url ?? '', is_decision_maker: !!p?.is_decision_maker });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!p && !co) { setErr('Choose the company this person works at.'); return; } setErr(null); setBusy(true);
    try { if (p) await api.patch(`/api/crm/contacts/${p.id}`, f); else await api.post(`/api/crm/companies/${co!.id}/contacts`, f); toast(`Saved ${f.full_name}.`); onSaved(); }
    catch (x: any) { setErr(x.message); setBusy(false); }
  };
  return <Modal title={p ? `Edit ${p.full_name ?? 'contact'}` : 'Add a contact'} onClose={onClose} wide><form className="col" onSubmit={submit}>
    {err && <div className="banner err" role="alert">{err}</div>}
    {!p && <CompanyPicker value={co} onPick={setCo} />}
    <div className="grid2">
      <label className="field"><span>Name</span><input required minLength={2} maxLength={120} autoFocus={!!(p || company)} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></label>
      <label className="field"><span>Job title</span><input maxLength={120} value={f.job_title} onChange={(e) => setF({ ...f, job_title: e.target.value })} placeholder="Founder" /></label>
      <label className="field"><span>Email</span><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label className="field"><span>Phone</span><input type="tel" maxLength={40} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+91 98450 12345" /></label>
      <label className="field" style={{ gridColumn: '1 / -1' }}><span>LinkedIn</span><input maxLength={300} value={f.linkedin_url} onChange={(e) => setF({ ...f, linkedin_url: e.target.value })} placeholder="https://www.linkedin.com/in/…" /></label>
    </div>
    <label className="row" style={{ gap: 8 }}><input type="checkbox" className="check" checked={f.is_decision_maker} onChange={(e) => setF({ ...f, is_decision_maker: e.target.checked })} />Makes the decision</label>
    <p className="faint" style={{ fontSize: 12, margin: 0 }}>An email on the do-not-contact list, or already on another contact, is refused.</p>
    <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy && <Spinner />}{p ? 'Save' : 'Add contact'}</button></div>
  </form></Modal>;
}

export function OpportunityForm({ company, o, onClose, onSaved }: { company?: { id: string; name: string } | null; o?: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const me = useMe(); const [co, setCo] = useState(company ?? null);
  const [f, setF] = useState({ stage: o?.stage ?? 'REPLIED', value: toRupees(o?.value_paise), owner: o?.owner ?? me.user, expected_close: o?.expected_close ?? '', next_action: o?.next_action ?? '', next_action_on: o?.next_action_on ?? '', lost_reason: o?.lost_reason ?? '' });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!o && !co) return setErr('Choose the company.');
    const value_paise = toPaise(f.value); if (value_paise === 'invalid') return setErr('Write the value in rupees, like 1,50,000.');
    if (f.stage === 'LOST' && !f.lost_reason.trim()) return setErr('Say why it was lost; the weekly review learns from it.');
    setBusy(true);
    const body = { stage: f.stage, value_paise, owner: f.owner || null, expected_close: f.expected_close, next_action: f.next_action, next_action_on: f.next_action_on, ...(f.stage === 'LOST' ? { lost_reason: f.lost_reason } : {}) };
    try { if (o) await api.patch(`/api/crm/opportunities/${o.id}`, body); else await api.post(`/api/crm/companies/${co!.id}/opportunities`, body); toast(o ? 'Opportunity saved.' : 'Opportunity opened.'); onSaved(); }
    catch (x: any) { setErr(x.message); setBusy(false); }
  };
  return <Modal title={o ? `Opportunity: ${o.company ?? company?.name ?? ''}` : 'New opportunity'} onClose={onClose} wide><form className="col" onSubmit={submit}>
    {err && <div className="banner err" role="alert">{err}</div>}
    {!o && <CompanyPicker value={co} onPick={setCo} />}
    <div className="grid2">
      <label className="field"><span>Stage</span><select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>{Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="field"><span>Value, ₹ (INR)</span><input inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder="1,50,000" /></label>
      <OwnerSelect value={f.owner} onChange={(v) => setF({ ...f, owner: v })} byUsername />
      <label className="field"><span>Expected close</span><input type="date" value={f.expected_close} onChange={(e) => setF({ ...f, expected_close: e.target.value })} /></label>
      <label className="field"><span>Next action</span><input maxLength={300} value={f.next_action} onChange={(e) => setF({ ...f, next_action: e.target.value })} placeholder="Send the proposal" /></label>
      <label className="field"><span>Next action on</span><input type="date" value={f.next_action_on} onChange={(e) => setF({ ...f, next_action_on: e.target.value })} /></label>
    </div>
    {f.stage === 'LOST' && <label className="field"><span>Why it was lost</span><input required value={f.lost_reason} onChange={(e) => setF({ ...f, lost_reason: e.target.value })} placeholder="Chose another studio, no budget, went quiet" /></label>}
    <p className="faint" style={{ fontSize: 12, margin: 0 }}>Moving the stage also moves the company forward in outbound. Nothing is marked won unless you choose Won.</p>
    <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy && <Spinner />}{o ? 'Save' : 'Open opportunity'}</button></div>
  </form></Modal>;
}

export function FollowUpForm({ company, opportunityId, onClose, onSaved }: { company: { id: string; name: string }; opportunityId?: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const me = useMe();
  const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const [f, setF] = useState({ title: '', due_date: tomorrow, priority: 'MEDIUM', assignee_id: me.id }); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr(null);
    try { await api.post(`/api/crm/companies/${company.id}/follow-ups`, { ...f, assignee_id: f.assignee_id || null, opportunity_id: opportunityId }); toast('Follow-up added. It is on the assignee’s Today list too.'); onSaved(); } catch (x: any) { setErr(x.message); setBusy(false); } };
  return <Modal title={`Follow-up with ${company.name}`} onClose={onClose}><form className="col" onSubmit={submit}>
    {err && <div className="banner err" role="alert">{err}</div>}
    <label className="field"><span>What to do</span><input autoFocus required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Share the case study" /></label>
    <div className="grid2">
      <label className="field"><span>Due</span><input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></label>
      <label className="field"><span>Priority</span><select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option></select></label>
    </div>
    <OwnerSelect value={f.assignee_id} onChange={(v) => setF({ ...f, assignee_id: v })} label="For" />
    <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !f.title.trim()}>{busy && <Spinner />}Add follow-up</button></div>
  </form></Modal>;
}
export { Icon };
