import { describe, it, expect } from "vitest";
import { fmtUSD, fmtPct, fmtUSDCompact, fmtPctSafe } from "@/lib/format";

describe("fmtUSDCompact", () => {
  it.each([
    [0, "$0"], [999, "$999"], [1000, "$1K"], [1500, "$1.5K"], [9_949, "$9.9K"], [9_999, "$10K"],
    [42_000, "$42K"], [485_200, "$485K"], [999_999, "$1M"], [1_250_000, "$1.3M"], [-2_500, "−$2.5K"],
  ])("%d → %s", (n, want) => { expect(fmtUSDCompact(n)).toBe(want); });
  it("never renders NaN", () => {
    expect(fmtUSDCompact(NaN)).toBe("—");
    expect(fmtUSDCompact(undefined as unknown as number)).toBe("—");
  });
  it("signed", () => { expect(fmtUSDCompact(1200, { signed: true })).toBe("+$1.2K"); });
});

describe("fmtPctSafe", () => {
  it("keeps integer zeros", () => {
    expect(fmtPctSafe(100, 0)).toBe("+100%");
    expect(fmtPctSafe(2.5)).toBe("+2.5%");
    expect(fmtPctSafe(2.0)).toBe("+2%");
    expect(fmtPctSafe(-10, 0)).toBe("−10%");
    expect(fmtPctSafe(NaN)).toBe("—");
  });
});

describe("fmtUSD / fmtPct (compact + NaN fixes folded into format.ts)", () => {
  it("compact rounds before choosing the unit", () => {
    expect(fmtUSD(9_999, { compact: true })).toBe("$10K");
    expect(fmtUSD(999_999, { compact: true })).toBe("$1.0M");
    expect(fmtUSD(5_300, { compact: true })).toBe("$5.3K");
    expect(fmtUSD(1_000, { compact: true })).toBe("$1.0K");
    expect(fmtUSDCompact(1_000)).toBe("$1K");
    expect(fmtUSD(-13_000, { compact: true })).toBe("−$13K");
  });
  it("never prints NaN", () => {
    expect(fmtUSD(NaN)).toBe("—");
    expect(fmtUSD(Infinity, { compact: true })).toBe("—");
    expect(fmtPct(NaN)).toBe("—");
  });
  it("keeps integer zeros in percentages", () => {
    expect(fmtPct(100, 0)).toBe("+100%");
    expect(fmtPct(2.5)).toBe("+2.5%");
    expect(fmtPct(0)).toBe("0%");
  });
});
