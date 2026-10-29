-- ── Follow-ups to inferences / recurring_streams / credit_statements ───────
-- (a) recurring_streams.autopay_inference_id may only point at an inference
--     owned by the same user. The plain FK from 20261020210100 let a row
--     reference any user's inference id; replace it with a composite FK on
--     (autopay_inference_id, user_id) -> inferences(id, user_id). Deleting
--     the inference still clears only autopay_inference_id (PG15+ column
--     list on SET NULL), never user_id. Existing cross-user links (should be
--     none) are cleared first so the constraint can be added.
-- (b) Undo on a direct table write (status -> 'suggested') clears
--     suppressed_until, so a stale rejection window can't hide the finding.
--     Mirrors applyDecision("undo") in src/lib/infer/decisions.ts.
-- (c) Drop redundant indexes: credit_statements_user_account_idx duplicates
--     the (user_id, account_id, statement_issue_date) primary key, and
--     inferences_user_kind_idx is a prefix of unique (user_id, kind, subject_ref).
-- (d) Index recurring_streams.autopay_inference_id so the FK's ON DELETE
--     check doesn't scan recurring_streams.
-- No grant or RLS changes. Idempotent.

-- (a)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.inferences'::regclass and conname = 'inferences_id_user_id_key'
  ) then
    alter table public.inferences add constraint inferences_id_user_id_key unique (id, user_id);
  end if;
end $$;

update public.recurring_streams rs
   set autopay_inference_id = null
 where rs.autopay_inference_id is not null
   and not exists (
     select 1 from public.inferences i
      where i.id = rs.autopay_inference_id and i.user_id = rs.user_id);

alter table public.recurring_streams drop constraint if exists recurring_streams_autopay_inference_id_fkey;
alter table public.recurring_streams add constraint recurring_streams_autopay_inference_id_fkey
  foreign key (autopay_inference_id, user_id)
  references public.inferences(id, user_id)
  on delete set null (autopay_inference_id);

-- (b)
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
      if tg_op = 'UPDATE' then
        new.suppressed_until := null;
      end if;
    end if;
    if new.status = 'rejected' and new.suppressed_until is null then
      new.suppressed_until := now() + interval '180 days';
    end if;
  end if;
  return new;
end
$fn$;

-- (c)
drop index if exists public.credit_statements_user_account_idx;
drop index if exists public.inferences_user_kind_idx;

-- (d)
create index if not exists recurring_streams_autopay_inference_idx
  on public.recurring_streams(autopay_inference_id)
  where autopay_inference_id is not null;
