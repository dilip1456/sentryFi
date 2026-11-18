/**
 * How much to plan for each time a recurring item comes around. Planning
 * prepares for the worst case: bills use the higher of their typical and
 * recent amounts, pay uses the lower. Used by every planning number (Picture
 * rows and totals, set-aside / sinking funds, allocation, the Timeline
 * rundown's shortfall check). NOT the price-change alert baseline: alerts
 * compare against the stable prior median (`priceChange(...).prior`).
 *
 * Rules (amounts are positive magnitudes, charges in the last 12 months,
 * same-day charges summed as one bill):
 *  1. A user-set expected amount always wins.
 *  2. Income: min(12-month median, average of the last 3), so pay isn't overstated.
 *  3. Outflows: max of
 *     - the 12-month median,
 *     - the average of the last 3 charges,
 *     - the latest charge, when a price change is detected (below),
 *     - for gas / electric (and other seasonal utilities) with variable
 *       amounts and 6+ charges: the high-season average, i.e. the mean of the
 *       3 highest charges in the last 12 months (one peak quarter of bills).
 *
 * Price change: the latest charge differs from the median of the earlier
 * charges (latest excluded) by more than max(15%, $10), and the earlier
 * history is stable (3+ charges, CV < 8%). Kept here, self-contained, so it
 * doesn't depend on edits to amount.ts.
 * Pure, no I/O.
 */
import { addDays, type ISODate } from "./dates";
import type { RecurringSeries } from "./detect";

export interface Charge { date: ISODate; amount: number }

export interface PlanningInput {
  direction: "inflow" | "outflow";
  /** Charges (any order); amounts' sign is ignored. */
  charges: readonly Charge[];
  /** The person's own expected amount; wins when set. */
  expectedAmount?: number | null;
  kind?: string | null;
  subtype?: string | null;
  /** Category / descriptor text, used to spot seasonal utilities. */
  text?: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const cv = (xs: readonly number[]) => { const m = mean(xs); return m ? Math.sqrt(mean(xs.map(x => (x - m) ** 2))) / m : 0; };

export const PRICE_CHANGE_PCT = 0.15;
export const PRICE_CHANGE_MIN = 10;
export const STABLE_CV = 0.08;
export const SEASONAL_RE = /\b(gas|electric|electricity|energy|power|heating|propane|heating\s*oil|pseg|firstenergy|duke\s*energy|con\s*ed|national\s*grid|peoples\s*gas|utilit(y|ies)|gas[_ ]and[_ ]electricity)\b/i;

/** Latest vs the stable prior median (`amounts` chronological). */
export function priceChange(amounts: readonly number[]): { changed: boolean; prior: number; latest: number } {
  const abs = amounts.map(a => Math.abs(a));
  const latest = abs[abs.length - 1] ?? 0;
  const earlier = abs.slice(0, -1).slice(-12);
  const prior = median(earlier);
  const changed = earlier.length >= 3 && cv(earlier) < STABLE_CV && prior > 0
    && Math.abs(latest - prior) > Math.max(PRICE_CHANGE_PCT * prior, PRICE_CHANGE_MIN);
  return { changed, prior: r2(prior), latest: r2(latest) };
}

const isSeasonal = (i: PlanningInput) => i.direction === "outflow" && (i.subtype === "utility" || SEASONAL_RE.test(`${i.text ?? ""} ${i.kind ?? ""}`));

/** The amount to plan for per occurrence; null when there is nothing to go on. */
export function planningAmount(i: PlanningInput): number | null {
  if (i.expectedAmount != null && Number.isFinite(i.expectedAmount) && i.expectedAmount >= 0) return r2(i.expectedAmount);
  // Same-day charges for one payee are one bill paid in parts: sum them.
  const byDay = new Map<string, number>();
  for (const c of i.charges) if (Number.isFinite(c.amount) && c.amount !== 0) byDay.set(c.date, (byDay.get(c.date) ?? 0) + Math.abs(c.amount));
  const sorted = [...byDay].map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return null;
  const since = addDays(sorted[sorted.length - 1].date, -365);
  const year = sorted.filter(c => c.date > since).map(c => Math.abs(c.amount));
  const med = median(year);
  const last3 = mean(year.slice(-3));
  if (i.direction === "inflow") return r2(Math.min(med, last3));
  let out = Math.max(med, last3);
  const pc = priceChange(sorted.map(c => c.amount));
  if (pc.changed) out = Math.max(out, pc.latest);
  if (isSeasonal(i) && year.length >= 6 && cv(year) >= STABLE_CV) out = Math.max(out, mean([...year].sort((a, b) => b - a).slice(0, 3)));
  return r2(out);
}

/** The charges a detected series has seen (paid occurrences). */
export function seriesCharges(s: Pick<RecurringSeries, "occurrences">): Charge[] {
  return s.occurrences.filter(o => o.actualAmount != null && o.actualDate).map(o => ({ date: o.actualDate!, amount: o.actualAmount! }));
}

/** planningAmount for a detected series (null = no paid occurrences). */
export function seriesPlanningAmount(s: Pick<RecurringSeries, "occurrences" | "direction" | "kind" | "subtype" | "category" | "displayName">, expectedAmount?: number | null): number | null {
  return planningAmount({ direction: s.direction === "inflow" ? "inflow" : "outflow", charges: seriesCharges(s), expectedAmount, kind: s.kind, subtype: s.subtype, text: `${s.category ?? ""} ${s.displayName}` });
}
