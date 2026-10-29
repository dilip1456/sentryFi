/**
 * What-if sliders (Tax Savers): monthly 401(k) / HSA contributions → tax
 * saved per year, change vs. now, and change in monthly take-home.
 * take-home Δ = −(Δ401k + ΔHSA) + Δsaved / 12   (prototype fp.js whatIfOut)
 */
import { taxSaved, type FilingStatus } from "./tax";
import { taxTable, CURRENT_TAX_YEAR } from "@/lib/tax-tables";

export interface WhatIfInput {
  gross: number;
  filing?: FilingStatus;
  /** Current monthly contributions. */
  baseK401: number;
  baseHsa: number;
  /** Slider values, monthly. */
  k401: number;
  hsa: number;
  year?: number;
}

export interface WhatIfResult {
  savedYear: number;
  deltaYear: number;
  takeHomeDeltaMonthly: number;
}

export function whatIfLimits(year = CURRENT_TAX_YEAR) {
  const t = taxTable(year);
  return { k401Max: t.k401Limit / 12, hsaMax: t.hsaLimit.self / 12, k401Step: 10, hsaStep: 5 };
}

export function whatIf({ gross, filing = "single", baseK401, baseHsa, k401, hsa, year = CURRENT_TAX_YEAR }: WhatIfInput): WhatIfResult {
  const lim = whatIfLimits(year);
  const k = Math.min(Math.max(0, k401), lim.k401Max), h = Math.min(Math.max(0, hsa), lim.hsaMax);
  const bk = Math.min(Math.max(0, baseK401), lim.k401Max), bh = Math.min(Math.max(0, baseHsa), lim.hsaMax);
  const now = taxSaved(gross, bh * 12, bk * 12, filing, year);
  const savedYear = taxSaved(gross, h * 12, k * 12, filing, year);
  const deltaYear = savedYear - now;
  return { savedYear, deltaYear, takeHomeDeltaMonthly: -((k - bk) + (h - bh)) + deltaYear / 12 };
}
