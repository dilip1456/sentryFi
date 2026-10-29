import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { TXN_TYPES, type Classification } from "@/lib/classify";
import {
  activeFilterCount, buildTimelineRows, buildUpcoming, categoryForType, classificationDiff, compareEventsDesc,
  cursorAfter, cursorForJump, decodeCursor, DEFAULT_FILTERS, demoPage, demoTimeline, encodeCursor, isBeforeCursor,
  matchesFilters, mergeStreams, paginateEvents, resolveTxnType, showHistory, showUpcoming, toPage, toggleChip,
  visibleUpcoming, eventFromRow, UPCOMING_DAYS, UPCOMING_DAYS_EXTENDED,
  type TimelineEvent, type TimelineFilters, type UpcomingStream,
} from "@/lib/timeline";

const ev = (id: string, on: string, extra: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id, source: "transaction", source_id: id, occurred_on: on, occurred_at: `${on}T12:00:00.000Z`, category: "spending",
  txn_type: "spend", is_internal: false, title: id, subtitle: null, amount: -10, account_id: "a", status: "posted",
  stream_id: null, pending: false, meta: {}, ...extra,
});
const F = (f: Partial<TimelineFilters> = {}): TimelineFilters => ({ ...DEFAULT_FILTERS, ...f });

/** Walk every page; return ids in order. */
function walk(all: TimelineEvent[], f: TimelineFilters, limit = 25) {
  const ids: string[] = []; let cursor = null; let pages = 0;
  do {
    const p = paginateEvents(all, cursor, f, limit);
    ids.push(...p.items.map(e => e.id)); cursor = p.next_cursor; pages++;
    if (pages > 1000) throw new Error("runaway");
  } while (cursor);
  return { ids, pages };
}

describe("timeline cursors", () => {
  it("round-trips through encode/decode", () => {
    const c = { on: "2026-10-01", at: "2026-10-01T23:30:00.000Z", id: "alert:x|y" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor(encodeCursor(cursorForJump("2026-01-31")))).toEqual({ on: "2026-02-01", at: null, id: null });
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("garbage")).toBeNull();
  });

  it("orders by day, then time, then id (all descending)", () => {
    const a = ev("txn:a", "2026-10-02"), b = ev("txn:b", "2026-10-02"), late = ev("alert:z", "2026-10-02", { occurred_at: "2026-10-02T23:00:00Z" });
    const older = ev("txn:zz", "2026-10-01", { occurred_at: "2026-10-03T03:00:00Z" }); // evening alert in local day before
    expect([a, older, late, b].sort(compareEventsDesc).map(e => e.id)).toEqual(["alert:z", "txn:b", "txn:a", "txn:zz"]);
  });

  it("isBeforeCursor is strict and breaks ties on id", () => {
    const e = ev("txn:m", "2026-10-02");
    expect(isBeforeCursor(e, cursorAfter(e))).toBe(false);
    expect(isBeforeCursor(e, { ...cursorAfter(e), id: "txn:n" })).toBe(true);
    expect(isBeforeCursor(e, { on: "2026-10-02", at: null, id: null })).toBe(false); // whole day excluded
    expect(isBeforeCursor(e, cursorForJump("2026-10-02"))).toBe(true);
    expect(isBeforeCursor(e, null)).toBe(true);
  });

  it("toPage uses the limit+1 row only to know there is more", () => {
    const rows = Array.from({ length: 26 }, (_, i) => ev(`txn:${String(99 - i)}`, "2026-10-01"));
    const p = toPage(rows, 25);
    expect(p.items).toHaveLength(25);
    expect(p.next_cursor).toEqual(cursorAfter(rows[24]));
    expect(toPage(rows.slice(0, 25), 25).next_cursor).toBeNull();
    expect(toPage([], 25)).toEqual({ items: [], next_cursor: null });
  });
});

