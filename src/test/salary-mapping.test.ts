/**
 * Regression: "Salary is $0 and shows under Other". Plaid's newer taxonomy
 * files paychecks as INCOME_SALARY (only INCOME_WAGES was mapped), and also
 * tags person-to-person Zelle deposits that way. Plus the related cleanups:
 * taxes, bare "Service" at LOW confidence, auto-loan transfers, funding
 * accounts, and payee names.
 */
import { describe, expect, it } from "vitest";
import { classifyAll, mapPfc, normalisePlaidCategory, type ClassifierAccount, type ClassifierTxn } from "@/lib/classify";
import { bankNameField, canonicalMerchants, cleanPayee, payrollCompany, isConfidentDetection, settleSuggestions } from "@/lib/recurring";

const accounts: ClassifierAccount[] = [
  { account_id: "chk", type: "depository", subtype: "checking", name: "Checking Account", mask: "4704" },
  { account_id: "chk2", type: "depository", subtype: "checking", name: "Checking", mask: "8842" },
  { account_id: "fund", type: "depository", subtype: "savings", name: "Funding Account 2061", mask: "2061" },
  { account_id: "auto", type: "loan", subtype: "auto", name: "Chase Auto Loan", mask: "7041" },
];
let n = 0;
const tx = (account_id: string, date: string, amount: number, name: string, extra: Partial<ClassifierTxn> = {}): ClassifierTxn =>
  ({ id: `t${++n}`, transaction_id: `p${n}`, account_id, date, amount, name, merchant_name: null, category: null, pending: false, ...extra });
const classify = (txns: ClassifierTxn[]) => classifyAll(txns, { accounts, selfNames: ["Dilip Naik"], plaidCategory: t => normalisePlaidCategory(t.category, t.merchant_name, t.name, t) });
const SALARY = { pfc_primary: "INCOME", pfc_detailed: "INCOME_SALARY" };

describe("salary mapping", () => {
  it("an INCOME_SALARY payroll deposit is salary", () => {
    const t = tx("chk", "2026-06-18", -3146.72, "CGI TECHNOLOGIES DES:PAYROLL ID:211908 INDN:NAIK,DILIP CO ID:XXXXX56778 PPD", { ...SALARY, pfc_confidence: "VERY_HIGH", category: ["Transfer", "Payroll"] });
    expect(classify([t]).get(t.id)?.type).toBe("income_salary");
    expect(mapPfc("INCOME", "INCOME_SALARY")).toMatchObject({ type: "income_salary", category: "Salary" });
  });
  it("a DES:PAYROLL deposit Plaid only calls generic income is still salary", () => {
    const t = tx("chk", "2026-06-04", -3146.72, "CGI TECHNOLOGIES DES:PAYROLL ID:211908 INDN:NAIK,DILIP PPD", { pfc_primary: "INCOME", pfc_detailed: "INCOME_OTHER_INCOME", pfc_confidence: "HIGH" });
    expect(classify([t]).get(t.id)?.type).toBe("income_salary");
  });
  it("other INCOME_* kinds are other income, not salary", () => {
    for (const d of ["INCOME_CONTRACTOR", "INCOME_GIG_ECONOMY", "INCOME_MILITARY", "INCOME_RENTAL", "INCOME_LONG_TERM_DISABILITY"]) {
      expect(mapPfc("INCOME", d)?.type).toBe("income_other");
    }
  });
  it("a Zelle deposit Plaid tags INCOME_SALARY is never salary", () => {
    const person = tx("chk2", "2026-05-04", -3040, "Zelle Credit PAY ID:BACe6cmslh6i ORG ID:BAC NAME:CHANDRIKA RA", { ...SALARY, pfc_confidence: "HIGH", category: ["Transfer", "Payroll"] });
    const personLow = tx("chk2", "2026-11-13", -1800, "Zelle Credit PAY ID:BACe0xipefq1 ORG ID:BAC NAME:CHANDRIKA RA", { ...SALARY, pfc_confidence: "LOW", category: ["Transfer", "Payroll"] });
    const memo = tx("chk2", "2026-06-01", -500, "Zelle payment from JOHN SMITH for \"Salary\"; Conf# abc123", { ...SALARY, pfc_confidence: "VERY_HIGH" });
    const self = tx("chk2", "2026-06-22", -3150, "Zelle Credit PAY ID:BACe85rzsxwy ORG ID:BAC NAME:DILIP NAIK", { ...SALARY, pfc_confidence: "HIGH", category: ["Transfer", "Payroll"] });
    const c = classify([person, personLow, memo, self]);
    for (const t of [person, personLow, memo]) expect(c.get(t.id)?.type).toBe("transfer_in");
    expect(c.get(self.id)?.type).toBe("transfer_internal");
    // and its display category isn't "Salary" either
    expect(normalisePlaidCategory(["Transfer", "Payroll"], null, person.name)).toBe("Transfer In");
    expect(normalisePlaidCategory(["Transfer", "Payroll"], null, "ACME CORP DES:PAYROLL ID:1 PPD")).toBe("Salary");
  });
});

