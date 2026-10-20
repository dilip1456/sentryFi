import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { localISODate, localISOMonth, todayISO, parseISODate, addDaysISO, daysBetweenISO, fmtShortDate, fmtDayHeading } from "@/lib/dates";

// Node honors runtime changes to process.env.TZ, so each block pins a zone
// where the old `toISOString().slice(0,10)` approach gave the wrong day.
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const withTZ = (tz: string, fn: () => void) => {
  describe(`in ${tz}`, () => {
    let prev: string | undefined;
    beforeAll(() => { prev = env.TZ; env.TZ = tz; });
    afterAll(() => { env.TZ = prev; });
    fn();
  });
};

withTZ("America/New_York", () => {
  it("reports the local day late in the evening (UTC is already tomorrow)", () => {
    const evening = new Date(2026, 9, 20, 21, 30); // Oct 20, 9:30pm EDT = Oct 21 01:30Z
    expect(evening.toISOString().slice(0, 10)).toBe("2026-10-21"); // the old bug
    expect(localISODate(evening)).toBe("2026-10-20");
    expect(todayISO(evening)).toBe("2026-10-20");
  });

  it("formats Today/Yesterday from the local calendar, not UTC", () => {
    const evening = new Date(2026, 9, 20, 23, 59);
    expect(fmtDayHeading("2026-10-20", evening)).toBe("Today");
    expect(fmtDayHeading("2026-10-19", evening)).toBe("Yesterday");
    expect(fmtDayHeading("2026-10-21", evening)).toBe("Wed, Oct 21");
  });

  it("parses YYYY-MM-DD as local midnight", () => {
    const d = parseISODate("2026-10-01");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 1, 0]);
  });

  it("adds days across DST and month/year boundaries", () => {
    expect(addDaysISO("2026-11-01", 1)).toBe("2026-11-02"); // DST ends Nov 1 2026
    expect(addDaysISO("2026-03-08", 1)).toBe("2026-03-09"); // DST starts Mar 8 2026
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysISO("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetweenISO("2026-10-01", "2026-11-15")).toBe(45);
  });
});

withTZ("Asia/Kolkata", () => {
  it("keeps month boundaries on the local calendar east of UTC", () => {
    const firstOfMonth = new Date(2026, 9, 1); // local midnight = Sep 30 18:30Z
    expect(firstOfMonth.toISOString().slice(0, 10)).toBe("2026-09-30"); // the old bug
    expect(localISODate(firstOfMonth)).toBe("2026-10-01");
    expect(localISOMonth(firstOfMonth)).toBe("2026-10");
    expect(localISODate(new Date(2026, 10, 0))).toBe("2026-10-31");
  });
});

describe("fmtShortDate", () => {
  const now = new Date(2026, 9, 20, 12);
  it("omits the year for the current year", () => {
    expect(fmtShortDate("2026-10-18", now)).toBe("Oct 18");
  });
  it("includes the year for other years", () => {
    expect(fmtShortDate("2025-12-31", now)).toBe("Dec 31, 2025");
  });
});
