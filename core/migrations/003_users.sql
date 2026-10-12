-- Personal sign-in. One row per person; the first admin is created from DASHBOARD_USER / DASHBOARD_PASSWORD on the
-- first boot after this migration (lib/auth.ts ensureFirstAdmin). Sessions carry session_version, so bumping it signs
-- that person out everywhere (password reset, deactivation).
create table users (
  id uuid primary key default gen_random_uuid(),
  username citext not null unique check (username::text ~ '^[A-Za-z0-9._-]{2,40}$'),
  email citext unique,
  name text not null,
  role text not null default 'member' check (role in ('admin','member')),
  password_hash text not null,                    -- scrypt$N$r$p$salt$hash
  active boolean not null default true,
  session_version int not null default 1,
  must_change_password boolean not null default false,
  last_login_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_updated before update on users for each row execute function set_updated_at();
