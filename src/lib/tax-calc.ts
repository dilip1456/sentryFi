/**
 * Rough, informational-only federal tax estimates used by "My Financial
 * Picture". These are NOT tax advice — no state tax tables, no credits,
 * no itemizing, no FICA additional-Medicare nuance beyond the headline
 * rate. The point is a directionally-useful "what bracket am I in" and
 * "about how much did HSA/401k save me in tax" answer built entirely from
 * inferred transaction data, not a filing-accurate calculation.
 *
 * 2026 tax year figures (IRS Rev. Proc. 2025-32, published Oct 2025):
 *   https://www.irs.gov — brackets, standard deduction, SSA wage base.
 */

export type FilingStatus = "single" | "married_joint";

interface Bracket { upTo: number; rate: number } // upTo = Infinity for the top bracket

// Taxable-income thresholds, 2026 tax year.
const BRACKETS: Record<FilingStatus, Bracket[]> = {
  single: [
    { upTo: 12_400, rate: 0.10 },
    { upTo: 50_400, rate: 0.12 },
    { upTo: 105_700, rate: 0.22 },
    { upTo: 201_775, rate: 0.24 },
    { upTo: 256_225, rate: 0.32 },
    { upTo: 640_600, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
  married_joint: [
    { upTo: 24_800, rate: 0.10 },
    { upTo: 100_800, rate: 0.12 },
    { upTo: 211_400, rate: 0.22 },
    { upTo: 403_550, rate: 0.24 },
    { upTo: 512_450, rate: 0.32 },
    { upTo: 768_700, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
};

export const STANDARD_DEDUCTION: Record<FilingStatus, number> = {
  single: 16_100,
  married_joint: 32_200,
};

// Payroll tax, 2026: 6.2% OASDI up to the wage base, 1.45% Medicare uncapped.
const SS_WAGE_BASE_2026 = 184_500;
const SS_RATE = 0.062;
const MEDICARE_RATE = 0.0145;

/** Federal income tax owed on this much taxable income (post-deduction). */
export function federalTaxOwed(taxableIncome: number, status: FilingStatus): number {
  if (taxableIncome <= 0) return 0;
  const brackets = BRACKETS[status];
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    if (taxableIncome <= lower) break;
    const upper = Math.min(taxableIncome, b.upTo);
    tax += (upper - lower) * b.rate;
    lower = upper;
    if (taxableIncome <= b.upTo) break;
  }
  return tax;
}

/** The marginal bracket rate (0.10–0.37) for this taxable income. */
export function marginalRate(taxableIncome: number, status: FilingStatus): number {
  const brackets = BRACKETS[status];
  for (const b of brackets) if (taxableIncome <= b.upTo) return b.rate;
  return brackets[brackets.length - 1].rate;
}

/** Employee-side FICA (Social Security + Medicare) on gross wages. */
export function ficaOwed(grossWages: number): number {
  const ss = Math.min(grossWages, SS_WAGE_BASE_2026) * SS_RATE;
  const medicare = grossWages * MEDICARE_RATE;
  return ss + medicare;
}

export interface GrossUpResult {
  estimatedGrossAnnual: number;
  taxableIncome: number;
  federalTax: number;
  fica: number;
  marginalRate: number;
  effectiveRate: number; // federal tax / gross
}

/**
 * Solve for the annual gross wages that would leave `netAnnual` after
 * federal income tax + FICA, given `preTaxAnnual` already deducted from
 * gross before either tax applies (true for traditional 401k and payroll
 * HSA, both federal- and FICA-exempt at the payroll-deduction stage for
 * HSA; 401k is federal-exempt but still FICA-taxed — see
 * `estimatePreTaxSavings` below for the split). Binary search since federal
 * tax is a non-linear (progressive) function of gross.
 */
export function grossUpFromNet(netAnnual: number, preTaxAnnual: number, status: FilingStatus): GrossUpResult {
  const deduction = STANDARD_DEDUCTION[status];
  const netOf = (gross: number) => {
    const taxable = Math.max(0, gross - preTaxAnnual - deduction);
    const fed = federalTaxOwed(taxable, status);
    const fica = ficaOwed(Math.max(0, gross - preTaxAnnual)); // approx: treats all pre-tax as FICA-exempt (HSA-weighted; see note above)
    return gross - fed - fica;
  };
  let lo = netAnnual;
  let hi = netAnnual * 2.5 + 50_000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (netOf(mid) < netAnnual) lo = mid; else hi = mid;
  }
  const gross = (lo + hi) / 2;
  const taxableIncome = Math.max(0, gross - preTaxAnnual - deduction);
  const federalTax = federalTaxOwed(taxableIncome, status);
  const fica = ficaOwed(Math.max(0, gross - preTaxAnnual));
  return {
    estimatedGrossAnnual: gross,
    taxableIncome,
    federalTax,
    fica,
    marginalRate: marginalRate(taxableIncome, status),
    effectiveRate: gross > 0 ? federalTax / gross : 0,
  };
}

export interface PreTaxSavingsInput {
  hsaAnnual: number;      // payroll/contribution into HSA-subtype accounts
  retirementAnnual: number; // 401k/403b/401a-subtype contributions (traditional, pre-tax assumed)
  marginalRate: number;   // from GrossUpResult
}

export interface PreTaxSavingsResult {
  hsaSavings: number;
  retirementSavings: number;
  totalSavings: number;
}

/**
 * HSA payroll contributions skip federal income tax AND FICA (7.65%).
 * Traditional 401k contributions skip federal income tax only — FICA still
 * applies to them. State tax isn't modeled (see module doc).
 */
export function estimatePreTaxSavings({ hsaAnnual, retirementAnnual, marginalRate: rate }: PreTaxSavingsInput): PreTaxSavingsResult {
  const hsaSavings = hsaAnnual * (rate + SS_RATE + MEDICARE_RATE);
  const retirementSavings = retirementAnnual * rate;
  return { hsaSavings, retirementSavings, totalSavings: hsaSavings + retirementSavings };
}

export const FEDERAL_BRACKETS_2026 = BRACKETS;

// 2026 annual contribution limits, for "how much more could you put away"
// max-out comparisons. HSA assumes self-only coverage (the family limit is
// $8,750) since the app has no household-coverage signal to pick the right
// one automatically.
// Sources: IRS Notice 2025-67 (401k) and Rev. Proc. 2025-19 (HSA), both for
// tax year 2026.
export const HSA_LIMIT_2026 = 4_400;
export const K401_LIMIT_2026 = 24_500;
