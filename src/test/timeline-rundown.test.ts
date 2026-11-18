import { describe, expect, it } from "vitest";
import {
  amountTolerance, buildRundown, DEFAULT_RUNDOWN_SETTINGS, demoRundown, eligibleStreams, findGroup, isSpendableType, kindOf,
  matchItems, normalizeRundownSettings, plannedFromEvents, previewEdit, spendableAccounts, txnsFromPlaid,
  type PlannedItem, type RundownAccount, type RundownInput, type RundownTxn, type TimelineEvent, type UpcomingStream,
} from "@/lib/timeline";

const T = "2026-11-03"; // Tuesday. Sat 7, Sun 8; Wed 11 = Veterans Day (bank holiday)
const CHK: RundownAccount = { id: "chk", name: "Checking", type: "depository", subtype: "checking", balance: 1000 };
const SAV: RundownAccount = { id: "sav", name: "Savings", type: "depository", subtype: "savings", balance: 2000 };
const CARD: RundownAccount = { id: "card", name: "Card", type: "credit", subtype: "credit card", balance: 900 };
const LOAN: RundownAccount = { id: "loan", name: "Loan", type: "loan", subtype: "auto", balance: 9000 };
const INV: RundownAccount = { id: "inv", name: "Brokerage", type: "investment", subtype: "brokerage", balance: 50000 };

let n = 0;
const item = (p: Partial<PlannedItem> & Pick<PlannedItem, "date" | "amount">): PlannedItem => ({
  id: p.id ?? `i${++n}`, title: p.title ?? `Item ${n}`, kind: p.kind ?? (p.amount > 0 ? "income" : "bill"),
  accountId: p.accountId === undefined ? "chk" : p.accountId, source: "confirmed", shift: "none", ...p,
});
const txn = (p: Partial<RundownTxn> & Pick<RundownTxn, "date" | "amount">): RundownTxn => ({ id: p.id ?? `t${++n}`, accountId: "chk", name: null, pending: false, ...p });
const run = (p: Partial<RundownInput> = {}) => buildRundown({
  today: T, days: 14, items: [], txns: [], accounts: [CHK], settings: DEFAULT_RUNDOWN_SETTINGS, ...p,
});
const flag = (r: ReturnType<typeof run>, type: string) => r.flags.find(f => f.type === type);

describe("rundown: running balance", () => {
  it("starts from the spendable balance and applies income before outflows on the same day", () => {
    const r = run({ items: [item({ date: "2026-11-05", amount: -1200 }), item({ date: "2026-11-05", amount: 500, kind: "income" })] });
    expect(r.start).toBe(1000);
    expect(r.eod[0]).toBe(1000);
    expect(r.eod[2]).toBe(300);
    // income first, so the bill is covered by checking (1500 ≥ 1200): no risk
    expect(r.rows.every(x => !x.risk)).toBe(true);
    expect(r.incomeExpected).toBe(500);
    expect(r.billsDue).toBe(-1200);
  });

  it("7 vs 14 day horizon", () => {
    const items = [item({ date: "2026-11-06", amount: -100 }), item({ date: "2026-11-12", amount: -200 })];
    const r7 = run({ days: 7, items }), r14 = run({ days: 14, items });
    expect(r7.daysOut).toHaveLength(7);
    expect(r14.daysOut).toHaveLength(14);
    expect(r7.billsDue).toBe(-100);
    expect(r14.billsDue).toBe(-300);
    expect(r7.daysOut.at(-1)!.date).toBe("2026-11-09");
  });

  it("ignores everything beyond the horizon", () => {
    const r = run({ days: 7, items: [item({ date: "2026-11-20", amount: -5000 })] });
    expect(r.low).toBe(1000);
    expect(r.flags).toHaveLength(0);
  });
});

