/**
 * `@/lib/recurring`: one entry point for both recurring modules.
 *  - Phase 3 recurring series & obligations (classifier, dates, schedule,
 *    amount, detect, rows, ...).
 *  - The Spending list's merchant cadence labels (spending-cadence.ts, from
 *    PR #8; formerly src/lib/recurring.ts, moved here unchanged).
 * The two share no export names (a test checks this).
 */
export * from "./classifier";
export * from "./dates";
export * from "./amount";
export * from "./schedule";
export * from "./detect";
export * from "./rows";
export { merchantKey, displayName } from "./patterns";
export { createSharedClassifier, type SharedClassifierExtras } from "./shared-classifier";
export * from "./spending-cadence";
