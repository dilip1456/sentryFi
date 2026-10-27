import { describe, it, expect } from "vitest";
import { classifyTxn, countsAsSpend, categoryCountsAsSpend, detectTxnFlags, normalizeMerchant, projectMonthEnd, dailyTotals, cumulative, withAlpha, fmtShortDate } from "@/lib/spending-insights";

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

describe("classifyTxn (delegates to the shared classifier)", () => {
  const t = (name: string, amount = 100) => ({ id: name, account_id: "chk", date: "2026-10-10", name, merchant_name: null, amount });
  const c = (category: string, name: string, amount = 100, extra: Partial<Parameters<typeof classifyTxn>[1]> = {}) =>
    classifyTxn(t(name, amount), { category, ...extra });
  it("separates card payments, internal transfers and savings from spend", () => {
    expect(c("Credit Card Payment", "CHASE AUTOPAY")).toBe("credit_card_payment");
    expect(c("Transfer Out", "ROBINHOOD DES:FUNDS")).toBe("savings_contribution");
    expect(c("Groceries", "Whole Foods", 100, { internal: true })).toBe("transfer_internal");
    expect(c("Internal Transfer", "ONLINE TRANSFER")).toBe("transfer_internal");
    expect(c("Salary", "Employer", -5000)).toBe("income_salary");
  });
  it("follows the shared definitions for people and brokerages", () => {
    // P2P with other people is a transfer: neither spending nor income
    expect(c("Transfer Out", "VENMO PAYMENT")).toBe("transfer_out");
    expect(c("Transfer In", "ZELLE FROM ALEX", -60)).toBe("transfer_in");
    // brokerage funding beats a merchant category
    expect(c("Shopping", "FIDELITY INVESTMENTS")).toBe("savings_contribution");
    // an unmatched, non-P2P transfer is left for review
    expect(c("Transfer Out", "ONLINE TRANSFER TO 1234")).toBe("transfer_out");
  });
  it("keeps explicitly categorized obligations as spending", () => {
    expect(c("Bills & Utilities", "Con Ed")).toBe("obligation_bill");
    expect(countsAsSpend(c("Mortgage", "Rocket"))).toBe(true);
    expect(countsAsSpend(c("Credit Card Payment", "CHASE AUTOPAY"))).toBe(false);
  });
  it("prefers a precomputed classification (overrides, pairs) when given", () => {
    expect(c("Groceries", "Whole Foods", 100, { classification: { type: "transfer_internal", source: "override", reason: "" } })).toBe("transfer_internal");
  });
  it("tells budgetable categories apart", () => {
    expect(categoryCountsAsSpend("Groceries")).toBe(true);
    expect(categoryCountsAsSpend("Some custom thing")).toBe(true);
    expect(categoryCountsAsSpend("Credit Card Payment")).toBe(false);
    expect(categoryCountsAsSpend("Internal Transfer")).toBe(false);
  });
});
