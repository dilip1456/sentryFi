/**
 * Demo / guest mode data for the Timeline: the same demo transactions and
 * accounts every other demo screen uses (src/lib/finance-data), classified
 * by the shared classifier, plus a few example alerts, findings and tax
 * milestones dated relative to today. Upcoming comes from running
 * src/lib/recurring detection over the demo history. No network.
 */
import { classifyAll, type ClassifierAccount, type ClassifierTxn, type TxnType } from "@/lib/classify";
import { demoAccounts, demoTransactions } from "@/lib/finance-data";
import { addDays, todayLocal } from "@/lib/recurring/dates";
import { detectRecurringSeries } from "@/lib/recurring/detect";
import { toStreamRow } from "@/lib/recurring/rows";
import { eventsFromTransactions } from "./events";
import { findPaycheckAnomalies, paycheckAlertEvent, type PaycheckAnomaly } from "./paycheck";
import { paginateEvents } from "./paginate";
import { buildUpcoming, type UpcomingAccount, type UpcomingStatement, type UpcomingMilestone } from "./upcoming";
import type { TimelineCursor, TimelineEvent, TimelineFilters, TimelinePage } from "./types";

export interface DemoTimelineData {
  today: string;
  events: TimelineEvent[];
  upcoming: (through: string) => TimelineEvent[];
  accounts: UpcomingAccount[];
  /** Oldest history day ("Start of history"). */
  oldest: string | null;
  /** Paycheck anomalies (computed client-side, merged into history by the panel). */
  paycheck: PaycheckAnomaly[];
}

const at = (day: string, hhmm: string) => (hhmm === "12:00" ? `${day}T12:00:00.000Z` : new Date(`${day}T${hhmm}:00-04:00`).toISOString());

function extraEvents(today: string): TimelineEvent[] {
  const ev = (id: string, daysAgo: number, time: string, e: Partial<TimelineEvent> & Pick<TimelineEvent, "title" | "category" | "status" | "source">): TimelineEvent => {
    const day = addDays(today, -daysAgo);
    return {
      id, source_id: id.split(":")[1] ?? id, occurred_on: day, occurred_at: at(day, time), txn_type: null,
      is_internal: false, subtitle: null, amount: null, account_id: null, stream_id: null, pending: false, meta: {}, ...e,
    };
  };
  return [
    ev("alert:demo-dup", 2, "09:10", { source: "alert", category: "alerts", status: "flag", title: "Possible duplicate charge", subtitle: "Starbucks charged twice · $34.50", account_id: "da5", meta: { alert_type: "duplicate" } }),
    ev("inf:demo-autopay", 9, "08:30", { source: "inference", category: "alerts", status: "done", title: "Rocket Mortgage looks like autopay", subtitle: "Paid from Everyday Checking 3 months in a row · confirmed", account_id: "da1", meta: { kind: "bill_autopay" } }),
    ev("alert:demo-large", 8, "14:05", { source: "alert", category: "alerts", status: "seen", title: "Large purchase: Best Buy", subtitle: "$320.00 on Sapphire Reserve", account_id: "da4", meta: { alert_type: "large_txn" } }),
    ev("inf:demo-low", 20, "07:45", { source: "inference", category: "alerts", status: "review", title: "Balance may run low", subtitle: "Everyday Checking could dip below $500 before payday", account_id: "da1", meta: { kind: "low_balance" } }),
    ev("alert:demo-price", 47, "10:00", { source: "alert", category: "alerts", status: "seen", title: "Netflix went up", subtitle: "$15.49 → $19.99 a month", account_id: "da5", meta: { alert_type: "price_increase" } }),
    // money moved between the user's own accounts (hidden unless "Show internal transfers")
    ...[3, 33, 63].flatMap(n => [
      ev(`txn:demo-int-out-${n}`, n, "12:00", { source: "transaction", category: "transfer", status: "moved", txn_type: "transfer_internal", is_internal: true, title: "Transfer to Emergency Fund", subtitle: "Everyday Checking → Emergency Fund", amount: -600, account_id: "da1" }),
      ev(`txn:demo-int-in-${n}`, n, "12:00", { source: "transaction", category: "transfer", status: "moved", txn_type: "transfer_internal", is_internal: true, title: "Transfer from Everyday Checking", subtitle: "Everyday Checking → Emergency Fund", amount: 600, account_id: "da3" }),
    ]),
    ev("tax:demo-q3", Math.max(1, daysSince(today, "09-15")), "12:00", { source: "tax_milestone", category: "taxes", status: "done", title: "Q3 estimated tax", subtitle: "Marked paid", txn_type: "obligation_tax", meta: { kind: "estimated_payment" } }),
    ev("tax:demo-w2", Math.max(1, daysSince(today, "01-31")), "12:00", { source: "tax_milestone", category: "taxes", status: "info", title: "W-2 available", subtitle: "Ready for your return", txn_type: "obligation_tax", meta: { kind: "other" } }),
  ];
}

