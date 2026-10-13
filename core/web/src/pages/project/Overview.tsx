import { useEffect, useState } from 'react';
import { api } from '../../api.ts';
import { Link, useRouter } from '../../router.tsx';
import { useLoad } from '../../ui/hooks.ts';
import { Icon } from '../../ui/icons.tsx';
import { Menu, MenuItem } from '../../ui/menu.tsx';
import { Modal, useConfirm } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Skeleton, Spinner, ago, todayIST } from '../../ui/kit.tsx';
import { useTeam } from '../../session.tsx';
import { Avatar, STATUS_COLOR, STATUS_ORDER, TASK_STATUS, daysFrom, describe, shortDay } from './shared.tsx';
import type { WS } from './Workspace.tsx';

// Health from what is recorded: late work, blocked work, missed milestones, and the project's own date. No score.
export function health(ws: WS) {
  const { p } = ws; const today = todayIST(); const open = p.task_list.filter((t) => t.status !== 'DONE');
  const late = open.filter((t) => t.due_date && t.due_date < today).length;
  const missed = p.milestones.filter((m) => m.status === 'OPEN' && m.target_date && m.target_date < today);
  const reasons: string[] = [];
  if (late) reasons.push(`${late} ${late === 1 ? 'task is' : 'tasks are'} past due`);
  if (p.counts.blocked) reasons.push(`${p.counts.blocked} ${p.counts.blocked === 1 ? 'task is' : 'tasks are'} waiting on other work`);
  if (missed.length) reasons.push(`${missed.length === 1 ? `“${missed[0].name}” is` : `${missed.length} milestones are`} past the target date`);
  const projectLate = p.due_date && p.due_date < today && p.status !== 'DONE' && open.length > 0;
  if (projectLate) reasons.push('the project is past its due date with work still open');
  if (!p.tasks) return { label: 'Not started', tone: 'neutral', text: 'No tasks yet. Add the first one to start tracking.', reasons };
  if (p.status === 'DONE') return { label: 'Done', tone: 'success', text: 'This project is marked done.', reasons };
  if (projectLate || late >= 3) return { label: 'At risk', tone: 'danger', text: `${p.done} of ${p.tasks} tasks completed.`, reasons };
  if (reasons.length) return { label: 'Needs attention', tone: 'warning', text: `${p.done} of ${p.tasks} tasks completed. A few items need attention to stay on track.`, reasons };
  return { label: 'On track', tone: 'success', text: `${p.done} of ${p.tasks} tasks completed. Nothing is late or blocked.`, reasons };
}

