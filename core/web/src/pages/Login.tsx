import { useState } from 'react';
import { api } from '../api.ts';
import { Spinner } from '../ui/kit.tsx';
export function Login({ onIn }: { onIn: () => void }) {
  const [user, setUser] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.post('/auth/login', { user, password }); onIn(); } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="login">
      <form onSubmit={submit} aria-label="Sign in">
        <div><div className="mark">awtm <b>forge</b></div><div className="kick">Built in one piece</div></div>
        <label className="field"><span>Name or email</span><input autoFocus autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} required /></label>
        <label className="field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {err && <div className="banner err" role="alert">{err}</div>}
        <button className="btn primary lg" disabled={busy}>{busy && <Spinner />}Sign in</button>
        <p className="faint" style={{ textAlign: 'center', fontSize: 'var(--fs-0)' }}>Outbound and the team workspace. Nothing sends without your say.</p>
      </form>
    </div>
  );
}
