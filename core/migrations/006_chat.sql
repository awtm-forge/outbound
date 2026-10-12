-- Workspace: chat. Open channels everyone can read, and direct conversations between two people.
-- seq orders everything a client has not seen yet: a new message takes the next one, and so does an edit or a delete,
-- so one cursor brings all three to every open browser.
create table chat_channels (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'CHANNEL' check (kind in ('CHANNEL','DIRECT')),
  name text check (name ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  topic text not null default '',
  direct_key text unique,                         -- DIRECT only: the two user ids, sorted, so a pair has one conversation
  archived boolean not null default false,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'CHANNEL' and name is not null and direct_key is null) or (kind = 'DIRECT' and direct_key is not null))
);
create unique index chat_channels_name_uq on chat_channels(name) where kind = 'CHANNEL';
-- DIRECT: who is in it. Both kinds: how far each person has read.
create table chat_members (
  channel_id uuid not null references chat_channels(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  last_read_seq bigint not null default 0,
  primary key (channel_id, user_id)
);
create index chat_members_user_idx on chat_members(user_id);
create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  seq bigserial not null unique,
  channel_id uuid not null references chat_channels(id) on delete cascade,
  author_id uuid references users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index chat_messages_channel_idx on chat_messages(channel_id, seq desc);
insert into chat_channels(kind, name, topic) values ('CHANNEL', 'general', 'Everyone. Announcements and the day-to-day.');
