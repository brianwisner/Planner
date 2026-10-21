-- Fee estimator, round 2: saved quotes (the original quote survives later edits),
-- which finished jobs to learn from, job size, site visits, a minimum fee,
-- a retainer and a proposal template.
alter table public.settings
  add column if not exists minimum_fee numeric not null default 0 check (minimum_fee >= 0),
  add column if not exists site_visit_hours numeric not null default 3 check (site_visit_hours >= 0),
  add column if not exists retainer_percent numeric not null default 0 check (retainer_percent between 0 and 100),
  add column if not exists proposal_template text not null default '';

alter table public.job_types
  add column if not exists site_visits numeric not null default 0 check (site_visits >= 0),
  add column if not exists size_unit text not null default '';

alter table public.jobs
  add column if not exists size numeric check (size >= 0),
  add column if not exists use_in_estimates boolean not null default true,
  add column if not exists estimate_note text not null default '',
  add column if not exists closeout_reason text not null default '';

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  job_type_id uuid references public.job_types(id) on delete set null,
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
create index if not exists quotes_job_idx on public.quotes(job_id);

alter table public.quotes enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'quotes' and policyname = 'team_all') then
    create policy team_all on public.quotes for all to authenticated using (true) with check (true);
  end if;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.quotes;
exception when duplicate_object then null;
end $$;
