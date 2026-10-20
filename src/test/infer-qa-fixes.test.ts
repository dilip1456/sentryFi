/**
 * Tester's PR #25 repros (results/pr25/zz-qa-repro.test.ts) as real tests,
 * plus §2.4 manual downgrade and the "suggestions never write autopay=auto" rule.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { Occurrence, RecurringSeries } from "@/lib/recurring/detect";
import type { ClassifierAccount, ClassifierTxn } from "@/lib/recurring/classifier";
import {
  autopayMissedFinding,
  billAutopayFinding,
  decide,
  detectAutopayMissed,
  detectBillAutopay,
  detectCardAutopay,
  overviewFindings,
  reconcileFindings,
  streamAutopayPatch,
  streamCountsAsAutopay,
  surfaceFindings,
  SURFACED_KEY,
  type CardInput,
  type CardPayment,
  type Finding,
  type InferenceRow,
} from "@/lib/infer";

const accounts: ClassifierAccount[] = [
  { account_id: "chk", type: "depository", subtype: "checking" },
  { account_id: "chk2", type: "depository", subtype: "checking" },
  { account_id: "sav", type: "depository", subtype: "savings" },
  { account_id: "visa", type: "credit", subtype: "credit card" },
];

type Pay = { date: string; amount?: number; account?: string; name?: string; channel?: string; authorized?: string | null; expected?: string };

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

describe("(1) bill autopay: N = 2 cycles is Medium (§2.1 rule 5)", () => {
  it("all boosters on 2 cycles stay below High", () => {
    const { s, txns } = series("Electric", [
      { date: "2026-08-12", name: "ELECTRIC AUTOPAY PPD" },
      { date: "2026-09-14", expected: "2026-09-14", name: "ELECTRIC AUTOPAY PPD" },
    ]);
    const r = detectBillAutopay(s, byId(txns), { accounts })!;
    expect(r.cycles).toBe(2);
    expect(r.confidence).toBe(0.84);
    expect(r.tier).toBe("medium");
    expect(billAutopayFinding(r)).not.toBeNull(); // still asked as a Finding
  });
  it("a third cycle reaches High", () => {
    const { s, txns } = series("Electric", ["2026-08-12", "2026-09-14", "2026-10-12"].map(d => ({ date: d, name: "ELECTRIC AUTOPAY PPD" })));
    expect(detectBillAutopay(s, byId(txns), { accounts })!.tier).toBe("high");
  });
});

describe("(2) bill autopay: the −0.5 penalty is for a RECENT switch only", () => {
  const dates = ["2026-04-13", "2026-05-12", "2026-06-12", "2026-07-13", "2026-08-12", "2026-09-14"];
  it("N = 6 with one old exception: no penalty, High, a finding", () => {
    const { s, txns } = series("Internet", dates.map((d, i) => ({ date: d, account: i === 0 ? "chk2" : "chk" })));
    const r = detectBillAutopay(s, byId(txns), { accounts })!;
    expect(r.signals).not.toContain("account_switch");
    expect(r.tier).toBe("high");
    expect(r.payFromAccountId).toBe("chk");
    expect(billAutopayFinding(r)).not.toBeNull();
  });
  it("N = 6 with the exception in the last 3 cycles: penalised, no autopay finding", () => {
    const { s, txns } = series("Internet", dates.map((d, i) => ({ date: d, account: i === 4 ? "chk2" : "chk" })));
    const r = detectBillAutopay(s, byId(txns), { accounts })!;
    expect(r.signals).toContain("account_switch");
    expect(billAutopayFinding(r)).toBeNull();
  });
});

describe("(3) card autopay: 'fixed' stays Medium until statement history exists", () => {
  const pays: CardPayment[] = ["2026-07-08", "2026-08-07", "2026-09-08", "2026-10-08"].map((d, i) => ({
    cardAccountId: "visa", transactionId: "p" + i, date: d, amount: 300, fromAccountId: "chk", autopayWords: false,
  }));
  it("no statements: fixed, Medium", () => {
    const card: CardInput = {
      account: accounts[3],
      details: { next_payment_due_date: "2026-11-08", last_statement_balance: 900, minimum_payment_amount: 35, last_statement_issue_date: "2026-10-12" },
      statements: [],
    };
    const r = detectCardAutopay(card, pays, { today: "2026-10-20" })!;
    expect(r.mode).toBe("fixed");
    expect(r.tier).toBe("medium");
    expect(r.confidence).toBe(0.7);
  });
  it("3 statements above the payment: fixed, High", () => {
    const statements = ["2026-08-08", "2026-09-08", "2026-10-08"].map(due => ({ statement_issue_date: due, statement_balance: 900, minimum_payment_amount: 35, due_date: due }));
    const card: CardInput = { account: accounts[3], details: { next_payment_due_date: "2026-11-08", last_statement_balance: 900, minimum_payment_amount: 35, last_statement_issue_date: "2026-10-12" }, statements };
    const r = detectCardAutopay(card, pays, { today: "2026-10-20" })!;
    expect(r.mode).toBe("fixed");
    expect(r.tier).toBe("high");
  });
});

const NOW = new Date("2026-10-20T16:00:00Z");
const row = (i: number, created: string, status: InferenceRow["status"] = "suggested"): InferenceRow => ({
  id: "i" + i, user_id: "u", kind: "bill_autopay", subject_type: "stream", subject_ref: "s" + i, payload: { amount: 100 }, confidence: 0.9,
  evidence_txn_ids: [], fingerprint: null, status, reason: null, suppressed_until: null, expires_at: null, detector_version: 1,
  last_detected_at: created, created_at: created, decided_at: null,
});
/** What the app does: persist the newly surfaced rows. */
const persist = (rows: InferenceRow[], saved: InferenceRow[]) => rows.map(r => saved.find(x => x.id === r.id) ?? r);

