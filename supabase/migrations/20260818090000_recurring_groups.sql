-- ── Recurring budget entries ─────────────────────────────────────────────────
-- The Budget page's new "Recurring Expenses" section lets a user track a
-- named recurring bill (e.g. "Mortgage Payment", "Netflix") with EXPLICIT
-- transaction membership so they can freely add/remove individual
-- transactions from it, rather than relying on a fragile merchant-string
-- match alone. Stored the same way as the app's other per-user JSON blobs.
alter table public.user_settings
  add column if not exists recurring_groups jsonb not null default '[]'::jsonb;
