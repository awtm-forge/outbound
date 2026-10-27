import { useMemo, useState } from 'react';
import { api } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useLoad } from '../ui/hooks.ts';
import { Icon, Dots } from '../ui/icons.tsx';
import { Menu, MenuItem } from '../ui/menu.tsx';
import { useToast } from '../ui/toast.tsx';
import { Failure, Loading, Spinner, ago, inr, pct, cardOpen, problemLabel, capLabel } from '../ui/kit.tsx';
import { Modal, useConfirm } from '../ui/overlay.tsx';
import { actorLabel } from '../ui/chrome.tsx';

const CAMPAIGN_STATUS: Record<string, string> = { ACTIVE: 'Active', DRAFT: 'Draft', PAUSED: 'Paused', STOPPED: 'Stopped' };
const SUPPRESS_SOURCE: Record<string, string> = { saleshandy_webhook: 'Saleshandy: bounce or unsubscribe', reply_classification: 'They asked to stop', demo: 'Demo data', discovery: 'Find companies' };
const DECISION: Record<string, string> = { STOP: 'Stop', CONTINUE: 'Keep going', SCALE: 'Scale up', TEST: 'Test a change', RESEARCH_MORE: 'Research more' };
// each card takes a tone in turn; the colour is decoration, the status is always written out
const TONES = ['255, 138, 42', '168, 85, 247', '56, 189, 248', '34, 197, 94', '244, 63, 94', '245, 158, 11'];
// decorative curves, as on Today's cards (DECISIONS-NEEDED #9): they do not plot data
const CURVES = ['M0 30 C12 30 18 24 28 26 S44 18 54 20 S70 8 80 2', 'M0 30 C14 28 20 30 30 24 S46 26 54 18 S70 14 80 4', 'M0 28 C10 30 20 22 30 26 S46 20 56 22 S70 10 80 3'];
const SORTS = [['name', 'Name'], ['found', 'Most companies found'], ['replies', 'Most replies'], ['newest', 'Newest first']] as const;
type Sort = (typeof SORTS)[number][0];
const LAYOUT_KEY = 'awtm-campaigns-layout';