export function Overview({ ws }: { ws: WS }) {
  const { p } = ws; const { search, go } = useRouter(); const toast = useToast(); const ask = useConfirm();
  const today = todayIST(); const open = p.task_list.filter((t) => t.status !== 'DONE');
  const pct = p.tasks ? Math.round((p.done / p.tasks) * 100) : 0;
  const [addMs, setAddMs] = useState(search.get('add') === 'milestone');
  useEffect(() => { if (search.get('add') === 'milestone') setAddMs(true); }, [search]);
  const closeMs = () => { setAddMs(false); if (search.get('add')) go(`/projects/${p.id}`, true); };
  const nums: [string, number, string?][] = [['Total tasks', p.tasks], ['Completed', p.done, 'g'], ['In progress', p.doing, 'o'], ['Blocked', p.counts.blocked, 'r'], ['Overdue', open.filter((t) => t.due_date && t.due_date < today).length, 'r'], ['Due today', p.counts.due_today, 'y']];
  const removeLink = async (l: any) => { if (!(await ask({ title: `Remove “${l.title}”?`, confirm: 'Remove' }))) return; try { await api.del(`/api/links/${l.id}`); ws.reload(); } catch (e: any) { toast(e.message, { err: true }); } };
  return (
    <div className="ov">
      <section className="panel ov-summary" aria-label="Progress">
        <div className="ov-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50" className="rt" /><circle cx="60" cy="60" r="50" className="rv" strokeDasharray={`${(pct / 100) * 314} 314`} transform="rotate(-90 60 60)" /></svg>
          <b>{pct}%</b><span>{p.done} of {p.tasks} tasks completed</span></div>
        <dl className="ov-nums">{nums.map(([l, n, tone]) => <div key={l}><dt>{l}</dt><dd className={tone && n ? `n-${tone}` : ''}>{n}</dd></div>)}</dl>
      </section>
      <div className="ov-grid">
        <section className="panel ov-about" aria-labelledby="about-h"><h2 id="about-h">About this project</h2>
          <p>{p.description || <span className="faint">No description yet. Add one in Settings.</span>}</p>
          {(() => { const labels = [...new Set(p.task_list.flatMap((t) => t.labels))].slice(0, 10); return labels.length > 0 && <div className="labels">{labels.map((l) => <Link key={l} to={`/projects/${p.id}/list?label=${encodeURIComponent(l)}`} className="lbl">{l}</Link>)}</div>; })()}
          <p className="faint" style={{ fontSize: 12 }}>Started {shortDay(p.created_at.slice(0, 10))}{p.owner_name ? ` · owned by ${p.owner_name}` : ''}</p></section>
        <section className="panel" aria-labelledby="links-h"><div className="panel-head"><h2 id="links-h"><span className="ic"><Icon.link size={18} /></span>Quick links</h2></div>
          <ul className="qlinks">{p.links.map((l) => <li key={l.id}><Icon.file size={15} /><a href={l.url} target="_blank" rel="noreferrer">{l.title}<span className="sr"> (opens in a new tab)</span></a>
            <button type="button" className="icon-btn" onClick={() => removeLink(l)} aria-label={`Remove ${l.title}`}><Icon.x size={13} /></button></li>)}</ul>
          {!p.links.length && <p className="ov-empty">Brief, designs, staging, client folder: keep the links here.</p>}
          <AddLink ws={ws} /></section>
        <section className="panel" aria-labelledby="ms-h"><div className="panel-head"><h2 id="ms-h"><span className="ic"><Icon.target size={18} /></span>Upcoming milestones</h2><span className="meta" style={{ marginLeft: 'auto' }}>{p.milestones.filter((m) => m.status === 'OPEN').length} open</span></div>
          <ul className="ms-list">{p.milestones.map((m) => { const d = m.target_date ? daysFrom(today, m.target_date) : null; return (
            <li key={m.id} className={m.status === 'DONE' ? 'done' : d != null && d < 0 ? 'late' : ''}><span className="ms-dot" aria-hidden="true" /><div><b>{m.name}</b><span>{m.tasks ? `${m.done} of ${m.tasks} tasks` : 'No tasks linked'}</span></div>
              <div className="ms-when">{m.target_date ? shortDay(m.target_date) : 'No date'}<small>{m.status === 'DONE' ? 'Reached' : d == null ? '' : d < 0 ? `${-d} ${d === -1 ? 'day' : 'days'} late` : d === 0 ? 'Today' : `In ${d} ${d === 1 ? 'day' : 'days'}`}</small></div>
              <MilestoneMenu ws={ws} m={m} /></li>); })}</ul>
          {!p.milestones.length && <p className="ov-empty">No milestones yet.</p>}
          <button type="button" className="link-accent" style={{ margin: '0 16px 14px' }} onClick={() => setAddMs(true)}><Icon.plus size={14} />Add milestone</button></section>
      </div>
      <RecentActivity ws={ws} />
      {addMs && <MilestoneForm ws={ws} onClose={closeMs} />}
    </div>
  );
}

function AddLink({ ws }: { ws: WS }) {
  const toast = useToast(); const [open, setOpen] = useState(false); const [f, setF] = useState({ title: '', url: '' }); const [busy, setBusy] = useState(false);
  const add = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); try { await api.post(`/api/projects/${ws.p.id}/links`, f); setF({ title: '', url: '' }); setOpen(false); ws.reload(); } catch (x: any) { toast(x.message, { err: true }); } finally { setBusy(false); } };
  return open ? <form className="ql-form" onSubmit={add}><input autoFocus required placeholder="Name" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="Link name" maxLength={120} />
    <input required type="url" placeholder="https://" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} aria-label="Address" />
    <button className="btn tiny primary" disabled={busy}>{busy ? <Spinner /> : 'Add'}</button><button type="button" className="btn tiny ghost" onClick={() => setOpen(false)}>Cancel</button></form>
    : <button type="button" className="link-accent" style={{ margin: '0 16px 14px' }} onClick={() => setOpen(true)}><Icon.plus size={14} />Add link</button>;
}

