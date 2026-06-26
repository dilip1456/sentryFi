-- Shared card catalog: reward rates per spending category.
-- Populated on first use (via edge function + Groq), reused across all users.
CREATE TABLE IF NOT EXISTS public.card_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_key text UNIQUE NOT NULL,          -- normalized slug, e.g. "chase-sapphire-preferred"
  display_name text NOT NULL,
  match_keywords text[] NOT NULL,         -- lowercase keywords matched against account name
  dining_rate numeric NOT NULL DEFAULT 1,
  grocery_rate numeric NOT NULL DEFAULT 1,
  travel_rate numeric NOT NULL DEFAULT 1,
  gas_rate numeric NOT NULL DEFAULT 1,
  streaming_rate numeric NOT NULL DEFAULT 1,
  amazon_rate numeric NOT NULL DEFAULT 1,
  default_rate numeric NOT NULL DEFAULT 1,
  rewards_summary text,
  best_for text,
  perks text,
  ai_generated boolean DEFAULT false,     -- true if Groq generated this entry
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Authenticated users can read the catalog (needed by edge functions running as user)
ALTER TABLE public.card_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "card_catalog_read" ON public.card_catalog FOR SELECT TO authenticated USING (true);

-- Seed with known cards --------------------------------------------------

INSERT INTO public.card_catalog (card_key, display_name, match_keywords, dining_rate, grocery_rate, travel_rate, gas_rate, streaming_rate, amazon_rate, default_rate, rewards_summary, best_for, perks) VALUES

('chase-sapphire-reserve',    'Chase Sapphire Reserve',
 ARRAY['sapphire reserve'],
 3, 1, 3, 1, 1, 1, 1,
 '3x dining & travel, 10x hotels/car via Chase portal, 1x all else',
 'Frequent travelers',
 '$300 annual travel credit, Priority Pass lounge access'),

('chase-sapphire-preferred',  'Chase Sapphire Preferred',
 ARRAY['sapphire preferred'],
 3, 1, 2, 1, 1, 1, 1,
 '3x dining, 2x travel, 5x Chase travel portal, 1x all else',
 'Travel & restaurants',
 '$50 annual hotel credit, Trip delay protection'),

('chase-freedom-flex',        'Chase Freedom Flex',
 ARRAY['freedom flex'],
 3, 1, 1, 1, 1, 1, 1,
 '5% rotating quarterly categories, 3% dining & drugstores, 1% all else',
 'Rotating category maximizers',
 NULL),

('chase-freedom-unlimited',   'Chase Freedom Unlimited',
 ARRAY['freedom unlimited'],
 3, 1, 1, 1, 1, 1, 1.5,
 '1.5% on everything, 3% dining & drugstores, 5% Chase travel',
 'Everyday purchases',
 NULL),

('chase-freedom',             'Chase Freedom',
 ARRAY['freedom'],
 1, 1, 1, 1, 1, 1, 1,
 '5% quarterly rotating categories, 1% all else',
 'Category maximizers',
 NULL),

('amex-platinum',             'Amex Platinum',
 ARRAY['platinum','amex platinum'],
 1, 1, 5, 1, 1, 1, 1,
 '5x flights (direct/Amex Travel), 5x hotels (Amex Travel), 1x all else',
 'Frequent flyers',
 '$200 airline fee credit, $200 hotel credit, Centurion & Priority Pass lounges'),

('amex-gold',                 'Amex Gold',
 ARRAY['amex gold','gold card'],
 4, 4, 3, 1, 1, 1, 1,
 '4x dining worldwide, 4x U.S. groceries (up to $25k/yr), 3x flights, 1x all else',
 'Foodies & grocery shoppers',
 '$120 dining credit, $120 Uber Cash annually'),

('amex-blue-cash-preferred',  'Amex Blue Cash Preferred',
 ARRAY['blue cash preferred'],
 1, 6, 1, 3, 6, 1, 1,
 '6% U.S. supermarkets (up to $6k/yr), 6% streaming, 3% gas & transit, 1% all else',
 'Families & grocery shoppers',
 NULL),

('amex-blue-cash-everyday',   'Amex Blue Cash Everyday',
 ARRAY['blue cash everyday'],
 1, 3, 1, 3, 1, 1, 1,
 '3% U.S. supermarkets, 3% U.S. online retail, 3% gas, 1% all else',
 'No-fee everyday use',
 NULL),

