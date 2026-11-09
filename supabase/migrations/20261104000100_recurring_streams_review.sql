-- ── Financial Picture "Detected recurring" review decisions ──────────────────
-- Reuses public.recurring_streams (no new table). The Picture screen stores
-- one row per decision (confirm / edit / "Not recurring"), keyed
-- series_key = 'picture:<review key>' and source = 'picture', so future
-- detection runs keep the person's choice: a dismissed item never returns and
-- an edited one keeps the user_* values. Detector rows keep source='detector'.
--
-- Files only; idempotent (add column if not exists, drop-then-add checks,
-- index if not exists). Privileges: revoke, then grant to authenticated and
-- service_role. No anon access. RLS (own rows) is unchanged from 20261020130000.

alter table public.recurring_streams
  add column if not exists source                  text not null default 'detector',
  add column if not exists review_group            text,
  add column if not exists pattern_label           text,
  add column if not exists user_cadence            text,
  add column if not exists user_amount             numeric,
  add column if not exists user_group              text,
  add column if not exists user_cover_account_id   text,
  add column if not exists matched_transaction_ids text[] not null default '{}'::text[],
  add column if not exists decided_at              timestamptz;

alter table public.recurring_streams drop constraint if exists recurring_streams_source_check;
alter table public.recurring_streams add constraint recurring_streams_source_check
  check (source in ('detector', 'picture'));

alter table public.recurring_streams drop constraint if exists recurring_streams_review_group_check;
alter table public.recurring_streams add constraint recurring_streams_review_group_check
  check (review_group is null or review_group in ('income', 'bills', 'insurance_tax', 'payments', 'savings'));

alter table public.recurring_streams drop constraint if exists recurring_streams_user_group_check;
alter table public.recurring_streams add constraint recurring_streams_user_group_check
  check (user_group is null or user_group in ('income', 'bills', 'insurance_tax', 'payments', 'savings'));

alter table public.recurring_streams drop constraint if exists recurring_streams_user_cadence_check;
alter table public.recurring_streams add constraint recurring_streams_user_cadence_check
  check (user_cadence is null or user_cadence in (
    'weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'semiannual', 'yearly'));

alter table public.recurring_streams drop constraint if exists recurring_streams_user_amount_check;
alter table public.recurring_streams add constraint recurring_streams_user_amount_check
  check (user_amount is null or user_amount >= 0);

create index if not exists recurring_streams_user_source_idx
  on public.recurring_streams(user_id, source);

-- Same own-rows policy, restated so a rerun always ends in the same state.
alter table public.recurring_streams enable row level security;
drop policy if exists "Users manage own recurring streams" on public.recurring_streams;
create policy "Users manage own recurring streams"
  on public.recurring_streams
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on table public.recurring_streams from anon;
revoke all on table public.recurring_streams from authenticated;
grant select, insert, update, delete on table public.recurring_streams to authenticated;
grant all on table public.recurring_streams to service_role;
