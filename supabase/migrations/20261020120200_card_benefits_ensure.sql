-- Idempotent definition of public.card_benefits (Benefits page).
--
-- The table was created by hand on the live project and never captured in
-- supabase/migrations. CardBenefitsView upserts with
-- onConflict "user_id,account_id,benefit_key", which needs a unique index on
-- exactly those columns. This file is a no-op on a correctly-configured
-- database and creates everything on a fresh one.

CREATE TABLE IF NOT EXISTS public.card_benefits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  benefit_key TEXT NOT NULL,
  title TEXT,
  description TEXT,
  value TEXT,
  period TEXT,
  action_type TEXT,
  action_label TEXT,
  cashback_category TEXT,
  cashback_rate NUMERIC,
  priority INTEGER NOT NULL DEFAULT 5,
  used_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.card_benefits
  ADD COLUMN IF NOT EXISTS action_type TEXT,
  ADD COLUMN IF NOT EXISTS action_label TEXT,
  ADD COLUMN IF NOT EXISTS cashback_category TEXT,
  ADD COLUMN IF NOT EXISTS cashback_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMPTZ DEFAULT now();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_benefits TO authenticated;
GRANT ALL ON public.card_benefits TO service_role;

ALTER TABLE public.card_benefits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'card_benefits'
      AND policyname = 'Users can manage own card benefits'
  ) THEN
    CREATE POLICY "Users can manage own card benefits" ON public.card_benefits
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Unique key for the client's upsert. Skipped (with a notice) rather than
-- failing if exact-key duplicates already exist; the client de-dupes on read.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = 'public.card_benefits'::regclass
      AND i.indisunique AND i.indnkeyatts = 3 AND i.indpred IS NULL
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
           FROM pg_attribute a
           WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey::int2[]))
          = ARRAY['account_id', 'benefit_key', 'user_id']
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.card_benefits
    GROUP BY user_id, account_id, benefit_key HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'card_benefits: exact duplicate (user_id, account_id, benefit_key) rows exist; unique index not created';
    RETURN;
  END IF;

  CREATE UNIQUE INDEX card_benefits_user_account_key
    ON public.card_benefits(user_id, account_id, benefit_key);
END $$;

CREATE INDEX IF NOT EXISTS idx_card_benefits_user ON public.card_benefits(user_id, priority);

NOTIFY pgrst, 'reload schema';
