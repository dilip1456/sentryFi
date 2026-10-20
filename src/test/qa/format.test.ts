/**
 * QA — currency / percent formatting (src/lib/format.ts).
 * Characterizes current behavior; `it.fails` marks known bugs (the assertion
 * states the CORRECT behavior, so the test flips to "unexpectedly passed"
 * — i.e. a failure you should resolve by removing `.fails` — once fixed).
 */
import { describe, it, expect } from "vitest";
import { fmtUSD, fmtPct } from "@/lib/format";

describe("QA fmtUSD", () => {
  it("whole dollars drop cents, fractional amounts always show 2 decimals", () => {
    expect(fmtUSD(4196)).toBe("$4,196");
    expect(fmtUSD(4196.61)).toBe("$4,196.61");
    expect(fmtUSD(4196.6)).toBe("$4,196.60");
    expect(fmtUSD(0.5)).toBe("$0.50");
  });

  it("rounds sub-cent floating-point noise instead of printing it", () => {
    expect(fmtUSD(0.1 + 0.2)).toBe("$0.30");
    expect(fmtUSD(100.004)).toBe("$100");
    expect(fmtUSD(99.999)).toBe("$100");
    expect(fmtUSD(1234.5678)).toBe("$1,234.57");
  });

  it("uses a true minus sign (U+2212) for negatives and never prints −$0", () => {
    expect(fmtUSD(-12.5)).toBe("−$12.50");
    expect(fmtUSD(-0)).toBe("$0");
    expect(fmtUSD(0)).toBe("$0");
  });

  it("signed mode prefixes + for zero/positive and − for negative", () => {
    expect(fmtUSD(6283.39, { signed: true })).toBe("+$6,283.39");
    expect(fmtUSD(-1610, { signed: true })).toBe("−$1,610");
    expect(fmtUSD(0, { signed: true })).toBe("+$0");
  });

  it("cents mode always shows two decimals", () => {
    expect(fmtUSD(15, { cents: true })).toBe("$15.00");
    expect(fmtUSD(-15, { cents: true })).toBe("−$15.00");
  });

  it("compact mode: <1K unchanged, K/M with one decimal under 10, none at/above 10", () => {
    expect(fmtUSD(950, { compact: true })).toBe("$950");
    expect(fmtUSD(5300, { compact: true })).toBe("$5.3K");
    expect(fmtUSD(13160.62, { compact: true })).toBe("$13K");
    expect(fmtUSD(292000, { compact: true })).toBe("$292K");
    expect(fmtUSD(1_500_000, { compact: true })).toBe("$1.5M");
    expect(fmtUSD(25_000_000, { compact: true })).toBe("$25M");
    expect(fmtUSD(-13000, { compact: true })).toBe("−$13K");
  });

  it("never renders NaN/undefined/Infinity text for finite inputs", () => {
    for (const n of [0, 1, -1, 0.01, 1e9, -1e9, 123456.789]) {
      for (const opts of [undefined, { compact: true }, { cents: true }, { signed: true }]) {
        expect(fmtUSD(n, opts)).not.toMatch(/NaN|undefined|Infinity/);
      }
    }
  });

  // KNOWN BUG: values that round up across a unit boundary keep the old unit.
  it.fails("KNOWN BUG compact: $9,999 should read $10K (currently \"$10.0K\")", () => {
    expect(fmtUSD(9999, { compact: true })).toBe("$10K");
  });
  it.fails("KNOWN BUG compact: $999,999 should read $1M/$1.0M (currently \"$1000K\")", () => {
    expect(fmtUSD(999_999, { compact: true })).toMatch(/^\$1(\.0)?M$/);
  });
  // KNOWN BUG: NaN input (e.g. Number(null-ish balance) slips through) prints "$NaN".
  it.fails("KNOWN BUG fmtUSD(NaN) should not render the text NaN", () => {
    expect(fmtUSD(Number.NaN)).not.toContain("NaN");
  });
});

describe("QA fmtPct", () => {
  it("signs and trims trailing zeros", () => {
    expect(fmtPct(2.5)).toBe("+2.5%");
    expect(fmtPct(2)).toBe("+2%");
    expect(fmtPct(-3.25)).toBe("−3.3%");
    expect(fmtPct(0)).toBe("0%");
    expect(fmtPct(10)).toBe("+10%");
    expect(fmtPct(100)).toBe("+100%");
  });
  // KNOWN BUG: the trailing-zero regex also eats integer zeros when digits=0.
  it.fails("KNOWN BUG fmtPct(100, 0) should be +100% (currently \"+1%\")", () => {
    expect(fmtPct(100, 0)).toBe("+100%");
  });
});
