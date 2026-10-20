import { describe, expect, it } from "vitest";
import type { RecurringSeries, Occurrence } from "@/lib/recurring/detect";
import type { ClassifierAccount, ClassifierTxn, TransactionClassifier } from "@/lib/recurring/classifier";
import {
  addBusinessDays,
  autopayMissedFinding,
  billAutopayFinding,
  businessDaysBetween,
  cardAutopayFindings,
  cardPaymentsFrom,
  detectAutopayMissed,
  detectBillAutopay,
  detectBillAutopays,
  detectCardAutopay,
  isSensitiveSeries,
  type CardInput,
  type CardPayment,
} from "@/lib/infer";

const accounts: ClassifierAccount[] = [
  { account_id: "chk", type: "depository", subtype: "checking" },
  { account_id: "chk2", type: "depository", subtype: "checking" },
  { account_id: "sav", type: "depository", subtype: "savings" },
  { account_id: "visa", type: "credit", subtype: "credit card" },
];

type Pay = { date: string; amount?: number; account?: string; name?: string; channel?: string; authorized?: string | null; expected?: string };

/** A monthly series whose occurrences were paid on the given dates. */
function series(name: string, pays: Pay[], extra: Partial<RecurringSeries> = {}): { s: RecurringSeries; txns: ClassifierTxn[] } {
  const txns: ClassifierTxn[] = pays.map((p, i) => ({
    transaction_id: `${name}-${i}`,
    account_id: p.account ?? "chk",
    amount: p.amount ?? 100,
    date: p.date,
    name: p.name ?? `${name.toUpperCase()} PAYMENT`,
    merchant_name: name,
    payment_channel: p.channel ?? "other",
    authorized_date: p.authorized === undefined ? p.date : p.authorized,
  }));
  const occurrences: Occurrence[] = pays.map((p, i) => ({
    period: p.expected ?? p.date,
    expectedDate: p.expected ?? p.date,
    expectedAmount: p.amount ?? 100,
    status: "paid",
    transactionId: txns[i].transaction_id,
    actualDate: p.date,
    actualAmount: p.amount ?? 100,
    daysLate: 0,
  }));
  const s: RecurringSeries = {
    seriesKey: `out:${name}`,
    merchantKey: name,
    displayName: name,
    direction: "outflow",
    txnType: "obligation_bill",
    subtype: null,
    kind: "bill",
    category: "Utilities",
    cadence: "monthly",
    schedule: { cadence: "monthly", kind: "day-of-month", anchorDay: 12, shift: "after" } as unknown as RecurringSeries["schedule"],
    accountId: pays[0]?.account ?? "chk",
    counterpartAccountId: null,
    amount: { median: 100, min: 100, max: 100, cv: 0, isFixed: true, priceChanged: false } as RecurringSeries["amount"],
    nextExpectedDate: "2026-11-12",
    nextExpectedAmount: 100,
    firstSeen: pays[0]?.date ?? "2026-01-01",
    lastSeen: pays[pays.length - 1]?.date ?? "2026-01-01",
    occurrenceCount: pays.length,
    active: true,
    mustPay: true,
    confidence: 0.9,
    transactionIds: txns.map(t => t.transaction_id),
    occurrences,
    reason: "test",
    ...extra,
  };
  return { s, txns };
}
const byId = (txns: ClassifierTxn[]) => new Map(txns.map(t => [t.transaction_id, t] as const));
const run = (x: { s: RecurringSeries; txns: ClassifierTxn[] }, paydays?: string[]) => detectBillAutopay(x.s, byId(x.txns), { accounts, paydays });

// Business days in 2026: Jul 13 Mon, Aug 12 Wed, Sep 14 Mon (12th = Sat), Oct 12 Mon (Columbus Day = bank holiday)
const SAME_DAY = [{ date: "2026-07-13" }, { date: "2026-08-12" }, { date: "2026-09-14", expected: "2026-09-12" }, { date: "2026-10-13", expected: "2026-10-12" }];

describe("business days", () => {
  it("counts bank days, skipping weekends and holidays", () => {
    expect(businessDaysBetween("2026-10-09", "2026-10-13")).toBe(1); // Sat, Sun, Columbus Day, then Tue
    expect(businessDaysBetween("2026-10-13", "2026-10-09")).toBe(-1);
    expect(addBusinessDays("2026-10-09", 1)).toBe("2026-10-13");
  });
});

