// The LinkedIn queue. The system picks who, writes the note and the follow-up, and keeps the book. A founder opens
// the profile, pastes, clicks. Daily cap per sender keeps the pace human; nothing here talks to LinkedIn.
import { q, one, audit, TODAY_IST } from './lib/db.ts';
import { runAgent } from './lib/ai.ts';
import { HttpError, loadProspect, untag } from './pipeline.ts';
import * as A from './agents/index.ts';

export const SENDERS: Record<string, { name: string; role: string; city: string }> = {
  rahul: { name: 'Rahul', role: 'Co-founder, product and design', city: 'Bengaluru' },
  ayush: { name: 'Ayush', role: 'Co-founder, engineering', city: 'Bengaluru' },
};
export const DAILY_CAP = Number(process.env.LINKEDIN_DAILY_CAP || 25);
// words that push; the agent is told not to use them and the server refuses a note that does anyway
const PUSHY = /!|we (help|build|rework|design|offer|specialise|specialize)|our (team|studio|clients|work)|urgent|limited|guarantee|free audit|quick call|hop on|circle back|touch base|synergy|leverage|game.changer|revolutionary|i'?d love to|just checking in|—|\p{Extended_Pictographic}/iu;
const sender = (s: string) => { const v = SENDERS[s]; if (!v) throw new HttpError(400, `sender must be one of ${Object.keys(SENDERS).join(', ')}`); return v; };

// Writes the note for one prospect and queues it. The target is the named person's profile when we have one,
// else the company's LinkedIn page, else a people search for the company's founder.
export async function queueOne(prospectId: string, senderKey: string, day?: string, opts: { workflowRunId?: string } = {}) {
  const s = sender(senderKey); const p = await loadProspect(prospectId);
  if (p.suppressed) throw new HttpError(409, 'suppressed');
  const existing = await one('select id, status from linkedin_outreach where prospect_id=$1 and sender=$2', [p.id, senderKey]); if (existing) return { id: existing.id, reused: true };
  const other = await one(`select sender from linkedin_outreach where prospect_id=$1 and status in ('SENT','ACCEPTED','REPLIED')`, [p.id]); if (other) throw new HttpError(409, `${other.sender} has already written to this company`);
  const person = p.contact && (p.contact.full_name || p.contact.first_name) ? p.contact : (await one(`select * from contacts where company_id=$1 and full_name is not null order by is_decision_maker desc, (linkedin_url is not null) desc, created_at limit 1`, [p.company.id]));
  const companyPage = p.company.metadata?.linkedin_url ?? (await one('select linkedin_url from discovery_candidates where domain=$1', [p.company.domain]))?.linkedin_url ?? null;
  const target_kind = person?.linkedin_url ? 'PERSON' : companyPage ? 'COMPANY_PAGE' : 'SEARCH';
  const target_url = person?.linkedin_url ?? companyPage ?? `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(p.company.name.split(/[|:–-]/)[0].trim() + ' founder')}`;
  const observation = untag(p.specific_observation ?? '');
  if (!observation || observation === 'UNKNOWN') throw new HttpError(409, 'no specific observation yet; research first');
  const r = await runAgent(A.linkedinNote, { company: { name: p.company.name, domain: p.company.domain, website: p.company.website ?? undefined, city: p.company.city ?? undefined, vertical: p.company.vertical ?? undefined, platform: p.company.platform ?? undefined },
    person: { full_name: person?.full_name ?? null, job_title: person?.job_title ?? null }, observation, consequence: untag(p.business_consequence ?? '') || null, sender: s, target_kind }, opts);
  let { note, follow_up } = r.output;
  note = note.replace(/\s+/g, ' ').trim(); follow_up = follow_up.trim();
  if (note.length > 300) throw new HttpError(422, `note is ${note.length} characters; LinkedIn allows 300`);
  if (PUSHY.test(note) || PUSHY.test(follow_up)) throw new HttpError(422, 'the note or follow-up uses pushy wording; refused');
  const row = (await one(`insert into linkedin_outreach(prospect_id,contact_id,sender,target_url,target_kind,note,follow_up,queued_for,ai_run_id) values($1,$2,$3,$4,$5,$6,$7,coalesce($8::date, ${TODAY_IST}),$9) returning id`,
    [p.id, person?.id ?? null, senderKey, target_url, target_kind, note, follow_up, day ?? null, r.runId]))!;
  await audit('prospect', p.id, 'linkedin_queued', senderKey, { target_kind, run_id: r.runId });
  return { id: row.id, target_kind, note, follow_up };
}

