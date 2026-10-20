/**
 * QA — period/date math: getPeriodRange/filterByPeriod (Home + legacy
 * spending tab) and SpendingBudgetView's month/day/week buckets.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@/integrations/supabase/client", async () => (await import("./mocks")).inertSupabase());
import { dash, spendView, need } from "./internals";
import { txn } from "./fixtures";

type P = { granularity: "day" | "week" | "month" | "year"; offset: number };
const range = need<(p: P) => { start: Date; end: Date }>(dash, "getPeriodRange");
const label = need<(p: P) => string>(dash, "getPeriodLabel");
const filter = need<(t: ReturnType<typeof txn>[], p: P) => ReturnType<typeof txn>[]>(dash, "filterByPeriod");
const months = need<(n: number) => { key: string; start: string; end: string; label: string }[]>(spendView, "monthBucketsList");
const weeks = need<(n: number) => { start: string; end: string }[]>(spendView, "weekBucketsList");
const at = (iso: string) => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(iso)); };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
afterEach(() => { vi.useRealTimers(); });

describe("QA getPeriodRange / filterByPeriod", () => {
  it("month: 1st 00:00 → last day 23:59:59.999, offsets cross year boundaries", () => {
    at("2026-10-20T12:00:00-04:00");
    const r = range({ granularity: "month", offset: 0 });
    expect([ymd(r.start), ymd(r.end)]).toEqual(["2026-10-01", "2026-10-31"]);
    const back = range({ granularity: "month", offset: -10 });
    expect([ymd(back.start), ymd(back.end)]).toEqual(["2025-12-01", "2025-12-31"]);
    expect(label({ granularity: "month", offset: 0 })).toBe("October 2026");
  });
  it("Feb in a leap year ends on the 29th", () => {
    at("2028-02-10T12:00:00-05:00");
    expect(ymd(range({ granularity: "month", offset: 0 }).end)).toBe("2028-02-29");
  });
  it("week runs Sunday→Saturday", () => {
    at("2026-10-20T12:00:00-04:00"); // Tuesday
    const r = range({ granularity: "week", offset: 0 });
    expect([ymd(r.start), ymd(r.end)]).toEqual(["2026-10-18", "2026-10-24"]);
  });
  it("filterByPeriod includes the first and last day of the month and nothing outside", () => {
    at("2026-10-20T12:00:00-04:00");
    const t = ["2026-09-30", "2026-10-01", "2026-10-31", "2026-11-01"].map(date => txn({ amount: 1, date, id: date }));
    expect(filter(t, { granularity: "month", offset: 0 }).map(x => x.id)).toEqual(["2026-10-01", "2026-10-31"]);
  });
  it("day labels", () => {
    at("2026-10-20T12:00:00-04:00");
    expect(label({ granularity: "day", offset: 0 })).toBe("Today");
    expect(label({ granularity: "day", offset: -1 })).toBe("Yesterday");
  });
});

describe("QA SpendingBudgetView buckets (America/New_York)", () => {
  it("12 month buckets ending with the current month, ISO start/end", () => {
    at("2026-10-20T12:00:00-04:00");
    const m = months(12);
    expect(m).toHaveLength(12);
    expect(m[11]).toMatchObject({ key: "2026-10", start: "2026-10-01", end: "2026-10-31", label: "Oct" });
    expect(m[0]).toMatchObject({ key: "2025-11", start: "2025-11-01", end: "2025-11-30" });
  });
  it("week buckets run Monday→Sunday (note: Home's getPeriodRange weeks run Sunday→Saturday)", () => {
    at("2026-10-20T12:00:00-04:00");
    const w = weeks(1)[0];
    expect([w.start, w.end]).toEqual(["2026-10-19", "2026-10-25"]);
  });
});

describe("QA timezone sensitivity", () => {
  const withTZ = (tz: string, fn: () => void) => {
    const prev = process.env.TZ; process.env.TZ = tz;
    try { fn(); } finally { process.env.TZ = prev; }
  };
  // KNOWN BUG: monthBucketsList builds local-midnight Dates and then slices
  // toISOString() (UTC). East of UTC that shifts every bucket back a day, so
  // "October" becomes Sep 30 → Oct 30 and Oct 31 spend disappears from the
  // Spending page while Home (local-date parsing) still counts it.
  it.fails("KNOWN BUG month buckets are correct east of UTC (Asia/Kolkata)", () => {
    withTZ("Asia/Kolkata", () => {
      at("2026-10-20T12:00:00+05:30");
      expect(months(1)[0]).toMatchObject({ start: "2026-10-01", end: "2026-10-31" });
    });
  });
  // Budget's 12-month lookback on the 31st is now tested against the real
  // BudgetPage render in budget-lookback.test.tsx (this file used to
  // re-implement the old loop, which tested nothing in the app).
});
