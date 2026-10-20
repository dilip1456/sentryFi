import { describe, expect, it } from "vitest";
import {
  addDays,
  amountModel,
  createSharedClassifier,
  withOverrides,
  detectRecurringSeries,
  mergeStreamRow,
  occurrenceOverridesFromRows,
  toOccurrenceRows,
  toStreamRow,
  type ClassifierAccount,
  type ClassifierTxn,
  type RecurringSeries,
  type TransactionClassifier,
  type TxnClassification,
  type TxnType,
  TXN_TYPES,
} from "@/lib/recurring/index";

const TODAY = "2026-10-20"; // Tuesday

const ACCOUNTS: ClassifierAccount[] = [
  { account_id: "chk", type: "depository", subtype: "checking", name: "Everyday Checking", mask: "1111" },
  { account_id: "chk2", type: "depository", subtype: "checking", name: "Bills Checking", mask: "2222" },
  { account_id: "hysa", type: "depository", subtype: "savings", name: "HYSA", mask: "3333", role: "savings" },
  { account_id: "mtg", type: "loan", subtype: "mortgage", name: "Home Loan", mask: "4444" },
  { account_id: "card", type: "credit", subtype: "credit card", name: "Sapphire", mask: "5555" },
];

let seq = 0;
function tx(date: string, amount: number, name: string, extra: Partial<ClassifierTxn> = {}): ClassifierTxn {
  return { transaction_id: `t${++seq}`, account_id: "chk", amount, date, name, merchant_name: null, ...extra };
}

/** Plaid sign: inflow is negative. */
const pay = (date: string, amount: number, name: string, extra?: Partial<ClassifierTxn>) => tx(date, -amount, name, extra);

function detect(txns: ClassifierTxn[], opts: Parameters<typeof detectRecurringSeries>[2] = {}) {
  return detectRecurringSeries(txns, ACCOUNTS, { today: TODAY, ...opts });
}

function only(series: RecurringSeries[], pred: (s: RecurringSeries) => boolean): RecurringSeries {
  const hits = series.filter(pred);
  expect(hits).toHaveLength(1);
  return hits[0];
}

const statusOf = (s: RecurringSeries) => Object.fromEntries(s.occurrences.map(o => [o.period, o.status]));

// 1st/15th payroll; weekends and New Year's Day paid the business day BEFORE.
const SEMI_MONTHLY_PAYDAYS = [
  "2025-12-31", // Jan 1 holiday
  "2026-01-15",
  "2026-01-30", // Feb 1 Sunday
  "2026-02-13", // Feb 15 Sunday
  "2026-02-27", // Mar 1 Sunday
  "2026-03-13", // Mar 15 Sunday
  "2026-04-01",
  "2026-04-15",
  "2026-05-01",
  "2026-05-15",
  "2026-06-01",
  "2026-06-15",
  "2026-07-01",
  "2026-07-15",
  "2026-07-31", // Aug 1 Saturday
  "2026-08-14", // Aug 15 Saturday
  "2026-09-01",
  "2026-09-15",
  "2026-10-01",
  "2026-10-15",
];

