/**
 * Label refresh, editable recurring patterns (name / expected amount /
 * cadence), the planning amount, full-history pattern lines and local tax.
 * Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { Builder, everyNDays, monthly, picture } from "./fixtures/picture-scenarios";
import { decisionFor, refreshDecisionLabel, type RecurringDecision, type ReviewItem } from "@/lib/recurring";
import { applyPatternOverrides, decisionToRow, expectedBaseline, rowToDecision, type DecisionRow } from "@/lib/recurring/decisions";
import { describePattern } from "@/lib/recurring/review";
import { planningAmount, priceChange, type Charge } from "@/lib/recurring/planning-amount";
import { eligibleStreams } from "@/lib/timeline/rundown-source";

const base = () => new Builder()
  .acct("chk", "Everyday Checking", "depository", "checking", "1111", 8000)
  .acct("card", "Sapphire Card", "credit", "credit card", "3333", 1500);
const review = (b: Builder, recurringDecisions: RecurringDecision[] = []) => picture(b.fx(), { recurringDecisions }).m.review;
const find = (items: ReviewItem[], re: RegExp) => items.find(i => re.test(i.label) || re.test(i.key));
const NOW = "2026-10-29T12:00:00Z";

// ── Stale label refresh ───────────────────────────────────────────────────
describe("label refresh", () => {
  const zelle = { transaction_id: "z1", date: "2026-07-10", name: "Zelle Credit PAY ID:BAC1234 ORG ID:BAC NAME:JORDAN SMYTHE", merchant_name: null };
  const byId = new Map([["z1", zelle]]);
  const dec = (label: string, extra: Partial<RecurringDecision> = {}): RecurringDecision => ({
    key: "inflow|credit org name", status: "confirmed",
    snapshot: { label, group: "income", kind: "income", cadence: "monthly", amount: 1500, lastSeen: "2026-07-10", nextDue: "2026-08-10", transactionIds: ["z1"], direction: "inflow" },
    ...extra,
  });
  it("a stale label from the old parser is re-derived", () => {
    expect(refreshDecisionLabel(dec("Credit Org Name"), byId).snapshot?.label).toBe("Jordan Smythe");
  });
  it("a label the person typed is kept", () => {
    const d = dec("Rent from Jordan");
    expect(refreshDecisionLabel(d, byId)).toBe(d);
  });
  it("an explicit rename (decision.name) is never touched, even if the label is stale", () => {
    const d = dec("Credit Org Name", { name: "Roommate" });
    expect(refreshDecisionLabel(d, byId)).toBe(d);
  });
  it("an already-current label is left alone", () => {
    const d = dec("Jordan Smythe");
    expect(refreshDecisionLabel(d, byId)).toBe(d);
  });
});

// ── Editable pattern: name, expected amount, cadence ──────────────────────
describe("pattern overrides", () => {
  const gym = () => {
    const b = base();
    b.series("card", monthly("2026-01", 8), 40, "PLANET FITNESS CLUB", { pfc: "PERSONAL_CARE", pfcd: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS", merchant_name: "Planet Fitness" });
    return b;
  };
  it("a rename + expected amount persist across re-detection (same series key)", () => {
    const b = gym();
    const it0 = find(review(b).items, /planet fitness/i)!;
    const d = decisionFor(it0, { status: "confirmed", name: "Gym", expectedAmount: 45 }, NOW);
    // New charge arrives: detection runs again on more data.
    b.tx("card", "2026-10-30", 40, "PLANET FITNESS CLUB", { pfc: "PERSONAL_CARE", pfcd: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS", merchant_name: "Planet Fitness" });
    const again = review(b, [d]);
    const it1 = again.items.find(i => i.key === it0.key)!;
    expect(it1).toMatchObject({ label: "Gym", renamed: true, amount: 45, expectedAmount: 45 });
    expect(again.relabeled ?? []).toHaveLength(0);
  });
  it("cadence edits stick and clear the Estimated flag", () => {
    const b = base();
    b.tx("chk", "2026-05-02", 905, "HOMEOWNERS INSURANCE", { pfc: "GENERAL_SERVICES", pfcd: "GENERAL_SERVICES_INSURANCE", pfc_confidence: "VERY_HIGH" } as never);
    const it0 = find(review(b).items, /homeowners/i)!;
    expect(it0.estimated).toBe(true);
    const it1 = find(review(b, [decisionFor(it0, { status: "confirmed", cadence: "semiannual" }, NOW)]).items, /homeowners/i)!;
    expect(it1).toMatchObject({ cadence: "semiannual", estimated: false });
  });
  it("reset to detected restores the detected name, amount and cadence", () => {
    const b = gym();
    const it0 = find(review(b).items, /planet fitness/i)!;
    const edited = find(review(b, [decisionFor(it0, { status: "confirmed", name: "Gym", expectedAmount: 45, cadence: "yearly" }, NOW)]).items, /gym/i)!;
    const reset = decisionFor(edited, { name: null, expectedAmount: null, cadence: null }, NOW);
    const it2 = review(b, [reset]).items.find(i => i.key === it0.key)!;
    expect(it2).toMatchObject({ label: it0.label, renamed: false, amount: it0.amount, cadence: it0.cadence, expectedAmount: null });
  });
  it("storage round trip: name in schedule.user_name + display_name, expectedAmount in user_amount", () => {
    const b = gym();
    const it0 = find(review(b).items, /planet fitness/i)!;
    const d = decisionFor(it0, { status: "confirmed", name: "Gym", expectedAmount: 45 }, NOW);
    const row = decisionToRow("u1", d);
    expect(row).toMatchObject({ display_name: "Gym", user_amount: 45, schedule: { user_name: "Gym", detected_name: it0.label } });
    expect(rowToDecision(row)).toMatchObject({ name: "Gym", expectedAmount: 45, snapshot: { label: it0.label } });
    const plain = decisionToRow("u1", decisionFor(it0, { status: "confirmed" }, NOW));
    expect(plain).toMatchObject({ display_name: it0.label, schedule: {} });
  });
  it("legacy stored `amount` reads as expectedAmount", async () => {
    const { parseStoredDecisions } = await import("@/lib/recurring/decisions");
    const [d] = parseStoredDecisions(JSON.stringify([{ key: "outflow|x", status: "confirmed", amount: 12 }]));
    expect(d.expectedAmount).toBe(12);
  });
});

// ── Expected amount as the shortfall / alert baseline ─────────────────────
describe("expected amount baseline", () => {
  it("expectedAmount ?? detected", () => {
    expect(expectedBaseline({ expectedAmount: 120, detectedAmount: 99 })).toBe(120);
    expect(expectedBaseline({ user_amount: null, amount_median: 99 })).toBe(99);
    expect(expectedBaseline({ expectedAmount: 0, detectedAmount: 99 })).toBe(0);
  });
  it("the Timeline rundown uses the person's amount from the Picture row (and their name)", () => {
    const stream = { series_key: "outflow|armstrong", source: "detector", merchant_key: "armstrong", direction: "outflow", display_name: "Armstrong", user_amount: null, matched_transaction_ids: ["a", "b", "c"], status: "confirmed", active: true, confidence: 0.9, next_expected_date: "2026-11-13", next_expected_amount: 59.95, amount_median: 59.95, is_fixed: true };
    const pic = { series_key: "picture:outflow|armstrong", source: "picture", merchant_key: "armstrong", direction: "outflow", display_name: "Internet", user_amount: 110, matched_transaction_ids: ["b", "c"], status: "confirmed", schedule: { user_name: "Internet", detected_name: "Armstrong" } } as unknown as DecisionRow;
    const [s] = eligibleStreams(applyPatternOverrides([stream] as never[], [pic])) as unknown as typeof stream[];
    expect(s).toMatchObject({ display_name: "Internet", next_expected_amount: 110 });
  });
  it("without an override, the rundown plans at the planning amount", () => {
    const stream = { series_key: "outflow|armstrong", source: "detector", status: "confirmed", active: true, confidence: 0.9, next_expected_date: "2026-11-13", next_expected_amount: 59.95, user_amount: null, display_name: "Armstrong", direction: "outflow" };
    const [s] = eligibleStreams([stream] as never[], new Map([["outflow|armstrong", 109.95]])) as typeof stream[];
    expect(s.next_expected_amount).toBe(109.95);
  });
});

// ── planningAmount ────────────────────────────────────────────────────────
const charges = (amounts: number[], start = "2026-01-13"): Charge[] =>
  amounts.map((a, i) => { const d = new Date(`${start}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + i); return { date: d.toISOString().slice(0, 10), amount: a }; });

describe("planningAmount", () => {
  it("Armstrong 59.95×7 then 109.95 plans at 109.95 (price change)", () => {
    const c = charges([...Array(7).fill(59.95), 109.95]);
    expect(priceChange(c.map(x => x.amount))).toMatchObject({ changed: true, prior: 59.95, latest: 109.95 });
    expect(planningAmount({ direction: "outflow", charges: c })).toBe(109.95);
  });
  it("a user expected amount always wins", () => {
    expect(planningAmount({ direction: "outflow", charges: charges([...Array(7).fill(59.95), 109.95]), expectedAmount: 75 })).toBe(75);
  });
  it("income plans at the lower of median and last-3 average", () => {
    const c = charges([3200, 3200, 3200, 3200, 2900, 2900, 2900]);
    expect(planningAmount({ direction: "inflow", charges: c })).toBe(2900);
  });
  it("seasonal gas/electric plans at the high-season average", () => {
    const c = charges([210, 190, 140, 120, 110, 130, 160, 150, 120, 140, 180, 220], "2025-11-15");
    expect(planningAmount({ direction: "outflow", charges: c, kind: "bill", subtype: "utility", text: "FirstEnergy RENT_AND_UTILITIES_GAS_AND_ELECTRICITY" })).toBeCloseTo((220 + 210 + 190) / 3, 2);
  });
  it("steady bills are unchanged", () => {
    expect(planningAmount({ direction: "outflow", charges: charges(Array(10).fill(15.49)) })).toBe(15.49);
  });
  it("a small wobble under max(15%, $10) is not a price change", () => {
    expect(priceChange([...Array(6).fill(59.95), 66]).changed).toBe(false);
  });
  it("same-day split charges count as one bill", () => {
    expect(planningAmount({ direction: "outflow", charges: [{ date: "2026-08-04", amount: 72 }, { date: "2026-08-31", amount: 9.8 }, { date: "2026-08-31", amount: 9.8 }] })).toBeCloseTo(45.8, 2);
  });
});

// ── Pattern lines across full history ─────────────────────────────────────
describe("pattern lines (full history)", () => {
  const today = "2026-11-18";
  const hs = "2026-04-02";
  it("biweekly paychecks", () => {
    const dates = everyNDays("2026-04-03", 14, today);
    const p = describePattern({ pattern: "Every 2 weeks on Fridays", cadence: "biweekly", dates, kind: "salary", direction: "inflow", historyStart: hs, today });
    expect(p).toMatchObject({ patternLine: `Every other Friday · ${dates.length} paychecks since Apr`, estimated: false });
  });
  it("monthly over 8 months", () => {
    const dates = ["2026-04-13", "2026-05-13", "2026-06-12", "2026-07-13", "2026-08-13", "2026-09-14", "2026-10-13", "2026-11-13"];
    const p = describePattern({ pattern: "Monthly on the 13th", cadence: "monthly", dates, kind: "bill", direction: "outflow", historyStart: hs, today });
    expect(p).toMatchObject({ patternLine: "Monthly on the 13th · 8 charges since Apr", estimated: false });
  });
  it("monthly with one stray extra charge is still regular", () => {
    const dates = ["2026-04-14", "2026-04-17", "2026-05-12", "2026-06-12", "2026-07-14", "2026-08-11", "2026-09-15", "2026-10-13", "2026-11-10"];
    expect(describePattern({ pattern: "Monthly on the 15th", cadence: "monthly", dates, kind: "bill", direction: "outflow", historyStart: hs, today }).estimated).toBe(false);
  });
  it("semiannual seen twice is an estimate", () => {
    const p = describePattern({ pattern: "Every 6 months (Apr & Oct)", cadence: "semiannual", dates: ["2026-04-20", "2026-10-20"], kind: "bill", direction: "outflow", historyStart: hs, today });
    expect(p.patternLine).toBe("Every 6 months (Apr & Oct) (seen twice)");
    expect(p.estimated).toBe(true);
    expect(p.estimateNote).toMatch(/^Not enough history yet · seen twice in 8 months, assumed every 6 months/);
  });
  it("yearly seen once says so plainly", () => {
    const p = describePattern({ pattern: "Yearly in May (around the 2nd)", cadence: "yearly", dates: ["2026-05-02"], kind: "bill", direction: "outflow", historyStart: hs, today });
    expect(p).toEqual({ patternLine: "Yearly in May (seen once)", estimated: true, estimateNote: "Not enough history yet · seen once in 8 months, assumed yearly" });
  });
  it("irregular gaps are flagged", () => {
    const dates = ["2026-04-05", "2026-04-20", "2026-07-01", "2026-07-09", "2026-10-30"];
    const p = describePattern({ pattern: "Monthly on the 5th", cadence: "monthly", dates, kind: "bill", direction: "outflow", historyStart: hs, today });
    expect(p.estimated).toBe(true);
    expect(p.estimateNote).toMatch(/^Irregular timing · seen 5 times in 8 months, assumed monthly/);
  });
});

// ── Local earned-income tax (Berkheimer) ──────────────────────────────────
describe("local tax", () => {
  it("small uneven Berkheimer payments form one quarterly Taxes row (estimated)", () => {
    const b = base();
    const tax = { pfc: "GOVERNMENT_AND_NON_PROFIT", pfcd: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT", pfc_confidence: "LOW" } as never;
    b.tx("chk", "2026-08-04", 72, "OPC*H A BERKHEIMER TAX", tax);
    b.tx("chk", "2026-08-31", 9.8, "OPC*H A BERKHEIMER TAX", tax);
    b.tx("chk", "2026-08-31", 9.8, "OPC*H A BERKHEIMER TAX", tax);
    const rows = review(b).items.filter(i => /berkheimer/i.test(i.label));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ group: "insurance_tax", cadence: "quarterly", estimated: true });
    expect(rows[0].amount).toBeCloseTo(45.8, 2);
    expect(rows[0].monthly).toBeCloseTo(45.8 / 3, 1);
  });
});
