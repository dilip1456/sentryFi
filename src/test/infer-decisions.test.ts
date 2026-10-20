import { describe, expect, it } from "vitest";
import {
  cardAutopayFromPatch,
  confidenceTier,
  countsTowardTotals,
  decide,
  fingerprintOf,
  materiallyChanged,
  openFindings,
  overviewFindings,
  reconcileFindings,
  surfaceFindings,
  SURFACED_KEY,
  streamAutopayPatch,
  streamCountsAsAutopay,
  toInferenceRow,
  type Finding,
  type InferenceRow,
} from "@/lib/infer";
import { mergeStreamRow, type RecurringStreamRow } from "@/lib/recurring/rows";

const NOW = new Date("2026-10-20T13:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const finding = (ref: string, payload: Record<string, unknown> = {}, confidence = 0.9): Finding => ({
  kind: "bill_autopay",
  subjectType: "stream",
  subjectRef: ref,
  payload: { amount: 100, payFromAccountId: "chk", payMethod: "bank", payDay: 12, autopay: "auto", ...payload },
  confidence,
  evidence: [{ transactionId: `${ref}-t1`, date: "2026-10-12", amount: 100, accountId: "chk" }],
  detectorVersion: 1,
});
const stored = (f: Finding, patch: Partial<InferenceRow> = {}): InferenceRow => ({ ...toInferenceRow(f, "u1", new Date(days(-10))), id: `id-${f.subjectRef}`, created_at: days(-10), ...patch });

describe("tiers and totals (§1)", () => {
  it("High ≥ 0.85, Medium 0.6–0.85, Low below", () => {
    expect(confidenceTier(0.85)).toBe("high");
    expect(confidenceTier(0.84)).toBe("medium");
    expect(confidenceTier(0.6)).toBe("medium");
    expect(confidenceTier(0.59)).toBe("low");
  });
  it("only confirmed counts toward totals, whatever the confidence", () => {
    const f = finding("s1", {}, 0.97);
    expect(countsTowardTotals(stored(f))).toBe(false);
    expect(countsTowardTotals(stored(f, { status: "confirmed" }))).toBe(true);
    expect(countsTowardTotals(stored(f, { status: "rejected" }))).toBe(false);
    expect(countsTowardTotals(null)).toBe(false);
  });
});

describe("toInferenceRow", () => {
  it("suggested, expires in 60 days, evidence ids + payload evidence", () => {
    const r = toInferenceRow(finding("s1"), "u1", NOW);
    expect(r.status).toBe("suggested");
    expect(r.expires_at).toBe(days(60));
    expect(r.evidence_txn_ids).toEqual(["s1-t1"]);
    expect((r.payload.evidence as unknown[]).length).toBe(1);
    expect(r.fingerprint).toBe(fingerprintOf(finding("s1")));
  });
});

describe("material change", () => {
  it("±20% amount, account, cadence or mode", () => {
    const p = { amount: 100, payFromAccountId: "chk", cadence: "monthly" };
    expect(materiallyChanged(p, { ...p, amount: 119 })).toBe(false);
    expect(materiallyChanged(p, { ...p, amount: 121 })).toBe(true);
    expect(materiallyChanged(p, { ...p, amount: 79 })).toBe(true);
    expect(materiallyChanged(p, { ...p, payFromAccountId: "chk2" })).toBe(true);
    expect(materiallyChanged(p, { ...p, cadence: "yearly" })).toBe(true);
    expect(materiallyChanged({ mode: "full" }, { mode: "minimum" })).toBe(true);
    expect(materiallyChanged(null, p)).toBe(true);
  });
  it("small amount noise keeps the fingerprint", () => {
    expect(fingerprintOf(finding("s", { amount: 100 }))).toBe(fingerprintOf(finding("s", { amount: 103 })));
    expect(fingerprintOf(finding("s", { amount: 100 }))).not.toBe(fingerprintOf(finding("s", { payFromAccountId: "x" })));
  });
});

