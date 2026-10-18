-- Add snapshots for future invoice credits and a unique link to a recurring
-- task's preceding occurrence. Existing financial history is not inferred.
begin;

alter table public.time_entries
  add column deposit_applied numeric check (deposit_applied >= 0);
alter table public.job_items
  add column deposit_applied numeric check (deposit_applied >= 0);

alter table public.tasks
  add column recurrence_parent_id uuid unique references public.tasks(id) on delete set null,
  add constraint tasks_recurrence_parent_not_self check (recurrence_parent_id <> id);

-- This only normalizes the row already being written; it requires no elevated
-- privileges and does not change RLS. Removing an existing invoice link also
-- unbills its work, including links removed by the invoice's foreign key.
create or replace function public.clear_unbilled_deposit_applied() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  work_amount numeric;
begin
  if tg_op = 'UPDATE' and old.invoice_id is not null and new.invoice_id is null then
    new.billed := false;
  end if;
  if not new.billed or new.invoice_id is null then
    new.deposit_applied := null;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.deposit_applied > 0 and old.job_id <> new.job_id then
    raise exception 'Unbill this work before moving it to another job.';
  end if;
  if new.deposit_applied > 0 then
    if tg_table_name = 'time_entries' then
      work_amount := new.hours * coalesce(new.rate,
        (select hourly_rate from public.profiles where id = new.user_id),
        (select default_rate from public.settings where id = 1), 150);
    else
      work_amount := new.quantity * new.unit_price;
    end if;
    if work_amount is null or work_amount::text in ('NaN', 'Infinity', '-Infinity')
        or work_amount < new.deposit_applied then
      raise exception 'Unbill this work before reducing its value below the deposit credit.';
    end if;
  end if;
  return new;
end $$;

create trigger time_entry_deposit_applied before insert or update on public.time_entries
  for each row execute function public.clear_unbilled_deposit_applied();
create trigger job_item_deposit_applied before insert or update on public.job_items
  for each row execute function public.clear_unbilled_deposit_applied();

-- Create an invoice and all of its work links in one database transaction.
-- SECURITY INVOKER keeps the caller's existing table permissions and RLS.
create or replace function public.record_invoice(
  p_job_id uuid,
  p_number text,
  p_amount numeric,
  p_issued_date date,
  p_paid_date date,
  p_notes text,
  p_links jsonb default '[]'::jsonb
) returns setof public.invoices
language plpgsql security invoker set search_path = public as $$
declare
  work_row record;
  requested_link jsonb;
  validated_links jsonb := '[]'::jsonb;
  available_deposit numeric;
  coverage numeric;
  new_invoice public.invoices%rowtype;
  written_rows int;
