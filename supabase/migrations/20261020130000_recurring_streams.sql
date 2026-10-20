-- ── Recurring streams + occurrences (Phase 3: recurring series & obligations) ──
-- Detected recurring series (salary, bills, loans, taxes, subscriptions,
-- yearly items) are STORED instead of being recomputed in React memos, so the
-- app, push alerts and AI all read the same predictions. Written by the
-- detector in src/lib/recurring/ (client today, edge function later).
--
--   recurring_streams   one row per series: cadence, schedule, amount model,
--                       next expected date/amount, must-pay flag, user status
--   stream_occurrences  one row per expected period: paid / late / skipped /
--                       expected, with the matched transaction
--
-- txn_type uses the shared classifier taxonomy (src/lib/classify/).
-- Idempotent ("if not exists" / drop-then-create policies) like the other
-- migrations in this folder.

create table if not exists public.recurring_streams (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  -- Stable detector key: "<direction>|<merchant key>[|~<amount bucket>]".
  series_key             text not null,
  merchant_key           text not null,
  display_name           text not null,
  direction              text not null check (direction in ('inflow', 'outflow')),
  txn_type               text not null check (txn_type in (
                           'spend', 'refund', 'income_salary', 'income_interest', 'income_other',
                           'transfer_internal', 'transfer_in', 'transfer_out', 'credit_card_payment',
                           'savings_contribution', 'obligation_loan', 'obligation_tax', 'obligation_bill')),
  subtype                text,          -- mortgage | student | auto | irs_estimated | property | rent | utility ...
  kind                   text not null check (kind in (
                           'salary', 'income', 'interest', 'bill', 'subscription', 'loan', 'tax',
                           'savings', 'card_payment', 'transfer')),
  category               text,
  cadence                text not null check (cadence in (
                           'weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'semiannual', 'yearly')),
  -- Full schedule (anchor days, phase, IRS calendar, weekend/holiday shift policy).
  schedule               jsonb not null default '{}'::jsonb,
  day_anchor             integer check (day_anchor between 1 and 31),
  shift_policy           text not null default 'none' check (shift_policy in ('none', 'before', 'after')),
  account_id             text,          -- account the money posts to / leaves from (plaid or manual id)
  counterpart_account_id text,          -- e.g. the linked mortgage account for a loan payment
  amount_median          numeric,
  amount_min             numeric,
  amount_max             numeric,
  amount_cv              numeric,
  is_fixed               boolean not null default false,
  price_changed          boolean not null default false,
  next_expected_date     date,
  next_expected_amount   numeric,
  first_seen             date,
  last_seen              date,
  occurrence_count       integer not null default 0,
  active                 boolean not null default true,
  status                 text not null default 'suggested' check (status in ('suggested', 'confirmed', 'dismissed')),
  must_pay               boolean not null default false,
  -- When true the user chose must_pay explicitly; the detector never overwrites it.
  must_pay_user_set      boolean not null default false,
  confidence             numeric,
  reason                 text,
  obligation_id          uuid references public.obligations(id) on delete set null,
  detector_version       integer not null default 1,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (user_id, series_key)
);

alter table public.recurring_streams enable row level security;

drop policy if exists "Users manage own recurring streams" on public.recurring_streams;
create policy "Users manage own recurring streams"
  on public.recurring_streams
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists recurring_streams_user_next_idx
  on public.recurring_streams(user_id, next_expected_date);
create index if not exists recurring_streams_user_kind_idx
  on public.recurring_streams(user_id, kind);

create table if not exists public.stream_occurrences (
  id               uuid primary key default gen_random_uuid(),
  stream_id        uuid not null references public.recurring_streams(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  -- Nominal date ("2026-10-15") or "2026-Q2" for IRS estimated taxes.
  period           text not null,
  label            text,
  expected_date    date not null,
  expected_amount  numeric,
  status           text not null default 'expected' check (status in ('expected', 'paid', 'late', 'skipped')),
  -- No FK: manual / imported transactions use the same free-form id space.
  transaction_id   text,
  actual_date      date,
  actual_amount    numeric,
  days_late        integer,
  -- When true the user set the status (e.g. "paid in cash", "skipped this month").
  user_set         boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (stream_id, period)
);

alter table public.stream_occurrences enable row level security;

drop policy if exists "Users manage own stream occurrences" on public.stream_occurrences;
create policy "Users manage own stream occurrences"
  on public.stream_occurrences
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.recurring_streams s
      where s.id = stream_id and s.user_id = auth.uid()
    )
  );

create index if not exists stream_occurrences_user_date_idx
  on public.stream_occurrences(user_id, expected_date);
create index if not exists stream_occurrences_user_status_idx
  on public.stream_occurrences(user_id, status);
create index if not exists stream_occurrences_txn_idx
  on public.stream_occurrences(transaction_id) where transaction_id is not null;
