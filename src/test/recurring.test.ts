import { describe, it, expect } from "vitest";
import { recurringFrequencyFor, classifyRecurrenceFrequency } from "@/lib/recurring";

describe("recurringFrequencyFor", () => {
  it("classifies a monthly bill", () => {
    expect(recurringFrequencyFor(["2026-07-15", "2026-08-15", "2026-09-15", "2026-10-15"], "Bills & Utilities", "Con Edison")).toBe("Monthly");
  });
  it("never labels discretionary spend (e.g. groceries) as recurring", () => {
    expect(recurringFrequencyFor(["2026-04-01", "2026-07-01", "2026-10-01"], "Groceries", "Whole Foods")).toBeNull();
  });
  it("still allows known subscriptions in discretionary categories", () => {
    expect(recurringFrequencyFor(["2026-08-03", "2026-09-03", "2026-10-03"], "Entertainment", "Netflix")).toBe("Monthly");
  });
  it("needs at least two occurrences", () => {
    expect(recurringFrequencyFor(["2026-10-03"], "Bills & Utilities", "Con Edison")).toBeNull();
  });
  it("rejects irregular gaps", () => {
    expect(classifyRecurrenceFrequency(45)).toBeNull();
    expect(classifyRecurrenceFrequency(14)).toBe("Biweekly");
  });
});
