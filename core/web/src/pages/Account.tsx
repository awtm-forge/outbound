import { useState } from 'react';
import { api, type Me } from '../api.ts';
import { useToast } from '../ui/toast.tsx';
import { Spinner } from '../ui/kit.tsx';

// Your name, email and password. Also the whole screen when an admin set your password and you have not chosen your own.
export function Account({ me, forced, onChanged }: { me: Me; forced?: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(me.name); const [email, setEmail] = useState(me.email ?? ''); const [savingProfile, setSavingProfile] = useState(false);
  const [current, setCurrent] = useState(''); const [next, setNext] = useState(''); const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (next !== again) return setErr('The two new passwords are not the same.');
    setBusy(true);
    try { await api.post('/api/me/password', { current, next }); setCurrent(''); setNext(''); setAgain(''); toast('Password changed. Other devices are signed out.'); onChanged(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault(); setSavingProfile(true);
    try { await api.post('/api/me/profile', { name, email }); toast('Saved.'); onChanged(); } catch (e: any) { toast(e.message, { err: true }); } finally { setSavingProfile(false); }
  };
  const pwForm = (
    <form className="card col" onSubmit={changePassword} style={{ maxWidth: 460 }}>
      <h2>{forced ? 'Choose your own password' : 'Password'}</h2>
      {forced && <p className="muted">An admin set a temporary password for you. Pick one only you know; at least 10 characters.</p>}
      <label className="field"><span>{forced ? 'Temporary password' : 'Current password'}</span><input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
      <label className="field"><span>New password</span><input type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required /></label>
      <label className="field"><span>New password again</span><input type="password" autoComplete="new-password" minLength={10} value={again} onChange={(e) => setAgain(e.target.value)} required /></label>
      {err && <div className="banner err" role="alert">{err}</div>}
      <div><button className="btn primary" disabled={busy}>{busy && <Spinner />}Change password</button></div>
    </form>
  );
  if (forced) return <div className="login">{pwForm}</div>;
  return (
    <div className="page">
      <div className="head"><div><h1>Your account</h1><p>Signed in as <b>{me.user}</b>, {me.role === 'admin' ? 'an admin' : 'a member'}.</p></div></div>
      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 'var(--s-5)' }}>
        <form className="card col" onSubmit={saveProfile} style={{ maxWidth: 460, flex: 1 }}>
          <h2>Profile</h2>
          <label className="field"><span>Name people see</span><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} /></label>
          <label className="field"><span>Email (you can sign in with it)</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <div><button className="btn" disabled={savingProfile}>{savingProfile && <Spinner />}Save</button></div>
        </form>
        <div style={{ flex: 1, minWidth: 300 }}>{pwForm}</div>
      </div>
    </div>
  );
}
