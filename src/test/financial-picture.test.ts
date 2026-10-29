import { describe, it, expect } from "vitest";
import { taxSnapshot, taxSaved, taxSaverNumbers, matchStatus, bracketRows, federalTax, fica } from "@/lib/picture/tax";
import { whatIf, whatIfLimits } from "@/lib/picture/whatif";
import { coverage, coverageMap, type CoverItem } from "@/lib/picture/coverage";
import { savingsBreakdown, tierOf } from "@/lib/picture/savings-breakdown";
import { riskGaugeValue, riskNote, RISK_LEVELS } from "@/lib/picture/risk";
import { cashflowSteps, flowSplit } from "@/lib/picture/cashflow";
import { TAX_TABLES, taxTable, CURRENT_TAX_YEAR } from "@/lib/tax-tables";
import {
  LOCAL_BUDGETS_KEY, budgetsMigratedKey, parseLocalBudgets, planBudgetMigration,
  isMigrationConfirmed, finishBudgetMigration, readMigrationState,
} from "@/lib/budgets-migration";

const near = (a: number, b: number, eps = 0.01) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("tax tables", () => {
  it("2026 table is keyed by year with sources and IRS Rev. Proc. 2025-32 figures", () => {
    const t = TAX_TABLES[2026];
    expect(CURRENT_TAX_YEAR).toBe(2026);
    expect(t.year).toBe(2026);
    expect(t.sources.length).toBeGreaterThan(0);
    expect(t.brackets.single.map(b => b.upTo).slice(0, 6)).toEqual([12400, 50400, 105700, 201775, 256225, 640600]);
    expect(t.brackets.married_joint.map(b => b.upTo).slice(0, 6)).toEqual([24800, 100800, 211400, 403550, 512450, 768700]);
    expect(t.standardDeduction).toEqual({ single: 16100, married_joint: 32200 });
    expect(t.ssWageBase).toBe(184500);
    expect(t.hsaLimit.self).toBe(4400);
    expect(t.k401Limit).toBe(24500);
  });
  it("falls back to the latest year at or before the one asked for", () => {
    expect(taxTable(2030).year).toBe(2026);
  });
});

describe("tax bracket", () => {
  // The prototype's example: $135k gross, $320/mo HSA, $854/mo 401(k), single.
  const s = taxSnapshot({ gross: 135000, hsa: 3840, k401: 10248, filing: "single" });
  it("taxable = gross − pre-tax − standard deduction", () => {
    expect(s.taxable).toBe(135000 - 3840 - 10248 - 16100);
  });
  it("lands in the 22% bracket with $888 to the 24% bracket", () => {
    expect(s.rate).toBe(0.22);
    expect(s.idx).toBe(2);
    expect(s.toNext).toBe(888);
    expect(s.nextRate).toBe(0.24);
  });
  it("federal tax is progressive", () => {
    near(s.fed, 1240 + 4560 + (104812 - 50400) * 0.22);
    expect(federalTax(0)).toBe(0);
    near(federalTax(12400), 1240);
  });
  it("FICA skips HSA but not 401(k), and stops Social Security at the wage base", () => {
    near(s.fica, (135000 - 3840) * 0.0765);
    near(fica(300000), 184500 * 0.062 + 300000 * 0.0145);
  });
  it("married filing jointly uses the wider brackets", () => {
    const m = taxSnapshot({ gross: 135000, hsa: 3840, k401: 10248, filing: "married_joint" });
    expect(m.taxable).toBe(135000 - 3840 - 10248 - 32200);
    expect(m.rate).toBe(0.12);
  });
  it("top bracket has no next bracket", () => {
    const top = taxSnapshot({ gross: 2_000_000 });
    expect(top.rate).toBe(0.37);
    expect(top.toNext).toBeNull();
    expect(top.nextRate).toBeNull();
  });
  it("bracket rows mark yours", () => {
    const rows = bracketRows("single", 2);
    expect(rows).toHaveLength(7);
    expect(rows[2]).toMatchObject({ lo: 50401, hi: 105700, rate: 0.22, you: true });
    expect(rows.filter(r => r.you)).toHaveLength(1);
  });
  it("zero / bad gross never goes negative", () => {
    const z = taxSnapshot({ gross: 0, hsa: 500 });
    expect(z.taxable).toBe(0);
    expect(z.total).toBe(0);
    expect(taxSnapshot({ gross: NaN }).total).toBe(0);
  });
});

