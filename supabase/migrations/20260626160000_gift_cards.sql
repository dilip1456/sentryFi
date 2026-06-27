CREATE TABLE public.gift_cards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_name TEXT NOT NULL,
  domain TEXT,
  logo_url TEXT,
  balance_check_url TEXT,
  buy_url TEXT,
  balance NUMERIC NOT NULL DEFAULT 0,
  initial_balance NUMERIC NOT NULL DEFAULT 0,
  card_number_last4 TEXT,
  pin TEXT,
  notes TEXT,
  balance_verified BOOLEAN NOT NULL DEFAULT false,
  last_balance_update TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gift_cards TO authenticated;
GRANT ALL ON public.gift_cards TO service_role;

ALTER TABLE public.gift_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own gift cards" ON public.gift_cards
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own gift cards" ON public.gift_cards
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own gift cards" ON public.gift_cards
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own gift cards" ON public.gift_cards
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_gift_cards_user ON public.gift_cards(user_id);

CREATE OR REPLACE FUNCTION public.gift_cards_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_gift_cards_updated BEFORE UPDATE ON public.gift_cards
  FOR EACH ROW EXECUTE FUNCTION public.gift_cards_set_updated_at();
