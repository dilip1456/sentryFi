-- RLS / privilege test for 20261104000100_recurring_streams_review (throwaway local PG only).
\set ON_ERROR_STOP 1
begin;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-00000000000a','a@t.test'),('00000000-0000-0000-0000-00000000000b','b@t.test');
do $$ begin
  if has_table_privilege('anon','public.recurring_streams','select') or has_table_privilege('anon','public.recurring_streams','insert') then raise exception 'anon has access'; end if;
  if has_table_privilege('authenticated','public.recurring_streams','truncate') then raise exception 'authenticated can truncate'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',true);
insert into public.recurring_streams(user_id,series_key,merchant_key,display_name,direction,txn_type,kind,cadence,source,status,user_amount,user_cadence)
  values ('00000000-0000-0000-0000-00000000000a','picture:x','x','X','outflow','obligation_bill','bill','monthly','picture','dismissed',10,'monthly');
do $$ declare ok boolean := false; begin
  begin
    insert into public.recurring_streams(user_id,series_key,merchant_key,display_name,direction,txn_type,kind,cadence,source)
      values ('00000000-0000-0000-0000-00000000000b','picture:y','y','Y','outflow','obligation_bill','bill','monthly','picture');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'cross-user insert allowed'; end if;
  begin
    insert into public.recurring_streams(user_id,series_key,merchant_key,display_name,direction,txn_type,kind,cadence,source)
      values ('00000000-0000-0000-0000-00000000000a','picture:z','z','Z','outflow','obligation_bill','bill','monthly','bogus');
    raise exception 'bad source accepted';
  exception when check_violation then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true);
do $$ begin
  if (select count(*) from public.recurring_streams) <> 0 then raise exception 'user b sees user a rows'; end if;
end $$;
update public.recurring_streams set user_amount = 99;
reset role;
do $$ begin
  if (select user_amount from public.recurring_streams where series_key='picture:x') <> 10 then raise exception 'cross-user update'; end if;
end $$;
select 'recurring_streams_review RLS: PASS';
rollback;
