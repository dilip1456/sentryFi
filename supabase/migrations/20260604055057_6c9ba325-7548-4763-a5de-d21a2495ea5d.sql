
CREATE TABLE public.plaid_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  item_id text NOT NULL UNIQUE,
  access_token text NOT NULL,
  institution_id text,
  institution_name text,
  cursor text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plaid_items TO authenticated;
GRANT ALL ON public.plaid_items TO service_role;
ALTER TABLE public.plaid_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own items" ON public.plaid_items FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.plaid_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES public.plaid_items(id) ON DELETE CASCADE,
  account_id text NOT NULL UNIQUE,
  name text,
  official_name text,
  mask text,
  type text,
  subtype text,
  current_balance numeric,
  available_balance numeric,
  iso_currency_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plaid_accounts TO authenticated;
GRANT ALL ON public.plaid_accounts TO service_role;
ALTER TABLE public.plaid_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own accounts" ON public.plaid_accounts FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.plaid_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES public.plaid_items(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  transaction_id text NOT NULL UNIQUE,
  amount numeric NOT NULL,
  iso_currency_code text,
  date date NOT NULL,
  authorized_date date,
  name text,
  merchant_name text,
  category text[],
  pending boolean DEFAULT false,
  payment_channel text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plaid_transactions TO authenticated;
GRANT ALL ON public.plaid_transactions TO service_role;
ALTER TABLE public.plaid_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own transactions" ON public.plaid_transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_plaid_accounts_user ON public.plaid_accounts(user_id);
CREATE INDEX idx_plaid_transactions_user_date ON public.plaid_transactions(user_id, date DESC);

CREATE TRIGGER trg_plaid_items_updated BEFORE UPDATE ON public.plaid_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_plaid_accounts_updated BEFORE UPDATE ON public.plaid_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_plaid_transactions_updated BEFORE UPDATE ON public.plaid_transactions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
