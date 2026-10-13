# Network contract

`before/` is the baseline recorded from `main` at 8839af6; `after/` is the same flows replayed on the `ui-ux-pass`
build. Each file is one user flow (19 flows, 86 steps, 53 mutations). For every step it lists:

- `writes`: every non-GET request, in order, as `METHOD /path?query {body field names}`
- `reads`: the set of GET requests the step triggered
- `background` (per flow): reads driven by timers or the chat long-poll (`/api/me`, `/api/overview`,
  `/api/chat/poll`, `/api/chat/channels`, `/api/jobs/:id`), compared as a set because their count depends on time

Ids are normalised to `:id`, numbers in paths to `:n`, numeric query values to `#`.

How it was run (scripts in `ui-ux-audit/tools/`): a fixture database made through the app's own API
(`fixtures.mjs`), copied fresh before every run, the core on port 8099 with mock AI and mock sending, and
`flows.mjs` driving Chromium. `diff.mjs before after` exits non-zero on any difference in method, path, query, body
field names, mutation order or the set of reads. Running the baseline twice gave no differences, so the harness is
deterministic.

**One harness change during the pass.** The first after run showed one extra `POST /api/chat/channels/:id/read` in
the chat "delete own" step. `tools/chatcheck.mjs` showed both builds send exactly that request once the live feed
delivers the deletion; the old build had simply moved on to the next step before the feed arrived. The step now
waits 6 seconds for the feed to settle, and both `before/` (served from the `main` build) and `after/` were
re-recorded with the same harness. Result: `19 flows, 86 steps, 53 mutations compared: no differences`.
