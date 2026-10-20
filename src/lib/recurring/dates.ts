/**
 * Calendar-date helpers for recurring detection.
 *
 * Every date here is a LOCAL calendar date string `YYYY-MM-DD` (what Plaid
 * returns in `date`). Arithmetic is done on integer "day numbers", computed
 * with Date.UTC purely as a calendar counter, so the result never depends on
 * the device timezone. "Today" comes from `todayLocal()`, which asks Intl for
 * the calendar date in the user's zone (default America/New_York). We never
 * call `toISOString()` on a local Date: at 9pm EDT that is already tomorrow
 * in UTC and causes off-by-one-day bugs.
 */

export type ISODate = string; // YYYY-MM-DD

export const DEFAULT_TIME_ZONE = "America/New_York";
const MS_PER_DAY = 86_400_000;

export function parseDate(d: ISODate): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) throw new Error(`Invalid date: ${d}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function ymd(y: number, m: number, d: number): ISODate {
  // Normalise overflow (e.g. month 13) through the day-number round trip.
  return fromDayNum(Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY));
}

export function toDayNum(d: ISODate): number {
  const p = parseDate(d);
  return Math.round(Date.UTC(p.y, p.m - 1, p.d) / MS_PER_DAY);
}

export function fromDayNum(n: number): ISODate {
  const dt = new Date(n * MS_PER_DAY);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + 1;
  const d = dt.getUTCDate();
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromDayNum(toDayNum(d) + n);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return toDayNum(a) - toDayNum(b);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(d: ISODate): number {
  // Day number 0 (1970-01-01) was a Thursday (4).
  return (((toDayNum(d) + 4) % 7) + 7) % 7;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Add calendar months, clamping the day (Jan 31 + 1 month → Feb 28/29). */
export function addMonths(d: ISODate, n: number, anchorDay?: number): ISODate {
  const p = parseDate(d);
  const total = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const day = Math.min(anchorDay ?? p.d, daysInMonth(y, m));
  return ymd(y, m, day);
}

/** Calendar date "today" in the given IANA zone (not UTC). */
export function todayLocal(timeZone: string = DEFAULT_TIME_ZONE, now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// ── US federal holidays (banking / payroll / IRS calendar) ──────────────────

function nthWeekday(y: number, m: number, wd: number, n: number): ISODate {
  const first = ymd(y, m, 1);
  const offset = (wd - weekday(first) + 7) % 7;
  return addDays(first, offset + (n - 1) * 7);
}

function lastWeekday(y: number, m: number, wd: number): ISODate {
  const last = ymd(y, m, daysInMonth(y, m));
  const back = (weekday(last) - wd + 7) % 7;
  return addDays(last, -back);
}

/**
 * Which holiday calendar to use.
 *
 * - `bank` (default): Federal Reserve / bank holidays. A Sunday holiday is
 *   observed the following Monday; a Saturday holiday is NOT observed, and
 *   the Fed and banks are open the Friday before (e.g. Fri 2026-07-03,
 *   Fri 2027-12-31). Used for payroll and bill posting dates.
 * - `irs`: "legal holidays" for IRS deadlines (IRC §7503 → §7701(a)(25)):
 *   DC legal holidays, which include DC Emancipation Day (Apr 16). DC
 *   observes a Saturday holiday on the Friday before and a Sunday holiday on
 *   the Monday after. That Friday is why the 2022 April deadline moved to
 *   Apr 18: Emancipation Day (Sat Apr 16) was observed Fri Apr 15.
 */
export type HolidayCalendar = "bank" | "irs";

function observedFor(d: ISODate, calendar: HolidayCalendar): ISODate | null {
  const wd = weekday(d);
  if (wd === 0) return addDays(d, 1); // Sunday → Monday (both calendars)
  if (wd === 6) return calendar === "irs" ? addDays(d, -1) : null; // Saturday: DC → Friday; Fed → none
  return d;
}

const holidayCache = new Map<string, Set<ISODate>>();

/** Observed holidays falling in calendar year `y` for the given calendar. */
export function usFederalHolidays(y: number, calendar: HolidayCalendar = "bank"): Set<ISODate> {
  const key = `${y}:${calendar}`;
  const hit = holidayCache.get(key);
  if (hit) return hit;
  const fixedDates = (yr: number) => {
    const list = [ymd(yr, 1, 1), ymd(yr, 6, 19), ymd(yr, 7, 4), ymd(yr, 11, 11), ymd(yr, 12, 25)];
    if (calendar === "irs") list.push(ymd(yr, 4, 16)); // DC Emancipation Day
    return list;
  };
  const s = new Set<ISODate>([
    nthWeekday(y, 1, 1, 3), // MLK
    nthWeekday(y, 2, 1, 3), // Presidents
    lastWeekday(y, 5, 1), // Memorial
    nthWeekday(y, 9, 1, 1), // Labor
    nthWeekday(y, 10, 1, 2), // Columbus / Indigenous Peoples'
    nthWeekday(y, 11, 4, 4), // Thanksgiving
  ]);
  // Fixed-date holidays of this year and next (Jan 1 on a Saturday is observed Dec 31 on the IRS calendar).
  for (const d of [...fixedDates(y), ...fixedDates(y + 1)]) {
    const o = observedFor(d, calendar);
    if (o && o.startsWith(`${y}-`)) s.add(o);
  }
  holidayCache.set(key, s);
  return s;
}

export interface BusinessDayOptions {
  /** Holiday calendar; defaults to `bank` (Federal Reserve). */
  calendar?: HolidayCalendar;
}

export function isBusinessDay(d: ISODate, opts: BusinessDayOptions = {}): boolean {
  const wd = weekday(d);
  if (wd === 0 || wd === 6) return false;
  return !usFederalHolidays(parseDate(d).y, opts.calendar ?? "bank").has(d);
}

export type ShiftPolicy = "none" | "before" | "after";

/** Move a nominal date onto a business day (payroll: before, bills/IRS: after). */
export function shiftToBusinessDay(d: ISODate, policy: ShiftPolicy, opts: BusinessDayOptions = {}): ISODate {
  if (policy === "none") return d;
  const step = policy === "before" ? -1 : 1;
  let cur = d;
  for (let i = 0; i < 10 && !isBusinessDay(cur, opts); i++) cur = addDays(cur, step);
  return cur;
}

// ── IRS estimated tax calendar ───────────────────────────────────────────────

export type EstimatedQuarter = 1 | 2 | 3 | 4;

export interface IrsEstimatedDue {
  taxYear: number;
  quarter: EstimatedQuarter;
  /** Statutory date before any weekend/holiday shift. */
  nominal: ISODate;
  /** Actual due date: next day that is not a Saturday, Sunday or DC legal holiday (IRC §7503). */
  due: ISODate;
}

/** Form 1040-ES due dates for a tax year: Apr 15, Jun 15, Sep 15, Jan 15 (next year). */
export function irsEstimatedDueDates(taxYear: number): IrsEstimatedDue[] {
  const nominals: [EstimatedQuarter, ISODate][] = [
    [1, ymd(taxYear, 4, 15)],
    [2, ymd(taxYear, 6, 15)],
    [3, ymd(taxYear, 9, 15)],
    [4, ymd(taxYear + 1, 1, 15)],
  ];
  return nominals.map(([quarter, nominal]) => ({
    taxYear,
    quarter,
    nominal,
    due: shiftToBusinessDay(nominal, "after", { calendar: "irs" }),
  }));
}

/** The first IRS estimated due date on/after `from` (by actual due date). */
export function nextIrsEstimatedDue(from: ISODate): IrsEstimatedDue {
  const y = parseDate(from).y;
  for (const ty of [y - 1, y, y + 1]) {
    for (const due of irsEstimatedDueDates(ty)) if (due.due >= from) return due;
  }
  throw new Error("unreachable");
}

/** The IRS due date closest to `d` (used to match payments made a bit early/late). */
export function nearestIrsEstimatedDue(d: ISODate): { due: IrsEstimatedDue; distance: number } {
  const y = parseDate(d).y;
  let best: { due: IrsEstimatedDue; distance: number } | null = null;
  for (const ty of [y - 2, y - 1, y, y + 1]) {
    for (const due of irsEstimatedDueDates(ty)) {
      const distance = Math.abs(diffDays(d, due.due));
      if (!best || distance < best.distance) best = { due, distance };
    }
  }
  return best!;
}
