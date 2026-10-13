-- Notes: folders beside pages, pages kept as reusable templates, and comment replies and edits.
alter table pages add column kind text not null default 'page' check (kind in ('page','folder')),
  add column is_template boolean not null default false;
create index pages_templates_idx on pages(created_at desc) where is_template;
alter table page_comments add column parent_id uuid references page_comments(id) on delete cascade,
  add column edited_at timestamptz;
