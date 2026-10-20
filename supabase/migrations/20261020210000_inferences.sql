-- ── Inferences: detected facts the user confirms or rejects ─────────────────
-- My Money "Findings" (review/insights/v2/INFERENCES.md §1). Every detector in
-- src/lib/infer/ produces findings; one row per (user, kind, subject).
--
--   suggested ──Confirm──▶ confirmed   (the fact is written, e.g. recurring_streams.autopay)
--       │     ──Not right─▶ rejected   (reason kept; suppressed for 180 days unless the
--       │                               evidence materially changes, see src/lib/infer/decisions.ts)
--       └──── 60 days unanswered ──▶ expired
--   confirmed ──Undo──▶ suggested
--
-- Only `confirmed` rows count toward totals (Dilip's rule). `kind` must stay
-- equal to INFERENCE_KINDS in src/lib/infer/types.ts (a test checks this).
-- Owner-only RLS, same grants as the user-managed tables in
-- 20261020170100_rls_owner_policies.sql: users read and write their own rows
-- (detection and decisions run client-side today), no anon access.
-- Idempotent.

create table if not exists public.inferences (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  kind              text not null,
  -- What the finding is about: a recurring_streams row (series_key), a Plaid
  -- account_id, a transaction_id, a set-aside fund key, or the user as a whole.
  subject_type      text not null,
  subject_ref       text not null,
  -- Detector output (mode, amount, pay-from account, day, ...). No free text
  -- from transactions beyond the merchant display name.
  payload           jsonb not null default '{}'::jsonb,
  confidence        numeric(4,3) not null,
  evidence_txn_ids  text[] not null default '{}',
  -- Hash of the evidence that matters for "materially changed" (amount
  -- bucket, account, cadence). A rejected finding comes back only when it differs.
  fingerprint       text,
  status            text not null default 'suggested',
  reason            text,
  suppressed_until  timestamptz,
  expires_at        timestamptz,
  detector_version  integer not null default 1,
  last_detected_at  timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  decided_at        timestamptz,
  unique (user_id, kind, subject_ref)
);

do $$
begin
  alter table public.inferences drop constraint if exists inferences_kind_check;
  alter table public.inferences add constraint inferences_kind_check check (kind in (
    'bill_autopay', 'card_autopay', 'card_autopay_source', 'autopay_missed',
    'paycheck', 'salary_change', 'yearly_bill', 'set_aside_funding', 'set_aside_status',
    'low_balance', 'price_increase', 'card_interest', 'interest_earned'));
  alter table public.inferences drop constraint if exists inferences_subject_type_check;
  alter table public.inferences add constraint inferences_subject_type_check
    check (subject_type in ('stream', 'account', 'transaction', 'fund', 'user'));
  alter table public.inferences drop constraint if exists inferences_status_check;
  alter table public.inferences add constraint inferences_status_check
    check (status in ('suggested', 'confirmed', 'rejected', 'expired'));
  alter table public.inferences drop constraint if exists inferences_confidence_check;
  alter table public.inferences add constraint inferences_confidence_check
    check (confidence >= 0 and confidence <= 1);
  alter table public.inferences drop constraint if exists inferences_reason_check;
  alter table public.inferences add constraint inferences_reason_check
    check (reason is null or char_length(reason) <= 500);
end $$;

create index if not exists inferences_user_status_idx on public.inferences(user_id, status);
create index if not exists inferences_user_kind_idx on public.inferences(user_id, kind);

-- decided_at follows status: stamped on confirm/reject, cleared on undo.
-- A rejection without an explicit suppression gets the default 180 days.
create or replace function public.inferences_status_stamp()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status in ('confirmed', 'rejected') then
      new.decided_at := coalesce(new.decided_at, now());
    elsif new.status = 'suggested' then
      new.decided_at := null;
    end if;
    if new.status = 'rejected' and new.suppressed_until is null then
      new.suppressed_until := now() + interval '180 days';
    end if;
  end if;
  return new;
end
$fn$;

drop trigger if exists trg_inferences_status_stamp on public.inferences;
create trigger trg_inferences_status_stamp before insert or update on public.inferences
  for each row execute function public.inferences_status_stamp();

drop trigger if exists trg_inferences_updated on public.inferences;
create trigger trg_inferences_updated before update on public.inferences
  for each row execute function public.update_updated_at_column();

alter table public.inferences enable row level security;
revoke all on public.inferences from anon;
revoke all on public.inferences from authenticated;
grant select, insert, update, delete on public.inferences to authenticated;
grant all on public.inferences to service_role;

drop policy if exists "Users manage own inferences" on public.inferences;
create policy "Users manage own inferences"
  on public.inferences
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
