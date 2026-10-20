-- Keep the customer-facing contact and Gmail sender separate from Auth/profile email.
alter table public.settings
  add column if not exists business_email text not null default '';

comment on column public.settings.business_email is
  'Business contact shown on invoices and selected for Gmail messages; independent of sign-in email.';
