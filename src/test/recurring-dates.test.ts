import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  irsEstimatedDueDates,
  isBusinessDay,
  nextIrsEstimatedDue,
  shiftToBusinessDay,
  todayLocal,
  usFederalHolidays,
  weekday,
} from "@/lib/recurring/dates";

describe("recurring/dates: local calendar math", () => {
  it("todayLocal uses the user's zone, not UTC", () => {
    // 01:30 UTC on Oct 21 is still 9:30pm Oct 20 in New York.
    const now = new Date("2026-10-21T01:30:00Z");
    expect(todayLocal("America/New_York", now)).toBe("2026-10-20");
    expect(now.toISOString().slice(0, 10)).toBe("2026-10-21"); // the bug we avoid
    expect(todayLocal("UTC", now)).toBe("2026-10-21");
  });

  it("todayLocal around midnight and DST transitions (America/New_York)", () => {
    expect(todayLocal(undefined, new Date("2026-10-21T03:59:00Z"))).toBe("2026-10-20"); // 23:59 EDT
    expect(todayLocal(undefined, new Date("2026-10-21T04:00:00Z"))).toBe("2026-10-21");
    expect(todayLocal(undefined, new Date("2026-03-08T04:59:00Z"))).toBe("2026-03-07"); // 23:59 EST
    expect(todayLocal(undefined, new Date("2026-03-08T07:30:00Z"))).toBe("2026-03-08"); // 03:30 EDT
    expect(todayLocal(undefined, new Date("2026-11-02T04:30:00Z"))).toBe("2026-11-01"); // 23:30 EST
    expect(todayLocal(undefined, new Date("2027-01-01T04:59:00Z"))).toBe("2026-12-31");
  });

  it("day arithmetic is timezone-independent", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09"); // DST change day
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(weekday("2026-10-20")).toBe(2); // Tuesday
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("knows Federal Reserve / bank holidays", () => {
    const h = usFederalHolidays(2026);
    expect(h.has("2026-09-07")).toBe(true); // Labor Day
    expect(h.has("2026-11-26")).toBe(true); // Thanksgiving
    expect(isBusinessDay("2026-09-07")).toBe(false);
    expect(isBusinessDay("2026-09-08")).toBe(true);
    // Sunday holiday → observed Monday (Juneteenth 2022 was a Sunday).
    expect(isBusinessDay("2022-06-20")).toBe(false);
    expect(isBusinessDay("2023-01-02")).toBe(false); // New Year's Day 2023 was a Sunday
  });

  // Regression (QA on PR #6): the Fed and banks are OPEN the Friday before a Saturday holiday.
  it("does not observe Saturday holidays on the Friday before (bank calendar)", () => {
    expect(isBusinessDay("2026-07-03")).toBe(true); // Jul 4 2026 is a Saturday
    expect(isBusinessDay("2027-12-31")).toBe(true); // Jan 1 2028 is a Saturday
    expect(isBusinessDay("2021-12-31")).toBe(true); // Jan 1 2022 was a Saturday
    expect(usFederalHolidays(2026).has("2026-07-03")).toBe(false);
    expect(shiftToBusinessDay("2027-12-31", "before")).toBe("2027-12-31");
    expect(shiftToBusinessDay("2026-07-04", "before")).toBe("2026-07-03");
    expect(shiftToBusinessDay("2026-07-04", "after")).toBe("2026-07-06");
  });

  it("the IRS calendar does observe Saturday holidays on Friday (DC legal holidays)", () => {
    const irs = usFederalHolidays(2026, "irs");
    expect(irs.has("2026-07-03")).toBe(true);
    expect(irs.has("2026-04-16")).toBe(true); // DC Emancipation Day (Thursday)
    expect(usFederalHolidays(2026).has("2026-04-16")).toBe(false); // not a bank holiday
    expect(usFederalHolidays(2027, "irs").has("2027-12-31")).toBe(true);
    expect(isBusinessDay("2026-07-03", { calendar: "irs" })).toBe(false);
  });

  it("shifts weekend/holiday dates before (payroll) or after (bills)", () => {
    expect(shiftToBusinessDay("2026-11-01", "before")).toBe("2026-10-30"); // Sunday → Friday
    expect(shiftToBusinessDay("2026-11-01", "after")).toBe("2026-11-02");
    expect(shiftToBusinessDay("2026-01-01", "before")).toBe("2025-12-31"); // New Year's Day
    expect(shiftToBusinessDay("2026-09-05", "after")).toBe("2026-09-08"); // Sat → past Labor Day
    expect(shiftToBusinessDay("2026-09-05", "none")).toBe("2026-09-05");
  });
});

describe("recurring/dates: IRS estimated tax calendar", () => {
  it("lists Apr 15, Jun 15, Sep 15 and Jan 15 of the next year", () => {
    const d = irsEstimatedDueDates(2026).map(x => x.due);
    expect(d).toEqual(["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"]);
  });

  it("shifts to the next business day for weekends and holidays", () => {
    expect(irsEstimatedDueDates(2024).map(x => x.due)).toEqual(["2024-04-15", "2024-06-17", "2024-09-16", "2025-01-15"]);
    expect(irsEstimatedDueDates(2025).map(x => x.due)).toEqual(["2025-04-15", "2025-06-16", "2025-09-15", "2026-01-15"]);
    // Jan 15 2023 is a Sunday and Jan 16 is MLK Day → Jan 17.
    expect(irsEstimatedDueDates(2022)[3].due).toBe("2023-01-17");
  });

  it("honours DC Emancipation Day for the April date", () => {
    // 2022: Emancipation Day (Sat Apr 16) observed Fri Apr 15 → Apr 18.
    expect(irsEstimatedDueDates(2022)[0].due).toBe("2022-04-18");
    // 2017 / 2028: Apr 15 Sat, Emancipation Day observed Mon Apr 17 → Tue Apr 18.
    expect(irsEstimatedDueDates(2017)[0].due).toBe("2017-04-18");
    expect(irsEstimatedDueDates(2028)[0].due).toBe("2028-04-18");
  });

  it("matches published 1040-ES due dates (QA table)", () => {
    const m = (y: number) => irsEstimatedDueDates(y).map(d => d.due);
    expect(m(2022)).toEqual(["2022-04-18", "2022-06-15", "2022-09-15", "2023-01-17"]);
    expect(m(2023)).toEqual(["2023-04-18", "2023-06-15", "2023-09-15", "2024-01-16"]);
    expect(m(2024)).toEqual(["2024-04-15", "2024-06-17", "2024-09-16", "2025-01-15"]);
    expect(m(2025)).toEqual(["2025-04-15", "2025-06-16", "2025-09-15", "2026-01-15"]);
    expect(m(2026)).toEqual(["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"]);
    expect(m(2028)[0]).toBe("2028-04-18");
    expect(m(2028)[3]).toBe("2029-01-16"); // Jan 15 2029 is MLK Day
  });

  it("finds the next due date", () => {
    const n = nextIrsEstimatedDue("2026-10-20");
    expect(n.due).toBe("2027-01-15");
    expect(n.taxYear).toBe(2026);
    expect(n.quarter).toBe(4);
    expect(nextIrsEstimatedDue("2026-06-15").due).toBe("2026-06-15");
  });
});
