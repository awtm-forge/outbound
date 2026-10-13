# Project skills

Claude Code loads every folder here as a skill for sessions in this repository. Four are copied unchanged from their
upstream repositories; three are written for this repository because no official skill exists.

| Skill | Use it for | Source | Licence |
|---|---|---|---|
| `design-taste-frontend` | Art direction and a no-slop house style for landing and marketing pages; a real-browser inspector and a look-and-fix loop | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) `skills/taste-skill` at `c924fad` | MIT |
| `image-to-code` | Generate reference images first, analyse them, then build the page to match | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) `skills/image-to-code-skill` at `c924fad` | MIT |
| `web-design-guidelines` | Review UI code against Vercel's Web Interface Guidelines, output as `file:line` findings | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) `skills/web-design-guidelines` at `063bee9` | MIT (stated in the upstream README) |
| `playwright-cli` | Drive a browser from the shell: snapshots, clicks, screenshots, tracing, test generation | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) `skills/playwright-cli` at `b85c7a7` | Apache 2.0 |
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
- `awesome-design-md` fetches one DESIGN.md at a time into `.design-md/` (git-ignored).

## Fit with this app

`design-taste-frontend` and `image-to-code` are written for public marketing pages and say so; the ops app is a
work tool. Use them for a landing page or the sign-in screen, and use `web-design-guidelines`, `playwright-cli` and
the house rules in `ui-ux-audit/DESIGN-PLAN.md` (UI pass, awtm-forge/outbound#1) for the app's screens.
`image-to-code` assumes an image generation tool, which Claude Code does not have by default.

## Updating

Re-copy the upstream folder at a newer commit, read the diff before committing (skills are instructions that future
sessions follow), and update the commit in the table above.
