import { describe, expect, it } from "vitest";
import { buildPictureModel, type PAccount, type PClass, type PTxn } from "@/lib/picture/model";

const today = new Date(2026, 9, 29, 12);
const account: PAccount = {
  id: "checking-row", account_id: "checking", name: "Checking", official_name: null,
  type: "depository", subtype: "checking", current_balance: 0,
};

function txn(id: string, date: string, amount: number, name: string, merchant_name: string | null = null): PTxn {
  return { id, account_id: "checking", amount, date, name, merchant_name, category: null, pending: false };
}

function model(txns: PTxn[], classifications: Record<string, PClass>) {
  return buildPictureModel({
    txns, accounts: [account],
    classOf: t => classifications[t.id],
    getEffectiveCategory: t => classifications[t.id]?.type === "income_salary" ? "Salary" : "Transfer In",
    manualIncome: [], budgets: {}, cardAutopayFrom: {}, savingsGoals: [],
    fp: { overrides: {}, fundingAccounts: {} }, today,
  });
}

describe("My Financial Picture income patterns", () => {
  it("annualizes a recurring monthly payroll pattern", () => {
    const dates = ["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-06", "2026-05-05", "2026-06-05", "2026-07-06", "2026-08-05", "2026-09-08", "2026-10-05"];
    const txns = dates.map((date, i) => txn(`pay-${i}`, date, -6000, "ACME CORP PAYROLL", "Acme Corp"));
    const classes = Object.fromEntries(txns.map(t => [t.id, { type: "income_salary" as const }]));
    const salary = model(txns, classes).rows.income.find(row => row.id === "salary")!;
    expect(salary.monthly).toBe(6000);
    expect(salary.sub).toContain("1 paycheck a month");
  });

  it("does not project a single payroll deposit as recurring monthly salary", () => {
    const t = txn("pay-one", "2026-10-05", -6000, "ACME CORP PAYROLL", "Acme Corp");
    const salary = model([t], { [t.id]: { type: "income_salary" } }).rows.income.find(row => row.id === "salary")!;
    expect(salary.monthly).toBe(0);
    expect(salary.sub).toContain("schedule not confirmed");
  });

  it("includes a recurring deposit from the same external sender as other income", () => {
    const dates = ["2026-08-07", "2026-08-21", "2026-09-04", "2026-09-18", "2026-10-02", "2026-10-16"];
    const txns = dates.map((date, i) => txn(`zelle-${i}`, date, -500, "Zelle payment from Alex Smith", "Zelle"));
    const classes = Object.fromEntries(txns.map(t => [t.id, { type: "transfer_in" as const, subtype: "p2p" }]));
    const income = model(txns, classes).rows.income.find(row => row.id === "other")!;
    expect(income.monthly).toBeCloseTo(500 * 26 / 12, 2);
    expect(income.sub).toContain("1 recurring deposit pattern");
    expect(income.txns).toHaveLength(6);
  });

  it("excludes a one-off deposit and a recurring internal account transfer", () => {
    const oneOff = txn("once", "2026-10-10", -900, "Zelle payment from Alex Smith", "Zelle");
    const internal = ["2026-08-01", "2026-09-01", "2026-10-01"].map((date, i) =>
      txn(`internal-${i}`, date, -1000, "Online Transfer from Savings", "Online Transfer"));
    const classes: Record<string, PClass> = {
      [oneOff.id]: { type: "transfer_in", subtype: "p2p" },
      ...Object.fromEntries(internal.map(t => [t.id, { type: "transfer_in" as const, subtype: "account_transfer" }])),
    };
    const rows = model([oneOff, ...internal], classes).rows.income;
    expect(rows.find(row => row.id === "other")).toBeUndefined();
  });
});
