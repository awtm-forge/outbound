// Sign in, sign out, the signed-in person, and managing people (admins).
import { route, makeSession, clearSession, rateLimited, overLimit } from '../lib/http.ts';
import { q, one, audit } from '../lib/db.ts';
import { env } from '../lib/env.ts';
import { shConfig } from '../saleshandy/config.ts';
import { queueState } from '../jobs.ts';
import { HttpError } from '../pipeline.ts';
import { hashPassword, verifyPassword, dummyHash, checkPassword, findForLogin, forgetUser, assertAnotherAdmin } from '../lib/auth.ts';
import { parse, z, needUuid } from '../lib/validate.ts';

route('POST', '/auth/login', 'none', async (c) => {
  if (rateLimited('login:' + c.ip, 10, 15 * 60_000)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  const login = String(c.body?.user ?? '').trim().slice(0, 200); const password = String(c.body?.password ?? '').slice(0, 200);
  // per account as well as per address, so guessing one person's password from many addresses is slow too.
  // Only failures count here, so signing in from several devices never locks anyone out.
  const acct = 'login-user:' + login.toLowerCase();
  if (login && overLimit(acct, 20, 15 * 60_000)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  const u = env.sessionSecret && login ? await findForLogin(login) : undefined;
  const ok = u ? await verifyPassword(password, u.password_hash) : (await verifyPassword(password, await dummyHash()), false);
  if (!u || !ok) { if (login) rateLimited(acct, 20, 15 * 60_000); await new Promise((r) => setTimeout(r, 400)); throw new HttpError(401, 'That name and password do not match.'); }
  c.setCookie(makeSession(u, env.cookieSecure));
  await q('update users set last_login_at=now() where id=$1', [u.id]);
  await audit('user', u.id, 'signed_in', u.username, { ip: c.ip });
  return { user: u.username };
});
route('POST', '/auth/logout', 'none', async (c) => { c.setCookie(clearSession()); return { ok: true }; });

route('GET', '/api/me', 'api', async (c) => ({
  user: c.actor, session: !!c.user, id: c.user?.id ?? null, name: c.user?.name ?? c.actor, role: c.user?.role ?? 'service', email: c.user?.email ?? null,
  must_change_password: c.user?.must_change_password ?? false,
  ai_provider: env.aiProvider, saleshandy: env.saleshandyMode, saleshandy_integration: shConfig().integration, discovery_source: env.discoverySource, queue: queueState(),
}));
route('POST', '/api/me/password', 'user', async (c) => {
  const u = (await one('select * from users where id=$1', [c.user!.id]))!;
  if (!(await verifyPassword(String(c.body.current ?? ''), u.password_hash))) throw new HttpError(400, 'Your current password is not right.');
  const next = checkPassword(c.body.next);
  // every other session ends; this one gets a fresh cookie
  const r = (await one('update users set password_hash=$2, must_change_password=false, session_version=session_version+1 where id=$1 returning id, session_version', [u.id, await hashPassword(next)]))!;
  forgetUser(u.id); c.setCookie(makeSession(r as any, env.cookieSecure));
  await audit('user', u.id, 'password_changed', c.actor);
  return { ok: true };
});
route('POST', '/api/me/profile', 'user', async (c) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(80), email: z.string().trim().email().max(200).nullable().optional().or(z.literal('').transform(() => null)) }), c.body);
  await uniqueEmail(b.email ?? null, c.user!.id);
  await q('update users set name=$2, email=$3 where id=$1', [c.user!.id, b.name, b.email ?? null]); forgetUser(c.user!.id);
  return { ok: true };
});

// Everyone signed in sees who is on the team (to assign work, start a conversation); admins see the rest.
route('GET', '/api/team', 'user', async () => q(`select id, username::text, name, role from users where active order by name`));
route('GET', '/api/users', 'admin', async () => q(`select id, username::text, name, email::text, role, active, must_change_password, last_login_at, created_at, created_by from users order by active desc, name`));

const NewUser = z.object({
  username: z.string().trim().regex(/^[A-Za-z0-9._-]{2,40}$/, 'letters, numbers, dot, dash or underscore, 2 to 40 of them'),
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200).nullable().optional().or(z.literal('').transform(() => null)),
  role: z.enum(['admin', 'member']).default('member'),
  password: z.string(),
});
async function uniqueEmail(email: string | null, exceptId: string | null) {
  if (email && await one('select 1 from users where email=$1 and id is distinct from $2', [email, exceptId])) throw new HttpError(409, 'Someone already uses that email.');
}
route('POST', '/api/users', 'admin', async (c) => {
  const b = parse(NewUser, c.body); const pw = checkPassword(b.password);
  if (await one('select 1 from users where username=$1', [b.username])) throw new HttpError(409, 'That username is taken.');
  await uniqueEmail(b.email ?? null, null);
  // a password set by someone else is temporary: the person is asked to choose their own after signing in
  const u = (await one(`insert into users(username,name,email,role,password_hash,must_change_password,created_by) values($1,$2,$3,$4,$5,true,$6) returning id, username::text, name, role`,
    [b.username, b.name, b.email ?? null, b.role, await hashPassword(pw), c.actor]))!;
  await audit('user', u.id, 'user_created', c.actor, { username: u.username, role: u.role });
  return { created: true, ...u };
});
route('PATCH', '/api/users/:id', 'admin', async (c) => {
  const id = needUuid(c.params.id, 'person');
  const b = parse(z.object({ name: z.string().trim().min(1).max(80).optional(), email: NewUser.shape.email, role: z.enum(['admin', 'member']).optional(), active: z.boolean().optional() }), c.body);
  const u = await one('select * from users where id=$1', [id]); if (!u) throw new HttpError(404, 'person not found');
  if ((b.role === 'member' && u.role === 'admin') || (b.active === false && u.active && u.role === 'admin')) await assertAnotherAdmin(id);
  if (b.email !== undefined) await uniqueEmail(b.email, id);
  const r = (await one(`update users set name=coalesce($2,name), email=case when $3::boolean then $4 else email end, role=coalesce($5,role), active=coalesce($6,active),
      session_version = session_version + case when $6::boolean is false then 1 else 0 end
    where id=$1 returning id, username::text, name, email::text, role, active`, [id, b.name ?? null, b.email !== undefined, b.email ?? null, b.role ?? null, b.active ?? null]))!;
  forgetUser(id);
  await audit('user', id, 'user_updated', c.actor, { role: b.role, active: b.active });
  return r;
});
route('POST', '/api/users/:id/password', 'admin', async (c) => {
  const id = needUuid(c.params.id, 'person'); const pw = checkPassword(c.body.password);
  const r = await one('update users set password_hash=$2, must_change_password=true, session_version=session_version+1 where id=$1 returning id', [id, await hashPassword(pw)]);
  if (!r) throw new HttpError(404, 'person not found');
  forgetUser(id); await audit('user', id, 'password_reset', c.actor);
  return { ok: true };
});