export function Campaigns() {
  const toast = useToast(); const { go } = useRouter();
  const { data, error, loading, reload } = useLoad(() => api.get('/api/campaigns'));
  const [busy, setBusy] = useState(false); const [adding, setAdding] = useState(false);
  const [show, setShow] = useState('ALL'); const [term, setTerm] = useState(''); const [sort, setSort] = useState<Sort>('name');
  const [layout, setLayoutState] = useState<'grid' | 'list'>(() => { try { return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } });
  const setLayout = (l: 'grid' | 'list') => { setLayoutState(l); try { localStorage.setItem(LAYOUT_KEY, l); } catch { /* private mode */ } };
  const analyse = async () => { setBusy(true); try { await api.run('/api/analytics/weekly'); toast('Read the numbers again. Recommendations are updated.'); reload(true); } catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(false); } };
  const programmes: any[] = (data?.campaigns ?? []).filter((c: any) => c.config?.kind === 'programme');
  const all: any[] = (data?.campaigns ?? []).filter((c: any) => c.config?.kind !== 'programme');
  const list = useMemo(() => {
    const t = term.trim().toLowerCase();
    const l = all.map((c, i) => ({ ...c, tone: TONES[i % TONES.length] })).filter((c) => (show === 'ALL' || c.status === show) && (!t || `${c.code} ${c.vertical} ${c.offer} ${c.name}`.toLowerCase().includes(t)));
    const m = (c: any, k: string) => Number(c.metrics?.[k] ?? 0);
    return l.sort((a, b) => sort === 'found' ? m(b, 'accounts_found') - m(a, 'accounts_found') : sort === 'replies' ? m(b, 'replies') - m(a, 'replies') : sort === 'newest' ? String(b.created_at).localeCompare(String(a.created_at)) : String(a.vertical).localeCompare(String(b.vertical)));
  }, [all, show, term, sort]);
  if (loading && !data) return <Loading rows={5} />;
  if (error) return <Failure error={error} retry={reload} />;
  const active = all.filter((c) => c.status === 'ACTIVE').length;
  const date = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="dash-main">
      <div className="hero-row">
        <div className="hero-text"><p className="hero-eyebrow">{date}</p><h1>Campaigns</h1>
          <p className="lede">One market, one buyer, one problem, one offer each.</p>
          <p className="lede">Judged on replies, meetings and money, never on opens. Recommendations only: nothing here changes how much is sent.</p></div>
        <div className="quote-card"><span className="qm" aria-hidden="true">“</span><p>Focus on the right buyers. Let the replies decide the rest.</p></div>
        <div className="quota-card"><span className="qc-ic" aria-hidden="true"><Icon.campaigns size={20} /></span>
          <div className="qc-body"><span>{active} of {all.length} active</span>
            <span className="qc-bar" role="progressbar" aria-label="Campaigns active" aria-valuemin={0} aria-valuemax={all.length} aria-valuenow={active}><i style={{ width: `${all.length ? (active / all.length) * 100 : 0}%` }} /></span></div>
          <span className="qc-pct">{all.length ? Math.round((active / all.length) * 100) : 0}%</span></div>
        <button type="button" className="btn primary glow" onClick={() => setAdding(true)}><Icon.plus size={16} />New campaign</button>
        {adding && <CampaignForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(true); }} />}
      </div>

      {programmes.map((pr) => <Programme key={pr.code} p={pr} />)}
      <div className="panel toolbar camp-bar">
        <div className="chip-row" role="group" aria-label="Show">
          {['ALL', 'ACTIVE', 'PAUSED', 'DRAFT', 'STOPPED'].map((s) => { const n = s === 'ALL' ? all.length : all.filter((c) => c.status === s).length; return (s === 'ALL' || n > 0) &&
            <button key={s} type="button" className="filter-chip" aria-pressed={show === s} onClick={() => setShow(s)}>{s === 'ALL' ? 'All' : CAMPAIGN_STATUS[s]}<span className="n" aria-hidden="true">{n}</span></button>; })}
        </div>
        <label className="tb-search"><Icon.find size={15} /><input placeholder="Search campaigns" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search campaigns" /></label>
        <Menu label="Sort" className="btn tiny" button={<><Icon.funnel size={14} />Sort</>}>{(close) => <>
          {SORTS.map(([k, l]) => <MenuItem key={k} onSelect={() => { setSort(k); close(); }}><span className="mcheck" aria-hidden="true">{sort === k ? <Icon.check size={13} /> : null}</span>{l}<span className="sr">{sort === k ? ', current' : ''}</span></MenuItem>)}</>}</Menu>
        <button className="btn tiny" onClick={analyse} disabled={busy}>{busy ? <Spinner /> : <Icon.spark size={14} />}Read the numbers{data.analysed_at ? <span className="faint" style={{ fontWeight: 400 }}>last {ago(data.analysed_at)}</span> : null}</button>
        <div className="seg layout-seg" role="group" aria-label="Layout">
          <button type="button" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')} aria-label="Cards"><Icon.grid size={15} /></button>
          <button type="button" aria-pressed={layout === 'list'} onClick={() => setLayout('list')} aria-label="List"><Icon.list size={15} /></button>
        </div>
      </div>

      {!list.length ? <div className="panel" style={{ padding: 20 }}><p className="muted">{term ? `No campaign matches “${term}”.` : 'No campaigns with this status.'}</p></div>
        : layout === 'grid' ? <div className="camp-grid">{list.map((c) => <CampaignCard key={c.code} c={c} reload={() => reload(true)} />)}</div>
        : <section className="panel" aria-label="Campaigns"><div className="scrollx"><table className="ctable">
          <thead><tr><th>Campaign</th><th>Status</th><th className="num">Found</th><th className="num">Sent</th><th className="num">Replies</th><th className="num">Meetings</th><th>Recommendation</th><th><span className="sr">Open</span></th></tr></thead>
          <tbody>{list.map((c) => { const m = c.metrics ?? {}; return <tr key={c.code} className="click" onClick={() => go(`/pipeline?campaign=${c.code}&view=active`)}>
            <td><div className="c-name"><div><b>{c.vertical}</b><span className="mono">{c.code}</span></div></div></td><td><span className={`state ${c.status}`}>{CAMPAIGN_STATUS[c.status] ?? c.status}</span></td>
            <td className="num">{m.accounts_found ?? 0}</td><td className="num">{m.emails_sent ?? 0}</td><td className="num">{m.replies ?? 0}</td><td className="num">{m.meetings_booked ?? 0}</td>
            <td>{c.recommendation ? DECISION[c.recommendation.decision] ?? c.recommendation.decision : <span className="sub">None yet</span>}</td>
            <td onClick={(e) => e.stopPropagation()}><Link className="icon-btn" to={`/pipeline?campaign=${c.code}&view=active`} aria-label={`Open the companies in ${c.vertical}`}><Icon.arrow size={15} /></Link></td></tr>; })}</tbody></table></div></section>}
      <Suppression />
    </div>
  );
}

