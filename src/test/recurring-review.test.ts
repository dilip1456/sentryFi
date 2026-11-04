/**
 * "Detected recurring" review (src/lib/recurring/review.ts) through the app's
 * real classifier and the Financial Picture model. Synthetic data only.
 * Each `it` is one row of the scenario → result table in the PR.
 */
import { describe, expect, it } from "vitest";
import { Builder, everyNDays, monthly, semimonthly, picture } from "./fixtures/picture-scenarios";
import { decisionFor, patternLabel, type RecurringDecision, type ReviewItem } from "@/lib/recurring";

const base = () => new Builder()
  .acct("chk", "Everyday Checking", "depository", "checking", "1111", 8000)
  .acct("sav", "Online Savings", "depository", "savings", "2222", 20000)
  .acct("card", "Sapphire Card", "credit", "credit card", "3333", 1500)
  .acct("mtg", "Home Mortgage", "loan", "mortgage", "4444", 310000);
const review = (b: Builder, recurringDecisions: RecurringDecision[] = []) => picture(b.fx(), { recurringDecisions }).m;
const find = (items: ReviewItem[], re: RegExp) => items.find(i => re.test(i.label) || re.test(i.key));
const WAGES = { pfc: "INCOME", pfcd: "INCOME_WAGES" };

describe("cadences", () => {
  it("weekly income over 3+ months", () => {
    const b = base();
    b.series("chk", everyNDays("2026-06-05", 7), -640, "UBER DRIVER PAYOUT", { ...WAGES, merchant_name: "Uber" });
    const it = find(review(b).review.items, /uber/i)!;
    expect(it).toMatchObject({ group: "income", cadence: "weekly", pattern: "Weekly on Fridays" });
    expect(it.monthly).toBeCloseTo(640 * 52 / 12, 1);
  });
  it("biweekly salary with name variants is one employer", () => {
    const b = base();
    const names = ["ACME CORP PAYROLL PPD ID: 9912345", "ACME CORP DIR DEP 0415", "ACME CORPORATION PAYROLL", "ADP PAYROLL ACME CORP"];
    b.series("chk", everyNDays("2026-01-02", 14), -2900, i => names[i % 4], { ...WAGES, merchant_name: null });
    const items = review(b).review.items.filter(i => i.group === "income");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "inflow|pay:acme", kind: "salary", cadence: "biweekly", pattern: "Every 2 weeks on Fridays" });
  });
  it("semi-monthly salary on the 15th and last day (weekend paydays move to Friday)", () => {
    const b = base();
    b.series("chk", semimonthly("2026-03"), -3100, "GLOBEX INC PAYROLL", WAGES);
    const it = find(review(b).review.items, /globex/i)!;
    expect(it.cadence).toBe("semimonthly");
    expect(it.pattern).toBe("Semi-monthly on the 15th and last day");
    expect(it.monthly).toBeCloseTo(6200, 0);
  });
  it("monthly bill with noisy dates (weekends, ±3 days drift)", () => {
    const b = base();
    const drift = [0, 2, -1, 3, 1, -2, 0, 2, -3, 1];
    monthly("2026-01", 12).forEach((d, i) => { const dt = new Date(`${d}T00:00:00Z`); dt.setUTCDate(dt.getUTCDate() + drift[i % drift.length]); b.tx("chk", dt.toISOString().slice(0, 10), 89.99, "COMCAST XFINITY", { pfc: "RENT_AND_UTILITIES", pfcd: "RENT_AND_UTILITIES_INTERNET_AND_CABLE", merchant_name: "Xfinity" }); });
    const it = find(review(b).review.items, /xfinity/i)!;
    expect(it).toMatchObject({ group: "bills", cadence: "monthly", amountKind: "fixed" });
    expect(it.nextDue).toMatch(/^2026-11-1/);
  });
  it("quarterly bill", () => {
    const b = base();
    b.series("chk", ["2025-11-20", "2026-02-20", "2026-05-20", "2026-08-20"], 240, "CITY WATER SEWER", { pfc: "RENT_AND_UTILITIES", pfcd: "RENT_AND_UTILITIES_WATER" });
    const it = find(review(b).review.items, /water/i)!;
    expect(it.cadence).toBe("quarterly");
    expect(it.monthly).toBe(80);
  });
  it("6-month insurance counts at 2 payments", () => {
    const b = base();
    b.series("chk", ["2026-01-12", "2026-07-13"], 612, "STATE FARM INSURANCE", { pfc: "GENERAL_SERVICES", pfcd: "GENERAL_SERVICES_INSURANCE", merchant_name: "State Farm" });
    const it = find(review(b).review.items, /state farm/i)!;
    expect(it).toMatchObject({ group: "insurance_tax", cadence: "semiannual", pattern: "Every 6 months (Jan & Jul)" });
    expect(it.monthly).toBe(102);
    expect(it.nextDue).toMatch(/^2027-01-1/);
  });
  it("yearly insurance and twice-a-year property tax count at 2", () => {
    const b = base();
    b.series("chk", ["2025-03-10", "2026-03-10"], 1320, "LEMONADE HOMEOWNERS INS", { pfc: "GENERAL_SERVICES", pfcd: "GENERAL_SERVICES_INSURANCE", merchant_name: "Lemonade" });
    b.series("chk", ["2026-02-01", "2026-08-01"], 4100, "COUNTY TREASURER PROPERTY TAX", { pfc: "GOVERNMENT_AND_NON_PROFIT", pfcd: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT" });
    const items = review(b).review.items;
    expect(find(items, /lemonade/i)).toMatchObject({ group: "insurance_tax", cadence: "yearly", pattern: "Yearly in Mar (around the 10th)" });
    expect(find(items, /county|property/i)).toMatchObject({ group: "insurance_tax", cadence: "semiannual" });
  });
  it("IRS estimated tax on the IRS calendar", () => {
    const b = base();
    ["2025-09-15", "2026-01-15", "2026-04-15", "2026-06-15", "2026-09-15"].forEach(d => b.tx("chk", d, 1800, "IRS USATAXPYMT 1040-ES", { pfc: "GOVERNMENT_AND_NON_PROFIT", pfcd: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT" }));
    const it = find(review(b).review.items, /irs/i)!;
    expect(it.group).toBe("insurance_tax");
    expect(it.nextDue).toBe("2027-01-15");
    expect(review(b).rows.taxes.some(r => r.reviewKey === it.key)).toBe(true);
  });
  it("pattern labels", () => {
    expect(patternLabel({ cadence: "monthly", kind: "day-of-month", anchorDay: 31, monthStep: 1, anchorMonth: 1, shift: "after" }, "monthly")).toBe("Monthly on the last day");
    expect(patternLabel({ cadence: "semimonthly", kind: "semimonthly", anchorDays: [1, 15], shift: "before" }, "semimonthly")).toBe("Semi-monthly on the 1st and 15th");
    expect(patternLabel({ cadence: "quarterly", kind: "day-of-month", anchorDay: 20, monthStep: 3, anchorMonth: 2, shift: "after" }, "quarterly")).toBe("Quarterly (Feb, May, Aug, Nov)");
  });
});

describe("amounts and evidence", () => {
  it("variable utility within a band is one recurring bill", () => {
    const b = base();
    b.series("chk", monthly("2025-10", 20), i => 95 + ((i * 37) % 80), "CON ED OF NY INTELL CK", { pfc: "RENT_AND_UTILITIES", pfcd: "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY", merchant_name: "Con Edison" });
    const it = find(review(b).review.items, /con ed/i)!;
    expect(it).toMatchObject({ group: "bills", amountKind: "variable" });
    expect(it.amountRange[0]).toBeLessThan(it.amountRange[1]);
  });
  it("a bill seen only twice is not recurring yet", () => {
    const b = base();
    b.series("chk", ["2026-08-08", "2026-09-08"], 49.99, "T-MOBILE POSTPAID", { pfc: "RENT_AND_UTILITIES", pfcd: "RENT_AND_UTILITIES_TELEPHONE" });
    expect(find(review(b).review.items, /mobile/i)).toBeUndefined();
  });
  it("income needs 3+ months: 5 weekly deposits in 5 weeks is not enough", () => {
    const b = base();
    b.series("chk", everyNDays("2026-09-25", 7), -400, "GIG CO PAYOUT", { ...WAGES, merchant_name: "Gig Co" });
    expect(find(review(b).review.items, /gig/i)).toBeUndefined();
  });
  it("each detection has confidence, matched ids, next date and monthly amount", () => {
    const b = base();
    b.series("card", monthly("2025-10", 14), 15.49, "NETFLIX.COM", { pfc: "ENTERTAINMENT", pfcd: "ENTERTAINMENT_TV_AND_MOVIES", merchant_name: "Netflix" });
    const it = find(review(b).review.items, /netflix/i)!;
    expect(it.confidence).toBeGreaterThan(0.8);
    expect(it.transactionIds.length).toBe(13);
    expect(it.matched[0].date >= it.matched[1].date).toBe(true);
    expect(it.nextDue).toMatch(/^2026-11-1/);
    expect(it.monthly).toBe(15.49);
    expect(it.why).toMatch(/13 payments/);
  });
});

describe("false positives", () => {
  it("repeated food, grocery, gas and shopping merchants are never recurring", () => {
    const b = base();
    b.series("card", everyNDays("2026-01-05", 7), 6.25, "STARBUCKS STORE 1234", { pfc: "FOOD_AND_DRINK", pfcd: "FOOD_AND_DRINK_COFFEE", merchant_name: "Starbucks" });
    b.series("card", everyNDays("2026-01-03", 7), i => 120 + (i % 5) * 18, "WHOLE FOODS MARKET", { pfc: "FOOD_AND_DRINK", pfcd: "FOOD_AND_DRINK_GROCERIES", merchant_name: "Whole Foods" });
    b.series("card", monthly("2026-01", 9), 15, "CHIPOTLE 0441", { pfc: "FOOD_AND_DRINK", pfcd: "FOOD_AND_DRINK_FAST_FOOD", merchant_name: "Chipotle" });
    b.series("card", everyNDays("2026-01-06", 10), 48, "SHELL OIL 5744", { pfc: "TRANSPORTATION", pfcd: "TRANSPORTATION_GAS", merchant_name: "Shell" });
    b.series("card", monthly("2026-01", 22), i => 30 + i * 9, "AMAZON MKTPL", { pfc: "GENERAL_MERCHANDISE", pfcd: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES", merchant_name: "Amazon" });
    b.series("card", monthly("2026-01", 18), 45.1, "DOORDASH*THAI PLACE", { pfc: "FOOD_AND_DRINK", pfcd: "FOOD_AND_DRINK_RESTAURANT", merchant_name: "DoorDash" });
    const items = review(b).review.items;
    expect(items.map(i => i.label)).toEqual([]);
  });
  it("…but a subscription or membership at a food/shopping merchant is", () => {
    const b = base();
    b.series("card", monthly("2026-01", 4), 9.99, "DOORDASH DASHPASS", { pfc: "FOOD_AND_DRINK", pfcd: "FOOD_AND_DRINK_RESTAURANT", merchant_name: "DoorDash" });
    b.series("card", ["2025-06-02", "2026-06-02", "2024-06-03"], 65, "COSTCO ANNUAL MEMBERSHIP", { pfc: "GENERAL_MERCHANDISE", pfcd: "GENERAL_MERCHANDISE_SUPERSTORES", merchant_name: "Costco" });
    const items = review(b).review.items;
    expect(find(items, /dashpass|doordash/i)).toMatchObject({ group: "bills", cadence: "monthly" });
  });
  it("internal transfers are not income; a monthly transfer into savings is a savings goal", () => {
    const b = base();
    b.pair("chk", "sav", monthly("2026-01", 2), 500, "ONLINE TRANSFER TO SAV ...2222", "ONLINE TRANSFER FROM CHK ...1111", { pfc: "TRANSFER_OUT", pfcd: "TRANSFER_OUT_SAVINGS" }, { pfc: "TRANSFER_IN", pfcd: "TRANSFER_IN_SAVINGS" });
    const m = review(b);
    expect(m.review.items.filter(i => i.group === "income")).toEqual([]);
    expect(find(m.review.items, /savings/i)).toMatchObject({ group: "savings", label: "Transfers to Online Savings", monthly: 500 });
    expect(m.rows.income.find(r => r.id === "salary")!.monthly).toBe(0);
  });
  it("a card's 'payment received' leg is not income", () => {
    const b = base();
    b.pair("chk", "card", monthly("2026-01", 25), i => 900 + i * 13, "CHASE CREDIT CRD AUTOPAY", "AUTOMATIC PAYMENT - THANK YOU", { pfc: "LOAN_PAYMENTS", pfcd: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }, { pfc: "LOAN_PAYMENTS", pfcd: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" });
    const items = review(b).review.items;
    expect(items.filter(i => i.group === "income")).toEqual([]);
    expect(find(items, /chase/i)).toMatchObject({ group: "payments", kind: "card_payment" });
  });
});

describe("dedupe", () => {
  it("one mortgage from descriptor variants (and the loan account's leg)", () => {
    const b = base();
    const names = ["ROCKET MORTGAGE PAYMENT", "ROCKET MTG ACH WEB PMT", "Rocket Mortgage"];
    monthly("2025-10", 1).forEach((d, i) => {
      const amt = d >= "2026-01-01" ? 2611.42 : 2450.18;
      b.tx("chk", d, amt, names[i % 3], { pfc: "LOAN_PAYMENTS", pfcd: "LOAN_PAYMENTS_MORTGAGE_PAYMENT", merchant_name: i % 2 ? "Rocket Mortgage" : null });
      b.tx("mtg", d, -amt, "PAYMENT RECEIVED", { pfc: "LOAN_PAYMENTS", pfcd: "LOAN_PAYMENTS_MORTGAGE_PAYMENT" });
    });
    const m = review(b);
    expect(m.review.items.filter(i => i.kind === "loan")).toHaveLength(1);
    expect(m.rows.obligations.filter(r => /rocket/i.test(r.label))).toHaveLength(1);
    expect(m.rows.obligations[0].monthly).toBeCloseTo(2611.42, 2);
  });
  it("salary per employer: two employers stay two; a split deposit is added up", () => {
    const b = base();
    semimonthly("2026-01").forEach(d => { b.tx("chk", d, -2650, "GLOBEX INC PAYROLL", WAGES); b.tx("sav", d, -300, "GLOBEX INC PAYROLL", WAGES); });
    b.series("chk", everyNDays("2026-02-06", 14), i => -(410 + (i % 3) * 60), "DOORDASH DASHER PAYMENT", { ...WAGES, merchant_name: "DoorDash" });
    const inc = review(b).review.items.filter(i => i.group === "income");
    expect(inc.map(i => i.key).sort()).toEqual(["inflow|pay:doordash", "inflow|pay:globex"]);
    expect(find(inc, /globex/i)!.amount).toBe(2950);
  });
});

describe("decisions", () => {
  const netflix = () => { const b = base(); b.series("card", monthly("2025-10", 14), 15.49, "NETFLIX.COM", { pfc: "ENTERTAINMENT", pfcd: "ENTERTAINMENT_TV_AND_MOVIES", merchant_name: "Netflix" }); return b; };
  it("a deleted item never comes back, even after new transactions", () => {
    const b = netflix();
    const it = find(review(b).review.items, /netflix/i)!;
    const dec = decisionFor(it, { status: "dismissed" });
    b.tx("card", "2026-10-28", 15.49, "NETFLIX.COM", { pfc: "ENTERTAINMENT", pfcd: "ENTERTAINMENT_TV_AND_MOVIES", merchant_name: "Netflix" });
    const m = review(b, [dec]);
    expect(find(m.review.items, /netflix/i)).toBeUndefined();
    expect(find(m.review.dismissed, /netflix/i)).toBeTruthy();
    expect(m.rows.fixed.find(r => /netflix/i.test(r.label))).toBeUndefined();
  });
  it("restore brings it back", () => {
    const b = netflix();
    const it = find(review(b).review.items, /netflix/i)!;
    const m = review(b, [{ ...decisionFor(it, { status: "dismissed" }), status: "suggested" }]);
    expect(find(m.review.items, /netflix/i)!.status).toBe("suggested");
  });
  it("an edited item keeps the person's cadence, amount, group and account", () => {
    const b = netflix();
    const it = find(review(b).review.items, /netflix/i)!;
    const m = review(b, [decisionFor(it, { status: "confirmed", cadence: "yearly", amount: 180, coverAccountId: "chk" })]);
    const ed = find(m.review.items, /netflix/i)!;
    expect(ed).toMatchObject({ status: "confirmed", edited: true, cadence: "yearly", amount: 180, monthly: 15, coverAccountId: "chk", coverUserSet: true });
    const row = m.rows.fixed.find(r => r.reviewKey === ed.key)!;
    expect(row.monthly).toBe(15);
    expect(row.coverId).toBe("chk");
    expect(row.coverSource).toBe("user");
  });
  it("a confirmed item that didn't arrive is flagged missed or late", () => {
    const b = base();
    b.series("chk", monthly("2026-01", 3, "after", "2026-09-30"), 1650, "ZELLE TO DAVID KIM RENT", { merchant_name: "David Kim", pfc: "TRANSFER_OUT", pfcd: "TRANSFER_OUT_ACCOUNT_TRANSFER" });
    const it = find(review(b).review.items, /david kim/i)!;
    expect(it.missed).toBe(false);
    const ed = find(review(b, [decisionFor(it, { status: "confirmed" })]).review.items, /david kim/i)!;
    expect(ed.missed).toBe(true);
    expect(ed.daysLate).toBeGreaterThan(0);
  });
  it("a confirmed item detection no longer finds is still listed (and missed)", () => {
    const b = base();
    const dec: RecurringDecision = { key: "outflow|gym co", status: "confirmed", snapshot: { label: "Gym Co", group: "bills", kind: "subscription", cadence: "monthly", amount: 40, lastSeen: "2026-07-01", nextDue: "2026-08-01", transactionIds: [], direction: "outflow" } };
    const it = find(review(b, [dec]).review.items, /gym/i)!;
    expect(it).toMatchObject({ status: "confirmed", missed: true, monthly: 40 });
  });
});
