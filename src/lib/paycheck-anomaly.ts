/**
 * Paycheck anomaly checks, restored from the old My Financial Picture
 * (origin/main MyFinancialPicture.tsx: paycheckStats, detectIncomeAnomaly,
 * detectMisclassifiedPaycheck; logic and wording unchanged). They now surface
 * as Alerts in the notification inbox (paycheckAlerts → src/lib/derived-alerts)
 * instead of a banner on the page. No push notifications.
 *
 * Pure (no React / Supabase): the Timeline (PR #26) can import the same checks.
 */
import type { TxnType } from "@/lib/classify";
import { fmtUSD } from "@/lib/format";

export interface AnomalyTxn {
  id: string; date: string; amount: number | string; pending?: boolean | null;
  name?: string | null; merchant_name?: string | null;
}
export type ClassOf<T extends AnomalyTxn = AnomalyTxn> = ((t: T) => { type: TxnType } | undefined) | undefined;

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

/** How many paychecks have landed this month vs. the typical count, based on
 * the trailing 6 months' history. Returns null when there isn't enough
 * history yet to say what "typical" even means. */
export function paycheckStats<T extends AnomalyTxn>(allTxns: T[], classOf: ClassOf<T>, now: Date): { found: number; typical: number } | null {
  const since = new Date(now);
  since.setDate(since.getDate() - 180);
  const sinceStr = ymd(since);
  const curMonthKey = monthKey(now);

  const salaryTxns = allTxns.filter(t => {
    if (t.pending || t.date < sinceStr) return false;
    return classOf?.(t)?.type === "income_salary";
  });
  const priorTxns = salaryTxns.filter(t => t.date.slice(0, 7) !== curMonthKey);
  if (priorTxns.length < 3) return null; // not enough history for a reliable pattern

  const byMonth = new Map<string, number>();
  for (const t of priorTxns) byMonth.set(t.date.slice(0, 7), (byMonth.get(t.date.slice(0, 7)) ?? 0) + 1);
  const counts = [...byMonth.values()];
  const typical = Math.round(counts.reduce((a, b) => a + b, 0) / counts.length);
  if (typical < 2) return null; // once-a-month earners: nothing reliable to compare against mid-month

  const found = salaryTxns.filter(t => t.date.slice(0, 7) === curMonthKey).length;
  return { found, typical };
}

/** Fewer paychecks than usual, once enough of the month has gone by. */
export function detectIncomeAnomaly<T extends AnomalyTxn>(allTxns: T[], classOf: ClassOf<T>, now: Date): string | null {
  if (now.getDate() < 20) return null; // too early in the month to call it a shortfall
  const stats = paycheckStats(allTxns, classOf, now);
  if (!stats || stats.found >= stats.typical) return null;
  return `Usually ~${stats.typical} paychecks land per month based on recent history — only ${stats.found} found so far this month. Worth checking for a missing or miscategorized deposit.`;
}

export interface MonthIncome {
  salary: { amount: number; txns: AnomalyTxn[] };
  other: { amount: number; txns: AnomalyTxn[] };
}

/** A second paycheck filed under "other income": the month's other income is
 *  within 0.8–1.25× of an average paycheck. */
export function detectMisclassifiedPaycheck(income: MonthIncome): { amount: number } | null {
  if (income.other.amount <= 0 || income.salary.txns.length === 0) return null;
  const avgPaycheck = income.salary.amount / income.salary.txns.length;
  if (avgPaycheck <= 0) return null;
  const ratio = income.other.amount / avgPaycheck;
  if (ratio > 0.8 && ratio < 1.25) return { amount: income.other.amount };
  return null;
}

/** This month's posted salary and other income (inflows are negative in Plaid). */
export function monthIncome<T extends AnomalyTxn>(allTxns: T[], classOf: ClassOf<T>, now: Date): MonthIncome {
  const key = monthKey(now);
  const out: MonthIncome = { salary: { amount: 0, txns: [] }, other: { amount: 0, txns: [] } };
  for (const t of allTxns) {
    if (t.pending || t.date.slice(0, 7) !== key) continue;
    const amt = -Number(t.amount);
    if (!(amt > 0)) continue;
    const type = classOf?.(t)?.type;
    const slot = type === "income_salary" ? out.salary : type === "income_other" ? out.other : null;
    if (!slot) continue;
    slot.amount += amt;
    slot.txns.push(t);
  }
  return out;
}

export interface PaycheckAlert {
  /** stable per month: a new month's anomaly is a new (unread) alert */
  id: string;
  alert_type: "paycheck_anomaly";
  title: string;
  body: string;
  payload: { kind: "missing" | "misclassified"; month: string; amount?: number; found?: number; typical?: number; transaction_ids?: string[] };
  created_at: string;
}

/** The inbox alerts for this month (at most one; misclassified wins, as before). */
export function paycheckAlerts<T extends AnomalyTxn>(allTxns: T[], classOf: ClassOf<T>, now: Date): PaycheckAlert[] {
  const month = monthKey(now);
  const created_at = new Date(now.getFullYear(), now.getMonth(), Math.min(now.getDate(), 20), 9).toISOString();
  const income = monthIncome(allTxns, classOf, now);
  const mis = detectMisclassifiedPaycheck(income);
  if (mis) {
    return [{
      id: `derived:paycheck:misclassified:${month}`, alert_type: "paycheck_anomaly",
      title: "A paycheck may be filed as other income",
      body: `Other income (${fmtUSD(mis.amount)}) is close to a typical paycheck — this might be a second paycheck filed under the wrong category.`,
      payload: { kind: "misclassified", month, amount: mis.amount, transaction_ids: income.other.txns.map(t => t.id) },
      created_at,
    }];
  }
  const text = detectIncomeAnomaly(allTxns, classOf, now);
  if (!text) return [];
  const stats = paycheckStats(allTxns, classOf, now);
  return [{
    id: `derived:paycheck:missing:${month}`, alert_type: "paycheck_anomaly",
    title: "Fewer paychecks than usual this month",
    body: text,
    payload: { kind: "missing", month, found: stats?.found, typical: stats?.typical },
    created_at,
  }];
}
