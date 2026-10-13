-- One opportunity per prospect. createMeeting relied on "on conflict do nothing" with no unique constraint to conflict
-- on, so a prospect whose reply had already opened an opportunity got a second one when a meeting was booked.
-- Merge what exists: keep a closed one (won, then lost) or else the furthest along (the oldest on a tie), move its siblings' meetings,
-- proposals, deals and history onto it, keep any value or owner only a sibling had, then add the constraint.
create temp table opp_merge on commit drop as
with ranked as (
  select id, prospect_id, row_number() over (partition by prospect_id order by
    case stage when 'WON' then 9 when 'LOST' then 8 when 'NEGOTIATION' then 6 when 'PROPOSAL_SENT' then 5 when 'MEETING_HELD' then 4
      when 'MEETING_BOOKED' then 3 when 'REPLIED' then 2 else 1 end desc, created_at, id) rn
  from opportunities)
select r.id old_id, k.id keep_id from ranked r join ranked k on k.prospect_id = r.prospect_id and k.rn = 1 where r.rn > 1;

update meetings x set opportunity_id = m.keep_id from opp_merge m where x.opportunity_id = m.old_id;
update proposals x set opportunity_id = m.keep_id from opp_merge m where x.opportunity_id = m.old_id;
update deals x set opportunity_id = m.keep_id from opp_merge m where x.opportunity_id = m.old_id;
update activities x set entity_id = m.keep_id from opp_merge m where x.entity_type = 'opportunity' and x.entity_id = m.old_id;
update opportunities k set
  value_paise = coalesce(k.value_paise, (select max(o.value_paise) from opportunities o join opp_merge m on m.old_id = o.id where m.keep_id = k.id)),
  owner = coalesce(k.owner, (select max(o.owner) from opportunities o join opp_merge m on m.old_id = o.id where m.keep_id = k.id))
where k.id in (select keep_id from opp_merge);
delete from opportunities where id in (select old_id from opp_merge);

alter table opportunities add constraint opportunities_prospect_uq unique (prospect_id);
