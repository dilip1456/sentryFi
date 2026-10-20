/**
 * Cadence schedules: generate the expected dates of a series and fit a
 * schedule to observed dates.
 *
 * A schedule produces NOMINAL dates (e.g. "the 1st", "every other Friday",
 * "Apr 15") and then shifts each onto a business day according to its
 * ShiftPolicy (payroll usually pays the business day BEFORE a weekend/holiday,
 * bills and the IRS move AFTER). Fitting tries every plausible schedule and
 * keeps the one that explains the most occurrences with the smallest error.
 */
import {
  addDays,
  daysInMonth,
  diffDays,
  irsEstimatedDueDates,
  isBusinessDay,
  parseDate,
  shiftToBusinessDay,
  toDayNum,
  fromDayNum,
  ymd,
  type ISODate,
  type ShiftPolicy,
} from "./dates";

export const CADENCES = ["weekly", "biweekly", "semimonthly", "monthly", "quarterly", "semiannual", "yearly"] as const;
export type Cadence = (typeof CADENCES)[number];

export type Schedule =
  | { cadence: "weekly" | "biweekly"; kind: "interval"; intervalDays: 7 | 14; phaseDay: ISODate; shift: ShiftPolicy }
  | { cadence: "semimonthly"; kind: "semimonthly"; anchorDays: [number, number]; shift: ShiftPolicy }
  | {
      cadence: "monthly" | "quarterly" | "semiannual" | "yearly";
      kind: "day-of-month";
      /** 1–31; 31 means "last day of the month". */
      anchorDay: number;
      monthStep: 1 | 3 | 6 | 12;
      /** A month (1–12) the series lands in, to phase quarterly/semiannual/yearly. */
      anchorMonth: number;
      shift: ShiftPolicy;
    }
  | { cadence: "quarterly"; kind: "irs-estimated"; shift: "after" };

export const CADENCE_DAYS: Record<Cadence, number> = {
  weekly: 7,
  biweekly: 14,
  semimonthly: 15,
  monthly: 30,
  quarterly: 91,
  semiannual: 182,
  yearly: 365,
};

/** How far (days) an actual posting may sit from its expected date and still count as on schedule. */
export function matchTolerance(s: Schedule): number {
  if (s.kind === "irs-estimated") return 10;
  switch (s.cadence) {
    case "weekly": return 2;
    case "biweekly": return 3;
    case "semimonthly": return 3;
    case "monthly": return 4;
    case "quarterly": return 7;
    case "semiannual": return 10;
    case "yearly": return 20;
  }
}

export interface ScheduledDate {
  nominal: ISODate;
  expected: ISODate;
  /** e.g. "2026-10-15" or "2026-Q2" for IRS estimated taxes. */
  period: string;
  label?: string;
}

function clampDay(y: number, m: number, anchor: number): ISODate {
  return ymd(y, m, Math.min(anchor, daysInMonth(y, m)));
}

function monthIndex(d: ISODate): number {
  const p = parseDate(d);
  return p.y * 12 + (p.m - 1);
}

/** Every scheduled date whose EXPECTED date lies in [from, to]. */
export function scheduleDates(s: Schedule, from: ISODate, to: ISODate, shiftOverride?: ShiftPolicy): ScheduledDate[] {
  const out: ScheduledDate[] = [];
  const shift = shiftOverride ?? s.shift;
  const push = (nominal: ISODate, period?: string, label?: string, opts?: { includeDcEmancipation?: boolean }) => {
    const expected = shiftToBusinessDay(nominal, shift, opts);
    if (expected >= from && expected <= to) out.push({ nominal, expected, period: period ?? nominal, label });
  };
  // Pad the window so shifted dates just outside it are still considered.
  const lo = addDays(from, -10);
  const hi = addDays(to, 10);

  if (s.kind === "interval") {
    const phase = toDayNum(s.phaseDay);
    const start = toDayNum(lo);
    let n = phase + Math.ceil((start - phase) / s.intervalDays) * s.intervalDays;
    for (; n <= toDayNum(hi); n += s.intervalDays) push(fromDayNum(n));
  } else if (s.kind === "semimonthly") {
    for (let mi = monthIndex(lo); mi <= monthIndex(hi); mi++) {
      const y = Math.floor(mi / 12);
      const m = (mi % 12) + 1;
      for (const a of s.anchorDays) push(clampDay(y, m, a));
    }
  } else if (s.kind === "day-of-month") {
    const phase = ((s.anchorMonth - 1) % s.monthStep + s.monthStep) % s.monthStep;
    for (let mi = monthIndex(lo); mi <= monthIndex(hi); mi++) {
      if (((mi % 12) % s.monthStep + s.monthStep) % s.monthStep !== phase) continue;
      push(clampDay(Math.floor(mi / 12), (mi % 12) + 1, s.anchorDay));
    }
  } else {
    const y0 = parseDate(lo).y - 1;
    const y1 = parseDate(hi).y;
    for (let ty = y0; ty <= y1; ty++) {
      for (const d of irsEstimatedDueDates(ty)) {
        if (d.due >= from && d.due <= to) {
          out.push({ nominal: d.nominal, expected: d.due, period: `${ty}-Q${d.quarter}`, label: `${ty} estimated tax Q${d.quarter}` });
        }
      }
    }
  }
  out.sort((a, b) => a.expected.localeCompare(b.expected));
  return out;
}

