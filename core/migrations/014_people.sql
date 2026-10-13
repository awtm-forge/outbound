-- People: what the directory adds on top of HR. Skills, a LinkedIn address and a photo on each person, and when each
-- sign-in last used the app (the only presence we have; nothing here claims someone is "online" beyond that).
alter table users add column last_seen_at timestamptz;
alter table employees
  add column linkedin_url text check (linkedin_url is null or linkedin_url ~* '^https://([a-z]{2,3}\.)?linkedin\.com/'),
  add column skills text[] not null default '{}' check (cardinality(skills) <= 30),
  add column avatar_file_id uuid references project_files(id) on delete set null;
create index employees_skills_idx on employees using gin(skills);
create index employees_manager_idx on employees(manager_id);
-- a profile photo is a stored file owned by the person
alter table project_files add column employee_id uuid references employees(id) on delete cascade,
  drop constraint project_files_owner,
  add constraint project_files_owner check (project_id is not null or wiki_page_id is not null or employee_id is not null);