describe("(4) overview: at most 3 NEW findings per week", () => {
  it("answering the week's 3 doesn't surface 3 more the same week", () => {
    let rows = [1, 2, 3, 4, 5, 6].map(i => row(i, "2026-10-19T12:00:00Z"));
    const first = surfaceFindings(rows, NOW);
    expect(first.shown).toHaveLength(3);
    rows = persist(rows, first.toSave);
    const ids = first.shown.map(r => r.id);
    rows = rows.map(r => (ids.includes(r.id) ? decide(r, { action: "confirm" }, NOW) : r));
    expect(overviewFindings(rows, new Date("2026-10-22T16:00:00Z"))).toEqual([]);
    // next week the slots free up
    const nextWeek = surfaceFindings(rows, new Date("2026-10-27T17:00:00Z"));
    expect(nextWeek.shown).toHaveLength(3);
    expect(nextWeek.shown.map(r => r.id)).not.toEqual(expect.arrayContaining(ids));
  });
  it("findings already surfaced stay on show without using new slots; re-detection keeps surfacedAt", () => {
    let rows = [1, 2].map(i => row(i, "2026-10-19T12:00:00Z"));
    rows = persist(rows, surfaceFindings(rows, NOW).toSave);
    const later = new Date("2026-10-21T16:00:00Z");
    const f = (i: number): Finding => ({ kind: "bill_autopay", subjectType: "stream", subjectRef: "s" + i, payload: { amount: 101 }, confidence: 0.9, evidence: [], detectorVersion: 1 });
    rows = persist(rows, reconcileFindings([f(1), f(2)], rows, { userId: "u", now: later }));
    expect(rows.every(r => r.payload[SURFACED_KEY] === NOW.toISOString())).toBe(true);
    rows.push(row(3, "2026-10-21T12:00:00Z"), row(4, "2026-10-21T12:00:00Z"));
    const s = surfaceFindings(rows, later);
    expect(s.shown.map(r => r.id)).toEqual(["i1", "i2", "i3"]);
    expect(s.toSave.map(r => r.id)).toEqual(["i3"]);
  });
  it("a rejected finding that comes back (material change) can surface again", () => {
    const prev = { ...row(9, "2026-05-01T00:00:00Z", "rejected"), payload: { amount: 100, [SURFACED_KEY]: "2026-05-01T00:00:00Z" }, suppressed_until: "2026-11-01T00:00:00Z" };
    const f: Finding = { kind: "bill_autopay", subjectType: "stream", subjectRef: "s9", payload: { amount: 200 }, confidence: 0.9, evidence: [], detectorVersion: 1 };
    const out = reconcileFindings([f], [prev], { userId: "u", now: NOW });
    expect(out[0].status).toBe("suggested");
    expect(out[0].payload[SURFACED_KEY]).toBeUndefined();
    expect(overviewFindings(out, NOW).map(r => r.id)).toEqual(["i9"]);
  });
});

