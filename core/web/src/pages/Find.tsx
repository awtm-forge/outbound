import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useLoad } from '../ui/hooks.ts';
import { Icon, Dots } from '../ui/icons.tsx';
import { Menu, MenuItem } from '../ui/menu.tsx';
import { useToast } from '../ui/toast.tsx';
import { Badge, Empty, Failure, Loading, Skeleton, Spinner, ago, statusLabel } from '../ui/kit.tsx';
import { countsBus } from '../App.tsx';

const TECH = ['', 'Shopify', 'WooCommerce', 'WordPress', 'Wix', 'Framer', 'Webflow', 'Magento'];
const KIND: Record<string, string> = { ARTICLE: 'Article, not a company', AGENCY: 'Agency', PLATFORM: 'Platform' };
const SOURCE: Record<string, string> = { mock: 'Simulated', serper: 'Serper', google_cse: 'Google' };
const SIG: [string, (s: any) => boolean][] = [['No viewport', (s) => s?.has_viewport_meta === false], ['No call to action', (s) => s?.cta_texts?.length === 0], ['No trust signals', (s) => s?.trust_signals?.length === 0], ['No meta description', (s) => s?.description === false]];
type Q = { industry: string; location: string; technology: string; keywords: string; pages: number };
const BLANK: Q = { industry: '', location: 'India', technology: '', keywords: '', pages: 2 };
// starting points that fill the form; nothing runs until Search is pressed, because every search spends quota
const IDEAS: { label: string; icon: keyof typeof Icon; q: Partial<Q> }[] = [
  { label: 'SaaS companies in India', icon: 'layers', q: { industry: 'SaaS company', location: 'India' } }, { label: 'Ecommerce brands', icon: 'globe', q: { industry: 'ecommerce brand', keywords: 'buy online' } },
  { label: 'Fitness & wellness', icon: 'target', q: { industry: 'fitness and wellness brand' } }, { label: 'DTC brands', icon: 'send', q: { industry: 'direct to consumer brand', keywords: 'shop now' } },
  { label: 'Real estate companies', icon: 'home', q: { industry: 'real estate developer' } }, { label: 'Digital agencies', icon: 'chip', q: { industry: 'digital marketing agency' } },
];
const QUICK: { label: string; icon: keyof typeof Icon; industry: string }[] = [
  { label: 'SaaS', icon: 'layers', industry: 'SaaS company' }, { label: 'Ecommerce', icon: 'globe', industry: 'ecommerce brand' }, { label: 'Agency', icon: 'send', industry: 'digital agency' },
  { label: 'Healthcare', icon: 'shield', industry: 'healthcare clinic' }, { label: 'Fintech', icon: 'chart', industry: 'fintech company' }, { label: 'EdTech', icon: 'wiki', industry: 'edtech company' },
];
const title = (q: any) => [q.industry, q.keywords].filter(Boolean).join(', ') || 'Search';
const subtitle = (q: any) => [q.keywords && q.industry ? null : null, q.technology && `on ${q.technology}`, q.keywords].filter(Boolean).join(' · ');
const when = (ts: string) => new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// saved searches live in this browser only; there is no server-side store for them yet
const SAVED_KEY = 'awtm-saved-searches';
type Saved = { id: string; name: string; q: Q };
const readSaved = (): Saved[] => { try { return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]'); } catch { return []; } };
const writeSaved = (l: Saved[]) => { try { localStorage.setItem(SAVED_KEY, JSON.stringify(l.slice(0, 20))); } catch { /* private mode */ } };

export function Find() {
  const { search, go } = useRouter(); const toast = useToast();
  const id = search.get('s');
  const quota = useLoad(() => api.get('/api/discovery/quota'));
  const history = useLoad(() => api.get<any[]>('/api/discovery/searches'));
  const stats = useLoad(() => api.get('/api/discovery/stats'));
  const [q, setQ] = useState<Q>(BLANK);
  const [running, setRunning] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved[]>(readSaved); const [allEarlier, setAllEarlier] = useState(false);
  const what = useRef<HTMLInputElement>(null); const formRef = useRef<HTMLFormElement>(null);
  const fill = (x: Partial<Q>, note?: string) => { setQ({ ...BLANK, ...x }); setErr(null); formRef.current?.scrollIntoView({ block: 'nearest' }); what.current?.focus(); if (note) toast(note); };
  const run = async (e?: React.FormEvent) => {
    e?.preventDefault(); if (!q.industry.trim() && !q.keywords.trim()) { setErr('Say what the companies sell, or add extra keywords.'); what.current?.focus(); return; }
    setRunning(true); setErr(null);
    try { const s = await api.post('/api/discovery/searches', { ...q, technology: q.technology || undefined, keywords: q.keywords || undefined }); go(`/find?s=${s.id}`); history.reload(true); quota.reload(true); stats.reload(true); }
    catch (x: any) { setErr(x.message); } finally { setRunning(false); }
  };
  const save = (s: any) => { const n: Saved = { id: s.id, name: title(s.query), q: { ...BLANK, ...s.query, technology: s.query.technology ?? '', keywords: s.query.keywords ?? '' } };
    const l = [n, ...saved.filter((x) => x.id !== s.id)]; setSaved(l); writeSaved(l); toast(`Saved “${n.name}”. It is kept in this browser.`); };
  const unsave = (sid: string) => { const l = saved.filter((x) => x.id !== sid); setSaved(l); writeSaved(l); toast('Removed from saved searches.'); };
  const qd = quota.data; const pct = qd ? Math.min(100, Math.round((qd.used_today / Math.max(1, qd.daily_quota)) * 100)) : 0;
  const earlier: any[] = history.data ?? []; const shownEarlier = allEarlier ? earlier : earlier.slice(0, 5);
  return (
    <div className="dash">
      <div className="dash-main">
        <div className="hero-row">
          <div className="hero-text"><p className="hero-eyebrow">Company discovery</p><h1>Find <em>companies</em></h1>
            <p className="lede">Say what they sell and where. We open every site and show what it runs on, how to reach them, and what looks broken.</p></div>
          <div className="quota-card" title={qd ? `Each page of 10 sites counts as one search. Results come from ${SOURCE[qd.source] ?? qd.source}.` : undefined}>
            <span className="qc-ic" aria-hidden="true"><Icon.crm size={20} /></span>
            <div className="qc-body"><span>{qd ? `${qd.used_today} of ${qd.daily_quota} searches today` : 'Searches today'}</span>
              <span className="qc-bar" role="progressbar" aria-label="Searches used today" aria-valuemin={0} aria-valuemax={qd?.daily_quota ?? 100} aria-valuenow={qd?.used_today ?? 0}><i style={{ width: `${pct}%` }} /></span></div>
            <span className="qc-pct">{pct}%</span>
          </div>
        </div>
        <form ref={formRef} className="panel find-form" onSubmit={run} aria-labelledby="find-h">
          <div className="panel-head"><h2 id="find-h"><span className="ic"><Icon.find size={20} /></span>Search for companies</h2>
            <div className="right"><span className="meta">Results from {qd ? SOURCE[qd.source] ?? qd.source : '…'}</span>
              <button type="button" className="btn tiny" onClick={() => document.getElementById('saved-h')?.scrollIntoView({ block: 'center' })}><Icon.wiki size={14} />Saved ({saved.length})</button></div></div>
          <div className="find-fields">
            <label className="ff ff-what"><span className="ff-label">What they sell</span><span className="ff-in"><Icon.find size={16} /><input ref={what} value={q.industry} onChange={(e) => setQ({ ...q, industry: e.target.value })} placeholder="e.g. wireless earbuds brand, fitness app, digital agency" autoFocus={!id} aria-describedby={err ? 'find-err' : undefined} /></span></label>
            <label className="ff"><span className="ff-label">Where</span><span className="ff-in"><Icon.home size={16} /><input value={q.location} onChange={(e) => setQ({ ...q, location: e.target.value })} placeholder="India, Bengaluru" list="find-places" /></span></label>
            <label className="ff"><span className="ff-label">Runs on</span><span className="ff-in"><Icon.layers size={16} /><select value={q.technology} onChange={(e) => setQ({ ...q, technology: e.target.value })}>{TECH.map((t) => <option key={t} value={t.toLowerCase()}>{t || 'Any platform'}</option>)}</select></span></label>
            <label className="ff"><span className="ff-label">Extra keywords</span><span className="ff-in"><Icon.edit size={16} /><input value={q.keywords} onChange={(e) => setQ({ ...q, keywords: e.target.value })} placeholder="buy online" /></span></label>
            <label className="ff ff-pages"><span className="ff-label">Pages</span><span className="ff-in"><Icon.file size={16} /><select value={q.pages} onChange={(e) => setQ({ ...q, pages: Number(e.target.value) })} aria-label="Pages">{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{`${n * 10} sites`}</option>)}</select></span></label>
            <button className="btn primary glow find-go" disabled={running}>{running ? <Spinner /> : <Icon.find size={16} />}{running ? 'Searching' : 'Search'}</button>
          </div>
          <datalist id="find-places">{['India', 'Bengaluru', 'Mumbai', 'Delhi NCR', 'Pune', 'Hyderabad', 'Chennai', 'United States', 'United Kingdom', 'UAE'].map((p) => <option key={p} value={p} />)}</datalist>
          {err && <div className="banner err" role="alert" id="find-err" style={{ margin: '0 16px 12px' }}>{err}</div>}
          {running && <div className="loading-line" role="status" style={{ margin: '0 16px 12px' }}><Spinner />Searching, then opening each site to read its platform and contact details. This takes 10 to 30 seconds.</div>}
          <div className="ideas"><span className="ideas-label">Try a search</span><div className="ideas-row">{IDEAS.map((x) => { const I = Icon[x.icon]; return <button key={x.label} type="button" className="idea" onClick={() => fill(x.q)}><I size={14} />{x.label}</button>; })}</div></div>
        </form>
        {id ? <Results id={id} key={id} /> : <>
          <FindStats data={stats.data} />
          <section className="panel" aria-labelledby="earlier-h">
            <div className="panel-head"><h2 id="earlier-h"><span className="ic"><Icon.clock size={20} /></span>Earlier searches</h2>
              {earlier.length > 5 && <div className="right"><button type="button" className="btn tiny" onClick={() => setAllEarlier(!allEarlier)} aria-expanded={allEarlier}>{allEarlier ? 'Show fewer' : 'View all'} <Icon.arrow size={14} /></button></div>}</div>
            {history.loading && !history.data ? <div className="col" style={{ padding: '0 16px 16px' }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={40} />)}</div>
              : history.error ? <div style={{ padding: '0 16px 16px' }}><Failure error={history.error} retry={history.reload} /></div>
              : !earlier.length ? <div style={{ padding: '0 16px 12px' }}><Empty title="Start with one search">Try “wireless earbuds brand” in India on Shopify. Narrow words find better companies than broad ones.</Empty></div>
              : <div className="scrollx"><table className="ctable">
                <thead><tr><th>Search query</th><th>Location</th><th>Source</th><th className="num">Companies</th><th>When</th><th><span className="sr">Actions</span></th></tr></thead>
                <tbody>{shownEarlier.map((s) => { const isSaved = saved.some((x) => x.id === s.id); return (
                  <tr key={s.id} className="click" onClick={() => go(`/find?s=${s.id}`)}>
                    <td><div className="c-name"><div><Link to={`/find?s=${s.id}`} onClick={(e) => e.stopPropagation()} style={{ textDecoration: 'none' }}><b>{s.query.industry || s.query.keywords}</b></Link><span>{subtitle(s.query) || 'Any platform'}</span></div></div></td>
                    <td>{s.query.location || 'Anywhere'}</td><td><span className="src-tag">{SOURCE[s.source] ?? s.source}</span></td>
                    <td className="num">{s.result_count}</td><td style={{ whiteSpace: 'nowrap' }}>{when(s.created_at)}</td>
                    <td onClick={(e) => e.stopPropagation()}><div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      <button type="button" className="btn tiny" onClick={() => fill({ ...s.query, technology: s.query.technology ?? '', keywords: s.query.keywords ?? '' }, 'The form is filled in. Press Search to run it again.')}><Icon.redo size={14} />Use again</button>
                      <Menu label={`Actions for ${title(s.query)}`} className="icon-btn" button={<Dots vertical size={16} />}>{(close) => <>
                        <MenuItem onSelect={() => { close(); go(`/find?s=${s.id}`); }}><Icon.arrow size={15} />Open results</MenuItem>
                        <MenuItem onSelect={() => { close(); isSaved ? unsave(s.id) : save(s); }}><Icon.wiki size={15} />{isSaved ? 'Remove from saved' : 'Save search'}</MenuItem></>}</Menu></div></td>
                  </tr>); })}</tbody></table></div>}
          </section>
        </>}
      </div>
      <aside className="dash-rail" aria-label="Search helpers">
        <section className="panel" aria-labelledby="saved-h">
          <div className="panel-head"><h2 id="saved-h"><span className="ic"><Icon.wiki size={18} /></span>Saved searches</h2>{saved.length > 0 && <span className="meta" style={{ marginLeft: 'auto' }}>In this browser</span>}</div>
          {saved.length ? <ul className="saved-list">{saved.map((x) => <li key={x.id}>
            <button type="button" className="saved-go" onClick={() => fill(x.q, 'The form is filled in. Press Search to run it.')}><span className="sv-ic" aria-hidden="true"><Icon.find size={15} /></span><span className="sv-txt"><b>{x.name}</b><span>{[x.q.location, x.q.technology].filter(Boolean).join(' · ') || 'Anywhere'}</span></span></button>
            <Menu label={`Actions for ${x.name}`} className="icon-btn" button={<Dots vertical size={16} />}>{(close) => <>
              <MenuItem onSelect={() => { close(); fill(x.q); }}><Icon.redo size={15} />Use</MenuItem>
              <MenuItem onSelect={() => { close(); go(`/find?s=${x.id}`); }}><Icon.arrow size={15} />Open last results</MenuItem>
              <MenuItem onSelect={() => { close(); unsave(x.id); }}><Icon.x size={15} />Remove</MenuItem></>}</Menu>
          </li>)}</ul> : <p className="task-empty" style={{ borderTop: 0, paddingTop: 0 }}>Save a search from Earlier searches with its menu, and it waits here. Saved searches are kept in this browser.</p>}
        </section>
        <section className="panel" aria-labelledby="quick-h">
          <div className="panel-head" style={{ paddingBottom: 4 }}><h2 id="quick-h"><span className="ic"><Icon.funnel size={18} /></span>Quick filters</h2></div>
          <p className="rail-sub">Fill in what they sell in one tap</p>
          <div className="quick quick6">{QUICK.map((x) => { const I = Icon[x.icon]; return <button key={x.label} type="button" className="quick-tile" onClick={() => fill({ ...q, industry: x.industry })}><I size={18} />{x.label}</button>; })}</div>
        </section>
        <section className="panel ai-finder" aria-labelledby="aif-h">
          <div className="assist-head"><span style={{ color: 'var(--accent)', display: 'flex' }}><Icon.bolt size={18} /></span><h2 id="aif-h">AI Company Finder</h2><span className="beta">BETA</span></div>
          <p>Describe your ideal customer and let AI find the best companies for you.</p>
          <button type="button" className="btn sm outline-accent" aria-disabled="true" aria-describedby="aif-note"><Icon.bolt size={14} />Try AI Company Finder</button>
          <span id="aif-note" className="aif-note">Not available yet. Today the search above finds companies, and AI researches and scores each one you add to the pipeline.</span>
        </section>
      </aside>
    </div>
  );
}

