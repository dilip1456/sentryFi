-- ── Obligations: cadence, next due date, must-pay, stream link ───────────────
-- Obligations become schedule-aware and can be backed by a detected recurring
-- stream (recurring_streams, previous migration). Requires
-- 20260825120000_obligations_and_cover_actions.sql and
-- 20261020130000_recurring_streams.sql.
--
-- obligations.kind = the stream kinds that can back an obligation (money the
-- user sends out). It must stay in sync with OBLIGATION_KINDS in
-- src/lib/recurring/rows.ts; a test checks that. Inflow stream kinds (salary,
-- income, interest) never become obligations.
--
-- Production safety: `obligations` was hand-created before it was ever in a
-- migration, so `cadence` / `kind` / `due_day` / `stream_id` may already exist
-- with other values or types. This migration therefore:
--   1. adds missing columns only (if not exists);
--   2. normalises known legacy spellings in place, but only when the column is text;
--   (our own checks are dropped first so re-runs can't trip over them)
--   3. adds each check as NOT VALID (enforced for new and updated rows only, so it
--      can't fail on old rows), then tries VALIDATE and only logs a NOTICE if
--      some legacy rows still don't match;
--   4. adds the stream_id FK only when the column is uuid.
-- Safe to run more than once.

alter table public.obligations add column if not exists cadence text;
alter table public.obligations add column if not exists due_day integer;
alter table public.obligations add column if not exists next_due_date date;
alter table public.obligations add column if not exists stream_id uuid;
alter table public.obligations add column if not exists must_pay boolean not null default false;
alter table public.obligations add column if not exists kind text;

do $$
declare
  col_type text;
begin
  -- Drop our checks/FK first: on a re-run a NOT VALID check from the previous
  -- run would otherwise reject the normalising UPDATE of a legacy row.
  alter table public.obligations drop constraint if exists obligations_cadence_check;
  alter table public.obligations drop constraint if exists obligations_due_day_check;
  alter table public.obligations drop constraint if exists obligations_kind_check;
  alter table public.obligations drop constraint if exists obligations_stream_id_fkey;

  -- 2. Normalise legacy values (text columns only).
  select data_type into col_type from information_schema.columns
   where table_schema = 'public' and table_name = 'obligations' and column_name = 'cadence';
  if col_type in ('text', 'character varying') then
    update public.obligations set cadence = case lower(btrim(cadence))
        when 'week' then 'weekly'
        when 'bi-weekly' then 'biweekly'      when 'bi_weekly' then 'biweekly'   when 'fortnightly' then 'biweekly'
        when 'semi-monthly' then 'semimonthly' when 'semi_monthly' then 'semimonthly' when 'twice-monthly' then 'semimonthly'
        when 'month' then 'monthly'
        when 'quarter' then 'quarterly'
        when 'semi-annual' then 'semiannual'   when 'semi_annual' then 'semiannual' when 'semi-annually' then 'semiannual' when 'biannual' then 'semiannual'
        when 'annual' then 'yearly'            when 'annually' then 'yearly'      when 'year' then 'yearly'
        when '' then null
        else lower(btrim(cadence)) end
     where cadence is not null;
  end if;

  select data_type into col_type from information_schema.columns
   where table_schema = 'public' and table_name = 'obligations' and column_name = 'kind';
  if col_type in ('text', 'character varying') then
    update public.obligations set kind = case lower(btrim(kind))
        when 'loans' then 'loan'   when 'mortgage' then 'loan' when 'student_loan' then 'loan' when 'auto_loan' then 'loan'
        when 'taxes' then 'tax'
        when 'bills' then 'bill'   when 'utility' then 'bill' when 'utilities' then 'bill' when 'rent' then 'bill' when 'insurance' then 'bill'
        when 'subscriptions' then 'subscription'
        when 'card-payment' then 'card_payment' when 'credit_card' then 'card_payment' when 'credit_card_payment' then 'card_payment'
        when '' then null
        else lower(btrim(kind)) end
     where kind is not null;
  end if;

  -- 3. Checks: NOT VALID first, then best-effort VALIDATE.
  alter table public.obligations add constraint obligations_cadence_check
    check (cadence is null or cadence in ('weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'semiannual', 'yearly')) not valid;

  alter table public.obligations add constraint obligations_due_day_check
    check (due_day is null or due_day between 1 and 31) not valid;

  alter table public.obligations add constraint obligations_kind_check
    check (kind is null or kind in ('loan', 'tax', 'bill', 'subscription', 'card_payment', 'savings', 'transfer')) not valid;

  begin
    alter table public.obligations validate constraint obligations_cadence_check;
  exception when check_violation then
    raise notice 'obligations_cadence_check left NOT VALID: legacy rows have other cadence values';
  end;
  begin
    alter table public.obligations validate constraint obligations_due_day_check;
  exception when check_violation then
    raise notice 'obligations_due_day_check left NOT VALID: legacy rows have due_day outside 1-31';
  end;
  begin
    alter table public.obligations validate constraint obligations_kind_check;
  exception when check_violation then
    raise notice 'obligations_kind_check left NOT VALID: legacy rows have other kind values';
  end;

  -- 4. stream_id FK only if the column is uuid.
  select data_type into col_type from information_schema.columns
   where table_schema = 'public' and table_name = 'obligations' and column_name = 'stream_id';
  if col_type = 'uuid' then
    alter table public.obligations add constraint obligations_stream_id_fkey
      foreign key (stream_id) references public.recurring_streams(id) on delete set null not valid;
    begin
      alter table public.obligations validate constraint obligations_stream_id_fkey;
    exception when foreign_key_violation then
      raise notice 'obligations_stream_id_fkey left NOT VALID: legacy stream_id values do not match recurring_streams';
    end;
  else
    raise notice 'obligations.stream_id is %, not uuid; skipping FK', col_type;
  end if;
end $$;

create index if not exists obligations_stream_id_idx on public.obligations(stream_id);
