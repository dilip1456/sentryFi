-- Idempotent repair for public.user_settings.
--
-- useUserSettings saves with upsert(..., { onConflict: "user_id" }), which
-- PostgREST turns into INSERT ... ON CONFLICT (user_id). That requires a
-- unique constraint/index on exactly (user_id); without one Postgres raises
-- 42P10 and the API answers HTTP 400 (seen live on
-- user_settings?on_conflict=user_id), so settings changes were never saved.
-- user_settings has never been defined in supabase/migrations (it was
-- created by hand), so this migration also:
--   * creates the table on fresh projects,
--   * adds any jsonb column the app writes that is missing (a missing column
--     is the other way that same upsert returns 400),
--   * ensures RLS with an own-row policy,
--   * moves duplicate rows per user_id (if any) into a backup table — the
--     newest row is kept — so the unique index can be built. Nothing is
--     permanently deleted.

CREATE TABLE IF NOT EXISTS public.user_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS budgets               jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS account_roles         jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS cat_overrides         jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS cat_rules             jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS smart_rules           jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS custom_cats           jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS name_overrides        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS name_rules            jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS manual_income         jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS manual_internal       jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS manual_external       jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dismissed_insights    jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dismissed_actions     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dismissed_recurring   jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recurring_dismissals  jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS overage_funding_prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS planned_transfers     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS savings_goals         jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS panel_order           jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS account_meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS benefits_used         jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS money_map_feedback    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS txn_tags              jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS txn_notes             jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS recurring_overrides   jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS txn_splits            jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS recurring_groups      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS card_autopay_from     jsonb NOT NULL DEFAULT '{}'::jsonb;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_settings'
      AND policyname = 'Users can manage own settings'
  ) THEN
    CREATE POLICY "Users can manage own settings" ON public.user_settings
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Unique (user_id), after parking any duplicates.
DO $$
DECLARE
  has_unique boolean;
  order_col text;
  dup_count integer;
BEGIN
  -- Any unique constraint or unique index whose only key column is user_id.
  SELECT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE i.indrelid = 'public.user_settings'::regclass
      AND i.indisunique
      AND i.indnkeyatts = 1
      AND a.attname = 'user_id'
      AND i.indpred IS NULL
  ) INTO has_unique;

  IF has_unique THEN
    RETURN;
  END IF;

  SELECT count(*) INTO dup_count FROM (
    SELECT user_id FROM public.user_settings GROUP BY user_id HAVING count(*) > 1
  ) d;

  IF dup_count > 0 THEN
    -- Prefer updated_at, then created_at, then physical order, to pick the newest row.
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'user_settings' AND column_name = 'updated_at')
        THEN 'updated_at'
      WHEN EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'user_settings' AND column_name = 'created_at')
        THEN 'created_at'
      ELSE NULL
    END INTO order_col;

    EXECUTE 'CREATE TABLE IF NOT EXISTS public.user_settings_duplicates_backup
               (LIKE public.user_settings INCLUDING DEFAULTS)';
    ALTER TABLE public.user_settings_duplicates_backup ENABLE ROW LEVEL SECURITY; -- no policies: service_role only
    REVOKE ALL ON public.user_settings_duplicates_backup FROM anon, authenticated;

    EXECUTE format($q$
      WITH ranked AS (
        SELECT ctid AS rid,
               row_number() OVER (PARTITION BY user_id ORDER BY %s ctid DESC) AS rn
        FROM public.user_settings
      ), moved AS (
        INSERT INTO public.user_settings_duplicates_backup
        SELECT s.* FROM public.user_settings s JOIN ranked r ON r.rid = s.ctid WHERE r.rn > 1
        RETURNING 1
      )
      DELETE FROM public.user_settings s USING ranked r WHERE r.rid = s.ctid AND r.rn > 1
    $q$, CASE WHEN order_col IS NULL THEN '' ELSE quote_ident(order_col) || ' DESC NULLS LAST,' END);

    RAISE NOTICE 'user_settings: parked duplicate rows for % user(s) in public.user_settings_duplicates_backup', dup_count;
  END IF;

  ALTER TABLE public.user_settings
    ADD CONSTRAINT user_settings_user_id_key UNIQUE (user_id);
END $$;

NOTIFY pgrst, 'reload schema';
