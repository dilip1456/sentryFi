import {
  Wallet, PiggyBank, CreditCard, TrendingUp, Landmark, Banknote,
  Coffee, ShoppingBag, Car, Home, Utensils, Plane, Film, Zap,
  type LucideIcon,
} from "lucide-react";

export type AccountGroup = "cash" | "credit" | "investments" | "liabilities";

export interface Account {
  id: string;
  name: string;
  institution: string;
  group: AccountGroup;
  balance: number;          // signed: positive for assets, negative for debt
  apr?: number;             // interest rate (positive earns, negative cost)
  limit?: number;           // for credit cards
  promo?: string;           // e.g. "0% APR until Aug 2026"
  trend30d: number;         // % change over 30d
  icon: LucideIcon;
  accent: "mint" | "sky" | "amber" | "coral" | "violet";
  last4?: string;
}

export const accounts: Account[] = [
  // CASH
  { id: "chk-1", name: "Everyday Checking", institution: "Chase", group: "cash", balance: 8420.55, apr: 0.01, trend30d: -2.4, icon: Wallet, accent: "sky", last4: "4421" },
  { id: "chk-2", name: "Joint Checking", institution: "Bank of America", group: "cash", balance: 3120.10, apr: 0.01, trend30d: 1.1, icon: Wallet, accent: "sky", last4: "8830" },
  { id: "hys-1", name: "High-Yield Savings", institution: "Marcus", group: "cash", balance: 42800.00, apr: 4.40, trend30d: 3.2, icon: PiggyBank, accent: "mint", last4: "1102" },
  { id: "hys-2", name: "Emergency Fund", institution: "Ally", group: "cash", balance: 18500.00, apr: 4.20, trend30d: 0.9, icon: PiggyBank, accent: "mint", last4: "7745" },
  { id: "sav-1", name: "Local Savings", institution: "Wells Fargo", group: "cash", balance: 6200.00, apr: 0.05, trend30d: 0.0, icon: Banknote, accent: "amber", last4: "3301" },

  // CREDIT
  { id: "cc-1", name: "Sapphire Reserve", institution: "Chase", group: "credit", balance: -2840.22, apr: 22.49, limit: 25000, trend30d: 18.0, icon: CreditCard, accent: "violet", last4: "9921" },
  { id: "cc-2", name: "Amex Gold", institution: "American Express", group: "credit", balance: -1120.40, apr: 24.99, limit: 15000, trend30d: -12.0, icon: CreditCard, accent: "amber", last4: "1004" },
  { id: "cc-3", name: "Citi Custom Cash", institution: "Citi", group: "credit", balance: -480.10, apr: 0, limit: 8000, promo: "0% APR until Aug 2026", trend30d: 6.0, icon: CreditCard, accent: "mint", last4: "5520" },
  { id: "cc-4", name: "Apple Card", institution: "Goldman Sachs", group: "credit", balance: -210.55, apr: 19.24, limit: 10000, trend30d: -3.0, icon: CreditCard, accent: "sky", last4: "8801" },

  // INVESTMENTS
  { id: "inv-1", name: "401(k)", institution: "Fidelity", group: "investments", balance: 184320.00, apr: 8.4, trend30d: 2.1, icon: TrendingUp, accent: "mint", last4: "K401" },
  { id: "inv-2", name: "Roth IRA", institution: "Vanguard", group: "investments", balance: 62150.00, apr: 9.1, trend30d: 1.8, icon: TrendingUp, accent: "mint", last4: "ROTH" },
  { id: "inv-3", name: "Brokerage", institution: "Schwab", group: "investments", balance: 38420.50, apr: 7.2, trend30d: -0.8, icon: TrendingUp, accent: "sky", last4: "BRK1" },
  { id: "inv-4", name: "HSA", institution: "Lively", group: "investments", balance: 14200.00, apr: 6.5, trend30d: 1.3, icon: Landmark, accent: "amber", last4: "HSA0" },

  // LIABILITIES
  { id: "lo-1", name: "Mortgage", institution: "Rocket", group: "liabilities", balance: -312400.00, apr: 6.75, trend30d: -0.2, icon: Home, accent: "coral", last4: "MTG0" },
  { id: "lo-2", name: "Student Loan", institution: "Nelnet", group: "liabilities", balance: -18420.00, apr: 5.50, trend30d: -1.1, icon: Landmark, accent: "coral", last4: "EDU2" },
  { id: "lo-3", name: "Auto Loan", institution: "Ally", group: "liabilities", balance: -9200.00, apr: 7.90, trend30d: -2.0, icon: Car, accent: "amber", last4: "AUTO" },
];

export const netWorthSeries = [
  { m: "May", v: 158400 },
  { m: "Jun", v: 162200 },
  { m: "Jul", v: 159800 },
  { m: "Aug", v: 167500 },
  { m: "Sep", v: 172300 },
  { m: "Oct", v: 178100 },
  { m: "Nov", v: 184600 },
  { m: "Dec", v: 188200 },
  { m: "Jan", v: 192400 },
  { m: "Feb", v: 198300 },
  { m: "Mar", v: 204900 },
  { m: "Apr", v: 211480 },
];

export type InsightSeverity = "high" | "medium" | "low";
export interface Insight {
  id: string;
  severity: InsightSeverity;
  category: "Rewards" | "0% APR" | "Idle Cash" | "Debt" | "Tax";
  title: string;
  what: string;        // what is happening
  why: string;         // why it matters
  action: string;      // suggested action
  impact: string;      // estimated $ impact
  impactValue: number;
}

