-- Preserve Plaid's original legacy category path separately from the app's
-- effective category and personal_finance_category mapping.
alter table public.plaid_transactions
  add column if not exists plaid_category text[];