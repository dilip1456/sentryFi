import { useEffect, useState, useCallback, useRef, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  ChevronLeft, RefreshCw, RepeatIcon, Receipt,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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
type ActionItem = { id: string; priority: "urgent"|"soon"|"info"; title: string; detail: string; cta: string; icon: typeof Wallet };
type AIInsight  = { id: string; severity: "high"|"medium"|"low"; category: string; title: string; what: string; why: string; action: string; impact: string; impactValue: number };
type Bucket     = "liquid" | "longterm" | "revolving" | "term";
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
const META_KEY = "sentrfi_account_meta";
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
  liquid:    { label: "Accounts & Savings",    sub: "Available cash and investments",         tone: "positive" },
  longterm:  { label: "Long-term Investments", sub: "Retirement & locked accounts",           tone: "info" },
  revolving: { label: "Credit Cards",          sub: "Statements due this cycle",              tone: "warning" },
  term:      { label: "Loans & Mortgages",     sub: "Only monthly payment affects cash flow", tone: "negative" },
};

// ── Helpers ────────────────────────────────────────────────────
const mapBucket = (type: string|null, subtype: string|null): Bucket => {
  if (type === "credit") return "revolving";
  if (type === "loan") return "term";
  if (type === "investment") {
    const sub = (subtype ?? "").toLowerCase();
    return (sub.includes("brokerage") || sub.includes("cash management")) ? "liquid" : "longterm";
  }
  return "liquid";
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

/** Smart human-readable subtype label — detects HYSA/money market from account name */
const smartSubtypeLabel = (a: PAccount): string => {
  const name = (a.name ?? a.official_name ?? "").toLowerCase();
  const sub  = (a.subtype ?? "").toLowerCase();
  const type = (a.type ?? "").toLowerCase();

  if (sub === "savings" || sub === "money market") {
    const HYSA_HINTS = ["high yield", "high-yield", "hysa", "hys", "marcus", "ally", "synchrony",
                        "discover savings", "sofi savings", "capital one 360", "american express savings"];
    if (HYSA_HINTS.some(h => name.includes(h))) return "High Yield Savings";
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

/** Reconstruct historical net worth from current value + transactions */
const buildNWByPeriod = (netWorth: number, txns: PTxn[], period: Period) => {
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
  return points.map(({ label, date }) => {
    const adj = txns.filter(t => t.date > date).reduce((s, t) => s + Number(t.amount), 0);
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

/** Month-over-month spend change per category: { category, thisMonth, lastMonth, delta, pct } */
const buildSpendTrends = (txns: PTxn[], overrides: Record<string,string>, getRuleCategory: (m:string|null)=>string|null) => {
  const now = new Date();
  const thisM = now.getMonth(); const thisY = now.getFullYear();
  const lastM = thisM === 0 ? 11 : thisM - 1;
  const lastY = thisM === 0 ? thisY - 1 : thisY;
  const catMap: Record<string,{this:number;last:number}> = {};
  for (const t of txns) {
    if (Number(t.amount) <= 0) continue;
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
  lastSeen: string; monthsActive: number; predictedDate: Date; alreadyCharged: boolean;
  accountId: string; // most-used account for this merchant
};

/** Detect recurring charges from the last 6 months and predict upcoming ones for the current month */
const detectRecurring = (txns: PTxn[]): RecurringCharge[] => {
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const expenses = txns.filter(t =>
    Number(t.amount) > 0 &&
    new Date(t.date) >= sixMonthsAgo &&
    !( t.category?.[0] ?? "").toLowerCase().includes("transfer")
  );

  const groups: Record<string, PTxn[]> = {};
  for (const t of expenses) {
    const key = (t.merchant_name ?? t.name ?? "").trim().toLowerCase().slice(0, 40);
    if (!key) continue;
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }

  const results: RecurringCharge[] = [];
  for (const [, txnList] of Object.entries(groups)) {
    const months = new Set(txnList.map(t => {
      const d = new Date(t.date + "T00:00:00");
      return `${d.getFullYear()}-${d.getMonth()}`;
    }));
    if (months.size < 2) continue;

    const amounts = txnList.map(t => Number(t.amount));
    const avgAmount = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const maxAmt = Math.max(...amounts); const minAmt = Math.min(...amounts);
    if (maxAmt > 0 && (maxAmt - minAmt) / maxAmt > 0.3) continue;

    const days = txnList.map(t => new Date(t.date + "T00:00:00").getDate());
    const dayOfMonth = Math.round(days.reduce((s, d) => s + d, 0) / days.length);
    const lastSeen = txnList.reduce((latest, t) => t.date > latest ? t.date : latest, txnList[0].date);
    const lastSeenDate = new Date(lastSeen + "T00:00:00");

    const predictedDate = new Date(now.getFullYear(), now.getMonth(), dayOfMonth);
    if (predictedDate < new Date(now.getFullYear(), now.getMonth(), 1)) continue;

    const alreadyCharged = txnList.some(t => {
      const d = new Date(t.date + "T00:00:00");
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    const monthsAgo = (now.getFullYear() - lastSeenDate.getFullYear()) * 12 + (now.getMonth() - lastSeenDate.getMonth());
    if (monthsAgo > 2 && !alreadyCharged) continue;

    const displayName = txnList.find(t => t.merchant_name)?.merchant_name ??
                        txnList[0].name ?? "Unknown";

    // Most-used account for this merchant (by frequency)
    const accCounts: Record<string, number> = {};
    for (const t of txnList) { accCounts[t.account_id] = (accCounts[t.account_id] ?? 0) + 1; }
    const accountId = Object.entries(accCounts).sort((a, b) => b[1] - a[1])[0][0];

    results.push({ merchant: displayName, avgAmount, dayOfMonth, lastSeen, monthsActive: months.size, predictedDate, alreadyCharged, accountId });
  }

  return results
    .filter(r => !r.alreadyCharged)
    .sort((a, b) => a.predictedDate.getTime() - b.predictedDate.getTime());
};

/** Period helpers for month/year/week navigation */
type PeriodGranularity = "week" | "month" | "year";
type PeriodState = { granularity: PeriodGranularity; offset: number }; // offset: 0 = current, -1 = previous, etc.

const getPeriodLabel = (p: PeriodState): string => {
  const now = new Date();
  if (p.granularity === "month") {
    const d = new Date(now.getFullYear(), now.getMonth() + p.offset, 1);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  if (p.granularity === "year") {
    return String(now.getFullYear() + p.offset);
  }
  // week
  const start = new Date(now); start.setDate(now.getDate() - now.getDay() + p.offset * 7);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return `${start.toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${end.toLocaleDateString("en-US",{month:"short",day:"numeric"})}`;
};

const filterByPeriod = (txns: PTxn[], p: PeriodState): PTxn[] => {
  const now = new Date();
  if (p.granularity === "month") {
    const d = new Date(now.getFullYear(), now.getMonth() + p.offset, 1);
    const mo = d.getMonth(); const yr = d.getFullYear();
    return txns.filter(t => { const td = new Date(t.date+"T00:00:00"); return td.getMonth()===mo && td.getFullYear()===yr; });
  }
  if (p.granularity === "year") {
    const yr = now.getFullYear() + p.offset;
    return txns.filter(t => new Date(t.date+"T00:00:00").getFullYear() === yr);
  }
  // week
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay() + p.offset * 7); startOfWeek.setHours(0,0,0,0);
  const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate() + 6); endOfWeek.setHours(23,59,59,999);
  return txns.filter(t => { const td = new Date(t.date+"T00:00:00"); return td >= startOfWeek && td <= endOfWeek; });
};

// Keywords that suggest an account is already a savings/HYSA — exclude from low-balance alerts
const SAVINGS_KEYWORDS = ["saving", "hysa", "hys", "high yield", "high-yield", "money market", "hsa", "ira", "401", "invest", "brokerage", "roth", "fund"];
const looksLikeSavings = (a: PAccount) => {
  const name = (a.name ?? a.official_name ?? "").toLowerCase();
  return SAVINGS_KEYWORDS.some(k => name.includes(k)) || a.subtype === "savings" || a.subtype === "money market";
};

const generateActions = (accounts: PAccount[], txns: PTxn[]): ActionItem[] => {
  const items: ActionItem[] = [];

  // Only flag genuine checking accounts (not savings/HYSA) with low balance
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

  // Credit card balances
  accounts.filter(a => a.type === "credit").forEach(cc => {
    const bal = Math.abs(Number(cc.current_balance) || 0);
    const shortName = (cc.name ?? "Card").split(" ").slice(0, 2).join(" ");
    if (bal > 1000) items.push({
      id: `cc-${cc.id}`, priority: "soon",
      title: `${shortName} balance due`,
      detail: `${fmtUSD(bal)} balance — schedule payment before due date.`,
      cta: "Schedule payment", icon: CreditCard,
    });
  });

  // Only suggest HYSA for plain savings accounts that don't already look like HYSA
  const lowYieldSavings = accounts.filter(a => {
    if (a.subtype !== "savings") return false;
    const name = (a.name ?? "").toLowerCase();
    // Skip if it already looks like a HYSA
    if (["hysa", "hys", "high yield", "high-yield", "marcus", "ally", "synchrony", "discover"].some(k => name.includes(k))) return false;
    return (Number(a.current_balance) || 0) > 2000;
  });
  if (lowYieldSavings.length > 0) items.push({
    id: "idle-savings", priority: "info",
    title: "Savings may have low yield",
    detail: `${fmtUSD(lowYieldSavings.reduce((s, a) => s + (Number(a.current_balance) || 0), 0))} may be earning below market rate — consider a 4%+ APY account.`,
    cta: "Explore HYSA", icon: Coins,
  });

  // Pending transactions
  const pending = txns.filter(t => t.pending);
  if (pending.length > 0) items.push({
    id: "pending", priority: "info",
    title: `${pending.length} pending transaction${pending.length > 1 ? "s" : ""}`,
    detail: `Total: ${fmtUSD(pending.reduce((s, t) => s + Math.abs(Number(t.amount)), 0))} still settling.`,
    cta: "View all", icon: Sparkles,
  });

  return items.slice(0, 5);
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
      <div className="font-display text-[17px] text-foreground leading-snug">{title}</div>
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
  const save  = () => { const n=parseFloat(val); if(n>0){onSave(n);onClose();} };
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
const TxnRow = ({ t, i, overrides, getRuleCategory, customCategories, openPickerId, onOpenPicker, onClosePicker, onSelect, onAddCategory, onAddRule, onRemoveCustom }: {
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
}) => {
  const rawCat     = getEffectiveCategory(t, overrides, getRuleCategory);
  const displayCat = humanizeCategory(rawCat, Number(t.amount));
  const isIncome   = Number(t.amount) < 0;
  const Icon       = isIncome ? ArrowDownLeft : categoryIcon(rawCat);
  const isEdited   = !!overrides[t.id] || !!getRuleCategory(t.merchant_name ?? t.name ?? null);
  const isOpen     = openPickerId === t.id;

  const handleCatClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOpen) { onClosePicker(); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Position: left-align with element, below it; clamp to viewport
    const x = Math.min(rect.left, window.innerWidth - 270);
    const y = rect.bottom + 6;
    onOpenPicker(t, { x, y });
  };

  return (
    <div className={cn("row-hover group grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 md:px-5 py-2", i>0 && "border-t border-border/30")}>
      <div className={cn("h-6 w-6 rounded grid place-items-center border shrink-0",
        isIncome?"bg-positive/10 border-positive/20 text-positive":"bg-secondary/50 border-border/50 text-muted-foreground")}>
        <Icon className="h-3 w-3" />
      </div>
      <div className="min-w-0">
        <div className="text-[12.5px] text-foreground truncate">
          {t.merchant_name ?? t.name ?? "Transaction"}
          {t.pending && <span className="ml-2 text-[9px] uppercase px-1.5 py-0.5 rounded border border-warning/30 bg-warning/10 text-warning">Pending</span>}
        </div>
        <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
          <span>{new Date(t.date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>
          {displayCat && (
            <>
              <span>·</span>
              <button onClick={handleCatClick}
                className={cn("inline-flex items-center gap-0.5 rounded px-1 -mx-1 transition-colors",
                  isOpen?"bg-secondary/60 text-foreground":"hover:bg-secondary/40 hover:text-foreground",
                  isEdited&&"text-info")}
                title="Click to change">
                {displayCat}
                <Pencil className="h-2 w-2 opacity-0 group-hover:opacity-50 ml-0.5 shrink-0 transition-opacity" />
              </button>
            </>
          )}
        </div>
      </div>
      <div className={cn("text-right text-[12.5px] tabular font-medium shrink-0", isIncome?"text-positive":"text-foreground")}>
        {isIncome?"+":"−"}{fmtUSD(Math.abs(Number(t.amount)),{cents:true})}
      </div>

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
  const y = pos.y + 280 > window.innerHeight ? Math.max(pos.y - 290, 8) : pos.y;
  const x = Math.min(Math.max(pos.x, 8), window.innerWidth - 274);
  return (
    <div style={{position:"fixed",left:x,top:y,zIndex:9999}}>
      <InlineCategoryPicker txn={txn} current={rawCat??"Other"}
        existingRule={getRuleCategory(txn.merchant_name??txn.name??null)??undefined}
        customCategories={customCategories}
        onSelect={cat=>onSelect(txn.id,cat)}
        onAddCategory={onAddCategory} onAddRule={onAddRule} onRemoveCustom={onRemoveCustom} onClose={onClose} />
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
          {budget && (
            <span className={cn("text-[9px] tabular px-1.5 py-0.5 rounded-full",
              overBudget?"bg-negative/15 text-negative":nearBudget?"bg-warning/15 text-warning":"bg-secondary text-muted-foreground")}>
              {pct.toFixed(0)}%
            </span>
          )}
          <button onClick={e=>{e.stopPropagation();onSetBudget();}}
            className="h-5 w-5 rounded grid place-items-center text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
            <Pencil className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">{formatCat(category)}</div>
      <div className="mt-0.5 font-display text-base tabular text-foreground leading-tight">{fmtUSD(total)}</div>
      {budget ? (
        <div className="text-[10px] text-muted-foreground tabular">of {fmtUSD(budget)}</div>
      ) : (
        <div className="text-[10px] text-muted-foreground tabular">{count} txn{count!==1?"s":""}</div>
      )}
      {budget && (
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
      <DialogContent className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">Edit account</DialogTitle>
        <DialogDescription className="sr-only">Rename or add details to this account.</DialogDescription>
        <div className="relative p-5 pb-4 border-b border-border/40">
          <button onClick={onClose} className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
            <X className="h-4 w-4" />
          </button>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Edit account</div>
          <div className="font-display text-base text-foreground">{account.name ?? "Account"}</div>
          {account.mask && <div className="text-[11px] text-muted-foreground">··{account.mask}</div>}
        </div>
        <div className="p-5 space-y-4">
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
        <div className="p-4 pt-0 flex gap-2">
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

  return (
    <button
      onClick={onSelect}
      className="row-hover w-full flex items-center gap-3 px-4 md:px-5 py-3 text-left group"
    >
      {/* Icon */}
      <div className="h-8 w-8 rounded-lg grid place-items-center bg-secondary/50 border border-border/50 shrink-0 text-gold">
        <Icon className="h-3.5 w-3.5" />
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[13px] text-foreground font-medium truncate">{displayName}</span>
          {isPromo && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-positive/30 bg-positive/10 text-positive shrink-0">0% APR</span>
          )}
          {dueDaysAway != null && dueDaysAway <= 7 && (
            <span className={cn("text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0",
              dueDaysAway <= 0 ? "border-negative/30 bg-negative/10 text-negative" : "border-warning/30 bg-warning/10 text-warning")}>
              {dueDaysAway <= 0 ? "overdue" : `due ${dueDaysAway}d`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 text-[10.5px] text-muted-foreground flex-wrap">
          <span className="font-medium text-foreground/60">{smartSubtypeLabel(a)}</span>
          <span className="opacity-30">·</span>
          <span>{instName}{a.mask ? ` ··${a.mask}` : ""}</span>
          {meta.apr != null && (
            <><span className="opacity-30">·</span><span className="tabular">{meta.apr.toFixed(2)}% {debt ? "APR" : "APY"}</span></>
          )}
          {utilization !== null && (
            <><span className="opacity-30">·</span>
            <span className={cn("tabular", utilization > 0.5 ? "text-negative" : utilization > 0.3 ? "text-warning" : "")}>
              {(utilization * 100).toFixed(0)}% used
            </span></>
          )}
        </div>
        {/* Inline credit utilization bar */}
        {utilization !== null && (
          <div className="mt-1.5 h-0.5 rounded-full bg-border/40 overflow-hidden max-w-[100px]">
            <div className="h-full rounded-full" style={{
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
        <div className={cn("text-[13.5px] font-medium tabular", debt ? "text-negative" : "text-foreground")}>
          {debt ? "−" : ""}{fmtUSD(Math.abs(bal), { compact: true })}
        </div>
        {avail != null && !debt && avail !== bal && (
          <div className="text-[10px] text-muted-foreground tabular">{fmtUSD(avail, { compact: true })} avail</div>
        )}
      </div>

      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 group-hover:text-muted-foreground transition-colors" />
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
  if (bucket === "liquid" && yearlyInterest > 0) trailing = `Earning +${fmtUSD(yearlyInterest, { compact: true })}/yr`;
  if (bucket === "revolving" && monthlyStatement > 0) trailing = `${fmtUSD(monthlyStatement, { compact: true })} due this cycle`;
  if (bucket === "term") trailing = `${fmtUSD(Math.abs(yearlyInterest), { compact: true })} interest/yr`;
  if (bucket === "longterm") trailing = "Held for the future";

  const getInstName = (a: PAccount) => {
    const raw = a as unknown as Record<string,unknown>;
    const itemId = raw.item_id as string | undefined;
    const item = itemId ? items.find(it => it.id === itemId) : undefined;
    return item?.institution_name ?? "Bank";
  };
  const getInstUrl = (a: PAccount) => {
    const instName = getInstName(a);
    return getInstitutionUrl(instName, accountMeta[a.id]?.customUrl);
  };

  return (
    <div className="surface-card card-hover overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-4 px-4 md:px-5 py-3.5 hover:bg-surface-hover/40 transition-colors text-left border-b border-border/40"
      >
        <div className="flex items-center gap-3 min-w-0">
          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0", !open && "-rotate-90")} />
          <div className={cn("h-1.5 w-1.5 rounded-full", toneDot[meta.tone])} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-display text-base md:text-lg text-foreground">{meta.label}</h3>
              {bucket === "longterm" && <Lock className="h-3 w-3 text-muted-foreground" />}
              <span className="text-[10.5px] text-muted-foreground tabular">· {accounts.length}</span>
            </div>
            <div className="text-[11px] text-muted-foreground truncate">{meta.sub}</div>
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className={cn("font-display text-xl md:text-2xl tabular leading-none",
            isNeg ? "text-negative" : "text-foreground")}>
            {isNeg ? "−" : ""}{fmtUSD(Math.abs(total), { compact: true })}
          </div>
          {trailing && (
            <div className={cn("text-[10.5px] tabular mt-1",
              bucket === "liquid" ? "text-positive" :
              bucket === "revolving" ? "text-warning" :
              bucket === "term" ? "text-negative" : "text-info")}>
              {trailing}
            </div>
          )}
        </div>
      </button>

      {open && (
        <div className="divide-y divide-border/30">
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
      )}
    </div>
  );
};

// ── Account detail right panel ─────────────────────────────────
const AccountDetailPanel = ({ a, txns, meta, credit, instName, instUrl, onEdit, onRemove, onClose }: {
  a: PAccount; txns: PTxn[]; meta: AccountMeta; credit?: CreditDetail;
  instName: string; instUrl: string | null;
  onEdit: () => void; onRemove: () => void; onClose: () => void;
}) => {
  const debt = isDebt(a.type);
  const bal = Number(a.current_balance) || 0;
  const avail = Number(a.available_balance) || 0;
  const utilization = a.type === "credit" && avail !== 0 ? Math.abs(bal) / (Math.abs(bal) + avail) : null;
  const displayName = meta.nickname || a.name || a.official_name || "Account";
  const recentTxns = txns.filter(t => t.account_id === a.account_id).slice(0, 12);
  const isPromo = meta.promoApr != null;
  const promoExpired = meta.promoEndDate ? new Date(meta.promoEndDate) < new Date() : false;
  const daysUntilPromoEnd = meta.promoEndDate
    ? Math.ceil((new Date(meta.promoEndDate).getTime() - Date.now()) / 86400000) : null;
  const yearlyInterest = meta.apr != null ? Math.abs(bal) * meta.apr / 100 : 0;
  const Icon = mapIcon(a.type, a.subtype);
  const accentColor = debt ? "hsl(var(--negative))" : "hsl(var(--positive))";

  // 30-day net flow
  const thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const accTxns = txns.filter(t => t.account_id === a.account_id && new Date(t.date) >= thirtyAgo);
  const netFlow = accTxns.reduce((s, t) => s - Number(t.amount), 0);
  const trendUp = netFlow > 0;
  const trendGood = debt ? !trendUp : trendUp;

  return (
    <RightPanel open onClose={onClose} footer={
      <div className="flex items-center gap-2 w-full">
        {instUrl && (
          <a href={instUrl} target="_blank" rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-2 h-9 rounded-lg bg-gold text-[12px] font-medium hover:opacity-90 transition-opacity">
            <ExternalLink className="h-3.5 w-3.5" /> Open banking
          </a>
        )}
        <button onClick={onEdit} className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-border text-[12px] text-muted-foreground hover:text-foreground transition-colors">
          <Pencil className="h-3.5 w-3.5" /> Edit
        </button>
        <button onClick={() => { onClose(); onRemove(); }} className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-negative/30 text-[12px] text-negative hover:bg-negative/10 transition-colors">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    }>
      {/* Panel header */}
      <PanelHeader
        icon={<Icon className="h-5 w-5" />}
        iconColor={accentColor}
        title={displayName}
        subtitle={`${smartSubtypeLabel(a)} · ${instName}${a.mask ? ` ··${a.mask}` : ""}`}
        onClose={onClose}
      />

      {/* Balance hero */}
      <div className="px-5 py-5 border-b" style={{ borderColor: "var(--gold-border)" }}>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Current balance</div>
        <div className={cn("font-display text-4xl tabular leading-none", debt ? "text-negative" : "text-foreground")}>
          {debt ? "−" : ""}{fmtUSD(Math.abs(bal))}
        </div>
        <div className="flex items-center gap-4 mt-2.5 flex-wrap">
          {avail > 0 && !debt && avail !== bal && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Available</div>
              <div className="text-[13px] text-positive tabular font-medium mt-0.5">{fmtUSD(avail)}</div>
            </div>
          )}
          {accTxns.length > 0 && Math.abs(netFlow) > 1 && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">30-day flow</div>
              <div className={cn("text-[13px] tabular font-medium mt-0.5 flex items-center gap-0.5", trendGood ? "text-positive" : "text-negative")}>
                {trendUp ? <TrendingUp className="h-3 w-3"/> : <TrendingDown className="h-3 w-3"/>}
                {netFlow > 0 ? "+" : ""}{fmtUSD(Math.abs(netFlow), { compact: true })}
              </div>
            </div>
          )}
          {meta.apr != null && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{debt ? "APR" : "APY"}</div>
              <div className="text-[13px] tabular font-medium mt-0.5">{meta.apr.toFixed(2)}%</div>
            </div>
          )}
        </div>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Key metrics grid */}
        {(meta.apr != null || credit?.last_statement_balance != null || credit?.next_payment_due_date || credit?.minimum_payment_amount != null || utilization !== null) && (
          <div className="grid grid-cols-2 gap-2.5">
            {meta.apr != null && (
              <div className="surface-card p-3">
                <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">{debt ? "Annual interest cost" : "Annual interest earned"}</div>
                <div className={cn("font-display text-base mt-1 tabular", debt ? "text-negative" : "text-positive")}>
                  {debt ? "−" : "+"}{fmtUSD(Math.abs(yearlyInterest), { compact: true })}
                </div>
              </div>
            )}
            {credit?.last_statement_balance != null && (
              <div className="surface-card p-3">
                <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Statement balance</div>
                <div className="font-display text-base mt-1 tabular text-warning">{fmtUSD(credit.last_statement_balance)}</div>
              </div>
            )}
            {credit?.next_payment_due_date && (
              <div className="surface-card p-3">
                <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Due date</div>
                <div className={cn("font-display text-base mt-1", credit.is_overdue ? "text-negative" : "text-info")}>
                  {new Date(credit.next_payment_due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  {credit.is_overdue && <span className="ml-1.5 text-[10px] text-negative font-normal">OVERDUE</span>}
                </div>
              </div>
            )}
            {credit?.minimum_payment_amount != null && (
              <div className="surface-card p-3">
                <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Min payment</div>
                <div className="font-display text-base mt-1 tabular text-warning">{fmtUSD(credit.minimum_payment_amount)}</div>
              </div>
            )}
            {utilization !== null && (
              <div className="surface-card p-3 col-span-2">
                <div className="flex justify-between text-[10.5px] mb-1.5">
                  <span className="text-muted-foreground">Credit utilization</span>
                  <span className={cn("font-medium tabular", utilization > 0.5 ? "text-negative" : utilization > 0.3 ? "text-warning" : "text-positive")}>
                    {(utilization * 100).toFixed(0)}% of {fmtUSD(Math.abs(bal) + avail, { compact: true })} limit
                  </span>
                </div>
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{
                    width: `${Math.min(utilization * 100, 100)}%`,
                    backgroundColor: utilization > 0.5 ? "hsl(var(--negative))" : utilization > 0.3 ? "hsl(var(--warning))" : "hsl(var(--positive))"
                  }} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Promo banner */}
        {isPromo && !promoExpired && (
          <div className="inline-flex items-center gap-1.5 chip chip-positive">
            <Sparkles className="h-3 w-3" />
            {daysUntilPromoEnd != null && daysUntilPromoEnd > 0
              ? `0% APR · ${daysUntilPromoEnd}d remaining${meta.promoEndDate ? ` (${new Date(meta.promoEndDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })})` : ""}`
              : "0% APR active"}
          </div>
        )}
        {isPromo && promoExpired && (
          <div className="inline-flex items-center gap-1.5 chip chip-negative text-[11px]">
            0% APR promo expired — interest now applies
          </div>
        )}

        {/* Recent transactions */}
        {recentTxns.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Recent activity</div>
            <div className="surface-card overflow-hidden divide-y divide-border/20">
              {recentTxns.map(t => {
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
          </div>
        )}

        {recentTxns.length === 0 && (
          <div className="text-center py-6 text-[12px] text-muted-foreground">No recent transactions for this account.</div>
        )}
      </div>
    </RightPanel>
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
  const [expandedAccId, setExpandedAccId] = useState<string|null>(null);
  const [period, setPeriod]         = useState<Period>("1M");
  const [budgetCategory, setBudgetCategory] = useState<string|null>(null);
  const [showCatManager, setShowCatManager] = useState(false);
  const [openActionItem, setOpenActionItem] = useState<ActionItem|null>(null);
  const [spendingPopup, setSpendingPopup] = useState<string|null>(null);
  const [spendPopupLimit, setSpendPopupLimit] = useState<5|10|"all">(5);
  // Period state for monthly + spending tabs
  const [monthlyPeriod, setMonthlyPeriod] = useState<PeriodState>({ granularity: "month", offset: 0 });
  const [spendingPeriod, setSpendingPeriod] = useState<PeriodState>({ granularity: "month", offset: 0 });
  // Per-section loading states for selective refresh
  const [refreshingAccounts, setRefreshingAccounts] = useState(false);
  const [refreshingTxns, setRefreshingTxns] = useState(false);
  // Inline category picker — tracks which txn has the picker open + anchor position
  const [openPickerTxn, setOpenPickerTxn] = useState<PTxn|null>(null);
  const [pickerPos, setPickerPos]         = useState<{x:number;y:number}>({x:0,y:0});

  const [dismissedInsights, setDismissedInsights] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("sentrifi_dismissed_insights")??"[]")); } catch { return new Set(); }
  });
  const [dismissedActions, setDismissedActions] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("sentrifi_dismissed_actions")??"[]")); } catch { return new Set(); }
  });

  const dismissInsight = (id:string) => { const n=new Set([...dismissedInsights,id]); setDismissedInsights(n); localStorage.setItem("sentrifi_dismissed_insights",JSON.stringify([...n])); };
  const dismissAction  = (id:string) => { const n=new Set([...dismissedActions,id]);  setDismissedActions(n);  localStorage.setItem("sentrifi_dismissed_actions",JSON.stringify([...n])); };

  const load = useCallback(async()=>{
    if (!user) return;
    setLoading(true);
    const [{ data:accs },{ data:t },{ data:its },{ data:cd }] = await Promise.all([
      supabase.from("plaid_accounts").select("*").eq("user_id",user.id).order("type"),
      supabase.from("plaid_transactions").select("*").eq("user_id",user.id).order("date",{ascending:false}).limit(200),
      supabase.from("plaid_items").select("id,item_id,institution_id,institution_name").eq("user_id",user.id),
      supabase.from("plaid_credit_details").select("*").eq("user_id",user.id).maybeSingle().then(r => ({ data: r.data ? [r.data] : null })),
    ]);
    setAccounts((accs??[]) as PAccount[]);
    setTxns((t??[]) as PTxn[]);
    setItems((its??[]) as PItem[]);
    setCreditDetails((cd??[]) as CreditDetail[]);
    setAccountMeta(loadAllMeta());
    setLoading(false);
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
    toast.success(`Synced ${data?.synced??0} transactions`);
    load();
  },[user,load,onSyncingChange]);

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
    const { data } = await supabase.from("plaid_transactions").select("*").eq("user_id", user.id).order("date", { ascending: false }).limit(200);
    if (data) setTxns(data as PTxn[]);
    setRefreshingTxns(false);
  }, [user]);

  useEffect(()=>{ load(); },[load]);
  useEffect(()=>{ loadInsights(); },[loadInsights]);
  useEffect(()=>{ if (syncTrigger>0) doSync(); },[syncTrigger]); // eslint-disable-line

  // ── Computed (before any early return) ────────────────────
  const assets      = accounts.filter(a=>!isDebt(a.type)).reduce((s,a)=>s+(Number(a.current_balance)||0),0);
  const liabilities = accounts.filter(a=>isDebt(a.type)).reduce((s,a)=>s+(Number(a.current_balance)||0),0);
  const netWorth    = assets-liabilities;
  const nwData      = buildNWByPeriod(netWorth, txns, period);
  const nwChange    = nwData.length>1 ? nwData[nwData.length-1].v - nwData[0].v : 0;
  const monthlyFlow = buildMonthlyFlow(txns);

  const animatedNW   = useCountUp(netWorth, 1200);
  const animatedAss  = useCountUp(assets, 1000);
  const animatedLiab = useCountUp(liabilities, 1000);

  const byBucket = (b:Bucket) => accounts.filter(a=>mapBucket(a.type,a.subtype)===b);

  // Current-month spending aggregation (homepage + spending tab default)
  const now = new Date();
  const curMo = now.getMonth(); const curYr = now.getFullYear();
  const curMonthTxns = txns.filter(t=>{ const d=new Date(t.date+"T00:00:00"); return d.getMonth()===curMo&&d.getFullYear()===curYr; });
  const curMonthExpenses = curMonthTxns.filter(t=>
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

  // Period-filtered data for monthly/spending tabs
  const monthlyPeriodTxns = filterByPeriod(txns, monthlyPeriod);
  const monthlyIncome = monthlyPeriodTxns.filter(t=>Number(t.amount)<0).reduce((s,t)=>s+Math.abs(Number(t.amount)),0);
  const monthlySpend  = monthlyPeriodTxns.filter(t=>Number(t.amount)>0).reduce((s,t)=>s+Number(t.amount),0);

  // Spending-tab period filtered
  const spendingPeriodTxns = filterByPeriod(txns, spendingPeriod);
  const spendingPeriodExpenses = spendingPeriodTxns.filter(t=>
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

  const allActions       = generateActions(accounts,txns);
  const visibleActions   = allActions.filter(a=>!dismissedActions.has(a.id));
  const visibleInsights  = aiInsights.filter(i=>!dismissedInsights.has(i.id));
  const spendTrends      = buildSpendTrends(txns, overrides, getRuleCategory);
  const recurringCharges = detectRecurring(txns);

  // Filtered txns for spending view
  const filteredSpendingTxns = (() => {
    let base = spendingPeriodTxns;
    if (selectedCategory) base = base.filter(t=>(getEffectiveCategory(t,overrides,getRuleCategory)??"Other")===selectedCategory);
    return base;
  })();

  // ── Tick thinning for dense charts ────────────────────────
  const nwTickEvery = { "1W":1,"1M":5,"3M":2,"1Y":1,"ALL":1 }[period];

  if (loading) return <div className="min-h-[40vh] grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  // ── Period nav pill (reused in monthly + spending tabs) ──────
  const PeriodNav = ({ state, onChange }: { state: PeriodState; onChange: (s: PeriodState) => void }) => (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex rounded-full border border-border p-0.5 bg-surface/60">
        {(["week","month","year"] as PeriodGranularity[]).map(g=>(
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
    <div className="space-y-4 animate-fade-up">

      {/* Net worth hero with period selector */}
      <section className="surface-elevated relative overflow-hidden p-4 md:p-5">
        <div className="pointer-events-none absolute -top-20 -right-20 h-44 w-44 rounded-full bg-positive/10 blur-3xl" />
        <div className="relative">
          <div className="flex items-baseline gap-3 flex-wrap mb-4">
            <h2 className="font-display text-3xl md:text-4xl font-medium leading-none tabular stat-gold animate-count-in">
              {fmtUSD(animatedNW)}
            </h2>
            {nwChange!==0 && (
              <span className={cn("chip !py-0.5 !px-2 !text-[11px] animate-pop-in", nwChange>=0?"chip-positive":"chip-negative")}>
                <ArrowUpRight className={cn("h-3 w-3",nwChange<0&&"rotate-180")} />
                {fmtUSD(Math.abs(nwChange),{compact:true})} · {period}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-5 max-w-sm mb-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Assets</div>
              <div className="font-display text-base mt-0.5 tabular text-positive animate-count-in">{fmtUSD(animatedAss,{compact:true})}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Liabilities</div>
              <div className="font-display text-base mt-0.5 tabular text-negative animate-count-in">−{fmtUSD(animatedLiab,{compact:true})}</div>
            </div>
          </div>

          {/* Period selector */}
          <div className="flex items-center gap-1 mb-3">
            {PERIODS.map(p=>(
              <button key={p} onClick={()=>setPeriod(p)}
                className={cn("px-3 py-1 rounded-full text-[12px] font-medium transition-all",
                  period===p?"bg-gold text-foreground shadow-sm":"text-muted-foreground hover:text-foreground hover:bg-secondary/60")}>
                {p}
              </button>
            ))}
          </div>

          <div className="h-28 -mx-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={nwData} margin={{top:4,right:4,bottom:0,left:4}}>
                <defs>
                  <linearGradient id="nw-live" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="m" axisLine={false} tickLine={false}
                  tick={{fill:"hsl(var(--muted-foreground))",fontSize:9}}
                  interval={nwTickEvery-1} />
                <YAxis hide domain={["dataMin - 1000","dataMax + 1000"]} />
                <Tooltip contentStyle={{background:"hsl(var(--popover))",border:"1px solid var(--gold-border)",borderRadius:"10px",fontSize:"12px"}}
                  labelStyle={{color:"hsl(var(--muted-foreground))"}}
                  formatter={(v:number)=>[fmtUSD(v),"Net worth"]} />
                <Area type="monotone" dataKey="v" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#nw-live)" animationDuration={800} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Accounts — bucketed, all collapsed by default */}
      <section className="space-y-2.5">
        <div className="flex items-baseline justify-between gap-4 px-1">
          <h2 className="font-display text-base md:text-lg text-primary">Accounts</h2>
          <button onClick={onAddAccount} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
            <Plus className="h-3 w-3" />Add account
          </button>
        </div>
        {accounts.length === 0 ? (
          <div className="surface-card p-6 text-center text-[12px] text-muted-foreground">
            No accounts yet. <button onClick={onAddAccount} className="text-gold underline">Link a bank</button>.
          </div>
        ) : (
          <div className="space-y-2.5">
            {(["liquid","revolving","term","longterm"] as Bucket[]).map(bucket => (
              <BucketGroup
                key={bucket}
                bucket={bucket}
                accounts={accounts.filter(a => mapBucket(a.type, a.subtype) === bucket)}
                txns={txns}
                accountMeta={accountMeta}
                creditDetails={creditDetails}
                items={items}
                expandedId={expandedAccId}
                onToggle={id => setExpandedAccId(v => v === id ? null : id)}
                onEdit={a => setEditingAccount(a)}
                onRemove={a => setRemovingAccount(a)}
                defaultOpen={false}
              />
            ))}
            <button
              onClick={onAddAccount}
              className="w-full surface-card border-dashed py-3 inline-flex items-center justify-center gap-2 text-[12px] text-muted-foreground hover:text-foreground hover:border-border-strong transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Link a bank, card, loan or brokerage via Plaid
            </button>
          </div>
        )}
      </section>

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
                  This will delete the account and all its synced transactions from SentriFi.
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
            <h2 className="font-display text-base md:text-lg text-primary">Insights into your spending</h2>
            <button onClick={()=>loadInsights(true)} disabled={insightsLoading}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border-strong text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors">
              <Sparkles className={cn("h-3 w-3", insightsLoading && "animate-pulse")} />
              {insightsLoading ? "Analyzing…" : "Refresh AI"}
            </button>
          </div>

          {/* Row 1: Action Items + Saving Opportunities */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Action Items */}
            <div className="surface-card overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 border-b border-border/30 flex items-center justify-between">
                <h3 className="font-display text-[13px] text-primary">Action items</h3>
                {visibleActions.length>0 && <span className="text-[10px] text-muted-foreground tabular">{visibleActions.length} open</span>}
              </div>
              {visibleActions.length===0 ? (
                <div className="px-4 py-4 flex items-center gap-2 text-[12px] text-muted-foreground">
                  <Check className="h-4 w-4 text-positive shrink-0" />All caught up.
                </div>
              ) : (
                <div className="divide-y divide-border/20">
                  {visibleActions.map(item=>{
                    const Icon=item.icon; const m=priorityMeta[item.priority];
                    return (
                      <button key={item.id} onClick={()=>setOpenActionItem(item)}
                        className="row-hover w-full px-4 py-2.5 text-left flex items-center gap-2.5">
                        <div className={cn("h-6 w-6 rounded grid place-items-center bg-secondary/50 border border-border/40 shrink-0",m.text)}>
                          <Icon className="h-3 w-3" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={cn("text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0",m.chip)}>{m.label}</span>
                            <span className="text-[12px] text-foreground font-medium truncate">{item.title}</span>
                          </div>
                          <p className="text-[10.5px] text-muted-foreground leading-snug truncate mt-0.5">{item.detail}</p>
                        </div>
                        <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Saving Opportunities (AI Insights — compact list) */}
            <div className="surface-card overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 border-b border-border/30 flex items-center justify-between">
                <h3 className="font-display text-[13px] text-primary">Saving opportunities</h3>
                {!insightsLoading && visibleInsights.length>0 && (
                  <span className="text-[10px] text-positive tabular">
                    +${visibleInsights.reduce((s,i)=>s+(i.impactValue??0),0).toLocaleString()}/yr
                  </span>
                )}
              </div>
              {insightsLoading ? (
                <div className="divide-y divide-border/20">
                  {[1,2].map(i=><div key={i} className="flex items-center gap-3 px-4 py-3 shimmer"><div className="h-7 w-7 rounded-lg bg-secondary/60 shrink-0"/><div className="flex-1 space-y-1"><div className="h-3 bg-secondary/60 rounded w-3/4"/><div className="h-2 bg-secondary/40 rounded w-1/2"/></div></div>)}
                </div>
              ) : visibleInsights.length===0 ? (
                <div className="px-4 py-4 text-[12px] text-muted-foreground">No opportunities found yet.</div>
              ) : (
                <div className="divide-y divide-border/20">
                  {visibleInsights.slice(0,4).map(insight=>{
                    const CatIcon=insight.category==="Rewards"?Sparkles:insight.category==="0% APR"?CreditCard:insight.category==="Idle Cash"?Coins:TrendingUp;
                    return (
                      <button key={insight.id} onClick={()=>setOpenInsight(insight)}
                        className="row-hover w-full flex items-center gap-3 px-4 py-2.5 text-left">
                        <div className="h-7 w-7 rounded-lg bg-secondary/60 grid place-items-center text-foreground/70 shrink-0"><CatIcon className="h-3.5 w-3.5"/></div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] text-foreground truncate">{insight.title}</div>
                          <div className="text-[10.5px] text-positive tabular">{insight.impact}</div>
                        </div>
                        <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0"/>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Row 2: High Spending Categories (Current Month) */}
          {spendByCategory.length > 0 && (
            <div className="surface-card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border/30 flex items-center justify-between">
                <div>
                  <h3 className="font-display text-[13px] text-primary">High Spending Categories</h3>
                  <div className="text-[10px] text-muted-foreground">{new Date().toLocaleDateString("en-US",{month:"long",year:"numeric"})} · {fmtUSD(totalSpend)} total</div>
                </div>
                <button onClick={()=>onCategorySelect?.("")}
                  className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                  Spending & Budget <ArrowRight className="h-3 w-3" />
                </button>
              </div>
              <div className="divide-y divide-border/20">
                {spendByCategory.slice(0,5).map(c=>{
                  const Icon=categoryIcon(c.category); const color=catColor(c.category);
                  const budget=budgets[c.category]; const pct=budget?(c.total/budget)*100:0;
                  const over=budget&&c.total>budget; const near=budget&&!over&&pct>=70;
                  const trend=spendTrends.find(t=>t.category===c.category);
                  const topTxns=[...c.txns].sort((a,b)=>Number(b.amount)-Number(a.amount));
                  return (
                    <button key={c.category} onClick={()=>{setSpendingPopup(c.category);setSpendPopupLimit(5);}}
                      className="row-hover w-full flex items-center gap-3 px-4 py-2.5 text-left">
                      <div className="h-7 w-7 rounded-lg grid place-items-center shrink-0" style={{backgroundColor:`${color}1f`,color}}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] text-foreground font-medium truncate">{formatCat(c.category)}</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {trend?.pct!=null&&trend.pct!==0&&(
                              <span className={cn("text-[9px] tabular",trend.delta>0?"text-negative":"text-positive")}>
                                {trend.delta>0?"+":""}{trend.pct}%
                              </span>
                            )}
                            <span className="text-[12px] tabular font-medium">{fmtUSD(c.total)}</span>
                          </div>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                          {topTxns[0] ? `Top: ${topTxns[0].merchant_name??topTxns[0].name??"—"} ${fmtUSD(Number(topTxns[0].amount))}` : `${c.count} transactions`}
                        </div>
                        {budget && (
                          <div className="mt-1 h-0.5 rounded-full bg-border/40 overflow-hidden">
                            <div className="h-full rounded-full" style={{width:`${Math.min(pct,100)}%`,backgroundColor:over?"hsl(var(--negative))":near?"hsl(var(--warning))":color}}/>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Row 3: Upcoming Charges / Recurring Bills */}
          {recurringCharges.length > 0 && (
            <div className="surface-card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border/30 flex items-center justify-between">
                <div>
                  <h3 className="font-display text-[13px] text-primary">Upcoming Charges</h3>
                  <div className="text-[10px] text-muted-foreground">Predicted recurring bills this month</div>
                </div>
                <button onClick={refreshTxns} disabled={refreshingTxns}
                  className="h-6 w-6 grid place-items-center rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
                  <RefreshCw className={cn("h-3 w-3", refreshingTxns && "animate-spin")} />
                </button>
              </div>
              <div className="divide-y divide-border/20">
                {recurringCharges.map((r, i) => {
                  const isPast = r.predictedDate < new Date();
                  const sourceAcc = accounts.find(a => a.account_id === r.accountId);
                  const isDebtAcc = sourceAcc ? isDebt(sourceAcc.type) : false;
                  const availBal = sourceAcc ? (Number(sourceAcc.available_balance) || Number(sourceAcc.current_balance) || 0) : null;
                  // Only warn for checking/savings — credit cards handle their own limit
                  const showBalCheck = !r.alreadyCharged && !isDebtAcc && availBal !== null;
                  const hasSufficient = availBal !== null && availBal >= r.avgAmount;
                  const isTight = availBal !== null && availBal >= r.avgAmount && availBal < r.avgAmount * 2;

                  return (
                    <div key={i} className="flex items-center gap-3 px-4 py-3">
                      {/* Date badge */}
                      <div className={cn(
                        "shrink-0 w-10 text-center rounded-lg py-1 border",
                        r.alreadyCharged
                          ? "bg-positive/10 border-positive/20"
                          : isPast
                          ? "bg-negative/10 border-negative/20"
                          : "bg-secondary/50 border-border/40"
                      )}>
                        <div className="text-[8.5px] uppercase tracking-wide text-muted-foreground leading-none">
                          {r.predictedDate.toLocaleDateString("en-US", { month: "short" })}
                        </div>
                        <div className={cn("text-[15px] font-semibold tabular leading-tight",
                          r.alreadyCharged ? "text-positive" : isPast ? "text-negative" : "text-foreground")}>
                          {r.predictedDate.getDate()}
                        </div>
                      </div>

                      {/* Merchant + account/balance info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[12.5px] text-foreground font-medium truncate">{r.merchant}</span>
                          {r.alreadyCharged && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded border border-positive/30 bg-positive/10 text-positive shrink-0">Paid</span>
                          )}
                          {!r.alreadyCharged && isPast && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded border border-warning/30 bg-warning/10 text-warning shrink-0">Pending?</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {sourceAcc && (
                            <span className="text-[10px] text-muted-foreground">
                              {sourceAcc.name ?? "Account"}{sourceAcc.mask ? ` ··${sourceAcc.mask}` : ""}
                            </span>
                          )}
                          {showBalCheck && (
                            <>
                              <span className="text-muted-foreground/30 text-[10px]">·</span>
                              <span className={cn("text-[10px] font-medium flex items-center gap-0.5",
                                !hasSufficient ? "text-negative" : isTight ? "text-warning" : "text-positive")}>
                                {!hasSufficient
                                  ? <><AlertTriangle className="h-2.5 w-2.5 shrink-0" /> Low balance ({fmtUSD(availBal!, { compact: true })} avail)</>
                                  : isTight
                                  ? <><AlertTriangle className="h-2.5 w-2.5 shrink-0" /> Tight ({fmtUSD(availBal!, { compact: true })} avail)</>
                                  : <><Check className="h-2.5 w-2.5 shrink-0" /> {fmtUSD(availBal!, { compact: true })} avail</>
                                }
                              </span>
                            </>
                          )}
                          {!sourceAcc && (
                            <span className="text-[10px] text-muted-foreground">{r.monthsActive} months recurring</span>
                          )}
                        </div>
                      </div>

                      {/* Amount */}
                      <div className={cn("text-[13px] tabular font-medium shrink-0",
                        r.alreadyCharged ? "text-muted-foreground line-through" : "text-foreground")}>
                        {fmtUSD(r.avgAmount)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Insight detail dialog (centered, matches demo) ── */}
      <Dialog open={!!openInsight} onOpenChange={(o) => { if (!o) setOpenInsight(null); }}>
        <DialogContent className="max-w-lg surface-elevated border-border p-0 gap-0 overflow-hidden">
          <DialogTitle className="sr-only">{openInsight?.title ?? "Insight"}</DialogTitle>
          <DialogDescription className="sr-only">Financial insight details and recommended action.</DialogDescription>
          {openInsight && (
            <>
              <div className="relative p-6 pb-4">
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
                <h3 className="font-display text-xl md:text-2xl mt-4 text-foreground leading-snug">{openInsight.title}</h3>
                <div className="mt-4 inline-flex items-baseline gap-2 rounded-lg bg-positive/10 border border-positive/20 px-3 py-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Estimated</span>
                  <span className="font-display text-lg tabular text-positive">{openInsight.impact}</span>
                </div>
              </div>
              <div className="hairline p-6 space-y-4">
                {([["What's happening", openInsight.what, false],["Why it matters", openInsight.why, false],["Suggested action", openInsight.action, true]] as [string,string,boolean][]).map(([label,body,accent])=>(
                  <div key={label}>
                    <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-1">{label}</div>
                    <p className={cn("text-sm leading-relaxed", accent?"text-foreground":"text-muted-foreground")}>{body}</p>
                  </div>
                ))}
              </div>
              <div className="hairline p-4 flex flex-wrap gap-2">
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
          )}
        </DialogContent>
      </Dialog>

      {openPickerTxn && <PositionedPicker txn={openPickerTxn} pos={pickerPos} overrides={overrides} getRuleCategory={getRuleCategory} customCategories={customCategories} onSelect={(id,cat)=>setOverride(id,cat)} onAddCategory={addCategory} onAddRule={addRule} onRemoveCustom={removeCategory} onClose={()=>setOpenPickerTxn(null)} />}

      {/* ── Action item detail dialog (centered, matches demo) ── */}
      <Dialog open={!!openActionItem} onOpenChange={(o) => { if (!o) setOpenActionItem(null); }}>
        <DialogContent className="max-w-lg surface-elevated border-border p-0 gap-0 overflow-hidden">
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
                <div className="relative p-6 pb-4">
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
                              {isInc?<ArrowDownLeft className="h-3 w-3"/>:<ArrowRight className="h-3 w-3"/>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[12px] text-foreground truncate">{t.merchant_name??t.name??"Transaction"}</div>
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
                <div className="hairline p-4 flex flex-wrap gap-2">
                  {/* Bank website link for transfer/payment actions */}
                  {actionInstUrl && (isTransferAction || isPaymentAction) && (
                    <a href={actionInstUrl} target="_blank" rel="noopener noreferrer"
                      className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 rounded-lg bg-gold px-4 py-2 text-xs font-medium hover:opacity-90 transition-opacity">
                      <ExternalLink className="h-3.5 w-3.5" />
                      {isTransferAction ? "Transfer at bank" : "Pay at bank"}
                    </a>
                  )}
                  <button onClick={()=>setOpenActionItem(null)}
                    className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 rounded-lg bg-positive px-4 py-2 text-xs font-medium text-positive-foreground hover:opacity-90 transition-opacity">
                    <ArrowRight className="h-3.5 w-3.5" /> {openActionItem.cta}
                  </button>
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
            <DialogContent className="max-w-lg surface-elevated border-border p-0 gap-0 overflow-hidden">
              <DialogTitle className="sr-only">{formatCat(cat)} — current month</DialogTitle>
              <DialogDescription className="sr-only">Top charges in {formatCat(cat)} this month.</DialogDescription>
              <div className="relative p-5 pb-4">
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
              <div className="hairline px-5 py-3 space-y-3">
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
                {budget && (
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
                            <div className="text-[12px] text-foreground truncate">{t.merchant_name??t.name??"Transaction"}</div>
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
              <div className="hairline p-4">
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
      <div className="grid grid-cols-2 gap-3">
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Income</div>
          <div className="font-display text-2xl text-positive mt-1">{fmtUSD(monthlyIncome)}</div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Spent</div>
          <div className="font-display text-2xl text-foreground mt-1">{fmtUSD(monthlySpend)}</div>
        </div>
      </div>
      {monthlyPeriod.granularity === "month" && monthlyPeriod.offset === 0 && (
        <div className="surface-card p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">6-month cash flow</div>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyFlow} margin={{top:0,right:0,bottom:0,left:0}} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.4)" vertical={false} />
                <XAxis dataKey="m" axisLine={false} tickLine={false} tick={{fill:"hsl(var(--muted-foreground))",fontSize:9}} />
                <YAxis hide />
                <Tooltip contentStyle={{background:"hsl(var(--popover))",border:"1px solid var(--gold-border)",borderRadius:"10px",fontSize:"12px"}}
                  formatter={(v:number,n:string)=>[fmtUSD(v),n==="income"?"Income":"Spend"]} />
                <Bar dataKey="income" fill="hsl(var(--positive)/0.7)" radius={[3,3,0,0]} animationDuration={1000} />
                <Bar dataKey="spend"  fill="hsl(var(--negative)/0.5)" radius={[3,3,0,0]} animationDuration={1200} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="font-display text-base md:text-lg text-primary">{getPeriodLabel(monthlyPeriod)}</h2>
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
              onAddCategory={addCategory} onAddRule={addRule} onRemoveCustom={removeCategory} />)}
          </div></div>
        )}
      </section>
      {openPickerTxn && <PositionedPicker txn={openPickerTxn} pos={pickerPos} overrides={overrides} getRuleCategory={getRuleCategory} customCategories={customCategories} onSelect={(id,cat)=>setOverride(id,cat)} onAddCategory={addCategory} onAddRule={addRule} onRemoveCustom={removeCategory} onClose={()=>setOpenPickerTxn(null)} />}
    </div>
  );

  // ── SPENDING & BUDGET ─────────────────────────────────────
  if (view==="spending") return (
    <div className="space-y-4 animate-fade-up">
      {/* Header + period nav + manage */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-xl text-primary">Spending & Budget</h2>
          {selectedCategory && (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Filtered: {formatCat(selectedCategory)} ·{" "}
              <button onClick={()=>onCategorySelect?.("")} className="text-gold hover:underline">Clear</button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <PeriodNav state={spendingPeriod} onChange={p=>{setSpendingPeriod(p);onCategorySelect?.("");}} />
          <button onClick={()=>setShowCatManager(true)}
            className="h-7 px-2.5 rounded-md border text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            style={{borderColor:"var(--gold-border)"}}>
            Manage
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="surface-card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Spent</div>
          <div className="font-display text-xl text-foreground mt-0.5">{fmtUSD(spendingPeriodTotal)}</div>
        </div>
        <div className="surface-card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Categories</div>
          <div className="font-display text-xl text-foreground mt-0.5">{spendingPeriodByCategory.length}</div>
        </div>
      </div>

      {/* 6-month stacked bar chart — only in month view, no category filter */}
      {!selectedCategory && spendingPeriod.granularity==="month" && spendingPeriodByCategory.length>0 && (() => {
        const top5 = spendingPeriodByCategory.slice(0,5).map(c=>c.category);
        const chartData = Array.from({length:6},(_,i)=>{
          const d=new Date(now.getFullYear(),now.getMonth()-(5-i),1);
          const mo=d.getMonth(); const yr=d.getFullYear();
          const row: Record<string,string|number> = { m: d.toLocaleDateString("en-US",{month:"short"}) };
          for (const cat of top5) {
            row[cat] = Math.round(txns.filter(t=>{
              const td=new Date(t.date+"T00:00:00");
              return Number(t.amount)>0 && td.getMonth()===mo && td.getFullYear()===yr && (getEffectiveCategory(t,overrides,getRuleCategory)??"Other")===cat;
            }).reduce((s,t)=>s+Number(t.amount),0));
          }
          return row;
        });
        return (
          <div className="surface-card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Spending by category · 6 months</div>
              <div className="flex items-center gap-3 flex-wrap justify-end">
                {top5.map(cat=>(<div key={cat} className="flex items-center gap-1"><div className="h-2 w-2 rounded-full" style={{backgroundColor:catColor(cat)}} /><span className="text-[10px] text-muted-foreground">{formatCat(cat)}</span></div>))}
              </div>
            </div>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{top:0,right:0,bottom:0,left:0}} barSize={18} barGap={1}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.4)" vertical={false} />
                  <XAxis dataKey="m" axisLine={false} tickLine={false} tick={{fill:"hsl(var(--muted-foreground))",fontSize:9}} />
                  <YAxis hide />
                  <Tooltip contentStyle={{background:"hsl(var(--popover))",border:"1px solid var(--gold-border)",borderRadius:"10px",fontSize:"11px"}} formatter={(v:number,n:string)=>[fmtUSD(v),formatCat(n)]} />
                  {top5.map(cat=><Bar key={cat} dataKey={cat} stackId="a" fill={catColor(cat)} radius={cat===top5[top5.length-1]?[3,3,0,0]:undefined} animationDuration={1000} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* Category tiles */}
      {!selectedCategory && spendingPeriodByCategory.length>0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {spendingPeriodByCategory.map(c=>{
            const trend = spendTrends.find(t=>t.category===c.category);
            return (
              <SpendTile key={c.category}
                category={c.category} total={c.total} count={c.count}
                budget={budgets[c.category]}
                delta={trend?.delta} deltaPct={trend?.pct}
                onSetBudget={()=>setBudgetCategory(c.category)}
                onSelect={()=>onCategorySelect?.(c.category)}
              />
            );
          })}
          <button onClick={()=>setBudgetCategory("__new")}
            className="surface-card card-hover p-4 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground border-dashed">
            <Plus className="h-5 w-5" />
            <span className="text-[12px]">Set budget</span>
          </button>
        </div>
      )}

      {/* Transaction list */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="font-display text-base md:text-lg text-primary">
            {selectedCategory ? `${formatCat(selectedCategory)} transactions` : "All transactions"}
          </h2>
          <span className="text-[11px] text-muted-foreground">{filteredSpendingTxns.length}</span>
        </div>
        {filteredSpendingTxns.length===0 ? (
          <div className="surface-card p-6 text-center text-[12px] text-muted-foreground">No transactions{selectedCategory?` in ${formatCat(selectedCategory)}`:""} for this period.</div>
        ) : (
          <div className="surface-card overflow-hidden"><div className="overflow-y-auto max-h-[600px]">
            {filteredSpendingTxns.map((t,i)=><TxnRow key={t.id} t={t} i={i} overrides={overrides} getRuleCategory={getRuleCategory} customCategories={customCategories}
              openPickerId={openPickerTxn?.id??null}
              onOpenPicker={(txn,pos)=>{setOpenPickerTxn(txn);setPickerPos(pos);}}
              onClosePicker={()=>setOpenPickerTxn(null)}
              onSelect={(id,cat)=>setOverride(id,cat)}
              onAddCategory={addCategory} onAddRule={addRule} onRemoveCustom={removeCategory} />)}
          </div></div>
        )}
      </section>

      {budgetCategory && budgetCategory!=="__new" && (
        <BudgetPanel category={budgetCategory} current={budgets[budgetCategory]}
          onSave={v=>setBudget(budgetCategory,v)}
          onRemove={()=>removeBudget(budgetCategory)}
          onClose={()=>setBudgetCategory(null)} />
      )}
      <Dialog open={budgetCategory==="__new"} onOpenChange={(o)=>{ if(!o) setBudgetCategory(null); }}>
        <DialogContent className="max-w-lg surface-elevated border-border p-0 gap-0 overflow-hidden">
          <DialogTitle className="sr-only">Set a budget</DialogTitle>
          <DialogDescription className="sr-only">Choose a category to set a monthly budget.</DialogDescription>
          <div className="relative p-6 pb-4">
            <button onClick={()=>setBudgetCategory(null)} className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"><X className="h-4 w-4" /></button>
            <h3 className="font-display text-xl text-foreground">Set a budget</h3>
            <p className="mt-1 text-[12px] text-muted-foreground">Choose a category to set a monthly limit.</p>
          </div>
          <div className="hairline divide-y divide-border/30 max-h-80 overflow-y-auto">
            {spendByCategory.filter(c=>!budgets[c.category]).length === 0 ? (
              <div className="px-5 py-8 text-center text-[12px] text-muted-foreground">
                <Check className="h-5 w-5 mx-auto mb-2 text-positive" />All spending categories have budgets set.
              </div>
            ) : spendByCategory.filter(c=>!budgets[c.category]).map(c=>{
              const Icon=categoryIcon(c.category); const color=catColor(c.category);
              return (
                <button key={c.category} onClick={()=>setBudgetCategory(c.category)}
                  className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-surface/60 transition-colors">
                  <div className="h-7 w-7 rounded-md grid place-items-center shrink-0" style={{backgroundColor:`${color}1f`,color}}><Icon className="h-3.5 w-3.5" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-foreground">{formatCat(c.category)}</div>
                    <div className="text-[10.5px] text-muted-foreground tabular">{fmtUSD(c.total)} this month</div>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
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
  return (
    <div className="space-y-4 animate-fade-up">
      <h2 className="font-display text-xl text-primary capitalize">{view}</h2>
      <div className="surface-card p-10 text-center space-y-2">
        <Sparkles className="h-8 w-8 mx-auto text-gold mb-3" />
        <div className="font-display text-lg text-foreground">Coming soon</div>
        <div className="text-[12px] text-muted-foreground max-w-xs mx-auto">AI-powered {view} analysis is being built.</div>
      </div>
    </div>
  );
};
