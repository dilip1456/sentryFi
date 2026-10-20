-- Baseline: public.alert_log (notification inbox; written by send-alerts).
--
-- Created by hand on the live project; no migration created it, so
-- `supabase db reset` failed at 20260706150000_realtime_alert_log (the first
-- migration that references it). Reconstructed from send-alerts (upsert of
-- user_id, alert_type, alert_key, title, body, payload, created_at with
-- onConflict user_id,alert_key), NotificationInbox (sent_at, read_at) and
-- 20260814120000 / 20261020150000 / 20261020170100 / 20261020180000. Names
-- of the unique constraint, index and policies match those migrations so
-- they stay no-ops after this.
--
-- Production: the table already exists, so this whole file is a no-op.
-- Sorted before every migration that references alert_log.
DO $$
BEGIN
  IF to_regclass('public.alert_log') IS NOT NULL THEN
    RAISE NOTICE 'public.alert_log exists; baseline skipped';
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS public.alert_log (
    id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    alert_type  text        NOT NULL,
    alert_key   text        NOT NULL,
    title       text,
    body        text,
    payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    sent_at     timestamptz NOT NULL DEFAULT now(),
    created_at  timestamptz NOT NULL DEFAULT now(),
    read_at     timestamptz,
    -- send-alerts' atomic insert-if-new (same name as 20260814120000)
    CONSTRAINT alert_log_user_alert_key_key UNIQUE (user_id, alert_key)
  );
  CREATE INDEX IF NOT EXISTS alert_log_user_sent_at_idx ON public.alert_log (user_id, sent_at DESC);
  CREATE INDEX IF NOT EXISTS alert_log_user_unread_idx ON public.alert_log (user_id, created_at DESC) WHERE read_at IS NULL;

  -- Users read their own alerts and may only set read_at; send-alerts writes as service_role.
  REVOKE ALL ON public.alert_log FROM anon, authenticated;
  GRANT SELECT ON public.alert_log TO authenticated;
  GRANT UPDATE (read_at) ON public.alert_log TO authenticated;
  GRANT ALL ON public.alert_log TO service_role;

  ALTER TABLE public.alert_log ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'alert_log'
                 AND policyname = 'Users view own alerts') THEN
    CREATE POLICY "Users view own alerts" ON public.alert_log
      FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'alert_log'
                 AND policyname = 'Users mark own alerts read') THEN
    CREATE POLICY "Users mark own alerts read" ON public.alert_log
      FOR UPDATE TO authenticated
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;