/** The first scheduled date with expected >= `from`. */
export function nextScheduled(s: Schedule, from: ISODate): ScheduledDate {
  const horizon = addDays(from, CADENCE_DAYS[s.cadence] * 2 + 40);
  const list = scheduleDates(s, from, horizon);
  if (!list.length) throw new Error("schedule produced no dates");
  return list[0];
}

// ── Fitting ──────────────────────────────────────────────────────────────────

export interface ScheduleFit {
  schedule: Schedule;
  /** Share of observed dates that landed on a scheduled date (one-to-one). */
  matched: number;
  /** Share of scheduled dates between first and last observation that were hit. */
  coverage: number;
  /** Mean |actual − expected| in days over matched dates. */
  meanError: number;
  /** Matched pairs (observed index → scheduled date). */
  assignments: Map<number, ScheduledDate>;
}

function evaluate(s: Schedule, dates: ISODate[]): ScheduleFit {
  const tol = matchTolerance(s);
  const first = dates[0];
  const last = dates[dates.length - 1];
  // Try both shift directions when fitting; keep the per-date best.
  const policies: ShiftPolicy[] = s.kind === "irs-estimated" ? ["after"] : ["before", "after"];
  const lists = policies.map(p => scheduleDates(s, addDays(first, -tol), addDays(last, tol), p));
  const merged = new Map<string, ScheduledDate[]>();
  for (const l of lists) for (const sd of l) (merged.get(sd.period) ?? merged.set(sd.period, []).get(sd.period)!).push(sd);
  const periods = [...merged.entries()].sort((a, b) => a[1][0].nominal.localeCompare(b[1][0].nominal));

  const assignments = new Map<number, ScheduledDate>();
  const usedObs = new Set<number>();
  let err = 0;
  for (const [, variants] of periods) {
    let best: { i: number; d: number; sd: ScheduledDate } | null = null;
    for (let i = 0; i < dates.length; i++) {
      if (usedObs.has(i)) continue;
      for (const sd of variants) {
        const d = Math.abs(diffDays(dates[i], sd.expected));
        if (d <= tol && (!best || d < best.d)) best = { i, d, sd };
      }
    }
    if (best) {
      usedObs.add(best.i);
      assignments.set(best.i, best.sd);
      err += best.d;
    }
  }
  const inner = periods.filter(([, v]) => v[0].nominal >= addDays(first, -tol) && v[0].nominal <= addDays(last, tol)).length;
  return {
    schedule: s,
    matched: assignments.size / dates.length,
    coverage: inner ? assignments.size / inner : 0,
    meanError: assignments.size ? err / assignments.size : Infinity,
    assignments,
  };
}

/**
 * Learn which way this payee shifts off weekends/holidays. Looks at
 * occurrences whose nominal date was a non-business day.
 */
export function learnShift(s: Schedule, dates: ISODate[], fallback: ShiftPolicy): ShiftPolicy {
  if (s.kind === "irs-estimated") return "after";
  const fit = evaluate({ ...s, shift: "none" } as Schedule, dates);
  let before = 0;
  let after = 0;
  let none = 0;
  fit.assignments.forEach((sd, i) => {
    if (isBusinessDay(sd.nominal)) return;
    const d = diffDays(dates[i], sd.nominal);
    if (d < 0) before++;
    else if (d > 0) after++;
    else none++;
  });
  if (before + after + none === 0) return fallback;
  if (none > before && none > after) return "none";
  return before >= after ? (before ? "before" : fallback) : "after";
}

function mode<T>(xs: T[]): T {
  const c = new Map<T, number>();
  let best = xs[0];
  for (const x of xs) {
    const n = (c.get(x) ?? 0) + 1;
    c.set(x, n);
    if (n > (c.get(best) ?? 0)) best = x;
  }
  return best;
}

export interface FitOptions {
  /** Allow the IRS estimated-tax calendar (tax series only). */
  allowIrs?: boolean;
  defaultShift: ShiftPolicy;
}

