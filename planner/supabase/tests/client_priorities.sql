-- Disposable local databases only. All records are synthetic and rolled back.
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

do $$
declare
  c1 uuid := gen_random_uuid();
  c2 uuid := gen_random_uuid();
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  closed uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  added uuid := gen_random_uuid();
  snapshot jsonb;
begin
  insert into public.clients(id, name) values (c1, 'Synthetic priority client'), (c2, 'Synthetic other client');
  insert into public.jobs(id, client_id, name, priority) values (a, c1, 'First open job', 30);
  insert into public.jobs(id, client_id, name, priority, status) values (closed, c1, 'Saved history', 5, 'complete');
  insert into public.jobs(id, client_id, name, priority, status) values (b, c1, 'Second open job', 20, 'on_hold');
  insert into public.jobs(id, client_id, name, priority) values (other, c2, 'Other client job', 1);
  select jsonb_agg(to_jsonb(j) - 'client_priority' order by id) into snapshot from public.jobs j where id in (a,b,closed,other);

  perform public.reorder_client_jobs(c1, array[a,b], array[b,a]);
  if (select array_agg(id order by client_priority) from public.jobs where client_id = c1) is distinct from array[b,closed,a] then
    raise exception 'Open jobs did not reorder around the retained history slot';
  end if;
  if (select jsonb_agg(to_jsonb(j) - 'client_priority' order by id) from public.jobs j where id in (a,b,closed,other)) is distinct from snapshot then
    raise exception 'Client reorder changed the global queue or other job fields';
  end if;
  if (select client_priority from public.jobs where id = other) <> 1 then
    raise exception 'Client reorder changed another client';
  end if;

  begin
    perform public.reorder_client_jobs(c1, array[a,b], array[b,a]);
    raise exception 'Stale order was accepted';
  exception when serialization_failure then null;
  end;
  begin
    perform public.reorder_client_jobs(c1, array[b,a], array[a,a]);
    raise exception 'Duplicate order was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.reorder_client_jobs(c1, array[b,a], array[a,other]);
    raise exception 'Cross-client order was accepted';
  exception when invalid_parameter_value then null;
  end;
  if (select array_agg(id order by client_priority) from public.jobs where client_id = c1) is distinct from array[b,closed,a] then
    raise exception 'Invalid reorder left a partial update';
  end if;

  insert into public.jobs(id, client_id, name, priority) values (added, c1, 'New at the end', 1);
  if (select client_priority from public.jobs where id = added) <> 4 then raise exception 'New job did not append'; end if;
  update public.jobs set client_id = c1 where id = other;
  if (select client_priority from public.jobs where id = other) <> 5 then raise exception 'Moved job did not append'; end if;
  begin
    perform public.reorder_client_jobs(c1, array[b,a], array[a,b]);
    raise exception 'Changed membership was accepted';
  exception when serialization_failure then null;
  end;

  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.reorder_client_jobs(c1, array[b,a,added,other], array[a,b,added,other]);
    raise exception 'Unsigned reorder was accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
