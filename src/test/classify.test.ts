import { describe, it, expect } from "vitest";
import {
  classifyAll, classifyOne, matchInternalTransfers, summarizeFlow, samePeriodLastMonth, monthRange,
  savingsRate, mapPfc, pfcToAppCategory, typeForCategory, bucketOf, normalisePlaidCategory,
  type ClassifierTxn, type ClassifierAccount, type ClassifierContext, type Classification,
} from "@/lib/classify/index.ts";

let n = 0;
const tx = (p: Partial<ClassifierTxn>): ClassifierTxn => ({
  id: p.id ?? `t${++n}`, account_id: "chk", amount: 10, date: "2026-10-10",
  name: null, merchant_name: null, category: null, pending: false, ...p,
});

const accounts: ClassifierAccount[] = [
  { account_id: "chk", item_id: "boa", type: "depository", subtype: "checking", mask: "1111", name: "Adv Plus Banking" },
  { account_id: "sav", item_id: "boa", type: "depository", subtype: "savings", mask: "2222", name: "Advantage Savings" },
  { account_id: "card", item_id: "chase", type: "credit", subtype: "credit card", mask: "3333", name: "Sapphire" },
  { account_id: "mtg", item_id: "rocket", type: "loan", subtype: "mortgage", mask: "4444", name: "Mortgage" },
  { account_id: "rh", item_id: "rh", type: "investment", subtype: "brokerage", mask: "5555", name: "Robinhood individual" },
];
const ctx = (extra: Partial<ClassifierContext> = {}): ClassifierContext => ({
  accounts, selfNames: ["Dilip Naik"], plaidCategory: t => normalisePlaidCategory(t.category, t.merchant_name, t.name), ...extra,
});
const typeOf = (txns: ClassifierTxn[], id: string, c = ctx()) => classifyAll(txns, c).get(id)!.type;

describe("internal transfer matcher", () => {
  it("pairs a checking → savings move and treats the outflow as a savings contribution", () => {
    const out = tx({ id: "o", account_id: "chk", amount: 500, name: "Online Transfer to SAV ...2222" });
    const inn = tx({ id: "i", account_id: "sav", amount: -500, date: "2026-10-11", name: "Online Transfer from CHK ...1111" });
    const m = classifyAll([out, inn], ctx());
    expect(m.get("o")!.type).toBe("savings_contribution");
    expect(m.get("i")!.type).toBe("transfer_internal");
    expect(m.get("o")!.pairId).toBe("i");
  });

  it("uses the DESTINATION for savings: a withdrawal from savings is not saving", () => {
    const out = tx({ id: "o", account_id: "sav", amount: 300, name: "Online Transfer to CHK ...1111" });
    const inn = tx({ id: "i", account_id: "chk", amount: -300, name: "Online Transfer from SAV ...2222" });
    const m = classifyAll([out, inn], ctx());
    expect(m.get("o")!.type).toBe("transfer_internal");
    expect(m.get("i")!.type).toBe("transfer_internal");
  });

  it("pairs a card payment (both legs) as credit_card_payment", () => {
    const out = tx({ id: "o", account_id: "chk", amount: 1240.5, name: "CHASE CREDIT CRD DES:AUTOPAY", category: ["Payment", "Credit Card"] });
    const inn = tx({ id: "i", account_id: "card", amount: -1240.5, date: "2026-10-12", name: "AUTOMATIC PAYMENT - THANK YOU" });
    const m = classifyAll([out, inn], ctx());
    expect(m.get("o")!.type).toBe("credit_card_payment");
    expect(m.get("i")!.type).toBe("credit_card_payment");
  });

  it("payment to a linked mortgage is an obligation once; the loan-side leg is ignored", () => {
    const out = tx({ id: "o", account_id: "chk", amount: 3000, name: "ROCKET MORTGAGE PAYMENT" });
    const inn = tx({ id: "i", account_id: "mtg", amount: -3000, name: "PAYMENT RECEIVED" });
    const m = classifyAll([out, inn], ctx());
    expect(m.get("o")!.type).toBe("obligation_loan");
    expect(m.get("i")!.type).toBe("transfer_internal");
  });

  it("does not pair an external Zelle deposit with an unrelated same-amount purchase", () => {
    const zelleIn = tx({ id: "z", account_id: "chk", amount: -200, name: "Zelle payment from JOHN SMITH" });
    const purchase = tx({ id: "p", account_id: "card", amount: 200, merchant_name: "Best Buy", name: "BEST BUY 123", pfc_primary: "GENERAL_MERCHANDISE", pfc_detailed: "GENERAL_MERCHANDISE_ELECTRONICS" });
    expect(matchInternalTransfers([zelleIn, purchase], accounts).size).toBe(0);
    const m = classifyAll([zelleIn, purchase], ctx());
    expect(m.get("z")!.type).toBe("income_other");
    expect(m.get("p")!.type).toBe("spend");
  });

  it("leaves an ambiguous match unpaired", () => {
    const accts: ClassifierAccount[] = [
      { account_id: "x", item_id: "i1", type: "depository", subtype: "checking" },
      { account_id: "y", item_id: "i2", type: "depository", subtype: "savings" },
      { account_id: "z", item_id: "i3", type: "depository", subtype: "savings" },
    ];
    const out = tx({ id: "o", account_id: "x", amount: 100, name: "Transfer to SAV" });
    const a = tx({ id: "a", account_id: "y", amount: -100, name: "Transfer from CHK" });
    const b = tx({ id: "b", account_id: "z", amount: -100, name: "Transfer from CHK" });
    expect(matchInternalTransfers([out, a, b], accts).size).toBe(0);
    // …but the strictly better candidate wins when there is one.
    const c = tx({ id: "c", account_id: "y", amount: -100, date: "2026-10-13", name: "Transfer from CHK" });
    expect(matchInternalTransfers([out, c, b], accts).get("o")?.pairId).toBe("b");
  });

  it("ignores pending legs and same-account matches", () => {
    const out = tx({ id: "o", account_id: "chk", amount: 50, name: "Transfer", pending: true });
    const inn = tx({ id: "i", account_id: "sav", amount: -50, name: "Transfer" });
    const same = tx({ id: "s", account_id: "chk", amount: -50, name: "Transfer" });
    expect(matchInternalTransfers([out, inn, same], accounts).size).toBe(0);
  });

  it("respects 'not internal' from the user", () => {
    const out = tx({ id: "o", account_id: "chk", amount: 500, name: "Online Transfer to SAV" });
    const inn = tx({ id: "i", account_id: "sav", amount: -500, name: "Online Transfer from CHK" });
    expect(typeOf([out, inn], "o", ctx({ notInternalIds: new Set(["o"]) }))).not.toBe("transfer_internal");
  });
});

