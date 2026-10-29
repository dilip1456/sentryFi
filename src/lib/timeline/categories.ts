import type { TxnType } from "@/lib/classify";
import type { TimelineCategory, TimelineStatus } from "./types";

/**
 * Chip a classified txn type rolls into. Mirrors public.timeline_category()
 * in supabase/migrations/20261029100000_timeline_events.sql (a test keeps
 * them in step).
 */
export function categoryForType(t: TxnType | string | null | undefined): TimelineCategory {
  switch (t) {
    case "income_salary": case "income_interest": case "income_other": return "income";
    case "obligation_bill": case "obligation_loan": return "bills";
    case "credit_card_payment": return "cards";
    case "savings_contribution": return "savings";
    case "obligation_tax": return "taxes";
    case "transfer_internal": case "transfer_in": case "transfer_out": return "transfer";
    default: return "spending";
  }
}

/** Internal transfers are hidden unless "Show internal transfers" is on. */
export const isInternalType = (t: TxnType | string | null | undefined) => t === "transfer_internal";

/**
 * The type the timeline shows for a transaction: the user's override wins,
 * then the shared classifier's stored verdict, then the PFC fallback.
 */
export function resolveTxnType(override: TxnType | null | undefined, classified: TxnType | null | undefined, fallback: TxnType): TxnType {
  return override ?? classified ?? fallback;
}

/** Status for a posted transaction (mirrors the view's CASE). */
export function statusForTxn(t: TxnType | string | null, pending: boolean): TimelineStatus {
  if (pending) return "pending";
  switch (t) {
    case "income_salary": case "income_interest": case "income_other": return "received";
    case "transfer_internal": case "savings_contribution": return "moved";
    case "transfer_in": case "transfer_out": return "review";
    case "obligation_bill": case "obligation_loan": case "obligation_tax": case "credit_card_payment": return "paid";
    default: return "posted";
  }
}

export const CATEGORY_LABEL: Record<TimelineCategory, string> = {
  income: "Income", bills: "Bills", cards: "Cards", savings: "Savings", taxes: "Taxes",
  alerts: "Alerts", spending: "Spending", transfer: "Transfer",
};

export const STATUS_LABEL: Record<TimelineStatus, string> = {
  received: "Received", paid: "Paid", posted: "Posted", moved: "Moved", pending: "Pending",
  review: "Needs a look", flag: "Needs a look", seen: "Seen", done: "Done", info: "Info",
  late: "Paid late", expected: "Expected", not_covered: "Not covered",
};

export type StatusTone = "positive" | "muted" | "negative" | "info";
export const STATUS_TONE: Record<TimelineStatus, StatusTone> = {
  received: "positive", paid: "positive", moved: "positive", done: "positive",
  posted: "muted", pending: "muted", expected: "muted", seen: "muted",
  review: "negative", flag: "negative", not_covered: "negative", late: "negative",
  info: "info",
};
