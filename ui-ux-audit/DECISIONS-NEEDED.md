# Decisions needed

Product questions that change behaviour, not only looks. For each, the default I built is marked, and none of the
defaults change what the app sends to the server.

## 1. Which theme people see first

| Option | What it is | Why it matters | If chosen |
|---|---|---|---|
| Follow the system | Light or dark from the operating system. | Most people's machines already say what they prefer. | Someone on a light Mac sees the light theme first. |
| **Dark by default (built, since the dashboard rebuild)** | Dark unless the person picks Light or System in the profile menu or on Your account. | The dashboard and sign-in references are dark, cinematic designs. | The light theme still works everywhere, but most people never see it. |

## 2. Restoring an old wiki version

| Option | What it is | Why it matters | If chosen |
|---|---|---|---|
| **Ask first (built)** | "Restore version 2 of 'Leave policy'? It becomes the newest version; nothing is lost." | Restore replaces what everyone reads, and was one click with no confirmation. | One extra click; the same request is sent. |
| One click, as before | No confirmation. | Fastest. | An accidental click changes the page for everyone until someone notices. |

## 3. What a deal's "lost" step asks for

| Option | What it is | Why it matters | If chosen |
|---|---|---|---|
| **Reason required, in a dialog (built)** | Same rule as before (the server already refuses LOST without a reason); the dialog says so and the Mark lost button stays disabled until a reason is typed. | The old prompt cancelled silently if left empty. | Same requests, clearer. |
| Reason optional | Allow LOST with no reason. | Faster. | Needs a server change (the API requires a reason), and the weekly review loses its input. Not built. |

## 4. Where Today's to-dos sit

| Option | What it is | Why it matters | If chosen |
|---|---|---|---|
| **To-dos first, then outbound (built, as before)** | Your list, then what is waiting in outbound. | The founders asked for their work and to-dos front and centre. | No change. |
| Outbound first | Drafts and replies above to-dos. | Outbound has deadlines set by other people. | To-dos drop below the fold at 1024. |

## 5. Navigation on phones

| Option | What it is | Why it matters | If chosen |
|---|---|---|---|
| **Menu sheet (built)** | A top bar with the page name and a Menu button; the full navigation opens as a sheet. | All 14 destinations are one tap away; today 12 are hidden in a sideways strip. | One extra tap to switch screens. |
| Bottom tab bar | Five fixed tabs (Today, Inbox, Projects, Chat, Menu). | Faster for the five most used. | Needs a decision on which five; the rest stay behind Menu. |

## 6. Long tables: scroll inside the card, or with the page

| Option | What it is | Why it matters | If chosen |
|---|---|---|---|
| **Inside the card (built)** | On screens wider than a phone, a wide table scrolls within its card, which is at most the height of the window. | The header row stays in view while reading down the pipeline or CRM. | Two scroll areas on long lists; the mouse wheel scrolls the table first. |
| With the page, as before | The whole page scrolls; the header row scrolls away. | One scroll area. | Past the first screen of rows, the columns are unlabelled. |

## 7. The navigation label for meetings and proposals

| Option | What it is | Why it matters | If chosen |
|---|---|---|---|
| **"Meetings" (built)** | The sidebar says Meetings; the page title stays "Meetings and deals". | The full name wrapped onto two lines in the sidebar. | Proposals live on a page whose sidebar name does not mention them. |
| "Deals" | Matches the address (/deals). | Short. | Can be confused with CRM opportunities, which are also deals. |

## 8. Campaign names on Today

| Option | What it is | Why it matters | If chosen |
|---|---|---|---|
| **Code first, vertical underneath (built, as in the dashboard reference)** | IND-WEB-ELECTRONICS, then "DTC ecommerce: electronics". | Matches the reference and how the team talks about campaigns. | Newcomers read codes first. |
| Vertical first, code underneath | The UI pass's earlier choice. | Plain words lead. | Differs from the reference. |

## 9. Decorative curves on the KPI cards

| Option | What it is | Why it matters | If chosen |
|---|---|---|---|
| **Decorative curves (built)** | A gentle line under each number, the same shape family on every card, hidden from screen readers. | The reference has them; there is no history to plot yet. | Someone may read a trend into a drawn shape. |
| Real sparklines | A 14-day series per card. | Honest trend at a glance. | Needs daily counts kept on the server (the daily metrics snapshot covers campaigns only). |
| No curves | Numbers only. | Nothing to misread. | Differs from the reference. |
