-- Workspace: the wiki. Markdown pages, every save kept as a revision, slugs that never change on rename.
create table wiki_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  body text not null default '',
  parent_id uuid references wiki_pages(id) on delete set null,
  version int not null default 1,                -- a save names the version it started from; a mismatch is a conflict
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('simple', title || ' ' || body)) stored
);
create index wiki_pages_search_idx on wiki_pages using gin(search);
create index wiki_pages_parent_idx on wiki_pages(parent_id);
create trigger wiki_pages_updated before update on wiki_pages for each row execute function set_updated_at();
create table wiki_revisions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references wiki_pages(id) on delete cascade,
  version int not null,
  title text not null,
  body text not null,
  author_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (page_id, version)
);
