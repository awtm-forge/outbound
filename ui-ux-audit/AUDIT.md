# UI and UX audit: ops.awtmforge.com

Date: 13 October 2026. Build audited: `main` at 8839af6. Method: every screen opened as an admin (Rahul) and, where the
view differs by role, as a member (Meera), at 1440, 1024, 768 and 390 pixels wide. The app has one theme (dark), so
there are no light screenshots before the change. Data is a fixture made through the app's own API: the project's
demo company plus seven prospects run through the mock AI, one discovery search on the mock source, two replies,
three people, two projects, wiki pages, chat, CRM deals, HR records with pay and leave. No real credentials were used.

Evidence files are in `ui-ux-audit/before/`, named `<screen>[.member].<width>.dark.jpg`. Network baselines are in
`ui-ux-audit/network/before/`. Automated accessibility results are at the end.

Severity, used throughout:

- **Blocks the task**: a person cannot finish what they came to do, or is likely to do the wrong thing.
- **Slows the task**: they get there, with extra reading, scrolling, guessing or clicks.
- **Looks unfinished**: it works, but erodes trust in the tool.
- **Polish**: small inconsistencies.

## 1. What the app is, and who sees what

React 19 single-page app (`core/web`), built with Vite, served by the Node core on the same origin. Routing is a
hand-written History API router (`src/router.tsx`). Styling is one global stylesheet (`src/styles.css`) with CSS custom
properties; there is no component library and no CSS framework. Icons are hand-drawn inline SVGs (`src/ui/icons.tsx`).
Fonts are self-hosted: Bricolage Grotesque (variable) for reading, IBM Plex Mono for short metadata. Shared pieces live
in `src/ui/kit.tsx` (spinner, empty, skeleton, failure banner, score ring, status tag, date and money formatting).

Roles: **admin** and **member** (personal logins), plus the X-Api-Key service caller, which has no screens.

| Screen | Path | Admin | Member | For, in one sentence |
|---|---|---|---|---|
| Sign in | any path, signed out | yes | yes | Get into the app with my own name and password. |
| Choose a password | any path, temporary password | yes | yes | Replace the password an admin gave me before anything else opens. |
| Today | `/` | yes | yes | See what needs me now: my to-dos, what is waiting in outbound, and how the pipeline stands. |
| Find companies | `/find`, `/find?s=` | yes | yes | Search the web for companies that fit, then add the right ones to a campaign. |
| Review emails | `/review` | yes | yes | Read each drafted cold email against the evidence, then approve, send back or reject it. |
| Inbox | `/inbox` | yes | yes | Deal with replies: read the suggestion, draft a teardown, book a call, or mark it handled. |
| Pipeline | `/pipeline` | yes | yes | See every company in outbound, filter by stage, and open one. |
| Prospect profile | `/prospects/:id` | yes | yes | See everything we know about one company and fix what blocks the next step (usually a named person). |
| Meetings and deals | `/deals` | yes | yes | Prepare for calls, turn notes into next steps, and approve proposal drafts. |
| Campaigns | `/campaigns` | yes | yes | Judge each campaign on its numbers and manage the do-not-contact list. |
| Projects | `/projects`, `?view=mine`, `?view=archived` | yes | yes | See all projects, and add or find the tasks on my plate. |
| Project board | `/projects/:id` | yes | yes | Move a project's tasks through To do, Doing, In review and Done. |
| Wiki | `/wiki`, `/wiki/:slug` (+ edit, history, new) | yes | yes | Read and write how we work; find a page fast. |
| Chat | `/chat/:id` | yes | yes | Talk to the team in channels or one to one. |
| CRM | `/crm` (companies, people, opportunities) | yes | yes | Find a client or contact, see the deals in play, and keep notes. |
| Company | `/crm/companies/:id` | yes | yes | Everything about one client: deals, outbound, notes, people, projects. |
| People | `/people`, `?tab=leave`, `/people/:id` | yes | yes (no pay) | See who is on the team and who is out; ask for or approve leave. |
| Team | `/team` | yes | no ("Nothing here") | Manage who can sign in and with what role. |
| Your account | `/account` | yes | yes | Change my name, email and password. |