function FindStats({ data }: { data?: any }) {
  const cards: { tone: string; icon: keyof typeof Icon; n?: number; wk?: number; label: string }[] = [
    { tone: 'orange', icon: 'crm', n: data?.companies_found, wk: data?.companies_found_7d, label: 'Companies found' },
    { tone: 'purple', icon: 'globe', n: data?.sites_analysed, wk: data?.sites_analysed_7d, label: 'Websites analysed' },
    { tone: 'cyan', icon: 'layers', n: data?.platforms_detected, wk: data?.platforms_detected_7d, label: 'Platforms detected' },
    { tone: 'green', icon: 'mail', n: data?.emails_found, wk: data?.emails_found_7d, label: 'Contact emails found' },
  ];
  return (
    <section className="kpis kpis4" aria-label="What searches have found so far">
      {cards.map((k, i) => { const I = Icon[k.icon]; return (
        <div key={k.label} className={`kpi stat ${k.tone}`}>
          <span className="k-ic"><I size={26} /></span>
          <span className="k-n">{data ? k.n : <Skeleton h={28} w={48} />}</span>
          <span className="k-l">{k.label}</span>
          {data && k.wk ? <span className="k-week">+{k.wk} this week</span> : null}
          <svg className="k-spark" viewBox="0 0 120 26" preserveAspectRatio="none" aria-hidden="true"><path d={['M0 22 C14 22 22 21 34 21 S56 17 66 18 S90 12 100 9 S114 6 120 1', 'M0 23 C16 23 26 22 38 22 S58 19 70 16 S92 8 104 7 S116 3 120 1', 'M0 22 C18 22 28 21 40 21 S60 18 72 19 S92 14 102 13 S114 8 120 4', 'M0 23 C14 23 26 22 40 22 S62 20 74 19 S94 13 106 10 S116 6 120 3'][i]} stroke="currentColor" strokeWidth="1.6" fill="none" vectorEffect="non-scaling-stroke" /></svg>
        </div>); })}
    </section>
  );
}

