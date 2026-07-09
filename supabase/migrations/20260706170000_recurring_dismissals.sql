-- Structured dismissals for upcoming/recurring charges: captures why a charge
-- was removed and whether to suppress the whole category, so similar predictions
-- don't come back.
alter table public.user_settings
  add column if not exists recurring_dismissals jsonb not null default '[]'::jsonb;
