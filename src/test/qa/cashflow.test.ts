/**
 * QA — monthly income / spend / net cash flow helpers and the spend-trend
 * (MoM) helper, using the real helpers from LivePlaidDashboard.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@/integrations/supabase/client", async () => (await import("./mocks")).inertSupabase());
import { dash, need } from "./internals";
import { txn, QA_NOW, octoberMix } from "./fixtures";

type Txn = ReturnType<typeof txn>;
type Flow = { m: string; income: number; spend: number };
const monthlyFlow = need<(t: Txn[], o: Record<string, string>, r: (m: string | null) => string | null, c?: unknown[]) => Flow[]>(dash, "buildMonthlyFlow");
const spendTrends = need<(t: Txn[], o: Record<string, string>, r: (m: string | null) => string | null, ids: Set<string>, c?: unknown[]) => { category: string; thisMonth: number; lastMonth: number; delta: number; pct: number | null }[]>(dash, "buildSpendTrends");
const detect = need<(t: Txn[]) => Set<string>>(dash, "detectInternalTransfers");
const noRule = () => null;

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(QA_NOW); });
afterEach(() => { vi.useRealTimers(); });

describe("QA buildMonthlyFlow (Home cash-flow chart)", () => {
  it("returns the last 6 calendar months ending with the current one", () => {
    const f = monthlyFlow([], {}, noRule);
    expect(f.map(x => x.m)).toEqual(["May", "Jun", "Jul", "Aug", "Sep", "Oct"]);
    expect(f.every(x => x.income === 0 && x.spend === 0)).toBe(true);
  });
  it("income = |money in| in income categories; spend nets refunds; rounded to dollars", () => {
    const f = monthlyFlow([
      txn({ amount: -3000.4, date: "2026-10-01", category: ["Salary"] }),
      txn({ amount: 200.25, date: "2026-10-03", category: ["Shopping"] }),
      txn({ amount: -50, date: "2026-10-04", category: ["Shopping"] }),
      txn({ amount: 80, date: "2026-09-30", category: ["Groceries"] }),
    ], {}, noRule);
    const oct = f[5], sep = f[4];
    expect(oct.income).toBe(3000);
    expect(oct.spend).toBe(150);
    expect(sep.spend).toBe(80);
  });
  it("month boundaries use local dates (Oct 1 / Sep 30 in America/New_York)", () => {
    const f = monthlyFlow([txn({ amount: 10, date: "2026-10-01", category: ["Groceries"] }), txn({ amount: 20, date: "2026-09-30", category: ["Groceries"] })], {}, noRule);
    expect(f[5].spend).toBe(10);
    expect(f[4].spend).toBe(20);
  });
  // KNOWN BUG: the 6-month chart is a THIRD definition of "spend". It never
  // receives internalTxnIds and has no ignored/transfer/obligation filter, so
  // for octoberMix it reports $2,165 (includes the card payment, mortgage,
  // Venmo and both internal-transfer legs) vs $590 on Home and $1,865 on
  // Spending. Once totals are unified all three should agree.
  it.fails("KNOWN BUG chart spend should equal Home 'spent this month' for the same month", () => {
    const f = monthlyFlow(octoberMix, {}, noRule);
    expect(f[5].spend).toBe(590);
  });
});

describe("QA net cash flow & savings rate (Home strip formula)", () => {
  // Home: net = curMonthIncome − totalSpend; savingsRate = round(net / income * 100), null when income = 0.
  const rate = (income: number, spend: number) => (income > 0 ? Math.round(((income - spend) / income) * 100) : null);
  it("matches the demo numbers shown on Home", () => {
    expect(10480 - 4196.61).toBeCloseTo(6283.39, 2);
    expect(rate(10480, 4196.61)).toBe(60);
  });
  it("no income → no savings rate (not NaN / -Infinity)", () => {
    expect(rate(0, 500)).toBeNull();
  });
  it("overspending gives a negative rate", () => {
    expect(rate(1000, 1500)).toBe(-50);
  });
});

describe("QA buildSpendTrends (month-over-month per category)", () => {
  it("excludes internal transfers and income, nets refunds, computes delta and pct", () => {
    const txns = [
      txn({ id: "a", amount: 300, date: "2026-10-05", category: ["Shopping"] }),
      txn({ id: "r", amount: -100, date: "2026-10-06", category: ["Shopping"] }),
      txn({ id: "b", amount: 100, date: "2026-09-05", category: ["Shopping"] }),
      txn({ id: "s", amount: -3000, date: "2026-10-01", category: ["Salary"] }),
      txn({ id: "x1", account_id: "chk", amount: 500, date: "2026-10-09", name: "Transfer", category: ["Transfer"] }),
      txn({ id: "x2", account_id: "sav", amount: -500, date: "2026-10-09", name: "Transfer", category: ["Transfer"] }),
    ];
    const tr = spendTrends(txns, {}, noRule, detect(txns));
    expect(tr).toEqual([{ category: "Shopping", thisMonth: 200, lastMonth: 100, delta: 100, pct: 100 }]);
  });
  it("pct is null when there was no spend last month", () => {
    const tr = spendTrends([txn({ amount: 40, date: "2026-10-02", category: ["Groceries"] })], {}, noRule, new Set());
    expect(tr[0].pct).toBeNull();
  });
  it("January compares against December of the previous year", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00-05:00"));
    const tr = spendTrends([
      txn({ amount: 50, date: "2026-01-03", category: ["Groceries"] }),
      txn({ amount: 25, date: "2025-12-20", category: ["Groceries"] }),
    ], {}, noRule, new Set());
    expect(tr[0]).toMatchObject({ thisMonth: 50, lastMonth: 25, pct: 100 });
  });
});
