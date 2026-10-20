-- ── recurring_streams: how each bill is paid (autopay / manual) ─────────────
-- Extends PR #6's recurring_streams (20261020130000) instead of adding a new
-- stream table. Filled by bill autopay detection (src/lib/infer/autopay.ts,
-- INFERENCES.md §2.1). Until the user confirms, `autopay_source = 'detected'`
-- and nothing counts toward totals; Confirm sets 'confirmed', a manual edit
-- sets 'user'. Re-detection never overwrites 'confirmed' / 'user'
-- (mergeStreamRow in src/lib/recurring/rows.ts).
--
--   autopay              auto | manual | unknown
--   pay_method           bank (debited from a checking/savings account)
--                        | card (charged to a credit card) | manual
--   pay_from_account_id  Plaid account_id the payments come from
--   pay_day              usual day of month (1-31)
-- Idempotent.

alter table public.recurring_streams add column if not exists autopay text not null default 'unknown';
alter table public.recurring_streams add column if not exists autopay_source text;
alter table public.recurring_streams add column if not exists autopay_confidence numeric(4,3);
alter table public.recurring_streams add column if not exists pay_method text;
alter table public.recurring_streams add column if not exists pay_from_account_id text;
alter table public.recurring_streams add column if not exists pay_day smallint;
alter table public.recurring_streams add column if not exists autopay_inference_id uuid;

do $$
begin
  alter table public.recurring_streams drop constraint if exists recurring_streams_autopay_check;
  alter table public.recurring_streams add constraint recurring_streams_autopay_check
    check (autopay in ('auto', 'manual', 'unknown'));
  alter table public.recurring_streams drop constraint if exists recurring_streams_autopay_source_check;
  alter table public.recurring_streams add constraint recurring_streams_autopay_source_check
    check (autopay_source is null or autopay_source in ('detected', 'confirmed', 'user'));
  alter table public.recurring_streams drop constraint if exists recurring_streams_autopay_confidence_check;
  alter table public.recurring_streams add constraint recurring_streams_autopay_confidence_check
    check (autopay_confidence is null or (autopay_confidence >= 0 and autopay_confidence <= 1));
  alter table public.recurring_streams drop constraint if exists recurring_streams_pay_method_check;
  alter table public.recurring_streams add constraint recurring_streams_pay_method_check
    check (pay_method is null or pay_method in ('bank', 'card', 'manual'));
  alter table public.recurring_streams drop constraint if exists recurring_streams_pay_day_check;
  alter table public.recurring_streams add constraint recurring_streams_pay_day_check
    check (pay_day is null or pay_day between 1 and 31);
  alter table public.recurring_streams drop constraint if exists recurring_streams_autopay_inference_id_fkey;
  alter table public.recurring_streams add constraint recurring_streams_autopay_inference_id_fkey
    foreign key (autopay_inference_id) references public.inferences(id) on delete set null;
end $$;
