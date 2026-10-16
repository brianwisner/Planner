-- =====================================================================
--  Wisner Engineering Planner — database setup
--  Paste this whole file into the Supabase SQL Editor and click "Run".
--  It is safe to run once on a brand-new project.
-- =====================================================================

-- ---------- Settings (one row) ----------
create table if not exists settings (
  id int primary key default 1 check (id = 1),
  company_name text not null default 'Wisner Engineering',
  default_rate numeric not null default 150,     -- $/hour used for unbilled estimates
  weekly_capacity numeric not null default 40     -- default hours/week per person
);
insert into settings (id) values (1) on conflict do nothing;

-- ---------- People ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null default '',
  color text not null default '#1f6feb',
  hourly_rate numeric,                 -- overrides settings.default_rate when set
  weekly_hours numeric not null default 40,
  ics_token text not null default encode(gen_random_bytes(16), 'hex'),
  created_at timestamptz not null default now()
);

-- Automatically create a profile row whenever a user account is created.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n int;
  palette text[] := array['#1f6feb','#d1242f','#1a7f37','#9a6700','#8250df','#bf3989','#0e7490','#b35900'];
begin
  select count(*) into n from profiles;
  insert into profiles (id, email, full_name, color)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    palette[(n % array_length(palette, 1)) + 1]
  )
  on conflict (id) do nothing;

  -- First person to sign up: attach the sample jobs to them so the
  -- dashboard, timesheet and reports have something to show.
  if n = 0 and exists (select 1 from clients where is_sample) then
    update phases set assignee_id = new.id
      where assignee_id is null
        and job_id in (select j.id from jobs j join clients c on c.id = j.client_id where c.is_sample);
    update tasks set assignee_id = new.id
      where assignee_id is null
        and job_id in (select j.id from jobs j join clients c on c.id = j.client_id where c.is_sample);
    insert into time_entries (job_id, phase_id, user_id, date, hours, notes, billed, invoice_id)
      select p.job_id, p.id, new.id, d.day, d.hrs, d.note, d.billed,
             case when d.billed then (select i.id from invoices i where i.job_id = p.job_id order by i.issued_date limit 1) end
      from phases p
      join jobs j on j.id = p.job_id
      join (values
        ('26-041','design',        current_date - 14, 6.0, 'Gravity framing',          false),
        ('26-041','design',        current_date - 7,  5.5, 'Gravity framing',          false),
        ('26-041','design',        current_date - 2,  4.0, 'Shear wall layout',        false),
        ('26-041','design',        current_date - 1,  3.0, 'Holdown design',           false),
        ('26-038','design',        current_date - 40, 8.0, 'Framing plan',             true),
        ('26-038','design',        current_date - 35, 8.0, 'Lateral analysis',         true),
        ('26-038','design',        current_date - 30, 7.5, 'Foundation design',        true),
        ('26-038','design',        current_date - 25, 8.0, 'Details',                  true),
        ('26-038','design',        current_date - 18, 6.0, 'Calc package',             true),
        ('26-038','plan_check',    current_date - 6,  3.0, 'Review county comments',   false),
        ('26-038','plan_check',    current_date - 3,  4.0, 'Diaphragm response',       false),
        ('26-029','design',        current_date - 55, 8.0, 'Wall design',              true),
        ('26-029','design',        current_date - 50, 7.0, 'Drainage and details',     true),
        ('26-029','design',        current_date - 45, 4.0, 'Calc package',             true),
        ('26-029','plan_check',    current_date - 10, 2.5, 'Soil bearing comment',     false),
        ('25-112','design',        current_date - 110, 4.5, 'Site visit and letter',   true)
      ) as d(job_number, kind, day, hrs, note, billed)
        on d.job_number = j.job_number and d.kind = p.kind;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ---------- Clients ----------
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text default '',
  email text default '',
  phone text default '',
  address text default '',
  notes text default '',
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- Jobs ----------
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  job_number text default '',
  name text not null,
  description text default '',
  address text default '',
  status text not null default 'active' check (status in ('active','on_hold','complete','archived')),
  priority int not null default 100,            -- lower number = higher in the queue
  fee numeric,                                  -- agreed fee, optional
  start_date date,
  due_date date,
  created_at timestamptz not null default now()
);

