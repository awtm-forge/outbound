// Generic agent runner: schema in, schema out, every call recorded in ai_runs, cached by input hash.
import { createHash } from 'node:crypto';
import type { ZodType } from 'zod';
import { env } from './env.ts';
import { q, one } from './db.ts';
import { log } from './log.ts';
import Anthropic from '@anthropic-ai/sdk';

export type AgentDef<I, O, IIn = any> = {
  name: string; version: string; tier?: 'default' | 'cheap';
  // Claude only: how hard to think (default: medium, low for the cheap tier) and whether it may search the web
  effort?: 'low' | 'medium' | 'high'; webSearch?: { maxUses: number };
  input: ZodType<I, any, IIn>; output: ZodType<O, any, any>;
  system: string; user: (i: I) => string; mock: (i: I) => O;
};
export type RunResult<O> = { output: O; runId: string; cached: boolean; provider: string; model: string };
export class AgentError extends Error { runId?: string; constructor(msg: string, runId?: string) { super(msg); this.runId = runId; } }

const hash = (o: unknown) => createHash('sha256').update(JSON.stringify(o)).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const GUARDRAILS = `
Rules that override everything else:
- Output ONLY a single JSON object matching the schema described. No prose, no markdown fences.
- Never invent facts. If evidence is missing, use the string "UNKNOWN" (or an empty array where a list is expected) and lower confidence.
- Label every factual claim as OBSERVED (seen in the supplied material), INFERRED (reasoned from it) or UNKNOWN.
- Never strengthen client wording. Never convert STATED or TO CONFIRM proof into VERIFIED. Never use proof labelled PRIVATE.
- Do not use em dashes.`;

type ModelReply = { text: string; tokensIn: number; tokensOut: number; costMicros?: number; searches?: number };
type RequestOpts = { effort?: 'low' | 'medium' | 'high'; webSearch?: { maxUses: number } };
class Retryable extends Error { waitMs?: number; constructor(m: string, waitMs?: number) { super(m); this.waitMs = waitMs; } }

// One request to the configured provider. Throws Retryable on rate limits and outages, a plain Error otherwise.
async function requestModel(model: string, system: string, user: string, opts: RequestOpts = {}): Promise<ModelReply> {
  if (env.aiProvider === 'gemini') {
    // Native Gemini API with JSON output enforced by the provider, not just asked for in the prompt.
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(120_000),
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.geminiKey },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: env.aiTemperature, maxOutputTokens: env.aiMaxTokens, responseMimeType: 'application/json' } }),
    });
    const body = await res.text();
    if (res.status === 429 || res.status >= 500) {
      // free-tier limits are per minute; Google says how long to wait, either as a header or as RetryInfo in the body
      const hinted = Number(res.headers.get('retry-after')) * 1000 || Number(body.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/)?.[1]) * 1000 || undefined;
      throw new Retryable(`gemini ${res.status}`, hinted);
    }
    if (!res.ok) throw new Error(`gemini ${res.status}: ${body.slice(0, 300)}`);
    const j = JSON.parse(body);
    const cand = j.candidates?.[0];
    if (!cand?.content?.parts) throw new Error(`gemini returned no content (${cand?.finishReason ?? j.promptFeedback?.blockReason ?? 'unknown'})`);
    // thinking models spend part of the output budget before answering; a cut-off answer is a budget problem, not bad JSON
    if (cand.finishReason === 'MAX_TOKENS') throw new Error(`gemini stopped at the output limit (${env.aiMaxTokens} tokens, ${j.usageMetadata?.thoughtsTokenCount ?? 0} of them thinking). Raise AI_MAX_TOKENS.`);
    return { text: cand.content.parts.map((p: any) => p.text ?? '').join(''), tokensIn: j.usageMetadata?.promptTokenCount ?? 0, tokensOut: (j.usageMetadata?.candidatesTokenCount ?? 0) + (j.usageMetadata?.thoughtsTokenCount ?? 0) };
  }
  return requestClaude(model, system, user, opts);
}

