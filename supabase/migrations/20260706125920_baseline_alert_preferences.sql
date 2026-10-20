-- Baseline: public.alert_preferences (one row per user; read by send-alerts).
--
-- Created by hand on the live project; no migration created it, so
-- `supabase db reset` failed at 20260814120000_alert_dedupe_and_categories
-- (the first migration that references it). Reconstructed from
-- NotificationPreferences (upsert onConflict user_id; DEFAULTS), send-alerts
-- and 20260814120000 / 20261020170100 / 20261020180400. Policy name and
-- grants match 20261020170100 so it stays a no-op after this.
--
-- Production: the table already exists, so this whole file is a no-op.
-- Sorted before every migration that references alert_preferences.
DO $$
BEGIN
  IF to_regclass('public.alert_preferences') IS NOT NULL THEN
    RAISE NOTICE 'public.alert_preferences exists; baseline skipped';
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS public.alert_preferences (
    id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    email_enabled   boolean     NOT NULL DEFAULT true,
    push_enabled    boolean     NOT NULL DEFAULT true,
    email           text,
    budget_pct      integer     NOT NULL DEFAULT 90,
    low_balance     numeric     NOT NULL DEFAULT 100,
    payment_days    integer     NOT NULL DEFAULT 3,
    weekly_summary  boolean     NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    -- upsert(..., { onConflict: "user_id" })
    CONSTRAINT alert_preferences_user_id_key UNIQUE (user_id)
  );
  -- The per-category alert_* flags are added by 20260814120000 / 20261020180400.

  REVOKE ALL ON public.alert_preferences FROM anon, authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.alert_preferences TO authenticated;
  GRANT ALL ON public.alert_preferences TO service_role;

  ALTER TABLE public.alert_preferences ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'alert_preferences'
                 AND policyname = 'Users manage own alert preferences') THEN
    CREATE POLICY "Users manage own alert preferences" ON public.alert_preferences
      FOR ALL TO authenticated
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;
