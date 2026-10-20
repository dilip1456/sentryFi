import { describe, it, expect } from "vitest";
import { fmtTxnAmount, isMoneyIn, txnAmountClass } from "@/lib/format";

// Plaid convention: positive = money out (purchase), negative = money in.
describe("fmtTxnAmount", () => {
  it("shows money out plain", () => {
    expect(fmtTxnAmount(86.42)).toBe("$86.42");
    expect(fmtTxnAmount("128")).toBe("$128");
  });
  it("shows money in with a plus, never a minus", () => {
    expect(fmtTxnAmount(-5240)).toBe("+$5,240");
    expect(fmtTxnAmount("-12.5")).toBe("+$12.50");
    expect(fmtTxnAmount(-5240)).not.toContain("−");
  });
  it("supports forced cents", () => {
    expect(fmtTxnAmount(86, { cents: true })).toBe("$86.00");
    expect(fmtTxnAmount(-86, { cents: true })).toBe("+$86.00");
  });
  it("treats zero and invalid input as $0", () => {
    expect(fmtTxnAmount(0)).toBe("$0");
    expect(fmtTxnAmount(-0)).toBe("$0");
    expect(fmtTxnAmount("abc")).toBe("$0");
  });
});

describe("isMoneyIn / txnAmountClass", () => {
  it("classifies by Plaid sign", () => {
    expect(isMoneyIn(-1)).toBe(true);
    expect(isMoneyIn(1)).toBe(false);
    expect(txnAmountClass(-1)).toBe("text-positive");
    expect(txnAmountClass(1)).toBe("text-foreground");
  });
});
