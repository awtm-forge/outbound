-- The cheap first-pass screen: can they pay, is there a problem we solve. Decides who gets full research.
alter table prospects add column if not exists screen jsonb;
alter table prospects add column if not exists screen_score int;
create index if not exists prospects_screen_idx on prospects(screen_score desc nulls last) where status in ('NEW','RESEARCH_FURTHER');
alter table discovery_candidates add column if not exists found_by text not null default 'search';