describe("tax savers", () => {
  it("saved = tax without contributions − tax with them", () => {
    const saved = taxSaved(135000, 3840, 10248);
    // Without them taxable is $118,900 (24%): the first $13,200 comes off at 24%,
    // the rest at 22%; the HSA also skips 7.65% FICA.
    const pre = 3840 + 10248;
    near(saved, 13200 * 0.24 + (pre - 13200) * 0.22 + 3840 * 0.0765, 0.5);
  });
  it("max-out shows extra savings and room left, capped at the limits", () => {
    const n = taxSaverNumbers(135000, 3840, 10248);
    expect(n.hsaRoom).toBe(4400 - 3840);
    expect(n.k401Room).toBe(24500 - 10248);
    expect(n.more).toBeGreaterThan(0);
    const over = taxSaverNumbers(135000, 99999, 99999);
    expect(over.hsaRoom).toBe(0);
    expect(over.k401Room).toBe(0);
    near(over.more, 0);
  });
  it("employer match: unanswered, yes (partial), yes (full) and no", () => {
    expect(matchStatus(undefined, 135000, 10248).answered).toBe(false);
    const partial = matchStatus({ answer: "yes", pct: 50, upToPct: 6 }, 100000, 3000);
    expect(partial.yourPct).toBe(3);
    near(partial.worth, 3000);
    near(partial.getting, 1500);
    near(partial.missing, 1500);
    expect(partial.full).toBe(false);
    const full = matchStatus({ answer: "yes", pct: 100, upToPct: 4 }, 100000, 6000);
    expect(full.full).toBe(true);
    near(full.missing, 0);
    expect(matchStatus({ answer: "no" }, 100000, 6000).worth).toBe(0);
  });
});

describe("what-if sliders", () => {
  const base = { gross: 135000, baseK401: 854, baseHsa: 320 };
  it("no change = no delta", () => {
    const r = whatIf({ ...base, k401: 854, hsa: 320 });
    near(r.deltaYear, 0);
    near(r.takeHomeDeltaMonthly, 0);
    near(r.savedYear, taxSaved(135000, 3840, 10248));
  });
  it("+$100/mo 401(k) saves 22% of $1,200 and costs $100 − $22 take-home", () => {
    const r = whatIf({ ...base, k401: 954, hsa: 320 });
    near(r.deltaYear, 1200 * 0.22, 0.5);
    near(r.takeHomeDeltaMonthly, -100 + (1200 * 0.22) / 12, 0.05);
  });
  it("clamps to the IRS limits and zero", () => {
    const lim = whatIfLimits();
    expect(lim.k401Max).toBeCloseTo(24500 / 12);
    expect(lim.hsaMax).toBeCloseTo(4400 / 12);
    expect(lim.k401Step).toBe(10);
    expect(lim.hsaStep).toBe(5);
    const maxed = whatIf({ ...base, k401: 1e9, hsa: 1e9 });
    const atLimit = whatIf({ ...base, k401: lim.k401Max, hsa: lim.hsaMax });
    near(maxed.savedYear, atLimit.savedYear);
    const neg = whatIf({ ...base, k401: -50, hsa: -50 });
    near(neg.savedYear, 0);
    expect(neg.deltaYear).toBeLessThan(0);
  });
  it("reducing contributions raises take-home but lowers savings", () => {
    const r = whatIf({ ...base, k401: 0, hsa: 0 });
    expect(r.deltaYear).toBeLessThan(0);
    expect(r.takeHomeDeltaMonthly).toBeGreaterThan(0);
  });
});

