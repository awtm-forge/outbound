// The only code that talks to Saleshandy. Server only: the key is read here from the environment and goes nowhere
// but the x-api-key header. Reads are open to the sync and the screens; the write sender can be taken exactly once,
// and the write gateway takes it when it loads, so no other code can send a write.
//
// Paths, headers and the envelope follow Saleshandy's official command line client (see docs/saleshandy/DIAGNOSIS.md):
// host https://open-api.saleshandy.com, paths under /api/open-api/v1/ or /v1/, x-api-key plus sh-application: open-api,
// successes wrapped as { payload }, errors as { code, type, message } or { statusCode, message }.
import { shConfig } from './config.ts';
import { log } from '../lib/log.ts';
import { mockTransport } from './mock.ts';

export type ShRequest = { method: string; url: string; headers: Record<string, string>; body?: string; signal: AbortSignal };
export type ShResponse = { status: number; headers: Record<string, string>; text: string };
export type Transport = (r: ShRequest) => Promise<ShResponse>;

export class ShError extends Error {
  status: number; code: number | null; type: string; retriable: boolean;
  constructor(status: number, message: string, opts: { code?: number | null; type?: string; retriable?: boolean } = {}) {
    super(message); this.name = 'ShError'; this.status = status; this.code = opts.code ?? null; this.type = opts.type ?? 'general'; this.retriable = !!opts.retriable;
  }
}

const fetchTransport: Transport = async (r) => {
  const res = await fetch(r.url, { method: r.method, headers: r.headers, body: r.body, signal: r.signal });
  const headers: Record<string, string> = {}; res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  return { status: res.status, headers, text: await res.text() };
};
let override: Transport | null = null;
// tests replace the transport; nothing else does
export function setTransport(t: Transport | null) { override = t; }
const transport = (): Transport => override ?? (shConfig().live ? fetchTransport : mockTransport);

// the host only: an old setting of .../v1 is trimmed so paths are never doubled
const base = () => String(process.env.SALESHANDY_BASE_URL || 'https://open-api.saleshandy.com').replace(/\/+$/, '').replace(/\/v1$/, '');

// one request at a time per interval across the whole process: reads, sync and writes share it
let nextSlot = 0;
async function throttle() {
  const gap = shConfig().minIntervalMs; const now = Date.now();
  const wait = Math.max(0, nextSlot - now); nextSlot = Math.max(now, nextSlot) + gap;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}
export const TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Retry-After is seconds or an HTTP date; anything odd falls back to the backoff
export function retryAfterMs(v: string | undefined): number | null {
  if (!v) return null; const n = Number(v); if (Number.isFinite(n) && n >= 0) return Math.min(n * 1000, 120_000);
  const d = Date.parse(v); return Number.isFinite(d) ? Math.min(Math.max(0, d - Date.now()), 120_000) : null;
}
// exponential with jitter; the base can be lowered for tests (SALESHANDY_BACKOFF_MS)
export const backoffMs = (attempt: number) => Math.min(30_000, Math.max(0, Number(process.env.SALESHANDY_BACKOFF_MS ?? 500)) * 2 ** attempt) * (0.5 + Math.random() / 2);

type Opts = { query?: Record<string, unknown>; body?: unknown };
function buildUrl(path: string, query?: Record<string, unknown>) {
  const u = new URL(base() + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) for (const x of v) u.searchParams.append(k, String(x)); else u.searchParams.set(k, String(v));
  }
  return u.toString();
}
async function request(method: string, path: string, opts: Opts = {}): Promise<any> {
  const key = process.env.SALESHANDY_API_KEY ?? '';
  const url = buildUrl(path, opts.query);
  let last: ShError | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await throttle();
    let res: ShResponse;
    try {
      res = await transport()({ method, url, headers: { 'x-api-key': key, 'sh-application': 'open-api', 'content-type': 'application/json', accept: 'application/json' },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e: any) {
      // network trouble or the timeout: worth another try
      last = new ShError(0, e?.name === 'TimeoutError' ? 'Saleshandy did not answer within 15 seconds.' : 'Saleshandy could not be reached.', { type: 'system', retriable: true });
      log.warn('saleshandy unreachable', { m: method, p: path, attempt });
      if (attempt < MAX_ATTEMPTS - 1) { await sleep(backoffMs(attempt)); continue; }
      throw last;
    }
    let data: any = null; try { data = res.text ? JSON.parse(res.text) : null; } catch { data = null; }
    if (res.status >= 200 && res.status < 300) return data && typeof data === 'object' && 'payload' in data ? data.payload : data;
    const msg = String((data && (data.message ?? data.messages)) ?? '').slice(0, 300) || `Saleshandy answered ${res.status}.`;
    const retriable = res.status === 429 || res.status >= 500;
    last = new ShError(res.status, Array.isArray(msg) ? msg.join(', ') : msg, { code: data?.code ?? data?.statusCode ?? null, type: data?.type ?? (res.status === 401 ? 'auth' : 'general'), retriable });
    log.warn('saleshandy error', { m: method, p: path, s: res.status, attempt });
    if (!retriable || attempt === MAX_ATTEMPTS - 1) throw last;
    await sleep(retryAfterMs(res.headers['retry-after']) ?? backoffMs(attempt));
  }
  throw last ?? new ShError(0, 'Saleshandy request failed.');
}

// POST endpoints that only read; anything else sent with POST is a write and must go through the gateway
const READ_POSTS = new Set(['/api/open-api/v1/unified-inbox/emails', '/api/open-api/v1/email-accounts', '/api/open-api/v1/analytics/stats',
  '/api/open-api/v1/analytics/consolidated-stats', '/api/open-api/v1/analytics/emailaccount/stats', '/api/open-api/v1/analytics/team/stats', '/api/open-api/v1/prospects/verification-status']);
export const read = {
  get: (path: string, query?: Record<string, unknown>) => request('GET', path, { query }),
  post: (path: string, body: unknown) => {
    if (!READ_POSTS.has(path)) throw new ShError(0, `${path} is not a read; writes go through the write gateway.`);
    return request('POST', path, { body });
  },
};

export type Writer = (method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;
let taken = false;
// the write gateway calls this once when it loads; a second caller is refused, so it is the only sender
export function takeWriter(): Writer {
  if (taken) throw new Error('The Saleshandy writer belongs to the write gateway.');
  taken = true;
  return (method, path, body) => request(method, path, { body });
}
