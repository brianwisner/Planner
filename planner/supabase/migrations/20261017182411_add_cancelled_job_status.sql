-- Allow job cancellation without changing or removing any existing records.
-- Apply to the existing Supabase project before publishing the new status menu.
begin;

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in ('active', 'on_hold', 'complete', 'cancelled', 'archived'));

commit;
