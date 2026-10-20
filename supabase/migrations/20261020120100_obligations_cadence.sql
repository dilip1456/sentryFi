-- ── Obligations: cadence, next due date, must-pay, stream link ───────────────
-- Obligations become schedule-aware and can be backed by a detected recurring
-- stream (recurring_streams, previous migration). Requires
-- 20260825120000_obligations_and_cover_actions.sql and
-- 20261020120000_recurring_streams.sql.

alter table public.obligations add column if not exists cadence text;
alter table public.obligations add column if not exists due_day integer;
alter table public.obligations add column if not exists next_due_date date;
alter table public.obligations add column if not exists stream_id uuid;
alter table public.obligations add column if not exists must_pay boolean not null default false;
alter table public.obligations add column if not exists kind text;

alter table public.obligations drop constraint if exists obligations_cadence_check;
alter table public.obligations add constraint obligations_cadence_check
  check (cadence is null or cadence in ('weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'semiannual', 'yearly'));

alter table public.obligations drop constraint if exists obligations_due_day_check;
alter table public.obligations add constraint obligations_due_day_check
  check (due_day is null or due_day between 1 and 31);

alter table public.obligations drop constraint if exists obligations_kind_check;
alter table public.obligations add constraint obligations_kind_check
  check (kind is null or kind in ('loan', 'tax', 'bill'));

alter table public.obligations drop constraint if exists obligations_stream_id_fkey;
alter table public.obligations add constraint obligations_stream_id_fkey
  foreign key (stream_id) references public.recurring_streams(id) on delete set null;

create index if not exists obligations_stream_id_idx on public.obligations(stream_id);