describe("salary detection", () => {
  it("detects semi-monthly 1st/15th payroll with weekend and holiday shifts", () => {
    const txns = SEMI_MONTHLY_PAYDAYS.map(d => pay(d, 3210.55, "ACME CORP PAYROLL PPD ID: 9876543210"));
    const s = only(detect(txns), x => x.kind === "salary");
    expect(s.cadence).toBe("semimonthly");
    expect(s.schedule).toMatchObject({ kind: "semimonthly", anchorDays: [1, 15], shift: "before" });
    expect(s.direction).toBe("inflow");
    expect(s.txnType).toBe("income_salary");
    expect(s.occurrenceCount).toBe(20);
    expect(s.occurrences.filter(o => o.status === "paid")).toHaveLength(20);
    expect(s.occurrences.some(o => o.status === "late" || o.status === "skipped")).toBe(false);
    // Nov 1 2026 is a Sunday → paid Friday Oct 30.
    expect(s.nextExpectedDate).toBe("2026-10-30");
    expect(s.nextExpectedAmount).toBe(3210.55);
    expect(s.mustPay).toBe(false);
    expect(s.amount.isFixed).toBe(true);
  });

  it("detects biweekly payroll and does not confuse it with semi-monthly", () => {
    const txns: ClassifierTxn[] = [];
    for (let d = "2026-01-09"; d <= TODAY; d = addDays(d, 14)) txns.push(pay(d, 2480 + (txns.length % 3), "GUSTO DIR DEP BETA LLC"));
    const s = only(detect(txns), x => x.kind === "salary");
    expect(s.cadence).toBe("biweekly");
    expect(s.lastSeen).toBe("2026-10-16");
    expect(s.nextExpectedDate).toBe("2026-10-30");
    expect(s.nextExpectedAmount).toBeCloseTo(2481, 0);
    expect(s.occurrences.every(o => o.status === "paid" || o.expectedDate > TODAY)).toBe(true);
  });

  it("marks a missing paycheck late", () => {
    const txns = SEMI_MONTHLY_PAYDAYS.filter(d => d !== "2026-10-15").map(d => pay(d, 3210.55, "ACME CORP PAYROLL"));
    const s = only(detect(txns), x => x.kind === "salary");
    const oct15 = s.occurrences.find(o => o.period === "2026-10-15")!;
    expect(oct15.status).toBe("late");
    expect(oct15.daysLate).toBe(3); // 5 days after payday minus the 2-day paycheck grace
    expect(s.active).toBe(true);
  });
});

describe("bills", () => {
  // Drafted on the 5th; weekends/holidays post the next business day.
  const ELECTRIC = [
    ["2026-01-05", 142.1], ["2026-02-05", 158.4], ["2026-03-05", 131.0], ["2026-04-06", 98.75],
    ["2026-05-05", 88.2], ["2026-06-05", 121.3], ["2026-07-06", 176.9], ["2026-08-05", 189.4],
    ["2026-09-08", 163.25], ["2026-10-05", 117.6],
  ] as const;

  it("detects a variable monthly utility bill with shift-after and predicts the next one", () => {
    const txns = ELECTRIC.map(([d, a]) => tx(d, a, "CON EDISON ELECTRIC PAYMENT"));
    const s = only(detect(txns), x => x.kind === "bill");
    expect(s.cadence).toBe("monthly");
    expect(s.schedule).toMatchObject({ kind: "day-of-month", anchorDay: 5, shift: "after" });
    expect(s.subtype).toBe("utility");
    expect(s.mustPay).toBe(true);
    expect(s.amount.isFixed).toBe(false);
    expect(s.nextExpectedDate).toBe("2026-11-05");
    // Variable → median of the last 6.
    expect(s.nextExpectedAmount).toBeCloseTo((121.3 + 163.25) / 2, 2);
    expect(Object.values(statusOf(s)).filter(v => v === "paid")).toHaveLength(10);
  });

  it("detects a fixed subscription, flags the price change and predicts the new price", () => {
    const dates = ["2026-03-12", "2026-04-12", "2026-05-12", "2026-06-12", "2026-07-12", "2026-08-12", "2026-09-12", "2026-10-12"];
    const txns = dates.map((d, i) => tx(d, i < 6 ? 15.49 : 17.99, "NETFLIX.COM", { merchant_name: "Netflix" }));
    const s = only(detect(txns), x => x.merchantKey === "netflix");
    expect(s.kind).toBe("subscription");
    expect(s.cadence).toBe("monthly");
    expect(s.mustPay).toBe(false);
    expect(s.amount.priceChanged).toBe(true);
    expect(s.nextExpectedAmount).toBe(17.99);
    expect(s.nextExpectedDate).toBe("2026-11-12");
  });

  it("finds a monthly charge hidden among one-off purchases at the same merchant", () => {
    const prime = ["2026-05-03", "2026-06-03", "2026-07-03", "2026-08-03", "2026-09-03", "2026-10-03"].map(d =>
      tx(d, 14.99, "AMAZON PRIME*2K4", { merchant_name: "Amazon" }),
    );
    const random = [["2026-05-19", 63.2], ["2026-06-07", 12.5], ["2026-07-22", 240.0], ["2026-09-14", 31.8]].map(([d, a]) =>
      tx(d as string, a as number, "AMAZON.COM*AB12", { merchant_name: "Amazon" }),
    );
    const s = only(detect([...prime, ...random]), x => x.merchantKey === "amazon");
    expect(s.cadence).toBe("monthly");
    expect(s.amount.expected).toBe(14.99);
    expect(s.seriesKey).toMatch(/~15$/);
  });
});

