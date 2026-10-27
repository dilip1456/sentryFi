-- Production drift repair: alert_log unique (user_id, alert_key).
--
-- 20260814120000_alert_dedupe_and_categories.sql is recorded as applied on
-- the live project, but its unique constraint never existed there. Every
-- send-alerts run then failed its upsert(onConflict: "user_id,alert_key")
-- with 42P10 ("no unique or exclusion constraint matching the ON CONFLICT
-- specification"), so alerts were not logged or de-duplicated.
--
-- This migration:
--   1. keeps the NEWEST row per (user_id, alert_key) (sent_at, then
--      created_at, then id) and, if any older duplicate was read, carries the
--      latest read_at over to the kept row so the inbox doesn't resurface it;
--   2. moves every older duplicate into public.alert_log_dedupe_backup
--      (service_role only) before deleting it from alert_log; nothing is
--      lost;
--   3. adds the constraint (same name as 20260814120000).
-- Idempotent: a re-run finds no duplicates and an existing constraint.

CREATE TABLE IF NOT EXISTS public.alert_log_dedupe_backup
  (LIKE public.alert_log INCLUDING DEFAULTS);
ALTER TABLE public.alert_log_dedupe_backup
  ADD COLUMN IF NOT EXISTS moved_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.alert_log_dedupe_backup ENABLE ROW LEVEL SECURITY; -- no policies: service_role only
REVOKE ALL ON public.alert_log_dedupe_backup FROM anon, authenticated;
GRANT ALL ON public.alert_log_dedupe_backup TO service_role;

DO $$
DECLARE
  n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conrelid = 'public.alert_log'::regclass
               AND conname = 'alert_log_user_alert_key_key') THEN
    RETURN;
  END IF;

  CREATE TEMP TABLE _alert_log_ranked ON COMMIT DROP AS
    SELECT id, user_id, alert_key,
           row_number() OVER (PARTITION BY user_id, alert_key
                              ORDER BY sent_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC) AS rn,
           max(read_at) OVER (PARTITION BY user_id, alert_key) AS last_read
    FROM public.alert_log;

  -- Carry read state over to the kept row.
  UPDATE public.alert_log a
     SET read_at = r.last_read
    FROM _alert_log_ranked r
   WHERE r.id = a.id AND r.rn = 1 AND a.read_at IS NULL AND r.last_read IS NOT NULL
     AND EXISTS (SELECT 1 FROM _alert_log_ranked d
                 WHERE d.user_id = r.user_id AND d.alert_key = r.alert_key AND d.rn > 1);

  INSERT INTO public.alert_log_dedupe_backup
    (id, user_id, alert_type, alert_key, sent_at, title, body, payload, read_at, created_at)
  SELECT a.id, a.user_id, a.alert_type, a.alert_key, a.sent_at, a.title, a.body, a.payload, a.read_at, a.created_at
    FROM public.alert_log a JOIN _alert_log_ranked r ON r.id = a.id
   WHERE r.rn > 1;
  GET DIAGNOSTICS n = ROW_COUNT;

  DELETE FROM public.alert_log a
   USING _alert_log_ranked r
   WHERE r.id = a.id AND r.rn > 1
     AND EXISTS (SELECT 1 FROM public.alert_log_dedupe_backup b WHERE b.id = a.id);

  RAISE NOTICE 'alert_log: moved % duplicate row(s) to alert_log_dedupe_backup', n;

  ALTER TABLE public.alert_log
    ADD CONSTRAINT alert_log_user_alert_key_key UNIQUE (user_id, alert_key);
END $$;

NOTIFY pgrst, 'reload schema';
