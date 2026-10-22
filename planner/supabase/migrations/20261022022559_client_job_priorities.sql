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