describe("coverage health", () => {
  const items: CoverItem[] = [
    { group: "obligations", id: "mortgage", label: "Mortgage", monthly: 2400, coverId: "chk" },
    { group: "fixed", id: "carins", label: "Car insurance", monthly: 180, coverId: "ins" }, // monthly set-aside counts
    { group: "fixed", id: "gym", label: "Gym", monthly: 60, coverId: null },
    { group: "budgets", id: "dining", label: "Dining", monthly: 300, coverId: "apple" },
    { group: "savings", id: "travel", label: "Travel", monthly: 200, coverId: "chk" },
  ];
  const cards = [
    { id: "amex", label: "Amex Gold", payoffId: "chk" },
    { id: "apple", label: "Apple Card", payoffId: null },
  ];
  const r = coverage(items, cards);
  it("counts items and cards, flags unassigned bills and unpaid cards", () => {
    expect(r.items).toBe(7);
    expect(r.flags.map(f => f.key)).toEqual(["row:fixed:gym", "row:cards:apple"]);
    expect(r.covered).toBe(5);
    expect(r.pct).toBe(Math.round((5 / 7) * 100));
  });
  it("a set-aside account counts as covered", () => {
    expect(r.flags.some(f => f.id === "carins")).toBe(false);
  });
  it("a budget on an unpaid card is a warning, not a flag", () => {
    expect(r.warnings).toEqual([expect.objectContaining({ id: "dining", cardId: "apple" })]);
    expect(r.flags.some(f => f.id === "dining")).toBe(false);
  });
  it("empty is 100%", () => {
    expect(coverage([], []).pct).toBe(100);
  });
  it("coverage map groups by paying account, cards under their payer, the rest in Not covered", () => {
    const m = coverageMap(items, cards, [
      { id: "chk", label: "Checking", kind: "bank" },
      { id: "ins", label: "Insurance fund", kind: "save" },
      { id: "apple", label: "Apple Card", kind: "card" },
    ]);
    expect(m.boxes.map(b => b.account.id)).toEqual(["chk", "ins", "apple"]);
    const chk = m.boxes[0].items.map(i => i.label);
    expect(chk).toEqual(["Mortgage", "→ Travel", "Amex Gold bill"]);
    expect(m.boxes[2].items).toEqual([{ label: "Dining", tone: "warn" }]);
    expect(m.notCovered.map(i => i.label)).toEqual(["Gym", "Apple Card bill"]);
  });
});

describe("savings breakdown", () => {
  const accts = [
    { account_id: "chk", type: "depository", subtype: "checking", current_balance: 5000 },
    { account_id: "hys", type: "depository", subtype: "savings", current_balance: 15000 },
    { account_id: "hsa", type: "depository", subtype: "hsa", current_balance: 8000 },
    { account_id: "edu", type: "investment", subtype: "529", current_balance: 12000 },
    { account_id: "brk", type: "investment", subtype: "brokerage", current_balance: 20000 },
    { account_id: "k401", type: "investment", subtype: "401k", current_balance: 90000 },
    { account_id: "ira", type: "investment", subtype: "roth", current_balance: 10000 },
    { account_id: "amex", type: "credit", subtype: "credit card", current_balance: 1500 },
    { account_id: "mort", type: "loan", subtype: "mortgage", current_balance: 300000 },
    { account_id: "empty", type: "depository", subtype: "savings", current_balance: 0 },
  ];
  it("tiers: cash now, long term, retirement; never credit or loans", () => {
    expect(tierOf(accts[0])).toBe("now");
    expect(tierOf(accts[2])).toBe("long");
    expect(tierOf(accts[3])).toBe("long");
    expect(tierOf(accts[4])).toBe("long");
    expect(tierOf(accts[5])).toBe("ret");
    expect(tierOf(accts[6])).toBe("ret");
    expect(tierOf(accts[7])).toBeNull();
    expect(tierOf(accts[8])).toBeNull();
  });
  it("totals and cash share", () => {
    const b = savingsBreakdown(accts);
    expect(b.tiers).toEqual({ now: 20000, long: 40000, ret: 100000 });
    expect(b.total).toBe(160000);
    expect(b.cashPct).toBe(13);
    expect(b.accounts.now.map(a => a.account.account_id)).toEqual(["hys", "chk"]);
    expect(b.accounts.now.some(a => a.account.account_id === "empty")).toBe(false);
  });
  it("no accounts → zero, no divide by zero", () => {
    expect(savingsBreakdown([])).toMatchObject({ total: 0, cashPct: 0 });
  });
});

describe("risk profile", () => {
  it("uses the approved descriptions and gauge thirds", () => {
    expect(RISK_LEVELS.map(r => r.key)).toEqual(["conservative", "moderate", "aggressive"]);
    expect(RISK_LEVELS[0].desc).toBe("You prefer keeping money safe over growing it fast.");
    expect(riskGaugeValue("conservative")).toBeCloseTo(1 / 6);
    expect(riskGaugeValue("moderate")).toBe(0.5);
    expect(riskGaugeValue("aggressive")).toBeCloseTo(5 / 6);
    expect(riskGaugeValue(undefined)).toBeNull();
  });
  it("flags a mismatch between what you picked and how your money sits", () => {
    expect(riskNote("aggressive", { cashPct: 70, total: 1000 }).mismatch).toBe("more_cautious");
    expect(riskNote("conservative", { cashPct: 10, total: 1000 }).mismatch).toBe("more_growth");
    expect(riskNote("moderate", { cashPct: 10, total: 1000 }).mismatch).toBeNull();
    expect(riskNote("aggressive", { cashPct: 70, total: 0 }).mismatch).toBeNull();
    expect(riskNote(null, { cashPct: 40, total: 1000 }).text).toContain("40%");
  });
});

