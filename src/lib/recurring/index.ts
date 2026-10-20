/**
 * Recurring series & obligations (Phase 3). Import as "@/lib/recurring/index"
 * (or a submodule): "@/lib/recurring" resolves to src/lib/recurring.ts, the
 * Spending list's cadence helpers from PR #8, which takes precedence over
 * this directory.
 */
export * from "./classifier";
export * from "./dates";
export * from "./amount";
export * from "./schedule";
export * from "./detect";
export * from "./rows";
export { merchantKey, displayName } from "./patterns";
export { createSharedClassifier, type SharedClassifierExtras } from "./shared-classifier";
