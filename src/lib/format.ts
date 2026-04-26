export const fmtUSD = (n: number, opts?: { signed?: boolean; compact?: boolean }) => {
  const abs = Math.abs(n);
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: opts?.compact ? "compact" : "standard",
    maximumFractionDigits: opts?.compact ? 1 : 2,
    minimumFractionDigits: opts?.compact ? 0 : 2,
  }).format(abs);
  if (opts?.signed) return (n < 0 ? "−" : "+") + formatted;
  return (n < 0 ? "−" : "") + formatted;
};

export const fmtPct = (n: number, digits = 2) =>
  `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