describe("keyset pagination", () => {
  // 3 events per day for 40 days (same-day ties on time) + an internal pair every 10 days
  const all: TimelineEvent[] = [];
  for (let d = 0; d < 40; d++) {
    const on = `2026-${d < 20 ? "09" : "08"}-${String(28 - (d % 20)).padStart(2, "0")}`;
    all.push(ev(`txn:s${d}a`, on), ev(`txn:s${d}b`, on), ev(`alert:${d}`, on, { category: "alerts", occurred_at: `${on}T15:00:00Z`, status: "flag" }));
    if (d % 10 === 0) all.push(ev(`txn:x${d}o`, on, { category: "transfer", txn_type: "transfer_internal", is_internal: true }), ev(`txn:x${d}i`, on, { category: "transfer", txn_type: "transfer_internal", is_internal: true }));
    if (d % 7 === 0) all.push(ev(`txn:inc${d}`, on, { category: "income", txn_type: "income_salary", amount: 2000 }));
  }

  it("visits every visible event exactly once, newest first, across page boundaries", () => {
    const { ids, pages } = walk(all, F());
    const expected = all.filter(e => !e.is_internal).sort(compareEventsDesc).map(e => e.id);
    expect(ids).toEqual(expected);
    expect(new Set(ids).size).toBe(ids.length);
    expect(pages).toBe(Math.ceil(expected.length / 25));
  });

  it("first page has 25 and a cursor; the last page has none", () => {
    const p1 = paginateEvents(all, null, F());
    expect(p1.items).toHaveLength(25);
    expect(p1.next_cursor).not.toBeNull();
    const tiny = paginateEvents(all.slice(0, 3), null, F());
    expect(tiny.next_cursor).toBeNull();
  });

  it("hides internal transfers by default and shows them with the toggle", () => {
    expect(walk(all, F()).ids.some(id => id.startsWith("txn:x"))).toBe(false);
    expect(walk(all, F({ includeInternal: true })).ids.filter(id => id.startsWith("txn:x"))).toHaveLength(8);
  });

  it("chips narrow categories; internal transfers still show with the toggle", () => {
    const inc = walk(all, F({ chips: ["income"] })).ids;
    expect(inc.every(id => id.startsWith("txn:inc"))).toBe(true);
    expect(inc).toHaveLength(6);
    const incInt = walk(all, F({ chips: ["income"], includeInternal: true })).ids;
    expect(incInt).toHaveLength(14);
    const multi = walk(all, F({ chips: ["income", "alerts"] })).ids;
    expect(multi).toHaveLength(46);
    // "upcoming" chip alone does not filter history categories (history hidden by showHistory instead)
    expect(walk(all, F({ chips: ["upcoming"] })).ids).toHaveLength(all.filter(e => !e.is_internal).length);
  });

  it("jump-to-date starts at the end of that day and keeps paging older", () => {
    const { ids } = walk(all, F({ at: "2026-09-15" }));
    const got = ids.map(id => all.find(e => e.id === id)!);
    expect(got.every(e => e.occurred_on <= "2026-09-15")).toBe(true);
    expect(got[0].occurred_on).toBe("2026-09-15");
  });

  it("matchesFilters mirrors timeline_page()", () => {
    const internal = { category: "transfer" as const, is_internal: true };
    expect(matchesFilters(internal, [], false)).toBe(false);
    expect(matchesFilters(internal, [], true)).toBe(true);
    expect(matchesFilters(internal, ["bills"], true)).toBe(true);
    expect(matchesFilters({ category: "transfer", is_internal: false }, ["bills"], false)).toBe(false);
    expect(matchesFilters({ category: "transfer", is_internal: false }, [], false)).toBe(true);
  });
});

describe("filters", () => {
  it("Upcoming shows for All or the Upcoming chip, never after a jump", () => {
    expect(showUpcoming(F())).toBe(true);
    expect(showUpcoming(F({ chips: ["bills"] }))).toBe(false);
    expect(showUpcoming(F({ chips: ["bills", "upcoming"] }))).toBe(true);
    expect(showUpcoming(F({ at: "2026-01-01" }))).toBe(false);
    expect(showHistory(F({ chips: ["upcoming"] }))).toBe(false);
    expect(showHistory(F({ chips: ["upcoming", "bills"] }))).toBe(true);
  });
  it("toggles chips and counts active filters", () => {
    let c = toggleChip([], "bills"); c = toggleChip(c, "income"); expect(c).toEqual(["bills", "income"]);
    expect(toggleChip(c, "bills")).toEqual(["income"]);
    expect(toggleChip(c, "all")).toEqual([]);
    expect(activeFilterCount(F({ chips: ["bills"], includeInternal: true }))).toBe(2);
  });
});

