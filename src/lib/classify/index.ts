/**
 * Shared transaction classifier — one taxonomy, one implementation for the
 * web app (Home, Spending, Budget, Money Map) and Supabase edge functions
 * (send-alerts). Pure TS with explicit ".ts" relative imports and no
 * React/Supabase/"@/..." imports so Deno can load it unchanged; the edge
 * copy lives in supabase/functions/_shared/classify (regenerate with
 * `node scripts/sync-classifier.mjs`; a test fails if it drifts).
 *
 * Intended to replace ad-hoc classifiers such as `classifyFlow` in
 * src/lib/spending-insights.ts (design branch): map
 *   spend/refund → "spend", credit_card_payment → "card_payment",
 *   transfer_internal → "internal", savings_contribution → "savings",
 *   spend+subtype p2p → "p2p_out", income_other+subtype p2p → "p2p_in",
 *   income_* → "income".
 */
export * from "./types.ts";
export * from "./categories.ts";
export * from "./patterns.ts";
export * from "./pfc.ts";
export * from "./pairs.ts";
export * from "./classify.ts";
export * from "./summary.ts";
export * from "./plaid-categories.ts";
