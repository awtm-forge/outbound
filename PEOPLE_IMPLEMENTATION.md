# People: what is built, what is not

The People page sits on the HR records that already existed (`employees`, `leave_requests` and the admin-only
`employee_compensation`) and on the existing sign-ins (`users`). It adds no second user system and no second leave
system.

## Built and tested

**Header and cards.** Four cards, all counted from the records:
- **Team members:** everyone not marked as left. "+N this month" counts people whose start date (or, without one, the
  day they were added) falls in this month.
- **Active today:** people whose sign-in was used today. It is shown as a share of the people who have a sign-in. A
  directory-only person is never counted as active.
- **On leave:** approved leave that covers today, or someone marked On leave.
- **Departments:** the distinct department names in use.

Each card opens the matching view.

**Tabs.** Directory, Leave & availability and Org chart, with an orange underline. Switching tabs does not reload the
directory.

**Directory.**
- A table of real people: person (photo or initials, name, email), role, department, reports to, availability,
  location and an actions menu.
- Search covers name, email, title, department, location and skills. Filters cover department, availability and
  manager. There is an "Include former team members" checkbox.
- Paging at 25 rows. Up and Down move through the rows.
- On phones the filters fold away and the rows stack.

**Profile panel.**
- Fixed on the right on wide screens; a slide-over below 1280px.
- Shows photo, name, availability, title, location, employment type, email, phone and LinkedIn (each only when set),
  reports to, department, the people reporting to them, joined date, skills, assigned projects and upcoming leave.
- Actions: Message (opens or reuses the direct conversation in Chat), Edit profile, Copy email, Copy link, Full record,
  and Leave details.

**Add and edit.**
- Admins add a person in one of three ways:
  - Directory only, with no sign-in.
  - Linked to an existing sign-in that has no record yet.
  - With a new sign-in. The username is unique, the access level is member or admin, and the temporary password must
    be changed at first sign-in, exactly as on the Team page. The sign-in and the record are created in one
    transaction.
- Duplicate work emails, a sign-in already linked to someone, and taken usernames are refused with the clash named.
- A person may edit only their own phone, location, LinkedIn, skills and photo. Title, department, manager, status,
  dates and email are for admins. The server enforces this split with a 403, not only the form.
- Changing someone's access level goes through the existing `/api/users/:id` route, which keeps its last-admin guard.

**Skills.**
- Compact tags, added and removed from the profile or the form.
- Trimmed, no case-insensitive repeats, at most 30.
- Searchable from the directory.

**Photo.**
- PNG, JPEG or WebP under 2 MB, uploaded by the person or an admin.
- Stored like every other file (`project_files` and `file_blobs`). The old photo is deleted when it is replaced.

**Assigned projects.**
- From `project_members`, shown with each project's own saved colour (the theme orange when none is set), its status,
  Owner when they own it, and their open task count.
- Each one links to the project.

**Leave & availability.**
- Availability today for everyone.
- Today and upcoming approved leave, requests waiting for a decision, and the past year.
- A list or a month calendar. Waiting requests are drawn dashed.
- Filter by person.
- Ask for leave, cancel, and (admins) approve or decline, all through the existing `/api/hr/leave` endpoints.
- The kind and reason of leave are sent only to the person themselves and to admins. Everyone else sees names and
  days.

**Org chart.**
- Built only from "reports to". Branches expand and collapse, and clicking a card opens the profile.
- People with no manager and nobody reporting to them are listed under "No reporting line yet" instead of being placed
  somewhere.
- Loops are refused by the server, and the form already leaves out the person and everyone below them.

**Pay.** Pay is not on this page. It stays on the admin-only full record (`/people/:id`), and no People route reads
pay. A test checks that no response from these routes contains pay.

## Availability: what each state means

There is no live presence service. Each state is what the data can support:

| Shown | Meaning |
| --- | --- |
| Active now | AWTM Forge was open (any request) in the last 5 minutes |
| Active today | Used earlier today (India time) |
| Away / Seen 3h ago | Has a sign-in, not used today |
| Not signed in yet | Has a sign-in that has never been used |
| No sign-in | In the directory only, so nothing is claimed |
| On leave | Approved leave covers today, or marked On leave |
| Left | Marked as left |

**In a meeting** is not shown. Meetings are tied to opportunities, with no attendees and no end time, so it cannot be
known. Once Meetings & Deals records internal participants, it can be added from that data.

## Database (migration `014_people.sql`, additive)
- `users.last_seen_at`. It is written at most once a minute per person and never blocks a request (`lib/auth.ts`
  `touchSeen`).
- `employees.linkedin_url`: only LinkedIn addresses, normalised to `https://www.linkedin.com/...`.
- `employees.skills`: `text[]` with a GIN index.
- `employees.avatar_file_id`.
- `project_files.employee_id`: the photo's owner, with cascade on delete. The owner check now allows a project, a wiki
  page or a person.
- An index on `employees.manager_id`.

## API (`core/src/routes/people.ts`, registered before `hr.ts`)

| Route | Who | What |
| --- | --- | --- |
| `GET /api/people?former=1` | signed in | Directory rows with availability |
| `GET /api/people/summary` | signed in | Card numbers and departments |
| `GET /api/people/leave?from&to` | signed in | Today, upcoming, waiting, past and calendar; kind and reason only for self or admins |
| `GET /api/people/:id` | signed in | Profile with reports, projects and upcoming leave |
| `PATCH /api/people/:id` | self (contact and skills) or admin (everything) | Edit, with loop and duplicate checks; audited |
| `POST /api/people` | admin | Add, optionally with a new or linked sign-in; audited |
| `POST`/`DELETE /api/people/:id/avatar` | self or admin | Photo |

## Front end
- `core/web/src/pages/people/PeoplePage.tsx`: page, cards, tabs and directory.
- `core/web/src/pages/people/Profile.tsx`
- `core/web/src/pages/people/PersonForm.tsx`
- `core/web/src/pages/people/LeaveView.tsx`
- `core/web/src/pages/people/OrgChart.tsx`
- `core/web/src/pages/people/shared.tsx`
- `core/web/src/design/people.css`
- `core/web/src/pages/People.tsx` keeps the full record and the admin pay panel at `/people/:id`. Its Edit button now
  opens the same form.

## Tests
- `core/test/people.test.ts` covers:
  - Adding with a new sign-in, a linked one, or none.
  - Duplicates.
  - Self versus admin edits, with 403s.
  - LinkedIn validation, reporting loops and former members.
  - Projects with their colours.
  - Availability, including on leave and no sign-in.
  - Leave privacy, the summary numbers, and photo type, ownership and replacement.
- The existing `hr.test.ts` still passes, including its check that pay never leaks.
- Browser flows cover add, search by skill, edit, the full record with pay, the org chart, leave approval, and a member
  asking for and cancelling leave.

## Not built
- **In a meeting** status: there is no calendar or attendee data yet (see above).
- **Local time:** no time zone is stored per person, so none is shown.
- **Invitation emails:** the app sends no email for sign-ins. The admin hands over the username and temporary password,
  as on the Team page.