describe("(5) §2.4: a confirmed autopay paid by hand → Manual, pending confirm", () => {
  const confirmed = { payFromAccountId: "chk", payDay: 12 };
  it("bill-pay wording on the latest payment", () => {
    const { s, txns } = series("Electric", [{ date: "2026-08-12" }, { date: "2026-09-14" }, { date: "2026-10-12", name: "ONLINE PMT ELECTRIC" }]);
    const r = detectAutopayMissed(s, confirmed, "2026-10-20", byId(txns))!;
    expect(r.missedDates).toEqual([]);
    expect(r.manualPayment).toMatchObject({ transactionId: "Electric-2", reasons: ["billpay_descriptor"] });
    expect(r.downgradeTo).toBe("manual");
    const f = autopayMissedFinding(r);
    expect(f.confidence).toBe(0.7); // Medium: asks to confirm
    expect(f.payload).toMatchObject({ downgradeTo: "manual", manualTransactionId: "Electric-2" });
  });
  it("a different account, or a day more than 5 off", () => {
    const acct = series("Water", [{ date: "2026-09-12" }, { date: "2026-10-12", account: "sav" }]);
    expect(detectAutopayMissed(acct.s, confirmed, "2026-10-20", byId(acct.txns))!.manualPayment!.reasons).toEqual(["different_account"]);
    const day = series("Gas", [{ date: "2026-09-12" }, { date: "2026-10-19", expected: "2026-10-12" }]);
    expect(detectAutopayMissed(day.s, confirmed, "2026-10-20", byId(day.txns))!.manualPayment!.reasons).toEqual(["different_day"]);
  });
  it("an on-time autopay debit, or a payment from before the confirm date, raises nothing", () => {
    const ok = series("Electric", [{ date: "2026-09-14" }, { date: "2026-10-13" }]);
    expect(detectAutopayMissed(ok.s, confirmed, "2026-10-20", byId(ok.txns))).toBeNull();
    const old = series("Water", [{ date: "2026-10-12", account: "sav" }]);
    expect(detectAutopayMissed(old.s, { ...confirmed, since: "2026-10-15" }, "2026-10-20", byId(old.txns))).toBeNull();
  });
  it("Confirm writes Manual; a suggestion or 'Not right' changes nothing; hand-set values are kept", () => {
    const { s, txns } = series("Electric", [{ date: "2026-09-14" }, { date: "2026-10-12", name: "BILL PAY ELECTRIC", account: "sav" }]);
    const f = autopayMissedFinding(detectAutopayMissed(s, confirmed, "2026-10-20", byId(txns))!);
    const base: InferenceRow = { ...row(1, NOW.toISOString()), kind: "autopay_missed", subject_ref: f.subjectRef, payload: f.payload, confidence: f.confidence };
    expect(streamAutopayPatch(base)).toBeNull();
    expect(streamAutopayPatch({ ...base, status: "rejected" })).toBeNull();
    const p = streamAutopayPatch({ ...base, status: "confirmed" })!;
    expect(p).toMatchObject({ autopay: "manual", autopay_source: "confirmed", pay_method: "manual", pay_from_account_id: "sav", autopay_inference_id: "i1" });
    expect(streamCountsAsAutopay(p)).toBe(false);
    expect(streamAutopayPatch({ ...base, status: "confirmed" }, { autopay_source: "user", autopay_inference_id: null })).toBeNull();
  });
  it("two misses in a row: Confirm drops it back to Unknown", () => {
    const base: InferenceRow = { ...row(1, NOW.toISOString(), "confirmed"), kind: "autopay_missed", payload: { downgrade: true, downgradeTo: "unknown" } };
    expect(streamAutopayPatch(base)).toMatchObject({ autopay: "unknown", autopay_source: null });
  });
});

describe("(6) only confirmed or hand-set autopay is ever stored as autopay = 'auto'", () => {
  const p = { autopay: "auto", payMethod: "bank", payFromAccountId: "chk", payDay: 12 };
  const statuses: InferenceRow["status"][] = ["suggested", "confirmed", "rejected", "expired"];
  it("for every status and prior state, autopay = 'auto' is written only when it counts", () => {
    for (const status of statuses) {
      for (const current of [null, { autopay_source: "detected" as const, autopay_inference_id: "i1" }, { autopay_source: "confirmed" as const, autopay_inference_id: "other" }]) {
        const patch = streamAutopayPatch({ ...row(1, NOW.toISOString(), status), payload: p }, current);
        if (patch?.autopay === "auto") expect(streamCountsAsAutopay(patch), `${status}`).toBe(true);
      }
    }
  });
  it("no app code reads recurring_streams.autopay directly (use streamCountsAsAutopay)", () => {
    const root = join(__dirname, "..");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (statSync(f).isDirectory()) { if (n !== "test") walk(f); }
        else if (/\.(ts|tsx)$/.test(n)) files.push(f);
      }
    };
    walk(root);
    // apply.ts defines the rule; autopay.ts reads its own detector results, not stream rows
    const allowed = [join("lib", "infer", "apply.ts"), join("lib", "infer", "autopay.ts")];
    const offenders = files.filter(f => !allowed.some(a => f.endsWith(a)) && /\.autopay\s*===?\s*["']auto["']/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
