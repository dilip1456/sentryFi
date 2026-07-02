import {
  Wallet, PiggyBank, CreditCard, TrendingUp, Landmark, Banknote,
  Coffee, ShoppingBag, Car, Home, Utensils, Plane, Film, Zap,
  Heart, Sparkles, ShieldCheck, Briefcase, Tv, Music, Globe, Hotel,
  type LucideIcon,
} from "lucide-react";

export type AccountGroup = "cash" | "credit" | "investments" | "liabilities";

/**
 * Bucket: how this account participates in monthly cash flow
 *  - "liquid"     → counted in "What you have" (spendable now)
 *  - "longterm"   → assets, but locked / illiquid (retirement, etc.) - shown separately
 *  - "revolving"  → credit cards: full statement balance paid every month
 *  - "term"       → mortgage / auto / student loans: only the EMI affects monthly view
 */
export type Bucket = "liquid" | "longterm" | "revolving" | "term";

export interface Account {
  id: string;
  name: string;
  institution: string;
  group: AccountGroup;
  bucket: Bucket;
  balance: number;          // signed: positive for assets, negative for debt
  apr?: number;             // interest rate (positive earns, negative cost)
  limit?: number;           // for credit cards
  promo?: string;           // e.g. "0% APR until Aug 2026"
  trend30d: number;         // % change over 30d
  icon: LucideIcon;
  accent: "mint" | "sky" | "amber" | "coral" | "violet";
  last4?: string;
  // Term-loan specifics
  emi?: number;             // monthly payment (EMI)
  termMonthsLeft?: number;  // remaining term
  originalBalance?: number; // for progress bar
  // Revolving specifics
  statementDue?: number;    // current statement amount (the bill due this month)
  dueDay?: number;          // day of month payment is due
  // Operations
  isPayingAccount?: boolean; // primary checking that bills draft from
}