describe("rundown: shortfall", () => {
  it("below $0: date of first negative day, lowest amount and amount short", () => {
    const r = run({ items: [item({ date: "2026-11-06", amount: -800 }), item({ date: "2026-11-09", amount: -700 })] });
    const f = flag(r, "short");
    expect(f).toBeTruthy();
    if (f?.type !== "short") throw new Error();
    expect(f.date).toBe("2026-11-09");
    expect(f.low).toBe(-500);
    expect(f.lowDate).toBe("2026-11-09");
    expect(f.amountShort).toBe(500);
    expect(f.atRiskCount).toBe(1);
  });

  it("below the buffer but above $0: amber 'buffer' with the amount under the buffer", () => {
    const r = run({ items: [item({ date: "2026-11-06", amount: -700 })] });
    const f = flag(r, "buffer");
    if (f?.type !== "buffer") throw new Error("expected buffer flag");
    expect(f.date).toBe("2026-11-06");
    expect(f.low).toBe(300);
    expect(f.amountShort).toBe(200);
  });

  it("buffer is configurable", () => {
    const items = [item({ date: "2026-11-06", amount: -700 })];
    expect(run({ items, settings: { ...DEFAULT_RUNDOWN_SETTINGS, buffer: 100 } }).flags).toHaveLength(0);
    expect(run({ items, settings: { ...DEFAULT_RUNDOWN_SETTINGS, buffer: 400 } }).flags[0].type).toBe("buffer");
  });

  it("all clear when every payment is covered and above the buffer", () => {
    const r = run({ items: [item({ date: "2026-11-06", amount: -100 })] });
    expect(r.flags).toEqual([]);
    expect(r.low).toBe(900);
  });
});

describe("rundown: payment at risk (uncovered funding)", () => {
  it("flags a bill whose funding account is short even when the combined balance is fine", () => {
    const joint: RundownAccount = { id: "joint", name: "Joint", type: "depository", subtype: "checking", balance: 350 };
    const r = run({ accounts: [CHK, joint], items: [item({ id: "auto", date: "2026-11-05", amount: -410, accountId: "joint" })] });
    const f = flag(r, "risk");
    if (f?.type !== "risk") throw new Error("expected risk");
    expect(f.accountId).toBe("joint");
    expect(f.short).toBe(60);
    expect(r.low).toBe(940);
    expect(r.rows[0].risk).toEqual({ accountId: "joint", before: 350, short: 60 });
  });

  it("counts at-risk payments inside the Shortfall chip when combined is negative (no separate chip)", () => {
    const r = run({ items: [item({ date: "2026-11-05", amount: -1500 })] });
    expect(flag(r, "risk")).toBeUndefined();
    const f = flag(r, "short");
    if (f?.type !== "short") throw new Error();
    expect(f.atRiskCount).toBe(1);
  });

  it("a transfer into the funding account before the bill covers it", () => {
    const joint: RundownAccount = { id: "joint", name: "Joint", type: "depository", subtype: "checking", balance: 0 };
    const r = run({ accounts: [CHK, joint], items: [
      item({ date: "2026-11-05", amount: -300, kind: "transfer", accountId: "chk", toAccountId: "joint" }),
      item({ date: "2026-11-05", amount: -250, accountId: "joint" }),
    ] });
    expect(r.rows.every(x => !x.risk)).toBe(true);
    expect(r.eod[2]).toBe(750); // the transfer nets to zero in All spendable
  });
});

