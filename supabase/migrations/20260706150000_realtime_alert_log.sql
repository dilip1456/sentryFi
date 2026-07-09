-- Enable realtime on alert_log so the notification bell updates live.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'alert_log'
  ) then
    alter publication supabase_realtime add table public.alert_log;
  end if;
end $$;
