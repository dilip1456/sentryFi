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
// Type names mirror the shared classifier being built in src/lib/classify/;
// classifyTxn() is the single seam to swap for it later. Product rule: only
// spend-like classes count as spending (and are budgetable); card payments,
// savings contributions, transfers to/from people and internal transfers
// are reported separately and never budgeted.
export type TxnClass =
  | "spend" | "refund"
  | "income-salary" | "income-interest" | "income-other"
  | "transfer-internal" | "transfer-in" | "transfer-out"
  | "credit-card-payment" | "savings-contribution"
  | "obligation-loan" | "obligation-tax" | "obligation-bill";

/** Classes that count toward spending totals (refunds net them down). */
export const countsAsSpend = (c: TxnClass): boolean =>
  c === "spend" || c === "refund" || c.startsWith("obligation-");
export const isIncomeClass = (c: TxnClass): boolean => c.startsWith("income-");

const SAVINGS_CAT_RE = /savings|investment|brokerage|retirement|401k|\bira\b/i;
const TRANSFERISH_CATS = new Set(["transfer out", "transfer in", "transfer", "other", "uncategorized", ""]);
const SAVINGS_HINTS = ["robinhood", "fidelity", "vanguard", "schwab", "e*trade", "etrade", "wealthfront", "betterment", "acorns", "coinbase", "brokerage", "to sav", "savings"];
const P2P_HINTS = ["zelle", "venmo", "cash app", "cashapp", "paypal", "apple cash"];
const CARD_PAYMENT_HINTS = ["payment thank you", "autopay", "credit crd", "credit card pmt", "card payment"];

/** Minimal interim classifier; replace with the shared one from src/lib/classify/. */
export function classifyTxn(
  cat: string,
  t: Pick<InsightTxn, "name" | "merchant_name" | "amount">,
  opts: { internal: boolean; income: boolean },
): TxnClass {
  const c = cat.toLowerCase();
  if (opts.internal || c === "internal transfer") return "transfer-internal";
  if (c === "credit card payment") return "credit-card-payment";
  const text = `${t.name ?? ""} ${t.merchant_name ?? ""}`.toLowerCase();
  const transferish = TRANSFERISH_CATS.has(c);
  if (opts.income) {
    if (c === "transfer in" || (transferish && P2P_HINTS.some(h => text.includes(h)))) return "transfer-in";
    if (/salary|payroll|paycheck/.test(c)) return "income-salary";
    if (/interest|dividend/.test(c)) return "income-interest";
    return "income-other";
  }
  if (/refund|reimburse/.test(c)) return "refund";
  if (SAVINGS_CAT_RE.test(cat)) return "savings-contribution";
  if (transferish) {
    if (CARD_PAYMENT_HINTS.some(h => text.includes(h))) return "credit-card-payment";
    if (SAVINGS_HINTS.some(h => text.includes(h))) return "savings-contribution";
    if (c.startsWith("transfer") || P2P_HINTS.some(h => text.includes(h))) return "transfer-out";
  }
  if (/\btax/.test(c)) return "obligation-tax";
  if (/mortgage|loan|rent/.test(c)) return "obligation-loan";
  if (/bills|utilities|insurance|bill payment/.test(c)) return "obligation-bill";
  return "spend";
}

// ── "Change type" menu options ──────────────────────────────────────────────
// Each choice is persisted as a re-categorization (category that
// classifyTxn maps back to the class), so it rides the existing override
// sync with no new storage.
export const TXN_TYPES: { key: TxnClass; label: string; short: string; hint: string; category: string | null }[] = [
  { key: "spend", label: "Spending", short: "Spend", hint: "Counts toward spending & budgets", category: null },
  { key: "obligation-bill", label: "Bill", short: "Bill", hint: "Utilities, phone, insurance; counted as spending", category: "Bills & Utilities" },
  { key: "obligation-loan", label: "Loan / rent / mortgage", short: "Loan", hint: "Fixed obligation; counted as spending", category: "Loan Payment" },
  { key: "refund", label: "Refund", short: "Refund", hint: "Nets down spending", category: "Refund / Reimbursement" },
  { key: "income-other", label: "Income", short: "Income", hint: "Money earned", category: "Other Income" },
  { key: "credit-card-payment", label: "Credit card payment", short: "Card pmt", hint: "Paying a card; not spending", category: "Credit Card Payment" },
  { key: "savings-contribution", label: "Savings & investing", short: "Savings", hint: "Savings/brokerage contribution; not spending", category: "Savings & Investing" },
  { key: "transfer-out", label: "Transfer out (to someone)", short: "Sent", hint: "Money sent to another person", category: "Transfer Out" },
  { key: "transfer-in", label: "Transfer in (from someone)", short: "Received", hint: "Money received from another person", category: "Transfer In" },
  { key: "transfer-internal", label: "Internal transfer", short: "Internal", hint: "Between your own accounts; ignored", category: "Internal Transfer" },
];

/** Menu entry for a class (income/obligation subtypes fold into the nearest option). */
export const txnTypeOption = (c: TxnClass) =>
  TXN_TYPES.find(x => x.key === c)
  ?? (isIncomeClass(c) ? TXN_TYPES.find(x => x.key === "income-other") : c === "obligation-tax" ? { ...TXN_TYPES[1], key: c, label: "Tax", short: "Tax" } : undefined)
  ?? TXN_TYPES[0];
