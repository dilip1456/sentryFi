import { describe, it, expect } from "vitest";
import { prepareInbox, isUnread, dueLabel, allIds, type AlertLike } from "@/lib/notifications";

const now = new Date(2026, 9, 20, 12);
let n = 0;
const al = (p: Partial<AlertLike>): AlertLike => ({
  id: `a${++n}`, alert_type: "large_txn", title: "Large charge: IKEA", body: "$812.40", payload: {}, read_at: null,
  created_at: "2026-10-20T10:00:00Z", ...p,
});

describe("prepareInbox", () => {
  it("folds identical alerts into the newest one", () => {
    const a = al({ created_at: "2026-10-20T10:00:00Z" });
    const b = al({ created_at: "2026-10-19T10:00:00Z" });
    const c = al({ title: "Large charge: Costco", created_at: "2026-10-18T10:00:00Z" });
    const r = prepareInbox([b, c, a], now);
    expect(r.map(x => x.id)).toEqual([a.id, c.id]);
    expect(r[0].duplicates.map(x => x.id)).toEqual([b.id]);
    expect(allIds(r[0])).toEqual([a.id, b.id]);
  });
  it("collapses payment-due reminders for the same card and due date", () => {
    const p = { account_id: "card1", due_date: "2026-10-22" };
    const r = prepareInbox([
      al({ alert_type: "payment_due", title: "💳 Payment due in 3d", payload: p, created_at: "2026-10-19T10:00:00Z" }),
      al({ alert_type: "payment_due", title: "💳 Payment due in 2d", payload: p, created_at: "2026-10-20T10:00:00Z" }),
    ], now);
    expect(r).toHaveLength(1);
    expect(dueLabel(r[0], now)).toBe("Due in 2 days");
  });
  it("marks past due-date alerts stale, sinks them and doesn't count them unread", () => {
    const old = al({ alert_type: "payment_due", payload: { account_id: "c", due_date: "2026-10-15" }, created_at: "2026-10-20T11:00:00Z" });
    const fresh = al({ created_at: "2026-10-19T10:00:00Z" });
    const r = prepareInbox([old, fresh], now);
    expect(r.map(x => x.id)).toEqual([fresh.id, old.id]);
    expect(r[1].stale).toBe(true);
    expect(isUnread(r[1])).toBe(false);
    expect(dueLabel(r[1], now)).toBe("Was due Oct 15");
  });
  it("due labels", () => {
    expect(dueLabel(al({ payload: { due_date: "2026-10-20" } }), now)).toBe("Due today");
    expect(dueLabel(al({ payload: { due_date: "2026-10-21" } }), now)).toBe("Due tomorrow");
    expect(dueLabel(al({ payload: {} }), now)).toBeNull();
  });
});
