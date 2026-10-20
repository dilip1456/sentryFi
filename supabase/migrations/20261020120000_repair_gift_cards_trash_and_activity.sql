-- Idempotent repair for the gift-card soft-delete + activity trail.
--
-- 20260925120000_gift_cards_trash_and_activity.sql was never applied to the
-- live project: the app's Gift Cards page queries gift_cards.deleted_at
-- (HTTP 400, column does not exist) and gift_card_activity (HTTP 404, table
-- not found), so the page spun forever. That migration isn't re-runnable
-- (plain ADD COLUMN / CREATE TABLE / CREATE POLICY), so this one re-creates
-- the same objects with IF NOT EXISTS guards. Safe to run whether or not the
-- earlier migration has been applied. RLS mirrors the existing gift_cards
-- conventions: authenticated users only see/insert their own rows; the
-- activity trail is append-only (no UPDATE/DELETE grant or policy).

-- 1. Soft delete on gift_cards ------------------------------------------------
ALTER TABLE public.gift_cards
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_gift_cards_deleted_at
  ON public.gift_cards(user_id, deleted_at);

-- 2. Append-only usage trail -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gift_card_activity (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  gift_card_id UUID NOT NULL REFERENCES public.gift_cards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('added', 'spend', 'adjustment', 'removed', 'restored')),
  amount NUMERIC,
  balance_after NUMERIC NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.gift_card_activity TO authenticated;
GRANT ALL ON public.gift_card_activity TO service_role;

ALTER TABLE public.gift_card_activity ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'gift_card_activity'
      AND policyname = 'Users view own gift card activity'
  ) THEN
    CREATE POLICY "Users view own gift card activity" ON public.gift_card_activity
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'gift_card_activity'
      AND policyname = 'Users insert own gift card activity'
  ) THEN
    CREATE POLICY "Users insert own gift card activity" ON public.gift_card_activity
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_gift_card_activity_card
  ON public.gift_card_activity(gift_card_id, created_at DESC);

-- 3. Make PostgREST see the new column/table immediately (otherwise the API
--    can keep returning 400/404 until its schema cache refreshes).
NOTIFY pgrst, 'reload schema';
