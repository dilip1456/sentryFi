/**
 * Bill price-change alerts: "I should've been notified when Armstrong went
 * from 49 to 110." Real series: $59.95 x7 monthly, then $109.95 on Nov 12,
 * synced Nov 17.
 */
import { describe, expect, it } from "vitest";
import { amountModel, decisionFor, decisionToRow, reviewRecurring, rowToDecision, applyDecision, type ClassifierAccount, type ClassifierTxn } from "@/lib/recurring";
import { detectRecurringSeries } from "@/lib/recurring/detect";
import { priceIncreaseFinding } from "@/lib/infer";
import { findPriceChanges, isPriceIncrease, priceAlertKey, priceAlertText, priceBaseline, streamExpected, type PriceStream, type PriceTxn } from "@/lib/price-change";
import { merchantKey } from "@/lib/merchant-name";

const ARMSTRONG_DATES = ["2026-04-13", "2026-05-13", "2026-06-12", "2026-07-13", "2026-08-12", "2026-09-14", "2026-10-13", "2026-11-12"];
const ARMSTRONG_AMOUNTS = [59.95, 59.95, 59.95, 59.95, 59.95, 59.95, 59.95, 109.95];

describe("amountModel: price change vs the EARLIER charges", () => {
  it("flags Armstrong on the first raised charge (whole-series CV 0.25)", () => {
    const m = amountModel(ARMSTRONG_AMOUNTS);
    expect(m.cv).toBeGreaterThan(0.2);
    expect(m.isFixed).toBe(false); // the whole series looks variable…
    expect(m.priceChanged).toBe(true); // …but the earlier 7 were one price
    expect(m.prevTypical).toBe(59.95);
    expect(m.priceDelta).toBe(50);
    expect(m.latest).toBe(109.95);
  });

  it("needs >= 3 steady earlier charges", () => {
    expect(amountModel([59.95, 59.95, 109.95]).priceChanged).toBe(false);
    expect(amountModel([59.95, 59.95, 59.95, 109.95]).priceChanged).toBe(true);
  });

  it("needs more than max(15%, $10) when the raise makes the series look variable", () => {
    // A small raise keeps the series fixed, so the existing fixed-series rule
    // (>5% off the median) still flags it in the app; push alerts use the
    // strict thresholds (isPriceIncrease below).
    expect(amountModel([59.95, 59.95, 59.95, 59.95, 68.0]).priceChanged).toBe(true);
    expect(isPriceIncrease(68, 59.95, false)).toBe(false);
    expect(amountModel([20, 20, 20, 20, 29]).priceChanged).toBe(false); // +45% but only $9
    expect(amountModel([59.95, 59.95, 59.95, 59.95, 70.5]).priceChanged).toBe(true); // +17.6%, $10.55
  });

  it("never flags a bill whose earlier charges already varied", () => {
    expect(amountModel([80, 120, 95, 140, 60, 200]).priceChanged).toBe(false);
  });

  it("reports the delta for a drop too, but the finding is only for rises", () => {
    const m = amountModel([109.95, 109.95, 109.95, 59.95]);
    expect(m.priceChanged).toBe(true);
    expect(m.priceDelta).toBe(-50);
  });
});

// ── Client: series → review item → finding → accept → stored row ─────────────

const ACCOUNTS: ClassifierAccount[] = [{ account_id: "chk", type: "depository", subtype: "checking", name: "Checking", mask: "1111" }];
const armstrongTxns = (): ClassifierTxn[] => ARMSTRONG_DATES.map((date, i) => ({
  transaction_id: `arm${i}`, account_id: "chk", amount: ARMSTRONG_AMOUNTS[i], date,
  name: "Aci*armstrong Cable", merchant_name: "Armstrong", category: ["Service", "Cable"],
  pfc_primary: "RENT_AND_UTILITIES", pfc_detailed: "RENT_AND_UTILITIES_INTERNET_AND_CABLE",
}));
const TODAY = "2026-11-18";

