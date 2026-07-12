import { useEffect, useState, useCallback, useRef, Fragment, useMemo } from "react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, rectSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { TouchSensor } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { supabase } from "@/integrations/supabase/client";
import { usePlaidLink, PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { useAuth } from "@/contexts/AuthContext";
import { useCountUp } from "@/hooks/useCountUp";
import { useUserSettings } from "@/hooks/useUserSettings";
import { ROLE_META, type AccountRole } from "@/hooks/useAccountRoles";
import { type CategoryRule, type RuleMatchType } from "@/hooks/useCategoryRules";
import { CategoryManager } from "@/components/finance/CategoryManager";
import {
  type Condition, type ConditionSet, type SmartRule, type RuleAction, type TxnField, type TxnOp, type EvalTxn,
  FIELD_META, OP_LABEL, evaluateSet, ruleMatches, emptyCondition, emptyRule,
} from "@/lib/txn-rules";
import { fmtUSD } from "@/lib/format";
import { demoAccounts, demoItems, demoTransactions } from "@/lib/finance-data";
import {
  Loader2, Plus, CreditCard, Landmark, TrendingUp, TrendingDown, Home,
  ShoppingBag, ShoppingCart, Utensils, Car, Zap, Plane, Film, Heart, Coffee,
  ArrowDownLeft, ArrowUpRight, Wallet, ArrowRight, Check, Sparkles, Coins, PiggyBank,
  AlertTriangle, ChevronRight, ChevronDown, Lock, X,
  Pencil, Search, Trash2, ExternalLink, Tag, Calendar, Unlink,
  ChevronLeft, RefreshCw, RepeatIcon, Receipt, ArrowUpDown, EyeOff, Eye, GripVertical,
  Compass, ShieldAlert, Target, ThumbsUp, ThumbsDown,
  ArrowRightLeft, CalendarClock, Info, DollarSign, User, BookOpen,
  SlidersHorizontal, Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// ── Types ──────────────────────────────────────────────────────
type PAccount = {
  id: string; account_id: string; name: string | null; official_name: string | null;
  mask: string | null; type: string | null; subtype: string | null;
  current_balance: number | null; available_balance: number | null; iso_currency_code: string | null;
};
type PTxn = {
  id: string; account_id: string; item_id: string | null; transaction_id: string | null;
  amount: number; date: string; authorized_date: string | null;
  name: string | null; merchant_name: string | null; category: string[] | null;
  pending: boolean | null; payment_channel: string | null;
};
type ActionItem = { id: string; priority: "urgent"|"soon"|"info"; title: string; detail: string; cta: string; icon: typeof Wallet; reviewCategory?: string; };
type AIInsight  = { id: string; severity: "high"|"medium"|"low"; category: string; title: string; what: string; why: string; action: string; impact: string; impactValue: number };
type Bucket     = "cash" | "credit" | "loan" | "investment" | "other";
type Period     = "1W" | "1M" | "3M" | "1Y" | "ALL";

// Institution from plaid_items
type PItem = {
  id: string;
  item_id: string;
  institution_id: string | null;
  institution_name: string | null;
};

// Per-account metadata stored in localStorage
type AccountMeta = {
  nickname?: string;
  apr?: number;          // e.g. 22.49
  promoApr?: number;     // e.g. 0
  promoEndDate?: string; // ISO date string
  customUrl?: string;    // override institution URL
};

// Credit card details (from Plaid Liabilities)
type CreditDetail = {
  account_id: string;
  last_statement_balance: number | null;
  last_payment_amount: number | null;
  minimum_payment_amount: number | null;
  next_payment_due_date: string | null;
  is_overdue: boolean | null;
  last_payment_date: string | null;
};

// ── Institution website lookup ──────────────────────────────────
const INST_URLS: Record<string, string> = {
  "chase": "https://chase.com", "jpmorgan": "https://chase.com",
  "bank of america": "https://bankofamerica.com", "bofa": "https://bankofamerica.com",
  "wells fargo": "https://wellsfargo.com",
  "citibank": "https://citi.com", "citi": "https://citi.com",
  "capital one": "https://capitalone.com",
  "american express": "https://americanexpress.com", "amex": "https://americanexpress.com",
  "discover": "https://discover.com",
  "ally": "https://ally.com",
  "marcus": "https://marcus.com",
  "synchrony": "https://mysynchrony.com",
  "us bank": "https://usbank.com",
  "pnc": "https://pnc.com",
  "td bank": "https://tdbank.com",
  "fidelity": "https://fidelity.com",
  "vanguard": "https://vanguard.com",
  "schwab": "https://schwab.com",
  "robinhood": "https://robinhood.com",
  "sofi": "https://sofi.com",
  "navy federal": "https://navyfederal.org",
  "usaa": "https://usaa.com",
  "goldman sachs": "https://marcus.com",
  "apple": "https://applecash.com",
  "paypal": "https://paypal.com",
  "venmo": "https://venmo.com",
  "nelnet": "https://nelnet.com",
  "sallie mae": "https://salliemae.com",
  "lively": "https://livelyme.com",
};

const getInstitutionUrl = (name: string | null, customUrl?: string): string | null => {
  if (customUrl) return customUrl;
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const [key, url] of Object.entries(INST_URLS)) {
    if (lower.includes(key)) return url;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(name + " bank login")}`;
};

// ── Account metadata helpers (Supabase-backed via useUserSettings) ──
const META_KEY = "sentryfi_account_meta"; // kept for migration reference only
const loadAllMeta = (): Record<string, AccountMeta> => {
  try { return JSON.parse(localStorage.getItem(META_KEY) ?? "{}"); } catch { return {}; }
};
// saveMeta is now a thin wrapper over S.setAccountMeta — defined inside the component

// ── Constants ──────────────────────────────────────────────────
const PERIODS: Period[] = ["1W", "1M", "3M", "1Y", "ALL"];

const EXPENSE_CATEGORIES = [
  "Food & Drink", "Groceries", "Travel", "Transportation", "Shopping",
  "Entertainment", "Healthcare", "Bills & Utilities", "Education",
  "Personal Care", "Charitable Giving", "Transfer Out", "Other",
];

const INCOME_CATEGORIES = [
  "Salary", "Freelance Income", "Interest & Dividends",
  "Refund / Reimbursement", "Transfer In", "Other Income",
];

const priorityMeta = {
  urgent: { label: "Urgent", dot: "bg-negative", text: "text-negative", chip: "border-negative/30 bg-negative/10 text-negative" },
  soon:   { label: "Soon",   dot: "bg-warning",  text: "text-warning",  chip: "border-warning/30 bg-warning/10 text-warning" },
  info:   { label: "FYI",    dot: "bg-info",     text: "text-info",     chip: "border-info/30 bg-info/10 text-info" },
};

const bucketMeta: Record<Bucket, { label: string; sub: string; tone: "positive"|"negative"|"info"|"warning" }> = {
  cash:       { label: "Checking & Savings", sub: "Everyday spending and savings",            tone: "positive" },
  credit:     { label: "Credit Cards",       sub: "Statements due this cycle",                tone: "warning" },
  loan:       { label: "Loans & Mortgages",  sub: "Only monthly payment affects cash flow",   tone: "negative" },
  investment: { label: "Investments",        sub: "Brokerage & retirement accounts",          tone: "info" },
  other:      { label: "Other",              sub: "Uncategorized accounts",                   tone: "info" },
};

const bucketOrder: Bucket[] = ["cash", "credit", "loan", "investment", "other"];

const getInstNameFor = (a: PAccount, items: PItem[]): string => {
  const raw = a as unknown as Record<string, unknown>;
  const itemId = raw.item_id as string | undefined;
  const item = itemId ? items.find(it => it.id === itemId) : undefined;
  return item?.institution_name ?? "Bank";
};

// ── Helpers ────────────────────────────────────────────────────
const mapBucket = (type: string|null, subtype: string|null): Bucket => {
  if (type === "credit") return "credit";
  if (type === "loan") return "loan";
  if (type === "investment") return "investment";
  const sub = (subtype ?? "").toLowerCase();
  if (sub === "checking" || sub === "savings" || sub.includes("money market") || sub === "hsa") return "cash";
  return "other";
};

const mapIcon = (type: string|null, subtype: string|null) => {
  const sub = (subtype ?? "").toLowerCase();
  if (sub.includes("checking")) return Wallet;
  if (sub.includes("savings") || sub.includes("money market") || sub.includes("hsa")) return PiggyBank;
  if (sub.includes("mortgage")) return Home;
  if (sub.includes("auto") || sub.includes("vehicle")) return Car;
  if (sub.includes("student")) return Landmark;
  if (type === "investment") return TrendingUp;
  if (type === "credit") return CreditCard;
  if (type === "loan") return Landmark;
  return Landmark;
};

/** Smart human-readable subtype label — detects HYSA/money market from account + bank name or APR */
const smartSubtypeLabel = (a: PAccount, instName = "", apr?: number | null): string => {
  const sub  = (a.subtype ?? "").toLowerCase();
  const type = (a.type ?? "").toLowerCase();

  if (sub === "savings" || sub === "money market") {
    if (isHYSA(a, instName, apr)) return "High Yield Savings";
    if (sub === "money market") return "Money Market";
    return "Savings";
  }
  if (sub === "checking")         return "Checking";
  if (sub === "hsa")              return "HSA";
  if (sub === "cd")               return "CD";
  if (sub === "ira")              return "IRA";
  if (sub.includes("401"))       return "401(k)";
  if (sub === "roth")             return "Roth IRA";
  if (sub === "brokerage")        return "Brokerage";
  if (sub === "cash management")  return "Cash Mgmt";
  if (sub === "mortgage")         return "Mortgage";
  if (sub.includes("auto"))       return "Auto Loan";
  if (sub.includes("student"))    return "Student Loan";
  if (type === "investment")      return "Investment";
  if (type === "credit")          return "Credit Card";
  return sub ? sub.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "Account";
};

const isDebt = (type: string|null) => type === "credit" || type === "loan";

const formatCat = (cat: string) =>
  cat.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

/** Rename Plaid transfer categories to human-friendly equivalents */
const humanizeCategory = (cat: string|null, amount: number): string => {
  if (!cat) return "Other";
  const c = cat.toLowerCase();
  if (c.includes("transfer")) return amount < 0 ? "Incoming Transfer" : "Outgoing Transfer";
  if (c.includes("debit")) return "Debit";
  if (c.includes("credit") && !c.includes("credit card")) return "Credit";
  return formatCat(cat);
};

const categoryIcon = (cat: string|null) => {
  if (!cat) return ShoppingBag;
  const c = cat.toLowerCase();
  if (c.includes("groceries")) return ShoppingCart;
  if (c.includes("food") || c.includes("restaurant") || c.includes("dining")) return Utensils;
  if (c.includes("coffee") || c.includes("cafe")) return Coffee;
  if (c.includes("travel") || c.includes("airline") || c.includes("hotel") || c.includes("lodging")) return Plane;
  if (c.includes("car") || c.includes("auto") || c.includes("gas") || c.includes("transport")) return Car;
  if (c.includes("utilities") || c.includes("electric") || c.includes("internet") || c.includes("bills") || c.includes("telecom")) return Zap;
  if (c.includes("entertainment") || c.includes("streaming") || c.includes("subscription")) return Film;
  if (c.includes("health") || c.includes("medical") || c.includes("pharmacy")) return Heart;
  if (c.includes("shops") || c.includes("shopping") || c.includes("merchandise")) return ShoppingBag;
  if (c.includes("transfer") || c.includes("payroll") || c.includes("debit") || c.includes("credit")) return ArrowDownLeft;
  if (c.includes("salary") || c.includes("income") || c.includes("paycheck")) return DollarSign;
  if (c.includes("service") || c.includes("fee") || c.includes("bank")) return Landmark;
  if (c.includes("personal")) return User;
  if (c.includes("home") || c.includes("rent")) return Home;
  if (c.includes("education")) return BookOpen;
  if (c.includes("charity") || c.includes("giving") || c.includes("non-profit")) return Heart;
  return ShoppingBag;
};

const catColor = (cat: string): string => {
  const c = cat.toLowerCase();
  if (c.includes("groceries")) return "hsl(156 72% 45%)";
  if (c.includes("food") || c.includes("dining") || c.includes("restaurant")) return "hsl(38 92% 55%)";
  if (c.includes("coffee")) return "hsl(25 80% 50%)";
  if (c.includes("travel") || c.includes("airline") || c.includes("lodging")) return "hsl(210 90% 60%)";
  if (c.includes("transport") || c.includes("car") || c.includes("auto") || c.includes("gas")) return "hsl(280 70% 60%)";
  if (c.includes("utilities") || c.includes("bills") || c.includes("electric") || c.includes("telecom")) return "hsl(50 85% 55%)";
  if (c.includes("entertainment") || c.includes("streaming")) return "hsl(330 70% 60%)";
  if (c.includes("subscription")) return "hsl(295 60% 60%)";
  if (c.includes("health") || c.includes("medical")) return "hsl(152 60% 45%)";
  if (c.includes("shopping") || c.includes("merchandise")) return "hsl(4 78% 58%)";
  if (c.includes("home") || c.includes("rent")) return "hsl(28 80% 55%)";
  if (c.includes("education")) return "hsl(190 80% 55%)";
  if (c.includes("personal")) return "hsl(260 70% 60%)";
  if (c.includes("salary") || c.includes("income") || c.includes("payroll")) return "hsl(145 60% 45%)";
  if (c.includes("transfer")) return "hsl(210 20% 55%)";
  if (c.includes("service") || c.includes("fee")) return "hsl(220 30% 55%)";
  if (c.includes("charity") || c.includes("giving")) return "hsl(340 60% 55%)";
  return "hsl(var(--primary))";
};

/** Reconstruct historical net worth from current value + transactions (excludes internal transfers) */
const buildNWByPeriod = (netWorth: number, txns: PTxn[], period: Period, internalIds?: Set<string>) => {
  const today = new Date(); today.setHours(0,0,0,0);

  const makePoints = (count: number, stepDays: number, labelFmt: Intl.DateTimeFormatOptions) =>
    Array.from({ length: count }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() - (count - 1 - i) * stepDays);
      return { label: d.toLocaleDateString("en-US", labelFmt), date: d.toISOString().split("T")[0] };
    });

  let points: { label: string; date: string }[];
  switch (period) {
    case "1W":  points = makePoints(7,  1, { weekday: "short" }); break;
    case "1M":  points = makePoints(30, 1, { month: "short", day: "numeric" }); break;
    case "3M":  points = makePoints(13, 7, { month: "short", day: "numeric" }); break;
    case "1Y":  points = makePoints(12, 30, { month: "short" }); break;
    default: { // ALL — monthly from oldest txn
      if (txns.length === 0) { points = makePoints(6, 30, { month: "short" }); break; }
      const oldest = txns.reduce((m, t) => (t.date < m ? t.date : m), txns[0].date);
      const diff = Math.ceil((today.getTime() - new Date(oldest).getTime()) / (30 * 86400000)) + 1;
      const cnt = Math.min(Math.max(diff, 3), 24);
      points = makePoints(cnt, 30, { month: "short", year: cnt > 12 ? "2-digit" : undefined });
    }
  }

  // NW at date d = currentNW + sum(txns after d), since txn.amount > 0 = expense (reduces NW)
  // Exclude internal transfers to avoid double-counting
  const realTxns = internalIds ? txns.filter(t => !internalIds.has(t.id)) : txns;
  return points.map(({ label, date }) => {
    const adj = realTxns.filter(t => t.date > date).reduce((s, t) => s + Number(t.amount), 0);
    return { m: label, v: Math.round(netWorth + adj) };
  });
};

const buildMonthlyFlow = (txns: PTxn[]) => {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5-i), 1);
    const mo = d.getMonth(); const yr = d.getFullYear();
    const mt = txns.filter(t => { const td = new Date(t.date+"T00:00:00"); return td.getMonth()===mo && td.getFullYear()===yr; });
    return {
      m: d.toLocaleDateString("en-US", { month: "short" }),
      income: Math.round(mt.filter(t=>Number(t.amount)<0).reduce((s,t)=>s+Math.abs(Number(t.amount)),0)),
      spend:  Math.round(mt.filter(t=>Number(t.amount)>0).reduce((s,t)=>s+Number(t.amount),0)),
    };
  });
};

/**
 * Detect internal transfers between the user's own accounts.
 * Returns a Set of transaction IDs that are internal transfers.
 * Criteria: Plaid category contains "transfer" OR name matches transfer patterns,
 * AND a matching opposite-amount transaction exists in another own account within 3 days.
 * Credit card payments (transfer from checking → credit) are also internal.
 */
const detectInternalTransfers = (txns: PTxn[]): Set<string> => {
  const ids = new Set<string>();
  // Only patterns that reliably indicate own-account movement (not person-to-person).
  // Excluded: zelle, venmo, cashapp — those are often real income/expense.
  // Excluded: autopay, bill pay, online payment — those are real bill payments.
  const OWN_TRANSFER = /\btransfer\b|pay yourself|\bfrom checking\b|\bto savings\b|\bto checking\b|\bfrom savings\b/i;

  const isCandidate = (t: PTxn) =>
    (t.category?.[0] ?? "").toLowerCase().includes("transfer") ||
    OWN_TRANSFER.test(t.merchant_name ?? t.name ?? "");

  const candidates = txns.filter(isCandidate);

  for (const t of candidates) {
    if (ids.has(t.id)) continue;
    const amt = Number(t.amount);
    const tDate = new Date(t.date + "T00:00:00");

    // Require a matching opposite-sign transaction in a DIFFERENT account within 3 days.
    // Without a confirmed pair, we do NOT auto-mark — better to miss some than to
    // incorrectly hide real income or expenses (e.g. Zelle from a friend).
    const match = candidates.find(o => {
      if (o.id === t.id || ids.has(o.id)) return false;
      if (o.account_id === t.account_id) return false;
      const oAmt = Number(o.amount);
      if (Math.abs(Math.abs(oAmt) - Math.abs(amt)) > 0.01) return false;
      if (Math.sign(oAmt) === Math.sign(amt)) return false;
      const oDate = new Date(o.date + "T00:00:00");
      return Math.abs(tDate.getTime() - oDate.getTime()) <= 3 * 86400000;
    });

    if (match) {
      ids.add(t.id);
      ids.add(match.id);
    }
    // No fallback — only mark as internal when we have a confirmed pair.
  }
  return ids;
};

/** Month-over-month spend change per category, excluding internal transfers */
const buildSpendTrends = (txns: PTxn[], overrides: Record<string,string>, getRuleCategory: (m:string|null)=>string|null, internalIds: Set<string>) => {
  const now = new Date();
  const thisM = now.getMonth(); const thisY = now.getFullYear();
  const lastM = thisM === 0 ? 11 : thisM - 1;
  const lastY = thisM === 0 ? thisY - 1 : thisY;
  const catMap: Record<string,{this:number;last:number}> = {};
  for (const t of txns) {
    if (Number(t.amount) <= 0 || internalIds.has(t.id)) continue;
    const d = new Date(t.date+"T00:00:00");
    const isThis = d.getMonth()===thisM && d.getFullYear()===thisY;
    const isLast = d.getMonth()===lastM && d.getFullYear()===lastY;
    if (!isThis && !isLast) continue;
    const cat = getEffectiveCategory(t, overrides, getRuleCategory) ?? "Other";
    if (!catMap[cat]) catMap[cat]={this:0,last:0};
    if (isThis) catMap[cat].this += Number(t.amount);
    else catMap[cat].last += Number(t.amount);
  }
  return Object.entries(catMap).map(([category,v])=>({
    category,
    thisMonth: Math.round(v.this),
    lastMonth: Math.round(v.last),
    delta: Math.round(v.this - v.last),
    pct: v.last > 0 ? Math.round(((v.this - v.last) / v.last) * 100) : null,
  })).sort((a,b)=>b.thisMonth-a.thisMonth);
};

type RecurringCharge = {
  merchant: string; merchantKey: string; category: string;
  avgAmount: number; dayOfMonth: number;
  lastSeen: string; monthsActive: number; predictedDate: Date;
  accountId: string; intervalDays: number; intervalLabel: string;
};

/**
 * Detect truly recurring charges by identifying consistent intervals.
 * Supports weekly (~7d), bi-weekly (~14d), monthly (~30d), quarterly (~90d).
 * Shows next 30 days of upcoming charges only.
 */
const detectRecurring = (
  txns: PTxn[],
  internalIds: Set<string> = new Set(),
  suppressMerchants: Set<string> = new Set(),
  suppressCategories: Set<string> = new Set(),
): RecurringCharge[] => {
  const now = new Date(); now.setHours(0,0,0,0);
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const lookahead = new Date(now.getTime() + 30 * 86400000);

  const INTERVAL_BUCKETS = [
    { label: "Weekly",     days: 7,  tolerance: 2 },
    { label: "Bi-weekly",  days: 14, tolerance: 3 },
    { label: "Monthly",    days: 30, tolerance: 5 },
    { label: "Quarterly",  days: 91, tolerance: 10 },
  ];

  // Categories that are never truly recurring (variable/one-off spend) — checked first
  // since category data from Plaid is reliable when present. Parking is included: it
  // is pay-per-use, not a subscription.
  const NON_RECURRING_CAT = /food|dining|restaurant|groceries|grocery|supermarket|gas station|fuel|atm|withdrawal|parking/i;
  // Merchant name patterns that indicate one-off or variable spend even when category data
  // is missing/generic — covers delivery apps, grocery/gas chains, restaurants, and parking.
  const NON_RECURRING_MERCHANT = /doordash|uber eats|grubhub|instacart|postmates|seamless|caviar|amazon fresh|whole foods|trader joe|kroger|safeway|publix|walmart|target|costco|shell|exxon|chevron|bp |sunoco|wawa|speedway|restaurant|cafe|coffee|bistro|grill|kitchen|diner|pizz|sushi|taco|bbq|bar\b|pub\b|brewery|bakery|deli\b|parking|parkmobile|paybyphone|spothero|garage\b|meter\b/i;

  const norm = (t: PTxn) => (t.merchant_name ?? t.name ?? "").trim().toLowerCase()
    .replace(/\s+(and|&|llc|inc|co\.?|corp\.?)[\s,]*$/i, "").slice(0, 40);

  const expenses = txns.filter(t => {
    if (Number(t.amount) <= 0 || t.pending) return false;
    if (internalIds.has(t.id)) return false; // app-detected internal transfers
    if (new Date(t.date) < threeMonthsAgo) return false;
    const cat0 = (t.category?.[0] ?? "").toLowerCase();
    const cat1 = (t.category?.[1] ?? "").toLowerCase();
    if (NON_RECURRING_CAT.test(cat0) || NON_RECURRING_CAT.test(cat1)) return false;
    if (suppressCategories.has(cat0) || suppressCategories.has(cat1)) return false;
    const merchant = (t.merchant_name ?? t.name ?? "").toLowerCase();
    if (NON_RECURRING_MERCHANT.test(merchant)) return false;
    if (cat0.includes("transfer")) return false;
    if (suppressMerchants.has(norm(t))) return false; // user-dismissed merchants
    return true;
  });

  // Group by normalized merchant name
  const groups: Record<string, PTxn[]> = {};
  for (const t of expenses) {
    const key = (t.merchant_name ?? t.name ?? "").trim().toLowerCase()
      .replace(/\s+(and|&|llc|inc|co\.?|corp\.?)[\s,]*$/i, "").slice(0, 40);
    if (!key) continue;
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }

  const results: RecurringCharge[] = [];

  for (const [, txnList] of Object.entries(groups)) {
    // Sort by date ascending
    const sorted = [...txnList].sort((a, b) => a.date.localeCompare(b.date));

    // Deduplicate same-day charges
    const deduped = sorted.filter((t, i) => i === 0 || t.date !== sorted[i-1].date);
    if (deduped.length < 2) continue;

    // Amount consistency check
    const amounts = deduped.map(t => Number(t.amount));
    const avgAmount = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const maxAmt = Math.max(...amounts); const minAmt = Math.min(...amounts);
    if (maxAmt > 0 && (maxAmt - minAmt) / maxAmt > 0.35) continue;

    // Compute gaps between consecutive occurrences
    const gaps: number[] = [];
    for (let i = 1; i < deduped.length; i++) {
      const a = new Date(deduped[i-1].date + "T00:00:00");
      const b = new Date(deduped[i].date + "T00:00:00");
      gaps.push(Math.round((b.getTime() - a.getTime()) / 86400000));
    }

    // Find the best-matching interval bucket
    let matchedInterval: typeof INTERVAL_BUCKETS[0] | null = null;
    for (const bucket of INTERVAL_BUCKETS) {
      const matching = gaps.filter(g => Math.abs(g - bucket.days) <= bucket.tolerance);
      if (matching.length >= Math.max(1, Math.floor(gaps.length * 0.55))) { // ≥55% of gaps match
        matchedInterval = bucket;
        break;
      }
    }
    if (!matchedInterval) continue;

    // Must have been seen recently
    const lastSeen = deduped[deduped.length - 1].date;
    const lastSeenDate = new Date(lastSeen + "T00:00:00");
    const daysSinceLast = Math.round((now.getTime() - lastSeenDate.getTime()) / 86400000);
    if (daysSinceLast > matchedInterval.days * 2.5) continue; // inactive

    // Predict next occurrence
    let predictedDate = new Date(lastSeenDate.getTime() + matchedInterval.days * 86400000);
    // If prediction is in the past (already overdue), advance by one interval
    while (predictedDate <= now) {
      predictedDate = new Date(predictedDate.getTime() + matchedInterval.days * 86400000);
    }
    if (predictedDate > lookahead) continue;

    const displayName = deduped.find(t => t.merchant_name)?.merchant_name ?? deduped[0].name ?? "Unknown";
    const dayOfMonth = predictedDate.getDate();
    const category = (deduped.find(t => t.category?.[0])?.category?.[0] ?? "").toLowerCase();
    const merchantKey = norm(deduped[0]);

    const accCounts: Record<string, number> = {};
    for (const t of deduped) { accCounts[t.account_id] = (accCounts[t.account_id] ?? 0) + 1; }
    const accountId = Object.entries(accCounts).sort((a, b) => b[1] - a[1])[0][0];

    results.push({
      merchant: displayName, merchantKey, category, avgAmount, dayOfMonth,
      lastSeen, monthsActive: deduped.length,
      predictedDate, accountId,
      intervalDays: matchedInterval.days,
      intervalLabel: matchedInterval.label,
    });
  }

  return results.sort((a, b) => a.predictedDate.getTime() - b.predictedDate.getTime());
};

/** Period helpers for day/week/month/year navigation */
type PeriodGranularity = "day" | "week" | "month" | "year";
type PeriodState = { granularity: PeriodGranularity; offset: number }; // offset: 0 = current, -1 = previous, etc.

/** Inclusive [start, end] date range for a period */
const getPeriodRange = (p: PeriodState): { start: Date; end: Date } => {
  const now = new Date();
  if (p.granularity === "day") {
    const d = new Date(now); d.setDate(now.getDate() + p.offset); d.setHours(0,0,0,0);
    const end = new Date(d); end.setHours(23,59,59,999);
    return { start: d, end };
  }
  if (p.granularity === "month") {
    const start = new Date(now.getFullYear(), now.getMonth() + p.offset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + p.offset + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }
  if (p.granularity === "year") {
    const yr = now.getFullYear() + p.offset;
    return { start: new Date(yr, 0, 1), end: new Date(yr, 11, 31, 23, 59, 59, 999) };
  }
  // week
  const start = new Date(now); start.setDate(now.getDate() - now.getDay() + p.offset * 7); start.setHours(0,0,0,0);
  const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23,59,59,999);
  return { start, end };
};

const getPeriodLabel = (p: PeriodState): string => {
  const now = new Date();
  if (p.granularity === "day") {
    if (p.offset === 0) return "Today";
    if (p.offset === -1) return "Yesterday";
    const d = new Date(now); d.setDate(now.getDate() + p.offset);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  if (p.granularity === "month") {
    const d = new Date(now.getFullYear(), now.getMonth() + p.offset, 1);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  if (p.granularity === "year") {
    return String(now.getFullYear() + p.offset);
  }
  // week
  const { start, end } = getPeriodRange(p);
  return `${start.toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${end.toLocaleDateString("en-US",{month:"short",day:"numeric"})}`;
};

const filterByPeriod = (txns: PTxn[], p: PeriodState): PTxn[] => {
  const { start, end } = getPeriodRange(p);
  return txns.filter(t => { const td = new Date(t.date+"T00:00:00"); return td >= start && td <= end; });
};

// Keywords that suggest an account is already a savings/HYSA — exclude from low-balance alerts
const SAVINGS_KEYWORDS = ["saving", "hysa", "hys", "high yield", "high-yield", "money market", "hsa", "ira", "401", "invest", "brokerage", "roth", "fund"];
const looksLikeSavings = (a: PAccount) => {
  const name = (a.name ?? a.official_name ?? "").toLowerCase();
  return SAVINGS_KEYWORDS.some(k => name.includes(k)) || a.subtype === "savings" || a.subtype === "money market";
};

const generateActions = (
  accounts: PAccount[],
  txns: PTxn[],
  internalIds: Set<string>,
  overrides: Record<string,string>,
  getRuleCategory: (m:string|null)=>string|null,
  budgets: Record<string,number>,
  creditDetails: CreditDetail[],
): ActionItem[] => {
  const items: ActionItem[] = [];
  const realTxns = txns.filter(t => !internalIds.has(t.id));

  // Low checking balance
  const lowCheck = accounts.filter(a =>
    a.subtype === "checking" &&
    !looksLikeSavings(a) &&
    (Number(a.current_balance) || 0) < 500
  );
  if (lowCheck.length > 0) items.push({
    id: "low-checking", priority: "urgent",
    title: `Low checking balance`,
    detail: `${lowCheck[0].name} is at ${fmtUSD(Number(lowCheck[0].current_balance) || 0)}. Consider a transfer.`,
    cta: "Transfer funds", icon: AlertTriangle,
  });

  // Budget overages — this month
  if (Object.keys(budgets).length > 0) {
    const now = new Date();
    const thisM = now.getMonth(); const thisY = now.getFullYear();
    const thisMonthSpend: Record<string,number> = {};
    for (const t of realTxns) {
      if (Number(t.amount) <= 0) continue;
      const d = new Date(t.date+"T00:00:00");
      if (d.getMonth() !== thisM || d.getFullYear() !== thisY) continue;
      const cat = getEffectiveCategory(t, overrides, getRuleCategory) ?? "Other";
      thisMonthSpend[cat] = (thisMonthSpend[cat] ?? 0) + Number(t.amount);
    }
    const overages = Object.entries(budgets)
      .filter(([cat, limit]) => (thisMonthSpend[cat] ?? 0) > limit && limit > 0)
      .map(([cat, limit]) => ({ cat, spent: thisMonthSpend[cat], over: thisMonthSpend[cat] - limit }))
      .sort((a, b) => b.over - a.over);
    if (overages.length > 0) {
      const top = overages[0];
      items.push({
        id: "budget-overage", priority: "urgent",
        title: `Budget exceeded: ${formatCat(top.cat)}`,
        detail: `${fmtUSD(top.spent)} spent vs ${fmtUSD(budgets[top.cat])} budget, ${fmtUSD(top.over)} over.${overages.length > 1 ? ` +${overages.length - 1} more categor${overages.length > 2 ? "ies" : "y"}.` : ""}`,
        cta: "Review spending", icon: AlertTriangle, reviewCategory: top.cat,
      });
    }
  }

  // Spending spike detection — this month vs 3-month avg (>25% over)
  (() => {
    const now = new Date();
    const thisM = now.getMonth(); const thisY = now.getFullYear();
    const catThis: Record<string,number> = {};
    const catHist: Record<string,number[]> = {};
    for (const t of realTxns) {
      if (Number(t.amount) <= 0) continue;
      const d = new Date(t.date+"T00:00:00");
      const mDiff = (thisY - d.getFullYear()) * 12 + (thisM - d.getMonth());
      const cat = getEffectiveCategory(t, overrides, getRuleCategory) ?? "Other";
      if (mDiff === 0) { catThis[cat] = (catThis[cat] ?? 0) + Number(t.amount); }
      else if (mDiff >= 1 && mDiff <= 3) {
        if (!catHist[cat]) catHist[cat] = [];
        catHist[cat].push(Number(t.amount));
      }
    }
    const spikes = Object.entries(catThis)
      .filter(([cat, thisAmt]) => {
        const hist = catHist[cat];
        if (!hist || hist.length < 3) return false;
        const avg = hist.reduce((s, v) => s + v, 0) / 3;
        return thisAmt > avg * 1.25 && thisAmt - avg > 50;
      })
      .map(([cat, thisAmt]) => {
        const avg = catHist[cat].reduce((s, v) => s + v, 0) / 3;
        return { cat, thisAmt, avg, pct: Math.round(((thisAmt - avg) / avg) * 100) };
      })
      .sort((a, b) => (b.thisAmt - b.avg) - (a.thisAmt - a.avg));
    if (spikes.length > 0) {
      const s = spikes[0];
      items.push({
        id: "spend-spike", priority: "soon",
        title: `${formatCat(s.cat)} spending up ${s.pct}%`,
        detail: `${fmtUSD(s.thisAmt)} this month vs ${fmtUSD(Math.round(s.avg))} avg, ${fmtUSD(Math.round(s.thisAmt - s.avg))} above normal.`,
        cta: "Review", icon: TrendingUp, reviewCategory: s.cat,
      });
    }
  })();

  // Credit card due dates — use Plaid credit details when available
  accounts.filter(a => a.type === "credit").forEach(cc => {
    const bal = Math.abs(Number(cc.current_balance) || 0);
    const shortName = (cc.name ?? "Card").split(" ").slice(0, 2).join(" ");
    const detail = creditDetails.find(d => d.account_id === cc.account_id);
    const dueDate = detail?.next_payment_due_date;
    const minPay = detail?.minimum_payment_amount;
    const isOverdue = detail?.is_overdue;

    if (isOverdue) {
      items.push({
        id: `cc-overdue-${cc.id}`, priority: "urgent",
        title: `${shortName} payment overdue`,
        detail: `Minimum payment of ${minPay ? fmtUSD(minPay) : "unknown"} is past due. Pay immediately to avoid fees.`,
        cta: "Pay now", icon: CreditCard,
      });
    } else if (dueDate) {
      const due = new Date(dueDate + "T00:00:00");
      const daysUntil = Math.round((due.getTime() - Date.now()) / 86400000);
      if (daysUntil <= 7 && daysUntil >= 0) {
        items.push({
          id: `cc-due-${cc.id}`, priority: daysUntil <= 3 ? "urgent" : "soon",
          title: `${shortName} due in ${daysUntil === 0 ? "today" : `${daysUntil}d`}`,
          detail: `${fmtUSD(bal)} balance${minPay ? ` · min payment ${fmtUSD(minPay)}` : ""} due ${due.toLocaleDateString("en-US",{month:"short",day:"numeric"})}.`,
          cta: "Schedule payment", icon: CreditCard,
        });
      }
    } else if (bal > 1000) {
      items.push({
        id: `cc-${cc.id}`, priority: "soon",
        title: `${shortName} balance due`,
        detail: `${fmtUSD(bal)} balance. Schedule payment before due date.`,
        cta: "Schedule payment", icon: CreditCard,
      });
    }
  });

  // Large unusual transaction (single expense >$500 in last 7 days, not recurring merchant)
  (() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
    const big = realTxns.filter(t =>
      Number(t.amount) > 500 &&
      !t.pending &&
      new Date(t.date + "T00:00:00") >= cutoff
    ).sort((a, b) => Number(b.amount) - Number(a.amount));
    if (big.length > 0) {
      const t = big[0];
      items.push({
        id: `large-txn-${t.id}`, priority: "info",
        title: `Large charge: ${fmtUSD(Number(t.amount))}`,
        detail: `${t.merchant_name ?? t.name ?? "Unknown merchant"} on ${new Date(t.date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}${big.length > 1 ? ` (+${big.length-1} more)` : ""}.`,
        cta: "Review", icon: AlertTriangle, reviewCategory: getEffectiveCategory(t, overrides, getRuleCategory) ?? undefined,
      });
    }
  })();

  // Fees / overdraft / non-purchase charges — money paid that isn't a real purchase
  (() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 45);
    const FEE_RE = /overdraft|\bnsf\b|non-?sufficient|insufficient fund|service charge|service fee|maintenance fee|monthly fee|account fee|late fee|late payment|\batm fee\b|foreign transaction|interest charge|finance charge|annual fee|over-?limit|returned item|stop payment|wire fee|transfer fee|\bfee\b|penalty/i;
    const fees = realTxns.filter(t =>
      Number(t.amount) > 0 && !t.pending &&
      new Date(t.date + "T00:00:00") >= cutoff &&
      FEE_RE.test(t.merchant_name ?? t.name ?? "")
    ).sort((a, b) => Number(b.amount) - Number(a.amount));
    if (fees.length > 0) {
      const total = fees.reduce((s, t) => s + Number(t.amount), 0);
      const top = fees[0];
      items.push({
        id: "fees-charged", priority: "urgent",
        title: `${fmtUSD(total)} in fees charged`,
        detail: `${fees.length} fee${fees.length > 1 ? "s" : ""} in the last 45 days, e.g. ${top.merchant_name ?? top.name ?? "a charge"} ${fmtUSD(Number(top.amount))}. These often can be waived, contact your bank.`,
        cta: "Review fees", icon: AlertTriangle,
      });
    }
  })();

  // Duplicate charges — same merchant + amount within 4 days (possible double-bill)
  (() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    const recent = realTxns.filter(t => Number(t.amount) > 0 && !t.pending && new Date(t.date + "T00:00:00") >= cutoff);
    const byKey: Record<string, PTxn[]> = {};
    for (const t of recent) {
      const key = `${(t.merchant_name ?? t.name ?? "").trim().toLowerCase()}|${Number(t.amount).toFixed(2)}`;
      (byKey[key] ??= []).push(t);
    }
    const dupes: PTxn[][] = [];
    for (const group of Object.values(byKey)) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
      for (let i = 1; i < sorted.length; i++) {
        const days = Math.abs((new Date(sorted[i].date).getTime() - new Date(sorted[i - 1].date).getTime()) / 86400000);
        if (days <= 4) { dupes.push([sorted[i - 1], sorted[i]]); break; }
      }
    }
    if (dupes.length > 0) {
      const [a] = dupes[0];
      items.push({
        id: "duplicate-charge", priority: "urgent",
        title: `Possible duplicate charge`,
        detail: `${a.merchant_name ?? a.name ?? "A merchant"} billed ${fmtUSD(Number(a.amount))} twice within days${dupes.length > 1 ? ` (+${dupes.length - 1} more pair${dupes.length > 2 ? "s" : ""})` : ""}. Verify it isn't a double charge.`,
        cta: "Review", icon: AlertTriangle,
      });
    }
  })();

  // Largest expense this month (beyond the recent-7-day flag) — surfaces a big
  // one-off spend for the current month if it stands out.
  (() => {
    const now = new Date();
    const monthTxns = realTxns.filter(t => {
      if (Number(t.amount) <= 0 || t.pending) return false;
      const d = new Date(t.date + "T00:00:00");
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).sort((a, b) => Number(b.amount) - Number(a.amount));
    if (monthTxns.length >= 3) {
      const top = monthTxns[0];
      const rest = monthTxns.slice(1);
      const avgRest = rest.reduce((s, t) => s + Number(t.amount), 0) / rest.length;
      // Flag only if it's genuinely large: >$300 and at least 3x the average of the rest.
      if (Number(top.amount) > 300 && Number(top.amount) > avgRest * 3) {
        items.push({
          id: `month-large-${top.id}`, priority: "info",
          title: `Biggest expense this month: ${fmtUSD(Number(top.amount))}`,
          detail: `${top.merchant_name ?? top.name ?? "Unknown"} on ${new Date(top.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}, well above your typical spend.`,
          cta: "Review", icon: TrendingUp, reviewCategory: getEffectiveCategory(top, overrides, getRuleCategory) ?? undefined,
        });
      }
    }
  })();

  // HYSA suggestion
  const lowYieldSavings = accounts.filter(a => {
    if (a.subtype !== "savings") return false;
    const name = (a.name ?? "").toLowerCase();
    if (["hysa", "hys", "high yield", "high-yield", "marcus", "ally", "synchrony", "discover"].some(k => name.includes(k))) return false;
    return (Number(a.current_balance) || 0) > 2000;
  });
  if (lowYieldSavings.length > 0) items.push({
    id: "idle-savings", priority: "info",
    title: "Savings may have low yield",
    detail: `${fmtUSD(lowYieldSavings.reduce((s, a) => s + (Number(a.current_balance) || 0), 0))} may be earning below market rate. Consider a 4%+ APY account.`,
    cta: "Explore HYSA", icon: Coins,
  });

  // Pending transactions (excluding internal transfers)
  const pending = realTxns.filter(t => t.pending);
  if (pending.length > 0) items.push({
    id: "pending", priority: "info",
    title: `${pending.length} pending transaction${pending.length > 1 ? "s" : ""}`,
    detail: `Total: ${fmtUSD(pending.reduce((s, t) => s + Math.abs(Number(t.amount)), 0))} still settling.`,
    cta: "View all", icon: Sparkles,
  });

  const rank: Record<string, number> = { urgent: 0, soon: 1, info: 2 };
  return items.sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3)).slice(0, 8);
};