## 2. Problems that cut across every screen

| # | Severity | Problem | Evidence |
|---|---|---|---|
| X1 | Blocks the task | **On a phone, 12 of the 14 destinations are hidden.** The sidebar becomes a single horizontal strip with no indication that it scrolls; only "Today" and "Find companies" are visible. Chat, Projects and Inbox are effectively unreachable. | `today.390`, `project-board.390` (top bar) |
| X2 | Blocks the task | **Destructive actions use the browser's own `confirm()` and `prompt()`** (nine places: delete a task, a wiki page, a chat message, a pay record; switch someone off; cancel leave; leave the wiki editor; mark a deal lost, twice). They cannot be styled, do not trap focus inside the app, show the site's address as the title, and the "lost" prompt throws away the stage change if the box is left empty without saying so. | Code: `Project.tsx`, `Wiki.tsx`, `Chat.tsx`, `People.tsx`, `Team.tsx`, `Crm.tsx`, `Company.tsx` |
| X3 | Slows the task | **Orange means everything.** The single accent is used for the primary button, the current nav item, unread counts, every "Awaiting review", "Replied" and "Proposal" tag, every "High" priority, every "Keep going" recommendation, campaign codes, and section eyebrows. Nothing stands out because everything does. | `pipeline.1440` (four solid orange tags per screen), `campaigns.1440` |
| X4 | Slows the task | **Internal codes and raw values reach people.** Campaign codes (`IND-WEB-ELECTRONICS`) are the primary label on Today, Pipeline, Review, Prospect, Company and Campaigns; enum values leak as `HIGH priority`, `draft`, `active`, `created · n8n`, `qualified · system`; the Find quota reads `0 of 100 searches today · mock`; Campaigns tells the reader to edit `core/config/campaigns.json`. | `today.1440`, `review.1440`, `inbox.1440`, `campaigns.1440`, `crm-company.1440`, `find.1440` |
| X5 | Looks unfinished | **All-caps monospace labels over almost everything**: date eyebrows, section eyebrows, every form label, every table header, every key/value label, wiki breadcrumbs. They are hard to read (11px, wide tracking, faint colour) and make every screen look the same. | every screenshot |
| X6 | Looks unfinished | **One card treatment for everything.** Tiles, panels, forms, lists, empty states and notes are the same bordered box with the same radius, so hierarchy comes only from position. | `today.1440`, `campaigns.1440`, `crm-company.1440` |
| X7 | Looks unfinished | **Decorative motion and washes**: every page fades up on every navigation (`.page { animation: rise }`), the sign-in page sits on a radial orange glow, "hot" tiles carry a gradient. | `login.1440`, code `styles.css` |
| X8 | Slows the task | **Buttons with arrows and icon-only actions without names.** "Open pipeline →", "Full profile →", "Profile →", "Companies →"; the wiki delete button is an unlabelled bin icon (axe: critical). | `review.1440`, `inbox.1440`, `wiki-page.1440` |
| X9 | Slows the task | **Disabled primary buttons look like a broken brown**, not like "not yet" (opacity 0.5 over orange). Seen on "Add note", chat send, "Comment". | `crm-company.1440`, `chat.1440` |
| X10 | Looks unfinished | **No light theme**, and the dark theme hard-codes 27 colours outside its tokens, so a theme cannot be added without touching rules one by one. | `styles.css` |
| X11 | Slows the task | **Wide tables overflow at 1440 and 768** with no sticky first column, so the right-hand columns (Person, Campaign, Updated) are cut off and must be scrolled to. | `pipeline.1440` ("UPDAT" clipped), `pipeline.768` |
| X12 | Polish | **Tables at 390 are the desktop table, scrolled sideways.** No stacked layout for phones. | `pipeline.390`, `crm-companies.390`, `people.390` |
| X13 | Polish | **Copy is inconsistent between the button and its confirmation** ("Approve" then "Approved. X will be queued"; "Add note" then nothing; "Save" then "Saved."). | toasts in code |
| X14 | Polish | **Placeholder dots for missing values** ("·") in tables and key/value lists read as data. | `person.member.1440` (Phone ·), `pipeline.1440` |

