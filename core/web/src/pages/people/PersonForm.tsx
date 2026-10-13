// Add a person, or edit one. Admins see every field; a person editing themselves sees their contact details, skills
// and photo only (the server enforces the same split). Adding can also make a sign-in, through the same user records
// the Team page manages, with a temporary password the person replaces the first time they sign in.
import { useRef, useState } from 'react';
import { api } from '../../api.ts';
import { useLoad } from '../../ui/hooks.ts';
import { Icon } from '../../ui/icons.tsx';
import { Modal } from '../../ui/overlay.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Spinner } from '../../ui/kit.tsx';
import { refreshTeam } from '../../session.tsx';
import { PAvatar, STATUS, TYPE, type Person } from './shared.tsx';

const tempPassword = () => { const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const r = crypto.getRandomValues(new Uint32Array(14)); return Array.from(r, (n) => a[n % a.length]).join(''); };

export function PersonForm({ person, people, admin, onClose, onSaved }: { person?: Person; people: Person[]; admin: boolean; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast(); const editing = !!person;
  const users = useLoad<any[]>(() => (admin ? api.get('/api/users') : Promise.resolve([])), [admin]);
  const [f, setF] = useState({
    full_name: person?.full_name ?? '', work_email: person?.work_email ?? '', job_title: person?.job_title ?? '', department: person?.department ?? '', manager_id: person?.manager_id ?? '',
    location: person?.location ?? '', phone: person?.phone ?? '', linkedin_url: person?.linkedin_url ?? '', employment_type: person?.employment_type ?? 'FULL_TIME', status: person?.status ?? 'ACTIVE',
    start_date: person?.start_date ?? '', end_date: person?.end_date ?? '', access: person?.access ?? 'member',
  });
  const [skills, setSkills] = useState<string[]>(person?.skills ?? []); const [skill, setSkill] = useState('');
  const [signin, setSignin] = useState<'none' | 'link' | 'new'>('none'); const [link, setLink] = useState(''); const [username, setUsername] = useState(''); const [password, setPassword] = useState(tempPassword);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const depts = [...new Set(people.map((p) => p.department).filter(Boolean))] as string[];
  // a manager cannot be the person or anyone under them
  const below = new Set<string>(); if (person) { below.add(person.id); let grew = true; while (grew) { grew = false; for (const p of people) if (p.manager_id && below.has(p.manager_id) && !below.has(p.id)) { below.add(p.id); grew = true; } } }
  const linked = new Set(people.map((p) => p.user_id).filter(Boolean));
  const free = (users.data ?? []).filter((u) => u.active && !linked.has(u.id));
  const addSkill = () => { const s = skill.trim().replace(/,$/, ''); if (s && !skills.some((x) => x.toLowerCase() === s.toLowerCase()) && skills.length < 30) setSkills([...skills, s.slice(0, 40)]); setSkill(''); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    if (admin && f.full_name.trim().length < 2) { setErr('Write the person’s full name.'); return; }
    if (signin === 'new' && !/^[A-Za-z0-9._-]{2,40}$/.test(username)) { setErr('A username uses letters, numbers, dot, dash or underscore, 2 to 40 of them.'); return; }
    if (signin === 'link' && !link) { setErr('Choose the sign-in to link.'); return; }
    setBusy(true);
    const self = { phone: f.phone, location: f.location, linkedin_url: f.linkedin_url, skills: skill.trim() ? [...skills, skill.trim()] : skills };
    const all = { ...self, full_name: f.full_name.trim(), work_email: f.work_email, job_title: f.job_title, department: f.department, manager_id: f.manager_id || null,
      employment_type: f.employment_type, status: f.status, start_date: f.start_date, end_date: f.end_date };
    try {
      if (editing) {
        await api.patch(`/api/people/${person!.id}`, admin ? all : self);
        // access is the sign-in's role, changed where the Team page changes it (the last admin is protected there)
        if (admin && person!.user_id && f.access !== person!.access) { await api.patch(`/api/users/${person!.user_id}`, { role: f.access }); refreshTeam(); }
        toast('Profile saved.'); onSaved(person!.id);
      } else {
        const r = await api.post('/api/people', { ...all, ...(signin === 'link' ? { user_id: link } : {}), ...(signin === 'new' ? { signin: { username, role: f.access, password } } : {}) });
        if (signin !== 'none') refreshTeam();
        toast(signin === 'new' ? `Added ${r.full_name}. Give them the username and temporary password; they choose their own when they first sign in.` : `Added ${r.full_name}.`);
        onSaved(r.id);
      }
    } catch (x: any) { setErr(x.message); setBusy(false); }
  };
  return <Modal title={editing ? (admin ? `Edit ${person!.full_name}` : 'Edit your profile') : 'Add a person'} onClose={onClose} wide>
    <form className="pp-form" onSubmit={submit} noValidate>
      {editing && <PhotoField person={person!} onChanged={() => onSaved(person!.id)} />}
      {admin && <fieldset><legend>Who</legend><div className="pp-grid">
        <label className="field"><span>Full name</span><input required minLength={2} maxLength={120} value={f.full_name} onChange={set('full_name')} autoFocus={!editing} /></label>
        <label className="field"><span>Work email</span><input type="email" maxLength={200} value={f.work_email} onChange={set('work_email')} placeholder="name@awtmforge.com" /></label>
        <label className="field"><span>Job title</span><input maxLength={120} value={f.job_title} onChange={set('job_title')} placeholder="Web developer" /></label>
        <label className="field"><span>Department</span><input maxLength={80} list="pp-depts" value={f.department} onChange={set('department')} placeholder="Engineering" /><datalist id="pp-depts">{depts.map((d) => <option key={d} value={d} />)}</datalist></label>
        <label className="field"><span>Reports to</span><select value={f.manager_id} onChange={set('manager_id')}><option value="">Nobody</option>{people.filter((p) => !below.has(p.id) && p.status !== 'EXITED').map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
        <label className="field"><span>Employment</span><select value={f.employment_type} onChange={set('employment_type')}>{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>Status</span><select value={f.status} onChange={set('status')}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>Joined</span><input type="date" value={f.start_date} onChange={set('start_date')} /></label>
        {(f.status === 'EXITED' || f.end_date) && <label className="field"><span>Left</span><input type="date" value={f.end_date} min={f.start_date || undefined} onChange={set('end_date')} /></label>}
      </div></fieldset>}
      <fieldset><legend>Contact</legend><div className="pp-grid">
        <label className="field"><span>Location</span><input maxLength={120} value={f.location} onChange={set('location')} placeholder="Bengaluru, India" /></label>
        <label className="field"><span>Phone</span><input type="tel" maxLength={40} value={f.phone} onChange={set('phone')} placeholder="+91" /></label>
        <label className="field"><span>LinkedIn</span><input maxLength={300} value={f.linkedin_url} onChange={set('linkedin_url')} placeholder="linkedin.com/in/name" /></label>
      </div></fieldset>
      <fieldset><legend>Skills</legend>
        <div className="pp-skills edit">{skills.map((s) => <span key={s} className="pp-skill">{s}<button type="button" onClick={() => setSkills(skills.filter((x) => x !== s))} aria-label={`Remove ${s}`}><Icon.x size={11} /></button></span>)}
          <input value={skill} onChange={(e) => setSkill(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSkill(); } else if (e.key === 'Backspace' && !skill && skills.length) setSkills(skills.slice(0, -1)); }} onBlur={addSkill}
            placeholder={skills.length ? 'Add another' : 'Type a skill, then Enter'} aria-label="Add a skill" maxLength={40} /></div></fieldset>
      {admin && !editing && <fieldset><legend>Sign-in</legend>
        <div className="pp-seg" role="radiogroup" aria-label="Sign-in">{([['none', 'Directory only'], ['link', 'Link an existing sign-in'], ['new', 'Make a sign-in']] as const).map(([k, l]) =>
          <label key={k} className={signin === k ? 'on' : ''}><input type="radio" name="signin" checked={signin === k} onChange={() => setSignin(k)} />{l}</label>)}</div>
        {signin === 'none' && <p className="faint">They appear in the directory and org chart, but cannot sign in, ask for leave or be messaged.</p>}
        {signin === 'link' && <label className="field"><span>Sign-in</span><select value={link} onChange={(e) => setLink(e.target.value)}><option value="">Choose…</option>{free.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}</select>
          {!free.length && !users.loading && <small className="faint">Every sign-in already belongs to someone in the directory.</small>}</label>}
        {signin === 'new' && <div className="pp-grid">
          <label className="field"><span>Username</span><input value={username} onChange={(e) => setUsername(e.target.value.trim())} placeholder="ritika" maxLength={40} autoComplete="off" /></label>
          <label className="field"><span>Access</span><select value={f.access} onChange={set('access')}><option value="member">Member</option><option value="admin">Admin</option></select></label>
          <label className="field"><span>Temporary password</span><span className="row"><input value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" spellCheck={false} className="mono grow" /><button type="button" className="btn tiny ghost" onClick={() => setPassword(tempPassword())}>New</button></span></label>
        </div>}</fieldset>}
      {admin && editing && person!.user_id && <fieldset><legend>Access</legend><label className="field"><span>Signs in as {person!.username}</span><select value={f.access} onChange={set('access')}><option value="member">Member</option><option value="admin">Admin</option></select></label>
        <p className="faint">Passwords and turning a sign-in off are on the Team page.</p></fieldset>}
      {err && <p className="form-err" role="alert">{err}</p>}
      <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy && <Spinner />}{editing ? 'Save profile' : 'Add person'}</button></div>
    </form>
  </Modal>;
}

function PhotoField({ person, onChanged }: { person: Person; onChanged: () => void }) {
  const toast = useToast(); const input = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState(false); const [shown, setShown] = useState(person.avatar_file_id);
  const upload = async (file?: File | null) => {
    if (!file) return; if (file.size > 2_000_000) { toast('Use a picture under 2 MB.', { err: true }); return; }
    setBusy(true); try { const r = await api.upload(`/api/people/${person.id}/avatar?name=${encodeURIComponent(file.name)}`, file); setShown(r.avatar_file_id); onChanged(); toast('Photo updated.'); } catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(false); }
  };
  return <div className="pp-photo"><PAvatar p={{ full_name: person.full_name, avatar_file_id: shown }} size={56} />
    <div className="col" style={{ gap: 6 }}><span className="row"><button type="button" className="btn tiny" onClick={() => input.current?.click()} disabled={busy}>{busy && <Spinner />}{shown ? 'Change photo' : 'Add a photo'}</button>
      {shown && <button type="button" className="btn tiny ghost" onClick={async () => { try { await api.del(`/api/people/${person.id}/avatar`); setShown(null); onChanged(); } catch (e: any) { toast(e.message, { err: true }); } }}>Remove</button>}</span>
      <small className="faint">PNG, JPEG or WebP, under 2 MB.</small></div>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} /></div>;
}