describe("self-payee, brokerage and savings", () => {
  it("Zelle to the user is an internal transfer, even when memo says Salary", () => {
    const t = tx({ amount: 3074.13, name: 'Zelle Recurring payment to DILIP NAIK for "Salary"; Conf# bqyboj6hx', category: ["Salary"] });
    expect(classifyOne(t, ctx()).type).toBe("transfer_internal");
  });

  it("payroll carrying the user's name is still salary", () => {
    const t = tx({ amount: -3036.07, name: "Cgi Technologies Des:Payroll Id Indn:Naik,Dilip Co Id Ppd" });
    expect(classifyOne(t, ctx()).type).toBe("income_salary");
  });

  it("Robinhood beats a high-confidence Plaid gambling category", () => {
    const a = tx({ amount: 100, name: "ROBINHOOD", merchant_name: "Robinhood", pfc_primary: "ENTERTAINMENT", pfc_detailed: "ENTERTAINMENT_CASINOS_AND_GAMBLING", pfc_confidence: "HIGH" });
    const b = tx({ amount: 100, name: "ROBINHOOD", merchant_name: "Robinhood", pfc_primary: "ENTERTAINMENT", pfc_detailed: "ENTERTAINMENT_CASINOS_AND_GAMBLING", pfc_confidence: "HIGH" });
    const m = classifyAll([a, b], { accounts });
    expect(m.get(a.id)?.type).toBe("savings_contribution");
    expect(m.get(b.id)?.type).toBe("savings_contribution");
  });
  it("Robinhood deposits from checking are savings contributions, never Gambling spend", () => {
    const a = tx({ amount: 100, name: "ROBINHOOD DES:FUNDS", merchant_name: "Robinhood", category: ["Recreation", "Gambling"] });
    expect(classifyOne(a, ctx()).type).toBe("savings_contribution");
    const back = tx({ amount: -250, name: "ROBINHOOD DES:DEBITS", merchant_name: "Robinhood" });
    expect(classifyOne(back, ctx()).type).toBe("transfer_internal");
  });

  it("a manual category override still wins over brokerage detection", () => {
    const a = tx({ id: "rb", amount: 100, merchant_name: "Robinhood" });
    expect(classifyOne(a, ctx({ categoryOverrides: { rb: "Entertainment" } })).type).toBe("spend");
  });
});