describe("reconcileFindings", () => {
  const opts = { userId: "u1", now: NOW };

  it("inserts new findings", () => {
    const out = reconcileFindings([finding("s1")], [], opts);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("suggested");
  });

  it("refreshes an open suggestion without restarting its clock unless evidence changed", () => {
    const prev = stored(finding("s1"), { expires_at: days(50) });
    const [same] = reconcileFindings([finding("s1", { amount: 105 }, 0.95)], [prev], opts);
    expect(same.id).toBe(prev.id);
    expect(same.confidence).toBe(0.95);
    expect(same.expires_at).toBe(days(50));
    const [moved] = reconcileFindings([finding("s1", { payFromAccountId: "chk2" })], [prev], opts);
    expect(moved.expires_at).toBe(days(60));
  });

  it("expires unanswered suggestions after 60 days, and ones whose evidence disappeared", () => {
    const old = stored(finding("s1"), { expires_at: days(-1) });
    expect(reconcileFindings([finding("s1")], [old], opts)[0].status).toBe("expired");
    const gone = stored(finding("s2"));
    expect(reconcileFindings([], [gone], opts)).toEqual([{ ...gone, status: "expired" }]);
  });

  it("never reverts a confirmed fact; just notes it was seen again", () => {
    const prev = stored(finding("s1"), { status: "confirmed", decided_at: days(-5) });
    const [r] = reconcileFindings([finding("s1", { amount: 500, payFromAccountId: "zzz" })], [prev], opts);
    expect(r.status).toBe("confirmed");
    expect(r.payload).toEqual(prev.payload);
    expect(r.last_detected_at).toBe(NOW.toISOString());
    // a confirmed row that's no longer detected stays confirmed
    expect(reconcileFindings([], [prev], opts)).toEqual([]);
  });

  it("a rejection suppresses the same finding for 180 days", () => {
    const prev = stored(finding("s1"), { status: "rejected", reason: "I pay this myself", suppressed_until: days(170) });
    expect(reconcileFindings([finding("s1", { amount: 110 })], [prev], opts)).toEqual([]);
  });

  it("…unless the evidence materially changed (new account, ±20%)", () => {
    const prev = stored(finding("s1"), { status: "rejected", reason: "no", suppressed_until: days(170) });
    const [r] = reconcileFindings([finding("s1", { payFromAccountId: "chk2" })], [prev], opts);
    expect(r.status).toBe("suggested");
    expect(r.suppressed_until).toBeNull();
    expect(r.reason).toBe("no"); // the old reason is kept for context
  });

  it("…or the 180 days passed", () => {
    const prev = stored(finding("s1"), { status: "rejected", suppressed_until: days(-1) });
    expect(reconcileFindings([finding("s1")], [prev], opts)[0].status).toBe("suggested");
  });

  it("an expired finding comes back only on a material change", () => {
    const prev = stored(finding("s1"), { status: "expired" });
    expect(reconcileFindings([finding("s1")], [prev], opts)).toEqual([]);
    expect(reconcileFindings([finding("s1", { amount: 200 })], [prev], opts)[0].status).toBe("suggested");
  });

  it("a newer missed date re-asks even after Not right", () => {
    const f = (d: string): Finding => ({ ...finding("s1"), kind: "autopay_missed", payload: { lastMissed: d, expectedAmount: 100 } });
    const prev = stored(f("2026-09-12"), { status: "rejected", suppressed_until: days(170) });
    expect(reconcileFindings([f("2026-09-12")], [prev], opts)).toEqual([]);
    expect(reconcileFindings([f("2026-10-12")], [prev], opts)[0].status).toBe("suggested");
  });
});

describe("decide (Confirm / Not right / Undo)", () => {
  const row = stored(finding("s1"));
  it("confirm stamps decided_at", () => {
    const r = decide(row, { action: "confirm" }, NOW);
    expect(r.status).toBe("confirmed");
    expect(r.decided_at).toBe(NOW.toISOString());
  });
  it("reject keeps a trimmed reason (≤500 chars) and suppresses 180 days", () => {
    const r = decide(row, { action: "reject", reason: `  ${"x".repeat(600)} ` }, NOW);
    expect(r.status).toBe("rejected");
    expect(r.reason).toHaveLength(500);
    expect(r.suppressed_until).toBe(days(180));
    expect(decide(row, { action: "reject", reason: "   " }, NOW).reason).toBeNull();
  });
  it("undo goes back to suggested with a fresh 60-day window", () => {
    const r = decide(decide(row, { action: "confirm" }, NOW), { action: "undo" }, NOW);
    expect(r.status).toBe("suggested");
    expect(r.decided_at).toBeNull();
    expect(r.expires_at).toBe(days(60));
  });
});

