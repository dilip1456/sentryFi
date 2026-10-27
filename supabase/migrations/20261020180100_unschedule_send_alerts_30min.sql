-- Production drift repair: remove the legacy pg_cron job "send-alerts-30min".
--
-- It was created by hand on the live project (not by any migration), posts
-- to send-alerts with no Authorization or x-cron-secret header, and since
-- 20261020170300 + the hardened send-alerts it only ever gets 403. The real
-- schedule is "send-alerts-every-20-min" (20260724120000 / 20261020170300).
-- Idempotent: does nothing if the job (or pg_cron) is absent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-alerts-30min') THEN
    PERFORM cron.unschedule('send-alerts-30min');
  END IF;
END $$;
