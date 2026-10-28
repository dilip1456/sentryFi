/**
 * App category taxonomy and its default txn type. Shared by every page so
 * "is this category income / spend / ignored" has one answer.
 */
import type { TxnType, TxnBucket } from "./types.ts";

export const INTERNAL_TRANSFER_CATEGORY = "Internal Transfer";
export const CREDIT_CARD_PAYMENT_CATEGORY = "Credit Card Payment";
export const SAVINGS_CATEGORY = "Savings & Investments";
export const UNREVIEWED_TRANSFER_CATEGORY = "Unreviewed Transfer";

/** Categories excluded from spend AND income (shown under "Ignored"). */
export const TRANSFER_OUT_CATEGORY = "Transfer Out";
export const TRANSFER_IN_CATEGORY = "Transfer In";
export const IGNORED_CATEGORIES = [
  CREDIT_CARD_PAYMENT_CATEGORY, INTERNAL_TRANSFER_CATEGORY, SAVINGS_CATEGORY, UNREVIEWED_TRANSFER_CATEGORY,
  // Money sent to / received from other people (Venmo, Zelle, …) and other
  // unmatched transfers: neither spending nor income.
  TRANSFER_OUT_CATEGORY, TRANSFER_IN_CATEGORY,
];

export const INCOME_CATEGORIES = [
  "Income", "Dividends", "Interest Earned",
  "Salary", "Freelance Income", "Interest & Dividends",
  "Other Income", "Tax Refund",
];

/** Category → type for an OUTFLOW (positive amount). Inflows into spend categories become refunds. */
const CATEGORY_TYPE: Record<string, TxnType> = {
  "internal transfer": "transfer_internal",
  "credit card payment": "credit_card_payment",
  "savings & investments": "savings_contribution",
  "savings": "savings_contribution",
  "investment transfer": "savings_contribution",
  "investing": "savings_contribution",
  "investment": "savings_contribution",
  "investments": "savings_contribution",
  "retirement": "savings_contribution",
  "401k": "savings_contribution",
  "401(k)": "savings_contribution",
  "hsa": "savings_contribution",
  "health savings account": "savings_contribution",
  "unreviewed transfer": "transfer_out",
  "transfer out": "transfer_out",
  "transfer in": "transfer_in",
  "income": "income_salary",
  "salary": "income_salary",
  "freelance income": "income_other",
  "other income": "income_other",
  "tax refund": "income_other",
  "interest earned": "income_interest",
  "interest & dividends": "income_interest",
  "dividends": "income_interest",
  "mortgage": "obligation_loan",
  "auto loan": "obligation_loan",
  "student loan": "obligation_loan",
  "loan payment": "obligation_loan",
  "loan": "obligation_loan",
  "taxes": "obligation_tax",
  "rent": "obligation_bill",
  "bills & utilities": "obligation_bill",
  "bill payment": "obligation_bill",
  "insurance": "obligation_bill",
};

export const bucketOf = (type: TxnType): TxnBucket => {
  switch (type) {
    case "spend": case "refund": case "obligation_loan": case "obligation_tax": case "obligation_bill": return "spending";
    case "income_salary": case "income_interest": case "income_other": return "income";
    case "transfer_in": case "transfer_out": return "neutral";
    default: return "ignored";
  }
};

export const isIncomeType = (type: TxnType) => bucketOf(type) === "income";
export const isSpendingType = (type: TxnType) => bucketOf(type) === "spending";
export const isObligationType = (type: TxnType) => type.startsWith("obligation_");
/** Budgets apply to spend categories only. */
export const isBudgetableType = (type: TxnType) => type === "spend" || type === "refund";

/**
 * Type a category implies for a transaction of the given signed amount, or
 * null when the category is unknown to the app (caller falls through).
 */
export function typeForCategory(
  category: string | null | undefined,
  amount: number,
  customCategories: { name: string; type: "income" | "expense" }[] = [],
): TxnType | null {
  const c = (category ?? "").trim().toLowerCase();
  if (!c) return null;
  // A known financial term (mortgage, HSA, taxes, ...) wins even if the user
  // also happens to have a custom category of the same name — otherwise a
  // custom "Mortgage" expense category silently defeats loan-payment
  // detection and the transaction looks like ordinary spending everywhere
  // in the app. Only truly unrecognized category names fall to the
  // custom-category / generic-spend fallback below.
  const t = CATEGORY_TYPE[c];
  if (t) {
    if (t === "transfer_out" && amount < 0) return "transfer_in";
    if (t === "transfer_in" && amount > 0) return "transfer_out";
    if (t === "savings_contribution" && amount < 0) return "transfer_internal"; // money back from savings
    if (isObligationType(t) && amount < 0) return "refund";
    return t;
  }
  const custom = customCategories.find(x => x.name.trim().toLowerCase() === c);
  if (custom) {
    if (custom.type === "income") return "income_other";
    return amount < 0 ? "refund" : "spend";
  }
  if (c === "other") return null; // catch-all, not a deliberate assignment
  if (KNOWN_SPEND.has(c)) return amount < 0 ? "refund" : "spend";
  return null;
}

export const KNOWN_SPEND = new Set([
  "food & drink", "groceries", "transportation", "travel", "home", "shopping",
  "entertainment", "healthcare", "education", "personal care", "financial services",
  "bank fees", "business", "charitable giving", "refund / reimbursement",
  "subscriptions", "auto & transport", "gambling", "cash & atm",
]);

/** Display category to show for a type when the stored category disagrees. */
export function displayCategoryForType(type: TxnType, subtype?: string): string | null {
  switch (type) {
    case "transfer_internal": return INTERNAL_TRANSFER_CATEGORY;
    case "credit_card_payment": return CREDIT_CARD_PAYMENT_CATEGORY;
    case "savings_contribution": return SAVINGS_CATEGORY;
    case "transfer_out": return subtype === "p2p" ? TRANSFER_OUT_CATEGORY : UNREVIEWED_TRANSFER_CATEGORY;
    case "transfer_in": return subtype === "p2p" ? TRANSFER_IN_CATEGORY : UNREVIEWED_TRANSFER_CATEGORY;
    case "income_salary": return "Salary";
    case "income_interest": return subtype === "dividend" ? "Dividends" : "Interest Earned";
    case "income_other": return "Other Income";
    case "obligation_tax": return "Taxes";
    case "obligation_loan": return "Loan Payment";
    case "obligation_bill": return "Bills & Utilities";
    case "refund": return "Refund / Reimbursement";
    default: return null;
  }
}

/** Human label for a type (chips, override picker). */
export const TXN_TYPE_LABEL: Record<TxnType, string> = {
  spend: "Spending",
  refund: "Refund",
  income_salary: "Salary",
  income_interest: "Interest / dividends",
  income_other: "Other income",
  transfer_internal: "Internal transfer (ignored)",
  transfer_in: "Transfer in (from someone / unreviewed; not income)",
  transfer_out: "Transfer out (to someone / unreviewed; not spending)",
  credit_card_payment: "Card payment (ignored)",
  savings_contribution: "Savings / investing",
  obligation_loan: "Loan payment",
  obligation_tax: "Tax",
  obligation_bill: "Bill",
};
