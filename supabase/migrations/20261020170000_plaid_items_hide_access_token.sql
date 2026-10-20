-- Security audit H2: plaid_items.access_token must never reach the client.
--
-- Plaid access tokens are long-lived bank credentials. Until now
-- `GRANT SELECT ON public.plaid_items TO authenticated` plus the owner SELECT
-- policy let any signed-in session read its own tokens through PostgREST
-- (`/rest/v1/plaid_items?select=access_token`). Only the edge functions,
-- which use service_role, need the token.
--
-- This migration switches anon/authenticated to column-level SELECT on every
-- column EXCEPT access_token, and removes their write privileges (the client
-- never writes plaid_items; the plaid-* edge functions do, as service_role).
-- The frontend only selects id, item_id, institution_id, institution_name,
-- status, cursor and created_at (useDashboardData, LivePlaidDashboard,
-- ProfileDialog, Index), so nothing in the app changes.
--
-- Idempotent: safe to re-run. Columns are discovered at run time, so columns
-- that were added by hand on the live project keep working.

DO $$
DECLARE
  cols text;
BEGIN
  IF to_regclass('public.plaid_items') IS NULL THEN
    RAISE NOTICE 'public.plaid_items does not exist; skipping';
    RETURN;
  END IF;

  -- Drop every table-level privilege the API roles might hold (Supabase's
  -- default privileges grant ALL on new public tables to anon/authenticated).
  REVOKE ALL ON public.plaid_items FROM anon, authenticated;
  -- Table-level REVOKE does not remove column-level grants, so remove any
  -- explicit column grant on the token as well.
  REVOKE ALL (access_token) ON public.plaid_items FROM anon, authenticated;

  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'plaid_items'
    AND column_name <> 'access_token';

  EXECUTE format('GRANT SELECT (%s) ON public.plaid_items TO authenticated', cols);
  GRANT ALL ON public.plaid_items TO service_role;

  ALTER TABLE public.plaid_items ENABLE ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'plaid_items'
      AND policyname = 'Users view own items'
  ) THEN
    CREATE POLICY "Users view own items" ON public.plaid_items
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

  -- supabase-schema.sql (legacy, root of the repo) created a FOR ALL policy.
  -- Writes are now privilege-revoked anyway, but drop it so the policy set
  -- matches intent if that file was ever applied.
  DROP POLICY IF EXISTS "Users can manage own plaid items" ON public.plaid_items;
END $$;

NOTIFY pgrst, 'reload schema';
