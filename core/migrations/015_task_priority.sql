-- Two more task priorities: Urgent above High, and No priority for work nobody has ranked yet. Existing tasks keep theirs.
alter table tasks drop constraint if exists tasks_priority_check;
alter table tasks add constraint tasks_priority_check check (priority in ('URGENT','HIGH','MEDIUM','LOW','NONE'));
