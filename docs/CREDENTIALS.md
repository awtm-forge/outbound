# Credentials and access still required

Nothing below exists on this machine or in this repository. The system runs fully in mock mode without them.

| Item | Unlocks | Where it goes | Who provides |
|---|---|---|---|
| Hostinger VPS SSH access (host, user, key) or a KVM VPS purchase approval (about INR 500 to 800 per month for 2 vCPU / 8 GB) | Production deployment at /opt/awtm-outbound-os | Your SSH config; repo cloned on the VPS | Rahul or Ayush |
| DNS control for awtmforge.com | n8n.awtmforge.com and ops.awtmforge.com A records | Registrar / Cloudflare | Rahul |
| Anthropic API key | Real agents instead of the deterministic mock (`AI_PROVIDER=anthropic`) | `.env` on the VPS only | console.anthropic.com, pay as you go |
| Saleshandy API key (Outreach Pro or above exposes the API) | Real sequences, prospects, DNC, stats (`SALESHANDY_MODE=real`) | `.env` on the VPS only | Saleshandy > Settings > API |
| Saleshandy webhook configuration | Reply, bounce and unsubscribe events into `https://n8n.awtmforge.com/webhook/awtm/saleshandy` with header `x-api-key: <CORE_API_KEY>` | Saleshandy > Settings > Webhooks | after deployment |
| Sending mailbox(es) on Google Workspace, connected and warmed in Saleshandy (ayush@awtmforge.com) | Actual sending | Saleshandy email accounts | Ayush |

When the Saleshandy key arrives: confirm the three endpoint paths in `core/src/adapters/saleshandy.ts` (`/sequences`, `/sequences/{id}/prospects`,
`/dnc`) against the account's API docs. Each is a one-line change if the path differs. The sequence step in Saleshandy must use the merge tags
`{{subject_1}}` and `{{body_1}}` so the approved copy is sent verbatim.

Email verification: Saleshandy's built-in verifier is assumed; set `email_verification_status` through `POST /api/contacts/:id/verification`
from the verification result. Sync refuses INVALID and RISKY contacts.
