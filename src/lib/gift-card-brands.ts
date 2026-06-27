// Preset catalog of prominent gift card brands. `domain` drives the auto-fetched
// logo (via logo.dev's public img endpoint) and `balanceCheckUrl` is the brand's
// official balance-check page — we link out to it rather than scraping it, since
// these pages are bot-protected and not meant for programmatic access.
export interface GiftCardBrand {
  name: string;
  domain: string;
  balanceCheckUrl: string;
  buyUrl: string;
}

export const GIFT_CARD_BRANDS: GiftCardBrand[] = [
  // ── Retail & big-box ──
  { name: "Amazon",            domain: "amazon.com",            balanceCheckUrl: "https://www.amazon.com/gc/balance",                    buyUrl: "https://www.amazon.com/gift-cards" },
  { name: "Target",            domain: "target.com",            balanceCheckUrl: "https://www.target.com/guest/egc-balance-check",       buyUrl: "https://www.target.com/c/gift-cards" },
  { name: "Walmart",           domain: "walmart.com",           balanceCheckUrl: "https://www.walmart.com/account/giftcard",             buyUrl: "https://www.walmart.com/cp/gift-cards" },
  { name: "Costco",            domain: "costco.com",            balanceCheckUrl: "https://www.costco.com/gift-cards.html",               buyUrl: "https://www.costco.com/gift-cards.html" },
  { name: "Best Buy",          domain: "bestbuy.com",           balanceCheckUrl: "https://www.bestbuy.com/giftcard/online/balancecheck", buyUrl: "https://www.bestbuy.com/site/gift-cards" },
  { name: "Home Depot",        domain: "homedepot.com",         balanceCheckUrl: "https://www.homedepot.com/c/gift_cards_check_balance", buyUrl: "https://www.homedepot.com/c/gift_cards" },
  { name: "Lowe's",            domain: "lowes.com",             balanceCheckUrl: "https://www.lowes.com/l/gift-cards.html",              buyUrl: "https://www.lowes.com/l/gift-cards.html" },
  { name: "Macy's",            domain: "macys.com",             balanceCheckUrl: "https://www.macys.com/giftcardbalance",                buyUrl: "https://www.macys.com/shop/gift-cards" },
  { name: "Kohl's",            domain: "kohls.com",             balanceCheckUrl: "https://www.kohls.com/feature/giftcards.shtml",        buyUrl: "https://www.kohls.com/feature/giftcards.shtml" },
  { name: "Nordstrom",         domain: "nordstrom.com",         balanceCheckUrl: "https://www.nordstrom.com/gift-cards",                 buyUrl: "https://www.nordstrom.com/gift-cards" },
  { name: "Old Navy",          domain: "oldnavy.gap.com",       balanceCheckUrl: "https://secure-oldnavy.gap.com/gift-cards/balance",     buyUrl: "https://oldnavy.gap.com/customerService/info.do?cid=1052792" },
  { name: "Gap",               domain: "gap.com",               balanceCheckUrl: "https://secure-gap.gap.com/gift-cards/balance",        buyUrl: "https://www.gap.com/customerService/info.do?cid=1052792" },
  { name: "TJ Maxx",           domain: "tjmaxx.tjx.com",        balanceCheckUrl: "https://www.tjmaxx.tjx.com/store/giftcards/index.jsp", buyUrl: "https://www.tjmaxx.tjx.com/store/giftcards/index.jsp" },
  { name: "IKEA",              domain: "ikea.com",              balanceCheckUrl: "https://www.ikea.com/us/en/customer-service/gift-card/", buyUrl: "https://www.ikea.com/us/en/customer-service/gift-card/" },
  { name: "Whole Foods",       domain: "wholefoodsmarket.com",  balanceCheckUrl: "https://www.wholefoodsmarket.com/gift-cards",          buyUrl: "https://www.wholefoodsmarket.com/gift-cards" },
  { name: "CVS",                domain: "cvs.com",               balanceCheckUrl: "https://www.cvs.com/gift-cards",                       buyUrl: "https://www.cvs.com/gift-cards" },
  { name: "Walgreens",         domain: "walgreens.com",         balanceCheckUrl: "https://www.walgreens.com/giftcards/default.jsp",      buyUrl: "https://www.walgreens.com/giftcards/default.jsp" },
  { name: "REI",                domain: "rei.com",               balanceCheckUrl: "https://www.rei.com/gift-cards",                       buyUrl: "https://www.rei.com/gift-cards" },
  { name: "GameStop",          domain: "gamestop.com",          balanceCheckUrl: "https://www.gamestop.com/gift-cards",                  buyUrl: "https://www.gamestop.com/gift-cards" },
  { name: "Barnes & Noble",    domain: "barnesandnoble.com",    balanceCheckUrl: "https://www.barnesandnoble.com/h/gift-cards",          buyUrl: "https://www.barnesandnoble.com/h/gift-cards" },

  // ── Coffee, food & dining ──
  { name: "Starbucks",         domain: "starbucks.com",         balanceCheckUrl: "https://www.starbucks.com/account/egiftcardbalance",  buyUrl: "https://www.starbucks.com/gift" },
  { name: "Dunkin'",           domain: "dunkindonuts.com",      balanceCheckUrl: "https://www.dunkindonuts.com/en/dd-perks/dd-card/check-card-balance", buyUrl: "https://www.dunkindonuts.com/en/dd-perks/dd-card" },
  { name: "Chipotle",          domain: "chipotle.com",          balanceCheckUrl: "https://www.chipotle.com/gift-cards/balance",         buyUrl: "https://www.chipotle.com/gift-cards" },
  { name: "Subway",            domain: "subway.com",            balanceCheckUrl: "https://www.subway.com/en-us/gift-cards",             buyUrl: "https://www.subway.com/en-us/gift-cards" },
  { name: "McDonald's",        domain: "mcdonalds.com",         balanceCheckUrl: "https://www.mcdonalds.com/us/en-us/gift-cards.html",  buyUrl: "https://www.mcdonalds.com/us/en-us/gift-cards.html" },
  { name: "Panera Bread",      domain: "panerabread.com",       balanceCheckUrl: "https://panerabread.wgiftcard.com/rbc/panerabread", buyUrl: "https://www.panerabread.com/en-us/giftcards.html" },
  { name: "Domino's",          domain: "dominos.com",           balanceCheckUrl: "https://www.dominos.com/en/pages/giftcards/",         buyUrl: "https://www.dominos.com/en/pages/giftcards/" },
  { name: "Olive Garden",      domain: "olivegarden.com",       balanceCheckUrl: "https://www.olivegarden.com/giftcards",                buyUrl: "https://www.olivegarden.com/giftcards" },
  { name: "Cheesecake Factory",domain: "thecheesecakefactory.com", balanceCheckUrl: "https://www.thecheesecakefactory.com/gift-cards/", buyUrl: "https://www.thecheesecakefactory.com/gift-cards/" },
  { name: "Texas Roadhouse",   domain: "texasroadhouse.com",    balanceCheckUrl: "https://www.texasroadhouse.com/gift-cards",           buyUrl: "https://www.texasroadhouse.com/gift-cards" },

  // ── Tech, gaming & entertainment ──
  { name: "Apple / iTunes",    domain: "apple.com",             balanceCheckUrl: "https://checkcardbalance.itunes.apple.com",           buyUrl: "https://www.apple.com/shop/gift-cards" },
  { name: "Google Play",       domain: "play.google.com",       balanceCheckUrl: "https://play.google.com/store/account",                buyUrl: "https://play.google.com/store/giftcards" },
  { name: "Steam",             domain: "steampowered.com",      balanceCheckUrl: "https://store.steampowered.com/account/",              buyUrl: "https://store.steampowered.com/digitalgiftcards" },
  { name: "PlayStation",       domain: "playstation.com",       balanceCheckUrl: "https://store.playstation.com/wallet",                 buyUrl: "https://www.playstation.com/en-us/gift-cards/" },
  { name: "Xbox",              domain: "xbox.com",              balanceCheckUrl: "https://www.xbox.com/en-us/redeem",                    buyUrl: "https://www.xbox.com/en-us/gift-cards" },
  { name: "Nintendo eShop",    domain: "nintendo.com",          balanceCheckUrl: "https://ec.nintendo.com/redeem",                       buyUrl: "https://www.nintendo.com/us/gift-cards/" },
  { name: "Spotify",           domain: "spotify.com",           balanceCheckUrl: "https://www.spotify.com/redeem/",                      buyUrl: "https://www.spotify.com/us/gift-card/" },
  { name: "Netflix",           domain: "netflix.com",           balanceCheckUrl: "https://www.netflix.com/redeem",                       buyUrl: "https://www.netflix.com/gift-cards" },
  { name: "Disney+",           domain: "disneyplus.com",        balanceCheckUrl: "https://www.disneyplus.com/redeem",                    buyUrl: "https://www.disneyplus.com/gift-cards" },
  { name: "Roblox",            domain: "roblox.com",            balanceCheckUrl: "https://www.roblox.com/redeem",                        buyUrl: "https://www.roblox.com/giftcards" },
  { name: "Discord Nitro",     domain: "discord.com",           balanceCheckUrl: "https://discord.com/gifting",                          buyUrl: "https://discord.com/gifting" },

  // ── Beauty, apparel & lifestyle ──
  { name: "Sephora",           domain: "sephora.com",           balanceCheckUrl: "https://www.sephora.com/gift-card-balance",            buyUrl: "https://www.sephora.com/gift-cards" },
  { name: "Ulta Beauty",       domain: "ulta.com",              balanceCheckUrl: "https://www.ulta.com/gift-cards",                       buyUrl: "https://www.ulta.com/gift-cards" },
  { name: "Nike",              domain: "nike.com",              balanceCheckUrl: "https://www.nike.com/help/a/gift-cards",                buyUrl: "https://www.nike.com/gift-cards" },
  { name: "Adidas",            domain: "adidas.com",            balanceCheckUrl: "https://www.adidas.com/us/gift_cards.html",            buyUrl: "https://www.adidas.com/us/gift_cards.html" },
  { name: "Lululemon",         domain: "lululemon.com",         balanceCheckUrl: "https://shop.lululemon.com/giftcardbalance",            buyUrl: "https://shop.lululemon.com/c/gift-cards" },
  { name: "Bath & Body Works", domain: "bathandbodyworks.com",  balanceCheckUrl: "https://www.bathandbodyworks.com/gift-cards",          buyUrl: "https://www.bathandbodyworks.com/gift-cards" },
  { name: "Etsy",              domain: "etsy.com",              balanceCheckUrl: "https://www.etsy.com/giftcards/redeem",                buyUrl: "https://www.etsy.com/gift-cards" },

  // ── Travel, rideshare & delivery ──
  { name: "Uber / Uber Eats",  domain: "uber.com",              balanceCheckUrl: "https://www.uber.com/us/en/giftcards/balance/",        buyUrl: "https://www.uber.com/us/en/gift-cards/" },
  { name: "DoorDash",          domain: "doordash.com",          balanceCheckUrl: "https://www.doordash.com/giftcard/balance",            buyUrl: "https://www.doordash.com/gift-cards" },
  { name: "Airbnb",            domain: "airbnb.com",            balanceCheckUrl: "https://www.airbnb.com/help/article/1387",             buyUrl: "https://www.airbnb.com/gift-cards" },
  { name: "Marriott",          domain: "marriott.com",          balanceCheckUrl: "https://www.marriott.com/giftcards/balance.mi",        buyUrl: "https://www.marriott.com/gift-cards.mi" },
  { name: "Hilton",             domain: "hilton.com",            balanceCheckUrl: "https://www.hilton.com/en/gift-cards/",                buyUrl: "https://www.hilton.com/en/gift-cards/" },
  { name: "Southwest",         domain: "southwest.com",         balanceCheckUrl: "https://www.southwest.com/giftcard/balance",          buyUrl: "https://www.southwest.com/giftcard/" },
  { name: "Delta",             domain: "delta.com",             balanceCheckUrl: "https://www.delta.com/us/en/gift-cards/check-balance", buyUrl: "https://www.delta.com/us/en/gift-cards" },
  { name: "United Airlines",   domain: "united.com",            balanceCheckUrl: "https://www.united.com/en/us/giftcards",               buyUrl: "https://www.united.com/en/us/giftcards" },

  // ── Open-loop prepaid ──
  { name: "Visa Gift Card",          domain: "visa.com",             balanceCheckUrl: "https://www.myvisagift.com",                                                buyUrl: "https://www.visa.com/gift-cards" },
  { name: "Mastercard Gift Card",    domain: "mastercard.com",       balanceCheckUrl: "https://www.mastercardgiftcard.com",                                        buyUrl: "https://www.mastercard.us/en-us/personal/get-support/gift-cards.html" },
  { name: "American Express Gift Card", domain: "americanexpress.com", balanceCheckUrl: "https://www.americanexpress.com/en-us/gift-cards/check-balance/",        buyUrl: "https://www.americanexpress.com/en-us/gift-cards/" },
];

