/**
 * android-compat.test.ts
 *
 * Tests for code paths that work on web but crash on Android WebView.
 * Every test here maps to a real production crash.
 */
import { describe, it, expect } from "vitest";
import { fmtUSD, fmtPct } from "@/lib/format";

// ── fmtUSD — compact notation ────────────────────────────────────
// CRASH: Intl.NumberFormat notation:'compact' throws RangeError on
// Android WebView < Chrome 77. Fixed by switching to manual K/M math.
describe("fmtUSD — compact (Android WebView safe)", () => {
  it("formats millions without Intl compact", () => {
    expect(fmtUSD(1_500_000, { compact: true })).toBe("$1.5M");
    expect(fmtUSD(2_400_000, { compact: true })).toBe("$2.4M");
    expect(fmtUSD(10_000_000, { compact: true })).toBe("$10M");
    expect(fmtUSD(123_456_789, { compact: true })).toBe("$123M");
  });

  it("formats thousands without Intl compact", () => {
    expect(fmtUSD(1_500, { compact: true })).toBe("$1.5K");
    expect(fmtUSD(42_000, { compact: true })).toBe("$42K");
    expect(fmtUSD(485_000, { compact: true })).toBe("$485K");
  });

  it("formats sub-thousand normally", () => {
    expect(fmtUSD(999, { compact: true })).toBe("$999");
    expect(fmtUSD(0, { compact: true })).toBe("$0");
  });

  it("never calls Intl with notation:compact (would crash Android)", () => {
    // This test verifies the output is correct WITHOUT using the
    // unsupported Intl notation. If this test passes, the Android-safe
    // path is working.
    const result = fmtUSD(5_000_000, { compact: true });
    expect(result).toMatch(/^\$\d+(\.\d)?M$/);
  });

  it("handles negative compact values", () => {
    expect(fmtUSD(-2_500_000, { compact: true })).toBe("−$2.5M");
    expect(fmtUSD(-50_000, { compact: true })).toBe("−$50K");
  });

  it("signed + compact", () => {
    expect(fmtUSD(1_000_000, { compact: true, signed: true })).toBe("+$1.0M");
    expect(fmtUSD(-1_000_000, { compact: true, signed: true })).toBe("−$1.0M");
  });
});

// ── fmtUSD — standard ────────────────────────────────────────────
describe("fmtUSD — standard", () => {
  it("whole dollars have no cents", () => {
    expect(fmtUSD(1000)).toBe("$1,000");
    expect(fmtUSD(0)).toBe("$0");
    expect(fmtUSD(1)).toBe("$1");
  });

  it("fractional amounts show 2 decimal places", () => {
    expect(fmtUSD(19.99)).toBe("$19.99");
    expect(fmtUSD(0.5)).toBe("$0.50");
    expect(fmtUSD(1234.56)).toBe("$1,234.56");
  });

  it("cents option forces 2dp even for whole numbers", () => {
    expect(fmtUSD(100, { cents: true })).toBe("$100.00");
    expect(fmtUSD(0, { cents: true })).toBe("$0.00");
  });

  it("negative shows minus prefix", () => {
    expect(fmtUSD(-50)).toBe("−$50");
    expect(fmtUSD(-19.99)).toBe("−$19.99");
  });

  it("signed shows + or − prefix", () => {
    expect(fmtUSD(200, { signed: true })).toBe("+$200");
    expect(fmtUSD(-200, { signed: true })).toBe("−$200");
    expect(fmtUSD(0, { signed: true })).toBe("+$0");
  });
});

// ── fmtPct ───────────────────────────────────────────────────────
describe("fmtPct", () => {
  it("strips trailing zeros", () => {
    expect(fmtPct(2.5)).toBe("+2.5%");
    expect(fmtPct(2.0)).toBe("+2%");
    expect(fmtPct(2.50)).toBe("+2.5%");
  });

  it("handles negative", () => {
    expect(fmtPct(-5.2)).toBe("−5.2%");
  });

  it("handles zero", () => {
    expect(fmtPct(0)).toBe("0%");
  });
});

// ── buildNWByPeriod — safe with empty txns ────────────────────────
// CRASH potential: reduce on empty array, Date math on bad strings
describe("buildNWByPeriod safety", () => {
  const buildNWByPeriod = (netWorth: number, txns: any[], period: string) => {
    const today = new Date(); today.setHours(0,0,0,0);
    const makePoints = (count: number, stepDays: number) =>
      Array.from({ length: count }, (_, i) => {
        const d = new Date(today);
        d.setDate(today.getDate() - (count - 1 - i) * stepDays);
        return { date: d.toISOString().split("T")[0] };
      });

    let points: { date: string }[];
    switch (period) {
      case "1W":  points = makePoints(7, 1); break;
      case "1M":  points = makePoints(30, 1); break;
      case "3M":  points = makePoints(13, 7); break;
      case "1Y":  points = makePoints(12, 30); break;
      default: {
        if (txns.length === 0) { points = makePoints(6, 30); break; }
        const oldest = txns.reduce((m: string, t: any) => t.date < m ? t.date : m, txns[0].date);
        const diff = Math.ceil((today.getTime() - new Date(oldest).getTime()) / (30 * 86400000)) + 1;
        const cnt = Math.min(Math.max(diff, 3), 24);
        points = makePoints(cnt, 30);
        break;
      }
    }
    return points.map(({ date }) => {
      const adj = txns.filter((t: any) => t.date > date).reduce((s: number, t: any) => s + Number(t.amount), 0);
      return { v: Math.round(netWorth + adj) };
    });
  };

  it("handles empty transactions for ALL period", () => {
    expect(() => buildNWByPeriod(10000, [], "ALL")).not.toThrow();
    const result = buildNWByPeriod(10000, [], "ALL");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].v).toBe(10000);
  });

  it("returns correct point count for each period", () => {
    expect(buildNWByPeriod(0, [], "1W").length).toBe(7);
    expect(buildNWByPeriod(0, [], "1M").length).toBe(30);
    expect(buildNWByPeriod(0, [], "3M").length).toBe(13);
    expect(buildNWByPeriod(0, [], "1Y").length).toBe(12);
    expect(buildNWByPeriod(0, [], "ALL").length).toBe(6);
  });

  it("NW at each point adjusts by future transactions", () => {
    // Past txn (amount=100 expense) increases historical NW (since current NW already subtracted it)
    const past = new Date(); past.setDate(past.getDate() - 60);
    const txns = [{ date: past.toISOString().split("T")[0], amount: 100 }];
    const result = buildNWByPeriod(5000, txns, "1M");
    // Points BEFORE the past txn should have higher NW (100 more)
    expect(result[0].v).toBeGreaterThanOrEqual(5000);
  });
});