describe("rundown: late / missed payments and income (±3 days, 10% or $5)", () => {
  it("tolerance is max(10%, $5)", () => {
    expect(amountTolerance(20)).toBe(5);
    expect(amountTolerance(400)).toBe(40);
  });

  it("matches a payment within 3 days and within tolerance as paid (not late)", () => {
    const r = run({ items: [item({ date: "2026-11-01", amount: -100 })], txns: [txn({ date: "2026-11-03", amount: -108 })] });
    expect(r.rows[0].state).toBe("paid");
    expect(r.flags).toHaveLength(0);
  });

  it("does not match outside 3 days, outside the amount tolerance, or on another account", () => {
    const it0 = item({ date: "2026-10-30", amount: -100 });
    expect(run({ items: [it0], txns: [txn({ date: "2026-11-03", amount: -100 })] }).rows[0].state).toBe("late"); // 4 days
    expect(run({ items: [it0], txns: [txn({ date: "2026-10-30", amount: -115 })] }).rows[0].state).toBe("late"); // > $10
    expect(run({ items: [it0], accounts: [CHK, SAV], txns: [txn({ date: "2026-10-30", amount: -100, accountId: "sav" })] }).rows[0].state).toBe("late");
    expect(run({ items: [item({ date: "2026-11-01", amount: -20 })], txns: [txn({ date: "2026-11-01", amount: -24.5 })] }).rows[0].state).toBe("paid"); // $5 floor
  });

  it("a late bill is counted as leaving today; Late for 1–5 days, Missed after", () => {
    const late = run({ items: [item({ id: "a", date: "2026-11-01", amount: -300 })] });
    expect(late.rows[0]).toMatchObject({ state: "late", daysLate: 2, day: T, counts: true });
    expect(late.eod[0]).toBe(700);
    expect(flag(late, "late")).toBeTruthy();
    const missed = run({ items: [item({ id: "b", date: "2026-10-27", amount: -300 })] });
    expect(missed.rows[0].state).toBe("missed");
    expect(flag(missed, "missed")).toBeTruthy();
  });

  it("late income is not counted until it arrives; shows the what-if and the bills it puts at risk", () => {
    const r = run({ items: [
      item({ id: "inv", title: "Invoice", date: "2026-11-01", amount: 1200, kind: "income" }),
      item({ id: "rent", title: "Rent", date: "2026-11-06", amount: -1500 }),
    ] });
    expect(r.rows.find(x => x.item.id === "inv")!.state).toBe("late");
    expect(r.low).toBe(-500);
    const f = flag(r, "income_late");
    if (f?.type !== "income_late") throw new Error();
    expect(f.lowWithout).toBe(-500);
    expect(f.lowWith).toBe(700);
    expect(f.putsAtRisk).toEqual(["Rent"]);
    const s = flag(r, "short");
    if (s?.type !== "short") throw new Error();
    expect(s.ifIncome).toEqual({ amount: 1200, low: 700 });
    // late income is listed on Today
    expect(r.daysOut[0].entries.some(e => e.kind === "row" && e.row.item.id === "inv")).toBe(true);
  });

  it("income received in the window is tracked and counted (already in balance)", () => {
    const r = run({ items: [item({ date: "2026-11-02", amount: 2000, kind: "income" })], txns: [txn({ date: "2026-11-02", amount: 2000 })] });
    expect(r.rows[0].state).toBe("received");
    expect(r.incomeReceived).toBe(2000);
    expect(r.eod[0]).toBe(1000); // not double counted
  });

  it("missed income after 5 days", () => {
    const r = run({ items: [item({ date: "2026-10-25", amount: 900, kind: "income" })] });
    expect(flag(r, "income_missed")).toBeTruthy();
  });

  it("a pending match counts as paid and is not double-subtracted", () => {
    const r = run({ items: [item({ date: "2026-11-02", amount: -200 })], txns: [txn({ date: "2026-11-03", amount: -200, pending: true })] });
    expect(r.rows[0].state).toBe("pending");
    expect(r.eod[0]).toBe(1000);
  });

  it("user marks: paid / skipped are not projected; this-time-only override moves date and amount", () => {
    const r = run({ items: [
      item({ date: "2026-11-05", amount: -300, status: "paid" }),
      item({ date: "2026-11-05", amount: -300, status: "skipped" }),
      item({ date: "2026-11-05", amount: -300, override: { date: "2026-11-10", amount: 50 } }),
    ] });
    expect(r.eod[6]).toBe(1000);
    expect(r.eod[7]).toBe(950);
  });
});

