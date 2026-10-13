// The org chart, from each person's "reports to" and nothing else. People with no manager start a branch; people with
// no manager and nobody reporting to them are listed apart, so no hierarchy is invented for them.
import { useMemo, useState } from 'react';
import { Icon } from '../../ui/icons.tsx';
import { Empty } from '../../ui/kit.tsx';
import { AvailPill, PAvatar, deptColor, rgb, type Person } from './shared.tsx';

export function OrgChart({ people, selected, onPick }: { people: Person[]; selected: string | null; onPick: (id: string) => void }) {
  const live = useMemo(() => people.filter((p) => p.status !== 'EXITED'), [people]);
  const kids = useMemo(() => { const ids = new Set(live.map((p) => p.id)); const m = new Map<string | null, Person[]>();
    for (const p of live) { const k = p.manager_id && ids.has(p.manager_id) ? p.manager_id : null; m.set(k, [...(m.get(k) ?? []), p]); }
    for (const l of m.values()) l.sort((a, b) => a.full_name.localeCompare(b.full_name)); return m; }, [live]);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const roots = (kids.get(null) ?? []).filter((p) => kids.has(p.id)); const loose = (kids.get(null) ?? []).filter((p) => !kids.has(p.id));
  if (!live.length) return <div className="panel"><Empty title="Nobody in the directory yet">Add people on the Directory tab, then set who each person reports to.</Empty></div>;
  const count = (id: string): number => (kids.get(id) ?? []).reduce((n, c) => n + 1 + count(c.id), 0);
  const node = (p: Person): React.ReactNode => {
    const ch = kids.get(p.id) ?? []; const open = !closed.has(p.id);
    return <li key={p.id} role="treeitem" aria-expanded={ch.length ? open : undefined} aria-selected={selected === p.id}>
      <div className={`oc-card${selected === p.id ? ' on' : ''}`} style={{ '--d-rgb': rgb(deptColor(p.department)) } as React.CSSProperties}>
        <button type="button" className="oc-open" onClick={() => onPick(p.id)} aria-label={`Open ${p.full_name}'s profile`}>
          <PAvatar p={p} size={36} /><span className="oc-text"><b>{p.full_name}</b><small>{p.job_title ?? 'No title'}</small>{p.department && <em>{p.department}</em>}</span></button>
        <AvailPill p={p} short />
        {ch.length > 0 && <button type="button" className="oc-tog" onClick={() => { const s = new Set(closed); open ? s.add(p.id) : s.delete(p.id); setClosed(s); }} aria-label={`${open ? 'Hide' : 'Show'} the ${count(p.id)} people under ${p.full_name}`}>
          {open ? <Icon.minus size={12} /> : <Icon.plus size={12} />}{count(p.id)}</button>}
      </div>
      {ch.length > 0 && open && <ul role="group">{ch.map(node)}</ul>}
    </li>;
  };
  return <div className="col" style={{ gap: 14 }}>
    {roots.length > 0 && <section className="panel oc-wrap" aria-label="Reporting lines">
      <div className="pp-sec-h"><h3>Reporting lines</h3><span className="row" style={{ gap: 8 }}><button type="button" className="btn tiny ghost" onClick={() => setClosed(new Set())}>Expand all</button><button type="button" className="btn tiny ghost" onClick={() => setClosed(new Set(live.filter((p) => kids.has(p.id)).map((p) => p.id)))}>Collapse all</button></span></div>
      <div className="oc-scroll"><ul className="oc-tree" role="tree" aria-label="Org chart">{roots.map(node)}</ul></div></section>}
    {loose.length > 0 && <section className="panel oc-loose" aria-labelledby="oc-loose-h">
      <div className="pp-sec-h"><h3 id="oc-loose-h">No reporting line yet</h3><span className="faint">{loose.length} {loose.length === 1 ? 'person' : 'people'} with no manager and nobody under them. Set Reports to on their profile.</span></div>
      <ul className="oc-flat">{loose.map((p) => <li key={p.id}><div className={`oc-card${selected === p.id ? ' on' : ''}`} style={{ '--d-rgb': rgb(deptColor(p.department)) } as React.CSSProperties}>
        <button type="button" className="oc-open" onClick={() => onPick(p.id)} aria-label={`Open ${p.full_name}'s profile`}><PAvatar p={p} size={36} /><span className="oc-text"><b>{p.full_name}</b><small>{p.job_title ?? 'No title'}</small>{p.department && <em>{p.department}</em>}</span></button>
        <AvailPill p={p} short /></div></li>)}</ul></section>}
  </div>;
}
