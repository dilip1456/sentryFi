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
-- migration, so cadence / due_day / kind / stream_id may already exist with
-- other values or even other types (integer cadence, text due_day, ...).
-- This migration never aborts on such data and never drops it silently:
--   1. adds missing columns only (if not exists), plus `legacy_values jsonb`;
--   2. for each column, looks up its real type (pg_attribute / format_type);
--      a column of the wrong type is converted (cadence/kind -> text,
--      due_day -> integer with non-numeric/out-of-range -> NULL,
--      stream_id -> uuid with non-uuid -> NULL). If the conversion itself is
--      impossible (e.g. a view depends on the column) it RAISEs a NOTICE and
--      skips only that column's constraint;
--   3. maps known legacy spellings ('Monthly', 'annual', '30' days, 'Rent', ...)
--      to the canonical values;
--   4. BEFORE any value is changed or set to NULL, copies the original into
--      legacy_values (e.g. {"cadence": "every 3 weeks", "due_day": 45}). The
--      first original wins, so re-runs never overwrite it;
--   5. sets unmappable values to NULL (and dangling stream_id to NULL), so the
--      checks/FK can be VALIDATEd and are always valid: editing an old row
--      can never trip over a NOT VALID constraint.
-- Safe to run more than once: a second run finds nothing to change.

alter table public.obligations add column if not exists cadence text;
alter table public.obligations add column if not exists due_day integer;
alter table public.obligations add column if not exists next_due_date date;
alter table public.obligations add column if not exists stream_id uuid;
alter table public.obligations add column if not exists must_pay boolean not null default false;
alter table public.obligations add column if not exists kind text;
alter table public.obligations add column if not exists legacy_values jsonb;

comment on column public.obligations.legacy_values is
  'Original values of cadence/due_day/kind/stream_id that 20261020130100 normalised or could not map (set to NULL), keyed by column name. Informational only.';

do $$
declare
  col_type    text;
  can_keep    boolean;   -- legacy_values is jsonb, so originals can be preserved
  cadence_ok  boolean := true;
  due_day_ok  boolean := true;
  kind_ok     boolean := true;
  stream_ok   boolean := true;
  n           bigint;
  -- Guarded day-of-month parser on the text form: '15', ' 7 ', '15.0' -> int;
  -- anything else, or outside 1-31, -> NULL. CASE nesting keeps the ::int cast
  -- from ever seeing non-digits.
  due_day_expr constant text :=
    $e$(case when btrim(%1$s::text) ~ '^[0-9]{1,6}(\.0+)?$'
             then case when split_part(btrim(%1$s::text), '.', 1)::int between 1 and 31
                       then split_part(btrim(%1$s::text), '.', 1)::int end end)$e$;
  uuid_expr constant text :=
    $e$(case when btrim(%1$s::text) ~* '^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$'
             then btrim(%1$s::text)::uuid end)$e$;
  cadence_map constant text :=
    $e$(case lower(regexp_replace(btrim(cadence), '[\s_-]+', '', 'g'))
        when 'weekly' then 'weekly'           when 'week' then 'weekly'        when '7' then 'weekly'
        when 'biweekly' then 'biweekly'       when 'fortnightly' then 'biweekly' when 'everyotherweek' then 'biweekly' when '14' then 'biweekly'
        when 'semimonthly' then 'semimonthly' when 'twicemonthly' then 'semimonthly' when 'twiceamonth' then 'semimonthly' when '15' then 'semimonthly'
        when 'monthly' then 'monthly'         when 'month' then 'monthly'      when '30' then 'monthly' when '31' then 'monthly'
        when 'quarterly' then 'quarterly'     when 'quarter' then 'quarterly'  when '90' then 'quarterly' when '91' then 'quarterly' when '92' then 'quarterly'
        when 'semiannual' then 'semiannual'   when 'semiannually' then 'semiannual' when 'biannual' then 'semiannual' when 'halfyearly' then 'semiannual' when '182' then 'semiannual' when '183' then 'semiannual'
        when 'yearly' then 'yearly'           when 'annual' then 'yearly'      when 'annually' then 'yearly' when 'year' then 'yearly' when '365' then 'yearly' when '366' then 'yearly'
        else null end)$e$;
  kind_map constant text :=
    $e$(case lower(regexp_replace(btrim(kind), '[\s-]+', '_', 'g'))
        when 'loan' then 'loan'   when 'loans' then 'loan'  when 'mortgage' then 'loan' when 'student_loan' then 'loan' when 'auto_loan' then 'loan'
        when 'tax' then 'tax'     when 'taxes' then 'tax'
        when 'bill' then 'bill'   when 'bills' then 'bill'  when 'utility' then 'bill' when 'utilities' then 'bill' when 'rent' then 'bill' when 'insurance' then 'bill'
        when 'subscription' then 'subscription' when 'subscriptions' then 'subscription'
        when 'card_payment' then 'card_payment' when 'credit_card' then 'card_payment' when 'credit_card_payment' then 'card_payment'
        when 'savings' then 'savings'
        when 'transfer' then 'transfer' when 'transfers' then 'transfer'
        else null end)$e$;