describe("rundown: grouping", () => {
  const subs = (date: string) => [
    item({ date, amount: -2.99, kind: "subscription" }), item({ date, amount: -14.95, kind: "subscription" }), item({ date, amount: -11, kind: "subscription" }),
  ];
  it("groups 2+ small (<$25) items on the same day", () => {
    const r = run({ items: [...subs("2026-11-05"), item({ date: "2026-11-05", amount: -95 })] });
    const g = r.daysOut[2].entries.find(e => e.kind === "group");
    if (g?.kind !== "group") throw new Error("expected group");
    expect(g.rows).toHaveLength(3);
    expect(g.total).toBeCloseTo(-28.94);
    expect(findGroup(r, g.key)).toBe(g);
    expect(r.daysOut[2].entries.filter(e => e.kind === "row")).toHaveLength(1);
  });

  it("a single small item stays on its own row", () => {
    const r = run({ items: [item({ date: "2026-11-05", amount: -9.99, kind: "subscription" })] });
    expect(r.daysOut[2].entries[0].kind).toBe("row");
  });

  it("never groups income or flagged (late / at-risk) items", () => {
    const r = run({ items: [
      item({ date: "2026-11-01", amount: -3, kind: "subscription" }), // late → today, flagged
      item({ date: "2026-11-03", amount: -4, kind: "subscription" }),
      item({ date: "2026-11-03", amount: 10, kind: "income" }),
    ] });
    expect(r.daysOut[0].entries.every(e => e.kind === "row")).toBe(true);
  });

  it("does not group items paid from an account that is short that day", () => {
    const joint: RundownAccount = { id: "joint", name: "Joint", type: "depository", subtype: "checking", balance: 10 };
    const r = run({ accounts: [CHK, joint], items: [
      item({ date: "2026-11-05", amount: -20, kind: "subscription", accountId: "joint" }),
      item({ date: "2026-11-05", amount: -5, kind: "subscription", accountId: "joint" }),
    ] });
    expect(r.daysOut[2].entries.every(e => e.kind === "row")).toBe(true);
  });
});

describe("rundown: weekends and holidays", () => {
  it("ACH items on a weekend move to Monday; card due dates do not move", () => {
    const r = run({ items: [
      item({ id: "ach", date: "2026-11-07", amount: -100, shift: "next_business" }),
      item({ id: "card", date: "2026-11-07", amount: -50, kind: "card", shift: "none" }),
    ] });
    expect(r.rows.find(x => x.item.id === "ach")!.date).toBe("2026-11-09");
    expect(r.rows.find(x => x.item.id === "card")!.date).toBe("2026-11-07");
  });

  it("bank holidays (Veterans Day) move to the next business day", () => {
    const r = run({ items: [item({ date: "2026-11-11", amount: 500, kind: "income", shift: "next_business" })] });
    expect(r.rows[0].date).toBe("2026-11-12");
  });
});

describe("rundown: spendable accounts", () => {
  it("only depository checking/savings are spendable; cards, loans, investments excluded", () => {
    expect(isSpendableType(CHK)).toBe(true);
    expect(isSpendableType(SAV)).toBe(true);
    expect([CARD, LOAN, INV].some(isSpendableType)).toBe(false);
    const r = run({ accounts: [CHK, SAV, CARD, LOAN, INV] });
    expect(r.start).toBe(3000);
    expect(r.spendable.sort()).toEqual(["chk", "sav"]);
  });

  it("items charged to a card (not cash yet) are left out", () => {
    const r = run({ accounts: [CHK, CARD], items: [item({ date: "2026-11-05", amount: -15, kind: "subscription", accountId: "card" })] });
    expect(r.rows).toHaveLength(0);
  });

  it("user can switch an account off; transfers into it then count as outflows", () => {
    const settings = { ...DEFAULT_RUNDOWN_SETTINGS, accounts: { sav: false } };
    expect(spendableAccounts([CHK, SAV], settings).on.has("sav")).toBe(false);
    const items = [item({ date: "2026-11-05", amount: -400, kind: "savings", toAccountId: "sav" })];
    expect(run({ accounts: [CHK, SAV], items }).eod[2]).toBe(3000);
    const off = run({ accounts: [CHK, SAV], items, settings });
    expect(off.start).toBe(1000);
    expect(off.eod[2]).toBe(600);
  });

  it("single-account view", () => {
    const r = run({ accounts: [CHK, SAV], view: "sav", items: [item({ date: "2026-11-05", amount: -100 })] });
    expect(r.start).toBe(2000);
    expect(r.eod[2]).toBe(2000);
    expect(r.daysOut[2].entries).toHaveLength(0);
  });
});

