-- ── plaid_accounts.persistent_account_id ────────────────────────────────────
-- Plaid's stable account identifier at institutions that use tokenized
-- account numbers (Chase, PNC, US Bank, ...). account_id changes when a bank
-- is linked again as a new Item ("Extend history", docs/PLAID_HISTORY.md);
-- persistent_account_id doesn't, so the re-link carry-over
-- (src/lib/relink/match.ts, plaid-relink) matches on it first and falls back
-- to mask + type + subtype. Written by plaid-exchange-token,
-- plaid-sync-transactions and plaid-relink; null where Plaid doesn't provide it.
-- No grant changes: plaid_accounts keeps its existing RLS. Idempotent.

alter table public.plaid_accounts add column if not exists persistent_account_id text;

create index if not exists plaid_accounts_user_persistent_idx
  on public.plaid_accounts(user_id, persistent_account_id)
  where persistent_account_id is not null;
