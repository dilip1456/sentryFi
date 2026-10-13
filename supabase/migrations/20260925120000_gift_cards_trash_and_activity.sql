-- Soft-delete for gift cards: "Remove" no longer destroys the row, so a
-- deleted card can be viewed and restored later. Existing SELECT/UPDATE/
-- DELETE policies already cover everything an update-to-soft-delete or a
-- true permanent delete needs, so no policy changes are required here.
ALTER TABLE public.gift_cards
  ADD COLUMN deleted_at TIMESTAMPTZ;

CREATE INDEX idx_gift_cards_deleted_at ON public.gift_cards(user_id, deleted_at);

-- Append-only usage trail: one row per meaningful event on a card (added,
-- spend logged, balance corrected by hand, removed, restored) so "how was
-- this card eventually used" is answerable from history instead of just the
-- current balance. Deliberately no UPDATE/DELETE grant or policy — a trail
-- that can be edited after the fact isn't a trail.
CREATE TABLE public.gift_card_activity (
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

CREATE POLICY "Users view own gift card activity" ON public.gift_card_activity
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own gift card activity" ON public.gift_card_activity
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_gift_card_activity_card ON public.gift_card_activity(gift_card_id, created_at DESC);
