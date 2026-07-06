create table if not exists public.manual_accounts (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,

  -- identity
  name                 text not null,
  institution_name     text,
  type                 text not null default 'other',
  -- 'mortgage' | 'auto_loan' | 'student_loan' | 'personal_loan' |
  -- 'investment' | 'checking' | 'savings' | 'credit_card' | 'other'

  -- balance (positive = asset, negative = liability; caller normalizes)
  current_balance      numeric,

  -- money map role
  role                 text not null default 'debt',
  role_label           text,

  -- mortgage / loan specific
  original_loan_amount numeric,
  interest_rate        numeric,        -- annual %, e.g. 6.75
  monthly_payment      numeric,        -- principal + interest only
  loan_start_date      date,
  loan_term_years      integer,        -- 15 or 30 (or custom)
  property_address     text,
  property_value       numeric,        -- for equity calc; user estimate or Zillow

  -- general
  notes                text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.manual_accounts enable row level security;

create policy "Users manage own manual accounts"
  on public.manual_accounts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index manual_accounts_user_id_idx on public.manual_accounts(user_id);
