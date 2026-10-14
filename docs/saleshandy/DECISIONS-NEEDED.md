# Saleshandy integration: decisions needed

Prepared with AI assistance. Each item is a choice made so the work could continue. Each lists the options, why it matters, and what happens with each. Nothing here is final until Rahul confirms it.

## 1. Who may take medium risk actions

Medium actions are: add or remove prospects from a sequence, change an outcome, add to Do Not Contact or the blacklist, pause a sequence, create a task.

1. Any signed-in person (chosen for now). Members can run day to day outreach. Mistakes are limited by the confirmation dialog, the typed count for bulk actions over 25, and the audit log.
2. Admins only. Safer, but every pause or outcome change waits for an admin, which slows replies.

Why it matters: the app has only two roles, `admin` and `member`, so there is no middle ground without adding a role.

## 2. Moving the existing pipeline sync onto the write gateway

The outreach pipeline already adds approved drafts to Saleshandy sequences every 15 minutes, calling Saleshandy directly. The brief says every write goes through one gateway.

1. Move it onto the gateway (chosen). Its writes are then permission checked, flag gated, environment guarded and audited like everything else. It will run as the `system` actor with the medium risk class, so it stops when `SALESHANDY_WRITES_ENABLED` or `SALESHANDY_WRITES_MEDIUM` is off.
2. Leave it as it is. Less change, but it would be the one path that bypasses the kill switches.

What happens with option 1: turning the medium flag off in an incident also stops the 15 minute sync, which is the point of a kill switch.

## 3. How the webhook proves it is Saleshandy

Saleshandy does not sign webhooks, but it sends custom headers chosen when the webhook is registered (confirmed in Saleshandy's official client).

1. Header only (chosen). The receiver requires `X-Webhook-Secret` and no longer accepts the secret as a `token` in the URL, so it never appears in links or access logs.
2. Keep the URL token as well. Only useful if some sender cannot set headers; none is known.

What happens with option 1: an old webhook registered with the secret in the URL stops being accepted. None is registered today.

## 4. Retention of mirrored data

1. 12 months (chosen as the proposal). Message bodies and events older than 12 months are deleted from our mirror; prospects with no activity for 12 months are removed from the mirror. Saleshandy stays the full record. Audit rows are kept for 3 years.
2. 6 months. Less personal data held, but reply history older than half a year disappears from our screens.
3. 24 months. Longer history for reporting, more personal data to justify under the DPDP Act.

Why it matters: the DPDP Act expects personal data to be kept only as long as its purpose needs.

## 5. Working without live access

This environment could not reach Saleshandy, and changing that was declined. So:

1. The endpoint list comes from Saleshandy's official command line client (its code read, not run), which fixes paths, fields, paging and limits.
2. Response shapes not shown by that client, rate limits, webhook payloads and credit costs are unverified and marked so. The client is typed loosely where a shape is unverified, and every unknown field is ignored rather than trusted.
3. Live tests and real sync counts wait for a session that can reach Saleshandy.

What happens: everything is built and tested against constructed fixtures. The first live session runs the live checks listed in the pull request and replaces constructed fixtures with recorded, anonymised ones.

## 6. Actions with no confirmed endpoint

Removing a prospect from a sequence, setting a thread's outcome, deleting a note and removing an address from Do Not Contact are not in Saleshandy's official client.

1. Fall back and link out (chosen). "Remove from sequence" sets the prospect's status in that sequence to finished, which stops all sending; outcome changes, note deletion and Do Not Contact removal link to Saleshandy.
2. Guess the endpoints. Rejected: a wrong guess fails at the worst moment.

## 7. When data counts as stale

1. 2 hours (chosen). The 30 minute sync only runs while someone uses the app, so the first visit of a morning can show data from the night run; anything older than 2 hours is flagged stale with a "Sync now" button.
2. 1 hour. More warnings, more manual syncs.

## 8. Sync cadence

1. Webhooks, a 30 minute incremental sync while the app is in use, and a nightly full run at 02:30 India time (chosen).
2. A 15 minute incremental sync. Fresher without webhooks, twice the requests and less database sleep.

## 9. Undo for low risk actions

Some low risk actions have an opposite in Saleshandy (a tag can be removed again); others do not (a completed task cannot be reopened, a note cannot be deleted).

1. Opposite where one exists, otherwise a 5 second wait in the browser with Undo (chosen). Undo inside the wait means nothing is sent. Closing the page inside the wait also means nothing is sent, which fails safe.
2. Hold low risk actions on the server for 10 seconds, like high risk ones. Survives a closed page, but every small action waits 10 seconds.

