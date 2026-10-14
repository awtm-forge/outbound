# Saleshandy integration: diagnosis

Prepared with AI assistance on 14 October 2026.

## Status

Part A (our app) is complete and below. Part B (the Saleshandy capability survey) has not started, for two reasons that are outside the code:

1. The development key is not visible to the session doing this work. Rahul added `SALESHANDY_API_KEY` to the cloud environment settings, and those settings reach new sessions only.
2. The environment's network policy refuses connections to `open-api.saleshandy.com` and `developer.saleshandy.com` (the proxy answers 403 to the connection). Both hosts need to be added to the environment's allowed domains.

Nothing in Part B will be written from memory or from the facts listed in the brief. Every endpoint, pagination style, rate limit and webhook detail will be read from the live docs and checked with GET requests once both are fixed. No request of any kind has been made to Saleshandy so far.

## Part A: our app

### 1. Stack

1. Server: Node 22 running TypeScript directly (`node src/server.ts`), with a small hand-written router in `core/src/lib/http.ts`. Routes declare who may call them: `user` (any signed-in person), `admin`, `api` (the service key n8n uses), `webhook` (a shared secret) or `none`.
2. Database: Postgres through `pg`, with `q`, `one` and `tx` helpers in `core/src/lib/db.ts`. Production is Neon (pooled connection string) behind Hostinger Cloud.
3. Migrations: numbered plain SQL files in `core/migrations/` (001 to 017 today), applied in order by `core/src/migrate.ts` on every boot and recorded so each runs once. The next files will be `018_saleshandy_*.sql`. Applying them only ever happens by starting the app against a database, so for this work they are applied to the local database only.
4. Validation: zod, through `parse` in `core/src/lib/validate.ts`. A validation failure becomes a 400 with a readable message.
5. Front end: React 19 and Vite in `core/web`, a custom router, `useLoad` for data, and one `api` client (`core/web/src/api.ts`) that adds an idempotency key to every write.
6. Server secrets: read once in `core/src/lib/env.ts` from the process environment. `core/.env.example` does not exist; the example file is `.env.example` at the repo root.
7. Scheduled work: an in-process scheduler (`core/src/scheduler.ts`) ticks every 20 seconds, matches jobs by India time, and takes a Postgres advisory lock per job. Each run is recorded in `workflow_runs`, one per time slot, so two app processes, or the app and n8n, never run the same job twice. Some jobs run only if someone used the app in the last quarter hour, so the free database can sleep at night. n8n can run the same jobs on hosts where it is available. The new sync jobs will be added to this scheduler.
8. Background work: `enqueue` in `core/src/jobs.ts` for work that outlives a request (AI calls today). Webhook processing will use it.

### 2. Saleshandy code that already exists

1. `core/src/adapters/saleshandy.ts`: an interface with a real client and a mock, chosen by `SALESHANDY_MODE` (`mock` by default). The real client's paths are marked in the code as unconfirmed; it was written before any key existed. It has a 20 second timeout, no retries, no rate limiting and no pagination.
2. The real client exposes writes (create sequence, add prospect to sequence, pause prospect, add to Do Not Contact), and the outreach pipeline calls them directly: `syncToSaleshandy` in `core/src/pipeline.ts`, run every 15 minutes by the scheduler for approved email drafts. Under the new rules every write must go through one gateway, so this path will be moved onto the gateway. Until then it stays harmless in practice because `SALESHANDY_MODE` is `mock` everywhere.
3. A webhook receiver at `POST /webhooks/saleshandy` that accepts a shared secret in an `X-Webhook-Secret` header or a `token` query parameter, compared in constant time. It processes events inline (no stored raw payload, no replay) and handles replies, bounces and unsubscribes by updating our own records and the suppression list.
4. The example environment file says Saleshandy webhooks do not sign payloads. That claim is not verified and will be checked against the live docs in Part B.
5. A read-only status route, `GET /api/ops/saleshandy`, that lists mailboxes and sequences.

### 3. Our records that Saleshandy data links to

1. `contacts.email` (citext, unique where set): the exact-email match. `contacts.external_ref` already holds a Saleshandy prospect id for contacts the pipeline pushed.
2. `companies.domain` (normalised: lower case, no `www`, unique): the company-domain match.
3. `prospects` (our outreach record for a company in a campaign) and `campaign_memberships`, which already store `saleshandy_prospect_id` and `saleshandy_sequence_id`.
4. `opportunities`, `meetings`, `proposals` and `deals` hang off prospects, so a linked Saleshandy prospect reaches the deal screens through the prospect.
5. `suppression_list` (email and domain) is our own do-not-contact list. Saleshandy's Do Not Contact and blacklist entries should be mirrored next to it, not merged into it, so we can always tell which side an entry came from.
6. `email_events` and `replies` hold what webhooks have delivered so far.

### 4. Roles, permissions and conventions to follow

1. Two roles only: `admin` and `member` (`users.role`). Route-level auth is the only permission system. High and spend risk actions will require `admin`; low and medium will require any signed-in person. Logged in `DECISIONS-NEEDED.md` in case members should be limited further.
2. Every write from the browser carries an `Idempotency-Key`, and the server stores the first response in `idempotency_keys` for 7 days, so a repeated key returns the first answer without acting again. The write gateway will use the same key, so a double click never sends twice.
3. Errors: `HttpError(status, message)` for anything the caller should see; database constraint errors become readable 400 or 409 messages; everything else is a logged 500 with a generic message in production.
4. Logging: structured JSON to stdout through `core/src/lib/log.ts`, which redacts any field whose name contains api key, password, secret, token or authorization. The Saleshandy client will log paths and status codes only, never request headers or bodies.
5. Audit: `audit()` writes to `activities`. The write gateway gets its own `write_audit` table because it needs before state, request and response.
6. Feature flags: there is no flag system. Switches are environment variables read in `env.ts`. The six Saleshandy flags will follow that pattern, all off unless set to `true`.
7. Tests: `node --test` against a private database per test process (`core/test/helpers.ts`), with the AI provider and Saleshandy in mock mode. 90 tests pass today.

## Part B: Saleshandy capability survey

Waiting for the two fixes listed under Status. When it runs, it will record for every endpoint in every resource group: method, path, purpose, fields, pagination style and maximum page size, whether an updated-since filter exists, read or write or credit-spending, risk class, and a build or link out recommendation with a reason. It will also answer the rate limit, webhook, deletion, credit and data volume questions from the brief, probing at no more than one request per second, and save anonymised sample responses under `core/test/fixtures/saleshandy/`.
