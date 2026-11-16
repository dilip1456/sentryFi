import { describe, expect, it } from "vitest";
import {
  buildCompactInbox, classifyPriority, compactAgo, dayLabel, dayOffset,
  formatInboxAmount, selectUrgentStrip, stackKey, stackTitle, type CompactItem,
} from "@/lib/notifications/compact";
import { demoInboxItems } from "@/lib/notifications/demo";

const NOW = new Date(2026, 10, 15, 12); // Sun Nov 15, 2026 12:00 local

const item = (p: Partial<CompactItem> & Pick<CompactItem, "id" | "type" | "title">): CompactItem => ({
  priority: "info",
  body: p.body ?? "",
  amount: p.amount ?? null,
  at: p.at ?? NOW.toISOString(),
  stack: p.stack ?? null,
  read: false,
  ...p,
});

describe("day grouping", () => {
  it("labels today, yesterday, this week and earlier", () => {
    expect(dayLabel(0)).toBe("Today");
    expect(dayLabel(-1)).toBe("Yesterday");
    expect(dayLabel(-3)).toBe("This week");
    expect(dayLabel(-6)).toBe("This week");
    expect(dayLabel(-7)).toBe("Earlier");
  });
  it("offsets from a fixed now", () => {
    expect(dayOffset("2026-11-15T08:00:00", NOW)).toBe(0);
    expect(dayOffset("2026-11-14T18:00:00", NOW)).toBe(-1);
    expect(dayOffset("2026-11-13T12:00:00", NOW)).toBe(-2);
    expect(dayOffset("2026-11-01T12:00:00", NOW)).toBe(-14);
  });
});

describe("classifyPriority", () => {
  it("marks a shortfall, missing paycheck and due-tomorrow bill urgent", () => {
    expect(classifyPriority({ type: "shortfall" }, NOW)).toBe("urgent");
    expect(classifyPriority({ type: "paycheck_anomaly" }, NOW)).toBe("urgent");
    expect(classifyPriority({ type: "payment_due", payload: { due_date: "2026-11-16" } }, NOW)).toBe("urgent");
    expect(classifyPriority({ type: "payment_due", payload: { due_date: "2026-11-15" } }, NOW)).toBe("urgent");
    expect(classifyPriority({ type: "payment_due", payload: { due_date: "2026-11-14" } }, NOW)).toBe("urgent");
  });
  it("marks a payment due in 2–7 days as soon and later as info", () => {
    expect(classifyPriority({ type: "payment_due", payload: { due_date: "2026-11-18" } }, NOW)).toBe("soon");
    expect(classifyPriority({ type: "payment_due", payload: { due_date: "2026-11-30" } }, NOW)).toBe("info");
  });
  it("marks a low balance below the buffer urgent", () => {
    expect(classifyPriority({ type: "low_balance", amount: 420, payload: { available: 420, buffer: 500 } }, NOW)).toBe("urgent");
    expect(classifyPriority({ type: "low_balance", amount: -10, payload: { available: -10 } }, NOW)).toBe("urgent");
  });
  it("marks a possible duplicate urgent and a regular insight info", () => {
    expect(classifyPriority({ type: "insight", title: "Possible duplicate charge" }, NOW)).toBe("urgent");
    expect(classifyPriority({ type: "insight", title: "Dining is up 22%" }, NOW)).toBe("info");
  });
  it("respects an explicit priority", () => {
    expect(classifyPriority({ type: "deposit", priority: "urgent" }, NOW)).toBe("urgent");
  });
});

