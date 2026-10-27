-- Runs send-alerts every 20 minutes so deposit/salary/refund/budget emails go
-- out even when the user never opens the app (previously fire-and-forget on load only).
--
-- Guarded (same style as 20261020170300): when pg_cron isn't installed, e.g.
-- a fresh `supabase db reset` with no cron schema, this skips with a NOTICE
-- instead of failing the whole reset. With pg_cron present (production) it
-- schedules exactly the same job as before; it is already applied there.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron is not installed; send-alerts-every-20-min not scheduled';
    RETURN;
  END IF;
  PERFORM cron.schedule(
  'send-alerts-every-20-min',
  '*/20 * * * *',
  $$
  select net.http_post(
    url := 'https://lihzpxzujswzketrredo.supabase.co/functions/v1/send-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpaHpweHp1anN3emtldHJyZWRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2MDMyMjksImV4cCI6MjA5NjE3OTIyOX0.MeMXYrpz_W7kA1yo3xOwBqVDFk7kDyX9F9tSus3sthA'
    ),
    body := '{}'::jsonb
  );
  $$
);
END
$do$;