describe("transfer hiding / classification", () => {
  it("maps every txn type to a chip, same as the SQL timeline_category()", () => {
    const sql = fs.readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261029100000_timeline_events.sql"), "utf8");
    const fn = sql.slice(sql.indexOf("function public.timeline_category"), sql.indexOf("-- ── the view"));
    const sqlMap = new Map<string, string>();
    for (const m of fn.matchAll(/when p_txn_type (?:in \(([^)]*)\)|= '([a-z_]+)') then '([a-z]+)'/g)) {
      const types = m[1] ? [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]) : [m[2]];
      for (const t of types) sqlMap.set(t, m[3]);
    }
    const sqlElse = /else '([a-z]+)'/.exec(fn)![1];
    for (const t of TXN_TYPES) expect(categoryForType(t), t).toBe(sqlMap.get(t) ?? sqlElse);
    expect(categoryForType("transfer_internal")).toBe("transfer");
    expect(categoryForType("refund")).toBe("spending");
  });

  it("user overrides win over the classifier, which wins over the PFC fallback", () => {
    expect(resolveTxnType("obligation_bill", "transfer_internal", "spend")).toBe("obligation_bill");
    expect(resolveTxnType(null, "transfer_internal", "transfer_out")).toBe("transfer_internal");
    expect(resolveTxnType(undefined, undefined, "transfer_out")).toBe("transfer_out");
  });

  it("only writes changed classifier verdicts, skipping pending and duplicate ids", () => {
    const cls = (type: Classification["type"]): Classification => ({ type, source: "pair", reason: "" });
    const classes = new Map([["1", cls("transfer_internal")], ["2", cls("spend")], ["3", cls("spend")], ["4", cls("income_salary")]]);
    const txns = [
      { id: "1", transaction_id: "p1" }, { id: "2", transaction_id: "p2" }, { id: "3", transaction_id: "p3", pending: true },
      { id: "4", transaction_id: "p4" }, { id: "5", transaction_id: null },
    ];
    const stored = new Map([["p2", "spend"], ["p4", "income_other"]]);
    expect(classificationDiff(txns, classes, stored)).toEqual([
      { transaction_id: "p1", txn_type: "transfer_internal" },
      { transaction_id: "p4", txn_type: "income_salary" },
    ]);
  });

  it("normalises view rows from PostgREST", () => {
    const e = eventFromRow({ id: "txn:1", source: "transaction", source_id: "1", occurred_on: "2026-10-01", occurred_at: "2026-10-01T12:00:00+00:00", category: "transfer", txn_type: "transfer_internal", is_internal: true, title: "X", amount: "-12.50", status: "moved" });
    expect(e.amount).toBe(-12.5);
    expect(e.occurred_at).toBe("2026-10-01T12:00:00.000Z");
    expect(e.is_internal).toBe(true);
    expect(e.meta).toEqual({});
  });
});

