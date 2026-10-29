-- Timeline RLS + keyset pagination check (run on a THROWAWAY local Postgres 17, never production).
-- Setup: auth schema stubs (supabase/tests/auth_shim.sql), then every file in supabase/migrations in order, then:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/timeline_events_rls.sql   (raises on failure; prints ALL TIMELINE RLS/PAGINATION CHECKS PASSED)
-- Seed two users and assert isolation + pagination semantics of timeline_events / timeline_page.
begin;
grant usage on schema auth to authenticated, anon;
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-00000000000a','a@x'),('00000000-0000-0000-0000-00000000000b','b@x') on conflict do nothing;
insert into public.plaid_items(id,user_id,item_id,access_token) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','ia','x'),
 ('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000b','ib','x');
-- user A: 30 spend txns on 30 days, an internal pair, an override, a classifier verdict
insert into public.plaid_transactions(user_id,item_id,account_id,transaction_id,amount,date,name,merchant_name,pfc_primary,pfc_detailed)
select '00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','acc1','a'||lpad(g::text,3,'0'),10+g,date '2026-10-01'-g,'Coffee '||g,'Cafe','FOOD_AND_DRINK','FOOD_AND_DRINK_COFFEE' from generate_series(1,30) g;
insert into public.plaid_transactions(user_id,item_id,account_id,transaction_id,amount,date,name,pfc_primary,pfc_detailed) values
 ('00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','acc1','a_xfer_out',500,'2026-10-02','ONLINE TRANSFER TO SAV','TRANSFER_OUT','TRANSFER_OUT_ACCOUNT_TRANSFER'),
 ('00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','acc2','a_xfer_in',-500,'2026-10-02','ONLINE TRANSFER FROM CHK','TRANSFER_IN','TRANSFER_IN_ACCOUNT_TRANSFER'),
 ('00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','acc1','a_pay',-3000,'2026-10-01','PAYROLL ACME','INCOME','INCOME_WAGES'),
 ('00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','acc1','a_ovr',75,'2026-10-01','CITY WATER','GENERAL_MERCHANDISE',null);
insert into public.txn_classifications(user_id,transaction_id,txn_type) values
 ('00000000-0000-0000-0000-00000000000a','a_xfer_out','transfer_internal'),('00000000-0000-0000-0000-00000000000a','a_xfer_in','transfer_internal'),
 ('00000000-0000-0000-0000-00000000000a','a_ovr','spend');
insert into public.txn_overrides(user_id,transaction_id,txn_type) values ('00000000-0000-0000-0000-00000000000a','a_ovr','obligation_bill');
-- user B: 5 txns + an alert
insert into public.plaid_transactions(user_id,item_id,account_id,transaction_id,amount,date,name,pfc_primary)
select '00000000-0000-0000-0000-00000000000b','10000000-0000-0000-0000-00000000000b','bacc','b'||g,99,date '2026-10-01'-g,'B secret','GENERAL_MERCHANDISE' from generate_series(1,5) g;
insert into public.alert_log(user_id,alert_type,alert_key,title,sent_at) values
 ('00000000-0000-0000-0000-00000000000b','large_txn','k1','B alert','2026-10-01T15:00Z'),
 ('00000000-0000-0000-0000-00000000000a','large_txn','k2','A alert','2026-10-01T23:30Z');
insert into public.inferences(user_id,kind,subject_type,subject_ref,payload,confidence,status) values
 ('00000000-0000-0000-0000-00000000000a','price_increase','stream','s1','{"displayName":"Netflix","amount":2}',0.9,'suggested'),
 ('00000000-0000-0000-0000-00000000000a','low_balance','account','acc1','{}',0.9,'rejected');
insert into public.tax_milestones(user_id,title,due_date,status,done_at) values
 ('00000000-0000-0000-0000-00000000000a','Q3 estimated tax','2026-09-15','done','2026-09-14T15:00Z'),
 ('00000000-0000-0000-0000-00000000000a','Q4 estimated tax','2027-01-15','upcoming',null);

