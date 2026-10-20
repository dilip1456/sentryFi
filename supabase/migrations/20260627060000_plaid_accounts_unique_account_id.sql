-- The upsert(onConflict: 'account_id') calls in plaid-exchange-token and
-- plaid-sync-transactions require a unique constraint on this column to work.
-- Without it, Postgres throws 42P10 and every account save silently no-ops.
-- Guarded: on a fresh project 20260604055057 already created this constraint
-- (inline UNIQUE, same auto-generated name), which made `supabase db reset`
-- fail here. Already applied on production, where it is never re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.plaid_accounts'::regclass AND conname = 'plaid_accounts_account_id_key'
  ) THEN
    ALTER TABLE public.plaid_accounts ADD CONSTRAINT plaid_accounts_account_id_key UNIQUE (account_id);
  END IF;
END $$;