describe("overview rate limit (§5: 3 new per week)", () => {
  it("surfaces at most 3, highest confidence first; the list has all", () => {
    const rows = [0.7, 0.95, 0.8, 0.9, 0.99].map((c, i) => stored(finding(`s${i}`, {}, c), { confidence: c, created_at: days(-1) }));
    rows.push(stored(finding("done", {}, 0.99), { confidence: 0.99, status: "confirmed", created_at: days(-1) }));
    const { shown, toSave } = surfaceFindings(rows, NOW);
    expect(shown.map(r => r.subject_ref)).toEqual(["s4", "s1", "s3"]);
    expect(toSave.map(r => r.payload[SURFACED_KEY])).toEqual([NOW.toISOString(), NOW.toISOString(), NOW.toISOString()]);
    expect(openFindings(rows)).toHaveLength(5);
  });
  it("an older finding never surfaced yet can still use a free slot", () => {
    const rows = [stored(finding("old", {}, 0.9), { created_at: days(-30) })];
    expect(overviewFindings(rows, NOW).map(r => r.subject_ref)).toEqual(["old"]);
  });
});

describe("apply: bill_autopay → recurring_streams", () => {
  const row = stored(finding("s1", { payDay: 14 }));
  it("a suggestion is written as 'detected' (shown, never counted)", () => {
    const p = streamAutopayPatch(row)!;
    // autopay stays 'unknown' until Confirm, so no reader can count it by mistake
    expect(p).toMatchObject({ autopay: "unknown", autopay_source: "detected", pay_method: null, pay_from_account_id: "chk", pay_day: 14, autopay_inference_id: row.id });
    expect(streamCountsAsAutopay(p)).toBe(false);
  });
  it("Confirm writes 'confirmed', which counts", () => {
    const p = streamAutopayPatch({ ...row, status: "confirmed" })!;
    expect(p.autopay_source).toBe("confirmed");
    expect(p).toMatchObject({ autopay: "auto", pay_method: "bank" });
    expect(streamCountsAsAutopay(p)).toBe(true);
  });
  it("never touches a hand-set value, never downgrades confirmed to detected", () => {
    expect(streamAutopayPatch({ ...row, status: "confirmed" }, { autopay_source: "user", autopay_inference_id: null })).toBeNull();
    expect(streamAutopayPatch(row, { autopay_source: "confirmed", autopay_inference_id: row.id! })).toBeNull();
  });
  it("Not right clears what this inference wrote", () => {
    expect(streamAutopayPatch({ ...row, status: "rejected" }, { autopay_source: "detected", autopay_inference_id: row.id! })).toMatchObject({ autopay: "unknown", autopay_source: null });
    expect(streamAutopayPatch({ ...row, status: "rejected" }, { autopay_source: "confirmed", autopay_inference_id: "other" })).toBeNull();
    expect(streamAutopayPatch({ ...row, status: "rejected" }, null)).toBeNull();
  });
  it("re-detection (mergeStreamRow) keeps stored autopay fields", () => {
    const detected = { user_id: "u1", series_key: "s1", autopay: undefined } as unknown as RecurringStreamRow;
    const prev = { id: "x", user_id: "u1", series_key: "s1", status: "active", must_pay: true, autopay: "auto", autopay_source: "confirmed", pay_from_account_id: "chk", pay_day: 14 } as unknown as RecurringStreamRow;
    const merged = mergeStreamRow(detected, prev);
    expect(merged).toMatchObject({ autopay: "auto", autopay_source: "confirmed", pay_from_account_id: "chk", pay_day: 14 });
  });
});

describe("apply: card_autopay → cardAutopayFrom", () => {
  const f: Finding = { ...finding("visa"), kind: "card_autopay", subjectType: "account", payload: { mode: "full", fromAccountId: "chk" } };
  const row = stored(f, { status: "confirmed" });
  it("prefills only on Confirm and only when the user hasn't chosen", () => {
    expect(cardAutopayFromPatch(row, {})).toEqual({ visa: "chk" });
    expect(cardAutopayFromPatch({ ...row, status: "suggested" }, {})).toBeNull();
    expect(cardAutopayFromPatch(row, { visa: "sav" })).toBeNull();
  });
  it("a confirmed card_autopay_source switches it", () => {
    const sw = stored({ ...f, kind: "card_autopay_source", payload: { fromAccountId: "chk2" } }, { status: "confirmed" });
    expect(cardAutopayFromPatch(sw, { visa: "chk", other: "x" })).toEqual({ visa: "chk2", other: "x" });
  });
});
