-- Production drift repair: obligations.funding_account_id.
--
-- Defined in 20260825120000_obligations_and_cover_actions.sql, which was never
-- applied to the live project (the table was created by hand). Which account
-- a bill/loan is drafted from; references plaid_accounts.account_id (text),
-- not a uuid FK, since manual accounts use the same free-form id shape.
-- Idempotent.
alter table public.obligations add column if not exists funding_account_id text;

NOTIFY pgrst, 'reload schema';