begin
  -- Same-job invoice requests serialize here. The row locks below also prevent
  -- ordinary edits from changing the inputs while coverage is being checked.
  perform id from public.jobs where id = p_job_id for update;
  if not found then raise exception 'This job is no longer available.'; end if;
  if p_amount is null or p_amount < 0 or p_amount::text in ('NaN', 'Infinity', '-Infinity')
      or p_issued_date is null then
    raise exception 'Enter a valid invoice amount and issue date.';
  end if;
  if p_links is null or jsonb_typeof(p_links) <> 'array' then
    raise exception 'Selected invoice work must be a list.';
  end if;
  for requested_link in select value from jsonb_array_elements(p_links) loop
    if jsonb_typeof(requested_link) <> 'object'
        or requested_link->>'table' is null
        or requested_link->>'table' not in ('time_entries', 'job_items')
        or jsonb_typeof(requested_link->'id') is distinct from 'string'
        or jsonb_typeof(requested_link->'amount') is distinct from 'number'
        or jsonb_typeof(requested_link->'depositApplied') is distinct from 'number' then
      raise exception 'Selected invoice work is invalid. Refresh Billing and select it again.';
    end if;
    -- Parsing every ID up front also rejects malformed UUIDs before any writes.
    perform (requested_link->>'id')::uuid;
    if (requested_link->>'depositApplied')::numeric < 0 then
      raise exception 'A deposit credit cannot be negative.';
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(p_links) link
    group by link->>'table', (link->>'id')::uuid having count(*) > 1
  ) then
    raise exception 'Selected invoice work contains a duplicate row.';
  end if;

  perform id from public.time_entries where job_id = p_job_id order by id for update;
  perform id from public.job_items where job_id = p_job_id order by id for update;
  perform id from public.deposits where job_id = p_job_id order by id for update;
  perform id from public.profiles where id in
    (select user_id from public.time_entries where job_id = p_job_id) order by id for share;
  perform id from public.settings where id = 1 for share;

  select greatest(0,
      coalesce((select sum(amount) from public.deposits where job_id = p_job_id), 0)
      - coalesce((select sum(greatest(0, coalesce(deposit_applied, 0))) from public.time_entries
          where job_id = p_job_id and billed and hours is not null), 0)
      - coalesce((select sum(greatest(0, coalesce(deposit_applied, 0))) from public.job_items
          where job_id = p_job_id and billed), 0))
    into available_deposit;

  -- Evaluate every row, including unselected work, before changing billing
  -- status. Tie breakers match jobCharges() so equal timestamps are stable.
  for work_row in
    select * from (
      select 'time_entries'::text as table_name, e.id, e.date, e.created_at, e.billed,
        e.hours * coalesce(e.rate, p.hourly_rate,
          (select default_rate from public.settings where id = 1), 150) as amount,
        0 as kind_order
      from public.time_entries e left join public.profiles p on p.id = e.user_id
      where e.job_id = p_job_id and e.hours is not null
      union all
      select 'job_items', i.id, i.date, i.created_at, i.billed,
        i.quantity * i.unit_price, 1
      from public.job_items i where i.job_id = p_job_id
    ) work order by date, created_at, kind_order, id
  loop
    coverage := 0;
    if not work_row.billed then
      coverage := greatest(0, least(available_deposit, work_row.amount));
      available_deposit := available_deposit - coverage;
    end if;
    select value into requested_link from jsonb_array_elements(p_links)
      where value->>'table' = work_row.table_name and (value->>'id')::uuid = work_row.id;
    if requested_link is not null then
      if work_row.billed or work_row.amount is null
          or work_row.amount::text in ('NaN', 'Infinity', '-Infinity')
          or abs(work_row.amount - (requested_link->>'amount')::numeric) > 0.000001
          or abs(coverage - (requested_link->>'depositApplied')::numeric) > 0.000001 then
        raise exception 'Selected work or its deposit credit changed. Refresh Billing and select it again.';
      end if;
      validated_links := validated_links || jsonb_build_array(jsonb_build_object(
        'table', work_row.table_name, 'id', work_row.id, 'depositApplied', coverage));
    end if;
  end loop;
  if jsonb_array_length(validated_links) <> jsonb_array_length(p_links) then
    raise exception 'Selected work is missing or belongs to another job. Refresh Billing and select it again.';
  end if;

  insert into public.invoices (job_id, number, amount, issued_date, paid_date, notes)
    values (p_job_id, coalesce(p_number, ''), p_amount, p_issued_date, p_paid_date, coalesce(p_notes, ''))
    returning * into new_invoice;
  for requested_link in select value from jsonb_array_elements(validated_links) loop
    if requested_link->>'table' = 'time_entries' then
      update public.time_entries set billed = true, invoice_id = new_invoice.id,
        deposit_applied = (requested_link->>'depositApplied')::numeric
        where id = (requested_link->>'id')::uuid and job_id = p_job_id and not billed;
    else
      update public.job_items set billed = true, invoice_id = new_invoice.id,
        deposit_applied = (requested_link->>'depositApplied')::numeric
        where id = (requested_link->>'id')::uuid and job_id = p_job_id and not billed;
    end if;
    get diagnostics written_rows = row_count;
    if written_rows <> 1 then
      raise exception 'Selected work could not be billed. No invoice was saved.';
    end if;
  end loop;
  return next new_invoice;
end $$;

revoke all on function public.record_invoice(uuid, text, numeric, date, date, text, jsonb) from public, anon;
grant execute on function public.record_invoice(uuid, text, numeric, date, date, text, jsonb) to authenticated;


commit;
