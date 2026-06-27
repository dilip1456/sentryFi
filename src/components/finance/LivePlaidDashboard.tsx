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
import { useBudgets } from "@/hooks/useBudgets";
import { useCategoryOverrides } from "@/hooks/useCategoryOverrides";
import { useCategoryRules } from "@/hooks/useCategoryRules";
import { useCustomCategories } from "@/hooks/useCustomCategories";
import { CategoryManager } from "@/components/finance/CategoryManager";
import { UNASSIGNED } from "@/hooks/useCategoryOverrides";
import { fmtUSD } from "@/lib/format";
import {
  Loader2, Plus, CreditCard, Landmark, TrendingUp, TrendingDown, Home,
  ShoppingBag, Utensils, Car, Zap, Plane, Film, Heart, Coffee,
  ArrowDownLeft, ArrowUpRight, Wallet, ArrowRight, Check, Sparkles, Coins, PiggyBank,
  AlertTriangle, ChevronRight, ChevronDown, Lock, X,
  Pencil, Search, Trash2, ExternalLink, Tag, Calendar, Unlink,
  ChevronLeft, RefreshCw, RepeatIcon, Receipt, ArrowUpDown, EyeOff, Eye, GripVertical,
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
  id: string; account_id: string; amount: number; date: string;
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

// ── Account metadata localStorage helpers ─────────────────────
const META_KEY = "sentryfi_account_meta";
const loadAllMeta = (): Record<string, AccountMeta> => {
  try { return JSON.parse(localStorage.getItem(META_KEY) ?? "{}"); } catch { return {}; }
};
const saveMeta = (accountId: string, meta: AccountMeta) => {
  const all = loadAllMeta();
  all[accountId] = { ...all[accountId], ...meta };
  localStorage.setItem(META_KEY, JSON.stringify(all));
};

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
  if (c.includes("food") || c.includes("restaurant") || c.includes("dining") || c.includes("groceries")) return Utensils;
  if (c.includes("travel") || c.includes("airline") || c.includes("hotel")) return Plane;
  if (c.includes("coffee") || c.includes("cafe")) return Coffee;
  if (c.includes("car") || c.includes("auto") || c.includes("gas") || c.includes("transport")) return Car;
  if (c.includes("utilities") || c.includes("electric") || c.includes("internet") || c.includes("bills")) return Zap;
  if (c.includes("entertainment") || c.includes("streaming")) return Film;
  if (c.includes("health") || c.includes("medical") || c.includes("pharmacy")) return Heart;
  if (c.includes("shops") || c.includes("shopping")) return ShoppingBag;
  if (c.includes("transfer")) return ArrowDownLeft;
  return ShoppingBag;
};

