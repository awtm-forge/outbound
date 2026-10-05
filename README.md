# AWTM Forge Outbound OS

Controlled outbound for awtm forge: prospect in, researched and scored by modular AI agents, one specific plain-text email drafted,
a human approves, Saleshandy sends, replies come back, get classified, and the deal moves through teardown, meeting brief,
post-meeting analysis and proposal draft. Nothing client-facing leaves without a human click. India first.

## What runs

| Service | Image | Port (local) | Purpose |
|---|---|---|---|
| postgres | postgres:16-alpine | 127.0.0.1:55460 | All data. Never exposed publicly. n8n uses schema `n8n` in the same database. |
| core | ./core (Node 24, TypeScript) | 127.0.0.1:8095 | API, 13 AI agents, scoring engine, the ops app, Saleshandy adapter, webhook receiver, metrics. |
| n8n | n8nio/n8n:1.112.0 | 127.0.0.1:5678 | 19 workflows that call the core over HTTP. Basic auth. |
| backup | postgres:16-alpine | none | pg_dump to ./backups on start and every 24 h, 14 day retention. |
| caddy (prod profile) | caddy:2-alpine | 80, 443 | HTTPS for n8n.awtmforge.com and ops.awtmforge.com. |

Ports bind to loopback only. In production Caddy is the only public listener.

## Quick start (local)

```bash
cp .env.example .env            # then set every "change-me": openssl rand -hex 32
docker compose up -d --build
docker compose exec -T n8n n8n import:workflow --separate --input=/workflows
docker compose exec -T n8n n8n update:workflow --all --active=true && docker compose restart n8n
open http://localhost:8095       # the ops app: sign in with DASHBOARD_USER / DASHBOARD_PASSWORD
open http://localhost:5678       # n8n, N8N_BASIC_AUTH_USER / N8N_BASIC_AUTH_PASSWORD
```

Run the end-to-end demo (synthetic company, mock AI, mock Saleshandy, nothing is sent):

```bash
cd core && DATABASE_URL=postgres://awtm:$POSTGRES_PASSWORD@127.0.0.1:55460/awtm_outbound node src/demo.ts
```

Tests (create and drop their own database on the same Postgres):

```bash
cd core && npm install && npm run typecheck && npm test
```

## Production (Hostinger VPS)

```bash
# on the VPS, as a sudo user with Docker installed
sudo mkdir -p /opt/awtm-outbound-os && sudo chown $USER /opt/awtm-outbound-os
git clone <repo> /opt/awtm-outbound-os && cd /opt/awtm-outbound-os
cp .env.example .env   # set secrets; N8N_PROTOCOL=https; N8N_HOST=n8n.awtmforge.com; OPS_HOST=ops.awtmforge.com; CORE_PUBLIC_URL=https://ops.awtmforge.com
docker compose --profile prod up -d --build
```

DNS: A records for `n8n.awtmforge.com` and `ops.awtmforge.com` to the VPS IP. Caddy obtains certificates automatically. The main
awtmforge.com site is untouched. Firewall: allow 22, 80, 443 only.

## The ops app

A React app in `core/web`, built into the core image and served by the core on the same origin. Dark, in the awtm forge
brand: the portal's tokens, Bricolage Grotesque and IBM Plex Mono, self-hosted. Seven screens, ordered by the day's work:

| Screen | What it is for |
|---|---|
| Today | What needs you now, where every company stands, campaign numbers, recent activity |
| Find companies | Search by what they sell, where, and platform; tick companies; add them to a campaign |
| Review emails | One draft at a time, with the observation, score, site findings and proof beside it. Keys: A approve, M research again, R reject, E edit, J and K next and previous |
| Inbox | Replies sorted by priority, with the suggested answer to copy, and teardowns to approve |
| Pipeline | Every company, filtered by stage or by "needs a decision maker"; the profile adds the person to write to |
| Meetings and deals | The brief before a call, notes into next steps after it, proposal drafts |
| Campaigns | Results per campaign, the weekly recommendations, and the do-not-contact list |

The five seed campaigns in `config/campaigns.json` were approved by the founders on 5 Oct 2026.

Sign-in is a form, not a browser pop-up: an HMAC-signed, HttpOnly, SameSite=Strict session cookie (12 hours,
`SESSION_SECRET`). Login is throttled to 10 attempts per 15 minutes per IP. Every API mutation still needs an
Idempotency-Key header, which a cross-site page cannot send, so the session cannot be used from another site.
n8n and scripts keep using `X-Api-Key`.

Develop the app with hot reload against the running core:

```bash
cd core/web && npm install && npm run dev    # http://localhost:5199, proxies /api to the core on 8095
```

## Prospect discovery

Find companies in the app, or `POST /api/discovery/searches` with `{industry, location, technology, keywords, pages}`.
A search source returns candidate sites; the core visits each one itself, fingerprints the platform (Shopify, Wix, WooCommerce,
WordPress, Framer, Webflow, Magento, plus Razorpay, Shiprocket, Meta Pixel, Google Tag), and pulls public contact details from the
home and contact pages: emails, Indian phone numbers, GSTIN, LinkedIn, Instagram and Facebook links, a country guess and a rough size.
The technology filter is applied to what we fingerprinted, never to what the search engine guessed. Marketplaces and directories are
excluded. Candidates are unique by domain across all searches; an identical search within seven days is served from the earlier run.
Tick candidates, choose a campaign, and they go through ingest, research, scoring and (at 70+) drafting. A company whose only public
email is a shared inbox still needs a named decision maker before a draft is allowed; the row shows a "find founder" LinkedIn search.

