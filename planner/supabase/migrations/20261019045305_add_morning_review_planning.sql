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
