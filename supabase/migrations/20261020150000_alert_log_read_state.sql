-- ── Notification read state ─────────────────────────────────────────────────
-- The inbox marks alerts read by setting alert_log.read_at, but the bell
-- badge counted from a localStorage list and nothing guaranteed the client
-- was allowed to UPDATE its own rows, so "All read" could silently do
-- nothing and the badge never cleared. This makes read state server-side:
--   * read_at / created_at columns exist (idempotent);
--   * a partial index makes the unread count cheap;
--   * users can update ONLY read_at, and only on their own rows.
-- Safe to re-run.

alter table public.alert_log
  add column if not exists read_at timestamptz,
  add column if not exists created_at timestamptz not null default now();

create index if not exists alert_log_user_unread_idx
  on public.alert_log (user_id, created_at desc)
  where read_at is null;

alter table public.alert_log enable row level security;

drop policy if exists "alert_log_select_own" on public.alert_log;
create policy "alert_log_select_own" on public.alert_log
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "alert_log_update_own_read_state" on public.alert_log;
create policy "alert_log_update_own_read_state" on public.alert_log
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Column-level: the client may only flip read_at (alerts themselves are
-- written by the send-alerts function with the service role).
revoke update on public.alert_log from authenticated;
grant select on public.alert_log to authenticated;
grant update (read_at) on public.alert_log to authenticated;
