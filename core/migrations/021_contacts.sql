-- Contact channels: a phone per person, where each detail came from, and the company's own reachable channels.
alter table contacts add column if not exists phone text;
alter table contacts add column if not exists phone_source_url text;
alter table contacts add column if not exists email_source_url text;
alter table companies add column if not exists phone text;
alter table companies add column if not exists email citext;
alter table companies add column if not exists contact_sources jsonb not null default '{}';
alter table companies add column if not exists contacts_checked_at timestamptz;