function MilestoneMenu({ ws, m }: { ws: WS; m: any }) {
  const toast = useToast(); const ask = useConfirm(); const [edit, setEdit] = useState(false);
  const patch = async (b: object) => { try { await api.patch(`/api/milestones/${m.id}`, b); ws.reload(); } catch (e: any) { toast(e.message, { err: true }); } };
  return <>
    <Menu label={`Actions for ${m.name}`} className="icon-btn" button={<Icon.down size={14} />}>{(close) => <>
      <MenuItem onSelect={() => { close(); patch({ status: m.status === 'DONE' ? 'OPEN' : 'DONE' }); }}><Icon.checkCircle size={15} />{m.status === 'DONE' ? 'Reopen' : 'Mark reached'}</MenuItem>
      <MenuItem onSelect={() => { close(); setEdit(true); }}><Icon.edit size={15} />Edit</MenuItem>
      <MenuItem onSelect={async () => { close(); if (await ask({ title: `Remove “${m.name}”?`, body: 'Tasks linked to it stay, without a milestone.', confirm: 'Remove', tone: 'danger' })) { try { await api.del(`/api/milestones/${m.id}`); ws.reload(); } catch (e: any) { toast(e.message, { err: true }); } } }}><Icon.trash size={15} />Remove</MenuItem></>}</Menu>
    {edit && <MilestoneForm ws={ws} m={m} onClose={() => setEdit(false)} />}</>;
}
export function MilestoneForm({ ws, m, onClose }: { ws: WS; m?: any; onClose: () => void }) {
  const toast = useToast(); const team = useTeam();
  const [f, setF] = useState({ name: m?.name ?? '', description: m?.description ?? '', target_date: m?.target_date ?? '', owner_id: m?.owner_id ?? '' }); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true);
    try { const b = { ...f, owner_id: f.owner_id || null }; if (m) await api.patch(`/api/milestones/${m.id}`, b); else await api.post(`/api/projects/${ws.p.id}/milestones`, b); toast(m ? 'Milestone saved.' : 'Milestone added.'); ws.reload(); onClose(); }
    catch (x: any) { toast(x.message, { err: true }); setBusy(false); } };
  return <Modal title={m ? 'Edit milestone' : 'New milestone'} onClose={onClose}><form className="col" onSubmit={submit}>
    <label className="field"><span>Name</span><input autoFocus required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Design review" /></label>
    <label className="field"><span>What it means</span><textarea rows={2} maxLength={2000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
    <div className="grid2"><label className="field"><span>Target date</span><input type="date" value={f.target_date} onChange={(e) => setF({ ...f, target_date: e.target.value })} /></label>
      <label className="field"><span>Owner</span><select value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })}><option value="">Nobody</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label></div>
    <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !f.name.trim()}>{busy && <Spinner />}{m ? 'Save' : 'Add milestone'}</button></div>
  </form></Modal>;
}

function RecentActivity({ ws }: { ws: WS }) {
  const { data, loading } = useLoad<any[]>(() => api.get(`/api/projects/${ws.p.id}/activity`), [ws.p.id, ws.p.last_updated?.created_at]);
  return (
    <section className="panel" aria-labelledby="ra-h"><div className="panel-head"><h2 id="ra-h"><span className="ic"><Icon.clock size={18} /></span>Recent activity</h2><Link to={`/projects/${ws.p.id}/activity`} className="link-accent" style={{ marginLeft: 'auto' }}>View all</Link></div>
      {loading && !data ? <div style={{ padding: '0 16px 16px' }}><Skeleton h={120} /></div> : !data?.length ? <p className="ov-empty">Nothing recorded yet.</p>
        : <ul className="ra-list">{data.slice(0, 6).map((a) => { const d = describe(a); return (
          <li key={a.id}><Avatar name={a.actor_name ?? '?'} /><div><p><b>{a.actor_name ?? 'Someone'}</b> {d.verb}{d.what ? <> <button type="button" className="link-btn" onClick={() => a.detail?.task_id && ws.openTask(a.detail.task_id)} disabled={!a.detail?.task_id}>{d.what}</button></> : null}{d.note && !d.note.startsWith('“') ? ` ${d.note}` : ''}<span className="when"> · {ago(a.created_at)}</span></p>
            {d.note?.startsWith('“') && <q>{d.note.slice(1, -1)}</q>}</div></li>); })}</ul>}
    </section>
  );
}

