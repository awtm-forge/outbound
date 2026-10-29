// Provider path: retries on 5xx, re-prompts once on invalid output, records tokens. Fetch is stubbed; nothing leaves the machine.
process.env.AI_PROVIDER = 'anthropic'; process.env.ANTHROPIC_API_KEY = 'test-key-not-real'; process.env.AI_MAX_RETRIES = '3';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>;
before(async () => { t = await bootstrap(); }); after(async () => { await t.teardown(); });
test('anthropic call retries 5xx then succeeds; invalid first answer is re-prompted', async () => {
  const { runAgent } = await import('../src/lib/ai.ts'); const { z } = await import('zod');
  // full Messages API shapes with a JSON content type, as the official SDK expects them
  const msg = (text: string, usage: any) => new Response(JSON.stringify({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage }), { headers: { 'content-type': 'application/json' } });
  const answers = [new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } }), { status: 529, headers: { 'content-type': 'application/json' } }), msg('{"b": 7}', { input_tokens: 10, output_tokens: 2 }), msg('```json\n{"b":"seven"}\n```', { input_tokens: 12, output_tokens: 3 })];
  const calls: any[] = []; const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => { calls.push(JSON.parse(init.body)); return answers.shift()!; }) as any;
  try {
    const def = { name: 'retry_agent', version: '1', input: z.object({ a: z.number() }), output: z.object({ b: z.string() }), system: 'sys', user: (i: any) => `in ${i.a}`, mock: () => ({ b: '' }) };
    const r = await runAgent(def, { a: 1 }); assert.deepEqual(r.output, { b: 'seven' }); assert.equal(r.provider, 'anthropic');
    assert.equal(calls.length, 3); assert.match(calls[2].messages[0].content, /failed validation/); assert.match(calls[0].system[0].text, /Never invent facts/); assert.equal(calls[0].system[0].cache_control.type, 'ephemeral'); // the instructions are one cached block
    const { one } = await import('../src/lib/db.ts'); const row = await one(`select tokens_in, tokens_out, valid from ai_runs where agent='retry_agent'`); assert.equal(row!.tokens_in, 22); assert.equal(row!.valid, true);
  } finally { globalThis.fetch = realFetch; }
});
