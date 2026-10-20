import {
  classifyOne, typeForCategory, isSpendingType, isIncomeType,
  CREDIT_CARD_PAYMENT_CATEGORY, SAVINGS_CATEGORY, INTERNAL_TRANSFER_CATEGORY,
  type Classification, type ClassifierTxn, type TxnType,
} from "./classify/index.ts";

/**
 * Pure helpers behind the Spending page's overview (hero, pace, daily chart,
 * review flags). Kept free of React so they're unit-testable and reusable by
 * both live Plaid data and the demo dataset.
 */

export interface InsightTxn {
  id: string;
  account_id: string;
  amount: number | string;
  date: string; // YYYY-MM-DD
  name: string | null;
  merchant_name: string | null;
  pending: boolean;
}

export type TxnFlag = "duplicate" | "transfer";

/** Lower-cased, punctuation/number-stripped merchant key ("STARBUCKS #1234" → "starbucks"). */
export const normalizeMerchant = (s: string | null | undefined): string =>
  (s ?? "")
    .toLowerCase()
    .replace(/[#*].*$/, "")
    .replace(/\b(des|id|indn|co id|ppd|web|ach)\b.*$/, "")
    .replace(/[^a-z&+ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Statement text that usually means money moved between the user's own
// accounts (brokerage funding, P2P to self, savings sweeps) rather than real
// spend. Only a hint: it's surfaced as a "Transfer?" chip for the user to
// confirm, never used to silently exclude anything from totals.
const TRANSFER_HINTS = [
  "transfer", "xfer", "robinhood", "fidelity", "vanguard", "schwab", "e*trade", "etrade", "wealthfront",
  "betterment", "coinbase", "acorns", "brokerage", "investment", "savings", "zelle to", "payment thank you",
  "autopay", "online pymt", "credit card pmt",
];

export const looksLikeTransfer = (name: string | null, merchant: string | null): boolean => {
  const s = `${name ?? ""} ${merchant ?? ""}`.toLowerCase();
  return TRANSFER_HINTS.some(h => s.includes(h));
};

const dayNum = (iso: string) => Math.floor(new Date(iso + "T00:00:00Z").getTime() / 86400000);

/**
 * Flags expense transactions worth a second look:
 *  - "duplicate": same account, same amount, same normalized merchant within
 *    `windowDays` of an earlier charge (the later one is flagged). Pending →
 *    posted pairs with identical ids are naturally excluded.
 *  - "transfer": statement text looks like an account-to-account move but it
 *    wasn't paired as an internal transfer, so it's counted as spend.
 */
export function detectTxnFlags<T extends InsightTxn>(
  txns: T[],
  opts: {
    isExpense: (t: T) => boolean;
    label: (t: T) => string;
    excludeIds?: Set<string>;
    windowDays?: number;
  },
): Map<string, TxnFlag> {
  const windowDays = opts.windowDays ?? 3;
  const out = new Map<string, TxnFlag>();
  const candidates = txns
    .filter(t => !opts.excludeIds?.has(t.id) && opts.isExpense(t) && Number(t.amount) > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const seen = new Map<string, number[]>(); // key → day numbers
  for (const t of candidates) {
    if (looksLikeTransfer(t.name, t.merchant_name)) { out.set(t.id, "transfer"); continue; }
    const key = `${t.account_id}|${Math.round(Number(t.amount) * 100)}|${normalizeMerchant(opts.label(t))}`;
    const dn = dayNum(t.date);
    const prev = seen.get(key);
    if (prev && prev.some(p => dn - p <= windowDays)) out.set(t.id, "duplicate");
    seen.set(key, [...(prev ?? []), dn]);
  }
  return out;
}

/** Straight-line projection of month-end spend from month-to-date spend. */
export const projectMonthEnd = (spentToDate: number, dayOfMonth: number, daysInMonth: number): number =>
  dayOfMonth <= 0 ? spentToDate : (spentToDate / dayOfMonth) * daysInMonth;

/** Per-day totals (index 0 = day 1) for one calendar month. */
export function dailyTotals<T extends InsightTxn>(txns: T[], year: number, monthIdx: number): number[] {
  const days = new Date(year, monthIdx + 1, 0).getDate();
  const out = new Array(days).fill(0);
  const prefix = `${year}-${String(monthIdx + 1).padStart(2, "0")}-`;
  for (const t of txns) {
    if (!t.date.startsWith(prefix)) continue;
    const d = Number(t.date.slice(8, 10));
    if (d >= 1 && d <= days) out[d - 1] += Number(t.amount);
  }
  return out;
}

export const cumulative = (arr: number[]): number[] => {
  let s = 0;
  return arr.map(v => (s += v));
};

/** One consistent short date format across the Spending page: "Oct 18" (adds the year when it isn't this year). */
export const fmtShortDate = (iso: string, now: Date = new Date()): string => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", d.getFullYear() === now.getFullYear()
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" });
};

/** Day-group heading in the same family: "Sun, Oct 18". */
export const fmtDayHeading = (iso: string, now: Date = new Date()): string => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", d.getFullYear() === now.getFullYear()
    ? { weekday: "short", month: "short", day: "numeric" }
    : { weekday: "short", month: "short", day: "numeric", year: "numeric" });
};

/** "hsl(155 18% 42%)" → "hsl(155 18% 42% / 0.15)"; hex/other colors are returned as-is with no alpha. */
export const withAlpha = (color: string, alpha: number): string => {
  const m = color.match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/);
  if (m) return `hsl(${m[1]} ${m[2]}% ${m[3]}% / ${alpha})`;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color + Math.round(alpha * 255).toString(16).padStart(2, "0");
  return color;
};

/** Lifts the app's deliberately muted category palette enough to read on a dark chart. */
export const vivid = (color: string, dS = 16, dL = 14): string => {
  const m = color.match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/);
  if (!m) return color;
  return `hsl(${m[1]} ${Math.min(100, Number(m[2]) + dS)}% ${Math.min(90, Number(m[3]) + dL)}%)`;
};

