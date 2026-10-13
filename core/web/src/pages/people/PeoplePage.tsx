// People: the header numbers, then Directory, Leave & availability and Org chart, with the selected person's profile
// beside them on wide screens and as a slide-over on narrow ones. Everything comes from the HR records and sign-ins.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { useRouter } from '../../router.tsx';
import { useKeys, useLoad } from '../../ui/hooks.ts';
import { Icon, Dots } from '../../ui/icons.tsx';
import { Menu, MenuItem } from '../../ui/menu.tsx';
import { Drawer } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Empty, Failure, Skeleton, copy } from '../../ui/kit.tsx';
import { isAdmin, useMe } from '../../session.tsx';
import { AVAIL, AvailPill, PAvatar, RolePill, type Avail, type Person, useMedia } from './shared.tsx';
import { Profile } from './Profile.tsx';
import { PersonForm } from './PersonForm.tsx';
import { LeaveView } from './LeaveView.tsx';
import { OrgChart } from './OrgChart.tsx';

type Tab = 'directory' | 'leave' | 'org';
const SIZE = 25;

export function People() {
  const { search, go } = useRouter(); const me = useMe(); const admin = isAdmin(me); const toast = useToast();
  const tab = (['leave', 'org'].includes(search.get('tab') ?? '') ? search.get('tab') : 'directory') as Tab;
  const [former, setFormer] = useState(false); const [version, setVersion] = useState(0);
  const list = useLoad<Person[]>(() => api.get(`/api/people${former ? '?former=1' : ''}`), [former, version]);
  const summary = useLoad<any>(() => api.get('/api/people/summary'), [version]);
  const people = list.data ?? [];
  const wide = useMedia('(min-width: 1280px)');
  // the selected person lives in the address, so a profile can be linked to and Back works
  const urlPerson = search.get('person');
  const [sel, setSel] = useState<string | null>(urlPerson);
  useEffect(() => { if (urlPerson) setSel(urlPerson); }, [urlPerson]);
  useEffect(() => { if (wide && !sel && !urlPerson && people.length && tab === 'directory') setSel(people.find((p) => p.user_id === me.id)?.id ?? people[0]!.id); }, [wide, people.length, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [form, setForm] = useState<{ person?: Person } | null>(null);
  useEffect(() => { const id = search.get('edit') && search.get('person'); if (id && people.length) { const p = people.find((x) => x.id === id); if (p) setForm({ person: p }); go(`/people?person=${id}`, true); } }, [search, people.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [leaveFor, setLeaveFor] = useState('');
  const bump = () => setVersion((v) => v + 1);
  const pick = (id: string) => { setSel(id); if (!wide) return; };
  const setTab = (t: Tab) => go(`/people${t === 'directory' ? '' : `?tab=${t}`}`, true);
  const [filters, setFilters] = useState({ q: '', dept: '', avail: '', manager: '' });
  const s = summary.data;
  const cards = [
    { k: 'members', tone: '255, 146, 46', icon: 'people', n: s?.members, label: 'Team members', sub: s ? (s.added_month ? <small className="k-trend up">+{s.added_month} this month</small> : <small className="k-trend flat">Nobody new this month</small>) : null, go: () => { setFilters({ q: '', dept: '', avail: '', manager: '' }); setTab('directory'); } },
    { k: 'active', tone: '34, 197, 94', icon: 'today', n: s?.active_today, label: 'Active today', sub: s ? <small className="k-trend flat" title="Used AWTM Forge today. People without a sign-in are not counted.">{s.with_signin ? `${Math.round((s.active_today / s.with_signin) * 100)}% of ${s.with_signin} with a sign-in` : 'Nobody has a sign-in yet'}</small> : null, go: () => { setFilters({ q: '', dept: '', avail: 'active_today', manager: '' }); setTab('directory'); } },
    { k: 'leave', tone: '168, 85, 247', icon: 'calendar', n: s?.on_leave, label: 'On leave', sub: s ? <small className="k-trend flat">{s.members ? `${Math.round((s.on_leave / s.members) * 100)}% of the team today` : 'Nobody yet'}</small> : null, go: () => setTab('leave') },
    { k: 'depts', tone: '59, 130, 246', icon: 'layers', n: s?.departments.length, label: 'Departments', sub: s ? <small className="k-trend flat">{s.departments.length ? s.departments.slice(0, 3).map((d: any) => d.name).join(', ') + (s.departments.length > 3 ? '…' : '') : 'None set yet'}</small> : null, go: () => setTab('org') },
  ];
  const profile = sel && <Profile key={sel} id={sel} version={version} onClose={() => { setSel(null); if (urlPerson) go('/people' + (tab === 'directory' ? '' : `?tab=${tab}`), true); }}
    onEdit={(p) => setForm({ person: people.find((x) => x.id === p.id) ?? p })} onLeave={(p) => { setLeaveFor(p.id); setTab('leave'); }} onChanged={bump} />;
  return (
    <div className={`dash pp${sel && wide ? '' : ' no-rail'}`}>
      <div className="dash-main">
        <div className="hero-row"><div className="hero-text"><h1>People</h1><p className="lede">Your team, responsibilities, reporting lines, and availability, all in one place.</p></div></div>
        {summary.error ? <Failure error={summary.error} retry={() => summary.reload()} /> : <section className="crm-cards" aria-label="Team numbers">{cards.map((c) => { const I = (Icon as any)[c.icon]; return (
          <button key={c.k} type="button" className="crm-card" style={{ '--tone-rgb': c.tone } as React.CSSProperties} onClick={c.go} aria-label={`${c.label}: ${c.n ?? 'loading'}`}>
            <span className="cc-ic" aria-hidden="true">{c.k === 'active' ? <span className="pp-live" /> : <I size={22} />}</span>
            <span className="cc-body"><b>{s ? c.n : <Skeleton h={24} w={40} />}</b><span>{c.label}</span>{c.sub}</span></button>); })}</section>}
        <div className="pp-tabs" role="tablist" aria-label="People views">{([['directory', 'Directory'], ['leave', 'Leave & availability'], ['org', 'Org chart']] as const).map(([k, l]) =>
          <button key={k} role="tab" type="button" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
        {list.error ? <Failure error={list.error} retry={() => list.reload()} />
          : tab === 'directory' ? <Directory people={people} loading={list.loading && !list.data} filters={filters} setFilters={setFilters} former={former} setFormer={setFormer} admin={admin} sel={sel} onPick={pick}
              onAdd={() => setForm({})} onEdit={(p) => setForm({ person: p })} onMessage={async (p) => { try { const c = await api.post('/api/chat/direct', { user_id: p.user_id }); go(`/chat/${c.id}`); } catch (e: any) { toast(e.message, { err: true }); } }} />
          : tab === 'leave' ? (list.loading && !list.data ? <Skeleton h={300} /> : <LeaveView people={people} person={leaveFor} onPerson={pick} onChanged={bump} />)
          : (list.loading && !list.data ? <Skeleton h={300} /> : <OrgChart people={people} selected={sel} onPick={pick} />)}
      </div>
      {sel && wide && <aside className="dash-rail pp-rail" aria-label="Profile">{profile}</aside>}
      {sel && !wide && <Drawer label="Profile" onClose={() => setSel(null)}>{profile}</Drawer>}
      {form && <PersonForm person={form.person} people={people} admin={admin} onClose={() => setForm(null)} onSaved={(id) => { setForm(null); bump(); setSel(id); }} />}
    </div>
  );
}

function Directory({ people, loading, filters, setFilters, former, setFormer, admin, sel, onPick, onAdd, onEdit, onMessage }: {
  people: Person[]; loading: boolean; filters: { q: string; dept: string; avail: string; manager: string }; setFilters: (f: any) => void; former: boolean; setFormer: (b: boolean) => void; admin: boolean;
  sel: string | null; onPick: (id: string) => void; onAdd: () => void; onEdit: (p: Person) => void; onMessage: (p: Person) => void }) {
  const me = useMe(); const toast = useToast(); const { go } = useRouter(); const [page, setPage] = useState(1); const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null); useKeys({ '/': () => ref.current?.focus() });
  const f = filters; const set = (k: string, v: string) => { setFilters({ ...f, [k]: v }); setPage(1); };
  const depts = useMemo(() => [...new Set(people.map((p) => p.department).filter(Boolean))].sort() as string[], [people]);
  const managers = useMemo(() => people.filter((p) => people.some((x) => x.manager_id === p.id)), [people]);
  const shown = useMemo(() => { const t = f.q.trim().toLowerCase();
    return people.filter((p) => (!t || [p.full_name, p.work_email, p.job_title, p.department, p.location, ...p.skills].some((x) => x?.toLowerCase().includes(t)))
      && (!f.dept || (f.dept === 'none' ? !p.department : p.department === f.dept))
      && (!f.avail || (f.avail === 'active_today' ? ['active', 'today'].includes(p.availability) : p.availability === f.avail))
      && (!f.manager || (f.manager === 'none' ? !p.manager_id : p.manager_id === f.manager))); }, [people, f]);
  const pages = Math.max(1, Math.ceil(shown.length / SIZE)); const cur = Math.min(page, pages); const rows = shown.slice((cur - 1) * SIZE, cur * SIZE);
  const active = Object.values(f).some(Boolean);
  // arrow keys move the selection through the rows
  const keyNav = (e: React.KeyboardEvent, i: number) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = rows[i + (e.key === 'ArrowDown' ? 1 : -1)]; if (n) { onPick(n.id); (document.querySelector(`[data-row="${n.id}"]`) as HTMLElement | null)?.focus(); } } };
  return (
    <section className="panel pp-dir" aria-label="Directory">
      <div className="pp-tools">
        <label className="tb-search pp-search"><Icon.find size={15} /><input ref={ref} value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="Search people, roles, skills…" aria-label="Search people, roles and skills" aria-keyshortcuts="/" /></label>
        <button type="button" className="btn pp-filter-tog" aria-expanded={open} onClick={() => setOpen(!open)}><Icon.funnel size={14} />Filters{active ? ' ·' : ''}</button>
        <div className={`pp-filters${open ? ' open' : ''}`}>
          <select value={f.dept} onChange={(e) => set('dept', e.target.value)} aria-label="Department"><option value="">Department</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}<option value="none">No department</option></select>
          <select value={f.avail} onChange={(e) => set('avail', e.target.value)} aria-label="Availability"><option value="">Status</option><option value="active">Active now</option><option value="active_today">Active today</option>
            {(['away', 'on_leave', 'never', 'no_signin'] as Avail[]).map((k) => <option key={k} value={k}>{AVAIL[k].label}</option>)}{former && <option value="former">Left</option>}</select>
          <select value={f.manager} onChange={(e) => set('manager', e.target.value)} aria-label="Manager"><option value="">Manager</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}<option value="none">Reports to nobody</option></select>
          <label className="pp-check"><input type="checkbox" className="check" checked={former} onChange={(e) => { setFormer(e.target.checked); setPage(1); }} />Include former team members</label>
        </div>
        {admin && <button type="button" className="btn primary pp-add" onClick={onAdd}><Icon.plus size={15} />Add person</button>}
      </div>
      {active && <div className="pp-active"><span>{shown.length} of {people.length} shown</span><button type="button" className="link-btn" onClick={() => setFilters({ q: '', dept: '', avail: '', manager: '' })}>Clear filters</button></div>}
      {loading ? <div className="crm-skel">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={52} />)}</div>
        : !people.length ? <Empty title="Nobody in the directory yet" action={admin ? <button type="button" className="btn primary" onClick={onAdd}><Icon.plus size={15} />Add person</button> : undefined}>{admin ? 'Add the team, starting with yourself. Link each person to their sign-in so they can ask for leave and be messaged.' : 'An admin adds people here.'}</Empty>
        : !shown.length ? <Empty title="Nobody matches" action={<button type="button" className="btn" onClick={() => setFilters({ q: '', dept: '', avail: '', manager: '' })}>Clear filters</button>}>Search reads names, emails, titles, departments, locations and skills.</Empty>
        : <div className="scrollx"><table className="ctable pp-table">
          <thead><tr><th>Person</th><th>Role</th><th>Department</th><th>Reports to</th><th>Availability</th><th>Location</th><th className="num"><span className="sr">Actions</span></th></tr></thead>
          <tbody>{rows.map((p, i) => <tr key={p.id} data-row={p.id} tabIndex={0} className={`click${sel === p.id ? ' sel' : ''}${p.status === 'EXITED' ? ' gone' : ''}`} aria-selected={sel === p.id}
            onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a, .menu-wrap')) onPick(p.id); }} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onPick(p.id); else keyNav(e, i); }}>
            <td><div className="c-name"><PAvatar p={p} size={38} /><div><b>{p.full_name}{p.user_id === me.id && <small className="pp-you"> you</small>}</b><span>{p.work_email ?? 'No email'}</span></div></div></td>
            <td><RolePill p={p} /></td><td>{p.department ?? <span className="faint">None</span>}</td>
            <td>{p.manager_name ?? <span className="faint">Nobody</span>}</td><td><AvailPill p={p} /></td>
            <td>{p.location ? <span className="pp-loc"><Icon.globe size={13} />{p.location}</span> : <span className="faint">Not set</span>}</td>
            <td className="num"><Menu label={`Actions for ${p.full_name}`} className="icon-btn" button={<Dots size={16} />} place="left">{(close) => <>
              <MenuItem onSelect={() => { close(); onPick(p.id); }}><Icon.user size={15} />View profile</MenuItem>
              {p.user_id && p.user_id !== me.id && p.signin_active && <MenuItem onSelect={() => { close(); onMessage(p); }}><Icon.chat size={15} />Message</MenuItem>}
              {(admin || p.user_id === me.id) && <MenuItem onSelect={() => { close(); onEdit(p); }}><Icon.edit size={15} />Edit profile</MenuItem>}
              {p.work_email && <MenuItem onSelect={async () => { close(); toast((await copy(p.work_email!)) ? 'Email copied.' : 'Could not copy.'); }}><Icon.copy size={15} />Copy email</MenuItem>}
              <MenuItem onSelect={() => { close(); go(`/people/${p.id}`); }}><Icon.arrow size={15} />Full record{admin ? ' and pay' : ''}</MenuItem></>}</Menu></td>
          </tr>)}</tbody></table></div>}
      {shown.length > 0 && <div className="pager"><span>Showing {(cur - 1) * SIZE + 1} to {Math.min(shown.length, cur * SIZE)} of {shown.length} {shown.length === 1 ? 'person' : 'people'}</span>
        {pages > 1 && <nav className="pg-nav" aria-label="Pages"><button type="button" className="icon-btn" disabled={cur <= 1} onClick={() => setPage(cur - 1)} aria-label="Previous page"><Icon.left size={15} /></button><span className="faint">{cur} of {pages}</span><button type="button" className="icon-btn" disabled={cur >= pages} onClick={() => setPage(cur + 1)} aria-label="Next page"><Icon.right size={15} /></button></nav>}</div>}
    </section>
  );
}
