import { describe, expect, it } from "vitest";
import {
  buildAccountViews, creditLimitOf, groupByBank, groupByType, identifierOf, rowFact, utilizationTone, MANUAL_BANK,
} from "@/lib/accounts/grouping";
import { apyFindings, comingDue, dormantFindings, duplicateFindings } from "@/lib/accounts/findings";
import type { CreditDetailLike, InstitutionItem, LinkedAccount, ManualAccountLike } from "@/lib/accounts/types";

const TODAY = new Date(2026, 10, 18, 12); // Nov 18, 2026
const items: InstitutionItem[] = [
  { id: "i-chase", item_id: "x1", institution_name: "Chase", created_at: "2024-01-01T00:00:00Z" },
  { id: "i-ally", item_id: "x2", institution_name: "Ally Bank", created_at: "2024-02-01T00:00:00Z" },
  { id: "i-fid", item_id: "x3", institution_name: "Fidelity", created_at: "2024-03-01T00:00:00Z" },
  { id: "i-chase2", item_id: "x4", institution_name: "Chase", created_at: "2026-06-01T00:00:00Z" },
];
const a = (id: string, item: string, type: string, subtype: string, bal: number, extra: Partial<LinkedAccount> = {}): LinkedAccount => ({
  id, account_id: `p-${id}`, name: id, official_name: null, mask: id.slice(-4), type, subtype, current_balance: bal, available_balance: null, item_id: item, ...extra,
});
const accounts: LinkedAccount[] = [
  a("chk-4410", "i-chase", "depository", "checking", 8420.55),
  a("card-9921", "i-chase", "credit", "credit card", 2840.22, { credit_limit: 25000 }),
  a("sav-7731", "i-ally", "depository", "savings", 41300),
  a("sav-7748", "i-ally", "depository", "savings", 20000),
  a("k401-2201", "i-fid", "investment", "401k", 168420.5),
  a("unused-0087", "i-chase", "depository", "savings", 0.41),
];
const manual: ManualAccountLike[] = [
  { id: "m1", name: "Student loan (Nelnet)", institution_name: "Nelnet", type: "student_loan", role: "debt", current_balance: 12400, updated_at: "2026-10-30T12:00:00Z" },
];
const credit: CreditDetailLike[] = [
  { account_id: "p-card-9921", last_statement_balance: 2612.4, last_payment_amount: 2318.77, minimum_payment_amount: 40, next_payment_due_date: "2026-11-24", is_overdue: false, last_payment_date: "2026-10-24" },
];

const views = buildAccountViews({ accounts, manual, items, meta: {}, credit });

describe("accounts/grouping: By type", () => {
  it("fixed group order, empty groups dropped, manual loan in Loans", () => {
    const g = groupByType(views);
    expect(g.map(x => x.key)).toEqual(["checking", "savings", "credit", "loan", "investment"]);
    expect(g.find(x => x.key === "loan")!.views.map(v => v.name)).toEqual(["Student loan (Nelnet)"]);
  });
  it("debts are negative and group totals are signed sums", () => {
    const g = groupByType(views);
    expect(g.find(x => x.key === "credit")!.total).toBeCloseTo(-2840.22);
    expect(g.find(x => x.key === "savings")!.total).toBeCloseTo(61300.41);
  });
  it("credit group carries the combined limit and use", () => {
    const c = groupByType(views).find(x => x.key === "credit")!;
    expect(c.limit).toBe(25000);
    expect(c.used).toBeCloseTo(2840.22);
  });
  it("hidden accounts leave the groups", () => {
    const v2 = buildAccountViews({ accounts, manual, items, meta: { "chk-4410": { hidden: true } }, credit });
    expect(groupByType(v2).map(x => x.key)).not.toContain("checking");
  });
  it("savings rows are sorted by size", () => {
    expect(groupByType(views).find(x => x.key === "savings")!.views.map(v => v.key)).toEqual(["sav-7731", "sav-7748", "unused-0087"]);
  });
});

describe("accounts/grouping: By bank", () => {
  it("one group per Plaid item, more accounts first, manual last", () => {
    const g = groupByBank(views);
    expect(g.map(x => x.label)).toEqual(["Chase", "Ally Bank", "Fidelity", MANUAL_BANK]);
    expect(g[0].views.map(v => v.group)).toEqual(["checking", "savings", "credit"]);
  });
  it("a broken item marks its group and rows", () => {
    const v2 = buildAccountViews({ accounts, manual, items, meta: {}, credit, health: { "i-fid": { id: "i-fid", error_code: "ITEM_LOGIN_REQUIRED", last_synced_at: "2026-11-15T10:00:00Z" } } });
    const fid = groupByBank(v2).find(x => x.label === "Fidelity")!;
    expect(fid.needsSignIn).toBe(true);
    expect(rowFact(fid.views[0], TODAY)).toEqual({ kind: "signin", text: "Needs sign-in · as of Nov 15" });
  });
});

