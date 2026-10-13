-- Project files: folders (nested, coloured), a description, versions when a file is replaced, and comments.
create table project_folders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  parent_id uuid references project_folders(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  color text check (color is null or color ~ '^#[0-9A-F]{6}$'),
  position double precision not null default 0,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index project_folders_idx on project_folders(project_id, parent_id, position);
alter table project_files add column folder_id uuid references project_folders(id) on delete set null,
  add column description text not null default '' check (length(description) <= 2000),
  add column version int not null default 1,
  add column updated_at timestamptz not null default now();
update project_files set updated_at = created_at;
create index project_files_folder_idx on project_files(folder_id) where folder_id is not null;
-- earlier versions of a replaced file, with their bytes; the current version stays in file_blobs
create table file_versions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references project_files(id) on delete cascade,
  version int not null,
  name text not null, mime text not null, size int not null,
  uploaded_by uuid references users(id) on delete set null,
  created_at timestamptz not null,
  data bytea not null,
  unique (file_id, version)
);
create table file_comments (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references project_files(id) on delete cascade,
  author_id uuid references users(id) on delete set null,
  body text not null check (length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index file_comments_idx on file_comments(file_id, created_at);