describe("type overrides always win", () => {
  it("can turn a matched internal transfer into spending and vice versa", () => {
    const out = tx({ id: "o", account_id: "chk", amount: 500, name: "Online Transfer to SAV" });
    const inn = tx({ id: "i", account_id: "sav", amount: -500, name: "Online Transfer from CHK" });
    const m = classifyAll([out, inn], ctx({ typeOverrides: { o: "spend" } }));
    expect(m.get("o")!.type).toBe("spend");
    expect(m.get("o")!.source).toBe("override");
    const g = tx({ id: "g", amount: 40, merchant_name: "Whole Foods", category: ["Groceries"] });
    expect(classifyOne(g, ctx({ typeOverrides: { g: "transfer_internal" } })).type).toBe("transfer_internal");
  });

  it("beats rules and category overrides", () => {
    const t = tx({ id: "x", amount: -20, merchant_name: "Venmo" });
    const c = ctx({ typeOverrides: { x: "income_salary" }, categoryOverrides: { x: "Shopping" }, ruleCategory: () => "Food & Drink" });
    expect(classifyOne(t, c).type).toBe("income_salary");
  });

  it("rules beat the pair matcher", () => {
    const out = tx({ id: "o", account_id: "chk", amount: 500, name: "Online Transfer to SAV" });
    const inn = tx({ id: "i", account_id: "sav", amount: -500, name: "Online Transfer from CHK" });
    expect(typeOf([out, inn], "o", ctx({ ruleCategory: t => t.id === "o" ? "Shopping" : null }))).toBe("spend");
  });
});

