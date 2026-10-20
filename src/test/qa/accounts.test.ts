/**
 * QA — account grouping (mapBucket/isDebt/looksLikeSavings) and the
 * demo-data account totals shown on Home.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", async () => (await import("./mocks")).inertSupabase());
import { dash, need } from "./internals";
import { demoAccounts } from "@/lib/finance-data";
import { estimateRemainingBalance } from "@/hooks/useManualAccounts";

const mapBucket = need<(t: string | null, s: string | null) => string>(dash, "mapBucket");
const isDebt = need<(t: string | null) => boolean>(dash, "isDebt");
const looksLikeSavings = need<(a: { name: string | null; official_name: string | null; subtype: string | null }) => boolean>(dash, "looksLikeSavings");

describe("QA mapBucket", () => {
  it.each([
    ["credit", "credit card", "credit"], ["loan", "mortgage", "loan"], ["loan", "auto", "loan"],
    ["investment", "401k", "investment"], ["depository", "checking", "cash"], ["depository", "savings", "cash"],
    ["depository", "money market", "cash"], ["depository", "hsa", "cash"], ["depository", "cd", "other"],
    [null, null, "other"], ["depository", "Checking", "cash"],
  ])("type=%s subtype=%s → %s", (t, s, want) => { expect(mapBucket(t, s)).toBe(want); });
});

describe("QA isDebt / looksLikeSavings", () => {
  it("only credit and loan are liabilities", () => {
    expect(isDebt("credit")).toBe(true);
    expect(isDebt("loan")).toBe(true);
    for (const t of ["depository", "investment", null, "other"]) expect(isDebt(t)).toBe(false);
  });
  it("detects savings by subtype or name keyword", () => {
    expect(looksLikeSavings({ name: "Marcus HYSA", official_name: null, subtype: "checking" })).toBe(true);
    expect(looksLikeSavings({ name: "Main", official_name: null, subtype: "savings" })).toBe(true);
    expect(looksLikeSavings({ name: "Everyday Checking", official_name: null, subtype: "checking" })).toBe(false);
  });
});

describe("QA demo account totals (what /demo Home must show)", () => {
  const sum = (f: (a: (typeof demoAccounts)[number]) => boolean) =>
    Math.round(demoAccounts.filter(f).reduce((s, a) => s + (a.current_balance ?? 0), 0) * 100) / 100;
  it("assets, liabilities and net worth", () => {
    const assets = sum(a => !isDebt(a.type));
    const liab = sum(a => isDebt(a.type));
    expect(assets).toBe(292461.05);
    expect(liab).toBe(13160.62);
    expect(Math.round((assets - liab) * 100) / 100).toBe(279300.43);
  });
  it("group subtotals: cash 69,720.55 · credit 3,960.62 · loans 9,200 · investments 222,740.50", () => {
    expect(sum(a => mapBucket(a.type, a.subtype) === "cash")).toBe(69720.55);
    expect(sum(a => mapBucket(a.type, a.subtype) === "credit")).toBe(3960.62);
    expect(sum(a => mapBucket(a.type, a.subtype) === "loan")).toBe(9200);
    expect(sum(a => mapBucket(a.type, a.subtype) === "investment")).toBe(222740.5);
  });
});

describe("QA estimateRemainingBalance (manual loans)", () => {
  it("is ~original balance at start and 0 after the term", () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-20T12:00:00-04:00"));
    const fresh = estimateRemainingBalance(300000, 6, 30, "2026-10-01")!;
    expect(fresh.balance).toBeCloseTo(300000, 0);
    expect(fresh.monthsRemaining).toBe(360);
    const done = estimateRemainingBalance(10000, 5, 1, "2020-01-01")!;
    expect(done.balance).toBe(0);
    expect(done.monthsRemaining).toBe(0);
    vi.useRealTimers();
  });
  it("12 months into a 30y 6% $300k mortgage ≈ $296,316", () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-20T12:00:00-04:00"));
    expect(estimateRemainingBalance(300000, 6, 30, "2025-10-01")!.balance).toBeCloseTo(296315.9, -1);
    vi.useRealTimers();
  });
  // KNOWN GAP: a 0% loan returns null, so 0%-APR auto loans get no estimate.
  it.fails("KNOWN GAP 0% APR loans should still amortize linearly", () => {
    expect(estimateRemainingBalance(12000, 0, 1, "2026-10-01")).not.toBeNull();
  });
});
