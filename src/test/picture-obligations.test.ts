/**
 * One Financial Picture plan: anticipating expenses (detection of yearly and
 * twice-a-year bills, projection, sinking funds, accounted-for check), where
 * the money goes, taxes and recommendations. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { Builder, monthly, picture, TODAY } from "./fixtures/picture-scenarios";
import {
  accountedFor, buildObligations, cadenceBucket, categorize, categoryTotals, fromManual, project, sinkingFund, windowEnd, type Obligation,
} from "@/lib/picture/obligations";
import { moneyAllocation, recommendations, taxSummary } from "@/lib/picture/plan-insights";
import { taxSaverNumbers, taxSnapshot, matchStatus } from "@/lib/picture/tax";
import type { ReviewItem } from "@/lib/recurring";

const base = () => new Builder()
  .acct("chk", "Everyday Checking", "depository", "checking", "1111", 8000)
  .acct("card", "Sapphire Card", "credit", "credit card", "3333", 1500);
const items = (b: Builder) => picture(b.fx()).m.review.items;
const find = (list: ReviewItem[], re: RegExp) => list.find(i => re.test(i.label) || re.test(i.key));

describe("detecting yearly and twice-a-year bills", () => {
  it("car insurance every 6 months from 2 payments, projected forward", () => {
    const b = base();
    b.series("chk", ["2025-11-12", "2026-05-12"], 612, "PROGRESSIVE INS PREM", { merchant_name: "Progressive" });
    const it = find(items(b), /progressive/i)!;
    expect(it).toMatchObject({ cadence: "semiannual", group: "insurance_tax" });
    expect(it.nextDue).toMatch(/^2026-11-1/);
    const [ob] = buildObligations({ today: TODAY, reviewItems: [it] });
    expect(ob).toMatchObject({ category: "insurance", source: "detected", amount: 612, annual: 1224 });
  });
  it("vehicle registration once a year from 2 payments", () => {
    const b = base();
    b.series("chk", ["2024-12-03", "2025-12-02"], 185, "DMV VEHICLE REGISTRATION RENEWAL", { merchant_name: null });
    const it = find(items(b), /dmv|registration/i)!;
    expect(it).toBeTruthy();
    expect(it.cadence).toBe("yearly");
    expect(it.nextDue).toMatch(/^2026-12-0/);
    expect(buildObligations({ today: TODAY, reviewItems: [it] })[0].category).toBe("vehicle");
  });
  it("a single registration charge with a clearly yearly descriptor is suggested a year on", () => {
    const b = base();
    b.tx("chk", "2026-03-14", 96, "STATE DMV TAG RENEWAL");
    const it = find(items(b), /dmv|tag/i)!;
    expect(it).toMatchObject({ cadence: "yearly", status: "suggested", occurrences: 1 });
    expect(it.nextDue).toMatch(/^2027-03-1/);
  });
  it("two one-off purchases a year apart at a store are not a bill", () => {
    const b = base();
    b.series("card", ["2025-06-02", "2026-06-01"], 240, "BEST BUY #123", { pfc: "GENERAL_MERCHANDISE", pfcd: "GENERAL_MERCHANDISE_ELECTRONICS", merchant_name: "Best Buy" });
    expect(find(items(b), /best buy/i)).toBeUndefined();
  });
  it("utilities and HOA are categorized", () => {
    expect(categorize("PINE RIDGE HOA DUES")).toBe("housing");
    expect(categorize("CITY WATER SEWER", "bill", "utility")).toBe("utilities");
    expect(categorize("COUNTY TREASURER PROPERTY TAX", "tax", "property")).toBe("taxes");
    expect(categorize("COSTCO ANNUAL MEMBERSHIP", "subscription", null, "yearly")).toBe("annual_fees");
    expect(categorize("BRIGHT HORIZONS TUITION")).toBe("family");
    expect(categorize("NETFLIX.COM", "subscription")).toBe("subscriptions");
  });
});

const ob = (p: Partial<Obligation>): Obligation => ({
  id: "o", label: "Thing", category: "other", source: "confirmed", amount: 100, amountKind: "fixed", cadence: "monthly", nextDue: "2026-11-01",
  lastPaid: null, paidDates: [], monthly: 100, annual: 1200, missed: false, daysLate: null, ...p,
});

describe("projection and views", () => {
  it("projects each cadence over a window, overdue once on day one", () => {
    const occ = project([
      ob({ id: "w", cadence: "weekly", nextDue: "2026-10-21" }),
      ob({ id: "y", cadence: "yearly", nextDue: "2027-03-14" }),
      ob({ id: "m", cadence: "monthly", nextDue: "2026-10-15", missed: true }),
    ], "2026-10-20", "2026-11-10");
    expect(occ.filter(o => o.ob.id === "w").map(o => o.date)).toEqual(["2026-10-21", "2026-10-28", "2026-11-04"]);
    expect(occ.some(o => o.ob.id === "y")).toBe(false);
    expect(occ.filter(o => o.ob.id === "m").map(o => `${o.date}${o.overdue ? "!" : ""}`)).toEqual(["2026-10-20!"]);
  });
  it("custom intervals and one-time items", () => {
    const occ = project([ob({ id: "c", cadence: "custom", intervalDays: 45, nextDue: "2026-10-25" }), ob({ id: "1", cadence: "once", nextDue: "2026-12-01" })], "2026-10-20", "2027-01-31");
    expect(occ.filter(o => o.ob.id === "c").map(o => o.date)).toEqual(["2026-10-25", "2026-12-09", "2027-01-23"]);
    expect(occ.filter(o => o.ob.id === "1").map(o => o.date)).toEqual(["2026-12-01"]);
  });
  it("window ends", () => {
    expect(windowEnd("week", "2026-10-20")).toBe("2026-10-26");
    expect(windowEnd("month", "2026-10-20")).toBe("2026-10-31");
    expect(windowEnd("quarter", "2026-10-20")).toBe("2027-01-18");
    expect(windowEnd("year", "2026-10-20")).toBe("2026-12-31");
  });
  it("cadence buckets", () => {
    expect(cadenceBucket({ cadence: "biweekly" })).toBe("weekly");
    expect(cadenceBucket({ cadence: "semiannual" })).toBe("annual");
    expect(cadenceBucket({ cadence: "custom", intervalDays: 90 })).toBe("quarterly");
  });
  it("manual items: amount required, rolling due date, legacy dueDay items", () => {
    const m = fromManual({ id: "pt", label: "Property tax", monthly: 0, amount: 2400, cadence: "semiannual", nextDue: "2026-04-10", category: "taxes" }, "2026-10-20");
    expect(m).toMatchObject({ nextDue: "2027-04-10", annual: 4800, monthly: 400, source: "manual" });
    const legacy = fromManual({ id: "g", label: "Gym membership", monthly: 60, dueDay: 3, group: "fixed" }, "2026-10-20");
    expect(legacy).toMatchObject({ cadence: "monthly", nextDue: "2026-11-03", amount: 60 });
    expect(buildObligations({ today: "2026-10-20", reviewItems: [], manual: [{ id: "z", label: "Zero", monthly: 0 }] })).toEqual([]);
  });
});

describe("sinking funds and totals", () => {
  it("non-monthly bills get a steady set-aside and a start-now amount", () => {
    const f = sinkingFund(ob({ cadence: "semiannual", amount: 600, annual: 1200, monthly: 100, nextDue: "2026-12-20" }), "2026-10-20")!;
    expect(f).toEqual({ perMonth: 100, monthsToDue: 2, toBeReady: 300 });
    expect(sinkingFund(ob({ cadence: "monthly" }), "2026-10-20")).toBeNull();
    expect(sinkingFund(ob({ cadence: "once", amount: 1200, annual: 1200, nextDue: "2027-04-20" }), "2026-10-20")!.perMonth).toBe(200);
  });
  it("category totals: monthly equivalent, yearly and set-aside", () => {
    const t = categoryTotals([
      ob({ id: "a", category: "insurance", cadence: "semiannual", amount: 600, annual: 1200, monthly: 100 }),
      ob({ id: "b", category: "insurance", cadence: "monthly", amount: 50, annual: 600, monthly: 50 }),
      ob({ id: "c", category: "utilities", amount: 80, annual: 960, monthly: 80 }),
      ob({ id: "g", source: "giftcard", noCost: true, cadence: "once" }),
    ], "2026-10-20");
    expect(t[0]).toMatchObject({ category: "insurance", count: 2, monthly: 150, annual: 1800, setAside: 100 });
    expect(t.map(x => x.category)).toEqual(["insurance", "utilities"]);
  });
});

describe("accounted for this month", () => {
  it("paid, covered by cash, and missing", () => {
    const res = accountedFor([
      ob({ id: "rent", label: "Rent", amount: 1500, nextDue: "2026-11-01", paidDates: ["2026-10-01"] }),
      ob({ id: "power", label: "Power", amount: 90, nextDue: "2026-10-25" }),
      ob({ id: "phone", label: "Phone", amount: 70, nextDue: "2026-10-28" }),
      ob({ id: "gym", label: "Gym", amount: 40, nextDue: "2026-11-10", missed: true }),
    ], "2026-10-20", 100);
    expect(res.paid).toBe(1);
    expect(res.missing.map(o => o.id)).toEqual(["gym"]);
    expect(res.covered).toBe(1);
    expect(res.uncovered.map(o => o.id)).toEqual(["phone"]);
    expect(res.expected).toBe(4);
    expect(res.upcomingTotal).toBe(160);
  });
});

describe("where the money goes", () => {
  it("shares of gross pay including payroll deductions", () => {
    const a = moneyAllocation({
      grossMonthly: 10000, takeHomeMonthly: 7000, taxMonthly: 2000, payroll: { k401: 800, hsa: 300, espp: 0, rsu: 0 },
      savings: [{ monthly: 500, toSubtype: "savings" }, { monthly: 200, toSubtype: "roth" }, { monthly: 300, toType: "investment", toSubtype: "brokerage" }],
      obligations: [ob({ category: "housing", monthly: 2500 }), ob({ category: "debt", monthly: 400 }), ob({ category: "utilities", monthly: 300 })],
      budgetsMonthly: 1000,
    });
    const s = Object.fromEntries(a.slices.map(x => [x.key, x.share]));
    expect(a.basis).toBe("gross");
    expect(s).toMatchObject({ taxes: 20, retirement: 10, hsa: 3, savings: 5, investments: 3, housing: 25, debt: 4, bills: 3, spending: 10, left: 17 });
  });
});

describe("taxes (estimates)", () => {
  it("withholding, estimated payments, property tax and pre-tax savings with assumptions", () => {
    const gross = 120000, hsa = 3600, k401 = 9600;
    const tax = taxSnapshot({ gross, hsa, k401, filing: "single", year: 2026 });
    const savers = taxSaverNumbers(gross, hsa, k401, "single", 2026);
    const it = (p: Partial<ReviewItem>) => ({ key: "k", kind: "tax", subtype: "irs_estimated", status: "confirmed", label: "IRS", matched: [], ...p }) as unknown as ReviewItem;
    const t = taxSummary({
      today: "2026-10-20", year: 2026, gross, grossEstimated: true, filing: "single", filingSet: false, tax, savers, hsaMonthly: 300, k401Monthly: 800,
      reviewItems: [
        it({ matched: [{ id: "1", date: "2026-09-15", amount: 1500, name: "IRS", accountId: "chk" }, { id: "2", date: "2026-06-15", amount: 1500, name: "IRS", accountId: "chk" }, { id: "3", date: "2025-06-15", amount: 999, name: "IRS", accountId: "chk" }] }),
        it({ subtype: "property", label: "County property tax", matched: [{ id: "4", date: "2026-04-10", amount: 2400, name: "COUNTY", accountId: "chk" }] }),
      ],
    });
    expect(t.estimatedPayments).toBe(3000);
    expect(t.propertyTax).toBe(2400);
    expect(t.withheld).toBe(Math.round(tax.fed + tax.fica));
    expect(t.preTaxSaved).toBeGreaterThan(0);
    expect(t.assumptions.join(" ")).toMatch(/estimate/i);
    expect(t.missing.join(" ")).toMatch(/gross salary/);
    expect(t.missing.join(" ")).toMatch(/filing status/);
  });
});

describe("recommendations", () => {
  const savers = taxSaverNumbers(120000, 1200, 6000, "single", 2026);
  const input = {
    today: "2026-10-20", toReview: 2, cash: 3000, low: { date: "2026-11-02", balance: -150 }, match: matchStatus({ answer: "yes", pct: 50, upToPct: 6 }, 120000, 6000),
    savers, gross: 120000, k401Annual: 6000, year: 2026, giftCardsExpiringSoon: 1, dismissed: [] as string[],
    utilityPayments: [{ date: "2026-09-10", amount: 240 }, { date: "2025-09-10", amount: 180 }],
    obligations: [ob({ id: "car", label: "Car insurance", category: "insurance", cadence: "semiannual", amount: 600, annual: 1200, monthly: 100, nextDue: "2027-01-10" }), ob({ id: "rent", label: "Rent", amount: 1500, monthly: 1500, annual: 18000 })],
  };
  it("explains each one", () => {
    const recs = recommendations(input);
    const titles = recs.map(r => r.title).join(" | ");
    expect(titles).toMatch(/Set aside \$100\/mo for Car insurance/);
    expect(titles).toMatch(/401\(k\) match/);
    expect(titles).toMatch(/HSA room/);
    expect(titles).toMatch(/Utilities up 33%/);
    expect(titles).toMatch(/covers about \d+ weeks? of bills/);
    expect(titles).toMatch(/run short/);
    expect(recs.every(r => r.why.length > 20)).toBe(true);
  });
  it("a dismissed one vanishes", () => {
    const first = recommendations(input).find(r => r.id.startsWith("rec:sink:"))!;
    expect(recommendations({ ...input, dismissed: [first.id] }).some(r => r.id === first.id)).toBe(false);
  });
});
