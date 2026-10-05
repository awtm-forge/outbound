# Deploying on Hostinger Cloud Professional with Neon

Decided 5 Oct 2026: no paid VPS. The core runs as a Node.js web app on the existing Hostinger Cloud
Professional plan, beside the client portal. The database is Neon's free Postgres. n8n does not run
on managed hosting, so the core's own scheduler does its timed work; the n8n workflows stay in the
repo for the day a server exists.

| Part | Where |
|---|---|
| Core API, ops app, scheduler, Saleshandy webhook | Hostinger Node.js web app, `ops.awtmforge.com` |
| Database | Neon free plan, Singapore region |
| Search | Serper |
| AI | Gemini free tier |

## 1. Neon, once (Rahul or Ayush)

1. Sign up at neon.com. The free plan needs no card.
2. Create a project: name `awtm-outbound`, Postgres 17, region **AWS Asia Pacific (Singapore)**.
3. On the project dashboard, Connect, turn **Connection pooling on**, and copy the connection string.
   It looks like `postgresql://USER:PASSWORD@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.
4. Put it in hPanel as `DATABASE_URL` (step 3). Never in the repo, never in chat.

Free plan limits that matter: 1 GB storage, 100 compute hours a month, the database sleeps after
5 idle minutes and wakes on the next query in about a second. The daily job trims raw AI text older
than 30 days to stay well under 1 GB. Neon keeps 6 hours of restore history on the free plan, so
the nightly backup below is still needed.

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
| `DASHBOARD_USER` | the sign-in name |
| `DASHBOARD_PASSWORD` | a long password, kept in the password manager |
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

- No n8n. The scheduler runs sync every 15 minutes, metrics at 08:00 IST and the weekly review on
  Monday at 09:00 IST. Each run is locked in Postgres, so it runs once even if n8n is also pointed at
  the same database. Runs are in `workflow_runs` under names starting `core:`.
- No reverse proxy of ours: Hostinger terminates HTTPS.
- The Docker Compose stack in the repo still works for local development and for a VPS later.
