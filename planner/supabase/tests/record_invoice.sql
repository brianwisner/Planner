-- Disposable local databases only. All records, helpers, and triggers roll back.
begin;

create function pg_temp.expect_invoice_failure(test_job uuid, test_links jsonb) returns void
language plpgsql as $$
declare
  saved boolean := false;
  before_invoices int;
  before_work jsonb;
  after_work jsonb;
begin
  select count(*) into before_invoices from public.invoices;
  select jsonb_agg(work order by work::text) into before_work from (
    select to_jsonb(e) as work from public.time_entries e
    union all select to_jsonb(i) from public.job_items i
  ) rows;
  begin
    perform public.record_invoice(test_job, 'EXPECTED-FAILURE', 50, current_date, null, '', test_links);
    saved := true;
  exception when others then null;
  end;
  if saved then raise exception 'An invalid invoice request succeeded: %', test_links; end if;
  if (select count(*) from public.invoices) <> before_invoices then
    raise exception 'A rejected request left an invoice behind';
  end if;
  select jsonb_agg(work order by work::text) into after_work from (
    select to_jsonb(e) as work from public.time_entries e
    union all select to_jsonb(i) from public.job_items i
  ) rows;
  if before_work is distinct from after_work then
    raise exception 'A rejected request changed work rows';
  end if;
end $$;

create function pg_temp.reject_invoice_test_item() returns trigger language plpgsql as $$
begin
  if new.description = 'REJECT_BILLING_FOR_TEST' and new.billed then
    raise exception 'Synthetic failure after the first link was written';
  end if;
  return new;
end $$;
create trigger zz_reject_invoice_test_item before update on public.job_items
  for each row execute function pg_temp.reject_invoice_test_item();

do $$
declare
  owner_id uuid := gen_random_uuid();
  client uuid;
  job uuid;
  another_job uuid;
  failure_job uuid;
  ordered_job uuid;
  time_id uuid;
  item_id uuid;
  new_time uuid;
  foreign_time uuid;
  failed_time uuid;
  failed_item uuid;
  older_item uuid;
  later_time uuid;
  created_invoice public.invoices%rowtype;
  link jsonb;