// ---------------- Claude, through the official SDK ----------------
// Prices per million tokens, from Anthropic's published table (6 Oct 2026). Cache writes bill at 1.25x input.
// Web search is billed per search; $10 per 1,000 is the published rate this assumes.
const PRICES: Record<string, { in: number; out: number; cacheRead: number }> = {
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2 }, 'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01 }, 'claude-fable-5-1': { in: 10, out: 50, cacheRead: 0.25 },
};
const WEB_SEARCH_MICROS = 10_000; // $0.01 a search
export function costMicros(model: string, u: { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }, searches = 0): number {
  const p = PRICES[model] ?? PRICES['claude-opus-5-5']; // unknown model: price as Opus so the cap errs on the safe side
  // tokens x dollars-per-million = micro-dollars exactly; rounded once at the end
  const m = (u.input_tokens ?? 0) * p.in + (u.cache_creation_input_tokens ?? 0) * p.in * 1.25 + (u.cache_read_input_tokens ?? 0) * p.cacheRead + (u.output_tokens ?? 0) * p.out;
  return Math.round(m) + searches * WEB_SEARCH_MICROS;
}
let claudeClient: Anthropic | undefined;
const claude = () => claudeClient ??= new Anthropic({
  apiKey: env.anthropicKey, maxRetries: 0, timeout: 300_000, // our callModel owns retries, with the provider's wait hint
  fetch: (url: any, init?: any) => globalThis.fetch(url, init), // resolved per call so tests can stub the network
});
async function requestClaude(model: string, system: string, user: string, opts: RequestOpts): Promise<ModelReply> {
  const tools = opts.webSearch ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: opts.webSearch.maxUses, user_location: { type: 'approximate', country: 'IN' } }] : undefined;
  const messages: any[] = [{ role: 'user', content: user }];
  let text = '', tokensIn = 0, tokensOut = 0, cost = 0, searches = 0;
  // a web-searching turn can pause; hand its content back and let it continue, a few times at most
  for (let turn = 0; turn < 6; turn++) {
    let r: any;
    try {
      r = await claude().beta.messages.create({
        model, max_tokens: 16000, system, messages, output_config: { effort: opts.effort ?? 'medium' },
        // a policy decline on Opus or Sonnet is retried on a fallback model inside the same call
        ...(/opus|sonnet/.test(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
        ...(tools ? { tools } : {}),
      } as any);
    } catch (e: any) {
      if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError || e?.status === 529)
        throw new Retryable(`anthropic ${e.status ?? 'connection'}`, Number(e.headers?.get?.('retry-after')) * 1000 || undefined);
      if (e instanceof Anthropic.APIError) throw new Error(`anthropic ${e.status}: ${String(e.message).slice(0, 300)}`);
      throw e;
    }
    const u = r.usage ?? {}; const s = u.server_tool_use?.web_search_requests ?? 0;
    searches += s; cost += costMicros(r.model ?? model, u, s);
    tokensIn += (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0); tokensOut += u.output_tokens ?? 0;
    if (r.stop_reason === 'refusal') throw new Error(`claude declined (${r.stop_details?.category ?? 'no category'})`);
    if (r.stop_reason === 'max_tokens') throw new Error('claude stopped at the output limit');
    text = (r.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    if (r.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: r.content });
  }
  return { text, tokensIn, tokensOut, costMicros: cost, searches };
}
// Retries rate limits and outages: the provider's own wait hint when it gives one, else 5, 15, 45 s (a Google 503 lasts
// tens of seconds, not milliseconds). Capped at 65 s a wait.
async function callModel(model: string, system: string, user: string, opts: RequestOpts = {}): Promise<ModelReply> {
  let lastErr: any;
  for (let attempt = 0; attempt <= env.aiMaxRetries; attempt++) {
    try { return await requestModel(model, system, user, opts); }
    catch (e: any) {
      lastErr = e;
      const retryable = e instanceof Retryable || e?.name === 'TimeoutError' || e?.cause?.code === 'ECONNRESET';
      if (!retryable || attempt === env.aiMaxRetries) break;
      const wait = Math.min(65_000, e.waitMs ?? env.aiRetryBaseMs * 3 ** attempt);
      log.warn('model retry', { provider: env.aiProvider, attempt: attempt + 1, waitMs: wait, reason: e.message });
      await sleep(wait);
    }
  }
  throw lastErr;
}

