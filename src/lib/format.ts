/** Placeholder for a missing / non-numeric value (never "$NaN"). */
export const MISSING_VALUE = "—";

// "1.0" → "1", "2.50" → "2.5"; leaves integers ("100") alone.
const trimZeros = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

/**
 * Format a USD amount for display.
 *
 * opts.compact  — compact notation ($42K, $1.2M, $3B). One decimal under 10
 *                 of a unit, none at/above 10. The value is rounded BEFORE the
 *                 unit is chosen, so $9,999 reads "$10K" (not "$10.0K") and
 *                 $999,999 reads "$1.0M" (not "$1000K"). Keeps the existing
 *                 "$1.0M" style; fmtUSDCompact below drops the ".0".
 * opts.cents    — always show two decimal places (useful for transaction rows).
 * opts.signed   — prefix with + or − (for change indicators).
 *
 * Non-finite input (NaN, undefined, Infinity) renders "—".
 */
export const fmtUSD = (
  n: number,
  opts?: { signed?: boolean; compact?: boolean; cents?: boolean; trimCompact?: boolean },
): string => {
  if (n == null || !Number.isFinite(Number(n))) return MISSING_VALUE;
  n = Number(n);
  const abs = Math.abs(n);

  let formatted: string;

  if (opts?.compact && abs >= 1_000) {
    // Manual compact; Intl notation:'compact' isn't supported on all Android WebViews.
    const units: [number, string][] = [[1_000_000_000, "B"], [1_000_000, "M"], [1_000, "K"]];
    let i = units.findIndex(([d]) => abs >= d);
    const fmt = (x: number) => {
      const one = x.toFixed(1);
      if (Number(one) >= 10) return x.toFixed(0); // 9.99 → "10", not "10.0"
      return opts.trimCompact ? trimZeros(one) : one;
    };
    let str = fmt(abs / units[i][0]);
    // Rounded up into the next unit (e.g. 999.9K → "1000"): step up.
    while (i > 0 && Number(str) >= 1000) { i--; str = fmt(abs / units[i][0]); }
    formatted = `$${str}${units[i][1]}`;
  } else {
    const hasCents = Math.round(abs * 100) % 100 !== 0;
    formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
      minimumFractionDigits: opts?.cents || hasCents ? 2 : 0,
    }).format(abs);
  }

  if (opts?.signed) return (n < 0 ? "−" : "+") + formatted;
  return (n < 0 ? "−" : "") + formatted;
};

/** Compact USD for tight UI ($1K, $42K, $1.2M, $1M): fmtUSD compact without a trailing ".0". */
export const fmtUSDCompact = (n: number, opts?: { signed?: boolean }): string =>
  fmtUSD(n, { ...opts, compact: true, trimCompact: true });

/**
 * Format a percentage.
 * Trailing zeros after the decimal point are suppressed: 2.50% → "2.5%",
 * 2.00% → "2%"; integer zeros are kept: fmtPct(100, 0) → "+100%".
 * Non-finite input renders "—".
 */
export const fmtPct = (n: number, digits = 1): string => {
  if (n == null || !Number.isFinite(Number(n))) return MISSING_VALUE;
  const str = trimZeros(Math.abs(n).toFixed(digits));
  return (n > 0 ? "+" : n < 0 ? "−" : "") + str + "%";
};

/** Alias kept for call sites written against PR #7's format-compact.ts. */
export const fmtPctSafe = fmtPct;

/**
 * Transaction amounts (Plaid sign convention: a POSITIVE amount is money
 * leaving the account, a NEGATIVE amount is money coming in).
 *
 * Shown consistently everywhere transactions are listed: money out is plain
 * ("$86.42"), money in carries an explicit plus and the positive color
 * ("+$5,240"). Never print the raw sign, which renders a paycheck as "−$5,240".
 */
export const isMoneyIn = (amount: number | string): boolean => Number(amount) < 0;

export const fmtTxnAmount = (amount: number | string, opts?: { cents?: boolean }): string => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return MISSING_VALUE;
  if (n === 0) return fmtUSD(0, opts?.cents ? { cents: true } : undefined);
  const base = fmtUSD(Math.abs(n), opts?.cents ? { cents: true } : undefined);
  return n < 0 ? `+${base}` : base;
};

/** Tailwind text-color class for a transaction amount. */
export const txnAmountClass = (amount: number | string): string =>
  isMoneyIn(amount) ? "text-positive" : "text-foreground";