const isAIInsight=(x:unknown):x is AIInsight=>{ if(!x||typeof x!=="object") return false; const o=x as Record<string,unknown>; return typeof o.id==="string"&&typeof o.title==="string"&&typeof o.impact==="string"; };
const parseInsights=(raw:unknown):AIInsight[]=>(Array.isArray(raw)?raw.filter(isAIInsight):[]);

/** Resolve the effective display category for a transaction, respecting overrides → rules → original */
// Maps raw Plaid category strings to app category names.
// Plaid sends categories in two formats:
//   New: ["Food & Drink"]
//   Old: ["Food and Drink", "Restaurants", "Fast Food"]
// We normalise both to the app's category set.
const normalisePlaidCategory = (cats: string[] | null | undefined): string => {
  if (!cats || cats.length === 0) return "Other";
  const c0 = (cats[0] ?? "").toLowerCase();
  const c1 = (cats[1] ?? "").toLowerCase();
  const c2 = (cats[2] ?? "").toLowerCase();
  const all = [c0, c1, c2].join("|");

  // Transfers & payments — check before food since some are ambiguous
  if (all.includes("payroll") || all.includes("salary"))    return "Salary";
  if (all.includes("interest earned") || all.includes("dividend")) return "Interest & Dividends";
  if (all.includes("interest charged") || all.includes("bank fee") || all.includes("overdraft")) return "Bills & Utilities";
  if (all.includes("transfer in") || all.includes("credit") && all.includes("transfer")) return "Transfer In";
  if (all.includes("transfer out") || all.includes("debit") && all.includes("transfer")) return "Transfer Out";
  if (all.includes("internal account transfer") || all.includes("third party") || c0 === "transfer") return "Transfer Out";
  if (all.includes("credit card") || all.includes("payment")) return "Bills & Utilities";

  // Food & drink
  if (c0 === "food & drink" || c0 === "food and drink" || all.includes("restaurant") || all.includes("fast food") || all.includes("coffee")) return "Food & Drink";
  if (c0 === "groceries" || all.includes("groceries") || all.includes("grocery") || all.includes("supermarket")) return "Groceries";

  // Shopping
  if (c0 === "shopping" || c0 === "shops" || all.includes("hardware") || all.includes("clothing") || all.includes("sporting")) return "Shopping";

  // Transport
  if (c0 === "transportation" || all.includes("taxi") || all.includes("uber") || all.includes("lyft") || all.includes("gas station") || all.includes("parking") || all.includes("transit")) return "Transportation";
  if (c0 === "travel" || all.includes("lodging") || all.includes("hotel") || all.includes("airline") || all.includes("flight")) return "Travel";

  // Bills & utilities
  if (c0 === "bills & utilities" || c0 === "service" || all.includes("utilities") || all.includes("electric") || all.includes("water") || all.includes("gas") || all.includes("cable") || all.includes("telecom") || all.includes("subscription") || all.includes("internet") || all.includes("phone")) return "Bills & Utilities";

  // Entertainment
  if (c0 === "entertainment" || all.includes("entertainment") || all.includes("streaming") || all.includes("gaming") || all.includes("sport") || all.includes("recreation")) return "Entertainment";

  // Health
  if (c0 === "healthcare" || all.includes("pharmacy") || all.includes("medical") || all.includes("dental") || all.includes("doctor") || all.includes("health")) return "Healthcare";

  // Education
  if (c0 === "education" || all.includes("education") || all.includes("school") || all.includes("tuition")) return "Education";

  // Personal care
  if (all.includes("personal care") || all.includes("salon") || all.includes("barber") || all.includes("spa")) return "Personal Care";

  // Charity
  if (all.includes("charit") || all.includes("donation") || all.includes("nonprofit") || all.includes("government")) return "Charitable Giving";

  // Catch-all: use the first category title-cased
  const raw = cats[0];
  if (raw && raw !== "Other") return raw;
  return "Other";
};

// Category priority (highest → lowest):
// 1. Manual per-transaction override (user explicitly set this transaction's category)
// 2. Pattern rule match (user defined "starbucks → Coffee")
// 3. Plaid's category (normalised from raw Plaid strings)
const getEffectiveCategory = (t: PTxn, overrides: Record<string,string>, getRuleCategory: (m:string|null)=>string|null): string|null => {
  // 1. Manual override wins over everything
  if (overrides[t.id]) return overrides[t.id];
  // 2. Pattern rule
  const merchant = t.merchant_name ?? t.name ?? null;
  const ruleMatch = getRuleCategory(merchant);
  if (ruleMatch) return ruleMatch;
  // 3. Normalised Plaid category
  return normalisePlaidCategory(t.category);
};