// Hard stop on Claude spend: AI_SPEND_CAP_USD dollars measured from AI_SPEND_SINCE (or all time). Off when 0.
export class SpendCapReached extends Error {}
export async function spentMicros(since = env.aiSpendSince) {
  return Number((await one(`select coalesce(sum(cost_micros),0)::bigint n from ai_runs where provider='anthropic' and ($1::timestamptz is null or created_at >= $1)`, [since || null]))!.n);
}
async function checkSpendCap() {
  if (!env.aiSpendCapUsd) return;
  const spent = await spentMicros();
  if (spent >= env.aiSpendCapUsd * 1_000_000) throw new SpendCapReached(`Claude spend cap reached: $${(spent / 1e6).toFixed(2)} of $${env.aiSpendCapUsd}`);
}
export function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = t.indexOf('{'), end = t.lastIndexOf('}');
  return JSON.parse(start >= 0 ? t.slice(start, end + 1) : t);
}

export async function runAgent<I, O, IIn>(def: AgentDef<I, O, IIn>, rawInput: IIn, opts: { workflowRunId?: string; force?: boolean } = {}): Promise<RunResult<O>> {
  const input = def.input.parse(rawInput);
  const input_hash = hash({ v: def.version, input });
  const provider = env.aiProvider;
  const model = provider === 'mock' ? 'mock' : def.tier === 'cheap' ? env.aiModelCheap : env.aiModel;

  if (!opts.force) {
    const prev = await one(`select id, output from ai_runs where agent=$1 and prompt_version=$2 and input_hash=$3 and provider=$4 and valid
      and created_at > now() - ($5 || ' hours')::interval order by created_at desc limit 1`, [def.name, def.version, input_hash, provider, String(env.aiCacheTtlHours)]);
    if (prev) {
      const r = await one('insert into ai_runs(agent,prompt_version,provider,model,input,input_hash,output,valid,cached_from,workflow_run_id,duration_ms) values($1,$2,$3,$4,$5,$6,$7,true,$8,$9,0) returning id',
        [def.name, def.version, provider, model, input, input_hash, prev.output, prev.id, opts.workflowRunId ?? null]);
      return { output: prev.output as O, runId: r!.id, cached: true, provider, model };
    }
  }

  if (provider === 'anthropic') await checkSpendCap();
  const t0 = Date.now();
  let raw = '', tokensIn = 0, tokensOut = 0, cost = 0, searches = 0, parsed: unknown, error: string | undefined;
  const reqOpts: RequestOpts = { effort: def.effort ?? (def.tier === 'cheap' ? 'low' : 'medium'), webSearch: def.webSearch };
  try {
    if (provider === 'mock') { parsed = def.mock(input); raw = JSON.stringify(parsed); }
    else {
      const system = def.system + GUARDRAILS;
      let user = def.user(input);
      for (let pass = 0; pass < 2; pass++) {
        const r = await callModel(model, system, user, reqOpts); raw = r.text; tokensIn += r.tokensIn; tokensOut += r.tokensOut; cost += r.costMicros ?? 0; searches += r.searches ?? 0;
        try { parsed = parseJson(raw); const v = def.output.safeParse(parsed); if (v.success) { parsed = v.data; error = undefined; break; } error = v.error.message; }
        catch (e: any) { error = 'invalid json: ' + e.message; }
        user = def.user(input) + `\n\nYour previous answer failed validation: ${error.slice(0, 800)}\nReturn corrected JSON only.`;
      }
    }
  } catch (e: any) { error = e.message; }

  const validation = parsed === undefined ? null : def.output.safeParse(parsed);
  const valid = !!validation?.success;
  const run = await one('insert into ai_runs(agent,prompt_version,provider,model,input,input_hash,output,raw_output,valid,error,tokens_in,tokens_out,duration_ms,workflow_run_id,cost_micros,web_searches) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id',
    [def.name, def.version, provider, model, input, input_hash, valid ? validation!.data : null, raw.slice(0, 20000), valid, valid ? null : (error ?? validation?.error?.message ?? 'unknown'), tokensIn, tokensOut, Date.now() - t0, opts.workflowRunId ?? null, cost, searches]);
  if (!valid) { log.error('agent failed', { agent: def.name, runId: run!.id, error }); throw new AgentError(`${def.name}: ${error ?? 'output failed schema'}`, run!.id); }
  log.info('agent ok', { agent: def.name, runId: run!.id, model, ms: Date.now() - t0 });
  return { output: validation!.data as O, runId: run!.id, cached: false, provider, model };
}
