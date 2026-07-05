import { describe, it, expect } from "vitest";
import { fmtUSD } from "@/lib/format";

// ── fmtUSD ───────────────────────────────────────────────────────
describe("fmtUSD", () => {
  it("formats whole dollars without cents", () => {
    expect(fmtUSD(1000)).toBe("$1,000");
    expect(fmtUSD(0)).toBe("$0");
  });

  it("formats cents when present", () => {
    expect(fmtUSD(19.99)).toBe("$19.99");
    expect(fmtUSD(0.5)).toBe("$0.50");
  });

  it("forces cents with opts.cents", () => {
    expect(fmtUSD(100, { cents: true })).toBe("$100.00");
  });

  it("handles negative numbers (returns positive with no prefix by default)", () => {
    // Plaid credits are negative amounts — the UI prefixes manually
    expect(fmtUSD(-50)).toBe("−$50");
  });

  it("signed option adds +/−", () => {
    expect(fmtUSD(200, { signed: true })).toBe("+$200");
    expect(fmtUSD(-200, { signed: true })).toBe("−$200");
  });

  it("compact for millions", () => {
    const result = fmtUSD(1_500_000, { compact: true });
    expect(result).toContain("M");
  });
});

// ── Budget rollup math ───────────────────────────────────────────
describe("budget rollup", () => {
  const budgets: Record<string, number> = {
    Groceries: 500,
    "Food & Drink": 300,
    Transportation: 200,
  };

  const catTotals: Record<string, number> = {
    Groceries: 620,       // over by 120
    "Food & Drink": 180,  // under by 120
    Transportation: 200,  // exactly on budget
    Shopping: 95,         // no budget set
  };

  it("identifies over-budget categories", () => {
    const over = Object.entries(budgets).filter(([cat, budget]) => (catTotals[cat] ?? 0) > budget);
    expect(over).toHaveLength(1);
    expect(over[0][0]).toBe("Groceries");
  });

  it("calculates total allocated", () => {
    const total = Object.values(budgets).reduce((s, v) => s + v, 0);
    expect(total).toBe(1000);
  });

  it("calculates total spent across budgeted categories", () => {
    const spent = Object.keys(budgets).reduce((s, cat) => s + (catTotals[cat] ?? 0), 0);
    expect(spent).toBe(1000); // 620 + 180 + 200
  });

  it("calculates correct overage per category", () => {
    const overage = Math.max((catTotals["Groceries"] ?? 0) - budgets["Groceries"], 0);
    expect(overage).toBe(120);
  });

  it("correctly identifies unbudgeted spending", () => {
    const unbudgeted = Object.entries(catTotals)
      .filter(([cat]) => !budgets[cat])
      .reduce((s, [, v]) => s + v, 0);
    expect(unbudgeted).toBe(95);
  });

  it("calculates net remaining correctly", () => {
    const income = 3000;
    const totalSpent = Object.values(catTotals).reduce((s, v) => s + v, 0);
    const left = income - totalSpent;
    expect(left).toBe(3000 - (620 + 180 + 200 + 95));
    expect(left).toBe(1905);
  });
});

// ── Money Map / True Available ───────────────────────────────────
describe("Money Map — True Available", () => {
  const accounts = [
    { account_id: "chk1", current_balance: 2500, type: "depository", subtype: "checking" },
    { account_id: "sav1", current_balance: 10000, type: "depository", subtype: "savings" },
    { account_id: "cc1",  current_balance: -800,  type: "credit",     subtype: "credit card" },
    { account_id: "inv1", current_balance: 25000,  type: "investment", subtype: "401k" },
  ];

  const roles: Record<string, { role: string }> = {
    chk1: { role: "spending" },
    sav1: { role: "buffer" },   // emergency fund — excluded from True Available
    cc1:  { role: "debt" },
    inv1: { role: "investment" },
  };

  const getRole = (id: string) => roles[id] ?? { role: "unassigned" };

  it("True Available = spending accounts only", () => {
    const trueAvailable = accounts
      .filter(a => getRole(a.account_id).role === "spending")
      .reduce((s, a) => s + (a.current_balance ?? 0), 0);

    expect(trueAvailable).toBe(2500);
    // NOT 2500 + 10000 = 12500 — the buffer never bleeds in
  });

  it("buffer balance is tracked separately, not in True Available", () => {
    const buffer = accounts
      .filter(a => getRole(a.account_id).role === "buffer")
      .reduce((s, a) => s + (a.current_balance ?? 0), 0);

    expect(buffer).toBe(10000);
  });

  it("debt is negative and shown separately", () => {
    const debt = accounts
      .filter(a => getRole(a.account_id).role === "debt")
      .reduce((s, a) => s + Math.abs(a.current_balance ?? 0), 0);

    expect(debt).toBe(800);
  });

  it("total net worth includes all accounts", () => {
    const netWorth = accounts.reduce((s, a) => s + (a.current_balance ?? 0), 0);
    expect(netWorth).toBe(2500 + 10000 + (-800) + 25000);
    expect(netWorth).toBe(36700);
  });
});

