/** Amount model for a recurring series (plan §3.4). Amounts are positive magnitudes. */

export interface AmountModel {
  median: number;
  min: number;
  max: number;
  latest: number;
  /** Coefficient of variation over the recent window. */
  cv: number;
  /** CV < 8%: subscriptions, rent, loan payments, salary. */
  isFixed: boolean;
  /**
   * The latest charge moved off a stable earlier price: the charges before it
   * (at least PRICE_MIN_HISTORY of them) had CV < 8%, and the latest differs
   * from their median by more than max(15%, $10). "Armstrong went from
   * $59.95 to $109.95". Judged against the EARLIER charges only, so the first
   * raised charge counts even though it makes the whole series look variable.
   * A fixed series that has settled on a new price (>5% off the median) also
   * counts. Never true for a bill whose earlier charges already varied.
   */
  priceChanged: boolean;
  /** Median of the charges before the latest one (null with no earlier charge). */
  prevTypical: number | null;
  /** latest − prevTypical (signed; 0 with no earlier charge). */
  priceDelta: number;
  /** Best prediction for the next occurrence. */
  expected: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Earlier charges needed before a price change can be called. */
export const PRICE_MIN_HISTORY = 3;
/** Earlier charges this steady (CV) count as one price. */
export const PRICE_STABLE_CV = 0.08;
/** A price change is more than this share of the earlier price… */
export const PRICE_CHANGE_PCT = 0.15;
/** …and more than this many dollars. */
export const PRICE_CHANGE_MIN = 10;

/** A move big enough to show the person: more than max(15%, $10) of the earlier price. */
export function isMaterialPriceChange(from: number, delta: number): boolean {
  return from > 0 && Math.abs(delta) > Math.max(PRICE_CHANGE_PCT * from, PRICE_CHANGE_MIN);
}

/** Coefficient of variation (population SD / mean); 0 for an empty list. */
export function coefficientOfVariation(xs: number[]): number {
  if (!xs.length) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  if (!mean) return 0;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
  return sd / mean;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** `amounts` in chronological order. */
export function amountModel(amounts: number[]): AmountModel {
  const abs = amounts.map(a => Math.abs(a));
  const recent = abs.slice(-12);
  const med = median(recent);
  const mean = recent.reduce((s, x) => s + x, 0) / (recent.length || 1);
  const sd = Math.sqrt(recent.reduce((s, x) => s + (x - mean) ** 2, 0) / (recent.length || 1));
  const cv = mean ? sd / mean : 0;
  const latest = abs[abs.length - 1] ?? 0;
  const prev = abs[abs.length - 2];
  // Latest differs >5% from the median. Only meaningful for FIXED series:
  // a variable utility bill moving from $102.50 to $110 is not a price change.
  const offMedian = med > 0 && Math.abs(latest - med) / med > 0.05;
  let expected: number;
  // A fixed series whose last two charges agree on a new price → expect the new price.
  const settledNewPrice = offMedian && prev != null && Math.abs(prev - latest) / latest <= 0.01;
  // Fixed if stable overall OR if the only variation is one step change.
  const stableAfterChange =
    settledNewPrice &&
    (() => {
      const idx = abs.findIndex((x, i) => i > 0 && Math.abs(x - abs[i - 1]) / abs[i - 1] > 0.05);
      return idx > 0 && abs.slice(idx).every(x => Math.abs(x - latest) / latest <= 0.01);
    })();
  const isFixed = cv < 0.08 || stableAfterChange;
  // Price change: latest vs the EARLIER charges (excluding the latest).
  const earlier = abs.slice(0, -1).slice(-12);
  const prevTypical = earlier.length ? median(earlier) : null;
  const priceDelta = prevTypical != null ? latest - prevTypical : 0;
  const offStablePrice =
    prevTypical != null && prevTypical > 0 &&
    earlier.length >= PRICE_MIN_HISTORY &&
    coefficientOfVariation(earlier) < PRICE_STABLE_CV &&
    isMaterialPriceChange(prevTypical, priceDelta);
  // A fixed series that settled on a new price ("Netflix $15.49 → $17.99",
  // two charges at the new price) still counts, as before.
  const priceChanged = offStablePrice || (isFixed && offMedian);
  if (isFixed) expected = settledNewPrice ? latest : med;
  else expected = median(abs.slice(-6));
  return {
    median: round2(med),
    min: round2(Math.min(...recent)),
    max: round2(Math.max(...recent)),
    latest: round2(latest),
    cv: Math.round(cv * 1000) / 1000,
    isFixed,
    priceChanged,
    prevTypical: prevTypical != null ? round2(prevTypical) : null,
    priceDelta: round2(priceDelta),
    expected: round2(expected),
  };
}

/** Does `amount` look like a payment of this series (±20%, or within the observed range for variable bills)? */
export function amountMatches(model: AmountModel, amount: number): boolean {
  const a = Math.abs(amount);
  const target = model.expected || model.median;
  if (Math.abs(a - target) <= target * 0.2) return true;
  if (!model.isFixed) return a >= model.min * 0.8 && a <= model.max * 1.2;
  return false;
}
