-- Remembers which account last covered an over-budget category (prediction
-- default for future overages) and tracks confirmed "you still need to make
-- this transfer" items shown on Home until marked done or dismissed.
alter table public.user_settings
  add column if not exists overage_funding_prefs jsonb not null default '{}'::jsonb,
  add column if not exists planned_transfers jsonb not null default '[]'::jsonb;
