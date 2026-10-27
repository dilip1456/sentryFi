-- Security audit H4: tables used by the app that were created by hand in the
-- dashboard and never captured in migrations. Make sure each one has RLS
-- enabled, owner-only policies, and no anon access.
--
--   table                 client needs            policy added here
--   alert_log             SELECT, UPDATE(read_at) owner SELECT + owner UPDATE
--   alert_preferences     SELECT/INSERT/UPDATE    owner ALL
--   push_tokens           upsert own token        owner ALL
--   user_settings         SELECT/INSERT/UPDATE    owner ALL   (same policy name as PR #4)
--   ai_insights           SELECT                  owner SELECT (written by analyze-finances as service_role)
--   card_benefits         SELECT/UPSERT/UPDATE    owner ALL   (same policy name as PR #4)
--   plaid_credit_details  SELECT                  owner SELECT (written by plaid-* functions as service_role)
--
-- Written to be idempotent and order-independent with PR #4
-- (20261020120100_user_settings_unique_user_id.sql and
-- 20261020120200_card_benefits_ensure.sql): it never creates tables, it
-- skips a table that does not exist (with a NOTICE), and it creates each
-- policy only when a policy with the same name is missing. The user_settings
-- and card_benefits policy names and grants match PR #4 exactly, so whichever
-- migration runs first wins and the other is a no-op.
--
-- Existing policies are left alone except the legacy FOR ALL policy on
-- plaid_credit_details from supabase-credit-details.sql (replaced by
-- SELECT-only). Any other permissive policy on these tables whose USING is
-- (or, for INSERT, WITH CHECK) is `true` is reported with a WARNING so it can be reviewed by hand.

-- Helper used only during this migration (dropped at the end).
CREATE OR REPLACE FUNCTION pg_temp.sentryfi_ensure_owner_policy(
  _table text, _policy text, _cmd text
) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = _table AND policyname = _policy
  ) THEN
    IF _cmd = 'SELECT' OR _cmd = 'DELETE' THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR %s TO authenticated USING ((select auth.uid()) = user_id)',
        _policy, _table, _cmd);
    ELSIF _cmd = 'INSERT' THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id)',
        _policy, _table);
    ELSE -- UPDATE / ALL
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR %s TO authenticated USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id)',
        _policy, _table, _cmd);
    END IF;
  END IF;
END
$fn$;

DO $$
DECLARE
  t text;
  r record;
BEGIN
  FOREACH t IN ARRAY ARRAY['alert_log','alert_preferences','push_tokens','user_settings',
                           'ai_insights','card_benefits','plaid_credit_details'] LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'public.% does not exist; skipped (create it, then re-run this migration)', t;
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = t AND column_name = 'user_id') THEN
      RAISE WARNING 'public.% has no user_id column; enabling RLS with no policy (service_role only)', t;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- No anonymous access to any of these tables. (authenticated gets exactly
    -- the privileges it needs in the per-table blocks below.)
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);

    -- Flag permissive "allow everything" policies left over from the dashboard.
    FOR r IN
      SELECT policyname, cmd, roles FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
        AND permissive = 'PERMISSIVE'
        AND (btrim(coalesce(qual, '')) IN ('true', '(true)')
             OR (cmd = 'INSERT' AND btrim(coalesce(with_check, '')) IN ('true', '(true)')))
    LOOP
      RAISE WARNING 'public.% policy "%" (% to %) does not restrict rows; review and drop it',
        t, r.policyname, r.cmd, r.roles;
    END LOOP;
  END LOOP;
END $$;

-- alert_log: written only by send-alerts (service_role). Users read their own
-- alerts and mark them read. Realtime (supabase_realtime publication) honours
-- these policies, so users only receive their own INSERT events.
DO $$
BEGIN
  IF to_regclass('public.alert_log') IS NULL THEN RETURN; END IF;
  REVOKE ALL ON public.alert_log FROM authenticated;
  GRANT SELECT ON public.alert_log TO authenticated;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'alert_log' AND column_name = 'read_at') THEN
    GRANT UPDATE (read_at) ON public.alert_log TO authenticated;
  END IF;
  PERFORM pg_temp.sentryfi_ensure_owner_policy('alert_log', 'Users view own alerts', 'SELECT');
  PERFORM pg_temp.sentryfi_ensure_owner_policy('alert_log', 'Users mark own alerts read', 'UPDATE');
END $$;

DO $$
BEGIN
  IF to_regclass('public.alert_preferences') IS NULL THEN RETURN; END IF;
  REVOKE ALL ON public.alert_preferences FROM authenticated;  -- drops TRUNCATE/REFERENCES/TRIGGER from Supabase defaults
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.alert_preferences TO authenticated;
  PERFORM pg_temp.sentryfi_ensure_owner_policy('alert_preferences', 'Users manage own alert preferences', 'ALL');
END $$;

DO $$
BEGIN
  IF to_regclass('public.push_tokens') IS NULL THEN RETURN; END IF;
  REVOKE ALL ON public.push_tokens FROM authenticated;  -- drops TRUNCATE/REFERENCES/TRIGGER from Supabase defaults
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_tokens TO authenticated;
  PERFORM pg_temp.sentryfi_ensure_owner_policy('push_tokens', 'Users manage own push tokens', 'ALL');
END $$;

-- Same grant and policy name as PR #4 (20261020120100_user_settings_unique_user_id.sql).
DO $$
BEGIN
  IF to_regclass('public.user_settings') IS NULL THEN RETURN; END IF;
  REVOKE ALL ON public.user_settings FROM authenticated;  -- drops TRUNCATE/REFERENCES/TRIGGER from Supabase defaults
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
  PERFORM pg_temp.sentryfi_ensure_owner_policy('user_settings', 'Users can manage own settings', 'ALL');
END $$;

-- ai_insights: analyze-finances upserts with service_role; the dashboard only reads.
DO $$
BEGIN
  IF to_regclass('public.ai_insights') IS NULL THEN RETURN; END IF;
  REVOKE ALL ON public.ai_insights FROM authenticated;
  GRANT SELECT ON public.ai_insights TO authenticated;
  PERFORM pg_temp.sentryfi_ensure_owner_policy('ai_insights', 'Users view own ai insights', 'SELECT');
END $$;

-- Same grant and policy name as PR #4 (20261020120200_card_benefits_ensure.sql).
DO $$
BEGIN
  IF to_regclass('public.card_benefits') IS NULL THEN RETURN; END IF;
  REVOKE ALL ON public.card_benefits FROM authenticated;  -- drops TRUNCATE/REFERENCES/TRIGGER from Supabase defaults
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_benefits TO authenticated;
  PERFORM pg_temp.sentryfi_ensure_owner_policy('card_benefits', 'Users can manage own card benefits', 'ALL');
END $$;

-- plaid_credit_details: written only by the plaid-* edge functions (service_role).
DO $$
BEGIN
  IF to_regclass('public.plaid_credit_details') IS NULL THEN RETURN; END IF;
  REVOKE ALL ON public.plaid_credit_details FROM authenticated;
  GRANT SELECT ON public.plaid_credit_details TO authenticated;
  PERFORM pg_temp.sentryfi_ensure_owner_policy('plaid_credit_details', 'Users view own credit details', 'SELECT');
  -- Legacy FOR ALL policy (with no WITH CHECK) from supabase-credit-details.sql.
  DROP POLICY IF EXISTS "Users can manage own credit details" ON public.plaid_credit_details;
END $$;

DROP FUNCTION IF EXISTS pg_temp.sentryfi_ensure_owner_policy(text, text, text);

NOTIFY pgrst, 'reload schema';
