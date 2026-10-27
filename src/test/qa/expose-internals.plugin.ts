/**
 * QA harness — test-only Vite plugin (wired in vitest.config.ts only; never in
 * vite.config.ts, so production builds are untouched).
 *
 * Most of SentryFi's money math lives as module-private helpers inside large
 * component files (e.g. LivePlaidDashboard.tsx). Rather than editing those
 * files just to add `export`, this plugin appends a single
 *   export const __qa_internals__ = { name: typeof name === "undefined" ? undefined : name, ... }
 * to the listed modules while vitest transforms them. `typeof` on an
 * identifier that no longer exists is safe, so if a branch renames/moves a
 * helper the tests report "helper missing" instead of the whole file failing
 * to compile.
 */
import type { Plugin } from "vite";

export const QA_INTERNALS: Record<string, string[]> = {
  "src/components/finance/LivePlaidDashboard.tsx": [
    "EXPENSE_CATEGORIES", "INCOME_CATEGORIES", "IGNORED_CATEGORIES",
    "mapBucket", "isDebt", "formatCat", "humanizeCategory",
    "buildNWByPeriod", "buildMonthlyFlow", "detectInternalTransfers",
    "buildSpendTrends", "detectRecurring", "getPeriodRange", "getPeriodLabel",
    "filterByPeriod", "looksLikeSavings", "normalisePlaidCategory",
    "getEffectiveCategory", "isIncomeCategory",
  ],
  "src/components/finance/SpendingBudgetView.tsx": [
    "monthBucketsList", "dayBucketsList", "weekBucketsList", "yearBucketsList",
    "classifyRecurrenceFrequency", "isNonBillRecurringCandidate", "OBLIGATION_LIKE_CATS",
  ],
  "src/components/finance/BudgetPage.tsx": [
    "classifyFrequency", "FREQ_MONTHLY_MULT", "isTransferLikeCategory", "monthKey",
    "amountsConsistent", "cleanMerchantName", "isDiscretionarySpend",
  ],
};

export function exposeInternals(map: Record<string, string[]> = QA_INTERNALS): Plugin {
  const entries = Object.entries(map);
  return {
    name: "qa-expose-internals",
    enforce: "pre",
    transform(code, id) {
      const clean = id.split("?")[0].replace(/\\/g, "/");
      const hit = entries.find(([file]) => clean.endsWith("/" + file));
      if (!hit) return null;
      const body = hit[1].map(n => `${JSON.stringify(n)}: typeof ${n} === "undefined" ? undefined : ${n}`).join(",\n  ");
      return { code: `${code}\n\n// --- appended by qa-expose-internals (tests only) ---\nexport const __qa_internals__ = {\n  ${body}\n};\n`, map: null };
    },
  };
}
