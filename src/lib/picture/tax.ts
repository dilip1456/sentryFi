/**
 * Tax math for My Financial Picture (Tax Savers, Tax Bracket, what-if).
 * Mirrors the approved prototype (review/financial-picture/fp.js `taxes()` / `saved()`):
 *   taxable = gross − HSA − 401(k) − standard deduction
 *   FICA    = on (gross − HSA)   (payroll HSA skips FICA; 401(k) does not)
 * Figures come from the year-keyed table in src/lib/tax-tables.ts.
 */
import { taxTable, CURRENT_TAX_YEAR, type FilingStatus, type TaxYearTable } from "@/lib/tax-tables";

export type { FilingStatus } from "@/lib/tax-tables";

export interface TaxInput {
  /** Annual gross wages. */
  gross: number;
  /** Annual pre-tax HSA (payroll). */
  hsa?: number;
  /** Annual pre-tax 401(k). */
  k401?: number;
  filing?: FilingStatus;
  year?: number;
}

export interface TaxSnapshot {
  taxable: number;
  fed: number;
  fica: number;
  total: number;
  /** Index of the bracket the last taxable dollar falls in. */
  idx: number;
  rate: number;
  /** Dollars of taxable income until the next bracket (null in the top bracket). */
  toNext: number | null;
  nextRate: number | null;
  standardDeduction: number;
}

const clamp0 = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function federalTax(taxable: number, filing: FilingStatus = "single", table: TaxYearTable = taxTable()): number {
  let owed = 0, lower = 0;
  for (const b of table.brackets[filing]) {
    if (taxable <= lower) break;
    owed += (Math.min(taxable, b.upTo) - lower) * b.rate;
    lower = b.upTo;
  }
  return owed;
}

export function fica(wages: number, table: TaxYearTable = taxTable()): number {
  const w = clamp0(wages);
  return Math.min(w, table.ssWageBase) * table.ssRate + w * table.medicareRate;
}

export function taxSnapshot({ gross, hsa = 0, k401 = 0, filing = "single", year = CURRENT_TAX_YEAR }: TaxInput): TaxSnapshot {
  const t = taxTable(year);
  const std = t.standardDeduction[filing];
  const taxable = clamp0(clamp0(gross) - clamp0(hsa) - clamp0(k401) - std);
  const fed = federalTax(taxable, filing, t);
  const f = fica(clamp0(gross) - clamp0(hsa), t);
  const bs = t.brackets[filing];
  let idx = bs.findIndex(b => taxable <= b.upTo);
  if (idx < 0) idx = bs.length - 1;
  const top = idx === bs.length - 1;
  return {
    taxable, fed, fica: f, total: fed + f, idx, rate: bs[idx].rate,
    toNext: top ? null : bs[idx].upTo - taxable,
    nextRate: top ? null : bs[idx + 1].rate,
    standardDeduction: std,
  };
}

/** Federal + FICA saved by these pre-tax contributions vs. none at all. */
export function taxSaved(gross: number, hsa: number, k401: number, filing: FilingStatus = "single", year = CURRENT_TAX_YEAR): number {
  const none = taxSnapshot({ gross, filing, year });
  const withThese = taxSnapshot({ gross, hsa, k401, filing, year });
  return none.total - withThese.total;
}

export interface TaxSaverNumbers {
  /** Saved per year by what you put in now. */
  now: number;
  /** Extra per year if both accounts were maxed. */
  more: number;
  hsaSaves: number;
  k401Saves: number;
  hsaRoom: number;
  k401Room: number;
  hsaLimit: number;
  k401Limit: number;
}

export function taxSaverNumbers(gross: number, hsa: number, k401: number, filing: FilingStatus = "single", year = CURRENT_TAX_YEAR): TaxSaverNumbers {
  const t = taxTable(year);
  const hsaLimit = t.hsaLimit.self, k401Limit = t.k401Limit;
  const h = Math.min(clamp0(hsa), hsaLimit), k = Math.min(clamp0(k401), k401Limit);
  const now = taxSaved(gross, h, k, filing, year);
  const maxed = taxSaved(gross, hsaLimit, k401Limit, filing, year);
  return {
    now, more: Math.max(0, maxed - now),
    hsaSaves: taxSaved(gross, h, 0, filing, year),
    k401Saves: taxSaved(gross, 0, k, filing, year),
    hsaRoom: hsaLimit - h, k401Room: k401Limit - k,
    hsaLimit, k401Limit,
  };
}

export type MatchAnswer = "yes" | "no" | "unsure";
export interface EmployerMatch { answer?: MatchAnswer; /** Match rate, % of what you put in (default 50). */ pct?: number; /** Matched up to this % of pay (default 6). */ upToPct?: number }

export interface MatchStatus {
  answered: boolean;
  answer: MatchAnswer | null;
  pct: number;
  upToPct: number;
  /** Your 401(k) as a % of gross pay. */
  yourPct: number;
  full: boolean;
  /** Match dollars per year you get now. */
  getting: number;
  /** Match dollars per year if you put in at least upToPct. */
  worth: number;
  missing: number;
}

export function matchStatus(m: EmployerMatch | undefined, gross: number, k401: number): MatchStatus {
  const pct = m?.pct ?? 50, upToPct = m?.upToPct ?? 6;
  const g = clamp0(gross);
  const yourPct = g > 0 ? (clamp0(k401) / g) * 100 : 0;
  const worth = (g * upToPct / 100) * (pct / 100);
  const getting = (g * Math.min(yourPct, upToPct) / 100) * (pct / 100);
  const answer = m?.answer ?? null;
  return {
    answered: !!answer, answer, pct, upToPct, yourPct,
    full: answer === "yes" && yourPct + 1e-9 >= upToPct,
    getting: answer === "yes" ? getting : 0,
    worth: answer === "yes" ? worth : 0,
    missing: answer === "yes" ? Math.max(0, worth - getting) : 0,
  };
}

export interface BracketRow { lo: number; hi: number; rate: number; you: boolean }
export function bracketRows(filing: FilingStatus, idx: number, year = CURRENT_TAX_YEAR): BracketRow[] {
  const bs = taxTable(year).brackets[filing];
  return bs.map((b, i) => ({ lo: i === 0 ? 0 : bs[i - 1].upTo + 1, hi: b.upTo, rate: b.rate, you: i === idx }));
}
