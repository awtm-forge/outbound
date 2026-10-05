// Provider path: retries on 5xx, re-prompts once on invalid output, records tokens. Fetch is stubbed; nothing leaves the machine.
process.env.AI_PROVIDER = 'anthropic'; process.env.ANTHROPIC_API_KEY = 'test-key-not-real'; process.env.AI_MAX_RETRIES = '3';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './helpers.ts';
let t: Awaited<ReturnType<typeof bootstrap>>;
before(async () => { t = await bootstrap(); }); after(async () => { await t.teardown(); });
test('anthropic call retries 5xx then succeeds; invalid first answer is re-prompted', async () => {
  const { runAgent } = await import('../src/lib/ai.ts'); const { z } = await import('zod');
  const answers = [new Response('overloaded', { status: 529 }), new Response(JSON.stringify({ content: [{ type: 'text', text: '{"b": 7}' }], usage: { input_tokens: 10, output_tokens: 2 } })), new Response(JSON.stringify({ content: [{ type: 'text', text: '```json\n{"b":"seven"}\n```' }], usage: { input_tokens: 12, output_tokens: 3 } }))];
  const calls: any[] = []; const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => { calls.push(JSON.parse(init.body)); return answers.shift()!; }) as any;
  try {
    const def = { name: 'retry_agent', version: '1', input: z.object({ a: z.number() }), output: z.object({ b: z.string() }), system: 'sys', user: (i: any) => `in ${i.a}`, mock: () => ({ b: '' }) };
    const r = await runAgent(def, { a: 1 }); assert.deepEqual(r.output, { b: 'seven' }); assert.equal(r.provider, 'anthropic');
    assert.equal(calls.length, 3); assert.match(calls[2].messages[0].content, /failed validation/); assert.match(calls[0].system, /Never invent facts/);
    const { one } = await import('../src/lib/db.ts'); const row = await one(`select tokens_in, tokens_out, valid from ai_runs where agent='retry_agent'`); assert.equal(row!.tokens_in, 22); assert.equal(row!.valid, true);
  } finally { globalThis.fetch = realFetch; }
});
