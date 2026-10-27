-- ── Credit card statement history ───────────────────────────────────────────
-- plaid_credit_details is overwritten on every sync, so the statement balance
-- and minimum of past cycles are lost. Card autopay mode detection
-- (full / minimum / fixed, INFERENCES.md §2.2) needs them per cycle, so the
-- plaid-* functions also snapshot each statement here, keyed by its issue
-- date (creditStatementRows in supabase/functions/_shared/plaid-liabilities.ts).
--
-- Written only by the plaid-* edge functions (service_role). Users read their
-- own rows: same grants and policy shape as plaid_credit_details /
-- plaid_loan_details. Idempotent.

create table if not exists public.credit_statements (
  user_id                 uuid not null references auth.users(id) on delete cascade,
  account_id              text not null,
  statement_issue_date    date not null,
  statement_balance       numeric,
  minimum_payment_amount  numeric,
  due_date                date,
  last_payment_amount     numeric,
  last_payment_date       date,
  is_overdue              boolean not null default false,
  captured_at             timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  primary key (user_id, account_id, statement_issue_date)
);

create index if not exists credit_statements_user_account_idx
  on public.credit_statements(user_id, account_id, statement_issue_date desc);

drop trigger if exists trg_credit_statements_updated on public.credit_statements;
create trigger trg_credit_statements_updated before update on public.credit_statements
  for each row execute function public.update_updated_at_column();

alter table public.credit_statements enable row level security;
revoke all on public.credit_statements from anon;
revoke all on public.credit_statements from authenticated;
grant select on public.credit_statements to authenticated;
grant all on public.credit_statements to service_role;

drop policy if exists "Users view own credit statements" on public.credit_statements;
create policy "Users view own credit statements"
  on public.credit_statements
  for select
  to authenticated
  using ((select auth.uid()) = user_id);