describe("bill autopay (§2.1)", () => {
  it("N≥3 same account, on schedule → auto, High, bank", () => {
    const r = run(series("Electric", SAME_DAY))!;
    expect(r.autopay).toBe("auto");
    expect(r.tier).toBe("high");
    expect(r.payMethod).toBe("bank");
    expect(r.payFromAccountId).toBe("chk");
    expect(r.payDay).toBeGreaterThanOrEqual(12);
    expect(r.payDay).toBeLessThanOrEqual(14);
    expect(r.signals).toEqual(expect.arrayContaining(["same_account", "on_schedule"]));
  });

  it("a weekend / holiday shift to the next bank day counts as on time", () => {
    const r = run(series("Water", [{ date: "2026-08-12" }, { date: "2026-09-14", expected: "2026-09-12" }, { date: "2026-10-13", expected: "2026-10-12" }]))!;
    expect(r.signals).toContain("exact_timing");
  });

  it("N=2 → Medium", () => {
    const r = run(series("Gas", SAME_DAY.slice(-2)))!;
    expect(r.autopay).toBe("auto");
    expect(r.tier).toBe("medium");
  });

  it("one payment is never enough", () => {
    expect(run(series("Gas", SAME_DAY.slice(-1)))).toBeNull();
  });

  it("amount changes never rule autopay out", () => {
    const r = run(series("Electric", SAME_DAY.map((p, i) => ({ ...p, amount: [82, 131, 147, 96][i] }))))!;
    expect(r.autopay).toBe("auto");
    expect(r.tier).toBe("high");
  });

  it("boosters (descriptor, online without authorization) lift confidence, capped at +0.2", () => {
    const plain = run(series("Electric", SAME_DAY.map(p => ({ ...p, expected: p.date }))))!;
    const boosted = run(series("Electric", SAME_DAY.map(p => ({ ...p, expected: p.date, name: "CON ED AUTOPAY PPD", channel: "online", authorized: null }))))!;
    expect(boosted.signals).toEqual(expect.arrayContaining(["autopay_descriptor", "no_authorization", "exact_timing"]));
    expect(boosted.confidence).toBeGreaterThan(plain.confidence);
    expect(boosted.confidence - 0.85).toBeLessThanOrEqual(0.2 + 1e-9);
  });

  it("a card-paid bill is High at N≥3 with pay method card", () => {
    const r = run(series("Netflix", SAME_DAY.map(p => ({ ...p, account: "visa" })), { kind: "subscription" }))!;
    expect(r.autopay).toBe("auto");
    expect(r.payMethod).toBe("card");
    expect(r.payFromAccountId).toBe("visa");
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("different accounts in recent cycles → not autopay (manual)", () => {
    const r = run(series("Rent", [{ date: "2026-07-01" }, { date: "2026-08-01", account: "chk2" }, { date: "2026-09-01" }, { date: "2026-10-01", account: "chk2" }]))!;
    expect(r.autopay).toBe("manual");
    expect(r.signals).toContain("account_switch");
  });

  it("one OLD account exception is allowed when N≥5 and isn't penalised (rule 2)", () => {
    const pays = ["2026-05-12", "2026-06-12", "2026-07-13", "2026-08-12", "2026-09-14", "2026-10-13"].map((d, i) => ({ date: d, account: i === 1 ? "chk2" : "chk" }));
    const r = run(series("Phone", pays))!;
    expect(r.signals).toContain("same_account");
    expect(r.signals).not.toContain("account_switch");
    expect(r.autopay).toBe("auto");
    expect(r.payFromAccountId).toBe("chk");
  });

  it("a switch among the last 3 cycles costs −0.5 (rule 7)", () => {
    const pays = ["2026-05-12", "2026-06-12", "2026-07-13", "2026-08-12", "2026-09-14", "2026-10-13"].map((d, i) => ({ date: d, account: i === 4 ? "chk2" : "chk" }));
    const r = run(series("Phone", pays))!;
    expect(r.signals).toContain("account_switch");
    expect(r.autopay).not.toBe("auto"); // 0.85 − 0.5 drops below Medium
  });

  it("BILL PAY / ONLINE PMT wording costs 0.3: never High, only a Medium suggestion when timing is exact", () => {
    const r = run(series("Insurance", SAME_DAY.map(p => ({ ...p, name: "ONLINE PMT STATE FARM" }))))!;
    expect(r.signals).toContain("billpay_descriptor");
    expect(r.tier).toBe("medium");
  });

  it("BILL PAY wording without exact timing → manual", () => {
    const pays = [{ date: "2026-07-13", expected: "2026-07-12" }, { date: "2026-08-14", expected: "2026-08-12" }, { date: "2026-09-12", expected: "2026-09-12" }, { date: "2026-10-14", expected: "2026-10-12" }];
    const r = run(series("Insurance", pays.map(p => ({ ...p, name: "BILL PAY STATE FARM" }))))!;
    expect(r.autopay).toBe("manual");
    expect(r.payMethod).toBe("manual");
    expect(r.signals).toContain("billpay_descriptor");
  });

  it("dates wandering more than ±3 days and ±2 day-of-month → manual", () => {
    const r = run(series("Daycare", [{ date: "2026-07-03", expected: "2026-07-01" }, { date: "2026-08-09", expected: "2026-08-01" }, { date: "2026-09-05", expected: "2026-09-01" }, { date: "2026-10-12", expected: "2026-10-01" }]))!;
    expect(r.autopay).toBe("manual");
    expect(r.signals).toContain("irregular_timing");
  });

  it("manual-payer trap: always paid right after payday → not High autopay", () => {
    const x = series("Cable", SAME_DAY);
    const paydays = SAME_DAY.map(p => p.date); // paid the same day the paycheck lands
    const r = run(x, paydays)!;
    expect(r.signals).toContain("payday_aligned");
    expect(r.tier).not.toBe("high");
  });

  it("a late or skipped cycle breaks the run", () => {
    const x = series("Electric", SAME_DAY);
    x.s.occurrences[1] = { ...x.s.occurrences[1], status: "late", transactionId: null, actualDate: null };
    expect(run(x)!.cycles).toBe(2); // only the cycles after the late one
    x.s.occurrences[2] = { ...x.s.occurrences[2], status: "skipped", transactionId: null, actualDate: null };
    expect(run(x)).toBeNull();
  });

  it("only bills, loans and subscriptions; never income or inactive series", () => {
    expect(run(series("Payroll", SAME_DAY, { kind: "salary", direction: "inflow" }))).toBeNull();
    expect(run(series("Electric", SAME_DAY, { active: false }))).toBeNull();
    expect(run(series("Mortgage", SAME_DAY, { kind: "loan" }))!.autopay).toBe("auto");
  });

  it("privacy: medical, donations, legal and P2P are never inferred", () => {
    expect(run(series("City Hospital", SAME_DAY))).toBeNull();
    expect(run(series("Grace Church", SAME_DAY))).toBeNull();
    expect(run(series("Smith Attorney", SAME_DAY))).toBeNull();
    expect(run(series("Rent", SAME_DAY.map(p => ({ ...p, name: "Zelle payment to J SMITH" }))))).toBeNull();
    const pfc = series("Acme", SAME_DAY);
    pfc.txns[0].pfc_primary = "MEDICAL";
    expect(isSensitiveSeries(pfc.s, byId(pfc.txns))).toBe(true);
    expect(run(series("Gym", SAME_DAY, { subtype: "p2p" }))).toBeNull();
  });

  it("findings carry no raw descriptors (privacy) and only for auto Medium+", () => {
    const r = run(series("Electric", SAME_DAY.map(p => ({ ...p, name: "CON ED AUTOPAY PPD ID 99887766" }))))!;
    const f = billAutopayFinding(r)!;
    expect(f.kind).toBe("bill_autopay");
    expect(f.subjectRef).toBe("out:Electric");
    expect(JSON.stringify(f)).not.toMatch(/99887766|PPD ID/);
    expect(f.evidence).toHaveLength(4);
    expect(billAutopayFinding({ ...r, autopay: "manual" })).toBeNull();
    expect(billAutopayFinding({ ...r, tier: "low" })).toBeNull();
  });

  it("detectBillAutopays derives paydays from salary series", () => {
    const bill = series("Cable", SAME_DAY);
    const pay = series("Employer", SAME_DAY, { kind: "salary", direction: "inflow", seriesKey: "in:emp" });
    const [r] = detectBillAutopays([bill.s, pay.s], [...bill.txns], { accounts });
    expect(r.signals).toContain("payday_aligned");
  });
});

describe("missed autopay (§2.4)", () => {
  it("flags a confirmed autopay with no payment by due + 3 business days; two misses downgrade", () => {
    const x = series("Electric", SAME_DAY);
    const miss = (o: Occurrence): Occurrence => ({ ...o, status: "late", transactionId: null, actualDate: null, actualAmount: null });
    x.s.occurrences[3] = miss(x.s.occurrences[3]);
    expect(detectAutopayMissed(x.s, { payFromAccountId: "chk" }, "2026-10-15")).toBeNull(); // only 2 bank days after Oct 12
    const one = detectAutopayMissed(x.s, { payFromAccountId: "chk" }, "2026-10-20")!;
    expect(one.missedDates).toEqual(["2026-10-12"]);
    expect(one.downgrade).toBe(false);
    x.s.occurrences[2] = miss(x.s.occurrences[2]);
    const two = detectAutopayMissed(x.s, { payFromAccountId: "chk" }, "2026-10-20")!;
    expect(two.downgrade).toBe(true);
    expect(autopayMissedFinding(two).payload.lastMissed).toBe("2026-10-12");
  });
});

// ── Cards ───────────────────────────────────────────────────────────────────

const pay = (date: string, amount: number, from: string | null = "chk", words = false): CardPayment => ({
  cardAccountId: "visa", transactionId: `p-${date}`, date, amount, fromAccountId: from, autopayWords: words,
});
const st = (due: string, bal: number, min = 35) => ({ statement_issue_date: `${due.slice(0, 8)}01`, statement_balance: bal, minimum_payment_amount: min, due_date: due });
const card = (extra: Partial<CardInput> = {}): CardInput => ({ account: accounts[3], ...extra });
const TODAY = "2026-10-20";

describe("card autopay (§2.2)", () => {
  // Dues: Jul 15 Wed, Aug 15 Sat, Sep 15 Tue, Oct 15 Thu
  const statements = [st("2026-07-15", 812.4), st("2026-08-15", 1290.05), st("2026-09-15", 940), st("2026-10-15", 1104.2)];

  it("statement balance on the due date for 3+ cycles → full, High", () => {
    const ps = [pay("2026-07-15", 812.4), pay("2026-08-14", 1290.05), pay("2026-09-15", 940), pay("2026-10-15", 1104.2)];
    const r = detectCardAutopay(card({ statements }), ps, { today: TODAY })!;
    expect(r.autopay).toBe("auto");
    expect(r.mode).toBe("full");
    expect(r.tier).toBe("high");
    expect(r.fromAccountId).toBe("chk");
    expect(r.fromSource).toBe("detected");
    expect(r.dueDay).toBe(15);
    expect(r.carriedBalance).toBeNull();
  });

  it("±$1 / ±0.5% still counts as full", () => {
    const ps = [pay("2026-09-15", 940.8), pay("2026-10-15", 1100)]; // 0.4%
    const r = detectCardAutopay(card({ statements }), ps, { today: TODAY })!;
    expect(r.mode).toBe("full");
    expect(r.tier).toBe("medium"); // only 2 cycles
  });

  it("minimum payments → minimum, with the carried balance", () => {
    const ps = [pay("2026-08-13", 35), pay("2026-09-14", 35), pay("2026-10-15", 35)];
    const r = detectCardAutopay(card({ statements }), ps, { today: TODAY })!;
    expect(r.mode).toBe("minimum");
    expect(r.carriedBalance).toBeCloseTo(1104.2 - 35);
  });

  it("the same amount below the statement → fixed", () => {
    const ps = [pay("2026-08-14", 500), pay("2026-09-15", 500), pay("2026-10-14", 500.5)];
    const r = detectCardAutopay(card({ statements }), ps, { today: TODAY })!;
    expect(r.mode).toBe("fixed");
    expect(r.amount).toBe(500);
  });

  it("several payments per cycle or early payments → manual", () => {
    const ps = [pay("2026-08-02", 300), pay("2026-08-10", 400), pay("2026-08-25", 900), pay("2026-09-28", 600), pay("2026-10-03", 500)];
    const r = detectCardAutopay(card({ statements }), ps, { today: TODAY })!;
    expect(r.autopay).toBe("manual");
    expect(r.mode).toBe("manual");
  });

  it("without statement history only the latest cycle is classified, Medium at most", () => {
    const details = { last_statement_balance: 1104.2, minimum_payment_amount: 35, next_payment_due_date: "2026-10-15", last_statement_issue_date: "2026-09-20" };
    const one = detectCardAutopay(card({ details }), [pay("2026-10-15", 1104.2)], { today: TODAY })!;
    expect(one.mode).toBe("full");
    expect(one.tier).toBe("medium");
    const timedOnly = detectCardAutopay(card({ details }), [pay("2026-08-14", 990), pay("2026-09-15", 760), pay("2026-10-15", 1104.2)], { today: TODAY })!;
    expect(timedOnly.autopay).toBe("auto");
    expect(timedOnly.tier).toBe("medium"); // full only verified for the latest cycle
  });

  it("the user's cardAutopayFrom wins; 2+ disagreeing cycles raise card_autopay_source", () => {
    const ps = [pay("2026-08-14", 1290.05, "chk2"), pay("2026-09-15", 940, "chk2"), pay("2026-10-15", 1104.2, "chk2")];
    const r = detectCardAutopay(card({ statements, userAutopayFrom: "chk" }), ps, { today: TODAY })!;
    expect(r.fromAccountId).toBe("chk");
    expect(r.fromSource).toBe("user");
    expect(r.disagreeingFromAccountId).toBe("chk2");
    const fs = cardAutopayFindings(r);
    expect(fs.map(f => f.kind)).toEqual(["card_autopay", "card_autopay_source"]);
    expect(fs[1].payload).toMatchObject({ fromAccountId: "chk2", currentFromAccountId: "chk" });
    // agreement → no source finding
    const ok = detectCardAutopay(card({ statements, userAutopayFrom: "chk2" }), ps, { today: TODAY })!;
    expect(ok.disagreeingFromAccountId).toBeNull();
  });

  it("an open current cycle doesn't break the run", () => {
    const sts = [...statements, st("2026-11-16", 700)];
    const ps = [pay("2026-08-14", 1290.05), pay("2026-09-15", 940), pay("2026-10-15", 1104.2)];
    const r = detectCardAutopay(card({ statements: sts }), ps, { today: TODAY })!;
    expect(r.autopay).toBe("auto");
    expect(r.cycles).toBe(3);
  });

  it("no due date known → nothing", () => {
    expect(detectCardAutopay(card(), [pay("2026-10-15", 10)], { today: TODAY })).toBeNull();
  });
});

describe("card payments via the shared classifier", () => {
  it("takes card-side credit_card_payment legs and resolves the paying account from the pair", () => {
    const txns: ClassifierTxn[] = [
      { transaction_id: "bank", account_id: "chk", amount: 940, date: "2026-09-15", name: "CHASE CREDIT CRD AUTOPAY", merchant_name: null },
      { transaction_id: "cardside", account_id: "visa", amount: -940, date: "2026-09-15", name: "AUTOMATIC PAYMENT - THANK YOU", merchant_name: null },
      { transaction_id: "refund", account_id: "visa", amount: -20, date: "2026-09-16", name: "AMAZON REFUND", merchant_name: "Amazon" },
    ];
    const ps = cardPaymentsFrom(txns, accounts);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ cardAccountId: "visa", transactionId: "cardside", amount: 940, fromAccountId: "chk", autopayWords: true });
  });

  it("uses whatever classifier it's given (underscore type names)", () => {
    const fake: TransactionClassifier = {
      classifyAll: ts => new Map(ts.map(t => [t.transaction_id, { txnType: "credit_card_payment", confidence: 1, source: "user", counterpartAccountId: "sav" }] as const)),
    };
    const ps = cardPaymentsFrom([{ transaction_id: "x", account_id: "visa", amount: -5, date: "2026-10-01", name: "PMT", merchant_name: null }], accounts, fake);
    expect(ps[0].fromAccountId).toBe("sav");
  });
});
