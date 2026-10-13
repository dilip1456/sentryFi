-- ── Credit card autopay mapping ──────────────────────────────────────────────
-- Financial overview's new Credit Cards section mirrors what users already
-- track by hand: which everyday/checking account is set up to auto-pay each
-- credit card's statement balance. Stored the same way as the app's other
-- per-user JSON blobs (accountRoles, overageFundingPrefs, etc.) — a single
-- jsonb object column on user_settings, keyed by the card's account_id,
-- valued by the funding account's account_id.
alter table public.user_settings
  add column if not exists card_autopay_from jsonb not null default '{}'::jsonb;
