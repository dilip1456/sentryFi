// Pure helpers for the Benefits page (CardBenefitsView). Kept free of React
// and Supabase so the cleanup / dedupe / count logic is unit-testable.
//
// The benefit rows come from an LLM (fetch-card-benefits edge function), so
// every field is treated as untrusted: strings may literally be "null", the
// same perk can arrive under several keys/wordings, and dollar values can be
// "$0". Everything the UI renders goes through these helpers.

export interface RawBenefit {
  key: string;
  title?: string | null;
  description?: string | null;
  value?: string | number | null;
  period?: string | null;
  action_type?: string | null;
  action_label?: string | null;
  cashback_category?: string | null;
  cashback_rate?: number | string | null;
  priority?: number | null;
  used_at?: string | null;
}

export interface Benefit {
  /** Primary benefit_key (first of `keys`). */
  key: string;
  /** Every DB benefit_key merged into this entry, so mark-done hits all duplicates. */
  keys: string[];
  title: string;
  description: string;
  /** Display-ready value, or "" when there is nothing meaningful to show. */
  value: string;
  period: string;
  action_type: string | null;
  action_label: string | null;
  cashback_category: string | null;
  cashback_rate: number | null;
  priority: number;
  used_at: string | null;
}

export interface CardBenefits {
  account_id: string;
  name: string;
  official_name: string;
  benefits: Benefit[];
}

const EMPTY_TOKENS = new Set(["null", "undefined", "none", "n/a", "na", "nan", "-", "--", "—", "[]", "{}"]);

/** Never let "null"/"undefined" (or real null) leak into the UI. */
export const cleanText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  let s = String(v).trim();
  if (EMPTY_TOKENS.has(s.toLowerCase())) return "";
  // Trailing " · null", ": undefined", "(null)" fragments from string concatenation upstream.
  s = s.replace(/\s*[·|,:\-–]\s*(null|undefined)\s*$/i, "").replace(/\s*\((null|undefined)\)\s*$/i, "").trim();
  return EMPTY_TOKENS.has(s.toLowerCase()) ? "" : s;
};

/** Display value for a perk; "" for missing or zero-dollar values so the badge is hidden. */
export const displayValue = (v: unknown): string => {
  const s = cleanText(v);
  if (!s) return "";
  // "$0", "0", "$0.00", "$0/year", "$0 per year", "0 value"
  if (/^\$?\s*0+(\.0+)?\b/.test(s) && !/^\$?\s*0+(\.0+)?\s*%/.test(s)) {
    const rest = s.replace(/^\$?\s*0+(\.0+)?/, "").trim();
    if (!rest || /^(\/|per\b|a\b|each\b|value\b|annual|yearly|monthly)/i.test(rest)) return "";
  }
  return s;
};

const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const STOPWORDS = new Set([
  "apply", "applied", "use", "using", "activate", "activation", "register", "registration",
  "enroll", "enrollment", "claim", "get", "redeem", "earn", "your", "the", "a", "an", "for",
  "to", "of", "on", "with", "and", "in", "at", "via", "annual", "annually", "yearly", "year",
  "per", "membership", "member", "benefit", "benefits", "perk", "perks", "complimentary",
  "free", "access", "statement", "up",
]);

const SINGULAR: Record<string, string> = {
  credits: "credit", lounges: "lounge", miles: "mile", points: "point", hotels: "hotel",
  flights: "flight", rentals: "rental", purchases: "purchase",
};

/** Token list for a benefit name with verbs/filler removed: "Apply $300 travel credit" → ["300","travel","credit"]. */
export const benefitTokens = (name: unknown): string[] => {
  const s = cleanText(name).toLowerCase()
    .replace(/&/g, " and ")
    .replace(/(\d),(\d)/g, "$1$2")
    .replace(/[^a-z0-9]+/g, " ");
  const out: string[] = [];
  for (const raw of s.split(" ")) {
    if (!raw || STOPWORDS.has(raw)) continue;
    const t = SINGULAR[raw] ?? raw;
    if (!out.includes(t)) out.push(t);
  }
  return out;
};

/** Canonical comparison key (order-insensitive). */
export const normalizeBenefitName = (name: unknown): string => [...benefitTokens(name)].sort().join(" ");

const isSubset = (a: string[], b: string[]) => a.every(t => b.includes(t));

/**
 * Two names describe the same perk if their normalized keys match, or one
 * name's tokens (at least 2 of them) are fully contained in the other's —
 * "Use Global Entry credit" vs "Global Entry / TSA PreCheck credit".
 */
