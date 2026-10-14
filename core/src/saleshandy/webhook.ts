// Saleshandy webhooks. The route (routes/outreach.ts) checks the secret header first. Then: the raw payload is stored
// in sh_webhook_inbox under its event id (or a hash of the body), a repeat is ignored, the quick local updates run
// (the mirror and our own reply, bounce and unsubscribe records), and anything that needs Saleshandy (a refresh) is
// queued to run after the response. A failure is kept with its error for replay from the integration status screen.
// Payload shapes are unverified, so fields are read from the likely places and every raw payload is kept.
import { createHash } from 'node:crypto';
import { q, one } from '../lib/db.ts';
import { log } from '../lib/log.ts';
import { enqueue } from '../jobs.ts';
import * as P from '../pipeline.ts';
import { refreshProspect, refreshTask, refreshSequenceList, refreshThread } from './sync.ts';

const pick = (o: any, ...paths: string[]) => { for (const p of paths) { const v = p.split('.').reduce((a: any, k) => (a == null ? undefined : a[k]), o); if (v !== undefined && v !== null && v !== '') return v; } return undefined; };
export const eventType = (e: any) => String(pick(e, 'event', 'eventType', 'event_type', 'type', 'webhookEvent') ?? 'unknown').toLowerCase().replace(/_/g, '-');
export const eventKey = (e: any) => { const id = pick(e, 'eventId', 'event_id', 'id', 'webhookEventId'); return id ? `id:${id}` : `hash:${createHash('sha256').update(JSON.stringify(e)).digest('hex')}`; };
// our own pipeline still records replies, bounces and unsubscribes in its tables (replies, email_events, suppression)
const LEGACY: Record<string, string> = { 'reply-received': 'replied', 'email-bounced': 'bounced', 'prospect-unsubscribed': 'unsubscribed', 'email-sent': 'email_sent', 'email-opened': 'opened', 'email-link-clicked': 'clicked',
  replied: 'replied', email_replied: 'replied', bounced: 'bounced', unsubscribed: 'unsubscribed', 'email-replied': 'replied', sent: 'sent', opened: 'opened', clicked: 'clicked' };
const UNRELIABLE = new Set(['email-opened', 'email-link-clicked', 'opened', 'clicked']);

export async function receive(raw: any): Promise<{ stored: number; duplicates: number; processed: any[] }> {
  const events = Array.isArray(raw) ? raw : Array.isArray(raw?.events) ? raw.events : [raw];
  let stored = 0, duplicates = 0; const processed: any[] = [];
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    const row = await one(`insert into sh_webhook_inbox(event_key, event_type, raw) values($1,$2,$3) on conflict (event_key) do nothing returning id`, [eventKey(e), eventType(e), e]);
    if (!row) { duplicates++; processed.push({ duplicate: true }); continue; }
    stored++;
    processed.push(await process(row.id));
  }
  return { stored, duplicates, processed };
}

export async function process(inboxId: string): Promise<any> {
  const row = await one(`update sh_webhook_inbox set attempts=attempts+1 where id=$1 returning *`, [inboxId]); if (!row) return { error: 'not found' };
  const e = row.raw; const type = row.event_type as string;
  try {
    const email = String(pick(e, 'prospect.email', 'email', 'prospectEmail', 'prospect_email', 'to') ?? '').toLowerCase() || null;
    const prospectId = pick(e, 'prospect.id', 'prospectId', 'prospect_id'); const sequenceId = pick(e, 'sequence.id', 'sequenceId', 'sequence_id');
    const taskId = pick(e, 'task.id', 'taskId', 'task_id'); const threadId = pick(e, 'emailThreadId', 'thread.id', 'threadId');
    const at = pick(e, 'timestamp', 'occurredAt', 'occurred_at', 'createdAt', 'created_at');
    let result: any = { event_type: type };
    if (email || prospectId) {
      await q(`insert into sh_events(id, kind, prospect_id, sequence_id, email, occurred_at, reliable) values($1,$2,$3,$4,$5,coalesce($6::timestamptz, now()),$7) on conflict (id) do nothing`,
        [row.event_key, type, prospectId ? String(prospectId) : null, sequenceId ? String(sequenceId) : null, email, at ?? null, !UNRELIABLE.has(type)]);
      if (prospectId) await q(`update sh_prospects set last_activity_at=greatest(coalesce(last_activity_at, 'epoch'), coalesce($2::timestamptz, now())) where id=$1`, [String(prospectId), at ?? null]);
      const status = type === 'prospect-unsubscribed' ? 'unsubscribed' : type === 'email-bounced' ? 'bounced' : type === 'reply-received' ? 'replied' : type === 'prospect-finished' ? 'finished' : null;
      if (status && prospectId && sequenceId) await q(`update sh_prospect_sequences set status=$3, updated_at=now() where prospect_id=$1 and sequence_id=$2`, [String(prospectId), String(sequenceId), status]);
      const legacy = LEGACY[type];
      if (legacy && email) {
        try {
          result = await P.ingestWebhook({ event: legacy, event_id: row.event_key, email, sequence_id: sequenceId, prospect_id: prospectId, occurred_at: at,
            subject: pick(e, 'email.subject', 'subject'), body: pick(e, 'email.body', 'body', 'replyBody', 'reply_body', 'message'), reply_from: pick(e, 'from', 'replyFrom') });
        } catch (err: any) { if (!/unknown event/.test(err.message)) throw err; }
      }
    }
    if (type === 'sequence-paused' && sequenceId) await q(`update sh_sequences set status='paused', active=false, updated_at=now() where id=$1`, [String(sequenceId)]);
    await q(`update sh_webhook_inbox set status='processed', processed_at=now(), last_error=null where id=$1`, [inboxId]);
    // anything that needs Saleshandy runs after the response
    if (email || taskId || threadId || type.startsWith('sequence-')) enqueue(`Saleshandy refresh after ${type}`, async () => {
      if (email) await refreshProspect(email); if (taskId) await refreshTask(String(taskId)); if (threadId) await refreshThread(String(threadId));
      if (type.startsWith('sequence-')) await refreshSequenceList(); return { ok: true };
    }, 'batch');
    return result;
  } catch (err: any) {
    await q(`update sh_webhook_inbox set status='failed', last_error=$2 where id=$1`, [inboxId, String(err.message).slice(0, 1000)]);
    log.warn('saleshandy webhook failed', { type, err: err.message });
    return { event_type: type, failed: true };
  }
}
// from the integration status screen
export async function replay(inboxId: string) { return process(inboxId); }
export async function replayFailed() { const rows = await q(`select id from sh_webhook_inbox where status='failed' order by received_at limit 100`); for (const r of rows) await process(r.id); return rows.length; }
