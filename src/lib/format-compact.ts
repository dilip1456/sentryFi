/**
 * Compact currency / percent formatting that fixes the rounding-boundary and
 * NaN bugs found by the QA harness (PR #5) without touching src/lib/format.ts
 * (owned by the feat/spending-ux-overhaul branch for its sign changes):
 *   $9,999   → "$10K"   (was "$10.0K")
 *   $999,999 → "$1M"    (was "$1000K")
 *   NaN      → "—"      (was "$NaN")
 *   fmtPctSafe(100, 0) → "+100%" (fmtPct gave "+1%")
 * Once format.ts is free, these can be folded back into fmtUSD/fmtPct.
 */
import { fmtUSD } from "./format";

const trim = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

export const fmtUSDCompact = (n: number, opts?: { signed?: boolean }): string => {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const abs = Math.abs(v);
  let body: string;
  if (abs < 1_000) {
    body = fmtUSD(abs);
  } else {
    // Round first, then pick the unit, so a value that rounds up crosses
    // into the next unit instead of printing "10.0K" or "1000K".
    const units: [number, string][] = [[1_000_000_000, "B"], [1_000_000, "M"], [1_000, "K"]];
    let i = units.findIndex(([d]) => abs >= d);
    const fmt = (x: number) => (x >= 10 ? x.toFixed(0) : trim(x.toFixed(1)));
    let str = fmt(abs / units[i][0]);
    while (i > 0 && Number(str) >= 1000) { i--; str = fmt(abs / units[i][0]); }
    body = `$${str}${units[i][1]}`;
  }
  if (opts?.signed) return (v < 0 ? "−" : "+") + body;
  return (v < 0 ? "−" : "") + body;
};

export const fmtPctSafe = (n: number, digits = 1): string => {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const str = trim(Math.abs(n).toFixed(digits));
  return (n > 0 ? "+" : n < 0 ? "−" : "") + str + "%";
};
