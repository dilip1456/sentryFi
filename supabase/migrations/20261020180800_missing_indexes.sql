-- Production drift repair: indexes from 20260604055057 and 20260825120000
-- that never existed on the live project. Idempotent.
-- (obligations_user_id_idx is not re-created: the live obligations_user_idx
-- already indexes the same column.)
CREATE INDEX IF NOT EXISTS idx_plaid_accounts_user ON public.plaid_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_plaid_transactions_user_date ON public.plaid_transactions(user_id, date DESC);
CREATE INDEX IF NOT EXISTS cover_actions_user_id_idx ON public.cover_actions(user_id);
