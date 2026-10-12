-- To-dos: a task with no project. Same assignee, due date, status and comments as a project task.
alter table tasks alter column project_id drop not null;
create index tasks_open_todos_idx on tasks(assignee_id, due_date) where project_id is null and status <> 'DONE';
