import { useEffect, useState } from 'react';
import { Icon } from './icons.tsx';
export function Spinner() { return <span className="spinner" aria-hidden="true" />; }
export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="empty"><div className="glyph"><Icon.check /></div><h3>{title}</h3>{children && <p style={{ maxWidth: '46ch' }}>{children}</p>}{action}</div>;
}
export function Skeleton({ h = 18, w = '100%' }: { h?: number; w?: number | string }) { return <div className="skeleton" style={{ height: h, width: w }} />; }
export function Loading({ rows = 4 }: { rows?: number }) { return <div className="col" aria-busy="true">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={i === 0 ? 30 : 56} w={i === 0 ? '40%' : '100%'} />)}</div>; }
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
export const pct = (v: number | null | undefined) => (v == null ? '·' : `${v}%`);

const STATUS: Record<string, { label: string; tone?: 'ember' | 'solid' | 'warn' | 'dim' }> = {
  NEW: { label: 'New' }, QUALIFYING: { label: 'Scoring' }, RESEARCHING: { label: 'Researching' }, RESEARCH_FURTHER: { label: 'Research further' },
  QUALIFIED: { label: 'Qualified', tone: 'ember' }, REJECTED: { label: 'Not a fit', tone: 'dim' }, EMAIL_DRAFTED: { label: 'Drafted' },
  PENDING_APPROVAL: { label: 'Awaiting review', tone: 'solid' }, APPROVED: { label: 'Approved', tone: 'ember' }, SYNCED: { label: 'Queued to send', tone: 'ember' },
  CONTACTED: { label: 'Contacted' }, REPLIED: { label: 'Replied', tone: 'solid' }, MEETING: { label: 'Meeting', tone: 'solid' }, PROPOSAL: { label: 'Proposal', tone: 'solid' },
  WON: { label: 'Won', tone: 'solid' }, LOST: { label: 'Closed', tone: 'dim' }, SUPPRESSED: { label: 'Do not contact', tone: 'warn' },
};
export function Status({ s }: { s: string }) { const m = STATUS[s] ?? { label: s }; return <span className={`tag ${m.tone ?? ''}`}>{m.label}</span>; }
export const statusLabel = (s: string) => STATUS[s]?.label ?? s;
const CLASS: Record<string, string> = { POSITIVE: 'Interested', VALUE_REQUEST: 'Asked for the two things', PRICE: 'Asked about price', TIMING: 'Not now', WRONG_PERSON: 'Wrong person', REFERRAL: 'Referred someone', OBJECTION: 'Objection', NOT_INTERESTED: 'Not interested', UNSUBSCRIBE: 'Asked to stop', OTHER: 'Needs a read' };
export const classLabel = (c?: string | null) => (c ? CLASS[c] ?? c : 'Not read yet');
const PROBLEM: Record<string, string> = { WEBSITE: 'Website', CONVERSION: 'Conversion', UX: 'User experience', SEO: 'Search', ANALYTICS: 'Analytics', PRODUCT: 'Product', MVP: 'First version', ENGINEERING: 'Engineering', AUTOMATION: 'Automation', AI: 'AI', BRAND: 'Brand', OTHER: 'Other' };
export const problemLabel = (p?: string | null) => (p ? PROBLEM[p] ?? p : 'Not found yet');
const CAP: Record<string, string> = { WEB: 'Web and digital experience', PRODUCT: 'Product and technology', BRAND: 'Brand and growth' };
export const capLabel = (c?: string | null) => (c ? CAP[c] ?? c : 'Not matched yet');
export function ProofTag({ label }: { label: string }) {
  const tone = label === 'VERIFIED' ? 'ember' : label === 'PRIVATE' ? 'warn' : 'dim';
  return <span className={`tag ${tone}`}>{label === 'VERIFIED' ? 'Verified' : label === 'STATED' ? 'Stated, not usable' : label === 'TO_CONFIRM' ? 'To confirm' : label === 'PRIVATE' ? 'Private' : label.toLowerCase()}</span>;
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