begin
  insert into auth.users (id, email, raw_user_meta_data)
    values (owner_id, 'invoice-test@example.test', '{"full_name":"Invoice Test"}'::jsonb);
  insert into public.clients (name) values ('Synthetic invoice client') returning id into client;
  insert into public.jobs (client_id, name) values (client, 'Synthetic invoice job') returning id into job;
  insert into public.jobs (client_id, name) values (client, 'Another invoice job') returning id into another_job;
  insert into public.deposits (job_id, amount) values (job, 100);
  insert into public.time_entries (job_id, user_id, date, hours, rate, created_at)
    values (job, owner_id, '2026-01-02', 1, 150, '2026-01-01T00:00:00Z') returning id into time_id;
  insert into public.job_items (job_id, date, quantity, unit_price, created_at)
    values (job, '2026-01-02', 1, 50, '2026-01-01T00:00:00Z') returning id into item_id;

  -- Equal dates/timestamps use time before item, matching the frontend allocator.
  select * into created_invoice from public.record_invoice(job, 'TEST-ATOMIC', 100, current_date, null, '',
    jsonb_build_array(
      jsonb_build_object('table', 'time_entries', 'id', time_id, 'amount', 150, 'depositApplied', 100),
      jsonb_build_object('table', 'job_items', 'id', item_id, 'amount', 50, 'depositApplied', 0)));
  if not exists (select 1 from public.time_entries where id = time_id and billed and invoice_id = created_invoice.id and deposit_applied = 100) then
    raise exception 'Time was not linked atomically with its credit';
  end if;
  if not exists (select 1 from public.job_items where id = item_id and billed and invoice_id = created_invoice.id and deposit_applied = 0) then
    raise exception 'Item was not linked atomically with an explicit zero credit';
  end if;

  -- Billed snapshots are reserved even ahead of new backdated work.
  insert into public.time_entries (job_id, user_id, date, hours, rate)
    values (job, owner_id, '2025-01-01', 1, 100) returning id into new_time;
  link := jsonb_build_object('table', 'time_entries', 'id', new_time, 'amount', 100, 'depositApplied', 0);
  perform pg_temp.expect_invoice_failure(job, jsonb_build_array(link || '{"depositApplied":100}'));
  perform pg_temp.expect_invoice_failure(job, jsonb_build_array(link || '{"amount":101}'));
  perform pg_temp.expect_invoice_failure(job, jsonb_build_array(link, link));
  perform pg_temp.expect_invoice_failure(job, jsonb_build_array(link || '{"id":"00000000-0000-0000-0000-000000000000"}'));
  perform pg_temp.expect_invoice_failure(job, jsonb_build_array(link || '{"table":"profiles"}'));
  perform pg_temp.expect_invoice_failure(job, jsonb_build_array(link - 'amount'));
  perform pg_temp.expect_invoice_failure(job, jsonb_build_array(link || '{"depositApplied":-1}'));
  perform pg_temp.expect_invoice_failure(job, '{}');
  perform pg_temp.expect_invoice_failure(job, jsonb_build_array(jsonb_build_object(
    'table', 'time_entries', 'id', time_id, 'amount', 150, 'depositApplied', 100)));
  insert into public.time_entries (job_id, user_id, hours, rate)
    values (another_job, owner_id, 1, 100) returning id into foreign_time;
  perform pg_temp.expect_invoice_failure(job, jsonb_build_array(link || jsonb_build_object('id', foreign_time)));
  perform public.record_invoice(job, 'TEST-BACKDATED', 100, current_date, null, '', jsonb_build_array(link));
  if not exists (select 1 from public.time_entries where id = new_time and billed and deposit_applied = 0) then
    raise exception 'Backdated work reused reserved credit';
  end if;
  -- A standalone invoice is still allowed, with no work selected.
  perform public.record_invoice(job, 'TEST-STANDALONE', 25, current_date, null, 'No linked work');

  -- Older unselected work must consume the pool before a selected later row.
  insert into public.jobs (client_id, name) values (client, 'Oldest-first job') returning id into ordered_job;
  insert into public.deposits (job_id, amount) values (ordered_job, 100);
  insert into public.job_items (job_id, date, quantity, unit_price)
    values (ordered_job, '2026-01-01', 1, 60) returning id into older_item;
  insert into public.time_entries (job_id, user_id, date, hours, rate)
    values (ordered_job, owner_id, '2026-01-02', 1, 150) returning id into later_time;
  link := jsonb_build_object('table', 'time_entries', 'id', later_time, 'amount', 150, 'depositApplied', 40);
  perform pg_temp.expect_invoice_failure(ordered_job, jsonb_build_array(link || '{"depositApplied":100}'));
  perform public.record_invoice(ordered_job, 'TEST-ORDERED', 110, current_date, null, '', jsonb_build_array(link));
  if not exists (select 1 from public.time_entries where id = later_time and deposit_applied = 40) then
    raise exception 'The allocator ignored older unselected work';
  end if;
  if not exists (select 1 from public.job_items where id = older_item and not billed and deposit_applied is null) then
    raise exception 'Billing selected work modified an unselected row';
  end if;

  -- Force a failure on the item after the time update; the whole RPC rolls back.
  insert into public.jobs (client_id, name) values (client, 'Rollback test job') returning id into failure_job;
  insert into public.time_entries (job_id, user_id, hours, rate)
    values (failure_job, owner_id, 1, 100) returning id into failed_time;
  insert into public.job_items (job_id, quantity, unit_price, description)
    values (failure_job, 1, 50, 'REJECT_BILLING_FOR_TEST') returning id into failed_item;
  perform pg_temp.expect_invoice_failure(failure_job, jsonb_build_array(
    jsonb_build_object('table', 'time_entries', 'id', failed_time, 'amount', 100, 'depositApplied', 0),
    jsonb_build_object('table', 'job_items', 'id', failed_item, 'amount', 50, 'depositApplied', 0)));

  if has_function_privilege('anon', 'public.record_invoice(uuid,text,numeric,date,date,text,jsonb)', 'execute') then
    raise exception 'Anonymous users can execute record_invoice';
  end if;
  if not has_function_privilege('authenticated', 'public.record_invoice(uuid,text,numeric,date,date,text,jsonb)', 'execute') then
    raise exception 'Authenticated users cannot execute record_invoice';
  end if;
  if (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'record_invoice') then
    raise exception 'record_invoice unexpectedly has elevated privileges';
  end if;
end $$;

-- Exercise the function under its actual caller role and existing team RLS.
-- A disposable database needs the same table grants Supabase supplies normally.
grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
set local role authenticated;
select public.record_invoice((select id from public.jobs where name = 'Synthetic invoice job'),
  'TEST-AUTHENTICATED', 10, current_date, null, '', '[]');
reset role;

set local role anon;
do $$
declare rejected boolean := false;
begin
  begin
    perform public.record_invoice('00000000-0000-0000-0000-000000000000',
      'TEST-ANON', 10, current_date, null, '', '[]');
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'An anonymous caller could execute record_invoice'; end if;
end $$;
reset role;

rollback;
