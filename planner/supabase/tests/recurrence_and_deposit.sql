-- Disposable local databases only. All synthetic records are rolled back.
begin;

do $$
<<test_data>>
declare
  user_id uuid := gen_random_uuid();
  client_id uuid;
  job_id uuid;
  other_job_id uuid;
  invoice_id uuid;
  parent_id uuid;
  child_id uuid;
  self_id uuid := gen_random_uuid();
  entry_id uuid;
  item_id uuid;
  legacy_id uuid;
  cleared_id uuid;
  rejected boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data)
    values (user_id, 'schema-test@example.test', '{"full_name":"Schema Test"}'::jsonb);
  insert into public.clients (name) values ('Synthetic schema test') returning id into client_id;
  insert into public.jobs (client_id, name) values (client_id, 'Synthetic test job') returning id into job_id;
  insert into public.jobs (client_id, name) values (client_id, 'Other synthetic job') returning id into other_job_id;
  insert into public.invoices (job_id, number, amount) values (job_id, 'TEST-1', 50) returning id into invoice_id;

  -- Many ordinary tasks may have NULL parents; only one successor may name a parent.
  insert into public.tasks (job_id, title, recurrence) values (job_id, 'Recurring parent', 'weekly') returning id into parent_id;
  insert into public.tasks (job_id, title, recurrence_parent_id) values (job_id, 'Next occurrence', parent_id) returning id into child_id;
  insert into public.tasks (job_id, title) values (job_id, 'Ordinary task A'), (job_id, 'Ordinary task B');
  rejected := false;
  begin
    insert into public.tasks (job_id, title, recurrence_parent_id) values (job_id, 'Duplicate next occurrence', parent_id);
  exception when unique_violation then rejected := true;
  end;
  if not rejected then raise exception 'A second successor was accepted'; end if;
  rejected := false;
  begin
    insert into public.tasks (id, job_id, title, recurrence_parent_id) values (self_id, job_id, 'Self parent', self_id);
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'A task was allowed to be its own parent'; end if;
  rejected := false;
  begin
    insert into public.tasks (job_id, title, recurrence_parent_id) values (job_id, 'Missing parent', gen_random_uuid());
  exception when foreign_key_violation then rejected := true;
  end;
  if not rejected then raise exception 'A missing parent was accepted'; end if;
  delete from public.tasks where id = parent_id;
  if not exists (select 1 from public.tasks t where t.id = child_id and t.recurrence_parent_id is null) then
    raise exception 'Deleting a parent did not preserve its successor';
  end if;

  -- Positive and zero snapshots survive ordinary edits; legacy rows stay unknown.
  insert into public.time_entries (job_id, user_id, hours, rate, billed, invoice_id, deposit_applied)
    values (job_id, user_id, 1, 150, true, invoice_id, 100) returning id into entry_id;
  update public.time_entries set notes = 'Preserve rate and credit' where id = entry_id;
  if not exists (select 1 from public.time_entries e where e.id = entry_id and e.deposit_applied = 100 and e.rate = 150 and e.hours = 1) then
    raise exception 'A valid time credit or original work amount changed';
  end if;
  insert into public.time_entries (job_id, user_id, hours, rate, billed, invoice_id, deposit_applied)
    values (job_id, user_id, 1, 150, true, invoice_id, 0) returning id into cleared_id;
  if not exists (select 1 from public.time_entries e where e.id = cleared_id and e.deposit_applied = 0) then
    raise exception 'An explicit zero time credit was not retained';
  end if;
  insert into public.time_entries (job_id, user_id, hours, rate, billed, invoice_id)
    values (job_id, user_id, 1, 150, true, invoice_id) returning id into legacy_id;
  if not exists (select 1 from public.time_entries e where e.id = legacy_id and e.deposit_applied is null and e.billed) then
    raise exception 'A legacy time credit was inferred';
  end if;
  rejected := false;
  begin
    update public.time_entries set deposit_applied = -1 where id = entry_id;
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'A negative time credit was accepted'; end if;
  rejected := false;
  begin
    update public.time_entries set hours = 0.5 where id = entry_id;
  exception when raise_exception then rejected := true;
  end;
  if not rejected then raise exception 'Time was reduced below its saved credit'; end if;
  rejected := false;
  begin
    update public.time_entries set job_id = other_job_id where id = entry_id;
  exception when raise_exception then rejected := true;
  end;
  if not rejected then raise exception 'Time credit was moved to another job'; end if;
  update public.time_entries set billed = false where id = entry_id;
  if not exists (select 1 from public.time_entries e where e.id = entry_id and e.deposit_applied is null and not e.billed) then
    raise exception 'Unbilling time did not release the credit';
  end if;
  update public.time_entries set billed = true, deposit_applied = 100 where id = entry_id;
  update public.time_entries set invoice_id = null where id = entry_id;
  if not exists (select 1 from public.time_entries e where e.id = entry_id and e.deposit_applied is null and not e.billed) then
    raise exception 'Unlinking time did not unbill it and release the snapshot';
  end if;
  update public.time_entries set billed = true, invoice_id = test_data.invoice_id, deposit_applied = 100 where id = entry_id;

  insert into public.job_items (job_id, quantity, unit_price, billed, invoice_id, deposit_applied)
    values (job_id, 2, 75, true, invoice_id, 100) returning id into item_id;
  update public.job_items set description = 'Preserve charge and credit' where id = item_id;
  if not exists (select 1 from public.job_items i where i.id = item_id and i.deposit_applied = 100 and i.quantity = 2 and i.unit_price = 75) then
    raise exception 'A valid item credit or original charge changed';
  end if;
  rejected := false;
  begin
    update public.job_items set deposit_applied = -1 where id = item_id;
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'A negative item credit was accepted'; end if;
  rejected := false;
  begin
    update public.job_items set quantity = 1 where id = item_id;
  exception when raise_exception then rejected := true;
  end;
  if not rejected then raise exception 'An item was reduced below its saved credit'; end if;
  rejected := false;
  begin
    update public.job_items set job_id = other_job_id where id = item_id;
  exception when raise_exception then rejected := true;
  end;
  if not rejected then raise exception 'An item credit was moved to another job'; end if;
  update public.job_items set billed = false where id = item_id;
  if not exists (select 1 from public.job_items i where i.id = item_id and i.deposit_applied is null and not i.billed) then
    raise exception 'Unbilling an item did not release the credit';
  end if;
  update public.job_items set billed = true, deposit_applied = 100 where id = item_id;

  -- Old clients cannot leave stale credits on new unbilled/unlinked rows.
  insert into public.job_items (job_id, quantity, unit_price, billed, deposit_applied)
    values (job_id, 1, 50, true, 50) returning id into cleared_id;
  if not exists (select 1 from public.job_items i where i.id = cleared_id and i.deposit_applied is null and i.billed) then
    raise exception 'An invoice-less legacy billed flag was changed or retained stale credit';
  end if;
  insert into public.time_entries (job_id, user_id, hours, rate, billed, invoice_id, deposit_applied)
    values (job_id, user_id, 1, 50, false, invoice_id, 50) returning id into cleared_id;
  if not exists (select 1 from public.time_entries e where e.id = cleared_id and e.deposit_applied is null and not e.billed) then
    raise exception 'An unbilled insert retained stale credit';
  end if;
  -- Releasing credit and moving/reducing work in the same write is allowed.
  update public.time_entries set billed = false, job_id = other_job_id, hours = 0.25 where id = cleared_id;

  -- FK ON DELETE SET NULL must also invoke normalization, without rewriting money.
  delete from public.invoices where id = invoice_id;
  if not exists (select 1 from public.time_entries e where e.id = entry_id and e.invoice_id is null and e.deposit_applied is null and not e.billed and e.hours = 1 and e.rate = 150) then
    raise exception 'Invoice deletion left stale time credit or changed work history';
  end if;
  if not exists (select 1 from public.job_items i where i.id = item_id and i.invoice_id is null and i.deposit_applied is null and not i.billed and i.quantity = 2 and i.unit_price = 75) then
    raise exception 'Invoice deletion left stale item credit or changed charge history';
  end if;
  if (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'clear_unbilled_deposit_applied') then
    raise exception 'The cleanup trigger unexpectedly has elevated privileges';
  end if;
end $$;

rollback;
