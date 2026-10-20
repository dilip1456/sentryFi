-- Production drift repair: updated_at triggers from 20260601172002 and
-- 20260604055057 that never existed on the live project (updated_at never
-- changed on edits). Uses public.update_updated_at_column()
-- (20261020180300). Each trigger is only created when the table has an
-- updated_at column, so it can never break writes. Idempotent.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('profiles', 'trg_profiles_updated'),
      ('subscribers', 'trg_subscribers_updated'),
      ('plaid_items', 'trg_plaid_items_updated'),
      ('plaid_accounts', 'trg_plaid_accounts_updated'),
      ('plaid_transactions', 'trg_plaid_transactions_updated')) AS v(tbl, trg)
  LOOP
    IF to_regclass(format('public.%I', r.tbl)) IS NULL
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = 'updated_at') THEN
      RAISE NOTICE 'public.% has no updated_at column; % not created', r.tbl, r.trg;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', r.trg, r.tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',
                   r.trg, r.tbl);
  END LOOP;
END $$;