describe("client: Armstrong price_increase", () => {
  it("the detected series carries the change and produces a price_increase finding", () => {
    const series = detectRecurringSeries(armstrongTxns(), ACCOUNTS, { today: TODAY });
    const s = series.find(x => /armstrong/i.test(x.displayName))!;
    expect(s).toBeTruthy();
    expect(s.amount.priceChanged).toBe(true);
    const f = priceIncreaseFinding(s)!;
    expect(f.kind).toBe("price_increase");
    expect(f.subjectType).toBe("stream");
    expect(f.subjectRef).toBe(s.seriesKey);
    expect(f.payload).toMatchObject({ from: 59.95, to: 109.95, delta: 50 });
    expect(priceIncreaseFinding(s, undefined, { acceptedAmount: 109.95 })).toBeNull();
  });

  it("the review item shows the change; taking the new price settles it and is stored", () => {
    const r = reviewRecurring(armstrongTxns(), ACCOUNTS, { today: TODAY });
    const it = r.items.find(i => /armstrong/i.test(i.label))!;
    expect(it.priceChange).toEqual({ from: 59.95, to: 109.95, delta: 50, date: "2026-11-12" });
    expect(it.amount).toBe(59.95); // typical stays until the person takes the new price

    const dec = decisionFor(it, { status: "confirmed", amount: it.priceChange!.to });
    const after = applyDecision(it, dec, TODAY);
    expect(after.amount).toBe(109.95);
    expect(after.priceChange).toBeNull();
    expect(after.nextAmount).toBe(109.95);

    const row = decisionToRow("u1", dec);
    expect(row.user_amount).toBe(109.95);
    expect(row.next_expected_amount).toBe(109.95);
    expect(row.price_changed).toBe(true);
    expect(typeof row.is_fixed).toBe("boolean");
    const back = rowToDecision({ ...row })!;
    expect(back.snapshot?.priceChanged).toBe(true);
    expect(back.snapshot?.nextAmount).toBe(109.95);
    expect(back.snapshot?.isFixed).toBe(row.is_fixed);
  });

  it("an untouched decision stores the detector's next amount", () => {
    const r = reviewRecurring(armstrongTxns(), ACCOUNTS, { today: TODAY });
    const it = r.items.find(i => /armstrong/i.test(i.label))!;
    const row = decisionToRow("u1", decisionFor(it, { status: "confirmed" }));
    expect(row.user_amount).toBeNull();
    expect(row.next_expected_amount).toBe(it.nextAmount);
  });
});

// ── Server: send-alerts price check (pure) ───────────────────────────────────

const NOW = new Date("2026-11-17T12:00:00Z");
const keyOf = (t: PriceTxn) => merchantKey(t.merchant_name ?? t.name ?? "");
const serverTxns = (amounts = ARMSTRONG_AMOUNTS, syncedLast = "2026-11-17T05:33:58Z"): PriceTxn[] =>
  ARMSTRONG_DATES.map((date, i) => ({
    id: `row${i}`, transaction_id: `arm${i}`, account_id: "chk", amount: amounts[i], date, authorized_date: null,
    created_at: i === ARMSTRONG_DATES.length - 1 ? syncedLast : "2026-10-30T20:40:25Z", pending: false,
    name: "Aci*armstrong Cable", merchant_name: "Armstrong",
  }));
const bill = () => "obligation_bill";