do $$
declare n int; r record; c_on date; c_at timestamptz; c_id text; seen int := 0; pages int := 0; ids text[] := '{}';
begin
  -- security_invoker is set on the view
  select count(*) into n from pg_class where relname='timeline_events' and reloptions @> array['security_invoker=true'];
  if n <> 1 then raise exception 'view not security_invoker'; end if;

  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',true);
  select count(*) into n from public.timeline_events where user_id <> auth.uid();
  if n <> 0 then raise exception 'A sees % foreign rows', n; end if;
  select count(*) into n from public.timeline_events where title in ('B secret','B alert');
  if n <> 0 then raise exception 'A sees B rows by title'; end if;
  select count(*) into n from public.timeline_events;
  raise notice 'A total view rows: %', n;  -- 34 txns + 1 alert + 1 inference + 1 milestone
  if n <> 37 then raise exception 'expected 37 rows, got %', n; end if;

  -- override wins over classifier; classifier wins over pfc; internal flag
  select txn_type, category, meta->>'type_source' as src into r from public.timeline_events where source_id='a_ovr';
  if r.txn_type <> 'obligation_bill' or r.category <> 'bills' or r.src <> 'override' then raise exception 'override did not win: %', r; end if;
  select count(*) into n from public.timeline_events where is_internal;
  if n <> 2 then raise exception 'internal count %', n; end if;
  select txn_type into r from public.timeline_events where source_id='a_pay';
  if r.txn_type <> 'income_salary' then raise exception 'pfc fallback wrong %', r; end if;
  -- alert day uses user tz (no profile -> America/New_York): 23:30Z = 19:30 ET on Oct 1
  select occurred_on into c_on from public.timeline_events where source='alert';
  if c_on <> date '2026-10-01' then raise exception 'alert day %', c_on; end if;

  -- paginate everything (default hides internal): 35 rows over 25 + 10, no dupes, strictly ordered
  c_on := null; c_at := null; c_id := null;
  loop
    pages := pages + 1; n := 0;
    for r in select * from public.timeline_page(c_on, c_at, c_id, '{}', false, 25) loop
      n := n + 1;
      if r.id = any(ids) then raise exception 'duplicate %', r.id; end if;
      ids := ids || r.id;
      if r.is_internal then raise exception 'internal leaked'; end if;
      c_on := r.occurred_on; c_at := r.occurred_at; c_id := r.id;
    end loop;
    exit when n < 25;
  end loop;
  if cardinality(ids) <> 35 or pages <> 2 then raise exception 'paged % rows in % pages', cardinality(ids), pages; end if;

  -- filters
  select count(*) into n from public.timeline_page(null,null,null,array['income'],false,100);
  if n <> 1 then raise exception 'income filter %', n; end if;
  select count(*) into n from public.timeline_page(null,null,null,array['income'],true,100);
  if n <> 3 then raise exception 'income+internal %', n; end if;
  select count(*) into n from public.timeline_page(null,null,null,array['alerts','taxes'],false,100);
  if n <> 3 then raise exception 'alerts+taxes %', n; end if;
  -- jump-to-date: on = at + 1 day, at null -> everything on/before Sep 20
  select count(*) into n from public.timeline_page(date '2026-09-21',null,null,'{}',false,100) where occurred_on > date '2026-09-20';
  if n <> 0 then raise exception 'jump leaked newer rows'; end if;
  select max(occurred_on) into c_on from public.timeline_page(date '2026-09-21',null,null,'{}',false,100);
  if c_on <> date '2026-09-20' then raise exception 'jump max %', c_on; end if;

  -- writes to another user's classification are rejected
  begin
    insert into public.txn_classifications(user_id,transaction_id,txn_type) values ('00000000-0000-0000-0000-00000000000b','b1','spend');
    raise exception 'cross-user insert allowed';
  exception when insufficient_privilege then null; when others then
    if sqlerrm like 'new row violates row-level security%' then null; else raise; end if;
  end;

  -- user B sees only own rows
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true);
  select count(*) into n from public.timeline_page(null,null,null,'{}',true,100);
  if n <> 6 then raise exception 'B count %', n; end if;
  select count(*) into n from public.timeline_events where user_id = '00000000-0000-0000-0000-00000000000a';
  if n <> 0 then raise exception 'B sees A'; end if;
  -- even passing A's id in a where clause through the RPC gives nothing extra
  select count(*) into n from public.txn_classifications;
  if n <> 0 then raise exception 'B sees A classifications'; end if;

  -- anon: no access at all
  perform set_config('role','anon',true);
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform 1 from public.timeline_events limit 1;
    raise exception 'anon could read view';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.timeline_page(null,null,null,'{}',false,25);
    raise exception 'anon could call rpc';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role','postgres',true);
  raise notice 'ALL TIMELINE RLS/PAGINATION CHECKS PASSED';
end $$;
rollback;