describe("rundown: everyday reserve", () => {
  it("off by default; when on, subtracts the daily amount each day", () => {
    expect(run().eod[13]).toBe(1000);
    const r = run({ settings: { ...DEFAULT_RUNDOWN_SETTINGS, reserveOn: true, reserveDaily: 40 } });
    expect(r.eod[0]).toBe(960);
    expect(r.eod[13]).toBe(1000 - 14 * 40);
    expect(flag(r, "buffer")).toBeTruthy();
  });
});

describe("rundown: planned recurring items only", () => {
  it("ad hoc spending kinds are never projected, and transactions never add to the projection", () => {
    const r = run({
      items: [item({ date: "2026-11-05", amount: -60, kind: "spending", title: "Restaurant" }), item({ date: "2026-11-05", amount: -120, kind: "groceries" })],
      txns: [txn({ date: "2026-11-03", amount: -45, name: "Sweetgreen" })],
    });
    expect(r.rows).toHaveLength(0);
    expect(r.eod.every(v => v === 1000)).toBe(true);
  });

  it("kindOf maps spending events to 'spending' (excluded) and bills to utility/insurance", () => {
    const ev = (p: Partial<TimelineEvent>): TimelineEvent => ({ id: "x", source: "upcoming", source_id: "x", occurred_on: T, occurred_at: T, category: "bills", txn_type: null, is_internal: false, title: "X", subtitle: null, amount: -10, account_id: null, status: "expected", stream_id: null, pending: false, meta: {}, ...p });
    expect(kindOf(ev({ category: "spending", txn_type: "spend", meta: { kind: "spend" } }))).toBe("spending");
    expect(kindOf(ev({ title: "Electric · Example Power", meta: { kind: "bill" } }))).toBe("utility");
    expect(kindOf(ev({ title: "Life insurance", meta: { kind: "bill" } }))).toBe("insurance");
    expect(kindOf(ev({ category: "income", amount: 100, txn_type: "income_salary", meta: { kind: "salary" } }))).toBe("income");
    expect(kindOf(ev({ meta: { kind: "card_statement" } }))).toBe("card");
  });
});

