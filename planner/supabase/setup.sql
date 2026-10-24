-- =====================================================================
--  Wisner Engineering Planner — database setup
--  Paste this whole file into the Supabase SQL Editor and click "Run".
--  It is safe to run once on a brand-new project.
-- =====================================================================

-- ---------- Settings (one row) ----------
create table if not exists settings (
  id int primary key default 1 check (id = 1),
  company_name text not null default 'Wisner Engineering',
  business_email text not null default '',       -- invoice contact and Gmail sender; separate from sign-in
  default_rate numeric not null default 150,     -- $/hour used for unbilled estimates
  weekly_capacity numeric not null default 40,    -- default hours/week per person
  minimum_fee numeric not null default 0 check (minimum_fee >= 0),           -- fee estimator floor
  site_visit_hours numeric not null default 3 check (site_visit_hours >= 0), -- per visit, with travel
  retainer_percent numeric not null default 0 check (retainer_percent between 0 and 100),
  proposal_template text not null default '',     -- blank = the app's standard wording
  letterhead text not null default '',            -- address/phone lines under the company name on invoices, reports, letters
  signature text not null default '',             -- sign-off on reports and letters; blank = your profile name
  visit_closing text not null default ''          -- closing paragraph of site visit reports; blank = the app's standard wording
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
    -- A few scheduled days ahead so the Gantt chart shows planned hours.
    insert into schedule_entries (job_id, phase_id, user_id, date, hours)
      select p.job_id, p.id, new.id, days.day, v.hrs
      from (values ('26-041','design',1,4),('26-041','design',2,6),('26-041','design',3,4),('26-041','design',4,2),
                   ('26-029','plan_check',1,3),('26-029','plan_check',2,2),('26-038','plan_check',3,3)) v(job_number, kind, n, hrs)
      join jobs j on j.job_number = v.job_number
      join phases p on p.job_id = j.id and p.kind = v.kind
      join (select d::date as day, row_number() over (order by d) as n
              from generate_series(current_date + 1, current_date + 14, interval '1 day') d
             where extract(isodow from d) < 6) days on days.n = v.n;
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
-- ---------- Job types (the fee estimator's starter hours) ----------
create table if not exists job_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  design_hours numeric not null default 0 check (design_hours >= 0),
  plan_check_hours numeric not null default 0 check (plan_check_hours >= 0),
  construction_hours numeric not null default 0 check (construction_hours >= 0),
  site_visits numeric not null default 0 check (site_visits >= 0),
  size_unit text not null default '',             -- e.g. 'sq ft'; blank = size not tracked
  keywords text not null default '',              -- words that identify this type, for automatic typing
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  job_number text default '',
  name text not null,
  description text default '',
  address text default '',
  status text not null default 'active' check (status in ('active','on_hold','complete','cancelled','archived')),
  priority int not null default 100,            -- lower number = higher in the queue
  fee numeric,                                  -- agreed fee, optional
  job_type_id uuid references job_types(id) on delete set null, -- the estimator learns from finished jobs of each type
  size numeric check (size >= 0),               -- in the job type's size unit
  use_in_estimates boolean not null default true, -- false leaves a finished job out of the estimator
  estimate_note text not null default '',       -- why it was left out
  closeout_reason text not null default '',     -- what made the hours differ from the quote
  queued_date date,                             -- when the job entered the queue
  start_date date,
  due_date date,
  created_at timestamptz not null default now()
);

-- ---------- Past jobs from before the planner (from email, invoices, files) ----------
-- Fee evidence for the estimator and examples for automatic job typing.
create table if not exists past_jobs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client text not null default '',
  address text not null default '',
  job_type_id uuid references job_types(id) on delete set null,
  date date,
  fee numeric check (fee >= 0),               -- what was charged (invoiced or quoted)
  hours numeric check (hours >= 0),           -- only when actually known
  size numeric check (size >= 0),
  scope text not null default '',
  source text not null default '',            -- where it came from (invoice numbers, emails, files)
  use_in_estimates boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Quotes saved from the fee estimator (never edited, so the original survives) ----------
create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  job_type_id uuid references job_types(id) on delete set null,
  rate numeric not null default 0,
  design_hours numeric not null default 0,
  plan_check_hours numeric not null default 0,
  construction_hours numeric not null default 0,
  site_visits numeric not null default 0,
  visit_hours numeric not null default 0,
  allowance_hours numeric not null default 0,
  rush_percent numeric not null default 0,
  size numeric,
  suggested_fee numeric not null default 0,
  fee numeric not null default 0,
  fee_note text not null default '',
  created_at timestamptz not null default now()
);

-- ---------- Phases (new jobs get five workflow phases) ----------
-- Retain the queued kind for existing phase IDs and their historical references.
create table if not exists phases (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  kind text not null check (kind in ('bidding','queued','design','plan_check','construction','client_changes')),
  name text not null,
  sort_order int not null default 0,
  status text not null default 'not_started' check (status in ('not_started','in_progress','waiting','complete')),
  estimate_hours numeric not null default 0,
  start_date date,
  due_date date,
  assignee_id uuid references profiles(id) on delete set null,
  notes text default ''
);