export function Rail({ ws }: { ws: WS }) {
  const { p } = ws; const toast = useToast(); const team = useTeam(); const { go } = useRouter(); const h = health(ws);
  const [addMs, setAddMs] = useState(false);
  const pct = p.tasks ? Math.round((p.done / p.tasks) * 100) : 0;
  const next = p.milestones.filter((m) => m.status === 'OPEN').sort((a, b) => String(a.target_date ?? '9').localeCompare(String(b.target_date ?? '9')))[0];
  const by = STATUS_ORDER.map((s) => [s, p.task_list.filter((t) => t.status === s).length] as const);
  let acc = 0; const R = 30; const C = 2 * Math.PI * R;
  const addMember = async (uid: string) => { try { await api.post(`/api/projects/${p.id}/members`, { user_id: uid }); ws.reload(); } catch (e: any) { toast(e.message, { err: true }); } };
  const notIn = team.filter((u) => !p.members.some((m) => m.id === u.id));
  return (
    <aside className="pws-rail" aria-label="Project summary">
      <section className="panel rh" aria-labelledby="h-h">
        <div className="rh-head"><Icon.today size={18} /><h2 id="h-h">Project health</h2><span className={`hbadge ${h.tone}`}>{h.label}</span></div>
        <p>{h.text}</p>{h.reasons.length > 0 && <ul className="rh-why">{h.reasons.map((r) => <li key={r}>{r[0]!.toUpperCase() + r.slice(1)}.</li>)}</ul>}
        <div className="rh-bar"><span className="pbar"><i style={{ width: `${pct}%` }} /></span><b>{pct}%</b></div>
      </section>
      <section className="panel rnext" aria-labelledby="nm-h"><h2 id="nm-h"><Icon.target size={17} />Next milestone</h2>
        {next ? <Link to={`/projects/${p.id}`} className="rn-row"><span className="ms-dot" aria-hidden="true" /><b>{next.name}</b><span className={next.target_date && next.target_date < todayIST() ? 'late' : ''}>{next.target_date ? shortDay(next.target_date) : 'No date'}</span><Icon.right size={14} /></Link>
          : <div className="rn-empty"><p className="faint">No open milestones.</p><button type="button" className="btn tiny" onClick={() => setAddMs(true)}><Icon.plus size={13} />Add milestone</button></div>}</section>
      <section className="panel" aria-labelledby="tb-h"><h2 id="tb-h" className="rail-h">Task breakdown</h2>
        <div className="donut"><svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r={R} className="rt" />{p.tasks > 0 && by.map(([s, n]) => { const len = (n / p.tasks) * C; const el = <circle key={s} cx="40" cy="40" r={R} fill="none" stroke={STATUS_COLOR[s]} strokeWidth="8" strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 40 40)" />; acc += len; return el; })}</svg>
          <ul>{by.map(([s, n]) => <li key={s}><i style={{ background: STATUS_COLOR[s] }} aria-hidden="true" />{n} {TASK_STATUS[s]}<span>{p.tasks ? Math.round((n / p.tasks) * 100) : 0}%</span></li>)}</ul></div></section>
      <section className="panel" aria-labelledby="tm-h"><h2 id="tm-h" className="rail-h">Team members</h2>
        <ul className="rteam">{p.members.map((m) => <li key={m.id}><Avatar name={m.name} size="md" /><div><b>{m.name}</b><span>{m.owner ? 'Owner' : m.role === 'admin' ? 'Admin' : 'Member'}</span></div></li>)}
          {notIn.length > 0 && <li><Menu label="Add a team member" className="icon-btn add-m" place="up left" button={<Icon.plus size={16} />}>{(close) => <>{notIn.map((u) => <MenuItem key={u.id} onSelect={() => { close(); addMember(u.id); }}><Avatar name={u.name} size="xs" />{u.name}</MenuItem>)}</>}</Menu></li>}</ul></section>
      <section className="panel" aria-labelledby="qa2-h"><h2 id="qa2-h" className="rail-h">Quick actions</h2>
        <div className="qacts">
          <button type="button" onClick={() => setAddMs(true)}><Icon.target size={16} />Add milestone<Icon.right size={14} /></button>
          <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(`${location.origin}/projects/${p.id}`); toast('Link copied. Everyone signed in can open it.'); } catch { toast('Could not copy the link.', { err: true }); } }}><Icon.share size={16} />Share project link<Icon.right size={14} /></button>
          <button type="button" onClick={() => go(`/projects/${p.id}/files?upload=1`)}><Icon.upload size={16} />Upload file<Icon.right size={14} /></button>
          <button type="button" onClick={() => go(`/projects/${p.id}/notes?new=1`)}><Icon.wiki size={16} />Add project note<Icon.right size={14} /></button>
          {(p as any).company_id && <button type="button" onClick={() => go(`/crm/companies/${(p as any).company_id}`)}><Icon.crm size={16} />View the client in CRM<Icon.right size={14} /></button>}
          <button type="button" onClick={() => go(`/projects/${p.id}/settings`)}><Icon.settings size={16} />Project settings<Icon.right size={14} /></button>
        </div></section>
      {addMs && <MilestoneForm ws={ws} onClose={() => setAddMs(false)} />}
    </aside>
  );
}
