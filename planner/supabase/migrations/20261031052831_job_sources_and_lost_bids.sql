-- Leads and bids: who sent each job, and why a bid was lost.
-- A lead is a job whose bidding phase hasn't started (no schema needed);
-- a won bid is one that moved past bidding.
alter table public.jobs
  add column if not exists source text not null default '',
  add column if not exists lost_reason text not null default '',
  add column if not exists lost_date date;
