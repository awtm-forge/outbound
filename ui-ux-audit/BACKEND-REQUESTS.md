# Backend requests

Changes this UI pass wanted but did not make, because they need the server. Each was designed around: the screen
works without it.

## 1. Send the campaign's name wherever its code is sent

- **What**: add the campaign's `vertical` (or `name`) next to `campaign` (the code) in `GET /api/crm/companies/:id`
  (the `prospects` list) and `GET /api/crm/opportunities`.
- **Helps**: CRM company page, CRM opportunities.
- **Why it matters**: people see `IND-WEB-ELECTRONICS` instead of "DTC ecommerce: electronics". Every other screen
  already gets a name and now shows it.
- **If never done**: those two screens keep showing the code, in small faint type so it reads as a reference rather
  than a title.

## 2. A reply rate that cannot pass 100%

- **What**: `campaignMetrics` divides replies by `emails_sent`, and counts a reply even when the matching sent event
  was never recorded (manual delivery, the demo), so the fixture shows "300%" and "Positive 200%".
- **Helps**: Today (campaign table), Campaigns.
- **Why it matters**: an impossible number makes every other number on the screen doubtful.
- **If never done**: the UI shows rates above 100% as "More replies than recorded sends" with the raw counts, instead
  of a percentage.

## 3. Display names on activity and notes

- **What**: return the person's display name with `actor` on activities and CRM notes (today it is the sign-in name,
  or `system`, `n8n`, `saleshandy`).
- **Helps**: CRM company activity and notes, prospect history, Today's recent feed.
- **Why it matters**: "rahul" and "n8n" are system words; "Rahul" and "Automation" are what people say.
- **If never done**: the UI maps known service actors to words ("Automation", "Saleshandy") and capitalises sign-in
  names, which is right for this team but not guaranteed for every name.

## 4. Pagination on long lists

- **What**: `GET /api/prospects`, `/api/crm/companies` and `/api/crm/contacts` return up to 500 rows with no cursor.
- **Helps**: Pipeline, CRM.
- **Why it matters**: past a few hundred companies the table becomes slow to render and the 500 cap silently hides rows.
- **If never done**: the tables render what arrives (sticky headers, in-browser filtering); a note appears under the
  table when exactly 500 rows came back, saying the list may be cut off and to narrow the search.

## 5. Unread count for chat in the overview

- **What**: include the chat unread total in `GET /api/overview`.
- **Helps**: Today.
- **Why it matters**: Today could say "3 unread messages" without the chat feed.
- **If never done**: Today does not mention chat; the Chat item in the navigation keeps its own count from the live
  feed, as now.
