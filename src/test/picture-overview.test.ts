/** One Financial Picture overview math (src/lib/picture/overview.ts). Synthetic data. */
import { describe, expect, it } from "vitest";
import { giftCardSummary, netWorthBreakdown, savingsRate, upcomingWindow } from "@/lib/picture/overview";
import type { PAccount } from "@/lib/picture/model";
import type { ReviewItem } from "@/lib/recurring";

const acct = (id: string, type: string, subtype: string, bal: number, name = id): PAccount =>
  ({ id, account_id: id, name, official_name: null, type, subtype, mask: "1234", current_balance: bal });

describe("netWorthBreakdown", () => {
  it("matches Home: credit and loans are owed, the rest are assets", () => {
    const nw = netWorthBreakdown([
      acct("chk", "depository", "checking", 5000), acct("sav", "depository", "savings", 20000),
      acct("card", "credit", "credit card", 1500), acct("mtg", "loan", "mortgage", 300000), acct("brk", "investment", "brokerage", 40000),
    ]);
    expect(nw.assets).toBe(65000);
    expect(nw.liabilities).toBe(301500);
    expect(nw.netWorth).toBe(-236500);
    expect(nw.groups.cash.total).toBe(25000);
    expect(nw.groups.credit.accounts.map(a => a.id)).toEqual(["card"]);
    expect(nw.groups.investments.total).toBe(40000);
  });
  it("manual accounts: debts owed, mortgage counts as equity", () => {
    const nw = netWorthBreakdown([], [
      { id: "h", name: "House", type: "mortgage", role: "debt", current_balance: 250000, property_value: 400000 },
      { id: "c", name: "Car loan", type: "auto_loan", role: "debt", current_balance: 12000 },
      { id: "g", name: "Gold", type: "other", role: "asset", current_balance: 3000 },
    ]);
    expect(nw.assets).toBe(150000 + 3000);
    expect(nw.liabilities).toBe(12000);
    expect(nw.groups.loans.accounts.map(a => a.name)).toEqual(["House", "Car loan"]);
  });
});

describe("savingsRate", () => {
  it("uses gross pay with payroll savings when known", () => {
    expect(savingsRate({ savingsMonthly: 500, payrollSavingsMonthly: 1000, grossMonthly: 10000, takeHomeMonthly: 7000 })).toEqual({ pct: 15, monthly: 1500, basis: "gross" });
  });
  it("falls back to take-home, then to nothing", () => {
    expect(savingsRate({ savingsMonthly: 700, payrollSavingsMonthly: 0, grossMonthly: 0, takeHomeMonthly: 7000 }).pct).toBe(10);
    expect(savingsRate({ savingsMonthly: 0, payrollSavingsMonthly: 0, grossMonthly: 0, takeHomeMonthly: 0 }).pct).toBeNull();
  });
});

const item = (p: Partial<ReviewItem>): ReviewItem => ({
  key: "k", group: "bills", kind: "bill", subtype: null, direction: "outflow", label: "Bill", pattern: "", cadence: "monthly", amount: 100,
  amountKind: "fixed", amountRange: [100, 100], monthly: 100, lastSeen: "2026-10-01", nextDue: "2026-11-01", occurrences: 3, confidence: 1,
  transactionIds: [], matched: [], accountId: null, coverAccountId: null, coverUserSet: false, status: "confirmed", edited: false, missed: false,
  daysLate: null, why: "", detected: null, renamed: false, autoLabel: String(p.label ?? "Item"), expectedAmount: null, patternLine: "", estimated: false, estimateNote: null, ...p,
});

describe("upcomingWindow", () => {
  it("runs bills and pay against today's cash and finds the low point", () => {
    const w = upcomingWindow({
      today: "2026-10-20", startCash: 1000,
      items: [
        item({ key: "rent", label: "Rent", amount: 1500, nextDue: "2026-11-01" }),
        item({ key: "pay", label: "Pay", direction: "inflow", group: "income", kind: "salary", cadence: "biweekly", amount: 2000, nextDue: "2026-10-24" }),
        item({ key: "gone", label: "Gone", status: "dismissed", nextDue: "2026-10-25" }),
      ],
    });
    expect(w.events.map(e => `${e.date} ${e.label}`)).toEqual(["2026-10-24 Pay", "2026-11-01 Rent", "2026-11-07 Pay"]);
    expect(w.inflow).toBe(4000);
    expect(w.outflow).toBe(1500);
    expect(w.endCash).toBe(3500);
    expect(w.low).toEqual({ date: "2026-10-20", balance: 1000 });
    expect(w.shortfallOn).toBeNull();
  });
  it("flags a shortfall and counts a few-days-late item as due now", () => {
    const w = upcomingWindow({ today: "2026-10-20", startCash: 100, items: [item({ amount: 300, nextDue: "2026-10-17" })] });
    expect(w.events[0].date).toBe("2026-10-20");
    expect(w.shortfallOn).toBe("2026-10-20");
    expect(w.low.balance).toBe(-500); // late one today, then the next monthly one on Nov 17
  });
  it("includes the person's own bills with a due day", () => {
    const w = upcomingWindow({ today: "2026-10-20", startCash: 0, items: [], manualItems: [{ id: "gym", label: "Gym", monthly: 60, dueDay: 3 }] });
    expect(w.events.map(e => e.date)).toEqual(["2026-11-03"]);
  });
  it("semi-monthly pay lands twice", () => {
    const w = upcomingWindow({ today: "2026-10-20", startCash: 0, items: [item({ direction: "inflow", cadence: "semimonthly", amount: 3000, nextDue: "2026-10-31" })] });
    expect(w.events.map(e => e.date)).toEqual(["2026-10-31", "2026-11-15"]);
  });
});

describe("giftCardSummary", () => {
  it("totals active cards by issuer and counts expiring ones", () => {
    const s = giftCardSummary([
      { id: "1", brand_name: "IKEA", balance: 40, expiry_date: "2026-11-01" },
      { id: "2", brand_name: "ikea", balance: "10.5" },
      { id: "3", brand_name: "REI", balance: 20, expiry_date: "2026-10-01" },
      { id: "4", brand_name: "Lowe's", balance: 0 },
      { id: "5", brand_name: "Target", balance: 25, archived_at: "2026-10-01" },
      { id: "6", brand_name: "Best Buy", balance: 80, deleted_at: "2026-10-01" },
    ], "2026-10-20");
    expect(s).toMatchObject({ total: 70.5, count: 3, expiringSoon: 1, expired: 1 });
    expect(s.issuers[0]).toEqual({ name: "IKEA", total: 50.5, count: 2 });
  });
});
