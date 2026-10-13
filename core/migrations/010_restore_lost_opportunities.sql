-- Repair after 009. Its first version ranked LOST below every open stage, so where a reply had opened opportunity A
-- (REPLIED) and the duplicate B was booked, met and analysed as lost, 009 kept A and deleted B: the deal came back as
-- open. The evidence survives on the meeting 009 moved onto A: its analysis says the call ended lost. A meeting
-- analysed as lost always set its opportunity to LOST (postMeeting), so an opportunity still at REPLIED or
-- MEETING_BOOKED with such a meeting can only be one of these. Put it back, with the call's summary as the reason.
update opportunities o set stage = 'LOST',
  lost_reason = coalesce(o.lost_reason, (select m.analysis->'crm_update'->>'summary' from meetings m
    where m.opportunity_id = o.id and m.analysis->'crm_update'->>'stage' = 'LOST' order by m.updated_at desc limit 1))
where o.stage in ('REPLIED', 'MEETING_BOOKED')
  and exists (select 1 from meetings m where m.opportunity_id = o.id and m.analysis->'crm_update'->>'stage' = 'LOST');

-- 3. Unread counts use the number a chat message was first posted with; an edit takes a new seq (so open browsers
-- get it) but must not make an old message unread again. Existing rows: their current seq is the best record left.
alter table chat_messages add column first_seq bigint;
update chat_messages set first_seq = seq;
