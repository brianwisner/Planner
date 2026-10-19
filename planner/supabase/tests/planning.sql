-- Disposable local database only. Every synthetic write is rolled back.
begin;
create function pg_temp.expect_rejected(sql text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then return; end;
  raise exception 'Expected rejection: %',sql;
end $$;

do $$
<<test_data>>
declare
  owner_id uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid(); client_id uuid; job_id uuid; other_job uuid;
  invoice_id uuid; review_id uuid:=gen_random_uuid(); history_phase uuid; task_id uuid; first_id uuid; second_id uuid; other_id uuid;
  checkpoint timestamptz; events_before bigint; affected integer; moves jsonb; initial_rows jsonb; table_name text;
begin
  insert into auth.users(id,email,raw_user_meta_data) values(owner_id,'planning-owner@example.test','{}'),(other_owner,'planning-legacy@example.test','{}');
  insert into public.clients(name) values('Synthetic planning client') returning id into client_id;
  insert into public.jobs(client_id,name) values(client_id,'Synthetic planning job') returning id into job_id;
  insert into public.jobs(client_id,name) values(client_id,'Other planning job') returning id into other_job;
  insert into public.invoices(job_id,number,amount) values(job_id,'SYN-PLAN',150) returning id into invoice_id;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  execute 'set local role authenticated';

  insert into public.daily_reviews(id,review_date,checkpoint_at,revision,created_at,priorities)
    values(review_id,'2026-03-01','1900-01-01',99,'1900-01-01',jsonb_build_array(jsonb_build_object('id','priority-1','title','Review framing','job_id',job_id,'done',false)));
  select checkpoint_at into checkpoint from public.daily_reviews where id=review_id;
  if checkpoint='1900-01-01'::timestamptz or (select revision from public.daily_reviews where id=review_id)<>1 then raise exception 'First-save cutoff/revision was caller-controlled'; end if;
  update public.daily_reviews set notes='Saved review' where id=review_id and revision=1;
  update public.daily_reviews set notes='Stale overwrite' where id=review_id and revision=1;
  get diagnostics affected=row_count;
  if affected<>0 or (select revision from public.daily_reviews where id=review_id)<>2 or (select checkpoint_at from public.daily_reviews where id=review_id)<>checkpoint then raise exception 'Stale update or immutable cutoff failed'; end if;
  perform pg_temp.expect_rejected(format('update daily_reviews set checkpoint_at=now() where id=%L',review_id));
  perform pg_temp.expect_rejected('insert into daily_reviews(review_date) values(''2026-03-01'')');
  perform pg_temp.expect_rejected('insert into daily_reviews(review_date,priorities) values(''2026-03-02'',''[{"id":"x","title":"Missing boolean","job_id":null}]'')');
  perform pg_temp.expect_rejected('insert into daily_reviews(review_date,priorities) values(''2026-03-02'',''[{"id":"x","title":"A","job_id":null,"done":false},{"id":"x","title":"B","job_id":null,"done":true}]'')');
  insert into public.follow_ups(job_id,invoice_id,title,contact_log) values(job_id,invoice_id,'Invoice follow-up','[{"id":"contact-1","date":"2026-03-01","note":"Called","promised_date":"2026-03-05"}]');
  perform pg_temp.expect_rejected(format('insert into follow_ups(invoice_id,title) values(%L,''Duplicate invoice'')',invoice_id));
  perform pg_temp.expect_rejected(format('update follow_ups set job_id=%L where invoice_id=%L',other_job,invoice_id));
  perform pg_temp.expect_rejected('insert into follow_ups(title,contact_log) values(''Bad log'',''[{"id":"x","date":"2026-02-30","note":"Invalid date"}]'')');
  perform pg_temp.expect_rejected('insert into follow_ups(title,contact_log) values(''Bad log'',''["unsafe shape"]'')');
  insert into public.daily_availability(date,base_hours) values('2026-03-01',0),('2026-03-02',24);
  insert into public.availability_blocks(date,title,kind,hours) values('2026-03-01','Site appointment','appointment',1);
  if not exists(select 1 from public.planning_events where entity_type='daily_availability' and summary='Insert: Daily availability · 2026-03-01')
    or not exists(select 1 from public.planning_events where entity_type='availability_blocks' and summary='Insert: Site appointment · 2026-03-01') then raise exception 'Availability activity lost its date context'; end if;
  perform pg_temp.expect_rejected('insert into daily_availability(date,base_hours) values(''2026-03-03'',25)');
  perform pg_temp.expect_rejected('insert into daily_availability(date,base_hours) values(''2026-03-03'',''NaN'')');
  perform pg_temp.expect_rejected('insert into availability_blocks(date,title,hours) values(''2026-03-01'',''No time'',0)');
  perform pg_temp.expect_rejected('insert into availability_blocks(date,title,kind,hours) values(''2026-03-01'',''Invalid kind'',''unknown'',1)');
  insert into public.job_planning(job_id,remaining_hours) values(job_id,0);
  perform pg_temp.expect_rejected(format('insert into job_planning(job_id,remaining_hours) values(%L,2)',job_id));
  perform pg_temp.expect_rejected(format('insert into job_planning(job_id,remaining_hours) values(%L,''NaN'')',other_job));
  insert into public.job_decisions(job_id,title,estimated_hours,billing_treatment,approval) values(job_id,'Saved scope change',1.5,'billable','needed');
  perform pg_temp.expect_rejected('insert into job_decisions(title,estimated_hours) values(''Negative'',-1)');

  insert into public.tasks(job_id,title) values(job_id,'Recorded activity task') returning id into task_id;
  update public.tasks set title='Changed activity task' where id=task_id;
  if not exists(select 1 from public.planning_events where entity_id=task_id and action='update' and actor_id=owner_id and changed_fields=array['title'] and summary like '%Changed activity task%') then raise exception 'Named, attributed task event was not captured'; end if;
  select count(*) into events_before from public.planning_events;
  update public.tasks set title=title where id=task_id;
  if (select count(*) from public.planning_events)<>events_before then raise exception 'No-op update inferred activity'; end if;
  perform pg_temp.expect_rejected(format('insert into planning_events(entity_type,entity_id,action,summary) values(''tasks'',%L,''update'',''Forged event'')',task_id));
  perform pg_temp.expect_rejected('update planning_events set summary=''Forged''');
  perform pg_temp.expect_rejected('delete from planning_events');
  if (select prosecdef from pg_proc where oid='public.apply_planning_schedule_moves(jsonb)'::regprocedure)
    or has_function_privilege('anon','public.apply_planning_schedule_moves(jsonb)','execute')
    or not has_function_privilege('authenticated','public.apply_planning_schedule_moves(jsonb)','execute') then raise exception 'RPC permission or invoker contract changed'; end if;

  insert into public.schedule_entries(job_id,user_id,date,hours,note) values(job_id,owner_id,'2026-03-01',2,'Keep first note') returning id into first_id;
  if not exists(select 1 from public.planning_events where entity_type='schedule_entries' and entity_id=first_id and summary='Insert: Planned hours · 2026-03-01') then raise exception 'Plan activity lost its date context'; end if;
  insert into public.schedule_entries(job_id,user_id,date,hours,note) values(job_id,owner_id,'2026-03-02',3,'Keep second note') returning id into second_id;
  insert into public.schedule_entries(job_id,user_id,date,hours,note) values(job_id,other_owner,'2026-03-04',1,'Legacy owner') returning id into other_id;
  select jsonb_agg(to_jsonb(s) order by id) into initial_rows from public.schedule_entries s where s.id in(first_id,second_id);
  moves:=jsonb_build_array(jsonb_build_object('id',first_id,'expected_job_id',job_id,'expected_phase_id',null,'expected_date','2026-03-01','expected_hours',2,'date','2026-03-05','hours',2),jsonb_build_object('id',second_id,'expected_job_id',job_id,'expected_phase_id',null,'expected_date','2026-03-02','expected_hours',999,'date','2026-03-06','hours',3));
  perform pg_temp.expect_rejected(format('select apply_planning_schedule_moves(%L)',moves));
  if (select jsonb_agg(to_jsonb(s) order by id) from public.schedule_entries s where s.id in(first_id,second_id)) is distinct from initial_rows then raise exception 'Stale multi-move partially changed plans'; end if;
  moves:=jsonb_set(moves,'{1,expected_hours}','3');
  perform pg_temp.expect_rejected(format('select apply_planning_schedule_moves(%L)',jsonb_set(moves,'{1,date}','"2026-03-05"')));
  perform pg_temp.expect_rejected(format('select apply_planning_schedule_moves(%L)',jsonb_build_array(moves->0,moves->0)));
  perform pg_temp.expect_rejected(format('select apply_planning_schedule_moves(%L)',jsonb_set(moves,'{0,expected_job_id}',to_jsonb(other_job))));
  perform pg_temp.expect_rejected(format('select apply_planning_schedule_moves(%L)',jsonb_set(moves,'{0,expected_phase_id}',to_jsonb(gen_random_uuid()))));
  perform pg_temp.expect_rejected(format('select apply_planning_schedule_moves(%L)',jsonb_set(moves,'{0,hours}','0')));
  perform pg_temp.expect_rejected(format('select apply_planning_schedule_moves(%L)',jsonb_build_array(jsonb_build_object('id',other_id,'expected_job_id',job_id,'expected_phase_id',null,'expected_date','2026-03-04','expected_hours',1,'date','2026-03-07','hours',1))));
  -- An unselected General-phase destination blocks the whole operation.
  perform pg_temp.expect_rejected(format('select apply_planning_schedule_moves(%L)',jsonb_build_array(jsonb_set(moves->0,'{date}','"2026-03-02"'))));
  update public.jobs set status='on_hold' where id=job_id;
  perform pg_temp.expect_rejected(format('select apply_planning_schedule_moves(%L)',moves));
  update public.jobs set status='active' where id=job_id;
  insert into public.phases(job_id,kind,name,sort_order) values(job_id,'queued','Retained planning',2) returning id into history_phase;
  update public.schedule_entries set phase_id=history_phase where id=first_id;
  perform pg_temp.expect_rejected(format('select apply_planning_schedule_moves(%L)',jsonb_build_array(jsonb_set(moves->0,'{expected_phase_id}',to_jsonb(history_phase)))));
  update public.schedule_entries set phase_id=null where id=first_id;
  -- Selected rows may swap without merging, losing identities, or changing notes.
  moves:=jsonb_set(jsonb_set(moves,'{0,date}','"2026-03-02"'),'{1,date}','"2026-03-01"');
  if not public.apply_planning_schedule_moves(moves) then raise exception 'Valid atomic swap failed'; end if;
  if not exists(select 1 from public.schedule_entries where id=first_id and date='2026-03-02' and hours=2 and user_id=owner_id and phase_id is null and note='Keep first note')
    or not exists(select 1 from public.schedule_entries where id=second_id and date='2026-03-01' and hours=3 and user_id=owner_id and phase_id is null and note='Keep second note') then raise exception 'Swap changed saved metadata'; end if;

  -- New history links must not prevent ordinary existing invoice/job deletion.
  delete from public.invoices i where i.id=test_data.invoice_id;
  if not exists(select 1 from public.follow_ups f where f.title='Invoice follow-up' and f.invoice_id is null and f.status='open') then raise exception 'Invoice deletion lost or rewrote follow-up history'; end if;
  delete from public.jobs j where j.id=test_data.job_id;
  if not exists(select 1 from public.follow_ups f where f.title='Invoice follow-up' and f.job_id is null)
    or not exists(select 1 from public.job_decisions d where d.title='Saved scope change' and d.job_id is null)
    or exists(select 1 from public.job_planning p where p.job_id=test_data.job_id)
    or not exists(select 1 from public.planning_events e where e.entity_type='jobs' and e.entity_id=test_data.job_id and e.action='delete' and e.job_id is null) then
    raise exception 'Job deletion did not preserve detached history or original cascade behavior';
  end if;

  execute 'set local role anon';
  foreach table_name in array array['daily_reviews','follow_ups','daily_availability','availability_blocks','job_planning','job_decisions','planning_events'] loop
    perform pg_temp.expect_rejected(format('select * from public.%I',table_name));
    if has_table_privilege('anon','public.' || table_name,'SELECT') then raise exception 'Anon access was granted to %',table_name; end if;
  end loop;
  perform pg_temp.expect_rejected('insert into daily_availability(date,base_hours) values(''2026-03-09'',5)');
  perform pg_temp.expect_rejected('select apply_planning_schedule_moves(''[]'')');
  execute 'reset role';
end $$;
rollback;
