-- ── Planned Savings goals ────────────────────────────────────────────────────
-- The new Budget page lets a user promote an auto-detected recurring transfer
-- (e.g. "$500/mo to Ally Savings") into a tracked goal with a monthly target.
-- Stored the same way as the app's other per-user JSON blobs (customCats,
-- manualIncome, etc.) — a single jsonb array column on user_settings.
alter table public.user_settings
  add column if not exists savings_goals jsonb not null default '[]'::jsonb;
