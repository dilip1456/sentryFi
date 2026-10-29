-- Timeline sidebar (PR B): one reverse-chronological feed of everything that
-- happened to the user's money.
--
--   * public.txn_classifications — the shared classifier's (src/lib/classify)
--     verdict per transaction, persisted by the app so SQL can tell internal
--     transfers (transfer_internal) apart. User overrides (txn_overrides)
--     still win over it.
--   * public.tax_milestones      — estimated-tax / filing dates (user-owned).
--   * public.timeline_events     — UNION ALL view over transactions, paid
--     occurrences without a matched transaction, alerts, inferences and tax
--     milestones. Created WITH (security_invoker = true) so the caller's RLS
--     on every source table applies (one user can never see another's rows).
--   * public.timeline_page(...)  — keyset-paginated read of the view,
--     SECURITY INVOKER, ordered (occurred_on desc, occurred_at desc, id desc).
--
-- Idempotent: safe to run repeatedly.

-- ── txn_classifications ─────────────────────────────────────────────────────
create table if not exists public.txn_classifications (
  user_id        uuid not null references auth.users(id) on delete cascade,
  transaction_id text not null references public.plaid_transactions(transaction_id) on delete cascade,
  txn_type       text not null,
  classified_at  timestamptz not null default now(),
  primary key (user_id, transaction_id)
);

do $$
begin
  alter table public.txn_classifications drop constraint if exists txn_classifications_txn_type_check;
  alter table public.txn_classifications add constraint txn_classifications_txn_type_check check (txn_type in (
    'spend', 'refund', 'income_salary', 'income_interest', 'income_other',
    'transfer_internal', 'transfer_in', 'transfer_out', 'credit_card_payment',
    'savings_contribution', 'obligation_loan', 'obligation_tax', 'obligation_bill'));
end $$;

alter table public.txn_classifications enable row level security;

drop policy if exists "Users read own txn classifications" on public.txn_classifications;
create policy "Users read own txn classifications" on public.txn_classifications
  for select using (auth.uid() = user_id);
drop policy if exists "Users insert own txn classifications" on public.txn_classifications;
create policy "Users insert own txn classifications" on public.txn_classifications
  for insert with check (auth.uid() = user_id);
drop policy if exists "Users update own txn classifications" on public.txn_classifications;
create policy "Users update own txn classifications" on public.txn_classifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users delete own txn classifications" on public.txn_classifications;
create policy "Users delete own txn classifications" on public.txn_classifications
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.txn_classifications to authenticated;
grant all on public.txn_classifications to service_role;

-- ── tax_milestones ──────────────────────────────────────────────────────────
create table if not exists public.tax_milestones (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null default 'estimated_payment',
  title       text not null,
  due_date    date not null,
  amount      numeric,
  status      text not null default 'upcoming',
  done_at     timestamptz,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

do $$
begin
  alter table public.tax_milestones drop constraint if exists tax_milestones_kind_check;
  alter table public.tax_milestones add constraint tax_milestones_kind_check
    check (kind in ('estimated_payment', 'filing_deadline', 'extension', 'other'));
  alter table public.tax_milestones drop constraint if exists tax_milestones_status_check;
  alter table public.tax_milestones add constraint tax_milestones_status_check
    check (status in ('upcoming', 'done', 'skipped'));
end $$;

alter table public.tax_milestones enable row level security;

drop policy if exists "Users manage own tax milestones" on public.tax_milestones;
create policy "Users manage own tax milestones" on public.tax_milestones
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.tax_milestones to authenticated;
grant all on public.tax_milestones to service_role;

create index if not exists tax_milestones_user_due_idx
  on public.tax_milestones (user_id, due_date desc, id desc);

-- ── keyset indexes on the view's sources ────────────────────────────────────
create index if not exists plaid_transactions_user_date_txn_idx
  on public.plaid_transactions (user_id, date desc, transaction_id desc);
create index if not exists alert_log_user_sent_id_idx
  on public.alert_log (user_id, sent_at desc, id desc);
create index if not exists inferences_user_created_idx
  on public.inferences (user_id, created_at desc, id desc);

-- ── helpers ─────────────────────────────────────────────────────────────────
-- SQL mirror of mapPfc() in src/lib/classify/pfc.ts. Only used until the app
-- has persisted the shared classifier's verdict; it never yields
-- transfer_internal (that needs pair matching across accounts).
create or replace function public.timeline_pfc_type(p_primary text, p_detailed text, p_amount numeric)
returns text
language sql
immutable
set search_path = public
as $$
  with x as (
    select upper(coalesce(p_detailed, '')) as d,
           upper(coalesce(p_primary, nullif(array_to_string((string_to_array(coalesce(p_detailed, ''), '_'))[1:2], '_'), ''), '')) as p
  ), t as (
    select case
      when d = 'INCOME_WAGES' then 'income_salary'
      when d in ('INCOME_INTEREST_EARNED', 'INCOME_DIVIDENDS') then 'income_interest'
      when d like 'INCOME\_%' then 'income_other'
      when d like 'TRANSFER\_IN\_%' then 'transfer_in'
      when d in ('TRANSFER_OUT_SAVINGS', 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS') then 'savings_contribution'
      when d = 'TRANSFER_OUT_WITHDRAWAL' then 'spend'
      when d like 'TRANSFER\_OUT\_%' then 'transfer_out'
      when d = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' then 'credit_card_payment'
      when d like 'LOAN\_PAYMENTS\_%' then 'obligation_loan'
      when d = 'GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT' then 'obligation_tax'
      when d like 'RENT\_AND\_UTILITIES\_%' then 'obligation_bill'
      when d = 'GENERAL_SERVICES_INSURANCE' then 'obligation_bill'
      when p = 'INCOME' then 'income_other'
      when p = 'TRANSFER_IN' then 'transfer_in'
      when p = 'TRANSFER_OUT' then 'transfer_out'
      when p = 'LOAN_PAYMENTS' then 'obligation_loan'
      else null
    end as ty from x
  )
  select case
    when ty is not null then ty
    -- unknown / ordinary spend: the sign decides (Plaid: positive = money out)
    when coalesce(p_amount, 0) < 0 then 'refund'
    else 'spend'
  end from t;
$$;

-- Filter chip a txn type belongs to. transfer_in / transfer_out /
-- transfer_internal all land in 'transfer' (shown under "All" only).
create or replace function public.timeline_category(p_txn_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_txn_type in ('income_salary', 'income_interest', 'income_other') then 'income'
    when p_txn_type in ('obligation_bill', 'obligation_loan') then 'bills'
    when p_txn_type = 'credit_card_payment' then 'cards'
    when p_txn_type = 'savings_contribution' then 'savings'
    when p_txn_type = 'obligation_tax' then 'taxes'
    when p_txn_type in ('transfer_internal', 'transfer_in', 'transfer_out') then 'transfer'
    else 'spending'
  end;
$$;

-- ── the view ────────────────────────────────────────────────────────────────
-- amount: signed from the user's point of view (+ money in, − money out).
-- occurred_at for date-only rows is 12:00 UTC on that date.
drop function if exists public.timeline_page(date, timestamptz, text, text[], boolean, integer);
drop view if exists public.timeline_events;

create view public.timeline_events
with (security_invoker = true)
as
-- 1. transactions
select
  'txn:' || t.transaction_id                                         as id,
  t.user_id,
  'transaction'::text                                                as source,
  t.transaction_id                                                   as source_id,
  t.date                                                             as occurred_on,
  (t.date + time '12:00') at time zone 'UTC'                         as occurred_at,
  public.timeline_category(ty.txn_type)                              as category,
  ty.txn_type,
  (ty.txn_type = 'transfer_internal')                                as is_internal,
  coalesce(nullif(t.merchant_name, ''), t.name, 'Transaction')       as title,
  t.name                                                             as subtitle,
  -t.amount                                                          as amount,
  t.account_id,
  case
    when t.pending then 'pending'
    when ty.txn_type in ('income_salary', 'income_interest', 'income_other') then 'received'
    when ty.txn_type in ('transfer_internal', 'savings_contribution') then 'moved'
    when ty.txn_type in ('transfer_in', 'transfer_out') then 'review'
    when ty.txn_type in ('obligation_bill', 'obligation_loan', 'obligation_tax', 'credit_card_payment') then 'paid'
    else 'posted'
  end                                                                as status,
  so.stream_id,
  t.pending,
  jsonb_build_object(
    'type_source', case when o.txn_type is not null then 'override'
                        when c.txn_type is not null then 'classifier'
                        else 'pfc' end,
    'pfc_detailed', t.pfc_detailed,
    'payment_channel', t.payment_channel
  )                                                                  as meta
from public.plaid_transactions t
left join public.txn_overrides o
  on o.user_id = t.user_id and o.transaction_id = t.transaction_id
left join public.txn_classifications c
  on c.user_id = t.user_id and c.transaction_id = t.transaction_id
cross join lateral (
  select coalesce(o.txn_type, c.txn_type,
                  public.timeline_pfc_type(t.pfc_primary, t.pfc_detailed, t.amount)) as txn_type
) ty
left join lateral (
  select s.stream_id from public.stream_occurrences s
  where s.user_id = t.user_id and s.transaction_id = t.transaction_id
  limit 1
) so on true

union all
-- 2. occurrences marked paid without a matched transaction (manual "paid")
select
  'occ:' || s.id::text,
  s.user_id,
  'occurrence',
  s.id::text,
  coalesce(s.actual_date, s.expected_date),
  (coalesce(s.actual_date, s.expected_date) + time '12:00') at time zone 'UTC',
  public.timeline_category(r.txn_type),
  r.txn_type,
  false,
  r.display_name,
  coalesce(s.label, r.category),
  case when r.direction = 'inflow' then 1 else -1 end
    * coalesce(s.actual_amount, s.expected_amount),
  r.account_id,
  case when s.status = 'late' then 'late' else 'paid' end,
  r.id,
  false,
  jsonb_build_object('period', s.period, 'user_set', s.user_set, 'days_late', s.days_late)
from public.stream_occurrences s
join public.recurring_streams r on r.id = s.stream_id
where s.status in ('paid', 'late') and s.transaction_id is null

union all
-- 3. alerts that were sent (notification inbox)
select
  'alert:' || a.id::text,
  a.user_id,
  'alert',
  a.id::text,
  (a.sent_at at time zone coalesce(p.timezone, 'America/New_York'))::date,
  a.sent_at,
  'alerts',
  null,
  false,
  a.title,
  a.body,
  null::numeric,
  a.payload->>'account_id',
  case when a.read_at is null then 'flag' else 'seen' end,
  null::uuid,
  false,
  jsonb_build_object('alert_type', a.alert_type, 'payload', a.payload)
from public.alert_log a
left join public.profiles p on p.user_id = a.user_id

union all
-- 4. inferences the user can act on (suggested) or has confirmed
select
  'inf:' || i.id::text,
  i.user_id,
  'inference',
  i.id::text,
  (coalesce(case when i.status = 'confirmed' then i.decided_at end, i.created_at)
     at time zone coalesce(p.timezone, 'America/New_York'))::date,
  coalesce(case when i.status = 'confirmed' then i.decided_at end, i.created_at),
  'alerts',
  null,
  false,
  case i.kind
    when 'bill_autopay' then coalesce(i.payload->>'displayName', 'A bill') || ' looks like autopay'
    when 'card_autopay' then 'Card looks auto-paid'
    when 'card_autopay_source' then 'Card payments come from a new account'
    when 'autopay_missed' then coalesce(i.payload->>'displayName', 'An autopay') || ' didn''t run'
    when 'salary_change' then 'Your paycheck changed'
    when 'yearly_bill' then coalesce(i.payload->>'displayName', 'A yearly bill') || ' is coming up'
    when 'set_aside_status' then 'Set-aside check-in'
    when 'low_balance' then 'Balance may run low'
    when 'price_increase' then coalesce(i.payload->>'displayName', 'A bill') || ' went up'
    when 'card_interest' then 'Card interest charged'
    else initcap(replace(i.kind, '_', ' '))
  end,
  i.reason,
  case when i.payload ? 'amount' and jsonb_typeof(i.payload->'amount') = 'number'
       then (i.payload->>'amount')::numeric end,
  case when i.subject_type = 'account' then i.subject_ref end,
  case when i.status = 'confirmed' then 'done' else 'review' end,
  null::uuid,
  false,
  jsonb_build_object('kind', i.kind, 'subject_type', i.subject_type, 'subject_ref', i.subject_ref,
                     'inference_status', i.status, 'payload', i.payload)
from public.inferences i
left join public.profiles p on p.user_id = i.user_id
where i.status in ('suggested', 'confirmed')
  and i.kind in ('bill_autopay', 'card_autopay', 'card_autopay_source', 'autopay_missed',
                 'salary_change', 'yearly_bill', 'set_aside_status', 'low_balance',
                 'price_increase', 'card_interest')

union all
-- 5. tax milestones that are done or already past due (future ones are "Upcoming")
select
  'tax:' || m.id::text,
  m.user_id,
  'tax_milestone',
  m.id::text,
  m.due_date,
  coalesce(m.done_at, (m.due_date + time '12:00') at time zone 'UTC'),
  'taxes',
  'obligation_tax',
  false,
  m.title,
  m.note,
  case when m.amount is null then null else -m.amount end,
  null::text,
  case when m.status = 'done' then 'done' when m.status = 'skipped' then 'info' else 'review' end,
  null::uuid,
  false,
  jsonb_build_object('kind', m.kind, 'milestone_status', m.status)
from public.tax_milestones m
where m.status <> 'upcoming' or m.due_date < current_date;

comment on view public.timeline_events is
  'Timeline sidebar feed. security_invoker: RLS of every source table applies to the caller.';

revoke all on public.timeline_events from anon;
grant select on public.timeline_events to authenticated, service_role;

-- ── keyset page ─────────────────────────────────────────────────────────────
-- Returns rows strictly older than the cursor (occurred_on, occurred_at, id),
-- newest first. Null p_before_on = first page; a day with null p_before_at
-- = everything strictly before that day (jump-to-date passes at + 1 day).
-- p_types empty/null = every category; include_internal adds internal
-- transfers regardless of the chips. The client asks for limit+1 rows to know
-- whether more exist.
--
-- The UNION ALL can't be merge-appended by the planner, so a plain
-- ORDER BY/LIMIT would sort every older row of the user. Instead the page is
-- read from a widening date window (45d → 180d → 720d → 2880d → unbounded):
-- each window is an index range scan on (user_id, date) and almost every
-- page is satisfied by the first one.
create or replace function public.timeline_page(
  p_before_on        date,
  p_before_at        timestamptz,
  p_before_id        text,
  p_types            text[] default '{}',
  p_include_internal boolean default false,
  p_limit            integer default 25
)
returns setof public.timeline_events
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 25), 1), 101);
  v_top    date    := coalesce(p_before_on, current_date + 1);
  v_span   integer := 45;
  v_lo     date;
  v_n      integer;
  v_types  text[]  := coalesce(p_types, '{}');
  v_uid    uuid    := auth.uid();
begin
  if v_uid is null then
    return;
  end if;
  loop
    v_lo := case when v_span is null then null else v_top - v_span end;
    if v_lo is not null then
      select count(*) into v_n from (
        select 1
        from public.timeline_events e
        where e.user_id = v_uid
          and e.occurred_on >= v_lo
          and (p_before_on is null
               or e.occurred_on < p_before_on
               or (e.occurred_on = p_before_on and p_before_at is not null
                   and (e.occurred_at < p_before_at
                        or (e.occurred_at = p_before_at and e.id < coalesce(p_before_id, '')))))
          and (cardinality(v_types) = 0 or e.category = any(v_types) or (p_include_internal and e.is_internal))
          and (p_include_internal or not e.is_internal)
        limit v_limit
      ) w;
    end if;
    if v_lo is null or v_n >= v_limit then
      return query
        select e.*
        from public.timeline_events e
        where e.user_id = v_uid
          and (v_lo is null or e.occurred_on >= v_lo)
          and (p_before_on is null
               or e.occurred_on < p_before_on
               or (e.occurred_on = p_before_on and p_before_at is not null
                   and (e.occurred_at < p_before_at
                        or (e.occurred_at = p_before_at and e.id < coalesce(p_before_id, '')))))
          and (cardinality(v_types) = 0 or e.category = any(v_types) or (p_include_internal and e.is_internal))
          and (p_include_internal or not e.is_internal)
        order by e.occurred_on desc, e.occurred_at desc, e.id desc
        limit v_limit;
      return;
    end if;
    v_span := case when v_span >= 2880 then null else v_span * 4 end;
  end loop;
end;
$$;

revoke all on function public.timeline_page(date, timestamptz, text, text[], boolean, integer) from public, anon;
grant execute on function public.timeline_page(date, timestamptz, text, text[], boolean, integer) to authenticated, service_role;
