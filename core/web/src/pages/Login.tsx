import { useState, type ReactNode } from 'react';
import { api } from '../api.ts';
import { Spinner } from '../ui/kit.tsx';
import { Icon } from '../ui/icons.tsx';

// The way in. Sign-in is the existing name-or-email and password check; nothing here changes how it works.
export function Login({ onIn }: { onIn: () => void }) {
  const [view, setView] = useState<'signin' | 'reset'>('signin');
  return (
    <AuthLayout>
      {view === 'signin' ? <SignIn onIn={onIn} onForgot={() => setView('reset')} /> : <Reset onBack={() => setView('signin')} />}
    </AuthLayout>
  );
}

// Shared by the sign-in screen and the forced password change: the artwork, the brand, and a card on the right.
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-bg" aria-hidden="true" />
      <header className="auth-logo"><Wordmark /></header>
      <section className="auth-pitch" aria-label="About awtm forge">
        <p className="auth-eyebrow">Operate <span aria-hidden="true">·</span> Outbound <span aria-hidden="true">·</span> Grow</p>
        <h2>Your agency<br /><em>operations,</em><br />in one place.</h2>
        <p className="auth-desc">Companies, outreach, emails, campaigns, pipeline, meetings and your team, all in one powerful workspace.</p>
        <ul className="auth-tiles">
          {([['mail', 'Outbound'], ['people', 'Team'], ['chart', 'CRM'], ['bolt', 'Automation']] as const).map(([i, l]) => { const I = Icon[i]; return <li key={l}><span><I size={20} /></span>{l}</li>; })}
        </ul>
      </section>
      <main className="auth-main" id="main">
        <div className="auth-card">{children}</div>
      </main>
    </div>
  );
}
export const Wordmark = ({ big }: { big?: boolean }) => <div className={`auth-mark${big ? ' big' : ''}`}><div className="mark">awtm <b>forge</b></div><span>Built in one piece</span></div>;

function SignIn({ onIn, onForgot }: { onIn: () => void; onForgot: () => void }) {
  const [user, setUser] = useState(''); const [password, setPassword] = useState('');
  const [show, setShow] = useState(false); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState({ user: false, password: false });
  const missUser = !user.trim(); const missPw = !password;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setTouched({ user: true, password: true }); if (missUser || missPw) return;
    setBusy(true); setErr(null);
    try { await api.post('/auth/login', { user, password }); onIn(); } catch (x: any) { setErr(x.message); setBusy(false); }
  };
  return (
    <form onSubmit={submit} aria-labelledby="auth-h" noValidate>
      <Wordmark big />
      <h1 id="auth-h">Welcome back</h1>
      <p className="auth-sub">Sign in to your operations workspace.</p>
      <label className="auth-field"><span className="auth-label">Email or name</span>
        <span className={`auth-input${touched.user && missUser ? ' bad' : ''}`}><Icon.mail size={18} />
          <input autoFocus autoComplete="username" placeholder="Enter your email or name" value={user} onChange={(e) => setUser(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, user: true }))}
            aria-invalid={touched.user && missUser} aria-describedby={touched.user && missUser ? 'user-err' : undefined} required /></span>
        {touched.user && missUser && <span className="auth-err" id="user-err">Write your email or the name you sign in with.</span>}</label>
      <label className="auth-field"><span className="auth-label">Password</span>
        <span className={`auth-input${touched.password && missPw ? ' bad' : ''}`}><Icon.lock size={18} />
          <input type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            aria-invalid={touched.password && missPw} aria-describedby={touched.password && missPw ? 'pw-err' : undefined} required />
          <button type="button" className="auth-eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>{show ? <Icon.eyeOff size={18} /> : <Icon.eye size={18} />}</button></span>
        {touched.password && missPw && <span className="auth-err" id="pw-err">Write your password.</span>}</label>
      <div className="auth-row">
        {/* sessions always last 12 hours on this device; the box states that rather than offering a choice the server does not have */}
        <label className="auth-check" title="You stay signed in on this device for 12 hours"><input type="checkbox" className="sr" checked readOnly disabled aria-describedby="keep-note" /><span className="auth-box" aria-hidden="true"><Icon.check size={14} /></span>Keep me signed in</label>
        <button type="button" className="auth-link" onClick={onForgot}>Forgot your password?</button>
      </div>
      <span id="keep-note" className="sr">You stay signed in on this device for 12 hours.</span>
      {err && <div className="auth-alert" role="alert"><Icon.shield size={16} />{err}</div>}
      <button className="auth-submit" disabled={busy}>{busy ? <><Spinner />Signing in</> : <>Sign in<span className="go"><Icon.arrow size={18} /></span></>}</button>
      <div className="auth-or" role="separator"><span>Or</span></div>
      <div className="auth-sso">
        <button type="button" aria-disabled="true" aria-describedby="sso-note" title="Not set up for this workspace yet"><GoogleMark />Continue with Google</button>
        <button type="button" aria-disabled="true" aria-describedby="sso-note" title="Not set up for this workspace yet"><MicrosoftMark />Continue with Microsoft</button>
      </div>
      <p className="auth-note" id="sso-note">Google and Microsoft sign-in are not set up for this workspace yet.</p>
      <p className="auth-foot">Outbound and the team workspace. Nothing sends without your say.</p>
    </form>
  );
}

// There is no email sending for accounts yet, so this screen says how a password is actually reset, and sends nothing.
function Reset({ onBack }: { onBack: () => void }) {
  return (
    <div className="auth-reset">
      <Wordmark big />
      <h1>Reset your password</h1>
      <p className="auth-sub">awtm forge cannot email reset links yet, so nothing is sent from this screen.</p>
      <ol className="auth-steps">
        <li><b>Ask an admin on your team.</b> They open Team, choose Reset password next to your name, and give you a temporary password.</li>
        <li><b>Sign in with it.</b> You are asked to choose your own password straight away, at least 10 characters.</li>
      </ol>
      <button type="button" className="auth-submit" onClick={onBack} autoFocus><Icon.back size={18} />Back to sign in</button>
      <p className="auth-foot">Signed in on another device? Your account page has Change password.</p>
    </div>
  );
}

const GoogleMark = () => <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.7 17.7 9.5 24 9.5Z" /><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.5 5.8c4.4-4 6.8-10 6.8-17.2Z" /><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6Z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6C6.5 42.6 14.6 48 24 48Z" /></svg>;
const MicrosoftMark = () => <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#F25022" d="M1 1h10v10H1z" /><path fill="#7FBA00" d="M13 1h10v10H13z" /><path fill="#00A4EF" d="M1 13h10v10H1z" /><path fill="#FFB900" d="M13 13h10v10H13z" /></svg>;