-- When a job is created, automatically add the five workflow phases.
-- Existing queued rows and jobs.queued_date remain untouched.
create or replace function add_standard_phases() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into phases (job_id, kind, name, sort_order) values
    (new.id, 'bidding',        'Bidding',                      1),
    (new.id, 'design',         'Original design',              2),
    (new.id, 'plan_check',     'County / plan-check comments', 3),
    (new.id, 'construction',   'Construction changes',         4),
    (new.id, 'client_changes', 'Client-requested changes',     5);
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
  recurrence_parent_id uuid unique references tasks(id) on delete set null, -- at most one next occurrence per completed task
  sort_order int not null default 0,
  completed_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint tasks_recurrence_parent_not_self check (recurrence_parent_id <> id)
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
  billable boolean not null default true,        -- internal/rework hours remain recorded without charging the client
  billed boolean not null default false,
  invoice_id uuid references invoices(id) on delete set null,
  deposit_applied numeric check (deposit_applied >= 0), -- deposit credit saved when the remaining work is invoiced; null for legacy/unbilled rows
  created_at timestamptz not null default now(),
  constraint time_entries_nonbillable_unlinked check (
    billable or (not billed and invoice_id is null and coalesce(deposit_applied, 0) = 0)
  )
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

-- ---------- Scheduled (planned) hours, set by dragging on the Gantt chart ----------
create table if not exists schedule_entries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  phase_id uuid references phases(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  date date not null,
  hours numeric not null check (hours > 0),
  note text default '',
  created_at timestamptz not null default now()
);

-- ---------- Billable charges other than hours (expenses, mileage, fees...) ----------
create table if not exists job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  date date not null default current_date,
  category text not null default 'Expense',
  description text not null default '',
  quantity numeric not null default 1,
  unit_price numeric not null default 0,
  billed boolean not null default false,
  invoice_id uuid references invoices(id) on delete set null,
  deposit_applied numeric check (deposit_applied >= 0),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- A recorded credit belongs to an invoice. Unbilling a row or deleting its
-- invoice releases that snapshot so the app can allocate deposits again.
create or replace function clear_unbilled_deposit_applied() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  work_amount numeric;
begin
  if tg_op = 'UPDATE' and old.invoice_id is not null and new.invoice_id is null then
    new.billed := false;
  end if;
  if not new.billed or new.invoice_id is null then
    new.deposit_applied := null;
  end if;
  if tg_table_name = 'time_entries' then
    if not new.billable and (new.billed or new.invoice_id is not null or coalesce(new.deposit_applied, 0) <> 0) then
      raise exception 'Non-billable hours cannot be invoiced or use deposits. Unbill these hours before changing their billing type.';
    end if;
  end if;
  if not new.billed or new.invoice_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.deposit_applied > 0 and old.job_id <> new.job_id then
    raise exception 'Unbill this work before moving it to another job.';
  end if;
  if new.deposit_applied > 0 then
    if tg_table_name = 'time_entries' then
      work_amount := new.hours * coalesce(new.rate,
        (select hourly_rate from public.profiles where id = new.user_id),
        (select default_rate from public.settings where id = 1), 150);
    else
      work_amount := new.quantity * new.unit_price;
    end if;
    if work_amount is null or work_amount::text in ('NaN', 'Infinity', '-Infinity')
        or work_amount < new.deposit_applied then
      raise exception 'Unbill this work before reducing its value below the deposit credit.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists time_entry_deposit_applied on time_entries;
create trigger time_entry_deposit_applied before insert or update on time_entries
  for each row execute function clear_unbilled_deposit_applied();
drop trigger if exists job_item_deposit_applied on job_items;
create trigger job_item_deposit_applied before insert or update on job_items
  for each row execute function clear_unbilled_deposit_applied();

