-- Bill price-change alerts ("Armstrong went from $59.95 to $109.95").
--
-- 1. alert_preferences.alert_price_change: per-category opt-out for the new
--    send-alerts "price_increase" check. Default true, like the other
--    alert_* flags (20261020180400), so everyone gets it until they opt out.
-- 2. send-alerts cron: raise the pg_net request timeout to 60s. The job's
--    net.http_post had no timeout_milliseconds, so pg_net's 5s default cut
--    the call off while send-alerts was still looping over users (the new
--    check reads ~400 days of history per user with fresh charges).
--    The existing command is edited in place with cron.alter_job, so the
--    URL and the Vault-backed headers (20261020170300) stay exactly as they
--    are in production. Safe to re-run: a command that already carries a
--    timeout just has its value set to 60000; nothing happens when pg_cron
--    or the job is missing.
--
-- Idempotent. Apply, then redeploy the send-alerts function.

alter table public.alert_preferences
  add column if not exists alert_price_change boolean not null default true;

DO $$
DECLARE
  j record;
  cmd text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron is not installed; send-alerts cron timeout unchanged';
    RETURN;
  END IF;

  FOR j IN
    SELECT jobid, jobname, command FROM cron.job
    WHERE jobname = 'send-alerts-every-20-min'
       OR (command ILIKE '%/functions/v1/send-alerts%' AND command ILIKE '%net.http_post%')
  LOOP
    IF j.command ~* 'timeout_milliseconds' THEN
      cmd := regexp_replace(j.command, 'timeout_milliseconds\s*:=\s*\d+', 'timeout_milliseconds := 60000', 'gi');
    ELSIF j.command ~* 'body\s*:=\s*''\{\}''::jsonb' THEN
      cmd := regexp_replace(j.command, '(body\s*:=\s*''\{\}''::jsonb)', '\1,
      timeout_milliseconds := 60000', 'i');
    ELSE
      RAISE NOTICE 'cron job % (%): no "body := ''{}''::jsonb" argument found; timeout left unchanged', j.jobid, j.jobname;
      CONTINUE;
    END IF;
    IF cmd IS DISTINCT FROM j.command THEN
      PERFORM cron.alter_job(job_id := j.jobid, command := cmd);
      RAISE NOTICE 'cron job % (%): timeout_milliseconds set to 60000', j.jobid, j.jobname;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
