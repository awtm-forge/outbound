import { useState } from 'react';
import { api } from '../../api.ts';
import { Icon } from '../../ui/icons.tsx';
import { useConfirm } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Spinner } from '../../ui/kit.tsx';
import { useTeam } from '../../session.tsx';
import { ColorPicker } from '../../ui/color.tsx';
import { Avatar, PROJECT_STATUS, STATUS_COLOR, TASK_STATUS } from './shared.tsx';
import type { WS } from './Workspace.tsx';

// The project's details, its colour, its team and its board columns, all in one place.
export function Settings({ ws, onPreview }: { ws: WS; onPreview: (c: string | null | undefined) => void }) {
  const { p } = ws; const toast = useToast(); const team = useTeam(); const ask = useConfirm();
  const [f, setF] = useState({ name: p.name, description: p.description }); const [busy, setBusy] = useState(false); const [key, setKey] = useState(0);
  const dirty = f.name !== p.name || f.description !== p.description;
  const save = async (patch: object, msg: string) => { setBusy(true); try { await api.patch(`/api/projects/${p.id}`, patch); ws.reload(); toast(msg); return true; } catch (e: any) { toast(e.message, { err: true }); return false; } finally { setBusy(false); } };
  const removeMember = async (m: any) => { if (!(await ask({ title: `Take ${m.name} off this project's team?`, body: 'Their tasks stay assigned to them.', confirm: 'Remove' }))) return;
    try { await api.del(`/api/projects/${p.id}/members/${m.id}`); ws.reload(); } catch (e: any) { toast(e.message, { err: true }); } };
  const addMember = async (id: string) => { try { await api.post(`/api/projects/${p.id}/members`, { user_id: id }); ws.reload(); } catch (e: any) { toast(e.message, { err: true }); } };
  return (
    <div className="pset">
      <form className="panel pset-sec" onSubmit={(e) => { e.preventDefault(); if (f.name.trim()) save({ name: f.name.trim(), description: f.description }, 'Saved.'); }}>
        <h2>Details</h2>
        <label className="field"><span>Name</span><input required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span>Description</span><textarea rows={3} maxLength={5000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label className="field"><span>Status</span><select value={p.status} onChange={(e) => save({ status: e.target.value }, 'Status changed.')}>{Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <div><button className="btn primary" disabled={!dirty || busy}>{busy && <Spinner />}Save details</button></div>
      </form>
      <section className="panel pset-sec" aria-labelledby="col-h"><h2 id="col-h">Colour</h2>
        <p className="muted">The project's accent on its cards, header, progress and highlights. Workflow colours stay the same everywhere.</p>
        <ColorPicker key={key} value={p.color} name={p.name} onPreview={onPreview} onCancel={() => { onPreview(undefined); setKey(key + 1); }}
          onApply={async (c) => { if (await save({ color: c }, c ? `Colour set to ${c}.` : 'Colour back to the default.')) onPreview(undefined); }} applyLabel="Save colour" busy={busy} /></section>
      <section className="panel pset-sec" aria-labelledby="tm2-h"><h2 id="tm2-h">Team</h2>
        <ul className="pset-team">{p.members.map((m) => <li key={m.id}><Avatar name={m.name} size="md" /><b>{m.name}</b><span className="faint">{m.owner ? 'Owner' : m.role === 'admin' ? 'Admin' : 'Member'}</span>
          {!m.owner && <button type="button" className="btn tiny ghost right" onClick={() => removeMember(m)}>Remove</button>}</li>)}</ul>
        {team.some((u) => !p.members.some((m) => m.id === u.id)) && <label className="field"><span>Add someone</span><select value="" onChange={(e) => e.target.value && addMember(e.target.value)}><option value="">Choose a person</option>{team.filter((u) => !p.members.some((m) => m.id === u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
        <p className="faint" style={{ fontSize: 12 }}>Everyone signed in can open every project; the team is who works on this one.</p></section>
      <section className="panel pset-sec" aria-labelledby="cols-h"><h2 id="cols-h">Board columns</h2>
        <ul className="pset-cols">{p.columns.map((c) => <li key={c.id}><i style={{ background: STATUS_COLOR[c.status] }} aria-hidden="true" /><b>{c.name}</b><span className="faint">counts as {TASK_STATUS[c.status]}{c.wip_limit ? ` · limit ${c.wip_limit}` : ''}</span></li>)}</ul>
        <p className="faint" style={{ fontSize: 12 }}>Add, rename, reorder and remove columns from the board. <a href={`/projects/${p.id}/board`}>Open the board <Icon.arrow size={12} /></a></p></section>
    </div>
  );
}
