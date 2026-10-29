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
import { CategorySuggestions } from "@/components/finance/CategorySuggestions";
import { SpendingBudgetView } from "@/components/finance/SpendingBudgetView";
import { ImportStatementModal } from "@/components/finance/ImportStatementModal";
import { MyFinancialPicture } from "@/components/finance/MyFinancialPicture";
import { bankHistory } from "@/lib/relink/history";
import { retryPendingCarryovers, type RelinkDb } from "@/lib/relink/client";
import { paycheckAlerts } from "@/lib/paycheck-anomaly";
import { setDerivedAlerts } from "@/lib/derived-alerts";
import { CardBenefitsView } from "@/components/finance/CardBenefitsView";
import {
  type Condition, type ConditionSet, type SmartRule, type RuleAction, type TxnField, type TxnOp, type EvalTxn,
  FIELD_META, OP_LABEL, evaluateSet, ruleMatches, emptyCondition, emptyRule,
} from "@/lib/txn-rules";
import { fmtUSD, fmtUSDCompact, fmtTxnAmount } from "@/lib/format";
import { cleanBankText, merchantKey as cleanMerchantKey, isStatementSummaryText } from "@/lib/merchant-name";
import { findDuplicateIds, findPossibleDuplicateIds, IMPORT_ID_PREFIX } from "@/lib/dedup";
import { useTxnTypeOverrides } from "@/hooks/useTxnTypeOverrides";
import {
  classifyAll, matchInternalTransfers, bucketOf, displayCategoryForType, normalisePlaidCategory, summarizeFlow, monthRange,
  samePeriodLastMonth, savingsRate as calcSavingsRate, TXN_TYPE_LABEL, TXN_TYPES,
  INCOME_CATEGORIES as SHARED_INCOME_CATEGORIES, IGNORED_CATEGORIES as SHARED_IGNORED_CATEGORIES,
  type Classification, type ClassifierTxn, type TxnType, type AccountRole as AccountRoleName,
} from "@/lib/classify/index.ts";
import { recurringFrequencyFor } from "@/lib/recurring";
import { cleanDescription } from "@/lib/statement-import";
import { demoAccounts, demoItems, demoTransactions } from "@/lib/finance-data";
import {
  Loader2, Plus, CreditCard, Landmark, TrendingUp, TrendingDown, Home, Building2,
  ShoppingBag, ShoppingCart, Utensils, Car, Zap, Plane, Film, Heart, Coffee,
  ArrowDownLeft, ArrowUpRight, ArrowUp, ArrowDown, Wallet, ArrowRight, Check, Sparkles, Coins, PiggyBank,
  AlertTriangle, ChevronRight, ChevronDown, Lock, X,
  Pencil, Search, Trash2, ExternalLink, Tag, Calendar, Unlink,
  ChevronLeft, RefreshCw, RepeatIcon, Receipt, ArrowUpDown, EyeOff, Eye, GripVertical,
  Compass, ShieldAlert, Target, ThumbsUp, ThumbsDown,
  ArrowRightLeft, CalendarClock, Info, DollarSign, User, BookOpen,
  SlidersHorizontal, Wand2, Sliders,
} from "lucide-react";
import { SpendingSkeleton } from "@/components/finance/spending/SpendingSkeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtDayDate, fmtShortDate } from "@/lib/format-date";

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
  // Present once supabase/migrations/20261020140000_plaid_transactions_pfc_detail.sql is applied.
  pfc_primary?: string | null; pfc_detailed?: string | null; pfc_confidence?: string | null;
};
// PostgREST caps any unbounded select at ~1000 rows by default — once total
// transaction volume (synced + imported) crosses that line, an ordinary
// `.select("*")` silently returns only the newest page and drops the rest.
// That's exactly what made previously-imported older statements (e.g. 2021)
// disappear the moment enough newer transactions (2024-26 imports, or just
// ordinary Plaid sync activity) pushed the total past the cap — the data was
// never deleted, just no longer inside the one page being fetched. Paging
// through in fixed-size chunks until a page comes back short guarantees every
// row is retrieved regardless of how many years of history are stored.
async function fetchAllTransactions(userId: string): Promise<PTxn[]> {
  const PAGE_SIZE = 1000;
  let offset = 0;
  const all: PTxn[] = [];
  for (;;) {
    const { data, error } = await supabase
      .from("plaid_transactions")
      .select("*")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) { console.error("[fetchAllTransactions]", error.message); break; }
    const rows = (data ?? []) as PTxn[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

// Finds and permanently deletes duplicate rows (same account+date+amount+
// vendor — see lib/dedup.ts) every time transactions are fetched, so overlap
// between a PDF import and live Plaid sync (or between two overlapping
// imports) never lingers as double-counted spend. Returns the list with the
// removed rows already filtered out; if the delete itself fails, the rows are
// left in place rather than hidden from the UI while still sitting in the DB.
async function dedupeTransactions(userId: string, rows: PTxn[]): Promise<PTxn[]> {
  const dupIds = findDuplicateIds(rows);
  if (dupIds.length === 0) return rows;
  const { error } = await supabase.from("plaid_transactions").delete().eq("user_id", userId).in("id", dupIds);
  if (error) {
    console.error("[dedupeTransactions]", error.message);
    return rows;
  }
  toast.info(`Cleaned up ${dupIds.length} duplicate transaction${dupIds.length > 1 ? "s" : ""}`);
  const removeSet = new Set(dupIds);
  return rows.filter(r => !removeSet.has(r.id));
}

// Backfills clean descriptions onto rows imported before cleanDescription()
// existed (or from before a parser fix improved it) — every row created by
// the PDF importer is tagged by its transaction_id prefix, so this doesn't
// need the settings-based "Imported" tag to find them. Self-limiting: once a
// row's stored name matches its cleaned form there's nothing left to update,
// so this becomes a no-op on every load after the first pass (and newly
// imported rows are already clean coming out of parseStatement, so they
// never show up here at all). Runs before dedupeTransactions so the stricter
// vendor-matching duplicate check compares clean text on both sides.
async function cleanImportedDescriptions(userId: string, rows: PTxn[]): Promise<PTxn[]> {
  const fixes = rows
    .filter(t => t.transaction_id?.startsWith(IMPORT_ID_PREFIX) && t.name)
    .map(t => ({ id: t.id, cleaned: cleanDescription(t.name as string) }))
    .filter(f => f.cleaned && f.cleaned !== rows.find(r => r.id === f.id)?.name);
  if (fixes.length === 0) return rows;
  const results = await Promise.allSettled(
    fixes.map(f => supabase.from("plaid_transactions").update({ name: f.cleaned }).eq("id", f.id).eq("user_id", userId))
  );
  const cleanMap = new Map<string, string>();
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && !r.value.error) cleanMap.set(fixes[i].id, fixes[i].cleaned);
    else console.error("[cleanImportedDescriptions]", r.status === "fulfilled" ? r.value.error?.message : r.reason);
  });
  if (cleanMap.size === 0) return rows;
  toast.info(`Tidied up ${cleanMap.size} imported transaction description${cleanMap.size > 1 ? "s" : ""}`);
  return rows.map(t => cleanMap.has(t.id) ? { ...t, name: cleanMap.get(t.id)! } : t);
}

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
  created_at?: string | null;
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

// Illustrative monthly budgets shown only in demo mode — real users set
// their own via "+ Budget" on a category. Shopping is intentionally tight
// against the demo transaction data so there's a genuine over-budget state
// to show, not just an empty "no budget set" screen.
const DEMO_BUDGETS: Record<string, number> = {
  "Bills & Utilities": 3400,
  "Shopping": 500,
  "Groceries": 500,
  "Food & Drink": 350,
  "Transportation": 250,
  "Entertainment": 80,
  "Healthcare": 100,
};

type TxnSort = "date-desc"|"date-asc"|"amount-desc"|"amount-asc"|"name-asc"|"name-desc"|"category-asc";
const SORT_LABELS: Record<TxnSort, string> = {
  "date-desc": "Newest first", "date-asc": "Oldest first",
  "amount-desc": "Largest amount", "amount-asc": "Smallest amount",
  "name-asc": "Name A→Z", "name-desc": "Name Z→A",
  "category-asc": "Category",
};

const EXPENSE_CATEGORIES = [
  // Food
  "Food & Drink", "Groceries",
  // Home & Transport
  "Transportation", "Travel", "Mortgage", "Rent", "Auto Loan", "Home",
  // Bills
  "Bills & Utilities", "Insurance", "Credit Card Payment", "Bill Payment", "Student Loan",
  // Life
  "Shopping", "Entertainment", "Healthcare", "Education", "Personal Care",
  // Finance
  "Financial Services", "Bank Fees", "Business",
  // Giving & transfers
  "Charitable Giving", "Transfer Out", "Transfer In", "Internal Transfer",
  // Money movement the shared classifier files under "Ignored" (never spend).
  "Savings & Investments", "Unreviewed Transfer",
  // Obligations and other types the classifier can assign.
  "Taxes", "Loan Payment", "Cash & ATM",
  // Refunds/returns net back against spend, not income (see "Tax|Refund"
  // mapping below) — a return must reduce what you spent, never count as
  // money earned.
  "Refund / Reimbursement",
  "Other",
];

// Full classification taxonomy — kept broad so auto-categorized transactions
// (mapped from raw Plaid categories via CATEGORY_MAP below, e.g. "Salary",
// "Salary") still classify correctly as income. "Income"/"Dividends"/
// "Interest Earned" are newer, simpler names added alongside the originals
// rather than replacing them, so nothing already categorized as "Salary" or
// "Salary" silently stops counting as income. "Transfer In" is NOT income:
// money from other people (Zelle, Venmo, …) or an unmatched transfer is a
// transfer (shared classifier: transfer_in), listed under Ignored.
// NOTE: "Refund / Reimbursement" deliberately lives in EXPENSE_CATEGORIES,
// not here — a refund/return is money coming back from something you
// already spent on, not newly earned income. Keeping it on the expense
// side means it nets the relevant spend down instead of inflating income.
const INCOME_CATEGORIES = SHARED_INCOME_CATEGORIES;

// The curated set actually offered in the category picker's "Income" section
// — a short, clean list instead of the full classification taxonomy above.
const INCOME_CATEGORIES_PICKER = ["Income", "Dividends", "Interest Earned"];

// Categories that represent money movement to ignore/exclude from spend
// (shown under their own "Ignored" section in the category picker instead of
// mixed into "Expenses" — they remain ordinary EXPENSE_CATEGORIES entries for
// classification purposes, this only changes how the picker groups them).
const IGNORED_CATEGORIES = SHARED_IGNORED_CATEGORIES;

// What the picker's "Expenses" section actually lists — every expense
// category except the ones broken out into "Ignored" above.
const EXPENSE_CATEGORIES_PICKER = EXPENSE_CATEGORIES.filter(c => !IGNORED_CATEGORIES.includes(c));

const ALL_CATEGORIES = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];

const priorityMeta = {
  urgent: { label: "Urgent", dot: "bg-negative", text: "text-negative", chip: "border-negative/30 bg-negative/10 text-negative" },
  soon:   { label: "Soon",   dot: "bg-warning",  text: "text-warning",  chip: "border-warning/30 bg-warning/10 text-warning" },
  info:   { label: "FYI",    dot: "bg-info",     text: "text-info",     chip: "border-info/30 bg-info/10 text-info" },
};

const bucketMeta: Record<Bucket, { label: string; sub: string; tone: "positive"|"negative"|"info"|"warning"; icon: React.ElementType }> = {
  cash:       { label: "Checking & Savings", sub: "Everyday spending and savings",            tone: "positive",  icon: Landmark   },
  credit:     { label: "Credit Cards",       sub: "Statements due this cycle",                tone: "warning",   icon: CreditCard },
  loan:       { label: "Loans & Mortgages",  sub: "Only monthly payment affects cash flow",   tone: "negative",  icon: Building2  },
  investment: { label: "Investments",        sub: "Brokerage & retirement accounts",          tone: "info",      icon: TrendingUp },
  other:      { label: "Other",              sub: "Uncategorized accounts",                   tone: "info",      icon: Landmark   },
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
// ── Bank colors & abbreviated names (no external logo fetch needed) ───────────
const BANK_BRANDS: [string, { color: string; bg: string; abbr: string }][] = [
  ["chase",           { color:"#fff", bg:"#1d6fa5", abbr:"C"  }],
  ["jpmorgan",        { color:"#fff", bg:"#1d6fa5", abbr:"JP" }],
  ["bank of america", { color:"#fff", bg:"#e31837", abbr:"BA" }],
  ["bofa",            { color:"#fff", bg:"#e31837", abbr:"BA" }],
  ["wells fargo",     { color:"#fff", bg:"#cc0000", abbr:"WF" }],
  ["citibank",        { color:"#fff", bg:"#003b8e", abbr:"C"  }],
  ["citi",            { color:"#fff", bg:"#003b8e", abbr:"C"  }],
  ["capital one",     { color:"#fff", bg:"#d03027", abbr:"C1" }],
  ["american express",{ color:"#fff", bg:"#016fd0", abbr:"AX" }],
  ["amex",            { color:"#fff", bg:"#016fd0", abbr:"AX" }],
  ["discover",        { color:"#fff", bg:"#f76400", abbr:"D"  }],
  ["ally",            { color:"#fff", bg:"#6e3aff", abbr:"A"  }],
  ["usaa",            { color:"#fff", bg:"#003087", abbr:"U"  }],
  ["navy federal",    { color:"#fff", bg:"#003087", abbr:"NF" }],
  ["td bank",         { color:"#fff", bg:"#34b233", abbr:"TD" }],
  ["us bank",         { color:"#fff", bg:"#002868", abbr:"US" }],
  ["pnc",             { color:"#fff", bg:"#f58025", abbr:"P"  }],
  ["truist",          { color:"#fff", bg:"#6b0099", abbr:"T"  }],
  ["suntrust",        { color:"#fff", bg:"#6b0099", abbr:"ST" }],
  ["regions",         { color:"#fff", bg:"#005b30", abbr:"R"  }],
  ["fifth third",     { color:"#fff", bg:"#003366", abbr:"53" }],
  ["citizens",        { color:"#fff", bg:"#009947", abbr:"CB" }],
  ["marcus",          { color:"#fff", bg:"#8347ad", abbr:"M"  }],
  ["goldman",         { color:"#fff", bg:"#2c2c2c", abbr:"GS" }],
  ["synchrony",       { color:"#fff", bg:"#2f578f", abbr:"SY" }],
  ["barclays",        { color:"#fff", bg:"#00aeef", abbr:"BA" }],
  ["robinhood",       { color:"#fff", bg:"#00c805", abbr:"RH" }],
  ["fidelity",        { color:"#fff", bg:"#538234", abbr:"F"  }],
  ["vanguard",        { color:"#fff", bg:"#951415", abbr:"V"  }],
  ["schwab",          { color:"#fff", bg:"#00a9e0", abbr:"CS" }],
  ["sofi",            { color:"#fff", bg:"#7b2d8b", abbr:"SF" }],
  ["chime",           { color:"#fff", bg:"#38c172", abbr:"CH" }],
  ["paypal",          { color:"#fff", bg:"#003087", abbr:"PP" }],
  ["venmo",           { color:"#fff", bg:"#3d95ce", abbr:"V"  }],
  ["apple",           { color:"#fff", bg:"#555555", abbr:"AP" }],
  ["coinbase",        { color:"#fff", bg:"#0052ff", abbr:"CB" }],
  ["betterment",      { color:"#fff", bg:"#0f7cf0", abbr:"BT" }],
  ["wealthfront",     { color:"#fff", bg:"#00afc1", abbr:"WF" }],
  ["acorns",          { color:"#fff", bg:"#3aa74c", abbr:"AC" }],
  ["nelnet",          { color:"#fff", bg:"#003da5", abbr:"NL" }],
  ["sallie mae",      { color:"#fff", bg:"#0063a5", abbr:"SM" }],
  ["truist",          { color:"#fff", bg:"#6b0099", abbr:"TR" }],
];

function getBankBrand(instName: string): { color: string; bg: string; abbr: string } {
  const lower = instName.toLowerCase();
  for (const [key, brand] of BANK_BRANDS) {
    if (lower.includes(key)) return brand;
  }
  // Hash to a stable hue
  let hash = 0;
  for (let i = 0; i < lower.length; i++) hash = lower.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  const abbr = instName.slice(0,2).toUpperCase();
  return { color:"#fff", bg:`hsl(${hue} 55% 38%)`, abbr };
}

// Keep these for backward compat — some call sites use them
function getBankLogoUrl(_instName: string): string | null { return null; }
function getBankColor(instName: string): string { return getBankBrand(instName).bg; }

// Color per institution for fallback avatar



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

// Muted, professional category palette — low saturation so the app reads calm
// and restrained (not a rainbow), while categories stay distinguishable in the
// pie/donut. Lightness kept consistent so nothing shouts.
const catColor = (cat: string): string => {
  const c = cat.toLowerCase();
  if (c.includes("groceries"))                                              return "hsl(155 18% 42%)";
  if (c.includes("food") || c.includes("dining") || c.includes("restaurant")) return "hsl(30 22% 44%)";
  if (c.includes("travel") || c.includes("airline") || c.includes("lodging"))  return "hsl(210 22% 44%)";
  if (c.includes("transport") || c.includes("parking") || c.includes("gas"))   return "hsl(250 18% 48%)";
  if (c.includes("utilities") || c.includes("bills"))                      return "hsl(40 20% 42%)";
  if (c.includes("entertainment") || c.includes("streaming"))              return "hsl(320 16% 46%)";
  if (c.includes("health") || c.includes("medical"))                       return "hsl(170 18% 40%)";
  if (c.includes("shopping"))                                               return "hsl(10 20% 44%)";
  if (c.includes("home") || c.includes("rent") || c.includes("mortgage"))  return "hsl(25 20% 42%)";
  if (c.includes("education"))                                              return "hsl(195 20% 42%)";
  if (c.includes("personal"))                                               return "hsl(260 16% 46%)";
  if (c.includes("salary") || c.includes("income"))                        return "hsl(148 20% 38%)";
  if (c.includes("transfer") || c.includes("payment"))                     return "hsl(215 12% 46%)";
  if (c.includes("insurance"))                                              return "hsl(180 16% 40%)";
  if (c.includes("business"))                                               return "hsl(230 18% 44%)";
  return "hsl(215 12% 46%)";
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

// Classifier fallback for the standalone helpers below when the caller
// doesn't pass the component's (override-aware) classification.
type ClassOf = (t: PTxn) => Classification | undefined;
const looseClassOf = (
  txns: PTxn[], overrides: Record<string,string>, getRuleCategory: (m:string|null)=>string|null,
  customCategories: { name: string; type: "income" | "expense" }[] = [],
): ClassOf => {
  const m = classifyAll(txns as ClassifierTxn[], {
    categoryOverrides: overrides,
    ruleCategory: t => getRuleCategory(t.merchant_name ?? t.name ?? null),
    customCategories,
    plaidCategory: t => normalisePlaidCategory(t.category, t.merchant_name, t.name),
  });
  return t => m.get(t.id);
};

/** Linked-account transfer legs (thin wrapper over the shared matcher). */
const detectInternalTransfers = (txns: PTxn[]): Set<string> =>
  new Set(matchInternalTransfers(txns as ClassifierTxn[]).keys());

/** Home 6-month cash-flow chart — same definitions as every other total (src/lib/classify). */
const buildMonthlyFlow = (
  txns: PTxn[],
  overrides: Record<string,string>,
  getRuleCategory: (m:string|null)=>string|null,
  customCategories: { name: string; type: "income" | "expense" }[] = [],
  classOf?: ClassOf,
) => {
  const now = new Date();
  const cls = classOf ?? looseClassOf(txns, overrides, getRuleCategory, customCategories);
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5-i), 1);
    const s = summarizeFlow(txns as ClassifierTxn[], t => cls(t as PTxn), () => "", monthRange(now, i - 5));
    return {
      m: d.toLocaleDateString("en-US", { month: "short" }),
      income: Math.round(s.income),
      spend:  Math.round(s.spending),
    };
  });
};

