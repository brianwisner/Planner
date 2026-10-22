-- DISPOSABLE LOCAL DATABASES ONLY. Synthetic fixtures, helpers and triggers roll back.
-- Run after setup.sql (or after all migrations). Never run against customer data.
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000021', true);

create function pg_temp.quote_test_state() returns jsonb language sql as $$
  select jsonb_build_object(
    'jobs', (select jsonb_agg(to_jsonb(j) order by id) from public.jobs j),
    'phases', (select jsonb_agg(to_jsonb(p) order by id) from public.phases p),
    'quotes', (select jsonb_agg(to_jsonb(q) order by id) from public.quotes q),
    'requests', (select jsonb_agg(to_jsonb(r) order by request_id) from public.quote_save_requests r));
$$;
create function pg_temp.quote_expected(p_job uuid) returns jsonb language sql as $$
  select jsonb_build_object('fee', fee, 'job_type_id', job_type_id, 'size', size,
    'phases', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'estimate_hours', estimate_hours) order by id), '[]'::jsonb)
      from public.phases where job_id = p_job and kind in ('design','plan_check','construction')))
  from public.jobs where id = p_job;
$$;
create function pg_temp.expect_quote_failure(p_id uuid, p_quote jsonb, p_expected jsonb, p_code text default null)
returns void language plpgsql as $$
declare v_before jsonb := pg_temp.quote_test_state(); v_failed boolean := false; v_code text;
begin
  begin
    perform public.record_quote(p_id, p_quote, p_expected);
  exception when others then v_failed := true; v_code := sqlstate;
  end;
  if not v_failed then raise exception 'Invalid/faulted quote save unexpectedly succeeded'; end if;
  if p_code is not null and p_code <> v_code then raise exception 'Expected SQLSTATE %, got %', p_code, v_code; end if;
  if v_before is distinct from pg_temp.quote_test_state() then raise exception 'Failed save left partial writes'; end if;
end $$;
create function pg_temp.expect_undo_failure(p_id uuid, p_code text default null)
returns void language plpgsql as $$
declare v_before jsonb := pg_temp.quote_test_state(); v_failed boolean := false; v_code text;
begin
  begin
    perform public.undo_quote(p_id);
  exception when others then v_failed := true; v_code := sqlstate;
  end;
  if not v_failed then raise exception 'Conflicting/faulted undo unexpectedly succeeded'; end if;
  if p_code is not null and p_code <> v_code then raise exception 'Expected SQLSTATE %, got %', p_code, v_code; end if;
  if v_before is distinct from pg_temp.quote_test_state() then raise exception 'Failed undo left partial writes'; end if;
end $$;
create function pg_temp.quote_fault() returns trigger language plpgsql as $$
declare v_target text := current_setting('planner.quote_test_fail', true);
begin
  if tg_table_name = 'quotes' and tg_op = 'INSERT' and v_target = 'quote_rewrite' then
    new.fee := new.fee + 1;
    return new;
  end if;
  if tg_table_name = 'jobs' and v_target = 'job_rewrite' then
    new.fee := coalesce(new.fee, 0) + 1;
    return new;
  end if;
  if tg_table_name = 'phases' then
    if v_target = old.kind || '_rewrite' then new.estimate_hours := new.estimate_hours + 1; return new; end if;
    if v_target = old.kind then raise exception 'Synthetic quote failure at %', v_target; end if;
  elsif (tg_table_name = 'jobs' and v_target = 'job')
    or (tg_table_name = 'quotes' and v_target = 'quote_delete') then
    raise exception 'Synthetic quote failure at %', v_target;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger zz_quote_test_job before update on public.jobs for each row execute function pg_temp.quote_fault();
create trigger zz_quote_test_phase before update on public.phases for each row execute function pg_temp.quote_fault();
create trigger zz_quote_test_insert before insert on public.quotes for each row execute function pg_temp.quote_fault();
create trigger zz_quote_test_delete before delete on public.quotes for each row execute function pg_temp.quote_fault();

do $$
declare
  v_client uuid;
  v_job uuid;
  v_type uuid;
  v_other_type uuid;
  v_id uuid := gen_random_uuid();
  v_phase uuid;
  v_added uuid;
  v_previous uuid;
  v_newer uuid;
  v_q jsonb;
  v_before jsonb;
  v_expected jsonb;
  v_saved public.quotes%rowtype;
  v_repeated public.quotes%rowtype;
  v_fault text;
  v_state jsonb;
  v_reversed jsonb;
