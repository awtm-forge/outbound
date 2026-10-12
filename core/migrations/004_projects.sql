-- Workspace: projects and their tasks. Everyone signed in sees every project; the team is small.
create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ON_HOLD','DONE','ARCHIVED')),
  owner_id uuid references users(id) on delete set null,
  company_id uuid references companies(id) on delete set null,   -- the client, when it is client work
  due_date date,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'TODO' check (status in ('TODO','DOING','REVIEW','DONE')),
  priority text not null default 'MEDIUM' check (priority in ('LOW','MEDIUM','HIGH')),
  assignee_id uuid references users(id) on delete set null,
  due_date date,
  completed_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_project_idx on tasks(project_id, status);
create index tasks_assignee_idx on tasks(assignee_id) where status <> 'DONE';
create table task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  author_id uuid references users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
create index task_comments_task_idx on task_comments(task_id, created_at);
create trigger projects_updated before update on projects for each row execute function set_updated_at();
create trigger tasks_updated before update on tasks for each row execute function set_updated_at();
