/**
 * "Paid but still says missing": a second look at every expense whose current
 * due date has passed, before it is flagged missed or late.
 *
 * The detector matches payments to schedule slots strictly (one amount
 * cluster, a +-few-day window, the series' own descriptor). Real payments
 * slip past that: paid a week early, an extra-principal or payoff amount, a
 * new descriptor after a servicer change, a payment Plaid files as a
 * transfer, or one that only shows on the loan / card account itself (the
 * liability side, where a payment is money coming in). This pass searches
 * all posted transactions for a payment that plausibly settles the due one:
 *
 *   payee (same payee key, or a distinctive word of the label)
 *   + amount tolerance (loans may pay more; card payments vary)
 *   + a date window from half a period before the due date up to today.
 *
 * Settled items lose their missed/late flag, gain the payment as "last paid"
 * and roll their next due date forward. Pure: no React, no network.
 */
import type { ClassifierAccount, ClassifierTxn } from "./classifier";
import { addDays, addMonths, diffDays, parseDate, type ISODate } from "./dates";
import { payeeKey } from "./payee";
import type { Cadence } from "./schedule";
import type { MatchedTxn, ReviewItem } from "./review";

const PER_YEAR: Record<Cadence, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, quarterly: 4, semiannual: 2, yearly: 1 };
const periodDays = (c: Cadence) => Math.round(365 / PER_YEAR[c]);

/** Words that say nothing about who was paid. */
const GENERIC = new Set([
  "payment", "payments", "pymt", "pmt", "online", "transfer", "xfer", "loan", "loans", "bill", "bills", "autopay", "auto", "pay", "ach", "debit", "credit",
  "card", "the", "inc", "llc", "corp", "bank", "web", "recurring", "from", "acct", "account", "des", "indn", "ppd", "ccd", "withdrawal", "deposit",
  "mobile", "electronic", "services", "service", "monthly", "thank", "you", "and", "for", "epay", "billpay", "debt", "mortgage", "student", "home", "personal",
]);
export function payeeTokens(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z][a-z&']{2,}/g) ?? []).filter(w => !GENERIC.has(w)))];
}

/** The due date that has passed and isn't settled yet, if any. */
export function currentDue(it: Pick<ReviewItem, "nextDue" | "daysLate" | "missed" | "direction">, today: ISODate): ISODate | null {
  if (it.nextDue && it.nextDue <= today) return it.nextDue;
  if (it.daysLate != null) return addDays(today, -(it.daysLate + (it.direction === "inflow" ? 2 : 5)));
  return null;
}

function step(d: ISODate, c: Cadence, anchor: number): ISODate {
  switch (c) {
    case "weekly": return addDays(d, 7);
    case "biweekly": return addDays(d, 14);
    case "semimonthly": return parseDate(d).d <= 15 ? addDays(d, 15) : addMonths(d, 1, Math.min(anchor, 15));
    case "monthly": return addMonths(d, 1, anchor);
    case "quarterly": return addMonths(d, 3, anchor);
    case "semiannual": return addMonths(d, 6, anchor);
    default: return addMonths(d, 12, anchor);
  }
}

/** Next due after a payment on `paid` settled the one due on `due` (always after today). */
export function rollNextDue(due: ISODate, paid: ISODate, cadence: Cadence, today: ISODate): ISODate {
  const anchor = parseDate(due).d;
  const half = Math.floor(periodDays(cadence) / 2);
  let d = due;
  let guard = 0;
  while ((d <= today || diffDays(d, paid) <= half) && guard++ < 400) d = step(d, cadence, anchor);
  return d;
}

function amountOk(it: ReviewItem, amt: number, strong: boolean): boolean {
  if (!(amt > 0)) return false;
  if (it.kind === "card_payment") return true; // follows the statement balance
  const want = it.amount;
  if (!(want > 0)) return true;
  // A loan paid with extra principal or paid off is still paid (strong payee evidence only).
  if (it.kind === "loan" && strong) return amt >= want * 0.75 - 1;
  const tol = it.group === "insurance_tax" || it.subtype === "utility" || it.subtype === "phone" || it.subtype === "internet" ? 0.6 : 0.3;
  return Math.abs(amt - want) <= Math.max(5, want * tol);
}

