/**
 * Format a USD amount for display.
 *
 * opts.compact  — use compact notation ($42K, $1.2M). Fractions are suppressed
 *                 for amounts ≥ $10 K so you get "$485K" not "$485.2K".
 * opts.cents    — always show two decimal places (useful for transaction rows).
 * opts.signed   — prefix with + or − (for change indicators).
 */
export const fmtUSD = (
  n: number,
  opts?: { signed?: boolean; compact?: boolean; cents?: boolean },
): string => {
  const abs = Math.abs(n);

  let formatted: string;

  if (opts?.compact && abs >= 1_000_000) {
    // Manual compact for $1M+ — Intl notation:'compact' not supported on all Android WebViews
    const m = abs / 1_000_000;
    const str = m >= 10 ? m.toFixed(0) : m.toFixed(1);
    formatted = `$${str}M`;
  } else if (opts?.compact && abs >= 1_000) {
    const k = abs / 1_000;
    const str = k >= 10 ? k.toFixed(0) : k.toFixed(1);
    formatted = `$${str}K`;
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

/**
 * Format a percentage.
 * Trailing zeros are suppressed: 2.50% → "2.5%", 2.00% → "2%".
 */
export const fmtPct = (n: number, digits = 1): string => {
  const str = Math.abs(n).toFixed(digits).replace(/\.?0+$/, "");
  return (n > 0 ? "+" : n < 0 ? "−" : "") + str + "%";
};
