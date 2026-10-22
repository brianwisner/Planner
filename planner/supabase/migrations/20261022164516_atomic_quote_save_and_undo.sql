-- Atomic, retry-safe quote saves and guarded undo. No existing business rows change.
-- The receipt survives undo so a lost response cannot create or delete a second quote.
create table if not exists public.quote_save_requests (
  request_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  quote_id uuid not null,
  quote_payload jsonb not null,
  expected_snapshot jsonb not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  quote_snapshot jsonb not null,
  prior_quote_ids uuid[] not null,
  created_at timestamptz not null default clock_timestamp(),
  undone_at timestamptz
);
create index if not exists quote_save_requests_job_idx on public.quote_save_requests(job_id);
alter table public.quote_save_requests enable row level security;
drop policy if exists owner_requests on public.quote_save_requests;
create policy owner_requests on public.quote_save_requests for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.quote_save_requests from public, anon, authenticated;
grant select, insert, update on public.quote_save_requests to authenticated;

create or replace function public.record_quote(p_request_id uuid, p_quote jsonb, p_expected jsonb)
returns public.quotes
language plpgsql security invoker set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_job_id uuid;
  v_type_id uuid;
  v_receipt public.quote_save_requests%rowtype;
  v_quote public.quotes%rowtype;
  v_job public.jobs%rowtype;
  v_expected jsonb;
  v_before jsonb;
  v_after jsonb;
  v_phases jsonb;
  v_prior_ids uuid[];
  v_field text;
  v_phase jsonb;
  v_count integer;
  v_hours numeric;
