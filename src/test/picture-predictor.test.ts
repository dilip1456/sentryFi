/**
 * Picture predictor follow-ups (Dilip, Nov 17): a loan that was paid must not
 * stay "missing", detection reruns on fresh transactions, paychecks are never
 * bills to review, and Salary is never $0 while pay is recorded.
 * Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { Builder, monthly, semimonthly, picture } from "./fixtures/picture-scenarios";
import { decisionFor, expensesToReview, reconcilePayments, rollNextDue, type ClassifierTxn, type RecurringDecision, type ReviewItem } from "@/lib/recurring";
import { accountedFor, buildObligations } from "@/lib/picture/obligations";

const TODAY = "2026-10-29";
const LOAN = { pfc: "LOAN_PAYMENTS", pfcd: "LOAN_PAYMENTS_MORTGAGE_PAYMENT" };
const WAGES = { pfc: "INCOME", pfcd: "INCOME_WAGES" };

const loanItem = (over: Partial<ReviewItem> = {}): ReviewItem => ({
  key: "outflow|rocket mortgage", group: "payments", kind: "loan", subtype: "mortgage", direction: "outflow", label: "Rocket Mortgage",
  pattern: "Monthly on the 1st", cadence: "monthly", amount: 2150, amountKind: "fixed", amountRange: [2150, 2150], monthly: 2150,
  lastSeen: "2026-09-01", nextDue: "2026-10-01", occurrences: 1, confidence: 0.9, transactionIds: ["p9"],
  matched: [{ id: "p9", date: "2026-09-01", amount: 2150, name: "ROCKET MORTGAGE", accountId: "chk" }],
  accountId: "chk", coverAccountId: "chk", coverUserSet: false, status: "confirmed", edited: false, missed: true, daysLate: 28,
  why: "", renamed: false, autoLabel: String(over.label ?? "Rocket Mortgage"), expectedAmount: null, patternLine: "", estimated: false, estimateNote: null, detected: { cadence: "monthly", amount: 2150, group: "payments" }, ...over,
});
const tx = (id: string, account: string, date: string, amount: number, name: string): ClassifierTxn =>
  ({ transaction_id: id, account_id: account, date, amount, name, merchant_name: null, category: null, pending: false });
const prior = tx("p9", "chk", "2026-09-01", 2150, "ROCKET MORTGAGE");
const ACCTS = [
  { account_id: "chk", type: "depository", subtype: "checking", name: "Everyday Checking" },
  { account_id: "mtg", type: "loan", subtype: "mortgage", name: "Home Mortgage" },
  { account_id: "card", type: "credit", subtype: "credit card", name: "Sapphire Card" },
];

describe("loan paid but flagged missing (reconcilePayments)", () => {
  it("a payment that only shows on the loan account (liability side) settles it", () => {
    const [out] = reconcilePayments([loanItem()], [prior, tx("l1", "mtg", "2026-10-01", -2150, "PAYMENT RECEIVED")], { today: TODAY, accounts: ACCTS });
    expect(out).toMatchObject({ missed: false, daysLate: null, lastSeen: "2026-10-01", nextDue: "2026-11-01" });
    expect(out.matched[0].id).toBe("l1");
  });
  it("a payment filed as a transfer, under a new descriptor, with extra principal, settles it", () => {
    const [out] = reconcilePayments([loanItem()], [prior, tx("x1", "chk", "2026-10-02", 2400, "ONLINE TRANSFER TO ROCKET MTG 4444")], { today: TODAY, accounts: ACCTS });
    expect(out.missed).toBe(false);
    expect(out.lastSeen).toBe("2026-10-02");
  });
  it("paying the loan off (a much bigger payment to the same payee) settles it", () => {
    const [out] = reconcilePayments([loanItem()], [prior, tx("po", "chk", "2026-10-05", 182000, "ROCKET MORTGAGE")], { today: TODAY, accounts: ACCTS });
    expect(out.missed).toBe(false);
  });
  it("paid a week early (before the detector's window) settles it", () => {
    const item = loanItem({ transactionIds: ["p9", "e1"], matched: [{ id: "e1", date: "2026-09-24", amount: 2150, name: "ROCKET MORTGAGE", accountId: "chk" }, { id: "p9", date: "2026-09-01", amount: 2150, name: "ROCKET MORTGAGE", accountId: "chk" }], lastSeen: "2026-09-24" });
    const [out] = reconcilePayments([item], [prior, tx("e1", "chk", "2026-09-24", 2150, "ROCKET MORTGAGE")], { today: TODAY, accounts: ACCTS });
    expect(out).toMatchObject({ missed: false, nextDue: "2026-11-01" });
  });
  it("nothing paid stays missed; an unrelated payment of a similar size doesn't count", () => {
    const [out] = reconcilePayments([loanItem()], [prior, tx("c1", "chk", "2026-10-03", 2100, "CHASE CREDIT CRD AUTOPAY"), tx("c2", "card", "2026-10-03", -2100, "AUTOMATIC PAYMENT - THANK YOU")], { today: TODAY, accounts: ACCTS });
    expect(out).toMatchObject({ missed: true, daysLate: 28 });
  });
  it("one payment settles one item, and income is never touched", () => {
    const pay = loanItem({ key: "inflow|pay:globex", group: "income", kind: "salary", direction: "inflow", label: "Globex", missed: true });
    const out = reconcilePayments([loanItem(), loanItem({ key: "outflow|rocket mortgage|~2", label: "Rocket Mortgage" }), pay], [prior, tx("l1", "mtg", "2026-10-01", -2150, "PAYMENT RECEIVED")], { today: TODAY, accounts: ACCTS });
    expect(out.map(i => i.missed)).toEqual([false, true, true]);
  });
  it("rolls the next due date past today and past the payment", () => {
    expect(rollNextDue("2026-10-01", "2026-10-01", "monthly", TODAY)).toBe("2026-11-01");
    expect(rollNextDue("2026-10-31", "2026-10-20", "monthly", "2026-10-21")).toBe("2026-11-30");
    expect(rollNextDue("2026-04-15", "2026-04-10", "semiannual", TODAY)).toBe("2027-04-15");
  });
});

describe("predictor reruns when new transactions arrive", () => {
  const build = () => {
    const b = new Builder()
      .acct("chk", "Everyday Checking", "depository", "checking", "1111", 8000)
      .acct("mtg", "Home Mortgage", "loan", "mortgage", "4444", 310000);
    b.series("chk", monthly("2026-01", 1).filter(d => d < "2026-10-01"), 2150, "ROCKET MORTGAGE", { ...LOAN, merchant_name: "Rocket Mortgage" });
    return b;
  };
  const loanOf = (items: ReviewItem[]) => items.find(i => /rocket/i.test(i.label))!;
  it("missing before the payment syncs, paid (and accounted for) after", () => {
    const b = build();
    const first = picture(b.fx()).m;
    const dec: RecurringDecision = decisionFor(loanOf(first.review.items), { status: "confirmed" });
    const before = picture(b.fx(), { recurringDecisions: [dec] }).m;
    expect(loanOf(before.review.items).missed).toBe(true);
    const obsBefore = buildObligations({ today: TODAY, reviewItems: before.review.items });
    expect(accountedFor(obsBefore, TODAY, 8000).missing.map(o => o.label)).toContain(loanOf(before.review.items).label);

    // The October payment arrives with the next sync, a few days late and as a transfer.
    b.tx("chk", "2026-10-06", 2150, "ONLINE TRANSFER TO ROCKET MORTGAGE", { pfc: "TRANSFER_OUT", pfcd: "TRANSFER_OUT_ACCOUNT_TRANSFER" });
    const after = picture(b.fx(), { recurringDecisions: [dec] }).m;
    const loan = loanOf(after.review.items);
    expect(loan).toMatchObject({ missed: false, daysLate: null });
    expect(loan.nextDue! > TODAY).toBe(true);
    const obsAfter = buildObligations({ today: TODAY, reviewItems: after.review.items });
    const acc = accountedFor(obsAfter, TODAY, 8000);
    expect(acc.missing).toHaveLength(0);
    expect(acc.paid).toBeGreaterThanOrEqual(1);
  });
  it("a payment that posted after an old 'today' counts once today moves on", () => {
    const b = build();
    const dec = decisionFor(loanOf(picture(b.fx()).m.review.items), { status: "confirmed" });
    b.tx("chk", "2026-10-30", 2150, "ROCKET MORTGAGE", { ...LOAN, merchant_name: "Rocket Mortgage" });
    // Frozen at Oct 29 the Oct 30 payment is invisible …
    expect(loanOf(picture(b.fx(), { recurringDecisions: [dec] }).m.review.items).missed).toBe(true);
    // … with the real date it settles the bill.
    expect(loanOf(picture(b.fx(), { recurringDecisions: [dec], today: new Date(2026, 9, 31, 12) }).m.review.items).missed).toBe(false);
  });
});

describe("salary and paychecks", () => {
  const pay = () => {
    const b = new Builder().acct("chk", "Everyday Checking", "depository", "checking", "1111", 8000);
    b.series("chk", semimonthly("2026-03"), -3100, "GLOBEX INC PAYROLL", WAGES);
    return b;
  };
  const salary = (m: ReturnType<typeof picture>["m"]) => m.rows.income.find(r => r.id === "salary")!;
  it("INCOME_SALARY paychecks (Plaid's newer taxonomy) fill Salary, not Other income", () => {
    const b = new Builder().acct("chk", "Everyday Checking", "depository", "checking", "1111", 8000);
    b.series("chk", semimonthly("2026-03"), -3100, "CGI TECHNOLOGIES DES:PAYROLL ID:211908 INDN:NAIK,DILIP PPD", { pfc: "INCOME", pfcd: "INCOME_SALARY" });
    const { m } = picture(b.fx());
    expect(salary(m).monthly).toBeCloseTo(6200, 0);
    expect(m.pay.employer).toBe("CGI Technologies");
    expect(m.rows.income.find(r => r.id === "other")).toBeUndefined();
  });
  it("paychecks are never offered as bills to review", () => {
    const { m } = picture(pay().fx());
    const it = m.review.items.find(i => i.kind === "salary")!;
    expect(it.status).toBe("confirmed"); // pay counts without asking
    expect(expensesToReview(m.review.items)).not.toContainEqual(expect.objectContaining({ key: it.key }));
    expect(salary(m).monthly).toBeCloseTo(6200, 0);
  });
  it("a paycheck dismissed from the old bills queue still counts as salary", () => {
    const b = pay();
    const it = picture(b.fx()).m.review.items.find(i => i.kind === "salary")!;
    const { m } = picture(b.fx(), { recurringDecisions: [decisionFor(it, { status: "dismissed" })] });
    expect(salary(m).monthly).toBeCloseTo(6200, 0);
  });
  it("the salary override is respected; an emptied (0) override doesn't zero it", () => {
    const b = pay();
    expect(salary(picture(b.fx(), { fp: { overrides: { "income.salary": 7000 }, fundingAccounts: {} } }).m).monthly).toBe(7000);
    expect(salary(picture(b.fx(), { fp: { overrides: { "income.salary": 0 }, fundingAccounts: {} } }).m).monthly).toBeCloseTo(6200, 0);
  });
  it("payroll without a clean pattern yet is averaged instead of $0", () => {
    const b = new Builder().acct("chk", "Everyday Checking", "depository", "checking", "1111", 8000);
    b.series("chk", ["2026-09-15", "2026-09-30", "2026-10-15"], i => [-2400, -4100, -2900][i], "INITECH PAYROLL", WAGES);
    const s = salary(picture(b.fx()).m);
    expect(s.monthly).toBeGreaterThan(3000);
    expect(s.sub).toMatch(/averaged/);
  });
});
