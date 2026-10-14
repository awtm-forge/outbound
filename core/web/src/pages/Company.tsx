import { useState } from 'react';
import { api } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useLoad } from '../ui/hooks.ts';
import { Icon, Dots } from '../ui/icons.tsx';
import { Menu, MenuItem } from '../ui/menu.tsx';
import { useConfirm } from '../ui/overlay.tsx';
import { useToast } from '../ui/toast.tsx';
import { Empty, Failure, Skeleton, Spinner, ago, classLabel, dayLabel, inr, isLate, statusLabel, toPaise, toRupees } from '../ui/kit.tsx';
import { Crumbs, actorLabel } from '../ui/chrome.tsx';
import { useTeam } from '../session.tsx';
import { STAGE, useLostReason } from './Crm.tsx';
import { EVENT as PROSPECT_EVENT } from './Prospect.tsx';
import { PROJECT_STATUS } from './Projects.tsx';
import { CoMark, CompanyForm, ContactForm, EVENT, EVENT_ICON, FollowUpForm, OpportunityForm, OutStatus, PersonDot, StagePill, siteUrl } from './crm/shared.tsx';
import { SaleshandyPanel } from './outreach/Prospects.tsx';

const RESEARCH: Record<string, string> = { ACCOUNT: 'Company research', WEBSITE: 'Website audit', PROBLEM: 'Problem we saw', CAPABILITY: 'How we can help', DECISION_MAKER: 'Decision maker search' };
// the readable parts of a research finding: its sentences and short lists, nothing invented around them
const readable = (d: any): [string, string][] => Object.entries(d ?? {}).flatMap(([k, v]): [string, string][] => {
  const label = k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  if (typeof v === 'string' && v.length > 2 && v !== 'UNKNOWN') return [[label, v]];
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string')) return [[label, (v as string[]).slice(0, 5).join(' · ')]];
  return [];
}).slice(0, 6);

