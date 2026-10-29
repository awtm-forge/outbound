-- LinkedIn outreach queue: one row per person (or company page) a founder will write to by hand. Nothing here sends.
create table if not exists linkedin_outreach (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospects(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  sender text not null,                                   -- whose profile sends: rahul | ayush
  target_url text,                                        -- the person's profile, else the company page, else a people search
  target_kind text not null check (target_kind in ('PERSON','COMPANY_PAGE','SEARCH')),
  note text not null,                                     -- connection note, 300 characters at most
  follow_up text not null,                                -- one message after they accept, never more without a reply
  status text not null default 'QUEUED' check (status in ('QUEUED','SENT','ACCEPTED','REPLIED','DECLINED','SKIPPED')),
  queued_for date not null,                               -- the day it is meant to go out, IST
  sent_at timestamptz, accepted_at timestamptz, follow_up_sent_at timestamptz, replied_at timestamptz,
  skip_reason text,
  ai_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prospect_id, sender)
);
create index if not exists linkedin_outreach_day_idx on linkedin_outreach(sender, queued_for, status);
create trigger linkedin_outreach_updated before update on linkedin_outreach for each row execute function set_updated_at();