// ── Transaction classification ──────────────────────────────────────────────
// Delegates to the shared classifier in src/lib/classify/ (PR #7), so the
// Spending page uses exactly the same definitions as Home, Budget and Money
// Map. classifyTxn() stays the single seam the UI calls.
//   spending = spend, refund, obligation_*   (bucketOf → "spending")
//   income   = income_*                      (bucketOf → "income")
//   reported separately = credit_card_payment, savings_contribution,
//   transfer_internal ("ignored") and unmatched transfer_in/out ("neutral").
export type TxnClass = TxnType;

/** Classes that count toward spending totals (refunds net them down). */
export const countsAsSpend = (c: TxnClass): boolean => isSpendingType(c);
export const isIncomeClass = (c: TxnClass): boolean => isIncomeType(c);

/**
 * How a transaction counts. Prefer the classification the dashboard already
 * computed for every transaction (classifyAll: pairs, overrides, rules,
 * Plaid PFC); without one, run the shared single-transaction classifier with
 * the effective category as the stored category.
 */
export function classifyTxn(
  t: ClassifierTxn,
  opts: {
    category: string;
    classification?: Classification | null;
    /** Already known to be an internal transfer (legacy pairing). */
    internal?: boolean;
    customCategories?: { name: string; type: "income" | "expense" }[];
  },
): TxnClass {
  if (opts.classification) return opts.classification.type;
  if (opts.internal) return "transfer_internal";
  return classifyOne(t, {
    customCategories: opts.customCategories,
    plaidCategory: () => opts.category,
  }).type;
}

/** Whether money out in this category counts as spending (budgetable view). */
export function categoryCountsAsSpend(cat: string, customCategories?: { name: string; type: "income" | "expense" }[]): boolean {
  const type = typeForCategory(cat, 1, customCategories);
  return type === null || isSpendingType(type);
}

// ── "Change type" menu options ──────────────────────────────────────────────
// Choosing one stores a per-transaction type override (txn_overrides, via
// the dashboard's "Counts as" machinery) when available; otherwise it falls
// back to the re-categorization in `category`, which typeForCategory maps
// back to the same type.
export const TXN_TYPES: { key: TxnClass; label: string; short: string; hint: string; category: string | null }[] = [
  { key: "spend", label: "Spending", short: "Spend", hint: "Counts toward spending & budgets", category: null },
  { key: "obligation_bill", label: "Bill", short: "Bill", hint: "Rent, utilities, phone, insurance; counted as spending", category: "Bills & Utilities" },
  { key: "obligation_loan", label: "Loan / mortgage", short: "Loan", hint: "Fixed obligation; counted as spending", category: "Loan Payment" },
  { key: "refund", label: "Refund", short: "Refund", hint: "Nets down spending", category: "Refund / Reimbursement" },
  { key: "income_other", label: "Income", short: "Income", hint: "Money earned or received", category: "Other Income" },
  { key: "credit_card_payment", label: "Credit card payment", short: "Card pmt", hint: "Paying a card; not spending", category: CREDIT_CARD_PAYMENT_CATEGORY },
  { key: "savings_contribution", label: "Savings & investing", short: "Savings", hint: "Savings/brokerage contribution; not spending", category: SAVINGS_CATEGORY },
  { key: "transfer_out", label: "Transfer out (to review)", short: "Xfer out", hint: "Unmatched transfer; not counted until reviewed", category: "Transfer Out" },
  { key: "transfer_in", label: "Transfer in (to review)", short: "Xfer in", hint: "Unmatched transfer; not counted as income", category: "Transfer In" },
  { key: "transfer_internal", label: "Internal transfer", short: "Internal", hint: "Between your own accounts; ignored", category: INTERNAL_TRANSFER_CATEGORY },
];

/** Menu entry for a class (income/obligation subtypes fold into the nearest option). */
export const txnTypeOption = (c: TxnClass) => {
  const exact = TXN_TYPES.find(x => x.key === c);
  if (exact) return exact;
  if (c === "income_salary") return { ...TXN_TYPES[4], key: c, label: "Salary", short: "Salary" };
  if (c === "income_interest") return { ...TXN_TYPES[4], key: c, label: "Interest / dividends", short: "Interest" };
  if (c === "obligation_tax") return { ...TXN_TYPES[1], key: c, label: "Tax", short: "Tax" };
  return TXN_TYPES[0];
};