begin
  if v_owner is null then
    raise exception 'Sign in to save a quote.' using errcode = '42501';
  end if;
  if p_request_id is null or jsonb_typeof(p_quote) is distinct from 'object'
    or jsonb_typeof(p_expected) is distinct from 'object' then
    raise exception 'A request ID, complete quote, and original job snapshot are required.' using errcode = '22023';
  end if;
  if not (p_quote ?& array['job_id','job_type_id','rate','design_hours','plan_check_hours','construction_hours',
      'site_visits','visit_hours','allowance_hours','rush_percent','size','suggested_fee','fee','fee_note'])
    or (p_quote - array['job_id','job_type_id','rate','design_hours','plan_check_hours','construction_hours',
      'site_visits','visit_hours','allowance_hours','rush_percent','size','suggested_fee','fee','fee_note']) <> '{}'::jsonb
    or jsonb_typeof(p_quote->'job_id') is distinct from 'string'
    or jsonb_typeof(p_quote->'job_type_id') not in ('string','null')
    or jsonb_typeof(p_quote->'fee_note') is distinct from 'string' then
    raise exception 'The quote must contain exactly the supported quote fields.' using errcode = '22023';
  end if;
  foreach v_field in array array['rate','design_hours','plan_check_hours','construction_hours',
      'site_visits','visit_hours','allowance_hours','rush_percent','suggested_fee','fee'] loop
    if jsonb_typeof(p_quote->v_field) is distinct from 'number' then
      raise exception 'Quote % must be a nonnegative number.', v_field using errcode = '22023';
    end if;
    if (p_quote->>v_field)::numeric < 0 then
      raise exception 'Quote % must be a nonnegative number.', v_field using errcode = '22023';
    end if;
  end loop;
  if jsonb_typeof(p_quote->'size') not in ('number','null') then
    raise exception 'Quote size must be a nonnegative number or blank.' using errcode = '22023';
  end if;
  if (p_quote->>'size')::numeric < 0 then
    raise exception 'Quote size must be a nonnegative number or blank.' using errcode = '22023';
  end if;
  if not (p_expected ?& array['fee','job_type_id','size','phases'])
    or (p_expected - array['fee','job_type_id','size','phases']) <> '{}'::jsonb
    or jsonb_typeof(p_expected->'fee') not in ('number','null')
    or jsonb_typeof(p_expected->'size') not in ('number','null')
    or jsonb_typeof(p_expected->'job_type_id') not in ('string','null')
    or jsonb_typeof(p_expected->'phases') is distinct from 'array' then
    raise exception 'The original job snapshot is incomplete.' using errcode = '22023';
  end if;
  begin
    v_job_id := (p_quote->>'job_id')::uuid;
    v_type_id := (p_quote->>'job_type_id')::uuid;
    perform (p_expected->>'job_type_id')::uuid;
    for v_phase in select value from jsonb_array_elements(p_expected->'phases') loop
      if jsonb_typeof(v_phase) is distinct from 'object'
        or not (v_phase ?& array['id','estimate_hours'])
        or (v_phase - array['id','estimate_hours']) <> '{}'::jsonb
        or jsonb_typeof(v_phase->'id') is distinct from 'string'
        or jsonb_typeof(v_phase->'estimate_hours') is distinct from 'number' then
        raise exception 'Each original phase requires its ID and estimated hours.' using errcode = '22023';
      end if;
      perform (v_phase->>'id')::uuid;
    end loop;
  exception when invalid_text_representation then
    raise exception 'The quote and snapshot must use valid job, type, and phase IDs.' using errcode = '22023';
  end;
  if exists (select 1 from jsonb_array_elements(p_expected->'phases') as e
      group by (e->>'id')::uuid having count(*) > 1) then
    raise exception 'The original snapshot contains a duplicate phase.' using errcode = '22023';
  end if;
  -- Canonicalize IDs and phase order, but retain every original value for retries.
  select coalesce(jsonb_agg(jsonb_build_object('id', (e->>'id')::uuid,
      'estimate_hours', (e->>'estimate_hours')::numeric) order by (e->>'id')::uuid), '[]'::jsonb)
    into v_phases from jsonb_array_elements(p_expected->'phases') as e;
  v_expected := jsonb_build_object('fee', (p_expected->>'fee')::numeric,
    'job_type_id', (p_expected->>'job_type_id')::uuid, 'size', (p_expected->>'size')::numeric, 'phases', v_phases);

  -- A request-scoped lock also serializes competing uses of a new request ID.
  -- All quote RPCs use request -> job -> phases -> quotes lock order.
  perform pg_advisory_xact_lock(hashtextextended('record_quote:' || p_request_id::text, 0));
  select * into v_receipt from public.quote_save_requests where request_id = p_request_id for update;
  if found then
    if v_receipt.quote_payload is distinct from p_quote or v_receipt.expected_snapshot is distinct from v_expected then
      raise exception 'This quote request was already used with different values. Start a new save.' using errcode = '22023';
    end if;
    if v_receipt.undone_at is not null then
      raise exception 'This quote save was already undone. Start a new save.' using errcode = '40001';
    end if;
    -- A retry never rewrites current work, but must not report a missing or
    -- externally edited quote as though the original save were still intact.
    select * into v_quote from public.quotes where id = v_receipt.quote_id;
    if not found or to_jsonb(v_quote) is distinct from v_receipt.quote_snapshot then
      raise exception 'The saved quote was changed or removed after this request. Refresh and review before saving again.' using errcode = '40001';
    end if;
    return v_quote;
  end if;

  select * into v_job from public.jobs where id = v_job_id for update;
  if not found then
    raise exception 'The job no longer exists or is not accessible. Refresh and try again.' using errcode = '40001';
  end if;
  -- FOR UPDATE on the job also conflicts with FK checks for new phases/quotes.
  -- Lock ALL phases so an existing non-fee phase cannot change kind mid-save.
  perform id from public.phases where job_id = v_job_id order by id for update;
  perform id from public.quotes where job_id = v_job_id order by id for update;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'estimate_hours', estimate_hours) order by id), '[]'::jsonb)
    into v_phases from public.phases where job_id = v_job_id and kind in ('design','plan_check','construction');
  if v_expected is distinct from jsonb_build_object('fee', v_job.fee, 'job_type_id', v_job.job_type_id,
      'size', v_job.size, 'phases', v_phases) then
    raise exception 'The job or its phase estimates changed. Refresh and review the quote before saving.' using errcode = '40001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'estimate_hours', estimate_hours) order by id), '[]'::jsonb)
    into v_phases from public.phases where job_id = v_job_id and kind in ('design','plan_check','construction');
  v_before := jsonb_build_object('fee', v_job.fee, 'job_type_id', v_job.job_type_id, 'size', v_job.size, 'phases', v_phases);
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_prior_ids from public.quotes where job_id = v_job_id;

  insert into public.quotes(job_id, job_type_id, rate, design_hours, plan_check_hours, construction_hours,
      site_visits, visit_hours, allowance_hours, rush_percent, size, suggested_fee, fee, fee_note)
    values (v_job_id, v_type_id, (p_quote->>'rate')::numeric, (p_quote->>'design_hours')::numeric,
      (p_quote->>'plan_check_hours')::numeric, (p_quote->>'construction_hours')::numeric,
      (p_quote->>'site_visits')::numeric, (p_quote->>'visit_hours')::numeric,
      (p_quote->>'allowance_hours')::numeric, (p_quote->>'rush_percent')::numeric,
      (p_quote->>'size')::numeric, (p_quote->>'suggested_fee')::numeric, (p_quote->>'fee')::numeric, p_quote->>'fee_note')
    returning * into v_quote;
  if v_quote.id is null then raise exception 'The quote could not be saved.'; end if;
  if (to_jsonb(v_quote) - array['id','created_at']) is distinct from
      (p_quote || jsonb_build_object('job_id', v_job_id, 'job_type_id', v_type_id)) then
    raise exception 'The requested quote values could not be saved exactly. No quote was saved.';
  end if;
  update public.jobs set fee = v_quote.fee, job_type_id = v_quote.job_type_id, size = v_quote.size where id = v_job_id;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'The job could not be updated. No quote was saved.'; end if;
  -- Deterministic individual writes make all phase failures roll back the quote
  -- and job too, even when a trigger rejects the last phase.
  for v_phase in select value from jsonb_array_elements(v_before->'phases') loop
    v_hours := case v_phase->>'kind' when 'design' then v_quote.design_hours
      when 'plan_check' then v_quote.plan_check_hours else v_quote.construction_hours end;
    update public.phases set estimate_hours = v_hours where id = (v_phase->>'id')::uuid and job_id = v_job_id;
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception 'A phase could not be updated. No quote was saved.'; end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'estimate_hours', estimate_hours) order by id), '[]'::jsonb)
    into v_phases from public.phases where job_id = v_job_id and kind in ('design','plan_check','construction');
  select jsonb_build_object('fee', fee, 'job_type_id', job_type_id, 'size', size, 'phases', v_phases)
    into v_after from public.jobs where id = v_job_id;
  -- Do not accept a trigger silently skipping or rewriting the requested fields.
  select coalesce(jsonb_agg(e || jsonb_build_object('estimate_hours', case e->>'kind'
      when 'design' then v_quote.design_hours when 'plan_check' then v_quote.plan_check_hours
      else v_quote.construction_hours end) order by (e->>'id')::uuid), '[]'::jsonb)
    into v_phases from jsonb_array_elements(v_before->'phases') as e;
  if v_after is distinct from jsonb_build_object('fee', v_quote.fee, 'job_type_id', v_quote.job_type_id,
      'size', v_quote.size, 'phases', v_phases) then
    raise exception 'The job or phase estimates could not be saved exactly. No quote was saved.';
  end if;
  insert into public.quote_save_requests(request_id, owner_id, job_id, quote_id, quote_payload,
      expected_snapshot, before_snapshot, after_snapshot, quote_snapshot, prior_quote_ids)
    values (p_request_id, v_owner, v_job_id, v_quote.id, p_quote, v_expected, v_before, v_after, to_jsonb(v_quote), v_prior_ids);
  return v_quote;
