/**
 * QA — category resolution and income/expense classification, the inputs
 * to every money total in the app (LivePlaidDashboard.tsx helpers).
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", async () => (await import("./mocks")).inertSupabase());
import { dash, need } from "./internals";
import { txn } from "./fixtures";

type Txn = ReturnType<typeof txn>;
const normalise = need<(c: string[] | null, m?: string | null, n?: string | null) => string>(dash, "normalisePlaidCategory");
const effective = need<(t: Txn, o: Record<string, string>, r: (m: string | null) => string | null) => string | null>(dash, "getEffectiveCategory");
const isIncome = need<(cat: string, custom?: { name: string; type: "income" | "expense" }[], amt?: number) => boolean>(dash, "isIncomeCategory");
const humanize = need<(c: string | null, a: number) => string>(dash, "humanizeCategory");
const noRule = () => null;

describe("QA normalisePlaidCategory", () => {
  it("maps Plaid hierarchies most-specific first", () => {
    expect(normalise(["Transfer", "Payroll"])).toBe("Salary");
    expect(normalise(["Payment", "Credit Card"])).toBe("Credit Card Payment");
    expect(normalise(["Payment", "Rent"])).toBe("Rent");
    expect(normalise(["Transfer", "Third Party", "Venmo"])).toBe("Transfer Out");
    expect(normalise(["Transfer", "Internal Account Transfer"])).toBe("Internal Transfer");
    expect(normalise(["Service", "Financial", "Mortgages"])).toBe("Mortgage");
    expect(normalise(["Tax", "Refund"])).toBe("Refund / Reimbursement");
  });
  it("is case-insensitive on the Plaid strings", () => {
    expect(normalise(["TRANSFER", "payroll"])).toBe("Salary");
  });
  it("null/empty category → Other; unknown → raw first level", () => {
    expect(normalise(null)).toBe("Other");
    expect(normalise([])).toBe("Other");
    expect(normalise(["Weird Bucket"])).toBe("Weird Bucket");
  });
  it("merchant overrides beat Plaid's category (known Plaid ML errors)", () => {
    expect(normalise(["Food and Drink"], "ParkWhiz")).toBe("Transportation");
    expect(normalise(["Shops"], null, "GITHUB SPONSORS")).toBe("Business");
  });
  // Characterization: a bare "Payment" maps to Mortgage, which Home then
  // excludes from "spent this month". Flagged for review, not asserted as a bug.
  it("bare [\"Payment\"] currently resolves to Mortgage (review: very broad)", () => {
    expect(normalise(["Payment"])).toBe("Mortgage");
  });
});

describe("QA getEffectiveCategory priority", () => {
  const t = txn({ id: "t1", amount: 12, date: "2026-10-01", merchant_name: "Starbucks", category: ["Shops"] });
  it("manual override > rule > Plaid", () => {
    expect(effective(t, { t1: "Coffee" }, () => "Dining")).toBe("Coffee");
    expect(effective(t, {}, m => (m === "Starbucks" ? "Dining" : null))).toBe("Dining");
    expect(effective(t, {}, noRule)).toBe(normalise(["Shops"], "Starbucks"));
  });
  it("rules match on merchant_name, falling back to name", () => {
    const n = txn({ amount: 5, date: "2026-10-01", name: "SQ *BLUE BOTTLE", merchant_name: null, category: null });
    expect(effective(n, {}, m => (m === "SQ *BLUE BOTTLE" ? "Coffee" : null))).toBe("Coffee");
  });
});

describe("QA isIncomeCategory (classification by category, not sign)", () => {
  it("income categories are income regardless of sign", () => {
    for (const c of ["Salary", "Freelance Income", "Interest & Dividends", "Transfer In", "Income", "dividends"]) {
      expect(isIncome(c, [], 100)).toBe(true);
      expect(isIncome(c, [], -100)).toBe(true);
    }
  });
  it("a refund (negative amount) in an expense category stays an expense", () => {
    expect(isIncome("Shopping", [], -50)).toBe(false);
    expect(isIncome("Refund / Reimbursement", [], -50)).toBe(false);
  });
  it("transfers out / card payments / internal transfers are never income", () => {
    expect(isIncome("Transfer Out", [], -500)).toBe(false);
    expect(isIncome("Credit Card Payment", [], -300)).toBe(false);
    expect(isIncome("Internal Transfer", [], -500)).toBe(false);
  });
  it("'Other' and unmapped categories fall back to sign", () => {
    expect(isIncome("Other", [], -1000)).toBe(true);
    expect(isIncome("Other", [], 20)).toBe(false);
    expect(isIncome("Savings", [], -10)).toBe(true);
    expect(isIncome("Weird Bucket")).toBe(false);
  });
  it("custom categories use their declared type (case-insensitive)", () => {
    const custom = [{ name: "Side Hustle", type: "income" as const }, { name: "Salary", type: "expense" as const }];
    expect(isIncome("side hustle", custom, 10)).toBe(true);
    expect(isIncome("Salary", custom, -10)).toBe(false);
  });
});

describe("QA humanizeCategory (used by Home's transfer exclusion)", () => {
  it("anything containing 'transfer' becomes Incoming/Outgoing Transfer by sign", () => {
    expect(humanize("Transfer Out", 75)).toBe("Outgoing Transfer");
    expect(humanize("Internal Transfer", -5)).toBe("Incoming Transfer");
  });
  it("Credit Card Payment is NOT humanized as a transfer", () => {
    expect(humanize("Credit Card Payment", 300)).toBe("Credit Card Payment");
  });
  it("null → Other", () => { expect(humanize(null, 1)).toBe("Other"); });
});
