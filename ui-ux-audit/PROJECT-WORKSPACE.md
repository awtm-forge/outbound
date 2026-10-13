# Project workspace: what is built, what is not

## Built and tested
- **Per-project colour.**
  - Stored in `projects.color` (migration 011). It is validated as a hex value, and null means the theme orange.
  - It can be set from the card, New project, the workspace header and Settings.
  - All tints are derived from that one value through `--pa`, `--pa-rgb`, `--pa-text` and `--pa-ink` (`ui/color.tsx`). Status colours never change with the project.
- **Workspace tabs:** Overview, Board, List, Timeline, Notes, Files, Activity and Settings, at `/projects/:id/:view`.
- **Board:**
  - Custom columns, each tied to a status. Work-in-progress limits.
  - Drag and drop, plus Alt and the arrow keys as the keyboard alternative.
  - Filters, sort and compact cards.
- **List:**
  - Inline edits, multi-filters, grouping, and multi-sort with Shift and a click.
  - Column picker with show, hide, reorder and resize.
  - Saved views, personal or shared, over the same tasks.
  - Bulk actions with a confirm before delete, CSV export and pagination.
- **Tasks:**
  - Subtasks and dependencies. Loops are refused by the server.
  - Labels, collaborators, start date, effort and milestone.
  - Comments that can be edited and deleted, files on the task, and the task's own activity.
- **Timeline:**
  - Day, week and month views, milestones, dependency lines and a today line.
  - Rescheduling by drag or the keyboard. Tasks without dates are listed separately.
- **Notes:**
  - A page tree you can nest, move, star, archive, restore and delete.
  - Ten templates.
  - TipTap editor with slash commands, @mentions (the person is notified), page and task references, backlinks, callouts, toggles, tables, code, images, files, bookmarks and a table of contents.
  - Block drag handle, plus Alt+Shift with Up or Down to move a block.
  - Autosave that shows "Saved" only after the server confirms. A save based on an old version is refused with a 409 and the choice is offered.
  - Version history with restore. Page comments.
- **Files:**
  - Upload of up to 10 MB with the type and first bytes checked.
  - Download only when signed in. Previews for images, PDFs, text and mp4. Anything that could run in a browser is served as a download in a sandbox.
- **Activity:** every project event on the existing `activities` table, filterable by kind and person.
- **Notifications:** for a task given to you and for @mentions, shown in the bell.
- **Tests:**
  - `core/test/workspace.test.ts`, run with the rest of the server suite.
  - A browser walk-through of every flow against a throwaway database.
  - axe: no serious or critical findings on the workspace screens at 1440 and 390.

## Not built yet
- **Project databases** (bug tracker, decision log and so on) with custom properties and calendar views. Today only the task database has views.
- **Equations in notes.** The math extension needs KaTeX, whose current release has an open advisory and no fix compatible with TipTap 3.32, so it was left out.
- **Live co-editing.** Saves are conflict-safe: a newer version is never overwritten silently. Live cursors would need a sync server.
- **Page cover images.**
- **Reminders** before a due date. Notifications cover assignments and mentions only.
- **Project search from the global command palette.** `GET /api/projects/:id/search` exists; the palette only has New project.

## Decisions for you
- **File storage.** No object storage is configured, so file bytes are kept in Postgres (`file_blobs`), capped at 10 MB each. On Neon that counts toward database storage. Moving to S3 or R2 later only changes `routes/files.ts`.
- **Access.**
  - As before, everyone signed in can open every project. The project team is who works on it, not who may see it.
  - Pages and files can be deleted only by their maker or an admin.
- **Database migration 011** is additive only. It runs on its own at the next start of the core, like every migration.