describe("cash-flow waterfall", () => {
  const input = {
    grossMonthly: 11250, fedMonthly: 1500, ficaMonthly: 830, hsaMonthly: 320, k401Monthly: 854,
    postTaxMonthly: 400, takeHomeMonthly: 7214, bonusMonthly: 400, otherIncomeMonthly: 0,
    obligations: 2700, fixed: 600, budgets: 1500, savings: 1000,
  };
  it("walks gross → take-home → left over, with an Other payroll plug", () => {
    const s = cashflowSteps(input);
    expect(s.map(x => x.key)).toEqual(["gross", "taxes", "pretax", "posttax", "other", "takehome", "bonus", "obligations", "fixed", "budgets", "savings", "left"]);
    near(s.find(x => x.key === "other")!.amount, 11250 - 1500 - 830 - 320 - 854 - 400 - 7214);
    const left = s[s.length - 1];
    expect(left.label).toBe("Left over");
    near(left.amount, 7214 + 400 - 2700 - 600 - 1500 - 1000);
  });
  it("says Short when spending exceeds income", () => {
    const s = cashflowSteps({ ...input, budgets: 9000 });
    expect(s[s.length - 1].label).toBe("Short");
  });
  it("flow split matches the waterfall's left over", () => {
    const f = flowSplit(input);
    near(f.left, 1814);
    expect(f.income).toBe(7614);
  });
});

describe("budget migration (localStorage → server)", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
  };
  it("parses only positive, finite amounts", () => {
    expect(parseLocalBudgets(JSON.stringify({ a: 100, b: -5, c: "x", d: 0, e: 50.5 }))).toEqual({ a: 100, e: 50.5 });
    expect(parseLocalBudgets("not json")).toEqual({});
    expect(parseLocalBudgets(null)).toEqual({});
  });
  it("uploads local-only categories; the server wins on conflicts", () => {
    const p = planBudgetMigration({ Dining: 300, Groceries: 500 }, { Dining: 250 }, false);
    expect(p.toUpload).toEqual({ Groceries: 500 });
    expect(p.merged).toEqual({ Dining: 250, Groceries: 500 });
    expect(p.needsUpload).toBe(true);
  });
  it("nothing to do once migrated or when the server already has everything", () => {
    expect(planBudgetMigration({ A: 1 }, { B: 2 }, true)).toEqual({ merged: { B: 2 }, toUpload: {}, needsUpload: false });
    expect(planBudgetMigration({ A: 1 }, { A: 9 }, false).needsUpload).toBe(false);
    expect(planBudgetMigration({}, null, false).merged).toEqual({});
  });
  it("keeps the local copy until a read-back confirms", () => {
    const s = mem();
    s.setItem(LOCAL_BUDGETS_KEY, JSON.stringify({ Groceries: 500 }));
    const st = readMigrationState(s, "u1");
    expect(st).toEqual({ local: { Groceries: 500 }, migrated: false });
    expect(isMigrationConfirmed({ Groceries: 500 }, {})).toBe(false);
    expect(s.getItem(LOCAL_BUDGETS_KEY)).not.toBeNull();
    expect(isMigrationConfirmed({ Groceries: 500 }, { Groceries: 500, Dining: 1 })).toBe(true);
    finishBudgetMigration(s, "u1");
    expect(s.getItem(LOCAL_BUDGETS_KEY)).toBeNull();
    expect(s.getItem(budgetsMigratedKey("u1"))).not.toBeNull();
    expect(readMigrationState(s, "u1").migrated).toBe(true);
    // Another user on the same device is not marked migrated.
    expect(readMigrationState(s, "u2").migrated).toBe(false);
  });
  it("no storage → treated as migrated (nothing to upload)", () => {
    expect(readMigrationState(undefined, "u1")).toEqual({ local: {}, migrated: true });
  });
});
