/**
 * My Money inferences (review/insights/v2/INFERENCES.md). Pure TS: detectors
 * produce Findings; decisions.ts merges them with stored `inferences` rows;
 * apply.ts turns confirmed rows into facts. Only confirmed rows count.
 */
export * from "./types";
export * from "./decisions";
export * from "./autopay";
export * from "./apply";