/** Minimum observations before a cadence is believable. */
export const MIN_OCCURRENCES: Record<Cadence, number> = {
  weekly: 4,
  biweekly: 3,
  semimonthly: 4,
  monthly: 3,
  quarterly: 3,
  semiannual: 2,
  yearly: 2,
};

const CADENCE_ORDER: Cadence[] = ["monthly", "semimonthly", "biweekly", "weekly", "quarterly", "yearly", "semiannual"];

/** Candidate schedules for a sorted list of dates. */
function candidates(dates: ISODate[], opts: FitOptions): Schedule[] {
  const shift = opts.defaultShift;
  const out: Schedule[] = [];
  const doms = dates.map(d => parseDate(d).d);
  const distinctDoms = [...new Set(doms)];
  const last = dates[dates.length - 1];

  for (const intervalDays of [7, 14] as const) {
    const phases = dates.map(d => ((toDayNum(d) % intervalDays) + intervalDays) % intervalDays);
    const ph = mode(phases);
    const lastN = toDayNum(last);
    const phaseDay = fromDayNum(lastN - ((((lastN - ph) % intervalDays) + intervalDays) % intervalDays));
    out.push({ cadence: intervalDays === 7 ? "weekly" : "biweekly", kind: "interval", intervalDays, phaseDay, shift });
  }

  const pairs = new Set<string>(["1,15", "15,31"]);
  for (const a of distinctDoms) for (const b of distinctDoms) if (b - a >= 12 && b - a <= 18) pairs.add(`${a},${b}`);
  for (const p of pairs) {
    const [a, b] = p.split(",").map(Number) as [number, number];
    out.push({ cadence: "semimonthly", kind: "semimonthly", anchorDays: [a, b], shift });
  }

  const anchorDays = new Set<number>([...distinctDoms, 1, 31]);
  const steps: [Cadence, 1 | 3 | 6 | 12][] = [["monthly", 1], ["quarterly", 3], ["semiannual", 6], ["yearly", 12]];
  for (const [cadence, monthStep] of steps) {
    const anchorMonth = mode(dates.map(d => parseDate(d).m));
    for (const anchorDay of anchorDays) {
      out.push({ cadence, kind: "day-of-month", anchorDay, monthStep, anchorMonth, shift } as Schedule);
    }
  }
  if (opts.allowIrs) out.push({ cadence: "quarterly", kind: "irs-estimated", shift: "after" });
  return out;
}

/**
 * Pick the schedule that best explains `dates` (sorted ascending, ≥2 items).
 * Requires ≥75% of observations on schedule and ≥60% of scheduled periods hit
 * (so an occasional skipped month is fine, but a weekly fit on biweekly data
 * is rejected).
 */
export function fitSchedule(dates: ISODate[], opts: FitOptions): ScheduleFit | null {
  if (dates.length < 2) return null;
  const fits = candidates(dates, opts)
    .map(s => evaluate(s, dates))
    .filter(f => {
      const min = f.schedule.kind === "irs-estimated" ? 2 : MIN_OCCURRENCES[f.schedule.cadence];
      return f.assignments.size >= min && f.matched >= 0.75 && f.coverage >= 0.6;
    });
  if (!fits.length) return null;
  fits.sort((a, b) => {
    const sa = a.matched * a.coverage;
    const sb = b.matched * b.coverage;
    if (Math.abs(sa - sb) > 1e-9) return sb - sa;
    if (Math.abs(a.meanError - b.meanError) > 0.25) return a.meanError - b.meanError;
    // IRS calendar beats a generic quarterly fit for tax series; then simpler cadences first.
    if (a.schedule.kind === "irs-estimated" !== (b.schedule.kind === "irs-estimated")) return a.schedule.kind === "irs-estimated" ? -1 : 1;
    return CADENCE_ORDER.indexOf(a.schedule.cadence) - CADENCE_ORDER.indexOf(b.schedule.cadence);
  });
  const best = fits[0];
  const shift = learnShift(best.schedule, dates, opts.defaultShift);
  const schedule = best.schedule.kind === "irs-estimated" ? best.schedule : ({ ...best.schedule, shift } as Schedule);
  return { ...evaluate(schedule, dates), schedule };
}

/** Schedule for a single known-yearly charge (e.g. annual renewal, property tax). */
export function yearlyFromSingle(date: ISODate, shift: ShiftPolicy): Schedule {
  const p = parseDate(date);
  return { cadence: "yearly", kind: "day-of-month", anchorDay: p.d, monthStep: 12, anchorMonth: p.m, shift };
}

