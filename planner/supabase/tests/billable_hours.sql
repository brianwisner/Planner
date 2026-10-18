-- Disposable local databases only. All synthetic records and grants roll back.
begin;

do $$
declare
  owner_id uuid := gen_random_uuid();
  client uuid;
  job uuid;
  test_invoice uuid;
  billed_time uuid;
  legacy_time uuid;
  nonbillable_time uuid;
  dynamic_time uuid;
  selected_time uuid;
  older_item uuid;
  default_time uuid;
  test_id uuid;
  rejected boolean;
  invoice_count int;
  created_invoice public.invoices%rowtype;
begin
  insert into auth.users (id, email, raw_user_meta_data)
    values (owner_id, 'billable-test@example.test', '{"full_name":"Billable Test"}'::jsonb);
  insert into public.clients (name) values ('Synthetic billable client') returning id into client;
  insert into public.jobs (client_id, name) values (client, 'Synthetic billable job') returning id into job;
  insert into public.invoices (job_id, number, amount) values (job, 'TEST-NONBILLABLE', 50) returning id into test_invoice;

  -- Inserts from old clients omit billable; their current behavior stays intact.
  insert into public.time_entries (job_id, user_id, hours, rate, notes)
    values (job, owner_id, 1, 150, 'Default is billable') returning id into default_time;
  if not exists (select 1 from public.time_entries where id = default_time and billable) then
    raise exception 'An old-client insert did not default to billable';
  end if;
  rejected := false;
  begin
    insert into public.time_entries (job_id, user_id, hours, billable) values (job, owner_id, 1, null);
  exception when not_null_violation then rejected := true;
  end;
  if not rejected then raise exception 'A null billable flag was accepted'; end if;

  -- Financially linked history requires explicit unbilling before reclassification.
  insert into public.time_entries (job_id, user_id, hours, rate, billed, invoice_id, deposit_applied)
    values (job, owner_id, 1, 150, true, test_invoice, 100) returning id into billed_time;
  rejected := false;
  begin
    update public.time_entries set billable = false where id = billed_time;
  exception when raise_exception then rejected := true;
  end;
  if not rejected then raise exception 'Invoiced time was reclassified without unbilling'; end if;
  if not exists (select 1 from public.time_entries where id = billed_time and billable and billed
      and invoice_id = test_invoice and deposit_applied = 100 and hours = 1 and rate = 150) then
    raise exception 'Rejected reclassification changed financial history';
  end if;
  update public.time_entries set billed = false, invoice_id = null, billable = false where id = billed_time;
  if not exists (select 1 from public.time_entries where id = billed_time and not billable and not billed
      and invoice_id is null and deposit_applied is null and hours = 1 and rate = 150) then
    raise exception 'Explicit unbilling did not release the reclassification guard';
  end if;
  insert into public.time_entries (job_id, user_id, hours, rate, billed)
    values (job, owner_id, 1, 150, true) returning id into legacy_time;
  rejected := false;
  begin
    update public.time_entries set billable = false where id = legacy_time;
  exception when raise_exception then rejected := true;
  end;
  if not rejected then raise exception 'A legacy billed flag was ignored during reclassification'; end if;
  update public.time_entries set billed = false, billable = false where id = legacy_time;
  delete from public.time_entries where id = default_time;

  -- Internal hours keep their original hours/rate/notes but cannot acquire money links.
  insert into public.time_entries (job_id, user_id, date, hours, rate, billable, notes)
    values (job, owner_id, '2026-01-01', 5, 100, false, 'Synthetic non-billable time') returning id into nonbillable_time;
  rejected := false;
  begin
    update public.time_entries set billed = true, invoice_id = test_invoice where id = nonbillable_time;
  exception when raise_exception then rejected := true;
  end;
  if not rejected then raise exception 'An old-client direct write billed non-billable hours'; end if;
  rejected := false;
  begin
    update public.time_entries set invoice_id = test_invoice where id = nonbillable_time;
  exception when raise_exception then rejected := true;
  end;
  if not rejected then raise exception 'Non-billable time was linked to an invoice'; end if;
  rejected := false;
  begin
    update public.time_entries set billed = true where id = nonbillable_time;
  exception when raise_exception then rejected := true;
  end;
  if not rejected then raise exception 'Non-billable time retained an invoice-less billed flag'; end if;
  update public.time_entries set deposit_applied = 10 where id = nonbillable_time;
  if not exists (select 1 from public.time_entries where id = nonbillable_time and deposit_applied is null
      and not billed and invoice_id is null and hours = 5 and rate = 100 and notes = 'Synthetic non-billable time') then
    raise exception 'Non-billable time retained deposit credit or lost original work';
  end if;

  -- The check constraint protects these invariants independently of normalization.
  alter table public.time_entries disable trigger time_entry_deposit_applied;
  rejected := false;
  begin
    update public.time_entries set billed = true where id = nonbillable_time;
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'The non-billable check accepted billed=true'; end if;
  rejected := false;
  begin
    update public.time_entries set invoice_id = test_invoice where id = nonbillable_time;
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'The non-billable check accepted an invoice link'; end if;
  rejected := false;
  begin
    update public.time_entries set deposit_applied = 1 where id = nonbillable_time;
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'The non-billable check accepted deposit credit'; end if;
  alter table public.time_entries enable trigger time_entry_deposit_applied;

  -- Dynamic deposit coverage has no stored snapshot: reclassifying releases it.
  insert into public.deposits (job_id, amount) values (job, 100);
  insert into public.time_entries (job_id, user_id, date, hours, rate)
    values (job, owner_id, '2026-01-02', 1, 100) returning id into dynamic_time;
  update public.time_entries set billable = false where id = dynamic_time;
  insert into public.job_items (job_id, date, quantity, unit_price)
    values (job, '2026-01-03', 1, 30) returning id into older_item;
  insert into public.time_entries (job_id, user_id, date, hours, rate)
    values (job, owner_id, '2026-01-04', 1, 150) returning id into selected_time;
  select count(*) into invoice_count from public.invoices;
  rejected := false;
  begin
    perform public.record_invoice(job, 'REJECT-NONBILLABLE', 80, current_date, null, '', jsonb_build_array(
      jsonb_build_object('table', 'time_entries', 'id', selected_time, 'amount', 150, 'depositApplied', 70),
      jsonb_build_object('table', 'time_entries', 'id', nonbillable_time, 'amount', 500, 'depositApplied', 0)));
  exception when raise_exception then rejected := true;
  end;
  if not rejected then raise exception 'The RPC invoiced non-billable time'; end if;
  if (select count(*) from public.invoices) <> invoice_count
      or exists (select 1 from public.time_entries where id = selected_time and (billed or invoice_id is not null or deposit_applied is not null)) then
    raise exception 'A rejected non-billable selection saved a partial invoice';
  end if;
  select * into created_invoice from public.record_invoice(job, 'TEST-BILLABLE-ONLY', 80, current_date, null, '', jsonb_build_array(
    jsonb_build_object('table', 'time_entries', 'id', selected_time, 'amount', 150, 'depositApplied', 70)));
  if not exists (select 1 from public.time_entries where id = selected_time and billable and billed
      and invoice_id = created_invoice.id and deposit_applied = 70) then
    raise exception 'Non-billable work consumed deposits or disrupted oldest-first allocation';
  end if;
  if exists (select 1 from public.time_entries where job_id = job and not billable
      and (billed or invoice_id is not null or coalesce(deposit_applied, 0) <> 0)) then
    raise exception 'A non-billable row acquired a financial link';
  end if;

  -- Switching internal time back to billable allows ordinary allocation/invoicing.
  update public.time_entries set billable = true where id = dynamic_time;
  select * into created_invoice from public.record_invoice(job, 'TEST-BILLABLE-AGAIN', 70, current_date, null, '', jsonb_build_array(
    jsonb_build_object('table', 'time_entries', 'id', dynamic_time, 'amount', 100, 'depositApplied', 30)));
  if not exists (select 1 from public.time_entries where id = dynamic_time and billed and deposit_applied = 30) then
    raise exception 'Restoring billable time did not restore normal allocation';
  end if;
end $$;

-- The same old-client write is rejected for an ordinary authenticated caller.
grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
set local role authenticated;
do $$
declare rejected boolean := false;
begin
  begin
    update public.time_entries set billed = true,
      invoice_id = (select id from public.invoices where number = 'TEST-NONBILLABLE')
      where notes = 'Synthetic non-billable time';
  exception when raise_exception then rejected := true;
  end;
  if not rejected then raise exception 'An authenticated old client billed non-billable time'; end if;
end $$;
reset role;

rollback;
