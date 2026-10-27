-- What each AI call cost, from the provider's own usage figures, in millionths of a US dollar (integer, never float).
alter table ai_runs add column if not exists cost_micros bigint not null default 0;
alter table ai_runs add column if not exists web_searches int not null default 0;
create index if not exists ai_runs_provider_created_idx on ai_runs(provider, created_at);