## 3. Screen by screen, in build order

The order is by how often the screen is used and how much a confusing screen costs there (section 4 explains it).

### 3.1 Today (`today.*`)

1. Slows the task: the hero ("Good evening, Rahul. 6 things need you.") is 46px and two lines, pushing the work below the fold at 1024 and below. The "6" is the sum of drafts, replies and teardowns, which the reader cannot reconcile with the six tiles below it.
2. Slows the task: zero-count tiles are as large and as clickable as tiles with work in them; the hint under "Teardowns to approve" says "Two findings, ready to send" when there are none. At 390 the six tiles fill 1,000px before anything else.
3. Slows the task: the campaign table uses codes as names and shows an impossible "300%" reply rate without comment (data, see BACKEND-REQUESTS.md).
4. Looks unfinished: the stage strip ("Where everyone is") truncates its own labels at 390 ("RESEARCHI").
5. Polish: to-do project tags are cut mid-word ("Kaveri storefront rebu") in a monospace font.

### 3.2 Review emails (`review.*`)

1. Slows the task: the email (the thing being judged) sits right; the evidence column is three screens long, so at 1024 and below the draft is pushed under all of it and the decision buttons are far from the evidence.
2. Slows the task: the word count, which matters (over 120 words turns red), fails contrast (axe: serious) and sits in the corner.
3. Looks unfinished: keyboard hints are tiny bordered boxes with low contrast inside buttons (axe flagged them on the wiki editor too).
4. Polish: "Full profile →" arrow; campaign code tag.

### 3.3 Inbox (`inbox.*`)

1. Slows the task: the next step is written in the AI's words ("Generate two-point teardown for human approval.") rather than as an instruction.
2. Slows the task: two equal-weight orange things (the classification tag and the primary button).
3. Looks unfinished: `HIGH priority`, `For rahul` (a username), and the time stamp in the selected row fails contrast (axe: serious).
4. Polish: "Profile →".

### 3.4 Projects, My tasks and the board (`projects.*`, `my-tasks.*`, `project-board.*`, `task-drawer.*`)

1. Blocks the task (1024 and below): the board's fourth column (Done) is off screen with no cue; at 390 the reader sees one and a quarter columns and cannot tell there are four.
2. Slows the task: moving a card means drag and drop or opening the drawer; there is no keyboard way to move a card from the board itself.
3. Slows the task: the drawer is a dialog in name only: focus does not move into it, Tab escapes behind it, and closing does not return focus to the card.
4. Looks unfinished: deleting a task is a native `confirm()`.
5. Polish: project header controls (status, owner, due) wrap under the title at 1024 and look like a form.

### 3.5 Chat (`chat.*`)

1. Slows the task: at 390 the channel list and the conversation are stacked, so the message box is below a 150px list and the conversation gets very little height.
2. Looks unfinished: the send button is a disabled brown square until something is typed; edit and delete only appear on hover (not discoverable on touch); delete is a native `confirm()`.
3. Polish: channel and direct-message section labels are all-caps mono.

### 3.6 Pipeline and prospect profile (`pipeline.*`, `prospect.*`)

1. Slows the task: the table is wider than the page at 1440 (Updated is clipped) and much wider at 768. The person column, which is what most rows are waiting on, is off screen at 768.
2. Slows the task: four of eight rows carry a solid orange tag; "Awaiting review", "Replied" and "Proposal" all look the same.
3. Looks unfinished: the profile's back link is a button ("← Pipeline") above the title rather than a breadcrumb.

### 3.7 CRM (`crm-*.*`)

1. Blocks the task: marking a deal lost uses `prompt()`; leaving it empty silently cancels the change.
2. Slows the task: the company header's two buttons are both visually primary-ish; "Open a deal" disappears once one is open, with no explanation.
3. Looks unfinished: activity reads `qualified · system`, `created · n8n`; location reads `Mysuru, IN`.