export function Company({ id }: { id: string }) {
  const toast = useToast(); const ask = useConfirm(); const team = useTeam(); const { go } = useRouter();
  const { data, error, loading, reload } = useLoad<any>(() => api.get(`/api/crm/companies/${id}`), [id]);
  const camps = useLoad<any>(() => api.get('/api/campaigns'));
  const [modal, setModal] = useState<{ kind: string; x?: any } | null>(null); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  if (loading && !data) return <div className="dash-main"><Skeleton h={90} /><Skeleton h={400} /></div>;
  if (error) return <div className="dash-main"><Crumbs items={[{ to: '/crm', label: 'CRM' }, { label: 'Company' }]} /><Failure error={error} retry={reload} /></div>;
  const c = data; const url = siteUrl(c); const p = c.prospects[0]; const ref = { id: c.id, name: c.name };
  const done = () => { setModal(null); reload(true); };
  const addNote = async (e: React.FormEvent) => {
    e.preventDefault(); if (!note.trim()) return; setBusy(true);
    try { await api.post(`/api/crm/companies/${id}/notes`, { text: note }); setNote(''); toast('Note added.'); reload(true); } catch (x: any) { toast(x.message, { err: true }); } finally { setBusy(false); }
  };
  const patch = async (body: object, msg: string) => { try { await api.patch(`/api/crm/companies/${id}`, body); toast(msg); reload(true); } catch (x: any) { toast(x.message, { err: true }); } };
  const status = async (s: string) => { try { await api.post(`/api/crm/companies/${id}/status`, { status: s }); toast(`Outbound status: ${statusLabel(s)}.`); reload(true); } catch (x: any) { toast(x.message, { err: true }); } };
  const finish = async (t: any) => { try { await api.patch(`/api/tasks/${t.id}`, { status: t.status === 'DONE' ? 'TODO' : 'DONE' }); reload(true); } catch (x: any) { toast(x.message, { err: true }); } };
  const openFu = c.follow_ups.filter((t: any) => t.status !== 'DONE');
  return (
    <div className="dash-main co-page">
      <Crumbs items={[{ to: '/crm', label: 'CRM' }, { label: c.name }]} />
      <div className="co-hero panel">
        <CoMark name={c.name} size={60} />
        <div className="co-id">
          <h1>{c.name}{c.archived_at && <span className="ostat none">Archived</span>}</h1>
          <div className="co-tags">{url && <a href={url} target="_blank" rel="noopener noreferrer" className="co-tag link"><Icon.globe size={13} />{c.domain}<Icon.out size={11} /></a>}
            {c.industry && <span className="co-tag">{c.industry}</span>}{c.vertical && <span className="co-tag">{c.vertical}</span>}{[c.city, c.country].filter(Boolean).length > 0 && <span className="co-tag"><Icon.home size={12} />{[c.city, c.country].filter(Boolean).join(', ')}</span>}
            {c.platform && <span className="co-tag">{c.platform}</span>}{c.company_size && <span className="co-tag">{c.company_size} people</span>}</div>
        </div>
        <div className="co-facts">
          <div><span>Outbound</span><OutStatus s={p?.status} /></div>
          <div><span>Campaign</span>{p?.campaign ? <Link to={`/pipeline?campaign=${p.campaign}`} className="camp-tag2">{p.campaign}</Link> : <b className="sub">None</b>}</div>
          <label><span>Owner</span><select value={c.owner_id ?? ''} onChange={(e) => patch({ owner_id: e.target.value || null }, 'Owner changed.')} aria-label="Owner"><option value="">Nobody</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        </div>
        <div className="co-actions">
          <button className="btn tiny" onClick={() => setModal({ kind: 'edit' })}><Icon.edit size={14} />Edit</button>
          <button className="btn tiny" onClick={() => setModal({ kind: 'contact' })}><Icon.user size={14} />Add contact</button>
          <button className="btn tiny" onClick={() => setModal({ kind: 'follow' })}><Icon.calendar size={14} />Follow-up</button>
          <button className="btn tiny primary" onClick={() => setModal({ kind: 'opp' })}><Icon.plus size={14} />Opportunity</button>
          <Menu label="More actions" className="icon-btn" place="left" button={<Dots vertical size={16} />}>{(close) => <>
            <MenuItem onSelect={() => { close(); document.getElementById('note-box')?.focus(); }}><Icon.edit size={15} />Add note</MenuItem>
            {url && <MenuItem onSelect={() => { close(); window.open(url, '_blank', 'noopener'); }}><Icon.out size={15} />Open website</MenuItem>}
            {p?.campaign && <MenuItem onSelect={() => { close(); go(`/pipeline?campaign=${p.campaign}`); }}><Icon.campaigns size={15} />View campaign</MenuItem>}
            {p && <MenuItem onSelect={() => { close(); go(`/prospects/${p.id}`); }}><Icon.pipeline size={15} />Open in pipeline</MenuItem>}
            {p && p.status !== 'REJECTED' && <MenuItem onSelect={() => { close(); status('REJECTED'); }}><Icon.x size={15} />Mark not a fit</MenuItem>}
            {p && p.status !== 'RESEARCH_FURTHER' && <MenuItem onSelect={() => { close(); status('RESEARCH_FURTHER'); }}><Icon.find size={15} />Send back to research</MenuItem>}
            <div className="menu-sep" />
            {c.archived_at ? <MenuItem onSelect={() => { close(); patch({ archived: false }, 'Restored.'); }}><Icon.redo size={15} />Restore</MenuItem>
              : <MenuItem onSelect={async () => { close(); if (await ask({ title: `Archive ${c.name}?`, body: 'It leaves the CRM lists. Outbound, deals and history are untouched.', confirm: 'Archive' })) patch({ archived: true }, 'Archived.'); }}><Icon.archive size={15} />Archive</MenuItem>}</>}</Menu>
        </div>
      </div>

      <div className="co-grid">
        <div className="co-main">
          <section className="panel co-sec" aria-labelledby="op-h"><div className="panel-head"><h2 id="op-h"><span className="ic"><Icon.handshake size={18} /></span>Opportunities</h2>
            <button className="btn tiny right" onClick={() => setModal({ kind: 'opp' })} style={{ marginLeft: 'auto' }}><Icon.plus size={13} />New</button></div>
            {c.opportunities.length ? c.opportunities.map((o: any) => <Opportunity key={o.id} o={o} company={c.name} reload={() => reload(true)} onEdit={() => setModal({ kind: 'oppedit', x: { ...o, company: c.name } })} />) : <p className="co-empty">No opportunities yet. Open one when a conversation starts.</p>}
          </section>
          <section className="panel co-sec" aria-labelledby="rs-h"><div className="panel-head"><h2 id="rs-h"><span className="ic"><Icon.sparkle size={18} /></span>Research and website audit</h2></div>
            {c.research.length ? <div className="rs-grid">{c.research.map((r: any) => { const items = readable(r.data); return <div key={r.kind} className="rs-card"><b>{RESEARCH[r.kind] ?? r.kind}</b><small>{ago(r.created_at)}{r.confidence != null ? ` · confidence ${Math.round(Number(r.confidence) * 100)}%` : ''}</small>
              {items.length ? <dl>{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : <p className="faint">Nothing readable in this finding.</p>}</div>; })}</div>
              : <p className="co-empty">{p ? 'Not researched yet. Outbound researches companies in a campaign.' : 'Not in outbound, so not researched. Add it to a campaign to research it.'}</p>}
            {p?.specific_observation && p.specific_observation !== 'UNKNOWN' && <p className="obs"><b>What we saw:</b> {p.specific_observation}</p>}
          </section>
          <section className="panel co-sec" aria-labelledby="em-h"><div className="panel-head"><h2 id="em-h"><span className="ic"><Icon.mail size={18} /></span>Emails and replies</h2></div>
            {c.emails.length ? <ul className="em-list">{c.emails.map((e: any) => <li key={e.kind + e.id}><span className={`f-ic tone-${e.kind === 'reply' ? 'g' : 'o'}`} aria-hidden="true">{e.kind === 'reply' ? <Icon.reply size={13} /> : <Icon.mail size={13} />}</span>
              <div><b>{e.subject || '(no subject)'}</b><small>{e.kind === 'reply' ? `Reply · ${classLabel(e.classification)}` : `Our email · ${({ PENDING_APPROVAL: 'waiting for review', APPROVED: 'approved', REJECTED: 'rejected', RESEARCH_MORE: 'sent back for research', SENT_TO_SEQUENCER: 'sent' } as any)[e.status] ?? e.status}`}</small></div>
              <span className="when">{ago(e.at_time)}</span></li>)}</ul> : <p className="co-empty">No emails yet.</p>}
          </section>
          <section className="panel co-sec" aria-labelledby="nt-h"><div className="panel-head"><h2 id="nt-h"><span className="ic"><Icon.edit size={18} /></span>Notes</h2></div>
            <form className="note-form" onSubmit={addNote}><textarea id="note-box" className="textarea" rows={2} aria-label="New note" placeholder="What happened, what was said, what is next" value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} />
              <button className="btn tiny primary" disabled={busy || !note.trim()}>{busy && <Spinner />}Add note</button></form>
            {c.notes.map((n: any) => <div key={n.id} className="comment sm"><PersonDot name={actorLabel(n.actor)} /><div><div className="who-line"><b>{actorLabel(n.actor)}</b><span className="faint">{ago(n.created_at)}</span></div><p className="prose">{n.text}</p></div></div>)}
          </section>
        </div>
        <aside className="co-side">
          <section className="panel rpanel" aria-labelledby="pp-h"><div className="rp-head"><Icon.people size={17} /><h2 id="pp-h">People</h2><button className="btn tiny" style={{ marginLeft: 'auto' }} onClick={() => setModal({ kind: 'contact' })}><Icon.plus size={12} />Add</button></div>
            {c.contacts.length ? <ul className="pp-list">{c.contacts.map((x: any) => <li key={x.id}><PersonDot name={x.full_name ?? x.email ?? '?'} /><div><b>{x.full_name ?? 'No name'}{x.is_decision_maker && <span className="decides">Decides</span>}</b>
              <span>{x.job_title ?? ''}</span>{x.email && <a href={`mailto:${x.email}`}>{x.email}</a>}{x.phone && <a href={`tel:${x.phone.replace(/[^\d+]/g, '')}`}>{x.phone}</a>}</div>
              <button className="icon-btn" onClick={() => setModal({ kind: 'cedit', x })} aria-label={`Edit ${x.full_name ?? 'contact'}`}><Icon.edit size={14} /></button></li>)}</ul> : <Empty title="Nobody yet">Add the person who decides.</Empty>}</section>
          <section className="panel rpanel" aria-labelledby="fu2-h"><div className="rp-head"><Icon.calendar size={17} /><h2 id="fu2-h">Follow-ups</h2><button className="btn tiny" style={{ marginLeft: 'auto' }} onClick={() => setModal({ kind: 'follow' })}><Icon.plus size={12} />Add</button></div>
            {c.follow_ups.length ? <ul className="fu-list">{c.follow_ups.map((t: any) => { const late = t.status !== 'DONE' && isLate(t.due_date); return <li key={t.id} className={late ? 'late' : t.status === 'DONE' ? 'isdone' : ''}>
              <button type="button" className={`fu-check${t.status === 'DONE' ? ' on' : ''}`} onClick={() => finish(t)} aria-pressed={t.status === 'DONE'} aria-label={`${t.status === 'DONE' ? 'Reopen' : 'Mark done'}: ${t.title}`}><Icon.check size={12} /></button>
              <div className="fu-body"><span>{t.title}</span><small>{t.due_date ? (late ? `Late, ${dayLabel(t.due_date)}` : dayLabel(t.due_date)) : 'No date'}{t.assignee_name ? ` · ${t.assignee_name}` : ''}</small></div></li>; })}</ul>
              : <p className="rp-empty">None yet.</p>}{openFu.length > 0 && <p className="rp-foot">They are on each person’s Today list too.</p>}</section>
          {c.meetings.length > 0 && <section className="panel rpanel" aria-labelledby="mt-h"><div className="rp-head"><Icon.calendar size={17} /><h2 id="mt-h">Meetings</h2></div>
            <ul className="em-list">{c.meetings.map((m: any) => <li key={m.id}><span className="f-ic tone-p" aria-hidden="true"><Icon.calendar size={13} /></span><div><b>{m.scheduled_at ? new Date(m.scheduled_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Time not set'}</b><small>{m.held ? 'Held' : 'Not held yet'}</small></div></li>)}</ul>
            <Link to="/deals" className="link-accent rp-more">Meetings and deals <Icon.arrow size={13} /></Link></section>}
          {c.projects.length > 0 && <section className="panel rpanel" aria-labelledby="pj-h"><div className="rp-head"><Icon.projects size={17} /><h2 id="pj-h">Projects</h2></div>
            <ul className="em-list">{c.projects.map((x: any) => <li key={x.id}><Link to={`/projects/${x.id}`}><b>{x.name}</b></Link><small className="right">{PROJECT_STATUS[x.status]}</small></li>)}</ul></section>}
          <section className="panel rpanel" aria-labelledby="ac-h"><div className="rp-head"><Icon.clock size={17} /><h2 id="ac-h">Activity</h2></div>
            {c.activity.length ? <ul className="ra-feed">{c.activity.slice(0, 15).map((a: any, i: number) => { const [ic, tone] = EVENT_ICON(a.action); const I = Icon[ic]; return <li key={i}><span className={`f-ic tone-${tone}`} aria-hidden="true"><I size={13} /></span>
              <span>{(EVENT[a.action] ?? PROSPECT_EVENT[a.action]?.toLowerCase() ?? a.action.replace(/_/g, ' ')).replace(/^./, (x: string) => x.toUpperCase())} <span className="faint">by {actorLabel(a.actor)}</span></span><small>{ago(a.created_at)}</small></li>; })}</ul>
              : <p className="rp-empty">Nothing has happened here yet.</p>}</section>
          <SaleshandyPanel companyId={c.id} />
        </aside>
      </div>
      {modal?.kind === 'edit' && <CompanyForm c={c} campaigns={camps.data?.campaigns} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === 'contact' && <ContactForm company={ref} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === 'cedit' && <ContactForm p={modal.x} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === 'opp' && <OpportunityForm company={ref} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === 'oppedit' && <OpportunityForm o={modal.x} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === 'follow' && <FollowUpForm company={ref} onClose={() => setModal(null)} onSaved={done} />}
    </div>
  );
}

function Opportunity({ o, company, reload, onEdit }: { o: any; company: string; reload: () => void; onEdit: () => void }) {
  const toast = useToast(); const lostReason = useLostReason(); const [dealOpen, setDealOpen] = useState(false);
  const patch = async (body: object, msg: string) => { try { await api.patch(`/api/crm/opportunities/${o.id}`, body); toast(msg); reload(); } catch (e: any) { toast(e.message, { err: true }); } };
  const setStage = async (stage: string) => { if (stage === 'LOST') { const r = await lostReason(company); if (!r) return; return patch({ stage, lost_reason: r }, 'Marked lost.'); } patch({ stage }, `Moved to ${STAGE[stage]}.`); };
  return (
    <div className="opp-card">
      <div className="opp-top"><StagePill s={o.stage} /><b className="deal-v">{o.value_paise ? inr(o.value_paise) : 'No value set'}</b>
        <select value={o.stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">{Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn tiny" onClick={onEdit}><Icon.edit size={13} />Edit</button></div>
      <dl className="opp-dl"><div><dt>Expected close</dt><dd className={o.expected_close && isLate(o.expected_close) && !['WON', 'LOST'].includes(o.stage) ? 'late' : ''}>{o.expected_close ? dayLabel(o.expected_close) : 'Not set'}</dd></div>
        <div><dt>Next action</dt><dd>{o.next_action ? `${o.next_action}${o.next_action_on ? `, ${dayLabel(o.next_action_on)}` : ''}` : 'None'}</dd></div>
        <div><dt>Owner</dt><dd>{o.owner ? actorLabel(o.owner) : 'Nobody'}</dd></div><div><dt>Meetings</dt><dd>{o.meetings}</dd></div></dl>
      {o.stage === 'LOST' && o.lost_reason && <p className="muted">Lost: {o.lost_reason}</p>}
      {o.deal ? <div className="deal-box"><div><small>Signed{o.deal.signed_at ? ` ${dayLabel(o.deal.signed_at)}` : ''} · {o.deal.status.charAt(0) + o.deal.status.slice(1).toLowerCase()}</small><b>{inr(o.deal.revenue_paise)}</b><small>Cost {inr(o.deal.cost_paise)} · gross profit {inr(o.deal.gross_profit_paise)}</small></div>
        <button className="btn tiny" onClick={() => setDealOpen(!dealOpen)} aria-expanded={dealOpen}>Update the deal</button></div>
        : o.stage === 'WON' && !dealOpen && <button className="btn tiny" onClick={() => setDealOpen(true)}>Record the signed deal</button>}
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
  return <form className="col deal-form" onSubmit={save}><div className="grid2">
    <label className="field"><span>Revenue, ₹</span><input inputMode="decimal" required value={f.revenue} onChange={(e) => setF({ ...f, revenue: e.target.value })} /></label>
    <label className="field"><span>Our cost, ₹</span><input inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></label>
    <label className="field"><span>Status</span><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{['OPEN', 'DELIVERING', 'COMPLETE', 'CANCELLED'].map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select></label>
    <label className="field"><span>Signed on</span><input type="date" value={f.signed_at} onChange={(e) => setF({ ...f, signed_at: e.target.value })} /></label>
  </div><div className="row"><button className="btn tiny primary">Save deal</button><button type="button" className="btn tiny ghost" onClick={onDone}>Cancel</button></div></form>;
}
