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

## 3. Webhook secret in the URL

Saleshandy's webhook settings may only allow a URL, with no custom header. The existing receiver accepts the secret either as an `X-Webhook-Secret` header or as a `token` query parameter. This will be confirmed in Part B.

1. Keep accepting the query parameter (current default, if Saleshandy cannot sign or send headers). The secret then sits in Saleshandy's settings and possibly in access logs on the hosting side. Rotation is easy.
2. Header or signature only. Safer, but only possible if Saleshandy supports it.
