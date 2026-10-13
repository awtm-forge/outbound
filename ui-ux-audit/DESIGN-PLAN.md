# Design plan

Written before any code changed. It keeps the brand the portal already set (Bricolage Grotesque, IBM Plex Mono, the
warm charcoal dark theme, the ember accent) and fixes what fails contrast or consistency. It adds a light theme in the
brief's direction: cool grey paper, charcoal ink, burnt orange.

Everything here is presentation. No request, response or timing changes.

## 1. Colour

### Base values

| Name | Light | Dark | Role |
|---|---|---|---|
| Paper | `#eff1f3` | `#141110` | The page. Cool grey in light; the portal's warm charcoal in dark. |
| Charcoal | `#1c2024` | `#ede7dc` | Ink: the text people read. |
| Ember | `#c2410c` | `#e08536` | The accent. Primary action and current location only. |
| Moss | `#1f6b43` | `#7cc49a` | Done, approved, won, verified. |
| Amber | `#8a5300` | `#e5b35c` | Waiting on someone, due today, needs a person. |
| Brick | `#b42318` | `#f0907a` | Late, failed, lost, do not contact, destructive. |

A seventh, Slate (`#2c5a85` light, `#9fb3c8` dark), is reserved for neutral information that must still stand apart
from body text (in progress). It is used in exactly one component, the status badge.

### Semantic tokens

`--ground` page, `--surface` panels and tables, `--raised` rows and inputs that sit on a panel, `--sunken` wells
(quotes, code), `--border` hairlines between things, `--control` the outline of anything you can type into or tick,
`--ink`, `--ink-muted`, `--ink-faint` (three text levels, no fourth), `--accent`, `--accent-text` (the accent when it
is text), `--on-accent` (text on an accent fill), `--focus`, and `--success`, `--warning`, `--danger`, `--info`, each
with a `-bg` partner for badges.

### Contrast, checked

Every pair the components use was computed (script and full table: `ui-ux-audit/tools/contrast.mjs`,
`ui-ux-audit/contrast.txt`). Lowest ratio per pair across the three backgrounds:

| Pair | Light | Dark | Needs |
|---|---|---|---|
| Ink | 14.47 | 13.56 | 4.5 |
| Muted text | 7.00 | 7.16 | 4.5 |
| Faint text | 5.07 | 5.26 | 4.5 |
| Accent as text | 5.23 | 7.02 | 4.5 |
| Text on the accent button | 5.18 | 6.79 | 4.5 |
| Success, warning, danger, info as text | 5.59 and up | 7.13 and up | 4.5 |
| The same inside their badges | 5.61 and up | 7.02 and up | 4.5 |
| Control outline against its background | 3.01 | 3.26 | 3 |
| Focus ring | 4.57 | 7.02 | 3 |

What changed from the current dark tokens and why: faint text was `#8a7f72` (4.26:1 on raised panels, the axe
failures on Review and Inbox), now `#9a8f82`; muted text nudged to `#b4a89a`; inputs had no distinguishable
outline (the hairline was 1.31:1 against the page), now they get `--control` at 3.26:1. The ground, surfaces,
ink and ember are unchanged.

### Where the accent is allowed

1. The one primary button on a view.
2. The current navigation item (a 2px bar, not a fill) and the active tab underline.
3. Focus rings.
4. Links inside prose (wiki, chat), as text.

Not allowed: status badges, priority, counts in navigation (they become ink on a neutral pill; only the count that
is "waiting on you" in Review and Inbox keeps a filled accent dot), eyebrows, campaign labels, recommendations.

### Status is text plus colour

Every status badge is a word with a small coloured dot or tinted background, never colour alone:
neutral (New, Researching, To do), info (Doing, Contacted, Proposal), warning (Awaiting review, Waiting, Due today,
Needs a person), success (Approved, Won, Done, Verified), danger (Late, Lost, Rejected, Do not contact).

### Themes

`<html data-theme="light|dark">`; without the attribute the theme follows the operating system. A small same-origin
script (`public/theme-init.js`, allowed by the existing CSP) sets the attribute before first paint so there is no
flash. The choice (System, Light, Dark) is a control in the sidebar footer and on Your account, stored in
`localStorage` only. No request is involved.

## 2. Type

| Role | Family | Size / line height | Weight | Notes |
|---|---|---|---|---|
| Page title | Bricolage Grotesque | 26 / 32 (22 / 28 under 768) | 650 | Tracking -0.015em. One per page. |
| Section title | Bricolage | 17 / 24 | 620 | Sentence case. Replaces the all-caps eyebrows. |
| Body | Bricolage | 14.5 / 22 | 400 | Prose (wiki, email drafts) at 15 / 24, max 72ch. |
| Label | Bricolage | 13 / 18 | 550 | Visible form labels, table headers, key-value keys. Sentence case, muted ink. |
| Small | Bricolage | 12.5 / 18 | 450 | Helper text, timestamps, secondary cells. Faint ink. |
| Numbers | Bricolage | as context | as context | `font-variant-numeric: tabular-nums` everywhere data is shown. Bricolage supports it (measured: "1111" and "0000" set at equal width). |
| Code | IBM Plex Mono | 12.5 / 18 | 450 | Keyboard hints, domains in tables, ids. Nothing else. |

All-caps is removed from labels, headers and eyebrows. The only uppercase left is the brand mark.

## 3. Spacing and layout

Spacing scale (px): 2, 4, 8, 12, 16, 20, 24, 32, 40, 56. Nothing in between.

Layout: a 232px sidebar and a fluid content column with 32px gutters (16px under 768). Content width by kind:
reading pages (wiki, account, person) 760px; work pages (review, inbox, chat, board) full width up to 1360px;
tables full width with a sticky header and a sticky first column.

