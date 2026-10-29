/**
 * Federal tax tables, keyed by tax year. The one place these numbers live:
 * src/lib/tax-calc.ts and My Financial Picture (src/lib/picture/tax.ts) both
 * read from here. Add a new year as a new key; `taxTable()` falls back to the
 * latest year on file when asked for a year that isn't here yet.
 *
 * Informational estimates only, not tax advice (see tax-calc.ts).
 */
export type FilingStatus = "single" | "married_joint";

export interface Bracket { upTo: number; rate: number } // upTo = Infinity for the top bracket

export interface TaxYearTable {
  year: number;
  /** Where every figure in this entry comes from. */
  sources: string[];
  /** Taxable-income thresholds (after the standard deduction). */
  brackets: Record<FilingStatus, Bracket[]>;
  standardDeduction: Record<FilingStatus, number>;
  /** Social Security (OASDI) wage base; Medicare has no cap. */
  ssWageBase: number;
  ssRate: number;
  medicareRate: number;
  /** HSA contribution limits (self-only / family coverage). */
  hsaLimit: { self: number; family: number };
  /** 401(k)/403(b) elective deferral limit (under 50, no catch-up). */
  k401Limit: number;
}

export const TAX_TABLES: Record<number, TaxYearTable> = {
  2026: {
    year: 2026,
    sources: [
      "IRS Rev. Proc. 2025-32 (2026 brackets and standard deduction, as amended by the One, Big, Beautiful Bill Act): https://www.irs.gov/pub/irs-drop/rp-25-32.pdf",
      "SSA 2026 contribution and benefit base ($184,500): https://www.ssa.gov/oact/cola/cbb.html",
      "IRS Rev. Proc. 2025-19 (2026 HSA limits)",
      "IRS Notice 2025-67 (2026 401(k) limit)",
    ],
    brackets: {
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
    },
    standardDeduction: { single: 16_100, married_joint: 32_200 },
    ssWageBase: 184_500,
    ssRate: 0.062,
    medicareRate: 0.0145,
    hsaLimit: { self: 4_400, family: 8_750 },
    k401Limit: 24_500,
  },
};

/** The tax year the app estimates for. */
export const CURRENT_TAX_YEAR = 2026;

/** The table for `year`, or the latest year on file at or before it (else the latest overall). */
export function taxTable(year: number = CURRENT_TAX_YEAR): TaxYearTable {
  if (TAX_TABLES[year]) return TAX_TABLES[year];
  const years = Object.keys(TAX_TABLES).map(Number).sort((a, b) => a - b);
  const prior = years.filter(y => y <= year);
  return TAX_TABLES[prior.length ? prior[prior.length - 1] : years[years.length - 1]];
}