begin
  -- Our own constraints are (re)created below; drop them first so a re-run
  -- (or an earlier NOT VALID revision of this migration) can't get in the way.
  alter table public.obligations drop constraint if exists obligations_cadence_check;
  alter table public.obligations drop constraint if exists obligations_due_day_check;
  alter table public.obligations drop constraint if exists obligations_kind_check;
  alter table public.obligations drop constraint if exists obligations_stream_id_fkey;

  select format_type(a.atttypid, a.atttypmod) into col_type
    from pg_attribute a
   where a.attrelid = 'public.obligations'::regclass and a.attname = 'legacy_values' and not a.attisdropped;
  can_keep := col_type = 'jsonb';
  if not can_keep then
    raise notice 'obligations.legacy_values is %, not jsonb: legacy values will not be changed or nulled; checks stay NOT VALID where rows do not match', col_type;
  end if;

  -- ── cadence ──────────────────────────────────────────────────────────────
  select format_type(a.atttypid, a.atttypmod) into col_type from pg_attribute a
   where a.attrelid = 'public.obligations'::regclass and a.attname = 'cadence' and not a.attisdropped;
  if col_type <> 'text' then
    begin
      if can_keep and col_type not like 'character varying%' and col_type not like 'character%' then
        -- The representation changes (e.g. integer 30 -> '30'): keep the typed original.
        update public.obligations
           set legacy_values = jsonb_build_object('cadence', to_jsonb(cadence)) || coalesce(legacy_values, '{}'::jsonb)
         where cadence is not null;
      end if;
      execute 'alter table public.obligations alter column cadence type text using cadence::text';
      raise notice 'obligations.cadence converted from % to text', col_type;
    exception when others then
      cadence_ok := false;
      raise notice 'obligations.cadence is % and could not be converted to text (%); skipping its check', col_type, sqlerrm;
    end;
  end if;
  if cadence_ok and can_keep then
    execute format($u$
      update public.obligations
         set legacy_values = jsonb_build_object('cadence', cadence) || coalesce(legacy_values, '{}'::jsonb),
             cadence = %1$s
       where cadence is distinct from %1$s$u$, cadence_map);
    get diagnostics n = row_count;
    if n > 0 then raise notice 'obligations.cadence: % row(s) normalised or set to NULL (originals in legacy_values)', n; end if;
  end if;

  -- ── due_day ──────────────────────────────────────────────────────────────
  select format_type(a.atttypid, a.atttypmod) into col_type from pg_attribute a
   where a.attrelid = 'public.obligations'::regclass and a.attname = 'due_day' and not a.attisdropped;
  if col_type <> 'integer' then
    begin
      if can_keep then
        execute format($u$
          update public.obligations
             set legacy_values = jsonb_build_object('due_day', to_jsonb(due_day)) || coalesce(legacy_values, '{}'::jsonb)
           where due_day is not null and %s is null$u$, format(due_day_expr, 'due_day'));
        execute format('alter table public.obligations alter column due_day type integer using %s',
                       format(due_day_expr, 'due_day'));
        raise notice 'obligations.due_day converted from % to integer (non-numeric values -> NULL, originals in legacy_values)', col_type;
      else
        due_day_ok := false;
        raise notice 'obligations.due_day is % and legacy_values is unavailable; not converting, skipping its check', col_type;
      end if;
    exception when others then
      due_day_ok := false;
      raise notice 'obligations.due_day is % and could not be converted to integer (%); skipping its check', col_type, sqlerrm;
    end;
  elsif can_keep then
    update public.obligations
       set legacy_values = jsonb_build_object('due_day', due_day) || coalesce(legacy_values, '{}'::jsonb),
           due_day = null
     where due_day is not null and due_day not between 1 and 31;
    get diagnostics n = row_count;
    if n > 0 then raise notice 'obligations.due_day: % row(s) outside 1-31 set to NULL (originals in legacy_values)', n; end if;
  end if;

  -- ── kind ─────────────────────────────────────────────────────────────────
  select format_type(a.atttypid, a.atttypmod) into col_type from pg_attribute a
   where a.attrelid = 'public.obligations'::regclass and a.attname = 'kind' and not a.attisdropped;
  if col_type <> 'text' then
    begin
      execute 'alter table public.obligations alter column kind type text using kind::text';
      raise notice 'obligations.kind converted from % to text', col_type;
    exception when others then
      kind_ok := false;
      raise notice 'obligations.kind is % and could not be converted to text (%); skipping its check', col_type, sqlerrm;
    end;
  end if;
  if kind_ok and can_keep then
    execute format($u$
      update public.obligations
         set legacy_values = jsonb_build_object('kind', kind) || coalesce(legacy_values, '{}'::jsonb),
             kind = %1$s
       where kind is distinct from %1$s$u$, kind_map);
    get diagnostics n = row_count;
    if n > 0 then raise notice 'obligations.kind: % row(s) normalised or set to NULL (originals in legacy_values)', n; end if;
  end if;

  -- ── stream_id ────────────────────────────────────────────────────────────
  select format_type(a.atttypid, a.atttypmod) into col_type from pg_attribute a
   where a.attrelid = 'public.obligations'::regclass and a.attname = 'stream_id' and not a.attisdropped;
  if col_type <> 'uuid' then
    begin
      if can_keep then
        execute format($u$
          update public.obligations
             set legacy_values = jsonb_build_object('stream_id', to_jsonb(stream_id)) || coalesce(legacy_values, '{}'::jsonb)
           where stream_id is not null and %s is null$u$, format(uuid_expr, 'stream_id'));
        execute format('alter table public.obligations alter column stream_id type uuid using %s',
                       format(uuid_expr, 'stream_id'));
        raise notice 'obligations.stream_id converted from % to uuid (non-uuid values -> NULL, originals in legacy_values)', col_type;
      else
        stream_ok := false;
        raise notice 'obligations.stream_id is % and legacy_values is unavailable; skipping FK', col_type;
      end if;
    exception when others then
      stream_ok := false;
      raise notice 'obligations.stream_id is % and could not be converted to uuid (%); skipping FK', col_type, sqlerrm;
    end;
  end if;
  if stream_ok and can_keep then
    -- A hand-made stream_id cannot point at a stream: recurring_streams is new.
    update public.obligations o
       set legacy_values = jsonb_build_object('stream_id', o.stream_id) || coalesce(o.legacy_values, '{}'::jsonb),
           stream_id = null
     where o.stream_id is not null
       and not exists (select 1 from public.recurring_streams r where r.id = o.stream_id);
    get diagnostics n = row_count;
    if n > 0 then raise notice 'obligations.stream_id: % dangling value(s) set to NULL (originals in legacy_values)', n; end if;
  end if;

  -- ── constraints: added NOT VALID, then VALIDATEd (normally always succeeds) ─
  if cadence_ok then
    alter table public.obligations add constraint obligations_cadence_check
      check (cadence is null or cadence in ('weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'semiannual', 'yearly')) not valid;
    begin
      alter table public.obligations validate constraint obligations_cadence_check;
    exception when check_violation then
      raise notice 'obligations_cadence_check left NOT VALID: rows with other cadence values could not be cleaned';
    end;
  end if;
  if due_day_ok then
    alter table public.obligations add constraint obligations_due_day_check
      check (due_day is null or due_day between 1 and 31) not valid;
    begin
      alter table public.obligations validate constraint obligations_due_day_check;
    exception when check_violation then
      raise notice 'obligations_due_day_check left NOT VALID: rows with due_day outside 1-31 could not be cleaned';
    end;
  end if;
  if kind_ok then
    alter table public.obligations add constraint obligations_kind_check
      check (kind is null or kind in ('loan', 'tax', 'bill', 'subscription', 'card_payment', 'savings', 'transfer')) not valid;
    begin
      alter table public.obligations validate constraint obligations_kind_check;
    exception when check_violation then
      raise notice 'obligations_kind_check left NOT VALID: rows with other kind values could not be cleaned';
    end;
  end if;
  if stream_ok then
    alter table public.obligations add constraint obligations_stream_id_fkey
      foreign key (stream_id) references public.recurring_streams(id) on delete set null not valid;
    begin
      alter table public.obligations validate constraint obligations_stream_id_fkey;
    exception when foreign_key_violation then
      raise notice 'obligations_stream_id_fkey left NOT VALID: stream_id values could not be cleaned';
    end;
  end if;

  -- Columns we don't constrain: only report an unexpected type.
  select format_type(a.atttypid, a.atttypmod) into col_type from pg_attribute a
   where a.attrelid = 'public.obligations'::regclass and a.attname = 'next_due_date' and not a.attisdropped;
  if col_type <> 'date' then raise notice 'obligations.next_due_date is %, expected date; left as is', col_type; end if;
  select format_type(a.atttypid, a.atttypmod) into col_type from pg_attribute a
   where a.attrelid = 'public.obligations'::regclass and a.attname = 'must_pay' and not a.attisdropped;
  if col_type <> 'boolean' then raise notice 'obligations.must_pay is %, expected boolean; left as is', col_type; end if;
end $$;

create index if not exists obligations_stream_id_idx on public.obligations(stream_id);
