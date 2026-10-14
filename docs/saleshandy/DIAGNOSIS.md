# Saleshandy integration: diagnosis

Prepared with AI assistance on 14 October 2026.

## The answer

1. Almost everything we run day to day can be done from ops.awtmforge.com: reading sequences, prospects, the unified inbox, tasks, notes, Do Not Contact lists, mailbox health and analytics, and acting on them (pause and resume sequences, add prospects, change a prospect's sequence status, reply to email, notes, tags, custom field values, tasks, enrichment).
2. Capability matrix: 99 endpoints found in Saleshandy's own client. 67 build (43 reads, 21 writes, 3 credit-spending), 32 link out. 9 more actions are listed in the brief or expected but were not found, and are confirmed against the live docs before anything depends on them.
3. Recommended sync design: Saleshandy webhooks for near real time events (replies, bounces, unsubscribes, outcome changes, task and sequence changes), plus a scheduled sync every 30 minutes for the inbox (it accepts a date filter), plus a nightly full reconciliation of everything. No list endpoint found has an "updated since" filter, so every other resource is a full scan, which is cheap at our size. Webhooks cannot be signed, but Saleshandy lets us attach custom headers to each webhook, so our receiver requires a secret header and rejects everything else.
4. Things that are still unknown and need a live check: rate limit numbers and 429 behaviour, exact response fields for some endpoints, webhook payloads and retry behaviour, how credit costs are reported per call, and today's data volume. These are listed with how each will be checked.

## How this was verified, and what was not

This work environment cannot reach Saleshandy: the cloud environment's network policy refuses connections to both `open-api.saleshandy.com` and `developer.saleshandy.com`, and the development key is only visible to new sessions. Changing that was declined, so no request has been made to Saleshandy, and the live docs could not be read.

Instead, every endpoint below comes from Saleshandy's official command line client, `@saleshandy/saleshandy-cli` version 0.1.15 from npm. It is published by Saleshandy staff (five maintainers, all with saleshandy.com addresses), points to github.com/saleshandy/saleshandy-cli, and was last updated in May 2026. Its code was downloaded and read as text, never run. That makes the paths, methods, request fields, pagination parameters, page size limits, error format and webhook event names reliable, because they are what Saleshandy's own tool sends.

What the client cannot show, and is therefore marked unverified:
1. Endpoints its tool does not use. The live docs may list more (the brief mentions Blacklist Domains and Leads To Email, which the client does not call).
2. Full response bodies. The client names the fields it prints, which covers most list screens; the rest is confirmed on the first live call and the type is widened if needed.
3. Rate limits, 429 responses and `Retry-After`, webhook payloads, signing and retries, credit costs per call, and data volume.

Sample responses under `core/test/fixtures/saleshandy/` are constructed from the field names the official client reads, filled with obvious fake data. They are marked as constructed, not recorded. They will be replaced with recorded, anonymised responses on the first live run.

## Facts that differ from the brief

1. Base URL. The host is `https://open-api.saleshandy.com`. Most paths start with `/api/open-api/v1/`. Clients, Do Not Contact and warm-up reports use `/v1/` instead. The brief's `https://open-api.saleshandy.com/v1` is right for the second group only.
2. Headers. The official client sends `x-api-key` and also `sh-application: open-api` on every request. We send both.
3. Envelope. Successful responses are wrapped as `{ "payload": ... }`. Errors come as `{ "code", "type", "message" }`, or `{ "statusCode", "message" }` for validation errors.
4. The existing adapter in `core/src/adapters/saleshandy.ts` uses paths such as `/sequences`, `/dnc` and `/email-accounts` on the `/v1` base. None of those match the official client, so the existing real mode would have failed on its first call. It is replaced.
5. Webhooks can carry custom headers chosen when the webhook is created. The example settings file claimed a secret had to go in the URL; it does not.

## Pagination styles

There are five, so there are five adapters:

1. Page and page size in the query string (`page`, `pageSize`): prospects (max 100), sequences (max 1000), clients (max 100), Do Not Contact lists and items (max 100), webhooks (max 100), inbox outcomes (max 100), tasks (max not stated, 100 used).
2. Page and limit in a POST body: unified inbox emails (`page`, `limit`), team analytics (`page`, `limit`).
3. Page and page size in a POST body: email accounts (`page`, `pageSize`, max 100).
4. Page number and page limit in a POST body: consolidated analytics (`pageNum`, `pageLimit`, 10 to 500).
5. Skip and take in the query string: notes for a prospect (`skip`, `take`).

Several reads return the whole list at once with no paging: sequence steps, schedules, prospect tags, fields, inbox categories, subsequences, team members, domains.

No response seen carries a total count. A page shorter than the page size is the last page.

## Incremental sync

1. No list endpoint found accepts an "updated since" filter.
2. The unified inbox list accepts `startDate` and `endDate`, so new mail can be fetched incrementally.
3. Prospects can be sorted by `createdAt`, which finds new prospects but not changed ones.
4. Everything else is a full scan. At today's size (to be measured) a full scan of sequences, prospects and tasks every night is well within any sensible rate limit at one request per second.

## Rate limits

Not published and not observable from here. The official client has no retry or rate limit handling at all. Our client throttles to one request per second (the brief's probing ceiling), backs off with jitter on 429 and 5xx responses, and honours `Retry-After` if Saleshandy sends it. The first live session measures the real behaviour by watching response headers on normal traffic at that rate, never by deliberately exceeding it. Enrichment has its own endpoint that reports its limits.

## Webhooks

1. Events (19): email sent, email opened, email link clicked, reply received, email bounced, prospect unsubscribed, prospect finished, prospect outcome updated, sequence paused, email account disconnected, email account paused, inbox analyser test completed, task created, bulk task updated, call task updated, LinkedIn task updated, custom task updated, WhatsApp task updated, task updated.
2. Created with a name, a URL, the events, and optional custom headers.
3. Signing: none found. Custom headers are the protection: our receiver requires `X-Webhook-Secret` to match `SALESHANDY_WEBHOOK_SECRET`.
4. Payload per event, unique event ids and retry behaviour: unverified. The receiver stores every raw payload, so the first real events document themselves. Duplicates are detected by the event id when one is present, otherwise by a hash of the raw body.

## Deleted and unsubscribed prospects

1. Unsubscribed: a prospect's sequence status can be `unsubscribed`, and a `prospect-unsubscribed` webhook exists. We mirror it to our suppression list.
2. Deleted: no endpoint in the official client deletes or lists deleted prospects. A prospect missing from the nightly full scan is treated as deleted in Saleshandy: its synced row is removed and its link to our records is cleared. Our own contact record is never deleted.

## Credits

1. `GET /api/open-api/v1/credits` reports available enrichment credits.
2. `GET /api/open-api/v1/enrich/rate-limits` reports enrichment limits.
3. Cost per call is unverified. The spend guard counts a conservative estimate (one credit per contact or company requested, one per email for verification), records the balance before and after each spend call, and records the real cost from the difference.

## Data volume

Unknown until the first live read. The integration status screen shows counts per resource after each sync.

## Capability matrix

Risk classes: Read; Low; Medium; High; Spend. "Unverified" means not called by Saleshandy's own client.

### Prospects

| Method and path | What it does | Paging | Updated since | Kind | Risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| GET /api/open-api/v1/contacts | List prospects, with search, sort and custom fields | Query page, max 100 | No (sort by created) | Read | Read | Build: the prospects screen and linking need it |
| GET /api/open-api/v1/prospects/attribute | One long text field value | None | No | Read | Read | Build: shown on demand in the prospect panel |
| POST /api/open-api/v1/prospects/{id}/attribute | Set one or more field values | None | No | Write | Low | Build: field edits from the panel |
| POST /api/open-api/v1/prospects/import-with-field-name | Create or update prospects | None | No | Write | Medium | Build: adding prospects from our records |
| GET /api/open-api/v1/prospects/import-status/{requestId} | Status of an import | None | No | Read | Read | Build: an import is asynchronous |
| PATCH /api/open-api/v1/contacts/status | Prospect status in a sequence: replied, finished, paused, unsubscribed, active | None | No | Write | Medium, High for active | Build: pause, finish or resume one prospect |
| GET /api/open-api/v1/contacts/tags | List tags | None | No | Read | Read | Build: tag filter and picker |
| POST /api/open-api/v1/contacts/tags/assign | Assign tags | None | No | Write | Low | Build: tags from the panel |
| POST /api/open-api/v1/contacts/tags/un-assign | Remove tags | None | No | Write | Low | Build: undo for tags |
| POST /api/open-api/v1/prospects/verification-status | Verification status of emails | None | No | Read (not confirmed free) | Read | Build: shown in the panel; checked for credit use on the first live call |
| Delete a prospect | Unverified | | | Write | High | Link out: hard deletes stay in Saleshandy by rule |

### Sequences

| Method and path | What it does | Paging | Updated since | Kind | Risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| GET /api/open-api/v1/sequences | List sequences | Query page, max 1000 | No | Read | Read | Build: outreach overview |
| POST /api/open-api/v1/sequences | Create a sequence (title, mailboxes, schedule) | None | No | Write | High | Build: create a sequence shell; its steps are written in Saleshandy |
| POST /api/open-api/v1/sequences/status | Change status of sequences | None | No | Write | Medium to pause, High to resume | Build: pause and resume |
| GET /api/open-api/v1/sequences/{id}/steps | List steps | None | No | Read | Read | Build: steps shown read only |
| GET /api/open-api/v1/sequences/{id}/steps/{stepId} | Step variants and subjects | None | No | Read | Read | Build: read only preview |
| POST /api/open-api/v1/sequences/{id}/steps | Create a step | None | No | Write | High | Link out: the step content editor stays in Saleshandy |
| POST /api/open-api/v1/sequences/{id}/steps/{stepId}/variants | Add a variant | None | No | Write | High | Link out: content editor |
| PATCH /api/open-api/v1/sequences/{id}/steps/{stepId}/variants/{variantId} | Edit a variant | None | No | Write | High | Link out: content editor |
| POST /api/open-api/v1/sequences/{id}/contacts | Add existing prospects at a step | None | No | Write | Medium | Build: add prospects to a sequence |
| POST /api/open-api/v1/sequences/prospects/import-with-field-name | Import prospects into a sequence | None | No | Write | Medium | Build: the approved draft pipeline uses it |
| GET /api/open-api/v1/sequences/{id}/settings | Settings, schedule, priority, client | None | No | Read | Read | Build: shown on sequence detail |
| PATCH /api/open-api/v1/sequences/{id}/settings | Change any of 13 settings, including the unsubscribe link | None | No | Write | High | Link out: compliance and deliverability settings belong with the sequence editor |
| PATCH /api/open-api/v1/sequences/{id}/schedule | Assign a sending schedule | None | No | Write | Medium | Build: set schedule from sequence detail |
| PATCH /api/open-api/v1/sequences/{id}/priority-distribution | Follow-up versus new prospect priority | None | No | Write | Medium | Link out: a sending strategy setting, rarely changed, best judged next to the sequence |
| GET /api/open-api/v1/sequences/{id}/email-accounts | Mailboxes on a sequence | None | No | Read | Read | Build: shown on sequence detail |
| POST /api/open-api/v1/sequences/{id}/email-accounts/add | Add mailboxes | None | No | Write | Medium | Link out: mailbox management |
| POST /api/open-api/v1/sequences/{id}/email-accounts/remove | Remove mailboxes | None | No | Write | Medium | Link out: mailbox management |
| POST /api/open-api/v1/sequences/{id}/test-email | Send a test email | None | No | Write | High | Link out: part of writing a step |
| POST /api/open-api/v1/sequences/{id}/verify-prospects | Verify a sequence's emails | None | No | Write | Spend | Build: with the spend guard |
| Remove a prospect from a sequence | Unverified | | | Write | Medium | Build if the live docs have it; until then the panel sets status to finished, which stops sending |
| Rename, duplicate or delete a sequence | Unverified | | | Write | High | Link out until confirmed |

### Subsequences and schedules

| Method and path | What it does | Paging | Updated since | Kind | Risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| GET /api/open-api/v1/sequences/{id}/subsequences | List subsequences | None | No | Read | Read | Build: listed on sequence detail |
| GET /api/open-api/v1/sequences/subsequence/{id}/settings | Trigger conditions and schedule | None | No | Read | Read | Build: shown read only |
| POST /api/open-api/v1/sequences/{id}/subsequence | Create a subsequence | None | No | Write | High | Link out: condition editor |
| PATCH /api/open-api/v1/sequences/{id}/subsequence/{subId} | Change a subsequence | None | No | Write | High | Link out: condition editor |
| GET /api/open-api/v1/schedules | List schedules | None | No | Read | Read | Build: schedule picker |
| POST /api/open-api/v1/schedules | Create a schedule with weekly time slots | None | No | Write | Medium | Link out: a weekly slot editor we would always be catching up with |

### Fields

| Method and path | What it does | Paging | Updated since | Kind | Risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| GET /api/open-api/v1/fields | List fields | None | No | Read | Read | Build: field labels in the panel |
| POST /api/open-api/v1/fields | Create a field | None | No | Write | Low | Link out: account set-up; a field is referenced by merge tags in sequence copy |
| PATCH /api/open-api/v1/fields/{id} | Rename a field or its fallback | None | No | Write | Low | Link out: renaming can break merge tags in copy |

### Do Not Contact and blacklist

| Method and path | What it does | Paging | Updated since | Kind | Risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| GET /v1/dnc | List Do Not Contact lists | Query page, max 100 | No | Read | Read | Build: lists screen |
| GET /v1/dnc/{listId} | Items in a list | Query page, max 100 | No | Read | Read | Build: lists screen and suppression mirror |
| GET /v1/dnc/item/search | Search items across lists | Query page, max 100 | No | Read | Read | Build: "is this address blocked" check |
| POST /v1/dnc | Add emails or domains to a list (max 1000) | None | No | Write | Medium | Build: from the panel and the lists screen |
| Remove from Do Not Contact | Unverified | | | Write | High | Link out until confirmed |
| Blacklist Domains group | Unverified (domains are items in Do Not Contact lists in the official client) | | | | | Confirm against live docs |

### Clients and user

| Method and path | What it does | Paging | Updated since | Kind | Risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| GET /v1/clients | List agency clients | Query page, max 100 | No | Read | Read | Build: filter sequences by client |
| POST /api/open-api/v1/clients | Create a client (sends them access) | None | No | Write | High | Link out: team and user management |
| POST /v1/clients/assign/{type} | Give a client sequences or mailboxes | None | No | Write | High | Link out: access management |
| GET /api/open-api/v1/user/team-member-list | Team members | None | No | Read | Read | Build: task assignee names |

### Email accounts and warm-up

| Method and path | What it does | Paging | Updated since | Kind | Risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| POST /api/open-api/v1/email-accounts | List mailboxes (health, quota) | Body page, max 100 | No | Read | Read | Build: mailbox health |
| GET /v1/warmup/report/{id}/{date} | Warm-up report for a day | None | No | Read | Read | Build: mailbox health detail |
| POST /api/open-api/v1/email-accounts/connect | Connect mailboxes (SMTP and IMAP passwords) | None | No | Write | High | Link out: sign-in flow, and we must never handle mailbox passwords |
| POST /api/open-api/v1/email-accounts/smtp-imap/connect | Connect one mailbox | None | No | Write | High | Link out: same |
| GET /api/open-api/v1/email-accounts/connect/status/{id} | Connection status | None | No | Read | Read | Link out: only meaningful after connecting there |
| POST /api/open-api/v1/email-accounts/reconnect | Reconnect mailboxes | None | No | Write | High | Link out: sign-in flow |
| POST /api/open-api/v1/email-accounts/bulk-update | Pause, primary flag, client | None | No | Write | High | Link out: mailbox management |

### Analytics

| Method and path | What it does | Paging | Updated since | Kind | Risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| POST /api/open-api/v1/analytics/stats | One sequence: sent, opens, replies, clicks, bounces, unsubscribes | None | No | Read | Read | Build: overview and detail |
| POST /api/open-api/v1/analytics/consolidated-stats | Many sequences over a date range | Body pageNum, 10 to 500 | Date range | Read | Read | Build: nightly snapshot |
| POST /api/open-api/v1/analytics/emailaccount/stats | One mailbox | None | No | Read | Read | Build: mailbox health |
| POST /api/open-api/v1/analytics/team/stats | Per team member | Body page | Date range | Read | Read | Build: overview |

### Tasks

| Method and path | What it does | Paging | Updated since | Kind | Risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| GET /api/open-api/v1/tasks | List with status, sequence, assignee filters | Query page | No | Read | Read | Build: tasks screen |
| GET /api/open-api/v1/tasks/{id} | One task | None | No | Read | Read | Build |
| GET /api/open-api/v1/tasks/counts | Counts by status | None | No | Read | Read | Build: badges |
| GET /api/open-api/v1/tasks/assignee/list | Assignees | None | No | Read | Read | Build |
| POST /api/open-api/v1/tasks/create | Create a task for prospects | None | No | Write | Medium | Build |
| POST /api/open-api/v1/tasks/{id}/complete | Complete | None | No | Write | Low | Build |
| POST /api/open-api/v1/tasks/{id}/skip | Skip | None | No | Write | Low | Build |
| POST /api/open-api/v1/tasks/{id}/snooze | Snooze until a time | None | No | Write | Low | Build |
| PATCH /api/open-api/v1/tasks/{id}/note | Change the task note | None | No | Write | Low | Build |
| POST /api/open-api/v1/tasks/bulk-skip | Skip up to 100 | None | No | Write | Low | Build: bulk actions |
| POST /api/open-api/v1/tasks/bulk-snooze | Snooze up to 10,000 | None | No | Write | Low | Build: bulk actions |
| GET /api/open-api/v1/tasks/bulk-status/{id} | Bulk action progress | None | No | Read | Read | Build |

### Unified inbox

| Method and path | What it does | Paging | Updated since | Kind | Risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| POST /api/open-api/v1/unified-inbox/emails | List threads with filters | Body page and limit | Yes, startDate | Read | Read | Build: inbox |
| GET /api/open-api/v1/unified-inbox/emails/{threadId} | A thread | None | No | Read | Read | Build |
| GET /api/open-api/v1/unified-inbox/emails/{threadId}/{emailId} | One email | None | No | Read | Read | Build |
| POST /api/open-api/v1/unified-inbox/emails/reply | Reply | None | No | Write | High | Build: admin only, 10 second undo |
| GET /api/open-api/v1/unified-inbox/outcome | Outcome definitions | Query page, max 100 | No | Read | Read | Build |
| GET /api/open-api/v1/unibox/categories | Categories and sentiment | None | No | Read | Read | Build |
| GET /api/open-api/v1/unified-inbox/unread-email-threads-count | Unread count | None | No | Read | Read | Build: badge |
| Set a thread's outcome | Unverified (a webhook reports outcome changes) | | | Write | Medium | Build if the live docs have it; link out until then |
| Mark read or unread | Unverified | | | Write | Low | Confirm against live docs |

### Notes and attachments

| Method and path | What it does | Paging | Updated since | Kind | Risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| GET /api/open-api/v1/prospects/{id}/notes | Notes for a prospect | Skip and take | No | Read | Read | Build |
| POST /api/open-api/v1/notes | Create a note on prospects | None | No | Write | Low | Build |
| PATCH /api/open-api/v1/notes/{id} | Edit content, visibility, status | None | No | Write | Low | Build: edit, and undo by restoring the old text |
| Delete a note | Unverified | | | Write | High | Link out until confirmed; undo of a new note is an edit back to empty with private visibility |
| POST /api/open-api/v1/attachments, /notes/attachments | Upload a file | None | No | Write | Low | Link out: only used by the step editor and note attachments; we keep no files from Saleshandy |

### Enrichment and lead finding

| Method and path | What it does | Paging | Updated since | Kind | Risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| POST /api/open-api/v1/enrich/contact | Enrich contacts by LinkedIn URL (max 100) | None | No | Spend | Spend | Build: admin only, with the spend guard |
| POST /api/open-api/v1/enrich/company | Enrich companies by domain, website or LinkedIn | None | No | Spend | Spend | Build: admin only, with the spend guard |
| GET /api/open-api/v1/enrich/status/{id} | Enrichment progress | None | No | Read | Read | Build |
| GET /api/open-api/v1/enrich/status/result/{id} | Enrichment result | None | No | Read | Read | Build |
| GET /api/open-api/v1/credits | Credits left | None | No | Read | Read | Build: shown before every spend |
| GET /api/open-api/v1/enrich/rate-limits | Enrichment limits | None | No | Read | Read | Build |
| Leads To Email group | Unverified | | | Spend | Spend | Confirm against live docs |

### Domain

All link out by default rule (domain set-up and billing): list domains, search, purchase, revoke, delete, orders, plans, mailbox name generation, profile picture upload. 10 endpoints.

### Webhook

| Method and path | What it does | Paging | Updated since | Kind | Risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| GET /api/open-api/v1/webhook | List webhooks | Query page, max 100 | No | Read | Read | Build: integration status shows what is registered |
| GET /api/open-api/v1/webhook/{id} | One webhook | None | No | Read | Read | Build |
| POST /api/open-api/v1/webhook/create | Register a webhook | None | No | Write | High | Link out: a person registers it in Saleshandy, by the brief's rule |

### Counts

1. Endpoints found in Saleshandy's own client: 99.
2. Build: 67 (43 reads, 21 writes behind the gateway, 3 credit-spending calls behind the gateway and the spend guard).
3. Link out: 32 (22 in the tables above, plus the 10 domain endpoints).
4. Not found, to confirm against the live docs: 9 (delete a prospect; remove a prospect from a sequence; rename, duplicate or delete a sequence; remove from Do Not Contact; the Blacklist Domains group; set a thread's outcome; mark a thread read or unread; delete a note; the Leads To Email group). Deletes link out regardless.

## Part A: our app

### 1. Stack

1. Server: Node 22 running TypeScript directly (`node src/server.ts`), with a small hand-written router in `core/src/lib/http.ts`. Routes declare who may call them: `user` (any signed-in person), `admin`, `api` (the service key n8n uses), `webhook` (a shared secret) or `none`.
2. Database: Postgres through `pg`, with `q`, `one` and `tx` helpers in `core/src/lib/db.ts`. Production is Neon (pooled connection string) behind Hostinger Cloud.
3. Migrations: numbered plain SQL files in `core/migrations/` (001 to 017 today), applied in order by `core/src/migrate.ts` on every boot and recorded so each runs once. The next file is `018_saleshandy.sql`. Applying them only ever happens by starting the app against a database, so for this work they are applied to the local database only.
4. Validation: zod, through `parse` in `core/src/lib/validate.ts`. A validation failure becomes a 400 with a readable message.
5. Front end: React 19 and Vite in `core/web`, a custom router, `useLoad` for data, and one `api` client (`core/web/src/api.ts`) that adds an idempotency key to every write.
6. Server secrets: read once in `core/src/lib/env.ts` from the process environment. The example file is `.env.example` at the repo root.
7. Scheduled work: an in-process scheduler (`core/src/scheduler.ts`) ticks every 20 seconds, matches jobs by India time, and takes a Postgres advisory lock per job. Each run is recorded in `workflow_runs`, one per time slot, so two app processes, or the app and n8n, never run the same job twice. Some jobs run only if someone used the app in the last quarter hour, so the free database can sleep at night. The new sync jobs are added to this scheduler.
8. Background work: `enqueue` in `core/src/jobs.ts` for work that outlives a request. Webhook processing uses it.

### 2. Saleshandy code that already exists

1. `core/src/adapters/saleshandy.ts`: an interface with a real client and a mock, chosen by `SALESHANDY_MODE` (`mock` by default). Its real paths do not match Saleshandy's (see "Facts that differ from the brief"). It has a 20 second timeout, no retries, no rate limiting and no pagination.
2. The real client exposes writes, and the outreach pipeline calls them directly: `syncToSaleshandy` in `core/src/pipeline.ts`, run every 15 minutes by the scheduler for approved email drafts. Under the new rules every write goes through one gateway, so this path is moved onto the gateway. It is harmless today because `SALESHANDY_MODE` is `mock` everywhere.
3. A webhook receiver at `POST /webhooks/saleshandy` that accepts a shared secret in an `X-Webhook-Secret` header or a `token` query parameter, compared in constant time. It processes events inline (no stored raw payload, no replay) and handles replies, bounces and unsubscribes by updating our own records and the suppression list.
4. A read-only status route, `GET /api/ops/saleshandy`, that lists mailboxes and sequences.

### 3. Our records that Saleshandy data links to

1. `contacts.email` (citext, unique where set): the exact-email match. `contacts.external_ref` already holds a Saleshandy prospect id for contacts the pipeline pushed.
2. `companies.domain` (normalised: lower case, no `www`, unique): the company-domain match.
3. `prospects` (our outreach record for a company in a campaign) and `campaign_memberships`, which already store `saleshandy_prospect_id` and `saleshandy_sequence_id`.
4. `opportunities`, `meetings`, `proposals` and `deals` hang off prospects, so a linked Saleshandy prospect reaches the deal screens through the prospect.
5. `suppression_list` (email and domain) is our own do-not-contact list. Saleshandy's Do Not Contact entries are mirrored next to it, not merged into it, so we can always tell which side an entry came from.
6. `email_events` and `replies` hold what webhooks have delivered so far.

### 4. Roles, permissions and conventions to follow

1. Two roles only: `admin` and `member` (`users.role`). Route-level auth is the only permission system. High and spend actions require `admin`; low and medium require any signed-in person (see `DECISIONS-NEEDED.md`).
2. Every write from the browser carries an `Idempotency-Key`, and the server stores the first response in `idempotency_keys` for 7 days, so a repeated key returns the first answer without acting again. The write gateway records the same key against each Saleshandy write, so a double click never sends twice.
3. Errors: `HttpError(status, message)` for anything the caller should see; database constraint errors become readable 400 or 409 messages; everything else is a logged 500 with a generic message in production.
4. Logging: structured JSON to stdout through `core/src/lib/log.ts`, which redacts any field whose name contains api key, password, secret, token or authorization. The Saleshandy client logs paths and status codes only, never request headers or bodies.
5. Audit: `audit()` writes to `activities`. The write gateway has its own `sh_write_audit` table because it needs before state, request and response.
6. Feature flags: there is no flag system. Switches are environment variables read in `env.ts`. The six Saleshandy flags follow that pattern, all off unless set to `true`.
7. Tests: `node --test` against a private database per test process (`core/test/helpers.ts`), with the AI provider and Saleshandy in mock mode. 90 tests pass today.
