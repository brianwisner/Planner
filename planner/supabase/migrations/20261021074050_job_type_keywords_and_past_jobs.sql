-- Fee estimator, round 3: key words for automatic job typing, and past jobs
-- from before the planner (email, invoices, files) as fee evidence.
alter table public.job_types
  add column if not exists keywords text not null default '';

create table if not exists public.past_jobs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client text not null default '',
  address text not null default '',
  job_type_id uuid references public.job_types(id) on delete set null,
  date date,
  fee numeric check (fee >= 0),
  hours numeric check (hours >= 0),
  size numeric check (size >= 0),
  scope text not null default '',
  source text not null default '',
  use_in_estimates boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists past_jobs_type_idx on public.past_jobs(job_type_id);

alter table public.past_jobs enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'past_jobs' and policyname = 'team_all') then
    create policy team_all on public.past_jobs for all to authenticated using (true) with check (true);
  end if;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.past_jobs;
exception when duplicate_object then null;
end $$;
