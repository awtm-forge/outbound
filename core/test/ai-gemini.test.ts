// Gemini path with a stubbed network: honours Google's retry hint on 429, enforces JSON output, never retries a 400.
process.env.AI_PROVIDER = 'gemini'; process.env.GEMINI_API_KEY = 'test-gemini-key'; process.env.AI_MAX_RETRIES = '3';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>;
before(async () => { t = await bootstrap(); }); after(async () => { await t.teardown(); });
const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 5 } }));
test('gemini: waits the hinted delay after a 429, then parses enforced JSON and records the model', async () => {
  const { runAgent } = await import('../src/lib/ai.ts'); const { z } = await import('zod'); const { env } = await import('../src/lib/env.ts');
  assert.equal(env.aiModel, 'gemini-3.5-flash'); assert.equal(env.aiModelCheap, 'gemini-3.5-flash-lite');
  const calls: { url: string; init: any; at: number }[] = []; const real = globalThis.fetch;
  const answers = [new Response(JSON.stringify({ error: { code: 429, details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '1s' }] } }), { status: 429 }), ok('{"b":"yes"}')];
  globalThis.fetch = (async (url: any, init: any) => { calls.push({ url: String(url), init, at: Date.now() }); return answers.shift()!; }) as any;
  try {
    const def = { name: 'gem_agent', version: '1', tier: 'cheap' as const, input: z.object({ a: z.number() }), output: z.object({ b: z.string() }), system: 'sys', user: () => 'u', mock: () => ({ b: '' }) };
    const r = await runAgent(def, { a: 1 });
    assert.deepEqual(r.output, { b: 'yes' }); assert.equal(r.provider, 'gemini'); assert.equal(r.model, 'gemini-3.5-flash-lite');
    assert.equal(calls.length, 2); assert.ok(calls[1].at - calls[0].at >= 950, 'waited for the hinted 1s');
    assert.match(calls[0].url, /models\/gemini-3\.5-flash-lite:generateContent$/); assert.equal(calls[0].init.headers['x-goog-api-key'], 'test-gemini-key');
    const body = JSON.parse(calls[0].init.body); assert.equal(body.generationConfig.responseMimeType, 'application/json'); assert.match(body.systemInstruction.parts[0].text, /Never invent facts/);
    const { one } = await import('../src/lib/db.ts'); const row = await one(`select tokens_in, model, valid from ai_runs where agent='gem_agent'`); assert.equal(row!.tokens_in, 40); assert.equal(row!.model, 'gemini-3.5-flash-lite');
  } finally { globalThis.fetch = real; }
});
test('gemini: a 400 is not retried and the failure is recorded', async () => {
  const { runAgent, AgentError } = await import('../src/lib/ai.ts'); const { z } = await import('zod');
  let n = 0; const real = globalThis.fetch;
  globalThis.fetch = (async () => { n++; return new Response('{"error":{"message":"API key not valid"}}', { status: 400 }); }) as any;
  try {
    await assert.rejects(runAgent({ name: 'gem_bad', version: '1', input: z.object({}), output: z.object({ b: z.string() }), system: 's', user: () => 'u', mock: () => ({ b: '' }) }, {}), AgentError);
    assert.equal(n, 1);
    const { one } = await import('../src/lib/db.ts'); assert.match((await one(`select error from ai_runs where agent='gem_bad'`))!.error, /gemini 400/);
  } finally { globalThis.fetch = real; }
});
