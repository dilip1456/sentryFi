-- ── Timeline cash-flow rundown settings ──────────────────────────────────────
-- One jsonb column on the existing per-user public.user_settings row:
--   { "buffer": 500, "reserveOn": false, "reserveDaily": 40,
--     "accounts": { "<account_id>": false } }   -- missing key = default (on)
--
-- Why a separate column (not financial_picture): the Timeline writes this from
-- outside the dashboard's useUserSettings instance, whose debounced upsert
-- sends every column it knows from its own (possibly stale) copy. A column
-- that useUserSettings never sends can't be clobbered by it. The app falls
-- back to localStorage until this migration is applied.
--
-- Files only; idempotent (add column if not exists, drop-then-add check,
-- policy created only when missing). Privileges: revoke, then grant to
-- authenticated (own rows via RLS) and service_role. No anon access.

do $$
begin
  if to_regclass('public.user_settings') is null then
    raise notice 'public.user_settings does not exist; skipped';
    return;
  end if;

  alter table public.user_settings
    add column if not exists rundown_settings jsonb not null default '{}'::jsonb;

  alter table public.user_settings drop constraint if exists user_settings_rundown_settings_object;
  alter table public.user_settings add constraint user_settings_rundown_settings_object
    check (jsonb_typeof(rundown_settings) = 'object');

  alter table public.user_settings enable row level security;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_settings' and policyname = 'Users can manage own settings'
  ) then
    create policy "Users can manage own settings" on public.user_settings
      for all to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

  revoke all on table public.user_settings from anon;
  revoke all on table public.user_settings from authenticated;
  grant select, insert, update, delete on table public.user_settings to authenticated;
  grant all on table public.user_settings to service_role;
end $$;
