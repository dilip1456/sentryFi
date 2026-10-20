/**
 * Plaid personal_finance_category (PFC) → txn type + app category.
 * Taxonomy: https://plaid.com/documents/transactions-personal-finance-category-taxonomy.csv
 */
import type { TxnType } from "./types.ts";

export interface PfcMapping { type: TxnType; category: string; subtype?: string }

// Primary → app category for ordinary spend (and the fallback for detailed
// values not listed below).
export const PFC_PRIMARY_CATEGORY: Record<string, string> = {
  INCOME: "Other Income",
  TRANSFER_IN: "Transfer In",
  TRANSFER_OUT: "Transfer Out",
  LOAN_PAYMENTS: "Loan Payment",
  BANK_FEES: "Bank Fees",
  ENTERTAINMENT: "Entertainment",
  FOOD_AND_DRINK: "Food & Drink",
  GROCERIES: "Groceries",
  GENERAL_MERCHANDISE: "Shopping",
  HOME_IMPROVEMENT: "Home",
  MEDICAL: "Healthcare",
  PERSONAL_CARE: "Personal Care",
  GENERAL_SERVICES: "Bills & Utilities",
  GOVERNMENT_AND_NON_PROFIT: "Charitable Giving",
  TRANSPORTATION: "Transportation",
  TRAVEL: "Travel",
  RENT_AND_UTILITIES: "Bills & Utilities",
};

const DETAILED: Record<string, PfcMapping> = {
  INCOME_WAGES: { type: "income_salary", category: "Salary" },
  INCOME_INTEREST_EARNED: { type: "income_interest", category: "Interest Earned", subtype: "interest" },
  INCOME_DIVIDENDS: { type: "income_interest", category: "Dividends", subtype: "dividend" },
  INCOME_TAX_REFUND: { type: "income_other", category: "Tax Refund", subtype: "tax_refund" },
  INCOME_UNEMPLOYMENT: { type: "income_other", category: "Other Income", subtype: "benefits" },
  INCOME_RETIREMENT_PENSION: { type: "income_other", category: "Other Income", subtype: "pension" },
  INCOME_OTHER_INCOME: { type: "income_other", category: "Other Income" },

  TRANSFER_IN_ACCOUNT_TRANSFER: { type: "transfer_in", category: "Transfer In", subtype: "account_transfer" },
  TRANSFER_IN_SAVINGS: { type: "transfer_in", category: "Transfer In", subtype: "from_savings" },
  TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS: { type: "transfer_in", category: "Transfer In", subtype: "from_investments" },
  TRANSFER_IN_DEPOSIT: { type: "transfer_in", category: "Transfer In", subtype: "deposit" },
  TRANSFER_IN_CASH_ADVANCES_AND_LOANS: { type: "transfer_in", category: "Transfer In", subtype: "loan_proceeds" },
  TRANSFER_IN_OTHER_TRANSFER_IN: { type: "transfer_in", category: "Transfer In" },

  TRANSFER_OUT_SAVINGS: { type: "savings_contribution", category: "Savings & Investments", subtype: "savings" },
  TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS: { type: "savings_contribution", category: "Savings & Investments", subtype: "investment" },
  TRANSFER_OUT_ACCOUNT_TRANSFER: { type: "transfer_out", category: "Transfer Out", subtype: "account_transfer" },
  TRANSFER_OUT_WITHDRAWAL: { type: "spend", category: "Cash & ATM", subtype: "cash" },
  TRANSFER_OUT_OTHER_TRANSFER_OUT: { type: "transfer_out", category: "Transfer Out" },

  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: { type: "credit_card_payment", category: "Credit Card Payment" },
  LOAN_PAYMENTS_MORTGAGE_PAYMENT: { type: "obligation_loan", category: "Mortgage", subtype: "mortgage" },
  LOAN_PAYMENTS_CAR_PAYMENT: { type: "obligation_loan", category: "Auto Loan", subtype: "auto" },
  LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT: { type: "obligation_loan", category: "Student Loan", subtype: "student" },
  LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT: { type: "obligation_loan", category: "Loan Payment", subtype: "personal" },
  LOAN_PAYMENTS_OTHER_PAYMENT: { type: "obligation_loan", category: "Loan Payment" },

  GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT: { type: "obligation_tax", category: "Taxes", subtype: "tax" },
  GOVERNMENT_AND_NON_PROFIT_DONATIONS: { type: "spend", category: "Charitable Giving" },

  RENT_AND_UTILITIES_RENT: { type: "obligation_bill", category: "Rent", subtype: "rent" },
  RENT_AND_UTILITIES_GAS_AND_ELECTRICITY: { type: "obligation_bill", category: "Bills & Utilities", subtype: "utility" },
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: { type: "obligation_bill", category: "Bills & Utilities", subtype: "utility" },
  RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT: { type: "obligation_bill", category: "Bills & Utilities", subtype: "utility" },
  RENT_AND_UTILITIES_TELEPHONE: { type: "obligation_bill", category: "Bills & Utilities", subtype: "phone" },
  RENT_AND_UTILITIES_WATER: { type: "obligation_bill", category: "Bills & Utilities", subtype: "utility" },
  RENT_AND_UTILITIES_OTHER_UTILITIES: { type: "obligation_bill", category: "Bills & Utilities", subtype: "utility" },
  GENERAL_SERVICES_INSURANCE: { type: "obligation_bill", category: "Insurance", subtype: "insurance" },
};

/**
 * Map a PFC pair to a type + app category. Spend-type results use the sign
 * at classification time (a negative spend becomes a refund), so this only
 * returns the outflow meaning.
 */
export function mapPfc(primary?: string | null, detailed?: string | null): PfcMapping | null {
  const d = (detailed ?? "").toUpperCase();
  const p = (primary ?? (d ? d.split("_").slice(0, 2).join("_") : "")).toUpperCase();
  if (d && DETAILED[d]) return DETAILED[d];
  if (!p) return null;
  if (p === "INCOME") return { type: "income_other", category: "Other Income" };
  if (p === "TRANSFER_IN") return { type: "transfer_in", category: "Transfer In" };
  if (p === "TRANSFER_OUT") return { type: "transfer_out", category: "Transfer Out" };
  if (p === "LOAN_PAYMENTS") return { type: "obligation_loan", category: "Loan Payment" };
  const cat = PFC_PRIMARY_CATEGORY[p];
  return cat ? { type: "spend", category: cat } : null;
}

/** App category to store in plaid_transactions.category for a PFC-only transaction. */
export function pfcToAppCategory(primary?: string | null, detailed?: string | null): string | null {
  return mapPfc(primary, detailed)?.category ?? null;
}

/** Whether a PFC confidence level is trustworthy enough to be decisive. */
export const pfcTrusted = (confidence?: string | null) =>
  !confidence || !/^(LOW|UNKNOWN)$/i.test(confidence);
