import { describe, it, expect } from "vitest";
import { fmtShortDate, fmtDayDate, fmtRelativeDay, fmtTimeAgo, toLocalDate } from "@/lib/format-date";

const now = new Date(2026, 9, 20, 12, 0, 0); // Oct 20 2026 local

describe("format-date", () => {
  it("short dates", () => {
    expect(fmtShortDate("2026-10-24", now)).toBe("Oct 24");
    expect(fmtShortDate("2025-12-02", now)).toBe("Dec 2, 2025");
    expect(fmtShortDate(null, now)).toBe("—");
    expect(fmtShortDate("garbage", now)).toBe("—");
  });
  it("reads YYYY-MM-DD as a local date (no off-by-one)", () => {
    expect(toLocalDate("2026-10-01")!.getDate()).toBe(1);
  });
  it("day dates", () => { expect(fmtDayDate("2026-10-15", now)).toBe("Thu, Oct 15"); });
  it("relative days", () => {
    expect(fmtRelativeDay("2026-10-20", now)).toBe("Today");
    expect(fmtRelativeDay("2026-10-21", now)).toBe("Tomorrow");
    expect(fmtRelativeDay("2026-10-19", now)).toBe("Yesterday");
    expect(fmtRelativeDay("2026-10-30", now)).toBe("Oct 30");
  });
  it("time ago", () => {
    expect(fmtTimeAgo(new Date(now.getTime() - 30_000), now)).toBe("Just now");
    expect(fmtTimeAgo(new Date(now.getTime() - 5 * 60_000), now)).toBe("5m ago");
    expect(fmtTimeAgo(new Date(now.getTime() - 3 * 3600_000), now)).toBe("3h ago");
    expect(fmtTimeAgo(new Date(2026, 9, 19, 9), now)).toBe("Yesterday");
    expect(fmtTimeAgo(new Date(2026, 9, 2, 9), now)).toBe("Oct 2");
  });
});
