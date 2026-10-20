-- ── Plaid loan details (mortgage / student) ─────────────────────────────────
-- syncLiabilities previously stored credit cards only (plaid_credit_details).
-- /liabilities/get also returns mortgage[] and student[]; the servicer's next
-- due date and payment amount feed the loan recurring streams' predictions.
-- Written only by the plaid-sync-transactions / plaid-exchange-token /
-- plaid-grant-consent edge functions (service_role, which bypasses RLS).
-- Users can only read their own rows: same grants and policy shape as
-- plaid_credit_details in PR #10 (20261020170100_rls_owner_policies.sql):
-- no anon access, SELECT-only for authenticated, no user INSERT/UPDATE/DELETE
-- policy, ALL for service_role.

create table if not exists public.plaid_loan_details (
  user_id                 uuid not null references auth.users(id) on delete cascade,
  account_id              text not null,
  kind                    text not null check (kind in ('mortgage', 'student')),
  next_payment_due_date   date,
  next_monthly_payment    numeric,
  minimum_payment_amount  numeric,
  last_payment_amount     numeric,
  last_payment_date       date,
  interest_rate           numeric,
  origination_principal   numeric,
  outstanding_principal   numeric,
  escrow_balance          numeric,
  ytd_interest_paid       numeric,
  ytd_principal_paid      numeric,
  is_overdue              boolean default false,
  updated_at              timestamptz not null default now(),
  primary key (user_id, account_id)
);

alter table public.plaid_loan_details enable row level security;

revoke all on public.plaid_loan_details from anon;
revoke all on public.plaid_loan_details from authenticated;
grant select on public.plaid_loan_details to authenticated;
grant all on public.plaid_loan_details to service_role;

-- Earlier revision of this migration created a FOR ALL policy; replace it.
drop policy if exists "Users can manage own loan details" on public.plaid_loan_details;
drop policy if exists "Users view own loan details" on public.plaid_loan_details;
create policy "Users view own loan details"
  on public.plaid_loan_details
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop trigger if exists trg_plaid_loan_details_updated on public.plaid_loan_details;
create trigger trg_plaid_loan_details_updated before update on public.plaid_loan_details
  for each row execute function public.update_updated_at_column();