export const sameBenefitName = (a: unknown, b: unknown): boolean => {
  const ta = benefitTokens(a), tb = benefitTokens(b);
  if (!ta.length || !tb.length) return false;
  if (normalizeBenefitName(a) === normalizeBenefitName(b)) return true;
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return small.length >= 2 && isSubset(small, big);
};

export const benefitsMatch = (
  a: { key?: string; title?: unknown; action_label?: unknown },
  b: { key?: string; title?: unknown; action_label?: unknown },
): boolean => {
  if (a.key && b.key && a.key === b.key) return true;
  if (sameBenefitName(a.title, b.title)) return true;
  // Title-vs-action-label catches "Apply $300 travel credit" (an action
  // label) vs "$300 Annual Travel Credit" (a title). Labels are never
  // compared to each other, and cross matches need 2+ meaningful tokens so a
  // generic label like "Activate now" can't glue unrelated perks together.
  const cross = (title: unknown, label: unknown) =>
    benefitTokens(label).length >= 2 && benefitTokens(title).length >= 2 && sameBenefitName(title, label);
  return cross(a.title, b.action_label) || cross(b.title, a.action_label);
};

const ACTION_TYPES = new Set(["register", "activate", "use_credit", "subscribe", "link", "none"]);

/** Normalize one raw DB / edge-function row into a render-safe Benefit. */
export const toBenefit = (r: RawBenefit): Benefit => {
  const actionType = cleanText(r.action_type).toLowerCase();
  const title = cleanText(r.title) || cleanText(r.action_label) || "Card perk";
  return {
    key: r.key,
    keys: [r.key],
    title,
    description: cleanText(r.description),
    value: displayValue(r.value),
    period: cleanText(r.period),
    action_type: ACTION_TYPES.has(actionType) ? actionType : null,
    action_label: cleanText(r.action_label) || null,
    cashback_category: cleanText(r.cashback_category) || null,
    cashback_rate: toNumber(r.cashback_rate),
    priority: Number.isFinite(Number(r.priority)) && r.priority !== null ? Number(r.priority) : 5,
    used_at: cleanText(r.used_at) || null,
  };
};

const better = <T,>(a: T | null | undefined, b: T | null | undefined) => (a ?? b ?? null);

const merge = (a: Benefit, b: Benefit): Benefit => {
  const aAction = !!a.action_type && a.action_type !== "none";
  const bAction = !!b.action_type && b.action_type !== "none";
  // Prefer the more actionable / more descriptive row as the base.
  const base = (bAction && !aAction) || (aAction === bAction && b.description.length > a.description.length) ? b : a;
  const other = base === a ? b : a;
  return {
    ...base,
    keys: [...new Set([...base.keys, ...other.keys])],
    value: base.value || other.value,
    description: base.description || other.description,
    period: base.period || other.period,
    action_type: better(base.action_type, other.action_type),
    action_label: better(base.action_label, other.action_label),
    cashback_category: better(base.cashback_category, other.cashback_category),
    cashback_rate: base.cashback_rate != null && other.cashback_rate != null
      ? Math.max(base.cashback_rate, other.cashback_rate)
      : better(base.cashback_rate, other.cashback_rate),
    priority: Math.min(base.priority, other.priority),
    // A perk counts as done if any of its duplicate rows was marked done.
    used_at: base.used_at ?? other.used_at,
  };
};

/** Collapse duplicate perks for ONE card, sorted by priority. */
export const dedupeBenefits = (rows: (RawBenefit | Benefit)[]): Benefit[] => {
  const out: Benefit[] = [];
  for (const r of rows) {
    const b = "keys" in r ? r : toBenefit(r);
    const i = out.findIndex(x => benefitsMatch(x, b));
    if (i >= 0) out[i] = merge(out[i], b);
    else out.push(b);
  }
  return out.sort((a, b) => a.priority - b.priority);
};

export const isActionable = (b: Benefit) => !!b.action_type && b.action_type !== "none";

export interface BenefitSummary {
  totalPerks: number;
  completed: number;
  /** Actionable perks not yet done. */
  pendingActions: number;
  perCard: Record<string, { total: number; completed: number; pending: number }>;
}

/** Single source of truth for every count shown on the Benefits page. */
export const summarizeBenefits = (cards: CardBenefits[]): BenefitSummary => {
  const perCard: BenefitSummary["perCard"] = {};
  let totalPerks = 0, completed = 0, pendingActions = 0;
  for (const c of cards) {
    const total = c.benefits.length;
    const done = c.benefits.filter(b => !!b.used_at).length;
    const pending = c.benefits.filter(b => !b.used_at && isActionable(b)).length;
    perCard[c.account_id] = { total, completed: done, pending };
    totalPerks += total; completed += done; pendingActions += pending;
  }
  return { totalPerks, completed, pendingActions, perCard };
};