// ── Right-panel drawer ─────────────────────────────────────────
/** Consistent right-side panel. Children = scrollable body. `footer` = pinned CTA row. */
const RightPanel = ({ open, onClose, children, footer }: {
  open: boolean; onClose: ()=>void; children: React.ReactNode; footer?: React.ReactNode;
}) => (
  <>
    {open && <div className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm" onClick={onClose} />}
    <div className={cn(
      "fixed inset-y-0 right-0 z-50 w-full sm:w-[460px] flex flex-col bg-card",
      "border-l shadow-2xl transition-transform duration-300 ease-out will-change-transform",
      open ? "translate-x-0" : "translate-x-full",
    )} style={{ borderColor: "var(--gold-border)" }}>
      <div className="flex-1 overflow-y-auto min-h-0">{children}</div>
      {footer && (
        <div className="shrink-0 px-5 py-4 border-t flex gap-2" style={{ borderColor: "var(--gold-border)" }}>
          {footer}
        </div>
      )}
    </div>
  </>
);

/** Consistent panel header — icon + title + subtitle + close */
const PanelHeader = ({ icon, iconColor, title, subtitle, badge, badgeClass, onClose }: {
  icon: React.ReactNode; iconColor: string; title: string; subtitle?: string;
  badge?: string; badgeClass?: string; onClose: ()=>void;
}) => (
  <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b" style={{ borderColor: "var(--gold-border)" }}>
    <div className="h-10 w-10 rounded-xl grid place-items-center shrink-0" style={{ backgroundColor:`${iconColor}1a`, color:iconColor }}>
      {icon}
    </div>
    <div className="flex-1 min-w-0">
      {badge && <span className={cn("text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border mb-1 inline-block", badgeClass)}>{badge}</span>}
      <div className="font-display text-lg text-foreground leading-snug">{title}</div>
      {subtitle && <div className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</div>}
    </div>
    <button onClick={onClose} className="shrink-0 h-7 w-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
      <X className="h-3.5 w-3.5" />
    </button>
  </div>
);

// ── Budget panel ────────────────────────────────────────────────
const BudgetPanel = ({ category, current, onSave, onRemove, onClose }: {
  category: string; current?: number; onSave:(v:number)=>void; onRemove:()=>void; onClose:()=>void;
}) => {
  const [val, setVal] = useState(String(current ?? ""));
  const color = catColor(category);
  const Icon  = categoryIcon(category);
  const save  = () => { const n=parseFloat(val); if(!isNaN(n)&&n>=0){onSave(n);onClose();} };
  return (
    <Dialog open onOpenChange={(o)=>{ if(!o) onClose(); }}>
      <DialogContent className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">{formatCat(category)} budget</DialogTitle>
        <DialogDescription className="sr-only">Set a monthly spending limit for {formatCat(category)}.</DialogDescription>
        <div className="relative p-6 pb-4">
          <button onClick={onClose}
            className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-9 w-9 rounded-lg grid place-items-center shrink-0" style={{backgroundColor:`${color}1f`,color}}>
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-display text-lg text-foreground">{formatCat(category)} budget</h3>
              <div className="text-[11px] text-muted-foreground">Monthly spending limit</div>
            </div>
          </div>
          <p className="text-[12px] text-muted-foreground mb-4">
            You'll see a progress bar when you're close to the limit.
          </p>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Monthly limit</label>
            <div className="relative mt-2">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[14px]">$</span>
              <input type="number" min={0} step={10} value={val} onChange={e=>setVal(e.target.value)} autoFocus
                onKeyDown={e=>e.key==="Enter"&&save()}
                placeholder="e.g. 500"
                className="w-full bg-surface/40 border border-border/60 rounded-lg pl-7 pr-3 py-3 text-[15px] text-foreground outline-none focus:border-foreground/40" />
            </div>
          </div>
          {current!=null && val && parseFloat(val)!==current && (
            <div className="mt-3 surface-card p-3 text-[12px] text-muted-foreground">
              Changing from <span className="text-foreground font-medium">{fmtUSD(current)}/mo</span> to <span className="text-foreground font-medium">{fmtUSD(parseFloat(val)||0)}/mo</span>
            </div>
          )}
        </div>
        <div className="hairline p-4 flex gap-2">
          <button onClick={save} className="flex-1 inline-flex items-center justify-center h-10 rounded-lg bg-gold text-[13px] font-medium hover:opacity-90">
            {current!=null?"Update budget":"Set budget"}
          </button>
          {current!=null && (
            <button onClick={()=>{onRemove();onClose();}}
              className="h-10 px-4 rounded-lg border text-[12px] text-negative hover:bg-negative/10 transition-colors"
              style={{borderColor:"hsl(var(--negative)/0.3)"}}>
              Remove
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── Inline category picker (floating dropdown) ─────────────────

const InlineCategoryPicker = ({
  txn, current, existingRule, customCategories,
  onSelect, onAddCategory, onAddRule, onRemoveCustom, onClose,
}: {
  txn: PTxn;
  current: string;
  existingRule?: string;
  customCategories: { name:string; type:"income"|"expense" }[];
  onSelect: (cat: string, createRule: boolean) => void;
  onAddCategory: (name: string, type: "income"|"expense") => void;
  onAddRule: (merchant: string, cat: string) => void;
  onRemoveCustom: (name: string) => void;
  onClose: () => void;
}) => {
  const isIncomeTxn = Number(txn.amount) < 0;
  const [tab, setTab]           = useState<"expense"|"income">(isIncomeTxn ? "income" : "expense");
  const [search, setSearch]     = useState("");
  const [alwaysApply, setAlways] = useState(!!existingRule);
  const merchant = txn.merchant_name ?? txn.name ?? null;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const builtIn = tab === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const extras  = customCategories.filter(c=>c.type===tab).map(c=>c.name);
  const allCats = [...builtIn, ...extras];
  const filtered = search
    ? allCats.filter(c=>c.toLowerCase().includes(search.toLowerCase()))
    : allCats;
  const canCreate = !!search && !allCats.some(c=>c.toLowerCase()===search.toLowerCase());

  const pick = (cat: string) => {
    onSelect(cat, alwaysApply && !!merchant);
    if (alwaysApply && merchant) onAddRule(merchant, cat);
    onClose();
  };

  return (
    <div className="w-full surface-elevated overflow-hidden" onClick={e=>e.stopPropagation()}>
        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/30">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input ref={inputRef} value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search or create…"
            className="flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground" />
          {search && <button aria-label="Clear search" onClick={()=>setSearch("")} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>}
        </div>
        {/* Income / Expense tabs */}
        <div className="flex border-b border-border/30">
          {(["expense","income"] as const).map(t=>(
            <button key={t} onClick={()=>setTab(t)}
              className={cn("flex-1 py-1.5 text-[11px] font-medium transition-colors capitalize",
                tab===t?"text-foreground bg-secondary/40":"text-muted-foreground hover:text-foreground")}>
              {t}
            </button>
          ))}
        </div>
        {/* Category list */}
        <div className="max-h-52 overflow-y-auto">
          {filtered.map(cat => {
            const Icon  = categoryIcon(cat);
            const color = catColor(cat);
            const active = cat === current;
            const isCustom = !builtIn.includes(cat);
            return (
              <div key={cat} className="group/item flex items-center">
                <button onClick={()=>pick(cat)}
                  className={cn("flex-1 flex items-center gap-2 px-3 py-2 text-left hover:bg-secondary/50 transition-colors",active&&"bg-secondary/30")}>
                  <div className="h-5 w-5 rounded grid place-items-center shrink-0" style={{backgroundColor:`${color}1f`,color}}>
                    <Icon className="h-3 w-3" />
                  </div>
                  <span className="text-[12px] text-foreground flex-1">{cat}</span>
                  {active && <Check className="h-3 w-3 text-positive shrink-0" />}
                </button>
                {isCustom && (
                  <button onClick={()=>onRemoveCustom(cat)}
                    className="px-2 opacity-0 group-hover/item:opacity-100 text-muted-foreground hover:text-negative transition-all">
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
          {canCreate && (
            <button onClick={()=>{ onAddCategory(search, tab); pick(search); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-secondary/50 transition-colors text-gold">
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span className="text-[12px]">Create "{search}"</span>
            </button>
          )}
          {filtered.length===0 && !canCreate && (
            <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">No matches</div>
          )}
        </div>
        {/* Always-apply toggle */}
        {merchant && (
          <label className="flex items-center gap-2 px-3 py-2.5 border-t border-border/30 cursor-pointer hover:bg-secondary/30 transition-colors">
            <input type="checkbox" checked={alwaysApply} onChange={e=>setAlways(e.target.checked)}
              className="accent-[hsl(var(--primary))] h-3.5 w-3.5" />
            <span className="text-[11px] text-muted-foreground leading-snug">
              Always apply to <span className="text-foreground font-medium truncate">"{merchant}"</span>
            </span>
          </label>
        )}
      </div>
  );
};

// ── Transaction row ────────────────────────────────────────────
const TxnRow = ({ t, i, overrides, getRuleCategory, isInternal, isAutoInternal, nameOverride, isManualInternal, onToggleInternal, onOpenDetail, onOpenDetailCat }: {
  t: PTxn; i: number;
  overrides: Record<string,string>;
  getRuleCategory: (m:string|null)=>string|null;
  isInternal?: boolean;
  isAutoInternal?: boolean;
  nameOverride?: string;
  isManualInternal?: boolean;
  onToggleInternal?: (id: string) => void;
  onOpenDetail: (txn: PTxn) => void;
  onOpenDetailCat: (txn: PTxn) => void;
}) => {
  const rawCat     = getEffectiveCategory(t, overrides, getRuleCategory);
  const displayCat = humanizeCategory(rawCat, Number(t.amount));
  const isIncome   = Number(t.amount) < 0;
  const Icon       = isIncome ? ArrowDownLeft : categoryIcon(rawCat);
  const isEdited   = !!overrides[t.id] || !!getRuleCategory(t.merchant_name ?? t.name ?? null);
  const displayName = nameOverride ?? t.merchant_name ?? t.name ?? "Transaction";

  return (
    <div className={cn(
      "group grid items-center gap-2 px-4 md:px-5 py-2.5 transition-colors hover:bg-surface-hover/30 cursor-pointer",
      i > 0 && "border-t border-border/20",
      isInternal && "opacity-60",
    )} style={{gridTemplateColumns:"auto 1fr auto auto"}}
      onClick={() => onOpenDetail(t)}>
      {/* Category icon */}
      <div className={cn("h-7 w-7 rounded-lg grid place-items-center border shrink-0 transition-colors",
        isInternal ? "bg-secondary/40 border-border/30 text-muted-foreground/50"
        : isIncome ? "bg-positive/10 border-positive/20 text-positive"
        : "bg-secondary/50 border-border/40 text-muted-foreground")}>
        <Icon className="h-3.5 w-3.5" />
      </div>

      {/* Name + meta */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={cn("text-[12.5px] font-medium truncate", isInternal ? "line-through text-muted-foreground" : "text-foreground")}>
            {displayName}
          </span>
          {nameOverride && <span className="text-[10px] text-[hsl(var(--primary)/0.5)] shrink-0">edited</span>}
          {isManualInternal && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-muted-foreground/20 bg-secondary/50 text-muted-foreground/60 shrink-0">Transfer</span>}
          {!isManualInternal && isInternal && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-muted-foreground/20 bg-secondary/50 text-muted-foreground/60 shrink-0">Internal</span>}
          {t.pending && <span className="text-[10px] uppercase px-1.5 py-0.5 rounded border border-warning/30 bg-warning/10 text-warning shrink-0">Pending</span>}
        </div>
        <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
          <span>{new Date(t.date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>
          {displayCat && !isInternal && <>
            <span className="text-muted-foreground/30">·</span>
            <button onClick={e=>{e.stopPropagation();onOpenDetailCat(t);}}
              className={cn("inline-flex items-center gap-0.5 rounded px-1 -mx-1 transition-colors hover:bg-secondary/40 hover:text-foreground",
                isEdited&&"text-info")}
              title="Click to change category">
              {displayCat}
              <Pencil className="h-2 w-2 opacity-0 group-hover:opacity-40 ml-0.5 shrink-0 transition-opacity" />
            </button>
          </>}
        </div>
      </div>

      {/* Amount */}
      <div className={cn("text-right text-[12.5px] tabular font-semibold shrink-0",
        isInternal?"text-muted-foreground/50":isIncome?"text-positive":"text-foreground")}>
        {isIncome?"+":"−"}{fmtUSD(Math.abs(Number(t.amount)),{cents:true})}
      </div>

      {/* Transfer toggle — hover on desktop, always visible when active */}
      <button
        onClick={e=>{e.stopPropagation();onToggleInternal?.(t.id);}}
        title={isManualInternal ? "Remove transfer mark" : isAutoInternal && !isInternal ? "Auto-detected as transfer (un-flagged, click to re-flag)" : isAutoInternal ? "Auto-detected as transfer, click to un-flag" : "Mark as internal transfer"}
        className={cn(
          "h-6 w-6 grid place-items-center rounded transition-all shrink-0",
          isManualInternal || isAutoInternal
            ? "text-info bg-info/10"
            : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-secondary/60 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        )}>
        <RepeatIcon className="h-3 w-3" />
      </button>
    </div>
  );
};

// ── Transaction detail modal ──────────────────────────────────────────
type RenameRequest = { txnId: string; merchant: string | null; newName: string; matchingCount: number };

// ── Shared condition editor (used by the filter and by Smart Rules) ────
const ConditionRows = ({ set, onChange, accounts, categoryOptions, compact }: {
  set: ConditionSet;
  onChange: (s: ConditionSet) => void;
  accounts: { account_id: string; name: string; type: string | null }[];
  categoryOptions: string[];
  compact?: boolean;
}) => {
  const acctTypes = Array.from(new Set(accounts.map(a => a.type).filter(Boolean))) as string[];
  // Matches the transaction toolbar controls so the whole app reads as one system.
  const inputCls = "h-8 rounded-lg bg-secondary/40 border border-border/40 text-[11.5px] text-foreground px-2.5 outline-none focus:border-[hsl(var(--primary)/0.5)] transition-colors";

  const patch = (id: string, p: Partial<Condition>) =>
    onChange({ ...set, conditions: set.conditions.map(c => c.id === id ? { ...c, ...p } : c) });
  const removeRow = (id: string) => onChange({ ...set, conditions: set.conditions.filter(c => c.id !== id) });
  const addRow = () => onChange({ ...set, conditions: [...set.conditions, emptyCondition()] });

  const onFieldChange = (c: Condition, field: TxnField) => {
    const ops = FIELD_META[field].ops;
    patch(c.id, { field, op: ops[0], value: field === "flow" ? "expense" : field === "pending" ? "true" : "", value2: undefined });
  };

  // Plain render function (NOT a nested component) so text inputs keep focus
  // across the parent re-render each keystroke triggers.
  const renderValue = (c: Condition) => {
    const meta = FIELD_META[c.field];
    if (c.field === "account")
      return (
        <select value={c.value} onChange={e => patch(c.id, { value: e.target.value })} className={cn(inputCls, "flex-1 min-w-0")}>
          <option value="">Select account…</option>
          {accounts.map(a => <option key={a.account_id} value={a.account_id}>{a.name}</option>)}
        </select>
      );
    if (c.field === "account_type")
      return (
        <select value={c.value} onChange={e => patch(c.id, { value: e.target.value })} className={cn(inputCls, "flex-1 min-w-0")}>
          <option value="">Select type…</option>
          {acctTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      );
    if (c.field === "flow")
      return (
        <select value={c.value} onChange={e => patch(c.id, { value: e.target.value })} className={cn(inputCls, "flex-1 min-w-0")}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
      );
    if (c.field === "pending")
      return (
        <select value={c.value} onChange={e => patch(c.id, { value: e.target.value })} className={cn(inputCls, "flex-1 min-w-0")}>
          <option value="true">Pending</option>
          <option value="false">Posted</option>
        </select>
      );
    if (meta.kind === "number")
      return (
        <div className="flex-1 flex items-center gap-1 min-w-0">
          <input type="number" value={c.value} onChange={e => patch(c.id, { value: e.target.value })} placeholder="0" className={cn(inputCls, "flex-1 min-w-0")} />
          {c.op === "between" && <>
            <span className="text-[10px] text-muted-foreground">and</span>
            <input type="number" value={c.value2 ?? ""} onChange={e => patch(c.id, { value2: e.target.value })} placeholder="0" className={cn(inputCls, "flex-1 min-w-0")} />
          </>}
        </div>
      );
    if (meta.kind === "date")
      return (
        <div className="flex-1 flex items-center gap-1 min-w-0">
          <input type="date" value={c.value} onChange={e => patch(c.id, { value: e.target.value })} className={cn(inputCls, "flex-1 min-w-0")} />
          {c.op === "between" && <>
            <span className="text-[10px] text-muted-foreground">and</span>
            <input type="date" value={c.value2 ?? ""} onChange={e => patch(c.id, { value2: e.target.value })} className={cn(inputCls, "flex-1 min-w-0")} />
          </>}
        </div>
      );
    // text (merchant, category)
    return (
      <>
        <input list={c.field === "category" ? "cond-cats" : undefined} value={c.value} onChange={e => patch(c.id, { value: e.target.value })}
          placeholder={c.field === "category" ? "Category…" : "Text…"} className={cn(inputCls, "flex-1 min-w-0")} />
        {c.field === "category" && (
          <datalist id="cond-cats">{categoryOptions.map(o => <option key={o} value={o} />)}</datalist>
        )}
      </>
    );
  };

  return (
    <div className="space-y-2">
      {set.conditions.length > 1 && (
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-muted-foreground">Match</span>
          <div className="flex rounded-md border border-border/60 overflow-hidden">
            {(["all", "any"] as const).map(m => (
              <button key={m} type="button" onClick={() => onChange({ ...set, match: m })}
                className={cn("px-2.5 py-1 text-[10.5px] font-medium transition-colors", set.match === m ? "bg-[hsl(var(--primary))] text-background" : "text-muted-foreground hover:text-foreground")}>
                {m === "all" ? "ALL" : "ANY"}
              </button>
            ))}
          </div>
          <span className="text-muted-foreground">of the conditions</span>
        </div>
      )}
      {set.conditions.map(c => (
        <div key={c.id} className="flex items-center gap-1.5">
          <select value={c.field} onChange={e => onFieldChange(c, e.target.value as TxnField)}
            className={cn(inputCls, "shrink-0", compact ? "w-[92px]" : "w-[110px]")}>
            {(Object.keys(FIELD_META) as TxnField[]).map(f => <option key={f} value={f}>{FIELD_META[f].label}</option>)}
          </select>
          <select value={c.op} onChange={e => patch(c.id, { op: e.target.value as TxnOp })}
            className={cn(inputCls, "shrink-0", compact ? "w-[96px]" : "w-[120px]")}>
            {FIELD_META[c.field].ops.map(op => <option key={op} value={op}>{OP_LABEL[op]}</option>)}
          </select>
          {renderValue(c)}
          <button type="button" onClick={() => removeRow(c.id)} className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-negative shrink-0">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={addRow} className="inline-flex items-center gap-1 text-[11px] text-[hsl(var(--primary))] hover:opacity-80">
        <Plus className="h-3 w-3" /> Add condition
      </button>
    </div>
  );
};

// ── Rules Manager ──────────────────────────────────────────────
const RulesManager = ({
  rules, nameRules, allTxns, onRemoveCatRule, onToggleCatRule, onUpdateCatRule,
  onAddCatRule, onSaveNameRule, onRemoveNameRule, onClose,
  smartRules, evalTxns, accounts, categoryOptions,
  onAddSmartRule, onUpdateSmartRule, onRemoveSmartRule, onToggleSmartRule,
}: {
  rules: CategoryRule[];
  nameRules: Record<string, string>;
  allTxns: { merchant_name: string | null; name: string | null }[];
  onRemoveCatRule: (id: string) => void;
  onToggleCatRule: (id: string) => void;
  onUpdateCatRule: (id: string, updates: Partial<Pick<CategoryRule, "pattern" | "category" | "matchType" | "enabled">>) => void;
  onAddCatRule: (pattern: string, category: string, matchType?: RuleMatchType) => void;
  onSaveNameRule: (merchant: string, name: string) => void;
  onRemoveNameRule: (merchant: string) => void;
  onClose: () => void;
  smartRules: SmartRule[];
  evalTxns: { id: string; ev: EvalTxn }[];
  accounts: { account_id: string; name: string; type: string | null }[];
  categoryOptions: string[];
  onAddSmartRule: (rule: SmartRule) => void;
  onUpdateSmartRule: (id: string, patch: Partial<SmartRule>) => void;
  onRemoveSmartRule: (id: string) => void;
  onToggleSmartRule: (id: string) => void;
}) => {
  const [tab, setTab] = useState<"smart" | "category" | "names">("smart");
  const [draftRule, setDraftRule] = useState<SmartRule | null>(null);
  const countSmartMatches = (rule: SmartRule) =>
    evalTxns.reduce((n, { ev }) => n + (ruleMatches({ ...rule, enabled: true }, ev) ? 1 : 0), 0);
  const [editId, setEditId] = useState<string | null>(null);
  const [editPattern, setEditPattern] = useState("");
  const [editMatchType, setEditMatchType] = useState<RuleMatchType>("contains");
  const [editCategory, setEditCategory] = useState("");
  const [editNameKey, setEditNameKey] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [showNewCat, setShowNewCat] = useState(false);
  const [newPattern, setNewPattern] = useState("");
  const [newMatchType, setNewMatchType] = useState<RuleMatchType>("contains");
  const [newCategory, setNewCategory] = useState("");
  const [showNewName, setShowNewName] = useState(false);
  const [newNameMerchant, setNewNameMerchant] = useState("");
  const [newNameDisplay, setNewNameDisplay] = useState("");

  const countMatches = (pattern: string, matchType: RuleMatchType) =>
    allTxns.filter(t => {
      const m = (t.merchant_name ?? t.name ?? "").toLowerCase();
      const p = pattern.toLowerCase();
      switch (matchType) {
        case "exact": return m === p;
        case "starts_with": return m.startsWith(p);
        default: return m.includes(p);
      }
    }).length;

  const matchLabel = (mt: RuleMatchType) =>
    mt === "exact" ? "is exactly" : mt === "starts_with" ? "starts with" : "contains";

  const userRules = rules.filter(r => r.source !== "system");
  const sysRules  = rules.filter(r => r.source === "system");
  const nameEntries = Object.entries(nameRules);

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[88dvh] flex flex-col">
        <DialogTitle className="sr-only">Rules</DialogTitle>
        <DialogDescription className="sr-only">Manage transaction rules</DialogDescription>

        {/* Header */}
        <div className="px-5 py-4 border-b border-border/30 shrink-0 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-display text-[15px] text-foreground font-semibold">Transaction Rules</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Rules apply automatically to every transaction, new and old</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => {
                const enabled = smartRules.filter(r => r.enabled);
                const affected = new Set<string>();
                for (const { id, ev } of evalTxns)
                  for (const r of enabled) if (ruleMatches(r, ev)) { affected.add(id); break; }
                toast.success("Rules are live", {
                  description: `${enabled.length} active rule${enabled.length !== 1 ? "s" : ""} currently affecting ${affected.size} transaction${affected.size !== 1 ? "s" : ""}.`,
                });
              }}
              title="Re-check rules against all transactions"
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border-strong text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors">
              <RefreshCw className="h-3.5 w-3.5" /> Run rules
            </button>
            <button onClick={() => {
                if (tab === "smart") setDraftRule(emptyRule());
                else { setShowNewCat(tab === "category"); setShowNewName(tab === "names"); }
                setEditId(null); setEditNameKey(null);
              }}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-gold text-[12px] font-semibold shrink-0">
              <Plus className="h-3.5 w-3.5" /> New Rule
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-border/20 shrink-0">
          {([["smart", "Smart Rules", smartRules.length], ["category", "Category Rules", rules.length], ["names", "Name Rules", nameEntries.length]] as const).map(([k, label, count]) => (
            <button key={k} onClick={() => setTab(k)}
              className={cn("flex-1 py-2.5 text-[12.5px] font-medium transition-colors border-b-2 -mb-px",
                tab === k ? "border-[hsl(var(--primary))] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {label}
              {count > 0 && <span className={cn("ml-1.5 px-1.5 py-0.5 rounded-full text-[10px]", tab === k ? "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))]" : "bg-border/40 text-muted-foreground")}>{count}</span>}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">

          {/* ── SMART RULES TAB ── */}
          {tab === "smart" && (
            <div className="divide-y divide-border/10">
              {/* Draft (create/edit) form */}
              {draftRule && (
                <div className="p-4 bg-[hsl(var(--primary)/0.04)] border-b border-[hsl(var(--primary)/0.12)] space-y-3">
                  <div className="flex items-center gap-2">
                    <Wand2 className="h-4 w-4 text-[hsl(var(--primary))]" />
                    <input value={draftRule.name} onChange={e => setDraftRule({ ...draftRule, name: e.target.value })}
                      placeholder="Rule name (e.g. Coffee shops)"
                      className="flex-1 h-8 px-2.5 rounded-lg bg-secondary/40 border border-border/40 text-[12px] font-medium text-foreground outline-none focus:border-[hsl(var(--primary)/0.5)]" />
                  </div>

                  <div className="rounded-lg border border-border/40 p-3 space-y-2">
                    <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">When a transaction matches</div>
                    <ConditionRows set={{ match: draftRule.match, conditions: draftRule.conditions }}
                      onChange={s => setDraftRule({ ...draftRule, match: s.match, conditions: s.conditions })}
                      accounts={accounts} categoryOptions={categoryOptions} />
                  </div>

                  <div className="rounded-lg border border-border/40 p-3 space-y-2">
                    <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">Then do</div>
                    {draftRule.actions.map((a, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <select value={a.type} onChange={e => {
                            const type = e.target.value as RuleAction["type"];
                            const next = [...draftRule.actions];
                            next[i] = type === "mark_internal" ? { type } : { type, value: "" } as RuleAction;
                            setDraftRule({ ...draftRule, actions: next });
                          }}
                          className="h-8 w-[130px] shrink-0 rounded-lg bg-secondary/40 border border-border/40 text-[11.5px] text-foreground px-2 outline-none">
                          <option value="set_category">Set category</option>
                          <option value="rename">Rename to</option>
                          <option value="mark_internal">Mark internal</option>
                        </select>
                        {a.type !== "mark_internal" && (
                          <input list={a.type === "set_category" ? "smart-cats" : undefined}
                            value={a.value} onChange={e => {
                              const next = [...draftRule.actions];
                              next[i] = { ...a, value: e.target.value } as RuleAction;
                              setDraftRule({ ...draftRule, actions: next });
                            }}
                            placeholder={a.type === "set_category" ? "Category…" : "Display name…"}
                            className="flex-1 min-w-0 h-8 rounded-lg bg-secondary/40 border border-border/40 text-[11.5px] text-foreground px-2 outline-none focus:border-[hsl(var(--primary)/0.5)]" />
                        )}
                        {a.type === "mark_internal" && <span className="flex-1 text-[11px] text-muted-foreground px-1">Excludes it from spending totals</span>}
                        {draftRule.actions.length > 1 && (
                          <button onClick={() => setDraftRule({ ...draftRule, actions: draftRule.actions.filter((_, j) => j !== i) })}
                            className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-negative shrink-0"><X className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                    ))}
                    <datalist id="smart-cats">{categoryOptions.map(o => <option key={o} value={o} />)}</datalist>
                    <button onClick={() => setDraftRule({ ...draftRule, actions: [...draftRule.actions, { type: "set_category", value: "" }] })}
                      className="inline-flex items-center gap-1 text-[11px] text-[hsl(var(--primary))] hover:opacity-80"><Plus className="h-3 w-3" /> Add action</button>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">
                      Matches <span className="text-[hsl(var(--primary))] font-semibold">{countSmartMatches(draftRule)}</span> current transactions
                    </span>
                    <div className="flex gap-2">
                      <button onClick={() => setDraftRule(null)} className="h-8 px-3 rounded-md border border-border-strong text-[11.5px] text-muted-foreground">Cancel</button>
                      <button onClick={() => {
                          const clean = { ...draftRule, name: draftRule.name.trim() || "Untitled rule" };
                          if (smartRules.some(r => r.id === clean.id)) onUpdateSmartRule(clean.id, clean);
                          else onAddSmartRule(clean);
                          setDraftRule(null);
                        }}
                        disabled={!draftRule.conditions.some(c => (c.value ?? "").trim() !== "" || c.field === "pending" || c.field === "flow")}
                        className="h-8 px-4 rounded-md bg-gold text-[11.5px] font-semibold disabled:opacity-50">Save rule</button>
                    </div>
                  </div>
                </div>
              )}

              {smartRules.length === 0 && !draftRule && (
                <div className="py-10 text-center space-y-2 px-6">
                  <div className="h-11 w-11 mx-auto rounded-full bg-[hsl(var(--primary)/0.08)] grid place-items-center">
                    <Wand2 className="h-5 w-5 text-[hsl(var(--primary)/0.6)]" />
                  </div>
                  <div className="text-[13px] text-foreground font-medium">No smart rules yet</div>
                  <div className="text-[11.5px] text-muted-foreground">Build one rule that combines any conditions - amount, name, fuzzy match, account, date - and set a category, rename, or mark it internal. It runs automatically on new transactions.</div>
                  <button onClick={() => setDraftRule(emptyRule())} className="mt-1 text-[11.5px] text-[hsl(var(--primary))] underline underline-offset-2">Create your first smart rule</button>
                </div>
              )}

              {smartRules.map(rule => {
                const count = countSmartMatches(rule);
                const summary = (c: Condition) => `${FIELD_META[c.field].label} ${OP_LABEL[c.op]}${c.field === "pending" || c.field === "flow" ? "" : ` ${c.value}`}${c.op === "between" ? ` – ${c.value2 ?? ""}` : ""}`;
                const actionSummary = (a: RuleAction) => a.type === "mark_internal" ? "mark internal" : a.type === "rename" ? `rename to "${a.value}"` : `set category → ${formatCat(a.value)}`;
                return (
                  <div key={rule.id} className={cn("px-4 py-3.5", !rule.enabled && "opacity-50")}>
                    <div className="flex items-start gap-3">
                      <div className="h-8 w-8 rounded-lg bg-[hsl(var(--primary)/0.1)] grid place-items-center shrink-0 mt-0.5">
                        <Wand2 className="h-4 w-4 text-[hsl(var(--primary))]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] font-semibold text-foreground">{rule.name}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          <span className="text-muted-foreground/70">If {rule.match === "all" ? "all" : "any"}: </span>
                          {rule.conditions.map(summary).join(rule.match === "all" ? " and " : " or ")}
                        </div>
                        <div className="text-[11px] mt-0.5">
                          <span className="text-muted-foreground/70">Then: </span>
                          <span className="text-foreground">{rule.actions.map(actionSummary).join(", ")}</span>
                        </div>
                        <div className="text-[10.5px] text-[hsl(var(--primary))] mt-1">{count} match{count !== 1 ? "es" : ""}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => onToggleSmartRule(rule.id)}
                          className={cn("h-7 px-2.5 rounded-full text-[10px] font-medium transition-colors border",
                            rule.enabled ? "bg-positive/10 text-positive border-positive/20" : "bg-border/30 text-muted-foreground border-border/40")}>
                          {rule.enabled ? "On" : "Off"}
                        </button>
                        <button onClick={() => setDraftRule(JSON.parse(JSON.stringify(rule)))}
                          className="h-7 w-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-border/30"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => onRemoveSmartRule(rule.id)}
                          className="h-7 w-7 rounded-md grid place-items-center text-muted-foreground hover:text-negative hover:bg-negative/10"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── CATEGORY RULES TAB ── */}
          {tab === "category" && (
            <div className="divide-y divide-border/10">

              {/* New category rule form */}
              {showNewCat && (
                <div className="p-4 bg-[hsl(var(--primary)/0.04)] border-b border-[hsl(var(--primary)/0.12)] space-y-3">
                  <div className="text-[11.5px] font-semibold text-foreground">New category rule</div>
                  <div className="grid grid-cols-[auto_1fr] gap-2 items-center">
                    <span className="text-[11px] text-muted-foreground">When name</span>
                    <select value={newMatchType} onChange={e => setNewMatchType(e.target.value as RuleMatchType)}
                      className="h-8 px-2 rounded-lg bg-secondary/40 border border-border/40 text-[11px] outline-none focus:border-[hsl(var(--primary)/0.5)]">
                      <option value="contains">contains</option>
                      <option value="starts_with">starts with</option>
                      <option value="exact">is exactly</option>
                    </select>
                    <span className="text-[11px] text-muted-foreground">Pattern</span>
                    <input value={newPattern} onChange={e => setNewPattern(e.target.value)} placeholder="e.g. Amazon, Starbucks…"
                      className="h-8 px-2.5 rounded-lg bg-secondary/40 border border-border/40 text-[11px] outline-none focus:border-[hsl(var(--primary)/0.5)]" />
                    <span className="text-[11px] text-muted-foreground">Category</span>
                    <input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="e.g. Shopping, Food…"
                      className="h-8 px-2.5 rounded-lg bg-secondary/40 border border-border/40 text-[11px] outline-none focus:border-[hsl(var(--primary)/0.5)]" />
                  </div>
                  {newPattern && newCategory && (
                    <div className="text-[10.5px] text-muted-foreground bg-border/20 rounded-md px-3 py-1.5">
                      When merchant name {matchLabel(newMatchType)} <strong className="text-foreground">"{newPattern}"</strong> → set category to <strong className="text-foreground">{formatCat(newCategory)}</strong>
                      <span className="ml-2 text-[hsl(var(--primary))]">({countMatches(newPattern, newMatchType)} matches)</span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => {
                      if (!newPattern.trim() || !newCategory.trim()) return;
                      onAddCatRule(newPattern.trim(), newCategory.trim(), newMatchType);
                      setNewPattern(""); setNewCategory(""); setNewMatchType("contains"); setShowNewCat(false);
                    }} className="h-8 px-4 rounded-md bg-gold text-[11.5px] font-semibold">Save rule</button>
                    <button onClick={() => { setShowNewCat(false); setNewPattern(""); setNewCategory(""); }} className="h-8 px-3 rounded-md border border-border-strong text-[11.5px] text-muted-foreground">Cancel</button>
                  </div>
                </div>
              )}

              {userRules.length === 0 && !showNewCat && (
                <div className="py-10 text-center space-y-2">
                  <div className="text-[13px] text-foreground font-medium">No category rules yet</div>
                  <div className="text-[11.5px] text-muted-foreground">Rules auto-categorize transactions based on merchant name patterns.</div>
                  <button onClick={() => setShowNewCat(true)} className="mt-2 text-[11.5px] text-[hsl(var(--primary))] underline underline-offset-2">Create your first rule</button>
                </div>
              )}

              {userRules.map(r => {
                const isEditing = editId === r.id;
                const Icon = categoryIcon(r.category);
                const color = catColor(r.category);
                const matches = countMatches(r.pattern, r.matchType);
                return (
                  <div key={r.id} className={cn("px-4 py-3.5 transition-colors", !r.enabled && "opacity-50", isEditing && "bg-[hsl(var(--primary)/0.04)]")}>
                    {isEditing ? (
                      <div className="space-y-2.5">
                        <div className="text-[11px] font-semibold text-foreground mb-1">Edit rule</div>
                        <div className="grid grid-cols-[auto_1fr] gap-2 items-center">
                          <span className="text-[11px] text-muted-foreground">When name</span>
                          <select value={editMatchType} onChange={e => setEditMatchType(e.target.value as RuleMatchType)}
                            className="h-8 px-2 rounded-lg bg-secondary/40 border border-border/40 text-[11px] outline-none focus:border-[hsl(var(--primary)/0.5)]">
                            <option value="contains">contains</option>
                            <option value="starts_with">starts with</option>
                            <option value="exact">is exactly</option>
                          </select>
                          <span className="text-[11px] text-muted-foreground">Pattern</span>
                          <input value={editPattern} onChange={e => setEditPattern(e.target.value)}
                            className="h-8 px-2.5 rounded-md bg-background border border-[hsl(var(--primary)/0.4)] text-[11px] outline-none focus:border-[hsl(var(--primary)/0.6)]" />
                          <span className="text-[11px] text-muted-foreground">Category</span>
                          <input value={editCategory} onChange={e => setEditCategory(e.target.value)}
                            className="h-8 px-2.5 rounded-lg bg-secondary/40 border border-border/40 text-[11px] outline-none focus:border-[hsl(var(--primary)/0.5)]" />
                        </div>
                        {editPattern && editCategory && (
                          <div className="text-[10.5px] text-muted-foreground bg-border/20 rounded-md px-3 py-1.5">
                            When merchant {matchLabel(editMatchType)} <strong className="text-foreground">"{editPattern}"</strong> → <strong className="text-foreground">{formatCat(editCategory)}</strong>
                            <span className="ml-2 text-[hsl(var(--primary))]">({countMatches(editPattern, editMatchType)} matches)</span>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button onClick={() => { onUpdateCatRule(r.id, { pattern: editPattern, matchType: editMatchType, category: editCategory }); setEditId(null); }}
                            className="h-8 px-4 rounded-md bg-gold text-[11.5px] font-semibold">Save changes</button>
                          <button onClick={() => setEditId(null)} className="h-8 px-3 rounded-md border border-border-strong text-[11.5px] text-muted-foreground">Cancel</button>
                          <button onClick={() => { onRemoveCatRule(r.id); setEditId(null); }}
                            className="h-8 px-3 rounded-md text-[11.5px] text-negative hover:bg-negative/10 ml-auto">Delete</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3">
                        <div className="h-8 w-8 rounded-lg grid place-items-center shrink-0 mt-0.5" style={{ backgroundColor: `${color}20`, color }}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12.5px] font-medium text-foreground">
                            When name <span className="text-muted-foreground font-normal">{matchLabel(r.matchType)}</span> <span className="font-semibold">"{r.pattern}"</span>
                          </div>
                          <div className="text-[12px] text-muted-foreground mt-0.5">
                            Category: <span className="text-foreground font-medium">{formatCat(r.category)}</span>
                            <span className="mx-1.5 text-border">·</span>
                            <span className={cn(matches > 0 ? "text-[hsl(var(--primary))]" : "text-muted-foreground")}>{matches} match{matches !== 1 ? "es" : ""}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => onToggleCatRule(r.id)}
                            className={cn("h-7 px-2.5 rounded-full text-[10px] font-medium transition-colors border",
                              r.enabled ? "bg-positive/10 text-positive border-positive/20 hover:bg-positive/20" : "bg-border/30 text-muted-foreground border-border/40 hover:bg-border/50")}>
                            {r.enabled ? "On" : "Off"}
                          </button>
                          <button onClick={() => { setEditId(r.id); setEditPattern(r.pattern); setEditMatchType(r.matchType); setEditCategory(r.category); setShowNewCat(false); }}
                            className="h-7 w-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-border/30 transition-colors">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => onRemoveCatRule(r.id)}
                            className="h-7 w-7 rounded-md grid place-items-center text-muted-foreground hover:text-negative hover:bg-negative/10 transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {sysRules.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-border/10">
                    <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">System rules</span>
                    <span className="text-[10px] text-muted-foreground ml-2">(auto-generated, can be toggled)</span>
                  </div>
                  {sysRules.map(r => {
                    const Icon = categoryIcon(r.category);
                    const color = catColor(r.category);
                    return (
                      <div key={r.id} className={cn("px-4 py-3 flex items-center gap-3", !r.enabled && "opacity-40")}>
                        <div className="h-7 w-7 rounded-lg grid place-items-center shrink-0" style={{ backgroundColor: `${color}20`, color }}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] text-foreground">
                            <span className="text-muted-foreground">{matchLabel(r.matchType)} </span>
                            <span className="font-medium">"{r.pattern}"</span>
                            <span className="text-muted-foreground"> → </span>
                            <span className="font-medium">{formatCat(r.category)}</span>
                          </div>
                          <div className="text-[10px] text-muted-foreground">{countMatches(r.pattern, r.matchType)} matches</div>
                        </div>
                        <button onClick={() => onToggleCatRule(r.id)}
                          className={cn("h-7 px-2.5 rounded-full text-[10px] font-medium transition-colors border shrink-0",
                            r.enabled ? "bg-positive/10 text-positive border-positive/20" : "bg-border/30 text-muted-foreground border-border/40")}>
                          {r.enabled ? "On" : "Off"}
                        </button>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* ── NAME RULES TAB ── */}
          {tab === "names" && (
            <div className="divide-y divide-border/10">

              {/* New name rule form */}
              {showNewName && (
                <div className="p-4 bg-[hsl(var(--primary)/0.04)] border-b border-[hsl(var(--primary)/0.12)] space-y-3">
                  <div className="text-[11.5px] font-semibold text-foreground">New name rule</div>
                  <div className="grid grid-cols-[auto_1fr] gap-2 items-center">
                    <span className="text-[11px] text-muted-foreground">Merchant name</span>
                    <input value={newNameMerchant} onChange={e => setNewNameMerchant(e.target.value)} placeholder="e.g. AMZN Mktp US"
                      className="h-8 px-2.5 rounded-lg bg-secondary/40 border border-border/40 text-[11px] outline-none focus:border-[hsl(var(--primary)/0.5)]" />
                    <span className="text-[11px] text-muted-foreground">Show as</span>
                    <input value={newNameDisplay} onChange={e => setNewNameDisplay(e.target.value)} placeholder="e.g. Amazon"
                      className="h-8 px-2.5 rounded-lg bg-secondary/40 border border-border/40 text-[11px] outline-none focus:border-[hsl(var(--primary)/0.5)]" />
                  </div>
                  {newNameMerchant && newNameDisplay && (
                    <div className="text-[10.5px] text-muted-foreground bg-border/20 rounded-md px-3 py-1.5">
                      Display <strong className="text-foreground">"{newNameMerchant}"</strong> as <strong className="text-foreground">"{newNameDisplay}"</strong>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => {
                      if (!newNameMerchant.trim() || !newNameDisplay.trim()) return;
                      onSaveNameRule(newNameMerchant.trim(), newNameDisplay.trim());
                      setNewNameMerchant(""); setNewNameDisplay(""); setShowNewName(false);
                    }} className="h-8 px-4 rounded-md bg-gold text-[11.5px] font-semibold">Save rule</button>
                    <button onClick={() => { setShowNewName(false); setNewNameMerchant(""); setNewNameDisplay(""); }} className="h-8 px-3 rounded-md border border-border-strong text-[11.5px] text-muted-foreground">Cancel</button>
                  </div>
                </div>
              )}

              {nameEntries.length === 0 && !showNewName && (
                <div className="py-10 text-center space-y-2">
                  <div className="text-[13px] text-foreground font-medium">No name rules yet</div>
                  <div className="text-[11.5px] text-muted-foreground">Name rules replace how merchant names display across the app.</div>
                  <button onClick={() => setShowNewName(true)} className="mt-2 text-[11.5px] text-[hsl(var(--primary))] underline underline-offset-2">Create your first rule</button>
                </div>
              )}

              {nameEntries.map(([merchant, display]) => {
                const isEditing = editNameKey === merchant;
                const matchCount = allTxns.filter(t => (t.merchant_name ?? t.name ?? "") === merchant).length;
                return (
                  <div key={merchant} className={cn("px-4 py-3.5 transition-colors", isEditing && "bg-[hsl(var(--primary)/0.04)]")}>
                    {isEditing ? (
                      <div className="space-y-2.5">
                        <div className="text-[11px] font-semibold text-foreground mb-1">Edit name rule</div>
                        <div className="grid grid-cols-[auto_1fr] gap-2 items-center">
                          <span className="text-[11px] text-muted-foreground">Merchant name</span>
                          <input value={merchant} readOnly className="h-8 px-2.5 rounded-md bg-border/20 border border-border/40 text-[11px] text-muted-foreground cursor-not-allowed" />
                          <span className="text-[11px] text-muted-foreground">Show as</span>
                          <input value={editNameValue} onChange={e => setEditNameValue(e.target.value)}
                            className="h-8 px-2.5 rounded-md bg-background border border-[hsl(var(--primary)/0.4)] text-[11px] outline-none focus:border-[hsl(var(--primary)/0.6)]" />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => { onSaveNameRule(merchant, editNameValue); setEditNameKey(null); }}
                            className="h-8 px-4 rounded-md bg-gold text-[11.5px] font-semibold">Save changes</button>
                          <button onClick={() => setEditNameKey(null)} className="h-8 px-3 rounded-md border border-border-strong text-[11.5px] text-muted-foreground">Cancel</button>
                          <button onClick={() => { onRemoveNameRule(merchant); setEditNameKey(null); }}
                            className="h-8 px-3 rounded-md text-[11.5px] text-negative hover:bg-negative/10 ml-auto">Delete</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-secondary/60 grid place-items-center shrink-0">
                          <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12.5px] font-medium text-foreground">
                            "{merchant}" <span className="text-muted-foreground font-normal mx-1">shown as</span> "{display}"
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            <span className={cn(matchCount > 0 ? "text-[hsl(var(--primary))]" : "text-muted-foreground")}>{matchCount} match{matchCount !== 1 ? "es" : ""}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => { setEditNameKey(merchant); setEditNameValue(display); setShowNewName(false); }}
                            className="h-7 w-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-border/30 transition-colors">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => onRemoveNameRule(merchant)}
                            className="h-7 w-7 rounded-md grid place-items-center text-muted-foreground hover:text-negative hover:bg-negative/10 transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const TxnDetailModal = ({
  txn, overrides, getRuleCategory, nameOverride, nameRules, customCategories, allTxns,
  accounts, items, initialCatOpen, onClose, onSaveNameOverride, onBulkRename, onSaveNameRule,
  onAddCategory, onAddRule, onRemoveCustom, onSelect, onToggleInternal, isManualInternal, isAutoInternal, isManualExternal,
  onFindSimilar,
}: {
  txn: PTxn; overrides: Record<string,string>; getRuleCategory: (m:string|null)=>string|null;
  nameOverride?: string; nameRules: Record<string,string>;
  customCategories: {name:string;type:"income"|"expense"}[];
  allTxns: PTxn[];
  accounts: PAccount[];
  items: PItem[];
  initialCatOpen?: boolean;
  onClose: () => void;
  onSaveNameOverride: (id: string, name: string) => void;
  onBulkRename: (ids: string[], name: string) => void;
  onSaveNameRule: (merchant: string, name: string) => void;
  onAddCategory: (name: string, type: "income"|"expense") => void;
  onAddRule: (pattern: string, cat: string) => void;
  onRemoveCustom: (name: string) => void;
  onSelect: (id: string, cat: string) => void;
  onToggleInternal: (id: string) => void;
  isManualInternal: boolean;
  isAutoInternal: boolean;
  isManualExternal: boolean;
  onFindSimilar: (pattern: string) => void;
}) => {
  const merchant = txn.merchant_name ?? txn.name ?? null;
  const rawCat = getEffectiveCategory(txn, overrides, getRuleCategory);
  const isIncome = Number(txn.amount) < 0;
  const Icon = isIncome ? ArrowDownLeft : categoryIcon(rawCat);
  const color = isIncome ? "hsl(var(--positive))" : catColor(rawCat);
  const currentDisplayName = nameOverride ?? (merchant ? (nameRules[merchant] ?? merchant) : "Transaction");
  const originalPlaidCat = txn.category?.[0] ?? null;
  const account = accounts.find(a => a.account_id === txn.account_id);
  const item = account ? items.find(it => it.id === account.id.split("_")[0] || account.account_id === txn.account_id) : null;
  // get institution via item_id on txn
  const txnItem = txn.item_id ? items.find(it => it.id === txn.item_id) : null;
  const institutionName = txnItem?.institution_name ?? account?.official_name?.split(" ")?.[0] ?? null;

  const samemerchantTxns = merchant ? allTxns.filter(t => t.id !== txn.id && (t.merchant_name ?? t.name) === merchant) : [];
  const recurringInfo = (() => {
    if (samemerchantTxns.length < 1) return null;
    const dates = [txn, ...samemerchantTxns].map(t => t.date).sort().reverse();
    if (dates.length < 2) return null;
    const intervals = dates.slice(0,-1).map((d,i) => Math.round((new Date(d+"T00:00:00").getTime() - new Date(dates[i+1]+"T00:00:00").getTime()) / 86400000));
    const avg = intervals.reduce((s,v)=>s+v,0)/intervals.length;
    const label = avg <= 8 ? "weekly" : avg <= 16 ? "biweekly" : avg <= 35 ? "monthly" : avg <= 100 ? "quarterly" : null;
    return label ? { label, count: dates.length } : null;
  })();

  const [nameDraft, setNameDraft] = useState(currentDisplayName);
  const [showCatPicker, setShowCatPicker] = useState(initialCatOpen ?? false);
  const [showAddRule, setShowAddRule] = useState(false);
  const [ruleDraft, setRuleDraft] = useState(merchant ?? "");
  const [ruleMatchType, setRuleMatchType] = useState<RuleMatchType>("contains");
  const [renameReq, setRenameReq] = useState<RenameRequest | null>(null);
  const [applyAll, setApplyAll] = useState(true);
  const [createRule, setCreateRule] = useState(true);
  const [applyAllCat, setApplyAllCat] = useState(false);

  const handleCommitName = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === currentDisplayName) return;
    setRenameReq({ txnId: txn.id, merchant, newName: trimmed, matchingCount: samemerchantTxns.length });
  };

  const applyRename = (all: boolean, rule: boolean) => {
    if (!renameReq) return;
    onSaveNameOverride(txn.id, renameReq.newName);
    if (all && samemerchantTxns.length > 0) onBulkRename(samemerchantTxns.map(t => t.id), renameReq.newName);
    if (rule && renameReq.merchant) onSaveNameRule(renameReq.merchant, renameReq.newName);
    setRenameReq(null);
    toast.success("Renamed" + (rule ? " + rule created" : ""));
  };

  const handleCatSelect = (cat: string) => {
    onSelect(txn.id, cat);
    // If apply-all is on, bulk-override every txn from same merchant
    if (applyAllCat && merchant) {
      const ids = samemerchantTxns.map(t => t.id);
      ids.forEach(id => onSelect(id, cat));
      if (ids.length > 0) toast.success(`Category applied to ${ids.length + 1} transactions`);
      // also create a rule so future txns are categorized automatically
      onAddRule(merchant, cat);
    }
    setShowCatPicker(false);
  };

  const info: [string, string | React.ReactNode][] = [
    ["Amount", <span className={cn("font-semibold tabular", isIncome ? "text-positive" : "text-foreground")}>{isIncome ? "+" : "−"}{fmtUSD(Math.abs(Number(txn.amount)), { cents: true })}</span>],
    ["Date", new Date(txn.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })],
    ...(txn.authorized_date && txn.authorized_date !== txn.date ? [["Auth date", txn.authorized_date] as [string, string]] : []),
    ["Account", account ? `${account.name ?? account.official_name}${account.mask ? ` ···· ${account.mask}` : ""}` : "n/a"],
    ...(institutionName ? [["Institution", institutionName] as [string, string]] : []),
    ["Channel", txn.payment_channel ? txn.payment_channel.replace(/_/g," ") : "n/a"],
    ["Status", txn.pending ? "Pending" : "Posted"],
    ...(originalPlaidCat ? [["Original category", originalPlaidCat] as [string, string]] : []),
    ...(txn.transaction_id ? [["Reference", <span className="font-mono text-[10.5px] text-muted-foreground/70 break-all">{txn.transaction_id}</span>] as [string, React.ReactNode]] : []),
  ];

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[90dvh] flex flex-col">
        <DialogTitle className="sr-only">Transaction details</DialogTitle>
        <DialogDescription className="sr-only">Edit transaction name or category.</DialogDescription>

        {/* Compact header */}
        <div className="px-4 pt-4 pb-3 border-b border-border/30 flex items-center gap-3 shrink-0">
          <div className="h-9 w-9 rounded-xl grid place-items-center shrink-0" style={{ backgroundColor: `${color}20`, color }}>
            <Icon className="h-4.5 w-4.5" />
          </div>
          <div className="flex-1 min-w-0">
            <input value={nameDraft} onChange={e => setNameDraft(e.target.value)}
              onBlur={handleCommitName}
              onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
              className="w-full bg-transparent text-[14px] font-semibold text-foreground outline-none border-b border-transparent focus:border-[hsl(var(--primary)/0.4)] pb-0.5 truncate" />
            <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
              {account && <span className="font-medium text-foreground/70">{account.name}</span>}
              {account && <span>·</span>}
              <span>{new Date(txn.date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>
              {txn.payment_channel && <><span>·</span><span className="capitalize">{txn.payment_channel.replace(/_/g," ")}</span></>}
              {txn.pending && <span className="text-warning font-medium">· Pending</span>}
              {recurringInfo && <span className="text-info font-medium">· {recurringInfo.label}</span>}
            </div>
          </div>
          <div className={cn("text-[16px] font-display tabular shrink-0 font-bold", isIncome ? "text-positive" : "text-foreground")}>
            {isIncome ? "+" : "−"}{fmtUSD(Math.abs(Number(txn.amount)), { cents: true })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Rename confirmation */}
          {renameReq && (
            <div className="px-5 py-4 border-b border-border/20 bg-[hsl(var(--primary)/0.04)] space-y-2.5 shrink-0">
              <div className="text-[12px] font-semibold text-foreground">Apply rename to:</div>
              <div className="space-y-2">
                {samemerchantTxns.length > 0 && (
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={applyAll} onChange={e => setApplyAll(e.target.checked)} className="h-4 w-4 rounded accent-[hsl(var(--primary))]" />
                    <span className="text-[11.5px] text-foreground">All {samemerchantTxns.length} other "{merchant}" transactions</span>
                  </label>
                )}
                {renameReq.merchant && (
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={createRule} onChange={e => setCreateRule(e.target.checked)} className="h-4 w-4 rounded accent-[hsl(var(--primary))]" />
                    <span className="text-[11.5px] text-foreground">Create rule for future transactions</span>
                  </label>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => applyRename(applyAll, createRule)} className="flex-1 h-8 rounded-lg bg-gold text-[11.5px] font-semibold hover:opacity-90">Apply</button>
                <button onClick={() => applyRename(false, false)} className="h-8 px-3 rounded-lg border border-border text-[11px] text-muted-foreground">Just this</button>
                <button onClick={() => { setRenameReq(null); setNameDraft(currentDisplayName); }} className="h-8 w-8 rounded-lg border border-border grid place-items-center text-muted-foreground"><X className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          )}

          {/* Category row */}
          <button onClick={() => setShowCatPicker(s => !s)}
            className="w-full px-5 py-4 flex items-center justify-between border-b border-border/15 hover:bg-surface-hover/20 transition-colors">
            <div className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-lg grid place-items-center shrink-0" style={{ backgroundColor: `${color}20`, color }}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="text-left">
                <div className="text-[12.5px] font-medium text-foreground">{humanizeCategory(rawCat, Number(txn.amount))}</div>
                {originalPlaidCat && rawCat !== originalPlaidCat && (
                  <div className="text-[10.5px] text-muted-foreground/60">Plaid: {originalPlaidCat}</div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[hsl(var(--primary))]">Change</span>
              <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0", showCatPicker && "rotate-180")} />
            </div>
          </button>

          {showCatPicker && (
            <div>
              {samemerchantTxns.length > 0 && (
                <label className="flex items-center gap-2 px-5 py-3 bg-[hsl(var(--primary)/0.04)] border-b border-border/15 cursor-pointer select-none">
                  <input type="checkbox" checked={applyAllCat} onChange={e => setApplyAllCat(e.target.checked)} className="h-4 w-4 rounded accent-[hsl(var(--primary))]" />
                  <span className="text-[11.5px] text-foreground">Apply to all {samemerchantTxns.length + 1} "{merchant}" transactions + create rule</span>
                </label>
              )}
              <InlineCategoryPicker txn={txn} current={rawCat ?? "Other"}
                existingRule={getRuleCategory(txn.merchant_name ?? txn.name ?? null) ?? undefined}
                customCategories={customCategories}
                onSelect={handleCatSelect}
                onAddCategory={onAddCategory} onAddRule={onAddRule} onRemoveCustom={onRemoveCustom}
                onClose={() => setShowCatPicker(false)} />
            </div>
          )}

          {/* Compact info grid */}
          <div className="px-5 py-4 space-y-0 divide-y divide-border/10">
            {info.map(([label, value]) => (
              <div key={label as string} className="flex items-start justify-between gap-3 py-2">
                <span className="text-[10.5px] text-muted-foreground shrink-0">{label}</span>
                <span className="text-[11px] text-foreground text-right">{value}</span>
              </div>
            ))}
          </div>

          {/* Action strip */}
          <div className="px-5 py-4 border-t border-border/15 grid grid-cols-2 gap-2">
            <button
              onClick={() => { onFindSimilar(merchant ?? ""); onClose(); }}
              disabled={!merchant}
              className="h-9 rounded-lg border border-border-strong text-[11.5px] text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40">
              <Search className="h-3.5 w-3.5" /> Find similar
            </button>
            <button
              onClick={() => setShowAddRule(s => !s)}
              className="h-9 rounded-lg border border-border-strong text-[11.5px] text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 transition-colors">
              <Plus className="h-3.5 w-3.5" /> Add rule
            </button>
            <button
              onClick={() => onToggleInternal(txn.id)}
              className={cn("h-9 rounded-lg border text-[11.5px] flex items-center justify-center gap-1.5 transition-colors col-span-2",
                (isManualInternal || isAutoInternal) && !isManualExternal
                  ? "border-info/40 text-info bg-info/5"
                  : "border-border-strong text-muted-foreground hover:text-foreground")}>
              <EyeOff className="h-3.5 w-3.5" />
              {(isManualInternal || isAutoInternal) && !isManualExternal ? "Marked as internal transfer" : "Mark as internal transfer"}
            </button>
          </div>

          {/* Add rule inline */}
          {showAddRule && (
            <div className="px-4 pb-4 pt-1 space-y-2.5 border-t border-border/15">
              <div className="text-[11px] font-semibold text-foreground">New rule</div>
              <div className="flex items-center gap-2">
                <select value={ruleMatchType} onChange={e => setRuleMatchType(e.target.value as RuleMatchType)}
                  className="h-8 px-2 rounded-md bg-surface/60 border border-border/60 text-[11px] text-foreground outline-none shrink-0">
                  <option value="contains">contains</option>
                  <option value="exact">exact</option>
                  <option value="starts_with">starts with</option>
                </select>
                <input value={ruleDraft} onChange={e => setRuleDraft(e.target.value)} placeholder="pattern…"
                  className="flex-1 h-8 px-2.5 rounded-md bg-surface/60 border border-border/60 text-[11px] text-foreground outline-none focus:border-[hsl(var(--primary)/0.4)]" />
              </div>
              <button
                onClick={() => { if (ruleDraft.trim() && rawCat) { onAddRule(ruleDraft.trim(), rawCat); setShowAddRule(false); toast.success("Rule created"); } }}
                className="w-full h-8 rounded-lg bg-gold text-[11.5px] font-semibold hover:opacity-90">
                Create rule → {humanizeCategory(rawCat, Number(txn.amount))}
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};


// ── Positioned picker — rendered at root level of each view ───

// ── Sortable panel card ──────────────────────────────────────────
const SortableCard = ({ id, children }: { id: string; children: (handleProps: React.HTMLAttributes<HTMLElement>) => React.ReactNode }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1, zIndex: isDragging ? 50 : undefined }}>
      {children({ ...attributes, ...listeners })}
    </div>
  );
};

// ── Spending category tile ─────────────────────────────────────
const SpendTile = ({ category, total, count, budget, delta, deltaPct, onSetBudget, onSelect }: {
  category: string; total: number; count: number; budget?: number;
  delta?: number; deltaPct?: number | null;
  onSetBudget: ()=>void; onSelect?: ()=>void;
}) => {
  const Icon = categoryIcon(category);
  const color = catColor(category);
  const pct = budget ? Math.min((total/budget)*100, 100) : 0;
  const overBudget = budget && total > budget;
  const nearBudget = budget && !overBudget && total/budget > 0.8;
  const up = delta != null && delta > 0;
  const down = delta != null && delta < 0;

  return (
    <button onClick={onSelect??onSetBudget}
      className="surface-card card-hover p-3 text-left w-full group">
      <div className="flex items-center justify-between">
        <div className="h-8 w-8 rounded-lg grid place-items-center" style={{ backgroundColor:`${color}1f`, color }}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="flex items-center gap-1">
          {/* MoM trend badge */}
          {deltaPct != null && deltaPct !== 0 && (
            <span className={cn("text-[10px] tabular px-1.5 py-0.5 rounded-full font-medium",
              up?"bg-negative/12 text-negative":"bg-positive/12 text-positive")}>
              {up?"+":""}{deltaPct}%
            </span>
          )}
          {!!budget && (
            <span className={cn("text-[10px] tabular px-1.5 py-0.5 rounded-full",
              overBudget?"bg-negative/15 text-negative":nearBudget?"bg-warning/15 text-warning":"bg-secondary text-muted-foreground")}>
              {pct.toFixed(0)}%
            </span>
          )}
          <div role="button" onClick={e=>{e.stopPropagation();onSetBudget();}}
            className="h-5 w-5 rounded grid place-items-center text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity cursor-pointer">
            <Pencil className="h-3 w-3" />
          </div>
        </div>
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">{formatCat(category)}</div>
      <div className="mt-0.5 font-display text-base tabular text-foreground leading-tight">{fmtUSD(total)}</div>
      {budget ? (
        <div className="text-[10px] text-muted-foreground tabular">of {fmtUSD(budget)}</div>
      ) : (
        <div className="text-[10px] text-muted-foreground tabular">{count} txn{count!==1?"s":""}</div>
      )}
      {!!budget && (
        <div className="mt-2 h-1 rounded-full bg-secondary overflow-hidden">
          <div className="h-full rounded-full transition-all"
            style={{ width:`${pct}%`, backgroundColor: overBudget?"hsl(var(--negative))":nearBudget?"hsl(var(--warning))":color }} />
        </div>
      )}
    </button>
  );
};

// ── Account edit dialog ────────────────────────────────────────
const AccountEditDialog = ({ account, meta, instUrl, onSave, onClose }: {
  account: PAccount;
  meta: AccountMeta;
  instUrl: string | null;
  onSave: (m: AccountMeta) => void;
  onClose: () => void;
}) => {
  const [nickname, setNickname]       = useState(meta.nickname ?? "");
  const [apr, setApr]                 = useState(meta.apr != null ? String(meta.apr) : "");
  const [promoApr, setPromoApr]       = useState(meta.promoApr != null ? String(meta.promoApr) : "");
  const [promoEnd, setPromoEnd]       = useState(meta.promoEndDate ?? "");
  const [customUrl, setCustomUrl]     = useState(meta.customUrl ?? "");

  const save = () => {
    onSave({
      nickname: nickname.trim() || undefined,
      apr: apr ? parseFloat(apr) : undefined,
      promoApr: promoApr !== "" ? parseFloat(promoApr) : undefined,
      promoEndDate: promoEnd || undefined,
      customUrl: customUrl.trim() || undefined,
    });
    onClose();
  };

  const isCredit = account.type === "credit";

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col">
        <DialogTitle className="sr-only">Edit account</DialogTitle>
        <DialogDescription className="sr-only">Rename or add details to this account.</DialogDescription>
        <div className="relative p-5 pb-4 border-b border-border/40 shrink-0">
          <button onClick={onClose} className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
            <X className="h-4 w-4" />
          </button>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Edit account</div>
          <div className="font-display text-lg text-foreground">{account.name ?? "Account"}</div>
          {account.mask && <div className="text-[11px] text-muted-foreground">··{account.mask}</div>}
        </div>
        <div className="p-5 space-y-4 flex-1 overflow-y-auto min-h-0">
          {/* Nickname */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Nickname (optional)</label>
            <input value={nickname} onChange={e => setNickname(e.target.value)} placeholder={account.name ?? ""}
              className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40" />
          </div>

          {/* APR (credit cards only or any account) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">APR %</label>
              <input type="number" value={apr} onChange={e => setApr(e.target.value)} placeholder="e.g. 22.49"
                className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Promo APR %</label>
              <input type="number" value={promoApr} onChange={e => setPromoApr(e.target.value)} placeholder="e.g. 0"
                className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40" />
            </div>
          </div>

          {/* Promo end date */}
          {promoApr !== "" && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Promo expires</label>
              <input type="date" value={promoEnd} onChange={e => setPromoEnd(e.target.value)}
                className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40" />
            </div>
          )}

          {/* Website URL */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Bank website URL (optional override)</label>
            <input type="url" value={customUrl} onChange={e => setCustomUrl(e.target.value)}
              placeholder={instUrl ?? "https://..."}
              className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40" />
            {instUrl && !customUrl && (
              <div className="mt-1 text-[10px] text-muted-foreground">Auto-detected: {instUrl}</div>
            )}
          </div>
        </div>
        <div className="p-4 pt-0 flex gap-2 shrink-0">
          <button onClick={save}
            className="flex-1 h-10 rounded-lg bg-gold text-[13px] font-medium hover:opacity-90 active:opacity-70">
            Save
          </button>
          <button onClick={onClose}
            className="h-10 px-4 rounded-lg border border-border-strong text-[12px] text-muted-foreground hover:text-foreground active:opacity-70">
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── Mini stat cell (matches demo AccountsSection) ──────────────
const Mini = ({ label, value, tone }: { label: string; value: string; tone: "positive"|"negative"|"info"|"warning"|"neutral" }) => {
  const toneText: Record<string,string> = { positive:"text-positive", negative:"text-negative", info:"text-info", warning:"text-warning", neutral:"text-muted-foreground" };
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("text-[12.5px] tabular font-medium mt-0.5", toneText[tone])}>{value}</div>
    </div>
  );
};

// ── Account detail panel (expanded row) ────────────────────────
const AccountDetailRow = ({ a, meta, credit, instName, instUrl, onEdit, onRemove }: {
  a: PAccount; meta: AccountMeta; credit?: CreditDetail;
  instName: string; instUrl: string | null;
  onEdit: () => void; onRemove: () => void;
}) => {
  const debt = isDebt(a.type);
  const avail = Number(a.available_balance) || 0;
  const bal = Number(a.current_balance) || 0;
  const utilization = a.type === "credit" && avail !== 0 ? Math.abs(bal) / (Math.abs(bal) + avail) : null;
  const isPromo = meta.promoApr != null;
  const promoExpired = meta.promoEndDate ? new Date(meta.promoEndDate) < new Date() : false;
  const daysUntilPromoEnd = meta.promoEndDate
    ? Math.ceil((new Date(meta.promoEndDate).getTime() - Date.now()) / 86400000)
    : null;
  const yearlyInterest = meta.apr != null ? Math.abs(bal) * meta.apr / 100 : 0;

  return (
    <div className="px-4 md:px-5 py-3.5 bg-surface/40 border-t border-border/40 animate-fade-up space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {meta.apr != null && (
          <Mini
            label={debt ? "Annual interest cost" : "Annual interest earned"}
            value={`${debt ? "−" : "+"}${fmtUSD(Math.abs(yearlyInterest), { compact: true })}`}
            tone={debt ? "negative" : "positive"}
          />
        )}
        {credit?.last_statement_balance != null && (
          <Mini label="Statement balance" value={fmtUSD(credit.last_statement_balance)} tone="warning" />
        )}
        {credit?.next_payment_due_date && (
          <Mini
            label="Due date"
            value={new Date(credit.next_payment_due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            tone={credit.is_overdue ? "negative" : "info"}
          />
        )}
        {credit?.minimum_payment_amount != null && (
          <Mini label="Min payment" value={fmtUSD(credit.minimum_payment_amount)} tone="warning" />
        )}
        {utilization !== null && (
          <Mini
            label="Credit used"
            value={`${(utilization * 100).toFixed(0)}% of ${fmtUSD(Math.abs(bal) + avail, { compact: true })}`}
            tone={utilization > 0.5 ? "negative" : utilization > 0.3 ? "warning" : "positive"}
          />
        )}
        {a.available_balance != null && a.type !== "credit" && (
          <Mini label="Available" value={fmtUSD(Math.abs(avail))} tone="positive" />
        )}
        {a.mask && <Mini label="Account #" value={`··${a.mask}`} tone="neutral" />}
        {a.subtype && <Mini label="Type" value={a.subtype.replace(/_/g, " ")} tone="neutral" />}
      </div>

      {/* Utilization bar for credit cards */}
      {utilization !== null && (
        <div>
          <div className="flex justify-between text-[10.5px] text-muted-foreground tabular mb-1">
            <span>Credit used {(utilization * 100).toFixed(0)}%</span>
            <span>{fmtUSD(Math.abs(bal) + avail, { compact: true })} limit</span>
          </div>
          <div className="h-1 rounded-full bg-secondary overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(utilization * 100, 100)}%`,
                backgroundColor: utilization > 0.5 ? "hsl(var(--negative))" : utilization > 0.3 ? "hsl(var(--warning))" : "hsl(var(--positive))" }} />
          </div>
        </div>
      )}

      {/* 0% APR promo banner */}
      {isPromo && !promoExpired && (
        <div className="inline-flex items-center gap-1.5 chip chip-positive">
          <Sparkles className="h-3 w-3" />
          {daysUntilPromoEnd != null && daysUntilPromoEnd > 0
            ? `0% APR · ${daysUntilPromoEnd}d remaining${meta.promoEndDate ? ` (${new Date(meta.promoEndDate).toLocaleDateString("en-US",{month:"short",day:"numeric"})})` : ""}`
            : "0% APR active"}
        </div>
      )}
      {isPromo && promoExpired && (
        <div className="inline-flex items-center gap-1.5 chip chip-negative text-[11px]">
          0% APR promo expired. Interest now applies.
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        {instUrl && (
          <a href={instUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
            <ExternalLink className="h-3 w-3" /> Open at {instName}
          </a>
        )}
        <button onClick={onEdit}
          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
          <Pencil className="h-3 w-3" /> Edit details
        </button>
        <button onClick={onRemove}
          className="inline-flex items-center gap-1.5 text-[11px] text-negative/70 hover:text-negative transition-colors">
          <Trash2 className="h-3 w-3" /> Remove account
        </button>
      </div>
    </div>
  );
};

// ── Account row — click opens right-panel detail ───────────────
const AccountRow = ({ a, txns, meta, credit, instName, onSelect }: {
  a: PAccount; txns: PTxn[]; meta: AccountMeta; credit?: CreditDetail;
  instName: string; onSelect: () => void;
}) => {
  const Icon = mapIcon(a.type, a.subtype);
  const debt = isDebt(a.type);
  const bal  = Number(a.current_balance) || 0;
  const avail = a.available_balance != null ? Number(a.available_balance) : null;
  const displayName = meta.nickname || a.name || a.official_name || "Account";

  const isPromo = meta.promoApr != null && meta.promoEndDate && new Date(meta.promoEndDate) > new Date();
  const utilization = a.type === "credit" && avail !== null && avail !== 0
    ? Math.abs(bal) / (Math.abs(bal) + avail)
    : null;
  const dueDate = credit?.next_payment_due_date;
  const dueDaysAway = dueDate ? Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86400000) : null;

  // 30-day net flow for trend indicator
  const thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const accTxns = txns.filter(t => t.account_id === a.account_id && new Date(t.date) >= thirtyAgo);
  const netFlow = accTxns.reduce((s, t) => s - Number(t.amount), 0);
  const showTrend = accTxns.length > 0 && Math.abs(netFlow) > 1;
  const trendUp = netFlow > 0;
  const trendGood = debt ? !trendUp : trendUp;

  const iconBg = debt
    ? "bg-negative/10 border-negative/20 text-negative"
    : a.type === "investment" || a.type === "brokerage"
    ? "bg-info/10 border-info/20 text-info"
    : a.subtype === "savings"
    ? "bg-positive/10 border-positive/20 text-positive"
    : "bg-[hsl(var(--primary)/0.1)] border-[hsl(var(--primary)/0.2)] text-gold";

  return (
    <button
      onClick={onSelect}
      className="row-hover w-full flex items-center gap-3 px-4 md:px-5 py-3.5 text-left group transition-colors"
    >
      {/* Icon */}
      <div className={cn("h-9 w-9 rounded-xl grid place-items-center border shrink-0 transition-transform group-hover:scale-105", iconBg)}>
        <Icon className="h-4 w-4" />
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[13px] text-foreground font-medium truncate">{displayName}</span>
          {isPromo && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-positive/30 bg-positive/10 text-positive shrink-0">0% APR</span>
          )}
          {a.subtype === "savings" && isHYSA(a, instName, meta.apr) && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-positive/30 bg-positive/10 text-positive shrink-0">High Yield</span>
          )}
          {dueDaysAway != null && dueDaysAway <= 7 && (
            <span className={cn("text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border shrink-0",
              dueDaysAway <= 0 ? "border-negative/30 bg-negative/10 text-negative" : "border-warning/30 bg-warning/10 text-warning")}>
              {dueDaysAway <= 0 ? "overdue" : `due ${dueDaysAway}d`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 text-[10.5px] text-muted-foreground flex-wrap">
          <span>{instName}{a.mask ? ` ··${a.mask}` : ""}</span>
          {meta.apr != null && (
            <><span className="opacity-30">·</span><span className="tabular">{meta.apr.toFixed(2)}% {debt ? "APR" : "APY"}</span></>
          )}
          {utilization !== null && (
            <><span className="opacity-30">·</span>
            <span className={cn("tabular", utilization > 0.5 ? "text-negative" : utilization > 0.3 ? "text-warning" : "text-positive")}>
              {(utilization * 100).toFixed(0)}% used
            </span></>
          )}
        </div>
        {utilization !== null && (
          <div className="mt-1.5 h-0.5 rounded-full bg-border/40 overflow-hidden max-w-[120px]">
            <div className="h-full rounded-full transition-all" style={{
              width: `${Math.min(utilization * 100, 100)}%`,
              backgroundColor: utilization > 0.5 ? "hsl(var(--negative))" : utilization > 0.3 ? "hsl(var(--warning))" : "hsl(var(--positive))"
            }} />
          </div>
        )}
      </div>

      {/* Trend + balance */}
      <div className="text-right shrink-0">
        {showTrend && (
          <div className={cn("text-[10px] tabular mb-0.5 flex items-center justify-end gap-0.5", trendGood ? "text-positive" : "text-negative")}>
            {trendUp ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
            {netFlow > 0 ? "+" : ""}{fmtUSD(Math.abs(netFlow), { compact: true })}
          </div>
        )}
        <div className={cn("text-[14px] font-semibold tabular", debt ? "text-negative" : "text-foreground")}>
          {debt ? "−" : ""}{fmtUSD(Math.abs(bal), { compact: true })}
        </div>
        {avail != null && !debt && avail !== bal && (
          <div className="text-[10px] text-muted-foreground tabular">{fmtUSD(avail, { compact: true })} avail</div>
        )}
      </div>

      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all" />
    </button>
  );
};

// ── Bucket group (matches demo BucketTable exactly) ────────────
const BucketGroup = ({
  bucket, accounts, txns=[], accountMeta, creditDetails, items,
  onSelect, defaultOpen=false,
}: {
  bucket: Bucket; accounts: PAccount[]; txns?: PTxn[];
  accountMeta: Record<string,AccountMeta>; creditDetails: CreditDetail[]; items: PItem[];
  onSelect:(a:PAccount)=>void;
  defaultOpen?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const meta = bucketMeta[bucket];
  if (accounts.length === 0) return null;

  const total = accounts.reduce((s, a) =>
    s + (isDebt(a.type) ? -Math.abs(Number(a.current_balance)||0) : (Number(a.current_balance)||0)), 0);
  const isNeg = total < 0;
  const toneDot: Record<string,string> = { positive:"bg-positive", negative:"bg-negative", info:"bg-info", warning:"bg-warning" };

  // Trailing context text — mirrors demo BucketTable
  const monthlyStatement = accounts.reduce((s,a) => {
    const cd = creditDetails.find(c=>c.account_id===a.account_id);
    return s + (cd?.last_statement_balance ?? 0);
  }, 0);
  const yearlyInterest = accounts.reduce((s, a) => {
    const m = accountMeta[a.id];
    return s + (m?.apr != null ? Math.abs(Number(a.current_balance)||0) * m.apr / 100 : 0);
  }, 0);

  let trailing: string | null = null;
  if (bucket === "cash" && yearlyInterest > 0) trailing = `Earning +${fmtUSD(yearlyInterest, { compact: true })}/yr`;
  if (bucket === "credit" && monthlyStatement > 0) trailing = `${fmtUSD(monthlyStatement, { compact: true })} due this cycle`;
  if (bucket === "loan") trailing = `${fmtUSD(Math.abs(yearlyInterest), { compact: true })} interest/yr`;
  if (bucket === "investment") trailing = "Held for the future";

  const getInstName = (a: PAccount) => getInstNameFor(a, items);
  const getInstUrl = (a: PAccount) => {
    const instName = getInstName(a);
    return getInstitutionUrl(instName, accountMeta[a.id]?.customUrl);
  };

  const accentColor = bucket === "cash" ? "hsl(var(--positive))" : bucket === "credit" ? "hsl(var(--warning))" : bucket === "loan" ? "hsl(var(--negative))" : "hsl(var(--info))";
  const trailingColor = bucket === "cash" ? "text-positive" : bucket === "credit" ? "text-warning" : bucket === "loan" ? "text-negative" : "text-info";

  return (
    <div className="surface-card overflow-hidden" style={{borderLeft:`3px solid ${accentColor}30`}}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-4 px-4 md:px-5 py-4 hover:bg-surface-hover/30 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn("h-8 w-8 rounded-lg grid place-items-center shrink-0 transition-all", open ? "bg-secondary/60" : "bg-secondary/30")}
            style={{color: accentColor}}>
            <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", !open && "-rotate-90")} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-display text-[13px] text-foreground">{meta.label}</h3>
              {bucket === "investment" && <Lock className="h-3 w-3 text-muted-foreground" />}
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary/60 text-muted-foreground tabular">{accounts.length}</span>
            </div>
            <div className="text-[10.5px] text-muted-foreground truncate mt-0.5">{meta.sub}</div>
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className={cn("font-display text-[15px] tabular leading-none font-semibold",
            isNeg ? "text-negative" : "text-foreground")}>
            {isNeg ? "−" : ""}{fmtUSD(Math.abs(total), { compact: true })}
          </div>
          {trailing && (
            <div className={cn("text-[10.5px] tabular mt-1 font-medium", trailingColor)}>
              {trailing}
            </div>
          )}
        </div>
      </button>

      {open && (
        bucket === "cash" ? (()=>{
          const checkingAccs = accounts.filter(a => (a.subtype ?? "").toLowerCase() === "checking");
          const savingsAccs  = accounts.filter(a => (a.subtype ?? "").toLowerCase() !== "checking");
          const groups: { label: string; accs: PAccount[] }[] = [
            ...(checkingAccs.length ? [{ label: "Checking", accs: checkingAccs }] : []),
            ...(savingsAccs.length ? [{ label: "Savings", accs: savingsAccs }] : []),
          ];
          const multi = groups.length > 1;
          return (
            <div className="border-t border-border/20 max-h-[480px] overflow-y-auto">
              {groups.map(g => (
                <div key={g.label}>
                  {multi && (
                    <div className="px-4 pt-2 pb-0.5 flex items-center gap-2">
                      <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-medium">{g.label}</span>
                    </div>
                  )}
                  <div className={cn("divide-y divide-border/20", multi && "ml-2 border-l border-border/20")}>
                    {g.accs.map(a => (
                      <AccountRow
                        key={a.id}
                        a={a}
                        txns={txns}
                        meta={accountMeta[a.id] ?? {}}
                        credit={creditDetails.find(c => c.account_id === a.account_id)}
                        instName={getInstName(a)}
                        onSelect={() => onSelect(a)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })() : (
          <div className="border-t border-border/20 divide-y divide-border/20 max-h-[480px] overflow-y-auto">
            {accounts.map(a => (
              <AccountRow
                key={a.id}
                a={a}
                txns={txns}
                meta={accountMeta[a.id] ?? {}}
                credit={creditDetails.find(c => c.account_id === a.account_id)}
                instName={getInstName(a)}
                onSelect={() => onSelect(a)}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
};

// ── Card info lookup ───────────────────────────────────────────
type AnnualCredit = { label: string; amount: number; howTo: string };
type CardInfo = { purpose: string; rewards: string; bestFor: string; notes?: string; annualFee?: number; annualCredits?: AnnualCredit[] };
const CARD_INFO: { match: RegExp; info: CardInfo }[] = [
  { match: /sapphire reserve/i,     info: { purpose: "Premium travel card", rewards: "3x dining & travel, 10x hotels/car via Chase portal", bestFor: "Frequent travelers", annualFee: 550,
    annualCredits: [
      { label: "$300 travel credit", amount: 300, howTo: "Automatically applied to any travel purchase" },
      { label: "Priority Pass lounge", amount: 0, howTo: "Activate membership via Chase benefits portal" },
      { label: "$5/mo DoorDash DashPass", amount: 60, howTo: "Activate via Chase offers. $5/mo DashPass credit." },
    ]} },
  { match: /sapphire preferred/i,   info: { purpose: "Travel & dining card", rewards: "3x dining, 2x travel, 5x Chase travel portal", bestFor: "Travel & restaurants", annualFee: 95,
    annualCredits: [
      { label: "$50 hotel credit", amount: 50, howTo: "Book through Chase Ultimate Rewards hotel portal" },
      { label: "$10/mo dining bonus", amount: 120, howTo: "10% bonus on all dining spend each anniversary year" },
    ]} },
  { match: /freedom flex/i,         info: { purpose: "Rotating cashback", rewards: "5% rotating quarterly categories, 3% dining & drugstores, 1% all else", bestFor: "Maximizing rotating categories", annualFee: 0 } },
  { match: /freedom unlimited/i,    info: { purpose: "Flat-rate cashback", rewards: "1.5% on everything, 3% dining & drugstores, 5% Chase travel", bestFor: "Everyday purchases", annualFee: 0 } },
  { match: /freedom/i,              info: { purpose: "Rotating cashback", rewards: "5% quarterly rotating categories, 1% all else", bestFor: "Category maximizers", annualFee: 0 } },
  { match: /amex.*(platinum|plat)/i,info: { purpose: "Premium travel & perks", rewards: "5x flights (direct/Amex Travel), 5x hotels (Amex Travel)", bestFor: "Frequent flyers", annualFee: 695,
    annualCredits: [
      { label: "$200 airline fee credit", amount: 200, howTo: "Select one airline. Applies to incidental fees." },
      { label: "$200 hotel credit", amount: 200, howTo: "Prepaid Fine Hotels + Resorts or Hotel Collection (2-night min)" },
      { label: "$240 digital entertainment", amount: 240, howTo: "$20/mo: Disney+, Hulu, ESPN+, Peacock, NYT, WSJ" },
      { label: "$155 Walmart+ credit", amount: 155, howTo: "$12.95/mo credit on Walmart+ membership" },
      { label: "$200 Uber Cash", amount: 200, howTo: "$15/mo Uber Cash + $35 in December (US rides/Eats)" },
      { label: "$300 Equinox credit", amount: 300, howTo: "$25/mo Equinox+ or eligible gym memberships" },
      { label: "Priority Pass + Centurion lounges", amount: 0, howTo: "Enroll via Amex benefits portal" },
    ]} },
  { match: /amex.*gold|gold.*amex/i,info: { purpose: "Dining & groceries", rewards: "4x dining worldwide, 4x U.S. groceries (up to $25k/yr), 3x flights", bestFor: "Foodies & grocery shoppers", annualFee: 250,
    annualCredits: [
      { label: "$120 dining credit", amount: 120, howTo: "$10/mo at Grubhub, The Cheesecake Factory, Goldbelly, Wine.com, Five Guys" },
      { label: "$120 Uber Cash", amount: 120, howTo: "$10/mo Uber Cash for Uber Eats or rides (U.S.)" },
    ]} },
  { match: /blue cash preferred/i,  info: { purpose: "Grocery & streaming cashback", rewards: "6% U.S. supermarkets (up to $6k/yr), 6% streaming, 3% gas & transit, 1% all else", bestFor: "Families & grocery shoppers", annualFee: 95 } },
  { match: /blue cash everyday/i,   info: { purpose: "No-fee cashback", rewards: "3% U.S. supermarkets, 3% U.S. online retail, 3% gas, 1% all else", bestFor: "No-fee everyday use", annualFee: 0 } },
  { match: /venture x/i,            info: { purpose: "Premium travel miles", rewards: "10x hotels & cars (Capital One Travel), 5x flights, 2x everything", bestFor: "Capital One ecosystem travelers", annualFee: 395,
    annualCredits: [
      { label: "$300 Capital One Travel credit", amount: 300, howTo: "Book flights, hotels, or rental cars via Capital One Travel" },
      { label: "10,000 anniversary miles", amount: 100, howTo: "Automatically credited each account anniversary (~$100 value)" },
      { label: "Priority Pass + Plaza lounges", amount: 0, howTo: "Enroll via Capital One benefits portal" },
    ]} },
  { match: /venture/i,              info: { purpose: "Flat travel miles", rewards: "2x miles on every purchase", bestFor: "Simple travel rewards", annualFee: 95 } },
  { match: /quicksilver/i,          info: { purpose: "Flat cashback", rewards: "1.5% cashback on everything", bestFor: "Simple no-fuss rewards", annualFee: 0 } },
  { match: /double cash/i,          info: { purpose: "2% cashback everywhere", rewards: "1% when you buy + 1% when you pay", bestFor: "Everyday spending", annualFee: 0 } },
  { match: /citi custom cash/i,     info: { purpose: "Auto-category cashback", rewards: "5% on your top eligible spend category each month (up to $500), 1% all else", bestFor: "Flexible category maximizers", annualFee: 0 } },
  { match: /active cash/i,          info: { purpose: "Flat 2% cashback", rewards: "2% cashback on all purchases", bestFor: "Simple everyday use", annualFee: 0 } },
  { match: /autograph/i,            info: { purpose: "Travel & dining", rewards: "3x restaurants, gas, travel, transit, streaming, phone, 1x all else", bestFor: "Diverse everyday categories", annualFee: 0 } },
  { match: /discover.*(it|chrome)/i,info: { purpose: "Rotating cashback", rewards: "5% rotating quarterly categories (up to $1,500/quarter), 1% all else", bestFor: "Category maximizers", annualFee: 0, notes: "Cashback Match first year" } },
  { match: /apple card/i,           info: { purpose: "Apple ecosystem card", rewards: "3% Apple purchases, 2% Apple Pay, 1% all else (physical card)", bestFor: "Heavy Apple Pay users", annualFee: 0 } },
  { match: /prime visa|amazon prime/i, info: { purpose: "Amazon & Whole Foods", rewards: "5% Amazon & Whole Foods, 2% dining, gas & drugstores, 1% all else", bestFor: "Amazon Prime members", annualFee: 0 } },
  { match: /marriott|bonvoy/i,      info: { purpose: "Hotel loyalty", rewards: "6x Marriott Bonvoy, 3x dining & gas, 2x all else", bestFor: "Marriott hotel loyalists", annualFee: 95 } },
  { match: /hilton honors/i,        info: { purpose: "Hotel loyalty", rewards: "7x Hilton, 5x dining, 5x groceries, 3x gas, 3x all else", bestFor: "Hilton hotel loyalists", annualFee: 95 } },
];

const getCardInfo = (name: string | null, officialName: string | null): CardInfo | null => {
  const haystack = `${name ?? ""} ${officialName ?? ""}`;
  for (const { match, info } of CARD_INFO) {
    if (match.test(haystack)) return info;
  }
  return null;
};

// ── HYSA detection ─────────────────────────────────────────────
const HYSA_INSTITUTIONS = ["marcus", "ally", "sofi", "discover", "american express", "amex", "barclays", "synchrony",
  "capital one 360", "citizens", "bask", "bread", "sallie mae", "varo", "axos", "laurel road", "ufb", "lending club",
  "cit bank", "live oak", "western alliance", "primis", "wealthfront", "betterment", "current", "robinhood", "vio",
  "quontic", "customers bank", "salem five", "everbank", "comenity", "popular direct", "tab bank", "first foundation",
  "north american savings", "dollar savings direct", "my banking direct", "evergreen", "patriot bank", "lendingclub"];
// HYSA threshold — most checking/standard savings pay well under 1%, online HYSAs are typically 4%+
const HYSA_APR_THRESHOLD = 3.0;
const isHYSA = (a: PAccount, instName: string, apr?: number | null): boolean => {
  if (a.type !== "depository" || a.subtype !== "savings") return false;
  const haystack = `${a.name ?? ""} ${a.official_name ?? ""} ${instName}`.toLowerCase();
  if (/high.?yield|hysa|hys\b/.test(haystack)) return true;
  if (HYSA_INSTITUTIONS.some(inst => haystack.includes(inst))) return true;
  return apr != null && apr >= HYSA_APR_THRESHOLD;
};

// ── Grant additional consent (e.g. cards linked before Liabilities existed) ────
const GrantConsentButton = ({ itemId, onGranted }: { itemId: string; onGranted: () => void }) => {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const onSuccess = useCallback(async (public_token: string) => {
    setFinishing(true);
    const { data, error } = await supabase.functions.invoke("plaid-grant-consent", {
      body: { public_token, itemId },
    });
    setFinishing(false);
    if (error || data?.error) {
      toast.error("Couldn't finish granting access", { description: error?.message ?? data?.error });
      return;
    }
    toast.success("Card details unlocked");
    onGranted();
  }, [itemId, onGranted]);

  const { open: openPlaid, ready } = usePlaidLink({ token: linkToken, onSuccess });

  const start = async () => {
    if (linkToken && ready) { openPlaid(); return; }
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("plaid-create-link-token", { body: { itemId } });
    setLoading(false);
    if (error || !data?.link_token) {
      toast.error("Couldn't start access request", { description: error?.message ?? data?.error });
      return;
    }
    setLinkToken(data.link_token);
  };

  // Open Plaid as soon as the token from a fresh request is ready
  useEffect(() => { if (linkToken && ready) openPlaid(); }, [linkToken, ready, openPlaid]);

  return (
    <button onClick={start} disabled={loading || finishing}
      className="w-full inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-[hsl(var(--primary)/0.35)] text-[11px] font-medium text-gold hover:bg-[hsl(var(--primary)/0.08)] transition-colors disabled:opacity-50">
      {loading || finishing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
      {finishing ? "Finishing…" : loading ? "Preparing…" : "Grant card details access"}
    </button>
  );
};

// ── Account detail dialog ──────────────────────────────────────
const AccountDetailPanel = ({ a, txns, meta, credit, instName, instUrl, itemId, onEdit, onRemove, onClose, onGranted }: {
  a: PAccount; txns: PTxn[]; meta: AccountMeta; credit?: CreditDetail;
  instName: string; instUrl: string | null; itemId: string | null;
  onEdit: () => void; onRemove: () => void; onClose: () => void; onGranted: () => void;
}) => {
  const debt = isDebt(a.type);
  const isCredit = a.type === "credit";
  const isSavings = a.type === "depository" && a.subtype === "savings";
  const isChecking = a.type === "depository" && a.subtype === "checking";
  const isInvestment = a.type === "investment" || a.type === "brokerage";
  const bal = Number(a.current_balance) || 0;
  const avail = Number(a.available_balance) || 0;
  const creditLimit = isCredit && avail >= 0 ? Math.abs(bal) + avail : 0;
  const utilization = isCredit && creditLimit > 0 ? Math.abs(bal) / creditLimit : null;
  const displayName = meta.nickname || a.name || a.official_name || "Account";
  const cardInfo = isCredit ? getCardInfo(a.name, a.official_name) : null;
  const hysa = isHYSA(a, instName, meta.apr);
  const isPromo = meta.promoApr != null;
  const promoExpired = meta.promoEndDate ? new Date(meta.promoEndDate) < new Date() : false;
  const daysUntilPromoEnd = meta.promoEndDate
    ? Math.ceil((new Date(meta.promoEndDate).getTime() - Date.now()) / 86400000) : null;
  const Icon = mapIcon(a.type, a.subtype);
  const accentColor = debt ? "hsl(var(--negative))" : "hsl(var(--positive))";

  // 30-day net flow
  const thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const recentAll = txns.slice(0, 5);
  const accTxns30 = txns.filter(t => new Date(t.date) >= thirtyAgo);
  const netFlow30 = accTxns30.reduce((s, t) => s - Number(t.amount), 0);
  const trendGood = debt ? netFlow30 < 0 : netFlow30 > 0;

  // Annual interest / earnings
  const aprRate = meta.apr ?? null;
  const yearlyAmount = aprRate != null ? Math.abs(bal) * aprRate / 100 : 0;

  const dueDate = credit?.next_payment_due_date
    ? new Date(credit.next_payment_due_date + "T00:00:00") : null;
  const dueSoon = dueDate ? (dueDate.getTime() - Date.now()) / 86400000 <= 7 : false;

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogTitle className="sr-only">{displayName}</DialogTitle>
        <DialogDescription className="sr-only">Account details for {displayName}</DialogDescription>

        {/* Header */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b shrink-0" style={{ borderColor: "var(--gold-border)" }}>
          <div className="h-10 w-10 rounded-xl grid place-items-center shrink-0" style={{ backgroundColor:`${accentColor}1a`, color:accentColor }}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-display text-lg text-foreground leading-snug">{displayName}</span>
              {hysa && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-positive/30 text-positive bg-positive/10">High Yield</span>}
              {isCredit && credit?.is_overdue && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-negative/30 text-negative bg-negative/10">Overdue</span>}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {smartSubtypeLabel(a, instName, meta.apr)} · {instName}{a.mask ? ` ··${a.mask}` : ""}
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 h-7 w-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-5 py-4 space-y-4">

            {/* Balance row */}
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                  {isCredit ? "Current balance" : isSavings ? "Savings balance" : isChecking ? "Checking balance" : "Balance"}
                </div>
                <div className={cn("font-display text-3xl tabular leading-none", debt ? "text-negative" : "text-foreground")}>
                  {debt ? "−" : ""}{fmtUSD(Math.abs(bal))}
                </div>
              </div>
              {avail > 0 && avail !== bal && (
                <div className="text-right">
                  <div className="text-[10px] text-muted-foreground">{isCredit ? "Available credit" : "Available"}</div>
                  <div className={cn("text-[14px] tabular font-medium", isCredit ? "text-positive" : "text-foreground")}>
                    {fmtUSD(avail)}
                  </div>
                </div>
              )}
            </div>

            {/* Credit card specifics */}
            {isCredit && (
              <>
                {/* Utilization bar */}
                {utilization !== null && creditLimit > 0 && (
                  <div className="surface-card p-3 space-y-2">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">Credit utilization</span>
                      <span className={cn("font-medium tabular", utilization > 0.5 ? "text-negative" : utilization > 0.3 ? "text-warning" : "text-positive")}>
                        {(utilization * 100).toFixed(0)}% of {fmtUSD(creditLimit, { compact: true })} limit
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{
                        width: `${Math.min(utilization * 100, 100)}%`,
                        backgroundColor: utilization > 0.5 ? "hsl(var(--negative))" : utilization > 0.3 ? "hsl(var(--warning))" : "hsl(var(--positive))"
                      }} />
                    </div>
                  </div>
                )}

                {/* Statement / due date grid */}
                {(credit?.last_statement_balance != null || dueDate || credit?.minimum_payment_amount != null || credit?.last_payment_amount != null) && (
                  <div className="grid grid-cols-2 gap-2">
                    {credit?.last_statement_balance != null && (
                      <div className="surface-card p-3">
                        <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Statement balance</div>
                        <div className="font-display text-[15px] mt-1 tabular text-warning">{fmtUSD(credit.last_statement_balance)}</div>
                      </div>
                    )}
                    {dueDate && (
                      <div className={cn("surface-card p-3", credit?.is_overdue && "border border-negative/30")}>
                        <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Payment due</div>
                        <div className={cn("font-display text-[15px] mt-1", credit.is_overdue ? "text-negative" : dueSoon ? "text-warning" : "text-foreground")}>
                          {dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          {dueSoon && !credit?.is_overdue && <span className="ml-1 text-[10px] text-warning font-normal">soon</span>}
                        </div>
                      </div>
                    )}
                    {credit?.minimum_payment_amount != null && (
                      <div className="surface-card p-3">
                        <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Min payment</div>
                        <div className="font-display text-[15px] mt-1 tabular">{fmtUSD(credit.minimum_payment_amount)}</div>
                      </div>
                    )}
                    {credit?.last_payment_amount != null && (
                      <div className="surface-card p-3">
                        <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Last payment</div>
                        <div className="font-display text-[15px] mt-1 tabular text-positive">{fmtUSD(credit.last_payment_amount)}</div>
                      </div>
                    )}
                  </div>
                )}
                {!credit && itemId && (
                  <div className="surface-card p-3">
                    <div className="text-[11px] text-muted-foreground mb-2">
                      This card was linked before statement balance, due date, and APR tracking existed. Grant a bit of extra access to unlock it.
                    </div>
                    <GrantConsentButton itemId={itemId} onGranted={onGranted} />
                  </div>
                )}

                {/* Promo APR banner */}
                {isPromo && !promoExpired && (
                  <div className="inline-flex items-center gap-1.5 chip chip-positive text-[11px]">
                    <Sparkles className="h-3 w-3" />
                    {daysUntilPromoEnd != null && daysUntilPromoEnd > 0
                      ? `0% promo APR · ${daysUntilPromoEnd}d left${meta.promoEndDate ? ` (ends ${new Date(meta.promoEndDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })})` : ""}`
                      : "0% APR active"}
                  </div>
                )}
                {isPromo && promoExpired && (
                  <div className="inline-flex items-center gap-1.5 chip chip-negative text-[11px]">
                    0% promo APR expired. Regular APR now applies.
                  </div>
                )}
                {!isPromo && aprRate != null && (
                  <div className="flex items-center justify-between surface-card px-3 py-2.5">
                    <span className="text-[12px] text-muted-foreground">APR</span>
                    <span className="text-[12px] font-medium text-negative tabular">{aprRate.toFixed(2)}%</span>
                  </div>
                )}

                {/* Card purpose & rewards */}
                {cardInfo && (
                  <div className="space-y-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Card details</div>
                    <div className="surface-card p-3 space-y-2.5">
                      <div>
                        <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground mb-0.5">Best used for</div>
                        <div className="text-[12.5px] text-foreground">{cardInfo.bestFor}</div>
                      </div>
                      <div>
                        <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground mb-0.5">Rewards</div>
                        <div className="text-[12.5px] text-foreground leading-relaxed">{cardInfo.rewards}</div>
                      </div>
                      {cardInfo.notes && (
                        <div>
                          <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground mb-0.5">Special perks</div>
                          <div className="text-[12.5px] text-foreground leading-relaxed">{cardInfo.notes}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Savings / checking specifics */}
            {(isSavings || isChecking) && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {Math.abs(netFlow30) > 1 && (
                    <div className="surface-card p-3">
                      <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">30-day flow</div>
                      <div className={cn("font-display text-[15px] mt-1 tabular flex items-center gap-1", trendGood ? "text-positive" : "text-negative")}>
                        {netFlow30 > 0 ? <TrendingUp className="h-3 w-3"/> : <TrendingDown className="h-3 w-3"/>}
                        {netFlow30 > 0 ? "+" : ""}{fmtUSD(Math.abs(netFlow30), { compact: true })}
                      </div>
                    </div>
                  )}
                  {aprRate != null && (
                    <div className="surface-card p-3">
                      <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">APY</div>
                      <div className="font-display text-[15px] mt-1 tabular text-positive">{aprRate.toFixed(2)}%</div>
                    </div>
                  )}
                  {aprRate != null && (
                    <div className="surface-card p-3">
                      <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Est. annual yield</div>
                      <div className="font-display text-[15px] mt-1 tabular text-positive">+{fmtUSD(yearlyAmount, { compact: true })}</div>
                    </div>
                  )}
                </div>
                {hysa && (
                  <div className="surface-card px-3 py-2.5 flex items-start gap-2.5">
                    <PiggyBank className="h-4 w-4 text-positive shrink-0 mt-0.5" />
                    <div>
                      <div className="text-[12px] text-foreground font-medium">High-Yield Savings Account</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                        Earns significantly more than a standard savings account.
                        {aprRate != null ? ` At ${aprRate.toFixed(2)}% APY, your balance earns ${fmtUSD(yearlyAmount, { compact: true })}/yr.` : " Set your APY in Edit to see estimated earnings."}
                      </div>
                    </div>
                  </div>
                )}
                {isSavings && !hysa && (
                  <div className="surface-card px-3 py-2.5 flex items-start gap-2.5">
                    <Coins className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="text-[11px] text-muted-foreground leading-relaxed">
                      Standard savings account. Consider moving idle cash to a High-Yield Savings Account (HYSA) to earn more interest.
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Investment specifics */}
            {isInvestment && Math.abs(netFlow30) > 1 && (
              <div className="surface-card p-3">
                <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">30-day change</div>
                <div className={cn("font-display text-[15px] mt-1 tabular flex items-center gap-1", trendGood ? "text-positive" : "text-negative")}>
                  {netFlow30 > 0 ? <TrendingUp className="h-3 w-3"/> : <TrendingDown className="h-3 w-3"/>}
                  {netFlow30 > 0 ? "+" : ""}{fmtUSD(Math.abs(netFlow30), { compact: true })}
                </div>
              </div>
            )}

            {/* Recent transactions */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Recent charges</div>
                {txns.length > 5 && (
                  <button onClick={onClose} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
                    View all {txns.length} <ChevronRight className="h-3 w-3" />
                  </button>
                )}
              </div>
              {recentAll.length > 0 ? (
                <div className="surface-card overflow-hidden divide-y divide-border/20">
                  {recentAll.map(t => {
                    const isInc = Number(t.amount) < 0;
                    return (
                      <div key={t.id} className="flex items-center gap-2.5 px-3 py-2.5">
                        <div className={cn("h-6 w-6 rounded grid place-items-center shrink-0",
                          isInc ? "bg-positive/10 text-positive" : "bg-secondary/50 text-muted-foreground")}>
                          {isInc ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] text-foreground truncate">{t.merchant_name ?? t.name ?? "Transaction"}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {new Date(t.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            {t.pending && " · Pending"}
                          </div>
                        </div>
                        <span className={cn("text-[12px] tabular font-medium shrink-0", isInc ? "text-positive" : "text-foreground")}>
                          {isInc ? "+" : "−"}{fmtUSD(Math.abs(Number(t.amount)), { cents: true })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-4 text-[12px] text-muted-foreground">No recent transactions.</div>
              )}
            </div>

          </div>
        </div>

        {/* Footer actions */}
        <div className="shrink-0 px-5 py-3 border-t flex gap-2" style={{ borderColor: "var(--gold-border)" }}>
          {instUrl && (
            <a href={instUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 inline-flex items-center justify-center gap-2 h-9 rounded-lg bg-gold text-[12px] font-medium hover:opacity-90 transition-opacity">
              <ExternalLink className="h-3.5 w-3.5" /> Open bank
            </a>
          )}
          <button onClick={onEdit} className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-border text-[12px] text-muted-foreground hover:text-foreground transition-colors">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
          <button onClick={() => { onClose(); onRemove(); }} className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-negative/30 text-[12px] text-negative hover:bg-negative/10 transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── Money Map subcomponents (module-level to preserve React identity) ──────────
type AccountEntry = { acc: PAccount; info: AccountRoleInfo };

const ROLE_OPTIONS: { role: AccountRole; icon: typeof Wallet }[] = [
  { role: "spending",     icon: Wallet },
  { role: "buffer",       icon: ShieldAlert },
  { role: "reserve",      icon: Target },
  { role: "savings_goal", icon: PiggyBank },
  { role: "investment",   icon: TrendingUp },
  { role: "debt",         icon: CreditCard },
];

const AccountTagStack = ({
  list,
  onAssign,
}: {
  list: AccountEntry[];
  onAssign: (accountId: string, role: AccountRole) => void;
}) => {
  const [index, setIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const clamped = Math.min(index, Math.max(0, list.length - 1));

  if (list.length === 0) return null;
  const current = list[clamped];

  const goNext = () => setIndex(i => Math.min(list.length - 1, i + 1));
  const goPrev = () => setIndex(i => Math.max(0, i - 1));
  const onPointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    startXRef.current = e.clientX;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    setDragX(e.clientX - startXRef.current);
  };
  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (dragX < -60) goNext(); else if (dragX > 60) goPrev();
    setDragX(0);
  };
  const assign = (role: AccountRole) => {
    onAssign(current.acc.account_id, role);
    setDragX(0);
    setIndex(i => Math.min(i, Math.max(0, list.length - 2)));
  };

  return (
    <div className="surface-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border/30 flex items-center justify-between">
        <div>
          <h3 className="font-display text-[13px] text-primary">Quick-tag accounts</h3>
          <div className="text-[10.5px] text-muted-foreground mt-0.5">Swipe or tap a category for each one</div>
        </div>
        <span className="text-[10px] text-muted-foreground tabular shrink-0">{clamped + 1} of {list.length}</span>
      </div>
      <div className="p-4">
        <div className="relative h-[126px] select-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerLeave={endDrag} style={{ touchAction: "none" }}>
          {list.map(({ acc }, i) => {
            const offset = i - clamped;
            if (Math.abs(offset) > 2) return null;
            const isActive = offset === 0;
            const liveDrag = isActive ? dragX : 0;
            const translate = offset * 22 + liveDrag / 3;
            const scale = 1 - Math.min(Math.abs(offset), 2) * 0.06;
            const opacity = 1 - Math.min(Math.abs(offset), 2) * 0.4;
            return (
              <div key={acc.account_id}
                className="absolute inset-0 max-w-md mx-auto rounded-xl border border-border/50 bg-surface-elevated px-5 py-4.5 flex items-center gap-3 cursor-grab active:cursor-grabbing"
                style={{
                  transform: `translateX(${translate}%) scale(${scale})`, opacity, zIndex: 10 - Math.abs(offset),
                  transition: draggingRef.current && isActive ? "none" : "transform 280ms cubic-bezier(0.22,1,0.36,1), opacity 280ms",
                  pointerEvents: isActive ? "auto" : "none",
                }}>
                <div className="h-9 w-9 rounded-lg bg-secondary/60 grid place-items-center shrink-0">
                  <Landmark className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-foreground font-medium truncate">{acc.name ?? acc.official_name}</div>
                  <div className="text-[11px] text-muted-foreground tabular mt-0.5">{fmtUSD(Number(acc.current_balance) || 0)}</div>
                  <div className="text-[10.5px] text-muted-foreground mt-1">What's this account for?</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-3 gap-1.5 mt-3">
          {ROLE_OPTIONS.map(({ role, icon: Icon }) => (
            <button key={role} onClick={() => assign(role)}
              className="flex flex-col items-center gap-1 rounded-lg border border-border/40 py-2 hover:border-[hsl(var(--primary)/0.4)] hover:bg-surface-hover/40 transition-colors">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] text-foreground text-center leading-tight">{ROLE_META[role].short}</span>
            </button>
          ))}
        </div>
        {list.length > 1 && (
          <div className="flex justify-center gap-1.5 mt-3">
            {list.map((_, i) => (
              <div key={i} className={cn("h-1.5 rounded-full transition-all", i === clamped ? "w-4 bg-gold" : "w-1.5 bg-border/50")} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const RoleBadgeSelect = ({
  accountId, accType, accSubtype, getRole, setRole,
}: {
  accountId: string;
  accType: string | null;
  accSubtype: string | null;
  getRole: (id: string, type: string | null, subtype: string | null) => AccountRoleInfo;
  setRole: (id: string, info: AccountRoleInfo) => void;
}) => {
  const current = getRole(accountId, accType, accSubtype);
  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState(current.label ?? "");
  if (editing) {
    return (
      <form className="flex items-center gap-1.5" onSubmit={e => {
        e.preventDefault();
        setRole(accountId, { role: current.role, label: labelDraft.trim() || undefined });
        setEditing(false);
      }}>
        <input autoFocus value={labelDraft} onChange={e => setLabelDraft(e.target.value)}
          placeholder="e.g. Travel" onKeyDown={e => { if (e.key === "Escape") setEditing(false); }}
          className="h-7 w-24 px-2 rounded-md bg-surface/60 border border-[hsl(var(--primary)/0.4)] text-[11px] text-foreground outline-none" />
        <button type="submit" className="h-7 px-2 rounded-md bg-gold text-[10.5px] font-medium">Save</button>
      </form>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <select value={current.role} onChange={e => setRole(accountId, { role: e.target.value as AccountRole, label: current.label })}
        className="h-7 px-2 rounded-md bg-surface/60 border border-border/50 text-[11px] text-foreground outline-none cursor-pointer">
        {(Object.keys(ROLE_META) as AccountRole[]).filter(r => r !== "unassigned").map(r => (
          <option key={r} value={r}>{ROLE_META[r].name}</option>
        ))}
      </select>
      {(current.role === "reserve" || current.role === "savings_goal") && (
        <button onClick={() => { setLabelDraft(current.label ?? ""); setEditing(true); }}
          className="text-[10.5px] text-muted-foreground hover:text-foreground">
          {current.label ? `"${current.label}"` : "+ label"}
        </button>
      )}
    </div>
  );
};

// ── Main props ─────────────────────────────────────────────────
interface Props {
  onAddAccount: ()=>void;
  hasItems: boolean;
  demo?: boolean;
  guestDemo?: boolean;
  view?: string;
  syncTrigger?: number;
  onSyncingChange?: (v:boolean)=>void;
  selectedCategory?: string|null;
  onCategorySelect?: (cat:string)=>void;
  manualAccounts?: import("@/hooks/useManualAccounts").ManualAccount[];
  onEditManual?: (acct: import("@/hooks/useManualAccounts").ManualAccount) => void;
  onDeleteManual?: (id: string) => void;
}

export const LivePlaidDashboard = ({
  onAddAccount, hasItems, demo=false, guestDemo=false, view="overall",
  syncTrigger=0, onSyncingChange,
  selectedCategory, onCategorySelect,
  manualAccounts = [], onEditManual, onDeleteManual,
}: Props) => {
  const { user } = useAuth();

  // ── All user preferences — synced to Supabase ──────────────────
  // Demo mode (whether guest /demo or a real user previewing "Demo mode") must
  // never read or write the real account's settings — pass no userId so it
  // always gets fresh, in-memory-only defaults, same as guestDemo.
  const S = useUserSettings((demo || guestDemo) ? undefined : user?.id);
  const { settings, loaded: settingsLoaded } = S;

  // Destructure for ergonomic use throughout the component
  const budgets = settings.budgets;
  const setBudget = S.setBudget;
  const removeBudget = S.removeBudget;
  const roles = settings.accountRoles;
  const setRole = S.setAccountRole;
  const catOverridesManual = settings.catOverrides;
  const setOverride = S.setCatOverride;
  const bulkSetOverride = (ids: string[], cat: string) => S.bulkSetCatOverride(ids, cat);
  const bulkSetOverrideMap = S.bulkSetCatOverrideMap;
  const reassignCategory = (oldCat: string, newCat: string) => {
    const map: Record<string,string> = {};
    txns.forEach(t => { if ((getEffectiveCategory(t, settings.catOverrides, getRuleCategory) ?? "Other") === oldCat) map[t.id] = newCat; });
    S.bulkSetCatOverrideMap(map);
  };
  const rules = settings.catRules;
  // When a rule is added, clear any per-txn overrides for transactions the rule now covers.
  // This is what makes "set rule → category sticks" work — without this, old AI-generated
  // overrides in catOverrides take priority over the new rule.
  const addRule = (pattern: string, category: string, matchType: "contains" | "exact" | "starts_with" = "contains") => {
    S.addCatRule(pattern, category, matchType);
    // Find all txns covered by this new rule and clear their per-txn overrides
    const p = pattern.toLowerCase();
    const matchedIds = txns
      .filter(t => {
        const m = (t.merchant_name ?? t.name ?? "").toLowerCase();
        if (matchType === "exact") return m === p;
        if (matchType === "starts_with") return m.startsWith(p);
        return m.includes(p);
      })
      .map(t => t.id);
    if (matchedIds.length > 0) S.clearAiOverridesForIds(matchedIds);
  };
  const updateRule = (id: string, patch: Parameters<typeof S.updateCatRule>[1]) => {
    S.updateCatRule(id, patch);
    // Also re-clear overrides if pattern or category changed
    if (patch.pattern || patch.category || patch.matchType) {
      const rule = rules.find(r => r.id === id);
      if (rule) {
        const resolvedPattern = patch.pattern ?? rule.pattern;
        const resolvedMatchType = patch.matchType ?? rule.matchType;
        const p = resolvedPattern.toLowerCase();
        const matchedIds = txns
          .filter(t => {
            const m = (t.merchant_name ?? t.name ?? "").toLowerCase();
            if (resolvedMatchType === "exact") return m === p;
            if (resolvedMatchType === "starts_with") return m.startsWith(p);
            return m.includes(p);
          })
          .map(t => t.id);
        if (matchedIds.length > 0) S.clearAiOverridesForIds(matchedIds);
      }
    }
  };
  const removeRule = S.removeCatRule;
  const toggleRule = S.toggleCatRule;
  const smartRules = settings.smartRules;
  const addSmartRule = S.addSmartRule;
  const updateSmartRule = S.updateSmartRule;
  const removeSmartRule = S.removeSmartRule;
  const toggleSmartRule = S.toggleSmartRule;
  const customCategories = settings.customCats;
  const addCategory = S.addCustomCat;
  const removeCategory = S.removeCustomCat;
  const allCategoryNames = useMemo(
    () => Array.from(new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES, ...customCategories.map(c => c.name)])).map(formatCat),
    [customCategories]
  );
  const nameOverridesManual = settings.nameOverrides;
  const setNameOverride = S.setNameOverride;
  const bulkSetNameOverride = S.bulkSetNameOverride;
  const nameRules = settings.nameRules;
  const saveNameRule = S.saveNameRule;
  const manualIncome = settings.manualIncome;
  const addManualIncome = (item: { id: string; label: string; amount: number }) => S.addManualIncome(item);
  const removeManualIncome = (id: string) => S.removeManualIncome(id);
  const benefitsUsed = settings.benefitsUsed;
  const feedback = settings.moneyMapFeedback;
  const getFeedback = (id: string) => settings.moneyMapFeedback[id];
  const recordFeedback = S.recordFeedback;

  const dismissedInsights = new Set(settings.dismissedInsights);
  const dismissedActions = new Set(settings.dismissedActions);
  const dismissedRecurring = new Set(settings.dismissedRecurring);
  const recurringDismissals = settings.recurringDismissals;
  const dismissInsight = S.dismissInsight;
  const dismissAction = S.dismissAction;
  const dismissRecurring = (merchant: string) => S.dismissRecurring(merchant);
  const dismissRecurringWithReason = S.dismissRecurringWithReason;
  const restoreAllRecurring = () => S.clearRecurringDismissals();
  // Suppression sets derived from structured dismissals: exact merchant keys plus
  // any categories the user chose to hide entirely, so similar charges stay gone.
  const suppressRecurringMerchants = useMemo(
    () => new Set([...dismissedRecurring, ...recurringDismissals.map(d => d.merchant.toLowerCase())]),
    [settings.dismissedRecurring, recurringDismissals]
  );
  const suppressRecurringCategories = useMemo(
    () => new Set(recurringDismissals.filter(d => d.suppressCategory && d.category).map(d => d.category!.toLowerCase())),
    [recurringDismissals]
  );

  // getRuleCategory — derived from rules (memoized)
  const getRuleCategory = useCallback((merchantName: string | null): string | null => {
    if (!merchantName) return null;
    const m = merchantName.toLowerCase();
    const ordered = [...rules.filter(r => r.source === "user"), ...rules.filter(r => r.source === "system")];
    const match = ordered.find(r => {
      if (!r.enabled) return false;
      const p = r.pattern.toLowerCase();
      if (p.length < 2) return false;
      switch (r.matchType) {
        case "exact": return m === p;
        case "starts_with": return m.startsWith(p);
        default: return m.includes(p);
      }
    });
    return match?.category ?? null;
  }, [rules]);

  const getMatchCount = (rule: (typeof rules)[0], txnList: { merchant_name: string | null; name: string | null }[]) => {
    const p = rule.pattern.toLowerCase();
    return txnList.filter(t => {
      const m = (t.merchant_name ?? t.name ?? "").toLowerCase();
      switch (rule.matchType) {
        case "exact": return m === p;
        case "starts_with": return m.startsWith(p);
        default: return m.includes(p);
      }
    }).length;
  };

  const getRole = (accountId: string, accountType?: string | null, accountSubtype?: string | null) => {
    if (roles[accountId]) return roles[accountId];
    if (accountType === "credit" || accountType === "loan") return { role: "debt" as const };
    if (accountType === "investment") return { role: "investment" as const };
    if (accountSubtype === "checking") return { role: "spending" as const };
    return { role: "unassigned" as const };
  };

  const saveMeta = (accountId: string, meta: Partial<AccountMeta>) => S.setAccountMeta(accountId, meta);

  const [loading, setLoading]       = useState(true);
  const [syncing, setSyncing]       = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date|null>(null);
  const [accounts, setAccounts]     = useState<PAccount[]>([]);
  const [items, setItems]           = useState<PItem[]>([]);
  const [creditDetails, setCreditDetails] = useState<CreditDetail[]>([]);
  const [txns, setTxns]             = useState<PTxn[]>([]);
  // accountMeta from Supabase settings
  const accountMeta = settings.accountMeta as Record<string, AccountMeta>;
  const [editingAccount, setEditingAccount] = useState<PAccount | null>(null);
  const [detailAccount, setDetailAccount] = useState<PAccount | null>(null);
  const [removingAccount, setRemovingAccount] = useState<PAccount | null>(null);
  const [removeConfirming, setRemoveConfirming] = useState(false);
  const [aiInsights, setAiInsights] = useState<AIInsight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [openInsight, setOpenInsight] = useState<AIInsight|null>(null);
  const [period, setPeriod]         = useState<Period>("1M");
  const [editingBudgetCat, setEditingBudgetCat] = useState<string|null>(null);
  const [openPickerTxn, setOpenPickerTxn] = useState<PTxn|null>(null);
  const [pickerPos, setPickerPos] = useState<{x:number;y:number}>({x:0,y:0});
  const [budgetDraft, setBudgetDraft] = useState("");
  const [showCatManager, setShowCatManager] = useState(false);
  const [showRulesManager, setShowRulesManager] = useState(false);
  const [openActionItem, setOpenActionItem] = useState<ActionItem|null>(null);
  const [spendingPopup, setSpendingPopup] = useState<string|null>(null);
  const [spendPopupLimit, setSpendPopupLimit] = useState<5|10|"all">(5);
  // Period state for monthly + spending tabs
  const [monthlyPeriod, setMonthlyPeriod] = useState<PeriodState>({ granularity: "month", offset: 0 });
  const [spendingPeriod, setSpendingPeriod] = useState<PeriodState>({ granularity: "month", offset: 0 });
  const [budgetMonthOffset, setBudgetMonthOffset] = useState(0);
  const [budgetCatPopup, setBudgetCatPopup] = useState<string | null>(null);
  const [addCatNameDraft, setAddCatNameDraft] = useState("");
  const [addCatCustom, setAddCatCustom] = useState("");
  const [hoveredSlice, setHoveredSlice] = useState<number | null>(null);
  const [recurringMenuFor, setRecurringMenuFor] = useState<string | null>(null); // merchantKey whose remove-reason menu is open
  const [showOrganize, setShowOrganize] = useState(false); // Money Map: organize-accounts dialog
  // manualIncome from useUserSettings
  const [showAddIncome, setShowAddIncome] = useState(false);
  const [incomeDraftLabel, setIncomeDraftLabel] = useState("");
  const [incomeDraftAmt, setIncomeDraftAmt] = useState("");
  const [fundAllocations, setFundAllocations] = useState<Record<string,string>>({});
  // Transaction explorer (spending tab) — search / filter / sort
  const [txnSearch, setTxnSearch] = useState("");
  const [txnFlowFilter, setTxnFlowFilter] = useState<"all"|"expense"|"income">("all");
  const [txnSort, setTxnSort] = useState<"date-desc"|"date-asc"|"amount-desc"|"amount-asc"|"name-asc"|"name-desc"|"category-asc">("date-desc");
  const [hideInternal, setHideInternal] = useState(true);
  const [txnLimit, setTxnLimit] = useState(150);
  // Drill-down: clicking a bar in the spend-trend chart narrows the txn list to that exact day/month
  const [chartDrillDate, setChartDrillDate] = useState<string|null>(null);   // exact "YYYY-MM-DD" (day/week/month granularity)
  const [chartDrillMonth, setChartDrillMonth] = useState<number|null>(null); // 0-11 (year granularity)
  // Advanced filter — a full condition set (all/any across every field)
  const [filterSet, setFilterSet] = useState<ConditionSet>({ match: "all", conditions: [] });
  const [showFilterBuilder, setShowFilterBuilder] = useState(false);
  const [otherCatsExpanded, setOtherCatsExpanded] = useState(false);
  const [incomeExpanded, setIncomeExpanded] = useState(false);
  const [monthlyFlowFilter, setMonthlyFlowFilter] = useState<"all"|"expense"|"income">("all");
  const setBenefitsUsed = (updater: ((prev: Record<string,boolean>) => Record<string,boolean>) | Record<string,boolean>) => {
    const next = typeof updater === "function" ? updater(settings.benefitsUsed) : updater;
    S.update({ benefitsUsed: next });
  };
  // Per-section loading states for selective refresh
  const [refreshingAccounts, setRefreshingAccounts] = useState(false);
  const [refreshingTxns, setRefreshingTxns] = useState(false);
  // Inline category picker — tracks which txn has the picker open + anchor position

  // dismissedXxx are computed from settings (Supabase-backed)

  // nameOverrides, nameRules, setNameOverride, bulkSetNameOverride, saveNameRule — all from useUserSettings above

  const [detailTxn, setDetailTxn] = useState<PTxn | null>(null);
  const [detailTxnOpenCat, setDetailTxnOpenCat] = useState(false);
  const openDetail = (txn: PTxn, openCat = false) => { setDetailTxn(txn); setDetailTxnOpenCat(openCat); };

  // ── Smart rules — evaluate generic multi-condition rules across all txns.
  // Because this is derived state, newly synced transactions are handled
  // automatically on the next render (no manual "run" needed).
  // Normalized transactions the rule/filter evaluator reads from.
  const evalTxns = useMemo<{ id: string; ev: EvalTxn }[]>(() => {
    const acctMap = new Map(accounts.map(a => [a.account_id, a]));
    return txns.map(t => {
      const acc = acctMap.get(t.account_id);
      const amount = Number(t.amount) || 0;
      return { id: t.id, ev: {
        amount, absAmount: Math.abs(amount),
        merchant: nameOverridesManual[t.id] ?? t.merchant_name ?? t.name ?? "",
        category: formatCat(getEffectiveCategory(t, catOverridesManual, getRuleCategory) ?? "Other"),
        accountId: t.account_id, accountName: acc?.name ?? "", accountType: acc?.type ?? "",
        date: t.date, flow: (amount >= 0 ? "expense" : "income") as "expense" | "income", pending: !!t.pending,
      } };
    });
  }, [txns, accounts, getRuleCategory, catOverridesManual, nameOverridesManual]);

  const smartResults = useMemo(() => {
    const catById: Record<string, string> = {};
    const nameById: Record<string, string> = {};
    const internalIds = new Set<string>();
    const enabled = smartRules.filter(r => r.enabled && r.conditions.length && r.actions.length);
    if (enabled.length === 0) return { catById, nameById, internalIds };
    for (const { id, ev } of evalTxns) {
      for (const rule of enabled) {
        if (!ruleMatches(rule, ev)) continue;
        for (const action of rule.actions) {
          if (action.type === "set_category" && action.value) catById[id] = action.value;
          else if (action.type === "rename" && action.value) nameById[id] = action.value;
          else if (action.type === "mark_internal") internalIds.add(id);
        }
      }
    }
    return { catById, nameById, internalIds };
  }, [smartRules, evalTxns]);

  // Merged maps — manual edits always win over smart-rule output.
  const overrides = useMemo(() => ({ ...smartResults.catById, ...catOverridesManual }), [smartResults, catOverridesManual]);
  const nameOverrides = useMemo(() => ({ ...smartResults.nameById, ...nameOverridesManual }), [smartResults, nameOverridesManual]);

  // Resolve display name: per-txn override → merchant rule → merchant name
  const getDisplayName = (t: PTxn) => {
    if (nameOverrides[t.id]) return nameOverrides[t.id];
    const m = t.merchant_name ?? t.name ?? null;
    if (m && nameRules[m]) return nameRules[m];
    return m ?? "Transaction";
  };

  // Panel order for overall dashboard (drag-and-drop)
  const DEFAULT_PANEL_ORDER = ["action-items", "saving-opps", "top-spending", "upcoming-charges"];
  const panelOrder = (settings.panelOrder?.length === 4 && DEFAULT_PANEL_ORDER.every(id => settings.panelOrder.includes(id))) ? settings.panelOrder : DEFAULT_PANEL_ORDER;
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const txnListRef = useRef<HTMLDivElement>(null);
  // Fire daily alerts check silently (once per day per device)
  useEffect(() => {
    if (!user || demo || guestDemo) return;
    const key = `sentryfi_alerts_checked_${new Date().toISOString().slice(0,10)}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    supabase.functions.invoke("send-alerts").catch(() => {}); // fire and forget
  }, [user, demo, guestDemo]);
  const handlePanelDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = panelOrder.indexOf(String(active.id));
      const newIdx = panelOrder.indexOf(String(over.id));
      const next = arrayMove(panelOrder, oldIdx, newIdx);
      S.setPanelOrder(next);
    }
  };

  const load = useCallback(async()=>{
    // In demo mode: skip Supabase, seed with realistic local data immediately
    if (demo) {
      setAccounts(demoAccounts as unknown as PAccount[]);
      setTxns(demoTransactions as unknown as PTxn[]);
      setItems(demoItems as unknown as PItem[]);
      setCreditDetails([]);
      setLoading(false);
      return;
    }
    if (!user) return;
    setLoading(true);
    try {
      const threeMonthsAgo = (() => { const d = new Date(); d.setMonth(d.getMonth()-3); return d.toISOString().slice(0,10); })();
      const [accsRes, txnsRes, itsRes, cdRes] = await Promise.all([
        supabase.from("plaid_accounts").select("*").eq("user_id",user.id).order("type"),
        supabase.from("plaid_transactions").select("*").eq("user_id",user.id).gte("date", threeMonthsAgo).order("date",{ascending:false}),
        supabase.from("plaid_items").select("id,item_id,institution_id,institution_name").eq("user_id",user.id),
        supabase.from("plaid_credit_details").select("*").eq("user_id",user.id),
      ]);
      if (accsRes.error) console.error("[load] accounts:", accsRes.error.message);
      if (txnsRes.error) console.error("[load] transactions:", txnsRes.error.message);
      if (itsRes.error)  console.error("[load] items:", itsRes.error.message);
      if (cdRes.error)   console.error("[load] credit details:", cdRes.error.message);
      // Apply whatever succeeded — one failing table shouldn't blank the rest
      setAccounts((accsRes.data ?? []) as PAccount[]);
      setTxns((txnsRes.data ?? []) as PTxn[]);
      setItems((itsRes.data ?? []) as PItem[]);
      setCreditDetails((cdRes.data ?? []) as CreditDetail[]);
      // accountMeta auto-updates from settings
      setLastSyncedAt(new Date());
      if (accsRes.error && txnsRes.error) {
        toast.error("Failed to load financial data", { description: accsRes.error.message });
      }
    } catch (e) {
      console.error("[load] unexpected error:", e);
      toast.error("Failed to load data", { description: (e as Error)?.message });
    } finally {
      setLoading(false);
    }
  },[user, demo]);

  const loadInsights = useCallback(async (force=false)=>{
    if (!user) return;
    setInsightsLoading(true);
    try {
      if (!force) {
        const { data:cached } = await supabase.from("ai_insights").select("insights,created_at").eq("user_id",user.id).maybeSingle();
        if (cached?.insights) {
          const age = Date.now()-new Date(cached.created_at).getTime();
          setAiInsights(parseInsights(cached.insights));
          if (age < 6*3600*1000) { setInsightsLoading(false); return; }
        }
      }
      const { data,error } = await supabase.functions.invoke("analyze-finances");
      if (!error && data?.insights) setAiInsights(parseInsights(data.insights));
      else if (error) toast.error("AI analysis failed", { description: error.message });
    } catch(e) { console.error("[insights]",e); }
    finally { setInsightsLoading(false); }
  },[user]);

  const doSync = useCallback(async()=>{
    if (!user) return;
    setSyncing(true); onSyncingChange?.(true);
    const { data,error } = await supabase.functions.invoke("plaid-sync-transactions");
    setSyncing(false); onSyncingChange?.(false);
    if (error||data?.error) { toast.error("Sync failed",{description:error?.message??data?.error}); return; }
    const synced = data?.synced ?? 0;
    toast.success(`Synced ${synced} transaction${synced !== 1 ? "s" : ""}`);
    await load();
    // Plaid already provides categories — no AI needed.
    // User rules (pattern matching) and manual per-txn overrides handle the rest.
    if (synced > 0) {
      loadInsights(true).catch(console.warn);
    }
  },[user,load,loadInsights,onSyncingChange]);

  const doRemoveAccount = useCallback(async (account: PAccount) => {
    if (!user) return;
    setRemoveConfirming(true);
    try {
      // Delete the account directly; transactions cascade via DB foreign key
      const { error: accErr } = await supabase
        .from("plaid_accounts")
        .delete()
        .eq("id", account.id)
        .eq("user_id", user.id);
      if (accErr) throw accErr;

      // Also remove associated transactions for this account
      await supabase
        .from("plaid_transactions")
        .delete()
        .eq("account_id", account.account_id)
        .eq("user_id", user.id);

      // If this was the last account for the linked item, remove the item too
      const { data: remaining } = await supabase
        .from("plaid_accounts")
        .select("id")
        .eq("user_id", user.id);
      const raw = account as unknown as Record<string, unknown>;
      const itemId = raw.item_id as string | undefined;
      if (itemId) {
        const stillHasAccounts = (remaining ?? []).some(a => {
          const r = a as unknown as Record<string, unknown>;
          return r.item_id === itemId;
        });
        if (!stillHasAccounts) {
          // Calls Plaid's /item/remove server-side before dropping our row — deleting only
          // the local row leaks the Item on Plaid's side forever (it stays alive and counted
          // against the account's Item limit, with no way to find it again afterward).
          const { error: rmErr } = await supabase.functions.invoke("plaid-remove-item", { body: { itemId } });
          if (rmErr) throw rmErr;
        }
      }

      toast.success(`Removed ${account.name ?? "account"}`);
      setRemovingAccount(null);
      load();
    } catch (e: unknown) {
      toast.error("Failed to remove account", { description: (e as Error)?.message });
    } finally {
      setRemoveConfirming(false);
    }
  }, [user, load]);

  // ── Selective refresh — only reload the relevant slice of data ──
  const refreshAccounts = useCallback(async () => {
    if (!user) return;
    setRefreshingAccounts(true);
    const { data } = await supabase.from("plaid_accounts").select("*").eq("user_id", user.id).order("type");
    if (data) setAccounts(data as PAccount[]);
    // accountMeta auto-updates from settings
    setRefreshingAccounts(false);
  }, [user]);

  const refreshTxns = useCallback(async () => {
    if (!user) return;
    setRefreshingTxns(true);
    const threeMonthsAgo = (() => { const d = new Date(); d.setMonth(d.getMonth()-3); return d.toISOString().slice(0,10); })();
    const { data } = await supabase.from("plaid_transactions").select("*").eq("user_id", user.id).gte("date", threeMonthsAgo).order("date", { ascending: false });
    if (data) { setTxns(data as PTxn[]); setLastSyncedAt(new Date()); }
    setRefreshingTxns(false);
  }, [user]);

  useEffect(()=>{ load(); },[load]);
  useEffect(()=>{ loadInsights(); },[loadInsights]);
  useEffect(()=>{ if (syncTrigger>0) doSync(); },[syncTrigger, doSync]);
  useEffect(()=>{ setOpenPickerTxn(null); setEditingBudgetCat(null); },[view]);

  // ── Computed (before any early return) ────────────────────
  const manualAssets = manualAccounts.filter(a => a.role !== "debt").reduce((s,a)=>s+(Number(a.current_balance)||0),0);
  const manualLiab   = manualAccounts.filter(a => a.role === "debt").reduce((s,a)=>s+(Number(a.current_balance)||0),0);
  const assets      = accounts.filter(a=>!isDebt(a.type)).reduce((s,a)=>s+(Number(a.current_balance)||0),0) + manualAssets;
  const liabilities = accounts.filter(a=>isDebt(a.type)).reduce((s,a)=>s+(Number(a.current_balance)||0),0) + manualLiab;
  const netWorth    = assets-liabilities;
  const monthlyFlow = buildMonthlyFlow(txns);

  const animatedNW   = useCountUp(netWorth, 1200);
  const animatedAss  = useCountUp(assets, 1000);
  const animatedLiab = useCountUp(liabilities, 1000);

  const byBucket = (b:Bucket) => accounts.filter(a=>mapBucket(a.type,a.subtype)===b);

  // Detect internal transfers once — used to exclude them from all analysis
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const autoInternalIds = useMemo(() => detectInternalTransfers(txns), [txns]);

  // User-marked internal transfers — from Supabase settings
  const manualInternalIds = new Set<string>(settings.manualInternal ?? []);
  // Whitelist: user explicitly un-flagged an auto-detected transfer
  const manualExternalIds = new Set<string>(settings.manualExternal ?? []);

  const toggleManualInternal = (id: string) => {
    S.toggleManualInternal(id);
  };
  const internalTxnIds = useMemo(
    () => new Set([...autoInternalIds, ...smartResults.internalIds, ...manualInternalIds].filter(id => !manualExternalIds.has(id))),
    [autoInternalIds, smartResults, manualInternalIds, manualExternalIds]
  );

  // nwData must be computed after internalTxnIds so internal transfers are excluded from the chart
  const nwData   = buildNWByPeriod(netWorth, txns, period, internalTxnIds);
  const nwChange = nwData.length>1 ? nwData[nwData.length-1].v - nwData[0].v : 0;

  // Current-month spending aggregation (homepage + spending tab default)
  const now = new Date();
  const curMo = now.getMonth(); const curYr = now.getFullYear();
  const curMonthTxns = txns.filter(t=>{ const d=new Date(t.date+"T00:00:00"); return d.getMonth()===curMo&&d.getFullYear()===curYr; });
  const curMonthExpenses = curMonthTxns.filter(t=>
    !internalTxnIds.has(t.id) &&
    Number(t.amount)>0 &&
    !humanizeCategory(getEffectiveCategory(t,overrides,getRuleCategory),Number(t.amount)).toLowerCase().includes("transfer")
  );

  // Category aggregation for current month (homepage High Spending + spending tab)
  const spendMap: Record<string,{total:number;count:number;txns:PTxn[]}> = {};
  for (const t of curMonthExpenses) {
    const cat = getEffectiveCategory(t, overrides, getRuleCategory) ?? "Other";
    if (!spendMap[cat]) spendMap[cat]={total:0,count:0,txns:[]};
    spendMap[cat].total += Number(t.amount);
    spendMap[cat].count += 1;
    spendMap[cat].txns.push(t);
  }
  const spendByCategory = Object.entries(spendMap)
    .map(([category,{total,count,txns:catTxns}])=>({category,total,count,txns:catTxns}))
    .sort((a,b)=>b.total-a.total);
  const totalSpend = spendByCategory.reduce((s,c)=>s+c.total,0);
  const curMonthIncome = curMonthTxns.filter(t=>!internalTxnIds.has(t.id)&&Number(t.amount)<0).reduce((s,t)=>s+Math.abs(Number(t.amount)),0);

  // Period-filtered data for monthly/spending tabs
  const monthlyPeriodTxns = filterByPeriod(txns, monthlyPeriod);
  const monthlyIncome = monthlyPeriodTxns.filter(t=>!internalTxnIds.has(t.id)&&Number(t.amount)<0).reduce((s,t)=>s+Math.abs(Number(t.amount)),0);
  const monthlySpend  = monthlyPeriodTxns.filter(t=>!internalTxnIds.has(t.id)&&Number(t.amount)>0).reduce((s,t)=>s+Number(t.amount),0);

  // Spending-tab period filtered
  const spendingPeriodTxns = filterByPeriod(txns, spendingPeriod);
  const spendingPeriodExpenses = spendingPeriodTxns.filter(t=>
    !internalTxnIds.has(t.id) &&
    Number(t.amount)>0 &&
    !humanizeCategory(getEffectiveCategory(t,overrides,getRuleCategory),Number(t.amount)).toLowerCase().includes("transfer")
  );
  const spendingPeriodMap: Record<string,{total:number;count:number}> = {};
  for (const t of spendingPeriodExpenses) {
    const cat = getEffectiveCategory(t, overrides, getRuleCategory) ?? "Other";
    if (!spendingPeriodMap[cat]) spendingPeriodMap[cat]={total:0,count:0};
    spendingPeriodMap[cat].total += Number(t.amount);
    spendingPeriodMap[cat].count += 1;
  }
  const spendingPeriodByCategory = Object.entries(spendingPeriodMap)
    .map(([category,v])=>({category,...v}))
    .sort((a,b)=>b.total-a.total);
  const spendingPeriodTotal = spendingPeriodByCategory.reduce((s,c)=>s+c.total,0);
  const spendingPeriodIncome = spendingPeriodTxns
    .filter(t=>!internalTxnIds.has(t.id)&&Number(t.amount)<0)
    .reduce((s,t)=>s+Math.abs(Number(t.amount)),0);
  // Prior period spend for delta comparison
  const prevSpendingPeriodSpent = filterByPeriod(txns, {...spendingPeriod, offset: spendingPeriod.offset-1})
    .filter(t=>
      !internalTxnIds.has(t.id) && Number(t.amount)>0 &&
      !humanizeCategory(getEffectiveCategory(t,overrides,getRuleCategory),Number(t.amount)).toLowerCase().includes("transfer"))
    .reduce((s,t)=>s+Number(t.amount),0);
  const spendDeltaPct = prevSpendingPeriodSpent > 0
    ? Math.round(((spendingPeriodTotal - prevSpendingPeriodSpent) / prevSpendingPeriodSpent) * 100)
    : null;
  // Average spend per elapsed day in the period
  const spendingDailyAvg = (() => {
    const { start, end } = getPeriodRange(spendingPeriod);
    const now = new Date();
    const effectiveEnd = end < now ? end : now;
    const days = Math.max(1, Math.round((effectiveEnd.getTime() - start.getTime()) / 86400000) + 1);
    return spendingPeriodTotal / days;
  })();

  const allActions       = generateActions(accounts, txns, internalTxnIds, overrides, getRuleCategory, budgets, creditDetails);
  const visibleActions   = allActions.filter(a=>!dismissedActions.has(a.id));
  const visibleInsights  = aiInsights.filter(i=>!dismissedInsights.has(i.id));
  const spendTrends      = buildSpendTrends(txns, overrides, getRuleCategory, internalTxnIds);
  const recurringCharges = detectRecurring(txns, internalTxnIds, suppressRecurringMerchants, suppressRecurringCategories);

  // Filtered + sorted txns for the spending-tab explorer
  const acctById = useMemo(() => {
    const m: Record<string, PAccount> = {};
    for (const a of accounts) m[a.account_id] = a;
    return m;
  }, [accounts]);

  const filteredSpendingTxns = (() => {
    let base = spendingPeriodTxns;
    if (selectedCategory) base = base.filter(t=>(getEffectiveCategory(t,overrides,getRuleCategory)??"Other")===selectedCategory);
    if (txnFlowFilter === "expense") base = base.filter(t => Number(t.amount) > 0);
    if (txnFlowFilter === "income")  base = base.filter(t => Number(t.amount) < 0);
    if (hideInternal) base = base.filter(t => !internalTxnIds.has(t.id));
    if (chartDrillDate) base = base.filter(t => t.date === chartDrillDate);
    if (chartDrillMonth !== null) base = base.filter(t => new Date(t.date+"T00:00:00").getMonth() === chartDrillMonth);
    if (txnSearch.trim()) {
      const q = txnSearch.trim().toLowerCase();
      base = base.filter(t =>
        (nameOverrides[t.id] ?? t.merchant_name ?? "").toLowerCase().includes(q) ||
        (t.name ?? "").toLowerCase().includes(q) ||
        (getEffectiveCategory(t,overrides,getRuleCategory) ?? "").toLowerCase().includes(q)
      );
    }
    // Advanced condition set — shares the same evaluator as Smart Rules
    if (filterSet.conditions.some(c => (c.value ?? "").trim() !== "" || c.field === "pending")) {
      base = base.filter(t => {
        const amount = Number(t.amount) || 0;
        const acc = acctById[t.account_id];
        const evalTxn: EvalTxn = {
          amount, absAmount: Math.abs(amount),
          merchant: nameOverrides[t.id] ?? t.merchant_name ?? t.name ?? "",
          category: formatCat(getEffectiveCategory(t, overrides, getRuleCategory) ?? "Other"),
          accountId: t.account_id,
          accountName: acc?.name ?? "",
          accountType: acc?.type ?? "",
          date: t.date,
          flow: amount >= 0 ? "expense" : "income",
          pending: !!t.pending,
        };
        return evaluateSet(filterSet, evalTxn);
      });
    }
    const nameOf = (t: PTxn) => (nameOverrides[t.id] ?? t.merchant_name ?? t.name ?? "").toLowerCase();
    const catOf = (t: PTxn) => formatCat(getEffectiveCategory(t, overrides, getRuleCategory) ?? "Other").toLowerCase();
    const sorted = [...base];
    if (txnSort === "date-desc")   sorted.sort((a,b)=>b.date.localeCompare(a.date));
    if (txnSort === "date-asc")    sorted.sort((a,b)=>a.date.localeCompare(b.date));
    if (txnSort === "amount-desc") sorted.sort((a,b)=>Math.abs(Number(b.amount))-Math.abs(Number(a.amount)));
    if (txnSort === "amount-asc")  sorted.sort((a,b)=>Math.abs(Number(a.amount))-Math.abs(Number(b.amount)));
    if (txnSort === "name-asc")    sorted.sort((a,b)=>nameOf(a).localeCompare(nameOf(b)));
    if (txnSort === "name-desc")   sorted.sort((a,b)=>nameOf(b).localeCompare(nameOf(a)));
    if (txnSort === "category-asc") sorted.sort((a,b)=>catOf(a).localeCompare(catOf(b)));
    return sorted;
  })();

  // ── Tick thinning for dense charts ────────────────────────
  const nwTickEvery = { "1W":1,"1M":5,"3M":2,"1Y":1,"ALL":1 }[period];

  if (!demo && !guestDemo && user && !settingsLoaded) return (
    <div className="min-h-[40vh] grid place-items-center">
      <div className="flex items-center gap-2 text-muted-foreground text-[12px]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your settings…
      </div>
    </div>
  );
  if (loading) return <div className="min-h-[40vh] grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  // ── Period nav pill (reused in monthly + spending tabs) ──────
  const PeriodNav = ({ state, onChange, granularities = ["week","month","year"] }: { state: PeriodState; onChange: (s: PeriodState) => void; granularities?: PeriodGranularity[] }) => (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex rounded-full border border-border p-0.5 bg-surface/60">
        {granularities.map(g=>(
          <button key={g} onClick={()=>onChange({granularity:g,offset:0})}
            className={cn("px-3 py-1 rounded-full text-[11px] font-medium transition-all capitalize",
              state.granularity===g?"bg-foreground text-background":"text-muted-foreground hover:text-foreground")}>
            {g}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button onClick={()=>onChange({...state,offset:state.offset-1})}
          className="h-7 w-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-[12px] text-foreground font-medium min-w-[130px] text-center">{getPeriodLabel(state)}</span>
        <button onClick={()=>onChange({...state,offset:Math.min(0,state.offset+1)})}
          disabled={state.offset===0}
          className="h-7 w-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-30">
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );

  // ── OVERALL ───────────────────────────────────────────────
  if (view==="overall") return (
    <div className="space-y-3 animate-fade-up">

      {/* Net worth hero — left: numbers, right: chart */}
      <section className="surface-elevated relative overflow-hidden px-5 py-4 md:px-5 md:py-4">
        <div className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-positive/8 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-12 -left-12 h-32 w-32 rounded-full bg-[hsl(var(--primary)/0.06)] blur-3xl" />
        <div className="relative flex gap-4 items-stretch min-h-[100px] flex-col sm:flex-row">
          {/* Left — NW stats */}
          <div className="flex-1 min-w-0 flex flex-col justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Net Worth</div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <h2 className="font-display text-3xl md:text-4xl font-semibold leading-none tabular stat-gold animate-count-in">
                  {fmtUSD(animatedNW)}
                </h2>
                {nwChange!==0 && (
                  <span className={cn("chip !py-0.5 !px-1.5 !text-[10px] animate-pop-in", nwChange>=0?"chip-positive":"chip-negative")}>
                    <ArrowUpRight className={cn("h-2.5 w-2.5",nwChange<0&&"rotate-180")} />
                    {fmtUSD(Math.abs(nwChange),{compact:true})}
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-4 mt-2">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Assets</div>
                <div className="font-display text-base tabular text-positive">{fmtUSD(animatedAss,{compact:true})}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Liabilities</div>
                <div className="font-display text-base tabular text-negative">−{fmtUSD(animatedLiab,{compact:true})}</div>
              </div>
            </div>
            {/* Period selector */}
            <div className="flex items-center gap-0.5 mt-2.5 flex-wrap">
              {PERIODS.map(p=>(
                <button key={p} onClick={()=>setPeriod(p)}
                  className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium transition-all",
                    period===p?"bg-gold text-foreground":"text-muted-foreground hover:text-foreground hover:bg-secondary/60")}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          {/* Right — compact chart (hidden on small screens) */}
          <div className="hidden sm:block w-[45%] shrink-0 -mr-1 -my-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={nwData} margin={{top:4,right:4,bottom:4,left:4}}>
                <defs>
                  <linearGradient id="nw-live" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="m" axisLine={false} tickLine={false} tick={{fill:"hsl(var(--muted-foreground))",fontSize:8}} interval={nwTickEvery-1} />
                <YAxis hide domain={["dataMin - 1000","dataMax + 1000"]} />
                <Tooltip contentStyle={{background:"hsl(var(--card))",border:"1px solid var(--gold-border)",borderRadius:8,fontSize:11,padding:"6px 10px",boxShadow:"0 4px 20px rgba(0,0,0,0.3)"}}
                  labelStyle={{color:"hsl(var(--muted-foreground))",fontSize:9}}
                  formatter={(v:number)=>[fmtUSD(v),"Net worth"]} />
                <Area type="monotone" dataKey="v" stroke="hsl(var(--primary))" strokeWidth={1.5} fill="url(#nw-live)" dot={false} animationDuration={600} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* This month cash-flow strip */}
      {(totalSpend > 0 || curMonthIncome > 0) && (() => {
        const net = curMonthIncome - totalSpend;
        const savingsRate = curMonthIncome > 0 ? Math.round((net / curMonthIncome) * 100) : null;
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button type="button" onClick={()=>{
                setSpendingPeriod({granularity:"month",offset:0});setTxnFlowFilter("expense");setTxnLimit(150);
                onCategorySelect?.("__spending__");
              }}
              className="surface-card p-3 relative overflow-hidden text-left hover:border-border-strong transition-colors cursor-pointer">
              <div className="pointer-events-none absolute -top-4 -right-4 h-14 w-14 rounded-full bg-negative/8 blur-xl" />
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Spent this month</div>
              <div className="font-display text-lg tabular text-foreground mt-0.5">{fmtUSD(totalSpend)}</div>
              {spendTrends.length > 0 && (() => {
                const delta = spendTrends.reduce((s,c)=>s+c.delta,0);
                return delta !== 0 ? (
                  <div className={cn("text-[10px] tabular mt-0.5", delta > 0 ? "text-negative" : "text-positive")}>
                    {delta > 0 ? "+" : ""}{fmtUSD(Math.abs(delta))} vs last mo
                  </div>
                ) : null;
              })()}
            </button>
            <button type="button" onClick={()=>{
                setSpendingPeriod({granularity:"month",offset:0});setTxnFlowFilter("income");setTxnLimit(150);
                onCategorySelect?.("__spending__");
              }}
              className="surface-card p-3 relative overflow-hidden text-left hover:border-border-strong transition-colors cursor-pointer">
              <div className="pointer-events-none absolute -top-4 -right-4 h-14 w-14 rounded-full bg-positive/8 blur-xl" />
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Income this month</div>
              <div className="font-display text-lg tabular text-positive mt-0.5">{fmtUSD(curMonthIncome)}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">excl. transfers</div>
            </button>
            <button type="button" onClick={()=>{
                setSpendingPeriod({granularity:"month",offset:0});setTxnFlowFilter("all");setTxnLimit(150);
                onCategorySelect?.("__spending__");
              }}
              className="surface-card p-3 relative overflow-hidden text-left hover:border-border-strong transition-colors cursor-pointer">
              <div className="pointer-events-none absolute -top-4 -right-4 h-14 w-14 rounded-full bg-[hsl(var(--primary)/0.08)] blur-xl" />
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Net cash flow</div>
              <div className={cn("font-display text-lg tabular mt-0.5", net >= 0 ? "text-positive" : "text-negative")}>
                {net >= 0 ? "+" : "−"}{fmtUSD(Math.abs(net))}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">income − spend</div>
            </button>
            <button type="button" onClick={()=>{
                setSpendingPeriod({granularity:"month",offset:0});setTxnFlowFilter("all");setTxnLimit(150);
                onCategorySelect?.("__spending__");
              }}
              className="surface-card p-3 relative overflow-hidden text-left hover:border-border-strong transition-colors cursor-pointer">
              <div className="pointer-events-none absolute -top-4 -right-4 h-14 w-14 rounded-full bg-info/8 blur-xl" />
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Savings rate</div>
              <div className={cn("font-display text-lg tabular mt-0.5", savingsRate != null && savingsRate >= 20 ? "text-positive" : savingsRate != null && savingsRate < 0 ? "text-negative" : "text-foreground")}>
                {savingsRate != null ? `${savingsRate}%` : "n/a"}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{spendByCategory.length} categories</div>
            </button>
          </div>
        );
      })()}

      {/* Account detail right panel */}
      {detailAccount && (
        <AccountDetailPanel
          a={detailAccount}
          txns={txns.filter(t => t.account_id === detailAccount.account_id)}
          meta={accountMeta[detailAccount.id] ?? {}}
          credit={creditDetails.find(c => c.account_id === detailAccount.account_id)}
          instName={items.find(it => it.id === (detailAccount as unknown as Record<string,unknown>).item_id as string)?.institution_name ?? ""}
          instUrl={getInstitutionUrl(
            items.find(it => it.id === (detailAccount as unknown as Record<string,unknown>).item_id as string)?.institution_name ?? null,
            accountMeta[detailAccount.id]?.customUrl
          )}
          itemId={(detailAccount as unknown as Record<string,unknown>).item_id as string ?? null}
          onEdit={() => { setEditingAccount(detailAccount); setDetailAccount(null); }}
          onRemove={() => { setRemovingAccount(detailAccount); setDetailAccount(null); }}
          onClose={() => setDetailAccount(null)}
          onGranted={() => { load(); }}
        />
      )}

      {/* Account edit dialog */}
      {editingAccount && (
        <AccountEditDialog
          account={editingAccount}
          meta={accountMeta[editingAccount.id] ?? {}}
          instUrl={getInstitutionUrl(
            items.find(it => it.id === (editingAccount as unknown as Record<string,unknown>).item_id as string)?.institution_name ?? null,
            accountMeta[editingAccount.id]?.customUrl
          )}
          onSave={m => { saveMeta(editingAccount.id, m); }}
          onClose={() => setEditingAccount(null)}
        />
      )}

      {/* Remove account confirmation dialog */}
      <Dialog open={!!removingAccount} onOpenChange={o => { if (!o) setRemovingAccount(null); }}>
        <DialogContent className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden">
          <DialogTitle className="sr-only">Remove account</DialogTitle>
          <DialogDescription className="sr-only">Confirm removing this account and its transactions.</DialogDescription>
          {removingAccount && (
            <>
              <div className="p-6 pb-4">
                <div className="h-10 w-10 rounded-xl bg-negative/10 grid place-items-center mb-4">
                  <Unlink className="h-5 w-5 text-negative" />
                </div>
                <h3 className="font-display text-lg text-foreground">Remove {removingAccount.name ?? "account"}?</h3>
                <p className="mt-2 text-[12px] text-muted-foreground leading-relaxed">
                  This will delete the account and all its synced transactions from SentryFi.
                  Your actual bank account is not affected.
                </p>
                {removingAccount.mask && (
                  <div className="mt-3 surface-card p-3 flex items-center gap-2">
                    {(() => { const Icon = mapIcon(removingAccount.type, removingAccount.subtype); return <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />; })()}
                    <span className="text-[12px] text-foreground">{removingAccount.name}</span>
                    <span className="text-[11px] text-muted-foreground">··{removingAccount.mask}</span>
                  </div>
                )}
              </div>
              <div className="hairline p-4 flex gap-2">
                <button
                  onClick={() => doRemoveAccount(removingAccount)}
                  disabled={removeConfirming}
                  className="flex-1 h-10 rounded-lg bg-negative text-background text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {removeConfirming ? "Removing…" : "Yes, remove"}
                </button>
                <button
                  onClick={() => setRemovingAccount(null)}
                  disabled={removeConfirming}
                  className="h-10 px-4 rounded-lg border border-border-strong text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Insights — full width ── */}
      <div className="space-y-3 min-w-0">
      {/* ═══ Insights into your spending ═══════════════════════ */}
      {(visibleActions.length > 0 || visibleInsights.length > 0 || spendByCategory.length > 0 || recurringCharges.length > 0) && (
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="font-display text-lg md:text-xl text-primary">Insights into your spending</h2>
          </div>

          {/* Sortable 2-col panel grid — drag the ⠿ handle to reorder */}
          {(() => {
            const panelActionItems = (dragHandle: React.HTMLAttributes<HTMLElement>) => (
              <div className="surface-card overflow-hidden flex flex-col h-full">
                <div className="px-5 py-3 border-b border-border/30 flex items-center gap-2">
                  <button {...dragHandle} className="text-muted-foreground/30 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none shrink-0" title="Drag to reorder">
                    <GripVertical className="h-3.5 w-3.5" />
                  </button>
                  <h3 className="font-display text-[13px] text-primary flex-1">Action items</h3>
                  {visibleActions.length>0 && <span className="text-[10px] text-muted-foreground tabular">{visibleActions.length} open</span>}
                </div>
                {visibleActions.length===0 ? (
                  <div className="px-4 py-4 flex items-center gap-2 text-[12px] text-muted-foreground">
                    <Check className="h-4 w-4 text-positive shrink-0" />All caught up.
                  </div>
                ) : (
                  <div className="divide-y divide-border/20 max-h-[360px] overflow-y-auto">
                    {visibleActions.map(item=>{
                      const Icon=item.icon; const m=priorityMeta[item.priority];
                      const borderColor = item.priority==="urgent" ? "hsl(var(--negative))" : item.priority==="soon" ? "hsl(var(--warning))" : "hsl(var(--info))";
                      return (
                        <button key={item.id} onClick={()=>setOpenActionItem(item)}
                          className="group w-full px-5 py-4 text-left flex items-center gap-3 hover:bg-surface-hover/40 transition-colors"
                          style={{borderLeft:`3px solid ${borderColor}`}}>
                          <div className={cn("h-8 w-8 rounded-xl grid place-items-center shrink-0 transition-transform group-hover:scale-105",m.text)}
                            style={{background:`${borderColor}18`, border:`1px solid ${borderColor}30`}}>
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[13px] text-foreground font-medium truncate">{item.title}</span>
                              <span className={cn("text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border shrink-0",m.chip)}>{m.label}</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 truncate">{item.detail}</p>
                          </div>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );

            const panelSavingOpps = (dragHandle: React.HTMLAttributes<HTMLElement>) => (
              <div className="surface-card overflow-hidden flex flex-col h-full">
                <div className="px-5 py-3 border-b border-border/30 flex items-center gap-2">
                  <button {...dragHandle} className="text-muted-foreground/30 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none shrink-0" title="Drag to reorder">
                    <GripVertical className="h-3.5 w-3.5" />
                  </button>
                  <h3 className="font-display text-[13px] text-primary flex-1">Saving opportunities</h3>
                  {!insightsLoading && visibleInsights.length>0 && (
                    <span className="text-[10px] font-semibold text-positive tabular bg-positive/10 px-2 py-0.5 rounded-full">
                      +${visibleInsights.reduce((s,i)=>s+(i.impactValue??0),0).toLocaleString()}/yr
                    </span>
                  )}
                  <button onClick={()=>loadInsights(true)} disabled={insightsLoading}
                    title="Refresh AI suggestions"
                    className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-border/30 disabled:opacity-40 transition-colors shrink-0">
                    <RefreshCw className={cn("h-3.5 w-3.5", insightsLoading && "animate-spin")} />
                  </button>
                </div>
                {insightsLoading ? (
                  <div className="p-3 grid grid-cols-2 gap-2">
                    {[1,2,3,4].map(i=>(
                      <div key={i} className="shimmer rounded-xl p-3 space-y-2 border border-border/20">
                        <div className="h-7 w-7 rounded-lg bg-secondary/60"/>
                        <div className="h-3 bg-secondary/60 rounded w-4/5"/>
                        <div className="h-2 bg-secondary/40 rounded w-3/5"/>
                      </div>
                    ))}
                  </div>
                ) : visibleInsights.length===0 ? (
                  <div className="px-4 py-5 text-[12px] text-muted-foreground flex items-center gap-2">
                    <Sparkles className="h-4 w-4 shrink-0 opacity-40" />Tap the refresh icon above to generate insights.
                  </div>
                ) : (
                  <div className="p-3 grid grid-cols-1 gap-3">
                    {visibleInsights.slice(0,4).map(insight=>{
                      const CatIcon=insight.category==="Rewards"?Sparkles:insight.category==="Credit"?CreditCard:insight.category==="Subscriptions"?Coins:insight.category==="Savings"?Coins:TrendingUp;
                      const sevDot = insight.severity==="high" ? "bg-negative" : insight.severity==="medium" ? "bg-warning" : "bg-info";
                      return (
                        <button key={insight.id} onClick={()=>setOpenInsight(insight)}
                          className="group surface-card relative overflow-hidden p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-elevated)]">
                          <div className="flex items-start justify-between gap-3">
                            <div className="h-8 w-8 rounded-lg bg-secondary/60 grid place-items-center text-foreground/80">
                              <CatIcon className="h-4 w-4" />
                            </div>
                            <div className="flex items-center gap-1.5">
                              <div className={cn("h-1.5 w-1.5 rounded-full", sevDot)}>
                                <div className={cn("absolute h-1.5 w-1.5 rounded-full animate-pulse-glow", sevDot, "opacity-50 blur-sm")} />
                              </div>
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{insight.category}</span>
                            </div>
                          </div>

                          <h3 className="font-display text-[13px] font-medium mt-3 text-foreground leading-snug line-clamp-2">
                            {insight.title}
                          </h3>

                          <div className="mt-3 pt-3 border-t border-border/60 flex items-end justify-between">
                            <div>
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Opportunity</div>
                              <div className="font-display text-[12px] tabular text-positive leading-tight">{insight.impact}</div>
                            </div>
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground group-hover:text-foreground transition-colors">
                              Details <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );

            const panelTopSpending = (dragHandle: React.HTMLAttributes<HTMLElement>) => (
              <div className="surface-card overflow-hidden h-full">
                <div className="px-5 py-4 border-b border-border/30 flex items-center gap-2">
                  <button {...dragHandle} className="text-muted-foreground/30 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none shrink-0" title="Drag to reorder">
                    <GripVertical className="h-3.5 w-3.5" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display text-[13px] text-primary">Top Spending</h3>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{new Date().toLocaleDateString("en-US",{month:"long",year:"numeric"})} · {fmtUSD(totalSpend)}</div>
                  </div>
                  <button onClick={()=>onCategorySelect?.("__spending__")}
                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-lg border border-border/50 hover:border-border transition-colors shrink-0">
                    View all <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
                {spendByCategory.length === 0 ? (
                  <div className="px-4 py-6 text-[12px] text-muted-foreground text-center">No spending data.</div>
                ) : (
                  <div className="divide-y divide-border/20">
                    {spendByCategory.slice(0,5).map(c=>{
                      const Icon=categoryIcon(c.category); const color=catColor(c.category);
                      const budget=budgets[c.category]; const pct=budget?(c.total/budget)*100:0;
                      const over=budget&&c.total>budget; const near=budget&&!over&&pct>=70;
                      const trend=spendTrends.find(t=>t.category===c.category);
                      const topTxns=[...c.txns].sort((a,b)=>Number(b.amount)-Number(a.amount));
                      const sharePct = totalSpend > 0 ? (c.total / totalSpend) * 100 : 0;
                      return (
                        <button key={c.category} onClick={()=>{setSpendingPopup(c.category);setSpendPopupLimit(5);}}
                          className="group relative w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-surface-hover/40 transition-colors overflow-hidden">
                          <div className="pointer-events-none absolute inset-y-0 left-0" style={{width:`${sharePct}%`, background:`${color}09`}} />
                          <div className="relative h-8 w-8 rounded-xl grid place-items-center shrink-0 transition-transform group-hover:scale-105"
                            style={{backgroundColor:`${color}1f`,color}}>
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <div className="relative flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[12.5px] text-foreground font-medium truncate">{formatCat(c.category)}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                {trend?.pct!=null&&trend.pct!==0&&(
                                  <span className={cn("text-[10px] tabular px-1.5 py-0.5 rounded-full font-medium",
                                    trend.delta>0?"bg-negative/10 text-negative":"bg-positive/10 text-positive")}>
                                    {trend.delta>0?"+":""}{trend.pct}%
                                  </span>
                                )}
                                <span className="text-[13px] tabular font-semibold">{fmtUSD(c.total)}</span>
                              </div>
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                              {topTxns[0] ? `${nameOverrides[topTxns[0].id]??topTxns[0].merchant_name??topTxns[0].name??"Unknown"} · ${fmtUSD(Number(topTxns[0].amount))}` : `${c.count} transactions`}
                            </div>
                            {!!budget && (
                              <div className="mt-1.5 h-0.5 rounded-full bg-border/40 overflow-hidden">
                                <div className="h-full rounded-full" style={{width:`${Math.min(pct,100)}%`,backgroundColor:over?"hsl(var(--negative))":near?"hsl(var(--warning))":color}}/>
                              </div>
                            )}
                          </div>
                          <ChevronRight className="relative h-3.5 w-3.5 text-muted-foreground/30 shrink-0 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );

            const panelUpcomingCharges = (dragHandle: React.HTMLAttributes<HTMLElement>) => (
              <div className="surface-card overflow-hidden h-full">
                <div className="px-5 py-3 border-b border-border/30 flex items-center gap-2">
                  <button {...dragHandle} className="text-muted-foreground/30 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none shrink-0" title="Drag to reorder">
                    <GripVertical className="h-3.5 w-3.5" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display text-[13px] text-primary">Upcoming Charges</h3>
                    <div className="flex items-center gap-2">
                      <div className="text-[10px] text-muted-foreground">
                        Next 60 days · {recurringCharges.length} recurring
                        {recurringCharges.length > 0 && <> · <span className="tabular text-foreground font-medium">{fmtUSD(recurringCharges.reduce((s,r)=>s+r.avgAmount,0))}</span></>}
                      </div>
                      {suppressRecurringMerchants.size > 0 && (
                        <button onClick={restoreAllRecurring} className="text-[10px] text-muted-foreground/50 hover:text-[hsl(var(--primary))] transition-colors">
                          {suppressRecurringMerchants.size} hidden · restore
                        </button>
                      )}
                    </div>
                  </div>
                  <button onClick={refreshTxns} disabled={refreshingTxns}
                    className="h-6 w-6 grid place-items-center rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 shrink-0">
                    <RefreshCw className={cn("h-3 w-3", refreshingTxns && "animate-spin")} />
                  </button>
                </div>
                {recurringCharges.length === 0 ? (
                  <div className="px-4 py-6 text-[12px] text-muted-foreground text-center">No upcoming charges detected.</div>
                ) : (
                  <div className="divide-y divide-border/20 max-h-[360px] overflow-y-auto">
                    {recurringCharges.map((r, idx) => {
                      const daysAway = Math.ceil((r.predictedDate.getTime() - Date.now()) / 86400000);
                      const isThisWeek = daysAway <= 7;
                      const sourceAcc = accounts.find(a => a.account_id === r.accountId);
                      const isDebtAcc = sourceAcc ? isDebt(sourceAcc.type) : false;
                      const availBal = sourceAcc ? (Number(sourceAcc.available_balance) || Number(sourceAcc.current_balance) || 0) : null;
                      const showBalCheck = !isDebtAcc && availBal !== null;
                      const hasSufficient = availBal !== null && availBal >= r.avgAmount;
                      return (
                        <div key={idx} className="group flex items-center gap-3 px-5 py-3">
                          <div className={cn("shrink-0 w-9 text-center rounded-lg py-1 border",
                            daysAway<=3?"bg-negative/10 border-negative/20":isThisWeek?"bg-warning/10 border-warning/20":"bg-secondary/50 border-border/40")}>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground leading-none">
                              {r.predictedDate.toLocaleDateString("en-US",{month:"short"})}
                            </div>
                            <div className={cn("text-[14px] font-bold tabular leading-tight",
                              daysAway<=3?"text-negative":isThisWeek?"text-warning":"text-foreground")}>
                              {r.predictedDate.getDate()}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[12px] text-foreground font-medium truncate">{r.merchant}</span>
                              {daysAway<=1 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-negative/30 bg-negative/10 text-negative shrink-0 font-medium">
                                  {daysAway===0?"Today":"Tomorrow"}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              <span className="text-[10.5px] text-muted-foreground/60">{r.intervalLabel}</span>
                              {sourceAcc && <><span className="text-muted-foreground/30">·</span>
                                <span className="text-[10.5px] text-muted-foreground truncate">
                                  {sourceAcc.name??""}{sourceAcc.mask?` ··${sourceAcc.mask}`:""}
                                </span></>}
                              {showBalCheck && !hasSufficient && (
                                <><span className="text-muted-foreground/30">·</span>
                                <span className="text-[10.5px] text-negative flex items-center gap-0.5">
                                  <AlertTriangle className="h-2.5 w-2.5" />Low funds
                                </span></>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[13px] tabular font-semibold text-foreground">{fmtUSD(r.avgAmount)}</div>
                            {daysAway>1 && <div className="text-[10px] text-muted-foreground tabular">{daysAway}d</div>}
                          </div>
                          <div className="relative shrink-0">
                            <button onClick={()=>setRecurringMenuFor(m=>m===r.merchantKey?null:r.merchantKey)} title="Remove from recurring list"
                              className={cn("h-6 w-6 grid place-items-center rounded text-muted-foreground/50 hover:text-negative hover:bg-negative/10 transition-all",
                                recurringMenuFor===r.merchantKey ? "opacity-100 text-negative bg-negative/10" : "opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100")}>
                              <X className="h-3 w-3" />
                            </button>
                            {recurringMenuFor===r.merchantKey && (()=>{
                              const doDismiss = (reason: string, suppressCategory=false) => {
                                dismissRecurringWithReason({ merchant: r.merchantKey, category: r.category || undefined, reason, suppressCategory, at: new Date().toISOString() });
                                setRecurringMenuFor(null);
                                toast.success("Removed from upcoming", { description: suppressCategory && r.category ? `Similar ${formatCat(r.category)} charges will stay hidden.` : `"${r.merchant}" won't be predicted again.` });
                              };
                              return (
                                <>
                                  <button className="fixed inset-0 z-[60]" onClick={()=>setRecurringMenuFor(null)} />
                                  <div className="absolute right-0 top-7 z-[61] w-52 rounded-xl border border-border/60 bg-card shadow-2xl overflow-hidden py-1">
                                    <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">Why remove this?</div>
                                    {[
                                      { label: "Not a recurring charge", reason: "not_recurring" },
                                      { label: "I cancelled it", reason: "cancelled" },
                                      { label: "Wrong prediction", reason: "wrong_prediction" },
                                    ].map(opt=>(
                                      <button key={opt.reason} onClick={()=>doDismiss(opt.reason)}
                                        className="w-full text-left px-3 py-2 text-[12px] text-foreground hover:bg-surface-hover/50 transition-colors">
                                        {opt.label}
                                      </button>
                                    ))}
                                    {r.category && (
                                      <button onClick={()=>doDismiss("hide_category", true)}
                                        className="w-full text-left px-3 py-2 text-[12px] text-foreground hover:bg-surface-hover/50 transition-colors border-t border-border/20">
                                        Hide all {formatCat(r.category)} charges
                                      </button>
                                    )}
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );

            const renderPanel = (id: string, dragHandle: React.HTMLAttributes<HTMLElement>) => {
              if (id === "action-items") return panelActionItems(dragHandle);
              if (id === "saving-opps") return panelSavingOpps(dragHandle);
              if (id === "top-spending") return panelTopSpending(dragHandle);
              if (id === "upcoming-charges") return panelUpcomingCharges(dragHandle);
              return null;
            };

            return (
              <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handlePanelDragEnd}>
                <SortableContext items={panelOrder} strategy={rectSortingStrategy}>
                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-2.5 items-stretch">
                    {panelOrder.map(id => (
                      <SortableCard key={id} id={id}>
                        {(handleProps) => renderPanel(id, handleProps)}
                      </SortableCard>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            );
          })()}
        </section>
      )}

      </div>{/* end insights */}

      {/* ── Accounts — full-width section below insights ── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3 px-1 flex-wrap">
          <div className="flex items-baseline gap-2">
            <h2 className="font-display text-base text-primary">Accounts</h2>
            {lastSyncedAt && (
              <span className="text-[10px] text-muted-foreground/50">
                synced {lastSyncedAt.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}
              </span>
            )}
          </div>
          <button onClick={onAddAccount} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 shrink-0">
            <Plus className="h-3 w-3" />Add account
          </button>
        </div>
        {accounts.length === 0 ? (
          <div className="surface-card p-6 text-center text-[12px] text-muted-foreground">
            No accounts yet. <button onClick={onAddAccount} className="text-gold underline">Link a bank</button>.
          </div>
        ) : (
          <div className="space-y-3">
            {/* Composition infographic — assets vs debt at a glance */}
            {(() => {
              const buckets = bucketOrder.map(b => {
                const accs = accounts.filter(a => mapBucket(a.type, a.subtype) === b);
                const total = accs.reduce((s,a) => s + Math.abs(Number(a.current_balance)||0), 0);
                return { bucket: b, total, count: accs.length,
                  color: b==="cash"?"hsl(var(--positive))":b==="credit"?"hsl(var(--warning))":b==="loan"?"hsl(var(--negative))":b==="investment"?"hsl(var(--info))":"hsl(var(--muted-foreground))" };
              }).filter(x => x.count > 0 && x.total > 0);
              const grand = buckets.reduce((s,x)=>s+x.total,0) || 1;
              if (buckets.length === 0) return null;
              return (
                <div className="surface-card p-4 space-y-3">
                  <div className="flex h-3 rounded-full overflow-hidden bg-border/20">
                    {buckets.map(x => (
                      <div key={x.bucket} style={{ width: `${(x.total/grand)*100}%`, backgroundColor: x.color }}
                        className="h-full transition-all" title={`${bucketMeta[x.bucket].label}: ${fmtUSD(x.total)}`} />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {buckets.map(x => (
                      <div key={x.bucket} className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: x.color }} />
                        <span className="text-[11px] text-muted-foreground">{bucketMeta[x.bucket].label}</span>
                        <span className="text-[11px] font-semibold text-foreground tabular">{fmtUSD(x.total,{compact:true})}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            {/* Masonry columns so expanded/collapsed cards of different heights
                pack tightly and fill the row instead of leaving gaps. */}
            <div className="columns-1 md:columns-2 xl:columns-3 gap-2 [column-fill:balance]">
              {bucketOrder
                .filter(bucket => accounts.some(a => mapBucket(a.type, a.subtype) === bucket))
                .map(bucket => (
                  <div key={bucket} className="break-inside-avoid mb-2">
                    <BucketGroup
                      bucket={bucket}
                      accounts={accounts.filter(a => mapBucket(a.type, a.subtype) === bucket)}
                      txns={txns}
                      accountMeta={accountMeta}
                      creditDetails={creditDetails}
                      items={items}
                      onSelect={a => setDetailAccount(a)}
                      defaultOpen
                    />
                  </div>
                ))}
            </div>
            <button
              onClick={onAddAccount}
              className="w-full surface-card border-dashed py-3 inline-flex items-center justify-center gap-2 text-[12px] text-muted-foreground hover:text-foreground hover:border-border-strong transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Link a bank, card, loan or brokerage via Plaid
            </button>
          </div>
        )}

        {/* Manual accounts */}
        {manualAccounts.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground px-1">Manually added</div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {manualAccounts.map(acct => {
                const isLoan = ["mortgage","auto_loan","student_loan","personal_loan","credit_card"].includes(acct.type);
                const equity = acct.property_value && acct.current_balance
                  ? acct.property_value - acct.current_balance : null;
                return (
                  <div key={acct.id} className="surface-card p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-foreground truncate">{acct.name}</div>
                        {acct.institution_name && (
                          <div className="text-[11px] text-muted-foreground truncate">{acct.institution_name}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {onEditManual && (
                          <button onClick={() => onEditManual(acct)}
                            className="h-6 w-6 rounded grid place-items-center text-muted-foreground hover:text-foreground">
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                        )}
                        {onDeleteManual && (
                          <button onClick={() => onDeleteManual(acct.id)}
                            className="h-6 w-6 rounded grid place-items-center text-muted-foreground hover:text-negative">
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <div>
                        <div className="text-[10px] text-muted-foreground">{isLoan ? "Balance owed" : "Balance"}</div>
                        <div className={`text-[17px] font-bold ${isLoan ? "text-negative/80" : "text-foreground"}`}>
                          {isLoan ? "-" : ""}${(acct.current_balance ?? 0).toLocaleString()}
                        </div>
                      </div>
                      {equity !== null && (
                        <div className="text-right">
                          <div className="text-[10px] text-muted-foreground">Equity</div>
                          <div className="text-[14px] font-semibold text-positive">${equity.toLocaleString()}</div>
                        </div>
                      )}
                    </div>
                    {acct.interest_rate && (
                      <div className="text-[11px] text-muted-foreground">
                        {acct.interest_rate}% rate
                        {acct.monthly_payment ? ` · $${acct.monthly_payment.toLocaleString()}/mo` : ""}
                      </div>
                    )}
                    {acct.property_address && (
                      <div className="text-[11px] text-muted-foreground truncate">{acct.property_address}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* ── Insight detail dialog (centered, matches demo) ── */}
      <Dialog open={!!openInsight} onOpenChange={(o) => { if (!o) setOpenInsight(null); }}>
        <DialogContent className="max-w-lg surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col">
          <DialogTitle className="sr-only">{openInsight?.title ?? "Insight"}</DialogTitle>
          <DialogDescription className="sr-only">Financial insight details and recommended action.</DialogDescription>
          {openInsight && (()=>{
            const haystack = `${openInsight.title} ${openInsight.what} ${openInsight.action}`.toLowerCase();
            // Try to find a matching spending category for richer context
            const relatedCat = spendByCategory.find(c => haystack.includes(formatCat(c.category).toLowerCase()));
            const relatedCatColor = relatedCat ? catColor(relatedCat.category) : null;
            const RelatedCatIcon = relatedCat ? categoryIcon(relatedCat.category) : null;
            const relatedTopTxns = relatedCat ? [...relatedCat.txns].sort((a,b)=>Number(b.amount)-Number(a.amount)).slice(0,3) : [];
            // Try to find a matching account (cards, savings, checking) mentioned in the text
            const relatedAcc = accounts.find(a => {
              const n = (a.name ?? "").trim();
              return n.length > 3 && haystack.includes(n.toLowerCase());
            });
            const monthlyEquivalent = openInsight.impactValue > 0 ? openInsight.impactValue / 12 : 0;
            return (
            <>
              <div className="relative p-6 pb-4 shrink-0">
                <button onClick={() => setOpenInsight(null)}
                  className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
                  <X className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-lg bg-secondary/60 grid place-items-center">
                    {openInsight.category==="Rewards"?<Sparkles className="h-4 w-4 text-foreground"/>:
                     openInsight.category==="0% APR"?<CreditCard className="h-4 w-4 text-foreground"/>:
                     openInsight.category==="Idle Cash"?<Coins className="h-4 w-4 text-foreground"/>:
                     <TrendingUp className="h-4 w-4 text-foreground"/>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("chip !py-0.5 !px-2 !text-[10px]",
                      openInsight.severity==="high"?"chip-negative":openInsight.severity==="medium"?"chip-warning":"chip")}>
                      <span className={cn("h-1.5 w-1.5 rounded-full inline-block mr-1",
                        openInsight.severity==="high"?"bg-negative":openInsight.severity==="medium"?"bg-warning":"bg-info")}/>
                      {openInsight.severity==="high"?"High":openInsight.severity==="medium"?"Medium":"Low"} impact
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{openInsight.category}</span>
                  </div>
                </div>
                <h3 className="font-display text-xl mt-4 text-foreground leading-snug">{openInsight.title}</h3>
                <div className="mt-4 flex items-center gap-2 flex-wrap">
                  <div className="inline-flex items-baseline gap-2 rounded-lg bg-positive/10 border border-positive/20 px-3 py-2">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Estimated yearly</span>
                    <span className="font-display text-lg tabular text-positive">{openInsight.impact}</span>
                  </div>
                  {monthlyEquivalent > 0 && (
                    <div className="inline-flex items-baseline gap-1.5 rounded-lg bg-secondary/40 border border-border/40 px-3 py-2">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">≈ per month</span>
                      <span className="font-display text-[13px] tabular text-foreground">{fmtUSD(monthlyEquivalent)}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="hairline p-6 space-y-4 flex-1 overflow-y-auto min-h-0">
                {([["What's happening", openInsight.what, false],["Why it matters", openInsight.why, false],["Suggested action", openInsight.action, true]] as [string,string,boolean][]).map(([label,body,accent])=>(
                  <div key={label}>
                    <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-1">{label}</div>
                    <p className={cn("text-sm leading-relaxed", accent?"text-foreground":"text-muted-foreground")}>{body}</p>
                  </div>
                ))}

                {/* Related category breakdown — grounds the insight in real numbers */}
                {relatedCat && RelatedCatIcon && (
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-2">Related spending this month</div>
                    <button onClick={()=>{setOpenInsight(null);setSpendingPopup(relatedCat.category);setSpendPopupLimit(5);}}
                      className="w-full surface-card p-3 flex items-center gap-3 hover:bg-surface-hover/40 transition-colors text-left">
                      <div className="h-8 w-8 rounded-lg grid place-items-center shrink-0" style={{backgroundColor:`${relatedCatColor}1f`,color:relatedCatColor as string}}>
                        <RelatedCatIcon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] text-foreground font-medium">{formatCat(relatedCat.category)}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{relatedCat.count} transaction{relatedCat.count!==1?"s":""} this month</div>
                      </div>
                      <span className="text-[14px] tabular font-semibold text-foreground shrink-0">{fmtUSD(relatedCat.total)}</span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                    </button>
                    {relatedTopTxns.length > 0 && (
                      <div className="mt-2 surface-card overflow-hidden divide-y divide-border/20">
                        {relatedTopTxns.map(t=>(
                          <div key={t.id} className="flex items-center gap-2.5 px-3 py-2">
                            <Receipt className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-[11.5px] text-foreground truncate">{nameOverrides[t.id]??t.merchant_name??t.name??"Transaction"}</div>
                              <div className="text-[10.5px] text-muted-foreground">{new Date(t.date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                            </div>
                            <span className="text-[11.5px] tabular font-medium text-foreground shrink-0">{fmtUSD(Number(t.amount),{cents:true})}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Related account — grounds card/savings insights in the actual account */}
                {relatedAcc && (
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-2">Related account</div>
                    <button onClick={()=>{setOpenInsight(null);setDetailAccount(relatedAcc);}}
                      className="w-full surface-card p-3 flex items-center gap-3 hover:bg-surface-hover/40 transition-colors text-left">
                      {(()=>{ const AccIcon=mapIcon(relatedAcc.type,relatedAcc.subtype); return (
                        <div className="h-8 w-8 rounded-lg grid place-items-center bg-secondary/50 border border-border/50 text-gold shrink-0">
                          <AccIcon className="h-4 w-4" />
                        </div>
                      ); })()}
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] text-foreground font-medium truncate">{relatedAcc.name}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{relatedAcc.mask?`··${relatedAcc.mask}`:smartSubtypeLabel(relatedAcc, getInstNameFor(relatedAcc, items), accountMeta[relatedAcc.id]?.apr)}</div>
                      </div>
                      <span className={cn("text-[14px] tabular font-semibold shrink-0",isDebt(relatedAcc.type)?"text-negative":"text-foreground")}>
                        {isDebt(relatedAcc.type)?"−":""}{fmtUSD(Math.abs(Number(relatedAcc.current_balance)||0))}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                    </button>
                  </div>
                )}
              </div>
              <div className="hairline p-4 flex flex-wrap gap-2 shrink-0">
                <button onClick={() => setOpenInsight(null)}
                  className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 rounded-lg bg-positive px-4 py-2 text-xs font-medium text-positive-foreground hover:opacity-90 transition-opacity">
                  <Check className="h-3.5 w-3.5" /> Got it
                </button>
                <button onClick={() => { dismissInsight(openInsight.id); setOpenInsight(null); }}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-strong px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                  <X className="h-3.5 w-3.5" /> Dismiss
                </button>
              </div>
            </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {detailTxn && <TxnDetailModal txn={detailTxn} overrides={overrides} getRuleCategory={getRuleCategory} nameOverride={nameOverrides[detailTxn.id]} nameRules={nameRules} customCategories={customCategories} allTxns={txns} initialCatOpen={detailTxnOpenCat} onClose={()=>{setDetailTxn(null);setDetailTxnOpenCat(false);}} onSaveNameOverride={setNameOverride} onBulkRename={bulkSetNameOverride} onSaveNameRule={saveNameRule} onAddCategory={addCategory} onAddRule={addRule} onRemoveCustom={removeCategory} onSelect={(id,cat)=>setOverride(id,cat)} onToggleInternal={toggleManualInternal} isManualInternal={manualInternalIds.has(detailTxn.id)} isAutoInternal={autoInternalIds.has(detailTxn.id)} isManualExternal={manualExternalIds.has(detailTxn.id)} accounts={accounts} items={items} onFindSimilar={(pattern) => { setTxnSearch(pattern); setView("spending"); }} />}

      {/* ── Action item detail dialog (centered, matches demo) ── */}
      <Dialog open={!!openActionItem} onOpenChange={(o) => { if (!o) setOpenActionItem(null); }}>
        <DialogContent className="max-w-lg surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col">
          <DialogTitle className="sr-only">{openActionItem?.title ?? "Action item"}</DialogTitle>
          <DialogDescription className="sr-only">Action item details.</DialogDescription>
          {openActionItem && (()=>{
            const Icon=openActionItem.icon; const m=priorityMeta[openActionItem.priority];
            const relatedAcc = accounts.find(a=>(a.name??'').length>3 && (openActionItem.detail+openActionItem.title).toLowerCase().includes((a.name??'').toLowerCase()));
            const relAccTxns = relatedAcc ? txns.filter(t=>t.account_id===relatedAcc.account_id).slice(0,5) : [];
            // Find institution URL for transfer link
            const relatedItem = relatedAcc ? items.find(it => it.id === (relatedAcc as any).item_id) : null;
            const actionInstUrl = relatedItem
              ? getInstitutionUrl(relatedItem.institution_name, accountMeta[relatedAcc!.id]?.customUrl)
              : null;
            const isTransferAction = openActionItem.id.includes("transfer") || openActionItem.cta.toLowerCase().includes("transfer") || openActionItem.id.includes("low-checking");
            const isPaymentAction = openActionItem.id.startsWith("cc-") || openActionItem.cta.toLowerCase().includes("payment");
            return (
              <>
                <div className="relative p-6 pb-4 shrink-0">
                  <button onClick={()=>setOpenActionItem(null)}
                    className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                  <div className="flex items-center gap-2 mb-4">
                    <div className={cn("h-9 w-9 rounded-lg bg-secondary/60 grid place-items-center", m.text)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className={cn("chip !py-0.5 !px-2 !text-[10px]", m.chip)}>
                      <span className={cn("h-1.5 w-1.5 rounded-full inline-block mr-1", m.dot)}/>{m.label}
                    </span>
                  </div>
                  <h3 className="font-display text-xl text-foreground leading-snug">{openActionItem.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{openActionItem.detail}</p>
                </div>
                <div className="flex-1 overflow-y-auto min-h-0">
                {relatedAcc && (
                  <div className="hairline px-6 py-4">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Related account</div>
                    <div className="surface-card p-3 flex items-center gap-3">
                      {(()=>{ const AccIcon=mapIcon(relatedAcc.type,relatedAcc.subtype); return (
                        <div className="h-8 w-8 rounded-lg grid place-items-center bg-secondary/50 border border-border/50 text-gold shrink-0">
                          <AccIcon className="h-4 w-4" />
                        </div>
                      ); })()}
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-foreground">{relatedAcc.name}</div>
                        <div className="text-[10.5px] text-muted-foreground capitalize">{relatedAcc.subtype?.replace(/_/g," ")??""}{relatedAcc.mask?` ··${relatedAcc.mask}`:""}</div>
                      </div>
                      <div className={cn("text-[14px] font-medium tabular shrink-0",isDebt(relatedAcc.type)?"text-negative":"text-foreground")}>
                        {isDebt(relatedAcc.type)?"−":""}{fmtUSD(Math.abs(Number(relatedAcc.current_balance)||0))}
                      </div>
                    </div>
                  </div>
                )}
                {relAccTxns.length>0 && (
                  <div className="hairline px-6 py-4">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Recent activity</div>
                    <div className="surface-card overflow-hidden divide-y divide-border/20">
                      {relAccTxns.map(t=>{
                        const isInc=Number(t.amount)<0;
                        return (
                          <div key={t.id} className="flex items-center gap-2.5 px-3 py-2">
                            <div className={cn("h-5 w-5 rounded grid place-items-center shrink-0",isInc?"bg-positive/10 text-positive":"bg-secondary/50 text-muted-foreground")}>
                              {isInc?<ArrowDownLeft className="h-3 w-3"/>:<ArrowUpRight className="h-3 w-3"/>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[12px] text-foreground truncate">{nameOverrides[t.id]??t.merchant_name??t.name??"Transaction"}</div>
                              <div className="text-[10px] text-muted-foreground">{new Date(t.date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                            </div>
                            <span className={cn("text-[12px] tabular font-medium shrink-0",isInc?"text-positive":"text-foreground")}>
                              {isInc?"+":"−"}{fmtUSD(Math.abs(Number(t.amount)),{cents:true})}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                </div>
                <div className="hairline p-4 flex flex-wrap gap-2 shrink-0">
                  {/* Primary CTA — context-aware */}
                  {openActionItem.reviewCategory ? (
                    // "Review" / "Review spending" → open spending popup for that category
                    <button onClick={()=>{setOpenActionItem(null);setSpendingPopup(openActionItem.reviewCategory!);setSpendPopupLimit(5);}}
                      className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 rounded-lg bg-positive px-4 py-2 text-xs font-medium text-positive-foreground hover:opacity-90 transition-opacity">
                      <ArrowRight className="h-3.5 w-3.5" /> {openActionItem.cta}
                    </button>
                  ) : (isTransferAction || isPaymentAction) && actionInstUrl ? (
                    // Transfer/Payment → open bank website
                    <a href={actionInstUrl} target="_blank" rel="noopener noreferrer"
                      className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 rounded-lg bg-gold px-4 py-2 text-xs font-medium hover:opacity-90 transition-opacity">
                      <ExternalLink className="h-3.5 w-3.5" />
                      {isTransferAction ? "Transfer at bank" : "Pay at bank"}
                    </a>
                  ) : openActionItem.id === "pending" ? (
                    // "View all" → close popup (user can navigate to transactions tab)
                    <button onClick={()=>{setOpenActionItem(null);onCategorySelect?.("");}}
                      className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 rounded-lg bg-positive px-4 py-2 text-xs font-medium text-positive-foreground hover:opacity-90 transition-opacity">
                      <ArrowRight className="h-3.5 w-3.5" /> {openActionItem.cta}
                    </button>
                  ) : (
                    <button onClick={()=>setOpenActionItem(null)}
                      className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 rounded-lg bg-positive px-4 py-2 text-xs font-medium text-positive-foreground hover:opacity-90 transition-opacity">
                      <ArrowRight className="h-3.5 w-3.5" /> {openActionItem.cta}
                    </button>
                  )}
                  <button onClick={()=>{dismissAction(openActionItem.id);setOpenActionItem(null);}}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-strong px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                    <X className="h-3.5 w-3.5" /> Dismiss
                  </button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ── Spending category popup (top 5 → 10 → all → spending tab) ── */}
      {spendingPopup && (()=>{
        const cat=spendingPopup; const color=catColor(cat); const Icon=categoryIcon(cat);
        const catEntry = spendByCategory.find(c=>c.category===cat);
        const catTxns = catEntry ? [...catEntry.txns].sort((a,b)=>Number(b.amount)-Number(a.amount)) : [];
        const total=catTxns.reduce((s,t)=>s+Number(t.amount),0);
        const avgTxn=catTxns.length>0?total/catTxns.length:0;
        const trend=spendTrends.find(t=>t.category===cat);
        const budget=budgets[cat]; const pct=budget?(total/budget)*100:0;
        const displayCount = spendPopupLimit==="all" ? catTxns.length : spendPopupLimit;
        const shownTxns = catTxns.slice(0, displayCount);
        return (
          <Dialog open onOpenChange={(o)=>{ if(!o){setSpendingPopup(null);setSpendPopupLimit(5);} }}>
            <DialogContent className="max-w-lg surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col">
              <DialogTitle className="sr-only">{formatCat(cat)}: current month</DialogTitle>
              <DialogDescription className="sr-only">Top charges in {formatCat(cat)} this month.</DialogDescription>
              <div className="relative p-5 pb-4 shrink-0">
                <button onClick={()=>{setSpendingPopup(null);setSpendPopupLimit(5);}}
                  className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
                  <X className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg grid place-items-center shrink-0" style={{backgroundColor:`${color}1f`,color}}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg text-foreground">{formatCat(cat)}</h3>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{new Date().toLocaleDateString("en-US",{month:"long",year:"numeric"})}</div>
                  </div>
                </div>
              </div>
              <div className="hairline px-5 py-3 space-y-3 flex-1 overflow-y-auto min-h-0">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    {label:"Total",value:fmtUSD(total),color},
                    {label:"vs last mo",value:trend?.pct!=null?`${trend.delta>0?"+":""}${trend.pct}%`:"n/a",color:trend?.delta!=null?(trend.delta>0?"hsl(var(--negative))":"hsl(var(--positive))"):"hsl(var(--muted-foreground))"},
                    {label:"Avg charge",value:fmtUSD(avgTxn),color:"hsl(var(--foreground))"},
                  ].map(s=>(
                    <div key={s.label} className="surface-card p-2.5 text-center">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
                      <div className="font-display text-base mt-0.5 tabular" style={{color:s.color}}>{s.value}</div>
                    </div>
                  ))}
                </div>
                {!!budget && (
                  <div className="surface-card p-3 space-y-1.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">Monthly budget</span>
                      <span className={cn("font-medium tabular",pct>100?"text-negative":pct>80?"text-warning":"text-foreground")}>{fmtUSD(total)} / {fmtUSD(budget)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{width:`${Math.min(pct,100)}%`,backgroundColor:pct>100?"hsl(var(--negative))":pct>80?"hsl(var(--warning))":color}}/>
                    </div>
                  </div>
                )}
                {catTxns.length>0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                      Top charges, highest to lowest ({shownTxns.length} of {catTxns.length})
                    </div>
                    <div className="surface-card overflow-hidden divide-y divide-border/20">
                      {shownTxns.map(t=>(
                        <div key={t.id} className="flex items-center gap-2.5 px-3 py-2">
                          <Receipt className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px] text-foreground truncate">{nameOverrides[t.id]??t.merchant_name??t.name??"Transaction"}</div>
                            <div className="text-[10px] text-muted-foreground">{new Date(t.date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                          </div>
                          <span className="text-[12px] tabular font-medium text-foreground shrink-0">{fmtUSD(Number(t.amount),{cents:true})}</span>
                        </div>
                      ))}
                    </div>
                    {/* Expand controls */}
                    {catTxns.length>5 && spendPopupLimit!=="all" && (
                      <div className="flex gap-2 mt-2">
                        {spendPopupLimit===5 && catTxns.length>5 && (
                          <button onClick={()=>setSpendPopupLimit(10)}
                            className="flex-1 h-8 rounded-lg border border-border text-[11px] text-muted-foreground hover:text-foreground hover:border-border-strong hover:bg-surface-hover/40 transition-colors">
                            Show top 10
                          </button>
                        )}
                        {catTxns.length > (spendPopupLimit===5?5:10) && (
                          <button onClick={()=>setSpendPopupLimit("all")}
                            className="flex-1 h-8 rounded-lg border border-border text-[11px] text-muted-foreground hover:text-foreground hover:border-border-strong hover:bg-surface-hover/40 transition-colors">
                            Show all {catTxns.length}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {catTxns.length===0 && <div className="text-center text-[12px] text-muted-foreground py-4">No transactions in this category this month.</div>}
              </div>
              <div className="hairline p-4 shrink-0">
                <button onClick={()=>{setSpendingPopup(null);setSpendPopupLimit(5);onCategorySelect?.(cat);}}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-foreground text-background px-5 py-3 text-xs font-medium hover:opacity-90 transition-opacity">
                  View all in Spending & Budget <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}
    </div>
  );

  // Monthly view removed - merged into Spending tab

    // ── SPENDING & BUDGET ─────────────────────────────────────
  if (view==="spending") {
    // ── Donut data ──
    const donutData = spendingPeriodByCategory.slice(0, 8).map(c => ({
      name: formatCat(c.category),
      value: c.total,
      color: catColor(c.category),
      category: c.category,
    }));
    const otherTotal = spendingPeriodByCategory.slice(8).reduce((s,c)=>s+c.total,0);
    if (otherTotal > 0) donutData.push({ name:"Other", value: otherTotal, color:"hsl(var(--muted-foreground))", category:"Other" });

    const net = spendingPeriodIncome - spendingPeriodTotal;
    const netPct = spendingPeriodIncome > 0 ? Math.round((net/spendingPeriodIncome)*100) : 0;

    // ── Trend buckets ──
    const { start, end } = getPeriodRange(spendingPeriod);
    const todayMs = new Date().setHours(0,0,0,0);
    type Bkt = { label: string; total: number; isCurrent: boolean; dateKey?: string; monthIdx?: number };
    const bkts: Bkt[] = [];
    if (spendingPeriod.granularity === "day") {
      bkts.push({ label: "Today", total: Math.round(spendingPeriodTotal), isCurrent: true });
    } else if (spendingPeriod.granularity === "year") {
      const byMonth: Record<number,number> = {};
      for (const t of spendingPeriodExpenses) { const m = new Date(t.date+"T00:00:00").getMonth(); byMonth[m]=(byMonth[m]??0)+Number(t.amount); }
      for (let m=0;m<12;m++) bkts.push({ label:new Date(2000,m,1).toLocaleDateString("en-US",{month:"short"}), total:Math.round(byMonth[m]??0), isCurrent:spendingPeriod.offset===0&&m===new Date().getMonth(), monthIdx:m });
    } else {
      const byDate: Record<string,number> = {};
      for (const t of spendingPeriodExpenses) byDate[t.date]=(byDate[t.date]??0)+Number(t.amount);
      for (const d=new Date(start); d<=end; d.setDate(d.getDate()+1)) {
        const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        bkts.push({ label:spendingPeriod.granularity==="week"?d.toLocaleDateString("en-US",{weekday:"short"}):String(d.getDate()), total:Math.round(byDate[key]??0), isCurrent:d.getTime()===todayMs, dateKey:key });
      }
    }

    const TrendTip = ({ active, payload, label }: any) => {
      if (!active||!payload?.length) return null;
      return (
        <div className="surface-elevated border border-border/60 rounded-lg px-3 py-2 shadow-xl text-[11px]">
          <div className="text-muted-foreground mb-0.5">{label}</div>
          <div className="text-foreground font-semibold tabular">{fmtUSD(payload[0].value)}</div>
        </div>
      );
    };

    return (
    <div className="space-y-3 animate-fade-up">
      {/* ── Header row ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-xl text-primary">Spending</h2>
          <PeriodNav state={spendingPeriod} granularities={["day","week","month","year"]}
            onChange={p=>{setSpendingPeriod(p);setTxnLimit(150);setChartDrillDate(null);setChartDrillMonth(null);onCategorySelect?.("");}} />
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={()=>setShowCatManager(true)} className="h-7 px-2.5 rounded-md border border-border/50 text-[11px] text-muted-foreground hover:text-foreground transition-colors">Manage</button>
          <button onClick={()=>setShowRulesManager(true)} className="h-7 px-2.5 rounded-md border border-border/50 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
            Rules{rules.length>0&&<span className="ml-1 px-1 rounded bg-primary/15 text-[hsl(var(--primary))] text-[10px]">{rules.length}</span>}
          </button>
          <button onClick={()=>{
            const rows=[["Date","Name","Category","Amount","Account","Pending"]];
            for(const t of filteredSpendingTxns){const acc=accounts.find(a=>a.account_id===t.account_id);rows.push([t.date,nameOverrides[t.id]??t.merchant_name??t.name??"",getEffectiveCategory(t,overrides,getRuleCategory)??"",String(Number(t.amount).toFixed(2)),`${acc?.name??""} ${acc?.mask?`··${acc.mask}`:""}`.trim(),t.pending?"yes":"no"]);}
            const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
            const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`spending-${getPeriodLabel(spendingPeriod).replace(/\s+/g,"-")}.csv`;a.click();
          }} className="h-7 px-2.5 rounded-md border border-border/50 text-[11px] text-muted-foreground hover:text-foreground transition-colors">CSV</button>
        </div>
      </div>

      {/* ── Trend chart — full width, above data, doubles as a date filter ── */}
      {bkts.length > 1 && (
        <div className="surface-card p-4 mb-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-baseline gap-2">
              <span className="text-[12px] font-semibold text-foreground">
                {spendingPeriod.granularity==="year"?"Monthly":"Daily"} trend
              </span>
              <span className="text-[10.5px] text-muted-foreground">tap a bar to filter transactions</span>
            </div>
            {(chartDrillDate||chartDrillMonth!=null)&&(
              <button onClick={()=>{setChartDrillDate(null);setChartDrillMonth(null);}}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-medium border border-negative/30 bg-negative/10 text-negative">
                {chartDrillDate?new Date(chartDrillDate+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}):new Date(2000,chartDrillMonth!,1).toLocaleDateString("en-US",{month:"long"})}
                <X className="h-2.5 w-2.5"/>
              </button>
            )}
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bkts} margin={{top:2,right:0,bottom:0,left:0}} barCategoryGap="24%" onClick={(s:any)=>{
                const b=bkts[s?.activeTooltipIndex];if(!b)return;
                if(b.dateKey)setChartDrillDate(p=>p===b.dateKey?null:b.dateKey!);
                else if(b.monthIdx!=null)setChartDrillMonth(p=>p===b.monthIdx?null:b.monthIdx!);
              }}>
                <CartesianGrid strokeDasharray="3 6" stroke="hsl(var(--border))" strokeOpacity={0.2} vertical={false}/>
                <XAxis dataKey="label" axisLine={false} tickLine={false}
                  interval={spendingPeriod.granularity==="month"?Math.floor(bkts.length/12):0}
                  tick={{fontSize:9,fill:"hsl(var(--muted-foreground))",fontFamily:"inherit"}}/>
                <YAxis hide domain={[0,"dataMax+30"]}/>
                <Tooltip content={<TrendTip/>} cursor={{fill:"hsl(var(--foreground))",fillOpacity:0.05}}/>
                <Bar dataKey="total" radius={[3,3,0,0]} animationDuration={400} cursor="pointer">
                  {bkts.map((b,i)=>{
                    const drilled=(!!b.dateKey&&b.dateKey===chartDrillDate)||(b.monthIdx!=null&&b.monthIdx===chartDrillMonth);
                    return <Cell key={i} fill={drilled?"hsl(var(--negative))":"hsl(var(--primary))"} fillOpacity={drilled||b.isCurrent?1:0.45}/>;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Main 2-col layout ── */}
      <div className="lg:grid lg:grid-cols-[340px_minmax(0,1fr)] gap-3 items-start space-y-3 lg:space-y-0">

        {/* ── LEFT: visual summary ── */}
        <div className="space-y-3">

          {/* Donut + stats card */}
          <div className="surface-card p-4">
            {spendingPeriodByCategory.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-muted-foreground">No expenses this period</div>
            ) : (
              <div className="flex items-center gap-4">
                {/* Donut */}
                <div className="relative shrink-0 h-[130px] w-[130px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donutData} dataKey="value" cx="50%" cy="50%"
                        innerRadius={40} outerRadius={60} paddingAngle={2} animationDuration={500}
                        onClick={(d:any)=>onCategorySelect?.(selectedCategory===d.category?"":d.category)}
                        onMouseEnter={(_:any,i:number)=>setHoveredSlice(i)}
                        onMouseLeave={()=>setHoveredSlice(null)}>
                        {donutData.map((d,i)=>{
                          const isActive = hoveredSlice===i;
                          const dimmed = (selectedCategory && selectedCategory!==d.category) || (hoveredSlice!==null && !isActive);
                          return (
                            <Cell key={i} fill={d.color}
                              fillOpacity={dimmed?0.28:1}
                              stroke={isActive?d.color:"transparent"} strokeWidth={isActive?2:0}
                              style={{ transition:"opacity 0.15s", cursor:"pointer", filter:isActive?"brightness(1.12)":"none" }} />
                          );
                        })}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Center label — reflects hovered slice, else total */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-2 text-center">
                    {hoveredSlice!==null && donutData[hoveredSlice] ? (
                      <>
                        <div className="text-[11.5px] tabular font-bold text-foreground leading-tight">{fmtUSD(donutData[hoveredSlice].value,{compact:true})}</div>
                        <div className="text-[9px] text-muted-foreground truncate max-w-[72px] leading-tight mt-0.5">{formatCat(donutData[hoveredSlice].category)}</div>
                        <div className="text-[9px] font-medium mt-0.5" style={{color:donutData[hoveredSlice].color}}>
                          {Math.round((donutData[hoveredSlice].value/spendingPeriodTotal)*100)}%
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-[12px] tabular font-bold text-foreground">{fmtUSD(spendingPeriodTotal,{compact:true})}</div>
                        <div className="text-[10px] text-muted-foreground">spent</div>
                      </>
                    )}
                  </div>
                </div>

                {/* Right stats */}
                <div className="flex-1 min-w-0 space-y-2.5">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Income</div>
                    <div className="text-[15px] font-display tabular text-positive">{fmtUSD(spendingPeriodIncome)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Net</div>
                    <div className={cn("text-[15px] font-display tabular", net>=0?"text-positive":"text-negative")}>
                      {net>=0?"+":"−"}{fmtUSD(Math.abs(net))}
                    </div>
                    {spendingPeriodIncome>0&&(
                      <div className="mt-1 h-1.5 rounded-full bg-border/30 overflow-hidden">
                        <div className="h-full rounded-full bg-positive transition-all" style={{width:`${Math.min(Math.max(netPct,0),100)}%`}}/>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Daily avg</div>
                      <div className="text-[13px] tabular text-foreground font-semibold">{fmtUSD(spendingDailyAvg)}</div>
                    </div>
                    {spendDeltaPct!==null&&(
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">vs prior</div>
                        <div className={cn("text-[13px] tabular font-semibold", spendDeltaPct>0?"text-negative":"text-positive")}>
                          {spendDeltaPct>0?"+":""}{spendDeltaPct}%
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Category breakdown — compact rows with overflow bars */}
          {spendingPeriodByCategory.length > 0 && (
            <div className="surface-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border/15 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-foreground">By category</span>
                {selectedCategory&&<button onClick={()=>onCategorySelect?.("")} className="text-[10px] text-[hsl(var(--primary))]">Clear ×</button>}
              </div>
              <div className="divide-y divide-border/10 max-h-[280px] sm:max-h-[360px] overflow-y-auto scrollbar-none">
                {spendingPeriodByCategory.map(c=>{
                  const Icon=categoryIcon(c.category);
                  const color=catColor(c.category);
                  const maxS=spendingPeriodByCategory[0]?.total??1;
                  const barPct=Math.min((c.total/maxS)*100,100);
                  const sharePct=spendingPeriodTotal>0?Math.round((c.total/spendingPeriodTotal)*100):0;
                  const budget=budgets[c.category];
                  const budgetBarPct=budget?Math.min((budget/maxS)*100,100):null;
                  const over=budget&&c.total>budget;
                  const isActive=selectedCategory===c.category;
                  return (
                    <button key={c.category}
                      onClick={()=>{onCategorySelect?.(isActive?"":c.category);setTxnFlowFilter("expense");}}
                      className={cn("w-full text-left px-5 py-3 transition-colors",isActive?"bg-[hsl(var(--primary)/0.07)]":"hover:bg-surface-hover/30",selectedCategory&&!isActive?"opacity-40 hover:opacity-70":"")}>
                      <div className="flex items-center gap-2.5 mb-1.5">
                        <div className="h-6 w-6 rounded-md grid place-items-center shrink-0" style={{backgroundColor:`${color}20`,color}}>
                          <Icon className="h-3 w-3"/>
                        </div>
                        <span className="text-[12.5px] font-medium text-foreground flex-1 truncate">{formatCat(c.category)}</span>
                        <span className="text-[10px] text-muted-foreground tabular">{sharePct}%</span>
                        <span className={cn("text-[12.5px] font-semibold tabular",over?"text-negative":"text-foreground")}>{fmtUSD(c.total)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-border/25 relative overflow-visible">
                        {budgetBarPct!==null&&(
                          <div className="absolute inset-y-0 w-px bg-foreground/25 z-10" style={{left:`${budgetBarPct}%`}}/>
                        )}
                        <div className="h-full rounded-full transition-all" style={{width:`${barPct}%`,backgroundColor:over?"hsl(var(--negative))":color}}/>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

        </div>

        {/* ── RIGHT: transaction list ── */}
        <div className="surface-card overflow-hidden">
          {/* Toolbar */}
          <div className="px-5 py-3 border-b border-border/20 space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/40"/>
                <input value={txnSearch} onChange={e=>{setTxnSearch(e.target.value);setTxnLimit(150);}}
                  placeholder="Search…"
                  className="w-full h-8 pl-7 pr-7 rounded-lg bg-secondary/40 border border-border/40 text-[11.5px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-[hsl(var(--primary)/0.5)] transition-colors"/>
                {txnSearch&&<button onClick={()=>setTxnSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3 w-3"/></button>}
              </div>
              <select value={txnSort} onChange={e=>setTxnSort(e.target.value as typeof txnSort)}
                className="h-8 rounded-lg bg-secondary/40 border border-border/40 text-[11px] text-foreground px-2 focus:outline-none cursor-pointer">
                <option value="date-desc">Newest first</option>
                <option value="date-asc">Oldest first</option>
                <option value="amount-desc">Largest amount</option>
                <option value="amount-asc">Smallest amount</option>
                <option value="name-asc">Name A→Z</option>
                <option value="name-desc">Name Z→A</option>
                <option value="category-asc">Category A→Z</option>
              </select>
            </div>

            {/* Flow filter chips + advanced filter toggle */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {(["all","expense","income"] as const).map(f=>(
                <button key={f} onClick={()=>setTxnFlowFilter(f)}
                  className={cn("h-6 px-2.5 rounded-full text-[10px] font-medium transition-colors",
                    txnFlowFilter===f?"bg-primary/15 text-[hsl(var(--primary))] border border-[hsl(var(--primary)/0.3)]":"border border-border/40 text-muted-foreground hover:text-foreground")}>
                  {f==="all"?"All":f==="expense"?"Expenses":"Income"}
                </button>
              ))}
              {selectedCategory&&(
                <div className="flex items-center gap-1 h-6 px-2.5 rounded-full text-[10px] font-medium bg-secondary text-foreground border border-border">
                  {formatCat(selectedCategory)}
                  <button onClick={()=>onCategorySelect?.("")}><X className="h-2.5 w-2.5 ml-0.5"/></button>
                </div>
              )}
              {(() => {
                const activeCount = filterSet.conditions.filter(c=>(c.value??"").trim()!==""||c.field==="pending").length;
                return (
                  <button onClick={()=>{ if(filterSet.conditions.length===0){setFilterSet({match:"all",conditions:[emptyCondition()]});} setShowFilterBuilder(v=>!v); }}
                    className={cn("inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[10px] font-medium border transition-colors",
                      showFilterBuilder||activeCount>0?"bg-primary/15 text-[hsl(var(--primary))] border-[hsl(var(--primary)/0.3)]":"border border-border/40 text-muted-foreground hover:text-foreground")}>
                    <SlidersHorizontal className="h-2.5 w-2.5"/> Filters{activeCount>0&&<span className="ml-0.5">· {activeCount}</span>}
                  </button>
                );
              })()}
            </div>

            {showFilterBuilder&&(
              <div className="p-3 rounded-lg bg-secondary/30 border border-border/30 space-y-3">
                <ConditionRows set={filterSet} onChange={s=>{setFilterSet(s);setTxnLimit(150);}}
                  accounts={accounts} categoryOptions={allCategoryNames} compact />
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/20">
                  <button onClick={()=>{setFilterSet({match:"all",conditions:[]});}} className="text-[11px] text-muted-foreground hover:text-foreground">Clear all</button>
                  <button onClick={()=>setShowFilterBuilder(false)} className="h-7 px-3 rounded-md bg-gold text-[11px] font-semibold">Done</button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{filteredSpendingTxns.length} transaction{filteredSpendingTxns.length!==1?"s":""}</span>
              <span className="tabular">{(()=>{
                const out=filteredSpendingTxns.filter(t=>Number(t.amount)>0).reduce((s,t)=>s+Number(t.amount),0);
                const inn=filteredSpendingTxns.filter(t=>Number(t.amount)<0).reduce((s,t)=>s+Math.abs(Number(t.amount)),0);
                return <>{inn>0&&<span className="text-positive">+{fmtUSD(inn)}</span>}{inn>0&&out>0&&<span className="mx-1">·</span>}{out>0&&<span>−{fmtUSD(out)}</span>}</>;
              })()}</span>
            </div>
          </div>

          {/* Transaction list */}
          {filteredSpendingTxns.length===0?(
            <div className="p-8 text-center text-[12px] text-muted-foreground">No transactions match.</div>
          ):(()=>{
            const shown=filteredSpendingTxns.slice(0,txnLimit);
            const isDateSort=txnSort.startsWith("date");
            const dayLabel=(ds:string)=>{const d=new Date(ds+"T00:00:00"),t=new Date();t.setHours(0,0,0,0);const diff=Math.round((t.getTime()-d.getTime())/86400000);if(diff===0)return"Today";if(diff===1)return"Yesterday";return d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});};
            const renderRow=(t:PTxn,i:number)=>(
              <TxnRow key={t.id} t={t} i={i} overrides={overrides} getRuleCategory={getRuleCategory}
                isInternal={internalTxnIds.has(t.id)} isAutoInternal={autoInternalIds.has(t.id)}
                isManualInternal={manualInternalIds.has(t.id)} onToggleInternal={toggleManualInternal}
                nameOverride={getDisplayName(t)} onOpenDetail={txn=>openDetail(txn)} onOpenDetailCat={txn=>openDetail(txn,true)}/>
            );
            let content:React.ReactNode;
            if(isDateSort){
              const groups:{date:string;txns:PTxn[]}[]=[];
              for(const t of shown){const last=groups[groups.length-1];if(last&&last.date===t.date)last.txns.push(t);else groups.push({date:t.date,txns:[t]});}
              content=groups.map(g=>{
                const daySpend=g.txns.filter(t=>Number(t.amount)>0&&!internalTxnIds.has(t.id)).reduce((s,t)=>s+Number(t.amount),0);
                return(<Fragment key={g.date}>
                  <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-1 bg-card/96 backdrop-blur-sm border-b border-border/20">
                    <span className="text-[10.5px] uppercase tracking-widest text-muted-foreground font-semibold">{dayLabel(g.date)}</span>
                    {daySpend>0&&<span className="text-[10.5px] tabular text-muted-foreground">−{fmtUSD(daySpend)}</span>}
                  </div>
                  {g.txns.map((t,i)=>renderRow(t,i))}
                </Fragment>);
              });
            }else{content=shown.map((t,i)=>renderRow(t,i));}
            return(
              <div ref={txnListRef} className="overflow-y-auto max-h-[680px] xl:max-h-[calc(100dvh-240px)]">
                {content}
                {filteredSpendingTxns.length>txnLimit&&(
                  <button onClick={()=>setTxnLimit(l=>l+150)} className="w-full py-2.5 text-[11px] text-muted-foreground hover:text-foreground border-t border-border/20 transition-colors">
                    Show {Math.min(150,filteredSpendingTxns.length-txnLimit)} more
                  </button>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {detailTxn && <TxnDetailModal txn={detailTxn} overrides={overrides} getRuleCategory={getRuleCategory} nameOverride={nameOverrides[detailTxn.id]} nameRules={nameRules} customCategories={customCategories} allTxns={txns} initialCatOpen={detailTxnOpenCat} onClose={()=>{setDetailTxn(null);setDetailTxnOpenCat(false);}} onSaveNameOverride={setNameOverride} onBulkRename={bulkSetNameOverride} onSaveNameRule={saveNameRule} onAddCategory={addCategory} onAddRule={addRule} onRemoveCustom={removeCategory} onSelect={(id,cat)=>setOverride(id,cat)} onToggleInternal={toggleManualInternal} isManualInternal={manualInternalIds.has(detailTxn.id)} isAutoInternal={autoInternalIds.has(detailTxn.id)} isManualExternal={manualExternalIds.has(detailTxn.id)} accounts={accounts} items={items} onFindSimilar={(pattern) => { setTxnSearch(pattern); setView("spending"); }} />}
      {showRulesManager && <RulesManager
        rules={rules}
        nameRules={nameRules}
        allTxns={txns}
        onRemoveCatRule={removeRule}
        onToggleCatRule={toggleRule}
        onUpdateCatRule={updateRule}
        onAddCatRule={addRule}
        onSaveNameRule={saveNameRule}
        onRemoveNameRule={(merchant) => S.update({ nameRules: Object.fromEntries(Object.entries(nameRules).filter(([k]) => k !== merchant)) })}
        onClose={() => setShowRulesManager(false)}
        smartRules={smartRules}
        evalTxns={evalTxns}
        accounts={accounts}
        categoryOptions={allCategoryNames}
        onAddSmartRule={addSmartRule}
        onUpdateSmartRule={updateSmartRule}
        onRemoveSmartRule={removeSmartRule}
        onToggleSmartRule={toggleSmartRule}
      />}
      <CategoryManager
        open={showCatManager} onClose={()=>setShowCatManager(false)}
        txns={txns} overrides={overrides} rules={rules} budgets={budgets}
        customCategories={customCategories}
        builtInExpense={EXPENSE_CATEGORIES} builtInIncome={INCOME_CATEGORIES}
        getEffectiveCategory={t=>getEffectiveCategory(t,overrides,getRuleCategory)}
        onSetOverride={setOverride} onBulkSetOverride={bulkSetOverride} onBulkSetOverrideMap={bulkSetOverrideMap}
        onReassignCategory={reassignCategory}
        onSetBudget={setBudget} onRemoveBudget={removeBudget}
        onAddCategory={addCategory} onRemoveCategory={removeCategory}
      />
    </div>
    );
  }


  // ── BUDGET (dedicated tab) ────────────────────────────────
  if (view === "budget") {
    const budgetPeriodState: PeriodState = { granularity: "month", offset: budgetMonthOffset };
    const budgetTxns = filterByPeriod(txns, budgetPeriodState).filter(t => !internalTxnIds.has(t.id));
    const budgetExpenseTxns = budgetTxns.filter(t => Number(t.amount) > 0);
    const budgetIncomeTxns = budgetTxns.filter(t => Number(t.amount) < 0);

    // ── Recurring income detection — looks back 3 months for regular paycheck-like deposits ──
    const detectRecurringIncome = () => {
      const merchantTotals: Record<string,{dates:string[];amounts:number[]}> = {};
      for (let i = 1; i <= 3; i++) {
        const prior = filterByPeriod(txns, { granularity:"month", offset:-i }).filter(t=>Number(t.amount)<0&&!internalTxnIds.has(t.id));
        for (const t of prior) {
          const key = t.merchant_name ?? t.name ?? "Unknown";
          if (!merchantTotals[key]) merchantTotals[key] = { dates:[], amounts:[] };
          merchantTotals[key].dates.push(t.date);
          merchantTotals[key].amounts.push(Math.abs(Number(t.amount)));
        }
      }
      const recurring: {merchant:string;avgAmount:number;count:number}[] = [];
      for (const [merchant, data] of Object.entries(merchantTotals)) {
        if (data.dates.length >= 2) {
          const avg = data.amounts.reduce((s,v)=>s+v,0)/data.amounts.length;
          recurring.push({ merchant, avgAmount: avg, count: data.dates.length });
        }
      }
      return recurring.sort((a,b)=>b.avgAmount-a.avgAmount).slice(0,5);
    };
    const recurringIncomeSources = detectRecurringIncome();
    const addManualIncome = () => {
      const amt = parseFloat(incomeDraftAmt);
      if (!incomeDraftLabel.trim() || isNaN(amt) || amt <= 0) return;
      S.addManualIncome({ id: `mi_${Date.now()}`, label: incomeDraftLabel.trim(), amount: amt });
      setIncomeDraftLabel(""); setIncomeDraftAmt(""); setShowAddIncome(false);
    };
    const removeManualIncome = (id: string) => {
      S.removeManualIncome(id);
    };

    const detectedIncomeThisMonth = budgetIncomeTxns.reduce((s,t)=>s+Math.abs(Number(t.amount)),0);
    const manualIncomeTotal = manualIncome.reduce((s,m)=>s+m.amount,0);
    const anticipatedIncome = detectedIncomeThisMonth + manualIncomeTotal;

    const catMap: Record<string,{total:number;count:number;txns:PTxn[]}> = {};
    for (const t of budgetExpenseTxns) {
      const cat = getEffectiveCategory(t,overrides,getRuleCategory)??"Other";
      if (!catMap[cat]) catMap[cat] = { total:0, count:0, txns:[] };
      catMap[cat].total += Number(t.amount);
      catMap[cat].count += 1;
      catMap[cat].txns.push(t);
    }
    const allCats = Object.entries(catMap).map(([category,v])=>({category,...v})).sort((a,b)=>b.total-a.total);
    const zeroSpendBudgeted = Object.keys(budgets).filter(cat=>!catMap[cat]).map(cat=>({category:cat,total:0,count:0,txns:[] as PTxn[]}));
    const allBudgetedCats = [...allCats.filter(c=>!!budgets[c.category]),...zeroSpendBudgeted].sort((a,b)=>(budgets[b.category]??0)-(budgets[a.category]??0));
    const unbudgetedCats = allCats.filter(c=>!budgets[c.category]);

    const totalAllocated = allBudgetedCats.reduce((s,c)=>s+(budgets[c.category]??0),0);
    const totalSpent = allCats.reduce((s,c)=>s+c.total,0);
    const totalSpentBudgeted = allBudgetedCats.reduce((s,c)=>s+c.total,0);
    const overCount = allBudgetedCats.filter(c=>c.total>(budgets[c.category]??0)).length;
    const left = anticipatedIncome - totalSpent;
    const overCategories = allBudgetedCats.filter(c=>c.total>(budgets[c.category]??0));
    const totalOverage = overCategories.reduce((s,c)=>s+(c.total-(budgets[c.category]??0)),0);

    // Fund allocation for overages
    const spendingRoleAccounts = accounts.filter(a => {
      const role = getRole(a.account_id, a.type, a.subtype);
      return role.role !== "spending";
    });

    // Max bar = max of budget or actual across all categories (for aligned scale)
    const maxBar = Math.max(...allBudgetedCats.map(c=>Math.max(budgets[c.category]??0, c.total)), 1);

    return (
    <>
    <div className="animate-fade-up space-y-4">

      {/* Month nav */}
      <div className="flex items-center justify-between px-1">
        <button onClick={() => setBudgetMonthOffset(o => o - 1)}
          className="h-8 w-8 rounded-full border border-border-strong grid place-items-center text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-[14px] font-semibold text-foreground">{getPeriodLabel(budgetPeriodState)}</span>
        <button onClick={() => setBudgetMonthOffset(o => Math.min(0, o + 1))} disabled={budgetMonthOffset >= 0}
          className="h-8 w-8 rounded-full border border-border-strong grid place-items-center text-muted-foreground hover:text-foreground disabled:opacity-30">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Top tracker */}
      {(() => {
        const budgetPct = totalAllocated > 0 ? Math.min((totalSpent / totalAllocated) * 100, 100) : 0;
        const leftVsBudget = totalAllocated - totalSpent;
        return (
        <div className="surface-card px-5 py-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Budgeted", val: totalAllocated, color: "text-foreground" },
              { label: "Actual",   val: totalSpent,     color: overCount > 0 ? "text-negative" : "text-foreground" },
              { label: leftVsBudget >= 0 ? "Left" : "Over", val: Math.abs(leftVsBudget), color: leftVsBudget >= 0 ? "text-positive" : "text-negative" },
            ].map(m => (
              <div key={m.label} className="text-center">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{m.label}</div>
                <div className={cn("text-[20px] font-display font-bold tabular leading-tight", m.color)}>{fmtUSD(m.val)}</div>
              </div>
            ))}
          </div>
          <div className="h-1.5 rounded-full bg-border/30 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{
              width: `${budgetPct}%`,
              backgroundColor: budgetPct >= 100 ? "hsl(var(--negative))" : budgetPct >= 85 ? "hsl(var(--warning))" : "hsl(var(--positive))"
            }} />
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>{Math.round(budgetPct)}% of budget used</span>
            <span>{allBudgetedCats.length} categor{allBudgetedCats.length !== 1 ? "ies" : "y"}</span>
          </div>
        </div>
        );
      })()}

      {/* Category list */}
      <div className="surface-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border/20 flex items-center justify-between">
          <span className="text-[12px] font-semibold text-foreground">Budgeted categories</span>
          <button onClick={() => { setEditingBudgetCat("__add__"); setBudgetDraft(""); setAddCatNameDraft(""); setAddCatCustom(""); }}
            className="text-[11.5px] text-[hsl(var(--primary))] font-medium flex items-center gap-1 hover:opacity-80">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>

        {/* Add form */}
        {editingBudgetCat === "__add__" && (
          <div className="px-5 py-4 border-b border-border/20 bg-surface/40 space-y-2.5">
            <div className="text-[11px] font-semibold text-foreground mb-1">New budget</div>
            <select value={addCatNameDraft} onChange={e => setAddCatNameDraft(e.target.value)}
              className="w-full h-9 px-3 rounded-lg bg-surface/60 border border-border/60 text-[12px] text-foreground outline-none focus:border-[hsl(var(--primary)/0.4)]">
              <option value="">Select category...</option>
              {unbudgetedCats.map(c => (
                <option key={c.category} value={c.category}>{formatCat(c.category)} ({fmtUSD(c.total)} spent)</option>
              ))}
              <option value="__custom__">Custom name...</option>
            </select>
            {addCatNameDraft === "__custom__" && (
              <input value={addCatCustom} onChange={e => setAddCatCustom(e.target.value)}
                placeholder="Category name"
                className="w-full h-9 px-3 rounded-lg bg-surface/60 border border-border/60 text-[12px] text-foreground outline-none focus:border-[hsl(var(--primary)/0.4)]" />
            )}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">$</span>
                <input type="number" min={0} step={10} value={budgetDraft} onChange={e => setBudgetDraft(e.target.value)}
                  placeholder="Monthly amount"
                  className="w-full h-9 pl-7 pr-3 rounded-lg bg-surface/60 border border-border/60 text-[12px] text-foreground outline-none focus:border-[hsl(var(--primary)/0.4)]" />
              </div>
              <button onClick={() => {
                const cat = addCatNameDraft === "__custom__" ? addCatCustom.trim() : addCatNameDraft;
                const amt = parseFloat(budgetDraft);
                if (!cat || isNaN(amt) || amt <= 0) return;
                setBudget(cat, amt);
                setEditingBudgetCat(null);
                setBudgetDraft("");
                setAddCatNameDraft("");
                setAddCatCustom("");
              }} className="h-9 px-4 rounded-lg bg-gold text-[12px] font-semibold shrink-0">Save</button>
              <button onClick={() => { setEditingBudgetCat(null); setBudgetDraft(""); setAddCatNameDraft(""); }}
                className="h-9 px-3 rounded-lg border border-border-strong text-[12px] text-muted-foreground shrink-0">Cancel</button>
            </div>
          </div>
        )}

        {allBudgetedCats.length === 0 && editingBudgetCat !== "__add__" ? (
          <div className="p-10 text-center text-[12.5px] text-muted-foreground">
            No budgets yet. Press <span className="text-[hsl(var(--primary))]">+ Add</span> to create one.
          </div>
        ) : (
          <div className="divide-y divide-border/10">
            {allBudgetedCats.map(c => {
              const Icon = categoryIcon(c.category);
              const color = catColor(c.category);
              const budget = budgets[c.category] ?? 0;
              const actual = c.total;
              const over = actual > budget;
              const pct = budget > 0 ? Math.min((actual / budget) * 100, 100) : 0;
              const isEditing = editingBudgetCat === c.category;
              return (
                <div key={c.category} className="px-5 py-4">
                  {/* Name row */}
                  <div className="flex items-center gap-2.5 mb-2.5 cursor-pointer"
                    onClick={() => { if (!isEditing) setBudgetCatPopup(c.category); }}>
                    <div className="h-7 w-7 rounded-lg grid place-items-center shrink-0" style={{ backgroundColor: `${color}20`, color }}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-[13px] font-semibold text-foreground flex-1">{formatCat(c.category)}</span>
                    <span className="text-[10px] text-muted-foreground">{c.count} txn{c.count !== 1 ? "s" : ""}</span>
                    {over && <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-negative/15 text-negative">OVER</span>}
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />
                  </div>

                  {/* Budget / Actual aligned label-value rows */}
                  <div className="ml-9 space-y-1">
                    <div className="flex items-baseline">
                      <span className="text-[11px] text-muted-foreground w-16 shrink-0">Budget</span>
                      <span className="text-[13px] font-medium text-foreground tabular">{fmtUSD(budget)}</span>
                    </div>
                    <div className="flex items-baseline">
                      <span className="text-[11px] text-muted-foreground w-16 shrink-0">Actual</span>
                      <span className={cn("text-[13px] font-semibold tabular", over ? "text-negative" : "text-foreground")}>{fmtUSD(actual)}</span>
                      <span className={cn("text-[10.5px] tabular ml-3 font-medium", over ? "text-negative" : "text-positive")}>
                        {over ? `${fmtUSD(actual - budget)} over` : `${fmtUSD(budget - actual)} left`}
                      </span>
                    </div>
                    <div className="h-1 rounded-full bg-border/30 mt-2 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-300" style={{
                        width: `${pct}%`,
                        backgroundColor: over ? "hsl(var(--negative))" : pct >= 85 ? "hsl(var(--warning))" : color
                      }} />
                    </div>
                    {isEditing ? (
                      <form className="flex items-center gap-1.5 mt-2"
                        onSubmit={e => { e.preventDefault(); const n = parseFloat(budgetDraft); if (!isNaN(n) && n >= 0) setBudget(c.category, n); setEditingBudgetCat(null); setBudgetDraft(""); }}>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span>
                          <input autoFocus type="number" min={0} step={10} value={budgetDraft}
                            onChange={e => setBudgetDraft(e.target.value)}
                            onKeyDown={e => { if (e.key === "Escape") { setEditingBudgetCat(null); setBudgetDraft(""); } }}
                            className="w-24 h-7 pl-5 pr-1 rounded-md bg-surface/60 border border-[hsl(var(--primary)/0.4)] text-[11px] outline-none" />
                        </div>
                        <button type="submit" className="h-7 px-3 rounded-md bg-gold text-[10.5px] font-medium">Save</button>
                        <button type="button" onClick={() => { setEditingBudgetCat(null); setBudgetDraft(""); }}
                          className="h-7 px-2 rounded-md border border-border-strong text-[10px] text-muted-foreground">Cancel</button>
                        <button type="button" onClick={() => { removeBudget(c.category); setEditingBudgetCat(null); }}
                          className="h-7 px-2 rounded-md text-[10px] text-negative hover:bg-negative/10 ml-auto">Remove</button>
                      </form>
                    ) : (
                      <button onClick={() => { setEditingBudgetCat(c.category); setBudgetDraft(String(budget)); }}
                        className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 mt-1.5 transition-colors">
                        <Pencil className="h-2.5 w-2.5" /> Edit
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Unbudgeted spending */}
      {unbudgetedCats.length > 0 && (
        <div className="surface-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border/15 flex items-center gap-2">
            <span className="text-[11px] font-semibold text-foreground">Spending without a budget</span>
            <span className="text-[10px] text-muted-foreground ml-1">{fmtUSD(unbudgetedCats.reduce((s, c) => s + c.total, 0))} untracked</span>
          </div>
          <div className="divide-y divide-border/10">
            {unbudgetedCats.map(c => {
              const Icon = categoryIcon(c.category);
              const color = catColor(c.category);
              const isEditing = editingBudgetCat === c.category;
              return (
                <div key={c.category} className="flex items-center gap-3 px-5 py-3">
                  <div className="h-6 w-6 rounded-md grid place-items-center shrink-0" style={{ backgroundColor: `${color}20`, color }}>
                    <Icon className="h-3 w-3" />
                  </div>
                  <span className="text-[12.5px] font-medium text-foreground flex-1 truncate">{formatCat(c.category)}</span>
                  <span className="text-[12px] tabular text-muted-foreground">{fmtUSD(c.total)}</span>
                  {isEditing ? (
                    <form className="flex items-center gap-1" onSubmit={e => { e.preventDefault(); const n = parseFloat(budgetDraft); if (!isNaN(n) && n >= 0) setBudget(c.category, n); setEditingBudgetCat(null); setBudgetDraft(""); }}>
                      <div className="relative">
                        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span>
                        <input autoFocus type="number" min={0} step={10} value={budgetDraft} onChange={e => setBudgetDraft(e.target.value)}
                          className="w-20 h-7 pl-4 rounded-md bg-surface/60 border border-[hsl(var(--primary)/0.4)] text-[11px] outline-none" />
                      </div>
                      <button type="submit" className="h-7 px-2.5 rounded-md bg-gold text-[10.5px] font-medium">OK</button>
                    </form>
                  ) : (
                    <button onClick={() => { setEditingBudgetCat(c.category); setBudgetDraft(String(Math.ceil(c.total / 10) * 10)); }}
                      className="text-[11px] text-[hsl(var(--primary))] hover:underline shrink-0 font-medium">+ Budget</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>

        {/* Budget category txn popup */}
    {budgetCatPopup && (() => {
      const catTxns = budgetTxns.filter(t => Number(t.amount) > 0 && (getEffectiveCategory(t,overrides,getRuleCategory)??"Other") === budgetCatPopup).sort((a,b)=>b.date.localeCompare(a.date));
      const catBudget = budgets[budgetCatPopup] ?? 0;
      const catTotal = catTxns.reduce((s,t)=>s+Number(t.amount),0);
      const over = catBudget > 0 && catTotal > catBudget;
      const Icon = categoryIcon(budgetCatPopup);
      const color = catColor(budgetCatPopup);
      return (
        <Dialog open onOpenChange={o=>{ if(!o) setBudgetCatPopup(null); }}>
          <DialogContent className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[85dvh] flex flex-col">
            <DialogTitle className="sr-only">{formatCat(budgetCatPopup)} transactions</DialogTitle>
            <DialogDescription className="sr-only">Transactions for {formatCat(budgetCatPopup)}</DialogDescription>
            {/* Header */}
            <div className="px-5 py-4 border-b border-border/30 flex items-center gap-3 shrink-0">
              <div className="h-10 w-10 rounded-xl grid place-items-center shrink-0" style={{backgroundColor:`${color}20`,color}}>
                <Icon className="h-5 w-5"/>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-semibold text-foreground">{formatCat(budgetCatPopup)}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {fmtUSD(catTotal)} spent
                  {catBudget > 0 && <span className={cn("ml-1.5 font-medium", over?"text-negative":"text-positive")}>
                    {over ? `(${fmtUSD(catTotal-catBudget)} over)` : `(${fmtUSD(catBudget-catTotal)} left of ${fmtUSD(catBudget)})`}
                  </span>}
                </div>
              </div>
              {catBudget > 0 && (
                <div className="shrink-0 text-right">
                  <div className="text-[11px] text-muted-foreground">Budget</div>
                  <div className="text-[13px] font-semibold tabular text-foreground">{fmtUSD(catBudget)}</div>
                </div>
              )}
            </div>
            {/* Txn list */}
            <div className="flex-1 overflow-y-auto divide-y divide-border/10">
              {catTxns.length === 0 ? (
                <div className="px-5 py-10 text-center text-[12px] text-muted-foreground">No transactions this period.</div>
              ) : catTxns.map(t => {
                const acc = accounts.find(a=>a.account_id===t.account_id);
                return (
                  <button key={t.id} onClick={()=>{ setBudgetCatPopup(null); openDetail(t); }}
                    className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-surface-hover/30 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-foreground truncate">{nameOverrides[t.id] ?? t.merchant_name ?? t.name}</div>
                      <div className="text-[10.5px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                        <span>{new Date(t.date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>
                        {acc && <><span>·</span><span className="truncate max-w-[100px]">{acc.name}</span></>}
                        {t.pending && <span className="text-warning font-medium">· Pending</span>}
                      </div>
                    </div>
                    <span className="text-[14px] font-semibold tabular text-foreground shrink-0">{fmtUSD(Number(t.amount))}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0"/>
                  </button>
                );
              })}
            </div>
            {/* Footer */}
            <div className="px-5 py-3 border-t border-border/20 flex items-center justify-between shrink-0">
              <span className="text-[11px] text-muted-foreground">{catTxns.length} transaction{catTxns.length!==1?"s":""}</span>
              <button onClick={()=>{ setBudgetCatPopup(null); setEditingBudgetCat(budgetCatPopup); setBudgetDraft(String(catBudget||"")); }}
                className="text-[11.5px] text-[hsl(var(--primary))] font-medium flex items-center gap-1">
                <Pencil className="h-3 w-3"/> Edit budget
              </button>
            </div>
          </DialogContent>
        </Dialog>
      );
    })()}
    </>
    );
  }



  // ── MONEY MAP ──────────────────────────────────────────────
  // The core idea: not all money in your accounts is "available." A 10k
  // emergency fund shouldn't count toward what you can spend today. This view
  // separates accounts into roles (spending / buffer / reserve / savings goal /
  // investment / debt), computes a real "in hand" number from income minus
  // planned expenses minus committed savings (excluding buffer/reserve
  // balances entirely), and surfaces two kinds of actionable suggestions:
  // overspend-to-reserve matches and upcoming-expense forecasts -- both with
  // accept/dismiss feedback so repeated or rejected suggestions don't nag.
  if (view === "moneymap") {
    const moneyMapPeriod: PeriodState = { granularity: "month", offset: 0 };
    const periodKey = new Date().toISOString().slice(0, 7); // "2026-06" for suggestion ids
    const periodTxns = filterByPeriod(txns, moneyMapPeriod).filter(t => !internalTxnIds.has(t.id));

    // ── Categorize accounts by role ──
    const accountsWithRole = accounts.map(a => ({ acc: a, info: getRole(a.account_id, a.type, a.subtype) }));
    const spendingAccts = accountsWithRole.filter(x => x.info.role === "spending");
    const bufferAccts = accountsWithRole.filter(x => x.info.role === "buffer");
    const reserveAccts = accountsWithRole.filter(x => x.info.role === "reserve" || x.info.role === "savings_goal");
    const investmentAccts = accountsWithRole.filter(x => x.info.role === "investment");
    const debtAccts = accountsWithRole.filter(x => x.info.role === "debt");
    const unassignedAccts = accountsWithRole.filter(x => x.info.role === "unassigned");

    const sumBal = (list: typeof accountsWithRole) => list.reduce((s, x) => s + (Number(x.acc.current_balance) || 0), 0);
    const spendingBalance = sumBal(spendingAccts);
    const bufferBalance = sumBal(bufferAccts);
    const reserveBalance = sumBal(reserveAccts);
    const investmentBalance = sumBal(investmentAccts);
    const debtBalance = sumBal(debtAccts);

    // ── True Available: income this period minus planned expenses minus committed
    //    savings transfers, period. Buffer/reserve balances never enter this number
    //    at all -- they're informational, shown separately. ──
    const incomeThisPeriod = periodTxns.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    const expensesThisPeriod = periodTxns.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
    const totalBudgeted = Object.values(budgets).reduce((s, b) => s + b, 0);
    const trueAvailable = spendingBalance; // current real balance in spending-role accounts is the ground truth
    const projectedRemaining = incomeThisPeriod - expensesThisPeriod; // this period's net flow so far

    // ── Spend-by-category this period, for overspend detection ──
    const catTotals: Record<string, number> = {};
    for (const t of periodTxns) {
      if (Number(t.amount) <= 0) continue;
      const cat = getEffectiveCategory(t, overrides, getRuleCategory) ?? "Other";
      catTotals[cat] = (catTotals[cat] || 0) + Number(t.amount);
    }

    // ── Suggestion 1: overspend matched to a reserve account by name/label ──
    type Suggestion = { id: string; kind: "overage" | "upcoming"; title: string; detail: string; amount: number; matchAccount?: string };
    const suggestions: Suggestion[] = [];

    for (const [cat, spent] of Object.entries(catTotals)) {
      const budget = budgets[cat];
      if (!budget || spent <= budget) continue;
      const over = spent - budget;
      const catWords = formatCat(cat).toLowerCase();
      // Find a reserve/goal account whose label or name loosely matches this category
      const match = reserveAccts.find(x => {
        const label = (x.info.label || x.acc.name || x.acc.official_name || "").toLowerCase();
        return label && (label.includes(catWords) || catWords.includes(label) || catWords.split(" ").some(w => w.length > 3 && label.includes(w)));
      });
      const id = `overage:${cat}:${periodKey}`;
      suggestions.push({
        id, kind: "overage",
        title: `${formatCat(cat)} is ${fmtUSD(over)} over budget`,
        detail: match
          ? `Move ${fmtUSD(over)} from "${match.acc.name}" to cover it. That account looks earmarked for this.`
          : `No matching reserve account found. Tag a savings account for "${formatCat(cat)}" below so this can suggest covering it automatically.`,
        amount: over,
        matchAccount: match?.acc.account_id,
      });
    }

    // ── Suggestion 2: upcoming expenses, reusing the existing recurring-charge detector ──
    const upcoming = detectRecurring(txns).slice(0, 6);
    for (const r of upcoming) {
      const id = `upcoming:${r.merchant}:${r.predictedDate.toISOString().slice(0,10)}`;
      const daysOut = Math.round((r.predictedDate.getTime() - Date.now()) / 86400000);
      if (daysOut < 0 || daysOut > 21) continue; // only surface genuinely near-term ones here
      suggestions.push({
        id, kind: "upcoming",
        title: `${r.merchant}: ~${fmtUSD(r.avgAmount)} expected ${daysOut === 0 ? "today" : daysOut === 1 ? "tomorrow" : `in ${daysOut} days`}`,
        detail: `Based on ${r.monthsActive} months of history (${r.intervalLabel.toLowerCase()}). Make sure your spending account can cover it.`,
        amount: r.avgAmount,
      });
    }

    // ── Suggestion 3: autopay / credit-card payment risk ──
    // Find transactions that look like credit-card or bill payments
    const PAYMENT_RE = /\bpayment\b|autopay|bill\s*pay|online\s*payment|e-?pay/i;
    const paymentTxns = txns.filter(t =>
      Number(t.amount) > 0 && // positive = debit from source account
      (PAYMENT_RE.test(t.merchant_name ?? t.name ?? "") ||
       (t.category?.[0] ?? "").toLowerCase().includes("credit card"))
    );
    // Group by source account
    const payByAcct: Record<string, PTxn[]> = {};
    for (const t of paymentTxns) {
      if (!payByAcct[t.account_id]) payByAcct[t.account_id] = [];
      payByAcct[t.account_id].push(t);
    }
    for (const [acctId, acctPays] of Object.entries(payByAcct)) {
      const acct = accounts.find(a => a.account_id === acctId);
      if (!acct || acct.type !== "depository") continue;
      const sorted = [...acctPays].sort((a, b) => b.date.localeCompare(a.date));
      if (sorted.length < 2) continue;
      // Compute average interval and amount from last 3 payments
      const recent = sorted.slice(0, 3);
      const avgAmt = recent.reduce((s, t) => s + Number(t.amount), 0) / recent.length;
      const lastDate = new Date(sorted[0].date + "T00:00:00");
      // Estimate interval from spacing between most recent payments
      const intervals: number[] = [];
      for (let j = 0; j < Math.min(sorted.length - 1, 3); j++) {
        const d1 = new Date(sorted[j].date + "T00:00:00").getTime();
        const d2 = new Date(sorted[j + 1].date + "T00:00:00").getTime();
        intervals.push(Math.round((d1 - d2) / 86400000));
      }
      const avgInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length;
      const predictedDate = new Date(lastDate.getTime() + avgInterval * 86400000);
      const daysOut = Math.round((predictedDate.getTime() - Date.now()) / 86400000);
      if (daysOut < -3 || daysOut > 10) continue; // not due in next ~10 days
      const balance = Number(acct.current_balance) ?? 0;
      const isSufficient = balance >= avgAmt * 0.9; // 10% tolerance
      if (isSufficient) continue;
      const paymentName = sorted[0].merchant_name ?? sorted[0].name ?? "payment";
      const shortfall = avgAmt - balance;
      const dueTxt = daysOut <= 0 ? "overdue" : daysOut === 1 ? "tomorrow" : `in ${daysOut} days`;
      const sid = `autopay-risk:${acctId}:${predictedDate.toISOString().slice(0, 10)}`;
      suggestions.push({
        id: sid, kind: "upcoming",
        title: `Low balance for upcoming payment`,
        detail: `${acct.name} has ${fmtUSD(balance)} but "${paymentName}" (~${fmtUSD(avgAmt)}) is due ${dueTxt}. You may be short by ~${fmtUSD(shortfall)}.`,
        amount: shortfall,
      });
    }

    const visibleSuggestions = suggestions.filter(s => !getFeedback(s.id));
    const actedSuggestions = suggestions.filter(s => !!getFeedback(s.id));

    return (
      <div className="space-y-4 animate-fade-up">
        <div>
          <h2 className="font-display text-xl text-primary flex items-center gap-2"><Compass className="h-5 w-5" /> Money Map</h2>
          <div className="text-[11px] text-muted-foreground mt-0.5">What you actually have available, separate from buffers and reserves</div>
        </div>

        {/* ── The headline number ── */}
        <div className="surface-card p-5">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wide">In hand right now</div>
          <div className="font-display text-4xl tabular text-foreground mt-1">{fmtUSD(trueAvailable)}</div>
          <div className="text-[11px] text-muted-foreground mt-1.5">
            Sum of accounts tagged <span className="text-foreground font-medium">Everyday Expenses</span> only. Emergency fund, savings, and investments are excluded.
          </div>
          <div className={cn("text-[12px] mt-2 tabular font-medium", projectedRemaining >= 0 ? "text-positive" : "text-negative")}>
            {projectedRemaining >= 0 ? "+" : "−"}{fmtUSD(Math.abs(projectedRemaining))} net this month so far
          </div>
        </div>

        {/* ── Bucket breakdown ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: ROLE_META.buffer.name,       value: bufferBalance,     icon: ShieldAlert, color: "hsl(var(--info))",     count: bufferAccts.length },
            { label: "Savings",                    value: reserveBalance,    icon: Target,      color: "hsl(var(--gold))",     count: reserveAccts.length },
            { label: ROLE_META.investment.name,    value: investmentBalance, icon: TrendingUp,  color: "hsl(var(--positive))", count: investmentAccts.length },
            { label: ROLE_META.debt.name,          value: debtBalance,       icon: CreditCard,  color: "hsl(var(--negative))", count: debtAccts.length },
          ].map(b => (
            <div key={b.label} className="surface-card p-3.5">
              <div className="flex items-center gap-1.5">
                <b.icon className="h-3.5 w-3.5" style={{ color: b.color }} />
                <span className="text-[10.5px] text-muted-foreground uppercase tracking-wide">{b.label}</span>
              </div>
              <div className="font-display text-lg tabular text-foreground mt-1">{fmtUSD(b.value)}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{b.count} account{b.count !== 1 ? "s" : ""}</div>
            </div>
          ))}
        </div>

        {/* ── Suggestions ── */}
        <div className="surface-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border/30 flex items-center gap-2">
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="font-display text-[13px] text-primary">Suggestions</h3>
            <span className="text-[10px] text-muted-foreground ml-auto">{visibleSuggestions.length} active</span>
          </div>
          {visibleSuggestions.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">
              Nothing needs your attention right now.
            </div>
          ) : (
            <div className="divide-y divide-border/15">
              {visibleSuggestions.map(s => (
                <div key={s.id} className="px-5 py-4 flex items-start gap-3">
                  <div className="h-8 w-8 rounded-lg grid place-items-center shrink-0" style={{
                    backgroundColor: s.kind === "overage" ? "hsl(var(--negative)/0.12)" : "hsl(var(--info)/0.12)",
                    color: s.kind === "overage" ? "hsl(var(--negative))" : "hsl(var(--info))",
                  }}>
                    {s.kind === "overage" ? <ArrowRightLeft className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] text-foreground font-medium">{s.title}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{s.detail}</div>
                    <div className="flex items-center gap-2 mt-2">
                      <button onClick={() => recordFeedback(s.id, "accepted")}
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-positive/10 text-positive text-[10.5px] font-medium hover:bg-positive/20 transition-colors">
                        <ThumbsUp className="h-3 w-3" /> Got it
                      </button>
                      <button onClick={() => recordFeedback(s.id, "dismissed")}
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-border-strong text-muted-foreground text-[10.5px] hover:text-foreground transition-colors">
                        <ThumbsDown className="h-3 w-3" /> Not now
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Organize accounts: behind a button, grouped by type in a dialog ── */}
        <div className="surface-card px-5 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold text-foreground">Organize accounts</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {unassignedAccts.length > 0
                ? `${unassignedAccts.length} account${unassignedAccts.length > 1 ? "s" : ""} still need a role`
                : `${accountsWithRole.length} account${accountsWithRole.length !== 1 ? "s" : ""} tagged by role`}
            </div>
          </div>
          <button onClick={() => setShowOrganize(true)}
            className={cn("h-9 px-4 rounded-lg text-[12.5px] font-semibold shrink-0 inline-flex items-center gap-1.5",
              unassignedAccts.length > 0 ? "bg-gold" : "border border-border-strong text-foreground hover:bg-surface-hover/40")}>
            <Wallet className="h-3.5 w-3.5" /> Organize
            {unassignedAccts.length > 0 && <span className="ml-0.5 px-1.5 rounded-full bg-background/30 text-[10px]">{unassignedAccts.length}</span>}
          </button>
        </div>

        {showOrganize && (
          <Dialog open onOpenChange={o => { if (!o) setShowOrganize(false); }}>
            <DialogContent className="max-w-lg surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[85dvh] flex flex-col">
              <DialogTitle className="sr-only">Organize accounts</DialogTitle>
              <DialogDescription className="sr-only">Assign each account a role, grouped by type.</DialogDescription>
              <div className="px-5 py-4 border-b border-border/30 shrink-0">
                <div className="font-display text-[15px] text-foreground font-semibold">Organize accounts</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Grouped by type. Tag each with a Money Map role.</div>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                {bucketOrder
                  .map(bucket => ({ bucket, list: accountsWithRole.filter(x => mapBucket(x.acc.type, x.acc.subtype) === bucket) }))
                  .filter(g => g.list.length > 0)
                  .map(({ bucket, list }) => (
                    <div key={bucket} className="border-b border-border/15 last:border-0">
                      <div className="px-5 py-2 bg-border/10 flex items-center justify-between">
                        <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">{bucketMeta[bucket].label}</span>
                        <span className="text-[10px] text-muted-foreground">{list.length}</span>
                      </div>
                      <div className="divide-y divide-border/10">
                        {list.map(({ acc }) => {
                          const bal = Number(acc.current_balance) || 0;
                          const isDebtAcc = isDebt(acc.type);
                          return (
                            <div key={acc.account_id} className="flex items-center gap-3 px-5 py-3">
                              <div className="flex-1 min-w-0 flex items-center gap-2">
                                <Landmark className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <div className="min-w-0">
                                  <div className="text-[12.5px] text-foreground font-medium truncate">{acc.name ?? acc.official_name}</div>
                                  {acc.mask && <div className="text-[10px] text-muted-foreground">···· {acc.mask}</div>}
                                </div>
                              </div>
                              <div className={cn("text-[13px] tabular font-semibold shrink-0", isDebtAcc ? "text-negative" : "text-foreground")}>
                                {isDebtAcc ? "-" : ""}{fmtUSD(Math.abs(bal))}
                              </div>
                              <div className="shrink-0">
                                <RoleBadgeSelect accountId={acc.account_id} accType={acc.type} accSubtype={acc.subtype} getRole={getRole} setRole={setRole} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
              <div className="p-4 border-t border-border/20 shrink-0">
                <button onClick={() => setShowOrganize(false)} className="w-full h-10 rounded-lg bg-gold text-[13px] font-semibold">Done</button>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* ── Acted-on suggestions, collapsed reference ── */}
        {actedSuggestions.length > 0 && (
          <div className="text-[10.5px] text-muted-foreground text-center">
            {actedSuggestions.length} suggestion{actedSuggestions.length!==1?"s":""} already handled this period
          </div>
        )}
      </div>
    );
  }

  // ── BENEFITS / DEALS ──────────────────────────────────────
  const toggleBenefit = (key: string) => {
    setBenefitsUsed(prev => {
      const next = { ...prev, [key]: !prev[key] };
      // persisted via setBenefitsUsed above
      return next;
    });
  };

  const creditCards = accounts.filter(a => a.type === "credit");
  const cardsWithInfo = creditCards.map(a => ({
    account: a,
    info: getCardInfo(a.name, a.official_name),
  })).filter(c => c.info !== null);

  if (view === "benefits") {
    const totalAnnualFees = cardsWithInfo.reduce((s,c) => s + (c.info!.annualFee ?? 0), 0);
    const totalCredits = cardsWithInfo.reduce((s,c) => s + (c.info!.annualCredits?.reduce((cs,cr) => cs + cr.amount, 0) ?? 0), 0);
    const usedCredits = cardsWithInfo.reduce((s,c) => {
      return s + (c.info!.annualCredits?.reduce((cs,cr) => {
        const key = `${c.account.account_id}:${cr.label}`;
        return cs + (benefitsUsed[key] ? cr.amount : 0);
      }, 0) ?? 0);
    }, 0);
    return (
      <div className="space-y-4 animate-fade-up">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="font-display text-xl text-primary">Card Benefits</h2>
          {totalCredits > 0 && (
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="tabular"><span className="text-positive font-semibold">{fmtUSD(usedCredits)}</span> / {fmtUSD(totalCredits)} redeemed</span>
              {totalAnnualFees > 0 && <span>· {fmtUSD(totalAnnualFees)} annual fees</span>}
            </div>
          )}
        </div>

        {/* Summary bar */}
        {totalCredits > 0 && (
          <div className="surface-card p-4">
            <div className="flex items-center justify-between text-[11px] mb-2">
              <span className="text-muted-foreground">Annual credits redeemed</span>
              <span className="tabular font-medium">{totalCredits > 0 ? Math.round((usedCredits/totalCredits)*100) : 0}%</span>
            </div>
            <div className="h-2 rounded-full bg-border/40 overflow-hidden">
              <div className="h-full rounded-full bg-positive transition-all" style={{width:`${totalCredits > 0 ? Math.min((usedCredits/totalCredits)*100,100) : 0}%`}} />
            </div>
            <div className="mt-2 text-[10px] text-muted-foreground">
              {fmtUSD(totalCredits - usedCredits)} in unclaimed credits this year
              {totalAnnualFees > 0 && <> · Net cost after credits: <span className={cn("font-medium", totalAnnualFees - totalCredits < 0 ? "text-positive" : "text-foreground")}>{fmtUSD(Math.max(0, totalAnnualFees - totalCredits))}</span></>}
            </div>
          </div>
        )}

        {cardsWithInfo.length === 0 && (
          <div className="surface-card p-10 text-center space-y-2">
            <CreditCard className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
            <div className="font-display text-lg text-foreground">No credit cards linked</div>
            <div className="text-[12px] text-muted-foreground">Link a credit card to see your rewards and benefits.</div>
          </div>
        )}

        <div className="space-y-3">
          {cardsWithInfo.map(({ account: a, info }) => {
            if (!info) return null;
            const cardCredits = info.annualCredits ?? [];
            const cardTotalCredits = cardCredits.reduce((s,c) => s + c.amount, 0);
            const cardUsed = cardCredits.reduce((s,c) => benefitsUsed[`${a.account_id}:${c.label}`] ? s + c.amount : s, 0);
            const mask = a.mask ? `··${a.mask}` : "";
            return (
              <div key={a.account_id} className="surface-card overflow-hidden">
                {/* Card header */}
                <div className="px-5 py-4 border-b border-border/20 flex items-start gap-3">
                  <div className="h-9 w-9 rounded-xl bg-[hsl(var(--primary)/0.1)] grid place-items-center shrink-0">
                    <CreditCard className="h-4 w-4 text-gold" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-[13px] text-foreground truncate">{a.name ?? a.official_name ?? "Card"} {mask}</span>
                      {info.annualFee != null && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border/60 text-muted-foreground shrink-0">
                          {info.annualFee === 0 ? "No annual fee" : `$${info.annualFee}/yr fee`}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{info.purpose}</div>
                  </div>
                  {cardTotalCredits > 0 && (
                    <div className="text-right shrink-0">
                      <div className="text-[12px] font-semibold text-positive tabular">{fmtUSD(cardUsed)}</div>
                      <div className="text-[10.5px] text-muted-foreground">/ {fmtUSD(cardTotalCredits)}</div>
                    </div>
                  )}
                </div>

                {/* Rewards summary */}
                <div className="px-5 py-3 border-b border-border/15 bg-surface/30">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Rewards</div>
                  <div className="text-[11.5px] text-foreground">{info.rewards}</div>
                  <div className="text-[10.5px] text-muted-foreground mt-0.5">Best for: {info.bestFor}</div>
                </div>

                {/* Annual credits checklist */}
                {cardCredits.length > 0 && (
                  <div className="divide-y divide-border/15">
                    {cardCredits.map(credit => {
                      const key = `${a.account_id}:${credit.label}`;
                      const used = !!benefitsUsed[key];
                      return (
                        <button key={key} onClick={() => toggleBenefit(key)}
                          className={cn("w-full flex items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-hover/30",
                            used && "opacity-60")}>
                          <div className={cn("mt-0.5 h-4 w-4 rounded border-2 shrink-0 grid place-items-center transition-colors",
                            used ? "bg-positive border-positive" : "border-border/60")}>
                            {used && <Check className="h-2.5 w-2.5 text-background" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={cn("text-[12px] font-medium", used ? "line-through text-muted-foreground" : "text-foreground")}>
                              {credit.label}{credit.amount > 0 && <span className="ml-1 text-positive">+{fmtUSD(credit.amount)}</span>}
                            </div>
                            <div className="text-[10.5px] text-muted-foreground mt-0.5">{credit.howTo}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Cards without matched info — show raw list */}
        {creditCards.filter(a => !getCardInfo(a.name, a.official_name)).length > 0 && (
          <div className="surface-card p-4 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Other credit cards (no benefits data)</div>
            {creditCards.filter(a => !getCardInfo(a.name, a.official_name)).map(a => (
              <div key={a.account_id} className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <CreditCard className="h-3.5 w-3.5 shrink-0" />
                {a.name ?? a.official_name ?? "Card"}{a.mask ? ` ··${a.mask}` : ""}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Should be unreachable now — view is constrained to overall/monthly/spending/benefits
  // by the time it reaches here (admin and giftcards are excluded upstream in Index.tsx).
  return null;
};