function Results({ id }: { id: string }) {
  const toast = useToast(); const { go } = useRouter();
  const { data, error, loading, reload } = useLoad(() => api.get(`/api/discovery/searches/${id}`), [id]);
  const camps = useLoad(() => api.get('/api/campaigns'));
  const [sel, setSel] = useState<Set<string>>(new Set()); const [campaign, setCampaign] = useState(''); const [busy, setBusy] = useState(false);
  const [show, setShow] = useState<'all' | 'new' | 'reach'>('all');
  const rows: any[] = data?.candidates ?? [];
  useEffect(() => { // pre-select what is probably a real company in India we have not added yet
    setSel(new Set(rows.filter((r) => r.status === 'NEW' && r.enriched_at && (r.signals?.kind ?? 'COMPANY') === 'COMPANY' && r.country_guess === 'IN').map((r) => r.id)));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = (camps.data?.campaigns ?? []).filter((c: any) => c.status === 'ACTIVE' && c.config?.kind !== 'programme'); // a programme feeds campaigns; companies are not added to it directly
  useEffect(() => { if (!campaign && active.length && data) { /* wait for both, or the default ignores the search */ const w = String(data?.query?.industry ?? '').toLowerCase().split(/\W+/).filter((x) => x.length > 3); setCampaign((active.find((c: any) => w.some((x) => c.vertical.toLowerCase().includes(x))) ?? active[0]).code); } }, [active.length, data]); // eslint-disable-line
  const visible = useMemo(() => rows.filter((r) => show === 'all' || (show === 'new' ? r.status === 'NEW' : r.emails.length > 0 || r.phones.length > 0)), [rows, show]);
  const toggle = (rid: string) => setSel((s) => { const n = new Set(s); n.has(rid) ? n.delete(rid) : n.add(rid); return n; });
  const add = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/discovery/candidates/add', { candidate_ids: [...sel], campaign_code: campaign, run_chain: true });
      const ok = r.added.filter((x: any) => x.prospect_id); const queued = ok.filter((x: any) => x.chain?.queued).length;
      toast(queued ? `Added ${ok.length} to the pipeline. Each is researched in turn, about a minute apiece, and leaves Researching when done.` : `Added ${ok.length} to the pipeline.`, { action: { label: 'Open pipeline', run: () => go(`/pipeline?campaign=${campaign}`) } });
      setSel(new Set()); reload(true); countsBus.dispatchEvent(new Event('changed'));
    } catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(false); }
  };
  if (loading && !data) return <Loading kind="table" rows={6} />;
  if (error) return <Failure error={error} retry={reload} />;
  const qd = data.query;
  return (
    <section className="panel" aria-labelledby="res-h">
      <div className="panel-head">
        <div><button type="button" className="link-accent" onClick={() => go('/find')}><Icon.back size={14} />All searches</button>
          <h2 id="res-h" style={{ marginTop: 4 }}>{title(qd)}</h2>
          <p className="meta" style={{ marginTop: 4 }}>{[qd.location, qd.technology && `on ${qd.technology}`].filter(Boolean).join(' · ')} · {rows.length} companies · {ago(data.created_at)}{data.cached ? ' · from an earlier run, no search spent' : ''}</p></div>
        <div className="right" role="group" aria-label="Show">
          {([['all', 'Everything', rows.length], ['new', 'Not added yet', rows.filter((r) => r.status === 'NEW').length], ['reach', 'Has contact details', rows.filter((r) => r.emails.length || r.phones.length).length]] as const).map(([k, l, n]) =>
            <button key={k} type="button" className="filter-chip" aria-pressed={show === k} onClick={() => setShow(k)}>{l} ({n})</button>)}
        </div>
      </div>
      {!rows.length ? <div style={{ padding: '0 16px 16px' }}><Empty title="No companies matched">Try fewer words, or drop the platform filter. The platform is checked on each site, so a strict filter can remove most results.</Empty></div> :
      <div className="scrollx"><table className="t stack ctable">
        <thead><tr><th style={{ width: 36 }}><input type="checkbox" className="check" aria-label="Select all" checked={visible.length > 0 && visible.every((r) => sel.has(r.id) || r.status !== 'NEW')} onChange={(e) => setSel(e.target.checked ? new Set(visible.filter((r) => r.status === 'NEW').map((r) => r.id)) : new Set())} /></th>
          <th>Company</th><th>Runs on</th><th>How to reach them</th><th>Where, size</th><th>What looks broken</th><th>Status</th></tr></thead>
        <tbody>{visible.map((r) => { const kind = r.signals?.kind ?? 'COMPANY'; const added = r.status === 'ADDED'; const name: string = r.display_name ?? r.domain;
          return <tr key={r.id} className={sel.has(r.id) ? 'sel' : ''}>
            <td data-label="Select"><input type="checkbox" className="check" aria-label={`Select ${r.domain}`} disabled={added} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
            <td data-label="Company" style={{ minWidth: 220 }}><div style={{ fontWeight: 600, color: 'var(--ink)' }}>{name}</div><a className="sub" href={r.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>{r.domain} <Icon.out size={11} /><span className="sr"> (opens in a new tab)</span></a>
              <div className="signals" style={{ marginTop: 6 }}>{kind !== 'COMPANY' && <Badge tone="warning">{KIND[kind]}</Badge>}{!r.enriched_at && <Badge>Site did not load</Badge>}</div></td>
            <td data-label="Runs on">{r.platform ? <span className="tag">{r.platform}</span> : <span className="sub">Not detected</span>}<div className="sub" style={{ marginTop: 6 }}>{r.platform_signals.filter((p: string) => p !== r.platform).join(', ')}</div></td>
            <td data-label="Reach" style={{ minWidth: 220 }}>{r.emails.slice(0, 2).map((e: string) => <span key={e} className="contactline">{e}</span>)}{r.phones.slice(0, 1).map((p: string) => <span key={p} className="contactline mono faint" style={{ fontSize: 12 }}>{p}</span>)}
              {!r.emails.length && !r.phones.length && <span className="sub">Nothing public</span>}
              <div className="row" style={{ gap: 10, marginTop: 6, fontSize: 'var(--fs-0)' }}>{r.linkedin_url && <a href={r.linkedin_url} target="_blank" rel="noreferrer" className="faint">LinkedIn</a>}{r.instagram_url && <a href={r.instagram_url} target="_blank" rel="noreferrer" className="faint">Instagram</a>}
                <a href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(name + ' founder')}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-text)' }}>Find the founder</a></div></td>
            <td data-label="Where, size"><span>{r.country_guess === 'IN' ? 'India' : 'Not known'}</span><div className="sub">{({ SMALL: 'Small site', MID: 'Mid-sized', LARGE_CATALOGUE: 'Large catalogue' } as any)[r.size_estimate] ?? ''}</div>{r.gstin && <div className="sub mono">GST {r.gstin}</div>}</td>
            <td data-label="Looks broken"><div className="signals">{SIG.filter(([, f]) => f(r.signals)).map(([l]) => <Badge key={l} tone="warning">{l}</Badge>)}{!SIG.some(([, f]) => f(r.signals)) && r.enriched_at && <span className="sub">Nothing obvious</span>}</div></td>
            <td data-label="Status">{added ? <Badge tone="success">In pipeline</Badge> : r.status === 'IGNORED' ? <Badge>Ignored</Badge> : <span className="sub">Not added</span>}{added && r.prospect_status && <div className="sub" style={{ marginTop: 6 }}>{statusLabel(r.prospect_status)}{r.account_score != null ? ` · score ${r.account_score}` : ''}</div>}</td>
          </tr>; })}</tbody></table></div>}
      {sel.size > 0 && <div className="actionbar" role="region" aria-label="Add selected">
        <b>{sel.size} selected</b><span className="muted">Add to</span>
        <select className="input" value={campaign} onChange={(e) => setCampaign(e.target.value)} aria-label="Campaign">{active.map((c: any) => <option key={c.code} value={c.code}>{c.vertical || c.code}</option>)}</select>
        <span className="faint" style={{ fontSize: 'var(--fs-0)' }}>Each one is researched and scored in the background, about a minute each.</span>
        <button className="btn ghost right" onClick={() => setSel(new Set())}>Clear</button>
        <button className="btn primary" onClick={add} disabled={busy || !campaign}>{busy ? <Spinner /> : <Icon.plus size={16} />}{busy ? 'Adding' : 'Add to pipeline'}</button>
      </div>}
    </section>
  );
}