const isLiability = (a: ClassifierAccount | undefined) => !!a && (a.type === "loan" || a.type === "credit");
const PAYMENT_TEXT_RE = /\b(payment|pymt|pmt|autopay|auto\s*pay|thank\s*you|transfer|xfer|ach|online)\b/i;

export interface ReconcileOptions { today: ISODate; accounts?: readonly ClassifierAccount[] }

/** Clear missed/late flags on expenses whose due payment did arrive (see file comment). */
export function reconcilePayments(items: readonly ReviewItem[], txns: readonly ClassifierTxn[], opts: ReconcileOptions): ReviewItem[] {
  const { today } = opts;
  const acctById = new Map((opts.accounts ?? []).map(a => [a.account_id, a] as const));
  const txnById = new Map(txns.map(t => [t.transaction_id, t] as const));
  const posted = txns.filter(t => !t.pending && t.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  // A transaction settles one item at most.
  const claimed = new Set<string>();
  return items.map(it => {
    if (it.direction !== "outflow" || it.status === "dismissed") return it;
    const due = currentDue(it, today);
    if (!due) return it;
    const from = addDays(due, -Math.max(3, Math.round(periodDays(it.cadence) * 0.5)));
    const own = new Set(it.transactionIds);
    const keys = new Set(it.matched.map(m => txnById.get(m.id)).filter((t): t is ClassifierTxn => !!t).map(t => payeeKey({ name: t.name ?? null, merchant_name: t.merchant_name ?? null })));
    const toks = payeeTokens(`${it.label} ${it.matched.slice(0, 3).map(m => m.name).join(" ")}`);
    const debt = it.kind === "loan" || it.kind === "card_payment";
    const liabType = it.kind === "loan" ? "loan" : "credit";
    const liabAccts = (opts.accounts ?? []).filter(a => a.type === liabType);
    let hit: ClassifierTxn | null = null;
    for (const t of posted) {
      if (t.date < from) break;
      if (claimed.has(t.transaction_id)) continue;
      const text = `${t.name ?? ""} ${t.merchant_name ?? ""}`;
      const acct = acctById.get(t.account_id);
      if (own.has(t.transaction_id)) {
        if (t.amount > 0 && amountOk(it, t.amount, true)) { hit = t; break; }
        continue;
      }
      if (t.amount > 0) {
        const sameKey = keys.has(payeeKey({ name: t.name ?? null, merchant_name: t.merchant_name ?? null }));
        const word = toks.length > 0 && payeeTokens(text).some(w => toks.includes(w));
        if ((sameKey || word) && amountOk(it, t.amount, sameKey)) { hit = t; break; }
        continue;
      }
      // Liability side: the payment lands on the loan / card account as money in.
      if (debt && t.amount < 0 && isLiability(acct) && acct!.type === liabType) {
        const named = toks.length > 0 && payeeTokens(`${acct!.name ?? ""} ${text}`).some(w => toks.includes(w));
        const onlyOne = liabAccts.length === 1;
        const looksLikePayment = it.kind === "loan" || PAYMENT_TEXT_RE.test(text);
        if ((named || onlyOne) && looksLikePayment && amountOk(it, -t.amount, true)) { hit = t; break; }
      }
    }
    if (!hit) return it;
    claimed.add(hit.transaction_id);
    const m: MatchedTxn = { id: hit.transaction_id, date: hit.date, amount: Math.abs(hit.amount), name: hit.merchant_name || hit.name || "", accountId: hit.account_id };
    const matched = own.has(m.id) ? it.matched : [m, ...it.matched].sort((a, b) => b.date.localeCompare(a.date));
    return {
      ...it,
      missed: false,
      daysLate: null,
      matched,
      transactionIds: matched.map(x => x.id),
      occurrences: matched.length,
      lastSeen: hit.date > it.lastSeen ? hit.date : it.lastSeen,
      nextDue: rollNextDue(due, hit.date, it.cadence, today),
    };
  });
}