const catColor = (cat: string): string => {
  const c = cat.toLowerCase();
  if (c.includes("food") || c.includes("dining") || c.includes("restaurant")) return "hsl(38 92% 60%)";
  if (c.includes("groceries")) return "hsl(156 72% 55%)";
  if (c.includes("travel") || c.includes("airline")) return "hsl(210 90% 65%)";
  if (c.includes("transport") || c.includes("car") || c.includes("auto")) return "hsl(280 70% 65%)";
  if (c.includes("utilities") || c.includes("bills") || c.includes("electric")) return "hsl(50 90% 60%)";
  if (c.includes("entertainment") || c.includes("streaming")) return "hsl(330 70% 65%)";
  if (c.includes("health") || c.includes("medical")) return "hsl(152 60% 50%)";
  if (c.includes("shops") || c.includes("shopping")) return "hsl(4 78% 64%)";
  if (c.includes("education")) return "hsl(190 80% 60%)";
  if (c.includes("personal")) return "hsl(260 70% 65%)";
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
  const TRANSFER_NAME = /\btransfer\b|zelle|venmo|cashapp|pay yourself|from checking|to savings|to checking|from savings|online payment|autopay|bill pay/i;

  const isTransfer = (t: PTxn) =>
    (t.category?.[0] ?? "").toLowerCase().includes("transfer") ||
    TRANSFER_NAME.test(t.merchant_name ?? t.name ?? "");

  const candidates = txns.filter(isTransfer);

  for (const t of candidates) {
    if (ids.has(t.id)) continue;
    const amt = Number(t.amount);
    const tDate = new Date(t.date + "T00:00:00");

    // Look for a matching opposite transaction (same amount, different account, within 3 days)
    const match = candidates.find(o => {
      if (o.id === t.id || ids.has(o.id)) return false;
      if (o.account_id === t.account_id) return false;
      const oAmt = Number(o.amount);
      if (Math.abs(Math.abs(oAmt) - Math.abs(amt)) > 0.01) return false;
      if (Math.sign(oAmt) === Math.sign(amt)) return false; // must be opposite signs
      const oDate = new Date(o.date + "T00:00:00");
      return Math.abs(tDate.getTime() - oDate.getTime()) <= 3 * 86400000;
    });

    if (match) {
      ids.add(t.id);
      ids.add(match.id);
    } else if ((t.category?.[0] ?? "").toLowerCase().includes("transfer")) {
      // Even without a pair, Plaid-confirmed transfers are internal
      ids.add(t.id);
    }
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
  merchant: string; avgAmount: number; dayOfMonth: number;
  lastSeen: string; monthsActive: number; predictedDate: Date;
  accountId: string; intervalDays: number; intervalLabel: string;
};

/**
 * Detect truly recurring charges by identifying consistent intervals.
 * Supports weekly (~7d), bi-weekly (~14d), monthly (~30d), quarterly (~90d).
 * Shows next 30 days of upcoming charges only.
 */
const detectRecurring = (txns: PTxn[]): RecurringCharge[] => {
  const now = new Date(); now.setHours(0,0,0,0);
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const lookahead = new Date(now.getTime() + 30 * 86400000);

  const INTERVAL_BUCKETS = [
    { label: "Weekly",     days: 7,  tolerance: 2 },
    { label: "Bi-weekly",  days: 14, tolerance: 3 },
    { label: "Monthly",    days: 30, tolerance: 5 },
    { label: "Quarterly",  days: 91, tolerance: 10 },
  ];

  // Categories that are never truly recurring (variable spend) — checked first since
  // category data from Plaid is reliable when present.
  const NON_RECURRING_CAT = /food|dining|restaurant|groceries|grocery|supermarket|gas station|fuel|atm|withdrawal/i;
  // Merchant name patterns that indicate one-off or variable spend even when category data
  // is missing/generic — covers delivery apps, grocery/gas chains, and restaurant-style keywords
  // (category alone missed real restaurants too often, which is the bug this guards against).
  const NON_RECURRING_MERCHANT = /doordash|uber eats|grubhub|instacart|postmates|seamless|caviar|amazon fresh|whole foods|trader joe|kroger|safeway|publix|walmart|target|costco|shell|exxon|chevron|bp |sunoco|wawa|speedway|restaurant|cafe|coffee|bistro|grill|kitchen|diner|pizz|sushi|taco|bbq|bar\b|pub\b|brewery|bakery|deli\b/i;

  const expenses = txns.filter(t => {
    if (Number(t.amount) <= 0 || t.pending) return false;
    if (new Date(t.date) < threeMonthsAgo) return false;
    const cat0 = (t.category?.[0] ?? "").toLowerCase();
    const cat1 = (t.category?.[1] ?? "").toLowerCase();
    if (NON_RECURRING_CAT.test(cat0) || NON_RECURRING_CAT.test(cat1)) return false;
    const merchant = (t.merchant_name ?? t.name ?? "").toLowerCase();
    if (NON_RECURRING_MERCHANT.test(merchant)) return false;
    if (cat0.includes("transfer")) return false;
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

    const accCounts: Record<string, number> = {};
    for (const t of deduped) { accCounts[t.account_id] = (accCounts[t.account_id] ?? 0) + 1; }
    const accountId = Object.entries(accCounts).sort((a, b) => b[1] - a[1])[0][0];

    results.push({
      merchant: displayName, avgAmount, dayOfMonth,
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
    detail: `${lowCheck[0].name} is at ${fmtUSD(Number(lowCheck[0].current_balance) || 0)} — consider a transfer.`,
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
        detail: `${fmtUSD(top.spent)} spent vs ${fmtUSD(budgets[top.cat])} budget — ${fmtUSD(top.over)} over.${overages.length > 1 ? ` +${overages.length - 1} more categor${overages.length > 2 ? "ies" : "y"}.` : ""}`,
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
        detail: `${fmtUSD(s.thisAmt)} this month vs ${fmtUSD(Math.round(s.avg))} avg — ${fmtUSD(Math.round(s.thisAmt - s.avg))} above normal.`,
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
        detail: `Minimum payment of ${minPay ? fmtUSD(minPay) : "unknown"} is past due — pay immediately to avoid fees.`,
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
        detail: `${fmtUSD(bal)} balance — schedule payment before due date.`,
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
    detail: `${fmtUSD(lowYieldSavings.reduce((s, a) => s + (Number(a.current_balance) || 0), 0))} may be earning below market rate — consider a 4%+ APY account.`,
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

  return items.slice(0, 6);
};

const isAIInsight=(x:unknown):x is AIInsight=>{ if(!x||typeof x!=="object") return false; const o=x as Record<string,unknown>; return typeof o.id==="string"&&typeof o.title==="string"&&typeof o.impact==="string"; };
const parseInsights=(raw:unknown):AIInsight[]=>(Array.isArray(raw)?raw.filter(isAIInsight):[]);

/** Resolve the effective display category for a transaction, respecting overrides → rules → original */
const getEffectiveCategory = (t: PTxn, overrides: Record<string,string>, getRuleCategory: (m:string|null)=>string|null): string|null => {
  if (overrides[t.id]) return overrides[t.id];
  const merchant = t.merchant_name ?? t.name ?? null;
  const ruleMatch = getRuleCategory(merchant);
  if (ruleMatch) return ruleMatch;
  return t.category?.[0] ?? null;
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
        <div className="shrink-0 px-4 py-3 border-t flex gap-2" style={{ borderColor: "var(--gold-border)" }}>
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
      {badge && <span className={cn("text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border mb-1 inline-block", badgeClass)}>{badge}</span>}
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
type PickerState = { txn: PTxn; x: number; y: number };

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
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      {/* Picker card */}
      <div className="fixed z-50 w-64 surface-elevated rounded-xl shadow-2xl overflow-hidden"
        style={{ border:"1px solid var(--gold-border)" }}
        onClick={e=>e.stopPropagation()}>
        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/30">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input ref={inputRef} value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search or create…"
            className="flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground" />
          {search && <button onClick={()=>setSearch("")} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>}
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
    </>
  );
};

// ── Transaction row ────────────────────────────────────────────
const TxnRow = ({ t, i, overrides, getRuleCategory, customCategories, openPickerId, onOpenPicker, onClosePicker, onSelect, onAddCategory, onAddRule, onRemoveCustom, isInternal, nameOverride, onSetName, isManualInternal, onToggleInternal }: {
  t: PTxn; i: number;
  overrides: Record<string,string>;
  getRuleCategory: (m:string|null)=>string|null;
  customCategories: { name:string; type:"income"|"expense" }[];
  openPickerId: string|null;
  onOpenPicker: (txn: PTxn, anchor: {x:number;y:number}) => void;
  onClosePicker: () => void;
  onSelect: (txnId:string, cat:string) => void;
  onAddCategory: (name:string, type:"income"|"expense") => void;
  onAddRule: (merchant:string, cat:string) => void;
  onRemoveCustom: (name:string) => void;
  isInternal?: boolean;
  nameOverride?: string;
  onSetName?: (id: string, name: string) => void;
  isManualInternal?: boolean;
  onToggleInternal?: (id: string) => void;
}) => {
  const rawCat     = getEffectiveCategory(t, overrides, getRuleCategory);
  const displayCat = humanizeCategory(rawCat, Number(t.amount));
  const isIncome   = Number(t.amount) < 0;
  const Icon       = isIncome ? ArrowDownLeft : categoryIcon(rawCat);
  const isEdited   = !!overrides[t.id] || !!getRuleCategory(t.merchant_name ?? t.name ?? null);
  const isOpen     = openPickerId === t.id;
  const displayName = nameOverride ?? t.merchant_name ?? t.name ?? "Transaction";
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  const handleCatClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOpen) { onClosePicker(); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(rect.left, window.innerWidth - 270);
    const y = rect.bottom + 6;
    onOpenPicker(t, { x, y });
  };

  const startNameEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNameDraft(displayName);
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.select(), 0);
  };

  const commitName = () => {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== (t.merchant_name ?? t.name ?? "")) {
      onSetName?.(t.id, trimmed);
    } else if (!trimmed) {
      onSetName?.(t.id, ""); // clear override
    }
    setEditingName(false);
  };

  return (
    <div className={cn(
      "group grid items-center gap-2 px-4 md:px-5 py-2.5 transition-colors hover:bg-surface-hover/30",
      i > 0 && "border-t border-border/20",
      isInternal && "opacity-60",
    )} style={{gridTemplateColumns:"auto 1fr auto auto"}}>
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
          {editingName ? (
            <input ref={nameInputRef} autoFocus value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={e => { if (e.key==="Enter"){e.preventDefault();commitName();} if(e.key==="Escape")setEditingName(false); }}
              className="flex-1 min-w-0 bg-card border border-[hsl(var(--primary)/0.4)] rounded px-1.5 py-0.5 text-[12.5px] text-foreground outline-none focus:border-[hsl(var(--primary))]" />
          ) : (
            <span className={cn("text-[12.5px] font-medium truncate cursor-text select-none", isInternal?"line-through text-muted-foreground":"text-foreground")}
              onDoubleClick={startNameEdit}
              onTouchEnd={e=>{e.preventDefault();startNameEdit(e as unknown as React.MouseEvent);}}
              title="Double-click to edit name">
              {displayName}
            </span>
          )}
          {nameOverride && !editingName && <span className="text-[8px] text-[hsl(var(--primary)/0.5)] shrink-0">edited</span>}
          {isManualInternal && <span className="text-[8px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-muted-foreground/20 bg-secondary/50 text-muted-foreground/60 shrink-0">Transfer</span>}
          {!isManualInternal && isInternal && <span className="text-[8px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-muted-foreground/20 bg-secondary/50 text-muted-foreground/60 shrink-0">Internal</span>}
          {t.pending && <span className="text-[8px] uppercase px-1.5 py-0.5 rounded border border-warning/30 bg-warning/10 text-warning shrink-0">Pending</span>}
        </div>
        <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
          <span>{new Date(t.date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>
          {displayCat && !isInternal && <>
            <span className="text-muted-foreground/30">·</span>
            <button onClick={handleCatClick}
              className={cn("inline-flex items-center gap-0.5 rounded px-1 -mx-1 transition-colors",
                isOpen?"bg-secondary/60 text-foreground":"hover:bg-secondary/40 hover:text-foreground",
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

      {/* Mark-as-internal toggle — hover on desktop, always visible when active */}
      <button
        onClick={e=>{e.stopPropagation();onToggleInternal?.(t.id);}}
        title={isManualInternal?"Remove internal transfer mark":"Mark as internal transfer"}
        className={cn(
          "h-6 w-6 grid place-items-center rounded transition-all shrink-0",
          isManualInternal
            ? "text-info bg-info/10"
            : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-secondary/60 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        )}>
        <RepeatIcon className="h-3 w-3" />
      </button>
    </div>
  );
};

// ── Positioned picker — rendered at root level of each view ───
const PositionedPicker = ({ txn, pos, overrides, getRuleCategory, customCategories, onSelect, onAddCategory, onAddRule, onRemoveCustom, onClose }: {
  txn: PTxn; pos:{x:number;y:number};
  overrides:Record<string,string>; getRuleCategory:(m:string|null)=>string|null;
  customCategories:{name:string;type:"income"|"expense"}[];
  onSelect:(id:string,cat:string)=>void; onAddCategory:(n:string,t:"income"|"expense")=>void;
  onAddRule:(m:string,c:string)=>void; onRemoveCustom:(n:string)=>void; onClose:()=>void;
}) => {
  const rawCat = getEffectiveCategory(txn, overrides, getRuleCategory);
  const isMobile = window.innerWidth < 640;
  const y = isMobile ? undefined : (pos.y + 280 > window.innerHeight ? Math.max(pos.y - 290, 8) : pos.y);
  const x = isMobile ? undefined : Math.min(Math.max(pos.x, 8), window.innerWidth - 274);
  const mobileStyle = isMobile ? {position:"fixed" as const,inset:"auto 8px 8px 8px",zIndex:9999} : {position:"fixed" as const,left:x,top:y,zIndex:9999};
  return (
    <div style={mobileStyle}>
      <InlineCategoryPicker txn={txn} current={rawCat??"Other"}
        existingRule={getRuleCategory(txn.merchant_name??txn.name??null)??undefined}
        customCategories={customCategories}
        onSelect={cat=>onSelect(txn.id,cat)}
        onAddCategory={onAddCategory} onAddRule={onAddRule} onRemoveCustom={onRemoveCustom} onClose={onClose} />
    </div>
  );
};

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
            <span className={cn("text-[9px] tabular px-1.5 py-0.5 rounded-full font-medium",
              up?"bg-negative/12 text-negative":"bg-positive/12 text-positive")}>
              {up?"+":""}{deltaPct}%
            </span>
          )}
          {!!budget && (
            <span className={cn("text-[9px] tabular px-1.5 py-0.5 rounded-full",
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
      <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">{label}</div>
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
          0% APR promo expired — interest now applies
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
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-positive/30 bg-positive/10 text-positive shrink-0">0% APR</span>
          )}
          {a.subtype === "savings" && isHYSA(a, instName, meta.apr) && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-positive/30 bg-positive/10 text-positive shrink-0">High Yield</span>
          )}
          {dueDaysAway != null && dueDaysAway <= 7 && (
            <span className={cn("text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border shrink-0",
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
  onSelect, defaultOpen=true,
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
                      <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground font-medium">{g.label}</span>
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
      { label: "$5/mo DoorDash DashPass", amount: 60, howTo: "Activate via Chase offers — $5/mo DashPass credit" },
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
      { label: "$200 airline fee credit", amount: 200, howTo: "Select one airline — applies to incidental fees" },
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
              {hysa && <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-positive/30 text-positive bg-positive/10">High Yield</span>}
              {isCredit && credit?.is_overdue && <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-negative/30 text-negative bg-negative/10">Overdue</span>}
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
                        <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Statement balance</div>
                        <div className="font-display text-[15px] mt-1 tabular text-warning">{fmtUSD(credit.last_statement_balance)}</div>
                      </div>
                    )}
                    {dueDate && (
                      <div className={cn("surface-card p-3", credit?.is_overdue && "border border-negative/30")}>
                        <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Payment due</div>
                        <div className={cn("font-display text-[15px] mt-1", credit.is_overdue ? "text-negative" : dueSoon ? "text-warning" : "text-foreground")}>
                          {dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          {dueSoon && !credit?.is_overdue && <span className="ml-1 text-[9px] text-warning font-normal">soon</span>}
                        </div>
                      </div>
                    )}
                    {credit?.minimum_payment_amount != null && (
                      <div className="surface-card p-3">
                        <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Min payment</div>
                        <div className="font-display text-[15px] mt-1 tabular">{fmtUSD(credit.minimum_payment_amount)}</div>
                      </div>
                    )}
                    {credit?.last_payment_amount != null && (
                      <div className="surface-card p-3">
                        <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Last payment</div>
                        <div className="font-display text-[15px] mt-1 tabular text-positive">{fmtUSD(credit.last_payment_amount)}</div>
                      </div>
                    )}
                  </div>
                )}
                {!credit && itemId && (
                  <div className="surface-card p-3">
                    <div className="text-[11px] text-muted-foreground mb-2">
                      This card was linked before statement balance, due date, and APR tracking existed — grant a bit of extra access to unlock it.
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
                    0% promo APR expired — regular APR now applies
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
                        <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground mb-0.5">Best used for</div>
                        <div className="text-[12.5px] text-foreground">{cardInfo.bestFor}</div>
                      </div>
                      <div>
                        <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground mb-0.5">Rewards</div>
                        <div className="text-[12.5px] text-foreground leading-relaxed">{cardInfo.rewards}</div>
                      </div>
                      {cardInfo.notes && (
                        <div>
                          <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground mb-0.5">Special perks</div>
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
                      <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">30-day flow</div>
                      <div className={cn("font-display text-[15px] mt-1 tabular flex items-center gap-1", trendGood ? "text-positive" : "text-negative")}>
                        {netFlow30 > 0 ? <TrendingUp className="h-3 w-3"/> : <TrendingDown className="h-3 w-3"/>}
                        {netFlow30 > 0 ? "+" : ""}{fmtUSD(Math.abs(netFlow30), { compact: true })}
                      </div>
                    </div>
                  )}
                  {aprRate != null && (
                    <div className="surface-card p-3">
                      <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">APY</div>
                      <div className="font-display text-[15px] mt-1 tabular text-positive">{aprRate.toFixed(2)}%</div>
                    </div>
                  )}
                  {aprRate != null && (
                    <div className="surface-card p-3">
                      <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Est. annual yield</div>
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
                <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">30-day change</div>
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

// ── Main props ─────────────────────────────────────────────────
interface Props {
  onAddAccount: ()=>void;
  hasItems: boolean;
  view?: string;
  syncTrigger?: number;
  onSyncingChange?: (v:boolean)=>void;
  selectedCategory?: string|null;
  onCategorySelect?: (cat:string)=>void;
}

export const LivePlaidDashboard = ({
  onAddAccount, hasItems, view="overall",
  syncTrigger=0, onSyncingChange,
  selectedCategory, onCategorySelect,
}: Props) => {
  const { user } = useAuth();
  const { budgets, setBudget, removeBudget } = useBudgets();
  const { overrides, setOverride, bulkSetOverride, reassignCategory } = useCategoryOverrides();
  const { rules, addRule, getRuleCategory } = useCategoryRules();
  const { custom: customCategories, addCategory, removeCategory } = useCustomCategories();

  const [loading, setLoading]       = useState(true);
  const [syncing, setSyncing]       = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date|null>(null);
  const [accounts, setAccounts]     = useState<PAccount[]>([]);
  const [items, setItems]           = useState<PItem[]>([]);
  const [creditDetails, setCreditDetails] = useState<CreditDetail[]>([]);
  const [txns, setTxns]             = useState<PTxn[]>([]);
  const [accountMeta, setAccountMeta] = useState<Record<string, AccountMeta>>(loadAllMeta);
  const [editingAccount, setEditingAccount] = useState<PAccount | null>(null);
  const [detailAccount, setDetailAccount] = useState<PAccount | null>(null);
  const [removingAccount, setRemovingAccount] = useState<PAccount | null>(null);
  const [removeConfirming, setRemoveConfirming] = useState(false);
  const [aiInsights, setAiInsights] = useState<AIInsight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [openInsight, setOpenInsight] = useState<AIInsight|null>(null);
  const [period, setPeriod]         = useState<Period>("1M");
  const [editingBudgetCat, setEditingBudgetCat] = useState<string|null>(null);
  const [budgetDraft, setBudgetDraft] = useState("");
  const [showCatManager, setShowCatManager] = useState(false);
  const [openActionItem, setOpenActionItem] = useState<ActionItem|null>(null);
  const [spendingPopup, setSpendingPopup] = useState<string|null>(null);
  const [spendPopupLimit, setSpendPopupLimit] = useState<5|10|"all">(5);
  // Period state for monthly + spending tabs
  const [monthlyPeriod, setMonthlyPeriod] = useState<PeriodState>({ granularity: "month", offset: 0 });
  const [spendingPeriod, setSpendingPeriod] = useState<PeriodState>({ granularity: "month", offset: 0 });
  // Transaction explorer (spending tab) — search / filter / sort
  const [txnSearch, setTxnSearch] = useState("");
  const [txnAccountFilter, setTxnAccountFilter] = useState<string>("all");       // account_id or "all"
  const [txnAcctTypeFilter, setTxnAcctTypeFilter] = useState<string>("all");     // all | depository | credit | investment | loan
  const [txnFlowFilter, setTxnFlowFilter] = useState<"all"|"expense"|"income">("all");
  const [txnSort, setTxnSort] = useState<"date-desc"|"date-asc"|"amount-desc"|"amount-asc">("date-desc");
  const [hideInternal, setHideInternal] = useState(false);
  const [txnLimit, setTxnLimit] = useState(150);
  // Drill-down: clicking a bar in the spend-trend chart narrows the txn list to that exact day/month
  const [chartDrillDate, setChartDrillDate] = useState<string|null>(null);   // exact "YYYY-MM-DD" (day/week/month granularity)
  const [chartDrillMonth, setChartDrillMonth] = useState<number|null>(null); // 0-11 (year granularity)
  // Ad-hoc filter builder — user-added rules on top of the standard filters
  const [customFilters, setCustomFilters] = useState<{id:string;field:"amount"|"category"|"merchant"|"account";op:"gt"|"lt"|"eq"|"contains";value:string}[]>([]);
  const [filterDraft, setFilterDraft] = useState<{field:"amount"|"category"|"merchant"|"account";op:"gt"|"lt"|"eq"|"contains";value:string}>({field:"amount",op:"gt",value:""});
  const [showFilterBuilder, setShowFilterBuilder] = useState(false);
  const [otherCatsExpanded, setOtherCatsExpanded] = useState(false);
  const [incomeExpanded, setIncomeExpanded] = useState(false);
  const BENEFITS_KEY = "sentryfi_benefits_used";
  const [benefitsUsed, setBenefitsUsed] = useState<Record<string,boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(BENEFITS_KEY) ?? "{}"); } catch { return {}; }
  });
  // Per-section loading states for selective refresh
  const [refreshingAccounts, setRefreshingAccounts] = useState(false);
  const [refreshingTxns, setRefreshingTxns] = useState(false);
  // Inline category picker — tracks which txn has the picker open + anchor position
  const [openPickerTxn, setOpenPickerTxn] = useState<PTxn|null>(null);
  const [pickerPos, setPickerPos]         = useState<{x:number;y:number}>({x:0,y:0});

  const [dismissedInsights, setDismissedInsights] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("sentryfi_dismissed_insights")??"[]")); } catch { return new Set(); }
  });
  const [dismissedActions, setDismissedActions] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("sentryfi_dismissed_actions")??"[]")); } catch { return new Set(); }
  });

  const [dismissedRecurring, setDismissedRecurring] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("sentryfi_dismissed_recurring")??"[]")); } catch { return new Set(); }
  });

  const dismissInsight = (id:string) => { const n=new Set([...dismissedInsights,id]); setDismissedInsights(n); localStorage.setItem("sentryfi_dismissed_insights",JSON.stringify([...n])); };
  const dismissAction  = (id:string) => { const n=new Set([...dismissedActions,id]);  setDismissedActions(n);  localStorage.setItem("sentryfi_dismissed_actions",JSON.stringify([...n])); };
  const dismissRecurring = (merchant: string) => { const n=new Set([...dismissedRecurring,merchant.toLowerCase()]); setDismissedRecurring(n); localStorage.setItem("sentryfi_dismissed_recurring",JSON.stringify([...n])); };
  const restoreAllRecurring = () => { setDismissedRecurring(new Set()); localStorage.removeItem("sentryfi_dismissed_recurring"); };

  // Transaction name overrides (fix Plaid merchant name mangling)
  const [nameOverrides, setNameOverrides] = useState<Record<string,string>>(() => {
    try { return JSON.parse(localStorage.getItem("sentryfi_name_overrides") ?? "{}"); } catch { return {}; }
  });
  const setNameOverride = (id: string, name: string) => {
    const next = name ? { ...nameOverrides, [id]: name } : (() => { const n={...nameOverrides}; delete n[id]; return n; })();
    setNameOverrides(next);
    localStorage.setItem("sentryfi_name_overrides", JSON.stringify(next));
  };

  // Panel order for overall dashboard (drag-and-drop)
  const DEFAULT_PANEL_ORDER = ["action-items", "saving-opps", "top-spending", "upcoming-charges"];
  const [panelOrder, setPanelOrder] = useState<string[]>(() => {
    try { const s=JSON.parse(localStorage.getItem("sentryfi_panel_order")??"null"); return Array.isArray(s)&&s.length===4&&DEFAULT_PANEL_ORDER.every(id=>s.includes(id))?s:DEFAULT_PANEL_ORDER; }
    catch { return DEFAULT_PANEL_ORDER; }
  });
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const handlePanelDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = panelOrder.indexOf(String(active.id));
      const newIdx = panelOrder.indexOf(String(over.id));
      const next = arrayMove(panelOrder, oldIdx, newIdx);
      setPanelOrder(next);
      localStorage.setItem("sentryfi_panel_order", JSON.stringify(next));
    }
  };

  const load = useCallback(async()=>{
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
      console.log("[load] accounts:", accsRes.data?.length ?? 0, "txns:", txnsRes.data?.length ?? 0, "items:", itsRes.data?.length ?? 0);
      // Apply whatever succeeded — one failing table shouldn't blank the rest
      setAccounts((accsRes.data ?? []) as PAccount[]);
      setTxns((txnsRes.data ?? []) as PTxn[]);
      setItems((itsRes.data ?? []) as PItem[]);
      setCreditDetails((cdRes.data ?? []) as CreditDetail[]);
      setAccountMeta(loadAllMeta());
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
  },[user]);

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
    // Auto-categorize newly synced transactions that have no user override
    if (synced > 0) {
      try {
        const { data: freshTxns } = await supabase
          .from("plaid_transactions")
          .select("id,name,merchant_name,amount,category")
          .eq("user_id", user.id)
          .order("date", { ascending: false })
          .limit(synced + 20);
        if (freshTxns?.length) {
          const currentOverrides: Record<string,string> = JSON.parse(localStorage.getItem("sentryfi_cat_overrides") ?? "{}");
          const toCateg = (freshTxns as { id:string; name:string|null; merchant_name:string|null; amount:number; category:string[]|null }[])
            .filter(t => !currentOverrides[t.id]);
          if (toCateg.length > 0) {
            const { data: catResult } = await supabase.functions.invoke("ai-categorize", {
              body: { transactions: toCateg, rules: [], userExamples: [] },
            });
            if (catResult?.results?.length) {
              const newOverrides = { ...currentOverrides };
              for (const r of catResult.results as { id:string; category:string }[]) {
                if (r.id && r.category) newOverrides[r.id] = r.category;
              }
              localStorage.setItem("sentryfi_cat_overrides", JSON.stringify(newOverrides));
            }
          }
        }
      } catch (e) { console.warn("[auto-categorize]", e); }
      // Also refresh insights in background after sync
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
          await supabase.from("plaid_items").delete().eq("id", itemId).eq("user_id", user.id);
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
    setAccountMeta(loadAllMeta());
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
  const assets      = accounts.filter(a=>!isDebt(a.type)).reduce((s,a)=>s+(Number(a.current_balance)||0),0);
  const liabilities = accounts.filter(a=>isDebt(a.type)).reduce((s,a)=>s+(Number(a.current_balance)||0),0);
  const netWorth    = assets-liabilities;
  const monthlyFlow = buildMonthlyFlow(txns);

  const animatedNW   = useCountUp(netWorth, 1200);
  const animatedAss  = useCountUp(assets, 1000);
  const animatedLiab = useCountUp(liabilities, 1000);

  const byBucket = (b:Bucket) => accounts.filter(a=>mapBucket(a.type,a.subtype)===b);

  // Detect internal transfers once — used to exclude them from all analysis
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const autoInternalIds = useMemo(() => detectInternalTransfers(txns), [txns]);

  // User-marked internal transfers (persisted)
  const [manualInternalIds, setManualInternalIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("sentryfi_manual_internal") ?? "[]")); } catch { return new Set(); }
  });
  const toggleManualInternal = (id: string) => {
    const n = new Set(manualInternalIds);
    if (n.has(id)) n.delete(id); else n.add(id);
    setManualInternalIds(n);
    localStorage.setItem("sentryfi_manual_internal", JSON.stringify([...n]));
  };
  const internalTxnIds = useMemo(() => new Set([...autoInternalIds, ...manualInternalIds]), [autoInternalIds, manualInternalIds]);

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
  const recurringCharges = detectRecurring(txns).filter(r => !dismissedRecurring.has(r.merchant.toLowerCase()));

  // Filtered + sorted txns for the spending-tab explorer
  const acctById = useMemo(() => {
    const m: Record<string, PAccount> = {};
    for (const a of accounts) m[a.account_id] = a;
    return m;
  }, [accounts]);

  const filteredSpendingTxns = (() => {
    let base = spendingPeriodTxns;
    if (selectedCategory) base = base.filter(t=>(getEffectiveCategory(t,overrides,getRuleCategory)??"Other")===selectedCategory);
    if (txnAccountFilter !== "all") base = base.filter(t => t.account_id === txnAccountFilter);
    if (txnAcctTypeFilter !== "all") base = base.filter(t => acctById[t.account_id]?.type === txnAcctTypeFilter);
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
    for (const f of customFilters) {
      const v = f.value.trim().toLowerCase();
      if (!v) continue;
      base = base.filter(t => {
        if (f.field === "amount") {
          const amt = Math.abs(Number(t.amount));
          const n = parseFloat(f.value);
          if (isNaN(n)) return true;
          if (f.op === "gt") return amt > n;
          if (f.op === "lt") return amt < n;
          return Math.abs(amt - n) < 0.01;
        }
        if (f.field === "category") {
          const cat = formatCat(getEffectiveCategory(t,overrides,getRuleCategory) ?? "Other").toLowerCase();
          return f.op === "eq" ? cat === v : cat.includes(v);
        }
        if (f.field === "merchant") {
          const m = (nameOverrides[t.id] ?? t.merchant_name ?? t.name ?? "").toLowerCase();
          return f.op === "eq" ? m === v : m.includes(v);
        }
        if (f.field === "account") {
          const accName = (acctById[t.account_id]?.name ?? "").toLowerCase();
          return f.op === "eq" ? accName === v : accName.includes(v);
        }
        return true;
      });
    }
    const sorted = [...base];
    if (txnSort === "date-desc")  sorted.sort((a,b)=>b.date.localeCompare(a.date));
    if (txnSort === "date-asc")   sorted.sort((a,b)=>a.date.localeCompare(b.date));
    if (txnSort === "amount-desc") sorted.sort((a,b)=>Math.abs(Number(b.amount))-Math.abs(Number(a.amount)));
    if (txnSort === "amount-asc")  sorted.sort((a,b)=>Math.abs(Number(a.amount))-Math.abs(Number(b.amount)));
    return sorted;
  })();

  // ── Tick thinning for dense charts ────────────────────────
  const nwTickEvery = { "1W":1,"1M":5,"3M":2,"1Y":1,"ALL":1 }[period];

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
      <section className="surface-elevated relative overflow-hidden px-4 py-3 md:px-5 md:py-4">
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
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Assets</div>
                <div className="font-display text-base tabular text-positive">{fmtUSD(animatedAss,{compact:true})}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Liabilities</div>
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
            <div className="surface-card p-3 relative overflow-hidden">
              <div className="pointer-events-none absolute -top-4 -right-4 h-14 w-14 rounded-full bg-negative/8 blur-xl" />
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Spent this month</div>
              <div className="font-display text-lg tabular text-foreground mt-0.5">{fmtUSD(totalSpend)}</div>
              {spendTrends.length > 0 && (() => {
                const delta = spendTrends.reduce((s,c)=>s+c.delta,0);
                return delta !== 0 ? (
                  <div className={cn("text-[9px] tabular mt-0.5", delta > 0 ? "text-negative" : "text-positive")}>
                    {delta > 0 ? "+" : ""}{fmtUSD(Math.abs(delta))} vs last mo
                  </div>
                ) : null;
              })()}
            </div>
            <div className="surface-card p-3 relative overflow-hidden">
              <div className="pointer-events-none absolute -top-4 -right-4 h-14 w-14 rounded-full bg-positive/8 blur-xl" />
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Income this month</div>
              <div className="font-display text-lg tabular text-positive mt-0.5">{fmtUSD(curMonthIncome)}</div>
              <div className="text-[9px] text-muted-foreground mt-0.5">excl. transfers</div>
            </div>
            <div className="surface-card p-3 relative overflow-hidden">
              <div className="pointer-events-none absolute -top-4 -right-4 h-14 w-14 rounded-full bg-[hsl(var(--primary)/0.08)] blur-xl" />
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Net cash flow</div>
              <div className={cn("font-display text-lg tabular mt-0.5", net >= 0 ? "text-positive" : "text-negative")}>
                {net >= 0 ? "+" : "−"}{fmtUSD(Math.abs(net))}
              </div>
              <div className="text-[9px] text-muted-foreground mt-0.5">income − spend</div>
            </div>
            <div className="surface-card p-3 relative overflow-hidden">
              <div className="pointer-events-none absolute -top-4 -right-4 h-14 w-14 rounded-full bg-info/8 blur-xl" />
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Savings rate</div>
              <div className={cn("font-display text-lg tabular mt-0.5", savingsRate != null && savingsRate >= 20 ? "text-positive" : savingsRate != null && savingsRate < 0 ? "text-negative" : "text-foreground")}>
                {savingsRate != null ? `${savingsRate}%` : "—"}
              </div>
              <div className="text-[9px] text-muted-foreground mt-0.5">{spendByCategory.length} categories</div>
            </div>
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
          onSave={m => { saveMeta(editingAccount.id, m); setAccountMeta(loadAllMeta()); }}
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

      {/* ═══ Insights into your spending ═══════════════════════ */}
      {(visibleActions.length > 0 || visibleInsights.length > 0 || spendByCategory.length > 0 || recurringCharges.length > 0) && (
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="font-display text-lg md:text-xl text-primary">Insights into your spending</h2>
            <button onClick={()=>loadInsights(true)} disabled={insightsLoading}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border-strong text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors">
              <Sparkles className={cn("h-3 w-3", insightsLoading && "animate-pulse")} />
              {insightsLoading ? "Analyzing…" : "Refresh AI"}
            </button>
          </div>

          {/* Sortable 2-col panel grid — drag the ⠿ handle to reorder */}
          {(() => {
            const panelActionItems = (dragHandle: React.HTMLAttributes<HTMLElement>) => (
              <div className="surface-card overflow-hidden flex flex-col h-full">
                <div className="px-4 py-2.5 border-b border-border/30 flex items-center gap-2">
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
                          className="group w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-surface-hover/40 transition-colors"
                          style={{borderLeft:`3px solid ${borderColor}`}}>
                          <div className={cn("h-8 w-8 rounded-xl grid place-items-center shrink-0 transition-transform group-hover:scale-105",m.text)}
                            style={{background:`${borderColor}18`, border:`1px solid ${borderColor}30`}}>
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[13px] text-foreground font-medium truncate">{item.title}</span>
                              <span className={cn("text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border shrink-0",m.chip)}>{m.label}</span>
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
                <div className="px-4 py-2.5 border-b border-border/30 flex items-center gap-2">
                  <button {...dragHandle} className="text-muted-foreground/30 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none shrink-0" title="Drag to reorder">
                    <GripVertical className="h-3.5 w-3.5" />
                  </button>
                  <h3 className="font-display text-[13px] text-primary flex-1">Saving opportunities</h3>
                  {!insightsLoading && visibleInsights.length>0 && (
                    <span className="text-[10px] font-semibold text-positive tabular bg-positive/10 px-2 py-0.5 rounded-full">
                      +${visibleInsights.reduce((s,i)=>s+(i.impactValue??0),0).toLocaleString()}/yr
                    </span>
                  )}
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
                    <Sparkles className="h-4 w-4 shrink-0 opacity-40" />Click "Refresh AI" to generate insights.
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
                <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
                  <button {...dragHandle} className="text-muted-foreground/30 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none shrink-0" title="Drag to reorder">
                    <GripVertical className="h-3.5 w-3.5" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display text-[13px] text-primary">Top Spending</h3>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{new Date().toLocaleDateString("en-US",{month:"long",year:"numeric"})} · {fmtUSD(totalSpend)}</div>
                  </div>
                  <button onClick={()=>onCategorySelect?.("")}
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
                          className="group relative w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover/40 transition-colors overflow-hidden">
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
                                  <span className={cn("text-[9px] tabular px-1.5 py-0.5 rounded-full font-medium",
                                    trend.delta>0?"bg-negative/10 text-negative":"bg-positive/10 text-positive")}>
                                    {trend.delta>0?"+":""}{trend.pct}%
                                  </span>
                                )}
                                <span className="text-[13px] tabular font-semibold">{fmtUSD(c.total)}</span>
                              </div>
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                              {topTxns[0] ? `${nameOverrides[topTxns[0].id]??topTxns[0].merchant_name??topTxns[0].name??"—"} · ${fmtUSD(Number(topTxns[0].amount))}` : `${c.count} transactions`}
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
                <div className="px-4 py-2.5 border-b border-border/30 flex items-center gap-2">
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
                      {dismissedRecurring.size > 0 && (
                        <button onClick={restoreAllRecurring} className="text-[10px] text-muted-foreground/50 hover:text-[hsl(var(--primary))] transition-colors">
                          {dismissedRecurring.size} hidden · restore
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
                        <div key={idx} className="group flex items-center gap-3 px-4 py-2.5">
                          <div className={cn("shrink-0 w-9 text-center rounded-lg py-1 border",
                            daysAway<=3?"bg-negative/10 border-negative/20":isThisWeek?"bg-warning/10 border-warning/20":"bg-secondary/50 border-border/40")}>
                            <div className="text-[8px] uppercase tracking-wide text-muted-foreground leading-none">
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
                                <span className="text-[8px] px-1.5 py-0.5 rounded-full border border-negative/30 bg-negative/10 text-negative shrink-0 font-medium">
                                  {daysAway===0?"Today":"Tomorrow"}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              <span className="text-[9.5px] text-muted-foreground/60">{r.intervalLabel}</span>
                              {sourceAcc && <><span className="text-muted-foreground/30">·</span>
                                <span className="text-[9.5px] text-muted-foreground truncate">
                                  {sourceAcc.name??""}{sourceAcc.mask?` ··${sourceAcc.mask}`:""}
                                </span></>}
                              {showBalCheck && !hasSufficient && (
                                <><span className="text-muted-foreground/30">·</span>
                                <span className="text-[9.5px] text-negative flex items-center gap-0.5">
                                  <AlertTriangle className="h-2.5 w-2.5" />Low funds
                                </span></>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[13px] tabular font-semibold text-foreground">{fmtUSD(r.avgAmount)}</div>
                            {daysAway>1 && <div className="text-[9px] text-muted-foreground tabular">{daysAway}d</div>}
                          </div>
                          <button onClick={()=>dismissRecurring(r.merchant)} title="Remove from recurring list"
                            className="opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 h-6 w-6 grid place-items-center rounded text-muted-foreground/50 hover:text-negative hover:bg-negative/10 transition-all shrink-0">
                            <X className="h-3 w-3" />
                          </button>
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

      {/* Accounts — grouped by type, banks shown within each type, all collapsed by default */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3 px-1 flex-wrap">
          <div className="flex items-baseline gap-2">
            <h2 className="font-display text-lg md:text-xl text-primary">Accounts</h2>
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
          <div className="space-y-2">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(360px,1fr))] gap-2 items-start">
              {bucketOrder.map(bucket => (
                <BucketGroup
                  key={bucket}
                  bucket={bucket}
                  accounts={accounts.filter(a => mapBucket(a.type, a.subtype) === bucket)}
                  txns={txns}
                  accountMeta={accountMeta}
                  creditDetails={creditDetails}
                  items={items}
                  onSelect={a => setDetailAccount(a)}
                  defaultOpen={true}
                />
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
                              <div className="text-[9.5px] text-muted-foreground">{new Date(t.date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
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

      {openPickerTxn && <PositionedPicker txn={openPickerTxn} pos={pickerPos} overrides={overrides} getRuleCategory={getRuleCategory} customCategories={customCategories} onSelect={(id,cat)=>setOverride(id,cat)} onAddCategory={addCategory} onAddRule={addRule} onRemoveCustom={removeCategory} onClose={()=>setOpenPickerTxn(null)} />}

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
              <DialogTitle className="sr-only">{formatCat(cat)} — current month</DialogTitle>
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
                    {label:"vs last mo",value:trend?.pct!=null?`${trend.delta>0?"+":""}${trend.pct}%`:"—",color:trend?.delta!=null?(trend.delta>0?"hsl(var(--negative))":"hsl(var(--positive))"):"hsl(var(--muted-foreground))"},
                    {label:"Avg charge",value:fmtUSD(avgTxn),color:"hsl(var(--foreground))"},
                  ].map(s=>(
                    <div key={s.label} className="surface-card p-2.5 text-center">
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
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
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-2">
                      Top charges — sorted highest to lowest ({shownTxns.length} of {catTxns.length})
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
                            className="flex-1 h-8 rounded-lg border border-border text-[11px] text-muted-foreground hover:text-foreground hover:border-border-strong transition-colors">
                            Show top 10
                          </button>
                        )}
                        {catTxns.length > (spendPopupLimit===5?5:10) && (
                          <button onClick={()=>setSpendPopupLimit("all")}
                            className="flex-1 h-8 rounded-lg border border-border text-[11px] text-muted-foreground hover:text-foreground hover:border-border-strong transition-colors">
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
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-foreground text-background px-4 py-2.5 text-xs font-medium hover:opacity-90 transition-opacity">
                  View all in Spending & Budget <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}
    </div>
  );

  // ── MONTHLY ───────────────────────────────────────────────
  if (view==="monthly") return (
    <div className="space-y-4 animate-fade-up">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-display text-xl text-primary">Monthly</h2>
        <PeriodNav state={monthlyPeriod} onChange={setMonthlyPeriod} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="surface-card p-4 relative overflow-hidden">
          <div className="pointer-events-none absolute -top-6 -right-6 h-20 w-20 rounded-full bg-positive/8 blur-2xl" />
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Income</div>
          <div className="font-display text-2xl text-positive mt-1 tabular">{fmtUSD(monthlyIncome)}</div>
          {monthlyIncome > 0 && monthlySpend > 0 && (
            <div className="text-[10px] text-muted-foreground mt-1">
              {Math.round(((monthlyIncome - monthlySpend) / monthlyIncome) * 100)}% saved
            </div>
          )}
        </div>
        <div className="surface-card p-4 relative overflow-hidden">
          <div className="pointer-events-none absolute -top-6 -right-6 h-20 w-20 rounded-full bg-negative/8 blur-2xl" />
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Spent</div>
          <div className="font-display text-2xl text-foreground mt-1 tabular">{fmtUSD(monthlySpend)}</div>
          {monthlyIncome > 0 && (
            <div className="mt-2 h-1 rounded-full bg-border/40 overflow-hidden">
              <div className="h-full rounded-full transition-all"
                style={{width:`${Math.min((monthlySpend/monthlyIncome)*100,100)}%`,
                  background: monthlySpend > monthlyIncome ? "hsl(var(--negative))" : monthlySpend/monthlyIncome > 0.8 ? "hsl(var(--warning))" : "hsl(var(--positive))"}} />
            </div>
          )}
        </div>
        <div className="col-span-2 sm:col-span-1 surface-card p-4 relative overflow-hidden">
          <div className="pointer-events-none absolute -top-6 -right-6 h-20 w-20 rounded-full bg-[hsl(var(--primary)/0.08)] blur-2xl" />
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Net</div>
          {(() => {
            const net = monthlyIncome - monthlySpend;
            return (
              <>
                <div className={cn("font-display text-2xl mt-1 tabular", net >= 0 ? "text-positive" : "text-negative")}>
                  {net >= 0 ? "+" : "−"}{fmtUSD(Math.abs(net))}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {monthlyPeriodTxns.filter(t=>!internalTxnIds.has(t.id)).length} transactions
                </div>
              </>
            );
          })()}
        </div>
      </div>
      {monthlyPeriod.granularity === "month" && monthlyPeriod.offset === 0 && (
        <div className="surface-card p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">6-month cash flow</div>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyFlow} margin={{top:0,right:0,bottom:0,left:0}} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.4} vertical={false} />
                <XAxis dataKey="m" axisLine={false} tickLine={false} tick={{fill:"hsl(var(--muted-foreground))",fontSize:9}} />
                <YAxis hide />
                <Tooltip contentStyle={{background:"hsl(var(--popover))",border:"1px solid var(--gold-border)",borderRadius:"10px",fontSize:"12px"}}
                  formatter={(v:number,n:string)=>[fmtUSD(v),n==="income"?"Income":"Spend"]} />
                <Bar dataKey="income" fill="hsl(var(--positive))" fillOpacity={0.7} radius={[3,3,0,0]} animationDuration={1000} />
                <Bar dataKey="spend"  fill="hsl(var(--negative))" fillOpacity={0.5} radius={[3,3,0,0]} animationDuration={1200} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      {/* Category breakdown for the period */}
      {monthlyPeriodTxns.length > 0 && (() => {
        const periodExpenses = monthlyPeriodTxns.filter(t=>!internalTxnIds.has(t.id)&&Number(t.amount)>0);
        const catMap: Record<string,number> = {};
        for (const t of periodExpenses) {
          const cat = getEffectiveCategory(t, overrides, getRuleCategory) ?? "Other";
          catMap[cat] = (catMap[cat]??0) + Number(t.amount);
        }
        const cats = Object.entries(catMap).sort((a,b)=>b[1]-a[1]).slice(0,6);
        const total = cats.reduce((s,[,v])=>s+v,0);
        if (cats.length === 0) return null;
        return (
          <div className="surface-card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border/20 text-[10px] uppercase tracking-wider text-muted-foreground">
              Spending by category
            </div>
            <div className="divide-y divide-border/15">
              {cats.map(([cat, amt])=>{
                const Icon = categoryIcon(cat); const color = catColor(cat);
                const pct = total > 0 ? (amt/total)*100 : 0;
                return (
                  <div key={cat} className="flex items-center gap-3 px-4 py-2.5 relative overflow-hidden">
                    <div className="pointer-events-none absolute inset-y-0 left-0 opacity-60" style={{width:`${pct}%`,background:`${color}10`}}/>
                    <div className="h-6 w-6 rounded-md grid place-items-center shrink-0" style={{backgroundColor:`${color}20`,color}}>
                      <Icon className="h-3 w-3"/>
                    </div>
                    <span className="text-[12px] text-foreground flex-1 truncate">{formatCat(cat)}</span>
                    <span className="text-[10px] text-muted-foreground tabular shrink-0">{Math.round(pct)}%</span>
                    <span className="text-[12px] tabular font-semibold text-foreground shrink-0">{fmtUSD(amt)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <section className="space-y-2">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="font-display text-lg md:text-xl text-primary">{getPeriodLabel(monthlyPeriod)}</h2>
          <span className="text-[11px] text-muted-foreground">{monthlyPeriodTxns.length} transactions</span>
        </div>
        {monthlyPeriodTxns.length===0 ? (
          <div className="surface-card p-6 text-center text-[12px] text-muted-foreground">No transactions for this period.</div>
        ) : (
          <div className="surface-card overflow-hidden"><div className="overflow-y-auto max-h-[600px]">
            {monthlyPeriodTxns.map((t,i)=><TxnRow key={t.id} t={t} i={i} overrides={overrides} getRuleCategory={getRuleCategory} customCategories={customCategories}
              openPickerId={openPickerTxn?.id??null}
              onOpenPicker={(txn,pos)=>{setOpenPickerTxn(txn);setPickerPos(pos);}}
              onClosePicker={()=>setOpenPickerTxn(null)}
              onSelect={(id,cat)=>setOverride(id,cat)}
              onAddCategory={addCategory} onAddRule={addRule} onRemoveCustom={removeCategory}
              isInternal={internalTxnIds.has(t.id)}
              isManualInternal={manualInternalIds.has(t.id)}
              onToggleInternal={toggleManualInternal}
              nameOverride={nameOverrides[t.id]} onSetName={setNameOverride} />)}
          </div></div>
        )}
      </section>
      {openPickerTxn && <PositionedPicker txn={openPickerTxn} pos={pickerPos} overrides={overrides} getRuleCategory={getRuleCategory} customCategories={customCategories} onSelect={(id,cat)=>setOverride(id,cat)} onAddCategory={addCategory} onAddRule={addRule} onRemoveCustom={removeCategory} onClose={()=>setOpenPickerTxn(null)} />}
    </div>
  );

  // ── SPENDING & BUDGET ─────────────────────────────────────
  if (view==="spending") return (
    <div className="space-y-3 animate-fade-up">
      {/* Header + period nav + manage */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-xl text-primary">Spending & Budget</h2>
          <div className="text-[11px] text-muted-foreground mt-0.5">{getPeriodLabel(spendingPeriod)}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <PeriodNav state={spendingPeriod} granularities={["day","week","month","year"]}
            onChange={p=>{setSpendingPeriod(p);setTxnLimit(150);setChartDrillDate(null);setChartDrillMonth(null);}} />
          <button onClick={()=>{
            const rows = [["Date","Name","Category","Amount","Account","Pending"]];
            for (const t of filteredSpendingTxns) {
              const acc = accounts.find(a=>a.account_id===t.account_id);
              rows.push([
                t.date,
                nameOverrides[t.id]??t.merchant_name??t.name??"",
                getEffectiveCategory(t,overrides,getRuleCategory)??"",
                String(Number(t.amount).toFixed(2)),
                `${acc?.name??""} ${acc?.mask?`··${acc.mask}`:""}`.trim(),
                t.pending?"yes":"no",
              ]);
            }
            const csv = rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
            a.download = `sentryfi-transactions-${getPeriodLabel(spendingPeriod).replace(/\s+/g,"-")}.csv`;
            a.click();
          }} className="h-7 px-2.5 rounded-md border text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1" style={{borderColor:"var(--gold-border)"}}>
            Export CSV
          </button>
          <button onClick={()=>setShowCatManager(true)}
            className="h-7 px-2.5 rounded-md border text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            style={{borderColor:"var(--gold-border)"}}>
            Manage
          </button>
        </div>
      </div>

      {/* ── Two-column page: left = spending insights + transactions, right = budget ── */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-3 items-start">

      {/* ══ LEFT COLUMN (xl:3) ══ */}
      <div className="xl:col-span-3 space-y-3">

      {/* Compact insights strip — one row, no padding-heavy cards */}
      <div className="surface-card overflow-hidden">
        <div className="flex items-stretch divide-x divide-border/20 overflow-x-auto">
          <div className="flex-1 min-w-[110px] px-3.5 py-2.5">
            <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Spent</div>
            <div className="font-display text-[15px] text-foreground mt-0.5 tabular leading-tight">{fmtUSD(spendingPeriodTotal)}</div>
            {spendDeltaPct !== null && (
              <div className={cn("text-[9.5px] tabular mt-0.5 font-medium", spendDeltaPct > 0 ? "text-negative" : "text-positive")}>
                {spendDeltaPct > 0 ? "+" : ""}{spendDeltaPct}% vs prior
              </div>
            )}
          </div>
          <div className="flex-1 min-w-[110px] px-3.5 py-2.5">
            <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Income</div>
            <div className="font-display text-[15px] text-positive mt-0.5 tabular leading-tight">{fmtUSD(spendingPeriodIncome)}</div>
            <div className="text-[9.5px] text-muted-foreground mt-0.5">excl. transfers</div>
          </div>
          <div className="flex-1 min-w-[110px] px-3.5 py-2.5">
            <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Net</div>
            <div className={cn("font-display text-[15px] mt-0.5 tabular leading-tight", spendingPeriodIncome - spendingPeriodTotal >= 0 ? "text-positive" : "text-negative")}>
              {spendingPeriodIncome - spendingPeriodTotal >= 0 ? "+" : "−"}{fmtUSD(Math.abs(spendingPeriodIncome - spendingPeriodTotal))}
            </div>
            <div className="text-[9.5px] text-muted-foreground mt-0.5">income − spend</div>
          </div>
          <div className="flex-1 min-w-[110px] px-3.5 py-2.5">
            <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Daily avg</div>
            <div className="font-display text-[15px] text-foreground mt-0.5 tabular leading-tight">{fmtUSD(spendingDailyAvg)}</div>
            <div className="text-[9.5px] text-muted-foreground mt-0.5">{spendingPeriodByCategory.length} cat · {Object.keys(budgets).length} budgeted</div>
          </div>
        </div>
      </div>

      {/* ── Spend trend + pie: side-by-side panel ── */}
      {spendingPeriodExpenses.length > 0 && (() => {
        // Build trend buckets
        const { start, end } = getPeriodRange(spendingPeriod);
        const todayMs = new Date().setHours(0,0,0,0);
        type Bkt = { label: string; total: number; isCurrent: boolean; dateKey?: string; monthIdx?: number };
        const bkts: Bkt[] = [];
        if (spendingPeriod.granularity === "day") {
          // For a single day just show a single bar
          bkts.push({ label: "Today", total: Math.round(spendingPeriodTotal), isCurrent: true });
        } else if (spendingPeriod.granularity === "year") {
          const byMonth: Record<number,number> = {};
          for (const t of spendingPeriodExpenses) {
            const m = new Date(t.date+"T00:00:00").getMonth();
            byMonth[m] = (byMonth[m]??0) + Number(t.amount);
          }
          for (let m=0;m<12;m++) bkts.push({
            label: new Date(2000,m,1).toLocaleDateString("en-US",{month:"short"}),
            total: Math.round(byMonth[m]??0),
            isCurrent: spendingPeriod.offset===0 && m===new Date().getMonth(),
            monthIdx: m,
          });
        } else {
          const byDate: Record<string,number> = {};
          for (const t of spendingPeriodExpenses) byDate[t.date]=(byDate[t.date]??0)+Number(t.amount);
          for (const d=new Date(start); d<=end; d.setDate(d.getDate()+1)) {
            const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
            bkts.push({
              label: spendingPeriod.granularity==="week" ? d.toLocaleDateString("en-US",{weekday:"short"}) : String(d.getDate()),
              total: Math.round(byDate[key]??0),
              isCurrent: d.getTime()===todayMs,
              dateKey: key,
            });
          }
        }

        // Build pie slices (top 6 + "Other")
        const TOP_N = 6;
        const pieSlices = spendingPeriodByCategory.slice(0, TOP_N).map(c=>({
          name: formatCat(c.category), value: c.total, color: catColor(c.category),
        }));
        if (spendingPeriodByCategory.length > TOP_N) {
          const rest = spendingPeriodByCategory.slice(TOP_N).reduce((s,c)=>s+c.total,0);
          pieSlices.push({ name:"Other", value: rest, color:"hsl(var(--muted-foreground))" });
        }

        const TrendTip = ({ active, payload, label }: any) => {
          if (!active || !payload?.length) return null;
          return (
            <div className="surface-elevated border border-border/60 rounded-lg px-3 py-2 shadow-xl text-[11px]">
              <div className="text-muted-foreground mb-0.5">{label}</div>
              <div className="text-foreground font-semibold tabular">{fmtUSD(payload[0].value)}</div>
            </div>
          );
        };
        const PieTip = ({ active, payload }: any) => {
          if (!active || !payload?.length) return null;
          const p = payload[0];
          return (
            <div className="surface-elevated border border-border/60 rounded-lg px-3 py-2 shadow-xl text-[11px]">
              <div className="text-muted-foreground mb-0.5">{p.name}</div>
              <div className="text-foreground font-semibold tabular">{fmtUSD(p.value)}</div>
              <div className="text-muted-foreground">{spendingPeriodTotal>0?Math.round((p.value/spendingPeriodTotal)*100):0}%</div>
            </div>
          );
        };

        return (
          <div className="surface-card p-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Spend trend bar chart */}
              <div className={cn("pr-0 sm:pr-3", "sm:border-r sm:border-border/20")}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10.5px] font-semibold text-foreground">
                    {spendingPeriod.granularity==="year"?"Monthly breakdown":"Daily breakdown"}
                    <span className="ml-1 font-normal text-muted-foreground/60">· click a bar</span>
                  </div>
                  {spendDeltaPct!==null && (
                    <div className={cn("text-[9.5px] tabular font-medium", spendDeltaPct>0?"text-negative":"text-positive")}>
                      {spendDeltaPct>0?"+":""}{spendDeltaPct}% vs prior
                    </div>
                  )}
                </div>
                <div className="h-20">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={bkts} margin={{top:2,right:0,bottom:0,left:0}} barCategoryGap="30%"
                      style={{cursor:"pointer"}}
                      onClick={(state:any)=>{
                        const idx = state?.activeTooltipIndex;
                        if (idx==null) return;
                        const b: Bkt|undefined = bkts[idx];
                        if (!b) return;
                        if (b.dateKey) setChartDrillDate(prev=>prev===b.dateKey?null:b.dateKey!);
                        else if (b.monthIdx!=null) setChartDrillMonth(prev=>prev===b.monthIdx?null:b.monthIdx!);
                      }}>
                      <CartesianGrid strokeDasharray="3 6" stroke="hsl(var(--border))" strokeOpacity={0.25} vertical={false} />
                      <XAxis dataKey="label" axisLine={false} tickLine={false}
                        interval={spendingPeriod.granularity==="month" ? Math.floor(bkts.length/8) : 0}
                        tick={{ fontSize:8.5, fill:"hsl(var(--muted-foreground))", fontFamily:"inherit" }} />
                      <YAxis hide domain={[0,"dataMax+50"]} />
                      <Tooltip content={<TrendTip />} cursor={{ fill:"hsl(var(--foreground))", fillOpacity:0.06 }} />
                      <Bar dataKey="total" radius={[2,2,0,0]} animationDuration={500}>
                        {bkts.map((b,idx)=>{
                          const isDrilled = (!!b.dateKey && b.dateKey===chartDrillDate) || (b.monthIdx!=null && b.monthIdx===chartDrillMonth);
                          return (
                            <Cell key={idx}
                              fill={isDrilled ? "hsl(var(--negative))" : "hsl(var(--primary))"}
                              fillOpacity={isDrilled || b.isCurrent ? 1 : 0.45} />
                          );
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {(chartDrillDate || chartDrillMonth!=null) && (
                  <button onClick={()=>{setChartDrillDate(null);setChartDrillMonth(null);}}
                    className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-medium border border-negative/30 bg-negative/10 text-negative">
                    {chartDrillDate ? new Date(chartDrillDate+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}) : new Date(2000,chartDrillMonth!,1).toLocaleDateString("en-US",{month:"long"})}
                    <X className="h-2.5 w-2.5"/>
                  </button>
                )}
              </div>

              {/* Spending donut pie */}
              <div>
                <div className="text-[10.5px] font-semibold text-foreground mb-2">By Category · {spendingPeriodByCategory.length}</div>
                <div className="flex items-center gap-2.5">
                  <div className="shrink-0" style={{width:84,height:84}}>
                    <PieChart width={84} height={84}>
                      <Pie data={pieSlices} cx={40} cy={40} innerRadius={22} outerRadius={38}
                        dataKey="value" paddingAngle={2} animationDuration={500} animationBegin={0}>
                        {pieSlices.map((s,idx)=>(
                          <Cell key={idx} fill={s.color}
                            opacity={selectedCategory && s.name!==formatCat(selectedCategory??"")?0.4:1}/>
                        ))}
                      </Pie>
                      <Tooltip content={<PieTip />} />
                    </PieChart>
                  </div>
                  <div className="flex-1 min-w-0 space-y-0.5 max-h-[78px] overflow-y-auto">
                    {pieSlices.map(s=>(
                      <div key={s.name} className="flex items-center gap-1.5 text-[9.5px]">
                        <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{background:s.color}}/>
                        <span className="truncate text-muted-foreground">{s.name}</span>
                        <span className="tabular text-foreground font-medium ml-auto shrink-0">{spendingPeriodTotal>0?Math.round((s.value/spendingPeriodTotal)*100):0}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

        {/* ── Transaction explorer ── */}
        <div className="surface-card overflow-hidden">
          {/* Toolbar */}
          <div className="px-3.5 py-2.5 border-b border-border/20 space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/40" />
                <input value={txnSearch} onChange={e=>{setTxnSearch(e.target.value);setTxnLimit(150);}}
                  placeholder="Search transactions…"
                  className="w-full h-8 pl-7 pr-7 rounded-lg bg-secondary/40 border border-border/40 text-[11.5px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-[hsl(var(--primary)/0.5)] transition-colors" />
                {txnSearch && <button onClick={()=>setTxnSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground"><X className="h-3 w-3" /></button>}
              </div>
              <select value={txnSort} onChange={e=>setTxnSort(e.target.value as typeof txnSort)}
                className="h-8 rounded-lg bg-card border border-border/50 text-[11px] text-muted-foreground px-2 focus:outline-none focus:border-[hsl(var(--primary)/0.4)] cursor-pointer appearance-none">
                <option value="date-desc">Newest</option>
                <option value="date-asc">Oldest</option>
                <option value="amount-desc">Largest</option>
                <option value="amount-asc">Smallest</option>
              </select>
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {(["all","expense","income"] as const).map(f=>(
                <button key={f} onClick={()=>{setTxnFlowFilter(f);setTxnLimit(150);}}
                  className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors",
                    txnFlowFilter===f?"bg-foreground text-background border-foreground":"border-border/40 text-muted-foreground hover:text-foreground")}>
                  {f==="all"?"All":f==="expense"?"Expenses":"Income"}
                </button>
              ))}
              <span className="w-px h-3 bg-border/40"/>
              {[...new Set(accounts.map(a=>a.type).filter(Boolean))].map(ty=>{
                const LABEL:Record<string,string>={depository:"Cash",credit:"Credit",investment:"Invest.",loan:"Loans",brokerage:"Invest."};
                return (
                  <button key={ty} onClick={()=>{setTxnAcctTypeFilter(txnAcctTypeFilter===ty?"all":ty);setTxnAccountFilter("all");setTxnLimit(150);}}
                    className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors",
                      txnAcctTypeFilter===ty?"bg-[hsl(var(--primary)/0.15)] text-gold border-[hsl(var(--primary)/0.3)]":"border-border/40 text-muted-foreground hover:text-foreground")}>
                    {LABEL[ty]??ty}
                  </button>
                );
              })}
              <span className="w-px h-3 bg-border/40"/>
              <select value={txnAccountFilter} onChange={e=>{setTxnAccountFilter(e.target.value);setTxnLimit(150);}}
                className="h-6 rounded-full bg-card border border-border/40 text-[10px] text-muted-foreground px-2 focus:outline-none cursor-pointer appearance-none max-w-[140px]">
                <option value="all">All accounts</option>
                {accounts.map(a=>(<option key={a.account_id} value={a.account_id}>{(a.name??"Acct").slice(0,20)}{a.mask?` ··${a.mask}`:""}</option>))}
              </select>
              <button onClick={()=>setHideInternal(!hideInternal)}
                className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors",
                  hideInternal?"bg-secondary text-foreground border-border":"border-border/40 text-muted-foreground hover:text-foreground")}>
                {hideInternal?<EyeOff className="h-2.5 w-2.5"/>:<Eye className="h-2.5 w-2.5"/>} Internal
              </button>
              {selectedCategory && (
                <button onClick={()=>onCategorySelect?.("")}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border"
                  style={{background:`${catColor(selectedCategory)}12`,borderColor:`${catColor(selectedCategory)}35`,color:catColor(selectedCategory)}}>
                  {formatCat(selectedCategory)} <X className="h-2.5 w-2.5"/>
                </button>
              )}
              <span className="w-px h-3 bg-border/40"/>
              {customFilters.map(f=>(
                <button key={f.id} onClick={()=>setCustomFilters(cs=>cs.filter(x=>x.id!==f.id))}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border bg-[hsl(var(--primary)/0.1)] border-[hsl(var(--primary)/0.3)] text-gold">
                  {f.field} {f.op==="gt"?">":f.op==="lt"?"<":f.op==="eq"?"=":"~"} {f.field==="amount"?fmtUSD(parseFloat(f.value)||0):f.value}
                  <X className="h-2.5 w-2.5"/>
                </button>
              ))}
              <button onClick={()=>setShowFilterBuilder(v=>!v)}
                className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors",
                  showFilterBuilder?"bg-secondary text-foreground border-border":"border-border/40 text-muted-foreground hover:text-foreground")}>
                <Plus className="h-2.5 w-2.5"/> Filter
              </button>
            </div>

            {showFilterBuilder && (
              <form onSubmit={e=>{
                e.preventDefault();
                if (!filterDraft.value.trim()) return;
                setCustomFilters(cs=>[...cs, { ...filterDraft, id: `${Date.now()}` }]);
                setFilterDraft({field:"amount",op:"gt",value:""});
                setTxnLimit(150);
              }} className="flex items-center gap-1.5 p-2 rounded-lg bg-secondary/30 border border-border/30">
                <select value={filterDraft.field} onChange={e=>setFilterDraft(d=>({...d,field:e.target.value as typeof d.field}))}
                  className="h-7 rounded-md bg-card border border-border/50 text-[10.5px] text-foreground px-1.5 focus:outline-none cursor-pointer">
                  <option value="amount">Amount</option>
                  <option value="category">Category</option>
                  <option value="merchant">Merchant</option>
                  <option value="account">Account</option>
                </select>
                <select value={filterDraft.op} onChange={e=>setFilterDraft(d=>({...d,op:e.target.value as typeof d.op}))}
                  className="h-7 rounded-md bg-card border border-border/50 text-[10.5px] text-foreground px-1.5 focus:outline-none cursor-pointer">
                  {filterDraft.field==="amount" ? (
                    <><option value="gt">&gt;</option><option value="lt">&lt;</option><option value="eq">=</option></>
                  ) : (
                    <><option value="contains">contains</option><option value="eq">is exactly</option></>
                  )}
                </select>
                <input value={filterDraft.value} onChange={e=>setFilterDraft(d=>({...d,value:e.target.value}))}
                  type={filterDraft.field==="amount"?"number":"text"}
                  placeholder={filterDraft.field==="amount"?"e.g. 50":"e.g. coffee"}
                  className="flex-1 h-7 rounded-md bg-card border border-border/50 text-[10.5px] text-foreground px-2 focus:outline-none focus:border-[hsl(var(--primary)/0.5)]" />
                <button type="submit" className="h-7 px-2.5 rounded-md bg-gold text-[10.5px] font-medium hover:opacity-90 shrink-0">Add</button>
              </form>
            )}

            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{filteredSpendingTxns.length} transaction{filteredSpendingTxns.length!==1?"s":""}</span>
              <span className="tabular">{(()=>{
                const out=filteredSpendingTxns.filter(t=>Number(t.amount)>0).reduce((s,t)=>s+Number(t.amount),0);
                const inn=filteredSpendingTxns.filter(t=>Number(t.amount)<0).reduce((s,t)=>s+Math.abs(Number(t.amount)),0);
                return <>{inn>0&&<span className="text-positive">+{fmtUSD(inn)}</span>}{inn>0&&out>0&&<span className="mx-1 text-border">·</span>}{out>0&&<span>−{fmtUSD(out)}</span>}</>;
              })()}</span>
            </div>
          </div>

          {/* Transaction list grouped by day */}
          {filteredSpendingTxns.length===0 ? (
            <div className="p-8 text-center text-[12px] text-muted-foreground">No transactions match these filters.</div>
          ) : (()=>{
            const shown=filteredSpendingTxns.slice(0,txnLimit);
            const isDateSort=txnSort.startsWith("date");
            const dayLabel=(ds:string)=>{
              const d=new Date(ds+"T00:00:00"),t=new Date();t.setHours(0,0,0,0);
              const diff=Math.round((t.getTime()-d.getTime())/86400000);
              if(diff===0)return"Today";if(diff===1)return"Yesterday";
              return d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
            };
            const renderRow=(t:PTxn,i:number)=>(
              <TxnRow key={t.id} t={t} i={i} overrides={overrides} getRuleCategory={getRuleCategory} customCategories={customCategories}
                openPickerId={openPickerTxn?.id??null}
                onOpenPicker={(txn,pos)=>{setOpenPickerTxn(txn);setPickerPos(pos);}}
                onClosePicker={()=>setOpenPickerTxn(null)}
                onSelect={(id,cat)=>setOverride(id,cat)}
                onAddCategory={addCategory} onAddRule={addRule} onRemoveCustom={removeCategory}
                isInternal={internalTxnIds.has(t.id)}
                isManualInternal={manualInternalIds.has(t.id)}
                onToggleInternal={toggleManualInternal}
                nameOverride={nameOverrides[t.id]} onSetName={setNameOverride} />
            );
            let content:React.ReactNode;
            if(isDateSort){
              const groups:{date:string;txns:PTxn[]}[]=[];
              for(const t of shown){const last=groups[groups.length-1];if(last&&last.date===t.date)last.txns.push(t);else groups.push({date:t.date,txns:[t]});}
              content=groups.map(g=>{
                const daySpend=g.txns.filter(t=>Number(t.amount)>0&&!internalTxnIds.has(t.id)).reduce((s,t)=>s+Number(t.amount),0);
                return(
                  <Fragment key={g.date}>
                    <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-1 bg-card/96 backdrop-blur-sm border-b border-border/20">
                      <span className="text-[9.5px] uppercase tracking-widest text-muted-foreground font-semibold">{dayLabel(g.date)}</span>
                      {daySpend>0&&<span className="text-[9.5px] tabular text-muted-foreground">−{fmtUSD(daySpend)}</span>}
                    </div>
                    {g.txns.map((t,i)=>renderRow(t,i))}
                  </Fragment>
                );
              });
            }else{content=shown.map((t,i)=>renderRow(t,i));}
            return(
              <div className="overflow-y-auto max-h-[680px]">
                {content}
                {filteredSpendingTxns.length>txnLimit&&(
                  <button onClick={()=>setTxnLimit(l=>l+150)} className="w-full py-2.5 text-[11px] text-muted-foreground hover:text-foreground border-t border-border/20 transition-colors">
                    Show {Math.min(150,filteredSpendingTxns.length-txnLimit)} more ({filteredSpendingTxns.length-txnLimit} remaining)
                  </button>
                )}
              </div>
            );
          })()}
        </div>

      </div>
      {/* ══ END LEFT COLUMN ══ */}

      {/* ══ RIGHT COLUMN (xl:2) — Income + Spending Budget + Summary ══ */}
      <div className="xl:col-span-2 space-y-3">
      {(() => {
        const periodIncomeTxns = spendingPeriodTxns.filter(t => !internalTxnIds.has(t.id) && Number(t.amount) < 0);
        const totalIncome = periodIncomeTxns.reduce((s,t)=>s+Math.abs(Number(t.amount)),0);
        const incomeByCat: Record<string,{total:number;count:number}> = {};
        for (const t of periodIncomeTxns) {
          const cat = getEffectiveCategory(t,overrides,getRuleCategory) ?? "Other income";
          if (!incomeByCat[cat]) incomeByCat[cat] = {total:0,count:0};
          incomeByCat[cat].total += Math.abs(Number(t.amount));
          incomeByCat[cat].count += 1;
        }
        const incomeSources = Object.entries(incomeByCat).map(([category,v])=>({category,...v})).sort((a,b)=>b.total-a.total);

        const budgetedCats = spendingPeriodByCategory.filter(c=>!!budgets[c.category]);
        const otherCats = spendingPeriodByCategory.filter(c=>!budgets[c.category]);
        const totalBudgetAllocated = budgetedCats.reduce((s,c)=>s+(budgets[c.category]??0),0);
        const totalBudgetedSpend = budgetedCats.reduce((s,c)=>s+c.total,0);
        const totalOtherSpend = otherCats.reduce((s,c)=>s+c.total,0);
        const overCount = budgetedCats.filter(c=>c.total>budgets[c.category]).length;
        const remainingToBudget = totalIncome - totalBudgetAllocated;
        const actualRemaining = totalIncome - spendingPeriodTotal;

        return (
        <>
          {/* ── Income ── */}
          <div className="surface-card overflow-hidden">
            <button onClick={()=>setIncomeExpanded(v=>!v)} className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface-hover/30 transition-colors">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-[13px] text-primary">Income</h3>
                <span className="text-[10px] text-muted-foreground">{incomeSources.length} source{incomeSources.length!==1?"s":""}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] tabular font-semibold text-positive">+{fmtUSD(totalIncome)}</span>
                <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", incomeExpanded && "rotate-180")} />
              </div>
            </button>
            {incomeExpanded && (
              incomeSources.length === 0 ? (
                <div className="px-4 py-4 text-center text-[11.5px] text-muted-foreground border-t border-border/20">No income detected this period.</div>
              ) : (
                <div className="divide-y divide-border/20 border-t border-border/20 max-h-[220px] overflow-y-auto">
                  {incomeSources.map(s=>{
                    const Icon=categoryIcon(s.category); const color=catColor(s.category);
                    return (
                      <div key={s.category} className="flex items-center gap-2.5 px-3.5 py-2">
                        <div className="h-6 w-6 rounded-md grid place-items-center shrink-0" style={{backgroundColor:`${color}1f`,color}}>
                          <Icon className="h-3 w-3" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11.5px] text-foreground font-medium truncate">{formatCat(s.category)}</div>
                          <div className="text-[9.5px] text-muted-foreground">{s.count} txn{s.count!==1?"s":""}</div>
                        </div>
                        <span className="text-[12px] tabular font-semibold text-positive shrink-0">+{fmtUSD(s.total)}</span>
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>

          {/* ── Spending Budget ── */}
          <div className="surface-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border/30">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-display text-[13px] text-primary">Spending Budget</h3>
                <span className="text-[10px] text-muted-foreground">{budgetedCats.length}/{spendingPeriodByCategory.length} categories</span>
              </div>
              {totalBudgetAllocated > 0 && (
                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-muted-foreground">Monthly budget used</span>
                    <span className={cn("tabular font-medium", totalBudgetedSpend > totalBudgetAllocated ? "text-negative" : "text-foreground")}>
                      {fmtUSD(totalBudgetedSpend)} <span className="text-muted-foreground font-normal">/ {fmtUSD(totalBudgetAllocated)}</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-border/40 overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{
                      width:`${Math.min((totalBudgetedSpend/totalBudgetAllocated)*100,100)}%`,
                      backgroundColor: totalBudgetedSpend > totalBudgetAllocated ? "hsl(var(--negative))" : totalBudgetedSpend/totalBudgetAllocated > 0.8 ? "hsl(var(--warning))" : "hsl(var(--positive))"
                    }}/>
                  </div>
                  {overCount > 0 && (
                    <div className="mt-1.5 text-[10px] text-negative font-medium">{overCount} categor{overCount===1?"y":"ies"} over budget</div>
                  )}
                </div>
              )}
            </div>

            {spendingPeriodByCategory.length === 0 ? (
              <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">No spending this period.</div>
            ) : (
              <div className="max-h-[440px] overflow-y-auto">
                {/* Budgeted categories — specific, editable */}
                {budgetedCats.length > 0 && (
                  <div className="divide-y divide-border/20">
                    {budgetedCats.map(c=>{
                      const Icon=categoryIcon(c.category); const color=catColor(c.category);
                      const budget=budgets[c.category]; const pct=budget?(c.total/budget)*100:0;
                      const over=budget&&c.total>budget; const near=budget&&!over&&pct>=70;
                      const isSelected = selectedCategory === c.category;
                      const sharePct = spendingPeriodTotal>0 ? (c.total/spendingPeriodTotal)*100 : 0;
                      const isEditing = editingBudgetCat === c.category;
                      return (
                        <div key={c.category} className={cn("group relative overflow-hidden", isSelected ? "bg-surface-hover/60" : "")}>
                          <div className="pointer-events-none absolute inset-y-0 left-0" style={{width:`${sharePct}%`,background:`${color}0a`}} />
                          {isSelected && <div className="absolute inset-y-0 left-0 w-0.5" style={{background:color}} />}
                          <button
                            onClick={()=>onCategorySelect?.(isSelected ? "" : c.category)}
                            className="relative w-full flex items-center gap-2.5 px-3.5 pt-2.5 pb-1.5 text-left transition-colors hover:bg-surface-hover/30">
                            <div className="h-7 w-7 rounded-lg grid place-items-center shrink-0" style={{backgroundColor:`${color}1f`,color}}>
                              <Icon className="h-3.5 w-3.5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className={cn("text-[12px] truncate", isSelected ? "text-foreground font-semibold" : "text-foreground font-medium")}>{formatCat(c.category)}</span>
                                <span className="text-[12px] tabular font-semibold shrink-0">{fmtUSD(c.total)}</span>
                              </div>
                              <div className="flex items-center justify-between gap-2 mt-0.5">
                                <span className="text-[9.5px] text-muted-foreground">{c.count} txn{c.count!==1?"s":""} · {Math.round(sharePct)}%</span>
                                {!!budget && !isEditing && (
                                  <span className={cn("text-[9.5px] tabular", over?"text-negative font-medium":near?"text-warning":"text-muted-foreground")}>
                                    {over ? `${fmtUSD(c.total-budget)} over` : `${fmtUSD(budget-c.total)} left`}
                                  </span>
                                )}
                              </div>
                              {!!budget && !isEditing && (
                                <div className="mt-1 h-0.5 rounded-full bg-border/40 overflow-hidden">
                                  <div className="h-full rounded-full" style={{width:`${Math.min(pct,100)}%`,backgroundColor:over?"hsl(var(--negative))":near?"hsl(var(--warning))":color}}/>
                                </div>
                              )}
                            </div>
                          </button>
                          {/* Budget row — always visible */}
                          <div className="relative px-3.5 pb-2.5 flex items-center gap-2">
                            {isEditing ? (
                              <form className="flex items-center gap-1.5 w-full" onSubmit={e=>{
                                e.preventDefault();
                                const n=parseFloat(budgetDraft);
                                if(!isNaN(n)&&n>=0){setBudget(c.category,n);}
                                setEditingBudgetCat(null);setBudgetDraft("");
                              }}>
                                <span className="text-[11px] text-muted-foreground shrink-0">Budget/mo</span>
                                <div className="relative flex-1">
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-[11px]">$</span>
                                  <input
                                    autoFocus
                                    type="number" min={0} step={10}
                                    value={budgetDraft}
                                    onChange={e=>setBudgetDraft(e.target.value)}
                                    onKeyDown={e=>{ if(e.key==="Escape"){setEditingBudgetCat(null);setBudgetDraft("");} }}
                                    placeholder={budget?String(budget):"e.g. 200"}
                                    className="w-full h-7 pl-5 pr-2 rounded-md bg-surface/60 border border-[hsl(var(--primary)/0.4)] text-[11px] text-foreground outline-none focus:border-[hsl(var(--primary))] transition-colors"
                                  />
                                </div>
                                <button type="submit" className="h-7 px-2.5 rounded-md bg-gold text-[11px] font-medium hover:opacity-90 shrink-0">Save</button>
                                {!!budget && (
                                  <button type="button" onClick={()=>{removeBudget(c.category);setEditingBudgetCat(null);setBudgetDraft("");}}
                                    className="h-7 px-2 rounded-md border border-negative/30 text-negative text-[10px] hover:bg-negative/10 shrink-0">×</button>
                                )}
                                <button type="button" onClick={()=>{setEditingBudgetCat(null);setBudgetDraft("");}}
                                  className="h-7 px-2 rounded-md border border-border/50 text-muted-foreground text-[10px] hover:text-foreground shrink-0">Cancel</button>
                              </form>
                            ) : (
                              <button
                                onClick={e=>{e.stopPropagation();setEditingBudgetCat(c.category);setBudgetDraft(budget?String(budget):"");}}
                                className="ml-9 text-[10px] tabular flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
                                <span className="text-muted-foreground/50">Budget</span> {fmtUSD(budget)}/mo <span className="opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-60 text-[9px] ml-0.5">edit</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Other categories — auto-detected, unbudgeted, rolled up */}
                {otherCats.length > 0 && (
                  <div className="border-t border-border/20">
                    <button onClick={()=>setOtherCatsExpanded(v=>!v)}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-surface-hover/30 transition-colors">
                      <div className="h-7 w-7 rounded-lg grid place-items-center shrink-0 bg-secondary/50 text-muted-foreground">
                        <Coins className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-[12px] text-foreground font-medium">Other Categories</span>
                        <div className="text-[9.5px] text-muted-foreground mt-0.5">{otherCats.length} unbudgeted categor{otherCats.length!==1?"ies":"y"}</div>
                      </div>
                      <span className="text-[12px] tabular font-semibold text-muted-foreground shrink-0">{fmtUSD(totalOtherSpend)}</span>
                      <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground/60 transition-transform shrink-0", otherCatsExpanded && "rotate-180")} />
                    </button>
                    {otherCatsExpanded && (
                      <div className="divide-y divide-border/10 bg-secondary/10">
                        {otherCats.map(c=>{
                          const Icon=categoryIcon(c.category); const color=catColor(c.category);
                          const isSelected = selectedCategory === c.category;
                          return (
                            <button key={c.category} onClick={()=>onCategorySelect?.(isSelected ? "" : c.category)}
                              className={cn("w-full flex items-center gap-2.5 pl-9 pr-3.5 py-1.5 text-left hover:bg-surface-hover/30 transition-colors", isSelected && "bg-surface-hover/50")}>
                              <div className="h-5 w-5 rounded grid place-items-center shrink-0" style={{backgroundColor:`${color}1f`,color}}>
                                <Icon className="h-2.5 w-2.5" />
                              </div>
                              <span className="text-[11px] text-foreground flex-1 truncate">{formatCat(c.category)}</span>
                              <span className="text-[9.5px] text-muted-foreground shrink-0">{c.count}×</span>
                              <span className="text-[11px] tabular font-medium text-foreground shrink-0">{fmtUSD(c.total)}</span>
                              <button onClick={e=>{e.stopPropagation();setEditingBudgetCat(c.category);setBudgetDraft("");}}
                                className="text-[9px] text-muted-foreground/50 hover:text-[hsl(var(--primary))] shrink-0">+ budget</button>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Summary ── */}
          <div className="surface-card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border/20 text-[10px] uppercase tracking-wider text-muted-foreground">
              Summary · {getPeriodLabel(spendingPeriod)}
            </div>
            <div className="divide-y divide-border/15">
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-[11.5px] text-muted-foreground">Total Income</span>
                <span className="text-[12.5px] tabular font-semibold text-positive">+{fmtUSD(totalIncome)}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-[11.5px] text-muted-foreground">Total Budgeted Expenses</span>
                <span className="text-[12.5px] tabular font-semibold text-foreground">{fmtUSD(totalBudgetAllocated)}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-[11.5px] text-muted-foreground">Total Remaining Income</span>
                <span className={cn("text-[12.5px] tabular font-semibold", remainingToBudget>=0?"text-foreground":"text-negative")}>
                  {remainingToBudget>=0?"":"−"}{fmtUSD(Math.abs(remainingToBudget))}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-3 bg-secondary/20">
                <span className="text-[12px] font-medium text-foreground">{actualRemaining>=0?"Remaining this month":"Overflow this month"}</span>
                <span className={cn("text-[15px] tabular font-bold", actualRemaining>=0?"text-positive":"text-negative")}>
                  {actualRemaining>=0?"+":"−"}{fmtUSD(Math.abs(actualRemaining))}
                </span>
              </div>
            </div>
          </div>
        </>
        );
      })()}
      </div>

      </div>
      {/* ══ END two-column page ══ */}

      {openPickerTxn && <PositionedPicker txn={openPickerTxn} pos={pickerPos} overrides={overrides} getRuleCategory={getRuleCategory} customCategories={customCategories} onSelect={(id,cat)=>setOverride(id,cat)} onAddCategory={addCategory} onAddRule={addRule} onRemoveCustom={removeCategory} onClose={()=>setOpenPickerTxn(null)} />}
      <CategoryManager
        open={showCatManager} onClose={()=>setShowCatManager(false)}
        txns={txns} overrides={overrides} rules={rules} budgets={budgets}
        customCategories={customCategories}
        builtInExpense={EXPENSE_CATEGORIES} builtInIncome={INCOME_CATEGORIES}
        getEffectiveCategory={t=>getEffectiveCategory(t,overrides,getRuleCategory)}
        onSetOverride={setOverride} onBulkSetOverride={bulkSetOverride}
        onReassignCategory={reassignCategory}
        onSetBudget={setBudget} onRemoveBudget={removeBudget}
        onAddCategory={addCategory} onRemoveCategory={removeCategory}
      />
    </div>
  );

  // ── BENEFITS / DEALS ──────────────────────────────────────
  const toggleBenefit = (key: string) => {
    setBenefitsUsed(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(BENEFITS_KEY, JSON.stringify(next));
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
                <div className="px-4 py-3 border-b border-border/20 flex items-start gap-3">
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
                      <div className="text-[9.5px] text-muted-foreground">/ {fmtUSD(cardTotalCredits)}</div>
                    </div>
                  )}
                </div>

                {/* Rewards summary */}
                <div className="px-4 py-2.5 border-b border-border/15 bg-surface/30">
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
                          className={cn("w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover/30",
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

  // ── DEALS ──────────────────────────────────────────────────
  return (
    <div className="space-y-4 animate-fade-up">
      <h2 className="font-display text-xl text-primary">Deals & Offers</h2>
      <div className="surface-card p-10 text-center space-y-2">
        <Sparkles className="h-8 w-8 mx-auto text-gold mb-3" />
        <div className="font-display text-lg text-foreground">Coming soon</div>
        <div className="text-[12px] text-muted-foreground max-w-xs mx-auto">Card-specific deals and limited-time offers will appear here.</div>
      </div>
    </div>
  );
};