describe("selectUrgentStrip", () => {
  it("returns null when nothing is urgent or everything urgent is already read", () => {
    expect(selectUrgentStrip([], NOW)).toBeNull();
    expect(selectUrgentStrip([
      item({ id: "a", type: "paycheck_anomaly", title: "Paycheck may be missing", priority: "urgent", read: true }),
      item({ id: "b", type: "budget_threshold", title: "Shopping over budget", priority: "soon" }),
    ], NOW)).toBeNull();
  });
  it("picks the most recent unread urgent item and counts +N more", () => {
    const paycheck = item({ id: "pay", type: "paycheck_anomaly", title: "Paycheck may be missing", priority: "urgent", at: "2026-11-15T10:00:00" });
    const amex = item({
      id: "amex", type: "payment_due", title: "Amex Gold due tomorrow", priority: "urgent",
      at: "2026-11-15T07:00:00", payload: { due_date: "2026-11-16" },
    });
    const low = item({ id: "low", type: "low_balance", title: "Joint Checking is low", priority: "urgent", amount: 420, at: "2026-11-15T04:00:00" });
    const dup = item({ id: "dup", type: "insight", title: "Possible duplicate charge", priority: "urgent", at: "2026-11-14T10:00:00" });
    const sel = selectUrgentStrip([dup, low, amex, paycheck], NOW);
    expect(sel).not.toBeNull();
    // newest first — matches the Option B mockup ("Paycheck may be missing · +3 more")
    expect(sel!.item.id).toBe("pay");
    expect(sel!.more).toBe(3);
    expect(sel!.all.map(i => i.id)).toEqual(["pay", "amex", "low", "dup"]);
  });
  it("uses urgency rank only as a tie-breaker when times match", () => {
    const at = "2026-11-15T10:00:00";
    const short = item({ id: "s", type: "shortfall", title: "Shortfall in 7 days", priority: "urgent", at });
    const due = item({
      id: "d", type: "payment_due", title: "Amex Gold due tomorrow", priority: "urgent", at,
      payload: { due_date: "2026-11-16" },
    });
    expect(selectUrgentStrip([due, short], NOW)!.item.id).toBe("s");
    expect(selectUrgentStrip([due, short], NOW)!.more).toBe(1);
  });
  it("does not count dismissed or info items in +N", () => {
    const a = item({ id: "a", type: "paycheck_anomaly", title: "Missing", priority: "urgent" });
    const gone = item({ id: "g", type: "low_balance", title: "Low", priority: "urgent", gone: true });
    const info = item({ id: "i", type: "deposit", title: "Paycheck deposited", priority: "info" });
    const sel = selectUrgentStrip([a, gone, info], NOW);
    expect(sel!.item.id).toBe("a");
    expect(sel!.more).toBe(0);
  });
});

