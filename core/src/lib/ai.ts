// Generic agent runner: schema in, schema out, every call recorded in ai_runs, cached by input hash.
import { createHash } from 'node:crypto';
import type { ZodType } from 'zod';
import { env } from './env.ts';
import { q, one } from './db.ts';
import { log } from './log.ts';

export type AgentDef<I, O, IIn = any> = {
  name: string; version: string; tier?: 'default' | 'cheap';
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

type ModelReply = { text: string; tokensIn: number; tokensOut: number };
class Retryable extends Error { waitMs?: number; constructor(m: string, waitMs?: number) { super(m); this.waitMs = waitMs; } }

// One request to the configured provider. Throws Retryable on rate limits and outages, a plain Error otherwise.
async function requestModel(model: string, system: string, user: string): Promise<ModelReply> {
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
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(120_000),
    headers: { 'content-type': 'application/json', 'x-api-key': env.anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: env.aiMaxTokens, temperature: env.aiTemperature, system, messages: [{ role: 'user', content: user }] }),
  });
  if (res.status === 429 || res.status >= 500) throw new Retryable(`anthropic ${res.status}`, Number(res.headers.get('retry-after')) * 1000 || undefined);
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j: any = await res.json();
  return { text: j.content?.map((c: any) => c.text ?? '').join('') ?? '', tokensIn: j.usage?.input_tokens ?? 0, tokensOut: j.usage?.output_tokens ?? 0 };
}
// Retries rate limits and outages: the provider's own wait hint when it gives one, else exponential backoff. Capped at 65 s a wait.
async function callModel(model: string, system: string, user: string): Promise<ModelReply> {
  let lastErr: any;
  for (let attempt = 0; attempt <= env.aiMaxRetries; attempt++) {
    try { return await requestModel(model, system, user); }
    catch (e: any) {
      lastErr = e;
      const retryable = e instanceof Retryable || e?.name === 'TimeoutError' || e?.cause?.code === 'ECONNRESET';
      if (!retryable || attempt === env.aiMaxRetries) break;
      const wait = Math.min(65_000, e.waitMs ?? 1000 * 2 ** attempt);
      log.warn('model retry', { provider: env.aiProvider, attempt: attempt + 1, waitMs: wait, reason: e.message });
      await sleep(wait);
    }
  }
  throw lastErr;
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

  const t0 = Date.now();
  let raw = '', tokensIn = 0, tokensOut = 0, parsed: unknown, error: string | undefined;
  try {
    if (provider === 'mock') { parsed = def.mock(input); raw = JSON.stringify(parsed); }
    else {
      const system = def.system + GUARDRAILS;
      let user = def.user(input);
      for (let pass = 0; pass < 2; pass++) {
        const r = await callModel(model, system, user); raw = r.text; tokensIn += r.tokensIn; tokensOut += r.tokensOut;
        try { parsed = parseJson(raw); const v = def.output.safeParse(parsed); if (v.success) { parsed = v.data; error = undefined; break; } error = v.error.message; }
        catch (e: any) { error = 'invalid json: ' + e.message; }
        user = def.user(input) + `\n\nYour previous answer failed validation: ${error.slice(0, 800)}\nReturn corrected JSON only.`;
      }
    }
  } catch (e: any) { error = e.message; }

  const validation = parsed === undefined ? null : def.output.safeParse(parsed);
  const valid = !!validation?.success;
  const run = await one('insert into ai_runs(agent,prompt_version,provider,model,input,input_hash,output,raw_output,valid,error,tokens_in,tokens_out,duration_ms,workflow_run_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id',
    [def.name, def.version, provider, model, input, input_hash, valid ? validation!.data : null, raw.slice(0, 20000), valid, valid ? null : (error ?? validation?.error?.message ?? 'unknown'), tokensIn, tokensOut, Date.now() - t0, opts.workflowRunId ?? null]);
  if (!valid) { log.error('agent failed', { agent: def.name, runId: run!.id, error }); throw new AgentError(`${def.name}: ${error ?? 'output failed schema'}`, run!.id); }
  log.info('agent ok', { agent: def.name, runId: run!.id, model, ms: Date.now() - t0 });
  return { output: validation!.data as O, runId: run!.id, cached: false, provider, model };
}
