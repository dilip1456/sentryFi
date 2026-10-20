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

  it("day arithmetic is timezone-independent", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09"); // DST change day
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(weekday("2026-10-20")).toBe(2); // Tuesday
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("knows observed federal holidays", () => {
    const h = usFederalHolidays(2026);
    expect(h.has("2026-07-03")).toBe(true); // July 4 is a Saturday
    expect(h.has("2026-09-07")).toBe(true); // Labor Day
    expect(h.has("2026-11-26")).toBe(true); // Thanksgiving
    expect(usFederalHolidays(2021).has("2021-12-31")).toBe(true); // NY 2022 on Saturday
    expect(isBusinessDay("2026-09-07")).toBe(false);
    expect(isBusinessDay("2026-09-08")).toBe(true);
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

  it("finds the next due date", () => {
    const n = nextIrsEstimatedDue("2026-10-20");
    expect(n.due).toBe("2027-01-15");
    expect(n.taxYear).toBe(2026);
    expect(n.quarter).toBe(4);
    expect(nextIrsEstimatedDue("2026-06-15").due).toBe("2026-06-15");
  });
});
