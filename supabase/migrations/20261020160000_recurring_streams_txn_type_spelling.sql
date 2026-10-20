-- ── recurring_streams.txn_type: use the shared taxonomy spelling ─────────────
-- 20261020130000_recurring_streams.sql constrained txn_type to hyphenated
-- names (income-salary). The shared classifier (src/lib/classify) and
-- txn_overrides (20261020140100) use underscores (income_salary). Store one
-- spelling everywhere: convert any existing rows and swap the check.
-- The app maps 1:1 in src/lib/recurring/classifier.ts (toSharedTxnType).
-- Requires 20261020130000_recurring_streams.sql. Safe to run more than once.

alter table public.recurring_streams drop constraint if exists recurring_streams_txn_type_check;

update public.recurring_streams
   set txn_type = replace(txn_type, '-', '_')
 where txn_type like '%-%';

alter table public.recurring_streams add constraint recurring_streams_txn_type_check
  check (txn_type in (
    'spend', 'refund', 'income_salary', 'income_interest', 'income_other',
    'transfer_internal', 'transfer_in', 'transfer_out', 'credit_card_payment',
    'savings_contribution', 'obligation_loan', 'obligation_tax', 'obligation_bill'));
