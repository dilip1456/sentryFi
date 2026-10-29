import { describe, expect, it, beforeEach } from "vitest";
import type { TxnType } from "@/lib/classify";
import {
  detectIncomeAnomaly, detectMisclassifiedPaycheck, monthIncome, paycheckStats,
  type AnomalyTxn as PaycheckTxn,
} from "@/lib/paycheck-anomaly";
import {
  DEFAULT_FILTERS, demoTimeline, findPaycheckAnomalies, mergeComputedEvents, paycheckAlertEvent, seenStore,
  type TimelineEvent, type TimelineFilters,
} from "@/lib/timeline";

const types = new Map<string, TxnType>();
let n = 0;
const tx = (date: string, amount: number, type: TxnType = "income_salary", extra: Partial<PaycheckTxn> = {}): PaycheckTxn => {
  const id = `t${++n}`; types.set(id, type);
  return { id, date, amount, pending: false, name: "Direct Deposit - Employer", merchant_name: null, ...extra };
};
const classOf = (t: PaycheckTxn) => { const type = types.get(t.id); return type ? { type } : undefined; };
/** Biweekly paychecks May–Sep 2026 (2 per month). */
const history = () => ["05", "06", "07", "08", "09"].flatMap(m => [tx(`2026-${m}-01`, -2500), tx(`2026-${m}-15`, -2500)]);
const OCT25 = new Date(2026, 9, 25, 12);

// src/lib/paycheck-anomaly is #28's module (also feeds the inbox); the Timeline adapts it.
describe("paycheck anomaly detection (shared module)", () => {
  it("computes typical vs found from trailing history", () => {
    expect(paycheckStats([...history(), tx("2026-10-01", -2500)], classOf, OCT25)).toEqual({ found: 1, typical: 2 });
  });

  it("needs >= 3 prior paychecks and typical >= 2 (monthly earners never flag)", () => {
    expect(paycheckStats([tx("2026-09-01", -5000), tx("2026-09-15", -5000)], classOf, OCT25)).toBeNull();
    const monthly = ["05", "06", "07", "08", "09"].map(m => tx(`2026-${m}-01`, -5000));
    expect(paycheckStats(monthly, classOf, OCT25)).toBeNull();
    expect(detectIncomeAnomaly(monthly, classOf, OCT25)).toBeNull();
  });

  it("ignores pending rows, non-salary rows and anything older than 180 days", () => {
    const rows = [...history(), tx("2026-10-01", -2500, "income_salary", { pending: true }), tx("2026-10-02", -2500, "income_other")];
    expect(paycheckStats(rows, classOf, OCT25)).toEqual({ found: 0, typical: 2 });
    const old = ["2025-12", "2026-01", "2026-02"].flatMap(m => [tx(`${m}-01`, -1), tx(`${m}-15`, -1)]);
    expect(paycheckStats(old, classOf, OCT25)).toBeNull();
  });

  it("only reports a shortfall from the 20th of the month, with main's wording", () => {
    const rows = [...history(), tx("2026-10-01", -2500)];
    expect(detectIncomeAnomaly(rows, classOf, new Date(2026, 9, 19, 12))).toBeNull();
    expect(detectIncomeAnomaly(rows, classOf, new Date(2026, 9, 20, 12))).toBe(
      "Usually ~2 paychecks land per month based on recent history — only 1 found so far this month. Worth checking for a missing or miscategorized deposit.",
    );
    expect(detectIncomeAnomaly([...rows, tx("2026-10-15", -2500)], classOf, OCT25)).toBeNull();
  });

  it("flags other income within 0.8–1.25× of an average paycheck (exclusive)", () => {
    const b = (salary: number[], other: number) => ({ salary: { amount: salary.reduce((a, c) => a + c, 0), txns: salary.map((_, i) => ({ id: `s${i}`, date: "2026-10-01", amount: 0 })) }, other: { amount: other, txns: [] } });
    expect(detectMisclassifiedPaycheck(b([2500], 2500))).toEqual({ amount: 2500 });
    expect(detectMisclassifiedPaycheck(b([2500], 2000))).toBeNull(); // exactly 0.8
    expect(detectMisclassifiedPaycheck(b([2500], 3125))).toBeNull(); // exactly 1.25
    expect(detectMisclassifiedPaycheck(b([2500], 2100))).toEqual({ amount: 2100 });
    expect(detectMisclassifiedPaycheck(b([], 2500))).toBeNull();
    expect(detectMisclassifiedPaycheck(b([2500], 0))).toBeNull();
  });

  it("buckets this month's posted salary and other income", () => {
    const rows = [tx("2026-10-01", -2500), tx("2026-10-02", -900, "income_salary", { pending: true }), tx("2026-10-03", -40, "income_interest"), tx("2026-10-04", -100, "income_other"), tx("2026-09-30", -2500)];
    const m = monthIncome(rows, classOf, OCT25);
    expect(m.salary.amount).toBe(2500);
    expect(m.salary.txns).toHaveLength(1);
    expect(m.other.amount).toBe(100);
  });

  it("Timeline adapter: misclassified wins over the shortfall; at most one per month; same wording as the inbox", () => {
    const other = tx("2026-10-15", -2450, "income_other");
    const rows = [...history(), tx("2026-10-01", -2500), other];
    const out = findPaycheckAnomalies(rows, classOf, OCT25);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "paycheck_misclassified", month: "2026-10", amount: 2450, on: "2026-10-15", txnIds: [other.id] });
    expect(out[0].text).toBe("Other income ($2,450) is close to a typical paycheck — this might be a second paycheck filed under the wrong category.");
    expect(findPaycheckAnomalies([...history(), tx("2026-10-01", -2500)], classOf, OCT25)).toMatchObject([{ kind: "paycheck_shortfall", found: 1, typical: 2, on: "2026-10-20" }]);
    expect(findPaycheckAnomalies([...history(), tx("2026-10-01", -2500), tx("2026-10-15", -2500)], classOf, OCT25)).toEqual([]);
  });
});

