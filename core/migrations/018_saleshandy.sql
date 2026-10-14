-- Saleshandy mirror, webhook inbox, sync runs, write audit and credit spend. Every mirrored row is keyed by the
-- Saleshandy id so a repeated sync changes nothing. Only fields a screen, report or action uses are stored.
create table sh_sequences (
  id text primary key,
  title text not null default '',
  active boolean,
  status text,                                    -- as Saleshandy reports it
  progress text,
  client_id text,
  schedule_id text,
  totals jsonb not null default '{}'::jsonb,      -- sent, opened, replied, clicked, bounced, unsubscribed
  totals_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table sh_sequence_steps (
  id text primary key,
  sequence_id text not null references sh_sequences(id) on delete cascade,
  number int,
  type text,
  execution_type text,
  relative_days int,
  status text,
  variant_count int,
  subject text,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sh_sequence_steps_seq_idx on sh_sequence_steps(sequence_id, number);
create table sh_prospects (
  id text primary key,
  email citext,
  first_name text,
  last_name text,
  company_name text,
  verification_status text,
  tags text[] not null default '{}',
  sh_created_at timestamptz,
  contact_id uuid references contacts(id) on delete set null,
  company_id uuid references companies(id) on delete set null,
  link_method text check (link_method in ('email','domain','manual')),
  last_activity_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sh_prospects_email_idx on sh_prospects(email);
create index sh_prospects_contact_idx on sh_prospects(contact_id) where contact_id is not null;
create index sh_prospects_company_idx on sh_prospects(company_id) where company_id is not null;
create table sh_prospect_sequences (
  prospect_id text not null references sh_prospects(id) on delete cascade,
  sequence_id text not null,
  step_id text,
  status text,                                    -- active, paused, finished, replied, unsubscribed, bounced
  outcome text,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (prospect_id, sequence_id)
);
create index sh_prospect_sequences_seq_idx on sh_prospect_sequences(sequence_id);
create table sh_events (
  id text primary key,                            -- Saleshandy event id, or a hash of the raw event
  kind text not null,
  prospect_id text,
  sequence_id text,
  email citext,
  occurred_at timestamptz not null default now(),
  reliable boolean not null default true,         -- false for opens and clicks: mail privacy features fake them
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sh_events_prospect_idx on sh_events(prospect_id, occurred_at desc);
create index sh_events_email_idx on sh_events(email, occurred_at desc);
create table sh_threads (
  id text primary key,
  prospect_email citext,
  subject text,
  sequence_id text,
  email_account_id text,
  last_message_at timestamptz,
  is_read boolean,
  category text,
  sentiment text,
  outcome text,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sh_threads_last_idx on sh_threads(last_message_at desc);
create index sh_threads_email_idx on sh_threads(prospect_email);
create table sh_messages (
  id text primary key,
  thread_id text not null references sh_threads(id) on delete cascade,
  direction text,                                 -- in or out
  from_email citext,
  to_emails text[] not null default '{}',
  sent_at timestamptz,
  subject text,
  body_text text,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sh_messages_thread_idx on sh_messages(thread_id, sent_at);
create table sh_tasks (
  id text primary key,
  type text,
  status text,
  priority text,
  prospect_id text,
  prospect_name text,
  sequence_id text,
  sequence_name text,
  due_date date,
  note text,
  assignee text,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sh_tasks_status_idx on sh_tasks(status, due_date);
create index sh_tasks_prospect_idx on sh_tasks(prospect_id);
create table sh_notes (
  id text primary key,
  prospect_id text not null,
  content text not null default '',
  visibility text,
  status text,
  sh_created_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sh_notes_prospect_idx on sh_notes(prospect_id, sh_created_at desc);
create table sh_dnc_lists (
  id text primary key,
  name text not null default '',
  item_count int,
  sh_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table sh_dnc_items (
  id text primary key,
  list_id text not null references sh_dnc_lists(id) on delete cascade,
  value citext not null,
  type text,                                      -- email or domain
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sh_dnc_items_value_idx on sh_dnc_items(value);
create table sh_email_accounts (
  id text primary key,
  from_email citext,
  from_name text,
  status text,
  provider text,
  health jsonb not null default '{}'::jsonb,      -- health score, remaining quota, as reported
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- small reference lists the screens need: schedules, tags, fields, outcomes, categories, team members, clients
create table sh_lookups (
  kind text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (kind, id)
);
create table sh_analytics_snapshots (
  day date not null,
  scope text not null,                            -- sequence, mailbox, team
  scope_id text not null,
  numbers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (day, scope, scope_id)
);
create table sh_webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,                 -- the event id when Saleshandy sends one, otherwise a hash of the body
  event_type text,
  raw jsonb not null,
  status text not null default 'received' check (status in ('received','processed','failed','ignored')),
  attempts int not null default 0,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index sh_webhook_inbox_status_idx on sh_webhook_inbox(status, received_at desc);
create table sh_sync_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('full','incremental','refresh')),
  status text not null default 'running' check (status in ('running','success','partial','failed')),
  counts jsonb not null default '{}'::jsonb,      -- per resource: seen, upserted, removed, skipped
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index sh_sync_runs_started_idx on sh_sync_runs(started_at desc);
create table sh_write_audit (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  actor_user_id uuid references users(id) on delete set null,
  actor text not null,                            -- a person's name, or system
  action text not null,
  risk text not null check (risk in ('low','medium','high','spend')),
  targets jsonb not null default '{}'::jsonb,     -- prospect, sequence, thread, task ids and emails
  before_state jsonb,
  request jsonb,                                  -- method, path and body; never headers or the key
  response jsonb,
  outcome text not null check (outcome in ('refused','pending','sending','sent','failed','cancelled')), -- sending: in flight; a row stuck there needs a look in Saleshandy
  reason text,
  send_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sh_write_audit_created_idx on sh_write_audit(created_at desc);
create index sh_write_audit_pending_idx on sh_write_audit(send_at) where outcome = 'pending';
create table sh_credit_spend (
  id uuid primary key default gen_random_uuid(),
  month text not null,                            -- YYYY-MM, India time
  action text not null,
  estimated int not null,
  balance_before numeric,
  balance_after numeric,
  actual int,
  audit_id uuid references sh_write_audit(id) on delete set null,
  created_at timestamptz not null default now()
);
create index sh_credit_spend_month_idx on sh_credit_spend(month);
