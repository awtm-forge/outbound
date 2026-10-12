-- Workspace: HR. A directory everyone signed in can read, leave requests, and compensation that only admins can see.
create table employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references users(id) on delete set null,   -- their sign-in, when they have one
  full_name text not null,
  work_email citext unique,
  phone text,
  job_title text,
  department text,
  employment_type text not null default 'FULL_TIME' check (employment_type in ('FULL_TIME','PART_TIME','CONTRACTOR','INTERN')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ON_LEAVE','EXITED')),
  start_date date,
  end_date date check (end_date is null or start_date is null or end_date >= start_date),
  manager_id uuid references employees(id) on delete set null,
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger employees_updated before update on employees for each row execute function set_updated_at();

-- Admins only. Its own table so that no query a member can reach ever selects a salary by accident: only the
-- admin-only routes in routes/hr.ts read it. Every change is a new row; the latest effective_from is current.
create table employee_compensation (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  amount_paise bigint not null check (amount_paise > 0),          -- integer paise, like all money here
  period text not null default 'MONTHLY' check (period in ('MONTHLY','ANNUAL')),
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  effective_from date not null,
  note text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index employee_compensation_idx on employee_compensation(employee_id, effective_from desc, created_at desc);

create table leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  kind text not null default 'CASUAL' check (kind in ('CASUAL','SICK','EARNED','UNPAID','OTHER')),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  half_day boolean not null default false check (not half_day or end_date = start_date),
  days numeric(5,1) not null check (days >= 0),                   -- working days, Monday to Friday
  reason text,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','CANCELLED')),
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index leave_requests_dates_idx on leave_requests(start_date, end_date) where status = 'APPROVED';
create index leave_requests_employee_idx on leave_requests(employee_id, start_date desc);