-- ---------- Phases (every job gets the same four) ----------
create table if not exists phases (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  kind text not null check (kind in ('design','plan_check','construction','client_changes')),
  name text not null,
  sort_order int not null default 0,
  status text not null default 'not_started' check (status in ('not_started','in_progress','waiting','complete')),
  estimate_hours numeric not null default 0,
  start_date date,
  due_date date,
  assignee_id uuid references profiles(id) on delete set null,
  notes text default ''
);

-- When a job is created, automatically add the four standard phases.
create or replace function add_standard_phases() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into phases (job_id, kind, name, sort_order) values
    (new.id, 'design',         'Original design',             1),
    (new.id, 'plan_check',     'County / plan-check comments', 2),
    (new.id, 'construction',   'Construction changes',        3),
    (new.id, 'client_changes', 'Client-requested changes',    4);
  return new;
end $$;

drop trigger if exists on_job_created on jobs;
create trigger on_job_created
  after insert on jobs
  for each row execute procedure add_standard_phases();

-- ---------- Tasks ----------
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  phase_id uuid references phases(id) on delete cascade,
  title text not null,
  description text default '',
  status text not null default 'todo' check (status in ('todo','doing','waiting','done')),
  assignee_id uuid references profiles(id) on delete set null,
  due_date date,
  scheduled_at timestamptz,                     -- for site visits with a time
  is_site_visit boolean not null default false,
  estimate_hours numeric,
  recurrence text not null default 'none' check (recurrence in ('none','daily','weekly','biweekly','monthly')),
  sort_order int not null default 0,
  completed_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- Invoices ----------
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  number text not null default '',
  amount numeric not null default 0,
  issued_date date not null default current_date,
  paid_date date,
  notes text default '',
  created_at timestamptz not null default now()
);