begin
  insert into auth.users(id,email,raw_user_meta_data)
    values ('00000000-0000-4000-8000-000000000021', 'quote-test@example.test', '{"full_name":"Quote Test"}'),
      ('00000000-0000-4000-8000-000000000022', 'other-quote-test@example.test', '{"full_name":"Other Quote Test"}');
  insert into public.clients(name) values ('Synthetic quote client') returning id into v_client;
  insert into public.job_types(name) values ('Synthetic original quote type') returning id into v_type;
  insert into public.job_types(name) values ('Synthetic new quote type') returning id into v_other_type;
  insert into public.jobs(client_id,name,fee,job_type_id,size)
    values (v_client,'Synthetic quote job',null,v_type,null) returning id into v_job;
  update public.phases set estimate_hours = case kind when 'design' then 7 when 'plan_check' then 2
    when 'construction' then 1 else 99 end where job_id = v_job;
  -- Duplicate fee-phase kinds are legacy-compatible; every current row must update.
  insert into public.phases(job_id,kind,name,estimate_hours) values (v_job,'design','Extra design',3);
  insert into public.quotes(job_id,fee) values (v_job,999) returning id into v_previous;
  v_expected := pg_temp.quote_expected(v_job);
  v_before := v_expected;
  v_q := jsonb_build_object('job_id',v_job,'job_type_id',v_other_type,'rate',150,
    'design_hours',12,'plan_check_hours',4,'construction_hours',6,'site_visits',1,'visit_hours',3,
    'allowance_hours',2,'rush_percent',10,'size',1000,'suggested_fee',3650,'fee',3650,'fee_note','');

  -- Validate request shape and values before any mutation.
  perform pg_temp.expect_quote_failure(null,v_q,v_expected,'22023');
  perform pg_temp.expect_quote_failure(v_id,v_q - 'fee',v_expected,'22023');
  perform pg_temp.expect_quote_failure(v_id,v_q || '{"id":"00000000-0000-4000-8000-000000000099"}',v_expected,'22023');
  perform pg_temp.expect_quote_failure(v_id,v_q || '{"rate":"150"}',v_expected,'22023');
  perform pg_temp.expect_quote_failure(v_id,v_q || '{"fee":-1}',v_expected,'22023');
  perform pg_temp.expect_quote_failure(v_id,v_q || '{"job_id":"invalid"}',v_expected,'22023');
  perform pg_temp.expect_quote_failure(v_id,v_q,v_expected - 'fee','22023');
  perform pg_temp.expect_quote_failure(v_id,v_q,jsonb_set(v_expected,'{phases}','[]'),'40001');
  perform pg_temp.expect_quote_failure(v_id,v_q,jsonb_set(v_expected,'{phases}',
    (v_expected->'phases') || jsonb_build_array(v_expected->'phases'->0)),'22023');
  perform pg_temp.expect_quote_failure(v_id,v_q,v_expected || '{"fee":1}','40001');
  perform pg_temp.expect_quote_failure(v_id,v_q,v_expected || '{"size":1}','40001');
  perform pg_temp.expect_quote_failure(v_id,v_q,v_expected || jsonb_build_object('job_type_id',v_other_type),'40001');
  select id into v_phase from public.phases where job_id=v_job and kind='plan_check';
  update public.phases set estimate_hours=13 where id=v_phase;
  perform pg_temp.expect_quote_failure(v_id,v_q,v_expected,'40001');
  update public.phases set estimate_hours=2 where id=v_phase;
  insert into public.phases(job_id,kind,name) values(v_job,'construction','Concurrent new phase') returning id into v_added;
  perform pg_temp.expect_quote_failure(v_id,v_q,v_expected,'40001');
  delete from public.phases where id=v_added;
  begin
    delete from public.phases where id=v_phase;
    perform pg_temp.expect_quote_failure(v_id,v_q,v_expected,'40001');
    raise exception 'Restore deleted phase before save' using errcode='ZQ003';
  exception when sqlstate 'ZQ003' then null;
  end;

  -- Fail after quote INSERT, at the job UPDATE and at EACH phase kind.
  foreach v_fault in array array['job','design','plan_check','construction','quote_rewrite','job_rewrite','design_rewrite','plan_check_rewrite','construction_rewrite'] loop
    perform set_config('planner.quote_test_fail',v_fault,true);
    perform pg_temp.expect_quote_failure(v_id,v_q,v_expected,'P0001');
  end loop;
  perform set_config('planner.quote_test_fail','',true);
  select * into v_saved from public.record_quote(v_id,v_q,v_expected);
  if (select count(*) from public.quotes where job_id=v_job) <> 2 then raise exception 'Quote was not inserted exactly once'; end if;
  if (select fee from public.jobs where id=v_job) <> 3650
    or (select job_type_id from public.jobs where id=v_job) <> v_other_type
    or (select size from public.jobs where id=v_job) <> 1000 then raise exception 'Job fields were not updated'; end if;
  if exists(select 1 from public.phases where job_id=v_job and estimate_hours <> case kind
    when 'design' then 12 when 'plan_check' then 4 when 'construction' then 6 else 99 end) then
    raise exception 'A fee phase was missed, or unrelated work changed'; end if;
  v_state := pg_temp.quote_test_state();
  select * into v_repeated from public.record_quote(v_id,v_q,v_expected);
  if to_jsonb(v_saved) is distinct from to_jsonb(v_repeated) or v_state is distinct from pg_temp.quote_test_state() then
    raise exception 'Lost-response retry did not return the same quote without writes'; end if;
  select jsonb_agg(e order by e->>'id' desc) into v_reversed from jsonb_array_elements(v_expected->'phases') as e;
  perform public.record_quote(v_id,v_q,jsonb_set(v_expected,'{phases}',v_reversed));
  perform pg_temp.expect_quote_failure(v_id,v_q || '{"fee":3700}',v_expected,'22023');
  perform pg_temp.expect_quote_failure(v_id,v_q,v_expected || '{"fee":1}','22023');
  -- A second request using the same stale before-state cannot overwrite this one.
  perform pg_temp.expect_quote_failure(gen_random_uuid(),v_q,v_expected,'40001');

  -- Undo cannot erase any later edit, changed membership, changed quote or newer quote.
  update public.jobs set fee=4000 where id=v_job;
  v_state := pg_temp.quote_test_state();
  select * into v_repeated from public.record_quote(v_id,v_q,v_expected);
  if to_jsonb(v_repeated) is distinct from to_jsonb(v_saved) or v_state is distinct from pg_temp.quote_test_state() then
    raise exception 'Replay overwrote later job changes'; end if;
  perform pg_temp.expect_undo_failure(v_id,'40001');
  update public.jobs set fee=3650,size=1001 where id=v_job;
  perform pg_temp.expect_undo_failure(v_id,'40001');
  update public.jobs set size=1000,job_type_id=v_type where id=v_job;
  perform pg_temp.expect_undo_failure(v_id,'40001');
  update public.jobs set job_type_id=v_other_type where id=v_job;
  update public.phases set estimate_hours=5 where id=v_phase;
  perform pg_temp.expect_undo_failure(v_id,'40001');
  update public.phases set estimate_hours=4,kind='design' where id=v_phase;
  perform pg_temp.expect_undo_failure(v_id,'40001');
  update public.phases set kind='plan_check' where id=v_phase;
  insert into public.phases(job_id,kind,name) values(v_job,'design','Added after save') returning id into v_added;
  perform pg_temp.expect_undo_failure(v_id,'40001');
  delete from public.phases where id=v_added;
  begin
    delete from public.phases where id=v_phase;
    perform pg_temp.expect_undo_failure(v_id,'40001');
    raise exception 'Restore deleted phase before undo' using errcode='ZQ004';
  exception when sqlstate 'ZQ004' then null;
  end;
  update public.quotes set fee_note='Later edit' where id=v_saved.id;
  perform pg_temp.expect_undo_failure(v_id,'40001');
  perform pg_temp.expect_quote_failure(v_id,v_q,v_expected,'40001');
  update public.quotes set fee_note='' where id=v_saved.id;
  begin
    delete from public.quotes where id=v_saved.id;
    perform pg_temp.expect_undo_failure(v_id,'40001');
    perform pg_temp.expect_quote_failure(v_id,v_q,v_expected,'40001');
    raise exception 'Restore deleted test quote' using errcode='ZQ001';
  exception when sqlstate 'ZQ001' then null;
  end;
  insert into public.quotes(job_id,fee,created_at) values(v_job,3650,'2000-01-01') returning id into v_newer;
  perform pg_temp.expect_undo_failure(v_id,'40001');
  delete from public.quotes where id=v_newer;
  -- A deleted original type cannot cause a partial restoration.
  begin
    delete from public.job_types where id=v_type;
    perform pg_temp.expect_undo_failure(v_id,'23503');
    raise exception 'Restore deleted test type' using errcode='ZQ002';
  exception when sqlstate 'ZQ002' then null;
  end;
  -- Fault every rollback point too, including the final quote DELETE.
  foreach v_fault in array array['job','design','plan_check','construction','quote_delete','job_rewrite','design_rewrite','plan_check_rewrite','construction_rewrite'] loop
    perform set_config('planner.quote_test_fail',v_fault,true);
    perform pg_temp.expect_undo_failure(v_id,'P0001');
  end loop;
  perform set_config('planner.quote_test_fail','',true);
  if not public.undo_quote(v_id) then raise exception 'Undo did not report success'; end if;
  if pg_temp.quote_expected(v_job) is distinct from v_before then raise exception 'Undo did not restore the exact nullable job and phase snapshot'; end if;
  if exists(select 1 from public.quotes where id=v_saved.id)
    or not exists(select 1 from public.quotes where id=v_previous) then raise exception 'Undo removed the wrong quote'; end if;
  v_state := pg_temp.quote_test_state();
  if not public.undo_quote(v_id) or v_state is distinct from pg_temp.quote_test_state() then raise exception 'Repeat undo was not idempotent'; end if;
  update public.jobs set fee=765 where id=v_job;
  perform public.undo_quote(v_id);
  if (select fee from public.jobs where id=v_job) <> 765 then raise exception 'Repeat undo overwrote later work'; end if;
  perform pg_temp.expect_quote_failure(v_id,v_q,v_expected,'40001');
  perform pg_temp.expect_undo_failure(gen_random_uuid(),'40001');
  perform set_config('request.jwt.claim.sub','',true);
  perform pg_temp.expect_quote_failure(gen_random_uuid(),v_q,pg_temp.quote_expected(v_job),'42501');
  perform pg_temp.expect_undo_failure(v_id,'42501');
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000021',true);

  if has_function_privilege('anon','public.record_quote(uuid,jsonb,jsonb)','execute')
    or has_function_privilege('anon','public.undo_quote(uuid)','execute')
    or has_table_privilege('anon','public.quote_save_requests','select') then raise exception 'Anonymous quote access is allowed'; end if;
  if not has_function_privilege('authenticated','public.record_quote(uuid,jsonb,jsonb)','execute')
    or not has_function_privilege('authenticated','public.undo_quote(uuid)','execute') then raise exception 'Authenticated quote access is missing'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('record_quote','undo_quote') and p.prosecdef) then
    raise exception 'Quote RPC unexpectedly bypasses RLS'; end if;
