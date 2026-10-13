// People: types, labels and the small pieces every People view uses.
import { useEffect, useState } from 'react';
import { ago, dayLabel, initials } from '../../ui/kit.tsx';

export type Person = {
  id: string; user_id: string | null; full_name: string; work_email: string | null; phone: string | null; job_title: string | null; department: string | null;
  employment_type: string; status: 'ACTIVE' | 'ON_LEAVE' | 'EXITED'; start_date: string | null; end_date: string | null; manager_id: string | null; manager_name: string | null;
  location: string | null; linkedin_url: string | null; skills: string[]; avatar_file_id: string | null; created_at: string; username: string | null; access: 'admin' | 'member' | null;
  signin_active: boolean | null; last_seen_at: string | null; leave_until: string | null; leave_half: boolean | null; availability: Avail;
};
export type Avail = 'active' | 'today' | 'away' | 'never' | 'no_signin' | 'on_leave' | 'former';
export const TYPE: Record<string, string> = { FULL_TIME: 'Full time', PART_TIME: 'Part time', CONTRACTOR: 'Contractor', INTERN: 'Intern' };
export const STATUS: Record<string, string> = { ACTIVE: 'Working', ON_LEAVE: 'On leave', EXITED: 'Left' };
export const KIND: Record<string, string> = { CASUAL: 'Casual', SICK: 'Sick', EARNED: 'Earned', UNPAID: 'Unpaid', OTHER: 'Other' };
export const LEAVE_STATUS: Record<string, string> = { PENDING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Declined', CANCELLED: 'Cancelled' };
// what each availability means, said plainly; there is no live presence, only when someone last used the app
export const AVAIL: Record<Avail, { label: string; tone: string; hint: string }> = {
  active: { label: 'Active now', tone: 'ok', hint: 'Used AWTM Forge in the last 5 minutes' },
  today: { label: 'Active today', tone: 'ok-dim', hint: 'Used AWTM Forge earlier today' },
  away: { label: 'Away', tone: 'off', hint: 'Has not used AWTM Forge today' },
  never: { label: 'Not signed in yet', tone: 'off', hint: 'Has a sign-in but has never used it' },
  no_signin: { label: 'No sign-in', tone: 'off', hint: 'In the directory only, so there is no activity to show' },
  on_leave: { label: 'On leave', tone: 'leave', hint: 'Approved leave covers today, or marked on leave' },
  former: { label: 'Left', tone: 'off', hint: 'No longer on the team' },
};
export const availText = (p: Pick<Person, 'availability' | 'last_seen_at' | 'leave_until'>) =>
  p.availability === 'away' && p.last_seen_at ? `Last active ${ago(p.last_seen_at)}` : p.availability === 'on_leave' && p.leave_until ? `On leave until ${dayLabel(p.leave_until)}` : AVAIL[p.availability].hint;

export function AvailPill({ p, short }: { p: Pick<Person, 'availability' | 'last_seen_at' | 'leave_until'>; short?: boolean }) {
  const a = AVAIL[p.availability];
  return <span className={`pp-avail t-${a.tone}`} title={availText(p)}><i aria-hidden="true" />{short || p.availability !== 'away' || !p.last_seen_at ? a.label : `Seen ${ago(p.last_seen_at)}`}</span>;
}

// a steady colour per person and per department, from the name, so it never changes between visits
const HUES = ['#F97316', '#A855F7', '#3B82F6', '#14B8A6', '#EC4899', '#22C55E', '#F59E0B', '#06B6D4', '#6366F1'];
const hash = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
const DEPT: [RegExp, string][] = [[/lead|founder|exec|management/i, '#A855F7'], [/engineer|tech|develop|product/i, '#3B82F6'], [/design|brand|creative/i, '#14B8A6'], [/market|growth|sales|outbound/i, '#F97316'], [/ops|operation|admin|finance|hr|people/i, '#94A3B8']];
export const deptColor = (d?: string | null) => (d ? DEPT.find(([re]) => re.test(d))?.[1] ?? HUES[hash(d) % HUES.length]! : '#94A3B8');
export const rgb = (hex: string) => { const h = hex.replace('#', ''); return `${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}`; };

export function PAvatar({ p, size = 40 }: { p: { full_name: string; avatar_file_id?: string | null }; size?: number }) {
  const [broken, setBroken] = useState(false);
  const c = HUES[hash(p.full_name) % HUES.length]!;
  if (p.avatar_file_id && !broken) return <img className="pp-av" src={`/api/files/${p.avatar_file_id}/content`} alt="" width={size} height={size} style={{ width: size, height: size }} onError={() => setBroken(true)} loading="lazy" />;
  return <span className="pp-av" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.36), '--av-rgb': rgb(c) } as React.CSSProperties}>{initials(p.full_name)}</span>;
}
export function RolePill({ p }: { p: Pick<Person, 'job_title' | 'department'> }) {
  if (!p.job_title) return <span className="faint">No title</span>;
  return <span className="pp-role" style={{ '--r-rgb': rgb(deptColor(p.department)) } as React.CSSProperties} title={p.job_title}>{p.job_title}</span>;
}
export const span = (l: { start_date: string; end_date: string; half_day?: boolean }) => (l.start_date === l.end_date ? dayLabel(l.start_date) + (l.half_day ? ', half day' : '') : `${dayLabel(l.start_date)} to ${dayLabel(l.end_date)}`);
export const days = (d: string) => { const n = Number(d); return `${n} ${n === 1 ? 'day' : 'days'}`; };

export function useMedia(q: string) {
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => { const mq = matchMedia(q); const h = () => setM(mq.matches); mq.addEventListener('change', h); h(); return () => mq.removeEventListener('change', h); }, [q]);
  return m;
}
