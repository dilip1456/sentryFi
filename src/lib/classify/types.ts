/**
 * Shared classifier types. Pure TS — no React, Supabase, or "@/..." imports —
 * so the same files run in the Vite app and in Supabase (Deno) edge
 * functions (see scripts/sync-classifier.mjs).
 */

/**
 * What kind of money movement a transaction is (orthogonal to its spend
 * category). See docs in ./index.ts for how each type rolls up.
 */
export type TxnType =
  | "spend"                // consumption at a merchant / money to another person
  | "refund"               // money back from a merchant (nets against spend)
  | "income_salary"        // payroll / wages
  | "income_interest"      // interest and dividends earned
  | "income_other"         // P2P received from others, benefits, tax refund, side income
  | "transfer_internal"    // money between two of the user's own accounts — ignored
  | "transfer_in"          // unmatched incoming transfer — neutral, needs review
  | "transfer_out"         // unmatched outgoing transfer — neutral, needs review
  | "credit_card_payment"  // paying a card (either leg, linked or not) — excluded from spend
  | "savings_contribution" // money to savings / investments — excluded from spend
  | "obligation_loan"      // mortgage, auto, student, personal loan payment
  | "obligation_tax"       // federal / state / property / estimated taxes
  | "obligation_bill";     // rent, utilities, insurance, phone (fixed must-pays)

export const TXN_TYPES: TxnType[] = [
  "spend", "refund", "income_salary", "income_interest", "income_other",
  "transfer_internal", "transfer_in", "transfer_out", "credit_card_payment",
  "savings_contribution", "obligation_loan", "obligation_tax", "obligation_bill",
];

/** Which totals a type rolls into. */
export type TxnBucket = "spending" | "income" | "neutral" | "ignored";

export type ClassSource = "override" | "category_override" | "rule" | "pair" | "card" | "pfc" | "pattern" | "recurring" | "category" | "fallback";

export interface Classification {
  type: TxnType;
  /** Optional finer detail: "mortgage", "p2p", "dividend", "irs", "self", "brokerage", … */
  subtype?: string;
  source: ClassSource;
  /** Short human reason for a "why?" tooltip. */
  reason: string;
  /** For linked-account pairs, the other leg's transaction id. */
  pairId?: string;
}

/** Minimal transaction shape the classifier reads. */
export interface ClassifierTxn {
  id: string;
  transaction_id?: string | null;   // Plaid id (stable across re-syncs; keys txn_overrides)
  account_id: string;
  item_id?: string | null;
  amount: number | string;          // Plaid convention: > 0 money out, < 0 money in
  date: string;                     // YYYY-MM-DD
  name: string | null;
  merchant_name: string | null;
  category?: string[] | null;       // stored (legacy or mapped) Plaid category
  pending?: boolean | null;
  pfc_primary?: string | null;      // Plaid personal_finance_category.primary
  pfc_detailed?: string | null;     // Plaid personal_finance_category.detailed
  pfc_confidence?: string | null;   // VERY_HIGH | HIGH | MEDIUM | LOW | UNKNOWN
}

export type AccountRole = "spending" | "buffer" | "reserve" | "savings_goal" | "investment" | "debt" | "unassigned";

export interface ClassifierAccount {
  account_id: string;
  item_id?: string | null;
  name?: string | null;
  mask?: string | null;
  type: string | null;
  subtype: string | null;
  /** User-assigned role (Money Map), if any. */
  role?: AccountRole | null;
}

export interface ClassifierContext {
  accounts?: ClassifierAccount[];
  /** Per-transaction type override the user picked — always wins. */
  typeOverrides?: Record<string, TxnType>;
  /** Per-transaction category the user picked. */
  categoryOverrides?: Record<string, string>;
  /** Category from the user's merchant/smart rules, if any. */
  ruleCategory?: (t: ClassifierTxn) => string | null | undefined;
  /** Ids a smart rule / legacy setting marked internal. */
  ruleInternalIds?: Set<string>;
  /** Ids the user explicitly said are NOT internal (legacy "manualExternal"). */
  notInternalIds?: Set<string>;
  /** The user's own name(s) for "Zelle to <me>" detection. */
  selfNames?: string[];
  /** Custom categories with their declared type. */
  customCategories?: { name: string; type: "income" | "expense" }[];
  /** Recurring-stream context hook (stage 7) — return a type for confirmed streams. */
  recurringType?: (t: ClassifierTxn) => TxnType | null | undefined;
  /** Base category resolver for the legacy stored category (defaults to category[0]). */
  plaidCategory?: (t: ClassifierTxn) => string;
}
