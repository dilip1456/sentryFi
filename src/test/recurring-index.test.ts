/**
 * `@/lib/recurring` is one entry point for the Phase 3 recurring module and
 * PR #8's Spending cadence helpers (src/lib/recurring/spending-cadence.ts,
 * formerly src/lib/recurring.ts). Guard that both are exported and that no
 * name is shadowed or silently dropped by `export *`.
 */
import { describe, expect, it } from "vitest";
import * as all from "@/lib/recurring";
import * as spending from "@/lib/recurring/spending-cadence";
import * as classifier from "@/lib/recurring/classifier";
import * as dates from "@/lib/recurring/dates";
import * as amount from "@/lib/recurring/amount";
import * as schedule from "@/lib/recurring/schedule";
import * as detect from "@/lib/recurring/detect";
import * as rows from "@/lib/recurring/rows";
import * as patterns from "@/lib/recurring/patterns";
import * as shared from "@/lib/recurring/shared-classifier";

describe("@/lib/recurring entry point", () => {
  it("re-exports every PR #8 spending-cadence export, identical", () => {
    const names = Object.keys(spending);
    expect(names.sort()).toEqual([
      "RECURRING_EXCLUDED_CATEGORIES", "RECURRING_OVERRIDE_KEYWORDS", "averageGapDays",
      "classifyRecurrenceFrequency", "isNonBillRecurringCandidate", "recurringFrequencyFor",
    ]);
    for (const n of names) expect((all as Record<string, unknown>)[n]).toBe((spending as Record<string, unknown>)[n]);
  });

  it("no export name is shared between spending-cadence and the Phase 3 modules", () => {
    const ours = new Set([classifier, dates, amount, schedule, detect, rows, patterns, shared].flatMap(m => Object.keys(m)));
    expect(Object.keys(spending).filter(n => ours.has(n))).toEqual([]);
  });

  it("still exposes the Phase 3 API", () => {
    for (const n of ["detectRecurringSeries", "createSharedClassifier", "toObligationLink", "readObligationSchedule", "irsEstimatedDueDates", "CADENCES"]) {
      expect(typeof (all as Record<string, unknown>)[n]).not.toBe("undefined");
    }
  });
});
