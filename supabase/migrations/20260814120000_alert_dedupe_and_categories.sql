-- ── Fix duplicate alert sends ────────────────────────────────────────────────
-- send-alerts runs on a 20-minute cron and previously deduped by doing a
-- SELECT to check for an existing alert_log row, then an INSERT if none was
-- found. That's not atomic: overlapping/near-simultaneous invocations can
-- both pass the SELECT before either INSERT lands, producing duplicate rows
-- and duplicate pushes/emails for the same underlying event (e.g. the same
-- "payment due" notice firing on every cron tick all day).
--
-- Clean up any duplicates that already exist from the race, keeping one
-- arbitrary row per (user_id, alert_key)...
delete from public.alert_log a
using public.alert_log b
where a.user_id = b.user_id
  and a.alert_key = b.alert_key
  and a.id > b.id;

-- ...then enforce it at the database level so it can never happen again. The
-- edge function now does an atomic upsert with onConflict + ignoreDuplicates
-- against this constraint instead of the old check-then-insert.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'alert_log_user_alert_key_key'
  ) then
    alter table public.alert_log
      add constraint alert_log_user_alert_key_key unique (user_id, alert_key);
  end if;
end $$;

-- ── Per-category alert opt-in/out ────────────────────────────────────────────
-- Lets a user keep push/email on globally but silence a specific alert type
-- (e.g. turn off "payment due" reminders without losing their other
-- threshold settings). Defaults to true so existing users keep getting every
-- alert type they already get today until they explicitly opt out.
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
