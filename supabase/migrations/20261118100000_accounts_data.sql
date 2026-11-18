-- Accounts redesign, data (review/accounts-redesign/RATIONALE.md §4 "Data gaps").
--
--  1. plaid_accounts.credit_limit: Plaid balances.limit, so card rows can show
--     utilization without guessing from current + available.
--  2. plaid_items.error_code / error_at / last_synced_at: per-bank sync health
--     for the "Fidelity stopped syncing" strip, Connections and "as of" dates.
--     Written by the plaid-* edge functions (service_role); the client only
--     reads them, so authenticated gets column-level SELECT on just these
--     three (plaid_items uses column grants since 20261020170000 so that
--     access_token never reaches the client).
--  3. inferences.kind: account_dormant and account_duplicate
--     (src/lib/infer/types.ts INFERENCE_KINDS; a test checks they match).
--
-- Idempotent. Version is in the 20261118100000+ block.

alter table public.plaid_accounts add column if not exists credit_limit numeric;

alter table public.plaid_items add column if not exists error_code text;
alter table public.plaid_items add column if not exists error_at timestamptz;
alter table public.plaid_items add column if not exists last_synced_at timestamptz;

grant select (error_code, error_at, last_synced_at) on public.plaid_items to authenticated;

do $$
begin
  alter table public.inferences drop constraint if exists inferences_kind_check;
  alter table public.inferences add constraint inferences_kind_check check (kind in (
    'bill_autopay', 'card_autopay', 'card_autopay_source', 'autopay_missed',
    'paycheck', 'salary_change', 'yearly_bill', 'set_aside_funding', 'set_aside_status',
    'low_balance', 'price_increase', 'card_interest', 'interest_earned',
    'account_dormant', 'account_duplicate'));
end $$;

notify pgrst, 'reload schema';
