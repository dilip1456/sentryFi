-- ── Obligations + cover actions ─────────────────────────────────────────────
-- ObligationsView.tsx and CoverModal have called supabase.from("obligations")
-- / .from("cover_actions") for a while, but neither table was ever captured
-- in a migration (they were created by hand at some point), which is why
-- src/integrations/supabase/types.ts has no knowledge of either and every
-- query against them falls back to a generic/untyped overload in tsc. Using
-- "if not exists" everywhere so this is safe to run whether the tables
-- already exist live or not — it just fills in whatever's missing.

create table if not exists public.obligations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  name             text not null,
  type             text not null default 'fixed', -- 'fixed' | 'flex' | 'envelope' | 'goal'
  amount           numeric not null default 0,
  category         text,
  merchant_hint    text,
  goal_target      numeric,
  goal_deadline    date,
  sort_order       integer not null default 0,
  active           boolean not null default true,
  -- Which account the payment is actually drafted from — a loan/bill you
  -- "have to pay without fail" should say where the money comes from, not
  -- just how much. References plaid_accounts.account_id (text), not a uuid
  -- fk, since manual accounts use the same free-form id shape.
  funding_account_id text,
  created_at       timestamptz not null default now()
);

alter table public.obligations add column if not exists funding_account_id text;
alter table public.obligations add column if not exists active boolean not null default true;
alter table public.obligations add column if not exists sort_order integer not null default 0;

alter table public.obligations enable row level security;

drop policy if exists "Users manage own obligations" on public.obligations;
create policy "Users manage own obligations"
  on public.obligations
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists obligations_user_id_idx on public.obligations(user_id);

create table if not exists public.cover_actions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  month        text not null,      -- "2026-08"
  from_id      uuid,                -- obligation/envelope/goal the funds came from (null = absorbed/one-time)
  to_id        uuid not null,       -- the obligation that was over
  amount       numeric not null default 0,
  action_type  text not null,       -- 'shift' | 'goal_borrow' | 'absorb'
  note         text,
  created_at   timestamptz not null default now()
);

alter table public.cover_actions enable row level security;

drop policy if exists "Users manage own cover actions" on public.cover_actions;
create policy "Users manage own cover actions"
  on public.cover_actions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists cover_actions_user_id_idx on public.cover_actions(user_id);
