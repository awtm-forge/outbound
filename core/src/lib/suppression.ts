import { q, one, audit } from './db.ts';
import { emailDomain } from './normalize.ts';
export async function isSuppressed(email?: string | null, domain?: string | null): Promise<{ suppressed: boolean; reason?: string }> {
  const d = domain ?? (email ? emailDomain(email) : null);
  const r = await one(`select reason from suppression_list where (expires_at is null or expires_at > now()) and (($1::citext is not null and email = $1) or ($2::text is not null and domain = $2)) limit 1`, [email ?? null, d ?? null]);
  return r ? { suppressed: true, reason: r.reason } : { suppressed: false };
}
// Suppress and cascade: prospects, memberships, pending drafts. History is never deleted; re-adding is manual only.
export async function suppress(opts: { email?: string | null; domain?: string | null; reason: string; source: string; actor?: string; expires_at?: string | null }) {
  const { email = null, domain = null, reason, source, actor = 'system', expires_at = null } = opts;
  if (!email && !domain) throw new Error('email or domain required');
  const row = await one(`insert into suppression_list(email,domain,reason,source,expires_at) values($1,$2,$3,$4,$5)
    on conflict do nothing returning id`, [email, domain, reason, source, expires_at]);
  const affected = await q(`update prospects p set suppressed=true, suppression_reason=$3, status='SUPPRESSED' from companies c where p.company_id=c.id
    and (($1::citext is not null and exists (select 1 from contacts ct where ct.id=p.contact_id and ct.email=$1)) or ($2::text is not null and c.domain=$2)) returning p.id`, [email, domain, reason]);
  for (const p of affected) {
    await q(`update campaign_memberships set status='SUPPRESSED' where prospect_id=$1`, [p.id]);
    await q(`update email_drafts set status='REJECTED', rejection_reason='suppressed' where prospect_id=$1 and status in ('PENDING_APPROVAL','APPROVED')`, [p.id]);
    await audit('prospect', p.id, 'suppressed', actor, { reason, source });
  }
  return { id: row?.id ?? null, already: !row, prospects_affected: affected.length };
}
