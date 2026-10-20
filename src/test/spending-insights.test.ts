import { describe, it, expect } from "vitest";
import { classifyTxn, countsAsSpend, detectTxnFlags, normalizeMerchant, projectMonthEnd, dailyTotals, cumulative, withAlpha, fmtShortDate } from "@/lib/spending-insights";

const tx = (id: string, date: string, amount: number, name: string, account_id = "a1", pending = false) =>
  ({ id, account_id, amount, date, name, merchant_name: name, pending });

describe("spending-insights", () => {
  it("normalizes merchant names", () => {
    expect(normalizeMerchant("STARBUCKS #1234 NEW YORK")).toBe("starbucks");
    expect(normalizeMerchant("Uber Eats")).toBe("uber eats");
  });

  it("flags a same-amount same-merchant charge within 3 days as a possible duplicate", () => {
    const flags = detectTxnFlags([
      tx("1", "2026-10-10", 34.5, "Starbucks"),
      tx("2", "2026-10-11", 34.5, "Starbucks"),
      tx("3", "2026-10-20", 34.5, "Starbucks"),
      tx("4", "2026-10-11", 34.5, "Starbucks", "a2"),
    ], { isExpense: () => true, label: t => t.merchant_name ?? "" });
    expect(flags.get("1")).toBeUndefined();
    expect(flags.get("2")).toBe("duplicate");
    expect(flags.get("3")).toBeUndefined();
    expect(flags.get("4")).toBeUndefined();
  });

  it("flags brokerage deposits as likely transfers, skipping excluded/internal ids and income", () => {
    const flags = detectTxnFlags([
      tx("r", "2026-10-05", 500, "ROBINHOOD DES:FUNDS"),
      tx("i", "2026-10-05", 500, "Vanguard Buy"),
      tx("n", "2026-10-05", -500, "Transfer from savings"),
    ], { isExpense: t => Number(t.amount) > 0, label: t => t.name ?? "", excludeIds: new Set(["i"]) });
    expect(flags.get("r")).toBe("transfer");
    expect(flags.has("i")).toBe(false);
    expect(flags.has("n")).toBe(false);
  });

  it("projects month-end spend linearly", () => {
    expect(projectMonthEnd(1000, 10, 31)).toBeCloseTo(3100);
    expect(projectMonthEnd(50, 0, 30)).toBe(50);
  });

  it("buckets daily totals and accumulates", () => {
    const d = dailyTotals([tx("1", "2026-02-01", 10, "x"), tx("2", "2026-02-01", 5, "y"), tx("3", "2026-03-01", 99, "z")], 2026, 1);
    expect(d.length).toBe(28);
    expect(d[0]).toBe(15);
    expect(cumulative([1, 2, 3])).toEqual([1, 3, 6]);
  });

  it("adds alpha to hsl colors and formats dates consistently", () => {
    expect(withAlpha("hsl(155 18% 42%)", 0.2)).toBe("hsl(155 18% 42% / 0.2)");
    expect(fmtShortDate("2026-10-18", new Date("2026-10-20T12:00:00"))).toBe("Oct 18");
    expect(fmtShortDate("2025-10-18", new Date("2026-10-20T12:00:00"))).toBe("Oct 18, 2025");
  });
});

describe("classifyTxn", () => {
  const t = (name: string, amount = 100) => ({ name, merchant_name: null, amount });
  const exp = { internal: false, income: false };
  it("separates card payments, internal transfers, savings and P2P from spend", () => {
    expect(classifyTxn("Credit Card Payment", t("CHASE AUTOPAY"), exp)).toBe("credit-card-payment");
    expect(classifyTxn("Transfer Out", t("ROBINHOOD DES:FUNDS"), exp)).toBe("savings-contribution");
    expect(classifyTxn("Transfer Out", t("VENMO PAYMENT"), exp)).toBe("transfer-out");
    expect(classifyTxn("Transfer In", t("ZELLE FROM ALEX", -60), { internal: false, income: true })).toBe("transfer-in");
    expect(classifyTxn("Groceries", t("Whole Foods"), { internal: true, income: false })).toBe("transfer-internal");
    expect(classifyTxn("Internal Transfer", t("ONLINE TRANSFER"), exp)).toBe("transfer-internal");
    expect(classifyTxn("Salary", t("Employer", -5000), { internal: false, income: true })).toBe("income-salary");
  });
  it("keeps explicitly categorized spend as spend-like even if the text looks like a transfer", () => {
    expect(classifyTxn("Shopping", t("FIDELITY INVESTMENTS"), exp)).toBe("spend");
    expect(classifyTxn("Bills & Utilities", t("Con Ed"), exp)).toBe("obligation-bill");
    expect(countsAsSpend(classifyTxn("Mortgage", t("Rocket"), exp))).toBe(true);
    expect(countsAsSpend(classifyTxn("Transfer Out", t("VENMO"), exp))).toBe(false);
  });
});
