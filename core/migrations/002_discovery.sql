-- Prospect discovery: searches, candidate companies found on the web, and the daily source quota.
create table discovery_searches (
  id uuid primary key default gen_random_uuid(),
  query jsonb not null,                           -- {industry, location, technology, keywords, pages}
  query_hash text not null,
  source text not null,                           -- google_cse | apify | saleshandy | mock
  status text not null default 'RUNNING' check (status in ('RUNNING','DONE','FAILED')),
  result_count int not null default 0,
  error text,
  actor text not null default 'system',
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index discovery_searches_hash_idx on discovery_searches(query_hash, source, created_at desc);

create table discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  url text not null,
  title text, snippet text,
  platform text,
  platform_signals text[] not null default '{}',
  emails text[] not null default '{}',
  phones text[] not null default '{}',
  gstin text,
  linkedin_url text, instagram_url text, facebook_url text,
  country_guess text,
  size_estimate text not null default 'UNKNOWN',
  signals jsonb not null default '{}',            -- snapshot summary: title, h1, trust signals, word count, forms
  status text not null default 'NEW' check (status in ('NEW','ADDED','IGNORED')),
  company_id uuid references companies(id),
  enriched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger discovery_candidates_updated before update on discovery_candidates for each row execute function set_updated_at();

create table discovery_search_candidates (
  search_id uuid not null references discovery_searches(id) on delete cascade,
  candidate_id uuid not null references discovery_candidates(id) on delete cascade,
  rank int not null,
  primary key (search_id, candidate_id)
);

create table source_calls (
  source text not null, day date not null default current_date, n int not null default 0,
  primary key (source, day)
);