const ev = (id: string, on: string, extra: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id, source: "transaction", source_id: id, occurred_on: on, occurred_at: `${on}T12:00:00.000Z`, category: "spending",
  txn_type: "spend", is_internal: false, title: id, subtitle: null, amount: -10, account_id: "a", status: "posted",
  stream_id: null, pending: false, meta: {}, ...extra,
});
const F = (f: Partial<TimelineFilters> = {}): TimelineFilters => ({ ...DEFAULT_FILTERS, ...f });
const short = { kind: "paycheck_shortfall" as const, month: "2026-10", found: 1, typical: 2, on: "2026-10-20", text: "Usually ~2 …" };

describe("paycheck alerts in the Timeline", () => {
  it("builds a stable Alerts item that can be marked seen", () => {
    const e = paycheckAlertEvent(short);
    expect(e).toMatchObject({ id: "alert:paycheck-shortfall-2026-10", source: "alert", category: "alerts", status: "flag", amount: null, is_internal: false, title: "Paycheck may be missing" });
    expect(e.meta).toMatchObject({ computed: true, alert_type: "paycheck_shortfall", found: 1, typical: 2, detail: short.text });
    expect(paycheckAlertEvent(short, new Set([e.id])).status).toBe("seen");
    const m = paycheckAlertEvent({ kind: "paycheck_misclassified", month: "2026-10", amount: 2450, on: "2026-10-15", txnIds: ["x"], text: "t" });
    expect(m).toMatchObject({ id: "alert:paycheck-misclassified-2026-10", amount: 2450, title: "Paycheck may be miscategorized" });
  });

  it("merges into the loaded range in keyset order and respects filters / jump date", () => {
    const pay = paycheckAlertEvent(short);
    const hist = [ev("a", "2026-10-22"), ev("b", "2026-10-19"), ev("c", "2026-10-10")];
    expect(mergeComputedEvents(hist, [pay], { filters: F(), hasMore: false }).map(e => e.id)).toEqual(["a", pay.id, "b", "c"]);
    expect(mergeComputedEvents(hist, [pay], { filters: F({ chips: ["alerts"] }), hasMore: false }).map(e => e.id)).toContain(pay.id);
    expect(mergeComputedEvents(hist, [pay], { filters: F({ chips: ["income"] }), hasMore: false })).toBe(hist);
    expect(mergeComputedEvents(hist, [pay], { filters: F({ at: "2026-10-19" }), hasMore: false })).toBe(hist);
    // not yet reached by paging: wait for the next page
    expect(mergeComputedEvents([ev("a", "2026-10-22")], [pay], { filters: F(), hasMore: true }).map(e => e.id)).toEqual(["a"]);
    expect(mergeComputedEvents([], [pay], { filters: F({ chips: ["alerts"] }), hasMore: false }).map(e => e.id)).toEqual([pay.id]);
    // no duplicates
    expect(mergeComputedEvents([pay], [pay], { filters: F(), hasMore: false })).toHaveLength(1);
  });

  describe("seen store", () => {
    beforeEach(() => localStorage.clear());
    it("persists per user", () => {
      seenStore.add("u1", "alert:paycheck-shortfall-2026-10");
      expect(seenStore.read("u1").has("alert:paycheck-shortfall-2026-10")).toBe(true);
      expect(seenStore.read("u2").size).toBe(0);
      expect(seenStore.read(null).size).toBe(0);
    });
  });

  it("demo: regular paychecks produce no real anomaly, so one example shortfall is shown", () => {
    const d = demoTimeline("2026-10-20");
    expect(d.paycheck).toEqual([expect.objectContaining({ kind: "paycheck_shortfall", month: "2026-10", on: "2026-10-20" })]);
    expect(demoTimeline("2026-10-05").paycheck[0]).toMatchObject({ month: "2026-09", on: "2026-09-20" });
  });
});
