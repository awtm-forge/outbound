import { useState } from 'react';
import { api } from '../api.ts';
import { useLoad } from '../ui/hooks.ts';
import { useToast } from '../ui/toast.tsx';
import { Failure, Loading, Spinner, ago, initials } from '../ui/kit.tsx';
import { refreshTeam, useMe } from '../session.tsx';

// Admins only: who can sign in, with which role. Passwords set here are temporary.
export function Team() {
  const me = useMe(); const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api.get<any[]>('/api/users'));
  const [form, setForm] = useState({ username: '', name: '', email: '', role: 'member', password: '' }); const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState<{ id: string; password: string } | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await api.post('/api/users', form); toast(`${form.name} can sign in as ${form.username}. Give them the temporary password; they choose their own next.`); setForm({ username: '', name: '', email: '', role: 'member', password: '' }); refreshTeam(); reload(true); }
    catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(false); }
  };
  const update = async (id: string, patch: object, done: string) => {
    try { await api.patch(`/api/users/${id}`, patch); toast(done); refreshTeam(); reload(true); } catch (e: any) { toast(e.message, { err: true }); }
  };
  const doReset = async (e: React.FormEvent) => {
    e.preventDefault(); if (!reset) return;
    try { await api.post(`/api/users/${reset.id}/password`, { password: reset.password }); toast('Temporary password set. They are signed out everywhere.'); setReset(null); reload(true); } catch (e: any) { toast(e.message, { err: true }); }
  };
  if (loading && !data) return <div className="page"><Loading rows={4} /></div>;
  if (error) return <div className="page"><Failure error={error} retry={reload} /></div>;
  return (
    <div className="page">
      <div className="head"><div><h1>Team</h1><p>Everyone who can sign in. Admins manage people and see salaries; members use everything else.</p></div></div>
      <div className="card flush scrollx"><table className="t">
        <thead><tr><th>Person</th><th>Sign-in name</th><th>Role</th><th>Last signed in</th><th /></tr></thead>
        <tbody>{data!.map((u) => <tr key={u.id} style={{ opacity: u.active ? 1 : 0.55 }}>
          <td><div className="row"><div className="avatar">{initials(u.name)}</div><div><div style={{ fontWeight: 600 }}>{u.name}{u.id === me.id && <span className="faint"> (you)</span>}</div><div className="sub">{u.email ?? 'No email'}</div></div></div></td>
          <td className="mono">{u.username}{u.must_change_password && <div className="sub">Temporary password</div>}</td>
          <td><select className="input" style={{ width: 'auto' }} value={u.role} disabled={!u.active} aria-label={`Role for ${u.name}`} onChange={(e) => update(u.id, { role: e.target.value }, `${u.name} is now ${e.target.value === 'admin' ? 'an admin' : 'a member'}.`)}>
            <option value="member">Member</option><option value="admin">Admin</option></select></td>
          <td className="sub">{u.last_login_at ? ago(u.last_login_at) : 'Never'}</td>
          <td><div className="row" style={{ justifyContent: 'flex-end' }}>
            {u.active && <button className="btn sm ghost" onClick={() => setReset({ id: u.id, password: '' })}>Reset password</button>}
            {u.active ? <button className="btn sm danger" onClick={() => confirm(`Switch off ${u.name}? They are signed out at once and cannot sign in.`) && update(u.id, { active: false }, `${u.name} can no longer sign in.`)}>Switch off</button>
              : <button className="btn sm" onClick={() => update(u.id, { active: true }, `${u.name} can sign in again.`)}>Switch on</button>}
          </div>
          {reset?.id === u.id && <form className="row" onSubmit={doReset} style={{ marginTop: 8, justifyContent: 'flex-end' }}><input className="input" style={{ width: 220 }} placeholder="Temporary password" minLength={10} autoFocus value={reset?.password ?? ""} onChange={(e) => setReset({ id: u.id, password: e.target.value })} /><button className="btn sm primary">Set</button><button type="button" className="btn sm ghost" onClick={() => setReset(null)}>Cancel</button></form>}
          </td></tr>)}</tbody></table></div>
      <form className="card col" onSubmit={add} style={{ maxWidth: 720 }}>
        <h2>Add someone</h2>
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <label className="field grow"><span>Full name</span><input value={form.name} onChange={set('name')} required maxLength={80} /></label>
          <label className="field grow"><span>Sign-in name</span><input value={form.username} onChange={set('username')} required pattern="[A-Za-z0-9._\-]{2,40}" title="Letters, numbers, dot, dash or underscore" /></label>
        </div>
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <label className="field grow"><span>Email (optional)</span><input type="email" value={form.email} onChange={set('email')} /></label>
          <label className="field"><span>Role</span><select value={form.role} onChange={set('role')}><option value="member">Member</option><option value="admin">Admin</option></select></label>
          <label className="field grow"><span>Temporary password</span><input value={form.password} onChange={set('password')} required minLength={10} /></label>
        </div>
        <div><button className="btn primary" disabled={busy}>{busy && <Spinner />}Add to the team</button></div>
      </form>
    </div>
  );
}