function CampaignCard({ c, reload }: { c: any; reload: () => void }) {
  const toast = useToast(); const { go } = useRouter(); const confirm = useConfirm();
  const m = c.metrics ?? {}; const r = c.recommendation; const [why, setWhy] = useState(false); const [editing, setEditing] = useState(false);
  const setStatus = async (status: string) => {
    if (status === 'STOPPED' && !(await confirm({ title: `Stop ${c.vertical}?`, body: 'Nothing more is sent for it. It can be made active again later.', confirm: 'Stop campaign', tone: 'danger' }))) return;
    try { await api.patch(`/api/campaigns/${c.code}`, { status }); toast(`${c.code} is now ${CAMPAIGN_STATUS[status]!.toLowerCase()}.`); reload(); } catch (e: any) { toast(e.message, { err: true }); }
  };
  const curve = CURVES[c.code.length % CURVES.length]!;
  const copy = async () => { try { await navigator.clipboard.writeText(c.code); toast(`Copied ${c.code}.`); } catch { toast('Could not copy. The browser blocked the clipboard.', { err: true }); } };
  return (
    <article className="camp" style={{ '--tone-rgb': c.tone } as React.CSSProperties} aria-labelledby={`camp-${c.code}`} {...cardOpen(`/pipeline?campaign=${c.code}&view=active`, go)}>
      <div className="camp-top"><span className="camp-code">{c.code}</span><span className={`state ${c.status}`}>{CAMPAIGN_STATUS[c.status] ?? c.status}</span>
        <Menu label={`Actions for ${c.vertical}`} className="icon-btn" button={<Dots vertical size={16} />}>{(close) => <>
          <MenuItem onSelect={() => { close(); go(`/pipeline?campaign=${c.code}&view=active`); }}><Icon.arrow size={15} />Open companies</MenuItem>
          <MenuItem onSelect={() => { close(); go(`/review`); }}><Icon.mail size={15} />Review emails</MenuItem>
          <MenuItem onSelect={() => { close(); copy(); }}><Icon.file size={15} />Copy campaign code</MenuItem>
          <MenuItem onSelect={() => { close(); setEditing(true); }}><Icon.edit size={15} />Edit campaign</MenuItem>
          {c.status === 'ACTIVE' ? <MenuItem onSelect={() => { close(); setStatus('PAUSED'); }}><Icon.check size={15} />Pause</MenuItem> : c.status !== 'STOPPED' ? <MenuItem onSelect={() => { close(); setStatus('ACTIVE'); }}><Icon.check size={15} />Make active</MenuItem> : null}
          {c.status !== 'STOPPED' ? <MenuItem onSelect={() => { close(); setStatus('STOPPED'); }}><Icon.shield size={15} />Stop</MenuItem> : <MenuItem onSelect={() => { close(); setStatus('ACTIVE'); }}><Icon.check size={15} />Make active again</MenuItem>}</>}</Menu>
        {editing && <CampaignForm c={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}</div>
      <div className="camp-head"><div><h2 id={`camp-${c.code}`}>{c.vertical}</h2><p>{c.offer}</p></div>
        <svg className="camp-curve" viewBox="0 0 80 32" preserveAspectRatio="none" aria-hidden="true"><path d={curve} /><circle cx="80" cy={curve.endsWith('2') ? 2 : curve.endsWith('4') ? 4 : 3} r="2" /></svg></div>
      <dl className="camp-nums">{([['Found', m.accounts_found], ['Sent', m.emails_sent], ['Replies', m.replies], ['Meetings', m.meetings_booked]] as const).map(([k, v]) =>
        <div key={k}><dt>{k}</dt><dd>{v ?? 0}</dd></div>)}</dl>
      {m.emails_sent ? <p className="camp-rates"><span title={m.reply_rate > 100 ? 'More replies than recorded sends, so the rate is not meaningful yet' : undefined}>Reply <b>{pct(m.reply_rate)}</b></span><span>Positive <b>{pct(m.positive_reply_rate)}</b></span><span>Bounce <b>{pct(m.bounce_rate)}</b></span><span>Won <b>{m.wins ?? 0}{m.wins ? ` · ${inr(m.revenue_paise)}` : ''}</b></span></p>
        : <p className="camp-rates faint">No emails sent yet, so there are no rates to show.</p>}
      {r ? <div className="camp-rec"><button type="button" className={`rec rec-${r.decision}`} aria-expanded={why} onClick={() => setWhy(!why)} title="Recommendation from the last read of the numbers">{DECISION[r.decision] ?? r.decision}<Icon.down size={13} /></button>
        {why && <p>{r.reason}{r.suggested_test ? ` ${r.suggested_test}` : ''}</p>}</div>
        : <div className="camp-rec"><span className="rec none">No recommendation yet</span></div>}
      <div className="camp-foot"><span className="camp-sender"><Icon.globe size={14} />{c.sender ?? 'No sender set'}</span><span className="faint">{c.country}</span>
        <Link to={`/pipeline?campaign=${c.code}&view=active`} className="camp-go" aria-label={`Open the companies in ${c.vertical}`}><Icon.arrow size={16} /></Link></div>
    </article>
  );
}

function Suppression() {
  const toast = useToast(); const { data, reload } = useLoad(() => api.get<any[]>('/api/suppression'));
  const [v, setV] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [all, setAll] = useState(false);
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); const val = v.trim().toLowerCase(); if (!val) return; setBusy(true);
    try { const r = await api.post('/api/suppression', val.includes('@') ? { email: val, reason: reason || 'manual' } : { domain: val.replace(/^https?:\/\/(www\.)?/, '').split('/')[0], reason: reason || 'manual' }); toast(r.already ? 'Already on the list.' : `Added to the list. ${r.prospects_affected} ${r.prospects_affected === 1 ? 'company' : 'companies'} stopped.`); setV(''); setReason(''); reload(true); }
    catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(false); }
  };
  // the list as a spreadsheet file, made in the browser from what is loaded
  const exportCsv = () => {
    const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const csv = ['email_or_domain,reason,added_by,since', ...(data ?? []).map((s) => [s.email ?? s.domain, s.reason, SUPPRESS_SOURCE[s.source] ?? actorLabel(s.source), s.created_at].map(esc).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'do-not-contact.csv'; a.click(); URL.revokeObjectURL(a.href);
  };
  const rows = data ?? []; const shown = all ? rows : rows.slice(0, 8);
  return (
    <section className="panel dnc" aria-labelledby="dnc-h">
      <div className="dnc-head"><span className="dnc-ic" aria-hidden="true"><Icon.shield size={20} /></span>
        <div><h2 id="dnc-h">Do not contact</h2><p>Anyone here is never written to again, in any campaign. Unsubscribes and hard bounces land here on their own. Nothing is ever taken off automatically.</p></div>
        <button type="button" className="btn tiny" onClick={exportCsv} disabled={!rows.length}><Icon.down size={14} />Export</button></div>
      <form className="dnc-form" onSubmit={add}>
        <label className="ff"><span className="sr">Email or domain</span><span className="ff-in"><Icon.mail size={16} /><input placeholder="name@company.com or company.com" value={v} onChange={(e) => setV(e.target.value)} required aria-label="Email or domain" /></span></label>
        <label className="ff"><span className="sr">Reason (optional)</span><span className="ff-in"><Icon.edit size={16} /><input placeholder="Reason, for example asked us to stop" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason (optional)" /></span></label>
        <button className="btn primary glow" disabled={busy}>{busy ? <Spinner /> : <Icon.plus size={16} />}Add to the list</button></form>
      {data && (rows.length > 0 ? <><div className="scrollx"><table className="ctable"><thead><tr><th>Email or domain</th><th>Reason</th><th>Added by</th><th>Since</th></tr></thead>
        <tbody>{shown.map((s) => <tr key={s.id}><td className="mono" style={{ fontSize: 12.5, overflowWrap: 'anywhere', color: 'var(--ink)' }}>{s.email ?? s.domain}</td><td>{s.reason === 'manual' ? <span className="sub">No reason given</span> : s.reason}</td><td className="sub">{SUPPRESS_SOURCE[s.source] ?? actorLabel(s.source)}</td><td className="sub" style={{ whiteSpace: 'nowrap' }}>{ago(s.created_at)}</td></tr>)}</tbody></table></div>
        {rows.length > 8 && <button type="button" className="feed-more" onClick={() => setAll(!all)} aria-expanded={all}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>}</>
        : <p className="dnc-note">Nobody is on the list yet.</p>)}
    </section>
  );
}

const DOMAINS = ['WEB', 'PRODUCT', 'BRAND'];
const PROBLEMS = ['WEBSITE', 'CONVERSION', 'UX', 'SEO', 'ANALYTICS', 'PRODUCT', 'MVP', 'ENGINEERING', 'AUTOMATION', 'AI', 'BRAND', 'OTHER'];
// Add or edit a campaign. Programmes never reach this form: their card has no menu.
function CampaignForm({ c, onClose, onSaved }: { c?: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ code: c?.code ?? '', name: c?.name ?? '', country: c?.country ?? 'IN', service_domain: c?.service_domain ?? 'WEB', vertical: c?.vertical ?? '', problem: c?.problem ?? 'CONVERSION', offer: c?.offer ?? '',
    buyer_titles: (c?.buyer_titles ?? []).join(', '), sender: c?.sender ?? '', unsubscribe_text: c?.compliance?.unsubscribe_text ?? "Reply 'no' and I will not write again.", cta: c?.config?.cta ?? 'Worth sending them over?', max_words: String(c?.config?.max_words ?? 110), status: c?.status ?? 'ACTIVE' });
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    const body = { name: f.name, country: f.country, service_domain: f.service_domain, vertical: f.vertical, problem: f.problem, offer: f.offer, buyer_titles: f.buyer_titles.split(',').map((t: string) => t.trim()).filter(Boolean), sender: f.sender || null,
      compliance: { ...(c?.compliance ?? {}), country: f.country, unsubscribe_text: f.unsubscribe_text }, config: { ...(c?.config ?? {}), cta: f.cta, max_words: Number(f.max_words) }, status: f.status };
    try { if (c) await api.patch(`/api/campaigns/${c.code}`, body); else await api.post('/api/campaigns', { ...body, code: f.code }); toast(c ? 'Campaign saved.' : `Added ${f.code.toUpperCase()}.`); onSaved(); }
    catch (x: any) { setErr(x.message); setBusy(false); }
  };
  const field = (label: string, k: keyof typeof f, props: Record<string, unknown> = {}) => <label className="field"><span>{label}</span><input value={f[k]} onChange={(e) => set(k, e.target.value)} {...props} /></label>;
  return <Modal title={c ? `Edit ${c.code}` : 'New campaign'} onClose={onClose} wide><form className="col" onSubmit={submit}>
    {err && <div className="banner err" role="alert">{err}</div>}
    <div className="grid2">
      {c ? <label className="field"><span>Code</span><input value={f.code} disabled /></label> : field('Code', 'code', { required: true, autoFocus: true, placeholder: 'IND-WEB-SAAS', pattern: '[A-Za-z0-9]+(-[A-Za-z0-9]+)*', maxLength: 40, style: { textTransform: 'uppercase' } })}
      {field('Name', 'name', { required: true, maxLength: 160, placeholder: 'India / Web / SaaS' })}
      {field('Vertical', 'vertical', { required: true, maxLength: 120, placeholder: 'SaaS' })}
      {field('Country (2 letters)', 'country', { required: true, maxLength: 2, minLength: 2, style: { textTransform: 'uppercase' } })}
      <label className="field"><span>Service</span><select value={f.service_domain} onChange={(e) => set('service_domain', e.target.value)}>{DOMAINS.map((d) => <option key={d} value={d}>{capLabel(d)}</option>)}</select></label>
      <label className="field"><span>Problem</span><select value={f.problem} onChange={(e) => set('problem', e.target.value)}>{PROBLEMS.map((d) => <option key={d} value={d}>{problemLabel(d)}</option>)}</select></label>
      {field('Sender', 'sender', { type: 'email', placeholder: 'ayush@awtmforge.com' })}
      <label className="field"><span>Status</span><select value={f.status} onChange={(e) => set('status', e.target.value)}>{Object.entries(CAMPAIGN_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    </div>
    {field('Offer', 'offer', { required: true, maxLength: 300, placeholder: 'Short product and onboarding review' })}
    {field('Buyer titles, separated by commas', 'buyer_titles', { placeholder: 'Founder, CEO, Head of Product' })}
    <div className="grid2">
      {field('Call to action', 'cta', { required: true, maxLength: 200 })}
      {field('Max words', 'max_words', { type: 'number', min: 30, max: 400, required: true })}
    </div>
    {field('Unsubscribe line', 'unsubscribe_text', { required: true, maxLength: 300 })}
    <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy && <Spinner />}{c ? 'Save campaign' : 'Add campaign'}</button></div>
  </form></Modal>;
}