end;
$$;
revoke all on function public.record_quote(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.record_quote(uuid, jsonb, jsonb) to authenticated;

create or replace function public.undo_quote(p_request_id uuid)
returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  v_receipt public.quote_save_requests%rowtype;
  v_job public.jobs%rowtype;
  v_current jsonb;
  v_quote jsonb;
  v_phases jsonb;
  v_phase jsonb;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to undo a quote.' using errcode = '42501';
  end if;
  if p_request_id is null then raise exception 'The original quote request ID is required.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('record_quote:' || p_request_id::text, 0));
  select * into v_receipt from public.quote_save_requests where request_id = p_request_id for update;
  if not found then
    raise exception 'The saved quote request no longer exists or belongs to another account.' using errcode = '40001';
  end if;
  if v_receipt.undone_at is not null then return true; end if;
  select * into v_job from public.jobs where id = v_receipt.job_id for update;
  if not found then raise exception 'The job no longer exists. Nothing was undone.' using errcode = '40001'; end if;
  perform id from public.phases where job_id = v_receipt.job_id order by id for update;
  perform id from public.quotes where job_id = v_receipt.job_id order by id for update;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'estimate_hours', estimate_hours) order by id), '[]'::jsonb)
    into v_phases from public.phases where job_id = v_receipt.job_id and kind in ('design','plan_check','construction');
  v_current := jsonb_build_object('fee', v_job.fee, 'job_type_id', v_job.job_type_id, 'size', v_job.size, 'phases', v_phases);
  select to_jsonb(q) into v_quote from public.quotes q where id = v_receipt.quote_id and job_id = v_receipt.job_id;
  if v_current is distinct from v_receipt.after_snapshot or v_quote is distinct from v_receipt.quote_snapshot
    or exists (select 1 from public.quotes where job_id = v_receipt.job_id and id <> v_receipt.quote_id
      and not (id = any(v_receipt.prior_quote_ids))) then
    raise exception 'The job, phases, or quote changed after this save, or a newer quote exists. Nothing was undone.' using errcode = '40001';
  end if;
  update public.jobs set fee = (v_receipt.before_snapshot->>'fee')::numeric,
    job_type_id = (v_receipt.before_snapshot->>'job_type_id')::uuid,
    size = (v_receipt.before_snapshot->>'size')::numeric where id = v_receipt.job_id;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'The job could not be restored. Nothing was undone.'; end if;
  for v_phase in select value from jsonb_array_elements(v_receipt.before_snapshot->'phases') loop
    update public.phases set estimate_hours = (v_phase->>'estimate_hours')::numeric
      where id = (v_phase->>'id')::uuid and job_id = v_receipt.job_id;
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception 'A phase could not be restored. Nothing was undone.'; end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'estimate_hours', estimate_hours) order by id), '[]'::jsonb)
    into v_phases from public.phases where job_id = v_receipt.job_id and kind in ('design','plan_check','construction');
  select jsonb_build_object('fee', fee, 'job_type_id', job_type_id, 'size', size, 'phases', v_phases)
    into v_current from public.jobs where id = v_receipt.job_id;
  if v_current is distinct from v_receipt.before_snapshot then
    raise exception 'The original job or phase estimates could not be restored exactly. Nothing was undone.';
  end if;
  delete from public.quotes where id = v_receipt.quote_id and job_id = v_receipt.job_id;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'The quote could not be removed. Nothing was undone.'; end if;
  update public.quote_save_requests set undone_at = clock_timestamp() where request_id = p_request_id;
  return true;
end;
$$;
revoke all on function public.undo_quote(uuid) from public, anon;
grant execute on function public.undo_quote(uuid) to authenticated;