describe("upcoming", () => {
  const today = "2026-10-28";
  const base: UpcomingStream = {
    id: "s1", series_key: "outflow|rent", display_name: "Rent", direction: "outflow", txn_type: "obligation_bill", kind: "bill",
    cadence: "monthly", category: "Rent", schedule: { cadence: "monthly", kind: "day-of-month", anchorDay: 1, monthStep: 1, anchorMonth: 1, shift: "none" },
    account_id: "chk", amount_median: 2000, amount_cv: 0, is_fixed: true, next_expected_date: "2026-11-01", next_expected_amount: 2000,
    last_seen: "2026-10-01", active: true, status: "confirmed", must_pay: true,
  };
  const accounts = [{ account_id: "chk", name: "Checking", mask: "0042" }, { account_id: "card", name: "Amex Gold", mask: "1004", current_balance: 900 }];

  it("projects stream dates into the window with Covered-by from obligations", () => {
    const up = buildUpcoming({ today, through: "2026-12-15", streams: [base], obligations: [{ id: "o1", stream_id: "s1", funding_account_id: "chk" }], accounts });
    expect(up.map(e => e.occurred_on)).toEqual(["2026-12-01", "2026-11-01"]);
    expect(up[0]).toMatchObject({ upcoming: true, category: "bills", amount: -2000, status: "expected", covered_by: "Checking ••0042", estimated: false, repeats: "Monthly on the 1st" });
  });

  it("marks must-pay outflows with no funding account Not covered; income never", () => {
    const [bill] = buildUpcoming({ today, through: "2026-11-10", streams: [base], accounts });
    expect(bill.status).toBe("not_covered");
    const pay = { ...base, id: "s2", series_key: "inflow|pay", display_name: "Paycheck", direction: "inflow", txn_type: "income_salary", kind: "salary", must_pay: false };
    const [p] = buildUpcoming({ today, through: "2026-11-10", streams: [pay], accounts });
    expect(p).toMatchObject({ status: "expected", amount: 2000, category: "income" });
  });

  it("uses the autopay account when no obligation links the stream (confirmed autopay only)", () => {
    const [u] = buildUpcoming({ today, through: "2026-11-10", streams: [{ ...base, autopay: "auto", autopay_source: "detected", pay_from_account_id: "chk" }], accounts });
    expect(u.covered_by).toBeNull(); // detected-only autopay doesn't count (streamCountsAsAutopay)
    const [e] = buildUpcoming({ today, through: "2026-11-10", streams: [{ ...base, autopay: "auto", autopay_source: "confirmed", pay_from_account_id: "chk" }], accounts });
    expect(e.covered_by).toBe("Checking ••0042");
  });

  it("skips dismissed/inactive streams and periods that already posted", () => {
    expect(buildUpcoming({ today, through: "2026-11-10", streams: [{ ...base, status: "dismissed" }] })).toEqual([]);
    expect(buildUpcoming({ today, through: "2026-11-10", streams: [{ ...base, active: false }] })).toEqual([]);
    // paid Oct 28 (early, within tolerance) for the Nov 1 period → nothing until Dec
    expect(buildUpcoming({ today, through: "2026-11-10", streams: [{ ...base, last_seen: "2026-10-28" }] })).toHaveLength(0);
  });

  it("labels variable amounts est. and projects weekly streams for every week", () => {
    const wk: UpcomingStream = { ...base, id: "w", series_key: "outflow|gym", txn_type: "spend", kind: "subscription", cadence: "weekly", must_pay: false, is_fixed: false, amount_cv: 0.2,
      schedule: { cadence: "weekly", kind: "interval", intervalDays: 7, phaseDay: "2026-10-02", shift: "none" }, last_seen: "2026-10-23" };
    const up = buildUpcoming({ today, through: "2026-11-11", streams: [wk] });
    expect(up.map(e => e.occurred_on)).toEqual(["2026-11-06", "2026-10-30"]);
    expect(up.every(e => e.estimated && e.category === "spending")).toBe(true);
  });

  it("falls back to next_expected_date when a stored schedule is unusable", () => {
    const [e] = buildUpcoming({ today, through: "2026-11-10", streams: [{ ...base, schedule: {}, next_expected_date: "2026-11-03", last_seen: null }] });
    expect(e.occurred_on).toBe("2026-11-03");
  });

  it("adds card due dates from the latest statement and drops a duplicate card-payment stream", () => {
    const cardStream = { ...base, id: "cp", series_key: "outflow|amex", kind: "card_payment", txn_type: "credit_card_payment", counterpart_account_id: "card" };
    const up = buildUpcoming({
      today, through: "2026-11-20", streams: [cardStream], accounts,
      statements: [
        { account_id: "card", statement_issue_date: "2026-09-12", due_date: "2026-10-07", statement_balance: 500, minimum_payment_amount: 25 },
        { account_id: "card", statement_issue_date: "2026-10-12", due_date: "2026-11-07", statement_balance: null, minimum_payment_amount: 25 },
      ],
    });
    expect(up).toHaveLength(1);
    expect(up[0]).toMatchObject({ occurred_on: "2026-11-07", category: "cards", amount: -900, estimated: true, title: "Amex Gold payment due" });
  });

  it("includes upcoming tax milestones only", () => {
    const up = buildUpcoming({ today, through: "2027-02-01", streams: [], milestones: [
      { id: "q4", title: "Q4 estimated tax", due_date: "2027-01-15", amount: 1800, status: "upcoming" },
      { id: "q3", title: "Q3", due_date: "2026-11-15", amount: 1800, status: "done" },
    ] });
    expect(up.map(e => e.id)).toEqual(["up:tax:q4"]);
    expect(up[0]).toMatchObject({ category: "taxes", amount: -1800, estimated: true });
  });

  it("windows to 14 days by default, 5 weeks extended, and respects chips + internal toggle", () => {
    const streams = [base, { ...base, id: "x", series_key: "outflow|xfer", txn_type: "transfer_internal", kind: "transfer", must_pay: false, schedule: { cadence: "monthly", kind: "day-of-month", anchorDay: 5, monthStep: 1, anchorMonth: 1, shift: "none" }, last_seen: "2026-10-05" }] as UpcomingStream[];
    const all = buildUpcoming({ today, through: "2026-12-31", streams });
    expect(UPCOMING_DAYS).toBe(14); expect(UPCOMING_DAYS_EXTENDED).toBe(35);
    expect(visibleUpcoming(all, F(), today, UPCOMING_DAYS).map(e => e.occurred_on)).toEqual(["2026-11-01"]);
    expect(visibleUpcoming(all, F({ includeInternal: true }), today, UPCOMING_DAYS).map(e => e.occurred_on)).toEqual(["2026-11-05", "2026-11-01"]);
    expect(visibleUpcoming(all, F(), today, UPCOMING_DAYS_EXTENDED).map(e => e.occurred_on)).toEqual(["2026-12-01", "2026-11-01"]);
    expect(visibleUpcoming(all, F({ chips: ["upcoming", "income"] }), today, 35)).toEqual([]);
    expect(visibleUpcoming(all, F({ chips: ["upcoming"] }), today, 35)).toHaveLength(2);
  });

  it("merges stored streams over detected ones (stored decisions win)", () => {
    const detected = [{ ...base, id: null, status: "suggested", last_seen: "2026-10-01" }, { ...base, id: null, series_key: "outflow|new", display_name: "New" }];
    const stored = [{ ...base, status: "dismissed", last_seen: "2026-09-01" }];
    const m = mergeStreams(stored, detected);
    expect(m.find(s => s.series_key === "outflow|rent")).toMatchObject({ id: "s1", status: "dismissed", last_seen: "2026-10-01" });
    expect(m).toHaveLength(2);
    expect(buildUpcoming({ today, through: "2026-11-10", streams: m }).map(e => e.title)).toEqual(["New"]);
  });
});