/** Days since the most recent MM-DD on or before today. */
function daysSince(today: string, mmdd: string): number {
  const y = Number(today.slice(0, 4));
  let d = `${y}-${mmdd}`;
  if (d > today) d = `${y - 1}-${mmdd}`;
  return Math.round((Date.parse(today) - Date.parse(d)) / 864e5);
}

let cache: { key: string; data: DemoTimelineData } | null = null;

export function demoTimeline(today = todayLocal()): DemoTimelineData {
  if (cache?.key === today) return cache.data;
  const txns: ClassifierTxn[] = (demoTransactions as unknown as ClassifierTxn[]).map(t => ({ ...t, transaction_id: t.id }));
  const accounts: ClassifierAccount[] = demoAccounts.map(a => ({ account_id: a.account_id, item_id: a.item_id, name: a.name, mask: a.mask, type: a.type, subtype: a.subtype }));
  const classes = classifyAll(txns, { accounts });
  const series = detectRecurringSeries(txns.map(t => ({ ...t, transaction_id: t.id, amount: Number(t.amount) })), accounts, { today });
  const streamByTxn = new Map<string, string>();
  for (const s of series) for (const id of s.transactionIds) streamByTxn.set(id, s.seriesKey);
  const events = [...eventsFromTransactions(txns.filter(t => t.date <= today), classes, streamByTxn), ...extraEvents(today)];
  const upAccounts: UpcomingAccount[] = demoAccounts.map(a => ({ account_id: a.account_id, name: a.name, mask: a.mask, type: a.type, subtype: a.subtype, current_balance: a.current_balance }));
  const streams = series.map(s => ({ ...toStreamRow(s, "demo"), id: s.seriesKey, last_seen: s.lastSeen }));
  // Everyday Checking covers the must-pay bills, so "Covered by" shows; the student loan is left uncovered on purpose
  const obligations = streams
    .filter(s => s.kind === "loan" || s.kind === "bill")
    .filter(s => !/nelnet/i.test(s.display_name))
    .map(s => ({ id: `ob-${s.series_key}`, stream_id: s.id, funding_account_id: "da1", active: true }));
  const statements: UpcomingStatement[] = [
    { account_id: "da4", statement_issue_date: addDays(today, -16), due_date: addDays(today, 9), statement_balance: 2840.22, minimum_payment_amount: 40 },
    { account_id: "da5", statement_issue_date: addDays(today, -9), due_date: addDays(today, 16), statement_balance: null, minimum_payment_amount: 35 },
  ];
  const milestones: UpcomingMilestone[] = [
    { id: "demo-q4", title: "Q4 estimated tax", due_date: nextMmdd(today, "01-15"), amount: 1800, status: "upcoming", kind: "estimated_payment", note: "Federal · IRS Direct Pay" },
  ];
  const data: DemoTimelineData = {
    today,
    events,
    accounts: upAccounts,
    oldest: events.reduce<string | null>((m, e) => (!m || e.occurred_on < m ? e.occurred_on : m), null),
    paycheck: demoPaycheck(txns.filter(t => t.date <= today), t => classes.get(t.id), today),
    upcoming: through => buildUpcoming({ today, through, streams, obligations, statements, milestones, accounts: upAccounts }),
  };
  cache = { key: today, data };
  return data;
}

/**
 * The real detector over the demo history; when the regular demo paychecks
 * give it nothing, an illustrative shortfall (like the other example
 * alerts above) is shown instead so /demo has a paycheck alert to open.
 */
function demoPaycheck(txns: ClassifierTxn[], classOf: (t: ClassifierTxn) => { type: TxnType } | undefined, today: string): PaycheckAnomaly[] {
  const now = new Date(`${today}T12:00:00`);
  const found = findPaycheckAnomalies(txns, classOf, now);
  if (found.length) return found;
  const d = now.getDate() >= 20 ? now : new Date(now.getFullYear(), now.getMonth() - 1, 20);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return [{ kind: "paycheck_shortfall", month, found: 1, typical: 2, on: `${month}-20`,
    text: "Usually ~2 paychecks land per month based on recent history — only 1 found so far this month. Worth checking for a missing or miscategorized deposit." }];
}

function nextMmdd(today: string, mmdd: string): string {
  const y = Number(today.slice(0, 4));
  const d = `${y}-${mmdd}`;
  return d >= today ? d : `${y + 1}-${mmdd}`;
}

export function demoPage(cursor: TimelineCursor | null, filters: TimelineFilters, limit?: number): TimelinePage {
  return paginateEvents(demoTimeline().events, cursor, filters, limit);
}
