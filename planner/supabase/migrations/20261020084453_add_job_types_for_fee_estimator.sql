-- Fee estimator: job types with the owner's usual hours per phase, and a link
-- from each job to its type so finished jobs refine the estimate.
create table if not exists public.job_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  design_hours numeric not null default 0 check (design_hours >= 0),
  plan_check_hours numeric not null default 0 check (plan_check_hours >= 0),
  construction_hours numeric not null default 0 check (construction_hours >= 0),
  notes text not null default '',
  created_at timestamptz not null default now()
);

alter table public.jobs
  add column if not exists job_type_id uuid references public.job_types(id) on delete set null;
create index if not exists jobs_type_idx on public.jobs(job_type_id);

alter table public.job_types enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'job_types' and policyname = 'team_all') then
    create policy team_all on public.job_types for all to authenticated using (true) with check (true);
  end if;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.job_types;
exception when duplicate_object then null;
end $$;
