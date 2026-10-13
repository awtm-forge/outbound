import { useEffect, useState } from 'react';
import { Icon } from './icons.tsx';
export function Spinner() { return <span className="spinner" aria-hidden="true" />; }
export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="empty"><div className="glyph" aria-hidden="true"><Icon.check /></div><h2 className="empty-title">{title}</h2>{children && <p style={{ maxWidth: '46ch' }}>{children}</p>}{action}</div>;
}
export function Skeleton({ h = 18, w = '100%' }: { h?: number; w?: number | string }) { return <div className="skeleton" style={{ height: h, width: w }} />; }
// Placeholders shaped like what is coming, so nothing jumps when it arrives. kind: a table, a list of rows, or a page.
export function Loading({ rows = 4, kind = 'page' }: { rows?: number; kind?: 'page' | 'table' | 'list' }) {
  if (kind === 'table') return <div className="card flush" aria-busy="true" aria-label="Loading"><div style={{ height: 34, background: 'var(--surface-raised)', borderBottom: '1px solid var(--hairline)' }} />
    {Array.from({ length: rows }, (_, i) => <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'center', height: 56, padding: '0 12px', borderBottom: '1px solid var(--hairline-soft)' }}><Skeleton h={14} w="22%" /><Skeleton h={14} w="12%" /><Skeleton h={14} w="30%" /><Skeleton h={14} w="14%" /></div>)}</div>;
  if (kind === 'list') return <div className="col" style={{ gap: 8 }} aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={44} />)}</div>;
  return <div className="col" aria-busy="true" aria-label="Loading"><Skeleton h={28} w="32%" /><Skeleton h={16} w="52%" />{Array.from({ length: Math.max(1, rows - 1) }, (_, i) => <Skeleton key={i} h={72} />)}</div>;
}
export function Failure({ error, retry }: { error: string; retry?: () => void }) {
  return <div className="banner err"><span>{error}</span>{retry && <button className="btn sm right" onClick={retry}>Try again</button>}</div>;
}
export function Ring({ value }: { value: number | null }) {
  return <div className="ring" style={{ ['--p' as any]: value ?? 0 }} aria-label={`Score ${value ?? 'not set'} of 100`}><div>{value ?? '·'}</div></div>;
}
export function Busy({ busy, children }: { busy: boolean; children: React.ReactNode }) { return <>{busy ? <Spinner /> : null}{children}</>; }
export const initials = (name?: string | null) => (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('') || '?';

const IST = { timeZone: 'Asia/Kolkata' } as const;
export function ago(ts?: string | null) {
  if (!ts) return '';
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 0) return new Date(ts).toLocaleString('en-IN', { ...IST, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString('en-IN', { ...IST, day: 'numeric', month: 'short' });
}
export const when = (ts?: string | null) => ts ? new Date(ts).toLocaleString('en-IN', { ...IST, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Not scheduled';
// Money arrives as integer paise (string or number) and is formatted without ever becoming a float.
export function inr(paise: string | number | null | undefined) {
  if (paise == null) return '₹0';
  const p = BigInt(String(paise)); const neg = p < 0n; const a = neg ? -p : p;
  const rupees = (a / 100n).toString(); const last3 = rupees.slice(-3); const rest = rupees.slice(0, -3);
  return `${neg ? '-' : ''}₹${rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : ''}${last3}`;
}
export const pct = (v: number | null | undefined) => (v == null ? 'None yet' : v > 100 ? 'Over 100%' : `${v}%`);

// Status is a word plus a coloured dot, never colour alone. warning = waiting on you; success = done well; danger = stopped.
export type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';
const STATUS: Record<string, { label: string; tone: Tone }> = {
  NEW: { label: 'New', tone: 'neutral' }, QUALIFYING: { label: 'Scoring', tone: 'info' }, RESEARCHING: { label: 'Researching', tone: 'info' }, RESEARCH_FURTHER: { label: 'Research further', tone: 'warning' },
  QUALIFIED: { label: 'Qualified', tone: 'info' }, REJECTED: { label: 'Not a fit', tone: 'neutral' }, EMAIL_DRAFTED: { label: 'Drafted', tone: 'info' },
  PENDING_APPROVAL: { label: 'Awaiting review', tone: 'warning' }, APPROVED: { label: 'Approved', tone: 'success' }, SYNCED: { label: 'Queued to send', tone: 'info' },
  CONTACTED: { label: 'Contacted', tone: 'info' }, REPLIED: { label: 'Replied', tone: 'warning' }, MEETING: { label: 'Meeting', tone: 'info' }, PROPOSAL: { label: 'Proposal', tone: 'info' },
  WON: { label: 'Won', tone: 'success' }, LOST: { label: 'Closed', tone: 'neutral' }, SUPPRESSED: { label: 'Do not contact', tone: 'danger' },
};
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) { return <span className={`tag tone-${tone}`}>{children}</span>; }
export function Status({ s }: { s: string }) { const m = STATUS[s] ?? { label: s, tone: 'neutral' as Tone }; return <Badge tone={m.tone}>{m.label}</Badge>; }
// A clickable table row that also opens with Enter or Space from the keyboard.
export const rowOpen = (run: () => void) => ({ tabIndex: 0, onClick: run, onKeyDown: (e: React.KeyboardEvent) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); run(); } } });
export const statusLabel = (s: string) => STATUS[s]?.label ?? s;
const CLASS: Record<string, string> = { POSITIVE: 'Interested', VALUE_REQUEST: 'Asked for the two things', PRICE: 'Asked about price', TIMING: 'Not now', WRONG_PERSON: 'Wrong person', REFERRAL: 'Referred someone', OBJECTION: 'Objection', NOT_INTERESTED: 'Not interested', UNSUBSCRIBE: 'Asked to stop', OTHER: 'Needs a read' };
export const classLabel = (c?: string | null) => (c ? CLASS[c] ?? c : 'Not read yet');
const PROBLEM: Record<string, string> = { WEBSITE: 'Website', CONVERSION: 'Conversion', UX: 'User experience', SEO: 'Search', ANALYTICS: 'Analytics', PRODUCT: 'Product', MVP: 'First version', ENGINEERING: 'Engineering', AUTOMATION: 'Automation', AI: 'AI', BRAND: 'Brand', OTHER: 'Other' };
export const problemLabel = (p?: string | null) => (p ? PROBLEM[p] ?? p : 'Not found yet');
const CAP: Record<string, string> = { WEB: 'Web and digital experience', PRODUCT: 'Product and technology', BRAND: 'Brand and growth' };
export const capLabel = (c?: string | null) => (c ? CAP[c] ?? c : 'Not matched yet');
export function ProofTag({ label }: { label: string }) {
  const tone: Tone = label === 'VERIFIED' ? 'success' : label === 'PRIVATE' ? 'danger' : label === 'TO_CONFIRM' ? 'warning' : 'neutral';
  return <Badge tone={tone}>{label === 'VERIFIED' ? 'Verified' : label === 'STATED' ? 'Stated, not usable' : label === 'TO_CONFIRM' ? 'To confirm' : label === 'PRIVATE' ? 'Private' : label.charAt(0) + label.slice(1).toLowerCase()}</Badge>;
}
export function useNow(ms = 60_000) { const [n, setN] = useState(Date.now()); useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]); return n; }
export async function copy(text: string) { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }
export function ScoreBars({ criteria, values }: { criteria: { key: string; label: string; max: number }[]; values: Record<string, number> }) {
  return <div className="bars">{criteria.map((c) => { const v = values?.[c.key] ?? 0; return <div key={c.key} style={{ display: 'contents' }}><span className="muted ellipsis">{c.label}</span><span className="track"><i style={{ width: `${(v / c.max) * 100}%` }} /></span><span className="v">{v}/{c.max}</span></div>; })}</div>;
}

// Calendar dates (YYYY-MM-DD) are days, not instants: shown as written, compared against today in India.
export const todayIST = () => new Date().toLocaleDateString('en-CA', IST);
export function dayLabel(d?: string | null) {
  if (!d) return '';
  const [y, m, dd] = d.split('-').map(Number); const dt = new Date(Date.UTC(y!, m! - 1, dd!));
  return dt.toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', ...(y !== Number(todayIST().slice(0, 4)) ? { year: 'numeric' } : {}) });
}
export const isLate = (d?: string | null) => !!d && d < todayIST();

// Rupees typed by a person ("1,50,000" or "2500.50") to integer paise as a string, without passing through a float.
export function toPaise(rupees: string): string | null {
  const s = rupees.replace(/[,\s₹]/g, ''); if (!s) return null;
  const m = /^(\d{1,14})(?:\.(\d{1,2}))?$/.exec(s); if (!m) return 'invalid';
  return (BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0')).toString();
}
// integer paise back to an editable rupee string ("150000" or "2500.50")
export function toRupees(paise?: string | null) {
  if (paise == null) return ''; const p = BigInt(paise); const r = p / 100n; const f = p % 100n;
  return f ? `${r}.${f.toString().padStart(2, '0')}` : r.toString();
}