### 3.8 Find companies (`find.*`)

1. Slows the task: the quota badge (`0 of 100 searches today · mock`) and "Pages: 2 · 20" are cryptic.
2. Looks unfinished: the source column shows the adapter name (`mock`, `serper`).

### 3.9 Meetings and deals (`deals.*`)

1. Slows the task: the empty "Coming up" card is 280px tall and sits above the content that exists.
2. Looks unfinished: proposal status shows as lower-case `draft`; the investment placeholder shouts "TO BE CONFIRMED BY FOUNDERS".

### 3.10 Wiki (`wiki*.*`)

1. Blocks the task (screen reader and keyboard users): the delete button has no name (axe: critical; Lighthouse 94).
2. Looks unfinished: leaving the editor with changes uses `confirm()`; restoring a version has no confirmation at all.
3. Polish: heading order skips a level on the history page (Lighthouse).

### 3.11 People (`people*.*`, `person*.*`)

1. Looks unfinished: cancelling leave and removing a pay record use `confirm()`; empty values show as "·".
2. Polish: the member's own profile is half empty at 1440; leave status tags are solid orange.

### 3.12 Campaigns (`campaigns.*`)

1. Slows the task: six identical cards, each led by a code; null rates show as a bullet ("Reply rate •"); six identical solid "Keep going" tags.
2. Looks unfinished: developer instruction ("defined in core/config/campaigns.json") in the interface.

### 3.13 Team, account, sign in (`team.*`, `account.*`, `login.*`)

1. Looks unfinished: switching someone off uses `confirm()`; the role select sits inside the table with no label of its own beyond the column.
2. Looks unfinished: the sign-in page's orange radial glow; the tagline in all-caps mono.

## 4. Ranking (sets the build order)

| Rank | Screen | Used | Cost of confusion |
|---|---|---|---|
| 1 | Today | Every session, both people | It decides what gets done first. |
| 2 | Review emails | Every draft | A wrong approval sends a cold email that cannot be taken back. |
| 3 | Inbox | Daily, time-sensitive | A missed or mishandled reply loses a deal. |
| 4 | Projects, My tasks, board, task drawer | Many times a day | The two founders' shared to-do list. |
| 5 | Chat | All day | Constant, but low cost per mistake. |
| 6 | Pipeline, prospect | Daily | Mostly reading; the blocker (a named person) must be obvious. |
| 7 | CRM, company | Several times a week | Notes and deal value feed decisions. |
| 8 | Find companies | Weekly | Spends search quota. |
| 9 | Meetings and deals | Per call | Low frequency, high stakes per use. |
| 10 | Wiki | Weekly | Reading mostly. |
| 11 | People, leave, person | Monthly | Pay is sensitive; leave is occasional. |
| 12 | Campaigns, do not contact | Weekly | Reading; the do-not-contact add is rare but important. |
| 13 | Team, account, sign in | Rare | Setup. |

## 5. Automated accessibility before

axe-core 4.10 (WCAG 2.0 to 2.2 A and AA rules) at 1440, dark, on 35 screen and role combinations: **1 critical, 3 serious**.

| Impact | Rule | Screen | Element |
|---|---|---|---|
| critical | button-name | wiki page | the delete (bin) button |
| serious | color-contrast | review | the word count |
| serious | color-contrast | inbox | the time stamp in the selected reply |
| serious | color-contrast | wiki editor | the keyboard hint in the Save button |

Lighthouse 12.8 accessibility, desktop, admin: **average 99.2, lowest 94** (wiki page). Under 100: review 96, inbox 96,
wiki editor 96, projects 98, wiki history 98, task drawer 99. Full results in `ui-ux-audit/a11y-before.json`.

Neither tool checks focus management in the drawer, the native dialogs, the hidden mobile navigation, or colour used
as the only signal; those are covered by the cross-cutting findings above.

## 6. Bundle before

Production build (`npm run build` in `core/web`): JavaScript 400.83 kB (115.61 kB gzip), CSS 36.70 kB (7.34 kB gzip).