describe("loans", () => {
  it("detects a mortgage paid to a linked loan account and uses the servicer's due date", () => {
    const txns: ClassifierTxn[] = [];
    for (const d of ["2026-03-02", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-03", "2026-09-01", "2026-10-01"]) {
      txns.push(tx(d, 2150, "MR COOPER MORTGAGE PMT"));
      txns.push(pay(d, 2150, "PAYMENT THANK YOU", { account_id: "mtg" }));
    }
    const series = detect(txns, {
      loanDetails: [{ account_id: "mtg", kind: "mortgage", next_payment_due_date: "2026-11-01", next_monthly_payment: 2163.4 }],
    });
    expect(series).toHaveLength(1); // the loan-side inflow leg is internal and ignored
    const s = series[0];
    expect(s.kind).toBe("loan");
    expect(s.subtype).toBe("mortgage");
    expect(s.txnType).toBe("obligation_loan");
    expect(s.counterpartAccountId).toBe("mtg");
    expect(s.cadence).toBe("monthly");
    expect(s.mustPay).toBe(true);
    expect(s.nextExpectedDate).toBe("2026-11-01");
    expect(s.nextExpectedAmount).toBe(2163.4);
  });

  it("detects a student loan to an unlinked servicer and predicts from history", () => {
    const txns = ["2026-04-21", "2026-05-21", "2026-06-22", "2026-07-21", "2026-08-21", "2026-09-21"].map(d => tx(d, 312.44, "NAVIENT ONLINE PMT"));
    const s = only(detect(txns), x => x.kind === "loan");
    expect(s.subtype).toBe("student");
    expect(s.mustPay).toBe(true);
    expect(s.nextExpectedDate).toBe("2026-10-21");
    expect(s.occurrences.find(o => o.period === "2026-10-21")?.status).toBe("expected");
  });
});

describe("taxes", () => {
  it("models federal estimated taxes on the IRS quarterly calendar", () => {
    const paid = [
      ["2025-04-15", 2500], ["2025-06-16", 2500], ["2025-09-12", 2500], ["2026-01-15", 2500],
      ["2026-04-15", 3100], ["2026-06-15", 3100], ["2026-09-15", 3100],
    ] as const;
    const txns = paid.map(([d, a]) => tx(d, a, "IRS USATAXPYMT 1040ES"));
    const s = only(detect(txns), x => x.kind === "tax");
    expect(s.cadence).toBe("quarterly");
    expect(s.schedule.kind).toBe("irs-estimated");
    expect(s.subtype).toBe("irs_estimated");
    expect(s.mustPay).toBe(true);
    expect(s.nextExpectedDate).toBe("2027-01-15");
    expect(s.nextExpectedAmount).toBe(3100);
    const st = statusOf(s);
    expect(st["2025-Q3"]).toBe("paid"); // paid 3 days early
    expect(st["2026-Q3"]).toBe("paid");
    expect(st["2026-Q4"]).toBe("expected");
  });

  it("marks a missed estimated payment late, and skipped once a later one is paid", () => {
    const base = [["2026-01-15", 2500], ["2026-04-15", 2500], ["2026-06-15", 2500]] as const;
    const late = only(detect(base.map(([d, a]) => tx(d, a, "IRS USATAXPYMT 1040ES"))), x => x.kind === "tax");
    expect(statusOf(late)["2026-Q3"]).toBe("late");

    const withQ4Prev = [["2025-09-15", 2500], ["2026-04-15", 2500], ["2026-06-15", 2500], ["2026-09-15", 2500]] as const;
    const skipped = only(detect(withQ4Prev.map(([d, a]) => tx(d, a, "IRS USATAXPYMT 1040ES"))), x => x.kind === "tax");
    expect(statusOf(skipped)["2025-Q4"]).toBe("skipped");
  });

  it("suggests an estimated-tax stream from a single 1040-ES payment", () => {
    const s = only(detect([tx("2026-09-15", 1800, "IRS 1040ES ESTIMATED TAX")]), x => x.kind === "tax");
    expect(s.schedule.kind).toBe("irs-estimated");
    expect(s.confidence).toBeLessThan(0.5);
    expect(s.nextExpectedDate).toBe("2027-01-15");
  });
});

describe("yearly items", () => {
  it("detects a yearly insurance premium from two years of history", () => {
    const txns = [tx("2025-03-10", 1284.0, "GEICO AUTO INSURANCE"), tx("2026-03-09", 1326.5, "GEICO AUTO INSURANCE")];
    const s = only(detect(txns), x => x.merchantKey.startsWith("geico"));
    expect(s.cadence).toBe("yearly");
    expect(s.kind).toBe("bill");
    expect(s.subtype).toBe("insurance");
    expect(s.mustPay).toBe(true);
    expect(s.nextExpectedDate?.startsWith("2027-03")).toBe(true);
  });

  it("predicts a yearly renewal from one charge with a yearly descriptor", () => {
    const s = only(detect([tx("2026-02-02", 139, "AMAZON PRIME MEMBERSHIP ANNUAL RENEWAL")]), () => true);
    expect(s.cadence).toBe("yearly");
    expect(s.nextExpectedDate).toBe("2027-02-02");
    expect(s.confidence).toBeLessThan(0.5);
  });

  it("does not invent a series from a single ordinary purchase", () => {
    expect(detect([tx("2026-02-02", 139, "BEST BUY #123")])).toHaveLength(0);
  });
});

describe("occurrence status", () => {
  const monthly = (days: string[], amount: number, name: string) => days.map(d => tx(d, amount, name));

  it("skipped when a period is missed but the series continues", () => {
    const s = only(detect(monthly(["2026-05-11", "2026-06-10", "2026-07-10", "2026-09-10", "2026-10-12"], 40, "PLANET FITNESS")), () => true);
    const st = statusOf(s);
    expect(st["2026-08-10"]).toBe("skipped");
    expect(st["2026-09-10"]).toBe("paid");
    expect(s.active).toBe(true);
    expect(s.nextExpectedDate).toBe("2026-11-10");
  });

  it("late when the latest due period has no payment past the grace window", () => {
    const s = only(detect(monthly(["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-03", "2026-09-01"], 2400, "OAKWOOD APARTMENTS RENT")), () => true);
    const oct = s.occurrences.find(o => o.period === "2026-10-01")!;
    expect(oct.status).toBe("late");
    expect(oct.daysLate).toBe(14); // 19 days after the due date minus 5 days grace
    expect(s.kind).toBe("bill");
    expect(s.subtype).toBe("rent");
    expect(s.nextExpectedDate).toBe("2026-11-02"); // Nov 1 Sunday → Monday
  });

  it("paid (with days late) when the payment lands after the grace window", () => {
    const s = only(detect(monthly(["2026-06-01", "2026-07-01", "2026-08-03", "2026-09-01", "2026-10-12"], 2400, "OAKWOOD APARTMENTS RENT")), () => true);
    const oct = s.occurrences.find(o => o.period === "2026-10-01")!;
    expect(oct.status).toBe("paid");
    expect(oct.daysLate).toBe(6);
  });

  it("ends a series after two missed periods in a row (no next prediction)", () => {
    const s = only(detect(monthly(["2026-03-20", "2026-04-20", "2026-05-20", "2026-06-22", "2026-07-20"], 9.99, "SPOTIFY USA")), () => true);
    expect(s.active).toBe(false);
    expect(s.nextExpectedDate).toBeNull();
  });

  it("honours a user-set occurrence status", () => {
    const txns = monthly(["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-03", "2026-09-01"], 2400, "OAKWOOD APARTMENTS RENT");
    const key = only(detect(txns), () => true).seriesKey;
    const s = only(detect(txns, { occurrenceOverrides: [{ seriesKey: key, period: "2026-10-01", status: "paid" }] }), () => true);
    const oct = s.occurrences.find(o => o.period === "2026-10-01")!;
    expect(oct.status).toBe("paid");
    expect(oct.userSet).toBe(true);
  });
});

describe("internal transfers are ignored", () => {
  it("ignores both legs of a recurring transfer between own accounts", () => {
    const txns: ClassifierTxn[] = [];
    for (const d of ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-03", "2026-09-01", "2026-10-01"]) {
      txns.push(tx(d, 500, "ONLINE TRANSFER TO CHK ...2222"));
      txns.push(pay(addDays(d, 1), 500, "ONLINE TRANSFER FROM CHK ...1111", { account_id: "chk2" }));
    }
    expect(detect(txns)).toHaveLength(0);
  });

  it("ignores recurring savings sweeps to a linked HYSA and card payments to a linked card", () => {
    const txns: ClassifierTxn[] = [];
    for (const d of ["2026-05-15", "2026-06-15", "2026-07-15", "2026-08-14", "2026-09-15", "2026-10-15"]) {
      txns.push(tx(d, 750, "TRANSFER TO SAVINGS ...3333"));
      txns.push(pay(d, 750, "TRANSFER FROM CHECKING", { account_id: "hysa" }));
      txns.push(tx(addDays(d, 3), 1200, "CHASE CREDIT CRD AUTOPAY"));
      txns.push(pay(addDays(d, 3), 1200, "AUTOMATIC PAYMENT - THANK YOU", { account_id: "card" }));
    }
    expect(detect(txns)).toHaveLength(0);
  });

  it("ignores anything the classifier calls transfer_internal, whatever the descriptor", () => {
    const internalEverything: TransactionClassifier = {
      classifyAll: ts => new Map(ts.map(t => [t.transaction_id, { txnType: "transfer_internal", confidence: 1, source: "pair" } as TxnClassification])),
    };
    const txns = SEMI_MONTHLY_PAYDAYS.map(d => pay(d, 3210.55, "ACME CORP PAYROLL"));
    expect(detect(txns, { classifier: internalEverything })).toHaveLength(0);
  });
});

describe("user overrides win over the classifier", () => {
  const rentByZelle = () =>
    ["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-03", "2026-09-01", "2026-10-01"].map(d => tx(d, 1800, "ZELLE TO JOHN SMITH"));

  it("a transfer_out promoted to a bill becomes a must-pay bill series", () => {
    const txns = rentByZelle();
    const before = only(detect(txns), () => true);
    expect(before.kind).toBe("transfer");
    expect(before.mustPay).toBe(false);
    const overrides = txns.map(t => ({ transaction_id: t.transaction_id, txn_type: "obligation_bill" as const, subtype: "rent" }));
    const after = only(detect(txns, { overrides }), () => true);
    expect(after.txnType).toBe("obligation_bill");
    expect(after.kind).toBe("bill");
    expect(after.subtype).toBe("rent");
    expect(after.mustPay).toBe(true);
  });

  it("deposits overridden to transfer_internal drop out", () => {
    const txns = SEMI_MONTHLY_PAYDAYS.map(d => pay(d, 3210.55, "ACME CORP PAYROLL"));
    const overrides = txns.map(t => ({ transaction_id: t.transaction_id, txn_type: "transfer_internal" as const }));
    expect(detect(txns, { overrides })).toHaveLength(0);
  });

  it("matched internal legs overridden to salary are detected as salary", () => {
    const txns: ClassifierTxn[] = [];
    const inflows: ClassifierTxn[] = [];
    for (const d of SEMI_MONTHLY_PAYDAYS) {
      txns.push(tx(d, 2000, "ONLINE TRANSFER TO CHK ...1111", { account_id: "chk2" }));
      const i = pay(d, 2000, "ONLINE TRANSFER FROM CHK ...2222");
      inflows.push(i);
      txns.push(i);
    }
    expect(detect(txns)).toHaveLength(0);
    const overrides = inflows.map(t => ({ transaction_id: t.transaction_id, txn_type: "income_salary" as const }));
    const s = only(detect(txns, { overrides }), () => true);
    expect(s.kind).toBe("salary");
    expect(s.cadence).toBe("semimonthly");
  });

  it("overrides apply on top of any classifier implementing the interface", () => {
    const allSpend: TransactionClassifier = {
      classifyAll: ts => new Map(ts.map(t => [t.transaction_id, { txnType: "spend", confidence: 0.5, source: "fallback" } as TxnClassification])),
    };
    const txns = ["2026-04-15", "2026-06-15", "2026-09-15"].map(d => tx(d, 900, "STATE OF NJ"));
    const overrides = txns.map(t => ({ transaction_id: t.transaction_id, txn_type: "obligation_tax" as const, subtype: "irs_estimated" }));
    const s = only(detect(txns, { classifier: allSpend, overrides }), () => true);
    expect(s.kind).toBe("tax");
    expect(s.schedule.kind).toBe("irs-estimated");
  });
});

describe("shared classifier adapter (src/lib/classify)", () => {
  const c = createSharedClassifier();

  it("passes the shared taxonomy through unchanged", () => {
    const t1 = pay("2026-10-15", 3000, "ACME PAYROLL");
    const t2 = pay("2026-10-15", 1.23, "INTEREST PAID", { account_id: "hysa" });
    const t3 = tx("2026-10-15", 500, "IRS USATAXPYMT");
    const t4 = tx("2026-10-15", 25, "STARBUCKS");
    const t5 = tx("2026-10-01", 400, "NELNET STUDENT LN");
    const out = c.classifyAll([t1, t2, t3, t4, t5], { accounts: ACCOUNTS });
    expect(out.get(t1.transaction_id)?.txnType).toBe("income_salary");
    expect(out.get(t2.transaction_id)?.txnType).toBe("income_interest");
    expect(out.get(t3.transaction_id)?.txnType).toBe("obligation_tax");
    expect(out.get(t4.transaction_id)?.txnType).toBe("spend");
    expect(out.get(t5.transaction_id)?.txnType).toBe("obligation_loan");
    for (const v of out.values()) expect(TXN_TYPES).toContain(v.txnType);
  });

  it("resolves a pair to the other leg's account", () => {
    const out1 = tx("2026-10-01", 750, "TRANSFER TO SAVINGS ...3333");
    const in1 = pay("2026-10-01", 750, "TRANSFER FROM CHECKING", { account_id: "hysa" });
    const out = c.classifyAll([out1, in1], { accounts: ACCOUNTS });
    expect(out.get(out1.transaction_id)).toMatchObject({ txnType: "savings_contribution", source: "pair", counterpartAccountId: "hysa" });
    expect(out.get(in1.transaction_id)).toMatchObject({ txnType: "transfer_internal", counterpartAccountId: "chk" });
  });

  it("ignores overrides that are not a known underscore type name", () => {
    const t = tx("2026-10-15", 25, "STARBUCKS");
    const bogus = [{ transaction_id: t.transaction_id, txn_type: "obligation-bill" as unknown as TxnType }];
    const out = withOverrides(c, bogus).classifyAll([t], { accounts: ACCOUNTS });
    expect(out.get(t.transaction_id)).toMatchObject({ txnType: "spend" });
    expect(out.get(t.transaction_id)?.source).not.toBe("user");
  });

  it("txn_overrides rows win over the classifier", () => {
    const t = tx("2026-10-15", 25, "STARBUCKS");
    const out = withOverrides(c, [{ transaction_id: t.transaction_id, txn_type: "obligation_bill" }]).classifyAll([t], { accounts: ACCOUNTS });
    expect(out.get(t.transaction_id)).toMatchObject({ txnType: "obligation_bill", source: "user", confidence: 1 });
  });

  it("forwards extra shared context (self names make 'Zelle to me' internal)", () => {
    const txns = ["2026-06-01", "2026-07-01", "2026-08-03", "2026-09-01", "2026-10-01"].map(d => tx(d, 300, "ZELLE TO DILIP KUMAR"));
    expect(detect(txns)).toHaveLength(1);
    expect(detect(txns, { classifier: createSharedClassifier({ selfNames: ["Dilip Kumar"] }) })).toHaveLength(0);
  });

  it("never treats money arriving on a linked loan or card account as income", () => {
    const txns = ["2026-06-01", "2026-07-01", "2026-08-03", "2026-09-01", "2026-10-01"].map(d => pay(d, 2150, "PAYMENT RECEIVED", { account_id: "mtg" }));
    expect(detect(txns)).toHaveLength(0);
  });
});

describe("amount model", () => {
  it("separates fixed and variable amounts", () => {
    expect(amountModel([50, 50, 50, 50]).isFixed).toBe(true);
    const v = amountModel([80, 140, 95, 180, 120]);
    expect(v.isFixed).toBe(false);
    expect(v.expected).toBe(120);
  });
});

describe("persistence rows", () => {
  it("maps a series to rows and preserves the user's decisions on re-detection", () => {
    const txns = ["2026-06-01", "2026-07-01", "2026-08-03", "2026-09-01", "2026-10-01"].map(d => tx(d, 2400, "OAKWOOD APARTMENTS RENT"));
    const s = only(detect(txns), () => true);
    const row = toStreamRow(s, "user-1");
    expect(row).toMatchObject({ user_id: "user-1", cadence: "monthly", day_anchor: 1, shift_policy: "after", must_pay: true, status: "suggested" });
    expect(row.next_expected_date).toBe("2026-11-02");
    expect(row.txn_type).toBe("spend"); // same spelling as txn_overrides / the shared classifier

    const merged = mergeStreamRow(row, { id: "s1", status: "confirmed", must_pay: false, must_pay_user_set: true, obligation_id: "o1" });
    expect(merged).toMatchObject({ id: "s1", status: "confirmed", must_pay: false, must_pay_user_set: true, obligation_id: "o1" });
    expect(mergeStreamRow(row, { id: "s1", status: "dismissed", must_pay: false, must_pay_user_set: false }).must_pay).toBe(true);

    const occ = toOccurrenceRows(s, "s1", "user-1");
    expect(occ.map(o => o.status)).toEqual(["paid", "paid", "paid", "paid", "paid", "expected"]);
    const back = occurrenceOverridesFromRows(
      [{ stream_id: "s1", period: "2026-10-01", status: "skipped", user_set: true }, { stream_id: "s1", period: "2026-09-01", status: "paid", user_set: false }],
      [{ id: "s1", series_key: s.seriesKey }],
    );
    expect(back).toEqual([{ seriesKey: s.seriesKey, period: "2026-10-01", status: "skipped" }]);
  });
});

describe("mixed real-world history", () => {
  it("keeps series separate and drops internal movement", () => {
    const txns: ClassifierTxn[] = [
      ...SEMI_MONTHLY_PAYDAYS.map(d => pay(d, 3210.55, "ACME CORP PAYROLL PPD ID: 9876543210")),
      ...["2026-04-21", "2026-05-21", "2026-06-22", "2026-07-21", "2026-08-21", "2026-09-21"].map(d => tx(d, 312.44, "NAVIENT ONLINE PMT")),
      ...["2026-03-12", "2026-04-12", "2026-05-12", "2026-06-12", "2026-07-12", "2026-08-12", "2026-09-12", "2026-10-12"].map(d =>
        tx(d, 15.49, "NETFLIX.COM", { merchant_name: "Netflix" }),
      ),
      tx("2026-07-04", 82.13, "TRADER JOES #552"),
      tx("2026-08-19", 45.0, "SHELL OIL 5741"),
    ];
    for (const d of ["2026-05-16", "2026-06-16", "2026-07-16", "2026-08-17", "2026-09-16", "2026-10-16"]) {
      txns.push(tx(d, 1000, "TRANSFER TO SAVINGS ...3333"));
      txns.push(pay(d, 1000, "TRANSFER FROM CHECKING", { account_id: "hysa" }));
    }
    const series = detect(txns);
    expect(series.map(s => s.kind).sort()).toEqual(["loan", "salary", "subscription"]);
    // Sorted by next expected date.
    expect(series.map(s => s.nextExpectedDate)).toEqual(["2026-10-21", "2026-10-30", "2026-11-12"]);
  });

  it("detects 15th / last-day semi-monthly payroll", () => {
    const days = ["2026-05-15", "2026-05-29", "2026-06-15", "2026-06-30", "2026-07-15", "2026-07-31", "2026-08-14", "2026-08-31", "2026-09-15", "2026-09-30", "2026-10-15"];
    const s = only(detect(days.map(d => pay(d, 2800, "INITECH PAYROLL"))), () => true);
    expect(s.cadence).toBe("semimonthly");
    expect(s.schedule).toMatchObject({ anchorDays: [15, 31] });
    expect(s.nextExpectedDate).toBe("2026-10-30"); // Oct 31 is a Saturday
  });
});