Density:

- Tables: 40px rows, 8px vertical / 12px horizontal cell padding, header 32px.
- Lists (inbox, chat channels, to-dos): 36 to 44px rows.
- Forms: 16px between fields, 24px between groups, labels 6px above the control, helper text 4px below.

Radius by hierarchy, not one everywhere:

| Radius | Used for |
|---|---|
| 4px | Buttons, inputs, selects, badges, keyboard hints |
| 6px | Rows that highlight (nav items, list items, menu items) |
| 8px | Panels, tables, the composer |
| 12px | Overlays: dialog, drawer edge, menu, command palette, toast |
| full | Avatars, counts, the theme switch |

Elevation: panels are separated by a 1px border and a surface step, never a shadow. Shadows exist only on things that
float above the page (dialog, drawer, menu, palette, toast).

## 4. Components

Built in `src/ui/`, reusing what exists. No new runtime dependency: everything below is a few dozen lines of React
on the existing stack, so the bundle should not grow meaningfully.

| Component | Today | Plan |
|---|---|---|
| Button | CSS classes `.btn`, `.primary`, `.ghost`, `.danger`, `.sm`, `.lg` | Keep the classes; add `secondary`, a pending state (spinner replaces the icon, label stays, `aria-busy`), disabled that reads as disabled (neutral, not faded orange), 32px default, 28px small, 40px large; touch 44px under 768. No arrows in labels. |
| Input, select, textarea, date | Ad hoc, labels as all-caps spans | `Field` wrapper: visible label, optional helper, inline error on blur using only rules already in the code (required, minLength, pattern, type), `aria-describedby`. |
| Checkbox | Native with accent colour | Native, 16px, 24px hit area. |
| File upload | None in the app | Not needed; not built. |
| Table | `.t` | Sticky header, sticky first column, tabular numbers, row hover, keyboard-reachable row link (the name is the link), stacked layout under 640px. |
| List row | Several | One `.row-item` pattern. |
| Card / panel | `.card` everywhere | Panel used for groups of fields and data only; tiles, notes and empty states get their own lighter treatments. |
| Badge | `.tag` with orange variants | `Badge` with tone (neutral, info, warning, success, danger), text plus a dot. |
| Tabs | `.tabs` buttons with `role=tab` | Proper tablist: arrow keys move, `aria-controls`, underline in accent. |
| Dialog | None (native `confirm`/`prompt`) | `ConfirmDialog`: names the thing ("Delete the task 'Gather the menu'?"), focus trapped and returned, Escape cancels, the destructive button is red and says the verb. Optional text field for "why it was lost", with the confirm disabled until filled. |
| Drawer | Task drawer, no focus management | Same component, made modal: focus moves in, is trapped, returns to the card. |
| Toast | Exists | Keep; success messages reuse the button's verb ("Add note" gives "Note added"). Errors keep the input. |
| Tooltip | `title` attributes | Keep `title` for icons that also have `aria-label`; no custom tooltip (not worth the code). |
| Menu | None | Not needed by any current flow; not built. |
| Empty state | `.empty` with a tick glyph | Plain: one line on what this is, one on how to fill it, the action if there is one. No glyph. Compact by default. |
| Skeleton | `Loading` rows of bars | Per-layout skeletons (table, list, detail) that match the final height, so there is no shift. |
| Page header | `.head` | `PageHeader`: breadcrumb (when nested), title, one-line description, actions on the right (one primary). |
| Breadcrumbs | "← Projects" links | Real breadcrumb nav (`nav aria-label="Breadcrumb"`), last item is the current page. |
| Sidebar navigation | Two groups, horizontal strip on phones | Same groups; on phones a top bar with the page name and a Menu button that opens the full navigation as a sheet. |
| Command palette | None | Yes: 19 routes across two sections justify it. Cmd+K or Ctrl+K opens a list of screens and a few actions (new to-do, new project, new wiki page). It filters the static list in the browser and fetches nothing. |

## 5. Principles

The screen should say what needs the operator before it says anything else, and then get out of the way: one primary
action per view, the rest quieter. Colour is spent only where it carries meaning, so that when something is orange it
is the next thing to do, and when something is red it is wrong. Nothing moves unless it is explaining a change, and
nothing is destroyed without naming what will go. The same words mean the same thing on every screen, and they are the
operator's words, not the database's.

## 6. Review against generic dashboards

I read the first draft of this plan against what makes AI-made dashboards look the same, and changed these:

1. **Identical rounded cards with a soft shadow.** The first draft used one 10px radius and a light shadow on every
   panel. Changed to a radius by hierarchy (section 3) and no shadows on anything that does not float. Today's tiles
   stop being cards altogether and become a single row of counts with dividers.
2. **Gradient washes.** The sign-in glow and the "hot tile" gradient are removed rather than restyled.
3. **All-caps eyebrows over every heading.** The current app has them on nearly every section. The draft kept them as
   "small caps labels"; removed entirely in favour of sentence-case section titles.
4. **Numbered markers on things that are not a sequence.** "Finding 1", "Finding 2" in teardowns are a sequence (the
   email refers to "two things"), so they stay; nothing else gets numbers.
5. **Arrows on button text.** Removed everywhere ("Open pipeline →" becomes the link "Open pipeline").
6. **Fade-up on every section.** The page-level rise animation is removed. Motion is kept only for the drawer and
   dialog opening (180ms), a toast arriving, and a to-do being ticked.
7. **Orange as decoration.** The draft still used ember for status badges; changed to the semantic tones above, with
   the accent kept for the primary action and the current location.