// A programme card: what the feeder run is doing and its live numbers. It sends nothing itself.
function Programme({ p }: { p: any }) {
  const s = p.programme ?? {}; const cfg = p.config ?? {};
  const n = (k: string) => Number(s[k] ?? 0); const pctOf = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '');
  const stat = (label: string, v: number, sub?: string) => <div key={label}><div className="kick">{label}</div><div className="num" style={{ fontSize: 'var(--fs-4)', fontWeight: 700 }}>{v}</div>{sub && <div className="sub">{sub}</div>}</div>;
  return (
    <div className="panel col" style={{ gap: 'var(--s-4)', padding: 20, borderColor: 'var(--accent-line)', background: 'linear-gradient(180deg, #24180f 0%, var(--surface) 60%)' }}>
      <div className="row between wrap"><div><div className="kick ember">{p.code} · programme</div><div style={{ fontWeight: 700, fontSize: 'var(--fs-3)', marginTop: 6 }}>{p.name}</div></div>
        <div className="row"><span className="tag ember">feeds {n('campaigns_fed')} campaigns</span><span className="tag">target {cfg.target ?? '?'}{cfg.next_target ? `, then ${cfg.next_target}` : ''}</span>{s.started_at && <span className="faint mono" style={{ fontSize: 11 }}>since {ago(s.started_at)}</span>}</div></div>
      <p className="muted">{p.offer}</p>
      {Array.isArray(cfg.stages) && <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6, fontSize: 'var(--fs-0)' }} className="muted">{cfg.stages.map((x: string) => <li key={x}>{x}</li>)}</ol>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--s-3)' }}>
        {stat('Found', n('companies'))}{stat('Screened', n('screened'), pctOf(n('screened'), n('companies')))}{stat('Strong fit', n('strong'), pctOf(n('strong'), n('screened')))}
        {stat('Reachable', n('reachable'), `email ${n('with_email')}, phone ${n('with_phone')}`)}{stat('Researched', n('researched'))}{stat('Qualified', n('qualified'))}{stat('Person found', n('with_person'))}{stat('Drafts', n('drafted'))}
      </div>
      <div className="row wrap faint" style={{ fontSize: 'var(--fs-0)' }}><span>Claude spend so far: ${(Number(s.spend_micros ?? 0) / 1e6).toFixed(2)}</span>{s.last_activity && <span>· last activity {ago(s.last_activity)}</span>}<Link className="btn sm ghost right" to="/pipeline?view=active">Open pipeline <Icon.arrow size={14} /></Link></div>
    </div>
  );
}