-- ---------- Comments / notes on jobs ----------
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  user_id uuid references profiles(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------- Site visits: notes and photos from the site, printed as an observation report ----------
create table if not exists site_visits (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,   -- the scheduled visit it came from, if any
  visit_date date not null default current_date,
  purpose text not null default '',        -- what was observed, e.g. "Shear wall nailing before drywall"
  weather text not null default '',
  present text not null default '',        -- who was there
  observations text not null default '',   -- one item per line; numbered on the report
  corrections text not null default '',    -- items to fix, one per line
  conclusion text not null default '',     -- closing paragraph
  sent_date date,                          -- when the report went out
  user_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Photo files live in the private "site-photos" storage bucket (see the end of this file).
create table if not exists site_photos (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references site_visits(id) on delete cascade,
  path text not null,                      -- file path in the site-photos bucket
  caption text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- Plan check: the reviewer's comments and your responses, one round at a time ----------
create table if not exists plan_check_rounds (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  round int not null default 1 check (round >= 1),
  agency text not null default '',         -- e.g. "City of Bellingham Permit Center"
  reviewer text not null default '',
  permit_number text not null default '',
  received_date date,                      -- date of the comment letter
  sent_date date,                          -- when the responses went back
  notes text not null default '',          -- cover note printed in the response letter
  created_at timestamptz not null default now()
);

create table if not exists plan_check_comments (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references plan_check_rounds(id) on delete cascade,
  number text not null default '',         -- the reviewer's numbering, e.g. "3" or "S-3"
  comment text not null default '',
  response text not null default '',
  done boolean not null default false,     -- the change is made and the response written
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Create an invoice and all of its work links in one database transaction.
-- SECURITY INVOKER keeps the caller's existing table permissions and RLS.
create or replace function public.record_invoice(
  p_job_id uuid,
  p_number text,
  p_amount numeric,
  p_issued_date date,
  p_paid_date date,
  p_notes text,
  p_links jsonb default '[]'::jsonb
) returns setof public.invoices
language plpgsql security invoker set search_path = public as $$
declare
  work_row record;
  requested_link jsonb;
  validated_links jsonb := '[]'::jsonb;
  available_deposit numeric;
  coverage numeric;
  new_invoice public.invoices%rowtype;
  written_rows int;
begin
  -- Same-job invoice requests serialize here. The row locks below also prevent
  -- ordinary edits from changing the inputs while coverage is being checked.
  perform id from public.jobs where id = p_job_id for update;
  if not found then raise exception 'This job is no longer available.'; end if;
  if p_amount is null or p_amount < 0 or p_amount::text in ('NaN', 'Infinity', '-Infinity')
      or p_issued_date is null then
    raise exception 'Enter a valid invoice amount and issue date.';
  end if;
  if p_links is null or jsonb_typeof(p_links) <> 'array' then
    raise exception 'Selected invoice work must be a list.';
  end if;
  for requested_link in select value from jsonb_array_elements(p_links) loop
    if jsonb_typeof(requested_link) <> 'object'
        or requested_link->>'table' is null
        or requested_link->>'table' not in ('time_entries', 'job_items')
        or jsonb_typeof(requested_link->'id') is distinct from 'string'
        or jsonb_typeof(requested_link->'amount') is distinct from 'number'
        or jsonb_typeof(requested_link->'depositApplied') is distinct from 'number' then
      raise exception 'Selected invoice work is invalid. Refresh Billing and select it again.';
    end if;
    -- Parsing every ID up front also rejects malformed UUIDs before any writes.
    perform (requested_link->>'id')::uuid;
    if (requested_link->>'depositApplied')::numeric < 0 then
      raise exception 'A deposit credit cannot be negative.';
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(p_links) link
    group by link->>'table', (link->>'id')::uuid having count(*) > 1
  ) then
    raise exception 'Selected invoice work contains a duplicate row.';
  end if;

  perform id from public.time_entries where job_id = p_job_id order by id for update;
  perform id from public.job_items where job_id = p_job_id order by id for update;
  perform id from public.deposits where job_id = p_job_id order by id for update;
  perform id from public.profiles where id in
    (select user_id from public.time_entries where job_id = p_job_id) order by id for share;
  perform id from public.settings where id = 1 for share;

  select greatest(0,
      coalesce((select sum(amount) from public.deposits where job_id = p_job_id), 0)
      - coalesce((select sum(greatest(0, coalesce(deposit_applied, 0))) from public.time_entries
          where job_id = p_job_id and billable and billed and hours is not null), 0)
      - coalesce((select sum(greatest(0, coalesce(deposit_applied, 0))) from public.job_items
          where job_id = p_job_id and billed), 0))
    into available_deposit;

  -- Evaluate every row, including unselected work, before changing billing
  -- status. Tie breakers match jobCharges() so equal timestamps are stable.
  for work_row in
    select * from (
      select 'time_entries'::text as table_name, e.id, e.date, e.created_at, e.billed, e.billable,
        e.hours * coalesce(e.rate, p.hourly_rate,
          (select default_rate from public.settings where id = 1), 150) as amount,
        0 as kind_order
      from public.time_entries e left join public.profiles p on p.id = e.user_id
      where e.job_id = p_job_id and e.hours is not null
      union all
      select 'job_items', i.id, i.date, i.created_at, i.billed, true,
        i.quantity * i.unit_price, 1
      from public.job_items i where i.job_id = p_job_id
    ) work order by date, created_at, kind_order, id
  loop
    coverage := 0;
    if work_row.billable and not work_row.billed then
      coverage := greatest(0, least(available_deposit, work_row.amount));
      available_deposit := available_deposit - coverage;
    end if;
    select value into requested_link from jsonb_array_elements(p_links)
      where value->>'table' = work_row.table_name and (value->>'id')::uuid = work_row.id;
    if requested_link is not null then
      if not work_row.billable then
        raise exception 'Non-billable hours cannot be invoiced. Select billable work only.';
      end if;
      if work_row.billed or work_row.amount is null
          or work_row.amount::text in ('NaN', 'Infinity', '-Infinity')
          or abs(work_row.amount - (requested_link->>'amount')::numeric) > 0.000001
          or abs(coverage - (requested_link->>'depositApplied')::numeric) > 0.000001 then
        raise exception 'Selected work or its deposit credit changed. Refresh Billing and select it again.';
      end if;
      validated_links := validated_links || jsonb_build_array(jsonb_build_object(
        'table', work_row.table_name, 'id', work_row.id, 'depositApplied', coverage));
    end if;
  end loop;
  if jsonb_array_length(validated_links) <> jsonb_array_length(p_links) then
    raise exception 'Selected work is missing or belongs to another job. Refresh Billing and select it again.';
  end if;

  insert into public.invoices (job_id, number, amount, issued_date, paid_date, notes)
    values (p_job_id, coalesce(p_number, ''), p_amount, p_issued_date, p_paid_date, coalesce(p_notes, ''))
    returning * into new_invoice;
  for requested_link in select value from jsonb_array_elements(validated_links) loop
    if requested_link->>'table' = 'time_entries' then
      update public.time_entries set billed = true, invoice_id = new_invoice.id,
        deposit_applied = (requested_link->>'depositApplied')::numeric
        where id = (requested_link->>'id')::uuid and job_id = p_job_id and billable and not billed;
    else
      update public.job_items set billed = true, invoice_id = new_invoice.id,
        deposit_applied = (requested_link->>'depositApplied')::numeric
        where id = (requested_link->>'id')::uuid and job_id = p_job_id and not billed;
    end if;
    get diagnostics written_rows = row_count;
    if written_rows <> 1 then
      raise exception 'Selected work could not be billed. No invoice was saved.';
    end if;
  end loop;
  return next new_invoice;
end $$;

revoke all on function public.record_invoice(uuid, text, numeric, date, date, text, jsonb) from public, anon;
grant execute on function public.record_invoice(uuid, text, numeric, date, date, text, jsonb) to authenticated;


-- ---------- Indexes ----------
create index if not exists jobs_client_idx on jobs(client_id);
create index if not exists phases_job_idx on phases(job_id);
create index if not exists tasks_job_idx on tasks(job_id);
create index if not exists tasks_phase_idx on tasks(phase_id);
create index if not exists time_job_idx on time_entries(job_id);
create index if not exists time_user_idx on time_entries(user_id);
create index if not exists comments_job_idx on comments(job_id);
create index if not exists deposits_job_idx on deposits(job_id);
create index if not exists job_items_job_idx on job_items(job_id);
create index if not exists jobs_type_idx on jobs(job_type_id);
create index if not exists quotes_job_idx on quotes(job_id);
create index if not exists past_jobs_type_idx on past_jobs(job_type_id);
create index if not exists schedule_date_idx on schedule_entries(date);
create index if not exists schedule_job_idx on schedule_entries(job_id);
create index if not exists site_visits_job_idx on site_visits(job_id);
create index if not exists site_photos_visit_idx on site_photos(visit_id);
create index if not exists plan_check_rounds_job_idx on plan_check_rounds(job_id);
create index if not exists plan_check_comments_round_idx on plan_check_comments(round_id);

-- ---------- Security: only signed-in team members can see or change data ----------
alter table settings     enable row level security;
alter table profiles     enable row level security;
alter table clients      enable row level security;
alter table job_types    enable row level security;
alter table quotes       enable row level security;
alter table past_jobs    enable row level security;
alter table jobs         enable row level security;
alter table phases       enable row level security;
alter table tasks        enable row level security;
alter table invoices     enable row level security;
alter table deposits     enable row level security;
alter table job_items    enable row level security;
alter table schedule_entries enable row level security;
alter table time_entries enable row level security;
alter table comments     enable row level security;
alter table site_visits  enable row level security;
alter table site_photos  enable row level security;
alter table plan_check_rounds   enable row level security;
alter table plan_check_comments enable row level security;

do $$
declare t text;
begin
  foreach t in array array['settings','profiles','clients','job_types','past_jobs','jobs','quotes','phases','tasks','invoices','deposits','job_items','schedule_entries','time_entries','comments','site_visits','site_photos','plan_check_rounds','plan_check_comments'] loop
    execute format('drop policy if exists team_all on %I', t);
    execute format('create policy team_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------- Live sync across devices ----------
do $$
declare t text;
begin
  foreach t in array array['settings','profiles','clients','job_types','past_jobs','jobs','quotes','phases','tasks','invoices','deposits','job_items','schedule_entries','time_entries','comments','site_visits','site_photos','plan_check_rounds','plan_check_comments'] loop
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

  -- Phase details (the trigger already created the five workflow phases per job)
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
  -- Sample jobs are past bidding. Their historical queue-entry dates stay separate.
  update phases set status = 'complete' where kind = 'bidding' and job_id in (j1, j2, j3, j4);
  update jobs set queued_date = start_date - 10 where id in (j1, j2, j3, j4);

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

  -- Charges other than hours
  insert into job_items (job_id, date, category, description, quantity, unit_price) values
    (j1, current_date - 6, 'Mileage', 'Site visit round trip', 42, 0.70),
    (j2, current_date - 12, 'Permit / filing fee', 'County plan-check resubmittal fee', 1, 185),
    (j2, current_date - 5, 'Printing / plotting', '24x36 sets for resubmittal', 4, 12.50);

  -- Deposits: one used up (Smith, now has unbilled work), one with money left (Industrial Way)
  insert into deposits (job_id, amount, received_date, method, notes) values
    (j1, 2500, current_date - 21, 'Check', 'Retainer at signing'),
    (j3, 1000, current_date - 60, 'ACH / transfer', 'Retainer at signing');
end $$;

-- ---------- Morning review, follow-ups, availability and planning activity ----------
-- Additive planning workspace. Existing business rows and financial functions
-- are not rewritten. Activity starts when these triggers are installed.
create schema if not exists planning_private;
revoke all on schema planning_private from public, anon;
grant usage on schema planning_private to authenticated;

create function planning_private.valid_date(value text) returns boolean
language plpgsql immutable strict security invoker set search_path = '' as $$
begin
  if value !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  return value::date::text = value;
exception when others then return false;
end $$;

create function planning_private.valid_priorities(value jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare item jsonb; ids text[] := '{}';
begin
  if value is null or jsonb_typeof(value) <> 'array' then return false; end if;
  if jsonb_array_length(value) > 100 then return false; end if;
  for item in select * from jsonb_array_elements(value) loop
    if jsonb_typeof(item) <> 'object'
      or not (item ?& array['id','title','job_id','done'])
      or exists(select 1 from jsonb_object_keys(item) k where k <> all(array['id','title','job_id','done','source_id']))
      or jsonb_typeof(item->'id') <> 'string' or length(item->>'id') not between 1 and 200
      or jsonb_typeof(item->'title') <> 'string' or length(btrim(item->>'title')) not between 1 and 1000
      or jsonb_typeof(item->'done') <> 'boolean'
      or (jsonb_typeof(item->'job_id') <> 'null' and (jsonb_typeof(item->'job_id') <> 'string' or (item->>'job_id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'))
      or (item ? 'source_id' and (jsonb_typeof(item->'source_id') <> 'string' or length(item->>'source_id') not between 1 and 200))
      or (item->>'id') = any(ids) then return false; end if;
    ids := array_append(ids,item->>'id');
  end loop;
  return true;
end $$;

create function planning_private.valid_contact_log(value jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare item jsonb; ids text[] := '{}';
begin
  if value is null or jsonb_typeof(value) <> 'array' then return false; end if;
  if jsonb_array_length(value) > 500 then return false; end if;
  for item in select * from jsonb_array_elements(value) loop
    if jsonb_typeof(item) <> 'object' or not (item ?& array['id','date','note'])
      or exists(select 1 from jsonb_object_keys(item) k where k <> all(array['id','date','note','promised_date']))
      or jsonb_typeof(item->'id') <> 'string' or length(item->>'id') not between 1 and 200
      or jsonb_typeof(item->'note') <> 'string' or length(btrim(item->>'note')) not between 1 and 20000
      or jsonb_typeof(item->'date') <> 'string' or not planning_private.valid_date(item->>'date')
      or (item ? 'promised_date' and jsonb_typeof(item->'promised_date') <> 'null' and (jsonb_typeof(item->'promised_date') <> 'string' or not planning_private.valid_date(item->>'promised_date')))
      or (item->>'id') = any(ids) then return false; end if;
    ids := array_append(ids,item->>'id');
  end loop;
  return true;
end $$;
revoke all on function planning_private.valid_date(text), planning_private.valid_priorities(jsonb), planning_private.valid_contact_log(jsonb) from public, anon;
grant execute on function planning_private.valid_date(text), planning_private.valid_priorities(jsonb), planning_private.valid_contact_log(jsonb) to authenticated;

create table public.daily_reviews (
  id uuid primary key default gen_random_uuid(),
  review_date date not null unique,
  checkpoint_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  notes text not null default '',
  priorities jsonb not null default '[]' check (planning_private.valid_priorities(priorities)),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete set null,
  invoice_id uuid unique references public.invoices(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 1000),
  waiting_on text not null default '', reason text not null default '',
  status text not null default 'open' check (status in ('open','done')),
  next_follow_up_date date, promised_date date, invoice_due_date date,
  contact_log jsonb not null default '[]' check (planning_private.valid_contact_log(contact_log)),
  notes text not null default '',
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
create table public.daily_availability (
  id uuid primary key default gen_random_uuid(), date date not null unique,
  base_hours numeric not null check (base_hours between 0 and 24), note text not null default '',
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp()
);
create table public.availability_blocks (
  id uuid primary key default gen_random_uuid(), date date not null,
  title text not null check (length(btrim(title)) between 1 and 1000),
  kind text not null default 'other' check (kind in ('appointment','travel','admin','time_off','buffer','other')),
  hours numeric not null check (hours > 0 and hours <= 24), note text not null default '',
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp()
);
create table public.job_planning (
  id uuid primary key default gen_random_uuid(), job_id uuid not null unique references public.jobs(id) on delete cascade,
  status_update text not null default '', next_deliverable text not null default '',
  remaining_hours numeric check (remaining_hours >= 0 and remaining_hours::text not in ('NaN','Infinity','-Infinity')),
  internal_target_date date, client_commitment_date date,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp()
);
create table public.job_decisions (
  id uuid primary key default gen_random_uuid(), job_id uuid references public.jobs(id) on delete set null,
  kind text not null default 'decision' check (kind in ('decision','scope_change')),
  title text not null check (length(btrim(title)) between 1 and 1000), notes text not null default '',
  estimated_hours numeric check (estimated_hours >= 0 and estimated_hours::text not in ('NaN','Infinity','-Infinity')),
  billing_treatment text not null default 'undecided' check (billing_treatment in ('undecided','billable','included','nonbillable')),
  approval text not null default 'not_needed' check (approval in ('not_needed','needed','approved','declined')),
  recorded_date date not null default current_date,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp()
);
create table public.planning_events (
  id uuid primary key default gen_random_uuid(), occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid references auth.users(id) on delete set null,
  entity_type text not null, entity_id uuid not null,
  job_id uuid references public.jobs(id) on delete set null,
  action text not null check (action in ('insert','update','delete')),
  summary text not null, changed_fields text[] not null default '{}'
);
create index follow_ups_job_idx on public.follow_ups(job_id);
create index follow_ups_open_date_idx on public.follow_ups(next_follow_up_date) where status='open';
create index availability_blocks_date_idx on public.availability_blocks(date);
create index job_decisions_job_idx on public.job_decisions(job_id);
create index planning_events_time_idx on public.planning_events(occurred_at desc,id);
create index planning_events_job_idx on public.planning_events(job_id,occurred_at desc);
create index planning_events_actor_idx on public.planning_events(actor_id);

create function planning_private.prepare_record() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    new.created_at := statement_timestamp();
    if tg_table_name = 'daily_reviews' then new.checkpoint_at := clock_timestamp(); end if;
  else
    new.revision := old.revision + 1;
    new.created_at := old.created_at;
    if tg_table_name = 'daily_reviews' then
      if new.checkpoint_at is distinct from old.checkpoint_at then
        raise exception 'A saved review checkpoint cannot be changed' using errcode='23514';
      end if;
    end if;
  end if;
  if tg_table_name='follow_ups' then
    if new.invoice_id is not null and new.job_id is not null
       and not exists(select 1 from public.invoices i where i.id=new.invoice_id and i.job_id=new.job_id) then
      raise exception 'The follow-up invoice belongs to another job' using errcode='23514';
    end if;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
revoke all on function planning_private.prepare_record() from public, anon, authenticated;

create function planning_private.record_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  before_row jsonb := '{}'::jsonb; after_row jsonb := '{}'::jsonb; source_row jsonb;
  fields text[]; linked_job uuid; label text; actor uuid := auth.uid();
begin
  if tg_table_schema <> 'public' or tg_table_name <> all(array['jobs','phases','tasks','time_entries','invoices','deposits','job_items','comments','schedule_entries','daily_reviews','follow_ups','daily_availability','availability_blocks','job_planning','job_decisions']) then
    raise exception 'Unsupported planning activity source';
  end if;
  if tg_op <> 'INSERT' then before_row := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then after_row := to_jsonb(new); end if;
  select coalesce(array_agg(key order by key),'{}'::text[]) into fields
    from (select jsonb_object_keys(before_row || after_row) as key) keys
    where key <> all(array['revision','updated_at']) and before_row->key is distinct from after_row->key;
  if cardinality(fields)=0 then return null; end if;
  source_row := case when tg_op='DELETE' then before_row else after_row end;
  linked_job := case when tg_table_name='jobs' then (source_row->>'id')::uuid else (source_row->>'job_id')::uuid end;
  -- Deleted jobs have no live FK target; entity_id still preserves their identity.
  if linked_job is not null and not exists(select 1 from public.jobs where id=linked_job) then linked_job := null; end if;
  label := coalesce(nullif(source_row->>'name',''),nullif(source_row->>'title',''),
    case tg_table_name when 'time_entries' then 'Hours' when 'invoices' then 'Invoice ' || coalesce(source_row->>'number','')
      when 'deposits' then 'Deposit' when 'job_items' then 'Charge' when 'comments' then 'Job note'
      when 'schedule_entries' then 'Planned hours' when 'daily_reviews' then 'Daily review'
      when 'daily_availability' then 'Daily availability' when 'job_planning' then 'Job planning' else tg_table_name end);
  if tg_table_name in ('daily_availability','schedule_entries','availability_blocks') then
    label := label || ' · ' || (source_row->>'date');
  end if;
  -- auth.uid() supplies the actor, never a caller-supplied field. Service/DB
  -- operations legitimately have no actor. No old/new row values are copied.
  insert into public.planning_events(actor_id,entity_type,entity_id,job_id,action,summary,changed_fields)
    values(actor,tg_table_name,(source_row->>'id')::uuid,linked_job,lower(tg_op),initcap(lower(tg_op)) || ': ' || left(label,1000),fields);
  return null;
end $$;
revoke all on function planning_private.record_event() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['daily_reviews','follow_ups','daily_availability','availability_blocks','job_planning','job_decisions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public, anon, authenticated',t);
    execute format('grant select,insert,update,delete on table public.%I to authenticated',t);
    execute format('create policy planning_business on public.%I for all to authenticated using (true) with check (true)',t);
    execute format('create trigger planning_record_before before insert or update on public.%I for each row execute function planning_private.prepare_record()',t);
  end loop;
  alter table public.planning_events enable row level security;
  revoke all on public.planning_events from public, anon, authenticated;
  grant select on public.planning_events to authenticated;
  create policy planning_events_read on public.planning_events for select to authenticated using (true);
  foreach t in array array['jobs','phases','tasks','time_entries','invoices','deposits','job_items','comments','schedule_entries','daily_reviews','follow_ups','daily_availability','availability_blocks','job_planning','job_decisions'] loop
    execute format('create trigger planning_activity_after after insert or update or delete on public.%I for each row execute function planning_private.record_event()',t);
  end loop;
  foreach t in array array['daily_reviews','follow_ups','daily_availability','availability_blocks','job_planning','job_decisions','planning_events'] loop
    execute format('alter publication supabase_realtime add table public.%I',t);
  end loop;
end $$;

create function public.apply_planning_schedule_moves(p_moves jsonb) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare item jsonb; row public.schedule_entries%rowtype; who uuid := auth.uid(); count_locked integer := 0;
begin
  if who is null then raise exception 'Sign in before moving plans' using errcode='42501'; end if;
  if p_moves is null or jsonb_typeof(p_moves)<>'array' then raise exception 'Expected a list of schedule moves'; end if;
  if jsonb_array_length(p_moves) not between 1 and 200 then raise exception 'Select between 1 and 200 saved plans'; end if;
  for item in select * from jsonb_array_elements(p_moves) loop
    if jsonb_typeof(item)<>'object' or not(item ?& array['id','expected_job_id','expected_phase_id','expected_date','expected_hours','date','hours'])
      or jsonb_typeof(item->'id')<>'string' or jsonb_typeof(item->'expected_job_id')<>'string'
      or jsonb_typeof(item->'expected_phase_id') not in ('string','null')
      or jsonb_typeof(item->'expected_date')<>'string' or not planning_private.valid_date(item->>'expected_date')
      or jsonb_typeof(item->'date')<>'string' or not planning_private.valid_date(item->>'date')
      or jsonb_typeof(item->'expected_hours')<>'number' or (item->>'expected_hours')::numeric<=0
      or jsonb_typeof(item->'hours')<>'number' or (item->>'hours')::numeric<=0 or (item->>'hours')::numeric>24 then
      raise exception 'Invalid schedule move. Refresh the preview and choose valid dates and hours';
    end if;
    perform (item->>'id')::uuid,(item->>'expected_job_id')::uuid,(item->>'expected_phase_id')::uuid;
  end loop;
  if (select count(distinct (value->>'id')::uuid) from jsonb_array_elements(p_moves))<>jsonb_array_length(p_moves) then raise exception 'A plan was selected more than once'; end if;
  -- Legacy schedules may have duplicate slots, so no unique constraint can be
  -- added safely. This short transaction also serializes normal client writes
  -- while checking otherwise unlocked destination gaps.
  lock table public.schedule_entries in share row exclusive mode;
  -- Stable job/phase/row lock order protects status and workflow checks and
  -- serializes moves on the same jobs without changing stored ownership.
  perform j.id from public.jobs j where j.id in (select (value->>'expected_job_id')::uuid from jsonb_array_elements(p_moves)) order by j.id for update;
  perform p.id from public.phases p where p.id in (select (value->>'expected_phase_id')::uuid from jsonb_array_elements(p_moves)) order by p.id for update;
  for row in select s.* from public.schedule_entries s where s.id in (select (value->>'id')::uuid from jsonb_array_elements(p_moves)) order by s.id for update loop
    count_locked := count_locked+1;
    select value into item from jsonb_array_elements(p_moves) where (value->>'id')::uuid=row.id;
    if row.user_id<>who or row.job_id<>(item->>'expected_job_id')::uuid or row.phase_id is distinct from (item->>'expected_phase_id')::uuid
      or row.date<>(item->>'expected_date')::date or row.hours<>(item->>'expected_hours')::numeric
      or not exists(select 1 from public.jobs j where j.id=row.job_id and j.status='active')
      or (row.phase_id is not null and not exists(select 1 from public.phases p where p.id=row.phase_id and p.job_id=row.job_id and p.kind<>'queued')) then
      raise exception 'A selected plan changed, belongs to another owner, or is outside active workflow. Refresh the preview';
    end if;
  end loop;
  if count_locked<>jsonb_array_length(p_moves) then raise exception 'A selected plan no longer exists. Refresh the preview'; end if;
  if exists(select 1 from jsonb_array_elements(p_moves) a group by (a->>'expected_job_id')::uuid,(a->>'expected_phase_id')::uuid,(a->>'date')::date having count(*)>1) then
    raise exception 'Selected plans would occupy the same job/phase/day slot';
  end if;
  if exists(select 1 from jsonb_array_elements(p_moves) a join public.schedule_entries s
    on s.job_id=(a->>'expected_job_id')::uuid and s.phase_id is not distinct from (a->>'expected_phase_id')::uuid and s.user_id=who and s.date=(a->>'date')::date
    where s.id not in (select (value->>'id')::uuid from jsonb_array_elements(p_moves))) then
    raise exception 'A destination already has a saved plan. Choose another day or edit the existing plan';
  end if;
  -- Every check completes before any mutation. Swaps among selected rows work.
  update public.schedule_entries s set date=(m.value->>'date')::date,hours=(m.value->>'hours')::numeric
    from jsonb_array_elements(p_moves) m(value) where s.id=(m.value->>'id')::uuid;
  return true;
end $$;
revoke all on function public.apply_planning_schedule_moves(jsonb) from public, anon;
grant execute on function public.apply_planning_schedule_moves(jsonb) to authenticated;

-- ---------- Client-specific job priorities ----------
-- Client priorities are independent of the overall Jobs queue.
alter table public.jobs add column if not exists client_priority integer;

-- Start each client's list in its current queue order, including retained history.
with ranked as (
  select id, row_number() over (partition by client_id order by priority, created_at, id)::integer as position
  from public.jobs
)
update public.jobs j set client_priority = ranked.position
from ranked where j.id = ranked.id and j.client_priority is null;

-- The parent lock serializes appends with other appends and reorders for this client.
create or replace function public.append_client_job_priority() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.client_id is not distinct from old.client_id then
    return new;
  end if;
  perform id from public.clients where id = new.client_id for update;
  if not found then
    raise exception 'Client not found.' using errcode = '23503';
  end if;
  select greatest(coalesce(max(coalesce(j.client_priority, j.priority)), 0), 0) + 1
    into new.client_priority
    from public.jobs j where j.client_id = new.client_id and j.id <> new.id;
  return new;
end;
$$;
revoke all on function public.append_client_job_priority() from public, anon, authenticated;
create or replace trigger append_client_job_priority
  before insert or update of client_id on public.jobs
  for each row execute function public.append_client_job_priority();

-- One transaction updates the whole list. A stale open-job order is rejected;
-- complete/cancelled/archived jobs retain their slots for later reopening.
create or replace function public.reorder_client_jobs(
  p_client_id uuid, p_expected_ids uuid[], p_ordered_ids uuid[]
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_all_ids uuid[];
  v_current_ids uuid[];
  v_sorted_expected uuid[];
  v_sorted_ordered uuid[];
  v_new_ids uuid[] := '{}'::uuid[];
  v_id uuid;
  v_index integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in to order client jobs.' using errcode = '42501';
  end if;
  if p_expected_ids is null or p_ordered_ids is null then
    raise exception 'A complete job order is required.' using errcode = '22023';
  end if;
  -- UPDATE locks its job before the append trigger locks the client. Use the
  -- same order here to avoid an inverse lock order when a job changes clients.
  perform id from public.jobs where client_id = p_client_id order by id for update;
  perform id from public.clients where id = p_client_id for update;
  if not found then
    raise exception 'Client not found.' using errcode = '22023';
  end if;
  -- Catch rows appended while waiting for the parent lock and freeze statuses.
  perform id from public.jobs where client_id = p_client_id order by id for update;
  select coalesce(array_agg(id order by coalesce(client_priority, priority), priority, created_at, id), '{}'::uuid[]),
    coalesce(array_agg(id order by coalesce(client_priority, priority), priority, created_at, id)
      filter (where status in ('active', 'on_hold')), '{}'::uuid[])
    into v_all_ids, v_current_ids from public.jobs where client_id = p_client_id;
  if v_current_ids is distinct from p_expected_ids then
    raise exception 'The client job list changed. Refresh and try again.' using errcode = '40001';
  end if;
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_sorted_expected from unnest(p_expected_ids) as ids(id);
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_sorted_ordered from unnest(p_ordered_ids) as ids(id);
  if v_sorted_expected is distinct from v_sorted_ordered then
    raise exception 'The new order must contain each open client job exactly once.' using errcode = '22023';
  end if;
  foreach v_id in array v_all_ids loop
    if v_id = any(v_current_ids) then
      v_index := v_index + 1;
      v_new_ids := array_append(v_new_ids, p_ordered_ids[v_index]);
    else
      v_new_ids := array_append(v_new_ids, v_id);
    end if;
  end loop;
  update public.jobs j set client_priority = ordered.position::integer
    from unnest(v_new_ids) with ordinality as ordered(id, position)
    where j.id = ordered.id and j.client_id = p_client_id
      and j.client_priority is distinct from ordered.position::integer;
end;
$$;
revoke all on function public.reorder_client_jobs(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.reorder_client_jobs(uuid, uuid[], uuid[]) to authenticated;

-- ---------- Site photo files (private storage; only signed-in users can see them) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-photos', 'site-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

do $$
declare op text;
begin
  foreach op in array array['select', 'insert', 'update', 'delete'] loop
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'site_photos_' || op) then
      execute format(
        'create policy %I on storage.objects for %s to authenticated %s',
        'site_photos_' || op, op,
        case op when 'insert' then 'with check (bucket_id = ''site-photos'')'
                when 'update' then 'using (bucket_id = ''site-photos'') with check (bucket_id = ''site-photos'')'
                else 'using (bucket_id = ''site-photos'')' end);
    end if;
  end loop;
end $$;