describe("server: findPriceChanges", () => {
  it("fires for Armstrong: synced Nov 17, dated Nov 12 (the old window was date >= yesterday)", () => {
    const h = serverTxns();
    const out = findPriceChanges({ recent: h.slice(-1), history: h, keyOf, typeOf: bill, now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ merchantKey: "armstrong", amount: 109.95, baseline: 59.95, delta: 50, baselineSource: "median", variable: false, priorCount: 7, date: "2026-11-12" });
    expect(priceAlertKey(out[0])).toBe("price:armstrong:2026-11-12");
    expect(priceAlertText(out[0])).toEqual({ title: "📈 Armstrong went up", body: "$59.95 → $109.95 (+$50.00)" });
  });

  it("only looks at charges synced in the last 3 days", () => {
    const h = serverTxns(ARMSTRONG_AMOUNTS, "2026-11-13T05:00:00Z");
    expect(findPriceChanges({ recent: h.slice(-1), history: h, keyOf, typeOf: bill, now: NOW })).toHaveLength(0);
  });

  it("is scoped to bills / subscriptions / loans or a confirmed pattern", () => {
    const h = serverTxns();
    expect(findPriceChanges({ recent: h.slice(-1), history: h, keyOf, typeOf: () => "spend", now: NOW })).toHaveLength(0);
    const confirmed: PriceStream = { merchant_key: "armstrong", status: "confirmed", kind: "bill", direction: "outflow", matched_transaction_ids: ["arm0"] };
    expect(findPriceChanges({ recent: h.slice(-1), history: h, keyOf, typeOf: () => "spend", streams: [confirmed], now: NOW })).toHaveLength(1);
    const sub: PriceStream = { merchant_key: "armstrong", status: "suggested", kind: "subscription", direction: "outflow" };
    expect(findPriceChanges({ recent: h.slice(-1), history: h, keyOf, typeOf: () => "spend", streams: [sub], now: NOW })).toHaveLength(1);
  });

  it("skips dismissed patterns and charges the person re-typed", () => {
    const h = serverTxns();
    const dismissed: PriceStream = { merchant_key: "armstrong", status: "dismissed", kind: "bill", direction: "outflow" };
    expect(findPriceChanges({ recent: h.slice(-1), history: h, keyOf, typeOf: bill, streams: [dismissed], now: NOW })).toHaveLength(0);
    expect(findPriceChanges({ recent: h.slice(-1), history: h, keyOf, typeOf: bill, excluded: new Set(["arm7"]), now: NOW })).toHaveLength(0);
    const card: PriceStream = { merchant_key: "armstrong", status: "confirmed", kind: "card_payment", direction: "outflow" };
    expect(findPriceChanges({ recent: h.slice(-1), history: h, keyOf, typeOf: bill, streams: [card], now: NOW })).toHaveLength(0);
  });

  it("uses the expected amount the person set as the baseline", () => {
    const h = serverTxns();
    // Took the new price already → no alert.
    const took: PriceStream = { merchant_key: "armstrong", status: "confirmed", kind: "bill", direction: "outflow", user_amount: 109.95, display_name: "Armstrong Internet" };
    expect(findPriceChanges({ recent: h.slice(-1), history: h, keyOf, typeOf: bill, streams: [took], now: NOW })).toHaveLength(0);
    // Expects $80 → alert against $80 under the person's name.
    const exp: PriceStream = { ...took, user_amount: null, user_expected_amount: 80 };
    const out = findPriceChanges({ recent: h.slice(-1), history: h, keyOf, typeOf: bill, streams: [exp], now: NOW });
    expect(out[0]).toMatchObject({ baseline: 80, baselineSource: "expected", delta: 29.95, displayName: "Armstrong Internet" });
    expect(streamExpected(exp)).toBe(80);
  });

  it("needs >= 3 prior charges without a set amount", () => {
    const h = serverTxns().slice(-3);
    expect(findPriceChanges({ recent: h.slice(-1), history: h, keyOf, typeOf: bill, now: NOW })).toHaveLength(0);
    expect(priceBaseline(null, [1, 2])).toBeNull();
    expect(priceBaseline(null, [50, 60, 70])).toEqual({ value: 60, source: "median" });
  });

  it("thresholds: fixed > 15% and > $10; variable > 30% and > $15", () => {
    expect(isPriceIncrease(109.95, 59.95, false)).toBe(true);
    expect(isPriceIncrease(68, 59.95, false)).toBe(false); // +13%
    expect(isPriceIncrease(29, 20, false)).toBe(false); // $9
    expect(isPriceIncrease(59.95, 109.95, false)).toBe(false); // a drop is not an increase
    expect(isPriceIncrease(130, 100, true)).toBe(false); // +30% exactly
    expect(isPriceIncrease(140, 100, true)).toBe(true);
    expect(isPriceIncrease(40, 20, true)).toBe(true); // +100%, $20
    expect(isPriceIncrease(34, 20, true)).toBe(false); // $14
  });

  it("variable bills (CV >= 8%) use the wider threshold", () => {
    const amounts = [95, 102.5, 88, 120, 102.5, 110, 95, 125]; // electric: median of prior 7 = 102.5, +22%
    const h = serverTxns(amounts);
    const out = findPriceChanges({ recent: h.slice(-1), history: h, keyOf, typeOf: bill, now: NOW });
    expect(out).toHaveLength(0);
    const h2 = serverTxns([...amounts.slice(0, 7), 160]); // +56%, $57.50
    expect(findPriceChanges({ recent: h2.slice(-1), history: h2, keyOf, typeOf: bill, now: NOW })[0]).toMatchObject({ variable: true, baseline: 102.5 });
  });

  it("ignores pending copies in the history and the charge itself", () => {
    const h = serverTxns();
    const pendingTwin: PriceTxn = { ...h[7], id: "pend", transaction_id: "pend", pending: true, date: "2026-11-11" };
    const out = findPriceChanges({ recent: h.slice(-1), history: [...h, pendingTwin], keyOf, typeOf: bill, now: NOW });
    expect(out[0]).toMatchObject({ baseline: 59.95, priorCount: 7 });
  });
});

