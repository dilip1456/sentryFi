/**
 * Risk Profile: the person's own answer (never inferred), plus a gauge
 * position and a plain note comparing it with how their savings actually sit.
 */
import type { SavingsBreakdown } from "./savings-breakdown";

export type RiskLevel = "conservative" | "moderate" | "aggressive";

export const RISK_LEVELS: { key: RiskLevel; label: string; desc: string }[] = [
  { key: "conservative", label: "Conservative", desc: "You prefer keeping money safe over growing it fast." },
  { key: "moderate", label: "Moderate", desc: "You balance growth and stability, with a moderate tolerance for ups and downs." },
  { key: "aggressive", label: "Aggressive", desc: "You're comfortable with big swings for more long-term growth." },
];

/** Needle position 0–1 along the gauge (thirds, centered). */
export function riskGaugeValue(level: RiskLevel | undefined | null): number | null {
  if (!level) return null;
  return { conservative: 1 / 6, moderate: 0.5, aggressive: 5 / 6 }[level];
}

export interface RiskNote {
  cashPct: number;
  text: string;
  /** Set when how the money is held disagrees with the stated comfort level. */
  mismatch: "more_cautious" | "more_growth" | null;
}

export function riskNote(level: RiskLevel | undefined | null, b: Pick<SavingsBreakdown, "cashPct" | "total">): RiskNote {
  const cashPct = b.cashPct;
  const base = b.total > 0 ? `${cashPct}% of your savings is cash you can use any time.` : "No savings balances found yet.";
  if (!level || b.total <= 0) return { cashPct, text: base, mismatch: null };
  if (level === "aggressive" && cashPct > 50)
    return { cashPct, text: `${base} That's more cautious than "Aggressive" suggests.`, mismatch: "more_cautious" };
  if (level === "conservative" && cashPct < 20)
    return { cashPct, text: `${base} Most of it is invested, which can swing more than "Conservative" suggests.`, mismatch: "more_growth" };
  return { cashPct, text: base, mismatch: null };
}
