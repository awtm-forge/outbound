import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { env } from './env.ts';
import { one, q } from './db.ts';
import { log } from './log.ts';
import { HttpError } from '../pipeline.ts';
import { loadUser, publicUser, type SessionUser } from './auth.ts';
import { markActivity } from './activity.ts';

// user: the signed-in person, or null for X-Api-Key callers. actor: who the audit trail names (the username for a person).
export type Ctx = { req: IncomingMessage; res: ServerResponse; url: URL; params: Record<string, string>; body: any; actor: string; user: SessionUser | null; ip: string; setCookie: (c: string) => void };
type Handler = (c: Ctx) => Promise<unknown>;
// api: X-Api-Key (n8n, scripts) or a signed-in person (the ops app). user: a signed-in person only, any role.
// admin: a signed-in admin only. webhook: X-Webhook-Secret. none: public.
// raw: the body is handed over as bytes (a file upload) up to this many bytes, instead of parsed as JSON
type Route = { method: string; re: RegExp; keys: string[]; h: Handler; auth: 'api' | 'user' | 'admin' | 'webhook' | 'none'; raw?: number };
const routes: Route[] = [];
export function route(method: string, path: string, auth: Route['auth'], h: Handler, opts: { raw?: number } = {}) {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, h, auth, raw: opts.raw });
}
export const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ponytail: in-memory buckets per ip; one process, so this is enough. Move to pg if a second replica ever exists.
const buckets = new Map<string, { n: number; t: number }>();
export function rateLimited(key: string, limit: number, windowMs = 60_000) {
  const now = Date.now(); const b = buckets.get(key) ?? { n: 0, t: now };
  if (now - b.t > windowMs) { b.n = 0; b.t = now; }
  b.n++; buckets.set(key, b); return b.n > limit;
}
// Looks without counting; pair with rateLimited() on the outcome that should count (a failed sign-in).
export function overLimit(key: string, limit: number, windowMs = 60_000) { const b = buckets.get(key); return !!b && Date.now() - b.t <= windowMs && b.n >= limit; }

// ---------- sessions: HMAC-signed cookie, HttpOnly, SameSite=Strict ----------
// CSRF: every /api mutation already requires an Idempotency-Key header, which a cross-site form or image cannot send,
// and the server sends no CORS headers, so a cross-site script cannot either.
export const SESSION_COOKIE = 'awtm_session';
const SESSION_HOURS = 12;
const sign = (v: string) => createHmac('sha256', env.sessionSecret).update(v).digest('base64url');
// The cookie names the person and their session_version; bumping the version in the database ends every session they have.
export function makeSession(user: { id: string; session_version: number }, secure: boolean) {
  const v = Buffer.from(JSON.stringify({ uid: user.id, sv: user.session_version, exp: Date.now() + SESSION_HOURS * 3600_000 })).toString('base64url');
  return `${SESSION_COOKIE}=${v}.${sign(v)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${secure ? '; Secure' : ''}`;
}
export const clearSession = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
export async function sessionUser(req: IncomingMessage): Promise<SessionUser | null> {
  if (!env.sessionSecret) return null;
  const raw = String(req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(SESSION_COOKIE + '='))?.slice(SESSION_COOKIE.length + 1);
  if (!raw) return null;
  const [v, sig] = raw.split('.'); if (!v || !sig || !safeEq(sig, sign(v))) return null;
  let s: any; try { s = JSON.parse(Buffer.from(v, 'base64url').toString()); } catch { return null; }
  // a cookie from before personal logins carries no uid and is simply not a session any more
  if (!(s.exp > Date.now()) || typeof s.uid !== 'string' || !/^[0-9a-f-]{36}$/.test(s.uid)) return null;
  const u = await loadUser(s.uid);
  return u && u.active && u.session_version === s.sv ? publicUser(u) : null;
}

