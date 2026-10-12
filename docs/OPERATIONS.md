# Operations

## Daily

1. Open the app and sign in. Today shows what is waiting.
2. Review emails: approve, edit, reject or send back for research. Approved drafts go to Saleshandy through n8n
   `08_sync_to_saleshandy` within 15 minutes, or from "Approved, not sent".
3. Inbox: work replies from the top. For "Asked for the two things" draft the teardown, then approve it under Teardowns.
   Suggested answers are never sent by the system; copy them into Saleshandy or Gmail yourself.
4. Pipeline > Need a decision maker: add the named person for each qualified company, then "Write the email".
5. If Today shows a red line about failures, look below.

## Inspecting failures

| Symptom | Where to look |
|---|---|
| Workflow failed | The red line on Today, then `GET /api/ops/failures` (X-Api-Key). The row names the workflow, the node and the error. n8n UI > Executions shows the full run. |
| Agent produced invalid output | `select id, agent, error, raw_output from ai_runs where not valid order by created_at desc limit 20;` |
| Why did this prospect get this score / observation | Pipeline > the company: every research record, the score breakdown with per-criterion rationale, and the audit trail. |
| Saleshandy call failed | core logs: `docker compose logs core | grep saleshandy`. Status code is logged, never the key. |
| Health | `curl localhost:8095/health` returns db latency, provider modes, failed workflows in 24 h and pending approvals. `GET /metrics` (X-Api-Key) is Prometheus text. |

Logs are JSON on stdout: `docker compose logs -f core`, `docker compose logs -f n8n`. Keys, passwords and tokens are redacted by key name;
email bodies are not logged.

Database shell:

```bash
docker compose exec postgres psql -U awtm awtm_outbound
```

Useful tables: `prospects` (status machine), `email_drafts` (approval gate), `replies`, `teardowns`, `ai_runs` (every model call),
`workflow_runs` (n8n failures), `activities` (audit trail), `suppression_list`.

## Routine commands

```bash
docker compose ps                                   # all healthy?
docker compose up -d --build core                   # redeploy core after a code change
docker compose exec -T n8n n8n import:workflow --separate --input=/workflows   # after editing n8n/workflows (regenerate: cd core && node src/gen-n8n.ts)
docker compose restart n8n
scripts/backup-now.sh                               # ad hoc backup
```

Config changes (`core/config/*.json`) take effect for scoring and capabilities immediately; campaigns and proof assets are re-seeded on
`docker compose restart core`.

## Backups

- What: full `pg_dump` of the database (prospects, drafts, replies, ai_runs, and n8n's own schema), gzip.
- Where: `./backups/` on the host (`/opt/awtm-outbound-os/backups` on the VPS). Private directory, never a public bucket.
- When: on backup-container start and every 24 hours after. Retention `BACKUP_RETENTION_DAYS` (default 14).
- Off-box: `scripts/offsite-backup.sh` copies the newest dump to `OFFSITE_TARGET` (scp destination or private rclone remote). Add it to the VPS crontab. Hostinger snapshots alone are not enough.
- Verify: `gunzip -c backups/<file> | head` and check the row counts match `select count(*) from prospects`.

## Restore

```bash
scripts/restore.sh backups/awtm_outbound_YYYYMMDD_HHMMSS.sql.gz
```

It stops core and n8n, drops and recreates the database, loads the dump, and starts them again. It asks you to type the database name
first because it is destructive. To restore onto a fresh VPS: clone the repo, copy `.env` and the dump, `docker compose up -d postgres`,
then run the script.

## Security notes

- Postgres and the core bind to 127.0.0.1 only; Caddy terminates TLS. n8n webhooks are public by design (Saleshandy must reach them) but every workflow's first node checks `x-api-key` against `CORE_API_KEY` and answers 401 otherwise; the Saleshandy inbound path additionally requires `X-Webhook-Secret` at the core.
- People and passwords are managed in the app (Team, admins only). `DASHBOARD_PASSWORD` only seeds the first admin. Locked out: `cd core && npm run user -- reset <username>` with `DATABASE_URL` set prints a temporary password.
- Rotate `CORE_API_KEY`, `SALESHANDY_WEBHOOK_SECRET`, `SESSION_SECRET` (signs everyone out) and the n8n basic-auth password by editing `.env` and `docker compose up -d`.
- Rate limit: 120 requests per minute per IP on the core.
