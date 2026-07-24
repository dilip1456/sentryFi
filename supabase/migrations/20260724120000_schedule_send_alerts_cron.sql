-- Runs send-alerts every 20 minutes so deposit/salary/refund/budget emails go
-- out even when the user never opens the app (previously fire-and-forget on load only).
select cron.schedule(
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