export const insights: Insight[] = [
  {
    id: "i1",
    severity: "high",
    category: "Idle Cash",
    title: "$6,200 sitting in 0.05% APY savings",
    what: "Your Wells Fargo savings holds $6,200 earning effectively nothing while Marcus pays 4.40% APY.",
    why: "At current rates, that's $269/yr in foregone interest — fully risk-free, FDIC insured either way.",
    action: "Move $6,200 from Wells Fargo Savings → Marcus HYSA. Keep checking buffer untouched.",
    impact: "+$269 / yr",
    impactValue: 269,
  },
  {
    id: "i2",
    severity: "high",
    category: "0% APR",
    title: "Underutilizing 0% APR window on Citi Custom Cash",
    what: "You have a 0% APR offer until Aug 2026 but are paying the balance early instead of parking cash in HYSA.",
    why: "Every $1,000 you defer at 0% earns ~$44/yr in HYSA. You have ~16 months of runway remaining.",
    action: "Pay only the minimum on Citi until Jul 2026. Move the difference to Marcus HYSA, then pay in full before promo ends.",
    impact: "+$420 over promo",
    impactValue: 420,
  },
  {
    id: "i3",
    severity: "medium",
    category: "Rewards",
    title: "Wrong card used for 38% of dining spend",
    what: "You spent $612 on dining last month on Sapphire Reserve (3x) but $387 went to Apple Card (1x).",
    why: "Amex Gold earns 4x on dining — switching that $387 nets ~$15/mo, $180/yr in extra rewards.",
    action: "Set Amex Gold as default for restaurants & food delivery. Update Apple Pay default.",
    impact: "+$180 / yr",
    impactValue: 180,
  },
  {
    id: "i4",
    severity: "medium",
    category: "Debt",
    title: "Auto loan APR (7.90%) exceeds your HYSA yield",
    what: "You hold $18,500 in emergency fund at 4.20% while paying 7.90% on a $9,200 auto loan.",
    why: "The spread costs ~$340/yr. Keeping 6 months of expenses ($28k) is prudent; excess cash isn't.",
    action: "Consider an extra $300/mo principal payment on auto loan — payoff accelerates by 14 months.",
    impact: "Save $890 in interest",
    impactValue: 890,
  },
  {
    id: "i5",
    severity: "low",
    category: "Rewards",
    title: "Grocery category not optimized",
    what: "$420/mo on groceries is split across 3 cards — none earn elevated grocery rewards.",
    why: "Amex Gold earns 4x at US supermarkets (up to $25k/yr). That's $200+/yr left on the table.",
    action: "Route all grocery spend to Amex Gold.",
    impact: "+$200 / yr",
    impactValue: 200,
  },
];

export interface SpendCategory {
  name: string;
  spent: number;
  budget: number;
  icon: LucideIcon;
  color: string;
}

export const spendCategories: SpendCategory[] = [
  { name: "Housing", spent: 2400, budget: 2500, icon: Home, color: "hsl(210 90% 65%)" },
  { name: "Groceries", spent: 612, budget: 700, icon: Utensils, color: "hsl(156 72% 55%)" },
  { name: "Dining", spent: 480, budget: 400, icon: Coffee, color: "hsl(38 92% 60%)" },
  { name: "Transport", spent: 295, budget: 350, icon: Car, color: "hsl(280 70% 65%)" },
  { name: "Shopping", spent: 542, budget: 400, icon: ShoppingBag, color: "hsl(4 78% 64%)" },
  { name: "Travel", spent: 320, budget: 500, icon: Plane, color: "hsl(190 80% 60%)" },
  { name: "Entertainment", spent: 142, budget: 200, icon: Film, color: "hsl(330 70% 65%)" },
  { name: "Utilities", spent: 218, budget: 250, icon: Zap, color: "hsl(50 90% 60%)" },
];

export const monthlySpendSeries = [
  { m: "Nov", spent: 4820, budget: 5300 },
  { m: "Dec", spent: 6240, budget: 5300 },
  { m: "Jan", spent: 4120, budget: 5300 },
  { m: "Feb", spent: 4680, budget: 5300 },
  { m: "Mar", spent: 5010, budget: 5300 },
  { m: "Apr", spent: 5009, budget: 5300 },
];

export const recentTransactions = [
  { id: "t1", merchant: "Whole Foods Market", category: "Groceries", card: "Amex Gold", amount: -84.20, date: "Today" },
  { id: "t2", merchant: "Salary — Acme Corp", category: "Income", card: "Chase Checking", amount: 6420.00, date: "Today" },
  { id: "t3", merchant: "Blue Bottle Coffee", category: "Dining", card: "Sapphire Reserve", amount: -7.50, date: "Yesterday" },
  { id: "t4", merchant: "Shell Gas Station", category: "Transport", card: "Citi Custom Cash", amount: -52.10, date: "Yesterday" },
  { id: "t5", merchant: "Amazon", category: "Shopping", card: "Apple Card", amount: -134.99, date: "2d ago" },
  { id: "t6", merchant: "Delta Airlines", category: "Travel", card: "Sapphire Reserve", amount: -412.00, date: "3d ago" },
  { id: "t7", merchant: "Pacific Gas & Electric", category: "Utilities", card: "Chase Checking", amount: -118.42, date: "3d ago" },
];

export const groupMeta: Record<AccountGroup, { label: string; description: string }> = {
  cash: { label: "Cash & Savings", description: "Liquid assets across checking and savings" },
  credit: { label: "Credit Cards", description: "Revolving credit and outstanding balances" },
  investments: { label: "Investments & Retirement", description: "Brokerage, retirement, and tax-advantaged" },
  liabilities: { label: "Loans & Liabilities", description: "Long-term debt obligations" },
};
