-- The project workspace: a colour per project, board columns, richer tasks (subtasks, dependencies, labels, dates,
-- effort), milestones, links, saved views, notes pages with revisions and backlinks, files, and notifications.
-- Additive only: every existing project and task keeps its data, and the board columns are created from the
-- statuses tasks already have. Access stays as before: everyone signed in sees every project.

-- ---------- projects ----------
-- the project's own accent, as #RRGGBB; null means the theme's orange
alter table projects add column color text check (color ~ '^#[0-9A-F]{6}$');
create table project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  added_by uuid references users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
insert into project_members(project_id, user_id) select id, owner_id from projects where owner_id is not null on conflict do nothing;
insert into project_members(project_id, user_id) select distinct project_id, assignee_id from tasks where project_id is not null and assignee_id is not null on conflict do nothing;
create table project_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  url text not null check (url ~* '^https?://'),
  position double precision not null default 0,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index project_links_idx on project_links(project_id, position);

-- ---------- board columns ----------
-- every column belongs to one of the four statuses, so a task's status stays true everywhere (Today, My tasks)
-- whichever column it sits in; a project can have several columns per status
create table board_columns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  status text not null check (status in ('TODO','DOING','REVIEW','DONE')),
  position double precision not null default 0,
  wip_limit int check (wip_limit is null or wip_limit > 0),
  created_at timestamptz not null default now()
);
create index board_columns_idx on board_columns(project_id, position);
insert into board_columns(project_id, name, status, position)
  select p.id, c.name, c.status, c.pos from projects p cross join (values ('To do','TODO',1), ('In progress','DOING',2), ('In review','REVIEW',3), ('Done','DONE',4)) c(name, status, pos);

-- ---------- milestones ----------
create table milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  description text not null default '',
  target_date date,
  owner_id uuid references users(id) on delete set null,
  status text not null default 'OPEN' check (status in ('OPEN','DONE')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index milestones_idx on milestones(project_id, target_date);
create trigger milestones_updated before update on milestones for each row execute function set_updated_at();

-- ---------- tasks ----------
alter table tasks
  add column column_id uuid references board_columns(id) on delete set null,
  add column position double precision not null default 0,
  add column start_date date,
  add column parent_id uuid references tasks(id) on delete cascade,
  add column milestone_id uuid references milestones(id) on delete set null,
  add column labels text[] not null default '{}',
  add column estimate_hours numeric(6,1) check (estimate_hours is null or estimate_hours >= 0),
  add column actual_hours numeric(6,1) check (actual_hours is null or actual_hours >= 0),
  add column archived_at timestamptz;
update tasks t set column_id = c.id from board_columns c where c.project_id = t.project_id and c.status = t.status;
update tasks set position = extract(epoch from created_at);
create index tasks_column_idx on tasks(column_id, position);
create index tasks_parent_idx on tasks(parent_id) where parent_id is not null;
create table task_collaborators (
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key (task_id, user_id)
);
-- task_id is blocked by (or related to) depends_on_id
create table task_dependencies (
  task_id uuid not null references tasks(id) on delete cascade,
  depends_on_id uuid not null references tasks(id) on delete cascade,
  kind text not null default 'BLOCKS' check (kind in ('BLOCKS','RELATES')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_id),
  check (task_id <> depends_on_id)
);
create index task_dependencies_rev_idx on task_dependencies(depends_on_id);
alter table task_comments add column edited_at timestamptz;

-- ---------- saved views over the same task records ----------
create table project_views (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,   -- null: shared with everyone on the project
  name text not null check (length(name) between 1 and 60),
  layout text not null default 'list' check (layout in ('list','board','timeline')),
  config jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index project_views_idx on project_views(project_id);

-- ---------- notes: pages in a tree, content as editor JSON ----------
create table pages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  parent_id uuid references pages(id) on delete cascade,
  title text not null default '',
  icon text,
  content jsonb not null default '{"type":"doc","content":[]}',
  text_content text not null default '',                     -- plain text of the content, for search
  position double precision not null default 0,
  version int not null default 1,
  archived_at timestamptz,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(text_content,''))) stored
);
create index pages_tree_idx on pages(project_id, parent_id, position);
create index pages_search_idx on pages using gin(search);
create trigger pages_updated before update on pages for each row execute function set_updated_at();
create table page_revisions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  version int not null,
  title text not null,
  content jsonb not null,
  author_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (page_id, version)
);
create table page_stars (
  page_id uuid not null references pages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (page_id, user_id)
);
-- links found in a page's content, rebuilt on every save: other pages (backlinks) and tasks
create table page_links (
  from_page uuid not null references pages(id) on delete cascade,
  to_page uuid not null references pages(id) on delete cascade,
  primary key (from_page, to_page)
);
create index page_links_to_idx on page_links(to_page);
create table page_task_refs (
  page_id uuid not null references pages(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  primary key (page_id, task_id)
);
create table page_comments (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  author_id uuid references users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
create index page_comments_idx on page_comments(page_id, created_at);

-- ---------- files ----------
-- No object storage is configured, so the bytes live in their own table (never selected with the list) with a size cap.
create table project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  page_id uuid references pages(id) on delete set null,
  name text not null check (length(name) between 1 and 200),
  mime text not null,
  size int not null check (size > 0),
  uploaded_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index project_files_idx on project_files(project_id, created_at desc);
create index project_files_task_idx on project_files(task_id) where task_id is not null;
create table file_blobs (
  file_id uuid primary key references project_files(id) on delete cascade,
  data bytea not null
);

-- ---------- notifications ----------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  kind text not null,                                         -- task_assigned, mentioned
  title text not null,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_idx on notifications(user_id, created_at desc);
create index notifications_unread_idx on notifications(user_id) where read_at is null;

-- project events go on the existing activities table, against the project, so one index serves the timeline
create index if not exists activities_project_idx on activities(entity_id, created_at desc) where entity_type = 'project';
