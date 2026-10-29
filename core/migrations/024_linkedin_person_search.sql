-- A fourth kind of target: a people search for the named person at the company, when we have the name but not the profile.
alter table linkedin_outreach drop constraint if exists linkedin_outreach_target_kind_check;
alter table linkedin_outreach add constraint linkedin_outreach_target_kind_check check (target_kind in ('PERSON','PERSON_SEARCH','COMPANY_PAGE','SEARCH'));