('capital-one-venture-x',     'Capital One Venture X',
 ARRAY['venture x'],
 2, 2, 5, 2, 2, 2, 2,
 '10x hotels & cars (CapOne Travel), 5x flights, 2x everything',
 'Capital One ecosystem travelers',
 '$300 travel credit, 10k anniversary bonus miles'),

('capital-one-venture',       'Capital One Venture',
 ARRAY['venture'],
 2, 2, 2, 2, 2, 2, 2,
 '2x miles on every purchase',
 'Simple travel rewards',
 NULL),

('capital-one-quicksilver',   'Capital One Quicksilver',
 ARRAY['quicksilver'],
 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5,
 '1.5% cashback on everything',
 'Simple no-fuss rewards',
 NULL),

('citi-double-cash',          'Citi Double Cash',
 ARRAY['double cash'],
 2, 2, 2, 2, 2, 2, 2,
 '1% when you buy + 1% when you pay = 2% everywhere',
 'Everyday spending',
 NULL),

('citi-custom-cash',          'Citi Custom Cash',
 ARRAY['custom cash'],
 1, 1, 1, 1, 1, 1, 1,
 '5% on top eligible spend category each month (up to $500), 1% all else',
 'Flexible category maximizers',
 NULL),

('wells-fargo-active-cash',   'Wells Fargo Active Cash',
 ARRAY['active cash'],
 2, 2, 2, 2, 2, 2, 2,
 '2% cashback on all purchases',
 'Simple everyday use',
 NULL),

('wells-fargo-autograph',     'Wells Fargo Autograph',
 ARRAY['autograph'],
 3, 1, 3, 3, 3, 1, 1,
 '3x restaurants, gas, travel, transit, streaming, phone; 1x all else',
 'Diverse everyday categories',
 NULL),

('discover-it',               'Discover it',
 ARRAY['discover it','discover chrome'],
 1, 1, 1, 1, 1, 1, 1,
 '5% rotating quarterly categories (up to $1,500/quarter), 1% all else',
 'Category maximizers',
 'Cashback Match first year'),

('apple-card',                'Apple Card',
 ARRAY['apple card'],
 2, 1, 1, 1, 1, 1, 1,
 '3% Apple purchases, 2% Apple Pay, 1% all else (physical card)',
 'Heavy Apple Pay users',
 NULL),

('amazon-prime-visa',         'Amazon Prime Visa',
 ARRAY['amazon prime','prime visa','prime rewards'],
 2, 1, 1, 2, 1, 5, 1,
 '5% Amazon & Whole Foods, 2% dining, gas & drugstores, 1% all else',
 'Amazon Prime members',
 NULL),

('marriott-bonvoy',           'Marriott Bonvoy',
 ARRAY['marriott','bonvoy'],
 3, 1, 2, 3, 1, 1, 2,
 '6x Marriott Bonvoy, 3x dining & gas, 2x all else',
 'Marriott hotel loyalists',
 NULL),

('hilton-honors',             'Hilton Honors',
 ARRAY['hilton honors','hilton surpass','hilton aspire'],
 5, 5, 3, 3, 1, 1, 3,
 '7x Hilton, 5x dining, 5x groceries, 3x gas, 3x all else',
 'Hilton hotel loyalists',
 NULL),

('bank-of-america-customized-cash', 'BofA Customized Cash Rewards',
 ARRAY['customized cash','bofa cash','bank of america cash'],
 2, 2, 1, 3, 1, 1, 1,
 '3% chosen category, 2% groceries & wholesale clubs (up to $2,500/quarter), 1% all else',
 'BofA Preferred Rewards members',
 NULL),

('chase-ink-business-preferred', 'Chase Ink Business Preferred',
 ARRAY['ink business preferred','ink preferred'],
 1, 1, 3, 1, 1, 1, 1,
 '3x travel, shipping, ads, internet/cable/phone (up to $150k/yr); 1x all else',
 'Business travelers',
 NULL),

('chase-ink-unlimited',       'Chase Ink Business Unlimited',
 ARRAY['ink unlimited','ink business unlimited'],
 1, 1, 1, 1, 1, 1, 1.5,
 '1.5% cashback on all purchases',
 'Simple business spending',
 NULL)

ON CONFLICT (card_key) DO NOTHING;
