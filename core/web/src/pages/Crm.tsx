import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useKeys, useLoad } from '../ui/hooks.ts';
import { Icon, Dots } from '../ui/icons.tsx';
import { Menu, MenuItem } from '../ui/menu.tsx';
import { useConfirm } from '../ui/overlay.tsx';
import { useToast } from '../ui/toast.tsx';
import { Empty, Failure, Skeleton, ago, dayLabel, inr, isLate, statusLabel, type Tone } from '../ui/kit.tsx';
import { useMe, useTeam } from '../session.tsx';
import { countsBus } from '../App.tsx';
import { CoMark, CompanyForm, ContactForm, EVENT, EVENT_ICON, FollowUpForm, OPEN_STAGES, OpportunityForm, OutStatus, PersonDot, STAGE, STAGE_COLOR, STATUS_GROUPS, StagePill, siteUrl } from './crm/shared.tsx';

export { STAGE };
export const stageTone = (s: string): Tone => (s === 'WON' ? 'success' : s === 'LOST' ? 'neutral' : 'info');
// Asks why a deal was lost; the server refuses LOST without a reason, so the answer is required. Resolves to the reason, or null if cancelled.
export function useLostReason() {
  const ask = useConfirm();
  return async (company: string) => { const r = await ask({ title: `Mark ${company} as lost?`, body: 'The weekly review learns from the reason, so say what happened.', confirm: 'Mark lost', tone: 'danger', input: { label: 'Why was it lost', placeholder: 'Chose another studio, no budget, went quiet', required: true } }); return typeof r === 'string' && r.trim() ? r : null; };
}
const VERIFY: Record<string, string> = { VALID: 'Verified', UNVERIFIED: 'Not verified', INVALID: 'Bounced', RISKY: 'Risky', CATCH_ALL: 'Accepts any address', UNKNOWN: 'Unclear' };
const groupStatuses = (k: string) => STATUS_GROUPS.find((g) => g[0] === k)?.[2].join(',') ?? '';
type Tab = 'companies' | 'contacts' | 'opportunities';
type CF = { q: string; status: string; campaign: string; owner: string; stage: string; has: string; vertical: string; archived: boolean; sort: string; page: number; size: number };
type PF = { q: string; status: string; owner: string; has: string; sort: string; page: number; size: number };
type OF = { q: string; state: string; stage: string; owner: string; campaign: string; sort: string; page: number; size: number };
const C0: CF = { q: '', status: '', campaign: '', owner: '', stage: '', has: '', vertical: '', archived: false, sort: 'activity', page: 1, size: 20 };
const P0: PF = { q: '', status: '', owner: '', has: '', sort: 'added', page: 1, size: 20 };
const O0: OF = { q: '', state: 'open', stage: '', owner: '', campaign: '', sort: 'stage', page: 1, size: 20 };

