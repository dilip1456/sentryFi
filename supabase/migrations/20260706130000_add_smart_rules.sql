-- Generic multi-condition transaction rules ("Smart Rules").
-- Stored as a JSON array on user_settings; each rule has conditions + actions.
alter table public.user_settings
  add column if not exists smart_rules jsonb not null default '[]'::jsonb;