describe("client: what's worth showing", () => {
  it("a small drift on a steady bill isn't shown (Peoples Gas $18.77 → $21.18)", () => {
    const dates = ["2026-05-15", "2026-06-15", "2026-07-15", "2026-08-14", "2026-09-15", "2026-10-15"];
    const amts = [18.77, 18.77, 18.77, 18.77, 18.77, 21.18];
    const txns: ClassifierTxn[] = dates.map((date, i) => ({ transaction_id: `g${i}`, account_id: "chk", amount: amts[i], date, name: "PEOPLES GAS", merchant_name: "Peoples Gas" }));
    const s = detectRecurringSeries(txns, ACCOUNTS, { today: TODAY }).find(x => /peoples/i.test(x.displayName))!;
    expect(priceIncreaseFinding(s)).toBeNull();
    const it = reviewRecurring(txns, ACCOUNTS, { today: TODAY }).items.find(i => /peoples/i.test(i.label));
    expect(it?.priceChange ?? null).toBeNull();
  });

  it("once two charges agree on the new price, detection expects it and there's nothing to take", () => {
    const dates = [...ARMSTRONG_DATES, "2026-12-12"];
    const base = armstrongTxns()[0];
    const txns: ClassifierTxn[] = dates.map((date, i) => ({ ...base, transaction_id: `a${i}`, amount: i >= 7 ? 109.95 : 59.95, date }));
    const it = reviewRecurring(txns, ACCOUNTS, { today: "2026-12-14" }).items.find(i => /armstrong/i.test(i.label))!;
    expect(it.amount).toBe(109.95);
    expect(it.priceChange).toBeNull();
  });
});

describe("inbox: price_increase alert", () => {
  it("is a 'soon' item showing the new charge", async () => {
    const { classifyPriority, fromAlertLike } = await import("@/lib/notifications/compact");
    expect(classifyPriority({ type: "price_increase" })).toBe("soon");
    const item = fromAlertLike({
      id: "a1", alert_type: "price_increase", title: "📈 Armstrong went up", body: "$59.95 → $109.95 (+$50.00)",
      payload: { amount: 109.95, previous: 59.95, delta: 50, pct: 0.834, date: "2026-11-11", transaction_id: "arm7" }, read_at: null, created_at: "2026-11-17T06:00:00Z",
    }, new Date("2026-11-17T12:00:00Z"));
    expect(item.amount).toBe(109.95);
    expect(item.stack).toBeNull();
  });
});
