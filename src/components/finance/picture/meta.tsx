import { Banknote, ChartPie, CreditCard, FileText, House, Landmark, PiggyBank, Receipt, type LucideIcon } from "lucide-react";
import type { PictureGroup } from "@/lib/picture/model";

export const SEC: Record<PictureGroup, { t: string; i: LucideIcon; s: string }> = {
  income: { t: "Income", i: Banknote, s: "Money coming in" },
  deductions: { t: "Paycheck Deductions", i: Landmark, s: "Pre-tax & payroll contributions" },
  obligations: { t: "Obligations", i: House, s: "Loans you must pay" },
  fixed: { t: "Fixed Expenses", i: FileText, s: "Insurance, memberships, bills" },
  taxes: { t: "Taxes", i: Receipt, s: "This year, estimated" },
  budgets: { t: "Budgeted Categories", i: ChartPie, s: "Only the categories you budget" },
  cards: { t: "Cards & Payoff Accounts", i: CreditCard, s: "How your cards get paid" },
  savings: { t: "Savings", i: PiggyBank, s: "Transfers you make to your own goals" },
};

export const groupsFor = (full: boolean): PictureGroup[] =>
  ["income", "deductions", "obligations", "fixed", ...(full ? (["taxes"] as const) : []), "budgets", "cards", "savings"];

/** Groups that have a "Covered by" account. */
export const COVER_GROUPS = new Set<PictureGroup>(["obligations", "fixed", "budgets"]);