// ── Reward units ─────────────────────────────────────────────────────────

export type RewardUnit = "cash" | "miles" | "points";

/** Infer how a card's rewards are denominated from its product name. */
export const rewardUnitForCard = (name: unknown): RewardUnit => {
  const n = cleanText(name).toLowerCase();
  if (/venture|\bmiles?\b|skymiles|aadvantage|mileageplus|united|delta|southwest|jetblue|alaska air|hawaiian|frontier|spirit|aeroplan|avios/.test(n)) return "miles";
  if (/sapphire|\bink\b|amex gold|american express gold|\bgold card\b|platinum card|\bgreen card\b|strata|citi premier|thankyou|altitude|bonvoy|marriott|hilton|hyatt|\bihg\b|travel rewards|premium rewards|membership rewards|everyday preferred/.test(n)) return "points";
  return "cash";
};

/** "2% back" for cash cards, "2x miles" / "3x points" otherwise. */
export const formatRewardRate = (rate: number | null | undefined, unit: RewardUnit): string => {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "—";
  if (rate === 0) return "No rewards";
  const r = Number.isInteger(rate) ? String(rate) : rate.toFixed(1).replace(/\.0$/, "");
  return unit === "cash" ? `${r}% back` : `${r}x ${unit}`;
};

// ── Spend optimizer ──────────────────────────────────────────────────────

export type SpendBucket = "dining" | "groceries" | "travel" | "gas" | "streaming" | "online_shopping" | "everything" | "portal";

export const SPEND_BUCKET_LABEL: Record<SpendBucket, string> = {
  dining: "Dining", groceries: "Groceries", travel: "Travel", gas: "Gas",
  streaming: "Streaming", online_shopping: "Online shopping", everything: "Everything else", portal: "Issuer travel portal",
};

/** Map an LLM cashback_category string to a bucket. Portal-only rates are kept separate so "10x on Capital One Travel" doesn't look like a general travel rate. */
export const bucketForRewardCategory = (cat: unknown): SpendBucket | null => {
  const c = cleanText(cat).toLowerCase();
  if (!c) return null;
  if (/portal|capital one travel|chase travel|amex travel|ultimate rewards|through .*travel|booked (through|via)/.test(c)) return "portal";
  if (/dining|restaurant|food and drink|takeout|delivery/.test(c)) return "dining";
  if (/grocer|supermarket/.test(c)) return "groceries";
  if (/\bgas\b|fuel|gas station|ev charging/.test(c)) return "gas";
  if (/stream/.test(c)) return "streaming";
  if (/online|amazon/.test(c)) return "online_shopping";
  if (/travel|airline|flight|hotel|car rental|transit/.test(c)) return "travel";
  if (/every|all purchase|other|general|base|anything/.test(c)) return "everything";
  return null;
};

/** Map a Plaid transaction category array to a bucket. */
export const bucketForTxnCategory = (category: string[] | null | undefined): SpendBucket => {
  const c = (category ?? []).join(" ").toLowerCase();
  if (/supermarket|grocer/.test(c)) return "groceries";
  if (/gas station|fuel/.test(c)) return "gas";
  if (/restaurant|food and drink|coffee|fast food/.test(c)) return "dining";
  if (/stream|subscription.*(video|music)/.test(c)) return "streaming";
  if (/travel|airline|hotel|lodging|car service|rental car|taxi/.test(c)) return "travel";
  if (/digital purchase|online marketplace/.test(c)) return "online_shopping";
  return "everything";
};

export interface SpendSuggestion {
  category: string;
  monthly_avg: number;
  current_card_name: string;
  current_rate_label: string;
  best_card: string;
  best_card_name: string;
  best_rate_label: string;
  annual_gain: number;
}

interface Txn { account_id: string; amount: number; date: string; category: string[] | null }
interface Acct { account_id: string; name: string; official_name?: string | null; type: string }

/**
 * Compare where the user actually spends (last 90 days) to the best card they
 * own for that category. The "current" card is the account with the most
 * spend in that bucket, named from the account list (never "Unknown card").
 * Miles/points are valued at ~1¢ each for the gain estimate.
 */