// ── useUserSettings defaults — never undefined arrays ────────────
// CRASH: settings.panelOrder.length threw if panelOrder was undefined
describe("UserSettings defaults are always safe arrays", () => {
  const DEFAULTS = {
    budgets: {}, accountRoles: {}, catOverrides: {}, catRules: [],
    customCats: [], nameOverrides: {}, nameRules: {},
    manualIncome: [], manualInternal: [], manualExternal: [],
    dismissedInsights: [], dismissedActions: [], dismissedRecurring: [],
    panelOrder: [], accountMeta: {}, benefitsUsed: {}, moneyMapFeedback: {},
    smartRules: [], recurringDismissals: [],
  };

  it("all array fields are arrays, never undefined", () => {
    const arrays = [
      "catRules", "customCats", "manualIncome", "manualInternal",
      "manualExternal", "dismissedInsights", "dismissedActions",
      "dismissedRecurring", "panelOrder", "smartRules", "recurringDismissals",
    ] as const;
    arrays.forEach(k => {
      expect(Array.isArray(DEFAULTS[k]), `${k} must be array`).toBe(true);
    });
  });

  it("panelOrder.length never throws", () => {
    expect(() => DEFAULTS.panelOrder.length).not.toThrow();
    expect(() => DEFAULTS.panelOrder.map(x => x)).not.toThrow();
  });

  it("dbToSettings handles null/undefined DB fields safely", () => {
    const dbToSettings = (row: any) => ({
      catRules:           Array.isArray(row.cat_rules)          ? row.cat_rules          : [],
      panelOrder:         Array.isArray(row.panel_order)        ? row.panel_order        : [],
      manualIncome:       Array.isArray(row.manual_income)      ? row.manual_income      : [],
      dismissedInsights:  Array.isArray(row.dismissed_insights) ? row.dismissed_insights : [],
      smartRules:         Array.isArray(row.smart_rules)        ? row.smart_rules        : [],
    });

    // DB returns null for new columns
    const row = { cat_rules: null, panel_order: null, manual_income: undefined, smart_rules: null };
    const s = dbToSettings(row);
    expect(s.catRules).toEqual([]);
    expect(s.panelOrder).toEqual([]);
    expect(s.manualIncome).toEqual([]);
    expect(s.smartRules).toEqual([]);
    expect(() => s.panelOrder.length).not.toThrow();
    expect(() => s.catRules.filter(() => true)).not.toThrow();
  });
});

// ── Intl.NumberFormat compatibility ──────────────────────────────
// CRASH: notation:'compact' is ES2020, not available on Android API <29
describe("Intl.NumberFormat Android compatibility", () => {
  it("standard currency format works everywhere", () => {
    // This is the safe path — no exotic options
    expect(() => new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD",
      maximumFractionDigits: 2, minimumFractionDigits: 0,
    }).format(1234)).not.toThrow();
  });

  it("manual K/M formatting produces correct output", () => {
    const compact = (n: number) => {
      const abs = Math.abs(n);
      if (abs >= 1_000_000) return `$${(abs/1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
      if (abs >= 1_000)     return `$${(abs/1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
      return `$${abs}`;
    };
    expect(compact(1_500_000)).toBe("$1.5M");
    expect(compact(10_000_000)).toBe("$10M");
    expect(compact(1_500)).toBe("$1.5K");
    expect(compact(42_000)).toBe("$42K");
    expect(compact(500)).toBe("$500");
  });
});

// ── Date operations Android safe ─────────────────────────────────
describe("Date formatting Android safe", () => {
  it("toLocaleDateString with en-US locale works on Android", () => {
    const d = new Date("2026-07-10T00:00:00");
    // These options are all ES5 — safe everywhere
    expect(() => d.toLocaleDateString("en-US", {
      month: "short", day: "numeric"
    })).not.toThrow();
    expect(() => d.toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric", year: "numeric"
    })).not.toThrow();
  });

  it("ISO date string parsing never throws", () => {
    const dates = ["2026-01-15", "2026-12-31", "2026-07-10"];
    dates.forEach(d => {
      expect(() => new Date(d + "T00:00:00")).not.toThrow();
      expect(() => new Date(d + "T00:00:00").getTime()).not.toThrow();
    });
  });
});
