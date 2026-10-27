-- Baseline: public.user_settings.
--
-- The table was created by hand on the live project and no migration created
-- it, so `supabase db reset` failed at 20260706130000_add_smart_rules (the
-- first migration that ALTERs it). Reconstructed from the app
-- (src/hooks/useUserSettings), 20261020120100_user_settings_unique_user_id
-- and the column-adding migrations, with the policy name and grants used by
-- 20261020120100 / 20261020170100 so those stay no-ops after this.
--
-- Production: the table already exists, so this whole file is a no-op (the
-- guard returns before anything runs; nothing is altered, granted or
-- created). Sorted before every migration that references user_settings.
DO $$
BEGIN
  IF to_regclass('public.user_settings') IS NOT NULL THEN
    RAISE NOTICE 'public.user_settings exists; baseline skipped';
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS public.user_settings (
    id                    uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    budgets               jsonb       NOT NULL DEFAULT '{}'::jsonb,
    account_roles         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    cat_overrides         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    cat_rules             jsonb       NOT NULL DEFAULT '[]'::jsonb,
    custom_cats           jsonb       NOT NULL DEFAULT '[]'::jsonb,
    name_overrides        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    name_rules            jsonb       NOT NULL DEFAULT '{}'::jsonb,
    manual_income         jsonb       NOT NULL DEFAULT '[]'::jsonb,
    manual_internal       jsonb       NOT NULL DEFAULT '[]'::jsonb,
    manual_external       jsonb       NOT NULL DEFAULT '[]'::jsonb,
    dismissed_insights    jsonb       NOT NULL DEFAULT '[]'::jsonb,
    dismissed_actions     jsonb       NOT NULL DEFAULT '[]'::jsonb,
    dismissed_recurring   jsonb       NOT NULL DEFAULT '[]'::jsonb,
    panel_order           jsonb       NOT NULL DEFAULT '[]'::jsonb,
    account_meta          jsonb       NOT NULL DEFAULT '{}'::jsonb,
    benefits_used         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    money_map_feedback    jsonb       NOT NULL DEFAULT '{}'::jsonb,
    txn_splits            jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    -- upsert(..., { onConflict: "user_id" }) needs exactly this (same name as 20261020120100)
    CONSTRAINT user_settings_user_id_key UNIQUE (user_id)
  );
  -- Later migrations add: smart_rules, recurring_dismissals, overage_funding_prefs,
  -- planned_transfers, savings_goals, txn_tags, txn_notes, recurring_overrides,
  -- recurring_groups, card_autopay_from (all ADD COLUMN IF NOT EXISTS).

  REVOKE ALL ON public.user_settings FROM anon, authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
  GRANT ALL ON public.user_settings TO service_role;

  ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_settings'
                 AND policyname = 'Users can manage own settings') THEN
    CREATE POLICY "Users can manage own settings" ON public.user_settings
      FOR ALL TO authenticated
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;
