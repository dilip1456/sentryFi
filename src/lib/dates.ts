/**
 * Local-calendar date helpers.
 *
 * Transaction dates are plain "YYYY-MM-DD" calendar days. Never derive one
 * from `Date#toISOString()`: that is UTC, so after ~8pm in US time zones it
 * already reports tomorrow (and east of UTC, local midnight reports
 * yesterday), shifting "today", month boundaries and "last N days" windows.
 */

/** Local-calendar YYYY-MM-DD for a Date. */
export const localISODate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/** Local-calendar YYYY-MM for a Date. */
export const localISOMonth = (d: Date): string => localISODate(d).slice(0, 7);

/** Today's local calendar date as YYYY-MM-DD. */
export const todayISO = (now: Date = new Date()): string => localISODate(now);

/** Parses YYYY-MM-DD as LOCAL midnight (unlike `new Date("YYYY-MM-DD")`, which is UTC). */
export const parseISODate = (iso: string): Date => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

/** YYYY-MM-DD shifted by `days` calendar days (DST-safe). */
export const addDaysISO = (iso: string, days: number): string => {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return localISODate(d);
};

/** Whole calendar days from `fromIso` to `toIso` (positive when `toIso` is later). */
export const daysBetweenISO = (fromIso: string, toIso: string): number =>
  Math.round((parseISODate(toIso).getTime() - parseISODate(fromIso).getTime()) / 86400000);

/** Compact date: "Oct 18", or "Oct 18, 2025" outside the current year. */
export const fmtShortDate = (iso: string, now: Date = new Date()): string => {
  const d = parseISODate(iso);
  return d.toLocaleDateString("en-US", d.getFullYear() === now.getFullYear()
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" });
};

/** Day heading: "Today", "Yesterday", or "Sun, Oct 18" (+ year when not this year). */
export const fmtDayHeading = (iso: string, now: Date = new Date()): string => {
  const today = todayISO(now);
  if (iso === today) return "Today";
  if (iso === addDaysISO(today, -1)) return "Yesterday";
  const d = parseISODate(iso);
  return d.toLocaleDateString("en-US", d.getFullYear() === now.getFullYear()
    ? { weekday: "short", month: "short", day: "numeric" }
    : { weekday: "short", month: "short", day: "numeric", year: "numeric" });
};
