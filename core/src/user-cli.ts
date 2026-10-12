// Break glass, from any machine with DATABASE_URL: create a person or reset a password without signing in.
//   npm run user -- add <username> "<Full name>" [admin|member]
//   npm run user -- reset <username>
// Prints a temporary password; the person chooses their own at the next sign-in.
import { randomBytes } from 'node:crypto';
import { pool, one } from './lib/db.ts';
import { hashPassword } from './lib/auth.ts';
const [cmd, username, name, role = 'member'] = process.argv.slice(2);
const temp = randomBytes(9).toString('base64url');
async function main() {
  if (cmd === 'add' && username && name && (role === 'admin' || role === 'member')) {
    await one(`insert into users(username,name,role,password_hash,must_change_password,created_by) values($1,$2,$3,$4,true,'cli')`, [username, name, role, await hashPassword(temp)]);
  } else if (cmd === 'reset' && username) {
    const r = await one(`update users set password_hash=$2, must_change_password=true, active=true, session_version=session_version+1 where username=$1 returning id`, [username, await hashPassword(temp)]);
    if (!r) throw new Error(`no user called ${username}`);
  } else { console.error('usage: npm run user -- add <username> "<Full name>" [admin|member]  |  npm run user -- reset <username>'); process.exit(2); }
  console.log(`${username}: temporary password ${temp}`);
}
main().then(() => pool.end()).catch((e) => { console.error(e.message); process.exit(1); });