export const accounts: Account[] = [
  // CASH - liquid
  { id: "chk-1", name: "Everyday Checking", institution: "Chase", group: "cash", bucket: "liquid", balance: 8420.55, apr: 0.01, trend30d: -2.4, icon: Wallet, accent: "sky", last4: "4421", isPayingAccount: true },
  { id: "chk-2", name: "Joint Checking", institution: "Bank of America", group: "cash", bucket: "liquid", balance: 3120.10, apr: 0.01, trend30d: 1.1, icon: Wallet, accent: "sky", last4: "8830" },
  { id: "hys-1", name: "High-Yield Savings", institution: "Marcus", group: "cash", bucket: "liquid", balance: 42800.00, apr: 4.40, trend30d: 3.2, icon: PiggyBank, accent: "mint", last4: "1102" },
  { id: "hys-2", name: "Emergency Fund", institution: "Ally", group: "cash", bucket: "liquid", balance: 18500.00, apr: 4.20, trend30d: 0.9, icon: PiggyBank, accent: "mint", last4: "7745" },
  { id: "sav-1", name: "Local Savings", institution: "Wells Fargo", group: "cash", bucket: "liquid", balance: 6200.00, apr: 0.05, trend30d: 0.0, icon: Banknote, accent: "amber", last4: "3301" },

  // BROKERAGE - liquid investments (can be sold quickly)
  { id: "inv-3", name: "Brokerage", institution: "Schwab", group: "investments", bucket: "liquid", balance: 38420.50, apr: 7.2, trend30d: -0.8, icon: TrendingUp, accent: "sky", last4: "BRK1" },

  // INVESTMENTS - long-term / locked (not part of "what you have")
  { id: "inv-1", name: "401(k)", institution: "Fidelity", group: "investments", bucket: "longterm", balance: 184320.00, apr: 8.4, trend30d: 2.1, icon: TrendingUp, accent: "mint", last4: "K401" },
  { id: "inv-2", name: "Roth IRA", institution: "Vanguard", group: "investments", bucket: "longterm", balance: 62150.00, apr: 9.1, trend30d: 1.8, icon: TrendingUp, accent: "mint", last4: "ROTH" },
  { id: "inv-4", name: "HSA", institution: "Lively", group: "investments", bucket: "longterm", balance: 14200.00, apr: 6.5, trend30d: 1.3, icon: Landmark, accent: "amber", last4: "HSA0" },

  // CREDIT - revolving (paid in full monthly)
  { id: "cc-1", name: "Sapphire Reserve", institution: "Chase", group: "credit", bucket: "revolving", balance: -2840.22, apr: 22.49, limit: 25000, trend30d: 18.0, icon: CreditCard, accent: "violet", last4: "9921", statementDue: 2840.22, dueDay: 15 },
  { id: "cc-2", name: "Amex Gold", institution: "American Express", group: "credit", bucket: "revolving", balance: -1120.40, apr: 24.99, limit: 15000, trend30d: -12.0, icon: CreditCard, accent: "amber", last4: "1004", statementDue: 1120.40, dueDay: 22 },
  { id: "cc-3", name: "Citi Custom Cash", institution: "Citi", group: "credit", bucket: "revolving", balance: -480.10, apr: 0, limit: 8000, promo: "0% APR until Aug 2026", trend30d: 6.0, icon: CreditCard, accent: "mint", last4: "5520", statementDue: 25.00, dueDay: 8 },
  { id: "cc-4", name: "Apple Card", institution: "Goldman Sachs", group: "credit", bucket: "revolving", balance: -210.55, apr: 19.24, limit: 10000, trend30d: -3.0, icon: CreditCard, accent: "sky", last4: "8801", statementDue: 210.55, dueDay: 30 },

  // LIABILITIES - term loans (only EMI shows in monthly)
  { id: "lo-1", name: "Mortgage", institution: "Rocket", group: "liabilities", bucket: "term", balance: -312400.00, apr: 6.75, trend30d: -0.2, icon: Home, accent: "coral", last4: "MTG0", emi: 2480, termMonthsLeft: 322, originalBalance: 360000 },
  { id: "lo-2", name: "Student Loan", institution: "Nelnet", group: "liabilities", bucket: "term", balance: -18420.00, apr: 5.50, trend30d: -1.1, icon: Landmark, accent: "coral", last4: "EDU2", emi: 320, termMonthsLeft: 68, originalBalance: 42000 },
  { id: "lo-3", name: "Auto Loan", institution: "Ally", group: "liabilities", bucket: "term", balance: -9200.00, apr: 7.90, trend30d: -2.0, icon: Car, accent: "amber", last4: "AUTO", emi: 415, termMonthsLeft: 24, originalBalance: 24000 },
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
    why: "At current rates, that's $269/yr in foregone interest - fully risk-free, FDIC insured either way.",
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
    why: "Amex Gold earns 4x on dining - switching that $387 nets ~$15/mo, $180/yr in extra rewards.",
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
    action: "Consider an extra $300/mo principal payment on auto loan - payoff accelerates by 14 months.",
    impact: "Save $890 in interest",
    impactValue: 890,
  },
  {
    id: "i5",
    severity: "low",
    category: "Rewards",
    title: "Grocery category not optimized",
    what: "$420/mo on groceries is split across 3 cards - none earn elevated grocery rewards.",
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
  { id: "t2", merchant: "Salary - Acme Corp", category: "Income", card: "Chase Checking", amount: 6420.00, date: "Today" },
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

export const bucketMeta: Record<Bucket, { label: string; sub: string; tone: "positive" | "negative" | "info" | "warning" }> = {
  liquid:    { label: "Accounts & Savings",    sub: "Available cash and brokerage",          tone: "positive" },
  longterm:  { label: "Long-term Investments", sub: "Retirement & HSA - held for the future", tone: "info" },
  revolving: { label: "Credit Cards",          sub: "Statements paid in full each month",    tone: "warning" },
  term:      { label: "Loans & Mortgages",     sub: "Only the monthly payment affects cash flow", tone: "negative" },
};

// Recurring monthly subscriptions / fixed bills (non-loan)
export interface Subscription {
  id: string;
  name: string;
  category: string;
  amount: number;
  card: string;
  icon: LucideIcon;
}

export const subscriptions: Subscription[] = [
  { id: "s1", name: "Rent / HOA add-ons", category: "Housing", amount: 220, card: "Chase Checking", icon: Home },
  { id: "s2", name: "Netflix", category: "Entertainment", amount: 22.99, card: "Apple Card", icon: Film },
  { id: "s3", name: "Spotify Family", category: "Entertainment", amount: 16.99, card: "Apple Card", icon: Film },
  { id: "s4", name: "PG&E (avg)", category: "Utilities", amount: 142, card: "Chase Checking", icon: Zap },
  { id: "s5", name: "Internet - Xfinity", category: "Utilities", amount: 79, card: "Citi Custom Cash", icon: Zap },
  { id: "s6", name: "Phone - T-Mobile", category: "Utilities", amount: 85, card: "Apple Card", icon: Zap },
  { id: "s7", name: "Gym membership", category: "Health", amount: 45, card: "Amex Gold", icon: Heart },
  { id: "s8", name: "iCloud + ChatGPT", category: "Software", amount: 32, card: "Apple Card", icon: Sparkles },
];

/* =================================================================
 * BENEFITS - credit-card perks tracking
 * ================================================================= */
export type BenefitStatus = "unused" | "partial" | "used" | "expiring";
export interface CardBenefit {
  id: string;
  cardId: string;       // matches Account.id
  cardName: string;
  name: string;
  category: "Travel" | "Dining" | "Entertainment" | "Shopping" | "Lifestyle" | "Protection";
  value: number;        // $ value per cycle
  cycle: "monthly" | "quarterly" | "annual";
  used: number;         // how much already redeemed this cycle
  resetDate: string;    // human-readable
  status: BenefitStatus;
  icon: LucideIcon;
  how: string;          // how to redeem
}

export const cardBenefits: CardBenefit[] = [
  { id: "b1",  cardId: "cc-1", cardName: "Sapphire Reserve", name: "TSA PreCheck / Global Entry", category: "Travel",       value: 100, cycle: "annual",    used: 0,   resetDate: "Renews Jul 2027", status: "unused",   icon: ShieldCheck, how: "Pay $100 application fee with card - auto-reimbursed in 1-2 cycles." },
  { id: "b2",  cardId: "cc-1", cardName: "Sapphire Reserve", name: "DoorDash DashPass + $5/mo credit", category: "Dining",   value: 5,   cycle: "monthly",   used: 0,   resetDate: "Resets May 1",    status: "unused",   icon: Utensils,    how: "Auto-applied to next DoorDash order. Activate DashPass in Chase portal." },
  { id: "b3",  cardId: "cc-1", cardName: "Sapphire Reserve", name: "Travel credit",            category: "Travel",       value: 300, cycle: "annual",    used: 180, resetDate: "Renews Sep 2026", status: "partial",  icon: Plane,       how: "Auto-applied to first $300 of travel charges per cardmember year." },
  { id: "b4",  cardId: "cc-1", cardName: "Sapphire Reserve", name: "Priority Pass lounges",     category: "Travel",       value: 469, cycle: "annual",    used: 469, resetDate: "Active",          status: "used",     icon: Globe,       how: "Enroll in Priority Pass via Chase. Use at 1,300+ lounges worldwide." },
  { id: "b5",  cardId: "cc-2", cardName: "Amex Gold",        name: "Uber Cash",                 category: "Travel",       value: 10,  cycle: "monthly",   used: 0,   resetDate: "Resets May 1",    status: "expiring", icon: Car,         how: "Add Amex Gold to Uber wallet - credit auto-applies to next ride/Eats." },
  { id: "b6",  cardId: "cc-2", cardName: "Amex Gold",        name: "Dining credit (Grubhub, Resy)", category: "Dining",  value: 10,  cycle: "monthly",   used: 0,   resetDate: "Resets May 1",    status: "expiring", icon: Utensils,    how: "Enroll once in Amex Offers. Use card at Grubhub, Resy, Goldbelly, Cheesecake Factory, etc." },
  { id: "b7",  cardId: "cc-2", cardName: "Amex Gold",        name: "Resy dining credit",        category: "Dining",       value: 50,  cycle: "quarterly", used: 25,  resetDate: "Resets Jun 30",   status: "partial",  icon: Utensils,    how: "Use Amex Gold at any Resy-listed restaurant." },
  { id: "b8",  cardId: "cc-4", cardName: "Apple Card",       name: "Daily Cash on Apple Pay",   category: "Shopping",     value: 0,   cycle: "monthly",   used: 0,   resetDate: "Always on",       status: "used",     icon: ShoppingBag, how: "Get 2% back on every Apple Pay purchase, 3% on Apple/select merchants." },
  { id: "b9",  cardId: "cc-3", cardName: "Citi Custom Cash", name: "5% top spend category",     category: "Lifestyle",    value: 25,  cycle: "monthly",   used: 25,  resetDate: "On gas this cycle", status: "used",   icon: Sparkles,    how: "Auto-detects highest eligible category up to $500/mo." },
  { id: "b10", cardId: "cc-1", cardName: "Sapphire Reserve", name: "Peloton membership credit", category: "Entertainment", value: 10, cycle: "monthly",   used: 0,   resetDate: "Resets May 1",    status: "unused",   icon: Heart,       how: "Use Sapphire Reserve for Peloton App / All-Access membership." },
];

/* =================================================================
 * REFINANCE - opportunity analysis
 * ================================================================= */
export interface RefinanceOption {
  id: string;
  loanId: string;       // matches Account.id
  loanName: string;
  currentRate: number;
  offeredRate: number;
  lender: string;
  closingCost: number;
  monthsToBreakeven: number;
  monthlySavings: number;
  lifetimeSavings: number;
  recommendation: "strong" | "consider" | "skip";
  notes: string;
}

export const refinanceOptions: RefinanceOption[] = [
  { id: "rf1", loanId: "lo-1", loanName: "Mortgage",     currentRate: 6.75, offeredRate: 5.85, lender: "Better.com",      closingCost: 4200, monthsToBreakeven: 22, monthlySavings: 188, lifetimeSavings: 38600, recommendation: "strong",   notes: "Rate has dropped 0.9pp since origination. Breakeven inside 2 years - strong refinance candidate." },
  { id: "rf2", loanId: "lo-3", loanName: "Auto Loan",    currentRate: 7.90, offeredRate: 6.40, lender: "LightStream",     closingCost: 0,    monthsToBreakeven: 0,  monthlySavings: 24,  lifetimeSavings: 580,   recommendation: "consider", notes: "No closing cost. Modest monthly savings but instant payback." },
  { id: "rf3", loanId: "lo-2", loanName: "Student Loan", currentRate: 5.50, offeredRate: 5.20, lender: "SoFi",            closingCost: 0,    monthsToBreakeven: 0,  monthlySavings: 6,   lifetimeSavings: 410,   recommendation: "skip",     notes: "Refinancing federal loans forfeits IDR / forgiveness protections. Skip unless certain." },
];

/* =================================================================
 * DEALS - cross-card cashback offers (Amex Offers, Chase Offers, etc.)
 * ================================================================= */
export type DealKind = "cashback" | "points" | "statement";
export interface CardOffer {
  id: string;
  merchant: string;
  category: "Travel" | "Dining" | "Shopping" | "Streaming" | "Lifestyle";
  cardId: string;
  cardName: string;
  reward: string;        // e.g. "10% back" or "5x points"
  rewardValue: number;   // estimated $ value if you spend `minSpend`
  minSpend: number;
  expires: string;
  optedIn: boolean;
  kind: DealKind;
  icon: LucideIcon;
  source: "Amex Offers" | "Chase Offers" | "Citi Merchant" | "Apple Card";
};

export const cardOffers: CardOffer[] = [
  { id: "o1",  merchant: "Delta Air Lines",  category: "Travel",    cardId: "cc-1", cardName: "Sapphire Reserve", reward: "5x points",     rewardValue: 75,  minSpend: 300, expires: "May 30",  optedIn: true,  kind: "points",    icon: Plane,       source: "Chase Offers" },
  { id: "o2",  merchant: "Marriott Bonvoy",  category: "Travel",    cardId: "cc-2", cardName: "Amex Gold",        reward: "$50 back",      rewardValue: 50,  minSpend: 250, expires: "Jun 15",  optedIn: false, kind: "statement", icon: Hotel,       source: "Amex Offers" },
  { id: "o3",  merchant: "Whole Foods",      category: "Shopping",  cardId: "cc-2", cardName: "Amex Gold",        reward: "10% back",      rewardValue: 30,  minSpend: 300, expires: "May 12",  optedIn: false, kind: "cashback",  icon: ShoppingBag, source: "Amex Offers" },
  { id: "o4",  merchant: "Uber Eats",        category: "Dining",    cardId: "cc-2", cardName: "Amex Gold",        reward: "20% back",      rewardValue: 20,  minSpend: 100, expires: "May 8",   optedIn: true,  kind: "cashback",  icon: Utensils,    source: "Amex Offers" },
  { id: "o5",  merchant: "Apple Store",      category: "Shopping",  cardId: "cc-4", cardName: "Apple Card",       reward: "3% back",       rewardValue: 30,  minSpend: 1000, expires: "Always", optedIn: true,  kind: "cashback",  icon: ShoppingBag, source: "Apple Card" },
  { id: "o6",  merchant: "Netflix",          category: "Streaming", cardId: "cc-3", cardName: "Citi Custom Cash", reward: "5% back",       rewardValue: 1.5, minSpend: 23,  expires: "Always",  optedIn: false, kind: "cashback",  icon: Tv,          source: "Citi Merchant" },
  { id: "o7",  merchant: "Spotify",          category: "Streaming", cardId: "cc-2", cardName: "Amex Gold",        reward: "$5 back",       rewardValue: 5,   minSpend: 17,  expires: "Jun 30",  optedIn: false, kind: "statement", icon: Music,       source: "Amex Offers" },
  { id: "o8",  merchant: "Best Buy",         category: "Shopping",  cardId: "cc-1", cardName: "Sapphire Reserve", reward: "$25 back",      rewardValue: 25,  minSpend: 200, expires: "May 22",  optedIn: false, kind: "statement", icon: ShoppingBag, source: "Chase Offers" },
  { id: "o9",  merchant: "Hilton Hotels",    category: "Travel",    cardId: "cc-1", cardName: "Sapphire Reserve", reward: "10% back",      rewardValue: 60,  minSpend: 600, expires: "Jun 30",  optedIn: false, kind: "cashback",  icon: Hotel,       source: "Chase Offers" },
  { id: "o10", merchant: "Sephora",          category: "Shopping",  cardId: "cc-2", cardName: "Amex Gold",        reward: "15% back",      rewardValue: 22,  minSpend: 150, expires: "May 18",  optedIn: false, kind: "cashback",  icon: ShoppingBag, source: "Amex Offers" },
  { id: "o11", merchant: "Lyft",             category: "Travel",    cardId: "cc-1", cardName: "Sapphire Reserve", reward: "5x + $10 cred", rewardValue: 18,  minSpend: 50,  expires: "Always",  optedIn: true,  kind: "points",    icon: Car,         source: "Chase Offers" },
  { id: "o12", merchant: "DoorDash",         category: "Dining",    cardId: "cc-1", cardName: "Sapphire Reserve", reward: "$5 monthly",    rewardValue: 5,   minSpend: 12,  expires: "Monthly", optedIn: true,  kind: "statement", icon: Utensils,    source: "Chase Offers" },
];

/* Best card recommendation per spend category */
export const bestCardByCategory: Record<string, { cardId: string; cardName: string; rate: string; note: string }> = {
  Dining:        { cardId: "cc-2", cardName: "Amex Gold",        rate: "4x points",   note: "Best at restaurants, takeout, delivery" },
  Groceries:     { cardId: "cc-2", cardName: "Amex Gold",        rate: "4x (≤ $25k/yr)", note: "US supermarkets only" },
  Travel:        { cardId: "cc-1", cardName: "Sapphire Reserve", rate: "3x + $300 cr", note: "Includes lounges + Global Entry" },
  Gas:           { cardId: "cc-3", cardName: "Citi Custom Cash", rate: "5% back",     note: "Top 5% category - can target gas" },
  Streaming:     { cardId: "cc-3", cardName: "Citi Custom Cash", rate: "5% back",     note: "If selected as monthly top category" },
  Shopping:      { cardId: "cc-4", cardName: "Apple Card",       rate: "2-3% back",   note: "Apple Pay everywhere" },
  Entertainment: { cardId: "cc-1", cardName: "Sapphire Reserve", rate: "3x points",   note: "Includes streaming + Peloton credit" },
};

/* =================================================================
 * UPCOMING - scheduled outflows in the next ~14 days
 * ================================================================= */
export interface UpcomingTx {
  id: string;
  label: string;
  category: "Card payment" | "Loan payment" | "Subscription" | "Bill" | "Pool transfer";
  amount: number;        // positive number; always an outflow
  date: string;          // human-friendly
  daysAway: number;
  fromAccountId: string; // which account it drafts from
  icon: LucideIcon;
}

export const upcomingTransactions: UpcomingTx[] = [
  { id: "u1", label: "Apple Card statement",     category: "Card payment",   amount: 210.55,  date: "Apr 30", daysAway: 0, fromAccountId: "chk-1", icon: CreditCard },
  { id: "u2", label: "Mortgage EMI",             category: "Loan payment",   amount: 2480.00, date: "May 1",  daysAway: 1, fromAccountId: "chk-1", icon: Home },
  { id: "u3", label: "Pool transfer → HYSA",     category: "Pool transfer",  amount: 1725.00, date: "May 1",  daysAway: 1, fromAccountId: "chk-1", icon: PiggyBank },
  { id: "u4", label: "PG&E electricity",         category: "Bill",           amount: 142.00,  date: "May 3",  daysAway: 3, fromAccountId: "chk-1", icon: Zap },
  { id: "u5", label: "Auto loan EMI",            category: "Loan payment",   amount: 415.00,  date: "May 5",  daysAway: 5, fromAccountId: "chk-1", icon: Car },
  { id: "u6", label: "Citi Custom Cash min pay", category: "Card payment",   amount: 25.00,   date: "May 8",  daysAway: 8, fromAccountId: "chk-1", icon: CreditCard },
  { id: "u7", label: "Netflix",                  category: "Subscription",   amount: 22.99,   date: "May 9",  daysAway: 9, fromAccountId: "chk-1", icon: Tv },
  { id: "u8", label: "Sapphire Reserve statement", category: "Card payment", amount: 2840.22, date: "May 15", daysAway: 15, fromAccountId: "chk-1", icon: CreditCard },
];

/* =================================================================
 * ACTIONABLE ITEMS - things that need a decision now
 * ================================================================= */
export type ActionPriority = "urgent" | "soon" | "info";
export interface ActionItem {
  id: string;
  priority: ActionPriority;
  title: string;
  detail: string;
  cta: string;
  icon: LucideIcon;
}

export const actionItems: ActionItem[] = [
  { id: "a1", priority: "urgent", title: "Fund your paying account",          detail: "Chase Checking will fall short of next 14 days of bills. Move funds from Marcus HYSA.", cta: "Move $4,200", icon: Wallet },
  { id: "a2", priority: "urgent", title: "Amex Gold credits expire May 1",   detail: "$10 Uber Cash + $10 dining credit reset in 1 day - use them before they're gone.",       cta: "Use credits",  icon: Sparkles },
  { id: "a3", priority: "soon",   title: "Sapphire Reserve statement due",   detail: "$2,840 due May 15 - autopay set, but verify funds are available.",                       cta: "Verify",       icon: CreditCard },
  { id: "a4", priority: "soon",   title: "Refinance mortgage saves $188/mo", detail: "Better.com offers 5.85% vs your 6.75%. Breakeven in 22 months.",                          cta: "Review",       icon: Home },
  { id: "a5", priority: "info",   title: "Idle cash at 0.05% APY",           detail: "$6,200 in Wells Fargo Savings could earn $269/yr at Marcus.",                            cta: "Move funds",   icon: PiggyBank },
];

/* =================================================================
 * DEMO DATA - Plaid-shaped accounts and transactions for demo mode
 * ================================================================= */
export interface DemoPAccount {
  id: string; account_id: string; name: string | null; official_name: string | null;
  mask: string | null; type: string | null; subtype: string | null;
  current_balance: number | null; available_balance: number | null; iso_currency_code: string | null;
  item_id: string;
}

export const demoAccounts: DemoPAccount[] = [
  { id: "da1", account_id: "da1", name: "Everyday Checking", official_name: "Chase Total Checking", mask: "4421", type: "depository", subtype: "checking", current_balance: 8420.55, available_balance: 8320.55, iso_currency_code: "USD", item_id: "di1" },
  { id: "da2", account_id: "da2", name: "High-Yield Savings", official_name: "Marcus High-Yield Savings", mask: "1102", type: "depository", subtype: "savings", current_balance: 42800.00, available_balance: 42800.00, iso_currency_code: "USD", item_id: "di1" },
  { id: "da3", account_id: "da3", name: "Emergency Fund", official_name: "Ally Online Savings", mask: "7745", type: "depository", subtype: "savings", current_balance: 18500.00, available_balance: 18500.00, iso_currency_code: "USD", item_id: "di2" },
  { id: "da4", account_id: "da4", name: "Sapphire Reserve", official_name: "Chase Sapphire Reserve", mask: "9921", type: "credit", subtype: "credit card", current_balance: 2840.22, available_balance: 22159.78, iso_currency_code: "USD", item_id: "di1" },
  { id: "da5", account_id: "da5", name: "Amex Gold", official_name: "American Express Gold Card", mask: "1004", type: "credit", subtype: "credit card", current_balance: 1120.40, available_balance: 13879.60, iso_currency_code: "USD", item_id: "di3" },
  { id: "da6", account_id: "da6", name: "Brokerage", official_name: "Schwab One Brokerage", mask: "BRK1", type: "investment", subtype: "brokerage", current_balance: 38420.50, available_balance: null, iso_currency_code: "USD", item_id: "di2" },
  { id: "da7", account_id: "da7", name: "401(k)", official_name: "Fidelity NetBenefits 401k", mask: "K401", type: "investment", subtype: "401k", current_balance: 184320.00, available_balance: null, iso_currency_code: "USD", item_id: "di2" },
  { id: "da8", account_id: "da8", name: "Auto Loan", official_name: "Ally Auto Loan", mask: "AUTO", type: "loan", subtype: "auto", current_balance: 9200.00, available_balance: null, iso_currency_code: "USD", item_id: "di2" },
];

export const demoItems = [
  { id: "di1", item_id: "plaid_item_chase", institution_id: "ins_3", institution_name: "Chase" },
  { id: "di2", item_id: "plaid_item_ally", institution_id: "ins_7", institution_name: "Ally" },
  { id: "di3", item_id: "plaid_item_amex", institution_id: "ins_10", institution_name: "American Express" },
];

// 60 demo transactions spread across the last 3 months
const today = new Date();
const d = (daysAgo: number) => new Date(today.getTime() - daysAgo * 86400000).toISOString().slice(0, 10);
export const demoTransactions = [
  { id: "dt1",  account_id: "da4", amount: 86.42,  date: d(1),  name: "Whole Foods Market", merchant_name: "Whole Foods", category: ["Groceries"], pending: false, payment_channel: "in store" },
  { id: "dt2",  account_id: "da4", amount: 52.18,  date: d(1),  name: "Uber Eats", merchant_name: "Uber Eats", category: ["Food & Drink"], pending: false, payment_channel: "online" },
  { id: "dt3",  account_id: "da1", amount: -5240.00, date: d(2), name: "Direct Deposit - Employer", merchant_name: null, category: ["Salary"], pending: false, payment_channel: "other" },
  { id: "dt4",  account_id: "da5", amount: 34.50,  date: d(2),  name: "Starbucks", merchant_name: "Starbucks", category: ["Food & Drink"], pending: false, payment_channel: "in store" },
  { id: "dt5",  account_id: "da4", amount: 128.00, date: d(3),  name: "Con Edison", merchant_name: "Con Edison", category: ["Bills & Utilities"], pending: false, payment_channel: "online" },
  { id: "dt6",  account_id: "da5", amount: 19.99,  date: d(3),  name: "Netflix", merchant_name: "Netflix", category: ["Entertainment"], pending: false, payment_channel: "online" },
  { id: "dt7",  account_id: "da4", amount: 67.80,  date: d(4),  name: "Shell", merchant_name: "Shell", category: ["Transportation"], pending: false, payment_channel: "in store" },
  { id: "dt8",  account_id: "da4", amount: 214.30, date: d(5),  name: "Amazon.com", merchant_name: "Amazon", category: ["Shopping"], pending: false, payment_channel: "online" },
  { id: "dt9",  account_id: "da5", amount: 88.00,  date: d(5),  name: "Cheesecake Factory", merchant_name: "Cheesecake Factory", category: ["Food & Drink"], pending: false, payment_channel: "in store" },
  { id: "dt10", account_id: "da4", amount: 15.00,  date: d(6),  name: "Spotify", merchant_name: "Spotify", category: ["Entertainment"], pending: false, payment_channel: "online" },
  { id: "dt11", account_id: "da1", amount: 48.00,  date: d(7),  name: "Verizon Wireless", merchant_name: "Verizon", category: ["Bills & Utilities"], pending: false, payment_channel: "online" },
  { id: "dt12", account_id: "da4", amount: 320.00, date: d(8),  name: "Best Buy", merchant_name: "Best Buy", category: ["Shopping"], pending: false, payment_channel: "in store" },
  { id: "dt13", account_id: "da5", amount: 22.50,  date: d(9),  name: "Chipotle", merchant_name: "Chipotle", category: ["Food & Drink"], pending: false, payment_channel: "in store" },
  { id: "dt14", account_id: "da1", amount: 2480.00, date: d(10), name: "Rocket Mortgage", merchant_name: "Rocket Mortgage", category: ["Bills & Utilities"], pending: false, payment_channel: "online" },
  { id: "dt15", account_id: "da4", amount: 42.00,  date: d(11), name: "Uber", merchant_name: "Uber", category: ["Transportation"], pending: false, payment_channel: "online" },
  { id: "dt16", account_id: "da4", amount: 156.00, date: d(12), name: "Trader Joe's", merchant_name: "Trader Joe's", category: ["Groceries"], pending: false, payment_channel: "in store" },
  { id: "dt17", account_id: "da5", amount: 89.99,  date: d(13), name: "Apple.com", merchant_name: "Apple", category: ["Shopping"], pending: false, payment_channel: "online" },
  { id: "dt18", account_id: "da4", amount: 14.99,  date: d(14), name: "Disney+", merchant_name: "Disney+", category: ["Entertainment"], pending: false, payment_channel: "online" },
  { id: "dt19", account_id: "da1", amount: -5240.00, date: d(16), name: "Direct Deposit - Employer", merchant_name: null, category: ["Salary"], pending: false, payment_channel: "other" },
  { id: "dt20", account_id: "da4", amount: 62.14,  date: d(17), name: "CVS Pharmacy", merchant_name: "CVS", category: ["Healthcare"], pending: false, payment_channel: "in store" },
  { id: "dt21", account_id: "da5", amount: 74.80,  date: d(18), name: "Olive Garden", merchant_name: "Olive Garden", category: ["Food & Drink"], pending: false, payment_channel: "in store" },
  { id: "dt22", account_id: "da4", amount: 180.00, date: d(19), name: "T-Mobile", merchant_name: "T-Mobile", category: ["Bills & Utilities"], pending: false, payment_channel: "online" },
  { id: "dt23", account_id: "da4", amount: 56.20,  date: d(20), name: "Exxon", merchant_name: "Exxon", category: ["Transportation"], pending: false, payment_channel: "in store" },
  { id: "dt24", account_id: "da5", amount: 124.00, date: d(21), name: "Target", merchant_name: "Target", category: ["Shopping"], pending: false, payment_channel: "in store" },
  { id: "dt25", account_id: "da1", amount: 415.00, date: d(22), name: "Ally Auto Loan", merchant_name: "Ally", category: ["Bills & Utilities"], pending: false, payment_channel: "online" },
  { id: "dt26", account_id: "da4", amount: 45.00,  date: d(23), name: "Lyft", merchant_name: "Lyft", category: ["Transportation"], pending: false, payment_channel: "online" },
  { id: "dt27", account_id: "da4", amount: 98.40,  date: d(24), name: "Wegmans", merchant_name: "Wegmans", category: ["Groceries"], pending: false, payment_channel: "in store" },
  { id: "dt28", account_id: "da5", amount: 13.99,  date: d(25), name: "Hulu", merchant_name: "Hulu", category: ["Entertainment"], pending: false, payment_channel: "online" },
  { id: "dt29", account_id: "da4", amount: 240.00, date: d(26), name: "Nordstrom", merchant_name: "Nordstrom", category: ["Shopping"], pending: false, payment_channel: "in store" },
  { id: "dt30", account_id: "da1", amount: -5240.00, date: d(30), name: "Direct Deposit - Employer", merchant_name: null, category: ["Salary"], pending: false, payment_channel: "other" },
  { id: "dt31", account_id: "da4", amount: 32.00,  date: d(31), name: "DoorDash", merchant_name: "DoorDash", category: ["Food & Drink"], pending: false, payment_channel: "online" },
  { id: "dt32", account_id: "da4", amount: 280.00, date: d(32), name: "Comcast", merchant_name: "Comcast", category: ["Bills & Utilities"], pending: false, payment_channel: "online" },
  { id: "dt33", account_id: "da5", amount: 55.00,  date: d(33), name: "Panera Bread", merchant_name: "Panera", category: ["Food & Drink"], pending: false, payment_channel: "in store" },
  { id: "dt34", account_id: "da4", amount: 189.00, date: d(34), name: "Nike.com", merchant_name: "Nike", category: ["Shopping"], pending: false, payment_channel: "online" },
  { id: "dt35", account_id: "da4", amount: 77.30,  date: d(35), name: "BP", merchant_name: "BP", category: ["Transportation"], pending: false, payment_channel: "in store" },
  { id: "dt36", account_id: "da5", amount: 42.50,  date: d(36), name: "Sephora", merchant_name: "Sephora", category: ["Personal Care"], pending: false, payment_channel: "in store" },
  { id: "dt37", account_id: "da4", amount: 320.00, date: d(37), name: "Nelnet Student Loan", merchant_name: "Nelnet", category: ["Bills & Utilities"], pending: false, payment_channel: "online" },
  { id: "dt38", account_id: "da1", amount: -420.00, date: d(38), name: "Freelance Payment - Client", merchant_name: null, category: ["Freelance Income"], pending: false, payment_channel: "other" },
  { id: "dt39", account_id: "da4", amount: 68.00,  date: d(39), name: "The Home Depot", merchant_name: "Home Depot", category: ["Shopping"], pending: false, payment_channel: "in store" },
  { id: "dt40", account_id: "da5", amount: 110.00, date: d(40), name: "Chewy.com", merchant_name: "Chewy", category: ["Shopping"], pending: false, payment_channel: "online" },
  { id: "dt41", account_id: "da4", amount: 48.00,  date: d(45), name: "Planet Fitness", merchant_name: "Planet Fitness", category: ["Personal Care"], pending: false, payment_channel: "other" },
  { id: "dt42", account_id: "da1", amount: -5240.00, date: d(46), name: "Direct Deposit - Employer", merchant_name: null, category: ["Salary"], pending: false, payment_channel: "other" },
  { id: "dt43", account_id: "da4", amount: 92.00,  date: d(47), name: "Kroger", merchant_name: "Kroger", category: ["Groceries"], pending: false, payment_channel: "in store" },
  { id: "dt44", account_id: "da5", amount: 280.00, date: d(48), name: "United Airlines", merchant_name: "United", category: ["Travel"], pending: false, payment_channel: "online" },
  { id: "dt45", account_id: "da4", amount: 160.00, date: d(50), name: "Hilton Hotels", merchant_name: "Hilton", category: ["Travel"], pending: false, payment_channel: "online" },
  { id: "dt46", account_id: "da4", amount: 35.00,  date: d(52), name: "McDonald's", merchant_name: "McDonald's", category: ["Food & Drink"], pending: false, payment_channel: "in store" },
  { id: "dt47", account_id: "da5", amount: 95.40,  date: d(54), name: "Costco Wholesale", merchant_name: "Costco", category: ["Groceries"], pending: false, payment_channel: "in store" },
  { id: "dt48", account_id: "da4", amount: 420.00, date: d(56), name: "Amazon Prime", merchant_name: "Amazon", category: ["Shopping"], pending: false, payment_channel: "online" },
  { id: "dt49", account_id: "da1", amount: 85.00,  date: d(58), name: "Dr. Smith - Copay", merchant_name: null, category: ["Healthcare"], pending: false, payment_channel: "other" },
  { id: "dt50", account_id: "da4", amount: 18.99,  date: d(60), name: "Apple TV+", merchant_name: "Apple", category: ["Entertainment"], pending: false, payment_channel: "online" },
  { id: "dt51", account_id: "da1", amount: -5240.00, date: d(62), name: "Direct Deposit - Employer", merchant_name: null, category: ["Salary"], pending: false, payment_channel: "other" },
  { id: "dt52", account_id: "da4", amount: 46.00,  date: d(63), name: "Chick-fil-A", merchant_name: "Chick-fil-A", category: ["Food & Drink"], pending: false, payment_channel: "in store" },
  { id: "dt53", account_id: "da5", amount: 230.00, date: d(65), name: "REI", merchant_name: "REI", category: ["Shopping"], pending: false, payment_channel: "in store" },
  { id: "dt54", account_id: "da4", amount: 72.00,  date: d(67), name: "Publix", merchant_name: "Publix", category: ["Groceries"], pending: false, payment_channel: "in store" },
  { id: "dt55", account_id: "da4", amount: 39.99,  date: d(69), name: "YouTube Premium", merchant_name: "Google", category: ["Entertainment"], pending: false, payment_channel: "online" },
  { id: "dt56", account_id: "da1", amount: -200.00, date: d(70), name: "Interest & Dividends - Marcus", merchant_name: null, category: ["Interest & Dividends"], pending: false, payment_channel: "other" },
  { id: "dt57", account_id: "da5", amount: 145.00, date: d(72), name: "Macy's", merchant_name: "Macy's", category: ["Shopping"], pending: false, payment_channel: "in store" },
  { id: "dt58", account_id: "da4", amount: 68.40,  date: d(75), name: "Sunoco", merchant_name: "Sunoco", category: ["Transportation"], pending: false, payment_channel: "in store" },
  { id: "dt59", account_id: "da1", amount: -5240.00, date: d(76), name: "Direct Deposit - Employer", merchant_name: null, category: ["Salary"], pending: false, payment_channel: "other" },
  { id: "dt60", account_id: "da5", amount: 310.00, date: d(80), name: "Southwest Airlines", merchant_name: "Southwest", category: ["Travel"], pending: false, payment_channel: "online" },
];
