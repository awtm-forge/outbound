# Saleshandy integration: rollout and runbook

Everything here is done by a person. Nothing in the code registers webhooks, changes settings, or deploys. Every switch is off by default, and with every switch off the app behaves as it did before this work.

## Switches

All are server environment variables, read on every action, so a change takes effect on the next request once the host has restarted with it. A value of `true`, `1`, `yes` or `on` means on; anything else, including unset, means off.

| Variable | What it does |
| --- | --- |
| `SALESHANDY_INTEGRATION_ENABLED` | Shows the Outreach screens and runs the sync jobs. Off: no screens, no syncs, no reads. |
| `SALESHANDY_MODE` | `real` with a key set means real calls. Anything else serves the constructed fake account. |
| `SALESHANDY_API_KEY` | The key. Server only. Never put it in the web app's settings, a URL, a log or a message. |
| `SALESHANDY_WEBHOOK_SECRET` | The secret every webhook must carry in the `X-Webhook-Secret` header. Unset: every webhook is refused. |
| `SALESHANDY_WRITES_ENABLED` | The main write switch. Off: every write is refused and recorded as refused. |
| `SALESHANDY_WRITES_LOW`, `_MEDIUM`, `_HIGH`, `_SPEND` | One switch per risk class. A write needs the main switch and its class switch. |
| `SALESHANDY_TEST_ALLOWLIST` | Outside production, the only email domains a write may touch (comma separated). |
| `SALESHANDY_TEST_SEQUENCE_ID` | Outside production, the only sequence a write may touch. |
| `SALESHANDY_MONTHLY_CREDIT_CAP` | Credits that may be spent per calendar month. Unset or 0: nothing may spend. Outside production, nothing may spend at all. |
| `SALESHANDY_MIN_INTERVAL_MS` | The gap between calls to Saleshandy, default 1000. |

"Production" means `NODE_ENV=production`. Outside it, the environment guard limits every write to the allowlist and the test sequence, whatever the switches say.

## Rollout

Each step is checked before the next.

1. Apply migration `018_saleshandy.sql` with the normal migration command at deploy time. It only adds tables whose names start with `sh_`.
2. Deploy with every Saleshandy switch off. Check that nothing has changed: no Outreach item in the menu, the pipeline behaves as before.
3. Set `SALESHANDY_API_KEY` and `SALESHANDY_MODE=real` in the host's settings. Still off.
4. Set `SALESHANDY_INTEGRATION_ENABLED=true` and redeploy. Writes are still off, so nothing can change in Saleshandy.
5. As an admin, open Outreach, then Integration status, and press **Run read checks**. It reads every resource once from the live server, reports the rate limit headers Saleshandy sends and the credit balance, and writes nothing. Every line should pass. Then press Full sync and check the counts against Saleshandy.
6. Register the webhook (next section, also shown on Integration status). Send one test event and check it appears there as processed.
7. The test sequence check:
   1. In Saleshandy, make a sequence for testing only, and add one prospect to it whose email is at awtmforge.com.
   2. In the host, set `SALESHANDY_TEST_SEQUENCE_ID` to that sequence's id and `SALESHANDY_TEST_ALLOWLIST=awtmforge.com`, and turn on `SALESHANDY_WRITES_ENABLED`, `_LOW`, `_MEDIUM` and `_HIGH`. These switches apply to everyone, so do this when you are ready for writes.
   3. Press **Run test sequence check**. It pauses and resumes that sequence (only if it was running, so a paused sequence never starts sending), then adds a note, puts a tag on and takes it off, and creates and skips a task, all on that one prospect, through the write gateway. Every write is in the write log. Nothing outside that sequence and prospect is touched, even in production.
8. Keep writes on, or switch the classes off again and turn them on one at a time over a few days: low, then medium, then high, checking the write log each time.
9. Spend last, and only with a cap: set `SALESHANDY_MONTHLY_CREDIT_CAP` first, then `SALESHANDY_WRITES_SPEND=true`.

Still to confirm by watching the first real events: the payload of each webhook kind (each raw payload is kept on Integration status, so it documents itself), what a 429 looks like if one ever comes, and what one enrichment call costs. Record the answers in `DIAGNOSIS.md`.

## Registering the webhook

Do this yourself in Saleshandy. The code never registers it.

1. Make a secret on your own machine, for example with `openssl rand -hex 32`. Do not paste it anywhere but the two places below.
2. In the host's settings, set `SALESHANDY_WEBHOOK_SECRET` to it and restart.
3. In Saleshandy's webhook settings, create one:
   1. Name: ops portal.
   2. URL: `https://ops.awtmforge.com/webhooks/saleshandy`.
   3. Custom header: name `X-Webhook-Secret`, value the secret.
   4. Events: reply received, email bounced, prospect unsubscribed, prospect finished, prospect outcome updated, sequence paused, email sent, email account disconnected, email account paused, task created, task updated, bulk task updated, call task updated, LinkedIn task updated, custom task updated, WhatsApp task updated. Email opened and link clicked are optional: they are stored but marked unreliable, because mail privacy features open and click on their own.
4. Send a test event from Saleshandy if it offers one. It should appear on Integration status within a few seconds.

Never put the secret in the URL. The receiver no longer accepts a `?token=` parameter, so an old webhook that used one now gets 401 and must be recreated with the header.

## When something goes wrong

### The key may have leaked

1. In Saleshandy, open Settings, then API keys, and delete the key. Every call with it stops at once.
2. Set `SALESHANDY_WRITES_ENABLED=false` while you work, so nothing half-done is retried with a new key.
3. Create a new key and put it in the host's settings only. Restart.
4. Check the write log on Integration status, and Saleshandy's own activity, for anything you did not do.
5. If it leaked through a commit, the key is already rotated; also remove it from history with your Git host's guidance.

### A sync failed or is partial

1. Integration status lists recent syncs with counts and the records that were skipped and why.
2. Partial means some records did not match the expected shape and were skipped; everything else was stored. If the same field is skipped every time, Saleshandy has changed a shape: fix the schema in `core/src/saleshandy/sync.ts`.
3. Failed means a whole step could not run, usually because Saleshandy could not be reached or the key was refused (401). Check the key, then press Sync changes now.
4. A full run never removes rows for a resource whose scan did not finish, so a failed run does not delete anything.

### Webhooks are failing

1. Integration status lists recent webhooks. A 401 never reaches that list: check the secret on both sides.
2. A failed one keeps its raw payload and error. Fix the cause, then press Replay on it, or Replay failed for all.
3. Webhooks are a speed-up; the scheduled syncs catch anything missed.

### Stop all writes now

Set `SALESHANDY_WRITES_ENABLED=false`. It is checked again just before each send, so a high risk action waiting in its 10 second window is refused too. Reads and syncs carry on. To stop everything, set `SALESHANDY_INTEGRATION_ENABLED=false`.

### A write is stuck as "sending"

The app was stopped mid-send. Integration status counts these. Check in Saleshandy whether it happened before trying again; the app does not retry these by itself, because a repeat could double the action.

### Credits

The month's spend is the sum of estimates recorded before each call, corrected by the balance Saleshandy reports after it where it reports one. Raising the cap is a host setting; there is no override in the app.
