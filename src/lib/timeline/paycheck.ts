/**
 * Paycheck anomalies (src/lib/paycheck-anomaly) as Timeline Alerts items.
 * They are computed on the client (not rows in alert_log), so "Mark as seen"
 * is remembered per user in localStorage (see seenStore below).
 */
import { paycheckAlerts, type AnomalyTxn, type ClassOf } from "@/lib/paycheck-anomaly";
import { compareEventsDesc } from "./cursor";
import { historyCategories, matchesFilters } from "./filters";
import type { TimelineEvent, TimelineFilters } from "./types";

export const PAYCHECK_ALERT_PREFIX = "alert:paycheck-";

/** One month's paycheck anomaly, shaped for the Timeline (day it belongs to, ids). */
export type PaycheckAnomaly =
  | { kind: "paycheck_misclassified"; month: string; amount: number; on: string; txnIds: string[]; text: string }
  | { kind: "paycheck_shortfall"; month: string; found: number; typical: number; on: string; text: string };

/**
 * The inbox's checks (src/lib/paycheck-anomaly `paycheckAlerts`, the single
 * source since #28) as Timeline items: same rules, same wording, at most one
 * per month. The shortfall belongs to the 20th (when it can first fire); a
 * likely misclassified paycheck to the day of the latest other-income deposit.
 */
export function findPaycheckAnomalies<T extends AnomalyTxn>(txns: T[], classOf: ClassOf<T>, now: Date): PaycheckAnomaly[] {
  return paycheckAlerts(txns, classOf, now).map((a): PaycheckAnomaly => {
    const { month } = a.payload;
    if (a.payload.kind === "misclassified") {
      const ids = a.payload.transaction_ids ?? [];
      const on = txns.filter(t => ids.includes(t.id)).reduce((m, t) => (t.date > m ? t.date : m), `${month}-01`);
      return { kind: "paycheck_misclassified", month, amount: Math.round((a.payload.amount ?? 0) * 100) / 100, on, txnIds: ids, text: a.body };
    }
    return { kind: "paycheck_shortfall", month, found: a.payload.found ?? 0, typical: a.payload.typical ?? 0, on: `${month}-20`, text: a.body };
  });
}

export const isComputedAlert = (e: Pick<TimelineEvent, "id" | "meta">) => e.meta?.computed === true;

export function paycheckAlertEvent(a: PaycheckAnomaly, seen: ReadonlySet<string> = new Set()): TimelineEvent {
  const id = `${PAYCHECK_ALERT_PREFIX}${a.kind === "paycheck_shortfall" ? "shortfall" : "misclassified"}-${a.month}`;
  const base = {
    id, source: "alert" as const, source_id: id.slice("alert:".length), occurred_on: a.on, occurred_at: `${a.on}T12:00:00.000Z`,
    category: "alerts" as const, txn_type: null, is_internal: false, account_id: null, stream_id: null, pending: false,
    status: seen.has(id) ? "seen" as const : "flag" as const,
  };
  if (a.kind === "paycheck_shortfall") {
    return {
      ...base, title: "Paycheck may be missing", amount: null,
      subtitle: `Only ${a.found} of your usual ~${a.typical} paychecks this month`,
      meta: { computed: true, alert_type: a.kind, detail: a.text, found: a.found, typical: a.typical },
    };
  }
  return {
    ...base, title: "Paycheck may be miscategorized", amount: a.amount,
    subtitle: "Other income looks like a typical paycheck",
    meta: { computed: true, alert_type: a.kind, detail: a.text, txn_ids: a.txnIds },
  };
}

/**
 * Merge computed events into the loaded (server-paged) history without
 * breaking keyset order: same filters as timeline_page(), on/before a
 * jump date, and — while more pages exist — only events that sort at or
 * above the last loaded row (the rest appear once the user scrolls there).
 */
export function mergeComputedEvents(
  history: TimelineEvent[],
  extra: TimelineEvent[],
  opts: { filters: TimelineFilters; hasMore: boolean },
): TimelineEvent[] {
  if (!extra.length) return history;
  const cats = historyCategories(opts.filters);
  const last = history[history.length - 1];
  const keep = extra.filter(e =>
    matchesFilters(e, cats, opts.filters.includeInternal)
    && (!opts.filters.at || e.occurred_on <= opts.filters.at)
    && (!opts.hasMore || (last != null && compareEventsDesc(e, last) <= 0))
    && !history.some(h => h.id === e.id));
  if (!keep.length) return history;
  return [...history, ...keep].sort(compareEventsDesc);
}

/** Per-user "seen" ids for computed alerts (no table needed). */
export const seenStore = {
  key: (userId: string) => `sentryfi.timeline.seen.v1:${userId}`,
  read(userId: string | null): Set<string> {
    if (!userId || typeof localStorage === "undefined") return new Set();
    try { return new Set(JSON.parse(localStorage.getItem(this.key(userId)) ?? "[]") as string[]); } catch { return new Set(); }
  },
  add(userId: string | null, id: string) {
    if (!userId || typeof localStorage === "undefined") return;
    const s = this.read(userId); s.add(id);
    try { localStorage.setItem(this.key(userId), JSON.stringify([...s].slice(-200))); } catch { /* storage full/blocked: session-only */ }
  },
};
