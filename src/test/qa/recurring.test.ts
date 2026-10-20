/**
 * QA — recurring-charge detection (detectRecurring, used by Home "Upcoming
 * Charges") and the Budget/Spending cadence classifiers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@/integrations/supabase/client", async () => (await import("./mocks")).inertSupabase());
import { dash, spendView, budgetPage, need } from "./internals";
import { txn, QA_NOW } from "./fixtures";

type Txn = ReturnType<typeof txn>;
type Rec = { merchant: string; avgAmount: number; intervalLabel: string; predictedDate: Date; accountId: string };
const detect = need<(t: Txn[], internal?: Set<string>, sm?: Set<string>, sc?: Set<string>) => Rec[]>(dash, "detectRecurring");
const series = (merchant: string, amount: number, dates: string[], extra: Partial<Txn> = {}) =>
  dates.map(date => txn({ amount, date, merchant_name: merchant, category: ["Entertainment"], account_id: "acc_card", ...extra }));

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(QA_NOW); });
afterEach(() => { vi.useRealTimers(); });

describe("QA detectRecurring", () => {
  it("finds a monthly subscription due in the next 15 days and predicts the date", () => {
    const r = detect(series("Netflix", 15.49, ["2026-07-03", "2026-08-03", "2026-09-03", "2026-10-03"]));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ merchant: "Netflix", intervalLabel: "Monthly", accountId: "acc_card" });
    expect(r[0].avgAmount).toBeCloseTo(15.49, 2);
    expect(r[0].predictedDate.toISOString().slice(0, 10)).toBe("2026-11-02"); // last seen + 30d
  });
  it("finds weekly charges", () => {
    const r = detect(series("Planet Fitness", 10, ["2026-09-29", "2026-10-06", "2026-10-13"]));
    expect(r[0]?.intervalLabel).toBe("Weekly");
  });
  it("requires ≥3 occurrences", () => {
    expect(detect(series("Netflix", 15.49, ["2026-09-03", "2026-10-03"]))).toHaveLength(0);
  });
  it("rejects inconsistent amounts (>35% spread)", () => {
    const t = [...series("Utility Co", 50, ["2026-07-05", "2026-08-05"]), ...series("Utility Co", 120, ["2026-09-05", "2026-10-05"])];
    expect(detect(t)).toHaveLength(0);
  });
  it("ignores groceries/dining/parking, card payments, pending rows, refunds and internal transfers", () => {
    const d = ["2026-07-04", "2026-08-04", "2026-09-04", "2026-10-04"];
    expect(detect(series("Kroger", 80, d, { category: ["Groceries"] }))).toHaveLength(0);
    expect(detect(series("Chase Autopay", 300, d, { category: ["Payment"] , name: "AUTOPAY" }))).toHaveLength(0);
    expect(detect(series("Hulu", 13.99, d, { pending: true }))).toHaveLength(0);
    expect(detect(series("Hulu", -13.99, d))).toHaveLength(0);
    const s = series("Hulu", 13.99, d);
    expect(detect(s, new Set(s.map(x => x.id)))).toHaveLength(0);
  });
  it("respects user-suppressed merchants", () => {
    const s = series("Hulu", 13.99, ["2026-07-04", "2026-08-04", "2026-09-04", "2026-10-04"]);
    expect(detect(s, new Set(), new Set(["hulu"]))).toHaveLength(0);
  });
  it("drops inactive series (last seen > 2.5 intervals ago)", () => {
    expect(detect(series("Old Gym", 30, ["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01"]))).toHaveLength(0);
  });
  it("demo data produces finite recurring amounts (no NaN in Upcoming Charges)", async () => {
    const { demoTransactions } = await import("@/lib/finance-data");
    // demo data is generated relative to real "now" at import; only assert shape
    const r = detect(demoTransactions as unknown as Txn[]);
    for (const x of r) expect(Number.isFinite(x.avgAmount)).toBe(true);
  });
});

describe("QA cadence classifiers", () => {
  const sv = need<(g: number) => string | null>(spendView, "classifyRecurrenceFrequency");
  const bp = need<(g: number) => string | null>(budgetPage, "classifyFrequency");
  const mult = need<Record<string, number>>(budgetPage, "FREQ_MONTHLY_MULT");
  it.each([[7, "Weekly"], [14, "Biweekly"], [30, "Monthly"], [91, "Quarterly"], [365, "Yearly"], [20, null], [60, null]])(
    "avg gap %d days → %s (Spending and Budget agree)", (g, want) => {
      expect(sv(g)).toBe(want);
      expect(bp(g)).toBe(want ? want.toLowerCase() : null);
    });
  it("monthly-equivalent multipliers", () => {
    // 365.25 / 7 / 12 ≈ 4.348 weeks per month
    expect(mult.weekly).toBeCloseTo(365.25 / 7 / 12, 1);
    expect(mult.biweekly).toBeCloseTo(365.25 / 14 / 12, 1);
    expect(mult.monthly).toBe(1);
    expect(mult.quarterly).toBeCloseTo(1 / 3, 5);
    expect(mult.yearly).toBeCloseTo(1 / 12, 5);
  });
});
