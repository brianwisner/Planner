-- Stop adding Queued to newly created jobs. Do not rewrite existing phases,
-- sort orders, queue-entry dates, or any customer history and references.
-- CREATE OR REPLACE retains the function identity, owner, ACL, and job trigger.
create or replace function public.add_standard_phases() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into phases (job_id, kind, name, sort_order) values
    (new.id, 'bidding',        'Bidding',                      1),
    (new.id, 'design',         'Original design',              2),
    (new.id, 'plan_check',     'County / plan-check comments', 3),
    (new.id, 'construction',   'Construction changes',         4),
    (new.id, 'client_changes', 'Client-requested changes',     5);
  return new;
end $$;
