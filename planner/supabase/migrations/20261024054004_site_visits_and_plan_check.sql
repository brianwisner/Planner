-- Site visit reports (notes + photos) and plan check comment tracking,
-- plus letterhead/signature settings used on reports, letters and invoices.
alter table public.settings
  add column if not exists letterhead text not null default '',
  add column if not exists signature text not null default '',
  add column if not exists visit_closing text not null default '';

create table if not exists public.site_visits (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  visit_date date not null default current_date,
  purpose text not null default '',
  weather text not null default '',
  present text not null default '',
  observations text not null default '',
  corrections text not null default '',
  conclusion text not null default '',
  sent_date date,
  user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.site_photos (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.site_visits(id) on delete cascade,
  path text not null,
  caption text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.plan_check_rounds (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  round int not null default 1 check (round >= 1),
  agency text not null default '',
  reviewer text not null default '',
  permit_number text not null default '',
  received_date date,
  sent_date date,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.plan_check_comments (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.plan_check_rounds(id) on delete cascade,
  number text not null default '',
  comment text not null default '',
  response text not null default '',
  done boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists site_visits_job_idx on public.site_visits(job_id);
create index if not exists site_photos_visit_idx on public.site_photos(visit_id);
create index if not exists plan_check_rounds_job_idx on public.plan_check_rounds(job_id);
create index if not exists plan_check_comments_round_idx on public.plan_check_comments(round_id);

do $$
declare t text;
begin
  foreach t in array array['site_visits', 'site_photos', 'plan_check_rounds', 'plan_check_comments'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'team_all') then
      execute format('create policy team_all on public.%I for all to authenticated using (true) with check (true)', t);
    end if;
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Photo files: a private bucket that only signed-in users can read or write.
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
