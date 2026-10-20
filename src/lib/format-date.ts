/**
 * One date formatter for the whole app (kept out of src/lib/format.ts,
 * which another branch owns). Never shows raw "2026-06-22" in the UI.
 *
 *   fmtShortDate("2026-10-24")              → "Oct 24"   (same year)
 *   fmtShortDate("2025-12-02")              → "Dec 2, 2025"
 *   fmtDayDate("2026-10-15")                → "Thu, Oct 15"
 *   fmtRelativeDay("2026-10-21", today)     → "Tomorrow"
 *
 * "YYYY-MM-DD" strings are read as LOCAL calendar dates (new Date("2026-10-15")
 * is UTC midnight, which is the previous day in the Americas).
 */

export type DateInput = string | number | Date | null | undefined;

export function toLocalDate(d: DateInput): Date | null {
  if (d == null || d === "") return null;
  if (d instanceof Date) return isNaN(d.getTime()) ? null : d;
  if (typeof d === "number") { const x = new Date(d); return isNaN(x.getTime()) ? null : x; }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.trim());
  const x = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(d);
  return isNaN(x.getTime()) ? null : x;
}

const sameYear = (a: Date, now: Date) => a.getFullYear() === now.getFullYear();

/** "Oct 24", or "Dec 2, 2025" outside the current year. "—" when missing. */
export function fmtShortDate(d: DateInput, now: Date = new Date()): string {
  const x = toLocalDate(d);
  if (!x) return "—";
  return x.toLocaleDateString("en-US", sameYear(x, now)
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" });
}

/** "Thu, Oct 15" (year appended outside the current year). */
export function fmtDayDate(d: DateInput, now: Date = new Date()): string {
  const x = toLocalDate(d);
  if (!x) return "—";
  return x.toLocaleDateString("en-US", sameYear(x, now)
    ? { weekday: "short", month: "short", day: "numeric" }
    : { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** "Today" / "Tomorrow" / "Yesterday", otherwise fmtShortDate. */
export function fmtRelativeDay(d: DateInput, now: Date = new Date()): string {
  const x = toLocalDate(d);
  if (!x) return "—";
  const day = (y: Date) => new Date(y.getFullYear(), y.getMonth(), y.getDate()).getTime();
  const diff = Math.round((day(x) - day(now)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return fmtShortDate(x, now);
}

/** "Just now", "5m ago", "3h ago", "Yesterday", then "Oct 12". For timestamps. */
export function fmtTimeAgo(d: DateInput, now: Date = new Date()): string {
  const x = toLocalDate(d);
  if (!x) return "";
  const s = Math.round((now.getTime() - x.getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400 && x.getDate() === now.getDate()) return `${Math.floor(s / 3600)}h ago`;
  if (fmtRelativeDay(x, now) === "Yesterday") return "Yesterday";
  return fmtShortDate(x, now);
}
