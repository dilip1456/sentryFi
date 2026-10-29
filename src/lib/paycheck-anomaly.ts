/**
 * Paycheck anomaly detection, extracted verbatim (logic-wise) from
 * MyFinancialPicture.tsx on main (paycheckStats / detectIncomeAnomaly /
 * detectMisclassifiedPaycheck) so it can be shared without depending on the
 * Picture UI. Pure: no React, no Supabase. The Timeline turns the results
 * into Alerts items (src/lib/timeline/paycheck.ts); there are no push alerts.
 */
import type { TxnType } from "@/lib/classify";

export interface PaycheckTxn {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** Plaid sign: > 0 money out, < 0 money in. */
  amount: number | string;
  pending?: boolean | null;
  name?: string | null;
  merchant_name?: string | null;
}
export type PaycheckClassOf<T extends PaycheckTxn = PaycheckTxn> = (t: T) => { type: TxnType } | undefined;

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKeyOf = (now: Date) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

/** Bonus pay is income_salary but not a regular paycheck (same rule as the Picture). */
export const BONUS_RE = /\bbonus\b/i;

/**
 * How many paychecks have landed this month vs. the typical count, based on
 * the trailing 6 months' history (excluding the current, possibly-incomplete
 * month). Null when there isn't enough history to say what "typical" means,
 * or for once-a-month earners (nothing reliable to compare mid-month).
 */
export function paycheckStats<T extends PaycheckTxn>(
  allTxns: T[],
  classOf: PaycheckClassOf<T> | undefined,
  now: Date,
): { found: number; typical: number } | null {
  const since = new Date(now);
  since.setDate(since.getDate() - 180);
  const sinceStr = ymd(since);
  const curMonthKey = monthKeyOf(now);

  const salaryTxns = allTxns.filter(t => {
    if (t.pending || t.date < sinceStr) return false;
    return classOf?.(t)?.type === "income_salary";
  });
  const priorTxns = salaryTxns.filter(t => t.date.slice(0, 7) !== curMonthKey);
  if (priorTxns.length < 3) return null;

  const byMonth = new Map<string, number>();
  for (const t of priorTxns) byMonth.set(t.date.slice(0, 7), (byMonth.get(t.date.slice(0, 7)) ?? 0) + 1);
  const counts = [...byMonth.values()];
  const typical = Math.round(counts.reduce((a, b) => a + b, 0) / counts.length);
  if (typical < 2) return null;

  const found = salaryTxns.filter(t => t.date.slice(0, 7) === curMonthKey).length;
  return { found, typical };
}

/** Shortfall text, only from the 20th on (earlier is just "not paid yet"). */
export function detectIncomeAnomaly<T extends PaycheckTxn>(
  allTxns: T[],
  classOf: PaycheckClassOf<T> | undefined,
  now: Date,
): string | null {
  const s = detectPaycheckShortfall(allTxns, classOf, now);
  return s ? s.text : null;
}

export function detectPaycheckShortfall<T extends PaycheckTxn>(
  allTxns: T[],
  classOf: PaycheckClassOf<T> | undefined,
  now: Date,
): { found: number; typical: number; text: string } | null {
  if (now.getDate() < 20) return null;
  const stats = paycheckStats(allTxns, classOf, now);
  if (!stats || stats.found >= stats.typical) return null;
  return {
    ...stats,
    text: `Usually ~${stats.typical} paychecks land per month based on recent history — only ${stats.found} found so far this month. Worth checking for a missing or miscategorized deposit.`,
  };
}

export interface IncomeBuckets {
  salary: { amount: number; txns: PaycheckTxn[] };
  other: { amount: number; txns: PaycheckTxn[] };
}

/**
 * A second paycheck that landed under "other income" instead of "salary":
 * if this month's other income is within 0.8–1.25× of an average paycheck,
 * it's almost certainly the missing paycheck itself.
 */
export function detectMisclassifiedPaycheck(income: IncomeBuckets): { amount: number } | null {
  if (income.other.amount <= 0 || income.salary.txns.length === 0) return null;
  const avgPaycheck = income.salary.amount / income.salary.txns.length;
  if (avgPaycheck <= 0) return null;
  const ratio = income.other.amount / avgPaycheck;
  if (ratio > 0.8 && ratio < 1.25) return { amount: income.other.amount };
  return null;
}

/** This month's salary (bonus excluded) and other-income buckets, posted only. */
export function monthIncomeBuckets<T extends PaycheckTxn>(txns: T[], classOf: PaycheckClassOf<T> | undefined, now: Date): IncomeBuckets {
  const key = monthKeyOf(now);
  const out: IncomeBuckets = { salary: { amount: 0, txns: [] }, other: { amount: 0, txns: [] } };
  for (const t of txns) {
    if (t.pending || t.date.slice(0, 7) !== key) continue;
    const type = classOf?.(t)?.type;
    const v = -(Number(t.amount) || 0);
    if (type === "income_salary") {
      if (BONUS_RE.test(`${t.merchant_name ?? ""} ${t.name ?? ""}`)) continue;
      out.salary.amount += v; out.salary.txns.push(t);
    } else if (type === "income_other") {
      out.other.amount += v; out.other.txns.push(t);
    }
  }
  return out;
}

export type PaycheckAnomaly =
  | { kind: "paycheck_misclassified"; month: string; amount: number; on: string; txnIds: string[]; text: string }
  | { kind: "paycheck_shortfall"; month: string; found: number; typical: number; on: string; text: string };

/**
 * The Picture's rule: a likely misclassified paycheck wins; otherwise the
 * shortfall note. At most one anomaly per month.
 */
export function findPaycheckAnomalies<T extends PaycheckTxn>(txns: T[], classOf: PaycheckClassOf<T> | undefined, now: Date): PaycheckAnomaly[] {
  const month = monthKeyOf(now);
  const buckets = monthIncomeBuckets(txns, classOf, now);
  const mis = detectMisclassifiedPaycheck(buckets);
  if (mis) {
    const on = buckets.other.txns.reduce((m, t) => (t.date > m ? t.date : m), `${month}-01`);
    return [{
      kind: "paycheck_misclassified", month, amount: Math.round(mis.amount * 100) / 100, on,
      txnIds: buckets.other.txns.map(t => t.id),
      text: `Other income (${usd(mis.amount)}) is close to a typical paycheck — this might be a second paycheck filed under the wrong category.`,
    }];
  }
  const s = detectPaycheckShortfall(txns, classOf, now);
  return s ? [{ kind: "paycheck_shortfall", month, found: s.found, typical: s.typical, on: `${month}-20`, text: s.text }] : [];
}

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
