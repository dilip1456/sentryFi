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
  /** Fixed-amount series only: latest differs >5% from the median (e.g. "Netflix went up $2"). Always false for variable bills. */
  priceChanged: boolean;
  /** Best prediction for the next occurrence. */
  expected: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

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
  const priceChanged = isFixed && offMedian;
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
