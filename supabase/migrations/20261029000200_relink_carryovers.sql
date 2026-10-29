-- ── relink_carryovers: edits waiting for a re-linked bank's history ────────
-- After "Extend history" links a bank again as a new Item, the user's edits
-- (notes, tags, category / type overrides, splits, ...) are moved to the
-- matching new transactions (src/lib/relink). The 2-year history arrives in
-- the background, so edits on older transactions may not match right away;
-- they're kept here and retried after each load (src/lib/relink/pending.ts),
-- then dropped after 60 days. One row per re-link.
--
--   account_map  old account_id → new account_id
--   pending      PendingEdit[]: the old transaction's date / amount / name on
--                its NEW account, plus the edits to restore. No credentials,
--                no balances.
--
-- Owner-only RLS (same shape as public.inferences): the client writes and
-- clears its own rows. Idempotent.

create table if not exists public.relink_carryovers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  old_item_id   text not null,
  new_item_id   text not null,
  account_map   jsonb not null default '{}'::jsonb,
  pending       jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, old_item_id, new_item_id)
);

do $$
begin
  alter table public.relink_carryovers drop constraint if exists relink_carryovers_pending_check;
  alter table public.relink_carryovers add constraint relink_carryovers_pending_check
    check (jsonb_typeof(pending) = 'array');
  alter table public.relink_carryovers drop constraint if exists relink_carryovers_account_map_check;
  alter table public.relink_carryovers add constraint relink_carryovers_account_map_check
    check (jsonb_typeof(account_map) = 'object');
end $$;

create index if not exists relink_carryovers_user_idx on public.relink_carryovers(user_id);

drop trigger if exists trg_relink_carryovers_updated on public.relink_carryovers;
create trigger trg_relink_carryovers_updated before update on public.relink_carryovers
  for each row execute function public.update_updated_at_column();

alter table public.relink_carryovers enable row level security;
revoke all on public.relink_carryovers from anon;
revoke all on public.relink_carryovers from authenticated;
grant select, insert, update, delete on public.relink_carryovers to authenticated;
grant all on public.relink_carryovers to service_role;

drop policy if exists "Users manage own relink carryovers" on public.relink_carryovers;
create policy "Users manage own relink carryovers"
  on public.relink_carryovers
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