-- ---------- Time entries ----------
create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  phase_id uuid references phases(id) on delete set null,
  task_id uuid references tasks(id) on delete set null,
  user_id uuid not null references profiles(id) on delete cascade,
  date date not null default current_date,
  hours numeric,                                -- null while a timer is running
  started_at timestamptz,                       -- set while a timer is running
  rate numeric,                                 -- $/hour saved when the entry is created
  notes text default '',
  billed boolean not null default false,
  invoice_id uuid references invoices(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Save the billing rate on each new time entry (person's rate, else company default),
-- so changing a rate later does not change the value of hours already logged.
create or replace function set_entry_rate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.rate is null then
    new.rate := coalesce((select hourly_rate from profiles where id = new.user_id),
                         (select default_rate from settings where id = 1), 0);
  end if;
  return new;
end $$;
drop trigger if exists time_entry_rate on time_entries;
create trigger time_entry_rate before insert on time_entries for each row execute procedure set_entry_rate();

-- ---------- Deposits (retainers) received on a job ----------
-- A deposit pays for that job's un-invoiced hours, oldest first (worked out in the app).
create table if not exists deposits (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  amount numeric not null default 0,
  received_date date not null default current_date,
  method text default '',
  notes text default '',
  created_at timestamptz not null default now()
);

-- ---------- Comments / notes on jobs ----------
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  user_id uuid references profiles(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------- Indexes ----------
create index if not exists jobs_client_idx on jobs(client_id);
create index if not exists phases_job_idx on phases(job_id);
create index if not exists tasks_job_idx on tasks(job_id);
create index if not exists tasks_phase_idx on tasks(phase_id);
create index if not exists time_job_idx on time_entries(job_id);
create index if not exists time_user_idx on time_entries(user_id);
create index if not exists comments_job_idx on comments(job_id);
create index if not exists deposits_job_idx on deposits(job_id);

-- ---------- Security: only signed-in team members can see or change data ----------
alter table settings     enable row level security;
alter table profiles     enable row level security;
alter table clients      enable row level security;
alter table jobs         enable row level security;
alter table phases       enable row level security;
alter table tasks        enable row level security;
alter table invoices     enable row level security;
alter table deposits     enable row level security;
alter table time_entries enable row level security;
alter table comments     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['settings','profiles','clients','jobs','phases','tasks','invoices','deposits','time_entries','comments'] loop
    execute format('drop policy if exists team_all on %I', t);
    execute format('create policy team_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------- Live sync across devices ----------
do $$
declare t text;
begin
  foreach t in array array['settings','profiles','clients','jobs','phases','tasks','invoices','deposits','time_entries','comments'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- =====================================================================
--  Sample data so you can see how the app works.
--  Delete it later with the "Remove sample data" button in Settings.
-- =====================================================================
do $$
declare
  c1 uuid; c2 uuid; c3 uuid;
  j1 uuid; j2 uuid; j3 uuid; j4 uuid;
  p uuid;
begin
  if exists (select 1 from clients where is_sample) then return; end if;

  insert into clients (name, contact_name, email, phone, address, is_sample) values
    ('Smith Family',            'Dan Smith',     'dan@example.com',   '555-0101', '14 Maple Ct',          true) returning id into c1;
  insert into clients (name, contact_name, email, phone, address, is_sample) values
    ('Oak Street Builders',     'Maria Lopez',   'maria@example.com', '555-0102', '220 Oak St',           true) returning id into c2;
  insert into clients (name, contact_name, email, phone, address, is_sample) values
    ('ABC Development LLC',     'Kevin Park',    'kevin@example.com', '555-0103', '900 Industrial Way',   true) returning id into c3;

  insert into jobs (client_id, job_number, name, address, status, priority, fee, start_date, due_date, description)
    values (c1, '26-041', 'Smith Residence — Second Story Addition', '14 Maple Ct', 'active', 1, 6800,
            current_date - 21, current_date + 35, 'Two-story wood-frame addition over existing garage. Lateral + gravity.')
    returning id into j1;
  insert into jobs (client_id, job_number, name, address, status, priority, fee, start_date, due_date, description)
    values (c2, '26-038', 'Oak St Duplex — New Construction', '220 Oak St', 'active', 2, 14500,
            current_date - 45, current_date + 60, 'Two-unit duplex, slab on grade, shear walls per SDPWS.')
    returning id into j2;
  insert into jobs (client_id, job_number, name, address, status, priority, fee, start_date, due_date, description)
    values (c3, '26-029', 'Industrial Way — Retaining Wall', '900 Industrial Way', 'active', 3, 4200,
            current_date - 60, current_date - 3, '12 ft cantilevered CMU retaining wall.')
    returning id into j3;
  insert into jobs (client_id, job_number, name, address, status, priority, fee, start_date, due_date, description)
    values (c1, '25-112', 'Smith — Deck Repair Letter', '14 Maple Ct', 'complete', 50, 900,
            current_date - 120, current_date - 90, 'Site observation and repair letter.')
    returning id into j4;

  -- Phase details (the trigger already created the four phases per job)
  update phases set estimate_hours = 32, status = 'in_progress', start_date = current_date - 21, due_date = current_date + 10 where job_id = j1 and kind = 'design';
  update phases set estimate_hours = 8,  status = 'not_started', start_date = current_date + 12, due_date = current_date + 30 where job_id = j1 and kind = 'plan_check';
  update phases set estimate_hours = 6,  status = 'not_started' where job_id = j1 and kind = 'construction';
  update phases set estimate_hours = 4,  status = 'not_started' where job_id = j1 and kind = 'client_changes';

  update phases set estimate_hours = 60, status = 'complete',    start_date = current_date - 45, due_date = current_date - 10 where job_id = j2 and kind = 'design';
  update phases set estimate_hours = 12, status = 'in_progress', start_date = current_date - 8,  due_date = current_date + 6  where job_id = j2 and kind = 'plan_check';
  update phases set estimate_hours = 10, status = 'not_started', start_date = current_date + 20, due_date = current_date + 60 where job_id = j2 and kind = 'construction';
  update phases set estimate_hours = 6,  status = 'waiting',     due_date = current_date + 14 where job_id = j2 and kind = 'client_changes';

  update phases set estimate_hours = 20, status = 'complete',    start_date = current_date - 60, due_date = current_date - 30 where job_id = j3 and kind = 'design';
  update phases set estimate_hours = 6,  status = 'in_progress', start_date = current_date - 14, due_date = current_date - 3  where job_id = j3 and kind = 'plan_check';
  update phases set estimate_hours = 4,  status = 'not_started' where job_id = j3 and kind = 'construction';
  update phases set estimate_hours = 2,  status = 'not_started' where job_id = j3 and kind = 'client_changes';

  update phases set estimate_hours = 5,  status = 'complete', start_date = current_date - 120, due_date = current_date - 100 where job_id = j4 and kind = 'design';
  update phases set status = 'complete' where job_id = j4;

  -- Tasks
  select id into p from phases where job_id = j1 and kind = 'design';
  insert into tasks (job_id, phase_id, title, status, due_date, estimate_hours, sort_order) values
    (j1, p, 'Gravity design — floor and roof framing', 'done',  current_date - 5, 10, 1),
    (j1, p, 'Lateral design — shear walls and holdowns', 'doing', current_date + 3, 12, 2),
    (j1, p, 'Foundation check for added load', 'todo', current_date + 7, 6, 3),
    (j1, p, 'Draft calc package and stamp', 'todo', current_date + 10, 4, 4);
  insert into tasks (job_id, phase_id, title, status, due_date, scheduled_at, is_site_visit, estimate_hours, sort_order) values
    (j1, p, 'Site visit — verify existing garage framing', 'todo', current_date + 2, (current_date + 2)::timestamp + interval '9 hours', true, 2, 0);

  select id into p from phases where job_id = j2 and kind = 'plan_check';
  insert into tasks (job_id, phase_id, title, status, due_date, estimate_hours, sort_order) values
    (j2, p, 'Respond to county comment #1 — roof diaphragm', 'doing', current_date + 2, 4, 1),
    (j2, p, 'Respond to county comment #2 — anchor bolts', 'todo', current_date + 4, 3, 2),
    (j2, p, 'Resubmit revised sheets S1–S4', 'todo', current_date + 6, 2, 3);

  select id into p from phases where job_id = j3 and kind = 'plan_check';
  insert into tasks (job_id, phase_id, title, status, due_date, estimate_hours, sort_order) values
    (j3, p, 'Address soil bearing comment', 'doing', current_date - 3, 3, 1),
    (j3, p, 'Update drainage detail', 'todo', current_date - 1, 2, 2);

  -- A recurring task (weekly) with no phase
  insert into tasks (job_id, title, status, due_date, recurrence, sort_order) values
    (j2, 'Weekly check-in call with Oak Street Builders', 'todo', current_date + 1, 'weekly', 9);

  -- Comments
  insert into comments (job_id, body) values
    (j1, 'Owner wants to keep the existing garage door opening — need a steel moment frame or a portal frame there.'),
    (j2, 'County wants the resubmittal by end of month. Comments are in the shared drive folder.'),
    (j3, 'Plan check is overdue — contractor is waiting on us before pouring.');

  -- Invoices (billing)
  insert into invoices (job_id, number, amount, issued_date, paid_date) values
    (j2, 'INV-1041', 9000, current_date - 20, current_date - 5),
    (j2, 'INV-1052', 2500, current_date - 4, null),
    (j3, 'INV-1033', 3000, current_date - 30, current_date - 12),
    (j4, 'INV-0998', 900,  current_date - 95, current_date - 80);

  -- Deposits: one used up (Smith, now has unbilled work), one with money left (Industrial Way)
  insert into deposits (job_id, amount, received_date, method, notes) values
    (j1, 2500, current_date - 21, 'Check', 'Retainer at signing'),
    (j3, 1000, current_date - 60, 'ACH / transfer', 'Retainer at signing');
end $$;
