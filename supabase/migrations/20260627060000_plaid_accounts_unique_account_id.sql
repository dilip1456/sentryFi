-- The upsert(onConflict: 'account_id') calls in plaid-exchange-token and
-- plaid-sync-transactions require a unique constraint on this column to work.
-- Without it, Postgres throws 42P10 and every account save silently no-ops.
ALTER TABLE plaid_accounts ADD CONSTRAINT plaid_accounts_account_id_key UNIQUE (account_id);
