import { useState } from 'react';
import { api } from '../../api.ts';
import { Link, useRouter } from '../../router.tsx';
import { useMe, isAdmin } from '../../session.tsx';
import { useToast } from '../../ui/toast.tsx';
import { Badge, Spinner, ago, type Tone } from '../../ui/kit.tsx';

// Shared pieces of the Outreach screens: the sub navigation, "Last synced" with the stale warning, and words for statuses.
// Data comes from the synced copy in our database; Saleshandy is the source of truth.
export const SH_APP = 'https://my.saleshandy.com';
export type Synced = { last_synced: string | null; stale: boolean };

export function OutreachNav() {
  const { path } = useRouter(); const me = useMe();
  const tabs: [string, string][] = [['/outreach', 'Overview'], ['/outreach/inbox', 'Inbox'], ['/outreach/prospects', 'Prospects'], ['/outreach/tasks', 'Tasks'], ['/outreach/lists', 'Do not contact'],
    ['/outreach/mailboxes', 'Mailboxes'], ...(isAdmin(me) ? [['/outreach/enrich', 'Enrichment'] as [string, string]] : []), ['/outreach/unlinked', 'Not linked yet'], ['/outreach/status', 'Integration status']];
  const on = (to: string) => (to === '/outreach' ? path === '/outreach' || path.startsWith('/outreach/sequences') : path.startsWith(to));
  return <nav className="tabs" aria-label="Outreach" style={{ flexWrap: 'wrap' }}>{tabs.map(([to, label]) => <Link key={to} to={to} className={on(to) ? 'on' : ''} aria-current={on(to) ? 'page' : undefined}
    style={{ height: 30, padding: '0 12px', display: 'inline-flex', alignItems: 'center', borderRadius: 4, fontSize: 'var(--fs-0)', fontWeight: 600, color: on(to) ? 'var(--ink)' : 'var(--ink-muted)', background: on(to) ? 'var(--surface-raised)' : 'transparent', boxShadow: on(to) ? 'inset 0 -2px 0 var(--accent)' : 'none', textDecoration: 'none' }}>{label}</Link>)}</nav>;
}

// "Last synced" on every synced screen, and a warning when the copy is older than 2 hours (or was never synced)
export function SyncedLine({ s, reload }: { s: Synced | null | undefined; reload?: () => void }) {
  const me = useMe(); const toast = useToast(); const [busy, setBusy] = useState(false);
  if (!s) return null;
  const sync = async () => { setBusy(true); try { const r = await api.run('/api/sh/sync', { kind: 'incremental' }); toast(r?.status === 'success' ? 'Synced.' : r?.status === 'partial' ? 'Synced, with some records skipped. See Integration status.' : 'The sync did not finish. See Integration status.', { err: r?.status === 'failed' }); reload?.(); } catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(false); } };
  return <div className="col" style={{ gap: 8 }}>
    <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>Last synced {s.last_synced ? ago(s.last_synced) : 'never'}{isAdmin(me) && <> · <button className="link-btn" onClick={sync} disabled={busy} style={{ fontSize: 'inherit' }}>{busy ? <Spinner /> : null}Sync now</button></>}</p>
    {s.stale && <div className="banner warn"><span>{s.last_synced ? `This is the copy from ${ago(s.last_synced)}. It may be out of date until the next sync.` : 'Nothing has been synced from Saleshandy yet, so this is empty until the first sync.'}</span></div>}
  </div>;
}

const STATUS: Record<string, [string, Tone]> = {
  active: ['Active', 'success'], paused: ['Paused', 'warning'], finished: ['Finished', 'neutral'], replied: ['Replied', 'info'], unsubscribed: ['Unsubscribed', 'danger'], bounced: ['Bounced', 'danger'],
  draft: ['Draft', 'neutral'], overdue: ['Overdue', 'danger'], duetoday: ['Due today', 'warning'], upcoming: ['Upcoming', 'neutral'], completed: ['Completed', 'success'], skipped: ['Skipped', 'neutral'],
  connected: ['Connected', 'success'], disconnected: ['Disconnected', 'danger'], positive: ['Positive', 'success'], negative: ['Negative', 'danger'], neutral: ['Neutral', 'neutral'],
  success: ['Success', 'success'], partial: ['Partial', 'warning'], failed: ['Failed', 'danger'], running: ['Running', 'info'], received: ['Received', 'info'], processed: ['Processed', 'success'], ignored: ['Ignored', 'neutral'],
  refused: ['Refused', 'neutral'], pending: ['Waiting to send', 'warning'], sending: ['Sending', 'info'], sent: ['Sent', 'success'], cancelled: ['Undone', 'neutral'],
};
export function ShStatus({ s }: { s?: string | null }) {
  if (!s) return <span className="faint">Not known</span>;
  const m = STATUS[String(s).toLowerCase()] ?? [String(s).charAt(0).toUpperCase() + String(s).slice(1), 'neutral' as Tone];
  return <Badge tone={m[1]}>{m[0]}</Badge>;
}
export const seqStatus = (s: any) => (s.active ? 'active' : String(s.status ?? '').toLowerCase().includes('draft') ? 'draft' : s.status ? String(s.status).toLowerCase() : 'paused');
export const personName = (p: any) => [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || 'No name';
export const rate = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : 'None yet');
// off means the server answered 409: the integration is switched off
export const isOff = (e: string | null) => !!e && /switched off/.test(e);
export function Off() {
  return <div className="card"><p style={{ fontWeight: 600 }}>The Saleshandy integration is switched off.</p><p className="muted" style={{ marginTop: 6 }}>An admin turns it on with SALESHANDY_INTEGRATION_ENABLED in the server settings. Until then nothing here reads from or writes to Saleshandy.</p></div>;
}
export function AppLink({ to, children }: { to: string; children: React.ReactNode }) {
  return <a className="btn sm ghost" href={to.startsWith('http') ? to : SH_APP + to} target="_blank" rel="noreferrer">{children}</a>;
}
