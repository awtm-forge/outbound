# Deploying on Hostinger Cloud Professional with Neon

Decided 5 Oct 2026: no paid VPS. The core runs as a Node.js web app on the existing Hostinger Cloud
Professional plan, beside the client portal. The database is Neon Postgres, on a paid plan from October 2026 (the
Workspace's chat keeps it busy whenever someone has the app open; see below). n8n does not run
on managed hosting, so the core's own scheduler does its timed work; the n8n workflows stay in the
repo for the day a server exists.

| Part | Where |
|---|---|
| Core API, ops app, scheduler, Saleshandy webhook | Hostinger Node.js web app, `ops.awtmforge.com` |
| Database | Neon paid plan, Singapore region |
| Search | Serper |
| AI | Gemini free tier |

## 1. Neon, once (Rahul or Ayush)

1. Sign up at neon.com. The free plan needs no card.
2. Create a project: name `awtm-outbound`, Postgres 17, region **AWS Asia Pacific (Singapore)**.
3. On the project dashboard, Connect, turn **Connection pooling on**, and copy the connection string.
   It looks like `postgresql://USER:PASSWORD@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.
4. Put it in hPanel as `DATABASE_URL` (step 3). Never in the repo, never in chat.

### Why the paid plan (decided Oct 2026)

The free plan gives 100 compute hours a month and sleeps after 5 idle minutes. The Workspace changes that: every open
browser tab holds a chat long-poll, and while anyone is waiting the core runs one small query a second to catch new
messages. With the team signed in through the working day the database never sleeps, which runs past 100 hours within
the month. On the paid plan:

- In Neon, Billing, upgrade the existing `awtm-outbound` project. The connection string does not change; nothing to
  redeploy.
- Leave scale to zero on in the compute settings. Nights and weekends with nobody signed in still suspend the
  database, and the first request after wakes it in about a second.
- The smallest compute size is enough. Chat waits do not hold a database connection, so `DB_POOL_MAX=5` stays right
  for the team's size.
- Raise the restore window (history retention) to at least 7 days. Keep the nightly dump below as well: it is the copy
  that lives outside Neon.

The daily job still trims raw AI text older than 30 days.

## 2. GitHub, once (Ayush)

1. Create a private repository `awtm-forge/outbound` with no README.
2. Settings, Deploy keys, Add deploy key, title `awtm-outbound mac`, tick **Allow write access**, paste
   the contents of `~/.ssh/awtm_outbound_github_ed25519.pub` from the Mac this was built on.
3. The build session then pushes `main` with `git push github-awtm-outbound:awtm-forge/outbound.git main`.

## 3. hPanel, once

Websites, Add website, Node.js web app, Import Git repository, the `zekst` GitHub account, `awtm-forge/outbound`.

| Setting | Value |
|---|---|
| Framework | Other / Express |
| Node version | 22 |
| Root directory | `core` |
| Build command | `npm run build` |
| Entry file | `dist/server.js` |
| Branch | `main` |
| Domain | `ops.awtmforge.com` |

The build compiles the TypeScript to `dist/` and builds the ops app into `web/dist`. It uses the WASM
build of Rollup on purpose: the build host's glibc is too old for native build tools (the portal's
DEPLOY.md hit the same wall with Next's SWC).

Environment variables, all in hPanel:

| Name | Value |
|---|---|
| `DATABASE_URL` | the Neon pooled string from step 1 |
| `NODE_ENV` | `production` |
| `TZ` | `Asia/Kolkata` |
| `CORE_PUBLIC_URL` | `https://ops.awtmforge.com` (https makes the session cookie Secure) |
| `CORE_API_KEY` | `openssl rand -hex 32` |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `DASHBOARD_USER` | the first admin's sign-in name (read once, see below) |
| `DASHBOARD_PASSWORD` | the first admin's password, kept in the password manager (read once) |
| `AI_PROVIDER` | `gemini` |
| `GEMINI_API_KEY` | from aistudio.google.com |
| `DISCOVERY_SOURCE` | `serper` |
| `SERPER_API_KEY` | from serper.dev |
| `DISCOVERY_DAILY_QUOTA` | `100` |
| `SALESHANDY_MODE` | `mock` until the key exists, then `real` |
| `SALESHANDY_API_KEY` | when it exists |
| `SALESHANDY_WEBHOOK_SECRET` | `openssl rand -hex 32` |
| `SCHEDULER` | `on` |
| `DB_POOL_MAX` | `5` |

A value saved in hPanel reaches the app only on the next deploy: press Redeploy after changing one.

Every boot applies new migrations and re-reads campaigns and proof assets from `core/config/`, so a
campaign change is a commit and a deploy.

### The deploy that brings in personal logins

The first boot of this version creates the `users` table and makes `DASHBOARD_USER` an admin with
`DASHBOARD_PASSWORD`. Everyone who was signed in is signed out once (the old shared session cookie is not a session any
more). Then:

1. Sign in with the shared name and password as before. You are the first admin.
2. Team, Add someone, for each person, with a temporary password. Make the other founder an admin.
3. Your account (your name, bottom left): change your own password. From now on `DASHBOARD_PASSWORD` is not read;
   changing it in hPanel changes nothing.
4. People, Add a person, for each member of staff, linking their sign-in so they can ask for leave. Record pay on each
   person's page; only admins see that panel.

Locked out of every admin account: from the Mac, `cd core && DATABASE_URL='<Neon direct string>' npm run user -- reset <username>`
prints a temporary password.

## 4. Check it

```bash
curl -s https://ops.awtmforge.com/health
```

`status` is `ok`, `db` is `ok`, `ai_provider` is `gemini`. Then sign in at `https://ops.awtmforge.com`.

Saleshandy webhook URL, once sending is live:
`https://ops.awtmforge.com/webhooks/saleshandy?token=<SALESHANDY_WEBHOOK_SECRET>`, or the bare URL
with an `X-Webhook-Secret` header if Saleshandy allows custom headers.

## 5. Backups

Neon's free history is 6 hours. Take a nightly dump to the Hostinger account over SSH, the same way
the portal backs up MySQL (hPanel, Advanced, Cron Jobs, daily 02:30):

```bash
mkdir -p ~/backups && pg_dump "$NEON_DIRECT_URL" --no-owner | gzip > ~/backups/awtm-outbound-$(date +%F).sql.gz && find ~/backups -name 'awtm-outbound-*.sql.gz' -mtime +14 -delete
```

Use Neon's **direct** connection string (without `-pooler`) for `pg_dump`. If `pg_dump` is not on
the Hostinger account, run the same line from the Mac weekly. Restore into a fresh Neon branch or
project with `gunzip -c FILE | psql "$NEON_DIRECT_URL"`.

## What is different from the Docker setup

- One Node process. Rate limits, the AI queue and the chat wake-ups live in memory. Chat still delivers within about a
  second if the host ever starts a second process, but the rate limits would then be per process.
- No n8n. The scheduler runs sync every 15 minutes, metrics at 08:00 IST and the weekly review on
  Monday at 09:00 IST. Each run is locked in Postgres, so it runs once even if n8n is also pointed at
  the same database. Runs are in `workflow_runs` under names starting `core:`.
- No reverse proxy of ours: Hostinger terminates HTTPS.
- The Docker Compose stack in the repo still works for local development and for a VPS later.