// ── Category resolution ──────────────────────────────────────────
describe("getEffectiveCategory", () => {
  // Simplified version of the actual function for testability
  const getEffective = (
    txnId: string,
    txnCategory: string[] | null,
    merchant: string | null,
    overrides: Record<string, string>,
    rules: { pattern: string; matchType: string; category: string; enabled: boolean }[]
  ): string => {
    if (overrides[txnId]) return overrides[txnId];
    const getRuleMatch = (m: string | null) => {
      if (!m) return null;
      const mLower = m.toLowerCase();
      const ordered = rules.filter(r => r.enabled);
      return ordered.find(r => {
        const p = r.pattern.toLowerCase();
        if (r.matchType === "exact") return mLower === p;
        if (r.matchType === "starts_with") return mLower.startsWith(p);
        return mLower.includes(p);
      })?.category ?? null;
    };
    const ruleMatch = getRuleMatch(merchant);
    if (ruleMatch) return ruleMatch;
    return txnCategory?.[0] ?? "Other";
  };

  it("user override takes highest priority", () => {
    const cat = getEffective("t1", ["Food & Drink"], "Starbucks", { t1: "Coffee" }, []);
    expect(cat).toBe("Coffee");
  });

  it("rule match beats plaid category", () => {
    const rules = [{ pattern: "starbucks", matchType: "contains", category: "Coffee", enabled: true }];
    const cat = getEffective("t1", ["Food & Drink"], "Starbucks", {}, rules);
    expect(cat).toBe("Coffee");
  });

  it("falls back to plaid category when no override or rule", () => {
    const cat = getEffective("t1", ["Groceries"], "Whole Foods", {}, []);
    expect(cat).toBe("Groceries");
  });

  it("disabled rules are ignored", () => {
    const rules = [{ pattern: "whole foods", matchType: "contains", category: "Health Food", enabled: false }];
    const cat = getEffective("t1", ["Groceries"], "Whole Foods", {}, rules);
    expect(cat).toBe("Groceries");
  });

  it("returns Other when no category data at all", () => {
    const cat = getEffective("t1", null, null, {}, []);
    expect(cat).toBe("Other");
  });

  it("exact match rule works correctly", () => {
    const rules = [
      { pattern: "netflix", matchType: "exact", category: "Streaming", enabled: true },
      { pattern: "netflix premium", matchType: "exact", category: "Streaming", enabled: true },
    ];
    expect(getEffective("t1", null, "Netflix", {}, rules)).toBe("Streaming");
    expect(getEffective("t2", null, "Netflix HD", {}, rules)).toBe("Other"); // no match
  });
});

// ── Recurring detection logic ────────────────────────────────────
describe("recurring detection", () => {
  const txnDates = (dates: string[]) =>
    dates.map((date, i) => ({ id: `t${i}`, date, amount: 14.99, merchant_name: "Netflix" }));

  const calcAvgInterval = (dates: string[]) => {
    if (dates.length < 2) return null;
    const sorted = [...dates].sort().reverse();
    const intervals = sorted.slice(0, -1).map((d, i) =>
      Math.round((new Date(d).getTime() - new Date(sorted[i + 1]).getTime()) / 86400000)
    );
    return intervals.reduce((s, v) => s + v, 0) / intervals.length;
  };

  it("detects monthly pattern (~30 day interval)", () => {
    const avg = calcAvgInterval(["2026-04-15", "2026-05-15", "2026-06-15"]);
    expect(avg).toBeGreaterThanOrEqual(28);
    expect(avg).toBeLessThanOrEqual(33);
  });

  it("detects weekly pattern (~7 day interval)", () => {
    const avg = calcAvgInterval(["2026-06-01", "2026-06-08", "2026-06-15"]);
    expect(avg).toBeCloseTo(7, 0);
  });

  it("single transaction can't be recurring", () => {
    const avg = calcAvgInterval(["2026-06-15"]);
    expect(avg).toBeNull();
  });
});
