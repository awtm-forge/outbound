// People and passwords. scrypt from node:crypto, so there is no native dependency to build on Hostinger.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { q, one } from './db.ts';
import { env } from './env.ts';
import { log } from './log.ts';
import { HttpError } from '../pipeline.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, o: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const N = 16384, R = 8, P = 1, LEN = 32;
export async function hashPassword(pw: string) {
  const salt = randomBytes(16); const h = await scrypt(pw, salt, LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${h.toString('base64url')}`;
}
export async function verifyPassword(pw: string, stored: string) {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  const got = await scrypt(pw, Buffer.from(salt, 'base64url'), want.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return got.length === want.length && timingSafeEqual(got, want);
}
// Verified against when the name is unknown, so a wrong name and a wrong password take the same time.
let dummy: string | null = null;
export const dummyHash = async () => (dummy ??= await hashPassword(randomBytes(12).toString('hex')));

export function checkPassword(pw: unknown): string {
  const s = String(pw ?? '');
  if (s.length < 10) throw new HttpError(400, 'A password needs at least 10 characters.');
  if (s.length > 200) throw new HttpError(400, 'That password is too long.');
  return s;
}

export type Role = 'admin' | 'member';
export type SessionUser = { id: string; username: string; name: string; email: string | null; role: Role; must_change_password: boolean };
type Cached = SessionUser & { active: boolean; session_version: number };

// Every signed-in request checks the person is still active and the session still current. A few seconds of cache keeps
// chat polling from turning into a user lookup per request; changes made here clear it at once (one process).
const cache = new Map<string, { u: Cached | null; t: number }>();
export const forgetUser = (id: string) => cache.delete(id);
export async function loadUser(id: string): Promise<Cached | null> {
  const c = cache.get(id); if (c && Date.now() - c.t < 5000) return c.u;
  const u = (await one<Cached>('select id, username::text, name, email::text, role, must_change_password, active, session_version from users where id=$1', [id])) ?? null;
  cache.set(id, { u, t: Date.now() }); return u;
}
export const publicUser = (u: Cached | SessionUser): SessionUser => ({ id: u.id, username: u.username, name: u.name, email: u.email, role: u.role, must_change_password: u.must_change_password });

export async function findForLogin(login: string) {
  return one<{ id: string; username: string; password_hash: string; session_version: number }>('select id, username::text, password_hash, session_version from users where (username=$1 or email=$1) and active', [login.trim()]);
}

// First boot with personal logins: the shared dashboard sign-in becomes the first admin, with the same name and password,
// so nobody is locked out by the upgrade. After that DASHBOARD_PASSWORD is not read again; people are managed in the app.
export async function ensureFirstAdmin() {
  const n = Number((await one('select count(*)::int n from users'))!.n);
  if (n > 0) return false;
  if (!env.dashboardUser || !env.dashboardPassword) { log.warn('no users yet and DASHBOARD_USER or DASHBOARD_PASSWORD is empty: nobody can sign in until one is created (npm run user)'); return false; }
  await q(`insert into users(username,name,role,password_hash,created_by) values($1,$2,'admin',$3,'bootstrap') on conflict do nothing`,
    [env.dashboardUser, env.dashboardUser.charAt(0).toUpperCase() + env.dashboardUser.slice(1), await hashPassword(env.dashboardPassword)]);
  log.info('first admin created from DASHBOARD_USER', { username: env.dashboardUser });
  return true;
}

// The last active admin cannot be demoted or switched off; someone has to be able to manage people.
export async function assertAnotherAdmin(exceptId: string) {
  const n = Number((await one(`select count(*)::int n from users where role='admin' and active and id<>$1`, [exceptId]))!.n);
  if (n === 0) throw new HttpError(409, 'There has to be at least one active admin. Make someone else an admin first.');
}
