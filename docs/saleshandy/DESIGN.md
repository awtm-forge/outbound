# Saleshandy integration: design

Prepared with AI assistance on 14 October 2026. Read with `DIAGNOSIS.md`, which lists every endpoint this design uses.

## 1. Sync model

1. Webhooks for near real time events: reply received, email bounced, prospect unsubscribed, prospect finished, prospect outcome updated, sequence paused, email account disconnected and paused, task created and updated (all task kinds), email sent. Opens and link clicks are stored but marked unreliable, because mail privacy features open mail automatically.
2. Every 30 minutes, an incremental sync: unified inbox threads since the last successful run (the inbox list accepts `startDate`), new prospects (sorted by created date, stopping at the first one already known), sequence list and status, task list, mailbox health. It runs only while someone has used the app in the last quarter hour, like the existing draft sync, so the database can still sleep at night. Webhooks keep working regardless.
3. Every night at 02:30 India time, a full reconciliation of every synced resource. Anything missing from a full scan is treated as deleted in Saleshandy and removed from the mirror.
4. After every successful write, the affected records are fetched again at once (the prospect, the sequence, the thread or the task), so a screen never waits for the next sync to show what was just done.
5. Webhooks cannot be signed, but Saleshandy sends custom headers chosen when the webhook is registered. The receiver requires `X-Webhook-Secret`. If webhooks are ever unavailable, the 30 minute sync plus the nightly run still keep everything current within half an hour.

Every database write in a sync is an upsert keyed by the Saleshandy id, so running a sync twice changes nothing. Each run writes a `sh_sync_runs` row with counts per resource. A record that fails to parse is logged in the run's errors and skipped; it never fails the run.

## 2. Tables

All tables are prefixed `sh_` because the app already has `tasks` and `notes` tables of its own. Every table keyed by a Saleshandy id has `created_at` and `updated_at` (ours) and `synced_at` (the last time a sync or webhook saw it).

1. `sh_sequences`: id, title, active, status, progress, client id, schedule id, totals (sent, opened, replied, clicked, bounced, unsubscribed, as reported by Saleshandy), totals_at.
2. `sh_sequence_steps` (read only): id, sequence id, number, type, execution type, relative days, status, variant count, subject of the first variant.
3. `sh_prospects`: id, email, first name, last name, company name, verification status, tags, Saleshandy created date, and the link to our records: `contact_id`, `company_id`, `link_method` (exact email, company domain, by hand, or not linked).
4. `sh_prospect_sequences`: prospect id, sequence id, step id, status (active, paused, finished, replied, unsubscribed, bounced), outcome.
5. `sh_events`: id (the Saleshandy event id, or a hash of the raw event when there is none), kind, prospect id, sequence id, email, occurred at, `reliable` (false for opens and clicks).
6. `sh_threads`: id, prospect email, subject, sequence id, mailbox id, last message at, read flag, category and sentiment, outcome.
7. `sh_messages`: id, thread id, direction, from, to, sent at, subject, body as plain text (needed to read and answer a thread here).
8. `sh_tasks`: id, type, status, priority, prospect id, sequence id, due date, note, assignee.
9. `sh_notes`: id, prospect id, content, visibility, status, Saleshandy created date.
10. `sh_dnc_lists` and `sh_dnc_items`: list id, name, item count; item id, list id, value, type (email or domain).
11. `sh_email_accounts` (read only): id, from email, from name, status, provider, health and remaining quota.
12. `sh_analytics_snapshots`: day, scope (sequence, mailbox, team member), scope id, numbers. One row per day and scope, upserted.
13. `sh_webhook_inbox`: event key (unique), event type, raw payload, received at, processing status, attempts, last error. Kept for replay.
14. `sh_sync_runs`: kind (full, incremental, refresh), started, finished, status, counts per resource, errors.
15. `sh_write_audit`: idempotency key (unique), who, action, risk class, targets, before state, request (no secrets), Saleshandy response, outcome (refused, pending, sent, failed, cancelled), reason, send time.
16. `sh_credit_spend`: month, action, estimated credits, balance before, balance after, actual credits, audit id.

## 3. Data minimisation (DPDP Act)