describe("rundown: sources", () => {
  const s = (p: Partial<UpcomingStream & { confidence: number; source: string; user_amount: number }>): UpcomingStream & { confidence?: number } => ({
    series_key: "k", display_name: "X", direction: "outflow", txn_type: "obligation_bill", kind: "bill", cadence: "monthly", schedule: null, account_id: "chk",
    amount_median: 10, amount_cv: 0, is_fixed: true, next_expected_date: T, next_expected_amount: 10, last_seen: null, active: true, status: "suggested", must_pay: false, ...p,
  });
  it("only confirmed or high-confidence, non-dismissed streams; picture decision rows skipped; user amount respected", () => {
    const out = eligibleStreams([
      s({ series_key: "a", status: "confirmed", confidence: 0.2 }),
      s({ series_key: "b", confidence: 0.9 }),
      s({ series_key: "c", confidence: 0.5 }),
      s({ series_key: "d", status: "dismissed", confidence: 1 }),
      s({ series_key: "picture:e", status: "confirmed", source: "picture" }),
      s({ series_key: "f", status: "confirmed", user_amount: 42 }),
    ]);
    expect(out.map(x => x.series_key)).toEqual(["a", "b", "f"]);
    expect(out[2].next_expected_amount).toBe(42);
  });

  it("plannedFromEvents applies user-set occurrences and card pay-from accounts", () => {
    const base: TimelineEvent = { id: "up:k:2026-11-05", source: "upcoming", source_id: "s1", occurred_on: "2026-11-05", occurred_at: "", category: "bills", txn_type: "obligation_bill", is_internal: false, title: "Phone", subtitle: null, amount: -95, account_id: "chk", status: "expected", stream_id: "s1", pending: false, meta: { kind: "bill", series_key: "k", nominal_date: "2026-11-05" } };
    const card: TimelineEvent = { ...base, id: "up:card", stream_id: null, account_id: "card", txn_type: "credit_card_payment", meta: { kind: "card_statement" } };
    const out = plannedFromEvents([base, card], {
      streams: [s({ series_key: "k", status: "confirmed" }), s({ series_key: "cp", kind: "card_payment", account_id: "chk", counterpart_account_id: "card" })],
      occurrences: [{ stream_id: "s1", period: "2026-11-05", expected_date: "2026-11-08", expected_amount: 80, status: "expected", user_set: true }],
    });
    expect(out[0]).toMatchObject({ source: "confirmed", override: { date: "2026-11-08", amount: 80 }, period: "2026-11-05" });
    expect(out[1]).toMatchObject({ kind: "card", accountId: "chk", shift: "none" });
  });

  it("Plaid sign flips (+ = money out)", () => {
    expect(txnsFromPlaid([{ transaction_id: "a", account_id: "chk", amount: 12.5, date: T }])[0].amount).toBe(-12.5);
  });

  it("settings normalize with defaults ($500 buffer, reserve off)", () => {
    expect(normalizeRundownSettings(null)).toEqual(DEFAULT_RUNDOWN_SETTINGS);
    expect(normalizeRundownSettings({ buffer: -1, reserveOn: "yes", accounts: { a: false, b: "x" } })).toEqual({ ...DEFAULT_RUNDOWN_SETTINGS, accounts: { a: false } });
  });

  it("matchItems uses each transaction once", () => {
    const a = item({ id: "a", date: "2026-11-01", amount: -10 }), b = item({ id: "b", date: "2026-11-01", amount: -10 });
    const m = matchItems([a, b].map(x => ({ item: x, date: x.date, amount: x.amount })), [txn({ id: "only", date: "2026-11-01", amount: -10 })]);
    expect(m.size).toBe(1);
  });
});

describe("rundown: demo example", () => {
  it("is the Designer's risky scenario: shortfall, late income, late bill, joint account at risk", () => {
    const d = demoRundown(T);
    const r = buildRundown({ today: T, days: 14, ...d, settings: DEFAULT_RUNDOWN_SETTINGS });
    expect(r.start).toBe(2260);
    expect(r.spendable.sort()).toEqual(["rd-chk", "rd-joint"]);
    const types = r.flags.map(f => f.type);
    expect(types).toEqual(expect.arrayContaining(["short", "income_late", "late", "risk"]));
    expect(r.low).toBeLessThan(0);
    const risk = r.flags.find(f => f.type === "risk");
    if (risk?.type !== "risk") throw new Error();
    expect(risk.accountId).toBe("rd-joint");
    expect(risk.short).toBe(60);
    expect(r.recent).toHaveLength(3);
    expect(previewEdit({ today: T, days: 14, ...d, settings: DEFAULT_RUNDOWN_SETTINGS }, "demo-rd:amex", { amount: 0 }).low).toBeGreaterThan(r.low);
  });
});