describe("today marker & upcoming merge", () => {
  const up = [ev("up:a", "2026-11-05", { upcoming: true, status: "expected" }), ev("up:b", "2026-10-30", { upcoming: true, status: "expected" })];
  const hist = [ev("txn:1", "2026-10-28"), ev("txn:2", "2026-10-28"), ev("txn:3", "2026-09-30"), ev("txn:2", "2026-10-28")];

  it("puts upcoming (furthest first) above Today, then month/day headers", () => {
    const rows = buildTimelineRows({ today: "2026-10-28", upcoming: up, history: hist, showToday: true });
    expect(rows.map(r => r.kind === "event" ? `${r.ghost ? "ghost" : "ev"}:${r.event.id}` : r.kind === "month" ? `m:${r.month}` : r.kind === "day" ? `d:${r.date}` : r.kind)).toEqual([
      "upcoming-header", "ghost:up:a", "ghost:up:b", "today", "m:2026-10", "d:2026-10-28", "ev:txn:1", "ev:txn:2", "m:2026-09", "d:2026-09-30", "ev:txn:3",
    ]);
  });

  it("shows an empty-upcoming row, and nothing above history after a jump", () => {
    expect(buildTimelineRows({ today: "2026-10-28", upcoming: [], history: [], showToday: true }).map(r => r.kind)).toEqual(["upcoming-header", "upcoming-empty", "today"]);
    expect(buildTimelineRows({ today: "2026-10-28", upcoming: null, history: hist.slice(2, 3), showToday: false }).map(r => r.kind)).toEqual(["month", "day", "event"]);
  });
});

describe("demo timeline", () => {
  const d = demoTimeline("2026-10-28");
  it("covers every chip and hides internal transfers by default", () => {
    const cats = new Set(d.events.map(e => e.category));
    for (const c of ["income", "bills", "cards", "savings", "taxes", "alerts", "spending", "transfer"]) expect(cats.has(c as never), c).toBe(true);
    const p = demoPage(null, F());
    expect(p.items).toHaveLength(25);
    expect(walk(d.events, F()).ids.some(id => id.includes("demo-int"))).toBe(false);
    expect(walk(d.events, F({ includeInternal: true })).ids.filter(id => id.includes("demo-int"))).toHaveLength(6);
    expect(d.events.every(e => e.occurred_on <= "2026-10-28")).toBe(true);
  });
  it("projects upcoming bills, paychecks and card dues from the demo history", () => {
    const up = visibleUpcoming(d.upcoming("2026-12-02"), F(), "2026-10-28", 35);
    const cats = new Set(up.map(e => e.category));
    expect(cats.has("income") && cats.has("bills") && cats.has("cards")).toBe(true);
    expect(up.some(e => e.status === "not_covered")).toBe(true);
    expect(up.some(e => e.covered_by)).toBe(true);
    expect(up.every(e => e.occurred_on >= "2026-10-28")).toBe(true);
  });
});