async function authenticate(req: IncomingMessage, kind: Route['auth']): Promise<{ actor: string; user: SessionUser | null } | null> {
  if (kind === 'none') return { actor: 'anonymous', user: null };
  const h = req.headers;
  if (kind === 'webhook') {
    // header first; a ?token= in the URL for senders that cannot set headers. The query string is never logged.
    const s = String(h['x-webhook-secret'] ?? '') || (new URL(req.url ?? '/', 'http://x').searchParams.get('token') ?? '');
    return env.saleshandyWebhookSecret && safeEq(s, env.saleshandyWebhookSecret) ? { actor: 'saleshandy', user: null } : null;
  }
  const key = String(h['x-api-key'] ?? '');
  if (env.apiKey && key && safeEq(key, env.apiKey)) return { actor: String(h['x-actor'] ?? 'n8n'), user: null };
  const u = await sessionUser(req);
  return u ? { actor: u.username, user: u } : null;
}

async function readBody(req: IncomingMessage, rawLimit?: number): Promise<any> {
  const limit = rawLimit ?? 2_000_000; const chunks: Buffer[] = []; let size = 0;
  if (Number(req.headers['content-length'] ?? 0) > limit) throw new HttpError(413, rawLimit ? `That file is too large. The limit is ${Math.round(limit / 1_000_000)} MB.` : 'body too large');
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, rawLimit ? `That file is too large. The limit is ${Math.round(limit / 1_000_000)} MB.` : 'body too large'); chunks.push(c); }
  if (rawLimit) return Buffer.concat(chunks);
  const raw = Buffer.concat(chunks).toString(); if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'invalid json'); }
}

// ---------- the ops app: static files from web/dist, index.html for every app route ----------
const WEB_DIST = env.webDist;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
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
    const who = await authenticate(req, r.auth);
    if (!who) return send(401, { error: 'unauthorized' });
    if (r.auth !== 'none') markActivity();
    if ((r.auth === 'user' || r.auth === 'admin') && !who.user) return send(403, { error: 'This needs a personal sign-in; the API key does not open it.' });
    if (r.auth === 'admin' && who.user!.role !== 'admin') return send(403, { error: 'Only an admin can do that.' });
    // a password someone else set is temporary: until the person chooses their own, only that is open to them
    if (who.user?.must_change_password && !/^\/api\/me(\/password)?$/.test(url.pathname)) return send(403, { error: 'Choose your own password first.', must_change_password: true });
    const { actor, user } = who;
    const m = url.pathname.match(r.re)!; const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const body = req.method === 'GET' ? {} : await readBody(req, r.raw);
    const sent = String(req.headers['idempotency-key'] ?? '');
    // a person's keys are theirs: replaying someone else's key never returns their stored response
    const idem = sent && user ? `u:${user.id}:${sent}` : sent;
    if (req.method !== 'GET' && url.pathname.startsWith('/api/') && !idem) throw new HttpError(400, 'Idempotency-Key header required');
    if (idem && req.method !== 'GET') { const prev = await one('select status, response from idempotency_keys where key=$1', [idem]); if (prev) return send(prev.status, prev.response, { 'idempotent-replay': 'true' }); }
    const out = await r.h({ req, res, url, params, body, actor, user, ip, setCookie: (c) => cookies.push(c) });
    if (res.writableEnded) return;
    const status = typeof out === 'object' && out && 'created' in (out as any) && (out as any).created ? 201 : 200;
    if (idem && req.method !== 'GET' && typeof out !== 'string') await q('insert into idempotency_keys(key,method,path,status,response) values($1,$2,$3,$4,$5) on conflict do nothing', [idem, req.method, url.pathname, status, JSON.stringify(out ?? {})]);
    send(status, out ?? {});
  } catch (e: any) {
    // a reference to a row that does not exist, or a duplicate, is the caller's mistake rather than ours
    const pgStatus: Record<string, number> = { '23503': 400, '23505': 409, '22P02': 400 };
    const status = e instanceof HttpError ? e.status : e?.name === 'ZodError' ? 400 : pgStatus[e?.code] ?? 500;
    if (status !== 500 && pgStatus[e?.code]) e.message = e.code === '23505' ? 'That already exists.' : e.code === '23503' ? 'That refers to something that does not exist.' : 'A value is not in the right form.';
    if (status >= 500) log.error('unhandled', { p: url.pathname, err: e?.message, stack: e?.stack?.split('\n').slice(0, 4) });
    send(status, { error: status === 500 && env.nodeEnv === 'production' ? 'Something went wrong on our side. It is logged.' : e?.message ?? 'error', run_id: e?.runId });
  }
}