export const buildSpendSuggestions = (
  cards: CardBenefits[], txns: Txn[], accounts: Acct[], now = Date.now(),
): SpendSuggestion[] => {
  if (!txns.length || !cards.length) return [];
  const cutoff = new Date(now - 90 * 86400000).toISOString().slice(0, 10);
  const acctById = new Map(accounts.map(a => [a.account_id, a]));

  const rates = new Map<string, Partial<Record<SpendBucket, number>>>();
  for (const c of cards) {
    const r: Partial<Record<SpendBucket, number>> = {};
    for (const b of c.benefits) {
      const bucket = bucketForRewardCategory(b.cashback_category);
      if (!bucket || bucket === "portal" || !b.cashback_rate) continue;
      r[bucket] = Math.max(r[bucket] ?? 0, b.cashback_rate);
    }
    if (Object.keys(r).length) rates.set(c.account_id, r);
  }
  if (!rates.size) return [];
  const rateFor = (accountId: string, bucket: SpendBucket): number | null => {
    const r = rates.get(accountId);
    if (r) return r[bucket] ?? r.everything ?? 1;
    const a = acctById.get(accountId);
    if (a?.type === "credit") return 1; // credit card with no known rates: assume base 1x/1%
    return 0; // debit / checking: no rewards
  };

  const spend = new Map<SpendBucket, Map<string, number>>();
  for (const t of txns) {
    if (!(t.amount > 0) || t.date < cutoff) continue;
    const bucket = bucketForTxnCategory(t.category);
    const m = spend.get(bucket) ?? new Map<string, number>();
    m.set(t.account_id, (m.get(t.account_id) ?? 0) + Number(t.amount));
    spend.set(bucket, m);
  }

  const cardName = (id: string) => {
    const c = cards.find(x => x.account_id === id);
    const a = acctById.get(id);
    return cleanText(c?.official_name) || cleanText(c?.name) || cleanText(a?.official_name) || cleanText(a?.name) || "Other account";
  };

  const out: SpendSuggestion[] = [];
  for (const [bucket, byAcct] of spend) {
    const total = [...byAcct.values()].reduce((s, v) => s + v, 0);
    const monthly = total / 3;
    if (monthly < 20) continue;
    const [currentId] = [...byAcct.entries()].sort((a, b) => b[1] - a[1])[0];
    const currentRate = rateFor(currentId, bucket) ?? 0;
    let best: { id: string; rate: number } | null = null;
    for (const id of rates.keys()) {
      const r = rateFor(id, bucket) ?? 0;
      if (!best || r > best.rate) best = { id, rate: r };
    }
    if (!best || best.id === currentId || best.rate <= currentRate) continue;
    const gain = monthly * 12 * ((best.rate - currentRate) / 100);
    if (gain < 10) continue;
    const curName = cardName(currentId);
    const curAcct = acctById.get(currentId);
    out.push({
      category: SPEND_BUCKET_LABEL[bucket],
      monthly_avg: monthly,
      current_card_name: curName,
      current_rate_label: curAcct && curAcct.type !== "credit" && !rates.has(currentId)
        ? "No rewards"
        : formatRewardRate(currentRate, rewardUnitForCard(curName)),
      best_card: best.id,
      best_card_name: cardName(best.id),
      best_rate_label: formatRewardRate(best.rate, rewardUnitForCard(cardName(best.id))),
      annual_gain: gain,
    });
  }
  return out.sort((a, b) => b.annual_gain - a.annual_gain);
};

/**
 * When re-fetching perks for a card, reuse the benefit_key of an existing row
 * that describes the same perk, so the upsert updates it (keeping used_at)
 * instead of inserting a near-duplicate under a new LLM-chosen key.
 * Returns the incoming rows with keys remapped, plus keys of existing unused
 * rows that are now redundant duplicates and can be removed.
 */
export const reconcileFetched = (
  existing: RawBenefit[], incoming: RawBenefit[],
): { rows: RawBenefit[]; redundantKeys: string[] } => {
  const claimed = new Set<string>();
  const rows: RawBenefit[] = [];
  for (const inc of incoming) {
    if (!cleanText(inc.title) && !cleanText(inc.action_label)) continue;
    const match = existing.find(e => !claimed.has(e.key) && benefitsMatch(e, inc));
    const key = match ? match.key : inc.key;
    if (rows.some(r => r.key === key || benefitsMatch(r, inc))) continue; // dup inside the fetch itself
    if (match) claimed.add(match.key);
    rows.push({ ...inc, key });
  }
  const redundantKeys = existing
    .filter(e => !claimed.has(e.key) && !e.used_at && rows.some(r => benefitsMatch(r, e)))
    .map(e => e.key);
  return { rows, redundantKeys };
};
