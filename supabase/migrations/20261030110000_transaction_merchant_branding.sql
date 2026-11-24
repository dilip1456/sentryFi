-- Preserve the merchant branding fields Plaid supplies with transactions.
alter table public.plaid_transactions
  add column if not exists logo_url text,
  add column if not exists website text;
