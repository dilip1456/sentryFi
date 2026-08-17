-- ── Per-transaction annotations ─────────────────────────────────────────────
-- Tags, notes, an explicit "is this recurring?" override, and split lines —
-- all keyed by transaction id, same sparse-map pattern as cat_overrides /
-- name_overrides already on this table.
alter table public.user_settings
  add column if not exists txn_tags jsonb not null default '{}'::jsonb,
  add column if not exists txn_notes jsonb not null default '{}'::jsonb,
  add column if not exists recurring_overrides jsonb not null default '{}'::jsonb,
  add column if not exists txn_splits jsonb not null default '{}'::jsonb;
