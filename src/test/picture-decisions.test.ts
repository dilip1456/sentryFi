/**
 * "Detected stuff vanishes once I act on it" (one Financial Picture):
 * the optimistic decisions layer and the to-review filtering. Synthetic data.
 */
import { describe, expect, it } from "vitest";
import { Builder, monthly, picture } from "./fixtures/picture-scenarios";
import {
  carriedDecision, decisionFor, overlayDecisions, parseStoredDecisions, pendingReview,
  type RecurringDecision, type ReviewItem,
} from "@/lib/recurring";

const base = () => new Builder()
  .acct("chk", "Everyday Checking", "depository", "checking", "1111", 8000)
  .acct("card", "Sapphire Card", "credit", "credit card", "3333", 1500);
const NETFLIX = { pfc: "ENTERTAINMENT", pfcd: "ENTERTAINMENT_TV_AND_MOVIES", merchant_name: "Netflix" };
const netflix = () => { const b = base(); b.series("card", monthly("2025-10", 14), 15.49, "NETFLIX.COM", NETFLIX); return b; };
const review = (b: Builder, recurringDecisions: RecurringDecision[] = []) => picture(b.fx(), { recurringDecisions }).m;
const find = (items: ReviewItem[], re: RegExp) => items.find(i => re.test(i.label) || re.test(i.key));

describe("pendingReview", () => {
  it("keeps only suggested items", () => {
    const list = [{ key: "a", status: "suggested" }, { key: "b", status: "confirmed" }, { key: "c", status: "dismissed" }] as const;
    expect(pendingReview(list).map(i => i.key)).toEqual(["a"]);
  });
  it("a confident detection never waits for review and sits in its section", () => {
    const b = netflix();
    const it = find(review(b).review.items, /netflix/i)!;
    // Settled internally: nothing is ever "to review".
    expect(pendingReview(review(b).review.items)).toEqual([]);
    expect(review(b).rows.fixed.find(r => r.reviewKey === it.key)?.tags).toBeUndefined();
    const m = review(b, [decisionFor(it, { status: "confirmed" })]);
    expect(pendingReview(m.review.items).some(i => i.key === it.key)).toBe(false);
    const row = m.rows.fixed.find(r => r.reviewKey === it.key)!;
    expect(row).toBeTruthy();
    expect(row.tags).toBeUndefined(); // no longer "Detected"
  });
  it("a dismissed item leaves both the list and the sections", () => {
    const b = netflix();
    const it = find(review(b).review.items, /netflix/i)!;
    const m = review(b, [decisionFor(it, { status: "dismissed" })]);
    expect(pendingReview(m.review.items)).not.toContainEqual(expect.objectContaining({ key: it.key }));
    expect(m.rows.fixed.some(r => r.reviewKey === it.key)).toBe(false);
  });
});

describe("overlayDecisions (optimistic layer)", () => {
  const d = (key: string, status: RecurringDecision["status"]): RecurringDecision => ({ key, status });
  it("a local change wins over a stale server copy", () => {
    expect(overlayDecisions([d("a", "suggested")], new Map([["a", d("a", "dismissed")]]))).toEqual([d("a", "dismissed")]);
  });
  it("a late initial load can't bring back an item acted on before it arrived", () => {
    const local = new Map([["x", d("x", "dismissed")]]);
    const loaded: RecurringDecision[] = [d("y", "confirmed")];
    expect(overlayDecisions(loaded, local).map(v => `${v.key}:${v.status}`).sort()).toEqual(["x:dismissed", "y:confirmed"]);
  });
  it("null means restored (removed from the stored list)", () => {
    expect(overlayDecisions([d("a", "dismissed"), d("b", "confirmed")], new Map([["a", null]]))).toEqual([d("b", "confirmed")]);
  });
});

describe("re-detection keeps the person's decision", () => {
  it("a dismissed item whose key changed is carried over by its transactions, not re-suggested", () => {
    const b = netflix();
    const it = find(review(b).review.items, /netflix/i)!;
    const dec = { ...decisionFor(it, { status: "dismissed" }), key: "outflow|netflix|~1" }; // key from an older detection run
    const m = review(b, [dec]);
    expect(find(m.review.items, /netflix/i)).toBeUndefined();
    expect(m.review.dismissed.filter(i => /netflix/i.test(i.label))).toHaveLength(1);
  });
  it("needs real overlap and the same direction", () => {
    const dec: RecurringDecision = { key: "old", status: "dismissed", snapshot: { transactionIds: ["t1", "t2", "t3"], direction: "outflow" } };
    const map = new Map([["old", dec]]);
    expect(carriedDecision({ key: "new", transactionIds: ["t1", "t2", "t9"], s: { direction: "outflow" } }, map, new Set())).toBe(dec);
    expect(carriedDecision({ key: "new", transactionIds: ["t1", "t8", "t9"], s: { direction: "outflow" } }, map, new Set())).toBeUndefined();
    expect(carriedDecision({ key: "new", transactionIds: ["t1", "t2", "t3"], s: { direction: "inflow" } }, map, new Set())).toBeUndefined();
    expect(carriedDecision({ key: "new", transactionIds: ["t1", "t2", "t3"], s: { direction: "outflow" } }, map, new Set(["old"]))).toBeUndefined();
  });
  it("a suggested (restored) decision is never carried", () => {
    const dec: RecurringDecision = { key: "old", status: "suggested", snapshot: { transactionIds: ["t1", "t2"], direction: "outflow" } };
    expect(carriedDecision({ key: "new", transactionIds: ["t1", "t2"], s: { direction: "outflow" } }, new Map([["old", dec]]), new Set())).toBeUndefined();
  });
});

describe("demo storage", () => {
  it("parses stored decisions and drops junk", () => {
    expect(parseStoredDecisions(null)).toEqual([]);
    expect(parseStoredDecisions("{bad")).toEqual([]);
    expect(parseStoredDecisions(JSON.stringify([{ key: "a", status: "dismissed" }, { key: 3 }, { key: "b", status: "nope" }, null]))).toEqual([{ key: "a", status: "dismissed" }]);
  });
});
