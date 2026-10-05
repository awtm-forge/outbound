-- AWTM Forge Outbound OS. Schema v1. All timestamps timestamptz, all ids uuid.
create extension if not exists pgcrypto;
create extension if not exists citext;

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- campaigns (config-driven; seeded from config/campaigns.json) ----------
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                      -- IND-WEB-ELECTRONICS
  name text not null,
  country text not null,                          -- IN
  region text,
  service_domain text not null,                   -- WEB | PRODUCT | BRAND
  vertical text not null,
  problem text not null,                          -- primary problem family this campaign targets
  offer text not null,
  buyer_titles text[] not null default '{}',
  sender text,
  sequence_ref text,                              -- Saleshandy sequence id once created
  compliance jsonb not null default '{}',         -- per-campaign compliance config
  status text not null default 'ACTIVE' check (status in ('DRAFT','ACTIVE','PAUSED','STOPPED')),
  config jsonb not null default '{}',             -- tone, CTA, constraints
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- companies ----------
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null unique,                    -- normalized: lowercase, no www
  website text,
  country text,
  city text,
  industry text,
  vertical text,
  company_size text,
  platform text,                                  -- Shopify, Wix, custom...
  source text not null default 'manual',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- contacts ----------
create table contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  first_name text,
  last_name text,
  full_name text,
  job_title text,
  email citext,
  email_verification_status text not null default 'UNVERIFIED'
    check (email_verification_status in ('UNVERIFIED','VALID','INVALID','RISKY','CATCH_ALL','UNKNOWN')),
  linkedin_url text,
  is_decision_maker boolean not null default false,
  source text not null default 'manual',
  external_ref text,                              -- saleshandy prospect id
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, email)
);
create unique index contacts_email_uq on contacts (email) where email is not null;

-- ---------- prospects (an account+contact in a campaign pipeline) ----------
create table prospects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  campaign_id uuid references campaigns(id),
  status text not null default 'NEW' check (status in (
    'NEW','QUALIFYING','REJECTED','RESEARCH_FURTHER','RESEARCHING','QUALIFIED',
    'EMAIL_DRAFTED','PENDING_APPROVAL','APPROVED','SYNCED','CONTACTED',
    'REPLIED','MEETING','PROPOSAL','WON','LOST','SUPPRESSED')),
  account_score int check (account_score between 0 and 100),
  score_breakdown jsonb,
  problem_score int,
  commercial_score int,
  primary_problem text,
  secondary_problems text[] not null default '{}',
  problem_angle text,
  specific_observation text,
  business_consequence text,
  trigger_event text,
  relevant_capability text,
  relevant_proof_ids text[] not null default '{}',
  owner text,
  last_contacted_at timestamptz,
  next_action_at timestamptz,
  suppressed boolean not null default false,
  suppression_reason text,
  source text not null default 'manual',
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, campaign_id)
);
create index prospects_status_idx on prospects(status);
create index prospects_campaign_idx on prospects(campaign_id);

-- ---------- research (structured, per company, per kind; raw AI output kept in ai_runs) ----------
create table research (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  prospect_id uuid references prospects(id) on delete cascade,
  kind text not null,                             -- ACCOUNT | WEBSITE | PROBLEM | CAPABILITY | DECISION_MAKER
  data jsonb not null,
  confidence numeric(3,2),
  ai_run_id uuid,
  input_hash text not null,                       -- cache key: same input => reuse
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index research_company_kind_idx on research(company_id, kind, created_at desc);

-- ---------- campaign memberships ----------
create table campaign_memberships (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id),
  prospect_id uuid not null references prospects(id) on delete cascade,
  contact_id uuid references contacts(id),
  status text not null default 'PENDING' check (status in ('PENDING','ACTIVE','PAUSED','COMPLETED','REMOVED','SUPPRESSED')),
  saleshandy_prospect_id text,
  saleshandy_sequence_id text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, prospect_id)
);