describe("card payments, PFC detailed and patterns", () => {
  it("payment to an unlinked card is a card payment, not spend", () => {
    expect(classifyOne(tx({ amount: 900, name: "AMERICAN EXPRESS DES:ACH PMT" }), ctx()).type).toBe("credit_card_payment");
    expect(classifyOne(tx({ amount: 75, name: "DISCOVER E-PAYMENT 1234" }), ctx()).type).toBe("credit_card_payment");
  });

  it("maps detailed PFC instead of collapsing to the primary", () => {
    expect(classifyOne(tx({ amount: -12.3, name: "INTEREST PAYMENT", pfc_primary: "INCOME", pfc_detailed: "INCOME_INTEREST_EARNED" }), ctx()).type).toBe("income_interest");
    expect(classifyOne(tx({ amount: -40, pfc_primary: "INCOME", pfc_detailed: "INCOME_DIVIDENDS" }), ctx()).type).toBe("income_interest");
    expect(classifyOne(tx({ amount: -1200, pfc_primary: "INCOME", pfc_detailed: "INCOME_TAX_REFUND" }), ctx()).type).toBe("income_other");
    expect(classifyOne(tx({ amount: 1800, pfc_primary: "LOAN_PAYMENTS", pfc_detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT" }), ctx()).type).toBe("obligation_loan");
    expect(classifyOne(tx({ amount: 400, pfc_primary: "LOAN_PAYMENTS", pfc_detailed: "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT" }), ctx()).type).toBe("obligation_loan");
    expect(classifyOne(tx({ amount: 400, pfc_primary: "LOAN_PAYMENTS", pfc_detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }), ctx()).type).toBe("credit_card_payment");
    expect(classifyOne(tx({ amount: 2500, pfc_primary: "GOVERNMENT_AND_NON_PROFIT", pfc_detailed: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT" }), ctx()).type).toBe("obligation_tax");
    expect(classifyOne(tx({ amount: 120, pfc_primary: "RENT_AND_UTILITIES", pfc_detailed: "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY" }), ctx()).type).toBe("obligation_bill");
    expect(classifyOne(tx({ amount: 300, pfc_primary: "TRANSFER_OUT", pfc_detailed: "TRANSFER_OUT_SAVINGS" }), ctx()).type).toBe("savings_contribution");
  });

  it("stores app categories for PFC-only rows that keep their meaning", () => {
    expect(pfcToAppCategory("INCOME", "INCOME_INTEREST_EARNED")).toBe("Interest Earned");
    expect(pfcToAppCategory("INCOME", "INCOME_WAGES")).toBe("Salary");
    expect(pfcToAppCategory("LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT")).toBe("Credit Card Payment");
    expect(pfcToAppCategory("LOAN_PAYMENTS", "LOAN_PAYMENTS_MORTGAGE_PAYMENT")).toBe("Mortgage");
    expect(pfcToAppCategory("FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE")).toBe("Food & Drink");
    expect(mapPfc(null, null)).toBeNull();
  });

  it("low-confidence PFC falls through to patterns", () => {
    const t = tx({ amount: -3036, name: "ACME CORP PAYROLL", pfc_primary: "TRANSFER_IN", pfc_detailed: "TRANSFER_IN_DEPOSIT", pfc_confidence: "LOW" });
    expect(classifyOne(t, ctx()).type).toBe("income_salary");
  });

  it("detects interest, taxes and P2P by descriptor", () => {
    expect(classifyOne(tx({ amount: -21.44, name: "Interest Earned" }), ctx()).type).toBe("income_interest");
    expect(classifyOne(tx({ amount: 1500, name: "IRS USATAXPYMT" }), ctx()).type).toBe("obligation_tax");
    const sent = classifyOne(tx({ amount: 60, name: "Zelle payment to JANE DOE" }), ctx());
    expect(sent.type).toBe("spend");
    expect(sent.subtype).toBe("p2p");
  });

  it("unmatched incoming transfers are neutral, not income", () => {
    const t = tx({ amount: -800, name: "Online Transfer from SAV 9999", category: ["Transfer", "Deposit"] });
    expect(classifyOne(t, ctx()).type).toBe("transfer_in");
    expect(bucketOf("transfer_in")).toBe("neutral");
    expect(classifyOne(tx({ amount: -50, name: "DEPOSIT" }), ctx()).type).toBe("transfer_in");
  });

  it("refunds stay on the spend side", () => {
    expect(classifyOne(tx({ amount: -400, merchant_name: "IKEA", category: ["Shops", "Furniture And Home Decor"] }), ctx()).type).toBe("refund");
    expect(classifyOne(tx({ account_id: "card", amount: -19.99, merchant_name: "Amazon" }), ctx()).type).toBe("refund");
  });

  it("merchant overrides apply even with no Plaid category", () => {
    expect(normalisePlaidCategory(null, "ParkWhiz", null)).toBe("Transportation");
  });

  it("category table handles sign and custom categories", () => {
    expect(typeForCategory("Shopping", 10)).toBe("spend");
    expect(typeForCategory("Shopping", -10)).toBe("refund");
    expect(typeForCategory("Transfer In", -10)).toBe("transfer_in");
    expect(typeForCategory("Side Gig", -10, [{ name: "Side Gig", type: "income" }])).toBe("income_other");
    expect(typeForCategory("Other", 10)).toBeNull();
  });
});

describe("summarizeFlow — one definition for every page", () => {
  const txns = [
    tx({ id: "pay", amount: -3000, name: "ACME PAYROLL" }),
    tx({ id: "int", amount: -10, name: "Interest Earned", account_id: "sav" }),
    tx({ id: "g", amount: 200, merchant_name: "Whole Foods", category: ["Groceries"] }),
    tx({ id: "p", amount: 50, merchant_name: "Shell", category: ["Travel", "Gas Stations"], pending: true }),
    tx({ id: "ref", amount: -40, merchant_name: "IKEA", category: ["Shops"] }),
    tx({ id: "rent", amount: 1500, name: "Rent", category: ["Payment", "Rent"] }),
    tx({ id: "cc", amount: 900, name: "AMEX EPAYMENT ACH PMT" }),
    tx({ id: "rh", amount: 100, merchant_name: "Robinhood" }),
    tx({ id: "rh2", amount: 100, merchant_name: "Robinhood" }),
    tx({ id: "tin", amount: -700, name: "Online transfer from 9999", category: ["Transfer", "Deposit"] }),
    tx({ id: "old", amount: 999, date: "2026-09-30", merchant_name: "Target", category: ["Shops"] }),
  ];
  const classes = classifyAll(txns, ctx());
  const s = summarizeFlow(txns, t => classes.get(t.id) as Classification, t => t.category?.[0] ?? "Other", monthRange(new Date(2026, 9, 20)));

  it("spending includes pending + obligations, nets refunds, excludes transfers", () => {
    expect(s.spending).toBe(200 + 50 - 40 + 1500);
    expect(s.obligations).toBe(1500);
    expect(s.discretionary).toBe(210);
  });
  it("income separates salary and interest and excludes unmatched transfers", () => {
    expect(s.income).toBe(3010);
    expect(s.salary).toBe(3000);
    expect(s.interest).toBe(10);
    expect(s.unreviewedIn).toBe(700);
  });
  it("reports ignored movements separately", () => {
    expect(s.creditCardPayments).toBe(900);
    expect(s.savingsContributions).toBe(200);
    expect(s.net).toBe(3010 - 1710);
    expect(savingsRate(s.income, s.spending)).toBe(43);
    expect(savingsRate(0, 10)).toBeNull();
  });
  it("respects the date range", () => {
    expect(s.spendingByCategory["Shops"]?.total).toBe(-40);
  });
});

describe("date helpers", () => {
  it("compares month-to-date with the same span last month", () => {
    const r = samePeriodLastMonth(new Date(2026, 9, 20));
    expect(r).toMatchObject({ start: "2026-09-01", end: "2026-09-20", label: "Sep 1–20" });
    expect(samePeriodLastMonth(new Date(2026, 2, 31)).end).toBe("2026-02-28");
    expect(monthRange(new Date(2026, 0, 5), -1)).toEqual({ start: "2025-12-01", end: "2025-12-31" });
  });
});
