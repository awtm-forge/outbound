import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { env } from './env.ts';
import { one, q } from './db.ts';
import { log } from './log.ts';
import { HttpError } from '../pipeline.ts';

export type Ctx = { req: IncomingMessage; res: ServerResponse; url: URL; params: Record<string, string>; body: any; actor: string; form: boolean };
type Handler = (c: Ctx) => Promise<unknown>;
type Route = { method: string; re: RegExp; keys: string[]; h: Handler; auth: 'api' | 'dashboard' | 'webhook' | 'none' };
const routes: Route[] = [];
export function route(method: string, path: string, auth: Route['auth'], h: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, h, auth });
}
const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ponytail: in-memory token bucket per ip; one process, so this is enough. Move to pg if a second replica ever exists.
const buckets = new Map<string, { n: number; t: number }>();
function rateLimited(ip: string, limit = 120, windowMs = 60_000) {
  const now = Date.now(); const b = buckets.get(ip) ?? { n: 0, t: now };
  if (now - b.t > windowMs) { b.n = 0; b.t = now; }
  b.n++; buckets.set(ip, b); return b.n > limit;
}

function authenticate(req: IncomingMessage, kind: Route['auth']): string | null {
  if (kind === 'none') return 'anonymous';
  const h = req.headers;
  if (kind === 'webhook') { const s = String(h['x-webhook-secret'] ?? ''); return env.saleshandyWebhookSecret && safeEq(s, env.saleshandyWebhookSecret) ? 'saleshandy' : null; }
  const key = String(h['x-api-key'] ?? '');
  if (env.apiKey && key && safeEq(key, env.apiKey)) return String(h['x-actor'] ?? 'n8n');
  const basic = String(h.authorization ?? '');
  if (basic.startsWith('Basic ')) {
    const [u, p] = Buffer.from(basic.slice(6), 'base64').toString().split(':');
    if (env.dashboardUser && u === env.dashboardUser && p !== undefined && safeEq(p, env.dashboardPassword)) return u;
  }
  return null;
}

async function readBody(req: IncomingMessage): Promise<{ body: any; form: boolean }> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 2_000_000) throw new HttpError(413, 'body too large'); chunks.push(c); }
  const raw = Buffer.concat(chunks).toString(); if (!raw) return { body: {}, form: false };
  const ct = String(req.headers['content-type'] ?? '');
  if (ct.includes('application/x-www-form-urlencoded')) { const sp = new URLSearchParams(raw); const body: Record<string, any> = {}; for (const k of new Set(sp.keys())) { const all = sp.getAll(k); body[k] = all.length > 1 ? all : all[0]; } return { body, form: true }; }
  try { return { body: JSON.parse(raw), form: false }; } catch { throw new HttpError(400, 'invalid json'); }
}

export async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x'); const t0 = Date.now();
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '?').split(',')[0].trim();
  const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    const isHtml = typeof body === 'string';
    res.writeHead(status, { 'content-type': isHtml ? 'text/html; charset=utf-8' : 'application/json', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...headers });
    res.end(isHtml ? body : JSON.stringify(body));
    log.info('http', { m: req.method, p: url.pathname, s: status, ms: Date.now() - t0, ip });
  };
  try {
    if (rateLimited(ip)) throw new HttpError(429, 'rate limited');
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname)); if (!r) throw new HttpError(404, 'not found');
    const actor = authenticate(req, r.auth);
    if (!actor) return send(401, { error: 'unauthorized' }, r.auth === 'dashboard' ? { 'www-authenticate': 'Basic realm="awtm-ops"' } : {});
    const m = url.pathname.match(r.re)!; const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const { body, form } = req.method === 'GET' ? { body: {}, form: false } : await readBody(req);
    const idem = String(req.headers['idempotency-key'] ?? '');
    if (req.method !== 'GET' && !form && url.pathname.startsWith('/api/') && !idem) throw new HttpError(400, 'Idempotency-Key header required');
    if (idem && req.method !== 'GET') { const prev = await one('select status, response from idempotency_keys where key=$1', [idem]); if (prev) return send(prev.status, prev.response, { 'idempotent-replay': 'true' }); }
    const out = await r.h({ req, res, url, params, body, actor, form });
    if (res.writableEnded) return;
    const status = typeof out === 'object' && out && 'created' in (out as any) && (out as any).created ? 201 : 200;
    if (idem && req.method !== 'GET' && typeof out !== 'string') await q('insert into idempotency_keys(key,method,path,status,response) values($1,$2,$3,$4,$5) on conflict do nothing', [idem, req.method, url.pathname, status, JSON.stringify(out ?? {})]);
    send(status, out ?? {});
  } catch (e: any) {
    const status = e instanceof HttpError ? e.status : e?.name === 'ZodError' ? 400 : 500;
    if (status >= 500) log.error('unhandled', { p: url.pathname, err: e?.message, stack: e?.stack?.split('\n').slice(0, 4) });
    send(status, { error: status === 500 && env.nodeEnv === 'production' ? 'internal error' : e?.message ?? 'error', run_id: e?.runId });
  }
}
export const redirect = (c: Ctx, to: string) => { c.res.writeHead(303, { location: to }); c.res.end(); };
