// Claude path with a stubbed network: no temperature sent, effort and fallbacks set, cost measured, cap enforced.
process.env.AI_PROVIDER = 'anthropic'; process.env.ANTHROPIC_API_KEY = 'sk-ant-test'; process.env.AI_MODEL = ''; process.env.AI_MODEL_CHEAP = '';
process.env.AI_SPEND_CAP_USD = '1';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>;
before(async () => { t = await bootstrap(); }); after(async () => { await t.teardown(); });
const reply = (text: string, extra: any = {}) => new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...extra.usage }, ...extra.top }), { headers: { 'content-type': 'application/json' } });
test('cost is measured in micro-dollars from the usage figures', async () => {
  const { costMicros } = await import('../src/lib/ai.ts');
  assert.equal(costMicros('claude-opus-5-5', { input_tokens: 1000, output_tokens: 500 }), 14_000); // $0.004 + $0.010
  assert.equal(costMicros('claude-opus-5-5', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 10_000 }), 2_000);
  assert.equal(costMicros('claude-haiku-5-5', { input_tokens: 1_000_000, output_tokens: 0 }, 2), 100_000 + 20_000);
});
test('request shape: no temperature, effort from the agent, server-side fallback on Opus; cost and searches recorded', async () => {
  const { runAgent } = await import('../src/lib/ai.ts'); const { z } = await import('zod'); const { one } = await import('../src/lib/db.ts');
  const bodies: any[] = []; const real = globalThis.fetch;
  globalThis.fetch = (async (_u: any, init: any) => { bodies.push(JSON.parse(init.body)); return reply('{"b":"ok"}', { usage: { server_tool_use: { web_search_requests: 3 } } }); }) as any;
  try {
    const r = await runAgent({ name: 'claude_agent', version: '1', effort: 'high', webSearch: { maxUses: 4 }, input: z.object({}), output: z.object({ b: z.string() }), system: 'sys', user: () => 'u', mock: () => ({ b: '' }) }, {});
    assert.deepEqual(r.output, { b: 'ok' }); assert.equal(r.model, 'claude-opus-5-5');
    const b = bodies[0]; assert.equal(b.temperature, undefined); assert.equal(b.output_config.effort, 'high'); assert.equal(b.fallbacks, 'default'); assert.equal(b.tools[0].type, 'web_search_20260209'); assert.equal(b.tools[0].max_uses, 4);
    const row = await one(`select cost_micros, web_searches from ai_runs where agent='claude_agent'`); assert.equal(Number(row!.cost_micros), 14_000 + 30_000); assert.equal(row!.web_searches, 3);
  } finally { globalThis.fetch = real; }
});
test('a refusal is reported as one; the spend cap stops the next call before it is made', async () => {
  const { runAgent, SpendCapReached } = await import('../src/lib/ai.ts'); const { z } = await import('zod'); const { q } = await import('../src/lib/db.ts');
  let calls = 0; const real = globalThis.fetch;
  globalThis.fetch = (async () => { calls++; return reply('', { top: { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } } }); }) as any;
  try {
    await assert.rejects(runAgent({ name: 'claude_refused', version: '1', input: z.object({}), output: z.object({ b: z.string() }), system: 's', user: () => 'u', mock: () => ({ b: '' }) }, {}), /declined \(cyber\)/);
    await q(`insert into ai_runs(agent,prompt_version,provider,model,input,input_hash,valid,cost_micros) values('spend','1','anthropic','claude-opus-5-5','{}','x',true,2000000)`);
    const before = calls;
    await assert.rejects(runAgent({ name: 'claude_capped', version: '1', input: z.object({}), output: z.object({ b: z.string() }), system: 's', user: () => 'u', mock: () => ({ b: '' }) }, {}), SpendCapReached);
    assert.equal(calls, before, 'no request was sent once the cap was reached');
  } finally { globalThis.fetch = real; }
});
