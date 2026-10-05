import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { env } from './env.ts';
import { one, q } from './db.ts';
import { log } from './log.ts';
import { HttpError } from '../pipeline.ts';

export type Ctx = { req: IncomingMessage; res: ServerResponse; url: URL; params: Record<string, string>; body: any; actor: string; ip: string; setCookie: (c: string) => void };
type Handler = (c: Ctx) => Promise<unknown>;
// api: X-Api-Key (n8n, scripts) or a signed-in session (the ops app). webhook: X-Webhook-Secret. none: public.
type Route = { method: string; re: RegExp; keys: string[]; h: Handler; auth: 'api' | 'webhook' | 'none' };
const routes: Route[] = [];
export function route(method: string, path: string, auth: Route['auth'], h: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, h, auth });
}
export const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ponytail: in-memory buckets per ip; one process, so this is enough. Move to pg if a second replica ever exists.
const buckets = new Map<string, { n: number; t: number }>();
export function rateLimited(key: string, limit: number, windowMs = 60_000) {
  const now = Date.now(); const b = buckets.get(key) ?? { n: 0, t: now };
  if (now - b.t > windowMs) { b.n = 0; b.t = now; }
  b.n++; buckets.set(key, b); return b.n > limit;
}

// ---------- sessions: HMAC-signed cookie, HttpOnly, SameSite=Strict ----------
// CSRF: every /api mutation already requires an Idempotency-Key header, which a cross-site form or image cannot send,
// and the server sends no CORS headers, so a cross-site script cannot either.
export const SESSION_COOKIE = 'awtm_session';
const SESSION_HOURS = 12;
const sign = (v: string) => createHmac('sha256', env.sessionSecret).update(v).digest('base64url');
export function makeSession(user: string, secure: boolean) {
  const v = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + SESSION_HOURS * 3600_000 })).toString('base64url');
  return `${SESSION_COOKIE}=${v}.${sign(v)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${secure ? '; Secure' : ''}`;
}
export const clearSession = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
export function sessionUser(req: IncomingMessage): string | null {
  if (!env.sessionSecret) return null;
  const raw = String(req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(SESSION_COOKIE + '='))?.slice(SESSION_COOKIE.length + 1);
  if (!raw) return null;
  const [v, sig] = raw.split('.'); if (!v || !sig || !safeEq(sig, sign(v))) return null;
  try { const s = JSON.parse(Buffer.from(v, 'base64url').toString()); return s.exp > Date.now() ? String(s.u) : null; } catch { return null; }
}

function authenticate(req: IncomingMessage, kind: Route['auth']): string | null {
  if (kind === 'none') return 'anonymous';
  const h = req.headers;
  if (kind === 'webhook') {
    // header first; a ?token= in the URL for senders that cannot set headers. The query string is never logged.
    const s = String(h['x-webhook-secret'] ?? '') || (new URL(req.url ?? '/', 'http://x').searchParams.get('token') ?? '');
    return env.saleshandyWebhookSecret && safeEq(s, env.saleshandyWebhookSecret) ? 'saleshandy' : null;
  }
  const key = String(h['x-api-key'] ?? '');
  if (env.apiKey && key && safeEq(key, env.apiKey)) return String(h['x-actor'] ?? 'n8n');
  return sessionUser(req);
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 2_000_000) throw new HttpError(413, 'body too large'); chunks.push(c); }
  const raw = Buffer.concat(chunks).toString(); if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'invalid json'); }
}

// ---------- the ops app: static files from web/dist, index.html for every app route ----------
const WEB_DIST = env.webDist;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
async function serveApp(url: URL, res: ServerResponse): Promise<boolean> {
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const isAsset = /\.[a-z0-9]+$/i.test(rel);
  const file = isAsset ? join(WEB_DIST, rel) : join(WEB_DIST, 'index.html');
  if (!file.startsWith(WEB_DIST)) return false;
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' });
    res.end(data); return true;
  } catch { return false; }
}

export async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x'); const t0 = Date.now();
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '?').split(',')[0].trim();
  const cookies: string[] = [];
  const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    const text = typeof body === 'string';
    res.writeHead(status, { 'content-type': text ? 'text/plain; charset=utf-8' : 'application/json', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store', ...(cookies.length ? { 'set-cookie': cookies } : {}), ...headers });
    res.end(text ? body : JSON.stringify(body));
    log.info('http', { m: req.method, p: url.pathname, s: status, ms: Date.now() - t0, ip });
  };
  try {
    if (rateLimited('ip:' + ip, 600)) throw new HttpError(429, 'Too many requests. Wait a minute and try again.');
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) {
      if (req.method === 'GET' && !/^\/(api|webhooks)\//.test(url.pathname) && await serveApp(url, res)) return;
      throw new HttpError(404, 'not found');
    }
    const actor = authenticate(req, r.auth);
    if (!actor) return send(401, { error: 'unauthorized' });
    const m = url.pathname.match(r.re)!; const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const body = req.method === 'GET' ? {} : await readBody(req);
    const idem = String(req.headers['idempotency-key'] ?? '');
    if (req.method !== 'GET' && url.pathname.startsWith('/api/') && !idem) throw new HttpError(400, 'Idempotency-Key header required');
    if (idem && req.method !== 'GET') { const prev = await one('select status, response from idempotency_keys where key=$1', [idem]); if (prev) return send(prev.status, prev.response, { 'idempotent-replay': 'true' }); }
    const out = await r.h({ req, res, url, params, body, actor, ip, setCookie: (c) => cookies.push(c) });
    if (res.writableEnded) return;
    const status = typeof out === 'object' && out && 'created' in (out as any) && (out as any).created ? 201 : 200;
    if (idem && req.method !== 'GET' && typeof out !== 'string') await q('insert into idempotency_keys(key,method,path,status,response) values($1,$2,$3,$4,$5) on conflict do nothing', [idem, req.method, url.pathname, status, JSON.stringify(out ?? {})]);
    send(status, out ?? {});
  } catch (e: any) {
    const status = e instanceof HttpError ? e.status : e?.name === 'ZodError' ? 400 : 500;
    if (status >= 500) log.error('unhandled', { p: url.pathname, err: e?.message, stack: e?.stack?.split('\n').slice(0, 4) });
    send(status, { error: status === 500 && env.nodeEnv === 'production' ? 'Something went wrong on our side. It is logged.' : e?.message ?? 'error', run_id: e?.runId });
  }
}