Sources are adapters in `core/src/discovery.ts`: `serper` (Google results via serper.dev, 2,500 free queries, one query per page of 10 sites,
daily cap tracked in `source_calls`), `google_cse` (legacy: Google closed it to new customers and shuts it down on 1 January 2027) and
`mock`. Brave Search and Apify are the next candidates.

## Pipeline and where each piece lives

| Stage | Core code | HTTP | n8n workflow |
|---|---|---|---|
| Discovery search | `core/src/discovery.ts` runSearch | POST /api/discovery/searches, /api/discovery/candidates/add | 19_discovery_search |
| Ingest + dedupe | `core/src/pipeline.ts` ingest | POST /api/prospects, /api/prospects/bulk | 01_ingest_prospects |
| Research (site snapshot + Account Research Agent) | research | POST /api/prospects/:id/research | 03_research_account |
| Website Analysis Agent | analyzeWebsite | /analyze-website | 04_analyze_website |
| Decision-Maker Agent | identifyDecisionMaker | /decision-maker | (part of run-chain) |
| Problem Detection + Capability Matching | identifyProblem | /identify-problem | 05_identify_problem |
| Qualification Agent + scoring engine | qualify, `lib/scoring.ts` | /qualify | 02_qualify_accounts |
| Email Generation Agent | generateEmail | /generate-email | 06_generate_email |
| Human approval gate | decideDraft | POST /api/drafts/:id/decision, dashboard forms | 07_human_approval |
| Sync approved to Saleshandy | syncToSaleshandy | POST /api/drafts/:id/sync, /api/sync/approved | 08_sync_to_saleshandy (every 15 min) |
| Saleshandy webhook | ingestWebhook | POST /webhooks/saleshandy (X-Webhook-Secret) | 09_receive_saleshandy_webhook |
| Reply Classification Agent | classifyReply | POST /api/replies/:id/classify | 10_classify_reply |
| Teardown Agent | generateTeardown, decideTeardown | /api/replies/:id/teardown, /api/teardowns/:id/decision | 11_generate_teardown |
| Meeting Intelligence Agent | createMeeting, meetingBrief | /api/prospects/:id/meeting, /api/meetings/:id/brief | 12_meeting_brief |
| Post-Meeting Agent | postMeeting | /api/meetings/:id/post-meeting | 13_post_meeting |
| Proposal Draft Agent | draftProposal | /api/meetings/:id/proposal | 14_proposal_draft |
| Metrics | campaignMetrics | GET /api/metrics/campaigns, /metrics | 15_daily_metrics |
| Campaign Analytics Agent | weeklyAnalysis | POST /api/analytics/weekly | 16_weekly_campaign_analysis |
| Suppression | `lib/suppression.ts` | POST /api/suppression, GET /api/suppression/check | 17_suppression_handler |
| Health | | GET /health | 18_health_monitor (every 5 min) |

`POST /api/prospects/:id/run-chain` runs research, website, decision maker, problem, qualify and (if 70+) email in one call.

## Rules the code enforces

- Every `/api` mutation needs `X-Api-Key` and an `Idempotency-Key`; replays return the stored response.
- Drafts are created `PENDING_APPROVAL`. Only `APPROVED` drafts sync. Original and edited copy, approver and timestamp are stored.
- A company only moves forward once an email is approved: researching again, scoring again or drafting a follow-up never pulls a company that has replied or is in a deal back to an earlier stage.
- No draft is written to a contact without a name.
- Proof assets carry the brief's labels. Only `VERIFIED` ids survive into emails, teardowns and briefs; the server filters regardless of what the model says. `PRIVATE` (QC Lobby app) is never even shown to the model.
- Suppression overrides campaign membership: unsubscribe reply, unsubscribe event or hard bounce suppresses immediately, cascades to prospects, memberships and pending drafts, and a re-ingested contact lands suppressed.
- Proposals take price, deadline, deliverables, guarantees and SLA only from `business_inputs`; otherwise "TO BE CONFIRMED".
- Money is integer paise everywhere.
- Scoring weights and thresholds are `config/scoring.json`. Campaigns are `config/campaigns.json`. Proof is `config/proof_assets.json`. All three are upserted on every core start; no code change needed for a new campaign.
- Agents: explicit zod input and output schemas, provider/model/prompt version/tokens/duration recorded per call in `ai_runs`, cache by input hash (`AI_CACHE_TTL_HOURS`), one re-prompt on invalid output, exponential retry on 429/5xx, `UNKNOWN` tags instead of invention.

## Configuration

See `.env.example`. `AI_PROVIDER=gemini` with `GEMINI_API_KEY` (the free tier, chosen 5 Oct 2026) or `AI_PROVIDER=anthropic` with
`ANTHROPIC_API_KEY` switches every agent at once. `AI_MODEL` drives the reasoning agents and `AI_MODEL_CHEAP` classification and
qualification; left empty, each provider's default is used. Rate limits are retried using the provider's own wait hint. `SALESHANDY_MODE=real` with `SALESHANDY_API_KEY` switches the adapter.

## More

- `docs/OPERATIONS.md`: inspecting failures, logs, backup and restore, routine commands.
- `docs/CREDENTIALS.md`: exactly what is still needed and what each unlocks.
