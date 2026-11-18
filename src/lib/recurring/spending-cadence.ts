/**
 * Recurring-bill classification, shared by the Spending transaction list and
 * the transaction detail modal so both always report the same cadence for
 * the same merchant.
 */
import { daysBetweenISO } from "@/lib/dates";

/** Discretionary categories that are never projected as a recurring bill. */
export const RECURRING_EXCLUDED_CATEGORIES = new Set([
  "food & drink", "food and drink", "groceries", "shopping", "travel", "entertainment", "restaurants", "dining",
  "gas", "fuel", "transportation", "auto & transport",
]);

/** Real subscriptions that often get filed under a discretionary category. */
export const RECURRING_OVERRIDE_KEYWORDS = [
  "netflix", "spotify", "hulu", "disney+", "disney plus", "paramount+", "peacock", "hbo max",
  "amazon prime", "apple tv", "apple music", "youtube premium", "gym", "fitness", "planet fitness",
];
const PLAID_RETAIL_DETAILED = new Set([
  "GENERAL_MERCHANDISE_CONVENIENCE_STORES",
  "GENERAL_MERCHANDISE_DEPARTMENT_STORES",
  "GENERAL_MERCHANDISE_DISCOUNT_STORES",
  "GENERAL_MERCHANDISE_ELECTRONICS",
  "GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES",
  "GENERAL_MERCHANDISE_OFFICE_SUPPLIES",
  "GENERAL_MERCHANDISE_PET_SUPPLIES",
  "GENERAL_MERCHANDISE_SPORTING_GOODS",
  "GENERAL_MERCHANDISE_SUPERSTORES",
  "GENERAL_MERCHANDISE_TOYS_AND_GAMES",
  "GENERAL_MERCHANDISE_WAREHOUSE_CLUBS",
  "GENERAL_MERCHANDISE_TOBACCO_AND_VAPE",
  "TRANSPORTATION_GAS",
  "TRANSPORTATION_GAS_STATIONS",
]);

export interface PlaidRecurringCategory {
  primary?: string | null;
  detailed?: string | null;
}

/** Plaid retail and food categories are purchase activity, not bill evidence. */
export const isPlaidDiscretionaryRecurringExcluded = (primary: string | null | undefined, detailed: string | null | undefined, merchantName: string): boolean => {
  const pfcPrimary = (primary ?? "").toUpperCase();
  const pfcDetailed = (detailed ?? "").toUpperCase();
  const discretionary = pfcPrimary === "GENERAL_MERCHANDISE"
    || pfcPrimary === "FOOD_AND_DRINK"
    || pfcPrimary === "GROCERIES"
    || pfcDetailed.startsWith("GENERAL_MERCHANDISE_");
  if (!discretionary) return false;
  // Known subscriptions can still appear in broad retail categories.
  const merchant = merchantName.toLowerCase();
  return !RECURRING_OVERRIDE_KEYWORDS.some(k => merchant.includes(k));
};

/** True when a merchant in this category is a habit, not a bill (excluded from recurring). */
export const isNonBillRecurringCandidate = (cat: string, merchantName: string, plaid?: PlaidRecurringCategory): boolean => {
  const c = cat.toLowerCase();
  const n = merchantName.toLowerCase();
  // Plaid sometimes assigns a low-confidence convenience-store transaction
  // to a bill-like app category (especially when the app category is missing
  // and recurrence is inferred from merchant/date patterns). Treat the raw
  // Plaid retail taxonomy as stronger evidence that it is ordinary shopping.
  const plaidDiscretionary = PLAID_RETAIL_DETAILED.has((plaid?.detailed ?? "").toUpperCase())
    || isPlaidDiscretionaryRecurringExcluded(plaid?.primary, plaid?.detailed, merchantName);
  if (!plaidDiscretionary && !RECURRING_EXCLUDED_CATEGORIES.has(c)) return false;
  return !RECURRING_OVERRIDE_KEYWORDS.some(k => n.includes(k));
};

/** Cadence from the average gap (days) between occurrences, or null when irregular. */
export const classifyRecurrenceFrequency = (avgGapDays: number): string | null => {
  if (avgGapDays >= 5 && avgGapDays <= 9) return "Weekly";
  if (avgGapDays >= 12 && avgGapDays <= 17) return "Biweekly";
  if (avgGapDays >= 25 && avgGapDays <= 36) return "Monthly";
  if (avgGapDays >= 80 && avgGapDays <= 100) return "Quarterly";
  if (avgGapDays >= 340 && avgGapDays <= 390) return "Yearly";
  return null;
};

/** Average gap in days between sorted YYYY-MM-DD dates (needs ≥2). */
export const averageGapDays = (dates: string[]): number | null => {
  if (dates.length < 2) return null;
  const sorted = [...dates].sort();
  return daysBetweenISO(sorted[0], sorted[sorted.length - 1]) / (sorted.length - 1);
};

/** Recurring cadence for one merchant's occurrences, or null if it isn't a recurring bill. */
export const recurringFrequencyFor = (dates: string[], cat: string, label: string, plaid?: PlaidRecurringCategory): string | null => {
  if (isNonBillRecurringCandidate(cat, label, plaid)) return null;
  const gap = averageGapDays(dates);
  return gap == null ? null : classifyRecurrenceFrequency(gap);
};
