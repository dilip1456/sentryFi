/**
 * fromAlertLike used to pre-seed every alert as "info", which classifyPriority
 * then returned unchanged, so alert priority was lost in the inbox.
 */
import { describe, expect, it } from "vitest";
import { fromAlertLike, ownPriority } from "@/lib/notifications/compact";
import type { AlertLike } from "@/lib/notifications";

const NOW = new Date(2026, 10, 15, 12); // Sun Nov 15, 2026 12:00 local
const alert = (alert_type: string, payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): AlertLike =>
  ({ id: alert_type, alert_type, title: alert_type, body: "", payload, read_at: null, created_at: "2026-11-15T08:00:00", ...extra });
const pri = (a: AlertLike) => fromAlertLike(a, NOW).priority;

describe("inbox priority from alert rows", () => {
  it("works priority out from the type instead of defaulting to info", () => {
    expect(pri(alert("shortfall"))).toBe("urgent");
    expect(pri(alert("paycheck_anomaly"))).toBe("urgent");
    expect(pri(alert("paycheck_shortfall"))).toBe("urgent");
  });
  it("price_increase (#66, not yet in the type union) is a 'soon' warning", () => {
    expect(pri(alert("price_increase", { displayName: "Netflix", amount: 4.5 }))).toBe("soon");
  });
  it("payment due: tomorrow urgent, this week soon, later info", () => {
    expect(pri(alert("payment_due", { due_date: "2026-11-16" }))).toBe("urgent");
    expect(pri(alert("payment_due", { due_date: "2026-11-19" }))).toBe("soon");
    expect(pri(alert("payment_due", { due_date: "2026-11-30" }))).toBe("info");
  });
  it("low balance: below zero or the buffer is urgent, otherwise soon", () => {
    expect(pri(alert("low_balance", { balance: -20 }))).toBe("urgent");
    expect(pri(alert("low_balance", { balance: 120 }))).toBe("urgent");
    expect(pri(alert("low_balance", { balance: 900, buffer: 500 }))).toBe("soon");
  });
  it("budget: over is soon, nearing is info", () => {
    expect(pri(alert("budget_threshold", { spent: 520, budget: 500 }))).toBe("soon");
    expect(pri(alert("budget_threshold", { spent: 410, budget: 500 }))).toBe("info");
    expect(pri(alert("budget_threshold"))).toBe("soon");
  });
  it("a large charge is soon; a deposit is info", () => {
    expect(pri(alert("large_txn", { amount: 1200 }))).toBe("soon");
    expect(pri(alert("deposit", { amount: 3100 }))).toBe("info");
  });
  it("the alert's own priority / severity wins over the type", () => {
    expect(pri(alert("deposit", {}, { priority: "urgent" }))).toBe("urgent");
    expect(pri(alert("deposit", { priority: "soon" }))).toBe("soon");
    expect(pri(alert("insight", { severity: "high" }))).toBe("urgent");
    expect(ownPriority(alert("insight", { severity: "bogus" }))).toBeNull();
    expect(fromAlertLike(alert("shortfall"), NOW, { priority: "info" }).priority).toBe("info");
  });
});
