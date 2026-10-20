-- Security audit M1: send-alerts runs with service_role for every user and
-- used to accept any caller holding the public anon key. The function now
-- requires either the service_role key or an `x-cron-secret` header equal to
-- its CRON_SECRET env var (see supabase/functions/_shared/auth.ts).
--
-- This re-schedules the existing pg_cron job (same job name, so cron.schedule
-- replaces it in place) to send that header. Both values the job sends are
-- read from Supabase Vault at run time, so neither is stored in this file or
-- in cron.job (the old job hard-coded the anon JWT; audit L5):
--   * send_alerts_cron_secret: the x-cron-secret value (the real credential)
--   * anon_key: the project's public anon key, sent as Authorization only so
--     the request passes the gateway's verify_jwt check; it grants nothing.
--
-- BEFORE APPLYING (owner):
--   1. Generate a secret, e.g. `openssl rand -hex 32`.
--   2. supabase secrets set CRON_SECRET=<secret>            (edge function env)
--   3. select vault.create_secret('<secret>', 'send_alerts_cron_secret');
--      select vault.create_secret('<anon key>', 'anon_key');  -- skip if it exists
--   4. Apply this migration, then deploy the send-alerts function.
-- The migration refuses to run if step 3 is missing, so alerts cannot be left
-- silently broken.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron is not installed; nothing to reschedule';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'send_alerts_cron_secret') THEN
    RAISE EXCEPTION 'Vault secret "send_alerts_cron_secret" is missing. Create it first: select vault.create_secret(''<CRON_SECRET value>'', ''send_alerts_cron_secret'');';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'anon_key') THEN
    RAISE EXCEPTION 'Vault secret "anon_key" is missing. Create it first: select vault.create_secret(''<project anon key>'', ''anon_key'');';
  END IF;

  PERFORM cron.schedule(
    'send-alerts-every-20-min',
    '*/20 * * * *',
    $job$
    select net.http_post(
      url := 'https://lihzpxzujswzketrredo.supabase.co/functions/v1/send-alerts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                        where name = 'anon_key' limit 1),
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                          where name = 'send_alerts_cron_secret' limit 1)
      ),
      body := '{}'::jsonb
    );
    $job$
  );
END $$;
