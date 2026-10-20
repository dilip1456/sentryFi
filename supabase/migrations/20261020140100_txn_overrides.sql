-- Per-transaction classification overrides ("this internal transfer is
-- really spending", "this deposit is income"). The user's choice always wins
-- over the auto-classifier (src/lib/classify). Keyed by Plaid's stable
-- transaction_id so it survives re-syncs; rows disappear with the
-- transaction. Safe to run more than once.
create table if not exists public.txn_overrides (
  user_id        uuid not null references auth.users(id) on delete cascade,
  transaction_id text not null references public.plaid_transactions(transaction_id) on delete cascade,
  txn_type       text not null check (txn_type in (
    'spend','refund','income_salary','income_interest','income_other',
    'transfer_internal','transfer_in','transfer_out','credit_card_payment',
    'savings_contribution','obligation_loan','obligation_tax','obligation_bill')),
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (user_id, transaction_id)
);

grant select, insert, update, delete on public.txn_overrides to authenticated;
grant all on public.txn_overrides to service_role;

alter table public.txn_overrides enable row level security;

drop policy if exists "Users view own txn overrides" on public.txn_overrides;
create policy "Users view own txn overrides" on public.txn_overrides
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users insert own txn overrides" on public.txn_overrides;
create policy "Users insert own txn overrides" on public.txn_overrides
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users update own txn overrides" on public.txn_overrides;
create policy "Users update own txn overrides" on public.txn_overrides
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users delete own txn overrides" on public.txn_overrides;
create policy "Users delete own txn overrides" on public.txn_overrides
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists idx_txn_overrides_user on public.txn_overrides(user_id);

drop trigger if exists trg_txn_overrides_updated on public.txn_overrides;
create trigger trg_txn_overrides_updated before update on public.txn_overrides
  for each row execute function public.update_updated_at_column();