-- ---------- email drafts + approval gate ----------
create table email_drafts (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospects(id) on delete cascade,
  campaign_id uuid references campaigns(id),
  step int not null default 1,
  subject_original text not null,
  body_original text not null,
  subject_final text,
  body_final text,
  status text not null default 'PENDING_APPROVAL'
    check (status in ('PENDING_APPROVAL','APPROVED','REJECTED','RESEARCH_MORE','SENT_TO_SEQUENCER')),
  approver text,
  approved_at timestamptz,
  rejection_reason text,
  ai_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index email_drafts_status_idx on email_drafts(status);

-- ---------- email events (from Saleshandy webhooks) ----------
create table email_events (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid references prospects(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  campaign_id uuid references campaigns(id),
  event_type text not null check (event_type in ('SENT','DELIVERED','OPENED','CLICKED','BOUNCED','REPLIED','UNSUBSCRIBED','FAILED')),
  provider text not null default 'saleshandy',
  provider_event_id text,
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);
create index email_events_campaign_type_idx on email_events(campaign_id, event_type);

-- ---------- replies ----------
create table replies (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid references prospects(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  campaign_id uuid references campaigns(id),
  email_event_id uuid references email_events(id),
  from_email citext,
  subject text,
  body text not null,
  received_at timestamptz not null default now(),
  classification text check (classification in ('POSITIVE','VALUE_REQUEST','PRICE','TIMING','WRONG_PERSON','REFERRAL','OBJECTION','NOT_INTERESTED','UNSUBSCRIBE','OTHER')),
  confidence numeric(3,2),
  recommended_next_action text,
  suggested_reply text,
  priority text check (priority in ('HIGH','MEDIUM','LOW')),
  owner text,
  status text not null default 'NEW' check (status in ('NEW','CLASSIFIED','ACTIONED','IGNORED')),
  ai_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index replies_status_idx on replies(status);

-- ---------- teardowns (two-point) ----------
create table teardowns (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospects(id) on delete cascade,
  reply_id uuid references replies(id),
  findings jsonb not null,                        -- [{observation,evidence,why_it_matters,what_we_would_test}] x2
  capability text,
  proof_ids text[] not null default '{}',
  body_original text not null,
  body_final text,
  status text not null default 'PENDING_APPROVAL' check (status in ('PENDING_APPROVAL','APPROVED','REJECTED','SENT')),
  approver text, approved_at timestamptz,
  ai_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- opportunities / meetings / proposals / deals ----------
create table opportunities (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospects(id) on delete cascade,
  company_id uuid not null references companies(id),
  campaign_id uuid references campaigns(id),
  stage text not null default 'REPLIED' check (stage in ('REPLIED','MEETING_BOOKED','MEETING_HELD','PROPOSAL_SENT','NEGOTIATION','WON','LOST')),
  value_paise bigint,                             -- integer paise, never float
  owner text,
  lost_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table meetings (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  scheduled_at timestamptz,
  held boolean not null default false,
  brief jsonb,                                    -- meeting intelligence output
  notes text,                                     -- transcript / notes input
  analysis jsonb,                                 -- post-meeting output
  brief_ai_run_id uuid, analysis_ai_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table proposals (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  meeting_id uuid references meetings(id),
  draft jsonb not null,
  business_inputs jsonb not null default '{}',    -- price, deadline, guarantees: explicit human inputs only
  status text not null default 'DRAFT' check (status in ('DRAFT','PENDING_APPROVAL','APPROVED','SENT','ACCEPTED','DECLINED')),
  approver text, approved_at timestamptz,
  ai_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table deals (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id),
  proposal_id uuid references proposals(id),
  revenue_paise bigint not null default 0,
  cost_paise bigint not null default 0,
  gross_profit_paise bigint generated always as (revenue_paise - cost_paise) stored,
  status text not null default 'OPEN' check (status in ('OPEN','DELIVERING','COMPLETE','CANCELLED')),
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- activities (audit trail of human + system actions) ----------
create table activities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  actor text not null default 'system',
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index activities_entity_idx on activities(entity_type, entity_id, created_at desc);

-- ---------- suppression (global; overrides everything) ----------
create table suppression_list (
  id uuid primary key default gen_random_uuid(),
  email citext,
  domain text,
  reason text not null,
  source text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  check (email is not null or domain is not null)
);
create unique index suppression_email_uq on suppression_list(email) where email is not null;
create unique index suppression_domain_uq on suppression_list(domain) where domain is not null;

-- ---------- proof assets (from the Growth Partner Brief; label is law) ----------
create table proof_assets (
  id text primary key,                            -- slug e.g. ratiovisuals-impressions
  title text not null,
  kind text not null,                             -- RESULT | TESTIMONIAL | PORTFOLIO | CREDENTIAL
  label text not null check (label in ('VERIFIED','STATED','TO_CONFIRM','PRIVATE','SHOWCASE')),
  public_ok boolean not null default false,       -- only VERIFIED with permission may be true
  domains text[] not null default '{}',           -- WEB | PRODUCT | BRAND
  verticals text[] not null default '{}',
  problems text[] not null default '{}',
  text text not null,                             -- exact wording allowed in outreach
  source text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- ai runs (every agent call, raw) ----------
create table ai_runs (
  id uuid primary key default gen_random_uuid(),
  agent text not null,
  prompt_version text not null,
  provider text not null,
  model text not null,
  input jsonb not null,
  input_hash text not null,
  output jsonb,
  raw_output text,
  valid boolean,
  error text,
  tokens_in int, tokens_out int,
  duration_ms int,
  workflow_run_id uuid,
  cached_from uuid references ai_runs(id),
  created_at timestamptz not null default now()
);
create index ai_runs_agent_hash_idx on ai_runs(agent, prompt_version, input_hash, created_at desc);

-- ---------- workflow runs ----------
create table workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow text not null,
  external_execution_id text,
  entity_type text, entity_id uuid,
  status text not null default 'RUNNING' check (status in ('RUNNING','SUCCESS','FAILED','RETRYING')),
  error text,
  detail jsonb not null default '{}',
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index workflow_runs_status_idx on workflow_runs(status, started_at desc);

-- ---------- idempotency keys ----------
create table idempotency_keys (
  key text primary key,
  method text not null, path text not null,
  status int not null, response jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------- updated_at triggers ----------
do $$ declare t text; begin
  for t in select unnest(array['campaigns','companies','contacts','prospects','research','campaign_memberships',
    'email_drafts','replies','teardowns','opportunities','meetings','proposals','deals','proof_assets']) loop
    execute format('create trigger %I_updated before update on %I for each row execute function set_updated_at()', t, t);
  end loop; end $$;
