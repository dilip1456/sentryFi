/**
 * Aggregation over classified transactions — the single definition of the
 * headline metrics:
 *
 *   spending  = spend + refund + obligations (loan, tax, bill), signed, so
 *               refunds net out; pending transactions included.
 *   income    = salary + interest/dividends + other income, net of reversals.
 *   neutral   = unmatched transfers in/out (review queue) — in neither total.
 *   ignored   = internal transfers, card payments, savings contributions —
 *               reported separately, in neither total.
 *   net       = income − spending;  savings rate = net / income.
 */
import type { Classification, ClassifierTxn } from "./types.ts";
import { bucketOf, isBudgetableType } from "./categories.ts";

export interface FlowSummary {
  spending: number;
  discretionary: number;        // spend + refund (what budgets track)
  obligations: number;          // loan + tax + bill
  income: number;
  salary: number;
  interest: number;             // interest + dividends
  otherIncome: number;
  creditCardPayments: number;
  savingsContributions: number;
  internalTransfers: number;    // outgoing leg only, so each move counts once
  unreviewedIn: number;
  unreviewedOut: number;
  net: number;
  spendingByCategory: Record<string, { total: number; count: number }>;
  incomeByCategory: Record<string, { total: number; count: number }>;
  count: number;
}

export interface DateRange { start: string; end: string }

const r2 = (n: number) => Math.round(n * 100) / 100;

export function summarizeFlow(
  txns: ClassifierTxn[],
  classOf: (t: ClassifierTxn) => Classification | undefined,
  categoryOf: (t: ClassifierTxn) => string,
  range?: DateRange,
): FlowSummary {
  const s: FlowSummary = {
    spending: 0, discretionary: 0, obligations: 0, income: 0, salary: 0, interest: 0, otherIncome: 0,
    creditCardPayments: 0, savingsContributions: 0, internalTransfers: 0, unreviewedIn: 0, unreviewedOut: 0,
    net: 0, spendingByCategory: {}, incomeByCategory: {}, count: 0,
  };
  for (const t of txns) {
    if (range && (t.date < range.start || t.date > range.end)) continue;
    const c = classOf(t);
    if (!c) continue;
    const amt = Number(t.amount) || 0;
    s.count++;
    const bucket = bucketOf(c.type);
    if (bucket === "spending") {
      s.spending += amt;
      if (isBudgetableType(c.type)) s.discretionary += amt; else s.obligations += amt;
      const e = (s.spendingByCategory[categoryOf(t)] ??= { total: 0, count: 0 });
      e.total += amt; e.count++;
    } else if (bucket === "income") {
      const v = -amt;
      s.income += v;
      if (c.type === "income_salary") s.salary += v;
      else if (c.type === "income_interest") s.interest += v;
      else s.otherIncome += v;
      const e = (s.incomeByCategory[categoryOf(t)] ??= { total: 0, count: 0 });
      e.total += v; e.count++;
    } else if (bucket === "neutral") {
      if (amt < 0) s.unreviewedIn += -amt; else s.unreviewedOut += amt;
    } else if (amt > 0) {
      if (c.type === "credit_card_payment") s.creditCardPayments += amt;
      else if (c.type === "savings_contribution") s.savingsContributions += amt;
      else s.internalTransfers += amt;
    } else if (c.type === "credit_card_payment") {
      // Payment to an unlinked card only shows its outgoing leg (counted
      // above); a card-side leg with no matching outflow still counts once.
      if (!c.pairId) s.creditCardPayments += -amt;
    }
  }
  for (const k of ["spending","discretionary","obligations","income","salary","interest","otherIncome","creditCardPayments","savingsContributions","internalTransfers","unreviewedIn","unreviewedOut"] as const) s[k] = r2(s[k]);
  for (const m of [s.spendingByCategory, s.incomeByCategory]) for (const v of Object.values(m)) v.total = r2(v.total);
  s.net = r2(s.income - s.spending);
  return s;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;

/** Full calendar month (offset 0 = this month) in local time. */
export function monthRange(now: Date = new Date(), offset = 0): DateRange {
  const f = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate();
  return { start: ymd(f.getFullYear(), f.getMonth(), 1), end: ymd(f.getFullYear(), f.getMonth(), last) };
}

/**
 * The same day-span of the previous month (Oct 1–20 → Sep 1–20), so a
 * partial month is never compared with a full one.
 */
export function samePeriodLastMonth(now: Date = new Date()): DateRange & { label: string } {
  const f = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate();
  const endDay = Math.min(now.getDate(), last);
  const mon = f.toLocaleDateString("en-US", { month: "short" });
  return {
    start: ymd(f.getFullYear(), f.getMonth(), 1),
    end: ymd(f.getFullYear(), f.getMonth(), endDay),
    label: endDay === 1 ? `${mon} 1` : `${mon} 1–${endDay}`,
  };
}

/** Month-to-date range for `now`. */
export function monthToDate(now: Date = new Date()): DateRange {
  return { start: ymd(now.getFullYear(), now.getMonth(), 1), end: ymd(now.getFullYear(), now.getMonth(), now.getDate()) };
}

/** (income − spending) / income as a whole percent; null without income. */
export function savingsRate(income: number, spending: number): number | null {
  if (!(income > 0)) return null;
  return Math.round(((income - spending) / income) * 100);
}
