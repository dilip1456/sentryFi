/**
 * Recurring-bill classification, shared by the Spending transaction list and
 * the transaction detail modal so both always report the same cadence for
 * the same merchant.
 */
import { daysBetweenISO } from "@/lib/dates";

/** Discretionary categories that are never projected as a recurring bill. */
export const RECURRING_EXCLUDED_CATEGORIES = new Set([
  "food & drink", "food and drink", "groceries", "shopping", "travel", "entertainment", "restaurants", "dining",
]);

/** Real subscriptions that often get filed under a discretionary category. */
export const RECURRING_OVERRIDE_KEYWORDS = [
  "netflix", "spotify", "hulu", "disney+", "disney plus", "paramount+", "peacock", "hbo max",
  "amazon prime", "apple tv", "apple music", "youtube premium", "gym", "fitness", "planet fitness",
];

/** True when a merchant in this category is a habit, not a bill (excluded from recurring). */
export const isNonBillRecurringCandidate = (cat: string, merchantName: string): boolean => {
  const c = cat.toLowerCase();
  const n = merchantName.toLowerCase();
  if (!RECURRING_EXCLUDED_CATEGORIES.has(c)) return false;
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
export const recurringFrequencyFor = (dates: string[], cat: string, label: string): string | null => {
  if (isNonBillRecurringCandidate(cat, label)) return null;
  const gap = averageGapDays(dates);
  return gap == null ? null : classifyRecurrenceFrequency(gap);
};