// The CRM: every company, person and opportunity outbound and the team have touched, from the same records outbound uses.
export function Crm() {
  const { search, go } = useRouter(); const tab = (search.get('tab') === 'contacts' || search.get('tab') === 'opportunities' ? search.get('tab') : 'companies') as Tab;
  const summary = useLoad<any>(() => api.get('/api/crm/summary'));
  const camps = useLoad<any>(() => api.get('/api/campaigns'));
  // each tab keeps its own filters while you move between them
  const [cf, setCf] = useState<CF>(() => ({ ...C0, q: search.get('q') ?? '', owner: search.get('owner') ?? '' }));
  const [pf, setPf] = useState<PF>(P0); const [of, setOf] = useState<OF>(() => ({ ...O0, stage: search.get('stage') ?? '', state: search.get('stage') ? '' : 'open' }));
  const [modal, setModal] = useState<{ kind: 'company' | 'contact' | 'opportunity'; c?: any } | null>(search.get('new') === '1' ? { kind: 'company' } : null);
  const [version, setVersion] = useState(0); const bump = () => { setVersion((v) => v + 1); summary.reload(true); countsBus.dispatchEvent(new Event('changed')); };
  const setTab = (t: Tab) => go(t === 'companies' ? '/crm' : `/crm?tab=${t}`, true);
  const campaigns: any[] = camps.data?.campaigns ?? [];
  const date = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="dash crm">
      <div className="dash-main">
        <div className="hero-row">
          <div className="hero-text"><p className="hero-eyebrow">{date}</p><h1>CRM</h1><p className="lede">Every company, contact, and opportunity in one place.</p></div>
          <CrmSearch />
        </div>
        <Cards s={summary.data} error={summary.error} retry={() => summary.reload(true)}
          open={(k) => { if (k === 'companies') { setCf(C0); setTab('companies'); } else if (k === 'people') { setPf(P0); setTab('contacts'); } else if (k === 'opps') { setOf(O0); setTab('opportunities'); } else document.getElementById('fu-h')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} />
        <div className="crm-tabs-row">
          <div className="ptabs" role="tablist" aria-label="Records">{([['companies', 'Companies'], ['contacts', 'People'], ['opportunities', 'Opportunities']] as const).map(([k, l]) =>
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
          <ExportButton tab={tab} cf={cf} pf={pf} of={of} />
        </div>
        {tab === 'companies' && <Companies f={cf} setF={setCf} campaigns={campaigns} version={version} onChanged={bump} onAdd={() => setModal({ kind: 'company' })} />}
        {tab === 'contacts' && <People f={pf} setF={setPf} version={version} onChanged={bump} onAdd={() => setModal({ kind: 'contact' })} />}
        {tab === 'opportunities' && <Opportunities f={of} setF={setOf} campaigns={campaigns} version={version} onChanged={bump} onAdd={() => setModal({ kind: 'opportunity' })} />}
      </div>
      <aside className="dash-rail" aria-label="CRM at a glance">
        <FollowUps version={version} onChanged={bump} />
        <Snapshot s={summary.data} onStage={(s) => { setOf({ ...O0, state: '', stage: s }); setTab('opportunities'); }} />
        <TopCampaigns />
        <RecentActivity version={version} />
      </aside>
      {modal?.kind === 'company' && <CompanyForm campaigns={campaigns} onClose={() => { setModal(null); if (search.get('new')) go('/crm', true); }} onSaved={(c) => { setModal(null); bump(); go(`/crm/companies/${c.id}`); }} />}
      {modal?.kind === 'contact' && <ContactForm onClose={() => setModal(null)} onSaved={() => { setModal(null); bump(); }} />}
      {modal?.kind === 'opportunity' && <OpportunityForm onClose={() => setModal(null)} onSaved={() => { setModal(null); bump(); }} />}
    </div>
  );
}

// ---------- header ----------
function CrmSearch() {
  const { go } = useRouter(); const [q, setQ] = useState(''); const [r, setR] = useState<any>(null); const [open, setOpen] = useState(false); const ref = useRef<HTMLInputElement>(null);
  useKeys({ '/': () => ref.current?.focus() });
  useEffect(() => { if (q.trim().length < 2) { setR(null); return; } const t = setTimeout(async () => { try { setR(await api.get(`/api/crm/search?q=${encodeURIComponent(q)}`)); } catch { setR(null); } }, 220); return () => clearTimeout(t); }, [q]);
  const pick = (to: string) => { setOpen(false); setQ(''); go(to); };
  const groups: [string, any[], (x: any) => [string, string, string]][] = r ? [
    ['Companies', r.companies, (x) => [x.name, x.domain, `/crm/companies/${x.id}`]], ['People', r.people, (x) => [x.full_name ?? x.email, [x.job_title, x.company].filter(Boolean).join(' · '), `/crm/companies/${x.company_id}`]],
    ['Opportunities', r.opportunities, (x) => [x.company, `${STAGE[x.stage]}${x.value_paise ? ` · ${inr(x.value_paise)}` : ''}`, `/crm/companies/${x.company_id}`]]] : [];
  const any = groups.some(([, l]) => l.length);
  return (
    <div className="crm-search" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <label className="tb-search"><Icon.find size={16} /><input ref={ref} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search companies, people, opportunities" aria-label="Search the CRM" aria-keyshortcuts="/" role="combobox" aria-expanded={open && !!r} aria-controls="crm-results" /><kbd aria-hidden="true">/</kbd></label>
      {open && r && <div className="crm-results" id="crm-results" role="listbox" aria-label="Results">{any ? groups.map(([g, l, f]) => l.length > 0 && <div key={g}><p className="menu-note">{g}</p>
        {l.map((x) => { const [t, s, to] = f(x); return <button key={g + x.id} type="button" role="option" aria-selected="false" onClick={() => pick(to)}><b>{t}</b><span>{s}</span></button>; })}</div>) : <p className="menu-note">Nothing matches “{q}”.</p>}</div>}
    </div>
  );
}

const trend = (now: number, before: number) => before > 0 ? { pct: Math.round(((now - before) / before) * 100) } : now > 0 ? { added: now } : null;
function Spark({ points, tone }: { points: number[]; tone: string }) {
  if (points.length < 2 || Math.max(...points) === Math.min(...points) && points[0] === 0) return null;
  const max = Math.max(...points), min = Math.min(...points), span = max - min || 1;
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${(i / (points.length - 1)) * 100} ${26 - ((v - min) / span) * 22}`).join(' ');
  return <svg className="k-spark2" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true" style={{ color: tone }}><path d={d} /></svg>;
}
function Cards({ s, error, retry, open }: { s: any; error: string | null; retry: () => void; open: (k: string) => void }) {
  if (error) return <Failure error={error} retry={retry} />;
  const ser = (k: string) => (s?.series ?? []).map((x: any) => x[k]);
  const co = s && trend(s.companies, s.companies_before); const pe = s && trend(s.people, s.people_before); const op = s && (s.opened_prev_30d > 0 ? { pct: Math.round(((s.opened_30d - s.opened_prev_30d) / s.opened_prev_30d) * 100) } : s.opened_30d ? { added: s.opened_30d } : null);
  const line = (t: any) => !t ? <small className="k-trend flat">No change in 30 days</small> : 'pct' in t ? <small className={`k-trend ${t.pct > 0 ? 'up' : t.pct < 0 ? 'down' : 'flat'}`}>{t.pct > 0 ? '▲' : t.pct < 0 ? '▼' : ''} {t.pct > 0 ? '+' : ''}{t.pct}%<span> vs 30 days ago</span></small> : <small className="k-trend up">▲ +{t.added}<span> in 30 days</span></small>;
  const cards = [
    { k: 'companies', tone: '255, 146, 46', icon: 'crm', n: s?.companies, label: 'Total companies', sub: line(co), spark: ser('companies') },
    { k: 'people', tone: '59, 130, 246', icon: 'people', n: s?.people, label: 'People', sub: line(pe), spark: ser('people') },
    { k: 'opps', tone: '34, 197, 94', icon: 'target', n: s?.open_opps, label: 'Open opportunities', sub: op && 'pct' in op ? <small className={`k-trend ${op.pct >= 0 ? 'up' : 'down'}`}>{op.pct >= 0 ? '▲ +' : '▼ '}{op.pct}%<span> opened vs the 30 days before</span></small> : op ? <small className="k-trend up">▲ {op.added}<span> opened, 30 days</span></small> : <small className="k-trend flat">{s && s.open_value_paise !== '0' ? `${inr(s.open_value_paise)} open` : 'None opened in 30 days'}</small>, spark: ser('opened') },
    { k: 'follow', tone: '168, 85, 247', icon: 'calendar', n: s?.follow_ups_due, label: 'Follow-ups due', sub: s?.follow_ups_overdue ? <small className="k-trend down">{s.follow_ups_overdue} overdue</small> : <small className="k-trend flat">{s?.follow_ups_week ?? 0} more in the next 7 days</small>, spark: [] },
  ];
  return <section className="crm-cards" aria-label="CRM numbers">{cards.map((c) => { const I = Icon[c.icon as keyof typeof Icon]; return (
    <button key={c.k} type="button" className="crm-card" style={{ '--tone-rgb': c.tone } as React.CSSProperties} onClick={() => open(c.k)} aria-label={`${c.label}: ${c.n ?? 'loading'}`}>
      <span className="cc-ic" aria-hidden="true"><I size={22} /></span>
      <span className="cc-body"><b>{s ? c.n : <Skeleton h={24} w={40} />}</b><span>{c.label}</span>{s && c.sub}</span>
      <Spark points={c.spark} tone={`rgb(${c.tone})`} />
    </button>); })}</section>;
}

// ---------- shared table bits ----------
function Pager({ total, page, size, onPage, onSize }: { total: number; page: number; size: number; onPage: (p: number) => void; onSize: (s: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size)); const from = total ? (page - 1) * size + 1 : 0;
  const nums = Array.from({ length: pages }, (_, i) => i + 1).filter((i) => i === 1 || i === pages || Math.abs(i - page) <= 1);
  return <div className="pager"><span>{total ? `Showing ${from} to ${Math.min(total, page * size)} of ${total}` : 'Nothing to show'}</span>
    <nav className="pg-nav" aria-label="Pages"><button type="button" className="icon-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><Icon.left size={15} /></button>
      {nums.map((n, i) => <span key={n} style={{ display: 'contents' }}>{i > 0 && n - nums[i - 1]! > 1 && <span className="pg-gap" aria-hidden="true">…</span>}<button type="button" className={`pg-n${n === page ? ' on' : ''}`} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>{n}</button></span>)}
      <button type="button" className="icon-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><Icon.right size={15} /></button></nav>
    <label className="pg-size">Rows per page<select value={size} onChange={(e) => onSize(Number(e.target.value))}>{[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select></label></div>;
}
function useDebounced(v: string, ms = 250) { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; }
function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return <label className={`fsel${value ? ' on' : ''}`}><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}>{children}</select></label>;
}
function ActiveFilters({ items, reset }: { items: [string, () => void][]; reset: () => void }) {
  if (!items.length) return null;
  return <div className="active-f" aria-label="Active filters">{items.map(([l, clear]) => <button key={l} type="button" className="af" onClick={clear} aria-label={`Remove filter ${l}`}>{l}<Icon.x size={11} /></button>)}<button type="button" className="link-btn" onClick={reset}>Reset filters</button></div>;
}
function Th({ label, k, sort, set, alt }: { label: string; k?: string; sort: string; set: (s: string) => void; alt?: string }) {
  if (!k) return <th>{label}</th>;
  return <th aria-sort={sort === k ? (alt === 'asc' ? 'ascending' : 'descending') : undefined}><button type="button" className="th-sort" onClick={() => set(k)}>{label}{sort === k ? <span aria-hidden="true"> {alt === 'asc' ? '↑' : '↓'}</span> : null}</button></th>;
}

// ---------- companies ----------
function Companies({ f, setF, campaigns, version, onChanged, onAdd }: { f: CF; setF: (f: CF) => void; campaigns: any[]; version: number; onChanged: () => void; onAdd: () => void }) {
  const toast = useToast(); const team = useTeam(); const ask = useConfirm(); const { go } = useRouter();
  const [term, setTerm] = useState(f.q); const q = useDebounced(term);
  const set = (x: Partial<CF>) => setF({ ...f, page: 1, ...x });
  useEffect(() => { if (q !== f.q) set({ q }); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const params = new URLSearchParams({ sort: f.sort, page: String(f.page), size: String(f.size), ...(f.q ? { q: f.q } : {}), ...(f.status ? { status: groupStatuses(f.status) } : {}), ...(f.campaign ? { campaign: f.campaign } : {}),
    ...(f.owner ? { owner: f.owner } : {}), ...(f.stage ? { stage: f.stage } : {}), ...(f.has ? { has: f.has } : {}), ...(f.vertical ? { vertical: f.vertical } : {}), ...(f.archived ? { archived: '1' } : {}) });
  const { data, error, loading, reload } = useLoad<any>(() => api.get(`/api/crm/companies/table?${params}`), [params.toString(), version]);
  const [sel, setSel] = useState<Set<string>>(new Set()); useEffect(() => setSel(new Set()), [params.toString()]);
  const [modal, setModal] = useState<{ kind: string; c: any } | null>(null);
  const rows: any[] = data?.rows ?? [];
  const done = () => { reload(true); onChanged(); };
  const bulk = async (action: string, extra: object = {}) => {
    const ids = [...sel]; if (action === 'archive' && !(await ask({ title: `Archive ${ids.length} ${ids.length === 1 ? 'company' : 'companies'}?`, body: 'They leave the CRM lists. Outbound, deals and history are untouched, and you can restore them from Archived.', confirm: 'Archive' }))) return;
    if (action === 'not_fit' && !(await ask({ title: `Mark ${ids.length} as not a fit?`, body: 'Their outbound stops. Companies not in outbound are skipped.', confirm: 'Mark not a fit', tone: 'danger' }))) return;
    try { const r = await api.post('/api/crm/companies/bulk', { ids, action, ...extra }); toast(`${r.done} updated${r.skipped ? `, ${r.skipped} not in outbound` : ''}.`); setSel(new Set()); done(); } catch (e: any) { toast(e.message, { err: true }); }
  };
  const status = async (c: any, s: string) => { try { await api.post(`/api/crm/companies/${c.id}/status`, { status: s }); toast(`${c.name}: ${statusLabel(s)}.`); done(); } catch (e: any) { toast(e.message, { err: true }); } };
  const patch = async (c: any, body: object, msg: string) => { try { await api.patch(`/api/crm/companies/${c.id}`, body); toast(msg); done(); } catch (e: any) { toast(e.message, { err: true }); } };
  const verticals = [...new Set(campaigns.map((c) => c.vertical).filter(Boolean))];
  const nf = [f.status, f.campaign, f.owner, f.stage, f.has, f.vertical, f.archived ? '1' : ''].filter(Boolean).length;
  const chips: [string, () => void][] = [
    ...(f.q ? [[`“${f.q}”`, () => { setTerm(''); set({ q: '' }); }] as [string, () => void]] : []),
    ...(f.status ? [[STATUS_GROUPS.find((g) => g[0] === f.status)?.[1] ?? f.status, () => set({ status: '' })] as [string, () => void]] : []),
    ...(f.campaign ? [[f.campaign, () => set({ campaign: '' })] as [string, () => void]] : []),
    ...(f.owner ? [[f.owner === 'none' ? 'No owner' : `Owner: ${team.find((u) => u.id === f.owner)?.name ?? 'someone'}`, () => set({ owner: '' })] as [string, () => void]] : []),
    ...(f.stage ? [[f.stage === 'NONE' ? 'No deal' : `Deal: ${f.stage.split(',').map((s) => STAGE[s]).join(', ')}`, () => set({ stage: '' })] as [string, () => void]] : []),
    ...(f.has ? [[({ deal: 'Has an open deal', people: 'Has people', nopeople: 'No people yet' } as any)[f.has], () => set({ has: '' })] as [string, () => void]] : []),
    ...(f.vertical ? [[f.vertical, () => set({ vertical: '' })] as [string, () => void]] : []),
    ...(f.archived ? [['Archived', () => set({ archived: false })] as [string, () => void]] : []),
  ];
  const sortBy = (k: string) => set({ sort: k });
  return (
    <section className="panel crm-table" aria-label="Companies">
      <div className="crm-tools">
        <label className="tb-search grow"><Icon.find size={15} /><input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search companies, domains, people, email" aria-label="Search companies" /></label>
        <Select label="Outbound status" value={f.status} onChange={(v) => set({ status: v })}><option value="">All</option>{STATUS_GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select label="Campaign" value={f.campaign} onChange={(v) => set({ campaign: v })}><option value="">All campaigns</option>{campaigns.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}</Select>
        <Select label="Owner" value={f.owner} onChange={(v) => set({ owner: v })}><option value="">All owners</option><option value="none">No owner</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
        <Menu label="More filters" className={`btn tiny mf${nf > 3 ? ' on' : ''}`} kind="dialog" place="left" button={<><Icon.funnel size={14} />More filters</>}>{() => <div className="filter-pop">
          <label className="field"><span>Deal stage</span><select value={f.stage} onChange={(e) => set({ stage: e.target.value })}><option value="">Any</option><option value={OPEN_STAGES.join(',')}>Any open deal</option>{Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="NONE">No deal</option></select></label>
          <label className="field"><span>Has</span><select value={f.has} onChange={(e) => set({ has: e.target.value })}><option value="">Anything</option><option value="deal">An open deal</option><option value="people">People</option><option value="nopeople">No people yet</option></select></label>
          {verticals.length > 0 && <label className="field"><span>Vertical</span><select value={f.vertical} onChange={(e) => set({ vertical: e.target.value })}><option value="">Any</option>{verticals.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>}
          <label className="chk"><input type="checkbox" className="check" checked={f.archived} onChange={(e) => set({ archived: e.target.checked })} />Show archived companies</label>
          <label className="field"><span>Sort by</span><select value={f.sort} onChange={(e) => set({ sort: e.target.value })}><option value="activity">Last activity</option><option value="name">Company</option><option value="status">Outbound status</option><option value="value">Deal value</option><option value="updated">Recently updated</option><option value="created">Recently added</option></select></label></div>}</Menu>
        <button type="button" className="btn primary glow add-co" onClick={onAdd}><Icon.plus size={16} />Add company</button>
      </div>
      <ActiveFilters items={chips} reset={() => { setTerm(''); setF({ ...C0, sort: f.sort, size: f.size }); }} />
      {sel.size > 0 && <div className="bulkbar" role="region" aria-label="Selected companies"><b>{sel.size} selected</b>
        <select aria-label="Assign owner" value="" onChange={(e) => e.target.value && bulk('assign', { owner_id: e.target.value === 'none' ? null : e.target.value })}><option value="">Assign owner…</option><option value="none">Nobody</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <button type="button" className="btn tiny" onClick={() => bulk('not_fit')}>Mark not a fit</button>
        {f.archived ? <button type="button" className="btn tiny" onClick={() => bulk('restore')}><Icon.redo size={13} />Restore</button> : <button type="button" className="btn tiny" onClick={() => bulk('archive')}><Icon.archive size={13} />Archive</button>}
        <button type="button" className="btn tiny ghost" style={{ marginLeft: 'auto' }} onClick={() => setSel(new Set())}>Clear</button></div>}
      {loading && !data ? <div className="crm-skel">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={44} />)}</div> : error ? <div style={{ padding: 16 }}><Failure error={error} retry={reload} /></div> : !rows.length ?
        <div style={{ padding: 8 }}><Empty title={chips.length ? 'No company matches' : 'No companies yet'} action={chips.length ? <button className="btn" onClick={() => { setTerm(''); setF({ ...C0 }); }}>Reset filters</button> : <button className="btn primary" onClick={onAdd}>Add company</button>}>
          {chips.length ? 'Change the filters or the search.' : 'Companies arrive from Find companies, or add one by hand.'}</Empty></div> :
        <div className="scrollx"><table className="ctable crm-t">
          <thead><tr><th style={{ width: 36 }}><input type="checkbox" className="check" aria-label="Select all on this page" checked={rows.every((r) => sel.has(r.id))} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
            <Th label="Company" k="name" sort={f.sort} set={sortBy} alt="asc" /><Th label="Status" k="status" sort={f.sort} set={sortBy} alt="asc" /><th>Campaign</th><Th label="Deal / Stage" k="value" sort={f.sort} set={sortBy} /><th>People</th><Th label="Last activity" k="activity" sort={f.sort} set={sortBy} /><th className="num">Actions</th></tr></thead>
          <tbody>{rows.map((c) => { const url = siteUrl(c); const [ic, tone] = EVENT_ICON(c.last_action ?? ''); const LI = Icon[ic]; return (
            <tr key={c.id} className={`click${sel.has(c.id) ? ' sel' : ''}`} onClick={() => go(`/crm/companies/${c.id}`)}>
              <td onClick={(e) => e.stopPropagation()}><input type="checkbox" className="check" aria-label={`Select ${c.name}`} checked={sel.has(c.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} /></td>
              <td><div className="c-name"><CoMark name={c.name} /><div><span className="co-line"><Link to={`/crm/companies/${c.id}`} onClick={(e) => e.stopPropagation()}><b>{c.name}</b></Link>
                {url && <a href={url} target="_blank" rel="noopener noreferrer" className="ext" onClick={(e) => e.stopPropagation()} aria-label={`Open ${c.domain} in a new tab`}><Icon.out size={12} /></a>}</span>
                <span>{c.domain}{c.vertical || c.campaign_name ? ` · ${c.vertical || c.campaign_name}` : ''}</span></div></div></td>
              <td><OutStatus s={c.status} /></td>
              <td>{c.campaign ? <span className="camp-tag2">{c.campaign}</span> : <span className="sub">None</span>}</td>
              <td>{c.stage ? <><b className="deal-v">{c.value_paise ? inr(c.value_paise) : 'No value'}</b><StagePill s={c.stage} /></> : <><b className="deal-v none">—</b><span className="sub">No active deal</span></>}</td>
              <td>{c.contacts ? <span className="pstack" aria-label={`${c.contacts} ${c.contacts === 1 ? 'person' : 'people'}`}>{c.people.slice(0, 2).map((n: string) => <PersonDot key={n} name={n} />)}{c.contacts > 2 && <span className="more">+{c.contacts - 2}</span>}</span> : <span className="sub">None</span>}</td>
              <td>{c.last_at ? <span className="lastact"><span className={`f-ic tone-${tone}`} aria-hidden="true"><LI size={13} /></span><span><b>{EVENT[c.last_action] ? EVENT[c.last_action]![0]!.toUpperCase() + EVENT[c.last_action]!.slice(1) : c.last_action.replace(/_/g, ' ')}</b><small>{ago(c.last_at)}</small></span></span> : <span className="sub">Nothing yet</span>}</td>
              <td className="num" onClick={(e) => e.stopPropagation()}><Menu label={`Actions for ${c.name}`} className="icon-btn" place="left" button={<Dots vertical size={16} />}>{(close) => <>
                <MenuItem onSelect={() => { close(); go(`/crm/companies/${c.id}`); }}><Icon.arrow size={15} />View details</MenuItem>
                <MenuItem onSelect={() => { close(); setModal({ kind: 'edit', c }); }}><Icon.edit size={15} />Edit company</MenuItem>
                <MenuItem onSelect={() => { close(); setModal({ kind: 'contact', c }); }}><Icon.user size={15} />Add contact</MenuItem>
                <MenuItem onSelect={() => { close(); setModal({ kind: 'opp', c }); }}><Icon.handshake size={15} />Create opportunity</MenuItem>
                <MenuItem onSelect={() => { close(); setModal({ kind: 'follow', c }); }}><Icon.calendar size={15} />Add follow-up</MenuItem>
                {c.status && <><div className="menu-sep" />
                  {c.status !== 'REJECTED' && <MenuItem onSelect={() => { close(); status(c, 'REJECTED'); }}><Icon.x size={15} />Mark not a fit</MenuItem>}
                  {c.status !== 'RESEARCH_FURTHER' && <MenuItem onSelect={() => { close(); status(c, 'RESEARCH_FURTHER'); }}><Icon.find size={15} />Send back to research</MenuItem>}</>}
                <div className="menu-item" role="none"><Icon.people size={15} /><select aria-label={`Owner of ${c.name}`} value={c.owner_id ?? ''} onClick={(e) => e.stopPropagation()} onChange={(e) => { close(); patch(c, { owner_id: e.target.value || null }, 'Owner changed.'); }}><option value="">No owner</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
                {url && <MenuItem onSelect={() => { close(); window.open(url, '_blank', 'noopener'); }}><Icon.out size={15} />Open website</MenuItem>}
                <div className="menu-sep" />
                {c.archived_at ? <MenuItem onSelect={() => { close(); patch(c, { archived: false }, `${c.name} restored.`); }}><Icon.redo size={15} />Restore</MenuItem>
                  : <MenuItem onSelect={async () => { close(); if (await ask({ title: `Archive ${c.name}?`, body: 'It leaves the CRM lists. Outbound, deals and history are untouched; restore it from Archived.', confirm: 'Archive' })) patch(c, { archived: true }, `${c.name} archived.`); }}><Icon.archive size={15} />Archive company</MenuItem>}</>}</Menu></td>
            </tr>); })}</tbody></table></div>}
      {data && data.total > 0 && <Pager total={data.total} page={f.page} size={f.size} onPage={(p) => setF({ ...f, page: p })} onSize={(s) => setF({ ...f, size: s, page: 1 })} />}
      {modal?.kind === 'edit' && <CompanyForm c={modal.c} onClose={() => setModal(null)} onSaved={() => { setModal(null); done(); }} />}
      {modal?.kind === 'contact' && <ContactForm company={{ id: modal.c.id, name: modal.c.name }} onClose={() => setModal(null)} onSaved={() => { setModal(null); done(); }} />}
      {modal?.kind === 'opp' && <OpportunityForm company={{ id: modal.c.id, name: modal.c.name }} onClose={() => setModal(null)} onSaved={() => { setModal(null); done(); }} />}
      {modal?.kind === 'follow' && <FollowUpForm company={{ id: modal.c.id, name: modal.c.name }} onClose={() => setModal(null)} onSaved={() => { setModal(null); done(); }} />}
    </section>
  );
}

// ---------- people ----------
function People({ f, setF, version, onChanged, onAdd }: { f: PF; setF: (f: PF) => void; version: number; onChanged: () => void; onAdd: () => void }) {
  const team = useTeam(); const { go } = useRouter();
  const [term, setTerm] = useState(f.q); const q = useDebounced(term); const set = (x: Partial<PF>) => setF({ ...f, page: 1, ...x });
  useEffect(() => { if (q !== f.q) set({ q }); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const params = new URLSearchParams({ sort: f.sort, page: String(f.page), size: String(f.size), ...(f.q ? { q: f.q } : {}), ...(f.status ? { status: groupStatuses(f.status) } : {}), ...(f.owner ? { owner: f.owner } : {}), ...(f.has ? { has: f.has } : {}) });
  const { data, error, loading, reload } = useLoad<any>(() => api.get(`/api/crm/contacts/table?${params}`), [params.toString(), version]);
  const [edit, setEdit] = useState<any>(null); const rows: any[] = data?.rows ?? [];
  const chips: [string, () => void][] = [...(f.q ? [[`“${f.q}”`, () => { setTerm(''); set({ q: '' }); }] as [string, () => void]] : []), ...(f.status ? [[STATUS_GROUPS.find((g) => g[0] === f.status)?.[1] ?? '', () => set({ status: '' })] as [string, () => void]] : []),
    ...(f.owner ? [[f.owner === 'none' ? 'No owner' : `Owner: ${team.find((u) => u.id === f.owner)?.name ?? ''}`, () => set({ owner: '' })] as [string, () => void]] : []), ...(f.has ? [[({ email: 'Has email', noemail: 'No email', decides: 'Decision makers' } as any)[f.has], () => set({ has: '' })] as [string, () => void]] : [])];
  return (
    <section className="panel crm-table" aria-label="People">
      <div className="crm-tools">
        <label className="tb-search grow"><Icon.find size={15} /><input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search names, titles, email, phone, company" aria-label="Search people" /></label>
        <Select label="Outreach status" value={f.status} onChange={(v) => set({ status: v })}><option value="">All</option>{STATUS_GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select label="Company owner" value={f.owner} onChange={(v) => set({ owner: v })}><option value="">All owners</option><option value="none">No owner</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
        <Select label="Show" value={f.has} onChange={(v) => set({ has: v })}><option value="">Everyone</option><option value="decides">Decision makers</option><option value="email">Has email</option><option value="noemail">No email</option></Select>
        <Select label="Sort" value={f.sort} onChange={(v) => set({ sort: v })}><option value="added">Recently added</option><option value="name">Name</option><option value="company">Company</option><option value="contacted">Last contacted</option></Select>
        <button type="button" className="btn primary glow add-co" onClick={onAdd}><Icon.plus size={16} />Add contact</button>
      </div>
      <ActiveFilters items={chips} reset={() => { setTerm(''); setF({ ...P0 }); }} />
      {loading && !data ? <div className="crm-skel">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={44} />)}</div> : error ? <div style={{ padding: 16 }}><Failure error={error} retry={reload} /></div> : !rows.length ?
        <div style={{ padding: 8 }}><Empty title={chips.length ? 'Nobody matches' : 'Nobody here yet'} action={!chips.length ? <button className="btn primary" onClick={onAdd}>Add contact</button> : undefined}>{chips.length ? 'Change the filters or the search.' : 'People are added from a company, or arrive with outbound research.'}</Empty></div> :
        <div className="scrollx"><table className="ctable crm-t">
          <thead><tr><th>Person</th><th>Company</th><th>Email</th><th>Phone</th><th>Owner</th><th>Outreach</th><th>Last contacted</th><th>Next follow-up</th><th className="num"><span className="sr">Actions</span></th></tr></thead>
          <tbody>{rows.map((p) => <tr key={p.id} className="click" onClick={() => go(`/crm/companies/${p.company_id}`)}>
            <td><div className="c-name"><PersonDot name={p.full_name ?? p.email ?? '?'} /><div><b>{p.full_name ?? 'No name'}{p.is_decision_maker && <span className="decides">Decides</span>}</b><span>{p.job_title ?? ''}</span></div></div></td>
            <td><div className="c-name"><CoMark name={p.company} size={24} /><div><b>{p.company}</b><span>{p.domain}</span></div></div></td>
            <td>{p.email ? <><a href={`mailto:${p.email}`} onClick={(e) => e.stopPropagation()} className="mono-s">{p.email}</a><div className="sub">{VERIFY[p.email_verification_status] ?? ''}</div></> : <span className="sub">None</span>}</td>
            <td>{p.phone ? <a href={`tel:${p.phone.replace(/[^\d+]/g, '')}`} onClick={(e) => e.stopPropagation()}>{p.phone}</a> : <span className="sub">None</span>}</td>
            <td>{p.owner_name ?? <span className="sub">Nobody</span>}</td>
            <td><OutStatus s={p.status} /></td>
            <td className="sub">{p.last_contacted ? ago(p.last_contacted) : 'Never'}</td>
            <td className={p.next_follow_up && isLate(p.next_follow_up) ? 'late' : 'sub'}>{p.next_follow_up ? dayLabel(p.next_follow_up) : 'None'}</td>
            <td className="num" onClick={(e) => e.stopPropagation()}><button type="button" className="icon-btn" onClick={() => setEdit(p)} aria-label={`Edit ${p.full_name ?? 'contact'}`}><Icon.edit size={15} /></button></td></tr>)}</tbody></table></div>}
      {data && data.total > 0 && <Pager total={data.total} page={f.page} size={f.size} onPage={(p) => setF({ ...f, page: p })} onSize={(s) => setF({ ...f, size: s, page: 1 })} />}
      {edit && <ContactForm p={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(true); onChanged(); }} />}
    </section>
  );
}

// ---------- opportunities ----------
function Opportunities({ f, setF, campaigns, version, onChanged, onAdd }: { f: OF; setF: (f: OF) => void; campaigns: any[]; version: number; onChanged: () => void; onAdd: () => void }) {
  const toast = useToast(); const team = useTeam(); const lostReason = useLostReason(); const { go } = useRouter();
  const [term, setTerm] = useState(f.q); const q = useDebounced(term); const set = (x: Partial<OF>) => setF({ ...f, page: 1, ...x });
  useEffect(() => { if (q !== f.q) set({ q }); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const params = new URLSearchParams({ sort: f.sort, page: String(f.page), size: String(f.size), ...(f.q ? { q: f.q } : {}), ...(f.state ? { state: f.state } : {}), ...(f.stage ? { stage: f.stage } : {}), ...(f.owner ? { owner: f.owner } : {}), ...(f.campaign ? { campaign: f.campaign } : {}) });
  const { data, error, loading, reload, setData } = useLoad<any>(() => api.get(`/api/crm/opportunities/table?${params}`), [params.toString(), version]);
  const [edit, setEdit] = useState<any>(null); const rows: any[] = data?.rows ?? [];
  const setStage = async (o: any, stage: string) => {
    let lost_reason: string | undefined; if (stage === 'LOST') { const r = await lostReason(o.company); if (!r) return; lost_reason = r; }
    const before = data; setData({ ...data, rows: rows.map((x) => (x.id === o.id ? { ...x, stage } : x)) });
    try { await api.patch(`/api/crm/opportunities/${o.id}`, { stage, lost_reason }); toast(stage === 'LOST' ? `Marked ${o.company} lost.` : `Moved ${o.company} to ${STAGE[stage]}.`); reload(true); onChanged(); } catch (e: any) { setData(before); toast(e.message, { err: true }); }
  };
  return (
    <section className="panel crm-table" aria-label="Opportunities">
      <div className="crm-tools">
        <div className="seg crm-state" role="group" aria-label="Show">{([['open', 'Open'], ['won', 'Won'], ['lost', 'Lost'], ['', 'All']] as const).map(([k, l]) => <button key={l} type="button" aria-pressed={f.state === k && !f.stage} onClick={() => set({ state: k, stage: '' })}>{l}</button>)}</div>
        <label className="tb-search grow"><Icon.find size={15} /><input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search company, person, next action" aria-label="Search opportunities" /></label>
        <Select label="Stage" value={f.stage} onChange={(v) => set({ stage: v, state: '' })}><option value="">Any</option>{Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Select label="Owner" value={f.owner} onChange={(v) => set({ owner: v })}><option value="">All owners</option><option value="none">No owner</option>{team.map((u) => <option key={u.id} value={u.username}>{u.name}</option>)}</Select>
        <Select label="Campaign" value={f.campaign} onChange={(v) => set({ campaign: v })}><option value="">All</option>{campaigns.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}</Select>
        <Select label="Sort" value={f.sort} onChange={(v) => set({ sort: v })}><option value="stage">Stage</option><option value="value">Value</option><option value="close">Expected close</option><option value="updated">Recently moved</option><option value="company">Company</option></Select>
        <button type="button" className="btn primary glow add-co" onClick={onAdd}><Icon.plus size={16} />New opportunity</button>
      </div>
      {loading && !data ? <div className="crm-skel">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} h={44} />)}</div> : error ? <div style={{ padding: 16 }}><Failure error={error} retry={reload} /></div> : !rows.length ?
        <div style={{ padding: 8 }}><Empty title="No opportunities here">A reply that turns into a conversation opens one, or open one from a company.</Empty></div> :
        <div className="scrollx"><table className="ctable crm-t">
          <thead><tr><th>Opportunity</th><th>Stage</th><th className="num">Value</th><th>Owner</th><th>Expected close</th><th>Next action</th><th>Deal</th><th>Moved</th><th className="num"><span className="sr">Actions</span></th></tr></thead>
          <tbody>{rows.map((o) => <tr key={o.id}>
            <td><div className="c-name"><CoMark name={o.company} size={28} /><div><Link to={`/crm/companies/${o.company_id}`}><b>{o.company}</b></Link><span>{[o.contact_name, o.campaign].filter(Boolean).join(' · ') || o.domain}</span></div></div></td>
            <td><span className="stage-sel" style={{ '--sc': STAGE_COLOR[o.stage] } as React.CSSProperties}><i aria-hidden="true" /><select value={o.stage} onChange={(e) => setStage(o, e.target.value)} aria-label={`Stage for ${o.company}`}>{Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></span>
              {o.stage === 'LOST' && o.lost_reason && <div className="sub" style={{ maxWidth: 220, whiteSpace: 'normal' }}>{o.lost_reason}</div>}</td>
            <td className="num">{o.value_paise ? <b className="deal-v">{inr(o.value_paise)}</b> : <span className="sub">Not set</span>}</td>
            <td>{o.owner_name ?? o.owner ?? <span className="sub">Nobody</span>}</td>
            <td className={o.expected_close && isLate(o.expected_close) && !['WON', 'LOST'].includes(o.stage) ? 'late' : ''}>{o.expected_close ? dayLabel(o.expected_close) : <span className="sub">Not set</span>}</td>
            <td style={{ whiteSpace: 'normal', minWidth: 180 }}>{o.next_action ? <><span>{o.next_action}</span>{o.next_action_on && <div className={`sub${isLate(o.next_action_on) ? ' late' : ''}`}>{dayLabel(o.next_action_on)}</div>}</> : <span className="sub">None</span>}</td>
            <td>{o.deal ? <><b className="deal-v">{inr(o.deal.revenue_paise)}</b><div className="sub">{o.deal.status.charAt(0) + o.deal.status.slice(1).toLowerCase()}</div></> : <span className="sub">Not signed</span>}</td>
            <td className="sub">{ago(o.updated_at)}</td>
            <td className="num"><Menu label={`Actions for ${o.company}`} className="icon-btn" place="left" button={<Dots vertical size={16} />}>{(close) => <>
              <MenuItem onSelect={() => { close(); setEdit(o); }}><Icon.edit size={15} />Edit opportunity</MenuItem>
              <MenuItem onSelect={() => { close(); go(`/crm/companies/${o.company_id}`); }}><Icon.arrow size={15} />Open company</MenuItem></>}</Menu></td></tr>)}</tbody></table></div>}
      {data && data.total > 0 && <Pager total={data.total} page={f.page} size={f.size} onPage={(p) => setF({ ...f, page: p })} onSize={(s) => setF({ ...f, size: s, page: 1 })} />}
      {edit && <OpportunityForm o={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(true); onChanged(); }} />}
    </section>
  );
}

// the rows the current tab and filters show, all pages, as a spreadsheet file made in the browser
function ExportButton({ tab, cf, pf, of }: { tab: Tab; cf: CF; pf: PF; of: OF }) {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const f: any = tab === 'companies' ? cf : tab === 'contacts' ? pf : of; const out: any[] = [];
      const base: Record<string, string> = Object.fromEntries(Object.entries(f).filter(([k, v]) => !['page', 'size', 'archived'].includes(k) && v !== '' && v !== false).map(([k, v]) => [k, k === 'status' ? groupStatuses(String(v)) : String(v)]));
      if (tab === 'companies' && cf.archived) base.archived = '1';
      for (let page = 1; page <= 50; page++) { const r = await api.get(`/api/crm/${tab === 'companies' ? 'companies' : tab}/table?${new URLSearchParams({ ...base, page: String(page), size: '100' })}`); out.push(...r.rows); if (out.length >= r.total) break; }
      const cols: [string, (r: any) => unknown][] = tab === 'companies' ? [['Company', (r) => r.name], ['Domain', (r) => r.domain], ['Outbound status', (r) => r.status ? statusLabel(r.status) : 'Not in outbound'], ['Campaign', (r) => r.campaign], ['Stage', (r) => (r.stage ? STAGE[r.stage] : '')], ['Value INR', (r) => (r.value_paise ? Number(BigInt(r.value_paise) / 100n) : '')], ['People', (r) => r.contacts], ['Owner', (r) => r.owner_name], ['Last activity', (r) => r.last_at]]
        : tab === 'contacts' ? [['Name', (r) => r.full_name], ['Title', (r) => r.job_title], ['Company', (r) => r.company], ['Email', (r) => r.email], ['Phone', (r) => r.phone], ['Owner', (r) => r.owner_name], ['Outreach', (r) => (r.status ? statusLabel(r.status) : '')], ['Last contacted', (r) => r.last_contacted]]
        : [['Company', (r) => r.company], ['Stage', (r) => STAGE[r.stage]], ['Value INR', (r) => (r.value_paise ? Number(BigInt(r.value_paise) / 100n) : '')], ['Owner', (r) => r.owner_name ?? r.owner], ['Expected close', (r) => r.expected_close], ['Next action', (r) => r.next_action]];
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([[cols.map(([h]) => esc(h)).join(','), ...out.map((r) => cols.map(([, g]) => esc(g(r))).join(','))].join('\n')], { type: 'text/csv' }));
      a.download = `crm-${tab}.csv`; a.click(); URL.revokeObjectURL(a.href); toast(`Exported ${out.length} rows.`);
    } catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(false); }
  };
  return <button type="button" className="btn tiny exp" onClick={run} disabled={busy}><Icon.download size={14} />{busy ? 'Exporting…' : 'Export CSV'}</button>;
}

// ---------- the side panels ----------
function FollowUps({ version, onChanged }: { version: number; onChanged: () => void }) {
  const toast = useToast(); const me = useMe(); const [who, setWho] = useState<'mine' | 'all'>('mine');
  const { data, error, loading, reload, setData } = useLoad<any[]>(() => api.get(`/api/crm/follow-ups?who=${who}`), [who, version]);
  const done = async (t: any) => { const before = data; setData((data ?? []).filter((x) => x.id !== t.id)); try { await api.patch(`/api/tasks/${t.id}`, { status: 'DONE' }); toast(`Done: ${t.title}.`); onChanged(); } catch (e: any) { setData(before); toast(e.message, { err: true }); } };
  void me;
  return (
    <section className="panel rpanel" aria-labelledby="fu-h">
      <div className="rp-head"><Icon.calendar size={17} /><h2 id="fu-h">Upcoming follow-ups</h2>
        <div className="seg mini" role="group" aria-label="Whose"><button type="button" aria-pressed={who === 'mine'} onClick={() => setWho('mine')}>Mine</button><button type="button" aria-pressed={who === 'all'} onClick={() => setWho('all')}>All</button></div></div>
      {loading && !data ? <Skeleton h={120} /> : error ? <Failure error={error} retry={reload} /> : !data?.length ? <p className="rp-empty">No follow-ups waiting. Add one from a company’s menu.</p> :
        <ul className="fu-list">{data.slice(0, 5).map((t) => <li key={t.id} className={t.overdue ? 'late' : t.today ? 'today' : ''}>
          <button type="button" className="fu-check" onClick={() => done(t)} aria-label={`Mark “${t.title}” done`}><Icon.check size={12} /></button>
          <Link to={`/crm/companies/${t.company_id}`} className="fu-body"><b>{t.company}</b><span>{t.title}</span>
            <small><Icon.calendar size={12} />{t.due_date ? (t.overdue ? `Late, ${dayLabel(t.due_date)}` : t.today ? 'Today' : dayLabel(t.due_date)) : 'No date'}{t.priority === 'HIGH' ? ' · High' : ''}{who === 'all' && t.assignee_name ? ` · ${t.assignee_name}` : ''}</small></Link></li>)}</ul>}
      {data && data.length > 5 && <Link to="/projects?view=mine" className="link-accent rp-more">All {data.length} follow-ups <Icon.arrow size={13} /></Link>}
    </section>
  );
}
function Snapshot({ s, onStage }: { s: any; onStage: (s: string) => void }) {
  const stages: any[] = (s?.stages ?? []).filter((x: any) => x.n > 0); const total = stages.reduce((a, x) => a + x.n, 0);
  const R = 34, C = 2 * Math.PI * R; let acc = 0;
  return (
    <section className="panel rpanel" aria-labelledby="ps-h">
      <div className="rp-head"><Icon.chart size={17} /><h2 id="ps-h">Pipeline snapshot</h2></div>
      {!s ? <Skeleton h={120} /> : !total ? <p className="rp-empty">No opportunities yet.</p> :
        <div className="snap"><div className="snap-donut"><svg viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="9" />
          {stages.map((x) => { const len = (x.n / total) * C; const el = <circle key={x.stage} cx="42" cy="42" r={R} fill="none" stroke={STAGE_COLOR[x.stage]} strokeWidth="9" strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 42 42)" />; acc += len; return el; })}</svg>
          <span><b>{total}</b><small>{total === 1 ? 'Opportunity' : 'Opportunities'}</small></span></div>
          <ul>{stages.map((x) => <li key={x.stage}><button type="button" onClick={() => onStage(x.stage)}><i style={{ background: STAGE_COLOR[x.stage] }} aria-hidden="true" /><b>{x.n}</b>{STAGE[x.stage]}{x.value_paise !== '0' && <span>{inr(x.value_paise)}</span>}</button></li>)}</ul></div>}
      {s && s.open_value_paise !== '0' && <p className="snap-total">Open pipeline <b>{inr(s.open_value_paise)}</b></p>}
    </section>
  );
}
function TopCampaigns() {
  const [period, setPeriod] = useState('30d'); const { data, error, loading, reload } = useLoad<any[]>(() => api.get(`/api/crm/campaigns?period=${period}`), [period]);
  const COLORS = ['#38BDF8', '#FF922E', '#F43F5E', '#A855F7', '#22C55E', '#F59E0B'];
  const list = (data ?? []).slice(0, 5);
  return (
    <section className="panel rpanel" aria-labelledby="tc-h">
      <div className="rp-head"><Icon.campaigns size={17} /><h2 id="tc-h">Top campaigns</h2>
        <select className="rp-period" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period"><option value="7d">This week</option><option value="30d">30 days</option><option value="90d">90 days</option><option value="all">All time</option></select></div>
      {loading && !data ? <Skeleton h={110} /> : error ? <Failure error={error} retry={reload} /> : !list.length ? <p className="rp-empty">No campaigns yet.</p> :
        <ul className="tc-list">{list.map((c, i) => <li key={c.code}><Link to={`/pipeline?campaign=${c.code}`} title={`${c.vertical}: ${c.found} found, ${c.sent} emailed, ${c.replies} replies (${c.positive} positive), ${c.meetings} meetings, ${c.won} won`}>
          <i style={{ background: COLORS[i % COLORS.length] }} aria-hidden="true" /><span>{c.code}</span><b>{c.replies}</b><small>{c.replies === 1 ? 'reply' : 'replies'}</small></Link>
          <span className="tc-sub">{c.found} found · {c.sent} sent · {c.meetings} {c.meetings === 1 ? 'meeting' : 'meetings'}{c.won ? ` · ${c.won} won` : ''}</span></li>)}</ul>}
      <p className="rp-foot">Ranked by replies, then meetings, then companies found in the period.</p>
    </section>
  );
}
function RecentActivity({ version }: { version: number }) {
  const { data, error, loading, reload } = useLoad<any[]>(() => api.get('/api/crm/activity?limit=8'), [version]);
  return (
    <section className="panel rpanel" aria-labelledby="ra2-h">
      <div className="rp-head"><Icon.clock size={17} /><h2 id="ra2-h">Recent activity</h2></div>
      {loading && !data ? <Skeleton h={140} /> : error ? <Failure error={error} retry={reload} /> : !data?.length ? <p className="rp-empty">Nothing yet.</p> :
        <ul className="ra-feed">{data.map((a) => { const [ic, tone] = EVENT_ICON(a.action); const I = Icon[ic]; return <li key={a.id}>
          <span className={`f-ic tone-${tone}`} aria-hidden="true"><I size={13} /></span>
          {a.company_id ? <Link to={`/crm/companies/${a.company_id}`}><b>{a.company}</b> {EVENT[a.action] ?? a.action.replace(/_/g, ' ')}{a.action === 'stage_changed' && a.detail?.to ? ` to ${STAGE[a.detail.to] ?? a.detail.to}` : ''}</Link> : <span>{EVENT[a.action] ?? a.action}</span>}
          <small>{ago(a.created_at)}</small></li>; })}</ul>}
    </section>
  );
}