/** Best-effort logo via logo.dev's public, keyless img endpoint. Falls back to a generated initial-letter avatar if the image 404s (handled in the UI). */
export const logoUrlForDomain = (domain: string) =>
  `https://img.logo.dev/${domain}?size=80&fallback=404`;

export const lookupBrandByDomain = (domain: string) =>
  GIFT_CARD_BRANDS.find(b => b.domain.toLowerCase() === domain.toLowerCase());

export interface BrandSuggestion {
  name: string;
  domain: string;
  logo: string;
}

/**
 * Look up a company by name and get back its domain + logo — the "search for
 * any brand" path for cards not in our curated list. Backed by Clearbit's free,
 * keyless company-autocomplete endpoint (the same kind of company-name → logo
 * lookup a Google search would surface, without needing a Search API key).
 */
export const searchBrands = async (query: string, signal?: AbortSignal): Promise<BrandSuggestion[]> => {
  const q = query.trim();
  if (q.length < 2) return [];
  const res = await fetch(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) return [];
  const json = (await res.json()) as { name: string; domain: string; logo: string }[];
  return json.slice(0, 8);
};

/** Deterministic brand-color gradient so cards without a strong logo color still look distinct. */
export const brandGradient = (seed: string): string => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `linear-gradient(135deg, hsl(${hue} 55% 22%) 0%, hsl(${(hue + 40) % 360} 60% 14%) 100%)`;
};
