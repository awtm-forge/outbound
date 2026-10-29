import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/lib/env.ts';
import * as Portal from '../src/portal.ts';

test('portal: refuses clearly when not configured', async () => {
  env.portalApiUrl = ''; env.portalApiKey = '';
  assert.equal(Portal.portalConfigured(), false);
  await assert.rejects(Portal.clients(), /not connected/);
});

test('portal: sends the key, caches for a minute, explains a 404', async () => {
  env.portalApiUrl = 'https://portal.test/'; env.portalApiKey = 'k';
  let calls = 0; let status = 200; const orig = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => { calls++; assert.equal(String(url), 'https://portal.test/api/ops/clients'); assert.equal(init.headers['x-ops-key'], 'k'); return new Response(JSON.stringify({ clients: [] }), { status }); }) as any;
  try {
    Portal.forget();
    assert.deepEqual(await Portal.clients(), { clients: [] }); await Portal.clients(); assert.equal(calls, 1);
    Portal.forget(); status = 404; await assert.rejects(Portal.clients(), /OPS_API_KEY/);
  } finally { globalThis.fetch = orig; }
});
