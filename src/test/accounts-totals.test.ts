import { describe, expect, it } from "vitest";
import { netWorthTotals, NET_WORTH_GROUP_ORDER } from "@/lib/accounts/totals";
import type { LinkedAccount, ManualAccountLike } from "@/lib/accounts/types";
import { demoAccounts } from "@/lib/finance-data";

/**
 * Home's net worth exactly as LivePlaidDashboard computed it inline before it
 * moved to src/lib/accounts/totals.ts (main 4656bb6, lines 4876-4903).
 */
function homeNetWorthBefore(accounts: LinkedAccount[], manualAccounts: ManualAccountLike[]) {
  const isDebt = (type: string | null) => type === "credit" || type === "loan";
  const manualAccountNWValue = (a: ManualAccountLike): number => {
    const bal = Number(a.current_balance) || 0;
    if ((a.type === "mortgage" || a.type === "home_loan") && a.property_value) {
      return (Number(a.property_value) || 0) - Math.abs(bal);
    }
    if (a.role === "debt") return -Math.abs(bal);
    return bal;
  };
  const manualAssets = manualAccounts.filter(a => a.role !== "debt" && a.type !== "mortgage" && a.type !== "home_loan").reduce((s, a) => s + (Number(a.current_balance) || 0), 0);
  const manualLiab = manualAccounts.filter(a => a.role === "debt" && a.type !== "mortgage" && a.type !== "home_loan").reduce((s, a) => s + (Number(a.current_balance) || 0), 0);
  const mortgageEquity = manualAccounts.filter(a => a.type === "mortgage" || a.type === "home_loan").reduce((s, a) => s + manualAccountNWValue(a), 0);
  const assets = accounts.filter(a => !isDebt(a.type)).reduce((s, a) => s + (Number(a.current_balance) || 0), 0) + manualAssets + (mortgageEquity > 0 ? mortgageEquity : 0);
  const liabilities = accounts.filter(a => isDebt(a.type)).reduce((s, a) => s + (Number(a.current_balance) || 0), 0) + manualLiab + (mortgageEquity < 0 ? Math.abs(mortgageEquity) : 0);
  return { assets, liabilities, netWorth: assets - liabilities };
}

const acct = (id: string, type: string, subtype: string | null, bal: number | null, extra: Partial<LinkedAccount> = {}): LinkedAccount => ({
  id, account_id: `p-${id}`, name: id, official_name: null, mask: "0000", type, subtype, current_balance: bal, available_balance: null, ...extra,
});
const manual = (id: string, type: string, role: string, bal: number | null, property_value: number | null = null): ManualAccountLike => ({
  id, name: id, institution_name: null, type, role, current_balance: bal, property_value,
});

const linked: LinkedAccount[] = [
  acct("chk", "depository", "checking", 8420.55),
  acct("sav", "depository", "savings", 41300),
  acct("hsa", "depository", "hsa", 2500),
  acct("card", "credit", "credit card", 2840.22),
  acct("card-credit", "credit", "credit card", -35.1), // a card in credit
  acct("auto", "loan", "auto", 9200),
  acct("k401", "investment", "401k", 168420.5),
  acct("nullbal", "depository", "checking", null),
];
const manuals: ManualAccountLike[] = [
  manual("student", "student_loan", "debt", 12400),
  manual("house", "mortgage", "debt", 305000, 420000),
  manual("rental", "home_loan", "debt", 180000, 150000), // underwater
  manual("car", "other", "unassigned", 14000),
  manual("brokerage", "investment", "investment", 54320),
  manual("visa", "credit_card", "debt", 900),
  manual("mtg-no-value", "mortgage", "debt", 50000),
];

describe("accounts/totals: net worth equals Home's", () => {
  const cases: [string, LinkedAccount[], ManualAccountLike[]][] = [
    ["linked only", linked, []],
    ["manual only", [], manuals],
    ["linked + manual", linked, manuals],
    ["empty", [], []],
    ["only an underwater home loan", [], [manual("r", "home_loan", "debt", 200000, 150000)]],
    ["demo data", demoAccounts as unknown as LinkedAccount[], []],
  ];
  for (const [name, a, m] of cases) {
    it(name, () => {
      const before = homeNetWorthBefore(a, m);
      const t = netWorthTotals(a, m);
      expect(t.assets).toBeCloseTo(before.assets, 6);
      expect(t.liabilities).toBeCloseTo(before.liabilities, 6);
      expect(t.netWorth).toBeCloseTo(before.netWorth, 6);
    });
  }

  it("the legend groups add up to net worth", () => {
    const t = netWorthTotals(linked, manuals);
    const sum = NET_WORTH_GROUP_ORDER.reduce((s, g) => s + t.byGroup[g], 0);
    expect(sum).toBeCloseTo(t.netWorth, 6);
    expect(t.byGroup.checking).toBeCloseTo(8420.55, 6);
    expect(t.byGroup.savings).toBeCloseTo(43800, 6);
    expect(t.byGroup.cards).toBeCloseTo(-(2840.22 - 35.1) - 900, 6);
    expect(t.byGroup.investments).toBeCloseTo(168420.5 + 54320, 6);
  });

  it("hidden accounts still count; excludeFromNetWorth leaves them out (linked and manual)", () => {
    const base = netWorthTotals(linked, manuals);
    expect(netWorthTotals(linked, manuals, { chk: { hidden: true } }).netWorth).toBeCloseTo(base.netWorth, 6);
    const noChk = netWorthTotals(linked, manuals, { chk: { hidden: true, excludeFromNetWorth: true } });
    expect(noChk.netWorth).toBeCloseTo(base.netWorth - 8420.55, 6);
    const noCard = netWorthTotals(linked, manuals, { card: { hidden: true, excludeFromNetWorth: true } });
    expect(noCard.liabilities).toBeCloseTo(base.liabilities - 2840.22, 6);
    const noStudent = netWorthTotals(linked, manuals, { "manual:student": { hidden: true, excludeFromNetWorth: true } });
    expect(noStudent.netWorth).toBeCloseTo(base.netWorth + 12400, 6);
  });
});
