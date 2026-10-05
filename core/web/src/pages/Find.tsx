import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useLoad } from '../ui/hooks.ts';
import { Icon } from '../ui/icons.tsx';
import { useToast } from '../ui/toast.tsx';
import { Empty, Failure, Spinner, ago, statusLabel } from '../ui/kit.tsx';
import { countsBus } from '../App.tsx';

const TECH = ['', 'Shopify', 'WooCommerce', 'WordPress', 'Wix', 'Framer', 'Webflow', 'Magento'];
const KIND: Record<string, string> = { ARTICLE: 'Article, not a company', AGENCY: 'Agency', PLATFORM: 'Platform' };
const SIG: [string, (s: any) => boolean][] = [['No viewport', (s) => s?.has_viewport_meta === false], ['No call to action', (s) => s?.cta_texts?.length === 0], ['No trust signals', (s) => s?.trust_signals?.length === 0], ['No meta description', (s) => s?.description === false]];

export function Find() {
  const { search, go } = useRouter();
  const id = search.get('s');
  const quota = useLoad(() => api.get('/api/discovery/quota'));
  const history = useLoad(() => api.get<any[]>('/api/discovery/searches'));
  const [q, setQ] = useState({ industry: '', location: 'India', technology: '', keywords: '', pages: 2 });
  const [running, setRunning] = useState(false); const [err, setErr] = useState<string | null>(null);
  const run = async (e?: React.FormEvent) => {
    e?.preventDefault(); if (!q.industry.trim() && !q.keywords.trim()) { setErr('Say what the companies sell, or add keywords.'); return; }
    setRunning(true); setErr(null);
    try { const s = await api.post('/api/discovery/searches', { ...q, technology: q.technology || undefined, keywords: q.keywords || undefined }); go(`/find?s=${s.id}`); history.reload(true); quota.reload(true); }
    catch (e: any) { setErr(e.message); } finally { setRunning(false); }
  };
  return (
    <div className="page">
      <div className="head"><div><h1>Find companies</h1><p>Say what they sell and where. We search, open every site ourselves, and show you what each one runs on, how to reach them, and what looks broken.</p></div>
        {quota.data && <span className="tag" title="Each page of 10 sites is one search">{quota.data.used_today} of {quota.data.daily_quota} searches today · {quota.data.source}</span>}</div>
      <form className="card searchbar" onSubmit={run}>
        <label className="field"><span>What they sell</span><input value={q.industry} onChange={(e) => setQ({ ...q, industry: e.target.value })} placeholder="wireless earbuds brand" autoFocus={!id} /></label>
        <label className="field"><span>Where</span><input value={q.location} onChange={(e) => setQ({ ...q, location: e.target.value })} placeholder="India, Bengaluru" /></label>
        <label className="field"><span>Runs on</span><select value={q.technology} onChange={(e) => setQ({ ...q, technology: e.target.value })}>{TECH.map((t) => <option key={t} value={t.toLowerCase()}>{t || 'Any platform'}</option>)}</select></label>
        <label className="field"><span>Extra words</span><input value={q.keywords} onChange={(e) => setQ({ ...q, keywords: e.target.value })} placeholder="buy online" /></label>
        <label className="field"><span>Pages</span><select value={q.pages} onChange={(e) => setQ({ ...q, pages: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} · {n * 10}</option>)}</select></label>
        <button className="btn primary lg go" disabled={running}>{running ? <Spinner /> : <Icon.find size={16} />}{running ? 'Searching' : 'Search'}</button>
      </form>
      {err && <div className="banner err" role="alert">{err}</div>}
      {running && <div className="card loading-line"><Spinner />Searching, then opening each site to read its platform and contact details. This takes 10 to 30 seconds.</div>}
      {id ? <Results id={id} key={id} /> : <div className="section"><h2 className="section-title">Earlier searches</h2>
        {history.data?.length ? <div className="card flush"><table className="t"><thead><tr><th>Search</th><th>Source</th><th className="num">Companies</th><th>When</th></tr></thead>
          <tbody>{history.data.map((s) => <tr key={s.id} className="click" onClick={() => go(`/find?s=${s.id}`)}><td><Link to={`/find?s=${s.id}`} style={{ fontWeight: 600, textDecoration: 'none' }}>{[s.query.industry, s.query.keywords].filter(Boolean).join(', ')}</Link><div className="sub">{[s.query.location, s.query.technology].filter(Boolean).join(' · ')}</div></td>
            <td><span className="tag">{s.source}</span></td><td className="num">{s.result_count}</td><td className="sub">{ago(s.created_at)}</td></tr>)}</tbody></table></div>
          : <div className="card"><Empty title="Start with one search">Try "wireless earbuds brand" in India on Shopify. Narrow words find better companies than broad ones.</Empty></div>}</div>}
    </div>
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
  const active = (camps.data?.campaigns ?? []).filter((c: any) => c.status === 'ACTIVE');
  useEffect(() => { if (!campaign && active.length && data) { /* wait for both, or the default ignores the search */ const w = String(data?.query?.industry ?? '').toLowerCase().split(/\W+/).filter((x) => x.length > 3); setCampaign((active.find((c: any) => w.some((x) => c.vertical.toLowerCase().includes(x))) ?? active[0]).code); } }, [active.length, data]); // eslint-disable-line
  const visible = useMemo(() => rows.filter((r) => show === 'all' || (show === 'new' ? r.status === 'NEW' : r.emails.length > 0 || r.phones.length > 0)), [rows, show]);
  const toggle = (rid: string) => setSel((s) => { const n = new Set(s); n.has(rid) ? n.delete(rid) : n.add(rid); return n; });
  const add = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/discovery/candidates/add', { candidate_ids: [...sel], campaign_code: campaign, run_chain: true });
      const ok = r.added.filter((x: any) => x.prospect_id); const queued = ok.filter((x: any) => x.chain?.queued).length;
      toast(queued ? `${ok.length} added. Researching them one at a time, about a minute each. They move out of Researching in the pipeline as they finish.` : `${ok.length} added.`, { action: { label: 'Open pipeline', run: () => go(`/pipeline?campaign=${campaign}`) } });
      setSel(new Set()); reload(true); countsBus.dispatchEvent(new Event('changed'));
    } catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(false); }
  };
  if (loading && !data) return <div className="card loading-line"><Spinner />Loading results</div>;
  if (error) return <Failure error={error} retry={reload} />;
  const qd = data.query;
  return (
    <section className="section">
      <div className="row between wrap">
        <div><button className="btn sm ghost" onClick={() => go('/find')}><Icon.back size={14} />All searches</button>
          <h2 style={{ fontSize: 'var(--fs-4)', marginTop: 8 }}>{[qd.industry, qd.keywords].filter(Boolean).join(', ')}</h2>
          <p className="muted" style={{ marginTop: 4 }}>{[qd.location, qd.technology && `on ${qd.technology}`].filter(Boolean).join(' · ')} · {rows.length} companies · {ago(data.created_at)}{data.cached ? ' · from an earlier run, no search spent' : ''}</p></div>
        <div className="chips" role="group" aria-label="Show">
          {([['all', 'Everything', rows.length], ['new', 'Not added yet', rows.filter((r) => r.status === 'NEW').length], ['reach', 'Has contact details', rows.filter((r) => r.emails.length || r.phones.length).length]] as const).map(([k, l, n]) =>
            <button key={k} className={`chip${show === k ? ' on' : ''}`} onClick={() => setShow(k)}>{l} <span className="c">{n}</span></button>)}
        </div>
      </div>
      {!rows.length ? <div className="card"><Empty title="No companies matched">Try fewer words, or drop the platform filter. The platform is checked on each site, so a strict filter can remove most results.</Empty></div> :
      <div className="card flush scrollx"><table className="t">
        <thead><tr><th style={{ width: 36 }}><input type="checkbox" className="check" aria-label="Select all" checked={visible.length > 0 && visible.every((r) => sel.has(r.id) || r.status !== 'NEW')} onChange={(e) => setSel(e.target.checked ? new Set(visible.filter((r) => r.status === 'NEW').map((r) => r.id)) : new Set())} /></th>
          <th>Company</th><th>Runs on</th><th>How to reach them</th><th>Where, size</th><th>What looks broken</th><th>Status</th></tr></thead>
        <tbody>{visible.map((r) => { const kind = r.signals?.kind ?? 'COMPANY'; const added = r.status === 'ADDED'; const name: string = r.display_name ?? r.domain;
          return <tr key={r.id} className={sel.has(r.id) ? 'sel' : ''}>
            <td><input type="checkbox" className="check" aria-label={`Select ${r.domain}`} disabled={added} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
            <td style={{ minWidth: 220 }}><div style={{ fontWeight: 600 }}>{name}</div><a className="sub" href={r.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>{r.domain} <Icon.out size={11} /></a>
              <div className="signals" style={{ marginTop: 6 }}>{kind !== 'COMPANY' && <span className="tag warn">{KIND[kind]}</span>}{!r.enriched_at && <span className="tag dim">Site did not load</span>}</div></td>
            <td>{r.platform ? <span className="tag">{r.platform}</span> : <span className="sub">Not detected</span>}<div className="sub" style={{ marginTop: 6 }}>{r.platform_signals.filter((p: string) => p !== r.platform).join(', ')}</div></td>
            <td style={{ minWidth: 220 }}>{r.emails.slice(0, 2).map((e: string) => <span key={e} className="contactline">{e}</span>)}{r.phones.slice(0, 1).map((p: string) => <span key={p} className="contactline mono faint" style={{ fontSize: 12 }}>{p}</span>)}
              {!r.emails.length && !r.phones.length && <span className="sub">Nothing public</span>}
              <div className="row" style={{ gap: 10, marginTop: 6, fontSize: 'var(--fs-0)' }}>{r.linkedin_url && <a href={r.linkedin_url} target="_blank" rel="noreferrer" className="faint">LinkedIn</a>}{r.instagram_url && <a href={r.instagram_url} target="_blank" rel="noreferrer" className="faint">Instagram</a>}
                <a href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(name + ' founder')}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Find the founder</a></div></td>
            <td><span>{r.country_guess === 'IN' ? 'India' : 'Unknown'}</span><div className="sub">{({ SMALL: 'Small site', MID: 'Mid-sized', LARGE_CATALOGUE: 'Large catalogue' } as any)[r.size_estimate] ?? ''}</div>{r.gstin && <div className="sub mono">GST {r.gstin}</div>}</td>
            <td><div className="signals">{SIG.filter(([, f]) => f(r.signals)).map(([l]) => <span key={l} className="tag ember">{l}</span>)}{!SIG.some(([, f]) => f(r.signals)) && r.enriched_at && <span className="sub">Nothing obvious</span>}</div></td>
            <td>{added ? <span className="tag solid">In pipeline</span> : r.status === 'IGNORED' ? <span className="tag dim">Ignored</span> : <span className="sub">Not added</span>}{added && r.prospect_status && <div className="sub" style={{ marginTop: 6 }}>{statusLabel(r.prospect_status)}{r.account_score != null ? ` · ${r.account_score}` : ''}</div>}</td>
          </tr>; })}</tbody></table></div>}
      {sel.size > 0 && <div className="actionbar" role="region" aria-label="Add selected">
        <b>{sel.size} selected</b><span className="muted">Add to</span>
        <select className="input" value={campaign} onChange={(e) => setCampaign(e.target.value)} aria-label="Campaign">{active.map((c: any) => <option key={c.code} value={c.code}>{c.code} · {c.vertical}</option>)}</select>
        <span className="faint" style={{ fontSize: 'var(--fs-0)' }}>Each one is researched and scored in the background, about a minute each.</span>
        <button className="btn ghost right" onClick={() => setSel(new Set())}>Clear</button>
        <button className="btn primary" onClick={add} disabled={busy || !campaign}>{busy ? <Spinner /> : <Icon.arrow size={16} />}{busy ? 'Adding and scoring' : 'Add to pipeline'}</button>
      </div>}
    </section>
  );
}