describe("accounts/grouping: rows", () => {
  it("fact priority: sign-in > manual > due > APY", () => {
    const card = views.find(v => v.key === "card-9921")!;
    expect(rowFact(card, TODAY)).toEqual({ kind: "due", text: "Due Nov 24", soon: true });
    expect(rowFact(views.find(v => v.kind === "manual")!, TODAY)).toEqual({ kind: "manual", text: "Manual · Updated Oct 30" });
    const withApy = buildAccountViews({ accounts, manual, items, meta: { "sav-7731": { apr: 4.2 } }, credit }).find(v => v.key === "sav-7731")!;
    expect(rowFact(withApy, TODAY)).toEqual({ kind: "apy", text: "4.2% APY" });
    expect(rowFact(views.find(v => v.key === "chk-4410")!, TODAY)).toBeNull();
  });
  it("due more than 7 days out isn't gold", () => {
    const later = buildAccountViews({ accounts, manual: [], items, meta: {}, credit: [{ ...credit[0], next_payment_due_date: "2026-12-10" }] });
    expect(rowFact(later.find(v => v.key === "card-9921")!, TODAY)).toMatchObject({ soon: false });
  });
  it("identifier is bank ··mask", () => {
    expect(identifierOf(views.find(v => v.key === "card-9921")!)).toBe("Chase ··9921");
  });
  it("nickname wins over the bank's name", () => {
    const v2 = buildAccountViews({ accounts, manual, items, meta: { "chk-4410": { nickname: "Everyday checking" } }, credit });
    expect(v2.find(v => v.key === "chk-4410")!.name).toBe("Everyday checking");
  });
});

describe("accounts/grouping: utilization", () => {
  it("Plaid limit first, else balance + available, else none", () => {
    expect(creditLimitOf({ type: "credit", current_balance: 500, available_balance: 1500, credit_limit: 3000 })).toBe(3000);
    expect(creditLimitOf({ type: "credit", current_balance: 500, available_balance: 1500 })).toBe(2000);
    expect(creditLimitOf({ type: "credit", current_balance: 500, available_balance: null })).toBeNull();
    expect(creditLimitOf({ type: "depository", current_balance: 500, available_balance: 500 })).toBeNull();
  });
  it("tones at 30% / 50%", () => {
    expect(utilizationTone(0.11)).toBe("ok");
    expect(utilizationTone(0.3)).toBe("warn");
    expect(utilizationTone(0.5)).toBe("warn");
    expect(utilizationTone(0.51)).toBe("bad");
  });
  it("a card with no limit shows no meter", () => {
    const v2 = buildAccountViews({ accounts: [a("c-1", "i-chase", "credit", "credit card", 100)], manual: [], items, meta: {}, credit: [] });
    expect(v2[0].utilization).toBeNull();
  });
});

describe("accounts/findings", () => {
  it("dormant: under $5 and no activity for 120 days; Keep snoozes", () => {
    const txns = [{ account_id: "p-unused-0087", date: "2026-04-01" }, { account_id: "p-chk-4410", date: "2026-11-17" }];
    expect(dormantFindings(views, txns, {}, TODAY).map(f => f.accountKey)).toEqual(["unused-0087"]);
    expect(dormantFindings(views, txns, { "unused-0087": { keepUntil: "2027-05-01" } }, TODAY)).toEqual([]);
  });
  it("duplicate: same bank + mask + type twice flags the newer item's row", () => {
    const dupAccounts = [...accounts, a("chk-4410-again", "i-chase2", "depository", "checking", 8420.55, { mask: "4410" })];
    const v2 = buildAccountViews({ accounts: dupAccounts, manual: [], items, meta: {}, credit });
    const created = Object.fromEntries(items.map(i => [i.id, i.created_at]));
    expect(duplicateFindings(v2, created, {}, TODAY).map(f => f.accountKey)).toEqual(["chk-4410-again"]);
  });
  it("apy: only savings without a typed rate", () => {
    const v2 = buildAccountViews({ accounts, manual: [], items, meta: {}, credit, impliedApy: { "p-sav-7731": 4.18 } });
    const f = apyFindings(v2, {}, TODAY);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ accountKey: "sav-7731", apy: 4.2, action: "Use 4.2%" });
  });
  it("coming due: next 30 days, soonest first, statement amount", () => {
    const due = comingDue(views, credit, [], () => "detected", TODAY);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ name: "card-9921", dueLabel: "Nov 24", soon: true, amount: 2612.4, amountLabel: "statement", autopay: "detected" });
  });
});