describe("taxes and bare Service", () => {
  it("Tax / Tax|Payment are Taxes (obligation_tax), and a LOW-confidence local tax still is", () => {
    expect(normalisePlaidCategory(["Tax", "Payment"], null, "X")).toBe("Taxes");
    expect(normalisePlaidCategory(["Tax"], null, "X")).toBe("Taxes");
    const t = tx("chk", "2026-08-04", 72, "OPC*H A BERKHEIMER TAX", { pfc_primary: "GOVERNMENT_AND_NON_PROFIT", pfc_detailed: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT", pfc_confidence: "LOW", category: ["Tax", "Payment"] });
    const eit = tx("chk", "2026-04-15", 120, "KEYSTONE COLLECTIONS LOCAL EIT", {});
    const c = classify([t, eit]);
    expect(c.get(t.id)?.type).toBe("obligation_tax");
    expect(c.get(eit.id)?.type).toBe("obligation_tax");
  });
  it("a bare / unknown Service at LOW confidence isn't a bill", () => {
    expect(normalisePlaidCategory(["Service"], "Paystar", "Paystar", { pfc_primary: "GENERAL_SERVICES", pfc_detailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES", pfc_confidence: "LOW" })).toBe("Other");
    expect(normalisePlaidCategory(["Service", "Travel Agents and Tour Operators"], "Palotv Travel Cen", "MOBILE PURCHASE PALOTV", { pfc_primary: "GENERAL_MERCHANDISE", pfc_detailed: "GENERAL_MERCHANDISE_CONVENIENCE_STORES", pfc_confidence: "LOW" })).toBe("Shopping");
    // Plaid sure, or no PFC info at all: unchanged.
    expect(normalisePlaidCategory(["Service"], "Paystar", "Paystar", { pfc_confidence: "HIGH" })).toBe("Bills & Utilities");
    expect(normalisePlaidCategory(["Service"], "Paystar", "Paystar")).toBe("Bills & Utilities");
  });
});

describe("auto loan paid by bank transfer", () => {
  const ext = (date: string) => tx("fund", date, 499.99, `ACH Electronic Debit - JPMorgan Chase Ext Trnsfr ${date.replace(/-/g, "")}414`, { pfc_primary: "TRANSFER_OUT", pfc_detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER", pfc_confidence: "LOW", category: ["Transfer", "Debit"] });
  it("pairs with the loan's PAYMENT a few days apart, and the same transfer in earlier months is the loan too", () => {
    const loanSide = tx("auto", "2026-10-23", -499.99, "PAYMENT", { pfc_primary: "LOAN_PAYMENTS", pfc_detailed: "LOAN_PAYMENTS_CAR_PAYMENT", pfc_confidence: "VERY_HIGH", category: ["Transfer", "Credit"] });
    const oct = ext("2026-10-27"), sep = ext("2026-09-25"), aug = ext("2026-08-25");
    const c = classify([loanSide, oct, sep, aug]);
    expect(c.get(oct.id)).toMatchObject({ type: "obligation_loan", pairId: loanSide.id });
    expect(c.get(sep.id)?.type).toBe("obligation_loan");
    expect(c.get(aug.id)?.type).toBe("obligation_loan");
    expect(c.get(loanSide.id)?.type).toBe("transfer_internal");
  });
  it("an unmatched loan-side PAYMENT is never a refund", () => {
    const loanSide = tx("auto", "2026-01-23", -499.99, "PAYMENT", { pfc_primary: "LOAN_PAYMENTS", pfc_detailed: "LOAN_PAYMENTS_CAR_PAYMENT", pfc_confidence: "VERY_HIGH" });
    expect(classify([loanSide]).get(loanSide.id)?.type).toBe("transfer_internal");
  });
});

describe("funding accounts", () => {
  it("money moved into a savings account that pays the mortgage isn't savings", () => {
    const txns: ClassifierTxn[] = [];
    for (const m of ["06", "07", "08"]) {
      txns.push(tx("chk", `2026-${m}-02`, 3175, "Online Transfer to SAV ...2061", { pfc_primary: "TRANSFER_OUT", pfc_detailed: "TRANSFER_OUT_SAVINGS", pfc_confidence: "HIGH" }));
      txns.push(tx("fund", `2026-${m}-02`, -3175, "Online Transfer from CHK ...4704", { pfc_primary: "TRANSFER_IN", pfc_detailed: "TRANSFER_IN_ACCOUNT_TRANSFER", pfc_confidence: "HIGH" }));
      txns.push(tx("fund", `2026-${m}-05`, 3000, "ACH Electronic Debit - PROVIDENT FUNDIN ACH PMT", { merchant_name: "Provident Fundin", pfc_primary: "LOAN_PAYMENTS", pfc_detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT", pfc_confidence: "HIGH" }));
    }
    const c = classify(txns);
    const outs = txns.filter(t => t.account_id === "chk");
    for (const t of outs) expect(c.get(t.id)?.type).toBe("transfer_internal");
    // A savings goal the person set still counts as saving.
    const c2 = classifyAll(txns, { accounts: accounts.map(a => (a.account_id === "fund" ? { ...a, role: "savings_goal" as const } : a)) });
    expect(c2.get(outs[0].id)?.type).toBe("savings_contribution");
  });
});

describe("payee names", () => {
  it("parses payroll and BofA NAME: descriptors and joins truncated merchant names", () => {
    expect(payrollCompany("CGI TECHNOLOGIES DES:PAYROLL ID:211908 INDN:NAIK,DILIP CO ID:XXXXX56778 PPD")).toBe("CGI Technologies");
    expect(bankNameField("Zelle Credit PAY ID:BACe6cmslh6i ORG ID:BAC NAME:CHANDRIKA RA")).toBe("Chandrika Ra");
    const canon = canonicalMerchants(["Provident Fundin", "Provident Funding", "Netflix"]);
    expect(cleanPayee({ name: "ACH PMT", merchant_name: "Provident Fundin" }, canon)).toBe("Provident Funding");
    expect(cleanPayee({ name: "CGI TECHNOLOGIES DES:PAYROLL ID:1 PPD", merchant_name: null })).toBe("CGI Technologies");
  });
});

describe("detections settle internally", () => {
  it("confident ones count, weak ones are left out, decisions are kept", () => {
    const items = [
      { key: "a", status: "suggested" as const, confidence: 0.9, kind: "bill", cadence: "monthly", direction: "outflow" as const },
      { key: "b", status: "suggested" as const, confidence: 0.59, kind: "income", cadence: "monthly", direction: "inflow" as const },
      { key: "c", status: "suggested" as const, confidence: 0.6, kind: "bill", cadence: "yearly", direction: "outflow" as const },
      { key: "d", status: "confirmed" as const, confidence: 0.1, kind: "bill", cadence: "monthly", direction: "outflow" as const },
      { key: "e", status: "suggested" as const, confidence: 0.4, kind: "tax", cadence: "quarterly", direction: "outflow" as const },
      { key: "f", status: "suggested" as const, confidence: 0.62, kind: "subscription", cadence: "monthly", direction: "outflow" as const, transactionIds: ["1", "2", "3", "4"] },
      { key: "g", status: "suggested" as const, confidence: 0.62, kind: "bill", cadence: "monthly", direction: "outflow" as const, transactionIds: ["1", "2"] },
    ];
    const out = settleSuggestions(items);
    expect(out.map(i => `${i.key}:${i.status}`)).toEqual(["a:confirmed", "c:confirmed", "d:confirmed", "f:confirmed"]);
    expect(isConfidentDetection({ confidence: 0.2, kind: "salary" })).toBe(true);
  });
});