/** Month-over-month spend change per category, excluding internal transfers */
const buildSpendTrends = (txns: PTxn[], overrides: Record<string,string>, getRuleCategory: (m:string|null)=>string|null, internalIds: Set<string>, customCategories: {name:string;type:"income"|"expense"}[] = [], classOf?: ClassOf) => {
  const now = new Date();
  const cls = classOf ?? looseClassOf(txns, overrides, getRuleCategory, customCategories);
  const real = txns.filter(t => !internalIds.has(t.id));
  const catOf = (t: ClassifierTxn) => getEffectiveCategory(t as PTxn, overrides, getRuleCategory) ?? "Other";
  // Only spend categories (budgetable), so card payments, transfers and
  // obligations can't show up as "spending trends".
  const classOfSpend = (t: ClassifierTxn) => { const c = cls(t as PTxn); return c && (c.type === "spend" || c.type === "refund") ? c : undefined; };
  const cur = summarizeFlow(real as ClassifierTxn[], classOfSpend, catOf, monthRange(now, 0)).spendingByCategory;
  const prev = summarizeFlow(real as ClassifierTxn[], classOfSpend, catOf, monthRange(now, -1)).spendingByCategory;
  const cats = new Set([...Object.keys(cur), ...Object.keys(prev)]);
  return [...cats].map(category => {
    const t = cur[category]?.total ?? 0, l = prev[category]?.total ?? 0;
    return {
      category,
      thisMonth: Math.round(t),
      lastMonth: Math.round(l),
      delta: Math.round(t - l),
      pct: l > 0 ? Math.round(((t - l) / l) * 100) : null,
    };
  }).sort((a,b)=>b.thisMonth-a.thisMonth);
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
 * Shows next 15 days of upcoming charges only.
 */
const detectRecurring = (
  txns: PTxn[],
  internalIds: Set<string> = new Set(),
  suppressMerchants: Set<string> = new Set(),
  suppressCategories: Set<string> = new Set(),
): RecurringCharge[] => {
  const now = new Date(); now.setHours(0,0,0,0);
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, 1);  // 12mo lookback
  const lookahead = new Date(now.getTime() + 15 * 86400000);

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
  // Credit card/loan payments are the user paying down their own debt, not a merchant
  // charge to anticipate — Obligations already tracks statement due dates for these.
  // Including them here made already-made card payments resurface as a projected
  // "upcoming charge" a month out, which reads as showing a past payment as upcoming.
  const PAYMENT_LIKE_CAT = /transfer|credit card payment|loan payment/i;
  // Merchant name patterns that indicate one-off or variable spend even when category data
  // is missing/generic — covers delivery apps, grocery/gas chains, restaurants, and parking.
  const NON_RECURRING_MERCHANT = /doordash|uber eats|grubhub|instacart|postmates|seamless|caviar|amazon fresh|whole foods|trader joe|kroger|safeway|publix|walmart|target|costco|shell|exxon|chevron|bp |sunoco|wawa|speedway|restaurant|cafe|coffee|bistro|grill|kitchen|diner|pizz|sushi|taco|bbq|bar\b|pub\b|brewery|bakery|deli\b|parking|parkmobile|paybyphone|spothero|garage\b|meter\b/i;
  // Statement-descriptor patterns for card/loan payments when category data is missing —
  // "Payment - Thank You" style descriptors Plaid's own category rarely labels precisely.
  const PAYMENT_LIKE_MERCHANT = /payment\s*-?\s*thank\s*you|autopay|auto-pay|card payment|loan payment|statement credit|epayment|online payment/i;

  const norm = (t: PTxn) => (t.merchant_name ?? t.name ?? "").trim().toLowerCase()
    .replace(/\s+(and|&|llc|inc|co\.?|corp\.?)[\s,]*$/i, "").slice(0, 40);

  const expenses = txns.filter(t => {
    if (Number(t.amount) <= 0 || t.pending) return false;
    if (internalIds.has(t.id)) return false; // app-detected internal transfers
    if (new Date(t.date) < twelveMonthsAgo) return false;
    const cat0 = (t.category?.[0] ?? "").toLowerCase();
    const cat1 = (t.category?.[1] ?? "").toLowerCase();
    if (NON_RECURRING_CAT.test(cat0) || NON_RECURRING_CAT.test(cat1)) return false;
    if (PAYMENT_LIKE_CAT.test(cat0) || PAYMENT_LIKE_CAT.test(cat1)) return false;
    if (suppressCategories.has(cat0) || suppressCategories.has(cat1)) return false;
    const merchant = (t.merchant_name ?? t.name ?? "").toLowerCase();
    if (NON_RECURRING_MERCHANT.test(merchant)) return false;
    if (PAYMENT_LIKE_MERCHANT.test(merchant)) return false;
    if (isStatementSummaryText(merchant)) return false;
    if (cat0.includes("transfer")) return false;
    if (suppressMerchants.has(norm(t))) return false; // user-dismissed merchants
    return true;
  });

  // Group by normalized merchant name
  const groups: Record<string, PTxn[]> = {};
  for (const t of expenses) {
    // Cleaned key so "GEICO REF 1234" and "GEICO REF 5678" are one series.
    const key = cleanMerchantKey(t.merchant_name ?? t.name ?? "").slice(0, 40);
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
    if (deduped.length < 3) continue;  // require at least 3 occurrences for recurring

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
      if (matching.length >= Math.max(2, Math.floor(gaps.length * 0.65))) { // ≥65% of gaps match
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

    const displayName = cleanBankText(deduped.find(t => t.merchant_name)?.merchant_name ?? deduped[0].name ?? "") || "Unknown";
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
  customCategories: { name: string; type: "income" | "expense" }[] = [],
): ActionItem[] => {
  const items: ActionItem[] = [];
  const realTxns = txns.filter(t => !internalIds.has(t.id));

  // A positive amount alone isn't reliable proof something is a real expense —
  // a Zelle/ACH transfer between a user's own accounts (e.g. paying yourself
  // from a business account) can post as a positive debit on one side while
  // still being categorized "Salary"/income or a transfer by name/rule. The
  // "Large charge"/"Biggest expense" flags below were surfacing exactly that:
  // a self-transfer labeled "Salary" flagged as an unusual expense. Category
  // is the more authoritative signal here, so it's checked ahead of sign.
  const TRANSFER_LIKE_RE = /transfer|credit card payment|loan payment/i;
  const isRealExpenseTxn = (t: PTxn) => {
    if (Number(t.amount) <= 0) return false;
    const cat = getEffectiveCategory(t, overrides, getRuleCategory) ?? "Other";
    if (isIncomeCategory(cat, customCategories, Number(t.amount))) return false;
    if (TRANSFER_LIKE_RE.test(cat)) return false;
    return true;
  };

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
      const cat = getEffectiveCategory(t, overrides, getRuleCategory) ?? "Other";
      if (isIncomeCategory(cat, customCategories, Number(t.amount))) continue;
      const d = new Date(t.date+"T00:00:00");
      if (d.getMonth() !== thisM || d.getFullYear() !== thisY) continue;
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
      const cat = getEffectiveCategory(t, overrides, getRuleCategory) ?? "Other";
      if (isIncomeCategory(cat, customCategories, Number(t.amount))) continue;
      const d = new Date(t.date+"T00:00:00");
      const mDiff = (thisY - d.getFullYear()) * 12 + (thisM - d.getMonth());
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

      // Check if user is a full-balance payer — suppress generic "pay" nudge if so.
      // Full-balance payer = last payment >= last statement balance (or within 5%).
      const lastPay    = detail?.last_payment_amount ?? 0;
      const lastStmt   = detail?.last_statement_balance ?? 0;
      const paysInFull = lastPay > 0 && lastStmt > 0 && lastPay >= lastStmt * 0.95;

      if (daysUntil <= 7 && daysUntil >= 0) {
        // Only surface if NOT already paying full balance — those users don't need reminders.
        if (!paysInFull) {
          // Determine if checking account has enough to cover this payment
          const checkingAccounts = accounts.filter(a => a.type === "depository" && a.subtype === "checking");
          const checkingTotal = checkingAccounts.reduce((s, a) => s + (Number(a.current_balance) || 0), 0);
          const canCover = checkingTotal >= bal;
          const coverNote = checkingAccounts.length > 0
            ? canCover
              ? ` Checking has ${fmtUSD(checkingTotal)}, sufficient.`
              : ` Checking has ${fmtUSD(checkingTotal)}, short by ${fmtUSD(bal - checkingTotal)}. Fund before due date.`
            : "";
          items.push({
            id: `cc-due-${cc.id}`, priority: daysUntil <= 3 ? "urgent" : "soon",
            title: `${shortName} due in ${daysUntil === 0 ? "today" : `${daysUntil}d`}`,
            detail: `${fmtUSD(bal)} balance${minPay ? ` · min ${fmtUSD(minPay)}` : ""} due ${due.toLocaleDateString("en-US",{month:"short",day:"numeric"})}.${coverNote}`,
            cta: canCover ? "Schedule payment" : "Fund checking", icon: CreditCard,
          });
        }
      }
    } else if (bal > 1000) {
      const lastPay  = detail?.last_payment_amount ?? 0;
      const lastStmt = detail?.last_statement_balance ?? 0;
      const paysInFull = lastPay > 0 && lastStmt > 0 && lastPay >= lastStmt * 0.95;
      if (!paysInFull) {
        items.push({
          id: `cc-${cc.id}`, priority: "soon",
          title: `${shortName} balance due`,
          detail: `${fmtUSD(bal)} balance. Schedule payment before due date.`,
          cta: "Schedule payment", icon: CreditCard,
        });
      }
    }
  });

  // Large unusual transaction (single expense >$500 in last 7 days, not recurring merchant)
  (() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
    const big = realTxns.filter(t =>
      Number(t.amount) > 500 &&
      isRealExpenseTxn(t) &&
      !t.pending &&
      new Date(t.date + "T00:00:00") >= cutoff
    ).sort((a, b) => Number(b.amount) - Number(a.amount));
    if (big.length > 0) {
      const t = big[0];
      items.push({
        id: `large-txn-${t.id}`, priority: "info",
        title: `Large charge: ${fmtUSD(Number(t.amount))}`,
        detail: `${t.merchant_name ?? t.name ?? "Unknown merchant"} on ${fmtShortDate(t.date)}${big.length > 1 ? ` (+${big.length-1} more)` : ""}.`,
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
      if (!isRealExpenseTxn(t) || t.pending) return false;
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
          detail: `${top.merchant_name ?? top.name ?? "Unknown"} on ${fmtShortDate(top.date)}, well above your typical spend.`,
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
// Plaid → app category mapping lives in src/lib/classify/plaid-categories.ts


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
  // 3. Normalised Plaid category (with merchant override for known Plaid ML errors)
  return normalisePlaidCategory(t.category, t.merchant_name, t.name);
};

/**
 * Classify a category as income or expense by ASSIGNMENT, not by the sign of
 * any one transaction. This is what keeps a refund (a negative-amount credit
 * back into an expense category like "Shopping") from being counted as
 * income — it stays grouped under "Shopping" and simply reduces that
 * category's net total, exactly like a real refund should.
 * Falls back to the transaction's own sign only for categories the app has
 * no classification for at all (e.g. an unmapped raw Plaid category).
 */
const isIncomeCategory = (
  cat: string,
  customCategories: { name: string; type: "income" | "expense" }[] = [],
  fallbackAmount?: number,
): boolean => {
  const custom = customCategories.find(c => c.name.toLowerCase() === cat.toLowerCase());
  if (custom) return custom.type === "income";
  if (INCOME_CATEGORIES.some(c => c.toLowerCase() === cat.toLowerCase())) return true;
  // "Other" is EXPENSE_CATEGORIES' catch-all for anything that failed to
  // categorize (null/unmapped Plaid category) — it is NOT a deliberate
  // "this is an expense" assignment, so it must not hard-block a real
  // income deposit (e.g. a paycheck whose category never got backfilled)
  // from falling through to the sign-based fallback below.
  if (cat.toLowerCase() !== "other" && EXPENSE_CATEGORIES.some(c => c.toLowerCase() === cat.toLowerCase())) return false;
  // Unclassified category — fall back to sign (negative = money in) if given.
  return fallbackAmount != null ? fallbackAmount < 0 : false;
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
      {badge && <span className={cn("text-[12px] uppercase tracking-wider px-1.5 py-0.5 rounded border mb-1 inline-block", badgeClass)}>{badge}</span>}
      <div className="font-display text-lg text-foreground leading-snug">{title}</div>
      {subtitle && <div className="text-[12.5px] text-muted-foreground mt-0.5">{subtitle}</div>}
    </div>
    <button onClick={onClose} aria-label="Close" className="shrink-0 h-8 w-8 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
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
      <DialogContent showClose={false} className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">{formatCat(category)} budget</DialogTitle>
        <DialogDescription className="sr-only">Set a monthly spending limit for {formatCat(category)}.</DialogDescription>
        <div className="relative p-6 pb-4">
          <button onClick={onClose} aria-label="Close"
            className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-9 w-9 rounded-lg grid place-items-center shrink-0" style={{backgroundColor:`${color}1f`,color}}>
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-display text-lg text-foreground">{formatCat(category)} budget</h3>
              <div className="text-[12.5px] text-muted-foreground">Monthly spending limit</div>
            </div>
          </div>
          <p className="text-[13px] text-muted-foreground mb-4">
            You'll see a progress bar when you're close to the limit.
          </p>
          <div>
            <label className="text-[12px] uppercase tracking-wider text-muted-foreground">Monthly limit</label>
            <div className="relative mt-2">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[15px]">$</span>
              <input type="number" min={0} step={10} value={val} onChange={e=>setVal(e.target.value)} autoFocus
                onKeyDown={e=>e.key==="Enter"&&save()}
                placeholder="e.g. 500"
                className="w-full bg-surface/40 border border-border/60 rounded-lg pl-7 pr-3 py-3 text-[15px] text-foreground outline-none focus:border-foreground/40" />
            </div>
          </div>
          {current!=null && val && parseFloat(val)!==current && (
            <div className="mt-3 surface-card p-3 text-[13px] text-muted-foreground">
              Changing from <span className="text-foreground font-medium">{fmtUSD(current)}/mo</span> to <span className="text-foreground font-medium">{fmtUSD(parseFloat(val)||0)}/mo</span>
            </div>
          )}
        </div>
        <div className="hairline p-4 flex gap-2">
          <button onClick={save} className="flex-1 inline-flex items-center justify-center h-10 rounded-lg bg-gold text-[14px] font-medium hover:opacity-90">
            {current!=null?"Update budget":"Set budget"}
          </button>
          {current!=null && (
            <button onClick={()=>{onRemove();onClose();}}
              className="h-10 px-4 rounded-lg border text-[13px] text-negative hover:bg-negative/10 transition-colors"
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
            className="flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground" />
          {search && <button aria-label="Clear search" onClick={()=>setSearch("")} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>}
        </div>
        {/* Income / Expense tabs */}
        <div className="flex border-b border-border/30">
          {(["expense","income"] as const).map(t=>(
            <button key={t} onClick={()=>setTab(t)}
              className={cn("flex-1 py-1.5 text-[12.5px] font-medium transition-colors capitalize",
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
                  <span className="text-[13px] text-foreground flex-1">{cat}</span>
                  {active && <Check className="h-3 w-3 text-positive shrink-0" />}
                </button>
                {isCustom && (
                  <button onClick={()=>onRemoveCustom(cat)}
                    aria-label={`Remove custom category ${cat}`}
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
              <span className="text-[13px]">Create "{search}"</span>
            </button>
          )}
          {filtered.length===0 && !canCreate && (
            <div className="px-3 py-4 text-center text-[12.5px] text-muted-foreground">No matches</div>
          )}
        </div>
        {/* Always-apply toggle */}
        {merchant && (
          <label className="flex items-center gap-2 px-3 py-2.5 border-t border-border/30 cursor-pointer hover:bg-secondary/30 transition-colors">
            <input type="checkbox" checked={alwaysApply} onChange={e=>setAlways(e.target.checked)}
              className="accent-[hsl(var(--primary))] h-3.5 w-3.5" />
            <span className="text-[12.5px] text-muted-foreground leading-snug">
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
          <span className={cn("text-[13.5px] font-medium truncate", isInternal ? "line-through text-muted-foreground" : "text-foreground")}>
            {displayName}
          </span>
          {nameOverride && <span className="text-[12px] text-[hsl(var(--primary)/0.5)] shrink-0">edited</span>}
          {isManualInternal && <span className="text-[12px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-muted-foreground/20 bg-secondary/50 text-muted-foreground/60 shrink-0">Transfer</span>}
          {!isManualInternal && isInternal && <span className="text-[12px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-muted-foreground/20 bg-secondary/50 text-muted-foreground/60 shrink-0">Internal</span>}
          {t.pending && <span className="text-[12px] uppercase px-1.5 py-0.5 rounded border border-warning/30 bg-warning/10 text-warning shrink-0">Pending</span>}
        </div>
        <div className="text-[12px] text-muted-foreground flex items-center gap-1 mt-0.5">
          <span>{fmtShortDate(t.date)}</span>
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
      <div className={cn("text-right text-[13.5px] tabular font-semibold shrink-0",
        isInternal?"text-muted-foreground/50":isIncome?"text-positive":"text-foreground")}>
        {isIncome?"+":"−"}{fmtUSD(Math.abs(Number(t.amount)),{cents:true})}
      </div>

      {/* Transfer toggle — hover on desktop, always visible when active */}
      <button
        onClick={e=>{e.stopPropagation();onToggleInternal?.(t.id);}}
        title={isManualInternal ? "Remove transfer mark" : isAutoInternal && !isInternal ? "Auto-detected as transfer (un-flagged, click to re-flag)" : isAutoInternal ? "Auto-detected as transfer, click to un-flag" : "Mark as internal transfer"}
        aria-label={isManualInternal ? "Remove transfer mark" : isAutoInternal && !isInternal ? "Auto-detected as transfer (un-flagged, click to re-flag)" : isAutoInternal ? "Auto-detected as transfer, click to un-flag" : "Mark as internal transfer"}
        className={cn(
          "h-7 w-7 grid place-items-center rounded transition-all shrink-0",
          isManualInternal || isAutoInternal
            ? "text-info bg-info/10"
            : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-secondary/60 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        )}>
        <RepeatIcon className="h-3.5 w-3.5" />
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
  const inputCls = "h-8 rounded-lg bg-secondary/40 border border-border/40 text-[13px] text-foreground px-2.5 outline-none focus:border-[hsl(var(--primary)/0.5)] transition-colors";

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
            <span className="text-[12px] text-muted-foreground">and</span>
            <input type="number" value={c.value2 ?? ""} onChange={e => patch(c.id, { value2: e.target.value })} placeholder="0" className={cn(inputCls, "flex-1 min-w-0")} />
          </>}
        </div>
      );
    if (meta.kind === "date")
      return (
        <div className="flex-1 flex items-center gap-1 min-w-0">
          <input type="date" value={c.value} onChange={e => patch(c.id, { value: e.target.value })} className={cn(inputCls, "flex-1 min-w-0")} />
          {c.op === "between" && <>
            <span className="text-[12px] text-muted-foreground">and</span>
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
        <div className="flex items-center gap-1.5 text-[12.5px]">
          <span className="text-muted-foreground">Match</span>
          <div className="flex rounded-md border border-border/60 overflow-hidden">
            {(["all", "any"] as const).map(m => (
              <button key={m} type="button" onClick={() => onChange({ ...set, match: m })}
                className={cn("px-2.5 py-1 text-[12px] font-medium transition-colors", set.match === m ? "bg-[hsl(var(--primary))] text-background" : "text-muted-foreground hover:text-foreground")}>
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
          <button type="button" onClick={() => removeRow(c.id)} aria-label="Remove condition" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-negative shrink-0">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={addRow} className="inline-flex items-center gap-1 text-[12.5px] text-[hsl(var(--primary))] hover:opacity-80">
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
            <div className="text-[12.5px] text-muted-foreground mt-0.5">Rules apply automatically to every transaction, new and old</div>
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
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border-strong text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors">
              <RefreshCw className="h-3.5 w-3.5" /> Run rules
            </button>
            <button onClick={() => {
                if (tab === "smart") setDraftRule(emptyRule());
                else { setShowNewCat(tab === "category"); setShowNewName(tab === "names"); }
                setEditId(null); setEditNameKey(null);
              }}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-gold text-[13px] font-semibold shrink-0">
              <Plus className="h-3.5 w-3.5" /> New Rule
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-border/20 shrink-0">
          {([["smart", "Smart Rules", smartRules.length], ["category", "Category Rules", rules.length], ["names", "Name Rules", nameEntries.length]] as const).map(([k, label, count]) => (
            <button key={k} onClick={() => setTab(k)}
              className={cn("flex-1 py-2.5 text-[13.5px] font-medium transition-colors border-b-2 -mb-px",
                tab === k ? "border-[hsl(var(--primary))] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {label}
              {count > 0 && <span className={cn("ml-1.5 px-1.5 py-0.5 rounded-full text-[12px]", tab === k ? "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))]" : "bg-border/40 text-muted-foreground")}>{count}</span>}
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
                      className="flex-1 h-8 px-2.5 rounded-lg bg-secondary/40 border border-border/40 text-[13px] font-medium text-foreground outline-none focus:border-[hsl(var(--primary)/0.5)]" />
                  </div>

                  <div className="rounded-lg border border-border/40 p-3 space-y-2">
                    <div className="text-[12px] uppercase tracking-wider text-muted-foreground font-semibold">When a transaction matches</div>
                    <ConditionRows set={{ match: draftRule.match, conditions: draftRule.conditions }}
                      onChange={s => setDraftRule({ ...draftRule, match: s.match, conditions: s.conditions })}
                      accounts={accounts} categoryOptions={categoryOptions} />
                  </div>

                  <div className="rounded-lg border border-border/40 p-3 space-y-2">
                    <div className="text-[12px] uppercase tracking-wider text-muted-foreground font-semibold">Then do</div>
                    {draftRule.actions.map((a, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <select value={a.type} onChange={e => {
                            const type = e.target.value as RuleAction["type"];
                            const next = [...draftRule.actions];
                            next[i] = type === "mark_internal" ? { type } : { type, value: "" } as RuleAction;
                            setDraftRule({ ...draftRule, actions: next });
                          }}
                          className="h-8 w-[130px] shrink-0 rounded-lg bg-secondary/40 border border-border/40 text-[13px] text-foreground px-2 outline-none">
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
                            className="flex-1 min-w-0 h-8 rounded-lg bg-secondary/40 border border-border/40 text-[13px] text-foreground px-2 outline-none focus:border-[hsl(var(--primary)/0.5)]" />
                        )}
                        {a.type === "mark_internal" && <span className="flex-1 text-[12.5px] text-muted-foreground px-1">Excludes it from spending totals</span>}
                        {draftRule.actions.length > 1 && (
                          <button onClick={() => setDraftRule({ ...draftRule, actions: draftRule.actions.filter((_, j) => j !== i) })}
                            aria-label="Remove action" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-negative shrink-0"><X className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                    ))}
                    <datalist id="smart-cats">{categoryOptions.map(o => <option key={o} value={o} />)}</datalist>
                    <button onClick={() => setDraftRule({ ...draftRule, actions: [...draftRule.actions, { type: "set_category", value: "" }] })}
                      className="inline-flex items-center gap-1 text-[12.5px] text-[hsl(var(--primary))] hover:opacity-80"><Plus className="h-3 w-3" /> Add action</button>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[12.5px] text-muted-foreground">
                      Matches <span className="text-[hsl(var(--primary))] font-semibold">{countSmartMatches(draftRule)}</span> current transactions
                    </span>
                    <div className="flex gap-2">
                      <button onClick={() => setDraftRule(null)} className="h-8 px-3 rounded-md border border-border-strong text-[13px] text-muted-foreground">Cancel</button>
                      <button onClick={() => {
                          const clean = { ...draftRule, name: draftRule.name.trim() || "Untitled rule" };
                          if (smartRules.some(r => r.id === clean.id)) onUpdateSmartRule(clean.id, clean);
                          else onAddSmartRule(clean);
                          setDraftRule(null);
                        }}
                        disabled={!draftRule.conditions.some(c => (c.value ?? "").trim() !== "" || c.field === "pending" || c.field === "flow")}
                        className="h-8 px-4 rounded-md bg-gold text-[13px] font-semibold disabled:opacity-50">Save rule</button>
                    </div>
                  </div>
                </div>
              )}

              {smartRules.length === 0 && !draftRule && (
                <div className="py-10 text-center space-y-2 px-6">
                  <div className="h-11 w-11 mx-auto rounded-full bg-[hsl(var(--primary)/0.08)] grid place-items-center">
                    <Wand2 className="h-5 w-5 text-[hsl(var(--primary)/0.6)]" />
                  </div>
                  <div className="text-[14px] text-foreground font-medium">No smart rules yet</div>
                  <div className="text-[13px] text-muted-foreground">Build one rule that combines any conditions - amount, name, fuzzy match, account, date - and set a category, rename, or mark it internal. It runs automatically on new transactions.</div>
                  <button onClick={() => setDraftRule(emptyRule())} className="mt-1 text-[13px] text-[hsl(var(--primary))] underline underline-offset-2">Create your first smart rule</button>
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
                        <div className="text-[13.5px] font-semibold text-foreground">{rule.name}</div>
                        <div className="text-[12.5px] text-muted-foreground mt-0.5">
                          <span className="text-muted-foreground/70">If {rule.match === "all" ? "all" : "any"}: </span>
                          {rule.conditions.map(summary).join(rule.match === "all" ? " and " : " or ")}
                        </div>
                        <div className="text-[12.5px] mt-0.5">
                          <span className="text-muted-foreground/70">Then: </span>
                          <span className="text-foreground">{rule.actions.map(actionSummary).join(", ")}</span>
                        </div>
                        <div className="text-[12px] text-[hsl(var(--primary))] mt-1">{count} match{count !== 1 ? "es" : ""}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => onToggleSmartRule(rule.id)}
                          className={cn("h-7 px-2.5 rounded-full text-[12px] font-medium transition-colors border",
                            rule.enabled ? "bg-positive/10 text-positive border-positive/20" : "bg-border/30 text-muted-foreground border-border/40")}>
                          {rule.enabled ? "On" : "Off"}
                        </button>
                        <button onClick={() => setDraftRule(JSON.parse(JSON.stringify(rule)))}
                          aria-label={`Edit rule ${rule.name}`}
                          className="h-8 w-8 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-border/30"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => onRemoveSmartRule(rule.id)}
                          aria-label={`Delete rule ${rule.name}`}
                          className="h-8 w-8 rounded-md grid place-items-center text-muted-foreground hover:text-negative hover:bg-negative/10"><Trash2 className="h-3.5 w-3.5" /></button>
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
                  <div className="text-[13px] font-semibold text-foreground">New category rule</div>
                  <div className="grid grid-cols-[auto_1fr] gap-2 items-center">
                    <span className="text-[12.5px] text-muted-foreground">When name</span>
                    <select value={newMatchType} onChange={e => setNewMatchType(e.target.value as RuleMatchType)}
                      className="h-8 px-2 rounded-lg bg-secondary/40 border border-border/40 text-[12.5px] outline-none focus:border-[hsl(var(--primary)/0.5)]">
                      <option value="contains">contains</option>
                      <option value="starts_with">starts with</option>
                      <option value="exact">is exactly</option>
                    </select>
                    <span className="text-[12.5px] text-muted-foreground">Pattern</span>
                    <input value={newPattern} onChange={e => setNewPattern(e.target.value)} placeholder="e.g. Amazon, Starbucks…"
                      className="h-8 px-2.5 rounded-lg bg-secondary/40 border border-border/40 text-[12.5px] outline-none focus:border-[hsl(var(--primary)/0.5)]" />
                    <span className="text-[12.5px] text-muted-foreground">Category</span>
                    <input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="e.g. Shopping, Food…"
                      className="h-8 px-2.5 rounded-lg bg-secondary/40 border border-border/40 text-[12.5px] outline-none focus:border-[hsl(var(--primary)/0.5)]" />
                  </div>
                  {newPattern && newCategory && (
                    <div className="text-[12px] text-muted-foreground bg-border/20 rounded-md px-3 py-1.5">
                      When merchant name {matchLabel(newMatchType)} <strong className="text-foreground">"{newPattern}"</strong> → set category to <strong className="text-foreground">{formatCat(newCategory)}</strong>
                      <span className="ml-2 text-[hsl(var(--primary))]">({countMatches(newPattern, newMatchType)} matches)</span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => {
                      if (!newPattern.trim() || !newCategory.trim()) return;
                      onAddCatRule(newPattern.trim(), newCategory.trim(), newMatchType);
                      setNewPattern(""); setNewCategory(""); setNewMatchType("contains"); setShowNewCat(false);
                    }} className="h-8 px-4 rounded-md bg-gold text-[13px] font-semibold">Save rule</button>
                    <button onClick={() => { setShowNewCat(false); setNewPattern(""); setNewCategory(""); }} className="h-8 px-3 rounded-md border border-border-strong text-[13px] text-muted-foreground">Cancel</button>
                  </div>
                </div>
              )}

              {userRules.length === 0 && !showNewCat && (
                <div className="py-10 text-center space-y-2">
                  <div className="text-[14px] text-foreground font-medium">No category rules yet</div>
                  <div className="text-[13px] text-muted-foreground">Rules auto-categorize transactions based on merchant name patterns.</div>
                  <button onClick={() => setShowNewCat(true)} className="mt-2 text-[13px] text-[hsl(var(--primary))] underline underline-offset-2">Create your first rule</button>
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
                        <div className="text-[12.5px] font-semibold text-foreground mb-1">Edit rule</div>
                        <div className="grid grid-cols-[auto_1fr] gap-2 items-center">
                          <span className="text-[12.5px] text-muted-foreground">When name</span>
                          <select value={editMatchType} onChange={e => setEditMatchType(e.target.value as RuleMatchType)}
                            className="h-8 px-2 rounded-lg bg-secondary/40 border border-border/40 text-[12.5px] outline-none focus:border-[hsl(var(--primary)/0.5)]">
                            <option value="contains">contains</option>
                            <option value="starts_with">starts with</option>
                            <option value="exact">is exactly</option>
                          </select>
                          <span className="text-[12.5px] text-muted-foreground">Pattern</span>
                          <input value={editPattern} onChange={e => setEditPattern(e.target.value)}
                            className="h-8 px-2.5 rounded-md bg-background border border-[hsl(var(--primary)/0.4)] text-[12.5px] outline-none focus:border-[hsl(var(--primary)/0.6)]" />
                          <span className="text-[12.5px] text-muted-foreground">Category</span>
                          <input value={editCategory} onChange={e => setEditCategory(e.target.value)}
                            className="h-8 px-2.5 rounded-lg bg-secondary/40 border border-border/40 text-[12.5px] outline-none focus:border-[hsl(var(--primary)/0.5)]" />
                        </div>
                        {editPattern && editCategory && (
                          <div className="text-[12px] text-muted-foreground bg-border/20 rounded-md px-3 py-1.5">
                            When merchant {matchLabel(editMatchType)} <strong className="text-foreground">"{editPattern}"</strong> → <strong className="text-foreground">{formatCat(editCategory)}</strong>
                            <span className="ml-2 text-[hsl(var(--primary))]">({countMatches(editPattern, editMatchType)} matches)</span>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button onClick={() => { onUpdateCatRule(r.id, { pattern: editPattern, matchType: editMatchType, category: editCategory }); setEditId(null); }}
                            className="h-8 px-4 rounded-md bg-gold text-[13px] font-semibold">Save changes</button>
                          <button onClick={() => setEditId(null)} className="h-8 px-3 rounded-md border border-border-strong text-[13px] text-muted-foreground">Cancel</button>
                          <button onClick={() => { onRemoveCatRule(r.id); setEditId(null); }}
                            className="h-8 px-3 rounded-md text-[13px] text-negative hover:bg-negative/10 ml-auto">Delete</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3">
                        <div className="h-8 w-8 rounded-lg grid place-items-center shrink-0 mt-0.5" style={{ backgroundColor: `${color}20`, color }}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13.5px] font-medium text-foreground">
                            When name <span className="text-muted-foreground font-normal">{matchLabel(r.matchType)}</span> <span className="font-semibold">"{r.pattern}"</span>
                          </div>
                          <div className="text-[13px] text-muted-foreground mt-0.5">
                            Category: <span className="text-foreground font-medium">{formatCat(r.category)}</span>
                            <span className="mx-1.5 text-border">·</span>
                            <span className={cn(matches > 0 ? "text-[hsl(var(--primary))]" : "text-muted-foreground")}>{matches} match{matches !== 1 ? "es" : ""}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => onToggleCatRule(r.id)}
                            className={cn("h-7 px-2.5 rounded-full text-[12px] font-medium transition-colors border",
                              r.enabled ? "bg-positive/10 text-positive border-positive/20 hover:bg-positive/20" : "bg-border/30 text-muted-foreground border-border/40 hover:bg-border/50")}>
                            {r.enabled ? "On" : "Off"}
                          </button>
                          <button onClick={() => { setEditId(r.id); setEditPattern(r.pattern); setEditMatchType(r.matchType); setEditCategory(r.category); setShowNewCat(false); }}
                            aria-label={`Edit rule for ${r.pattern}`}
                            className="h-8 w-8 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-border/30 transition-colors">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => onRemoveCatRule(r.id)}
                            aria-label={`Delete rule for ${r.pattern}`}
                            className="h-8 w-8 rounded-md grid place-items-center text-muted-foreground hover:text-negative hover:bg-negative/10 transition-colors">
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
                    <span className="text-[12px] uppercase tracking-wider text-muted-foreground font-semibold">System rules</span>
                    <span className="text-[12px] text-muted-foreground ml-2">(auto-generated, can be toggled)</span>
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
                          <div className="text-[13px] text-foreground">
                            <span className="text-muted-foreground">{matchLabel(r.matchType)} </span>
                            <span className="font-medium">"{r.pattern}"</span>
                            <span className="text-muted-foreground"> → </span>
                            <span className="font-medium">{formatCat(r.category)}</span>
                          </div>
                          <div className="text-[12px] text-muted-foreground">{countMatches(r.pattern, r.matchType)} matches</div>
                        </div>
                        <button onClick={() => onToggleCatRule(r.id)}
                          className={cn("h-7 px-2.5 rounded-full text-[12px] font-medium transition-colors border shrink-0",
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
                  <div className="text-[13px] font-semibold text-foreground">New name rule</div>
                  <div className="grid grid-cols-[auto_1fr] gap-2 items-center">
                    <span className="text-[12.5px] text-muted-foreground">Merchant name</span>
                    <input value={newNameMerchant} onChange={e => setNewNameMerchant(e.target.value)} placeholder="e.g. AMZN Mktp US"
                      className="h-8 px-2.5 rounded-lg bg-secondary/40 border border-border/40 text-[12.5px] outline-none focus:border-[hsl(var(--primary)/0.5)]" />
                    <span className="text-[12.5px] text-muted-foreground">Show as</span>
                    <input value={newNameDisplay} onChange={e => setNewNameDisplay(e.target.value)} placeholder="e.g. Amazon"
                      className="h-8 px-2.5 rounded-lg bg-secondary/40 border border-border/40 text-[12.5px] outline-none focus:border-[hsl(var(--primary)/0.5)]" />
                  </div>
                  {newNameMerchant && newNameDisplay && (
                    <div className="text-[12px] text-muted-foreground bg-border/20 rounded-md px-3 py-1.5">
                      Display <strong className="text-foreground">"{newNameMerchant}"</strong> as <strong className="text-foreground">"{newNameDisplay}"</strong>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => {
                      if (!newNameMerchant.trim() || !newNameDisplay.trim()) return;
                      onSaveNameRule(newNameMerchant.trim(), newNameDisplay.trim());
                      setNewNameMerchant(""); setNewNameDisplay(""); setShowNewName(false);
                    }} className="h-8 px-4 rounded-md bg-gold text-[13px] font-semibold">Save rule</button>
                    <button onClick={() => { setShowNewName(false); setNewNameMerchant(""); setNewNameDisplay(""); }} className="h-8 px-3 rounded-md border border-border-strong text-[13px] text-muted-foreground">Cancel</button>
                  </div>
                </div>
              )}

              {nameEntries.length === 0 && !showNewName && (
                <div className="py-10 text-center space-y-2">
                  <div className="text-[14px] text-foreground font-medium">No name rules yet</div>
                  <div className="text-[13px] text-muted-foreground">Name rules replace how merchant names display across the app.</div>
                  <button onClick={() => setShowNewName(true)} className="mt-2 text-[13px] text-[hsl(var(--primary))] underline underline-offset-2">Create your first rule</button>
                </div>
              )}

              {nameEntries.map(([merchant, display]) => {
                const isEditing = editNameKey === merchant;
                const matchCount = allTxns.filter(t => (t.merchant_name ?? t.name ?? "") === merchant).length;
                return (
                  <div key={merchant} className={cn("px-4 py-3.5 transition-colors", isEditing && "bg-[hsl(var(--primary)/0.04)]")}>
                    {isEditing ? (
                      <div className="space-y-2.5">
                        <div className="text-[12.5px] font-semibold text-foreground mb-1">Edit name rule</div>
                        <div className="grid grid-cols-[auto_1fr] gap-2 items-center">
                          <span className="text-[12.5px] text-muted-foreground">Merchant name</span>
                          <input value={merchant} readOnly className="h-8 px-2.5 rounded-md bg-border/20 border border-border/40 text-[12.5px] text-muted-foreground cursor-not-allowed" />
                          <span className="text-[12.5px] text-muted-foreground">Show as</span>
                          <input value={editNameValue} onChange={e => setEditNameValue(e.target.value)}
                            className="h-8 px-2.5 rounded-md bg-background border border-[hsl(var(--primary)/0.4)] text-[12.5px] outline-none focus:border-[hsl(var(--primary)/0.6)]" />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => { onSaveNameRule(merchant, editNameValue); setEditNameKey(null); }}
                            className="h-8 px-4 rounded-md bg-gold text-[13px] font-semibold">Save changes</button>
                          <button onClick={() => setEditNameKey(null)} className="h-8 px-3 rounded-md border border-border-strong text-[13px] text-muted-foreground">Cancel</button>
                          <button onClick={() => { onRemoveNameRule(merchant); setEditNameKey(null); }}
                            className="h-8 px-3 rounded-md text-[13px] text-negative hover:bg-negative/10 ml-auto">Delete</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-secondary/60 grid place-items-center shrink-0">
                          <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13.5px] font-medium text-foreground">
                            "{merchant}" <span className="text-muted-foreground font-normal mx-1">shown as</span> "{display}"
                          </div>
                          <div className="text-[12.5px] text-muted-foreground mt-0.5">
                            <span className={cn(matchCount > 0 ? "text-[hsl(var(--primary))]" : "text-muted-foreground")}>{matchCount} match{matchCount !== 1 ? "es" : ""}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => { setEditNameKey(merchant); setEditNameValue(display); setShowNewName(false); }}
                            aria-label={`Edit name rule for ${merchant}`}
                            className="h-8 w-8 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-border/30 transition-colors">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => onRemoveNameRule(merchant)}
                            aria-label={`Delete name rule for ${merchant}`}
                            className="h-8 w-8 rounded-md grid place-items-center text-muted-foreground hover:text-negative hover:bg-negative/10 transition-colors">
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
  onAddCategory, onAddRule, onRemoveCustom, onRenameCategory, onSelect, onToggleInternal, isManualInternal, isAutoInternal, isManualExternal,
  onFindSimilar,
  tags, onAddTag, onRemoveTag, note, onSaveNote,
  isRecurringOverride, onSetRecurringOverride, onClearRecurringOverride,
  splits, onSaveSplits, recurringFrequency,
  classification, hasTypeOverride, onSetTxnType, possibleDuplicate,
}: {
  /** Cadence shown by the list that opened this modal (undefined = compute here). */
  recurringFrequency?: string | null;
  classification?: Classification;
  hasTypeOverride?: boolean;
  onSetTxnType?: (type: TxnType | null) => void;
  possibleDuplicate?: boolean;
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
  onRenameCategory?: (oldName: string, newName: string) => void;
  onSelect: (id: string, cat: string) => void;
  onToggleInternal: (id: string) => void;
  isManualInternal: boolean;
  isAutoInternal: boolean;
  isManualExternal: boolean;
  onFindSimilar: (pattern: string) => void;
  tags: string[];
  onAddTag: (id: string, tag: string) => void;
  onRemoveTag: (id: string, tag: string) => void;
  note: string;
  onSaveNote: (id: string, note: string) => void;
  isRecurringOverride?: boolean;
  onSetRecurringOverride: (id: string, val: boolean) => void;
  onClearRecurringOverride: (id: string) => void;
  splits: { label: string; amount: number; category?: string }[];
  onSaveSplits: (id: string, splits: { label: string; amount: number; category?: string }[]) => void;
}) => {
  const merchant = txn.merchant_name ?? txn.name ?? null;
  const rawCat = getEffectiveCategory(txn, overrides, getRuleCategory);
  // Derived straight from the transaction id, not the removable "Imported"
  // tag — so this always reflects the real source even if that tag was
  // edited or removed.
  const isImportedTxn = txn.transaction_id?.startsWith(IMPORT_ID_PREFIX) ?? false;
  const isIncome = Number(txn.amount) < 0;
  const color = isIncome ? "hsl(var(--positive))" : catColor(rawCat ?? "Other");
  const currentDisplayName = nameOverride ?? (merchant ? (nameRules[merchant] ?? merchant) : "Transaction");
  const account = accounts.find(a => a.account_id === txn.account_id);
  const samemerchantTxns = merchant ? allTxns.filter(t => t.id !== txn.id && (t.merchant_name ?? t.name) === merchant) : [];

  // Detect recurring
  // Detect recurring. When opened from the Spending list the caller passes
  // the exact cadence that list shows; otherwise the same shared rules
  // (src/lib/recurring/spending-cadence.ts) are applied here, so the two never disagree
  // (e.g. a grocery store is never labelled "Quarterly").
  const recurringLabel = recurringFrequency !== undefined
    ? recurringFrequency
    : (samemerchantTxns.length < 2 ? null
      : recurringFrequencyFor([txn, ...samemerchantTxns].map(t => t.date), rawCat ?? "Other", currentDisplayName));

  const [tab, setTab] = useState<"info"|"edit">("info");
  const [ruleOpen, setRuleOpen] = useState(false);
  const [reportMiscatOpen, setReportMiscatOpen] = useState(false);
  const [reportMiscatDraft, setReportMiscatDraft] = useState("");
  const [nameDraft, setNameDraft] = useState(currentDisplayName);
  const [showCatPicker, setShowCatPicker] = useState(initialCatOpen ?? false);
  const [ruleDraft, setRuleDraft] = useState(merchant ?? "");
  const [applyAllCat, setApplyAllCat] = useState(samemerchantTxns.length > 0);
  const [saved, setSaved] = useState(false);
  // Category picker's inline "add new" / "rename" states — shared by both the
  // Info and Edit tabs' category field since only one tab is ever visible.
  const [catEditMode, setCatEditMode] = useState<null | "add" | "rename">(null);
  const [catDraftName, setCatDraftName] = useState("");
  const [catDraftType, setCatDraftType] = useState<"income"|"expense">("expense");

  // Tags / note / split — quick-action editors, each a small inline reveal
  // rather than a separate tab since they're one-line inputs.
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteDraft, setNoteDraft] = useState(note);
  const [showSplitEditor, setShowSplitEditor] = useState(false);
  const [splitRows, setSplitRows] = useState<{label:string;amount:string}[]>(() =>
    splits.length ? splits.map(s => ({ label: s.label, amount: String(s.amount) })) : [{ label:"", amount:"" }, { label:"", amount:"" }]
  );
  const splitTotal = splitRows.reduce((s,r) => s + (parseFloat(r.amount) || 0), 0);
  const splitTargetAmt = Math.abs(Number(txn.amount));
  const submitTag = () => { const t = tagDraft.trim(); if (t) { onAddTag(txn.id, t); setTagDraft(""); } };
  const submitNote = () => { onSaveNote(txn.id, noteDraft); setShowNoteInput(false); };
  const submitSplits = () => {
    const rows = splitRows.filter(r => r.label.trim() && parseFloat(r.amount) > 0)
      .map(r => ({ label: r.label.trim(), amount: parseFloat(r.amount) }));
    onSaveSplits(txn.id, rows);
    setShowSplitEditor(false);
  };
  const clearSplits = () => { onSaveSplits(txn.id, []); setSplitRows([{label:"",amount:""},{label:"",amount:""}]); };
  const isRecurringNow = isRecurringOverride ?? !!recurringLabel;

  // Rule builder state (tab=rule)
  const [txnRuleDraft, setTxnRuleDraft] = useState<{match:"all"|"any";conditions:import("@/lib/txn-rules").Condition[]}>({
    match: "all",
    conditions: [{ id: Math.random().toString(36).slice(2), field: "merchant" as const, op: "contains" as const, value: merchant ?? "" }],
  });
  const [txnRuleActions, setTxnRuleActions] = useState<RuleAction[]>([
    { type: "set_category", value: rawCat ?? "Other" }
  ]);

  const handleSaveName = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === currentDisplayName) return;
    onSaveNameOverride(txn.id, trimmed);
    if (applyAllCat && samemerchantTxns.length > 0) onBulkRename(samemerchantTxns.map(t => t.id), trimmed);
    if (merchant) onSaveNameRule(merchant, trimmed);
    setSaved(true); setTimeout(() => setSaved(false), 1500);
    toast.success("Saved");
  };

  const handleCatSelect = (cat: string) => {
    onSelect(txn.id, cat);
    if (applyAllCat && merchant) {
      samemerchantTxns.forEach(t => onSelect(t.id, cat));
      onAddRule(merchant, cat);
      if (samemerchantTxns.length > 0) toast.success(`Applied to ${samemerchantTxns.length + 1} transactions`);
    }
    setShowCatPicker(false);
  };

  // "This is wrong" quick action — unlike the Edit tab's category field
  // (which just changes this one transaction) or "+ Rule" (which creates a
  // rule for whatever category is *currently* assigned), this fixes every
  // other same-merchant transaction that's STILL miscategorized the same
  // wrong way (never ones the user already corrected differently), and
  // creates/updates the rule so future imports land in the right place too.
  const otherMiscatTxns = merchant
    ? samemerchantTxns.filter(t => (getEffectiveCategory(t, overrides, getRuleCategory) ?? "Other") === (rawCat ?? "Other"))
    : [];
  const handleReportMiscategorized = (correctCat: string) => {
    if (!correctCat) return;
    onSelect(txn.id, correctCat);
    otherMiscatTxns.forEach(t => onSelect(t.id, correctCat));
    if (merchant) onAddRule(merchant, correctCat);
    toast.success(otherMiscatTxns.length > 0
      ? `Fixed ${otherMiscatTxns.length + 1} transactions · future ${merchant ?? "these"} charges will categorize correctly`
      : `Fixed · future ${merchant ?? "these"} charges will categorize correctly`);
    setReportMiscatOpen(false);
    setReportMiscatDraft("");
  };

  // ── Category picker: add-new / rename, inline in both tabs' category field ──
  const isCustomCat = (cat: string | null) => !!cat && customCategories.some(c => c.name === cat);
  const cancelCatEdit = () => { setCatEditMode(null); setCatDraftName(""); };
  const startAddCategory = () => { setCatDraftName(""); setCatDraftType(isIncome ? "income" : "expense"); setCatEditMode("add"); };
  const startRenameCategory = () => { if (!rawCat) return; setCatDraftName(rawCat); setCatEditMode("rename"); };
  const confirmAddCategory = () => {
    const name = catDraftName.trim();
    if (!name) return;
    onAddCategory(name, catDraftType);
    handleCatSelect(name);
    cancelCatEdit();
    toast.success(`Created "${name}"`);
  };
  const confirmRenameCategory = () => {
    const name = catDraftName.trim();
    if (!name || !rawCat || !onRenameCategory) return;
    onRenameCategory(rawCat, name);
    cancelCatEdit();
    toast.success(`Renamed to "${name}"`);
  };

  // Shared category field for both tabs — a select with an "Add new
  // category…" option, plus a rename button that appears whenever the
  // currently-assigned category is a custom one.
  const renderCategoryField = () => {
    if (catEditMode === "add") {
      return (
        <div className="flex items-center gap-2">
          <input autoFocus value={catDraftName} onChange={e=>setCatDraftName(e.target.value)}
            placeholder="New category name…"
            onKeyDown={e=>{ if (e.key==="Enter") confirmAddCategory(); if (e.key==="Escape") cancelCatEdit(); }}
            className="flex-1 min-w-0 bg-muted/40 border border-border/50 rounded-xl px-3 py-2.5 text-[13px] text-foreground outline-none focus:border-primary/50"/>
          <select value={catDraftType} onChange={e=>setCatDraftType(e.target.value as "income"|"expense")}
            className="bg-muted/40 border border-border/50 rounded-xl px-2 py-2.5 text-[13px] text-foreground outline-none shrink-0">
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
          <button onClick={confirmAddCategory} aria-label="Create category" className="h-10 w-10 grid place-items-center rounded-xl bg-gold shrink-0"><Check className="h-4 w-4"/></button>
          <button onClick={cancelCatEdit} aria-label="Cancel adding category" className="h-10 w-10 grid place-items-center rounded-xl text-muted-foreground hover:text-foreground shrink-0"><X className="h-4 w-4"/></button>
        </div>
      );
    }
    if (catEditMode === "rename") {
      return (
        <div className="flex items-center gap-2">
          <input autoFocus value={catDraftName} onChange={e=>setCatDraftName(e.target.value)}
            onKeyDown={e=>{ if (e.key==="Enter") confirmRenameCategory(); if (e.key==="Escape") cancelCatEdit(); }}
            className="flex-1 min-w-0 bg-muted/40 border border-[hsl(var(--primary)/0.4)] rounded-xl px-3 py-2.5 text-[13px] text-foreground outline-none"/>
          <button onClick={confirmRenameCategory} aria-label="Save category name" className="h-10 w-10 grid place-items-center rounded-xl bg-gold shrink-0"><Check className="h-4 w-4"/></button>
          <button onClick={cancelCatEdit} aria-label="Cancel rename" className="h-10 w-10 grid place-items-center rounded-xl text-muted-foreground hover:text-foreground shrink-0"><X className="h-4 w-4"/></button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5">
        <select
          value={rawCat ?? "Other"}
          onChange={e => { if (e.target.value === "__add_new__") startAddCategory(); else handleCatSelect(e.target.value); }}
          className="flex-1 min-w-0 bg-muted/40 border border-border/50 rounded-xl px-3 py-2.5 text-[13px] text-foreground outline-none focus:border-primary/50">
          {/* Grouped the same way as the table's category picker — Expenses,
              Income, Ignored — via native <optgroup>s instead of one long
              flat list. Uses the full classification arrays (not the
              shorter curated *_PICKER lists) so a transaction already
              assigned an less-common category like "Salary" or "Transfer
              In" still has its current value represented as a selectable
              option instead of silently falling off the list. */}
          <optgroup label="Expenses">
            {[...EXPENSE_CATEGORIES.filter(c => !IGNORED_CATEGORIES.includes(c)), ...customCategories.filter(c=>c.type==="expense").map(c=>c.name)].map(cat => (
              <option key={cat} value={cat}>{humanizeCategory(cat, Number(txn.amount))}</option>
            ))}
          </optgroup>
          <optgroup label="Income">
            {[...INCOME_CATEGORIES, ...customCategories.filter(c=>c.type==="income").map(c=>c.name)].map(cat => (
              <option key={cat} value={cat}>{humanizeCategory(cat, Number(txn.amount))}</option>
            ))}
          </optgroup>
          <optgroup label="Ignored">
            {IGNORED_CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{humanizeCategory(cat, Number(txn.amount))}</option>
            ))}
          </optgroup>
          <option value="__add_new__">+ Add new category…</option>
        </select>
        {isCustomCat(rawCat) && onRenameCategory && (
          <button onClick={startRenameCategory} aria-label="Rename category" title="Rename category"
            className="h-10 w-10 grid place-items-center rounded-xl border border-border/50 text-muted-foreground hover:text-foreground shrink-0">
            <Pencil className="h-3.5 w-3.5"/>
          </button>
        )}
      </div>
    );
  };

  const handleCreateRule = () => {
    if (!ruleDraft.trim() || !rawCat) return;
    onAddRule(ruleDraft.trim(), rawCat);
    toast.success("Rule created → " + humanizeCategory(rawCat, Number(txn.amount)));
    setTab("info");
  };

  const amt = Math.abs(Number(txn.amount));
  const dateStr = fmtDayDate(txn.date);

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      {/* Phones: a bottom sheet (full width, anchored to the bottom edge,
          padded by the bottom safe-area inset) instead of a centered card. */}
      <DialogContent className={cn("max-w-sm w-full surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[92dvh] flex flex-col rounded-2xl",
        "max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:translate-x-0 max-md:translate-y-0 max-md:max-w-none max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0 max-md:pb-[env(safe-area-inset-bottom)]",
        "max-md:data-[state=open]:slide-in-from-left-0 max-md:data-[state=open]:slide-in-from-bottom-full max-md:data-[state=closed]:slide-out-to-left-0 max-md:data-[state=closed]:slide-out-to-bottom-full max-md:data-[state=open]:zoom-in-100 max-md:data-[state=closed]:zoom-out-100")}>
        <DialogTitle className="sr-only">Transaction details</DialogTitle>
        <DialogDescription className="sr-only">Transaction info, edit, and rules.</DialogDescription>

        {/* ── Header ── */}
        <div className="px-5 pt-5 pb-4 shrink-0">
          <div className="flex items-start gap-3">
            {/* Category color dot */}
            <div className="h-10 w-10 rounded-xl shrink-0 flex items-center justify-center text-lg font-bold" style={{background:`${color}20`, color}}>
              {(merchant ?? "?").charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-display text-[15px] text-foreground truncate">{currentDisplayName}</p>
              <p className="text-[12px] text-muted-foreground mt-0.5 truncate">
                {dateStr}{account ? ` · ${account.name ?? account.official_name ?? "account"}${account.mask ? ` ··${account.mask}` : ""}` : ""}{txn.pending ? " · Pending" : ""}{isImportedTxn ? " · Imported from PDF" : ""}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className={cn("text-[18px] font-bold tabular", isIncome ? "text-positive" : "text-foreground")}>
                {fmtTxnAmount(txn.amount, {cents: true})}
              </p>
              {recurringLabel && <p className="text-[10px] text-muted-foreground/70">{recurringLabel}</p>}
            </div>
          </div>

          {/* Tab row */}
          <div className="flex gap-1 mt-4 bg-muted/50 rounded-xl p-1">
            {(["info","edit"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={cn("flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-all",
                  tab === t ? "bg-card shadow text-foreground" : "text-muted-foreground")}>
                {t === "info" ? "Details" : "Edit"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">

          {/* ── INFO TAB ── */}
          {tab === "info" && (
            <div className="px-5 pb-5 space-y-3">

              {/* Category — dropdown, plus inline "add new" / rename */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Category</label>
                {renderCategoryField()}
              </div>

              {/* Field/value grid — constrained to prevent overflow. Merchant is
                  only shown here when it differs from the title above (i.e. a
                  custom display name is hiding the real merchant) — otherwise
                  it's the same text already visible in the header. */}
              <div className="rounded-xl border border-border/30 overflow-hidden divide-y divide-border/20">
                {([
                  ...(merchant && merchant !== currentDisplayName ? [["Merchant", merchant]] : []),
                  ["Channel",   txn.payment_channel?.replace(/_/g, " ") ?? "-"],
                  ...(samemerchantTxns.length > 0 ? [["History", `${samemerchantTxns.length} past txns`]] : []),
                ] as [string,string][]).map(([label, value]) => (
                  <div key={label} className="flex items-center gap-3 px-4 py-2.5 bg-card/50">
                    <span className="text-[12px] text-muted-foreground w-20 shrink-0">{label}</span>
                    <span className="text-[12.5px] text-foreground font-medium truncate capitalize flex-1 text-right">{value}</span>
                  </div>
                ))}
              </div>

              {/* Ignored / Recurring — explicit yes/no toggles */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => onToggleInternal(txn.id)}
                  className={cn("py-2.5 rounded-xl border text-[11.5px] font-medium transition-colors flex items-center justify-center gap-1.5",
                    (isManualInternal || isAutoInternal) && !isManualExternal
                      ? "border-blue-500/40 text-blue-400 bg-blue-500/8"
                      : "border-border/60 text-muted-foreground hover:text-foreground")}>
                  Ignored: {(isManualInternal || isAutoInternal) && !isManualExternal ? "Yes" : "No"}
                </button>
                <button
                  onClick={() => onSetRecurringOverride(txn.id, !isRecurringNow)}
                  className={cn("py-2.5 rounded-xl border text-[11.5px] font-medium transition-colors flex items-center justify-center gap-1.5",
                    isRecurringNow
                      ? "border-violet-500/40 text-violet-400 bg-violet-500/8"
                      : "border-border/60 text-muted-foreground hover:text-foreground")}>
                  Recurring: {isRecurringNow ? (recurringLabel ?? "Yes") : "No"}
                  {isRecurringOverride === undefined && recurringLabel && <span className="text-[9px] opacity-60">(auto)</span>}
                </button>
                {isRecurringOverride !== undefined && (
                  <button onClick={() => onClearRecurringOverride(txn.id)}
                    className="col-span-2 -mt-1 text-[10.5px] text-muted-foreground/70 hover:text-foreground underline underline-offset-2">
                    Reset to auto-detected
                  </button>
                )}
              </div>

              {/* How this transaction counts in totals (shared classifier). A
                  choice here is saved per transaction and always wins. */}
              {classification && onSetTxnType && (
                <div className="rounded-xl border border-border/30 px-4 py-2.5 bg-card/50 space-y-1">
                  <div className="flex items-center gap-3">
                    <label htmlFor={`txn-type-${txn.id}`} className="text-[12px] text-muted-foreground w-20 shrink-0">Counts as</label>
                    <select id={`txn-type-${txn.id}`} value={classification.type}
                      onChange={e => onSetTxnType(e.target.value as TxnType)}
                      className="flex-1 bg-transparent text-[12.5px] text-foreground font-medium text-right outline-none cursor-pointer">
                      {TXN_TYPES.map(tp => <option key={tp} value={tp}>{TXN_TYPE_LABEL[tp]}</option>)}
                    </select>
                  </div>
                  <div className="text-[11px] text-muted-foreground/80 flex items-center gap-2">
                    <span className="flex-1">{hasTypeOverride ? "Set by you" : classification.reason}</span>
                    {hasTypeOverride && (
                      <button onClick={() => onSetTxnType(null)} className="underline underline-offset-2 hover:text-foreground">Use automatic</button>
                    )}
                  </div>
                </div>
              )}
              {possibleDuplicate && (
                <div className="rounded-xl border border-gold/40 bg-gold/5 px-4 py-2 text-[11.5px] text-foreground">
                  Possible duplicate: another posted transaction on this account has the same date, amount and merchant. Nothing was removed.
                </div>
              )}

              {/* Tags */}
              <div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {tags.map(t => (
                    <span key={t} className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-full bg-muted/60 border border-border/60 text-[11px] font-medium text-foreground">
                      {t}
                      <button onClick={() => onRemoveTag(txn.id, t)} aria-label={`Remove tag ${t}`} className="h-3.5 w-3.5 rounded-full grid place-items-center hover:bg-muted"><X className="h-2.5 w-2.5"/></button>
                    </span>
                  ))}
                  {showTagInput ? (
                    <div className="flex items-center gap-1">
                      <input autoFocus value={tagDraft} onChange={e=>setTagDraft(e.target.value)}
                        onKeyDown={e=>{ if(e.key==="Enter") submitTag(); if(e.key==="Escape") setShowTagInput(false); }}
                        placeholder="Tag name" className="h-6 w-24 px-2 rounded-full bg-muted/40 border border-border/60 text-[11px] text-foreground outline-none"/>
                      <button onClick={submitTag} aria-label="Add tag" className="h-6 w-6 grid place-items-center rounded-full bg-gold"><Check className="h-3 w-3"/></button>
                    </div>
                  ) : (
                    <button onClick={()=>setShowTagInput(true)} className="inline-flex items-center gap-1 h-6 px-2 rounded-full border border-dashed border-border/60 text-[11px] text-muted-foreground hover:text-foreground hover:border-border transition-colors">
                      <Plus className="h-2.5 w-2.5"/> Tag
                    </button>
                  )}
                </div>
              </div>

              {/* Note */}
              <div>
                {showNoteInput ? (
                  <div className="space-y-1.5">
                    <textarea autoFocus value={noteDraft} onChange={e=>setNoteDraft(e.target.value)} rows={2} placeholder="Add a note..."
                      className="w-full bg-muted/40 border border-border/60 rounded-xl px-3 py-2 text-[12.5px] text-foreground outline-none focus:border-primary/50 resize-none"/>
                    <div className="flex gap-2">
                      <button onClick={submitNote} className="flex-1 py-1.5 rounded-lg bg-primary text-primary-foreground text-[11.5px] font-semibold">Save note</button>
                      <button onClick={()=>{setShowNoteInput(false);setNoteDraft(note);}} className="px-3 py-1.5 rounded-lg border border-border/60 text-[11.5px] text-muted-foreground">Cancel</button>
                    </div>
                  </div>
                ) : note ? (
                  <button onClick={()=>setShowNoteInput(true)} className="w-full text-left p-2.5 rounded-xl bg-muted/30 border border-border/40 text-[12px] text-foreground hover:bg-muted/40 transition-colors">
                    {note}
                  </button>
                ) : (
                  <button onClick={()=>setShowNoteInput(true)} className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground hover:text-foreground transition-colors">
                    <Plus className="h-3 w-3"/> Add note
                  </button>
                )}
              </div>

              {/* Split */}
              {showSplitEditor ? (
                <div className="border border-border/60 rounded-xl p-3 space-y-2">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Split this transaction</p>
                  {splitRows.map((row, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <input value={row.label} onChange={e=>setSplitRows(rows=>rows.map((r,ri)=>ri===i?{...r,label:e.target.value}:r))}
                        placeholder={`Split ${i+1} label`} className="flex-1 min-w-0 h-8 px-2.5 rounded-lg bg-muted/40 border border-border/60 text-[12px] text-foreground outline-none"/>
                      <div className="relative w-20 shrink-0">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">$</span>
                        <input type="number" min={0} value={row.amount} onChange={e=>setSplitRows(rows=>rows.map((r,ri)=>ri===i?{...r,amount:e.target.value}:r))}
                          className="w-full h-8 pl-5 pr-1.5 rounded-lg bg-muted/40 border border-border/60 text-[12px] text-foreground outline-none"/>
                      </div>
                      <button onClick={()=>setSplitRows(rows=>rows.filter((_,ri)=>ri!==i))} aria-label="Remove split row" className="h-8 w-8 grid place-items-center text-muted-foreground/50 hover:text-negative shrink-0"><X className="h-3.5 w-3.5"/></button>
                    </div>
                  ))}
                  <button onClick={()=>setSplitRows(rows=>[...rows,{label:"",amount:""}])} className="text-[11.5px] text-[hsl(var(--primary))] font-medium flex items-center gap-1"><Plus className="h-3 w-3"/> Add split</button>
                  <div className={cn("text-[11px] pt-1", Math.abs(splitTotal - splitTargetAmt) < 0.01 ? "text-muted-foreground" : "text-warning")}>
                    Splits total {fmtUSD(splitTotal)} of {fmtUSD(splitTargetAmt)}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={submitSplits} className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-[12px] font-semibold">Save splits</button>
                    <button onClick={()=>setShowSplitEditor(false)} className="px-3 py-2 rounded-lg border border-border/60 text-[12px] text-muted-foreground">Cancel</button>
                  </div>
                </div>
              ) : splits.length > 0 ? (
                <div className="border border-border/40 rounded-xl p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Split</p>
                    <div className="flex items-center gap-2">
                      <button onClick={()=>setShowSplitEditor(true)} className="text-[11px] text-[hsl(var(--primary))] font-medium">Edit</button>
                      <button onClick={clearSplits} className="text-[11px] text-muted-foreground hover:text-negative">Clear</button>
                    </div>
                  </div>
                  {splits.map((s,i) => (
                    <div key={i} className="flex items-center justify-between text-[12px]">
                      <span className="text-foreground truncate">{s.label}</span>
                      <span className="text-muted-foreground tabular shrink-0 ml-2">{fmtUSD(s.amount)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <button onClick={()=>setShowSplitEditor(true)} className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground hover:text-foreground transition-colors">
                  <Plus className="h-3 w-3"/> Split transaction
                </button>
              )}

              {/* Quick action row */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                <button
                  onClick={() => { onFindSimilar(merchant ?? ""); onClose(); }}
                  disabled={!merchant}
                  className="py-2.5 rounded-xl border border-border/60 text-[11.5px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
                  Find similar
                </button>
                <button
                  onClick={() => setRuleOpen(true)}
                  className="py-2.5 rounded-xl border border-border/60 text-[11.5px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                  + Rule
                </button>
                <button
                  onClick={() => { setReportMiscatDraft(rawCat ?? "Other"); setReportMiscatOpen(true); }}
                  title="Report this category as wrong and fix it everywhere"
                  className="py-2.5 rounded-xl border border-negative/30 text-[11.5px] font-medium text-negative hover:bg-negative/10 transition-colors">
                  Wrong category?
                </button>
              </div>
            </div>
          )}

          {/* ── EDIT TAB ── */}
          {tab === "edit" && (
            <div className="px-5 pb-5 space-y-4">
              {/* Rename */}
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Display name</label>
                <input
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSaveName()}
                  className="w-full bg-muted/40 border border-border rounded-xl px-3.5 py-2.5 text-[13.5px] text-foreground outline-none focus:border-primary/50"
                />
                {samemerchantTxns.length > 0 && (
                  <label className="flex items-center gap-2 mt-2 cursor-pointer">
                    <input type="checkbox" checked={applyAllCat} onChange={e => setApplyAllCat(e.target.checked)} className="h-4 w-4 rounded accent-primary" />
                    <span className="text-[12px] text-muted-foreground">Apply to all {samemerchantTxns.length + 1} {merchant} transactions</span>
                  </label>
                )}
              </div>

              {/* Category — simple dropdown */}
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Category</label>
                {renderCategoryField()}
                {samemerchantTxns.length > 0 && (
                  <label className="flex items-center gap-2 mt-2 cursor-pointer">
                    <input type="checkbox" checked={applyAllCat} onChange={e => setApplyAllCat(e.target.checked)} className="h-4 w-4 rounded accent-primary" />
                    <span className="text-[12px] text-muted-foreground">Apply to all {samemerchantTxns.length + 1} {merchant} transactions</span>
                  </label>
                )}
              </div>

              <button
                onClick={handleSaveName}
                disabled={!nameDraft.trim() || nameDraft === currentDisplayName}
                className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold disabled:opacity-40 transition-opacity">
                {saved ? "✓ Saved" : "Save changes"}
              </button>
            </div>
          )}

        </div>

        {/* ── Rule creation overlay sheet ─────────────────────── */}
        {ruleOpen && (
          <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/50 rounded-2xl" onClick={() => setRuleOpen(false)}>
            <div className="bg-card rounded-t-2xl border-t border-border/40 max-h-[82%] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex justify-center pt-2.5 pb-1 shrink-0">
                <div className="w-8 h-1 rounded-full bg-muted-foreground/30"/>
              </div>
              <div className="flex items-center justify-between px-5 py-3 border-b border-border/30 shrink-0">
                <p className="font-display text-[15px] text-foreground">Create rule</p>
                <button onClick={() => setRuleOpen(false)} aria-label="Close" className="h-8 w-8 grid place-items-center rounded-full bg-muted/60 text-muted-foreground">
                  <X className="h-4 w-4"/>
                </button>
              </div>
              <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Rule name</label>
                  <input value={ruleDraft} onChange={e => setRuleDraft(e.target.value)} placeholder={`Rule for ${merchant ?? "this merchant"}...`}
                    className="w-full bg-muted/40 border border-border/50 rounded-xl px-3.5 py-2.5 text-[13px] text-foreground outline-none focus:border-primary/50"/>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">If</label>
                    <select value={txnRuleDraft.match} onChange={e => setTxnRuleDraft(d => ({...d, match: e.target.value as "all"|"any"}))}
                      className="h-7 px-2 rounded-lg bg-muted/40 border border-border/40 text-[12px] text-foreground outline-none">
                      <option value="all">ALL match</option>
                      <option value="any">ANY match</option>
                    </select>
                  </div>
                  <ConditionRows set={txnRuleDraft} onChange={s => setTxnRuleDraft(prev => ({...prev, ...s}))} accounts={accounts} categoryOptions={[...ALL_CATEGORIES, ...customCategories.map(cx => cx.name)]}/>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Then</label>
                    <button onClick={() => setTxnRuleActions(a => [...a, {type:"set_category",value:""}])} className="text-[11px] text-primary font-medium">+ Add action</button>
                  </div>
                  <div className="space-y-2">
                    {txnRuleActions.map((action, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <select value={action.type} onChange={e => {
                          const type = e.target.value as RuleAction["type"];
                          const next = [...txnRuleActions];
                          if (type === "mark_internal" || type === "ignore") next[i] = {type} as RuleAction;
                          else next[i] = {type, value:""} as RuleAction;
                          setTxnRuleActions(next);
                        }} className="h-9 px-2 rounded-lg bg-muted/40 border border-border/40 text-[12px] text-foreground outline-none shrink-0">
                          <option value="set_category">Set category</option>
                          <option value="rename">Rename to</option>
                          <option value="mark_internal">Mark internal</option>
                          <option value="ignore">Ignore / hide</option>
                        </select>
                        {action.type === "set_category" && (
                          <select value={(action as any).value} onChange={e => { const n=[...txnRuleActions]; n[i]={type:"set_category",value:e.target.value}; setTxnRuleActions(n); }}
                            className="flex-1 h-9 px-2 rounded-lg bg-muted/40 border border-border/40 text-[12px] text-foreground outline-none min-w-0">
                            <option value="">Category...</option>
                            <optgroup label="Expenses">
                              {[...EXPENSE_CATEGORIES.filter(c => !IGNORED_CATEGORIES.includes(c)), ...customCategories.filter(c=>c.type==="expense").map(c=>c.name)].map(cat=><option key={cat} value={cat}>{humanizeCategory(cat, Number(txn.amount))}</option>)}
                            </optgroup>
                            <optgroup label="Income">
                              {[...INCOME_CATEGORIES, ...customCategories.filter(c=>c.type==="income").map(c=>c.name)].map(cat=><option key={cat} value={cat}>{humanizeCategory(cat, Number(txn.amount))}</option>)}
                            </optgroup>
                            <optgroup label="Ignored">
                              {IGNORED_CATEGORIES.map(cat=><option key={cat} value={cat}>{humanizeCategory(cat, Number(txn.amount))}</option>)}
                            </optgroup>
                          </select>
                        )}
                        {action.type === "rename" && (
                          <input value={(action as any).value} onChange={e => { const n=[...txnRuleActions]; n[i]={type:"rename",value:e.target.value}; setTxnRuleActions(n); }}
                            placeholder="New name..." className="flex-1 h-9 px-2.5 rounded-lg bg-muted/40 border border-border/40 text-[12px] text-foreground outline-none min-w-0"/>
                        )}
                        {txnRuleActions.length > 1 && (
                          <button onClick={() => setTxnRuleActions(a => a.filter((_,x)=>x!==i))} aria-label="Remove action" className="h-9 w-7 text-muted-foreground hover:text-destructive grid place-items-center shrink-0">
                            <X className="h-3.5 w-3.5"/>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="px-5 py-4 border-t border-border/30 shrink-0">
                <button onClick={() => {
                  if (!ruleDraft.trim()) return;
                  const catAction = txnRuleActions.find(a => a.type === "set_category") as {type:"set_category";value:string}|undefined;
                  onAddRule(ruleDraft.trim(), catAction?.value ?? rawCat ?? "Other");
                  setRuleOpen(false);
                }} disabled={!ruleDraft.trim()} className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-[14px] font-bold disabled:opacity-40">
                  Save rule
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── "Wrong category?" overlay sheet ─────────────────────── */}
        {reportMiscatOpen && (
          <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/50 rounded-2xl" onClick={() => setReportMiscatOpen(false)}>
            <div className="bg-card rounded-t-2xl border-t border-border/40 max-h-[82%] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex justify-center pt-2.5 pb-1 shrink-0">
                <div className="w-8 h-1 rounded-full bg-muted-foreground/30"/>
              </div>
              <div className="flex items-center justify-between px-5 py-3 border-b border-border/30 shrink-0">
                <p className="font-display text-[15px] text-foreground">What's the correct category?</p>
                <button onClick={() => setReportMiscatOpen(false)} aria-label="Close" className="h-8 w-8 grid place-items-center rounded-full bg-muted/60 text-muted-foreground">
                  <X className="h-4 w-4"/>
                </button>
              </div>
              <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
                <p className="text-[12.5px] text-muted-foreground leading-relaxed">
                  Currently categorized as <span className="font-medium text-foreground">{humanizeCategory(rawCat ?? "Other", Number(txn.amount))}</span>.
                  {otherMiscatTxns.length > 0
                    ? ` This will also fix ${otherMiscatTxns.length} other ${merchant ?? "matching"} transaction${otherMiscatTxns.length===1?"":"s"} still categorized the same way, and`
                    : " This will"} create a rule so future {merchant ?? "these"} charges are categorized correctly automatically.
                </p>
                <select value={reportMiscatDraft} onChange={e => setReportMiscatDraft(e.target.value)}
                  className="w-full bg-muted/40 border border-border/50 rounded-xl px-3.5 py-2.5 text-[13px] text-foreground outline-none focus:border-primary/50">
                  <option value="" disabled>Choose the correct category…</option>
                  <optgroup label="Expenses">
                    {[...EXPENSE_CATEGORIES.filter(c => !IGNORED_CATEGORIES.includes(c)), ...customCategories.filter(c=>c.type==="expense").map(c=>c.name)].map(cat => (
                      <option key={cat} value={cat}>{humanizeCategory(cat, Number(txn.amount))}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Income">
                    {[...INCOME_CATEGORIES, ...customCategories.filter(c=>c.type==="income").map(c=>c.name)].map(cat => (
                      <option key={cat} value={cat}>{humanizeCategory(cat, Number(txn.amount))}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Ignored">
                    {IGNORED_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{humanizeCategory(cat, Number(txn.amount))}</option>
                    ))}
                  </optgroup>
                </select>
              </div>
              <div className="px-5 py-4 border-t border-border/30 shrink-0">
                <button onClick={() => handleReportMiscategorized(reportMiscatDraft)}
                  disabled={!reportMiscatDraft || reportMiscatDraft === (rawCat ?? "Other")}
                  className="w-full py-3 rounded-xl bg-negative text-negative-foreground text-[14px] font-bold disabled:opacity-40">
                  Fix it
                </button>
              </div>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
};


// ── Positioned picker — rendered at root level of each view ───

// ── Sortable panel card ──────────────────────────────────────────
const SpendingCatPopup = ({ cat, txns, accounts, nameOverrides, onClose, onOpenDetail }: {
  cat: string;
  txns: PTxn[];
  accounts: PAccount[];
  nameOverrides: Record<string,string>;
  onClose: () => void;
  onOpenDetail: (t: PTxn) => void;
}) => {
  const total = txns.reduce((s,t) => s + Number(t.amount), 0);
  const Icon = categoryIcon(cat);
  const color = catColor(cat);
  return (
    <Dialog open onOpenChange={o => { if(!o) onClose(); }}>
      <DialogContent className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[85dvh] flex flex-col">
        <DialogTitle className="sr-only">{formatCat(cat)}</DialogTitle>
        <DialogDescription className="sr-only">Transactions for {formatCat(cat)}</DialogDescription>
        <div className="px-5 py-4 border-b border-border/30 flex items-center gap-3 shrink-0">
          <div className="h-9 w-9 rounded-xl grid place-items-center shrink-0" style={{backgroundColor:`${color}20`,color}}>
            <Icon className="h-4 w-4"/>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-display text-[15px] text-foreground">{formatCat(cat)}</div>
            <div className="text-[12.5px] text-muted-foreground">{txns.length} transactions · {fmtUSD(total)}</div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-border/10">
          {txns.length === 0 ? (
            <div className="p-10 text-center text-[13px] text-muted-foreground">No transactions</div>
          ) : txns.map(t => {
            const acc = accounts.find(a => a.account_id === t.account_id);
            return (
              <button key={t.id} onClick={() => onOpenDetail(t)}
                className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-surface-hover/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-foreground truncate">
                    {nameOverrides[t.id] ?? t.merchant_name ?? t.name}
                  </div>
                  <div className="text-[12px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                    <span>{fmtShortDate(t.date)}</span>
                    {acc && <><span>·</span><span className="truncate max-w-[100px]">{acc.name}</span></>}
                  </div>
                </div>
                <span className="text-[14px] font-semibold tabular text-foreground shrink-0">{fmtUSD(Number(t.amount))}</span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0"/>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};

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
            <span className={cn("text-[12px] tabular px-1.5 py-0.5 rounded-full font-medium",
              up?"bg-negative/12 text-negative":"bg-positive/12 text-positive")}>
              {up?"+":""}{deltaPct}%
            </span>
          )}
          {!!budget && (
            <span className={cn("text-[12px] tabular px-1.5 py-0.5 rounded-full",
              overBudget?"bg-negative/15 text-negative":nearBudget?"bg-warning/15 text-warning":"bg-secondary text-muted-foreground")}>
              {pct.toFixed(0)}%
            </span>
          )}
          <div role="button" aria-label={`Set budget for ${formatCat(category)}`} onClick={e=>{e.stopPropagation();onSetBudget();}}
            className="h-5 w-5 rounded grid place-items-center text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity cursor-pointer">
            <Pencil className="h-3 w-3" />
          </div>
        </div>
      </div>
      <div className="mt-2 text-[12.5px] text-muted-foreground">{formatCat(category)}</div>
      <div className="mt-0.5 font-display text-base tabular text-foreground leading-tight">{fmtUSD(total)}</div>
      {budget ? (
        <div className="text-[12px] text-muted-foreground tabular">of {fmtUSD(budget)}</div>
      ) : (
        <div className="text-[12px] text-muted-foreground tabular">{count} txn{count!==1?"s":""}</div>
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
      <DialogContent showClose={false} className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col">
        <DialogTitle className="sr-only">Edit account</DialogTitle>
        <DialogDescription className="sr-only">Rename or add details to this account.</DialogDescription>
        <div className="relative p-5 pb-4 border-b border-border/40 shrink-0">
          <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
            <X className="h-4 w-4" />
          </button>
          <div className="text-[12px] uppercase tracking-wider text-muted-foreground mb-1">Edit account</div>
          <div className="font-display text-lg text-foreground">{account.name ?? "Account"}</div>
          {account.mask && <div className="text-[12.5px] text-muted-foreground">··{account.mask}</div>}
        </div>
        <div className="p-5 space-y-4 flex-1 overflow-y-auto min-h-0">
          {/* Nickname */}
          <div>
            <label className="text-[12px] uppercase tracking-wider text-muted-foreground">Nickname (optional)</label>
            <input value={nickname} onChange={e => setNickname(e.target.value)} placeholder={account.name ?? ""}
              className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[14px] text-foreground outline-none focus:border-foreground/40" />
          </div>

          {/* APR (credit cards only or any account) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] uppercase tracking-wider text-muted-foreground">APR %</label>
              <input type="number" value={apr} onChange={e => setApr(e.target.value)} placeholder="e.g. 22.49"
                className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[14px] text-foreground outline-none focus:border-foreground/40" />
            </div>
            <div>
              <label className="text-[12px] uppercase tracking-wider text-muted-foreground">Promo APR %</label>
              <input type="number" value={promoApr} onChange={e => setPromoApr(e.target.value)} placeholder="e.g. 0"
                className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[14px] text-foreground outline-none focus:border-foreground/40" />
            </div>
          </div>

          {/* Promo end date */}
          {promoApr !== "" && (
            <div>
              <label className="text-[12px] uppercase tracking-wider text-muted-foreground">Promo expires</label>
              <input type="date" value={promoEnd} onChange={e => setPromoEnd(e.target.value)}
                className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[14px] text-foreground outline-none focus:border-foreground/40" />
            </div>
          )}

          {/* Website URL */}
          <div>
            <label className="text-[12px] uppercase tracking-wider text-muted-foreground">Bank website URL (optional override)</label>
            <input type="url" value={customUrl} onChange={e => setCustomUrl(e.target.value)}
              placeholder={instUrl ?? "https://..."}
              className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[14px] text-foreground outline-none focus:border-foreground/40" />
            {instUrl && !customUrl && (
              <div className="mt-1 text-[12px] text-muted-foreground">Auto-detected: {instUrl}</div>
            )}
          </div>
        </div>
        <div className="p-4 pt-0 flex gap-2 shrink-0">
          <button onClick={save}
            className="flex-1 h-10 rounded-lg bg-gold text-[14px] font-medium hover:opacity-90 active:opacity-70">
            Save
          </button>
          <button onClick={onClose}
            className="h-10 px-4 rounded-lg border border-border-strong text-[13px] text-muted-foreground hover:text-foreground active:opacity-70">
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
      <div className="text-[12px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("text-[13.5px] tabular font-medium mt-0.5", toneText[tone])}>{value}</div>
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
            value={`${debt ? "−" : "+"}${fmtUSDCompact(Math.abs(yearlyInterest))}`}
            tone={debt ? "negative" : "positive"}
          />
        )}
        {credit?.last_statement_balance != null && (
          <Mini label="Statement balance" value={fmtUSD(credit.last_statement_balance)} tone="warning" />
        )}
        {credit?.next_payment_due_date && (
          <Mini
            label="Due date"
            value={fmtShortDate(credit.next_payment_due_date)}
            tone={credit.is_overdue ? "negative" : "info"}
          />
        )}
        {credit?.minimum_payment_amount != null && (
          <Mini label="Min payment" value={fmtUSD(credit.minimum_payment_amount)} tone="warning" />
        )}
        {utilization !== null && (
          <Mini
            label="Credit used"
            value={`${(utilization * 100).toFixed(0)}% of ${fmtUSDCompact(Math.abs(bal) + avail)}`}
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
          <div className="flex justify-between text-[12px] text-muted-foreground tabular mb-1">
            <span>Credit used {(utilization * 100).toFixed(0)}%</span>
            <span>{fmtUSDCompact(Math.abs(bal) + avail)} limit</span>
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
            ? `0% APR · ${daysUntilPromoEnd}d remaining${meta.promoEndDate ? ` (${fmtShortDate(meta.promoEndDate)})` : ""}`
            : "0% APR active"}
        </div>
      )}
      {isPromo && promoExpired && (
        <div className="inline-flex items-center gap-1.5 chip chip-negative text-[12.5px]">
          0% APR promo expired. Interest now applies.
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        {instUrl && (
          <a href={instUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground transition-colors">
            <ExternalLink className="h-3 w-3" /> Open at {instName}
          </a>
        )}
        <button onClick={onEdit}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground transition-colors">
          <Pencil className="h-3 w-3" /> Edit details
        </button>
        <button onClick={onRemove}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-negative/70 hover:text-negative transition-colors">
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

  // Neutral icon — muted, not color-coded by account type
  const iconBg = "bg-muted/60 border-border/40 text-muted-foreground";

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
          <span className="text-[14px] text-foreground font-medium truncate">{displayName}</span>
          {isPromo && (
            <span className="text-[12px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-positive/30 bg-positive/10 text-positive shrink-0">0% APR</span>
          )}
          {a.subtype === "savings" && isHYSA(a, instName, meta.apr, computeImpliedApy(a, txns).impliedApy) && (
            <span className="text-[12px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-positive/30 bg-positive/10 text-positive shrink-0">High Yield</span>
          )}
          {dueDaysAway != null && dueDaysAway <= 7 && (
            <span className={cn("text-[12px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border shrink-0",
              dueDaysAway <= 0 ? "border-negative/30 bg-negative/10 text-negative" : "border-warning/30 bg-warning/10 text-warning")}>
              {dueDaysAway <= 0 ? "overdue" : `due ${dueDaysAway}d`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 text-[12px] text-muted-foreground flex-wrap">
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
          <div className={cn("text-[12px] tabular mb-0.5 flex items-center justify-end gap-0.5", trendGood ? "text-positive" : "text-negative")}>
            {trendUp ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
            {netFlow > 0 ? "+" : ""}{fmtUSDCompact(Math.abs(netFlow))}
          </div>
        )}
        <div className={cn("text-[15px] font-semibold tabular", debt ? "text-negative" : "text-foreground")}>
          {debt ? "−" : ""}{fmtUSDCompact(Math.abs(bal))}
        </div>
        {avail != null && !debt && avail !== bal && (
          <div className="text-[12px] text-muted-foreground tabular">{fmtUSDCompact(avail)} avail</div>
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
  if (bucket === "cash" && yearlyInterest > 0) trailing = `Earning +${fmtUSDCompact(yearlyInterest)}/yr`;
  if (bucket === "credit" && monthlyStatement > 0) trailing = `${fmtUSDCompact(monthlyStatement)} due this cycle`;
  if (bucket === "loan") trailing = `${fmtUSDCompact(Math.abs(yearlyInterest))} interest/yr`;
  if (bucket === "investment") trailing = "Held for the future";

  const getInstName = (a: PAccount) => getInstNameFor(a, items);
  const getInstUrl = (a: PAccount) => {
    const instName = getInstName(a);
    return getInstitutionUrl(instName, accountMeta[a.id]?.customUrl);
  };

  const accentColor = "hsl(var(--muted-foreground))";
  const trailingColor = bucket === "cash" ? "text-positive" : bucket === "credit" ? "text-warning" : bucket === "loan" ? "text-negative" : "text-info";

  return (
    <div className="surface-card overflow-hidden" >
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-4 px-4 md:px-5 py-4 hover:bg-surface-hover/30 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-8 w-8 rounded-lg grid place-items-center shrink-0 bg-muted/40 text-muted-foreground">
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", !open && "-rotate-90")} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-display text-[14px] text-foreground">{meta.label}</h3>
              {bucket === "investment" && <Lock className="h-3 w-3 text-muted-foreground" />}
              <span className="text-[12px] px-1.5 py-0.5 rounded-full bg-secondary/60 text-muted-foreground tabular">{accounts.length}</span>
            </div>
            <div className="text-[12px] text-muted-foreground truncate mt-0.5">{meta.sub}</div>
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className={cn("font-display text-[15px] tabular leading-none font-semibold",
            isNeg ? "text-negative" : "text-foreground")}>
            {isNeg ? "−" : ""}{fmtUSDCompact(Math.abs(total))}
          </div>
          {trailing && (
            <div className={cn("text-[12px] tabular mt-1 font-medium", trailingColor)}>
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
                      <span className="text-[12px] uppercase tracking-wider text-muted-foreground font-medium">{g.label}</span>
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
// Lower threshold used for a *computed* rate (derived from real interest the
// account actually earned) rather than a manually-typed APR — the name/
// institution list and the 3% manual-APR threshold above both depend on the
// user doing something (naming their bank recognizably, or typing an APR in),
// so most HYSAs never got flagged. A realized rate >1% is specific enough on
// its own since ordinary checking/standard savings pay a small fraction of
// that, per the user's own instruction.
const HYSA_IMPLIED_RATE_THRESHOLD = 1.0;
const isHYSA = (a: PAccount, instName: string, apr?: number | null, impliedApy?: number | null): boolean => {
  if (a.type !== "depository" || a.subtype !== "savings") return false;
  const haystack = `${a.name ?? ""} ${a.official_name ?? ""} ${instName}`.toLowerCase();
  if (/high.?yield|hysa|hys\b/.test(haystack)) return true;
  if (HYSA_INSTITUTIONS.some(inst => haystack.includes(inst))) return true;
  if (apr != null && apr >= HYSA_APR_THRESHOLD) return true;
  return impliedApy != null && impliedApy >= HYSA_IMPLIED_RATE_THRESHOLD;
};

// Interest actually credited into an account (excludes interest *charged* on
// debt, which is a cost, not income) — used to derive a real-world implied
// rate instead of relying on the user to type an APR in.
const isInterestEarnedTxn = (t: PTxn) => {
  const hay = `${t.category?.[0] ?? ""} ${t.category?.[1] ?? ""}`.toLowerCase();
  if (!hay.includes("interest") || hay.includes("interest charged")) return false;
  return Number(t.amount) < 0; // money in, per this app's sign convention
};
const monthlyInterestFor = (accountId: string, txns: PTxn[], monthsBack: number): number => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const end = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 0);
  return txns.reduce((s, t) => {
    if (t.account_id !== accountId || !isInterestEarnedTxn(t)) return s;
    const d = new Date(t.date + "T00:00:00");
    if (d < start || d > end) return s;
    return s + Math.abs(Number(t.amount));
  }, 0);
};
// Annualized rate implied by actual interest credits — last *completed*
// month's interest alone (monthsBack starts at 1 so a mid-month credit this
// month doesn't understate it) for the headline figure, averaged over the
// last 3 completed months (skipping months with no credit) for a steadier
// "average rate" since some banks post interest irregularly.
const computeImpliedApy = (a: PAccount, txns: PTxn[]): { lastMonthInterest: number; impliedApy: number | null } => {
  const bal = Math.abs(Number(a.current_balance) || 0);
  const lastMonthInterest = monthlyInterestFor(a.account_id, txns, 1);
  if (bal <= 0) return { lastMonthInterest, impliedApy: null };
  const recentMonths = [1, 2, 3].map(mb => monthlyInterestFor(a.account_id, txns, mb)).filter(v => v > 0);
  if (recentMonths.length === 0) return { lastMonthInterest, impliedApy: null };
  const avgMonthly = recentMonths.reduce((s, v) => s + v, 0) / recentMonths.length;
  return { lastMonthInterest, impliedApy: (avgMonthly * 12 / bal) * 100 };
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
      className="w-full inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-[hsl(var(--primary)/0.35)] text-[12.5px] font-medium text-gold hover:bg-[hsl(var(--primary)/0.08)] transition-colors disabled:opacity-50">
      {loading || finishing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
      {finishing ? "Finishing…" : loading ? "Preparing…" : "Grant card details access"}
    </button>
  );
};

// Finer-grained grouping used only in the main Accounts panel — the app-wide
// Bucket/mapBucket lump every depository account into one "Checking & Savings"
// bucket, which is the right level of detail for net-worth/summary views but
// too coarse here: this is the list the user actually scans account-by-account,
// so Checking, Savings, and High-Yield Savings are split out as their own groups.
type AccountGroup = "checking" | "savings" | "hysa" | "credit" | "loan" | "investment" | "other";
const ACCOUNT_GROUP_ORDER: AccountGroup[] = ["checking", "savings", "hysa", "credit", "loan", "investment", "other"];
// Each group carries its own accent color so the category grid below reads
// at a glance (blue for everyday cash, teal for money set aside, red for
// debt, amber for loans, violet for investments) instead of every bucket
// looking the same gray.
const ACCOUNT_GROUP_META: Record<AccountGroup, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  checking:   { label: "Checking",           icon: Wallet,      color: "#60a5fa", bg: "rgba(96,165,250,0.14)" },
  savings:    { label: "Savings",            icon: PiggyBank,   color: "#34d399", bg: "rgba(52,211,153,0.14)" },
  hysa:       { label: "High-Yield Savings", icon: PiggyBank,   color: "#2dd4bf", bg: "rgba(45,212,191,0.14)" },
  credit:     { label: "Credit Cards",       icon: CreditCard,  color: "#fb7185", bg: "rgba(251,113,133,0.14)" },
  loan:       { label: "Loans & Mortgages",  icon: Building2,   color: "#fbbf24", bg: "rgba(251,191,36,0.14)" },
  investment: { label: "Investments",        icon: TrendingUp,  color: "#a78bfa", bg: "rgba(167,139,250,0.14)" },
  other:      { label: "Other",              icon: Landmark,    color: "#94a3b8", bg: "rgba(148,163,184,0.14)" },
};
const MANUAL_GROUP_META = { label: "Manual", icon: Landmark, color: "#818cf8", bg: "rgba(129,140,248,0.14)" };
const mapAccountGroup = (a: PAccount, instName: string, apr?: number | null, impliedApy?: number | null): AccountGroup => {
  if (a.type === "credit") return "credit";
  if (a.type === "loan") return "loan";
  if (a.type === "investment") return "investment";
  const sub = (a.subtype ?? "").toLowerCase();
  if (sub === "checking") return "checking";
  if (sub === "savings") return isHYSA(a, instName, apr, impliedApy) ? "hysa" : "savings";
  if (sub.includes("money market") || sub === "hsa") return "savings";
  return "other";
};

// ── Account detail dialog ──────────────────────────────────────
// ── AccountsPanel — collapsible groups + account rows ──────────
const AccountsPanel = ({ accounts, manualAccounts, accountMeta, items, txns, onSelect, onAddAccount, onEditManual, onDeleteManual }: {
  accounts: PAccount[];
  manualAccounts: ManualAccount[];
  accountMeta: Record<string, AccountMeta>;
  items: PlaidItem[];
  txns: PTxn[];
  onSelect: (a: PAccount) => void;
  onAddAccount: () => void;
  onEditManual?: (a: ManualAccount) => void;
  onDeleteManual?: (id: string) => void;
}) => {
  const [openBuckets, setOpenBuckets] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpenBuckets(p => ({ ...p, [k]: !p[k] }));

  const groupFor = (a: PAccount) => mapAccountGroup(a, getInstNameFor(a, items), accountMeta[a.id]?.apr, computeImpliedApy(a, txns).impliedApy);
  const activeBuckets = ACCOUNT_GROUP_ORDER.filter(b => accounts.some(a => groupFor(a) === b));
  const hasManual = manualAccounts.length > 0;

  // Net cash computed across depository accounts
  const cashAccounts = accounts.filter(a => a.type === "depository");
  const creditAccounts = accounts.filter(a => a.type === "credit");
  const totalCash = cashAccounts.reduce((s,a)=> s + (Number(a.current_balance)||0), 0);
  const totalCards = creditAccounts.reduce((s,a)=> s + (Number(a.current_balance)||0), 0);
  const netCash = totalCash - totalCards;

  // Pre-compute each bucket's accounts/total once, shared by the category
  // grid and the expanded account lists below it, instead of re-filtering
  // the same accounts array twice.
  // Manually-tracked mortgages/loans count toward the Loans total too, so a
  // $3,000/mo mortgage isn't missing from "Loans" just because it isn't linked.
  const MANUAL_LOAN_TYPES = new Set(["mortgage","home_loan","auto_loan","student_loan","personal_loan"]);
  const manualLoans = manualAccounts.filter(a => MANUAL_LOAN_TYPES.has(a.type));
  const manualLoanTotal = manualLoans.reduce((s,a)=> s + Math.abs(Number(a.current_balance ?? 0)), 0);
  const bucketData = activeBuckets.map(bucket => {
    const list = accounts.filter(a => groupFor(a) === bucket);
    const linkedTotal = list.reduce((s,a)=> s + Math.abs(Number(a.current_balance)||0), 0);
    const manualCount = bucket === "loan" ? manualLoans.length : 0;
    const total = linkedTotal + (bucket === "loan" ? manualLoanTotal : 0);
    const debt = bucket === "credit" || bucket === "loan";
    return { bucket, list, total, debt, manualCount };
  });
  const loansShown = bucketData.some(b => b.bucket === "loan");
  const manualTotal = manualAccounts.reduce((s,a)=> s + Math.abs(Number(a.current_balance ?? 0)), 0);
  const grandTotal = bucketData.reduce((s,b)=>s+b.total,0) + manualTotal - (loansShown ? manualLoanTotal : 0);

  const renderAccountRow = (a: PAccount) => {
    const debt = isDebt(a.type);
    const bal = Number(a.current_balance) || 0;
    const m = accountMeta[a.id] ?? {};
    const displayName = m.nickname || a.name || a.official_name || "Account";
    const instName = getInstNameFor(a, items);
    const brand = getBankBrand(instName);
    return (
      <button key={a.id} onClick={() => onSelect(a)}
        className="w-full flex items-center gap-3 px-5 md:px-6 py-3 text-left hover:bg-surface-hover/30 transition-colors group">
        {/* Bank brand avatar */}
        <div className="h-8 w-8 rounded-full shrink-0 flex items-center justify-center border border-white/10 shadow-sm"
          style={{ backgroundColor: brand.bg }}>
          <span className="text-[11px] font-extrabold tracking-tight" style={{ color: brand.color }}>{brand.abbr}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] text-foreground font-medium truncate">{displayName}</div>
          <div className="text-[11.5px] text-muted-foreground/70 truncate">{instName}{a.mask ? ` ··${a.mask}` : ""}</div>
        </div>
        <span className={cn("text-[14px] font-semibold tabular shrink-0", debt ? "text-negative" : "text-foreground")}>
          {fmtUSD(Math.abs(bal))}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/20 shrink-0 group-hover:text-muted-foreground/60 transition-colors" />
      </button>
    );
  };

  return (
    <div className="space-y-3">
      {/* Net cash hero: headline figure plus a proportional bar showing where
          the money actually sits across categories, colored to match the
          category cards below instead of a plain text-only strip. */}
      {cashAccounts.length > 0 && creditAccounts.length > 0 && (
        <div className="surface-card p-4 md:p-5">
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-[12px] text-muted-foreground font-medium">Net Cash</span>
            <span className={cn("text-[20px] font-bold tabular", netCash >= 0 ? "text-positive" : "text-negative")}>
              {fmtUSD(Math.abs(netCash))}
            </span>
          </div>
          {grandTotal > 0 && (
            <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-secondary/30">
              {bucketData.filter(b => b.total > 0).map(({ bucket, total }) => (
                <div key={bucket} title={`${ACCOUNT_GROUP_META[bucket].label}: ${fmtUSD(total)}`}
                  style={{ width: `${(total / grandTotal) * 100}%`, background: ACCOUNT_GROUP_META[bucket].color }} />
              ))}
              {manualTotal > 0 && (
                <div title={`Manual: ${fmtUSD(manualTotal - (loansShown ? manualLoanTotal : 0))}`}
                  style={{ width: `${((manualTotal - (loansShown ? manualLoanTotal : 0)) / grandTotal) * 100}%`, background: MANUAL_GROUP_META.color }} />
              )}
            </div>
          )}
        </div>
      )}

      {/* Category grid: each card is color-coded by account type (checking,
          savings, credit, loans, investments) so the categorization reads at
          a glance instead of one flat gray list. Tap a card to expand it. */}
      {/* auto-fit collapses unused tracks, so 5 buckets fill the row instead
          of leaving an empty 6th slot. */}
      <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
        {bucketData.map(({ bucket, list, total, debt, manualCount }) => {
          const open = !!openBuckets[bucket];
          const meta = ACCOUNT_GROUP_META[bucket];
          const Icon = meta.icon;
          return (
            <button key={bucket} onClick={() => toggle(bucket)}
              className="surface-card text-left p-3.5 rounded-2xl border-t-2 transition-all hover:shadow-md hover:-translate-y-0.5"
              style={{ borderTopColor: meta.color, boxShadow: open ? `0 0 0 1px ${meta.color}66` : undefined }}>
              <div className="h-9 w-9 rounded-xl grid place-items-center mb-2.5" style={{ background: meta.bg }}>
                <Icon className="h-4 w-4" style={{ color: meta.color }} />
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[12px] font-semibold text-foreground truncate">{meta.label}</span>
                <ChevronDown className={cn("h-3 w-3 text-muted-foreground/40 shrink-0 transition-transform", open && "rotate-180")} />
              </div>
              <div className="text-[10px] text-muted-foreground/60 mb-1">{list.length} account{list.length !== 1 ? "s" : ""}{manualCount > 0 ? ` + ${manualCount} manual` : ""}</div>
              <div className={cn("text-[16px] font-bold tabular", debt ? "text-negative" : "text-foreground")}>{fmtUSD(total)}</div>
            </button>
          );
        })}
        {hasManual && (() => {
          const open = !!openBuckets["__manual__"];
          return (
            <button onClick={() => toggle("__manual__")}
              className="surface-card text-left p-3.5 rounded-2xl border-t-2 transition-all hover:shadow-md hover:-translate-y-0.5"
              style={{ borderTopColor: MANUAL_GROUP_META.color, boxShadow: open ? `0 0 0 1px ${MANUAL_GROUP_META.color}66` : undefined }}>
              <div className="h-9 w-9 rounded-xl grid place-items-center mb-2.5" style={{ background: MANUAL_GROUP_META.bg }}>
                <Landmark className="h-4 w-4" style={{ color: MANUAL_GROUP_META.color }} />
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[12px] font-semibold text-foreground truncate">Manual</span>
                <ChevronDown className={cn("h-3 w-3 text-muted-foreground/40 shrink-0 transition-transform", open && "rotate-180")} />
              </div>
              <div className="text-[10px] text-muted-foreground/60 mb-1">{manualAccounts.length} account{manualAccounts.length !== 1 ? "s" : ""}</div>
              <div className="text-[16px] font-bold tabular text-foreground">{fmtUSD(manualTotal)}</div>
            </button>
          );
        })()}
      </div>

      {/* Expanded account lists, one surface-card per open category, tinted
          with that category's own color so it's clear which card it belongs to. */}
      {bucketData.filter(b => openBuckets[b.bucket]).map(({ bucket, list }) => {
        const meta = ACCOUNT_GROUP_META[bucket];
        const Icon = meta.icon;
        return (
          <div key={bucket} className="surface-card overflow-hidden">
            <div className="flex items-center gap-2 px-4 md:px-5 py-2.5 border-b border-border/15" style={{ background: meta.bg }}>
              <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
              <span className="text-[12px] font-semibold" style={{ color: meta.color }}>{meta.label}</span>
            </div>
            <div className="divide-y divide-border/10">
              {list.map(renderAccountRow)}
            </div>
          </div>
        );
      })}

      {/* Manual accounts, expanded */}
      {hasManual && openBuckets["__manual__"] && (
        <div className="surface-card overflow-hidden">
          <div className="flex items-center gap-2 px-4 md:px-5 py-2.5 border-b border-border/15" style={{ background: MANUAL_GROUP_META.bg }}>
            <Landmark className="h-3.5 w-3.5" style={{ color: MANUAL_GROUP_META.color }} />
            <span className="text-[12px] font-semibold" style={{ color: MANUAL_GROUP_META.color }}>Manual</span>
          </div>
          <div className="divide-y divide-border/10">
            {manualAccounts.map(acct => {
              const isMortgage = acct.type === "mortgage" || acct.type === "home_loan";
              const isLoanType = isMortgage || ["auto_loan","student_loan","personal_loan","credit_card"].includes(acct.type);
              const bal = Math.abs(Number(acct.current_balance ?? 0));
              const instBrand = getBankBrand(acct.institution_name || acct.name || "M");
              const emi = isMortgage && acct.original_loan_amount && acct.interest_rate && acct.loan_term_years
                ? (() => { const r = acct.interest_rate!/100/12; const n = acct.loan_term_years!*12; return r===0 ? acct.original_loan_amount!/n : acct.original_loan_amount! * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1); })()
                : acct.monthly_payment ?? null;
              const equity = isMortgage && acct.property_value ? (Number(acct.property_value) - bal) : null;
              return (
                <div key={acct.id} className="w-full flex items-center gap-3 px-5 md:px-6 py-3 group">
                  <div className="h-8 w-8 rounded-full shrink-0 flex items-center justify-center border border-white/10 shadow-sm"
                    style={{ backgroundColor: instBrand.bg }}>
                    <span className="text-[11px] font-extrabold tracking-tight" style={{ color: instBrand.color }}>{instBrand.abbr}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] text-foreground font-medium truncate">{acct.name}</div>
                    <div className="text-[11.5px] text-muted-foreground/70 truncate">
                      {acct.institution_name || (isMortgage ? "Mortgage" : isLoanType ? "Loan" : "Manual")}
                      {acct.interest_rate ? ` · ${acct.interest_rate}%` : ""}
                      {emi ? ` · EMI ${fmtUSD(emi)}` : ""}
                    </div>
                    {equity !== null && (
                      <div className={cn("text-[11px] font-medium", equity >= 0 ? "text-positive" : "text-negative")}>
                        {equity >= 0 ? "Equity" : "Underwater"}: {fmtUSD(Math.abs(equity))}
                        {acct.property_value ? ` · Home: ${fmtUSD(Number(acct.property_value))}` : ""}
                      </div>
                    )}
                  </div>
                  <span className={cn("text-[14px] font-semibold tabular shrink-0", isLoanType ? "text-negative" : "text-foreground")}>
                    {fmtUSD(bal)}
                  </span>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {onEditManual && <button onClick={() => onEditManual(acct)} aria-label={`Edit ${acct.name}`} className="h-8 w-8 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>}
                    {onDeleteManual && <button onClick={() => onDeleteManual(acct.id)} aria-label={`Delete ${acct.name}`} className="h-8 w-8 grid place-items-center rounded text-muted-foreground/60 hover:text-negative"><Trash2 className="h-3.5 w-3.5" /></button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add account */}
      <button onClick={onAddAccount}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-dashed border-border/50 text-[12.5px] text-muted-foreground hover:text-foreground hover:border-border transition-colors">
        <Plus className="h-3.5 w-3.5" /> Link an account
      </button>
    </div>
  );
};

// ── AccountDetailPanel — Rocket Money–style popup ───────────────
const AccountDetailPanel = ({ a, txns, meta, credit, instName, instUrl, itemId, onEdit, onRemove, onClose, onGranted }: {
  a: PAccount; txns: PTxn[]; meta: AccountMeta; credit?: CreditDetail;
  instName: string; instUrl: string | null; itemId: string | null;
  onEdit: () => void; onRemove: () => void; onClose: () => void; onGranted: () => void;
}) => {
  const debt = isDebt(a.type);
  const isCredit = a.type === "credit";
  const isSavings = a.type === "depository" && a.subtype === "savings";
  const isChecking = a.type === "depository" && a.subtype === "checking";
  const bal = Number(a.current_balance) || 0;
  const avail = Number(a.available_balance) || 0;
  const creditLimit = isCredit && avail >= 0 ? Math.abs(bal) + avail : 0;
  const utilization = isCredit && creditLimit > 0 ? Math.abs(bal) / creditLimit : null;
  const displayName = meta.nickname || a.name || a.official_name || "Account";
  // Computed from this account's own interest-credit transactions — lets HYSA
  // status and the interest figures below work even without a manually-typed
  // APR, since most users never fill that in.
  const { lastMonthInterest, impliedApy } = isSavings ? computeImpliedApy(a, txns) : { lastMonthInterest: 0, impliedApy: null };
  const hysa = isHYSA(a, instName, meta.apr, impliedApy);
  const isPromo = meta.promoApr != null;
  const promoExpired = meta.promoEndDate ? new Date(meta.promoEndDate) < new Date() : false;
  const daysUntilPromoEnd = meta.promoEndDate
    ? Math.ceil((new Date(meta.promoEndDate).getTime() - Date.now()) / 86400000) : null;
  const logoChar = instName.charAt(0).toUpperCase() || displayName.charAt(0).toUpperCase();
  const aprRate = meta.apr ?? null;
  const yearlyAmount = aprRate != null ? Math.abs(bal) * aprRate / 100 : 0;

  const thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const recentTxns = txns.filter(t => !t.pending).slice(0, 5);
  const accTxns30 = txns.filter(t => new Date(t.date) >= thirtyAgo);
  const netFlow30 = accTxns30.reduce((s, t) => s - Number(t.amount), 0);

  const dueDate = credit?.next_payment_due_date
    ? new Date(credit.next_payment_due_date + "T00:00:00") : null;
  const dueSoon = dueDate ? (dueDate.getTime() - Date.now()) / 86400000 <= 7 : false;

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent showClose={false} className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[88vh] flex flex-col rounded-2xl">
        <DialogTitle className="sr-only">{displayName}</DialogTitle>
        <DialogDescription className="sr-only">Account details for {displayName}</DialogDescription>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border/40 shrink-0">
          {(() => {
            const detailBrand = getBankBrand(instName || displayName);
            return (
              <div className="h-9 w-9 rounded-full shrink-0 flex items-center justify-center border border-white/10 shadow-sm"
                style={{ backgroundColor: detailBrand.bg }}>
                <span className="text-[13px] font-extrabold tracking-tight" style={{ color: detailBrand.color }}>{detailBrand.abbr}</span>
              </div>
            );
          })()}
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-foreground truncate">{displayName}</p>
            <p className="text-[11.5px] text-muted-foreground truncate">{instName}{a.mask ? ` ··${a.mask}` : ""}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="h-8 w-8 grid place-items-center rounded-full bg-secondary/60 text-muted-foreground hover:text-foreground shrink-0">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* Big balance */}
          <div className="px-5 pt-5 pb-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mb-1">
              {isCredit ? "Current Balance" : isSavings ? "Savings Balance" : isChecking ? "Checking Balance" : "Balance"}
            </p>
            <p className={cn("text-[34px] font-bold tabular leading-none", debt ? "text-negative" : "text-foreground")}>
              {fmtUSD(Math.abs(bal))}
            </p>
            {accTxns30.length > 0 && (
              <div className={cn("inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full text-[11.5px] font-medium",
                (debt ? netFlow30 < 0 : netFlow30 > 0) ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative"
              )}>
                {netFlow30 >= 0 ? "↑" : "↓"} {fmtUSD(Math.abs(netFlow30))} since 30 days ago
              </div>
            )}
          </div>

          {/* Credit card specifics */}
          {isCredit && (
            <div className="px-5 pb-4 space-y-3">
              {utilization !== null && creditLimit > 0 && (
                <div className="rounded-xl bg-secondary/40 p-3 space-y-2">
                  <div className="flex justify-between text-[12.5px]">
                    <span className="text-muted-foreground">Credit utilization</span>
                    <span className={cn("font-semibold tabular", utilization > 0.5 ? "text-negative" : utilization > 0.3 ? "text-warning" : "text-positive")}>
                      {(utilization * 100).toFixed(0)}% of {fmtUSDCompact(creditLimit)}
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
              {(credit?.last_statement_balance != null || dueDate || credit?.minimum_payment_amount != null) && (
                <div className="grid grid-cols-2 gap-2">
                  {credit?.last_statement_balance != null && (
                    <div className="rounded-xl bg-secondary/40 p-3">
                      <p className="text-[11px] text-muted-foreground/70 uppercase tracking-wider">Statement</p>
                      <p className="text-[14px] font-semibold mt-1 text-warning tabular">{fmtUSD(credit.last_statement_balance)}</p>
                    </div>
                  )}
                  {dueDate && (
                    <div className={cn("rounded-xl bg-secondary/40 p-3", credit?.is_overdue && "border border-negative/30")}>
                      <p className="text-[11px] text-muted-foreground/70 uppercase tracking-wider">Due date</p>
                      <p className={cn("text-[14px] font-semibold mt-1", credit?.is_overdue ? "text-negative" : dueSoon ? "text-warning" : "text-foreground")}>
                        {dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        {dueSoon && !credit?.is_overdue && <span className="ml-1 text-[11px] font-normal text-warning">soon</span>}
                      </p>
                    </div>
                  )}
                  {credit?.minimum_payment_amount != null && (
                    <div className="rounded-xl bg-secondary/40 p-3">
                      <p className="text-[11px] text-muted-foreground/70 uppercase tracking-wider">Min payment</p>
                      <p className="text-[14px] font-semibold mt-1 text-warning tabular">{fmtUSD(credit.minimum_payment_amount)}</p>
                    </div>
                  )}
                  {avail > 0 && (
                    <div className="rounded-xl bg-secondary/40 p-3">
                      <p className="text-[11px] text-muted-foreground/70 uppercase tracking-wider">Available</p>
                      <p className="text-[14px] font-semibold mt-1 text-positive tabular">{fmtUSD(avail)}</p>
                    </div>
                  )}
                </div>
              )}
              {isPromo && !promoExpired && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-positive/10 text-positive text-[12px] font-medium">
                  <Sparkles className="h-3 w-3" />
                  {daysUntilPromoEnd != null && daysUntilPromoEnd > 0 ? `0% APR · ${daysUntilPromoEnd}d left` : "0% APR active"}
                </div>
              )}
            </div>
          )}

          {/* APR / rate */}
          {aprRate != null && (
            <div className="mx-5 mb-4 rounded-xl bg-secondary/40 p-3 flex justify-between items-center">
              <span className="text-[12.5px] text-muted-foreground">{debt ? "APR" : "APY"} (set manually)</span>
              <div className="text-right">
                <span className="text-[13px] font-semibold text-foreground">{aprRate.toFixed(2)}%</span>
                <span className="text-[11px] text-muted-foreground ml-2">≈ {fmtUSDCompact(yearlyAmount)}/yr</span>
              </div>
            </div>
          )}

          {/* Interest actually earned — derived from this account's own interest-
              credit transactions, so it works even without a manually-typed APY. */}
          {isSavings && (lastMonthInterest > 0 || impliedApy != null) && (
            <div className="mx-5 mb-4 rounded-xl bg-secondary/40 p-3 space-y-2">
              {lastMonthInterest > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-[12.5px] text-muted-foreground">Interest earned last month</span>
                  <span className="text-[13px] font-semibold text-positive tabular">{fmtUSD(lastMonthInterest)}</span>
                </div>
              )}
              {impliedApy != null && (
                <div className="flex justify-between items-center">
                  <span className="text-[12.5px] text-muted-foreground">Avg. rate (from interest paid)</span>
                  <span className="text-[13px] font-semibold text-foreground tabular">{impliedApy.toFixed(2)}%</span>
                </div>
              )}
              {hysa && aprRate == null && (
                <div className="text-[11px] text-positive">Classified as High-Yield Savings based on this rate</div>
              )}
            </div>
          )}

          {/* Recent transactions */}
          {recentTxns.length > 0 && (
            <div className="mx-5 mb-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mb-2">Recent Transactions</p>
              <div className="rounded-xl overflow-hidden divide-y divide-border/20 border border-border/30">
                {recentTxns.map(t => {
                  const amt = Number(t.amount);
                  const name = t.merchant_name || t.name || "Transaction";
                  return (
                    <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 bg-card/40">
                      <div className="h-7 w-7 rounded-full bg-secondary/60 grid place-items-center shrink-0">
                        <span className="text-[11px] font-bold text-muted-foreground">{name.charAt(0).toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] text-foreground truncate">{name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {fmtShortDate(t.date)}
                          {t.pending && <span className="ml-1.5 text-warning">· Pending</span>}
                        </p>
                      </div>
                      <span className={cn("text-[12.5px] font-semibold tabular shrink-0", amt < 0 ? "text-positive" : t.pending ? "text-muted-foreground/60" : "text-foreground")}>
                        {amt < 0 ? "+" : ""}{fmtUSD(Math.abs(amt))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Details */}
          <div className="mx-5 mb-4 rounded-xl overflow-hidden divide-y divide-border/20 border border-border/30">
            {instName && (
              <div className="flex justify-between items-center px-3 py-2.5 bg-card/40">
                <span className="text-[12px] text-muted-foreground">Institution</span>
                <span className="text-[12.5px] font-medium text-foreground">{instName}</span>
              </div>
            )}
            {a.mask && (
              <div className="flex justify-between items-center px-3 py-2.5 bg-card/40">
                <span className="text-[12px] text-muted-foreground">Account #</span>
                <span className="text-[12.5px] font-medium text-foreground">··{a.mask}</span>
              </div>
            )}
            {a.subtype && (
              <div className="flex justify-between items-center px-3 py-2.5 bg-card/40">
                <span className="text-[12px] text-muted-foreground">Type</span>
                <span className="text-[12.5px] font-medium text-foreground capitalize">{a.subtype.replace(/_/g, " ")}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="mx-5 mb-5 flex flex-col gap-2">
            {instUrl && (
              <a href={instUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-secondary/50 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
                <ExternalLink className="h-3.5 w-3.5" /> Open at {instName}
              </a>
            )}
            <button onClick={onEdit}
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-secondary/50 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
              <Pencil className="h-3.5 w-3.5" /> Edit details
            </button>
            <button onClick={onRemove}
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-negative/5 border border-negative/20 text-[13px] text-negative/70 hover:text-negative transition-colors">
              <Trash2 className="h-3.5 w-3.5" /> Remove account
            </button>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
};


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
          <h3 className="font-display text-[14px] text-primary">Quick-tag accounts</h3>
          <div className="text-[12px] text-muted-foreground mt-0.5">Swipe or tap a category for each one</div>
        </div>
        <span className="text-[12px] text-muted-foreground tabular shrink-0">{clamped + 1} of {list.length}</span>
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
                  <div className="text-[14px] text-foreground font-medium truncate">{acc.name ?? acc.official_name}</div>
                  <div className="text-[12.5px] text-muted-foreground tabular mt-0.5">{fmtUSD(Number(acc.current_balance) || 0)}</div>
                  <div className="text-[12px] text-muted-foreground mt-1">What's this account for?</div>
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
              <span className="text-[12px] text-foreground text-center leading-tight">{ROLE_META[role].short}</span>
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
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(current.label ?? "");

  const roles = (Object.keys(ROLE_META) as AccountRole[]).filter(r => r !== "unassigned");

  return (
    <div className="space-y-2">
      {/* Role chips */}
      <div className="flex flex-wrap gap-1.5">
        {roles.map(r => {
          const { Icon } = ROLE_OPTIONS.find(o => o.role === r) ?? { Icon: Landmark };
          const isActive = current.role === r;
          return (
            <button key={r} onClick={() => setRole(accountId, { role: r, label: current.label })}
              className={cn(
                "flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[11px] font-medium transition-all",
                isActive
                  ? "bg-foreground text-background border-foreground"
                  : "border-border/40 text-muted-foreground hover:text-foreground hover:border-foreground/30"
              )}>
              <Icon className="h-3 w-3 shrink-0" />
              {ROLE_META[r].short}
            </button>
          );
        })}
      </div>
      {/* Optional label for reserve/savings_goal */}
      {(current.role === "reserve" || current.role === "savings_goal") && (
        editingLabel ? (
          <form className="flex items-center gap-1.5" onSubmit={e => {
            e.preventDefault();
            setRole(accountId, { role: current.role, label: labelDraft.trim() || undefined });
            setEditingLabel(false);
          }}>
            <input autoFocus value={labelDraft} onChange={e => setLabelDraft(e.target.value)}
              placeholder="e.g. Emergency fund" onKeyDown={e => { if (e.key === "Escape") setEditingLabel(false); }}
              className="h-7 flex-1 px-2.5 rounded-lg bg-transparent border border-foreground/30 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40" />
            <button type="submit" className="h-7 px-3 rounded-lg bg-foreground text-background text-[11px] font-medium">Save</button>
          </form>
        ) : (
          <button onClick={() => { setLabelDraft(current.label ?? ""); setEditingLabel(true); }}
            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
            <span className="text-[10px] opacity-40">+</span>
            {current.label ? `"${current.label}"` : "Add label"}
          </button>
        )
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
  onViewChange?: (v: string) => void;
  syncTrigger?: number;
  onSyncingChange?: (v:boolean)=>void;
  selectedCategory?: string|null;
  onCategorySelect?: (cat:string)=>void;
  manualAccounts?: import("@/hooks/useManualAccounts").ManualAccount[];
  onEditManual?: (acct: import("@/hooks/useManualAccounts").ManualAccount) => void;
  onDeleteManual?: (id: string) => void;
  /** Right-side header controls (sync/bell/profile) rendered in full-bleed views' own header. */
  headerActions?: React.ReactNode;
}

export const LivePlaidDashboard = ({
  onAddAccount, hasItems, demo=false, guestDemo=false, view="overall", onViewChange,
  syncTrigger=0, onSyncingChange,
  selectedCategory, onCategorySelect,
  manualAccounts = [], onEditManual, onDeleteManual, headerActions,
}: Props) => {
  const { user, profile } = useAuth();

  // ── All user preferences — synced to Supabase ──────────────────
  // Demo mode (whether guest /demo or a real user previewing "Demo mode") must
  // never read or write the real account's settings — pass no userId so it
  // always gets fresh, in-memory-only defaults, same as guestDemo.
  const S = useUserSettings((demo || guestDemo) ? undefined : user?.id);
  const { settings, loaded: settingsLoaded } = S;

  // Destructure for ergonomic use throughout the component
  // Demo mode gets illustrative budgets so the budget bars, pace ring, and
  // "over budget" states actually have something to show — settings.budgets
  // is always empty in demo since there's no real user to persist them for.
  // Demo: seeds under any budgets added this session (Picture "Add a budget").
  const budgets = useMemo(() => (demo || guestDemo) ? { ...DEMO_BUDGETS, ...settings.budgets } : settings.budgets, [demo, guestDemo, settings.budgets]);
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
  const renameCategory = S.renameCustomCat;
  const allCategoryNames = useMemo(
    () => Array.from(new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES, ...customCategories.map(c => c.name)])).map(formatCat),
    [customCategories]
  );
  const nameOverridesManual = settings.nameOverrides;
  const setNameOverride = S.setNameOverride;
  const bulkSetNameOverride = S.bulkSetNameOverride;
  const nameRules = settings.nameRules;
  const saveNameRule = S.saveNameRule;
  const removeNameRule = S.removeNameRule;
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
  const [showImportModal, setShowImportModal] = useState(false);
  const [openActionItem, setOpenActionItem] = useState<ActionItem|null>(null);
  const [spendingPopup, setSpendingPopup] = useState<string|null>(null);
  const [spendPopupLimit, setSpendPopupLimit] = useState<5|10|"all">(5);
  // Period state for monthly + spending tabs
  const [monthlyPeriod, setMonthlyPeriod] = useState<PeriodState>({ granularity: "month", offset: 0 });
  const [spendingPeriod, setSpendingPeriod] = useState<PeriodState>({ granularity: "month", offset: 0 });
  const [budgetMonthOffset, setBudgetMonthOffset] = useState(0);
  const [budgetCatPopup, setBudgetCatPopup] = useState<string | null>(null);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
  const [spendingCatPopup, setSpendingCatPopup] = useState<string | null>(null); // mobile only
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
  const [txnSort, setTxnSort] = useState<TxnSort>("date-desc");
  const [hideInternal, setHideInternal] = useState(true);
  const [txnLimit, setTxnLimit] = useState(150);
  // Drill-down: clicking a bar in the spend-trend chart narrows the txn list to that exact day/month
  const [chartDrillDate, setChartDrillDate] = useState<string|null>(null);   // exact "YYYY-MM-DD" (day/week/month granularity)
  const [chartDrillMonth, setChartDrillMonth] = useState<number|null>(null); // 0-11 (year granularity)
  // Advanced filter — a full condition set (all/any across every field)
  const [filterSet, setFilterSet] = useState<ConditionSet>({ match: "all", conditions: [] });
  const [showFilterBuilder, setShowFilterBuilder] = useState(false);
  // Draft copy edited while the filter popup is open — only committed to
  // filterSet (which actually filters the list) when the user hits Apply.
  const [filterDraft, setFilterDraft] = useState<ConditionSet | null>(null);
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
  // Recurring cadence the Spending list displayed for detailTxn (undefined
  // when the modal was opened from anywhere else).
  const [detailTxnRecurring, setDetailTxnRecurring] = useState<string | null | undefined>(undefined);
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

  // ── Shared classification (src/lib/classify) ──────────────────────────
  // Every page (Home, Spending, Budget, Money Map) reads the SAME per-
  // transaction type from here, so totals can't drift apart again.
  // Precedence: your per-transaction type override → your category →
  // rules → linked-account transfer pairs → card payments → Plaid detailed
  // category → descriptor patterns → stored category / sign.
  // User-marked internal transfers (legacy setting) act as a type override.
  const manualInternalIds = useMemo(() => new Set<string>(settings.manualInternal ?? []), [settings.manualInternal]);
  // Whitelist: user explicitly un-flagged an auto-detected transfer
  const manualExternalIds = useMemo(() => new Set<string>(settings.manualExternal ?? []), [settings.manualExternal]);
  const { overrides: typeOverridesByPlaidId, setOverride: setTypeOverride } = useTxnTypeOverrides((demo || guestDemo) ? undefined : user?.id);
  const typeOverrides = useMemo(() => {
    const m: Record<string, TxnType> = {};
    for (const t of txns) {
      const ov = t.transaction_id ? typeOverridesByPlaidId[t.transaction_id] : undefined;
      if (ov) m[t.id] = ov;
      else if (manualInternalIds.has(t.id) && !manualExternalIds.has(t.id)) m[t.id] = "transfer_internal";
    }
    return m;
  }, [txns, typeOverridesByPlaidId, manualInternalIds, manualExternalIds]);
  const selfNames = useMemo(() => {
    const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
    return [meta.full_name, meta.name, profile?.display_name].filter((x): x is string => typeof x === "string" && x.trim().includes(" "));
  }, [user, profile]);
  const txnClasses = useMemo(() => classifyAll(txns as ClassifierTxn[], {
    accounts: accounts.map(a => ({
      account_id: a.account_id, item_id: (a as unknown as { item_id?: string }).item_id ?? null,
      name: a.name, mask: a.mask, type: a.type, subtype: a.subtype,
      role: getRole(a.account_id, a.type, a.subtype).role as AccountRoleName,
    })),
    typeOverrides,
    categoryOverrides: catOverridesManual,
    ruleCategory: t => smartResults.catById[t.id] ?? getRuleCategory(t.merchant_name ?? t.name ?? null),
    ruleInternalIds: smartResults.internalIds,
    notInternalIds: manualExternalIds,
    selfNames,
    customCategories,
    plaidCategory: t => normalisePlaidCategory(t.category, t.merchant_name, t.name),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [txns, accounts, roles, typeOverrides, catOverridesManual, smartResults, getRuleCategory, manualExternalIds, selfNames, customCategories]);
  const classOf = useCallback((t: { id: string }) => txnClasses.get(t.id), [txnClasses]);

  // Days of history per connected bank (Financial Picture "Extend history" hint).
  const bankHist = useMemo(() => bankHistory(items, accounts as { account_id: string; item_id?: string | null }[], txns, new Date()), [items, accounts, txns]);

  // Paycheck anomalies → notification inbox Alerts (on-device, never pushed).
  // Not in demo: the inbox belongs to the signed-in user.
  useEffect(() => {
    if (demo || guestDemo || loading) { setDerivedAlerts([]); return; }
    setDerivedAlerts(paycheckAlerts(txns, classOf, new Date()));
  }, [demo, guestDemo, loading, txns, classOf]);
  useEffect(() => () => setDerivedAlerts([]), []);

  // "Extend history": place edits whose transaction arrived after the re-link.
  const relinkRetried = useRef(false);
  useEffect(() => {
    if (demo || guestDemo || !user || !settingsLoaded || loading || !txns.length || relinkRetried.current) return;
    relinkRetried.current = true;
    retryPendingCarryovers(supabase as unknown as RelinkDb, user.id, settings, next => S.update(next))
      .then(r => { if (r.resolved) toast.success(`Moved ${r.resolved} more edit${r.resolved === 1 ? "" : "s"} to your re-linked bank`); })
      .catch(e => console.warn("[relink] pending retry:", (e as Error)?.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per session, after the first full load
  }, [demo, guestDemo, user, settingsLoaded, loading, txns.length]);
  // Everything that is NOT spending or income (internal transfers, card
  // payments, savings contributions, unreviewed transfers) — excluded from
  // every spend/income total. Kept under the historical name so existing
  // call sites keep excluding the right things.
  const internalTxnIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, c] of txnClasses) { const b = bucketOf(c.type); if (b === "ignored" || b === "neutral") ids.add(id); }
    return ids;
  }, [txnClasses]);
  // Auto-detected (not user-forced) transfers, for the "Internal" chip.
  const autoInternalIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, c] of txnClasses) if (c.type === "transfer_internal" && c.source !== "override" && c.source !== "category_override") ids.add(id);
    return ids;
  }, [txnClasses]);
  // Align each transaction's displayed category with its type, so a page
  // that groups by category (Spending's Expenses / Income / Ignored tabs)
  // lands on the same totals as the classifier. Only applied where the two
  // disagree (e.g. a paired transfer still labeled "Salary").
  const classForcedCat = useMemo(() => {
    const m: Record<string, string> = {};
    const ignored = new Set(IGNORED_CATEGORIES.map(c => c.toLowerCase()));
    for (const t of txns) {
      const c = txnClasses.get(t.id);
      if (!c) continue;
      const amount = Number(t.amount);
      const current = catOverridesManual[t.id] ?? smartResults.catById[t.id] ?? getRuleCategory(t.merchant_name ?? t.name ?? null) ?? normalisePlaidCategory(t.category, t.merchant_name, t.name);
      const isIgnoredCat = ignored.has(current.toLowerCase());
      const isIncomeCat = isIncomeCategory(current, customCategories, amount);
      const bucket = bucketOf(c.type);
      let forced: string | null = null;
      if (bucket === "ignored" || bucket === "neutral") {
        // P2P with other people shows as "Transfer Out"/"Transfer In"; other
        // unmatched transfers as "Unreviewed Transfer" (both ignored).
        const display = displayCategoryForType(c.type, c.subtype);
        if (!isIgnoredCat || current.toLowerCase() !== (display ?? "").toLowerCase()) forced = display;
      } else if (bucket === "income") {
        if (!isIncomeCat || isIgnoredCat) forced = displayCategoryForType(c.type, c.subtype);
      } else if (isIncomeCat || isIgnoredCat) {
        // e.g. the user typed a Venmo as "spend": don't leave it in an ignored category
        forced = displayCategoryForType(c.type) ?? "Other";
      }
      if (forced && forced !== current) m[t.id] = forced;
    }
    return m;
  }, [txns, txnClasses, catOverridesManual, smartResults, getRuleCategory, customCategories]);
  /** Change (or clear) a transaction's type — persisted, always wins. */
  const setTxnType = useCallback((t: PTxn, type: TxnType | null) => {
    if (!t.transaction_id) { toast.error("This transaction can't be reclassified"); return; }
    // The legacy internal flags would otherwise fight the new choice.
    if (manualInternalIds.has(t.id)) S.toggleManualInternal(t.id);
    setTypeOverride(t.transaction_id, type);
  }, [manualInternalIds, S, setTypeOverride]);
  // Picking an explicit category is a more specific signal than an earlier
  // "mark as internal" flag or manual type override on the same txn — but
  // classifyOne checks type overrides BEFORE category overrides, so leaving
  // a stale one in place means the category keeps "reverting": the
  // classifier's type still wins, and classForcedCat forces the displayed
  // category back to match that type on the very next render. Clear any
  // conflicting type-level override whenever the user sets a category.
  const clearConflictingTypeOverride = useCallback((t: PTxn) => {
    if (manualInternalIds.has(t.id)) S.toggleManualInternal(t.id);
    if (t.transaction_id && typeOverridesByPlaidId[t.transaction_id]) setTypeOverride(t.transaction_id, null);
  }, [manualInternalIds, S, typeOverridesByPlaidId, setTypeOverride]);
  // Possible duplicates: flagged for review, never deleted.
  const possibleDupIds = useMemo(() => new Set(findPossibleDuplicateIds(txns)), [txns]);

  // Merged maps — the classifier's alignment wins, then manual edits, then
  // smart-rule output.
  const overrides = useMemo(() => ({ ...smartResults.catById, ...catOverridesManual, ...classForcedCat }), [smartResults, catOverridesManual, classForcedCat]);
  const nameOverrides = useMemo(() => ({ ...smartResults.nameById, ...nameOverridesManual }), [smartResults, nameOverridesManual]);

  // Resolve display name: per-txn override → merchant rule → merchant name
  const getDisplayName = (t: PTxn) => {
    if (nameOverrides[t.id]) return nameOverrides[t.id];
    const m = t.merchant_name ?? t.name ?? null;
    if (m && nameRules[m]) return nameRules[m];
    return m ?? "Transaction";
  };

  // Panel order for overall dashboard (drag-and-drop)
  const DEFAULT_PANEL_ORDER = ["action-items", "saving-opps", "upcoming-charges"];
  const panelOrder = (settings.panelOrder?.length === 3 && DEFAULT_PANEL_ORDER.every(id => settings.panelOrder.includes(id))) ? settings.panelOrder : DEFAULT_PANEL_ORDER;
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const txnListRef = useRef<HTMLDivElement>(null);
  // Alerts are sent by the send-alerts edge function on a pg_cron schedule
  // (every 20 min). It is server-only now (service_role or cron secret), so
  // the client no longer triggers it.
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
      // No date floor here — every detector downstream (recurring bills,
      // yearly expenses, income patterns) already applies its own lookback
      // window in JS once this data is loaded. A hard cutoff at this layer
      // used to silently drop anything older than 13 months on every single
      // refresh — including manually imported statement history from prior
      // years, which would vanish again the moment the page next reloaded.
      // Transactions are fetched via fetchAllTransactions (paginated — see
      // its comment) rather than a plain .select(), since a plain select
      // silently truncates at ~1000 rows once total volume crosses that line.
      const [accsRes, txnsData, itsRes, cdRes] = await Promise.all([
        supabase.from("plaid_accounts").select("*").eq("user_id",user.id).order("type"),
        fetchAllTransactions(user.id),
        supabase.from("plaid_items").select("id,item_id,institution_id,institution_name,created_at").eq("user_id",user.id),
        supabase.from("plaid_credit_details").select("*").eq("user_id",user.id),
      ]);
      if (accsRes.error) console.error("[load] accounts:", accsRes.error.message);
      if (itsRes.error)  console.error("[load] items:", itsRes.error.message);
      if (cdRes.error)   console.error("[load] credit details:", cdRes.error.message);
      // Apply whatever succeeded — one failing table shouldn't blank the rest
      setAccounts((accsRes.data ?? []) as PAccount[]);
      const cleanedTxns = await cleanImportedDescriptions(user.id, txnsData);
      const dedupedTxns = await dedupeTransactions(user.id, cleanedTxns);
      setTxns(dedupedTxns);
      setItems((itsRes.data ?? []) as PItem[]);
      setCreditDetails((cdRes.data ?? []) as CreditDetail[]);
      // accountMeta auto-updates from settings
      setLastSyncedAt(new Date());
      if (accsRes.error && txnsData.length === 0) {
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
    // Same no-cutoff, fully-paginated fetch as load() above — see its comment.
    const data = await fetchAllTransactions(user.id);
    const cleaned = await cleanImportedDescriptions(user.id, data);
    const deduped = await dedupeTransactions(user.id, cleaned);
    setTxns(deduped);
    setLastSyncedAt(new Date());
    setRefreshingTxns(false);
  }, [user]);

  useEffect(()=>{ load(); },[load]);
  useEffect(()=>{ loadInsights(); },[loadInsights]);
  useEffect(()=>{ if (syncTrigger>0) doSync(); },[syncTrigger, doSync]);
  useEffect(()=>{ setOpenPickerTxn(null); setEditingBudgetCat(null); },[view]);

  // ── Computed (before any early return) ────────────────────

  // Helper: compute remaining loan balance for a manual mortgage/loan
  // If the account is a mortgage AND has property_value set, use equity (not just balance)
  // Net worth contribution = property_value - current_balance (outstanding loan)
  const manualAccountNWValue = (a: ReturnType<typeof manualAccounts>[0]): number => {
    const bal = Number(a.current_balance) || 0;
    if ((a.type === "mortgage" || a.type === "home_loan") && a.property_value) {
      // Equity = property value - outstanding loan balance (positive = equity, negative = underwater)
      return (Number(a.property_value) || 0) - Math.abs(bal);
    }
    if (a.role === "debt") return -Math.abs(bal);
    return bal;
  };

  // EMI calculator for display in account detail
  const calcEMI = (principal: number, annualRate: number, termYears: number): number => {
    if (!principal || !annualRate || !termYears) return 0;
    const r = annualRate / 100 / 12;
    const n = termYears * 12;
    if (r === 0) return principal / n;
    return principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  };

  const manualAssets = manualAccounts.filter(a => a.role !== "debt" && a.type !== "mortgage" && a.type !== "home_loan").reduce((s,a)=>s+(Number(a.current_balance)||0),0);
  const manualLiab   = manualAccounts.filter(a => a.role === "debt" && a.type !== "mortgage" && a.type !== "home_loan").reduce((s,a)=>s+(Number(a.current_balance)||0),0);
  // Mortgage/home loans: add equity (property_value - loan) as asset contribution
  const mortgageEquity = manualAccounts
    .filter(a => a.type === "mortgage" || a.type === "home_loan")
    .reduce((s, a) => s + manualAccountNWValue(a), 0);
  const assets      = accounts.filter(a=>!isDebt(a.type)).reduce((s,a)=>s+(Number(a.current_balance)||0),0) + manualAssets + (mortgageEquity > 0 ? mortgageEquity : 0);
  const liabilities = accounts.filter(a=>isDebt(a.type)).reduce((s,a)=>s+(Number(a.current_balance)||0),0) + manualLiab + (mortgageEquity < 0 ? Math.abs(mortgageEquity) : 0);
  const netWorth    = assets-liabilities;
  const monthlyFlow = buildMonthlyFlow(txns, overrides, getRuleCategory, customCategories, classOf);

  const animatedNW   = useCountUp(netWorth, 1200);
  const animatedAss  = useCountUp(assets, 1000);
  const animatedLiab = useCountUp(liabilities, 1000);

  const byBucket = (b:Bucket) => accounts.filter(a=>mapBucket(a.type,a.subtype)===b);

  const toggleManualInternal = (id: string) => {
    S.toggleManualInternal(id);
  };

  // nwData must be computed after internalTxnIds so internal transfers are excluded from the chart
  const nwData   = buildNWByPeriod(netWorth, txns, period, internalTxnIds);
  const nwChange = nwData.length>1 ? nwData[nwData.length-1].v - nwData[0].v : 0;

  // ── Unified totals (src/lib/classify) ────────────────────────────────────
  // Every page uses the same definitions:
  //   spending = spend + refunds (net) + obligations (bills, loans, mortgage, taxes), pending included
  //   income   = salary + interest/dividends + other income (net of reversals)
  //   excluded = internal transfers, credit-card payments, savings contributions
  //   neutral  = unmatched transfers (review), never income or spend
  // Home, the 6-month chart, Spending, Budget and Money Map all call
  // summarizeFlow with the same classOf, so they can't drift apart again.
  const now = new Date();
  const catOfTxn = (t: ClassifierTxn) => getEffectiveCategory(t as PTxn, overrides, getRuleCategory) ?? "Other";
  const classOfC = (t: ClassifierTxn) => classOf(t as PTxn);
  const curRange = monthRange(now, 0);
  const curMonthTxns = txns.filter(t => t.date >= curRange.start && t.date <= curRange.end);
  const curSummary = summarizeFlow(curMonthTxns as ClassifierTxn[], classOfC, catOfTxn);
  const prevSpan = samePeriodLastMonth(now);
  const prevSpanSummary = summarizeFlow(txns as ClassifierTxn[], classOfC, catOfTxn, prevSpan);
  const curMonthExpenses = curMonthTxns.filter(t => { const c = classOf(t); return !!c && bucketOf(c.type) === "spending"; });

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
  const totalSpend = curSummary.spending;
  const curMonthIncome = curSummary.income;
  // Same day-span last month (e.g. Oct 1–20 vs Sep 1–20), not the full month.
  const spendVsLastMonth = totalSpend - prevSpanSummary.spending;
  const curSavingsRate = calcSavingsRate(curSummary.income, curSummary.spending);

  // Period-filtered data for monthly/spending tabs
  const monthlyPeriodTxns = filterByPeriod(txns, monthlyPeriod);

  const spendingPeriodTxns = filterByPeriod(txns, spendingPeriod);
  const spendingPeriodSummary = summarizeFlow(spendingPeriodTxns as ClassifierTxn[], classOfC, catOfTxn);
  const spendingPeriodByCategory = Object.entries(spendingPeriodSummary.spendingByCategory)
    .map(([category,v])=>({category,...v}))
    .sort((a,b)=>b.total-a.total);
  const spendingPeriodTotal = spendingPeriodSummary.spending;

  const allActions       = generateActions(accounts, txns, internalTxnIds, overrides, getRuleCategory, budgets, creditDetails, customCategories);
  const visibleActions   = allActions.filter(a=>!dismissedActions.has(a.id));
  const visibleInsights  = aiInsights.filter(i=>!dismissedInsights.has(i.id));
  const spendTrends      = buildSpendTrends(txns, overrides, getRuleCategory, internalTxnIds, customCategories, classOf);
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
    // Classify by the category's assigned type, not sign, so a refund into an
    // expense category shows under "Expenses" (netting the total down) rather
    // than appearing in "Income".
    if (txnFlowFilter === "expense") base = base.filter(t => !isIncomeCategory(getEffectiveCategory(t,overrides,getRuleCategory) ?? "Other", customCategories, Number(t.amount)));
    if (txnFlowFilter === "income")  base = base.filter(t => isIncomeCategory(getEffectiveCategory(t,overrides,getRuleCategory) ?? "Other", customCategories, Number(t.amount)));
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
      <div className="flex items-center gap-2 text-muted-foreground text-[13px]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your settings…
      </div>
    </div>
  );
  if (loading) {
    if (view === "spending" || view === "myfinances") return <SpendingSkeleton />;
    return <div className="min-h-[40vh] grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  // ── Period nav pill (reused in monthly + spending tabs) ──────
  // Segmented switch between the merged Spending and My Financial Picture views.
  const SpendBudgetTabs = () => (
    <div className="flex bg-muted/40 rounded-full p-0.5 text-[13px] font-medium">
      {([["spending", "Spending"], ["myfinances", "My Financial Picture"]] as const).map(([k, label]) => (
        <button key={k} onClick={() => onViewChange?.(k)}
          className={cn("px-5 py-1.5 rounded-full transition-all",
            view === k ? "bg-background text-foreground font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {label}
        </button>
      ))}
    </div>
  );

  const PeriodNav = ({ state, onChange, granularities = ["week","month","year"] }: { state: PeriodState; onChange: (s: PeriodState) => void; granularities?: PeriodGranularity[] }) => (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex rounded-full bg-muted/40 p-0.5">
        {granularities.map(g=>(
          <button key={g} onClick={()=>onChange({granularity:g,offset:0})}
            className={cn("px-3 py-1.5 rounded-full text-[12px] font-medium transition-all capitalize",
              state.granularity===g?"bg-background text-foreground shadow-sm":"text-muted-foreground hover:text-foreground")}>
            {g}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button onClick={()=>onChange({...state,offset:state.offset-1})}
          aria-label="Previous period"
          className="h-8 w-8 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-[13px] text-foreground font-medium min-w-[130px] text-center">{getPeriodLabel(state)}</span>
        <button onClick={()=>onChange({...state,offset:Math.min(0,state.offset+1)})}
          disabled={state.offset===0}
          aria-label="Next period"
          className="h-8 w-8 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-30">
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
              <div className="text-[12px] uppercase tracking-wider text-muted-foreground mb-0.5">Net Worth</div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <h2 className="font-display text-3xl md:text-4xl font-semibold leading-none tabular stat-gold animate-count-in">
                  {fmtUSD(animatedNW)}
                </h2>
                {nwChange!==0 && (
                  // A tiny rotated ArrowUpRight read as "×"; use a clear up/down
                  // arrow and say which period the change covers.
                  <span className={cn("chip !py-0.5 !px-1.5 !text-[12px] animate-pop-in inline-flex items-center gap-0.5 whitespace-nowrap", nwChange>=0?"chip-positive":"chip-negative")}
                    title={`${nwChange>=0?"Up":"Down"} ${fmtUSD(Math.abs(nwChange))} over ${period === "ALL" ? "all time" : `the last ${period}`}`}>
                    {nwChange>=0 ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />}
                    <span className="sr-only">{nwChange>=0?"Up":"Down"}</span>
                    {fmtUSDCompact(Math.abs(nwChange))}
                    <span className="opacity-70 font-normal">· {period === "ALL" ? "all time" : period}</span>
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-4 mt-2">
              <div>
                <div className="text-[12px] uppercase tracking-wider text-muted-foreground">Assets</div>
                <div className="font-display text-base tabular text-positive">{fmtUSDCompact(animatedAss)}</div>
              </div>
              <div>
                <div className="text-[12px] uppercase tracking-wider text-muted-foreground">Liabilities</div>
                <div className="font-display text-base tabular text-negative">−{fmtUSDCompact(animatedLiab)}</div>
              </div>
            </div>
            {/* Period selector */}
            <div className="flex items-center gap-0.5 mt-2.5 flex-wrap">
              {PERIODS.map(p=>(
                <button key={p} onClick={()=>setPeriod(p)}
                  className={cn("px-2 py-0.5 rounded-full text-[12px] font-medium transition-all",
                    period===p?"bg-gold text-foreground":"text-muted-foreground hover:text-foreground hover:bg-secondary/60")}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          {/* Right — compact chart (hidden on small screens) */}
          <div className="hidden sm:block w-[45%] shrink-0 -mr-1 -my-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={nwData} margin={{top:4,right:8,bottom:4,left:8}}>
                <defs>
                  <linearGradient id="nw-live" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="m" axisLine={false} tickLine={false} tick={{fill:"hsl(var(--muted-foreground))",fontSize:8}} interval={nwTickEvery-1}
                  padding={{left:14,right:14}} minTickGap={4} />
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
        const savingsRate = curSavingsRate;
        const excludedNote = [
          curSummary.creditCardPayments > 0 ? `card payments ${fmtUSD(curSummary.creditCardPayments)}` : null,
          curSummary.savingsContributions > 0 ? `savings ${fmtUSD(curSummary.savingsContributions)}` : null,
          curSummary.internalTransfers > 0 ? `transfers ${fmtUSD(curSummary.internalTransfers)}` : null,
        ].filter(Boolean).join(" · ");
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button type="button" onClick={()=>{
                setSpendingPeriod({granularity:"month",offset:0});setTxnFlowFilter("expense");setTxnLimit(150);
                onCategorySelect?.("__spending__");
              }}
              className="surface-card p-3 relative overflow-hidden text-left hover:border-border-strong transition-colors cursor-pointer">
              <div className="pointer-events-none absolute -top-4 -right-4 h-14 w-14 rounded-full bg-negative/8 blur-xl" />
              <div className="text-[12px] uppercase tracking-widest text-muted-foreground">Spent this month</div>
              <div className="font-display text-lg tabular text-foreground mt-0.5"
                title={`Purchases, bills, loans and taxes (refunds netted, pending included).${excludedNote ? ` Not counted: ${excludedNote}.` : ""}`}>
                {fmtUSD(totalSpend)}
              </div>
              {Math.round(spendVsLastMonth) !== 0 && (
                <div className={cn("text-[12px] tabular mt-0.5", spendVsLastMonth > 0 ? "text-negative" : "text-positive")}
                  title={`Compared with the same days last month (${prevSpan.label}: ${fmtUSD(prevSpanSummary.spending)})`}>
                  {spendVsLastMonth > 0 ? "↑" : "↓"} {fmtUSD(Math.abs(spendVsLastMonth))} {spendVsLastMonth > 0 ? "more" : "less"} than {prevSpan.label}
                </div>
              )}
            </button>
            <button type="button" onClick={()=>{
                setSpendingPeriod({granularity:"month",offset:0});setTxnFlowFilter("income");setTxnLimit(150);
                onCategorySelect?.("__spending__");
              }}
              className="surface-card p-3 relative overflow-hidden text-left hover:border-border-strong transition-colors cursor-pointer">
              <div className="pointer-events-none absolute -top-4 -right-4 h-14 w-14 rounded-full bg-positive/8 blur-xl" />
              <div className="text-[12px] uppercase tracking-widest text-muted-foreground">Income this month</div>
              <div className="font-display text-lg tabular text-positive mt-0.5"
                title={`Salary ${fmtUSD(curSummary.salary)} · interest ${fmtUSD(curSummary.interest)} · other ${fmtUSD(curSummary.otherIncome)}. Transfers between your accounts are not income.`}>
                {fmtUSD(curMonthIncome)}
              </div>
              <div className="text-[12px] text-muted-foreground mt-0.5">excl. transfers</div>
            </button>
            <button type="button" onClick={()=>{
                setSpendingPeriod({granularity:"month",offset:0});setTxnFlowFilter("all");setTxnLimit(150);
                onCategorySelect?.("__spending__");
              }}
              className="surface-card p-3 relative overflow-hidden text-left hover:border-border-strong transition-colors cursor-pointer">
              <div className="pointer-events-none absolute -top-4 -right-4 h-14 w-14 rounded-full bg-[hsl(var(--primary)/0.08)] blur-xl" />
              <div className="text-[12px] uppercase tracking-widest text-muted-foreground">Net cash flow</div>
              <div className={cn("font-display text-lg tabular mt-0.5", net >= 0 ? "text-positive" : "text-negative")}>
                {net >= 0 ? "+" : "−"}{fmtUSD(Math.abs(net))}
              </div>
              <div className="text-[12px] text-muted-foreground mt-0.5">income − spend</div>
            </button>
            <button type="button" onClick={()=>{
                setSpendingPeriod({granularity:"month",offset:0});setTxnFlowFilter("all");setTxnLimit(150);
                onCategorySelect?.("__spending__");
              }}
              className="surface-card p-3 relative overflow-hidden text-left hover:border-border-strong transition-colors cursor-pointer">
              <div className="pointer-events-none absolute -top-4 -right-4 h-14 w-14 rounded-full bg-info/8 blur-xl" />
              <div className="text-[12px] uppercase tracking-widest text-muted-foreground">Savings rate</div>
              <div className={cn("font-display text-lg tabular mt-0.5", savingsRate != null && savingsRate >= 20 ? "text-positive" : savingsRate != null && savingsRate < 0 ? "text-negative" : "text-foreground")}>
                {savingsRate != null ? `${savingsRate}%` : "n/a"}
              </div>
              <div className="text-[12px] text-muted-foreground mt-0.5">of income kept</div>
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
                <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
                  This will delete the account and all its synced transactions from SentryFi.
                  Your actual bank account is not affected.
                </p>
                {removingAccount.mask && (
                  <div className="mt-3 surface-card p-3 flex items-center gap-2">
                    {(() => { const Icon = mapIcon(removingAccount.type, removingAccount.subtype); return <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />; })()}
                    <span className="text-[13px] text-foreground">{removingAccount.name}</span>
                    <span className="text-[12.5px] text-muted-foreground">··{removingAccount.mask}</span>
                  </div>
                )}
              </div>
              <div className="hairline p-4 flex gap-2">
                <button
                  onClick={() => doRemoveAccount(removingAccount)}
                  disabled={removeConfirming}
                  className="flex-1 h-10 rounded-lg bg-negative text-background text-[14px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {removeConfirming ? "Removing…" : "Yes, remove"}
                </button>
                <button
                  onClick={() => setRemovingAccount(null)}
                  disabled={removeConfirming}
                  className="h-10 px-4 rounded-lg border border-border-strong text-[13px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Suggested transfers: confirmed from the Budget "Cover overages" picker.
          These are things the user still needs to actually go do — not auto-executed. ── */}
      {(() => {
        const pending = settings.plannedTransfers.filter(p => !p.done);
        if (pending.length === 0) return null;
        const monthLabel = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }); };
        return (
          <section className="surface-card overflow-hidden border border-[hsl(var(--primary)/0.25)]">
            <div className="px-5 py-3 border-b border-border/20 flex items-center gap-2">
              <ArrowRightLeft className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
              <h2 className="font-display text-[15px] text-primary flex-1">Suggested transfers</h2>
              <span className="text-[12px] text-muted-foreground">{pending.length} to do</span>
            </div>
            <div className="divide-y divide-border/15">
              {pending.map(p => (
                <div key={p.id} className="px-5 py-3.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] text-foreground">
                      Move <span className="font-semibold tabular">{fmtUSD(p.amount)}</span> from <span className="font-medium">{p.fromAccountName}</span> to cover <span className="font-medium">{formatCat(p.category)}</span>
                    </div>
                    <div className="text-[12px] text-muted-foreground mt-0.5">{monthLabel(p.month)} · you still need to make this transfer</div>
                  </div>
                  <button onClick={() => S.markTransferDone(p.id)}
                    className="h-8 px-3 rounded-lg bg-positive/10 text-positive text-[12px] font-medium hover:bg-positive/20 transition-colors shrink-0 inline-flex items-center gap-1">
                    <Check className="h-3.5 w-3.5" /> Done
                  </button>
                  <button onClick={() => S.dismissTransfer(p.id)}
                    aria-label="Dismiss suggested transfer"
                    className="h-8 w-8 grid place-items-center rounded-lg text-muted-foreground/60 hover:text-negative hover:bg-negative/10 transition-colors shrink-0">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        );
      })()}

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
                  <h3 className="font-display text-[14px] text-primary flex-1">Action items</h3>
                  {visibleActions.length>0 && <span className="text-[12px] text-muted-foreground tabular">{visibleActions.length} open</span>}
                </div>
                {visibleActions.length===0 ? (
                  <div className="px-4 py-4 flex items-center gap-2 text-[13px] text-muted-foreground">
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
                              <span className="text-[14px] text-foreground font-medium truncate">{item.title}</span>
                              <span className={cn("text-[12px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border shrink-0",m.chip)}>{m.label}</span>
                            </div>
                            <p className="text-[12.5px] text-muted-foreground leading-snug mt-0.5 line-clamp-2 break-words" title={typeof item.detail === "string" ? item.detail : undefined}>{item.detail}</p>
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
                  <h3 className="font-display text-[14px] text-primary flex-1">Saving opportunities</h3>
                  {!insightsLoading && visibleInsights.length>0 && (
                    <span className="text-[12px] font-semibold text-positive tabular bg-positive/10 px-2 py-0.5 rounded-full">
                      +{fmtUSDCompact(visibleInsights.reduce((s,i)=>s+(i.impactValue??0),0))}/yr
                    </span>
                  )}
                  <button onClick={()=>loadInsights(true)} disabled={insightsLoading}
                    title="Refresh AI suggestions" aria-label="Refresh AI suggestions"
                    className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-border/30 disabled:opacity-40 transition-colors shrink-0">
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
                  <div className="px-4 py-5 text-[13px] text-muted-foreground flex items-center gap-2">
                    <Sparkles className="h-4 w-4 shrink-0 opacity-40" />Tap the refresh icon above to generate insights.
                  </div>
                ) : (
                  // Fixed-height collapsed rows regardless of how many there are —
                  // expanding one reveals its detail inline without resizing the
                  // others, and the whole list scrolls once it outgrows ~5 rows
                  // instead of pushing the rest of the page down.
                  <div className={cn("divide-y divide-border/15", visibleInsights.length > 5 && "max-h-[340px] overflow-y-auto")}>
                    {visibleInsights.map(insight=>{
                      const CatIcon=insight.category==="Rewards"?Sparkles:insight.category==="Credit"?CreditCard:insight.category==="Subscriptions"?Coins:insight.category==="Savings"?Coins:TrendingUp;
                      const sevDot = insight.severity==="high" ? "bg-negative" : insight.severity==="medium" ? "bg-warning" : "bg-info";
                      return (
                        <div key={insight.id} className="group/insightrow flex items-start gap-1 px-2.5 py-2.5 hover:bg-surface-hover/30 transition-colors">
                          <button onClick={()=>setOpenInsight(insight)}
                            className="flex-1 min-w-0 flex items-start gap-2.5 text-left">
                            <div className="h-7 w-7 rounded-lg bg-secondary/60 grid place-items-center text-foreground/80 shrink-0 relative mt-0.5">
                              <CatIcon className="h-3.5 w-3.5" />
                              <span className={cn("absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full", sevDot)} />
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col gap-0.5 pt-0.5">
                              <span className="text-[13px] text-foreground font-medium leading-snug line-clamp-2 break-words">{insight.title}</span>
                              <span className="text-[11.5px] tabular text-positive font-semibold line-clamp-2 break-words" title={insight.impact}>{insight.impact}</span>
                            </div>
                          </button>
                          <button onClick={()=>dismissInsight(insight.id)} title="Dismiss" aria-label="Dismiss insight"
                            className="shrink-0 h-6 w-6 grid place-items-center rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-border/30 opacity-100 md:opacity-0 md:group-hover/insightrow:opacity-100 focus:opacity-100 transition-all mt-1">
                            <X className="h-3 w-3" />
                          </button>
                          <button onClick={()=>setOpenInsight(insight)} title="View details" aria-label="View insight details"
                            className="shrink-0 h-6 w-6 grid place-items-center rounded-md text-muted-foreground/50 hover:text-foreground transition-colors mt-1">
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );

            const panelUpcomingCharges = (dragHandle: React.HTMLAttributes<HTMLElement>) => (
              <div className="surface-card overflow-hidden h-full">
                {/* select-none: dragging the grip used to leave the header text
                    (e.g. the "$9.35" total) with a blue selection highlight. */}
                <div className="px-5 py-3 border-b border-border/30 flex items-center gap-2 select-none">
                  <button {...dragHandle} className="text-muted-foreground/30 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none shrink-0" title="Drag to reorder" aria-label="Drag to reorder">
                    <GripVertical className="h-3.5 w-3.5" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display text-[14px] text-primary">Upcoming Charges</h3>
                    <div className="flex items-center gap-x-2 flex-wrap">
                      <div className="text-[12px] text-muted-foreground whitespace-nowrap">
                        Next 15 days · {recurringCharges.length} recurring
                        {recurringCharges.length > 0 && <> · <span className="tabular text-foreground font-medium">{fmtUSD(recurringCharges.reduce((s,r)=>s+r.avgAmount,0))}</span></>}
                      </div>
                      {suppressRecurringMerchants.size > 0 && (
                        <button onClick={restoreAllRecurring} title="Show hidden charges again" className="text-[12px] text-muted-foreground/50 hover:text-[hsl(var(--primary))] transition-colors whitespace-nowrap">
                          {suppressRecurringMerchants.size} hidden · restore
                        </button>
                      )}
                    </div>
                  </div>
                  <button onClick={refreshTxns} disabled={refreshingTxns}
                    aria-label={refreshingTxns ? "Refreshing transactions" : "Refresh transactions"}
                    className="h-8 w-8 grid place-items-center rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 shrink-0">
                    <RefreshCw className={cn("h-3.5 w-3.5", refreshingTxns && "animate-spin")} />
                  </button>
                </div>
                {recurringCharges.length === 0 ? (
                  <div className="px-4 py-6 text-[13px] text-muted-foreground text-center">No upcoming charges detected.</div>
                ) : (
                  <div className="divide-y divide-border/20 max-h-[360px] overflow-y-auto">
                    {recurringCharges.map((r, idx) => {
                      const daysAway = Math.ceil((r.predictedDate.getTime() - Date.now()) / 86400000);
                      const isThisWeek = daysAway <= 7;
                      const sourceAcc = accounts.find(a => a.account_id === r.accountId);
                      const isCC = sourceAcc?.type === "credit";
                      const isDebtAcc = sourceAcc ? isDebt(sourceAcc.type) : false;
                      // For CC: check available credit. For checking/savings: check available balance.
                      const availBal = sourceAcc
                        ? isCC
                          ? (Number(sourceAcc.available_balance) || 0) // available credit on CC
                          : (Number(sourceAcc.available_balance) || Number(sourceAcc.current_balance) || 0)
                        : null;
                      const showBalCheck = availBal !== null;
                      const hasSufficient = availBal !== null && availBal >= r.avgAmount;
                      const flagLabel = isCC ? "Low credit" : "Low funds";
                      return (
                        <div key={idx} className="group flex items-center gap-3 px-5 py-3">
                          <div className={cn("shrink-0 w-9 text-center rounded-lg py-1 border",
                            daysAway<=3?"bg-negative/10 border-negative/20":isThisWeek?"bg-warning/10 border-warning/20":"bg-secondary/50 border-border/40")}>
                            <div className="text-[12px] uppercase tracking-wide text-muted-foreground leading-none">
                              {r.predictedDate.toLocaleDateString("en-US",{month:"short"})}
                            </div>
                            <div className={cn("text-[15px] font-bold tabular leading-tight",
                              daysAway<=3?"text-negative":isThisWeek?"text-warning":"text-foreground")}>
                              {r.predictedDate.getDate()}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[13px] text-foreground font-medium truncate">{r.merchant}</span>
                              {daysAway<=1 && (
                                <span className="text-[12px] px-1.5 py-0.5 rounded-full border border-negative/30 bg-negative/10 text-negative shrink-0 font-medium">
                                  {daysAway===0?"Today":"Tomorrow"}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              <span className="text-[12px] text-muted-foreground/60">{r.intervalLabel}</span>
                              {sourceAcc && <><span className="text-muted-foreground/30">·</span>
                                <span className="text-[12px] text-muted-foreground truncate">
                                  {sourceAcc.name??""}{sourceAcc.mask?` ··${sourceAcc.mask}`:""}
                                </span></>}
                              {showBalCheck && !hasSufficient && (
                                <><span className="text-muted-foreground/30">·</span>
                                <span className="text-[12px] text-negative flex items-center gap-0.5">
                                  <AlertTriangle className="h-2.5 w-2.5" />{flagLabel}
                                </span></>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[14px] tabular font-semibold text-foreground">{fmtUSD(r.avgAmount)}</div>
                            {daysAway>1 && <div className="text-[12px] text-muted-foreground tabular">{daysAway}d</div>}
                          </div>
                          <div className="relative shrink-0">
                            <button onClick={()=>setRecurringMenuFor(m=>m===r.merchantKey?null:r.merchantKey)} title="Remove from recurring list" aria-label={`Remove ${r.merchant} from recurring list`}
                              className={cn("h-8 w-8 grid place-items-center rounded text-muted-foreground/50 hover:text-negative hover:bg-negative/10 transition-all",
                                recurringMenuFor===r.merchantKey ? "opacity-100 text-negative bg-negative/10" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100")}>
                              <X className="h-3.5 w-3.5" />
                            </button>
                            {recurringMenuFor===r.merchantKey && (()=>{
                              const doDismiss = (reason: string, suppressCategory=false) => {
                                dismissRecurringWithReason({ merchant: r.merchantKey, category: r.category || undefined, reason, suppressCategory, at: new Date().toISOString() });
                                setRecurringMenuFor(null);
                                toast.success("Removed from upcoming", { description: suppressCategory && r.category ? `Similar ${formatCat(r.category)} charges will stay hidden.` : `"${r.merchant}" won't be predicted again.` });
                              };
                              return (
                                <>
                                  <button aria-label="Close menu" className="fixed inset-0 z-[60]" onClick={()=>setRecurringMenuFor(null)} />
                                  <div className="absolute right-0 top-8 z-[61] w-52 rounded-xl border border-border/60 bg-card shadow-2xl overflow-hidden py-1">
                                    <div className="px-3 py-1.5 text-[12px] uppercase tracking-wider text-muted-foreground/70">Why remove this?</div>
                                    {[
                                      { label: "Not a recurring charge", reason: "not_recurring" },
                                      { label: "I cancelled it", reason: "cancelled" },
                                      { label: "Wrong prediction", reason: "wrong_prediction" },
                                    ].map(opt=>(
                                      <button key={opt.reason} onClick={()=>doDismiss(opt.reason)}
                                        className="w-full text-left px-3 py-2 text-[13px] text-foreground hover:bg-surface-hover/50 transition-colors">
                                        {opt.label}
                                      </button>
                                    ))}
                                    {r.category && (
                                      <button onClick={()=>doDismiss("hide_category", true)}
                                        className="w-full text-left px-3 py-2 text-[13px] text-foreground hover:bg-surface-hover/50 transition-colors border-t border-border/20">
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
              if (id === "upcoming-charges") return panelUpcomingCharges(dragHandle);
              return null;
            };

            return (
              <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handlePanelDragEnd}>
                <SortableContext items={panelOrder} strategy={rectSortingStrategy}>
                  {/* One column per panel (3) on wide screens — the old xl:grid-cols-4
                      left an empty 4th column; at lg the odd last panel spans both. */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2.5 items-stretch lg:[&>*:last-child:nth-child(odd)]:col-span-2 xl:[&>*:last-child:nth-child(odd)]:col-span-1">
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
              <span className="text-[12px] text-muted-foreground/50">
                synced {lastSyncedAt.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}
              </span>
            )}
          </div>
          <button onClick={onAddAccount} className="text-[12.5px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 shrink-0">
            <Plus className="h-3 w-3" />Add account
          </button>
        </div>
        {accounts.length === 0 && manualAccounts.length === 0 ? (
          <div className="surface-card p-6 text-center text-[13px] text-muted-foreground">
            No accounts yet. <button onClick={onAddAccount} className="text-gold underline">Link a bank</button>.
          </div>
        ) : (
          <AccountsPanel
            accounts={accounts}
            manualAccounts={manualAccounts ?? []}
            accountMeta={accountMeta}
            items={items}
            txns={txns}
            onSelect={a => setDetailAccount(a)}
            onAddAccount={onAddAccount}
            onEditManual={onEditManual}
            onDeleteManual={onDeleteManual}
          />
        )}
      </section>

      {/* ── Insight detail dialog (centered, matches demo) ── */}
      <Dialog open={!!openInsight} onOpenChange={(o) => { if (!o) setOpenInsight(null); }}>
        <DialogContent showClose={false} className="max-w-lg surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col">
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
                <button onClick={() => setOpenInsight(null)} aria-label="Close"
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
                    <span className={cn("chip !py-0.5 !px-2 !text-[12px]",
                      openInsight.severity==="high"?"chip-negative":openInsight.severity==="medium"?"chip-warning":"chip")}>
                      <span className={cn("h-1.5 w-1.5 rounded-full inline-block mr-1",
                        openInsight.severity==="high"?"bg-negative":openInsight.severity==="medium"?"bg-warning":"bg-info")}/>
                      {openInsight.severity==="high"?"High":openInsight.severity==="medium"?"Medium":"Low"} impact
                    </span>
                    <span className="text-[12px] uppercase tracking-wider text-muted-foreground">{openInsight.category}</span>
                  </div>
                </div>
                <h3 className="font-display text-xl mt-4 text-foreground leading-snug">{openInsight.title}</h3>
                <div className="mt-4 flex items-center gap-2 flex-wrap">
                  <div className="inline-flex items-baseline gap-2 rounded-lg bg-positive/10 border border-positive/20 px-3 py-2">
                    <span className="text-[12px] uppercase tracking-wider text-muted-foreground">Estimated yearly</span>
                    <span className="font-display text-lg tabular text-positive">{openInsight.impact}</span>
                  </div>
                  {monthlyEquivalent > 0 && (
                    <div className="inline-flex items-baseline gap-1.5 rounded-lg bg-secondary/40 border border-border/40 px-3 py-2">
                      <span className="text-[12px] uppercase tracking-wider text-muted-foreground">≈ per month</span>
                      <span className="font-display text-[14px] tabular text-foreground">{fmtUSD(monthlyEquivalent)}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="hairline p-6 space-y-4 flex-1 overflow-y-auto min-h-0">
                {([["What's happening", openInsight.what, false],["Why it matters", openInsight.why, false],["Suggested action", openInsight.action, true]] as [string,string,boolean][]).map(([label,body,accent])=>(
                  <div key={label}>
                    <div className="text-[12px] uppercase tracking-[0.15em] text-muted-foreground mb-1">{label}</div>
                    <p className={cn("text-sm leading-relaxed", accent?"text-foreground":"text-muted-foreground")}>{body}</p>
                  </div>
                ))}

                {/* Related category breakdown — grounds the insight in real numbers */}
                {relatedCat && RelatedCatIcon && (
                  <div>
                    <div className="text-[12px] uppercase tracking-[0.15em] text-muted-foreground mb-2">Related spending this month</div>
                    <button onClick={()=>{setOpenInsight(null);setSpendingPopup(relatedCat.category);setSpendPopupLimit(5);}}
                      className="w-full surface-card p-3 flex items-center gap-3 hover:bg-surface-hover/40 transition-colors text-left">
                      <div className="h-8 w-8 rounded-lg grid place-items-center shrink-0" style={{backgroundColor:`${relatedCatColor}1f`,color:relatedCatColor as string}}>
                        <RelatedCatIcon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] text-foreground font-medium">{formatCat(relatedCat.category)}</div>
                        <div className="text-[12px] text-muted-foreground mt-0.5">{relatedCat.count} transaction{relatedCat.count!==1?"s":""} this month</div>
                      </div>
                      <span className="text-[15px] tabular font-semibold text-foreground shrink-0">{fmtUSD(relatedCat.total)}</span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                    </button>
                    {relatedTopTxns.length > 0 && (
                      <div className="mt-2 surface-card overflow-hidden divide-y divide-border/20">
                        {relatedTopTxns.map(t=>(
                          <div key={t.id} className="flex items-center gap-2.5 px-3 py-2">
                            <Receipt className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] text-foreground truncate">{nameOverrides[t.id]??t.merchant_name??t.name??"Transaction"}</div>
                              <div className="text-[12px] text-muted-foreground">{fmtShortDate(t.date)}</div>
                            </div>
                            <span className="text-[13px] tabular font-medium text-foreground shrink-0">{fmtUSD(Number(t.amount),{cents:true})}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Related account — grounds card/savings insights in the actual account */}
                {relatedAcc && (
                  <div>
                    <div className="text-[12px] uppercase tracking-[0.15em] text-muted-foreground mb-2">Related account</div>
                    <button onClick={()=>{setOpenInsight(null);setDetailAccount(relatedAcc);}}
                      className="w-full surface-card p-3 flex items-center gap-3 hover:bg-surface-hover/40 transition-colors text-left">
                      {(()=>{ const AccIcon=mapIcon(relatedAcc.type,relatedAcc.subtype); return (
                        <div className="h-8 w-8 rounded-lg grid place-items-center bg-secondary/50 border border-border/50 text-gold shrink-0">
                          <AccIcon className="h-4 w-4" />
                        </div>
                      ); })()}
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] text-foreground font-medium truncate">{relatedAcc.name}</div>
                        <div className="text-[12px] text-muted-foreground mt-0.5">{relatedAcc.mask?`··${relatedAcc.mask}`:smartSubtypeLabel(relatedAcc, getInstNameFor(relatedAcc, items), accountMeta[relatedAcc.id]?.apr)}</div>
                      </div>
                      <span className={cn("text-[15px] tabular font-semibold shrink-0",isDebt(relatedAcc.type)?"text-negative":"text-foreground")}>
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

      {detailTxn && <TxnDetailModal txn={detailTxn} overrides={overrides} getRuleCategory={getRuleCategory} nameOverride={nameOverrides[detailTxn.id]} nameRules={nameRules} customCategories={customCategories} allTxns={txns} initialCatOpen={detailTxnOpenCat} onClose={()=>{setDetailTxn(null);setDetailTxnOpenCat(false);}} onSaveNameOverride={setNameOverride} onBulkRename={bulkSetNameOverride} onSaveNameRule={saveNameRule} onAddCategory={addCategory} onAddRule={addRule} onRemoveCustom={removeCategory} onRenameCategory={renameCategory} onSelect={(id,cat)=>{setOverride(id,cat); if (detailTxn) clearConflictingTypeOverride(detailTxn);}} onToggleInternal={toggleManualInternal} isManualInternal={manualInternalIds.has(detailTxn.id)} isAutoInternal={autoInternalIds.has(detailTxn.id)} isManualExternal={manualExternalIds.has(detailTxn.id)} classification={classOf(detailTxn)} hasTypeOverride={!!(detailTxn.transaction_id && typeOverridesByPlaidId[detailTxn.transaction_id])} onSetTxnType={(tp)=>setTxnType(detailTxn, tp)} possibleDuplicate={possibleDupIds.has(detailTxn.id)} accounts={accounts} items={items} onFindSimilar={(pattern) => { setTxnSearch(pattern); onViewChange?.("spending"); }}
        tags={settings.txnTags[detailTxn.id] ?? []}
        onAddTag={(id,tag)=>S.addTxnTag(id,tag)}
        onRemoveTag={(id,tag)=>S.removeTxnTag(id,tag)}
        note={settings.txnNotes[detailTxn.id] ?? ""}
        onSaveNote={(id,n)=>S.setTxnNote(id,n)}
        isRecurringOverride={settings.recurringOverrides[detailTxn.id]}
        onSetRecurringOverride={(id,val)=>S.setRecurringOverride(id,val)}
        onClearRecurringOverride={(id)=>S.clearRecurringOverride(id)}
        splits={settings.txnSplits[detailTxn.id] ?? []}
        onSaveSplits={(id,sp)=>S.setTxnSplits(id,sp)}
        />}

      {/* ── Action item detail dialog (centered, matches demo) ── */}
      <Dialog open={!!openActionItem} onOpenChange={(o) => { if (!o) setOpenActionItem(null); }}>
        <DialogContent showClose={false} className="max-w-lg surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col">
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
                  <button onClick={()=>setOpenActionItem(null)} aria-label="Close"
                    className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                  <div className="flex items-center gap-2 mb-4">
                    <div className={cn("h-9 w-9 rounded-lg bg-secondary/60 grid place-items-center", m.text)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className={cn("chip !py-0.5 !px-2 !text-[12px]", m.chip)}>
                      <span className={cn("h-1.5 w-1.5 rounded-full inline-block mr-1", m.dot)}/>{m.label}
                    </span>
                  </div>
                  <h3 className="font-display text-xl text-foreground leading-snug">{openActionItem.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{openActionItem.detail}</p>
                </div>
                <div className="flex-1 overflow-y-auto min-h-0">
                {relatedAcc && (
                  <div className="hairline px-6 py-4">
                    <div className="text-[12px] uppercase tracking-wider text-muted-foreground mb-2">Related account</div>
                    <div className="surface-card p-3 flex items-center gap-3">
                      {(()=>{ const AccIcon=mapIcon(relatedAcc.type,relatedAcc.subtype); return (
                        <div className="h-8 w-8 rounded-lg grid place-items-center bg-secondary/50 border border-border/50 text-gold shrink-0">
                          <AccIcon className="h-4 w-4" />
                        </div>
                      ); })()}
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] text-foreground">{relatedAcc.name}</div>
                        <div className="text-[12px] text-muted-foreground capitalize">{relatedAcc.subtype?.replace(/_/g," ")??""}{relatedAcc.mask?` ··${relatedAcc.mask}`:""}</div>
                      </div>
                      <div className={cn("text-[15px] font-medium tabular shrink-0",isDebt(relatedAcc.type)?"text-negative":"text-foreground")}>
                        {isDebt(relatedAcc.type)?"−":""}{fmtUSD(Math.abs(Number(relatedAcc.current_balance)||0))}
                      </div>
                    </div>
                  </div>
                )}
                {relAccTxns.length>0 && (
                  <div className="hairline px-6 py-4">
                    <div className="text-[12px] uppercase tracking-wider text-muted-foreground mb-2">Recent activity</div>
                    <div className="surface-card overflow-hidden divide-y divide-border/20">
                      {relAccTxns.map(t=>{
                        const isInc=Number(t.amount)<0;
                        return (
                          <div key={t.id} className="flex items-center gap-2.5 px-3 py-2">
                            <div className={cn("h-5 w-5 rounded grid place-items-center shrink-0",isInc?"bg-positive/10 text-positive":"bg-secondary/50 text-muted-foreground")}>
                              {isInc?<ArrowDownLeft className="h-3 w-3"/>:<ArrowUpRight className="h-3 w-3"/>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] text-foreground truncate">{nameOverrides[t.id]??t.merchant_name??t.name??"Transaction"}</div>
                              <div className="text-[12px] text-muted-foreground">{fmtShortDate(t.date)}</div>
                            </div>
                            <span className={cn("text-[13px] tabular font-medium shrink-0",isInc?"text-positive":"text-foreground")}>
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
            <DialogContent showClose={false} className="max-w-lg surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col">
              <DialogTitle className="sr-only">{formatCat(cat)}: current month</DialogTitle>
              <DialogDescription className="sr-only">Top charges in {formatCat(cat)} this month.</DialogDescription>
              <div className="relative p-5 pb-4 shrink-0">
                <button onClick={()=>{setSpendingPopup(null);setSpendPopupLimit(5);}} aria-label="Close"
                  className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
                  <X className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg grid place-items-center shrink-0" style={{backgroundColor:`${color}1f`,color}}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg text-foreground">{formatCat(cat)}</h3>
                    <div className="text-[12px] uppercase tracking-wider text-muted-foreground">{new Date().toLocaleDateString("en-US",{month:"long",year:"numeric"})}</div>
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
                      <div className="text-[12px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
                      <div className="font-display text-base mt-0.5 tabular" style={{color:s.color}}>{s.value}</div>
                    </div>
                  ))}
                </div>
                {!!budget && (
                  <div className="surface-card p-3 space-y-1.5">
                    <div className="flex justify-between text-[12.5px]">
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
                    <div className="text-[12px] uppercase tracking-wider text-muted-foreground mb-2">
                      Top charges, highest to lowest ({shownTxns.length} of {catTxns.length})
                    </div>
                    <div className="surface-card overflow-hidden divide-y divide-border/20">
                      {shownTxns.map(t=>(
                        <div key={t.id} className="flex items-center gap-2.5 px-3 py-2">
                          <Receipt className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] text-foreground truncate">{nameOverrides[t.id]??t.merchant_name??t.name??"Transaction"}</div>
                            <div className="text-[12px] text-muted-foreground">{fmtShortDate(t.date)}</div>
                          </div>
                          <span className="text-[13px] tabular font-medium text-foreground shrink-0">{fmtUSD(Number(t.amount),{cents:true})}</span>
                        </div>
                      ))}
                    </div>
                    {/* Expand controls */}
                    {catTxns.length>5 && spendPopupLimit!=="all" && (
                      <div className="flex gap-2 mt-2">
                        {spendPopupLimit===5 && catTxns.length>5 && (
                          <button onClick={()=>setSpendPopupLimit(10)}
                            className="flex-1 h-8 rounded-lg border border-border text-[12.5px] text-muted-foreground hover:text-foreground hover:border-border-strong hover:bg-surface-hover/40 transition-colors">
                            Show top 10
                          </button>
                        )}
                        {catTxns.length > (spendPopupLimit===5?5:10) && (
                          <button onClick={()=>setSpendPopupLimit("all")}
                            className="flex-1 h-8 rounded-lg border border-border text-[12.5px] text-muted-foreground hover:text-foreground hover:border-border-strong hover:bg-surface-hover/40 transition-colors">
                            Show all {catTxns.length}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {catTxns.length===0 && <div className="text-center text-[13px] text-muted-foreground py-4">No transactions in this category this month.</div>}
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
  const renderBudgetPanel = (compact: boolean) => {
    // In the merged desktop layout the sidebar shares the Spending toolbar's
    // month nav instead of showing its own (was two separate month togglers
    // for the same period). Falls back to the current month when Spending is
    // browsing a non-month granularity, since budgets are always monthly.
    const effectiveBudgetOffset = compact
      ? (spendingPeriod.granularity === "month" ? spendingPeriod.offset : 0)
      : budgetMonthOffset;
    const budgetPeriodState: PeriodState = { granularity: "month", offset: effectiveBudgetOffset };
    const budgetMonthDate = new Date(); budgetMonthDate.setMonth(budgetMonthDate.getMonth() + effectiveBudgetOffset);
    const budgetMonthKey = `${budgetMonthDate.getFullYear()}-${String(budgetMonthDate.getMonth() + 1).padStart(2, "0")}`;
    const budgetTxns = filterByPeriod(txns, budgetPeriodState).filter(t => !internalTxnIds.has(t.id));
    // Classify by the category's assigned type, not transaction sign, so a
    // refund into an expense category (e.g. a Shopping return) reduces that
    // category's spend instead of being counted as income.
    const budgetExpenseTxns = budgetTxns.filter(t => !isIncomeCategory(getEffectiveCategory(t,overrides,getRuleCategory) ?? "Other", customCategories, Number(t.amount)));
    const budgetIncomeTxns = budgetTxns.filter(t => isIncomeCategory(getEffectiveCategory(t,overrides,getRuleCategory) ?? "Other", customCategories, Number(t.amount)));

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

    // Eligible funding accounts for covering an overage: everyday accounts only.
    // Long-term savings (reserve/savings_goal) are excluded on purpose so they stay
    // untouched; investment and debt accounts aren't sensible "move money from" sources.
    const fundingAccounts = accounts.filter(a => {
      const role = getRole(a.account_id, a.type, a.subtype).role;
      return role !== "reserve" && role !== "savings_goal" && role !== "investment" && role !== "debt";
    });

    // Max bar = max of budget or actual across all categories (for aligned scale)
    const maxBar = Math.max(...allBudgetedCats.map(c=>Math.max(budgets[c.category]??0, c.total)), 1);

    return (
    <>
    {/* Constrained column — a budget reads best in a focused width, not stretched
        across the whole screen where the progress bars become uncomfortably wide. */}
    <div className={cn("animate-fade-up space-y-4", !compact && "max-w-2xl mx-auto")}>

      {/* Switch + month nav — the sidebar (compact) has neither: it reflects
          whatever month the Spending toolbar above is already showing, so
          repeating the control here would just be a second way to change
          the same thing. Only the standalone Budget page gets its own nav. */}
      {!compact && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <SpendBudgetTabs />
          <div className="flex items-center gap-2">
            <button onClick={() => setBudgetMonthOffset(o => o - 1)} aria-label="Previous month"
              className="h-8 w-8 rounded-full border border-border-strong grid place-items-center text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-[15px] font-semibold text-foreground min-w-[120px] text-center">{getPeriodLabel(budgetPeriodState)}</span>
            <button onClick={() => setBudgetMonthOffset(o => Math.min(0, o + 1))} disabled={budgetMonthOffset >= 0} aria-label="Next month"
              className="h-8 w-8 rounded-full border border-border-strong grid place-items-center text-muted-foreground hover:text-foreground disabled:opacity-30">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Hero: this month's budget health ── */}
      {(() => {
        const spentOfBudget = totalSpentBudgeted;
        const leftOfBudget = totalAllocated - spentOfBudget;
        const usedPct = totalAllocated > 0 ? (spentOfBudget / totalAllocated) * 100 : 0;
        const now = new Date();
        const isCurrentMonth = effectiveBudgetOffset === 0;
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const dayOfMonth = isCurrentMonth ? now.getDate() : daysInMonth;
        const monthPct = (dayOfMonth / daysInMonth) * 100;
        const daysLeft = Math.max(daysInMonth - dayOfMonth, 0);
        const aheadOfPace = isCurrentMonth && totalAllocated > 0 && usedPct > monthPct + 6;
        const dailyLeft = daysLeft > 0 ? leftOfBudget / daysLeft : leftOfBudget;

        if (totalAllocated === 0) {
          return (
            <div className="surface-card p-8 text-center space-y-3">
              <div className="h-12 w-12 mx-auto rounded-full bg-[hsl(var(--primary)/0.1)] grid place-items-center">
                <Wallet className="h-6 w-6 text-[hsl(var(--primary))]" />
              </div>
              <div>
                <div className="font-display text-[15px] text-foreground">Start a budget</div>
                <div className="text-[13.5px] text-muted-foreground mt-1 max-w-xs mx-auto">Set a monthly limit for a category and track exactly how much is left to spend.</div>
              </div>
              <button onClick={() => { setEditingBudgetCat("__add__"); setBudgetDraft(""); setAddCatNameDraft(""); setAddCatCustom(""); }}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-gold text-[14px] font-semibold">
                <Plus className="h-4 w-4" /> Create your first budget
              </button>
            </div>
          );
        }

        return (
          <div className="surface-card p-5 space-y-4">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12.5px] uppercase tracking-wider text-muted-foreground">{leftOfBudget >= 0 ? "Left to spend" : "Over budget"}</div>
                <div className={cn("text-[34px] font-display font-bold tabular leading-none mt-1.5", leftOfBudget >= 0 ? "text-foreground" : "text-negative")}>
                  {leftOfBudget < 0 && "-"}{fmtUSD(Math.abs(leftOfBudget))}
                </div>
                <div className="text-[13px] text-muted-foreground mt-1.5">{fmtUSD(spentOfBudget)} spent of {fmtUSD(totalAllocated)}</div>
              </div>
              {isCurrentMonth && daysLeft > 0 && leftOfBudget > 0 && (
                <div className="text-right shrink-0">
                  <div className="text-[12px] uppercase tracking-wider text-muted-foreground">Daily · {daysLeft}d left</div>
                  <div className="text-[19px] font-display font-bold tabular text-foreground mt-1">{fmtUSD(dailyLeft)}</div>
                </div>
              )}
            </div>

            {/* Progress with a "where you should be" pace marker */}
            <div>
              <div className="relative h-3 rounded-full bg-border/30 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{
                  width: `${Math.min(usedPct, 100)}%`,
                  backgroundColor: usedPct >= 100 ? "hsl(var(--negative))" : aheadOfPace ? "hsl(var(--warning))" : "hsl(var(--positive))",
                }} />
                {isCurrentMonth && monthPct < 100 && (
                  <div className="absolute top-0 bottom-0 w-0.5 bg-foreground/60" style={{ left: `${monthPct}%` }} title="Today's pace" />
                )}
              </div>
              <div className="flex justify-between items-center text-[12.5px] mt-2">
                <span className="text-muted-foreground">{Math.round(usedPct)}% of budget used</span>
                {isCurrentMonth
                  ? <span className={cn("font-medium", aheadOfPace ? "text-warning" : "text-positive")}>{aheadOfPace ? "Spending ahead of pace" : "On track"}</span>
                  : <span className="text-muted-foreground">{allBudgetedCats.length} categories</span>}
              </div>
            </div>

            {overCount > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-negative/8 border border-negative/20 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-negative shrink-0" />
                <span className="text-[13px] text-foreground">{overCount} categor{overCount > 1 ? "ies" : "y"} over by <span className="font-semibold text-negative">{fmtUSD(totalOverage)}</span></span>
              </div>
            )}

            {compact && (
              <button onClick={() => { setEditingBudgetCat("__add__"); setBudgetDraft(""); setAddCatNameDraft(""); setAddCatCustom(""); }}
                className="w-full h-8 rounded-lg border border-dashed border-border/60 text-[12.5px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors inline-flex items-center justify-center gap-1.5">
                <Plus className="h-3.5 w-3.5" /> New budget
              </button>
            )}
          </div>
        );
      })()}

      {/* Cover overages — pick a funding account for each over-budget category,
          restricted to everyday accounts (never long-term savings). */}
      {overCategories.length > 0 && (() => {
        return (
        <div className="surface-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/20">
            <span className="text-[13px] font-semibold text-foreground">Cover overages</span>
            <span className="text-[12px] text-muted-foreground ml-2">Pick where to move the shortfall from</span>
          </div>
          <div className="divide-y divide-border/10">
            {overCategories.map(c => {
              const over = c.total - (budgets[c.category] ?? 0);
              const Icon = categoryIcon(c.category);
              const color = catColor(c.category);
              const predictedId = settings.overageFundingPrefs[c.category];
              // Prefer this session's pick; otherwise predict from what covered this category last time.
              const chosenId = fundAllocations[c.category] ?? predictedId ?? "";
              const chosen = fundingAccounts.find(a => a.account_id === chosenId);
              const transferId = `pt_${c.category}_${budgetMonthKey}`;
              const confirmed = settings.plannedTransfers.find(p => p.id === transferId && !p.done);
              const isPredicted = !fundAllocations[c.category] && !!predictedId && chosenId === predictedId;
              return (
                <div key={c.category} className="px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-lg grid place-items-center shrink-0" style={{ backgroundColor: `${color}20`, color }}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-[13px] font-medium text-foreground flex-1 truncate">{formatCat(c.category)}</span>
                    <span className="text-[13px] font-semibold tabular text-negative">{fmtUSD(over)} over</span>
                  </div>
                  {fundingAccounts.length === 0 ? (
                    <div className="ml-9 text-[12px] text-muted-foreground">
                      No eligible account. Tag a checking account below in Organize accounts.
                    </div>
                  ) : (
                    <div className="ml-9 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <select value={chosenId} onChange={e => setFundAllocations(p => ({ ...p, [c.category]: e.target.value }))}
                          className="h-8 flex-1 rounded-lg bg-secondary/40 border border-border/40 text-[12.5px] text-foreground px-2 outline-none focus:border-[hsl(var(--primary)/0.5)]">
                          <option value="">Cover from…</option>
                          {fundingAccounts.map(a => (
                            <option key={a.account_id} value={a.account_id}>{a.name ?? a.official_name} ({fmtUSDCompact(Number(a.current_balance) || 0)})</option>
                          ))}
                        </select>
                        {chosen && !confirmed && (
                          <button onClick={() => {
                              S.confirmOverageFunding({ category: c.category, month: budgetMonthKey, amount: over, fromAccountId: chosen.account_id, fromAccountName: chosen.name ?? chosen.official_name ?? "Account" });
                            }}
                            className="h-8 px-3 rounded-lg bg-gold text-[12px] font-semibold shrink-0 whitespace-nowrap">
                            Suggest transfer
                          </button>
                        )}
                      </div>
                      {isPredicted && !confirmed && (
                        <div className="text-[11.5px] text-muted-foreground">Predicted from last time. Change above if you'd rather use a different account.</div>
                      )}
                      {confirmed && (
                        <div className="flex items-center gap-1.5 text-[12px] text-positive">
                          <Check className="h-3 w-3" /> Added to Home as a suggested transfer.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="px-4 py-2.5 border-t border-border/15 text-[11.5px] text-muted-foreground">
            These are suggestions, transfers must be made manually in your bank or app.
          </div>
        </div>
        );
      })()}

      {/* ── Add-budget form (opens from header or empty state) ── */}
      {editingBudgetCat === "__add__" && (
        <div className="surface-card p-4 space-y-2.5 border border-[hsl(var(--primary)/0.3)]">
          <div className="text-[13px] font-semibold text-foreground">New budget</div>
          {/* Tap-to-select category grid */}
          <div className="flex flex-wrap gap-1.5">
            {unbudgetedCats.map(cc => {
              const col = catColor(cc.category);
              const Ic  = categoryIcon(cc.category);
              return (
                <button key={cc.category} onClick={() => setAddCatNameDraft(cc.category)}
                  className={cn("flex items-center gap-1.5 h-8 px-2.5 rounded-full border text-[11.5px] font-medium transition-all",
                    addCatNameDraft === cc.category
                      ? "border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary))] text-primary-foreground"
                      : "border-border/40 text-foreground hover:border-foreground/30")}>
                  <Ic className="h-3 w-3 shrink-0" style={{ color: col }} />
                  {formatCat(cc.category)}
                </button>
              );
            })}
            <button onClick={() => setAddCatNameDraft("__custom__")}
              className={cn("h-8 px-2.5 rounded-full border text-[11.5px] font-medium transition-all",
                addCatNameDraft === "__custom__" ? "border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary))] text-primary-foreground" : "border-dashed border-border/40 text-muted-foreground hover:text-foreground")}>
              + Custom
            </button>
          </div>
          {addCatNameDraft === "__custom__" && (
            <input value={addCatCustom} onChange={e => setAddCatCustom(e.target.value)} placeholder="Category name"
              className="w-full h-10 px-3 rounded-lg bg-surface/60 border border-border/60 text-[13.5px] text-foreground outline-none focus:border-foreground/40" />
          )}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">$</span>
              <input type="number" min={0} step={10} value={budgetDraft} onChange={e => setBudgetDraft(e.target.value)} placeholder="Monthly amount"
                className="w-full h-10 pl-7 pr-3 rounded-lg bg-surface/60 border border-border/60 text-[13.5px] text-foreground outline-none focus:border-[hsl(var(--primary)/0.4)]" />
            </div>
            <button onClick={() => {
              const cat = addCatNameDraft === "__custom__" ? addCatCustom.trim() : addCatNameDraft;
              const amt = parseFloat(budgetDraft);
              if (!cat || isNaN(amt) || amt <= 0) return;
              setBudget(cat, amt); setEditingBudgetCat(null); setBudgetDraft(""); setAddCatNameDraft(""); setAddCatCustom("");
            }} className="h-10 px-4 rounded-lg bg-gold text-[13.5px] font-semibold shrink-0">Save</button>
            <button onClick={() => { setEditingBudgetCat(null); setBudgetDraft(""); setAddCatNameDraft(""); }}
              className="h-10 px-3 rounded-lg border border-border-strong text-[13.5px] text-muted-foreground shrink-0">Cancel</button>
          </div>
        </div>
      )}

      {/* Category-level budgets now live inline in the Spending "By category" list
          (click a category there to edit its budget or filter transactions) —
          this sidebar stays a lean summary instead of repeating that list. */}
      {!compact && allBudgetedCats.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[13px] font-semibold text-foreground">Categories</span>
            {editingBudgetCat !== "__add__" && (
              <button onClick={() => { setEditingBudgetCat("__add__"); setBudgetDraft(""); setAddCatNameDraft(""); setAddCatCustom(""); }}
                className="text-[13px] text-[hsl(var(--primary))] font-medium inline-flex items-center gap-1 hover:opacity-80">
                <Plus className="h-3.5 w-3.5" /> Add budget
              </button>
            )}
          </div>
          {allBudgetedCats.map(c => {
            const Icon = categoryIcon(c.category);
            const color = catColor(c.category);
            const budget = budgets[c.category] ?? 0;
            const actual = c.total;
            const over = actual > budget;
            const remaining = budget - actual;
            const pct = budget > 0 ? Math.min((actual / budget) * 100, 100) : 0;
            const isEditing = editingBudgetCat === c.category;
            const barColor = over ? "hsl(var(--negative))" : pct >= 85 ? "hsl(var(--warning))" : color;
            return (
              <div key={c.category} className="surface-card p-4">
                {isEditing ? (
                  <form className="flex items-center gap-2"
                    onSubmit={e => { e.preventDefault(); const n = parseFloat(budgetDraft); if (!isNaN(n) && n >= 0) setBudget(c.category, n); setEditingBudgetCat(null); setBudgetDraft(""); }}>
                    <div className="h-8 w-8 rounded-lg grid place-items-center shrink-0" style={{ backgroundColor: `${color}20`, color }}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-[14px] font-medium text-foreground flex-1 truncate">{formatCat(c.category)}</span>
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12.5px] text-muted-foreground">$</span>
                      <input autoFocus type="number" min={0} step={10} value={budgetDraft}
                        onChange={e => setBudgetDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === "Escape") { setEditingBudgetCat(null); setBudgetDraft(""); } }}
                        className="w-24 h-8 pl-5 pr-1 rounded-md bg-surface/60 border border-[hsl(var(--primary)/0.4)] text-[13px] outline-none" />
                    </div>
                    <button type="submit" className="h-8 px-3 rounded-md bg-gold text-[12.5px] font-semibold">Save</button>
                    <button type="button" onClick={() => { removeBudget(c.category); setEditingBudgetCat(null); }}
                      aria-label={`Remove ${formatCat(c.category)} budget`}
                      className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-negative hover:bg-negative/10"><Trash2 className="h-3.5 w-3.5" /></button>
                  </form>
                ) : (
                  <>
                    <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => setBudgetCatPopup(c.category)}>
                      <div className="h-8 w-8 rounded-lg grid place-items-center shrink-0" style={{ backgroundColor: `${color}20`, color }}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[14px] font-semibold text-foreground truncate">{formatCat(c.category)}</span>
                          {over && <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-negative/15 text-negative shrink-0">OVER</span>}
                        </div>
                        <div className="text-[12.5px] text-muted-foreground">{c.count} transaction{c.count !== 1 ? "s" : ""}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={cn("text-[15px] font-display font-bold tabular leading-none", over ? "text-negative" : "text-foreground")}>
                          {over ? `${fmtUSD(-remaining)} over` : `${fmtUSD(remaining)} left`}
                        </div>
                        <div className="text-[12.5px] text-muted-foreground tabular mt-1">{fmtUSD(actual)} / {fmtUSD(budget)}</div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setEditingBudgetCat(c.category); setBudgetDraft(String(budget)); }}
                        aria-label={`Edit ${formatCat(c.category)} budget`}
                        className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-border/30 shrink-0">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="h-2 rounded-full bg-border/30 overflow-hidden mt-2.5">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Unbudgeted spending (quick-add chips) — full page only; in the sidebar
          each unbudgeted category already shows an inline "+ Budget" link in
          the Spending "By category" list. ── */}
      {!compact && unbudgetedCats.length > 0 && (
        <div className="surface-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[13px] font-semibold text-foreground">Not budgeted yet</span>
            <span className="text-[12px] text-muted-foreground">{fmtUSD(unbudgetedCats.reduce((s, c) => s + c.total, 0))} untracked</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {unbudgetedCats.slice(0, 12).map(c => {
              const Icon = categoryIcon(c.category);
              const color = catColor(c.category);
              return (
                <button key={c.category} onClick={() => { setEditingBudgetCat(c.category); setBudgetDraft(String(Math.ceil(c.total / 10) * 10)); }}
                  className="inline-flex items-center gap-1.5 h-8 pl-2 pr-2.5 rounded-full border border-border/60 hover:border-[hsl(var(--primary)/0.4)] hover:bg-surface-hover/40 transition-colors">
                  <span className="h-5 w-5 rounded-md grid place-items-center shrink-0" style={{ backgroundColor: `${color}20`, color }}>
                    <Icon className="h-3 w-3" />
                  </span>
                  <span className="text-[13px] text-foreground">{formatCat(c.category)}</span>
                  <span className="text-[12.5px] text-muted-foreground tabular">{fmtUSD(c.total)}</span>
                  <Plus className="h-3 w-3 text-[hsl(var(--primary))]" />
                </button>
              );
            })}
          </div>
          {/* Inline editor when a chip is chosen */}
          {unbudgetedCats.some(c => editingBudgetCat === c.category) && (() => {
            const cat = editingBudgetCat!;
            return (
              <form className="flex items-center gap-2 mt-3 pt-3 border-t border-border/20"
                onSubmit={e => { e.preventDefault(); const n = parseFloat(budgetDraft); if (!isNaN(n) && n >= 0) setBudget(cat, n); setEditingBudgetCat(null); setBudgetDraft(""); }}>
                <span className="text-[13px] font-medium text-foreground">{formatCat(cat)}</span>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12.5px] text-muted-foreground">$</span>
                  <input autoFocus type="number" min={0} step={10} value={budgetDraft} onChange={e => setBudgetDraft(e.target.value)}
                    className="w-24 h-8 pl-5 rounded-md bg-surface/60 border border-[hsl(var(--primary)/0.4)] text-[13px] outline-none" />
                </div>
                <button type="submit" className="h-8 px-3 rounded-md bg-gold text-[12.5px] font-semibold">Set budget</button>
                <button type="button" onClick={() => { setEditingBudgetCat(null); setBudgetDraft(""); }}
                  className="h-8 px-2.5 rounded-md border border-border-strong text-[12.5px] text-muted-foreground">Cancel</button>
              </form>
            );
          })()}
        </div>
      )}

    </div>

        {/* Budget category txn popup */}
    {budgetCatPopup && (() => {
      const catTxns = budgetTxns.filter(t => (getEffectiveCategory(t,overrides,getRuleCategory)??"Other") === budgetCatPopup).sort((a,b)=>b.date.localeCompare(a.date));
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
                <div className="text-[12.5px] text-muted-foreground mt-0.5">
                  {fmtUSD(catTotal)} spent
                  {catBudget > 0 && <span className={cn("ml-1.5 font-medium", over?"text-negative":"text-positive")}>
                    {over ? `(${fmtUSD(catTotal-catBudget)} over)` : `(${fmtUSD(catBudget-catTotal)} left of ${fmtUSD(catBudget)})`}
                  </span>}
                </div>
              </div>
              {catBudget > 0 && (
                <div className="shrink-0 text-right">
                  <div className="text-[12.5px] text-muted-foreground">Budget</div>
                  <div className="text-[14px] font-semibold tabular text-foreground">{fmtUSD(catBudget)}</div>
                </div>
              )}
            </div>
            {/* Txn list */}
            <div className="flex-1 overflow-y-auto divide-y divide-border/10">
              {catTxns.length === 0 ? (
                <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">No transactions this period.</div>
              ) : catTxns.map(t => {
                const acc = accounts.find(a=>a.account_id===t.account_id);
                return (
                  <button key={t.id} onClick={()=>{ setBudgetCatPopup(null); openDetail(t); }}
                    className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-surface-hover/30 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-medium text-foreground truncate">{nameOverrides[t.id] ?? t.merchant_name ?? t.name}</div>
                      <div className="text-[12px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                        <span>{fmtShortDate(t.date)}</span>
                        {acc && <><span>·</span><span className="truncate max-w-[100px]">{acc.name}</span></>}
                        {t.pending && <span className="text-warning font-medium">· Pending</span>}
                      </div>
                    </div>
                    <span className="text-[15px] font-semibold tabular text-foreground shrink-0">{fmtUSD(Number(t.amount))}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0"/>
                  </button>
                );
              })}
            </div>
            {/* Footer */}
            <div className="px-5 py-3 border-t border-border/20 flex items-center justify-between shrink-0">
              <span className="text-[12.5px] text-muted-foreground">{catTxns.length} transaction{catTxns.length!==1?"s":""}</span>
              <button onClick={()=>{ setBudgetCatPopup(null); setEditingBudgetCat(budgetCatPopup); setBudgetDraft(String(catBudget||"")); }}
                className="text-[13px] text-[hsl(var(--primary))] font-medium flex items-center gap-1">
                <Pencil className="h-3 w-3"/> Edit budget
              </button>
            </div>
          </DialogContent>
        </Dialog>
      );
    })()}
    </>
    );
  };

  if (view==="spending") {
    return (
      <>
        <SpendingBudgetView
          txns={txns}
          accounts={accounts}
          budgets={budgets}
          nameOverrides={nameOverrides}
          setBudget={setBudget}
          removeBudget={removeBudget}
          getEffectiveCategory={t => getEffectiveCategory(t, overrides, getRuleCategory) ?? "Other"}
          isIncomeCategory={(cat, amount) => isIncomeCategory(cat, customCategories, amount)}
          formatCat={formatCat}
          catColor={catColor}
          onOpenDetail={(t, info) => { setDetailTxn(t); setDetailTxnOpenCat(false); setDetailTxnRecurring(info?.recurringFrequency); }}
          internalTxnIds={internalTxnIds}
          initialSearch={txnSearch}
          categoryIcon={categoryIcon}
          expenseCategories={EXPENSE_CATEGORIES_PICKER}
          incomeCategories={INCOME_CATEGORIES_PICKER}
          ignoredCategories={IGNORED_CATEGORIES}
          customCategories={customCategories}
          onSelectCategory={(t, cat) => {
            setOverride(t.id, cat);
            clearConflictingTypeOverride(t as unknown as PTxn);
            // Manually re-categorizing a transaction is an explicit signal
            // that it isn't part of whatever recurring pattern it was
            // previously attached to — drop it from any recurring group it
            // belongs to and record an explicit "not recurring" override so
            // Budget's recurring-expense tracking doesn't keep counting it
            // under the old assignment.
            const inGroup = settings.recurringGroups.find(g => g.txnIds.includes(t.id));
            if (inGroup) S.removeTxnFromRecurringGroup(inGroup.id, t.id);
            S.setRecurringOverride(t.id, false);
          }}
          onAddCategory={addCategory}
          onRemoveCategory={removeCategory}
          onRenameCategory={renameCategory}
          txnTags={settings.txnTags}
          onAddTag={(id, tag) => S.addTxnTag(id, tag)}
          onOpenRules={() => setShowRulesManager(true)}
          onOpenImport={() => setShowImportModal(true)}
          headerActions={headerActions}
          isCategoryEdited={t => overrides[t.id] != null}
          classOf={classOf}
          onSetTxnType={(demo || guestDemo) ? undefined : setTxnType}
        />
        <ImportStatementModal
          open={showImportModal}
          onClose={() => setShowImportModal(false)}
          accounts={accounts.map(a => {
            const raw = a as unknown as Record<string, unknown>;
            return { account_id: a.account_id, item_id: raw.item_id as string | undefined, name: a.name, official_name: a.official_name, mask: a.mask };
          })}
          userId={user?.id ?? ""}
          onAddTag={(id, tag) => S.addTxnTag(id, tag)}
          onImported={refreshTxns}
        />
        {showRulesManager && (
          <RulesManager
            rules={rules}
            nameRules={nameRules}
            allTxns={txns}
            onRemoveCatRule={removeRule}
            onToggleCatRule={toggleRule}
            onUpdateCatRule={updateRule}
            onAddCatRule={addRule}
            onSaveNameRule={saveNameRule}
            onRemoveNameRule={removeNameRule}
            onClose={() => setShowRulesManager(false)}
            smartRules={smartRules}
            evalTxns={evalTxns}
            accounts={accounts}
            categoryOptions={[...ALL_CATEGORIES, ...customCategories.map(cx => cx.name)]}
            onAddSmartRule={addSmartRule}
            onUpdateSmartRule={updateSmartRule}
            onRemoveSmartRule={removeSmartRule}
            onToggleSmartRule={toggleSmartRule}
          />
        )}
        {detailTxn && <TxnDetailModal txn={detailTxn} recurringFrequency={detailTxnRecurring} overrides={overrides} getRuleCategory={getRuleCategory} nameOverride={nameOverrides[detailTxn.id]} nameRules={nameRules} customCategories={customCategories} allTxns={txns} initialCatOpen={detailTxnOpenCat} onClose={()=>{setDetailTxn(null);setDetailTxnOpenCat(false);setDetailTxnRecurring(undefined);}} onSaveNameOverride={setNameOverride} onBulkRename={bulkSetNameOverride} onSaveNameRule={saveNameRule} onAddCategory={addCategory} onAddRule={addRule} onRemoveCustom={removeCategory} onRenameCategory={renameCategory} onSelect={(id,cat)=>{setOverride(id,cat); if (detailTxn) clearConflictingTypeOverride(detailTxn);}} onToggleInternal={toggleManualInternal} isManualInternal={manualInternalIds.has(detailTxn.id)} isAutoInternal={autoInternalIds.has(detailTxn.id)} isManualExternal={manualExternalIds.has(detailTxn.id)} classification={classOf(detailTxn)} hasTypeOverride={!!(detailTxn.transaction_id && typeOverridesByPlaidId[detailTxn.transaction_id])} onSetTxnType={(tp)=>setTxnType(detailTxn, tp)} possibleDuplicate={possibleDupIds.has(detailTxn.id)} accounts={accounts} items={items} onFindSimilar={(pattern) => { setTxnSearch(pattern); onViewChange?.("spending"); }}
        tags={settings.txnTags[detailTxn.id] ?? []}
        onAddTag={(id,tag)=>S.addTxnTag(id,tag)}
        onRemoveTag={(id,tag)=>S.removeTxnTag(id,tag)}
        note={settings.txnNotes[detailTxn.id] ?? ""}
        onSaveNote={(id,n)=>S.setTxnNote(id,n)}
        isRecurringOverride={settings.recurringOverrides[detailTxn.id]}
        onSetRecurringOverride={(id,val)=>S.setRecurringOverride(id,val)}
        onClearRecurringOverride={(id)=>S.clearRecurringOverride(id)}
        splits={settings.txnSplits[detailTxn.id] ?? []}
        onSaveSplits={(id,sp)=>S.setTxnSplits(id,sp)}
        />}
      </>
    );
  }

  if (view==="myfinances") {
    return (
      <>
      <MyFinancialPicture
        txns={txns}
        accounts={accounts}
        getEffectiveCategory={t => getEffectiveCategory(t as unknown as PTxn, overrides, getRuleCategory) ?? "Other"}
        formatCat={formatCat}
        catColor={catColor}
        classOf={classOf}
        manualIncome={manualIncome}
        onOpenTxnDetail={t => { setDetailTxn(t as unknown as PTxn); setDetailTxnOpenCat(false); }}
        budgets={budgets}
        cardAutopayFrom={settings.cardAutopayFrom}
        savingsGoals={settings.savingsGoals}
        financialPicture={settings.financialPicture}
        onUpdate={S.update}
        demo={demo || guestDemo}
        banks={bankHist}
        dismissedInsights={settings.dismissedInsights}
      />
      {detailTxn && <TxnDetailModal txn={detailTxn} overrides={overrides} getRuleCategory={getRuleCategory} nameOverride={nameOverrides[detailTxn.id]} nameRules={nameRules} customCategories={customCategories} allTxns={txns} initialCatOpen={detailTxnOpenCat} onClose={()=>{setDetailTxn(null);setDetailTxnOpenCat(false);}} onSaveNameOverride={setNameOverride} onBulkRename={bulkSetNameOverride} onSaveNameRule={saveNameRule} onAddCategory={addCategory} onAddRule={addRule} onRemoveCustom={removeCategory} onRenameCategory={renameCategory} onSelect={(id,cat)=>{setOverride(id,cat); if (detailTxn) clearConflictingTypeOverride(detailTxn);}} onToggleInternal={toggleManualInternal} isManualInternal={manualInternalIds.has(detailTxn.id)} isAutoInternal={autoInternalIds.has(detailTxn.id)} isManualExternal={manualExternalIds.has(detailTxn.id)} classification={classOf(detailTxn)} hasTypeOverride={!!(detailTxn.transaction_id && typeOverridesByPlaidId[detailTxn.transaction_id])} onSetTxnType={(tp)=>setTxnType(detailTxn, tp)} possibleDuplicate={possibleDupIds.has(detailTxn.id)} accounts={accounts} items={items} onFindSimilar={(pattern) => { setTxnSearch(pattern); onViewChange?.("spending"); }}
        tags={settings.txnTags[detailTxn.id] ?? []}
        onAddTag={(id,tag)=>S.addTxnTag(id,tag)}
        onRemoveTag={(id,tag)=>S.removeTxnTag(id,tag)}
        note={settings.txnNotes[detailTxn.id] ?? ""}
        onSaveNote={(id,n)=>S.setTxnNote(id,n)}
        isRecurringOverride={settings.recurringOverrides[detailTxn.id]}
        onSetRecurringOverride={(id,val)=>S.setRecurringOverride(id,val)}
        onClearRecurringOverride={(id)=>S.clearRecurringOverride(id)}
        splits={settings.txnSplits[detailTxn.id] ?? []}
        onSaveSplits={(id,sp)=>S.setTxnSplits(id,sp)}
        />}
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
    // Same definitions as Home/Spending/Budget (src/lib/classify).
    const mmSummary = summarizeFlow(filterByPeriod(txns, moneyMapPeriod) as ClassifierTxn[], classOfC, catOfTxn);

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
    const unassignedBalance = sumBal(unassignedAccts.filter(x => !isDebt(x.acc.type)));

    // ── True Available: income this period minus planned expenses minus committed
    //    savings transfers, period. Buffer/reserve balances never enter this number
    //    at all -- they're informational, shown separately. ──
    const incomeThisPeriod = mmSummary.income;
    const expensesThisPeriod = mmSummary.spending;
    const totalBudgeted = Object.values(budgets).reduce((s, b) => s + b, 0);
    const trueAvailable = spendingBalance; // current real balance in spending-role accounts is the ground truth
    const projectedRemaining = incomeThisPeriod - expensesThisPeriod; // this period's net flow so far

    // ── Spend-by-category this period, for overspend detection ──
    // Budgets apply to spend categories only.
    const catTotals: Record<string, number> = {};
    for (const t of periodTxns) {
      const c = classOf(t);
      if (!c || (c.type !== "spend" && c.type !== "refund")) continue;
      const cat = getEffectiveCategory(t, overrides, getRuleCategory) ?? "Other";
      catTotals[cat] = (catTotals[cat] || 0) + Number(t.amount);
    }

    // ── Suggestion 1: overspend — let the user pick the funding account. Never
    // auto-suggest or auto-match a reserve/long-term-savings account; those stay
    // untouched. Eligible = everyday accounts (spending/buffer/unassigned). ──
    type Suggestion = { id: string; kind: "overage" | "upcoming"; title: string; detail: string; amount: number; category?: string };
    const suggestions: Suggestion[] = [];
    const fundingAccounts = accountsWithRole.filter(x =>
      x.info.role !== "reserve" && x.info.role !== "savings_goal" && x.info.role !== "investment" && x.info.role !== "debt"
    );

    for (const [cat, spent] of Object.entries(catTotals)) {
      const budget = budgets[cat];
      if (!budget || spent <= budget) continue;
      const over = spent - budget;
      const id = `overage:${cat}:${periodKey}`;
      suggestions.push({
        id, kind: "overage", category: cat,
        title: `${formatCat(cat)} is ${fmtUSD(over)} over budget`,
        detail: fundingAccounts.length > 0
          ? `Pick an account below to cover the ${fmtUSD(over)} overage. Long-term savings accounts aren't offered, so they stay untouched.`
          : `No everyday account to cover this from yet. Tag a checking account in Organize accounts below.`,
        amount: over,
      });
    }

    // ── Suggestion 2: upcoming expenses, reusing the existing recurring-charge detector ──
    // Actually check the spending balance instead of telling the user to check it themselves:
    // sum every near-term charge due on-or-before each one (they draw from the same pool),
    // and say plainly whether the balance covers it or falls short by how much.
    const upcomingAll = detectRecurring(txns, internalTxnIds, suppressRecurringMerchants, suppressRecurringCategories)
      .filter(r => {
        const daysOut = Math.round((r.predictedDate.getTime() - Date.now()) / 86400000);
        return daysOut >= 0 && daysOut <= 21;
      })
      .sort((a, b) => a.predictedDate.getTime() - b.predictedDate.getTime());
    // Only surface these as suggestions when they're actually at risk — "you have
    // enough money" isn't actionable and shouldn't take up space in the list. The
    // running total still accounts for every upcoming charge (covered or not) so
    // later at-risk checks are correct.
    let runningCommitted = 0;
    for (const r of upcomingAll.slice(0, 6)) {
      const id = `upcoming:${r.merchant}:${r.predictedDate.toISOString().slice(0,10)}`;
      const daysOut = Math.round((r.predictedDate.getTime() - Date.now()) / 86400000);
      runningCommitted += r.avgAmount;
      const projectedBalance = spendingBalance - runningCommitted;
      const atRisk = projectedBalance < 0;
      if (!atRisk) continue;
      const whenText = daysOut === 0 ? "today" : daysOut === 1 ? "tomorrow" : `in ${daysOut} days`;
      suggestions.push({
        id, kind: "upcoming",
        title: `${r.merchant}: ~${fmtUSD(r.avgAmount)} expected ${whenText}`,
        detail: `At risk: your spending balance (${fmtUSD(spendingBalance)}) won't cover this plus other bills due by then. Short by ${fmtUSD(Math.abs(projectedBalance))}, move money in before ${r.predictedDate.toLocaleDateString("en-US",{month:"short",day:"numeric"})}.`,
        amount: r.avgAmount,
      });
    }

    // ── Suggestion 3: autopay / credit-card payment risk ──
    // Find transactions that look like credit-card or bill payments
    const PAYMENT_RE = /\bpayment\b|autopay|bill\s*pay|online\s*payment|e-?pay/i;
    const paymentTxns = txns.filter(t => {
      if (Number(t.amount) <= 0) return false; // positive = debit from source account
      const c = classOf(t);
      // Card payments and bills/loans only — never savings sweeps or other
      // transfers between the user's own accounts.
      if (c?.type === "credit_card_payment" || c?.type === "obligation_loan" || c?.type === "obligation_bill") return true;
      if (c && bucketOf(c.type) !== "spending") return false;
      return PAYMENT_RE.test(t.merchant_name ?? t.name ?? "") ||
        (t.category?.[0] ?? "").toLowerCase().includes("credit card");
    });
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
      <div className="space-y-3 animate-fade-up">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[18px] text-foreground">Money Map</h2>
        </div>

        {/* ── The headline number ── */}
        <div className="surface-card p-5">
          <div className="text-[12.5px] text-muted-foreground uppercase tracking-wide">In hand right now</div>
          <div className="font-display text-4xl tabular text-foreground mt-1">{fmtUSD(trueAvailable)}</div>
          <div className="text-[12.5px] text-muted-foreground mt-1.5">
            Sum of accounts tagged <span className="text-foreground font-medium">Everyday Expenses</span> only. Emergency fund, savings, and investments are excluded.
          </div>
          <div className={cn("text-[13px] mt-2 tabular font-medium", projectedRemaining >= 0 ? "text-positive" : "text-negative")}>
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
            // Accounts without a role used to vanish from these tiles, so the
            // Money Map totals didn't reconcile with Home's account groups.
            ...(unassignedAccts.length > 0 ? [{ label: "Unassigned", value: unassignedBalance, icon: Info, color: "hsl(var(--muted-foreground))", count: unassignedAccts.length }] : []),
          ].map(b => (
            <div key={b.label} className="surface-card p-3.5">
              <div className="flex items-center gap-1.5">
                <b.icon className="h-3.5 w-3.5" style={{ color: b.color }} />
                <span className="text-[12px] text-muted-foreground uppercase tracking-wide">{b.label}</span>
              </div>
              <div className="font-display text-lg tabular text-foreground mt-1">{fmtUSD(b.value)}</div>
              <div className="text-[12px] text-muted-foreground mt-0.5">{b.count} account{b.count !== 1 ? "s" : ""}</div>
            </div>
          ))}
        </div>

        {/* ── Suggestions ── */}
        <div className="surface-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border/30 flex items-center gap-2">
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="font-display text-[14px] text-primary">Suggestions</h3>
            <span className="text-[12px] text-muted-foreground ml-auto">{visibleSuggestions.length} active</span>
          </div>
          {visibleSuggestions.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
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
                    <div className="text-[13.5px] text-foreground font-medium">{s.title}</div>
                    <div className="text-[12.5px] text-muted-foreground mt-0.5">{s.detail}</div>
                    {s.kind === "overage" && s.category && fundingAccounts.length > 0 && (() => {
                      const chosenId = fundAllocations[s.category];
                      const chosen = fundingAccounts.find(x => x.acc.account_id === chosenId);
                      return (
                        <div className="flex items-center gap-2 mt-2">
                          <select value={chosenId ?? ""} onChange={e => setFundAllocations(p => ({ ...p, [s.category!]: e.target.value }))}
                            className="h-8 flex-1 max-w-[240px] rounded-lg bg-secondary/40 border border-border/40 text-[12.5px] text-foreground px-2 outline-none focus:border-[hsl(var(--primary)/0.5)]">
                            <option value="">Cover from…</option>
                            {fundingAccounts.map(x => (
                              <option key={x.acc.account_id} value={x.acc.account_id}>{x.acc.name ?? x.acc.official_name} ({fmtUSDCompact(Number(x.acc.current_balance) || 0)})</option>
                            ))}
                          </select>
                          {chosen && (
                            <span className="text-[12px] text-muted-foreground truncate">
                              Move {fmtUSD(s.amount)} from {chosen.acc.name ?? chosen.acc.official_name}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                    <div className="flex items-center gap-2 mt-2">
                      <button onClick={() => recordFeedback(s.id, "accepted")}
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-positive/10 text-positive text-[12px] font-medium hover:bg-positive/20 transition-colors">
                        <ThumbsUp className="h-3 w-3" /> Got it
                      </button>
                      <button onClick={() => recordFeedback(s.id, "dismissed")}
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-border-strong text-muted-foreground text-[12px] hover:text-foreground transition-colors">
                        <ThumbsDown className="h-3 w-3" /> Not now
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Organize accounts ── */}
        <div className="surface-card px-5 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-foreground">Account roles</div>
            <div className="text-[12px] text-muted-foreground mt-0.5">
              {unassignedAccts.length > 0
                ? `${unassignedAccts.length} account${unassignedAccts.length > 1 ? "s need" : " needs"} a role`
                : `All ${accountsWithRole.length} accounts tagged`}
            </div>
          </div>
          <button onClick={() => setShowOrganize(true)}
            className={cn("h-8 px-3 rounded-full text-[12px] font-semibold shrink-0 inline-flex items-center gap-1.5",
              unassignedAccts.length > 0 ? "bg-gold" : "border border-border text-muted-foreground hover:text-foreground")}>
            <Wallet className="h-3 w-3" />
            {unassignedAccts.length > 0 ? `Tag ${unassignedAccts.length}` : "Edit roles"}
          </button>
        </div>

        {showOrganize && (
          <Dialog open onOpenChange={o => { if (!o) setShowOrganize(false); }}>
            <DialogContent className="max-w-lg surface-elevated border-border p-0 gap-0 max-h-[90dvh] flex flex-col">
              <DialogTitle className="sr-only">Account roles</DialogTitle>
              <DialogDescription className="sr-only">Assign each account a role for Money Map.</DialogDescription>

              {/* Header */}
              <div className="px-5 pt-5 pb-4 border-b border-border/20 shrink-0">
                <div className="font-display text-[16px] text-foreground">Account roles</div>
                <div className="text-[12.5px] text-muted-foreground mt-1">
                  Tag each account so Money Map knows how to group them.
                </div>
              </div>

              {/* Role legend */}
              <div className="px-5 py-3 border-b border-border/10 shrink-0">
                <div className="flex flex-wrap gap-1.5">
                  {ROLE_OPTIONS.map(({ role, icon: Icon }) => (
                    <div key={role} className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
                      <Icon className="h-2.5 w-2.5" />
                      <span>{ROLE_META[role].short}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Accounts list */}
              <div className="flex-1 overflow-y-auto min-h-0">
                {bucketOrder
                  .map(bucket => ({ bucket, list: accountsWithRole.filter(x => mapBucket(x.acc.type, x.acc.subtype) === bucket) }))
                  .filter(g => g.list.length > 0)
                  .map(({ bucket, list }) => (
                    <div key={bucket}>
                      <div className="px-5 py-2.5 sticky top-0 bg-[hsl(var(--surface-elevated))] border-b border-border/10 z-10">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{bucketMeta[bucket].label}</span>
                      </div>
                      <div className="divide-y divide-border/10">
                        {list.map(({ acc }) => {
                          const bal = Number(acc.current_balance) || 0;
                          const isDebtAcc = isDebt(acc.type);
                          const Icon = mapIcon(acc.type, acc.subtype);
                          return (
                            <div key={acc.account_id} className="px-5 py-4 space-y-3">
                              {/* Account info row */}
                              <div className="flex items-center gap-3">
                                <div className="h-9 w-9 rounded-xl bg-muted/40 grid place-items-center shrink-0">
                                  <Icon className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[13px] font-semibold text-foreground truncate">{acc.name ?? acc.official_name}</div>
                                  {acc.mask && <div className="text-[11px] text-muted-foreground">···· {acc.mask}</div>}
                                </div>
                                <div className={cn("text-[14px] tabular font-semibold shrink-0", isDebtAcc ? "text-negative" : "text-foreground")}>
                                  {isDebtAcc ? "−" : ""}{fmtUSDCompact(Math.abs(bal))}
                                </div>
                              </div>
                              {/* Role chips */}
                              <RoleBadgeSelect
                                accountId={acc.account_id}
                                accType={acc.type}
                                accSubtype={acc.subtype}
                                getRole={getRole}
                                setRole={setRole}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>

              <div className="p-4 border-t border-border/20 shrink-0">
                <button onClick={() => setShowOrganize(false)}
                  className="w-full h-11 rounded-xl bg-foreground text-background text-[14px] font-semibold">
                  Done
                </button>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* ── Acted-on suggestions, collapsed reference ── */}
        {actedSuggestions.length > 0 && (
          <div className="text-[12px] text-muted-foreground text-center">
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
    // New AI-powered benefits view — see CardBenefitsView component below
    return <CardBenefitsView accounts={accounts} supabase={supabase} user={user} txns={txns} />;
  }

  // Should be unreachable now — view is constrained to overall/monthly/spending/benefits
  // by the time it reaches here (admin and giftcards are excluded upstream in Index.tsx).
  return null;
};