describe("buildCompactInbox stacking", () => {
  it("keeps urgent items in Needs attention and never folds them into a stack", () => {
    const urgent = item({ id: "u", type: "payment_due", title: "Amex Gold due tomorrow", priority: "urgent", stack: "bills" });
    const n1 = item({ id: "n1", type: "payment_due", title: "Netflix", priority: "info", stack: "bills", at: "2026-11-15T02:00:00" });
    const n2 = item({ id: "n2", type: "payment_due", title: "Hulu", priority: "info", stack: "bills", at: "2026-11-15T02:00:00" });
    const model = buildCompactInbox([urgent, n1, n2], { now: NOW, filter: "all" });
    expect(model.urgent.map(i => i.id)).toEqual(["u"]);
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].label).toBe("Today");
    expect(model.groups[0].rows).toHaveLength(1);
    expect(model.groups[0].rows[0]).toMatchObject({ kind: "stack", stack: "bills" });
    if (model.groups[0].rows[0].kind === "stack") {
      expect(stackTitle(model.groups[0].rows[0])).toBe("2 bill reminders");
      expect(model.groups[0].rows[0].key).toBe(stackKey("bills", "Today"));
      expect(model.groups[0].rows[0].items.map(i => i.id)).toEqual(["n1", "n2"]);
    }
  });
  it("collapses 2+ product updates and leaves a single item unstacked", () => {
    const apk = item({ id: "apk", type: "promo", title: "Get the Android app", priority: "info", stack: "product", at: "2026-11-15T11:00:00" });
    const demo = item({ id: "demo", type: "promo", title: "You're viewing demo data", priority: "info", stack: "product", at: "2026-11-15T11:00:00" });
    const hist = item({ id: "hist", type: "promo", title: "Extend bank history", priority: "soon", stack: null, at: "2026-11-15T06:00:00" });
    const model = buildCompactInbox([apk, demo, hist], { now: NOW });
    const rows = model.groups[0].rows;
    expect(rows).toHaveLength(2);
    const stack = rows.find(r => r.kind === "stack");
    const lone = rows.find(r => r.kind === "item");
    expect(stack && stack.kind === "stack" && stackTitle(stack)).toBe("2 product updates");
    expect(lone && lone.kind === "item" && lone.item.id).toBe("hist");
  });
  it("does not stack a single bill reminder", () => {
    const n = item({ id: "n", type: "payment_due", title: "Netflix", priority: "info", stack: "bills" });
    const model = buildCompactInbox([n], { now: NOW });
    expect(model.groups[0].rows).toEqual([{ kind: "item", item: expect.objectContaining({ id: "n" }) }]);
  });
  it("groups leftover items by day and the Unread filter hides read rows", () => {
    const today = item({ id: "t", type: "budget_threshold", title: "Shopping over budget", priority: "soon", at: "2026-11-15T08:00:00" });
    const week = item({ id: "w", type: "large_txn", title: "Large purchase: Best Buy", priority: "soon", at: "2026-11-13T08:00:00" });
    const read = item({ id: "r", type: "deposit", title: "Paycheck deposited", priority: "info", at: "2026-11-12T08:00:00", read: true });
    const unread = buildCompactInbox([today, week, read], { now: NOW, filter: "unread" });
    expect(unread.groups.map(g => g.label)).toEqual(["Today", "This week"]);
    expect(unread.groups.flatMap(g => g.items.map(i => i.id))).toEqual(["t", "w"]);
    const all = buildCompactInbox([today, week, read], { now: NOW, filter: "all" });
    expect(all.groups.map(g => g.label)).toEqual(["Today", "This week"]);
    expect(all.groups[1].items.map(i => i.id)).toEqual(["w", "r"]);
  });
  it("drops dismissed items", () => {
    const a = item({ id: "a", type: "large_txn", title: "Best Buy", priority: "soon", gone: true });
    expect(buildCompactInbox([a], { now: NOW, filter: "all" }).groups).toEqual([]);
  });
});

describe("demo inbox + strip", () => {
  it("demo data has four unread urgent items; strip shows the top one and +3 more", () => {
    const items = demoInboxItems(NOW);
    const unreadUrgent = items.filter(i => i.priority === "urgent" && !i.read);
    expect(unreadUrgent).toHaveLength(4);
    const sel = selectUrgentStrip(items, NOW);
    expect(sel!.item.title).toBe("Paycheck may be missing");
    expect(sel!.more).toBe(3);
    const model = buildCompactInbox(items, { now: NOW, filter: "unread" });
    expect(model.urgent).toHaveLength(4);
    const today = model.groups.find(g => g.label === "Today");
    expect(today).toBeTruthy();
    const bills = today!.rows.find(r => r.kind === "stack" && r.stack === "bills");
    expect(bills && bills.kind === "stack" && stackTitle(bills)).toBe("3 bill reminders");
  });
});

describe("format helpers", () => {
  it("formats amounts and compact relative times", () => {
    expect(formatInboxAmount(-1388)).toBe("−$1,388");
    expect(formatInboxAmount(-15.49)).toBe("−$15.49");
    expect(formatInboxAmount(3330)).toBe("+$3,330");
    expect(formatInboxAmount(420, true)).toBe("$420");
    expect(formatInboxAmount(null)).toBe("");
    expect(compactAgo(new Date(NOW.getTime() - 2 * 3600000).toISOString(), NOW)).toBe("2h");
    expect(compactAgo(new Date(NOW.getTime() - 26 * 3600000).toISOString(), NOW)).toBe("1d");
  });
});
