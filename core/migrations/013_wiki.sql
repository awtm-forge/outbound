-- Wiki: categories, page metadata (icon, summary, category, order, archive, templates), structured editor content
-- alongside the existing Markdown body, stars, per-person quick links, comments, deduplicated page views, and files.
-- Additive: every existing page keeps its Markdown body and history; the editor converts it the first time it is saved.
create table wiki_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(name) between 1 and 60),
  icon text,
  color text check (color is null or color ~ '^#[0-9A-F]{6}$'),
  position double precision not null default 0,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
insert into wiki_categories(name, icon, color, position) values
  ('Getting Started', 'rocket', '#3B82F6', 1), ('Processes', 'layers', '#F43F5E', 2), ('Sales & Outreach', 'send', '#22C55E', 3),
  ('Client Delivery', 'handshake', '#F59E0B', 4), ('Internal Docs', 'file', '#A855F7', 5), ('Tools & Integrations', 'settings', '#FF922E', 6), ('Team', 'people', '#06B6D4', 7);

alter table wiki_pages
  add column category_id uuid references wiki_categories(id) on delete set null,
  add column icon text,
  add column description text not null default '' check (length(description) <= 300),
  add column content jsonb,                                   -- editor document; null until the page is first saved in the editor
  add column position double precision not null default 0,
  add column archived_at timestamptz,
  add column is_template boolean not null default false;
update wiki_pages set position = extract(epoch from created_at);
create index wiki_pages_tree_idx on wiki_pages(parent_id, position);
create index wiki_pages_category_idx on wiki_pages(category_id) where archived_at is null;
alter table wiki_revisions add column content jsonb;

create table wiki_stars (
  page_id uuid not null references wiki_pages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (page_id, user_id)
);
create table wiki_quick_links (
  user_id uuid not null references users(id) on delete cascade,
  page_id uuid not null references wiki_pages(id) on delete cascade,
  position int not null default 0,
  primary key (user_id, page_id)
);
create table wiki_comments (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references wiki_pages(id) on delete cascade,
  author_id uuid references users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
create index wiki_comments_idx on wiki_comments(page_id, created_at);
-- one view per person per page per day, so refreshing does not inflate the count
create table wiki_views (
  page_id uuid not null references wiki_pages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  day date not null,
  primary key (page_id, user_id, day)
);
create index wiki_views_day_idx on wiki_views(day);

-- files can belong to a wiki page instead of a project
alter table project_files alter column project_id drop not null,
  add column wiki_page_id uuid references wiki_pages(id) on delete cascade,
  add constraint project_files_owner check (project_id is not null or wiki_page_id is not null);
create index project_files_wiki_idx on project_files(wiki_page_id) where wiki_page_id is not null;
create index if not exists activities_wiki_idx on activities(created_at desc) where entity_type = 'wiki';
