# Project skills

Claude Code loads every folder here as a skill for sessions in this repository. Eleven are copied unchanged from their
upstream repositories; three are written for this repository because no official skill exists.

| Skill | Use it for | Source | Licence |
|---|---|---|---|
| `design-taste-frontend` | Art direction and a no-slop house style for landing and marketing pages; a real-browser inspector and a look-and-fix loop | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) `skills/taste-skill` at `c924fad` | MIT |
| `image-to-code` | Generate reference images first, analyse them, then build the page to match | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) `skills/image-to-code-skill` at `c924fad` | MIT |
| `web-design-guidelines` | Review UI code against Vercel's Web Interface Guidelines, output as `file:line` findings | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) `skills/web-design-guidelines` at `063bee9` | MIT (stated in the upstream README) |
| `playwright-cli` | Drive a browser from the shell: snapshots, clicks, screenshots, tracing, test generation | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) `skills/playwright-cli` at `b85c7a7` | Apache 2.0 |
| `frontend-design` | Anthropic's guidance for intentional visual design: a short token plan, a check against generic defaults, then build and critique | [anthropics/skills](https://github.com/anthropics/skills) `skills/frontend-design` at `dbd4588` | Apache 2.0 |
| `webapp-testing` | Python Playwright scripts against a local app, with a helper that starts and stops the servers | [anthropics/skills](https://github.com/anthropics/skills) `skills/webapp-testing` at `dbd4588` | Apache 2.0 |
| `redesign-existing-projects` | Audit an existing UI for generic patterns and missing states, then upgrade it in place without breaking behaviour | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) `skills/redesign-skill` at `c924fad` | MIT |
| `minimalist-ui` | A warm-monochrome, editorial, document-style look (Notion-like) | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) `skills/minimalist-skill` at `c924fad` | MIT |
| `vercel-react-best-practices` | 70 React performance rules: re-renders, bundle size, rendering, waterfalls | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) `skills/react-best-practices` at `063bee9` | MIT |
| `vercel-composition-patterns` | React component API patterns: compound components, no boolean-prop sprawl, React 19 changes | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) `skills/composition-patterns` at `063bee9` | MIT |
| `writing-guidelines` | Review prose and interface copy against Vercel's writing handbook | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) `skills/writing-guidelines` at `063bee9` | MIT (stated in the upstream README) |
| `awesome-design-md` | Use a published DESIGN.md (Linear, Stripe, Vercel and 80 more) as a reference, mapped onto this app's tokens | Written here; files fetched from [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) at `c7c1bad` | Collection: MIT |
| `motion-primitives` | Animated components from [Motion Primitives](https://motion-primitives.com), ported to CSS for this app by default | Written here; components from [ibelick/motion-primitives](https://github.com/ibelick/motion-primitives) | Components: MIT |
| `haikei` | Haikei-style SVG waves, blobs and peaks, hand-written or exported from [haikei.app](https://haikei.app) | Written here | |

## What they can do on their own

- `playwright-cli` pre-approves its own commands (`playwright-cli`, `npx playwright`) in its front matter. The CLI is
  not installed in this repo; its install step (`npm install -g @playwright/cli@latest`) still asks first.
- `web-design-guidelines` fetches its rules from GitHub at run time
  (`raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`).
- `design-taste-frontend` ships Node scripts. `inspect.mjs` launches a headless Chrome over the DevTools protocol;
  `assets.mjs` searches public image archives (Openverse, Wikimedia Commons, the Art Institute of Chicago, the Met,
  the Internet Archive, NASA) and downloads what you pick; `draw.mjs` keeps a small history in
  `~/.taste-skill/`. Working files go to `.taste-skill/`, which is git-ignored. None of them need keys or install
  anything.
- `writing-guidelines` also fetches its rules from GitHub at run time
  (`raw.githubusercontent.com/vercel-labs/writing-guidelines/main/command.md`).
- `webapp-testing` runs `scripts/with_server.py`, which starts whatever server commands it is given (with a shell)
  and stops them afterwards. It needs Python with the `playwright` package.
- `awesome-design-md` fetches one DESIGN.md at a time into `.design-md/` (git-ignored).

## Which to reach for

| Task | Skills |
|---|---|
| Improve an existing screen in the ops app | `redesign-existing-projects` to audit, `frontend-design` for direction, `web-design-guidelines` to review the result |
| A new public page (landing, marketing, the sign-in screen) | `design-taste-frontend`, `frontend-design`, `image-to-code` (needs an image tool), `awesome-design-md` for references, `haikei` for background shapes |
| Interface copy, labels, empty states, errors | `writing-guidelines`, plus the writing section of `frontend-design` |
| React component structure and speed | `vercel-composition-patterns`, `vercel-react-best-practices` |
| Animation | `motion-primitives` |
| See it working, screenshots, UI tests | `playwright-cli` or `webapp-testing` |

## House rules win

The ops app (`core/web`) has its own design system and rules from the UI pass (awtm-forge/outbound#1):
`core/web/src/design/tokens.css` and `ui-ux-audit/DESIGN-PLAN.md`. Where a skill's taste disagrees with them, the
house rules win for app screens. The disagreements to watch for:

- **Motion.** The app uses 150 to 250 ms, only to explain a change, with reduced-motion support. `minimalist-ui`
  (600 ms scroll entries, ambient blobs), `redesign-existing-projects` (smooth scroll, spring physics) and
  `design-taste-frontend` (a required motion layer of eight or more moving elements) are tuned for marketing pages.
- **Copy and labels.** Sentence case and no em dashes in UI copy. `minimalist-ui` asks for uppercase tracked badges;
  do not use them here.
- **Texture and imagery.** Grain overlays, picsum placeholders and decorative background photos suggested by
  `redesign-existing-projects` and `minimalist-ui` do not belong on working screens.
- **Fonts.** The app self-hosts Bricolage Grotesque and IBM Plex Mono; skills that suggest Geist, Satoshi or a serif
  pairing are for new public pages, not a swap here.
- **Data and network.** `vercel-react-best-practices` includes data-fetching rules (SWR, request deduplication,
  Next.js server patterns). The UI pass treats what the frontend fetches, and when, as fixed; changing it is a
  backend-contract change and needs its own review. Its re-render and bundle rules apply freely.
- **Tools.** `design-taste-frontend` and `image-to-code` are built for public pages and say so; the ops app is a
  work tool. `image-to-code` assumes an image generation tool, which Claude Code does not have by default.

## Updating

Re-copy the upstream folder at a newer commit, read the diff before committing (skills are instructions that future
sessions follow), and update the commit in the table above.
