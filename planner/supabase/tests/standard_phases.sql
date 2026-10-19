-- Disposable local databases only. All synthetic records are rolled back.
-- Run after setup.sql, or after the existing-project retirement migration.
begin;

do $$
<<test_data>>
declare
  owner_id uuid := gen_random_uuid();
  client_id uuid;
  job_id uuid;
  next_job_id uuid;
  legacy_phase_id uuid;
  task_id uuid;
  entry_id uuid;
  plan_id uuid;
  expected_phases jsonb := '[
    {"kind":"bidding","name":"Bidding","sort_order":1},
    {"kind":"design","name":"Original design","sort_order":2},
    {"kind":"plan_check","name":"County / plan-check comments","sort_order":3},
    {"kind":"construction","name":"Construction changes","sort_order":4},
    {"kind":"client_changes","name":"Client-requested changes","sort_order":5}
  ]'::jsonb;
  saved_history jsonb;
  current_history jsonb;
begin
  insert into auth.users (id, email, raw_user_meta_data)
    values (owner_id, 'phase-test@example.test', '{"full_name":"Phase Test"}');
  insert into public.clients (name) values ('Synthetic phase test') returning id into client_id;
  insert into public.jobs (client_id, name, queued_date)
    values (client_id, 'Synthetic job', '2026-01-05') returning id into job_id;

  if (select jsonb_agg(jsonb_build_object('kind',p.kind,'name',p.name,'sort_order',p.sort_order) order by p.sort_order)
      from public.phases p where p.job_id = test_data.job_id) is distinct from expected_phases then
    raise exception 'A new job did not receive exactly the five ordered workflow phases';
  end if;

  -- The retired kind must remain valid for retained historical phase IDs.
  insert into public.phases (job_id, kind, name, sort_order, status, estimate_hours, start_date, due_date, assignee_id, notes)
    values (job_id, 'queued', 'Original saved label', 2, 'waiting', 4.25, '2026-01-03', '2026-01-08', owner_id, 'Saved phase notes')
    returning id into legacy_phase_id;
  insert into public.tasks (job_id, phase_id, title, assignee_id, due_date, estimate_hours)
    values (job_id, legacy_phase_id, 'Retained planning task', owner_id, '2026-01-07', 1.5) returning id into task_id;
  insert into public.time_entries (job_id, phase_id, task_id, user_id, date, hours, rate, notes)
    values (job_id, legacy_phase_id, task_id, owner_id, '2026-01-06', 1.25, 123.45, 'Saved hourly history') returning id into entry_id;
  insert into public.schedule_entries (job_id, phase_id, user_id, date, hours, note)
    values (job_id, legacy_phase_id, owner_id, '2026-01-07', 2.5, 'Saved plan') returning id into plan_id;

  select jsonb_build_object(
    'job', (select to_jsonb(j) from public.jobs j where j.id = test_data.job_id),
    'phases', (select jsonb_agg(to_jsonb(p) order by p.id) from public.phases p where p.job_id = test_data.job_id),
    'task', (select to_jsonb(t) from public.tasks t where t.id = task_id),
    'time', (select to_jsonb(t) from public.time_entries t where t.id = entry_id),
    'plan', (select to_jsonb(s) from public.schedule_entries s where s.id = plan_id)
  ) into saved_history;

  insert into public.jobs (client_id, name) values (client_id, 'Next synthetic job') returning id into next_job_id;
  if (select count(*) from public.phases p where p.job_id = next_job_id) <> 5
     or exists (select 1 from public.phases p where p.job_id = next_job_id and p.kind = 'queued') then
    raise exception 'Another new job created a retired Queued phase';
  end if;
  if (select queued_date from public.jobs j where j.id = next_job_id) is not null then
    raise exception 'Creating a job auto-filled its historical queue-entry date';
  end if;

  select jsonb_build_object(
    'job', (select to_jsonb(j) from public.jobs j where j.id = test_data.job_id),
    'phases', (select jsonb_agg(to_jsonb(p) order by p.id) from public.phases p where p.job_id = test_data.job_id),
    'task', (select to_jsonb(t) from public.tasks t where t.id = task_id),
    'time', (select to_jsonb(t) from public.time_entries t where t.id = entry_id),
    'plan', (select to_jsonb(s) from public.schedule_entries s where s.id = plan_id)
  ) into current_history;
  if current_history is distinct from saved_history then
    raise exception 'Creating a new job changed historical phase records or references';
  end if;

  -- Retained planning tasks remain operable without moving their historical links.
  update public.tasks t set status = 'done', completed_at = '2026-01-08T12:00:00Z' where t.id = task_id;
  update public.tasks t set status = 'todo', completed_at = null where t.id = task_id;
  if (select phase_id from public.tasks t where t.id = task_id) is distinct from legacy_phase_id
     or (select phase_id from public.time_entries t where t.id = entry_id) is distinct from legacy_phase_id
     or (select phase_id from public.schedule_entries s where s.id = plan_id) is distinct from legacy_phase_id then
    raise exception 'Operating a retained task changed its phase/time/plan references';
  end if;
end $$;

rollback;
