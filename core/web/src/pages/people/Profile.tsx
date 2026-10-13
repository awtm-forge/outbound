// The profile beside the directory: contact, reporting line, skills, projects and upcoming leave, with Message and Edit.
// Only what the record holds is shown; an empty field is left out rather than filled with a guess.
import { useState } from 'react';
import { api } from '../../api.ts';
import { Link, useRouter } from '../../router.tsx';
import { useLoad } from '../../ui/hooks.ts';
import { Icon, Dots } from '../../ui/icons.tsx';
import { Menu, MenuItem } from '../../ui/menu.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Failure, Skeleton, Spinner, copy, dayLabel } from '../../ui/kit.tsx';
import { useMe } from '../../session.tsx';
import { DEFAULT_ACCENT } from '../../ui/color.tsx';
import { AvailPill, KIND, LEAVE_STATUS, PAvatar, TYPE, availText, span, type Person } from './shared.tsx';

const PSTATUS: Record<string, string> = { ACTIVE: 'Active', ON_HOLD: 'On hold', DONE: 'Done', ARCHIVED: 'Archived' };

export function Profile({ id, version, onClose, onEdit, onLeave, onChanged }: { id: string; version: number; onClose: () => void; onEdit: (p: Person) => void; onLeave: (p: Person) => void; onChanged: () => void }) {
  const me = useMe(); const toast = useToast(); const { go } = useRouter();
  const { data: p, error, loading, reload } = useLoad<any>(() => api.get(`/api/people/${id}`), [id, version]);
  const [allProjects, setAllProjects] = useState(false); const [skill, setSkill] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  if (loading && !p) return <div className="pp-prof"><Skeleton h={64} /><Skeleton h={120} /><Skeleton h={160} /></div>;
  if (error) return <div className="pp-prof"><Failure error={error} retry={() => reload()} /></div>;
  const self = p.user_id === me.id;
  const message = async () => { setBusy(true); try { const c = await api.post('/api/chat/direct', { user_id: p.user_id }); go(`/chat/${c.id}`); } catch (e: any) { toast(e.message, { err: true }); setBusy(false); } };
  const saveSkills = async (list: string[]) => { try { await api.patch(`/api/people/${p.id}`, { skills: list }); await reload(true); onChanged(); } catch (e: any) { toast(e.message, { err: true }); } };
  const projects: any[] = p.projects; const shown = allProjects ? projects : projects.slice(0, 3);
  return (
    <div className="pp-prof">
      <header className="pp-prof-head">
        <PAvatar p={p} size={56} />
        <div className="grow"><div className="row wrap" style={{ gap: 8 }}><h2>{p.full_name}</h2><AvailPill p={p} short /></div>
          <p className="pp-prof-title">{p.job_title ?? <span className="faint">No title yet</span>}</p>
          <p className="pp-prof-sub">{p.location && <><Icon.globe size={13} />{p.location}</>}{p.location && <span aria-hidden="true">|</span>}<span>{TYPE[p.employment_type]}</span></p></div>
        <Menu label={`More for ${p.full_name}`} className="icon-btn" button={<Dots size={16} />} place="left">{(close) => <>
          {p.work_email && <MenuItem onSelect={async () => { close(); toast((await copy(p.work_email)) ? 'Email copied.' : 'Could not copy.'); }}><Icon.copy size={15} />Copy email</MenuItem>}
          <MenuItem onSelect={async () => { close(); toast((await copy(`${location.origin}/people?person=${p.id}`)) ? 'Link copied.' : 'Could not copy.'); }}><Icon.link size={15} />Copy link to profile</MenuItem>
          <MenuItem onSelect={() => { close(); go(`/people/${p.id}`); }}><Icon.arrow size={15} />Open full record{p.can_admin ? ' and pay' : ''}</MenuItem>
          <MenuItem onSelect={() => { close(); onLeave(p); }}><Icon.calendar size={15} />Leave details</MenuItem>
          {p.can_edit && <MenuItem onSelect={() => { close(); onEdit(p); }}><Icon.edit size={15} />Edit profile</MenuItem>}</>}</Menu>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close profile"><Icon.x size={16} /></button>
      </header>
      <p className="pp-avail-note">{availText(p)}</p>

      {(p.work_email || p.phone || p.linkedin_url) && <ul className="pp-contact">
        {p.work_email && <li><Icon.mail size={15} /><a href={`mailto:${p.work_email}`}>{p.work_email}</a></li>}
        {p.phone && <li><Icon.message size={15} /><a href={`tel:${p.phone.replace(/[^\d+]/g, '')}`}>{p.phone}</a></li>}
        {p.linkedin_url && <li><span className="pp-in" aria-hidden="true">in</span><a href={p.linkedin_url} target="_blank" rel="noopener noreferrer">{p.linkedin_url.replace(/^https:\/\/(www\.)?/, '')}</a></li>}
      </ul>}

      <dl className="pp-dl">
        <div><dt><Icon.people size={15} />Reports to</dt><dd>{p.manager_id ? <Link to={`/people?person=${p.manager_id}`}>{p.manager_name}</Link> : 'Nobody'}</dd></div>
        <div><dt><Icon.layers size={15} />Department</dt><dd>{p.department ?? 'Not set'}</dd></div>
        {p.reports.length > 0 && <div><dt><Icon.share size={15} />Reporting to them</dt><dd className="pp-reps">{p.reports.map((r: any) => <Link key={r.id} to={`/people?person=${r.id}`} title={r.job_title ?? ''}><PAvatar p={r} size={22} />{r.full_name.split(' ')[0]}</Link>)}</dd></div>}
        {p.start_date && <div><dt><Icon.calendar size={15} />Joined</dt><dd>{dayLabel(p.start_date)}</dd></div>}
      </dl>

      <section className="pp-sec"><div className="pp-sec-h"><h3><Icon.bolt size={15} />Skills</h3>{p.can_edit && skill === null && <button type="button" className="link-btn" onClick={() => setSkill('')}><Icon.plus size={13} />Add</button>}</div>
        {p.skills.length || skill !== null ? <div className="pp-skills">{p.skills.map((s: string) => <span key={s} className="pp-skill">{s}{p.can_edit && <button type="button" onClick={() => saveSkills(p.skills.filter((x: string) => x !== s))} aria-label={`Remove ${s}`}><Icon.x size={11} /></button>}</span>)}
          {skill !== null && <form onSubmit={(e) => { e.preventDefault(); const v = skill.trim(); setSkill(null); if (v && !p.skills.some((x: string) => x.toLowerCase() === v.toLowerCase())) saveSkills([...p.skills, v]); }}>
            <input autoFocus className="pp-skill-in" value={skill} maxLength={40} onChange={(e) => setSkill(e.target.value)} onBlur={(e) => { const v = e.target.value.trim(); setSkill(null); if (v && !p.skills.some((x: string) => x.toLowerCase() === v.toLowerCase())) saveSkills([...p.skills, v]); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setSkill(null); } }} aria-label="New skill" placeholder="Skill" /></form>}</div>
          : <p className="faint">{p.can_edit ? (self ? 'Add what you are good at, so people know who to ask.' : 'No skills added yet.') : 'No skills added yet.'}</p>}</section>

      <section className="pp-sec"><div className="pp-sec-h"><h3><Icon.projects size={15} />Assigned projects ({projects.length})</h3>{projects.length > 3 && <button type="button" className="link-btn" onClick={() => setAllProjects(!allProjects)}>{allProjects ? 'Show fewer' : 'View all'}</button>}</div>
        {!p.user_id ? <p className="faint">Projects follow a sign-in, and {p.full_name.split(' ')[0]} has none.</p> : projects.length ? <ul className="pp-projects">{shown.map((x) =>
          <li key={x.id}><i style={{ background: x.color ?? DEFAULT_ACCENT, color: x.color ?? DEFAULT_ACCENT }} aria-hidden="true" /><Link to={`/projects/${x.id}`}>{x.name}</Link>{x.is_owner && <small className="faint">Owner</small>}{x.open_tasks > 0 && <small className="faint">{x.open_tasks} open</small>}<span className={`pp-pst s-${x.status}`}>{PSTATUS[x.status] ?? x.status}</span></li>)}</ul>
          : <p className="faint">Not on any project yet.</p>}</section>

      <section className="pp-sec"><div className="pp-sec-h"><h3><Icon.calendar size={15} />Upcoming leave</h3><button type="button" className="link-btn" onClick={() => onLeave(p)}>View all</button></div>
        {p.leave.length ? <ul className="pp-leave">{p.leave.map((l: any) => <li key={l.id}><span>{span(l)}</span><small className="faint">{[l.kind && KIND[l.kind], `${Number(l.days)} ${Number(l.days) === 1 ? 'day' : 'days'}`].filter(Boolean).join(' · ')}</small>
          <span className={`pp-lst s-${l.status}`}>{LEAVE_STATUS[l.status]}</span></li>)}</ul>
          : <div className="pp-empty"><Icon.calendar size={20} /><div><b>No upcoming leave</b><small>{p.full_name.split(' ')[0]} has no approved leave ahead.</small></div></div>}</section>

      <footer className="pp-prof-foot">
        {p.user_id && !self && p.signin_active ? <button type="button" className="btn" onClick={message} disabled={busy}>{busy ? <Spinner /> : <Icon.chat size={15} />}Message</button>
          : <button type="button" className="btn" disabled title={self ? 'This is you' : 'No sign-in, so no messages'}><Icon.chat size={15} />Message</button>}
        {p.can_edit ? <button type="button" className="btn primary" onClick={() => onEdit(p)}><Icon.edit size={15} />Edit profile</button>
          : <Link className="btn primary" to={`/people/${p.id}`}><Icon.arrow size={15} />Full record</Link>}
      </footer>
    </div>
  );
}
