-- Production drift repair: per-category alert opt-in/out on alert_preferences.
--
-- Same columns, types and defaults as the "Per-category alert opt-in/out"
-- block of 20260814120000_alert_dedupe_and_categories.sql, which is recorded
-- as applied on the live project but whose columns never existed there.
-- NotificationPreferences upserts these columns (so saving failed with an
-- unknown-column 400) and send-alerts reads them. Defaults are true, so
-- existing users keep getting every alert type until they opt out.
-- Idempotent.
alter table public.alert_preferences
  add column if not exists alert_budget_threshold boolean not null default true,
  add column if not exists alert_low_balance boolean not null default true,
  add column if not exists alert_payment_due boolean not null default true,
  add column if not exists alert_large_txn boolean not null default true,
  add column if not exists alert_deposit boolean not null default true,
  add column if not exists alert_refund boolean not null default true,
  add column if not exists alert_transfer boolean not null default true,
  add column if not exists alert_cc_payment boolean not null default true,
  add column if not exists alert_insight boolean not null default true;

NOTIFY pgrst, 'reload schema';
