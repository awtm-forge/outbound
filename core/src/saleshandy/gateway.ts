// The write gateway: the only path from this app to a Saleshandy write. It takes the client's writer when it loads,
// so nothing else can send one. In order, for every write: permission, kill switches, the environment guard, the
// spend guard, idempotency, an audit row before and after, and the shared throttle (inside the client).
// High risk writes wait 10 seconds before they are sent, so they can be undone; the kill switches are checked again
// at the moment of sending, so switching writes off in an incident also stops what is waiting.
import { q, one } from '../lib/db.ts';
import { log } from '../lib/log.ts';
import { HttpError } from '../pipeline.ts';
import { takeWriter, read, ShError } from './client.ts';
import { shConfig, RISK_FLAG, type Risk } from './config.ts';
import { ACTIONS, type Targets } from './actions.ts';

const send = takeWriter();
export type Actor = { kind: 'user'; id: string; name: string; role: 'admin' | 'member' } | { kind: 'system' };
export const UNDO_MS = 10_000;
export type Outcome = { audit_id: string; outcome: 'refused' | 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled'; reason?: string | null; send_at?: string | null; response?: unknown; replay?: boolean; label?: string };

const istMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const domainOf = (e: string) => e.toLowerCase().split('@').pop()!;
// always a JSON string: pg would send a bare array as a Postgres array, not jsonb
const trim = (v: unknown) => { const s = JSON.stringify(v ?? null); return s.length > 4000 ? JSON.stringify({ truncated: s.slice(0, 4000) }) : s; };
export async function monthSpend() { return Number((await one(`select coalesce(sum(coalesce(actual, estimated)),0)::int n from sh_credit_spend where month=$1`, [istMonth()]))!.n); }

// the checks that stand between a request and Saleshandy; returns the reason to refuse, or null
export function killSwitchReason(risk: Risk): string | null {
  const c = shConfig();
  if (!c.integration) return 'The Saleshandy integration is switched off (SALESHANDY_INTEGRATION_ENABLED).';
  if (!c.writes) return 'Writes to Saleshandy are switched off (SALESHANDY_WRITES_ENABLED).';
  if (!c.risk[risk]) return `${risk === 'spend' ? 'Credit-spending' : risk[0]!.toUpperCase() + risk.slice(1) + ' risk'} writes are switched off (${RISK_FLAG[risk]}).`;
  return null;
}
export function environmentReason(t: Targets & { unresolved?: boolean }, risk: Risk): string | null {
  const c = shConfig(); if (c.production) return null;
  if (risk === 'spend') return 'Outside production, credit-spending calls are refused. Fixtures stand in for them.';
  if (t.createsSequence) return 'Outside production, creating a sequence is refused: only the test sequence may be touched.';
  if (t.unresolved) return 'Outside production, a write is refused unless every affected email address is known.';
  const bad = [...t.emails.map(domainOf), ...t.domains].filter((d) => !c.allowlist.includes(d));
  if (bad.length) return `Outside production, writes only reach addresses at ${c.allowlist.length ? c.allowlist.join(', ') : 'the test allowlist (SALESHANDY_TEST_ALLOWLIST is empty)'}. Refused for ${[...new Set(bad)].slice(0, 3).join(', ')}.`;
  const seq = t.sequenceIds.filter((s) => s !== c.testSequenceId);
  if (seq.length) return c.testSequenceId ? `Outside production, only the test sequence may be touched. Refused for ${seq.slice(0, 3).join(', ')}.` : 'Outside production, sequence writes need SALESHANDY_TEST_SEQUENCE_ID, which is not set.';
  return null;
}

async function refuse(key: string, actor: Actor, action: string, risk: Risk, targets: unknown, reason: string): Promise<Outcome> {
  const row = await one(`insert into sh_write_audit(idempotency_key, actor_user_id, actor, action, risk, targets, outcome, reason) values($1,$2,$3,$4,$5,$6,'refused',$7)
    on conflict (idempotency_key) do nothing returning id`, [key, actor.kind === 'user' ? actor.id : null, actor.kind === 'user' ? actor.name : 'system', action, risk, JSON.stringify(targets ?? {}), reason]);
  log.info('saleshandy write refused', { action, risk, reason });
  return { audit_id: row?.id ?? '', outcome: 'refused', reason };
}

export async function execute(actor: Actor, action: string, rawInput: unknown, idempotencyKey: string): Promise<Outcome> {
  const def = ACTIONS[action]; if (!def) throw new HttpError(400, `Unknown action ${action}.`);
  if (!idempotencyKey || idempotencyKey.length > 300) throw new HttpError(400, 'Every write needs an idempotency key.');
  // a repeated key returns the first outcome and sends nothing
  const prev = await one(`select id, outcome, reason, send_at, response from sh_write_audit where idempotency_key=$1`, [idempotencyKey]);
  if (prev) return { audit_id: prev.id, outcome: prev.outcome, reason: prev.reason, send_at: prev.send_at, response: prev.response, replay: true };
  const parsed = def.input.safeParse(rawInput);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
  const input = parsed.data; const risk = def.risk(input);
  // 1. permission
  if (actor.kind === 'system' && !def.systemAllowed) return refuse(idempotencyKey, actor, action, risk, {}, 'Only a person can do this.');
  if (actor.kind === 'user' && (risk === 'high' || risk === 'spend') && actor.role !== 'admin') return refuse(idempotencyKey, actor, action, risk, {}, 'Only an admin can do this.');
  // 2. kill switches
  const ks = killSwitchReason(risk); if (ks) return refuse(idempotencyKey, actor, action, risk, {}, ks);
  // 3. who and what it touches, and the environment guard
  let targets: Targets & { unresolved?: boolean };
  try { targets = await def.targets(input); } catch (e: any) { return refuse(idempotencyKey, actor, action, risk, {}, e.message); }
  const env = environmentReason(targets, risk); if (env) return refuse(idempotencyKey, actor, action, risk, targets, env);
  // 4. spend guard
  let estimate = 0;
  if (risk === 'spend') {
    const cap = shConfig().creditCap; estimate = def.credits ? await def.credits(input) : 1;
    const spent = await monthSpend();
    if (!cap) return refuse(idempotencyKey, actor, action, risk, targets, 'No monthly credit cap is set (SALESHANDY_MONTHLY_CREDIT_CAP), so nothing may spend credits.');
    if (spent + estimate > cap) return refuse(idempotencyKey, actor, action, risk, targets, `This would use about ${estimate} credits; ${spent} of the ${cap} for this month are already spent.`);
  }
  // 5 and 6. claim the key and audit before sending
  const req = def.request(input);
  const before = def.before ? await def.before(input).catch(() => null) : null;
  const delayed = risk === 'high';
  const row = await one(`insert into sh_write_audit(idempotency_key, actor_user_id, actor, action, risk, targets, before_state, request, outcome, send_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + ($10 || ' milliseconds')::interval) on conflict (idempotency_key) do nothing returning id, send_at`,
    [idempotencyKey, actor.kind === 'user' ? actor.id : null, actor.kind === 'user' ? actor.name : 'system', action, risk, JSON.stringify(targets), trim(before), JSON.stringify({ ...req, input, estimate }), delayed ? 'pending' : 'sending', delayed ? UNDO_MS : 0]);
  if (!row) { const r = (await one(`select id, outcome, reason, send_at from sh_write_audit where idempotency_key=$1`, [idempotencyKey]))!; return { audit_id: r.id, outcome: r.outcome, reason: r.reason, send_at: r.send_at, replay: true }; }
  if (delayed) {
    const t = setTimeout(() => { void sendPending(row.id).catch((e) => log.error('saleshandy pending send failed', { err: e.message })); }, UNDO_MS + 50); t.unref();
    return { audit_id: row.id, outcome: 'pending', send_at: row.send_at, label: targets.label };
  }
  return { ...(await dispatch(row.id)), label: targets.label };
}

// claims a due pending row (once, even with two processes) and sends it
export async function sendPending(auditId: string): Promise<Outcome | null> {
  const r = await one(`update sh_write_audit set outcome='sending', updated_at=now() where id=$1 and outcome='pending' and send_at <= now() returning id`, [auditId]);
  return r ? dispatch(r.id) : null;
}
export async function sendDue() {
  const due = await q(`select id from sh_write_audit where outcome='pending' and send_at <= now() order by send_at limit 20`);
  const out = []; for (const d of due) out.push(await sendPending(d.id)); return out.filter(Boolean).length;
}
export async function cancel(auditId: string, actor: Actor): Promise<Outcome> {
  const r = await one(`update sh_write_audit set outcome='cancelled', reason='Undone before it was sent', updated_at=now() where id=$1 and outcome='pending' and ($2::uuid is null or actor_user_id=$2 or $3) returning id`,
    [auditId, actor.kind === 'user' ? actor.id : null, actor.kind === 'user' && actor.role === 'admin']);
  if (!r) { const cur = await one(`select outcome from sh_write_audit where id=$1`, [auditId]); throw new HttpError(409, cur ? (cur.outcome === 'pending' ? 'Only the person who started this, or an admin, can undo it.' : `Too late to undo: it is already ${cur.outcome}.`) : 'Not found.'); }
  return { audit_id: r.id, outcome: 'cancelled' };
}

async function dispatch(auditId: string): Promise<Outcome> {
  const row = (await one(`select * from sh_write_audit where id=$1`, [auditId]))!;
  const def = ACTIONS[row.action]!; const input = row.request.input;
  // the switches again at the moment of sending: an incident stops what was waiting
  const ks = killSwitchReason(row.risk);
  if (ks) { await q(`update sh_write_audit set outcome='refused', reason=$2, updated_at=now() where id=$1`, [auditId, ks]); return { audit_id: auditId, outcome: 'refused', reason: ks }; }
  let balanceBefore: number | null = null;
  if (row.risk === 'spend') balanceBefore = await creditBalance().catch(() => null);
  try {
    const res = await send(row.request.method, row.request.path, row.request.body);
    await q(`update sh_write_audit set outcome='sent', response=$2, updated_at=now() where id=$1`, [auditId, trim(res)]);
    if (row.risk === 'spend') {
      const after = await creditBalance().catch(() => null);
      await q(`insert into sh_credit_spend(month, action, estimated, balance_before, balance_after, actual, audit_id) values($1,$2,$3,$4,$5,$6,$7)`,
        [istMonth(), row.action, row.request.estimate ?? 0, balanceBefore, after, balanceBefore !== null && after !== null ? Math.max(0, balanceBefore - after) : null, auditId]);
    }
    // show the result at once, without waiting for the next sync; a refresh failure never turns a sent write into a failure
    if (def.refresh) await def.refresh(input, res).catch((e: any) => log.warn('saleshandy refresh after write failed', { action: row.action, err: e.message }));
    return { audit_id: auditId, outcome: 'sent', response: res };
  } catch (e: any) {
    const reason = e instanceof ShError ? e.message : 'The write did not reach Saleshandy.';
    await q(`update sh_write_audit set outcome='failed', reason=$2, response=$3, updated_at=now() where id=$1`, [auditId, reason, JSON.stringify({ status: e?.status ?? null, code: e?.code ?? null })]);
    return { audit_id: auditId, outcome: 'failed', reason };
  }
}
// the remaining enrichment credits as Saleshandy reports them (shape unverified: the first number found)
export async function creditBalance(): Promise<number | null> {
  const r = await read.get('/api/open-api/v1/credits');
  if (typeof r === 'number') return r;
  for (const k of ['enrichmentCredits', 'credits', 'available', 'remaining', 'balance', 'total']) if (r && Number.isFinite(Number(r[k]))) return Number(r[k]);
  return null;
}
