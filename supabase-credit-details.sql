-- Run in Supabase SQL Editor to enable credit card detail tracking
-- (due dates, minimum payments, statement balances from Plaid Liabilities)

create table if not exists public.plaid_credit_details (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id text not null,
  last_statement_balance numeric,
  last_payment_amount numeric,
  last_payment_date date,
  minimum_payment_amount numeric,
  next_payment_due_date date,
  is_overdue boolean default false,
  apr numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, account_id)
);

alter table public.plaid_credit_details enable row level security;
create policy "Users can manage own credit details"
  on public.plaid_credit_details for all using (auth.uid() = user_id);