// Fills a sender's queue up to the daily cap for the given day: best companies first, a named person with a profile
// before a company page, never a company already written to, suppressed, or closed.
export async function build(senderKey: string, count = DAILY_CAP, day?: string, opts: { workflowRunId?: string } = {}) {
  sender(senderKey);
  const have = Number((await one(`select count(*)::int n from linkedin_outreach where sender=$1 and queued_for=coalesce($2::date, ${TODAY_IST}) and status<>'SKIPPED'`, [senderKey, day ?? null]))!.n);
  const want = Math.max(0, Math.min(count, DAILY_CAP) - have);
  const rows = await q(`select p.id from prospects p join companies c on c.id=p.company_id
    left join contacts ct on ct.id=p.contact_id
    where not p.suppressed and p.status not in ('REJECTED','LOST','SUPPRESSED','WON') and p.specific_observation is not null and p.specific_observation <> 'UNKNOWN'
      and not exists (select 1 from linkedin_outreach l where l.prospect_id=p.id)
      and coalesce(p.account_score, 0) >= 55
    order by (ct.linkedin_url is not null) desc, (ct.full_name is not null) desc, p.account_score desc nulls last, p.screen_score desc nulls last limit $1`, [want * 2]);
  const out: any[] = []; let queued = 0;
  for (const r of rows) { if (queued >= want) break; try { const x = await queueOne(r.id, senderKey, day, opts); if (!(x as any).reused) queued++; out.push({ prospect_id: r.id, ...x }); } catch (e: any) { out.push({ prospect_id: r.id, error: e.message }); } }
  return { queued, already_today: have, cap: DAILY_CAP, results: out };
}

export async function today(senderKey: string, day?: string) {
  sender(senderKey);
  const rows = await q(`select l.*, c.name company, c.domain, c.website, p.account_score, p.primary_problem, p.specific_observation, ct.full_name person, ct.job_title person_title, ct.email person_email, ct.phone person_phone
    from linkedin_outreach l join prospects p on p.id=l.prospect_id join companies c on c.id=p.company_id left join contacts ct on ct.id=l.contact_id
    where l.sender=$1 and ((l.queued_for = coalesce($2::date, ${TODAY_IST}) and l.status in ('QUEUED','SENT')) or (l.status='ACCEPTED' and l.follow_up_sent_at is null))
    order by case l.status when 'ACCEPTED' then 0 when 'QUEUED' then 1 else 2 end, p.account_score desc nulls last`, [senderKey, day ?? null]);
  const counts = (await one(`select count(*) filter (where status<>'QUEUED' and status<>'SKIPPED' and sent_at::date = ${TODAY_IST})::int sent_today,
      count(*) filter (where status='ACCEPTED' and follow_up_sent_at is null)::int follow_ups_due, count(*) filter (where status='REPLIED')::int replied, count(*) filter (where status in ('SENT','ACCEPTED','REPLIED'))::int sent_all
    from linkedin_outreach where sender=$1`, [senderKey]))!;
  return { sender: SENDERS[senderKey], cap: DAILY_CAP, counts, items: rows };
}

const NEXT: Record<string, string[]> = { QUEUED: ['SENT', 'SKIPPED'], SENT: ['ACCEPTED', 'DECLINED', 'REPLIED', 'SKIPPED'], ACCEPTED: ['REPLIED', 'SKIPPED'], REPLIED: [], DECLINED: [], SKIPPED: [] };
export async function setStatus(id: string, status: string, actor: string, extra: { reason?: string; follow_up_sent?: boolean } = {}) {
  const l = await one('select * from linkedin_outreach where id=$1', [id]); if (!l) throw new HttpError(404, 'not in the queue');
  if (extra.follow_up_sent) { if (l.status !== 'ACCEPTED') throw new HttpError(409, 'follow-up goes only after they accept'); await q('update linkedin_outreach set follow_up_sent_at=now() where id=$1', [id]); await audit('prospect', l.prospect_id, 'linkedin_follow_up_sent', actor); return { id, status: l.status, follow_up_sent: true }; }
  if (!NEXT[l.status]?.includes(status)) throw new HttpError(409, `cannot go from ${l.status} to ${status}`);
  const stamp = status === 'SENT' ? 'sent_at' : status === 'ACCEPTED' ? 'accepted_at' : status === 'REPLIED' ? 'replied_at' : null;
  await q(`update linkedin_outreach set status=$2, skip_reason=$3${stamp ? `, ${stamp}=now()` : ''} where id=$1`, [id, status, extra.reason ?? null]);
  if (status === 'SENT') await q(`update prospects set last_contacted_at=coalesce(last_contacted_at, now()) where id=$1`, [l.prospect_id]);
  await audit('prospect', l.prospect_id, `linkedin_${status.toLowerCase()}`, actor, extra.reason ? { reason: extra.reason } : {});
  return { id, status };
}
export async function editText(id: string, note?: string, follow_up?: string, actor = 'user') {
  if (note !== undefined && note.trim().length > 300) throw new HttpError(422, 'the note must stay within 300 characters');
  if ((note && PUSHY.test(note)) || (follow_up && PUSHY.test(follow_up))) throw new HttpError(422, 'that wording pushes; keep it humane');
  const r = await one(`update linkedin_outreach set note=coalesce($2,note), follow_up=coalesce($3,follow_up) where id=$1 and status in ('QUEUED','SENT','ACCEPTED') returning id, prospect_id`, [id, note?.trim() ?? null, follow_up?.trim() ?? null]);
  if (!r) throw new HttpError(409, 'cannot edit after the conversation has moved on'); await audit('prospect', r.prospect_id, 'linkedin_edited', actor); return { id };
}
