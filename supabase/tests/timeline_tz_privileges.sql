-- Timeline: time zone fallback, lossless keyset cursor, and privileges.
-- THROWAWAY local Postgres 17 only (never production). Setup as in
-- timeline_events_rls.sql (auth_shim.sql + every migration), then run this
-- file; it raises on failure and prints ALL TIMELINE TZ/CURSOR/PRIVILEGE CHECKS PASSED.
begin;
grant usage on schema auth to authenticated, anon;
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000c1','c@x'),('00000000-0000-0000-0000-0000000000e5','e@x') on conflict do nothing;
-- C: a free-text profile time zone that Postgres can't parse
insert into public.profiles(user_id, timezone) values ('00000000-0000-0000-0000-0000000000c1','Eastern Time')
  on conflict (user_id) do update set timezone = excluded.timezone;
insert into public.alert_log(user_id,alert_type,alert_key,title,sent_at) values
 ('00000000-0000-0000-0000-0000000000c1','large_txn','tz1','Evening alert','2026-10-28T21:15:00-04:00');
insert into public.tax_milestones(user_id,title,due_date,status) values
 ('00000000-0000-0000-0000-0000000000c1','Due today (app zone)',(now() at time zone 'America/New_York')::date,'upcoming'),
 ('00000000-0000-0000-0000-0000000000c1','Due yesterday (app zone)',(now() at time zone 'America/New_York')::date - 1,'upcoming');
-- E: 5 findings created in the same microsecond-precision instant (batch insert)
insert into public.inferences(user_id,kind,subject_type,subject_ref,payload,confidence,status,created_at)
select '00000000-0000-0000-0000-0000000000e5','bill_autopay','stream','s'||g,jsonb_build_object('displayName','Bill '||g),0.9,'suggested','2026-10-20T15:00:00.654321Z'
from generate_series(1,5) g;

do $$
declare n int; d date; t text; r record; c_on date; c_at text; c_id text; pages int; ids text[];
  fns text[] := array['public.timeline_pfc_type(text, text, numeric)','public.timeline_category(text)',
                      'public.timeline_safe_tz(text)','public.timeline_tz()',
                      'public.timeline_page(date, timestamptz, text, text[], boolean, integer, text)'];
  f text; priv text;
begin
  -- ── helper ──
  if public.timeline_safe_tz('Eastern Time') <> 'America/New_York' then raise exception 'safe_tz bad name'; end if;
  if public.timeline_safe_tz(null) <> 'America/New_York' then raise exception 'safe_tz null'; end if;
  if public.timeline_safe_tz('') <> 'America/New_York' then raise exception 'safe_tz empty'; end if;
  if public.timeline_safe_tz('Europe/Paris') <> 'Europe/Paris' then raise exception 'safe_tz valid'; end if;
  if public.timeline_safe_tz('UTC') <> 'UTC' then raise exception 'safe_tz utc'; end if;

  -- ── privileges (revoke-then-grant) ──
  foreach priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('anon','public.txn_classifications',priv) then raise exception 'anon % txn_classifications', priv; end if;
    if has_table_privilege('anon','public.tax_milestones',priv) then raise exception 'anon % tax_milestones', priv; end if;
    if has_table_privilege('anon','public.timeline_events',priv) then raise exception 'anon % timeline_events', priv; end if;
    if has_table_privilege('authenticated','public.txn_classifications',priv) <> (priv in ('SELECT','INSERT','UPDATE')) then
      raise exception 'authenticated % txn_classifications wrong', priv; end if;
    if has_table_privilege('authenticated','public.tax_milestones',priv) <> (priv = 'SELECT') then
      raise exception 'authenticated % tax_milestones wrong', priv; end if;
    if has_table_privilege('authenticated','public.timeline_events',priv) <> (priv = 'SELECT') then
      raise exception 'authenticated % timeline_events wrong', priv; end if;
  end loop;
  foreach f in array fns loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon can execute %', f; end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated cannot execute %', f; end if;
    -- no PUBLIC grant left (an "=X/owner" acl item)
    select count(*) into n from pg_proc p, unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = f::regprocedure and a::text like '=%';
    if n <> 0 then raise exception 'PUBLIC can execute %', f; end if;
  end loop;

  -- ── bad profile tz no longer breaks the view or the RPC; app zone dates alerts ──
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',true);
  select occurred_on into d from public.timeline_events where title = 'Evening alert';
  if d <> date '2026-10-28' then raise exception 'view: 9:15 PM EDT alert dated % (want 2026-10-28)', d; end if;
  select count(*) into n from public.timeline_page(null,null,null,'{}',false,25);
  if n < 1 then raise exception 'rpc returned nothing'; end if;
  select occurred_on into d from public.timeline_page(null,null,null,array['alerts'],false,25,'Eastern Time') where title = 'Evening alert';
  if d <> date '2026-10-28' then raise exception 'rpc bad p_tz: alert dated %', d; end if;
  select occurred_on into d from public.timeline_page(null,null,null,array['alerts'],false,25,'America/New_York') where title = 'Evening alert';
  if d <> date '2026-10-28' then raise exception 'rpc NY: alert dated %', d; end if;
  select occurred_on into d from public.timeline_page(null,null,null,array['alerts'],false,25,'UTC') where title = 'Evening alert';
  if d <> date '2026-10-29' then raise exception 'rpc UTC: alert dated %', d; end if;
  perform set_config('sentryfi.timeline_tz','',true);
  -- tax milestones: "past due" in the app zone, so today's stays Upcoming only
  select count(*) into n from public.timeline_events where source = 'tax_milestone' and title = 'Due today (app zone)';
  if n <> 0 then raise exception 'milestone due today (app zone) is already in history'; end if;
  select count(*) into n from public.timeline_events where source = 'tax_milestone' and title = 'Due yesterday (app zone)';
  if n <> 1 then raise exception 'milestone due yesterday missing from history'; end if;

  -- ── lossless cursor: 5 rows sharing a microsecond timestamp, page size 2 ──
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e5',true);
  c_on := null; c_at := null; c_id := null; pages := 0; ids := '{}';
  loop
    pages := pages + 1; n := 0;
    for r in select * from public.timeline_page(c_on, c_at::timestamptz, c_id, '{}', false, 2, 'America/New_York') loop
      n := n + 1;
      if r.id = any(ids) then raise exception 'duplicate %', r.id; end if;
      ids := ids || r.id;
      -- what the client sends back: the JSON text PostgREST returned (at_exact)
      c_on := r.occurred_on; c_id := r.id; c_at := to_json(r.occurred_at) #>> '{}';
    end loop;
    exit when n < 2 or pages > 10;
  end loop;
  if cardinality(ids) <> 5 then raise exception 'exact cursor saw % of 5', cardinality(ids); end if;
  raise notice 'exact cursor: 5 of 5 in % pages (sample cursor text %)', pages, c_at;

  perform set_config('role','postgres',true);
  raise notice 'ALL TIMELINE TZ/CURSOR/PRIVILEGE CHECKS PASSED';
end $$;
rollback;
