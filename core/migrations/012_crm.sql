-- CRM: who owns a company, archiving, a phone per person, when a deal should close and what happens next, and
-- follow-ups as ordinary tasks linked to a company (so they show on Today and My tasks too). Additive only.
alter table companies add column owner_id uuid references users(id) on delete set null, add column archived_at timestamptz;
create index companies_owner_idx on companies(owner_id) where owner_id is not null;
create index companies_created_idx on companies(created_at);
alter table contacts add column phone text check (phone is null or length(phone) between 5 and 40);
create index contacts_created_idx on contacts(created_at);
alter table opportunities add column expected_close date, add column next_action text check (next_action is null or length(next_action) <= 300), add column next_action_on date;
alter table tasks add column company_id uuid references companies(id) on delete set null, add column opportunity_id uuid references opportunities(id) on delete set null;
create index tasks_company_idx on tasks(company_id, due_date) where company_id is not null;
create index tasks_opportunity_idx on tasks(opportunity_id) where opportunity_id is not null;
-- recent CRM events across companies, prospects and opportunities, newest first
create index if not exists activities_recent_idx on activities(created_at desc) where entity_type in ('company','prospect','opportunity','reply','meeting','email_draft');
