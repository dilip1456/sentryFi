-- Keep Plaid's richer personal_finance_category signal instead of collapsing
-- it to a primary-only label at sync time. Before this, INCOME_INTEREST_EARNED,
-- INCOME_DIVIDENDS and INCOME_TAX_REFUND were all stored as "Salary", and every
-- LOAN_PAYMENTS_* (credit card, mortgage, student, auto) as "Bills & Utilities".
-- The shared classifier (src/lib/classify) reads these columns when present.
-- Safe to run more than once.
alter table public.plaid_transactions
  add column if not exists pfc_primary text,
  add column if not exists pfc_detailed text,
  add column if not exists pfc_confidence text,
  add column if not exists merchant_entity_id text;

create index if not exists idx_plaid_transactions_user_pfc
  on public.plaid_transactions(user_id, pfc_detailed);

-- Existing rows are backfilled by running one full re-sync per item
-- (plaid-sync-transactions with {"full_resync": true}), which re-pulls every
-- transaction from Plaid with its detailed category. No data is deleted.