1. Only fields a screen, report or action uses are stored. Phone numbers, LinkedIn URLs and enrichment results are not mirrored; enrichment results are shown once and, if a person chooses, written to our own contact record.
2. Message bodies are stored as plain text without attachments, because the inbox screen needs them.
3. Deletions and unsubscribes in Saleshandy are mirrored: an unsubscribe adds the address to our suppression list; a prospect missing from the nightly scan is removed from the mirror together with its events, threads, notes and tasks.
4. Proposed retention, logged as a decision: mirrored message bodies and events older than 12 months are deleted; prospects with no activity for 12 months are removed from the mirror (Saleshandy remains the record). Audit rows are kept for 3 years.

## 4. Linking to our records

1. Exact email: a prospect whose email equals a `contacts.email` links to that contact (and its company).
2. Company domain: otherwise, the domain of the email is matched to `companies.domain`. Free mail domains (gmail.com, outlook.com and similar) never match.
3. Nothing else, and nothing is ever created: no client, lead or contact record is made automatically.
4. Unmatched prospects appear on the "Not linked yet" list, where a person picks the contact or company by hand. A link made by hand is never changed by a later sync.

## 5. Screens

All under Outreach, built from the app's existing components so the redesign can restyle them later. Every synced screen shows "Last synced" and handles loading, empty, error and stale states. Stale means the last successful sync is older than 2 hours.

1. Outreach overview: sequences with status, sent, replies, reply rate, bounces, and pause or resume.
2. Sequence detail: prospects in it with their status, steps read only with "Edit in Saleshandy", schedule (change it), subsequences read only, add prospects, and pause, finish or resume a prospect.
3. Inbox: threads with filters (unread, sentiment, sequence), read a thread, reply (admin, 10 second undo), create a task. Setting an outcome links out until the endpoint is confirmed.
4. Prospects: search and filter, and a detail panel with timeline, notes, tasks, field values, tags, sequence membership and Do Not Contact.
5. Prospect panel on our company page and on the prospect page: every Saleshandy prospect linked to that company or contact, with the same actions.
6. Tasks: list with filters, complete, skip, snooze, edit note, bulk skip and snooze.
7. Lists: Do Not Contact lists and their items (emails and domains), add items.
8. Mailbox health: read only status, quota and warm-up, with links to Saleshandy for any change.
9. Enrichment: contact and company enrichment with the spend guard, credits left and the month's spend.
10. Not linked yet.
11. Integration status: last sync per resource, errors, webhook inbox with replay of failures, credit spend this month, the audit log, and the state of every flag.

## 6. Write gateway

One module, `core/src/saleshandy/gateway.ts`, is the only code that can send a write. The client's write method is not exported; the gateway receives it when it is created. In order, for every write:

1. Permission: low and medium need a signed-in person; high and spend need an admin; the pipeline acts as the system.
2. Kill switches: `SALESHANDY_WRITES_ENABLED` and the flag for the action's class.
3. Environment guard: outside production, every affected email must be at a domain in `SALESHANDY_TEST_ALLOWLIST` and every affected sequence must be `SALESHANDY_TEST_SEQUENCE_ID`. A write whose targets cannot be resolved to emails and sequences is refused outside production.
4. Spend guard: outside production every spend call is refused. In production, refused if the month's recorded spend plus the estimate would pass `SALESHANDY_MONTHLY_CREDIT_CAP`.
5. Idempotency: the key from the browser's action is unique in `sh_write_audit`; a repeated key returns the first outcome and sends nothing.
6. Audit: the row is written before sending (with the before state) and updated after (response and outcome). Refusals are audited too.
7. The same throttle as reads.

High risk actions are held for 10 seconds before sending: the audit row is `pending` with a send time, the browser shows Undo, and cancelling within the window marks it `cancelled`. A timer sends it when due, and the scheduler sends any due row a restart left behind.

## 7. Link outs

Each appears as a plain link to the matching Saleshandy page where the action would otherwise be: step and variant editing, sequence settings and priority, test emails, subsequence conditions, creating schedules, field definitions, mailbox connection, reconnection and settings, warm-up settings, domains, clients and team members, webhook registration, and true deletion of prospects and sequences.