end $$;

-- Exercise actual invoker permissions, owner-only receipts and anonymous refusal.
grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on public.jobs, public.phases, public.quotes to authenticated;
set local role authenticated;
do $$
declare v_job uuid; v_id uuid := gen_random_uuid(); v_quote jsonb;
begin
  select id into v_job from public.jobs where name='Synthetic quote job';
  select quote_payload into v_quote from public.quote_save_requests where job_id=v_job limit 1;
  perform public.record_quote(v_id,v_quote,pg_temp.quote_expected(v_job));
  perform public.undo_quote(v_id);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000022',true);
  if exists(select 1 from public.quote_save_requests where job_id=v_job) then raise exception 'Another owner can see quote receipts'; end if;
  perform pg_temp.expect_undo_failure(v_id,'40001');
  perform pg_temp.expect_quote_failure(v_id,v_quote,pg_temp.quote_expected(v_job),'23505');
end $$;
reset role;
set local role anon;
do $$
declare v_rejected boolean := false;
begin
  begin perform public.undo_quote(gen_random_uuid()); exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'Anonymous caller could undo quotes'; end if;
  v_rejected := false;
  begin perform public.record_quote(gen_random_uuid(),'{}','{}'); exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'Anonymous caller could save quotes'; end if;
end $$;
reset role;
rollback;
