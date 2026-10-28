import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtUSD, fmtTxnAmount, txnAmountClass } from "@/lib/format";
import { useCountUp } from "@/hooks/useCountUp";
import { SpendingOverview, FlagChip, PendingChip, type OverviewMerchant, type OverviewMovement, type MovementKey } from "@/components/finance/spending/SpendingOverview";
import type { Classification, ClassifierTxn, TxnType } from "@/lib/classify/index.ts";
import { classifyTxn, countsAsSpend, categoryCountsAsSpend, type TxnClass, TXN_TYPES, txnTypeOption, detectTxnFlags, dailyTotals, cumulative, projectMonthEnd, normalizeMerchant, fmtShortDate, fmtDayHeading, withAlpha, vivid, type TxnFlag } from "@/lib/spending-insights";
import { useFloatingMenu } from "@/components/finance/spending/useFloatingMenu";
import { localISODate, localISOMonth, todayISO, addDaysISO, daysBetweenISO } from "@/lib/dates";
import { isNonBillRecurringCandidate, classifyRecurrenceFrequency } from "@/lib/recurring";
import {
  ChevronLeft, ChevronRight, Search, ArrowUpDown, ArrowUp, ArrowDown, RefreshCw, TrendingUp, TrendingDown,
  X, Landmark, Columns3, Check, Layers, Maximize2, Wallet, Pencil, Trash2, Plus, ChevronDown,
  Settings, ChevronsDownUp, ChevronsUpDown, Wand2, Upload, Filter, MoreHorizontal,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PTxn { id:string; account_id:string; item_id:string|null; transaction_id:string|null; amount:number|string; date:string; name:string|null; merchant_name:string|null; category:string[]|null; pending:boolean; [k:string]:any; }
interface PAccount { id:string; account_id:string; name:string|null; official_name:string|null; mask:string|null; type:string|null; subtype:string|null; current_balance:number|null; [k:string]:any; }

export interface SpendingBudgetViewProps {
  txns:PTxn[]; accounts:PAccount[]; budgets:Record<string,number>;
  nameOverrides:Record<string,string>; setBudget:(c:string,n:number)=>void;
  removeBudget?:(c:string)=>void;
  getEffectiveCategory:(t:PTxn)=>string; formatCat:(s:string)=>string;
  catColor:(s:string)=>string;
  // Opens the transaction detail modal; `recurringFrequency` is the cadence
  // this list shows for the row, so the modal can display the same label.
  onOpenDetail:(t:PTxn, info?:{ recurringFrequency: string|null })=>void; internalTxnIds:Set<string>;
  initialSearch?:string;
  // Classifies a transaction as income/expense by its assigned category
  // (falling back to the amount's sign only for unclassified categories) so
  // a refund into an expense category doesn't get counted as income.
  isIncomeCategory:(cat:string, amount:number)=>boolean;
  // Category picker (Expenses/Income/Ignored grouped popover shown from the
  // transaction table's Category cell; also reused inside the txn detail modal).
  categoryIcon:(cat:string)=>React.ElementType;
  expenseCategories:string[]; incomeCategories:string[]; ignoredCategories:string[];
  customCategories:{name:string; type:"income"|"expense"}[];
  onSelectCategory:(t:PTxn, cat:string)=>void;
  onAddCategory:(name:string, type:"income"|"expense")=>void;
  onRemoveCategory?:(name:string)=>void;
  // Custom categories only; renaming a built-in would silently break its
  // auto-categorization since Plaid-category mapping matches on the literal
  // string.
  onRenameCategory?:(oldName:string, newName:string)=>void;
  // Tags; used by the Tags filter; empty object is fine if the caller hasn't
  // wired tagging yet.
  txnTags:Record<string,string[]>;
  onAddTag?:(id:string, tag:string)=>void;
  // Opens the Transaction Rules manager (Smart/Category/Name rules); the
  // toolbar's only entry point into a feature that otherwise has no way to
  // be viewed or run once created.
  onOpenRules?:()=>void;
  // Opens the "Import statement" modal; a PDF-upload entry point living in
  // this same toolbar since that's where transactions are already browsed.
  onOpenImport?:()=>void;
  // Optional right-side header controls (notifications, profile...) so the
  // Spending header row matches Home's.
  headerActions?: React.ReactNode;
  // True when the user has manually re-categorized/re-typed this
  // transaction (drives the small "Edited" indicator).
  isCategoryEdited?: (t:PTxn)=>boolean;
  /** Shared-classifier result for a transaction (src/lib/classify, computed once by the dashboard). */
  classOf?: (t:{ id: string })=>Classification|undefined;
  /** Persist a per-transaction type override ("Counts as"); null clears it. */
  onSetTxnType?: (t:PTxn, type:TxnType|null)=>void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fc2 =(n:number) => { const v=Math.abs(n); if(v>=1000) return "$"+(v/1000).toFixed(v>=10000?0:1).replace(/\.0$/,"")+"k"; return "$"+v.toFixed(v%1<0.005?0:2).replace(/\B(?=(\d{3})+(?!\d))/g,","); };
// One date format family across the page: "Oct 18" in cells, "Sun, Oct 18"
// in day headings (relative "Today"/"Yesterday" mixed with absolute dates
// read inconsistently and truncated in narrow columns).
const rDate = (s:string) => fmtDayHeading(s);
const isoDay = (s:string) => Number(s.slice(8,10));

// ── Transaction table columns; toggleable via the "Columns" picker.
// "Description" (avatar + vendor name) is always shown and isn't in this
// list since it's the row's primary identity, not an optional attribute.
// Order here (date, amount, statement, category, then status/account) mirrors
// the priority the columns should read in left-to-right after the vendor name.
type ColKey = "date" | "amount" | "statement" | "category" | "status" | "account";
type SortKey = "name" | ColKey;
const COLUMN_DEFS: { key: ColKey; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "amount", label: "Amount" },
  { key: "statement", label: "Statement Desc." },
  { key: "category", label: "Category" },
  { key: "status", label: "Status" },
  { key: "account", label: "Account" },
];
// "statement" (the raw, unedited bank-statement text) is on by default
// alongside the always-required date/amount/category; status/account stay
// available via the Columns picker but aren't forced on.
const DEFAULT_COLS: ColKey[] = ["date", "amount", "statement", "category", "status", "account"];
const COLS_STORAGE_KEY = "sentryfi_spending_txn_columns";

// Human label for every sortable key (COLUMN_DEFS + the always-on "name"/Description column).
const SORT_LABELS: Record<SortKey, string> = {
  name: "Description", date: "Date", amount: "Amount", statement: "Statement Desc.", category: "Category", status: "Status", account: "Account",
};

// ── Resizable column widths, persisted across sessions. These are used as
// proportional weights on a table-layout:fixed table whose own width is
// pinned to 100% of its container; dragging a handle changes a column's
// share of that fixed width (and shrinks its neighbors), so the table can
// never grow wider than the view and trigger horizontal scroll. ───────────
type WidthKey = "name" | ColKey;
// Description gets the largest share since vendor names are the thing people
// actually need to read; date/status are short fixed-format values and get
// the least. Statement/category/account can still run long, so their cells
// wrap to two lines instead of being squeezed and ellipsized.
const DEFAULT_COL_WIDTHS: Record<WidthKey, number> = {
  name: 260, date: 84, amount: 100, statement: 200, category: 160, status: 84, account: 112,
};
const COL_WIDTHS_STORAGE_KEY = "sentryfi_spending_txn_col_widths";
const MIN_COL_WIDTH = 60;
// The Vendor column has no fixed width; it takes whatever the attribute
// columns leave, but never less than this. When the container is too
// narrow for every enabled column, the lowest-priority ones are hidden
// (in this order) instead of the table overflowing and getting clipped.
const SELECT_COL_WIDTH = 32;
const VENDOR_MIN_WIDTH = 200;
const COL_DROP_ORDER: ColKey[] = ["statement", "account", "status", "category", "date", "amount"];

// Category names that are really a fixed obligation (mortgage, a loan, rent)
// rather than everyday discretionary spend; the left-hand Categories panel
// shows these as simply "Met" once the period's payment has posted, instead
// of a dollar figure that invites comparing it to a "budget" the way a
// grocery or dining category would be.
const OBLIGATION_LIKE_CATS = new Set(["Mortgage", "Rent", "Auto Loan", "Student Loan", "Loan", "Loan Payment"]);

// ── Recurring-charge detection (Burn runway / Upcoming charges below) is for
// genuine bills only; the category exclusions and cadence windows live in
// src/lib/recurring/spending-cadence.ts so the transaction detail modal uses the exact same
// rules and never disagrees with the list. ─────────────────────────────────

// ── The Categories panel's three tabs; mirrors the app's own
// expenseCategories/incomeCategories/ignoredCategories taxonomy so a category
// always lives in exactly one of them, the same way it's grouped in the
// category picker elsewhere in the app. ───────────────────────────────────
const CAT_TABS: { key: "income"|"expenses"|"ignored"; label: string; title: string }[] = [
  { key: "income", label: "Income", title: "Money you received" },
  { key: "expenses", label: "Expenses", title: "Money you spent" },
  { key: "ignored", label: "Ignored", title: "Transfers and payments excluded from spend and income" },
];

// ── Group-by options for the transaction table ──────────────────────────────
type GroupKey = "none" | "account" | "date" | "category" | "status";
const GROUP_OPTIONS: { key: GroupKey; label: string }[] = [
  { key: "none", label: "No grouping" },
  { key: "date", label: "Day" },
  { key: "account", label: "Account" },
  { key: "category", label: "Category" },
  { key: "status", label: "Status" },
];

// ── Account-type grouping for the Accounts filter dropdown — same buckets
// the Accounts tab itself groups by, so "Credit Cards" here means the same
// thing it does there. Lets the dropdown offer a one-click "every credit
// card" selection instead of making the user tick each card individually. ──
type AcctGroupKey = "checking" | "savings" | "credit" | "loan" | "investment" | "other";
const ACCOUNT_GROUP_ORDER: AcctGroupKey[] = ["checking", "savings", "credit", "loan", "investment", "other"];
const ACCOUNT_GROUP_LABEL: Record<AcctGroupKey, string> = {
  checking: "Checking", savings: "Savings & HSA", credit: "Credit Cards", loan: "Loans", investment: "Investments", other: "Other",
};
function accountGroupKey(a: { type: string | null; subtype: string | null }): AcctGroupKey {
  const type = (a.type ?? "").toLowerCase();
  const sub = (a.subtype ?? "").toLowerCase();
  if (type === "credit") return "credit";
  if (type === "loan") return "loan";
  if (type === "investment") return "investment";
  if (sub === "checking") return "checking";
  if (sub === "savings" || sub.includes("money market") || sub === "hsa" || sub === "cd") return "savings";
  return "other";
}


function monthBucketsList(count: number) {
  const now = new Date();
  const out: { key:string; label:string; start:string; end:string; year:number; monthIdx:number }[] = [];
  for (let i = count-1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const end = new Date(d.getFullYear(), d.getMonth()+1, 0);
    out.push({
      key: localISOMonth(d),
      label: d.toLocaleDateString("en-US",{month:"short"}),
      start: localISODate(d),
      end: localISODate(end),
      year: d.getFullYear(), monthIdx: d.getMonth(),
    });
  }
  return out;
}

const DAY_COUNT = 14;
const WEEK_COUNT = 12;
const YEAR_COUNT = 6;

function dayBucketsList(count: number) {
  const now = new Date(); now.setHours(0,0,0,0);
  const out: { key:string; label:string; start:string; end:string; year:number }[] = [];
  for (let i = count-1; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate()-i);
    const iso = localISODate(d);
    out.push({
      key: iso,
      label: d.toLocaleDateString("en-US",{day:"numeric"}),
      start: iso, end: iso,
      year: d.getFullYear(),
    });
  }
  return out;
}

function weekBucketsList(count: number) {
  const now = new Date(); now.setHours(0,0,0,0);
  const dow = now.getDay();
  const diffToMonday = dow===0 ? -6 : 1-dow;
  const thisMonday = new Date(now); thisMonday.setDate(now.getDate()+diffToMonday);
  const out: { key:string; label:string; start:string; end:string; year:number }[] = [];
  for (let i = count-1; i >= 0; i--) {
    const monday = new Date(thisMonday); monday.setDate(thisMonday.getDate()-i*7);
    const sunday = new Date(monday); sunday.setDate(monday.getDate()+6);
    out.push({
      key: localISODate(monday),
      label: monday.toLocaleDateString("en-US",{month:"short",day:"numeric"}),
      start: localISODate(monday),
      end: localISODate(sunday),
      year: monday.getFullYear(),
    });
  }
  return out;
}

function yearBucketsList(count: number) {
  const now = new Date();
  const out: { key:string; label:string; start:string; end:string; year:number }[] = [];
  for (let i = count-1; i >= 0; i--) {
    const y = now.getFullYear()-i;
    out.push({ key:`${y}`, label:`${y}`, start:`${y}-01-01`, end:`${y}-12-31`, year:y });
  }
  return out;
}

// Shared bar-scrubber used by the month/week/year granularities in the header;
// bars are bolder gold when selected so the active period reads clearly at a glance.
function PeriodBars({ buckets, totals, selIdx, onSelect, maxWidth }: {
  buckets: { key:string; label:string }[]; totals:number[]; selIdx:number; onSelect:(i:number)=>void; maxWidth?:number;
}) {
  const maxV = Math.max(...totals, 1);
  return (
    <div className="flex items-end gap-1 h-8" style={maxWidth ? {maxWidth} : undefined}>
      {buckets.map((b,i) => {
        const spend = totals[i] ?? 0;
        const pct = Math.max((spend/maxV)*100, spend>0?8:3);
        const isSel = i === selIdx;
        const isLast = i === buckets.length-1;
        return (
          <button key={b.key} onClick={() => onSelect(i)}
            title={`${b.label}: ${fmtUSD(spend)}`}
            className="flex-1 min-w-0 flex flex-col items-center gap-0.5 group">
            <div className="w-full flex items-end" style={{height:20}}>
              <div className={cn("w-full rounded-sm transition-all duration-300",
                isSel ? "bg-gold" : isLast ? "bg-[hsl(var(--primary)/0.55)]" : "bg-[hsl(var(--primary)/0.25)] group-hover:bg-[hsl(var(--primary)/0.45)]")}
                style={{height:`${pct}%`}}/>
            </div>
            <span className={cn("text-[11px] font-medium truncate w-full text-center", isSel?"text-[hsl(var(--primary))] font-bold":"text-muted-foreground/60")}>{b.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

// Feature flag: the "Burn runway" chart is temporarily hidden per product
// request. Its computed data/state is left in place (harmless if unused)
// so it's a one-line flip to bring back.
const SHOW_BURN_RUNWAY = false;
// The left-hand Categories sidebar is superseded by the overview's "Where it
// went" card plus the category pill row above the table; kept behind a flag
// like the burn runway so it's a one-line flip to bring back.
const SHOW_CATEGORY_SIDEBAR = false;

export function SpendingBudgetView({txns,accounts,budgets,nameOverrides,setBudget,removeBudget,getEffectiveCategory,formatCat,catColor,onOpenDetail,internalTxnIds,initialSearch,isIncomeCategory,categoryIcon,expenseCategories,incomeCategories,ignoredCategories,customCategories,onSelectCategory,onAddCategory,onRemoveCategory,onRenameCategory,txnTags,onAddTag,onOpenRules,onOpenImport,headerActions,isCategoryEdited,classOf,onSetTxnType}:SpendingBudgetViewProps) {

  const monthBuckets = useMemo(() => monthBucketsList(12), []);
  const lastIdx = monthBuckets.length - 1;
  const [monthOffset, setMonthOffset] = useState(0); // 0 = current month, -1 = last month, ... -11
  const selIdx = lastIdx + monthOffset;
  const isCurrentMonth = monthOffset === 0;
  const sel = monthBuckets[selIdx];
  const prevSel = monthBuckets[selIdx-1];

  // Header bar-scrubbers for the day/week/year granularities, mirroring the
  // month scrubber above (one bar per bucket, click to select).
  const dayBuckets = useMemo(() => dayBucketsList(DAY_COUNT), []);
  const weekBuckets = useMemo(() => weekBucketsList(WEEK_COUNT), []);
  const yearBuckets = useMemo(() => yearBucketsList(YEAR_COUNT), []);

  // ── Granularity toggle (day/week/month/year); each granularity keeps its
  // own independent offset so switching back and forth doesn't lose your place. ──
  // Defaults to "month" (current month) on landing; "All" is still one tap
  // away in the tab row for anyone who wants to see everything at once,
  // including older imported history.
  const [granularity, setGranularity] = useState<"all"|"day"|"week"|"month"|"year">("month");
  const [dayOffset, setDayOffset] = useState(0);
  const [weekOffset, setWeekOffset] = useState(0);
  const [yearOffset, setYearOffset] = useState(0);
  const granularityOffset = granularity==="day" ? dayOffset : granularity==="week" ? weekOffset : granularity==="year" ? yearOffset : 0;
  // Day/week/year offsets are all clamped to their bar-scrubber's window
  // (14 days / 12 weeks / 6 years) so every granularity behaves the same way:
  // click a bar to select it, nothing to walk past what's visible.
  const stepPeriod = (dir: 1|-1) => {
    if (granularity==="day") setDayOffset(o=>Math.max(Math.min(o+dir,0), -(DAY_COUNT-1)));
    else if (granularity==="week") setWeekOffset(o=>Math.max(Math.min(o+dir,0), -(WEEK_COUNT-1)));
    else if (granularity==="year") setYearOffset(o=>Math.max(Math.min(o+dir,0), -(YEAR_COUNT-1)));
  };
  const selDayIdx = DAY_COUNT - 1 + dayOffset;
  const selWeekIdx = WEEK_COUNT - 1 + weekOffset;
  const selYearIdx = YEAR_COUNT - 1 + yearOffset;
  const resetPeriod = () => {
    if (granularity==="day") setDayOffset(0);
    else if (granularity==="week") setWeekOffset(0);
    else if (granularity==="year") setYearOffset(0);
  };

  // The actual date range driving transactions/categories/totals below; month
  // mode reuses the existing 12-month-scrubber machinery above; the other
  // granularities compute a simple rolling window relative to today.
  const activeRange = useMemo(() => {
    const base = new Date(); base.setHours(0,0,0,0);
    if (granularity==="all") {
      return { start: "0000-01-01", end: localISODate(base), isCurrent: true, label: "All time" };
    }
    if (granularity==="day") {
      const d = new Date(base); d.setDate(d.getDate()+dayOffset);
      const iso = localISODate(d);
      return { start: iso, end: iso, isCurrent: dayOffset===0,
        label: d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"}) };
    }
    if (granularity==="week") {
      const dow = base.getDay();
      const diffToMonday = dow===0 ? -6 : 1-dow;
      const monday = new Date(base); monday.setDate(base.getDate()+diffToMonday+weekOffset*7);
      const sunday = new Date(monday); sunday.setDate(monday.getDate()+6);
      return { start: localISODate(monday), end: localISODate(sunday), isCurrent: weekOffset===0,
        label: `${monday.toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${sunday.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}` };
    }
    if (granularity==="year") {
      const y = base.getFullYear()+yearOffset;
      return { start: `${y}-01-01`, end: `${y}-12-31`, isCurrent: yearOffset===0, label: `${y}` };
    }
    return { start: sel.start, end: sel.end, isCurrent: isCurrentMonth,
      label: isCurrentMonth ? "This month" : new Date(sel.year, sel.monthIdx, 1).toLocaleDateString("en-US",{month:"long",year:"numeric"}) };
  }, [granularity, dayOffset, weekOffset, yearOffset, sel, isCurrentMonth]);

  const [catSel, setCatSel] = useState<string|null>(null);
  // Which category universe the Categories panel/feed is browsing; one of
  // the app's three main category buckets (matches expenseCategories/
  // incomeCategories/ignoredCategories). A tab switches the whole panel
  // between them; it never mixes them. Switching resets catSel so a
  // category picked in one universe can't silently carry over and filter
  // another to empty.
  const [catTab, setCatTabRaw] = useState<"income"|"expenses"|"ignored">("expenses");
  const setCatTab = (next: "income"|"expenses"|"ignored") => { setCatTabRaw(next); setCatSel(null); };
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const clearSelection = () => setSelectedIds(new Set());
  const bulkMenu = useFloatingMenu(256);
  const [bulkTagDraft, setBulkTagDraft] = useState("");
  const [showBulkTagInput, setShowBulkTagInput] = useState(false);
  const [budgetDialogOpen, setBudgetDialogOpen] = useState(false);
  // Category name currently shown in the details/rename dialog; separate
  // from catSel (which drives the transaction-feed filter) so opening details
  // never disturbs whatever filter is already active.
  const [detailsCat, setDetailsCat] = useState<string | null>(null);
  // Text search is committed on Enter rather than filtering live on every
  // keystroke, and more than one term can be active at once (each shown as
  // its own removable chip); a transaction has to match every committed
  // term to stay visible, so each addition narrows further.
  const [searchDraft, setSearchDraft] = useState(initialSearch ?? "");
  const [searchTerms, setSearchTerms] = useState<string[]>(initialSearch ? [initialSearch] : []);
  // Search filters as you type (debounced); Enter still pins the current
  // text as a removable chip so several terms can be combined.
  const [liveSearch, setLiveSearch] = useState((initialSearch ?? "").trim());
  useEffect(() => {
    const id = window.setTimeout(() => setLiveSearch(searchDraft.trim()), 200);
    return () => window.clearTimeout(id);
  }, [searchDraft]);
  const activeSearchTerms = useMemo(() => {
    const live = liveSearch.trim();
    return live && !searchTerms.some(t => t.toLowerCase() === live.toLowerCase()) ? [...searchTerms, live] : searchTerms;
  }, [searchTerms, liveSearch]);
  // Mobile-only layout state; the period/spend-pulse card and burn-runway
  // chart are collapsed behind a toggle below `md` so the transaction list
  // itself is what fills the screen; the mobile search field is likewise a
  // slide-down reveal instead of permanent toolbar space.
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const commitSearchDraft = () => {
    const q = searchDraft.trim();
    if (!q) return;
    setSearchTerms(prev => prev.includes(q) ? prev : [...prev, q]);
    setSearchDraft("");
  };
  const removeSearchTerm = (term: string) => setSearchTerms(prev => prev.filter(t => t !== term));
  const [sortDesc, setSortDesc] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>("date");
  const handleSort = (key: SortKey) => {
    if (sortBy === key) { setSortDesc(d => !d); return; }
    setSortBy(key);
    setSortDesc(key === "date" || key === "amount" || key === "status"); // dates/amounts start newest/largest first; text columns start A→Z
  };
  const [accountFilters, setAccountFilters] = useState<string[]>([]);
  const toggleAccountFilter = (id: string) => setAccountFilters(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const accountsMenu = useFloatingMenu(260);
  const [amountMode, setAmountMode] = useState<"range"|"fixed">("range");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [fixedAmount, setFixedAmount] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all"|"in"|"out">("all");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [ignoredFilter, setIgnoredFilter] = useState<"no"|"yes">("no");
  const [dateMode, setDateMode] = useState<"none"|"range"|"lastN"|"year">("none");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [lastNDays, setLastNDays] = useState("30");
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()));
  const filtersMenu = useFloatingMenu(320);
  const sortMenu = useFloatingMenu(192);
  // "Ignored" is really just a friendlier, filter-bar-visible way to switch
  // the Categories panel to its Ignored tab; kept as one source of truth
  // (catTab) rather than a second, potentially-contradictory piece of state.
  useEffect(() => { setIgnoredFilter(catTab === "ignored" ? "yes" : "no"); }, [catTab]);
  const toggleIgnoredFilter = (val: "no"|"yes") => setCatTab(val === "yes" ? "ignored" : "expenses");

  // ── Visible transaction-table columns, persisted across sessions ──────────
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(() => {
    try {
      const saved = localStorage.getItem(COLS_STORAGE_KEY);
      if (saved) return new Set(JSON.parse(saved) as ColKey[]);
    } catch { /* ignore malformed/blocked storage */ }
    return new Set(DEFAULT_COLS);
  });
  useEffect(() => {
    try { localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify([...visibleCols])); } catch { /* ignore */ }
  }, [visibleCols]);
  const colsMenu = useFloatingMenu(192);
  const moreMenu = useFloatingMenu(224);
  const toggleCol = (k: ColKey) => setVisibleCols(prev => {
    const n = new Set(prev);
    if (n.has(k)) { if (n.size > 1) n.delete(k); } // always leave at least one attribute column visible
    else n.add(k);
    return n;
  });

  // ── Resizable column widths, persisted across sessions. Dragging a handle
  // updates one column's weight; because the table below is table-layout:fixed
  // with a 100%-width container, the browser rescales every column's share of
  // that fixed width automatically; there's no way for the total to exceed
  // the view, so the table never needs a horizontal scrollbar. ──────────────
  const [colWidths, setColWidths] = useState<Record<WidthKey, number>>(() => {
    try {
      const saved = localStorage.getItem(COL_WIDTHS_STORAGE_KEY);
      if (saved) return { ...DEFAULT_COL_WIDTHS, ...JSON.parse(saved) };
    } catch { /* ignore malformed/blocked storage */ }
    return DEFAULT_COL_WIDTHS;
  });
  useEffect(() => {
    try { localStorage.setItem(COL_WIDTHS_STORAGE_KEY, JSON.stringify(colWidths)); } catch { /* ignore */ }
  }, [colWidths]);
  // Height of the (sticky, phones only) list toolbar, so the mobile date
  // headings can stick directly underneath it.
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarH, setToolbarH] = useState(0);
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setToolbarH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Fit the desktop table to its container (see COL_DROP_ORDER). ────────
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [tableWrapWidth, setTableWrapWidth] = useState(0);
  useEffect(() => {
    const el = tableWrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(entries => setTableWrapWidth(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const tableCols = useMemo(() => {
    const cols = new Set(visibleCols);
    if (!tableWrapWidth) return cols;
    const used = () => [...cols].reduce((s, k) => s + (colWidths[k] ?? DEFAULT_COL_WIDTHS[k]), 0);
    for (const k of COL_DROP_ORDER) {
      if (SELECT_COL_WIDTH + VENDOR_MIN_WIDTH + used() <= tableWrapWidth) break;
      if (cols.size > 1) cols.delete(k);
    }
    return cols;
  }, [visibleCols, colWidths, tableWrapWidth]);
  const fitRef = useRef({ tableCols, tableWrapWidth, colWidths });
  fitRef.current = { tableCols, tableWrapWidth, colWidths };

  const resizingCol = useRef<{ key: WidthKey; startX: number; startWidth: number } | null>(null);
  const startColResize = (key: WidthKey) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    resizingCol.current = { key, startX: e.clientX, startWidth: colWidths[key] };
    const onMove = (ev: PointerEvent) => {
      if (!resizingCol.current) return;
      const { key: k, startX, startWidth } = resizingCol.current;
      // Never let a drag widen a column past what still leaves the Vendor
      // column its minimum width, so resizing can't push the table into
      // overflow (or auto-hide a neighbouring column).
      const { tableCols: tc, tableWrapWidth: ww, colWidths: cw } = fitRef.current;
      const others = [...tc].filter(c => c !== k).reduce((s, c) => s + cw[c], 0);
      const cap = ww ? Math.max(MIN_COL_WIDTH, ww - SELECT_COL_WIDTH - VENDOR_MIN_WIDTH - others) : Infinity;
      const next = Math.min(cap, Math.max(MIN_COL_WIDTH, Math.round(startWidth + (ev.clientX - startX))));
      setColWidths(w => ({ ...w, [k]: next }));
    };
    const onUp = () => {
      resizingCol.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ── Group-by, persisted across sessions like column visibility ────────────
  const [groupBy, setGroupBy] = useState<GroupKey>(() => {
    try {
      const saved = localStorage.getItem("sentryfi_spending_txn_groupby");
      // Guard against a stale value from before "month" grouping was removed.
      if (saved && GROUP_OPTIONS.some(g => g.key === saved)) return saved as GroupKey;
    } catch { /* ignore */ }
    return "none";
  });
  useEffect(() => {
    try { localStorage.setItem("sentryfi_spending_txn_groupby", groupBy); } catch { /* ignore */ }
  }, [groupBy]);
  const groupMenu = useFloatingMenu(176);
  const [scrubDay, setScrubDay] = useState<number|null>(null);
  const [hoveredDot, setHoveredDot] = useState<string|null>(null);
  // Tooltip content is portaled to document.body and positioned from the
  // dot's real screen coordinates; the chart cards use overflow-hidden (to
  // clip the swipeable carousel's off-screen panel), which was cutting the
  // old in-flow tooltips off at the card edge.
  const [dotTooltip, setDotTooltip] = useState<{x:number;y:number;above:boolean;content:React.ReactNode}|null>(null);
  const showDotTooltip = (key:string, e: React.MouseEvent, content: React.ReactNode) => {
    setHoveredDot(key);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDotTooltip({ x: r.left + r.width/2, y: r.top, above: r.top > 90, content });
  };
  const hideDotTooltip = (key:string) => {
    setHoveredDot(h => h===key ? null : h);
    setDotTooltip(null);
  };
  const [runwayIdx, setRunwayIdx] = useState<0|1>(0);
  const runwayDragging = useRef(false);
  const runwayStartX = useRef(0);
  const [runwayDragX, setRunwayDragX] = useState(0);
  const runwayOnDown = (e: React.PointerEvent) => { runwayDragging.current = true; runwayStartX.current = e.clientX; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); };
  const runwayOnMove = (e: React.PointerEvent) => { if (!runwayDragging.current) return; setRunwayDragX(e.clientX - runwayStartX.current); };
  const runwayEndDrag = () => {
    if (!runwayDragging.current) return;
    runwayDragging.current = false;
    if (runwayDragX < -50) setRunwayIdx(1);
    else if (runwayDragX > 50) setRunwayIdx(0);
    setRunwayDragX(0);
  };
  const chartRef = useRef<HTMLDivElement>(null);

  // An externally-driven search (e.g. "Find similar" from the transaction
  // detail modal) commits immediately; it's a deliberate jump-to action, not
  // something that should also need an Enter press.
  useEffect(() => {
    if (initialSearch !== undefined) { setSearchDraft(initialSearch); setSearchTerms(initialSearch ? [initialSearch] : []); }
  }, [initialSearch]);

  // Whether a transaction counts toward spend; income never does, and
  // neither does a *confirmed* internal transfer (internalTxnIds, detected
  // by pairing a matching opposite-amount transaction on a different one of
  // the user's own accounts). Ignored categories (card payments, savings,
  // "Transfer Out"/"Transfer In" for P2P and unmatched transfers) are
  // filtered by the callers via ignoredCategories; the shared classifier
  // decides which category a transaction lands in.
  const isExpenseTxn = useCallback((t: PTxn) => {
    const cat = getEffectiveCategory(t) ?? "Other";
    return !isIncomeCategory(cat, Number(t.amount));
  }, [getEffectiveCategory, isIncomeCategory]);

  // Whether a transaction belongs in the browsable Spending list/category
  // chips at all. The only thing hidden from the normal view is a confirmed
  // internal transfer (excluded via internalTxnIds at each call site below);
  // everything else, including categories that are merely *named* like a
  // transfer ("Transfer Out", "Credit Card Payment"), is a normal, visible
  // category here once pairing hasn't confirmed it's actually internal.
  const isBrowsableTxn = useCallback((_t: PTxn) => true, []);

  // ── Transactions within the active range, narrowed to the active tab's
  // category universe (Income/Expenses/Ignored; matches the app's own
  // expenseCategories/incomeCategories/ignoredCategories taxonomy) and
  // optionally one specific category once the user picks one. A confirmed
  // internal transfer is already forced to the "Internal Transfer" category
  // upstream, so ignoredCategories.includes(cat) alone is enough to route it
  // into the Ignored tab; no separate internalTxnIds check is needed here.
  // Defined early since totals for the day/week/year granularities are derived
  // directly from this list rather than from the month-bucket machinery below. ──
  const periodTxns = useMemo(() => {
    return txns.filter(t => {
      if (t.date < activeRange.start || t.date > activeRange.end) return false;
      const cat = getEffectiveCategory(t) ?? "Other";
      const inTab = ignoredCategories.includes(cat)
        ? catTab === "ignored"
        : isIncomeCategory(cat, Number(t.amount))
          ? catTab === "income"
          : catTab === "expenses";
      if (!inTab) return false;
      return !catSel || cat === catSel;
    });
  }, [txns, activeRange, catSel, getEffectiveCategory, catTab, ignoredCategories, isIncomeCategory]);

  // Same as periodTxns but ignoring the category filter; used to build the
  // Categories list itself, so clicking a category doesn't make every other
  // category disappear from its own picker (periodTxns above is intentionally
  // narrowed to catSel for the transaction table/chips, not for this).
  const periodTxnsAllCats = useMemo(() => txns.filter(t =>
    t.date >= activeRange.start && t.date <= activeRange.end
  ), [txns, activeRange]);

  // ── Per-month, per-category totals across the whole 12-month window ──────
  const catMonthlyTotals = useMemo(() => {
    const out: Record<string, number[]> = {};
    for (const t of txns) {
      if (internalTxnIds.has(t.id)) continue;
      if (t.date < monthBuckets[0].start || t.date > monthBuckets[lastIdx].end) continue;
      if (!isExpenseTxn(t)) continue;
      const cat = getEffectiveCategory(t) ?? "Other";
      // Ignored categories (Credit Card Payment, Internal Transfer) are
      // neither real spend nor real income; they must never count toward
      // overallMonthly/budget pacing, same as a confirmed internal transfer.
      if (ignoredCategories.includes(cat)) continue;
      const bi = monthBuckets.findIndex(b => t.date >= b.start && t.date <= b.end);
      if (bi === -1) continue;
      if (!out[cat]) out[cat] = new Array(monthBuckets.length).fill(0);
      out[cat][bi] += Number(t.amount);
    }
    return out;
  }, [txns, internalTxnIds, monthBuckets, lastIdx, isExpenseTxn, getEffectiveCategory, ignoredCategories]);

  // Same per-month/per-category breakdown as catMonthlyTotals, but for income
  // categories; kept fully separate so income never leaks into overallMonthly
  // (Total Spent, budget pacing, "safe to spend"), only into the Categories
  // list below where it's shown as a normal, browsable category.
  const incomeCatMonthlyTotals = useMemo(() => {
    const out: Record<string, number[]> = {};
    for (const t of txns) {
      if (internalTxnIds.has(t.id)) continue;
      if (t.date < monthBuckets[0].start || t.date > monthBuckets[lastIdx].end) continue;
      const cat = getEffectiveCategory(t) ?? "Other";
      if (ignoredCategories.includes(cat)) continue;
      if (!isIncomeCategory(cat, Number(t.amount))) continue;
      // A confirmed internal transfer is already excluded above (and its
      // category forced to "Internal Transfer" upstream, which never matches
      // isIncomeCategory anyway). Money someone else sent ("Transfer In",
      // P2P) is ignored above, not income; the user can re-type it.
      const bi = monthBuckets.findIndex(b => t.date >= b.start && t.date <= b.end);
      if (bi === -1) continue;
      if (!out[cat]) out[cat] = new Array(monthBuckets.length).fill(0);
      out[cat][bi] -= Number(t.amount); // signed: a payroll reversal nets income down (shared definition)
    }
    return out;
  }, [txns, internalTxnIds, monthBuckets, lastIdx, isIncomeCategory, getEffectiveCategory, ignoredCategories]);

  const overallMonthly = useMemo(() => {
    const out = new Array(monthBuckets.length).fill(0);
    for (const arr of Object.values(catMonthlyTotals)) arr.forEach((v,i) => out[i]+=v);
    return out;
  }, [catMonthlyTotals, monthBuckets.length]);

  // Total spend per bucket for the day/week/year bar-scrubbers; simple totals
  // (no per-category breakdown needed, unlike the month buckets above).
  const overallDaily = useMemo(() => {
    const out = new Array(dayBuckets.length).fill(0);
    const byDate: Record<string, number> = {};
    for (const b of dayBuckets) byDate[b.start] = 0;
    for (const t of txns) {
      if (internalTxnIds.has(t.id) || !isExpenseTxn(t)) continue;
      if (ignoredCategories.includes(getEffectiveCategory(t) ?? "Other")) continue;
      if (t.date in byDate) byDate[t.date] += Number(t.amount);
    }
    dayBuckets.forEach((b,i) => out[i] = byDate[b.start]);
    return out;
  }, [txns, internalTxnIds, isExpenseTxn, dayBuckets, ignoredCategories, getEffectiveCategory]);

  const overallWeekly = useMemo(() => {
    const out = new Array(weekBuckets.length).fill(0);
    for (const t of txns) {
      if (internalTxnIds.has(t.id) || !isExpenseTxn(t)) continue;
      if (ignoredCategories.includes(getEffectiveCategory(t) ?? "Other")) continue;
      const bi = weekBuckets.findIndex(b => t.date >= b.start && t.date <= b.end);
      if (bi !== -1) out[bi] += Number(t.amount);
    }
    return out;
  }, [txns, internalTxnIds, isExpenseTxn, weekBuckets, ignoredCategories, getEffectiveCategory]);

  const overallYearly = useMemo(() => {
    const out = new Array(yearBuckets.length).fill(0);
    for (const t of txns) {
      if (internalTxnIds.has(t.id) || !isExpenseTxn(t)) continue;
      if (ignoredCategories.includes(getEffectiveCategory(t) ?? "Other")) continue;
      const bi = yearBuckets.findIndex(b => t.date >= b.start && t.date <= b.end);
      if (bi !== -1) out[bi] += Number(t.amount);
    }
    return out;
  }, [txns, internalTxnIds, isExpenseTxn, yearBuckets, ignoredCategories, getEffectiveCategory]);

  // Date-context labels shown above the day/month/week bars so it's clear
  // which calendar month/year(s) the visible bars belong to.
  const dayCtxLabel = (() => {
    const first = new Date(dayBuckets[0].start+"T00:00:00");
    const last = new Date(dayBuckets[dayBuckets.length-1].start+"T00:00:00");
    return first.getFullYear()===last.getFullYear() && first.getMonth()===last.getMonth()
      ? first.toLocaleDateString("en-US",{month:"long",year:"numeric"})
      : `${first.toLocaleDateString("en-US",{month:"short"})} – ${last.toLocaleDateString("en-US",{month:"short",year:"numeric"})}`;
  })();
  const monthYearLabel = monthBuckets[0].year === monthBuckets[lastIdx].year
    ? `${monthBuckets[0].year}` : `${monthBuckets[0].year}–${monthBuckets[lastIdx].year}`;
  const weekYearLabel = weekBuckets[0].year === weekBuckets[weekBuckets.length-1].year
    ? `${weekBuckets[0].year}` : `${weekBuckets[0].year}–${weekBuckets[weekBuckets.length-1].year}`;

  const monthTotalSpent = overallMonthly[selIdx] ?? 0;
  const prevTotalSpent = overallMonthly[selIdx-1] ?? 0;
  const momPct = granularity==="month" && prevTotalSpent > 0 ? Math.round(((monthTotalSpent - prevTotalSpent) / prevTotalSpent) * 100) : null;
  // "Total Spent" always means real spend; never income, never an ignored
  // category; regardless of which Categories tab is currently being browsed.
  // Built from periodTxnsAllCats (date-range only, tab-agnostic) rather than
  // periodTxns so that switching to the Income or Ignored tab can't zero out
  // or corrupt this headline figure; catSel still narrows it, but only while
  // browsing the Expenses tab, matching how picking a category has always
  // scoped this stat to just that category.
  const totalSpent = granularity==="month" ? monthTotalSpent : periodTxnsAllCats.filter(t => {
    const cat = getEffectiveCategory(t) ?? "Other";
    if (ignoredCategories.includes(cat) || isIncomeCategory(cat, Number(t.amount))) return false;
    if (catTab === "expenses" && catSel && cat !== catSel) return false;
    return true;
  }).reduce((s,t)=>s+Number(t.amount),0);

  // Total income for the active period (ignores the category filter; earnings
  // aren't spend-category-scoped; shown alongside Total Spent in the header's
  // right-hand summary for every granularity).
  const totalEarned = useMemo(() => {
    let total = 0;
    for (const t of txns) {
      if (internalTxnIds.has(t.id)) continue;
      if (t.date < activeRange.start || t.date > activeRange.end) continue;
      const cat = getEffectiveCategory(t) ?? "Other";
      if (isIncomeCategory(cat, Number(t.amount))) total -= Number(t.amount); // signed, matches Home
    }
    return total;
  }, [txns, internalTxnIds, activeRange, getEffectiveCategory, isIncomeCategory]);

  const totalBudget = Object.values(budgets).reduce((s,v) => s+v, 0);
  const now = new Date();
  const daysInSelMonth = new Date(sel.year, sel.monthIdx+1, 0).getDate();
  const dayOfMonth = isCurrentMonth ? now.getDate() : daysInSelMonth;
  const daysLeft = isCurrentMonth ? Math.max(daysInSelMonth - dayOfMonth, 0) : 0;
  const pacePct = (dayOfMonth / daysInSelMonth) * 100;
  // These are always month-budget pacing math; deliberately keyed off
  // monthTotalSpent (the real month-to-date total), not the granularity-
  // dependent `totalSpent` above, so "Safe to spend today" stays correct
  // no matter which day/week/year tab you're browsing transactions in.
  const spentPct = totalBudget > 0 ? (monthTotalSpent / totalBudget) * 100 : 0;
  const projectedSpend = dayOfMonth > 0 ? (monthTotalSpent / dayOfMonth) * daysInSelMonth : monthTotalSpent;
  const overProjected = totalBudget > 0 && projectedSpend > totalBudget;
  const PROJECTION_DAYS = 15;
  const safeToSpendToday = totalBudget > 0
    ? (daysLeft > 0 ? Math.max(totalBudget - monthTotalSpent, 0) / daysLeft : Math.max(totalBudget - monthTotalSpent, 0))
    : null;

  // ── Recurring charge (bill) detection, looking back 13 months so slower
  // cadences (quarterly, yearly) have enough history to actually show up, not
  // just monthly. Ignored categories (Credit Card Payment, Internal Transfer)
  // and discretionary categories (Food & Drink, Groceries, Shopping, Travel,
  // Entertainment) are excluded, see isNonBillRecurringCandidate above; this
  // only ever surfaces genuine bills, never a habit that happens to repeat.
  // Each result carries its actual classified cadence (Weekly/Biweekly/
  // Monthly/Quarterly/Yearly), never a bare "recurring" flag with no sense of
  // how often. ───────────────────────────────────────────────────────────────
  const recurring = useMemo(() => {
    const byMerchant: Record<string, { dates:string[]; amounts:number[]; cat:string; label:string; accountId:string }> = {};
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth()-13);
    const cutoffStr = localISODate(cutoff);
    for (const t of txns) {
      if (internalTxnIds.has(t.id)) continue;
      if (!isExpenseTxn(t)) continue;
      if (t.date < cutoffStr) continue;
      const cat = getEffectiveCategory(t) ?? "Other";
      if (ignoredCategories.includes(cat)) continue;
      const label = (nameOverrides[t.id] ?? t.merchant_name ?? t.name ?? "").trim();
      if (!label) continue;
      if (isNonBillRecurringCandidate(cat, label)) continue;
      const key = label.toLowerCase();
      if (!byMerchant[key]) byMerchant[key] = { dates:[], amounts:[], cat, label, accountId: t.account_id };
      byMerchant[key].dates.push(t.date);
      byMerchant[key].amounts.push(Number(t.amount));
      byMerchant[key].accountId = t.account_id; // keep the most recent occurrence's account
    }
    const out: { merchant:string; category:string; avgAmount:number; nextDate:string; intervalDays:number; frequency:string; accountId:string }[] = [];
    for (const d of Object.values(byMerchant)) {
      if (d.dates.length < 2) continue;
      const sorted = [...d.dates].sort();
      const gaps: number[] = [];
      for (let i=1;i<sorted.length;i++) gaps.push((new Date(sorted[i]+"T00:00:00").getTime()-new Date(sorted[i-1]+"T00:00:00").getTime())/86400000);
      const avgGap = gaps.reduce((s,v)=>s+v,0)/gaps.length;
      const freq = classifyRecurrenceFrequency(avgGap);
      if (!freq) continue; // not a recognizable cadence, just an irregular habit
      const lastDate = sorted[sorted.length-1];
      const nextDate = addDaysISO(lastDate, Math.round(avgGap));
      const avgAmount = d.amounts.reduce((s,v)=>s+v,0)/d.amounts.length;
      out.push({ merchant: d.label, category: d.cat, avgAmount, nextDate, intervalDays: Math.round(avgGap), frequency: freq, accountId: d.accountId });
    }
    return out.sort((a,b) => a.nextDate.localeCompare(b.nextDate));
  }, [txns, internalTxnIds, isExpenseTxn, nameOverrides, getEffectiveCategory, ignoredCategories]);

  const recurringMerchantKeys = useMemo(() => new Map(recurring.map(r => [r.merchant.toLowerCase(), r.frequency])), [recurring]);

  const todayStr = todayISO(now);
  const in30 = addDaysISO(todayStr, 30);
  const next30Recurring = recurring.filter(r => r.nextDate >= todayStr && r.nextDate <= in30);
  const committedNext30 = next30Recurring.reduce((s,r)=>s+r.avgAmount,0);

  // Walk the upcoming recurring charges in date order, per account, subtracting
  // each from that account's current balance so we can flag the first point
  // where a charge would overdraw the account; not just list amounts blind.
  const upcomingCharges = useMemo(() => {
    const running: Record<string, number> = {};
    for (const a of accounts) running[a.account_id] = Number(a.current_balance ?? 0);
    const items = recurring.filter(r => r.nextDate >= todayStr && r.nextDate <= in30);
    return items.map(r => {
      const acc = accounts.find(a => a.account_id === r.accountId);
      const balanceBefore = running[r.accountId] ?? null;
      let balanceAfter: number | null = null;
      if (balanceBefore !== null) {
        balanceAfter = balanceBefore - r.avgAmount;
        running[r.accountId] = balanceAfter;
      }
      return { ...r, accountName: acc?.name ?? "Unknown account", balanceAfter, insufficient: balanceAfter !== null && balanceAfter < 0 };
    });
  }, [recurring, accounts, todayStr, in30]);

  // ── Burn runway card 1: cumulative spend for the month selected in the
  // 12-month scrubber above (day 1 through the last day of that month,
  // 28/29/30/31 depending on the month), with a marker on every day that
  // actually had a transaction. ─────────────────────────────────────────────
  const rolling30 = useMemo(() => {
    const days: { day:number; date:string; cum:number; txns:{merchant:string;amount:number}[] }[] = [];
    let cum = 0;
    for (let d = 1; d <= daysInSelMonth; d++) {
      const iso = `${sel.year}-${String(sel.monthIdx+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      const dayTxns = txns.filter(t => !internalTxnIds.has(t.id) && isExpenseTxn(t) && t.date === iso);
      cum += dayTxns.reduce((s,t)=>s+Number(t.amount),0);
      days.push({ day:d, date: iso, cum, txns: dayTxns.map(t => ({ merchant: nameOverrides[t.id] ?? t.merchant_name ?? t.name ?? "Unknown", amount: Number(t.amount) })) });
    }
    return days;
  }, [txns, internalTxnIds, isExpenseTxn, sel, daysInSelMonth, nameOverrides]);

  // ── Burn runway card 2: projected cumulative spend over the next 15 days
  // from detected recurring charges, each dot dated and colored red if that
  // charge's account is projected to run short. ─────────────────────────────
  const future15 = useMemo(() => {
    const items = upcomingCharges.filter(r => {
      const days = daysBetweenISO(todayStr, r.nextDate);
      return days >= 0 && days <= PROJECTION_DAYS;
    });
    let cum = 0;
    return items.map(r => { cum += r.avgAmount; return { ...r, cum }; });
  }, [upcomingCharges, todayStr]);

  // ── Category rows for the active period, one list per Categories tab.
  // Month mode reuses the 12-month bucket data (so it keeps its
  // month-over-month % and sparkline); the other granularities aggregate
  // directly from periodTxnsAllCats since there's no pre-computed bucket data
  // for arbitrary days/weeks/years. Expenses and Income are built the same
  // way from their own bucket totals; Ignored has no meaningful
  // month-over-month/sparkline (it's a drill-in view, not the main spending
  // breakdown) so it's always a flat per-category total over the active range. ──
  const rowFor = useCallback(([cat,arr]: [string, number[]], idx: number) => {
    const spend = arr[idx] ?? 0;
    const prevSpend = arr[idx-1] ?? 0;
    const mom = prevSpend > 0 ? Math.round(((spend-prevSpend)/prevSpend)*100) : null;
    const sparkline = arr.slice(Math.max(0,idx-5), idx+1);
    return { cat, spend, mom, sparkline };
  }, []);

  const expenseCatRows = useMemo(() => {
    if (granularity === "month") {
      return Object.entries(catMonthlyTotals).map(e => rowFor(e, selIdx))
        .filter(c => c.spend > 0)
        .sort((a,b) => b.spend-a.spend);
    }
    const map: Record<string, number> = {};
    for (const t of periodTxnsAllCats) {
      const cat = getEffectiveCategory(t) ?? "Other";
      if (ignoredCategories.includes(cat) || isIncomeCategory(cat, Number(t.amount))) continue;
      map[cat] = (map[cat] ?? 0) + Number(t.amount);
    }
    return Object.entries(map)
      .map(([cat,spend]) => ({ cat, spend, mom: null as number|null, sparkline: [] as number[] }))
      .sort((a,b) => b.spend-a.spend);
  }, [granularity, catMonthlyTotals, selIdx, periodTxnsAllCats, getEffectiveCategory, isIncomeCategory, ignoredCategories, rowFor]);

  const incomeCatRows = useMemo(() => {
    if (granularity === "month") {
      return Object.entries(incomeCatMonthlyTotals).map(e => rowFor(e, selIdx))
        .filter(c => c.spend > 0)
        .sort((a,b) => b.spend-a.spend);
    }
    const map: Record<string, number> = {};
    for (const t of periodTxnsAllCats) {
      const cat = getEffectiveCategory(t) ?? "Other";
      if (ignoredCategories.includes(cat) || !isIncomeCategory(cat, Number(t.amount))) continue;
      map[cat] = (map[cat] ?? 0) - Number(t.amount);
    }
    return Object.entries(map)
      .map(([cat,spend]) => ({ cat, spend, mom: null as number|null, sparkline: [] as number[] }))
      .sort((a,b) => b.spend-a.spend);
  }, [granularity, incomeCatMonthlyTotals, selIdx, periodTxnsAllCats, getEffectiveCategory, isIncomeCategory, ignoredCategories, rowFor]);

  // Kept for the few call sites below (details dialog, budget dialog) that
  // don't care which tab a category belongs to; just whichever of the three
  // lists it actually appears in.
  const catRows = useMemo(() => [...expenseCatRows, ...incomeCatRows], [expenseCatRows, incomeCatRows]);

  // ── Ignored categories (Credit Card Payment, confirmed Internal Transfer)
  //; a completely separate universe from expenseCatRows/incomeCatRows, only
  // ever browsed while the Ignored tab is active.
  const ignoredCatRows = useMemo(() => {
    const totals: Record<string, number> = {};
    const counts: Record<string, number> = {};
    for (const t of periodTxnsAllCats) {
      const cat = getEffectiveCategory(t) ?? "Other";
      if (!ignoredCategories.includes(cat)) continue;
      totals[cat] = (totals[cat] ?? 0) + Math.abs(Number(t.amount));
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return Object.entries(totals)
      .map(([cat, spend]) => ({ cat, spend, count: counts[cat] ?? 0 }))
      .sort((a, b) => b.spend - a.spend);
  }, [periodTxnsAllCats, getEffectiveCategory, ignoredCategories]);

  // Whichever of the three row-lists matches the active tab; used by the
  // mobile pill row, which (unlike the desktop card list) renders all three
  // tabs' rows through one shared, simpler pill template.
  const activeCatTabRows = catTab === "ignored" ? ignoredCatRows : catTab === "income" ? incomeCatRows : expenseCatRows;

  // Feeds the "View Budget" dialog's two columns: categories you've actually
  // spent in this period but haven't budgeted yet (left), and every category
  // that already has a budget, cross-referenced against this period's spend
  // if any (right). Built straight from expenseCatRows; by construction it
  // never contains income or ignored categories, so no extra filtering is
  // needed here (budgeting is inherently a spend concept; an income category
  // like "Salary" or an ignored one like "Credit Card Payment" shouldn't show
  // up asking to be budgeted).
  const budgetNeeds = useMemo(() => expenseCatRows.filter(c => budgets[c.cat] == null && !ignoredCategories.includes(c.cat)
    && categoryCountsAsSpend(c.cat, customCategories)), [expenseCatRows, budgets, ignoredCategories, customCategories]);
  const budgetDefined = useMemo(() => Object.entries(budgets)
    .map(([cat, budget]) => ({ cat, budget, spend: catRows.find(c => c.cat === cat)?.spend ?? 0 }))
    .sort((a, b) => b.spend - a.spend),
  [budgets, catRows]);

  // Stats backing the category details dialog; recomputed only while it's
  // open, straight from periodTxnsAllCats so the count/spend/mom always match
  // whatever's currently shown in the Categories list, regardless of granularity.
  const detailsCatStats = useMemo(() => {
    if (!detailsCat) return null;
    const row = catRows.find(c => c.cat === detailsCat);
    const count = periodTxnsAllCats.filter(t => (getEffectiveCategory(t) ?? "Other") === detailsCat).length;
    return { spend: row?.spend ?? 0, mom: row?.mom ?? null, count };
  }, [detailsCat, catRows, periodTxnsAllCats, getEffectiveCategory]);


  // Resolves the value a given column sorts by, for any transaction.
  const sortValueFor = useCallback((x: PTxn, key: SortKey): string | number => {
    switch (key) {
      case "name": return (nameOverrides[x.id] ?? x.merchant_name ?? x.name ?? "").toLowerCase();
      case "statement": return (x.name ?? "").toLowerCase();
      case "category": return (getEffectiveCategory(x) ?? "Other").toLowerCase();
      case "status": return x.pending ? 1 : 0;
      case "account": return (accounts.find(a => a.account_id === x.account_id)?.name ?? "").toLowerCase();
      case "amount": return Math.abs(Number(x.amount));
      case "date": default: return x.date;
    }
  }, [nameOverrides, getEffectiveCategory, accounts]);

  const visibleTxns = useMemo(() => {
    const searching = activeSearchTerms.length > 0;
    // A search is a "find this transaction" action, not normal browsing; it
    // deliberately looks across every period and category, not just the one
    // currently selected, so it isn't pre-scoped by periodTxns (which is
    // narrowed to activeRange + catSel). The other filter-panel controls
    // (account/type/amount/date/tag) still apply on top, since those are
    // filters the user explicitly set, not automatic period scoping.
    let t = searching ? txns.filter(x => !internalTxnIds.has(x.id)) : [...periodTxns];
    if (accountFilters.length > 0) t = t.filter(x => accountFilters.includes(x.account_id));
    if (typeFilter === "in") t = t.filter(x => Number(x.amount) < 0);
    else if (typeFilter === "out") t = t.filter(x => Number(x.amount) > 0);
    if (amountMode === "fixed" && fixedAmount.trim()) {
      const fx = parseFloat(fixedAmount);
      if (!isNaN(fx)) t = t.filter(x => Math.abs(Math.abs(Number(x.amount)) - fx) < 0.005);
    } else {
      const min = parseFloat(minAmount), max = parseFloat(maxAmount);
      if (!isNaN(min)) t = t.filter(x => Math.abs(Number(x.amount)) >= min);
      if (!isNaN(max)) t = t.filter(x => Math.abs(Number(x.amount)) <= max);
    }
    if (dateMode === "range" && (dateFrom || dateTo)) {
      if (dateFrom) t = t.filter(x => x.date >= dateFrom);
      if (dateTo) t = t.filter(x => x.date <= dateTo);
    } else if (dateMode === "lastN") {
      const n = parseInt(lastNDays, 10);
      if (!isNaN(n) && n > 0) {
        const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - n);
        const cutoffStr = localISODate(cutoff);
        t = t.filter(x => x.date >= cutoffStr);
      }
    } else if (dateMode === "year" && filterYear) {
      t = t.filter(x => x.date.startsWith(filterYear));
    }
    if (tagFilter.length > 0) t = t.filter(x => (txnTags[x.id] ?? []).some(tag => tagFilter.includes(tag)));
    if (searching) {
      t = t.filter(x => {
        const desc = (nameOverrides[x.id] ?? x.merchant_name ?? x.name ?? "").toLowerCase();
        const stmt = (x.name ?? "").toLowerCase();
        const cat = (getEffectiveCategory(x) ?? "").toLowerCase();
        // Every committed term must match; each addition narrows further,
        // rather than broadening like the tag/category filters do.
        return activeSearchTerms.every(term => {
          const q = term.toLowerCase();
          return desc.includes(q) || stmt.includes(q) || cat.includes(q);
        });
      });
    }
    t.sort((a,b) => {
      const va = sortValueFor(a, sortBy), vb = sortValueFor(b, sortBy);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sortDesc ? -cmp : cmp;
    });
    return t;
  }, [periodTxns, txns, internalTxnIds, activeSearchTerms, sortBy, sortDesc, sortValueFor, nameOverrides, getEffectiveCategory, accountFilters, minAmount, maxAmount, amountMode, fixedAmount, typeFilter, tagFilter, txnTags, dateMode, dateFrom, dateTo, lastNDays, filterYear]);

  // Accounts that actually appear in this period's transactions, sorted for the filter dropdown.
  const accountsInPeriod = useMemo(() => {
    const ids = new Set(periodTxns.map(t => t.account_id));
    return accounts.filter(a => ids.has(a.account_id)).sort((a,b) => (a.name??"").localeCompare(b.name??""));
  }, [accounts, periodTxns]);

  // Same accounts, bucketed into the Checking/Savings/Credit Cards/etc.
  // groups the Accounts filter dropdown shows, so a whole group can be
  // selected in one click instead of ticking every card individually.
  const accountGroups = useMemo(() => {
    const byGroup = new Map<AcctGroupKey, PAccount[]>();
    for (const a of accountsInPeriod) {
      const k = accountGroupKey(a);
      const list = byGroup.get(k);
      if (list) list.push(a); else byGroup.set(k, [a]);
    }
    return ACCOUNT_GROUP_ORDER.filter(k => byGroup.has(k)).map(k => ({ key: k, label: ACCOUNT_GROUP_LABEL[k], accounts: byGroup.get(k)! }));
  }, [accountsInPeriod]);
  const toggleAccountGroup = (ids: string[]) => setAccountFilters(prev => {
    const allSelected = ids.length > 0 && ids.every(id => prev.includes(id));
    return allSelected ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])];
  });

  // Every category present this period (for the standalone Category filter,
  // independent of clicking a card in the Categories list).
  const categoriesInPeriod = useMemo(() => {
    const set = new Set<string>();
    for (const x of periodTxnsAllCats) set.add(getEffectiveCategory(x) ?? "Other");
    return [...set].sort();
  }, [periodTxnsAllCats, getEffectiveCategory]);

  // Every tag present on any transaction in this period.
  const tagsInPeriod = useMemo(() => {
    const set = new Set<string>();
    for (const x of periodTxns) for (const tag of (txnTags[x.id] ?? [])) set.add(tag);
    return [...set].sort();
  }, [periodTxns, txnTags]);
  const toggleTagFilter = (tag: string) => setTagFilter(prev => prev.includes(tag) ? prev.filter(t=>t!==tag) : [...prev, tag]);

  const hasActiveFilters = !!(activeSearchTerms.length > 0 || accountFilters.length > 0 || minAmount || maxAmount || fixedAmount || typeFilter !== "all" || tagFilter.length > 0 || dateMode !== "none");
  const clearFilters = () => {
    setSearchDraft(""); setLiveSearch(""); setSearchTerms([]); setAccountFilters([]); setMinAmount(""); setMaxAmount(""); setFixedAmount(""); setAmountMode("range");
    setTypeFilter("all"); setTagFilter([]); setDateMode("none"); setDateFrom(""); setDateTo("");
  };
  // "date" desc (newest first) is the default sort; anything else counts as
  // an explicit choice worth surfacing its own quick-clear chip for.
  const hasActiveSort = !(sortBy === "date" && sortDesc);
  const clearSort = () => { setSortBy("date"); setSortDesc(true); };

  // Resolves the group label for a transaction under the current groupBy
  // mode. "date" grouping adapts to whatever granularity the header's period
  // scrubber is on, since grouping by exact day makes sense browsing a
  // month/week but not when looking at a whole year or all-time; that would
  // produce hundreds of one-line day groups instead of a useful breakdown.
  const groupLabelFor = useCallback((t: PTxn): string => {
    switch (groupBy) {
      case "account": return accounts.find(a => a.account_id === t.account_id)?.name ?? "Unknown account";
      case "date":
        if (granularity === "all") return t.date.slice(0, 4);   // by year
        if (granularity === "year") return t.date.slice(0, 7);  // by month
        return t.date;                                          // by day (month/week/day)
      case "category": return formatCat(getEffectiveCategory(t) ?? "Other");
      case "status": return t.pending ? "Pending" : "Posted";
      default: return "";
    }
  }, [groupBy, granularity, accounts, formatCat, getEffectiveCategory]);

  // Human-friendly heading for a group key; dates get calendar formatting
  // matched to the same granularity-driven bucket size as groupLabelFor
  // above; account/category/status groups just show the label as-is.
  const groupHeading = useCallback((key: string): string => {
    if (groupBy === "date") {
      if (granularity === "all") return key; // "2024"
      if (granularity === "year") {
        const [y, m] = key.split("-").map(Number);
        return new Date(y, (m || 1) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      }
      return rDate(key); // exact day; Today/Yesterday/weekday
    }
    return key || "Uncategorized";
  }, [groupBy, granularity]);

  // Buckets visibleTxns into ordered groups (order follows visibleTxns' own
  // sort, so grouping composes with whichever column you've sorted by).
  // Sort applies first, grouping second: visibleTxns is already fully sorted
  // by whatever column/direction is active, and we only bucket that sorted
  // list into groups here; we never re-sort within or across buckets. Both
  // the row order inside each group AND the order the groups themselves
  // appear in come from each row's position in the already-sorted list (a
  // group surfaces at the index of its first member), so switching the sort
  // column reorders the whole table, groups included, exactly like sorting a
  // flat list would; grouping just adds the visual dividers on top.
  const groupedTxns = useMemo(() => {
    if (groupBy === "none") return null;
    const buckets = new Map<string, { items: PTxn[]; firstIdx: number }>();
    visibleTxns.forEach((t, idx) => {
      const key = groupLabelFor(t);
      const b = buckets.get(key);
      if (b) b.items.push(t);
      else buckets.set(key, { items: [t], firstIdx: idx });
    });
    return [...buckets.entries()]
      .sort((a, b) => a[1].firstIdx - b[1].firstIdx)
      .map(([key, { items }]) => ({
        key, items, total: items.reduce((s, t) => s + Number(t.amount), 0),
      }));
  }, [visibleTxns, groupBy, groupLabelFor]);

  // Mobile's transaction list is always grouped by date, independent of the
  // desktop Group-by control; the redesigned mobile layout is built around
  // a chronological, date-headed feed regardless of what grouping mode
  // desktop/tablet happens to have selected.
  // Date headings only make sense while the feed is in date order; sorted
  // by amount/name/etc. the date buckets would be scattered fragments in
  // sort order, so the feed renders as one flat, header-less list instead.
  const MOBILE_FLAT_KEY = "__flat__";
  const mobileGroups = useMemo(() => {
    if (sortBy !== "date") {
      return [{ key: MOBILE_FLAT_KEY, items: visibleTxns, total: visibleTxns.reduce((s, t) => s + Number(t.amount), 0) }];
    }
    const buckets = new Map<string, { items: PTxn[]; firstIdx: number }>();
    visibleTxns.forEach((t, idx) => {
      const key = granularity === "all" ? t.date.slice(0, 4) : granularity === "year" ? t.date.slice(0, 7) : t.date;
      const b = buckets.get(key);
      if (b) b.items.push(t);
      else buckets.set(key, { items: [t], firstIdx: idx });
    });
    return [...buckets.entries()]
      .sort((a, b) => a[1].firstIdx - b[1].firstIdx)
      .map(([key, { items }]) => ({ key, items, total: items.reduce((s, t) => s + Number(t.amount), 0) }));
  }, [visibleTxns, granularity, sortBy]);

  const mobileGroupHeading = useCallback((key: string): string => {
    if (granularity === "all") return key;
    if (granularity === "year") {
      const [y, m] = key.split("-").map(Number);
      return new Date(y, (m || 1) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }
    return rDate(key);
  }, [granularity]);

  // Which groups are collapsed, keyed by the group's label; a Set so toggling
  // one group never touches the others' state. Cleared when groupBy changes so
  // stale keys from a previous grouping mode don't linger.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  useEffect(() => { setCollapsedGroups(new Set()); }, [groupBy]);
  const toggleGroupCollapsed = useCallback((key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  // Drives the single expand/collapse-all toggle button: once every current
  // group is collapsed the button flips to "expand all" instead of offering
  // to collapse an already-fully-collapsed list.
  const allGroupsCollapsed = !!groupedTxns && groupedTxns.length > 0 && groupedTxns.every(g => collapsedGroups.has(g.key));
  const expandAllGroups = useCallback(() => setCollapsedGroups(new Set()), []);
  const collapseAllGroups = useCallback(() => {
    if (!groupedTxns) return;
    setCollapsedGroups(new Set(groupedTxns.map(g => g.key)));
  }, [groupedTxns]);
  // "Show more" paging; back to the first page whenever the list changes.
  const [rowLimit, setRowLimit] = useState(ROW_PAGE);
  useEffect(() => { setRowLimit(ROW_PAGE); }, [visibleTxns, groupBy]);
  const desktopPage = useMemo(() => limitGroups(
    groupedTxns ?? [{ key: "__all__", items: visibleTxns, total: 0 }],
    rowLimit, k => !!groupedTxns && collapsedGroups.has(k),
  ), [groupedTxns, visibleTxns, rowLimit, collapsedGroups]);
  const mobilePage = useMemo(() => limitGroups(
    mobileGroups, rowLimit, k => k !== MOBILE_FLAT_KEY && collapsedGroups.has(k),
  ), [mobileGroups, rowLimit, collapsedGroups]);
  // Rows actually on screen in the desktop table; "select all" must never
  // pick up rows hidden inside a collapsed group (or not yet shown).
  const renderedTableTxns = useMemo(() => desktopPage.groups.flatMap(g => g.shown), [desktopPage]);

  // 1 "Description" column + however many optional attribute columns are visible.
  const colSpan = 2 + tableCols.size; // checkbox column + always-on name column + optional columns


  const animatedTotal = useCountUp(totalSpent, 900);

  // ── Redesigned overview (hero / daily chart / categories / merchants /
  // review flags) for the selected month. Same spend rules as
  // catMonthlyTotals: no confirmed internal transfers, no income, no ignored
  // categories. ─────────────────────────────────────────────────────────────
  // Owner rule: only real spending is "spend". Card payments, savings
  // contributions, money to/from other people and internal transfers are
  // reported separately (Money movement card) and never budgeted.
  const flowOf = useCallback((t: PTxn): TxnClass => {
    const cat = getEffectiveCategory(t) ?? "Other";
    const classification = classOf?.(t);
    if (!classification && ignoredCategories.includes(cat) && !/credit card payment/i.test(cat)) return "transfer_internal";
    // An explicit user edit beats auto-detected internal pairing.
    const internal = internalTxnIds.has(t.id) && !(isCategoryEdited?.(t) ?? false);
    return classifyTxn(t as unknown as ClassifierTxn, { category: cat, classification, internal, customCategories });
  }, [getEffectiveCategory, ignoredCategories, internalTxnIds, isCategoryEdited, classOf, customCategories]);
  const isTypeEdited = useCallback((t: PTxn) =>
    classOf?.(t)?.source === "override" || (isCategoryEdited?.(t) ?? false), [classOf, isCategoryEdited]);
  // "Change type" from a row: persisted as a re-categorization so it rides
  // the existing override sync; Spending falls back to "Other" so the user
  // can pick the specific spend category next.
  const changeTxnType = useCallback((t: PTxn, type: TxnClass) => {
    // Preferred: the shared per-transaction type override (txn_overrides).
    if (onSetTxnType && t.transaction_id) { onSetTxnType(t, type); return; }
    const def = TXN_TYPES.find(x => x.key === type);
    if (!def) return;
    const cat = def.category ?? "Other";
    if (type === "savings_contribution" && !customCategories.some(c => c.name === cat) && !expenseCategories.includes(cat)) onAddCategory(cat, "expense");
    onSelectCategory(t, cat);
  }, [customCategories, expenseCategories, onAddCategory, onSelectCategory, onSetTxnType]);
  const isSpendTxn = useCallback((t: PTxn) => countsAsSpend(flowOf(t)), [flowOf]);
  const isSpendCategory = useCallback((cat: string) =>
    !ignoredCategories.includes(cat) && categoryCountsAsSpend(cat, customCategories),
  [ignoredCategories, customCategories]);
  const spendBudgetTotal = useMemo(() => Object.entries(budgets).filter(([c]) => isSpendCategory(c)).reduce((s, [, v]) => s + v, 0), [budgets, isSpendCategory]);
  const txnLabel = useCallback((t: PTxn) => (nameOverrides[t.id] ?? t.merchant_name ?? t.name ?? "").trim() || "Unknown", [nameOverrides]);
  const txnFlags = useMemo(() => detectTxnFlags(txns, {
    isExpense: isSpendTxn, label: txnLabel, excludeIds: internalTxnIds,
  }), [txns, isSpendTxn, txnLabel, internalTxnIds]);

  const overview = useMemo(() => {
    const monthAll = txns.filter(t => t.date >= sel.start && t.date <= sel.end);
    const cur = monthAll.filter(isSpendTxn);
    const prevTxns = prevSel ? txns.filter(t => t.date >= prevSel.start && t.date <= prevSel.end && isSpendTxn(t)) : [];
    const dCur = dailyTotals(cur, sel.year, sel.monthIdx);
    const dPrev = prevSel ? dailyTotals(prevTxns, prevSel.year, prevSel.monthIdx) : [];
    const cumCur = cumulative(dCur), cumPrev = cumulative(dPrev);
    const spent = cur.reduce((s, t) => s + Number(t.amount), 0);
    const prevTotal = prevSel ? prevTxns.reduce((s, t) => s + Number(t.amount), 0) : null;
    const projected = isCurrentMonth ? projectMonthEnd(spent, dayOfMonth, daysInSelMonth) : spent;
    const days = dCur.map((amount, i) => {
      const day = i + 1;
      const past = !isCurrentMonth || day <= dayOfMonth;
      return {
        day, amount: past ? amount : 0,
        cum: past ? cumCur[i] : null,
        prevCum: i < cumPrev.length ? cumPrev[i] : null,
        projected: isCurrentMonth && day >= dayOfMonth && daysInSelMonth > dayOfMonth
          ? spent + (projected - spent) * ((day - dayOfMonth) / (daysInSelMonth - dayOfMonth)) : null,
      };
    });
    const prevSameDay = prevSel && cumPrev.length ? cumPrev[Math.min(dayOfMonth, cumPrev.length) - 1] : null;
    const pending = cur.filter(t => t.pending);

    const catSum = (list: PTxn[]) => {
      const m: Record<string, number> = {};
      for (const t of list) { const c = getEffectiveCategory(t) ?? "Other"; m[c] = (m[c] ?? 0) + Number(t.amount); }
      return m;
    };
    const curByCat = catSum(cur), prevByCat = catSum(prevTxns);
    const categories = Object.entries(curByCat)
      .map(([cat, spend]) => ({ cat, spend, prevSpend: prevByCat[cat] ?? 0, budget: budgets[cat] ?? null, fixed: OBLIGATION_LIKE_CATS.has(cat) }))
      .filter(c => c.spend > 0)
      .sort((a, b) => b.spend - a.spend);

    // Everything that moved money but isn't spending, grouped by flow.
    const movement: OverviewMovement = {
      credit_card_payment: { total: 0, count: 0 }, savings_contribution: { total: 0, count: 0 },
      transfer_out: { total: 0, count: 0 }, transfer_in: { total: 0, count: 0 }, transfer_internal: { total: 0, count: 0 },
    };
    for (const t of monthAll) {
      const f = flowOf(t);
      if (!(f in movement)) continue;
      // An internal transfer posts twice (out of one account, into the
      // other); count only the outgoing leg so the total isn't doubled.
      if (f === "transfer_internal" && Number(t.amount) < 0) continue;
      movement[f as MovementKey].total += Math.abs(Number(t.amount)); movement[f as MovementKey].count += 1;
    }

    // Top merchants this month + a 6-month trend line for each.
    const trendStart = Math.max(0, selIdx - 5);
    const keyOf = (t: PTxn) => normalizeMerchant(txnLabel(t)) || txnLabel(t).toLowerCase();
    const byM = new Map<string, OverviewMerchant>();
    for (const t of cur) {
      const k = keyOf(t);
      const m = byM.get(k) ?? { name: txnLabel(t), cat: getEffectiveCategory(t) ?? "Other", total: 0, count: 0, trend: new Array(selIdx - trendStart + 1).fill(0) };
      m.total += Number(t.amount); m.count += 1;
      byM.set(k, m);
    }
    const merchants = [...byM.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 6);
    const topKeys = new Map(merchants);
    for (const t of txns) {
      if (t.date < monthBuckets[trendStart].start || t.date > sel.end || !isSpendTxn(t)) continue;
      const m = topKeys.get(keyOf(t));
      if (!m) continue;
      const bi = monthBuckets.findIndex(b => t.date >= b.start && t.date <= b.end);
      if (bi >= trendStart && bi <= selIdx) m.trend[bi - trendStart] += Number(t.amount);
    }

    const flagged = cur.filter(t => txnFlags.has(t.id))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(t => ({ id: t.id, label: txnLabel(t), amount: Number(t.amount), date: t.date, flag: txnFlags.get(t.id) as TxnFlag }));

    return {
      spent, prevTotal, movement,
      days, prevSameDay, projected, categories, flagged,
      merchants: merchants.map(([, m]) => m),
      pendingSpent: pending.reduce((s, t) => s + Number(t.amount), 0), pendingCount: pending.length,
    };
  }, [txns, sel, prevSel, isSpendTxn, flowOf, isCurrentMonth, dayOfMonth, daysInSelMonth, selIdx, budgets, txnLabel, getEffectiveCategory, monthBuckets, txnFlags]);
  const selectOverviewCat = (cat: string | null) => {
    if (catTab !== "expenses") setCatTabRaw("expenses");
    setCatSel(cat);
  };
  const monthName = new Date(sel.year, sel.monthIdx, 1).toLocaleDateString("en-US", { month: "long" });
  const prevMonthShort = prevSel ? new Date(prevSel.year, prevSel.monthIdx, 1).toLocaleDateString("en-US", { month: "short" }) : "last month";
  const todayLong = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // ── Burn runway SVG geometry ──────────────────────────────────────────────
  // x is addressed by day-offset (0-based from the selected month's start) so
  // Card 1 geometry; one point per day of the selected month (28-31 points).
  const CW = 100, CH = 100; // viewBox units; scaled by the SVG's own width/height
  const past30Scale = Math.max(...rolling30.map(d=>d.cum), totalBudget || 0, 1);
  const xForPast = (i:number) => (i/(daysInSelMonth-1||1))*CW;
  const yForPast = (v:number) => CH - (v/past30Scale)*CH;
  const past30Path = rolling30.map((d,i) => `${i===0?"M":"L"}${xForPast(i).toFixed(2)},${yForPast(d.cum).toFixed(2)}`).join(" ");
  const past30Area = rolling30.length ? `${past30Path} L${CW},${CH} L0,${CH} Z` : "";
  const past30BudgetY = totalBudget > 0 ? yForPast(totalBudget) : null;
  // Date-axis ticks: day 1, every 5th day, and the last day of the month.
  const past30Ticks = useMemo(() => {
    const ticks = new Set<number>([1]);
    for (let d = 5; d < daysInSelMonth; d += 5) ticks.add(d);
    ticks.add(daysInSelMonth);
    return [...ticks].sort((a,b)=>a-b);
  }, [daysInSelMonth]);

  const onChartMove = (e: React.MouseEvent) => {
    if (!chartRef.current) return;
    const rect = chartRef.current.getBoundingClientRect();
    const pct = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    setScrubDay(Math.round(pct * (daysInSelMonth-1)));
  };

  // Card 2 geometry; x axis is days-from-today (0..PROJECTION_DAYS).
  const future15Scale = Math.max(...future15.map(f=>f.cum), 1);
  const xForFuture = (days:number) => (days/PROJECTION_DAYS)*CW;
  const yForFuture = (v:number) => CH - (v/future15Scale)*CH;
  const daysFromToday = (dateStr:string) => daysBetweenISO(todayStr, dateStr);
  const future15Path = future15.length
    ? [`M0,${CH.toFixed(2)}`, ...future15.map(f => `L${xForFuture(daysFromToday(f.nextDate)).toFixed(2)},${yForFuture(f.cum).toFixed(2)}`)].join(" ")
    : "";

  return (
    <div className="flex flex-col bg-background spending-v2">

      {/* ═══ 1. Header; same title/date treatment as Home, plus the period
          controls (granularity + month switcher) in one clean row ═══ */}
      <header className="content-max px-4 md:px-8 pt-3 md:pt-6 pb-4">
        <div className="flex items-start justify-between gap-3">
          {/* Phones show the title in the app's top bar (Index.tsx); repeating
              it here pushed the content down for no information. */}
          <div className="hidden md:block">
            <h1 className="font-display text-2xl text-foreground">Spending</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">{todayLong}</p>
          </div>
          {headerActions && <div className="hidden md:flex items-center gap-2">{headerActions}</div>}
        </div>
        <div className="md:mt-4 flex flex-wrap items-center gap-2">
          <div className="flex bg-muted/50 rounded-xl p-1 gap-0.5 border border-border/50" role="tablist" aria-label="Period">
            {(["day","week","month","year","all"] as const).map(g => (
              <button key={g} role="tab" aria-selected={granularity===g} onClick={() => setGranularity(g)}
                className={cn("px-3 py-1.5 rounded-lg text-[12.5px] font-semibold capitalize transition-all",
                  granularity===g ? "bg-[hsl(var(--primary))] text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/60")}>
                {g === "all" ? "All time" : g}
              </button>
            ))}
          </div>
          {granularity !== "all" && (() => {
            // One prev/next switcher for every granularity (it used to exist
            // for months only, so day/week/year had no way to go back).
            const atStart = granularity==="month" ? selIdx<=0
              : granularity==="day" ? dayOffset <= -(DAY_COUNT-1)
              : granularity==="week" ? weekOffset <= -(WEEK_COUNT-1)
              : yearOffset <= -(YEAR_COUNT-1);
            const unit = granularity === "day" ? "day" : granularity;
            const label = granularity==="month"
              ? new Date(sel.year, sel.monthIdx, 1).toLocaleDateString("en-US",{month:"long",year:"numeric"})
              : activeRange.label;
            const step = (dir: 1|-1) => granularity==="month"
              ? setMonthOffset(o => dir < 0 ? Math.max(o-1, -lastIdx) : Math.min(0, o+1))
              : stepPeriod(dir);
            return (
              <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-card p-1">
                <button onClick={()=>step(-1)} disabled={atStart} aria-label={`Previous ${unit}`}
                  className="h-9 w-9 md:h-8 md:w-8 rounded-lg grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-30 transition-colors">
                  <ChevronLeft className="h-4 w-4"/>
                </button>
                <span className="min-w-[124px] text-center text-[13.5px] font-semibold text-foreground tabular" aria-live="polite">{label}</span>
                <button onClick={()=>step(1)} disabled={activeRange.isCurrent} aria-label={`Next ${unit}`}
                  className="h-9 w-9 md:h-8 md:w-8 rounded-lg grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-30 transition-colors">
                  <ChevronRight className="h-4 w-4"/>
                </button>
              </div>
            );
          })()}
          {granularity !== "all" && !activeRange.isCurrent && (
            <button onClick={()=> granularity==="month" ? setMonthOffset(0) : resetPeriod()}
              className="text-[12.5px] font-medium text-[hsl(var(--primary))] hover:underline px-1">
              {granularity==="month" ? "This month" : granularity==="week" ? "This week" : granularity==="year" ? "This year" : "Today"}
            </button>
          )}
        </div>
      </header>

      <div className="content-max px-4 md:px-8 pb-10 space-y-4 flex flex-col">

        {granularity === "month" ? (
          <SpendingOverview
            monthName={monthName} prevMonthShort={prevMonthShort}
            monthEndLabel={fmtShortDate(sel.end)}
            isCurrentMonth={isCurrentMonth} dayOfMonth={dayOfMonth} daysInMonth={daysInSelMonth}
            spent={overview.spent} pendingSpent={overview.pendingSpent} pendingCount={overview.pendingCount}
            earned={totalEarned} prevSameDay={overview.prevSameDay} prevTotal={overview.prevTotal}
            budgetTotal={spendBudgetTotal} projected={overview.projected} movement={overview.movement}
            onShowIgnored={()=>setCatTab("ignored")}
            days={overview.days} categories={overview.categories} merchants={overview.merchants} flagged={overview.flagged}
            selectedCat={catTab === "expenses" ? catSel : null} onSelectCat={selectOverviewCat}
            onCategoryDetails={setDetailsCat} onManageBudgets={()=>setBudgetDialogOpen(true)}
            onOpenFlagged={id => { const t = txns.find(x => x.id === id); if (t) onOpenDetail(t); }}
            catColor={catColor} categoryIcon={categoryIcon} formatCat={formatCat}
          />
        ) : (
        <div className="space-y-3.5">
        <div className={cn("surface-card p-4 md:p-5 shrink-0", granularity==="all" && "inline-flex")}>
          <div className={cn(
            granularity==="all"
              // Nothing to bucket into a scrubber for "all time" — a full
              // stretched grid just leaves a wide empty gap between the label
              // and the stats. Sit them together, compact, on one side instead.
              ? "flex flex-wrap items-center gap-5"
              : "grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-5 lg:gap-7 items-stretch w-full",
          )}>

            {/* Left: duration toggle + spend bar spikes */}
            <div className="min-w-0">
              {granularity==="all" ? (
                /* No scrubber to bucket "all time" into; just a plain label,
                   same vertical footprint as the other tabs so switching
                   between them doesn't reflow the header. */
                <div className="h-8 flex items-center text-[11px] text-muted-foreground/70 whitespace-nowrap">
                  Every transaction on record, across every account and year.
                </div>
              ) : granularity==="day" ? (
                /* 14-day scrubber; same bar format as the other granularities
                   so the header never changes height when switching tabs. */
                <div>
                  <div className="text-[11px] font-semibold text-muted-foreground/70 mb-1">{dayCtxLabel}</div>
                  <PeriodBars buckets={dayBuckets} totals={overallDaily} selIdx={selDayIdx}
                    onSelect={(i) => setDayOffset(i-(DAY_COUNT-1))} maxWidth={560}/>
                </div>
              ) : granularity==="week" ? (
                /* 12-week scrubber, same bar format as months */
                <div>
                  <div className="text-[11px] font-semibold text-muted-foreground/70 mb-1">{weekYearLabel}</div>
                  <PeriodBars buckets={weekBuckets} totals={overallWeekly} selIdx={selWeekIdx}
                    onSelect={(i) => setWeekOffset(i-(WEEK_COUNT-1))} maxWidth={640}/>
                </div>
              ) : granularity==="year" ? (
                /* 6-year scrubber; each bar is one calendar year */
                <div>
                  <div className="text-[11px] font-semibold text-muted-foreground/70 mb-1">&nbsp;</div>
                  <PeriodBars buckets={yearBuckets} totals={overallYearly} selIdx={selYearIdx}
                    onSelect={(i) => setYearOffset(i-(YEAR_COUNT-1))} maxWidth={400}/>
                </div>
              ) : (
                /* 12-month scrubber; capped width so bars stay a sensible size on wide screens.
                   Year label above clarifies which calendar year(s) the months belong to. */
                <div>
                  <div className="text-[11px] font-semibold text-muted-foreground/70 mb-1">{monthYearLabel}</div>
                  <PeriodBars buckets={monthBuckets} totals={overallMonthly} selIdx={selIdx}
                    onSelect={(i) => setMonthOffset(i-lastIdx)} maxWidth={560}/>
                </div>
              )}
            </div>

            {/* Right: period summary; always just Total earned / Total spent
                for the selected range, so the panel's height and shape never
                change across day/week/month/year (no month-only budget block). */}
            <div className={cn(
              "shrink-0 border-border/50",
              granularity==="all"
                ? "border-l pl-5"
                : "w-full lg:w-[240px] lg:border-l lg:pl-6 pt-3 lg:pt-0 border-t lg:border-t-0",
            )}>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {activeRange.label}
              </div>
              <div className={cn(granularity==="all" ? "flex items-center gap-5" : "space-y-2")}>
                <div className={cn("flex items-center gap-3", granularity==="all" ? "flex-col items-start" : "justify-between")}>
                  <span className="text-[12px] text-muted-foreground">Total earned</span>
                  <span className="text-[15px] font-semibold tabular text-positive">{fmtUSD(totalEarned)}</span>
                </div>
                <div className={cn("flex items-center gap-3", granularity==="all" ? "flex-col items-start" : "justify-between")}>
                  <span className="text-[12px] text-muted-foreground">Total spent</span>
                  <span className="text-[15px] font-semibold tabular text-foreground">{fmtUSD(animatedTotal)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Stat tiles (Safe to spend / Committed next 30 days) now live in the
            fixed Insights panel to the right, alongside Top spending categories. */}

        {/* ═══ 3. Burn runway; swipeable: last 30 days ⇄ next 15 days ═════════ */}
        {SHOW_BURN_RUNWAY && (
        <div className="surface-card p-4 md:p-5 overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[13px] font-semibold text-foreground">Burn runway</div>
              <div className="text-[11.5px] text-muted-foreground">
                {runwayIdx===0 ? `${new Date(sel.year,sel.monthIdx,1).toLocaleDateString("en-US",{month:"long",year:"numeric"})}, cumulative spend` : "Next 15 days, anticipated charges"}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {runwayIdx===0 && scrubDay !== null && rolling30[scrubDay] && (
                <div className="text-right mr-1">
                  <div className="text-[13px] font-bold text-foreground tabular">{fmtUSD(rolling30[scrubDay].cum)}</div>
                  <div className="text-[11px] text-muted-foreground">{new Date(rolling30[scrubDay].date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                </div>
              )}
              <button onClick={()=>setRunwayIdx(0)} aria-label="Show this month's cumulative spend" className={cn("h-1.5 w-1.5 rounded-full transition-all", runwayIdx===0?"bg-[hsl(var(--primary))] w-4":"bg-border")}/>
              <button onClick={()=>setRunwayIdx(1)} aria-label="Show next 15 days' anticipated charges" className={cn("h-1.5 w-1.5 rounded-full transition-all", runwayIdx===1?"bg-[hsl(var(--primary))] w-4":"bg-border")}/>
            </div>
          </div>

          <div className="relative overflow-hidden"
            onPointerDown={runwayOnDown} onPointerMove={runwayOnMove} onPointerUp={runwayEndDrag} onPointerCancel={runwayEndDrag}>
            <div className="flex transition-transform duration-300 ease-out"
              style={{transform:`translateX(calc(${-runwayIdx*100}% + ${runwayDragging.current?runwayDragX:0}px))`}}>

              {/* ── Card 1: last 30 days ── */}
              <div className="w-full shrink-0">
                <div ref={chartRef} onMouseMove={onChartMove} onMouseLeave={()=>setScrubDay(null)} className="relative h-32 w-full cursor-crosshair">
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
                    <defs>
                      <linearGradient id="burnFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.35"/>
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0"/>
                      </linearGradient>
                    </defs>
                    {past30BudgetY !== null && (
                      <line x1="0" y1={past30BudgetY} x2="100" y2={past30BudgetY} stroke="hsl(var(--negative))" strokeWidth="0.6" strokeDasharray="2,2" vectorEffect="non-scaling-stroke"/>
                    )}
                    {past30Area && <path d={past30Area} fill="url(#burnFill)" stroke="none"/>}
                    {past30Path && (
                      <path d={past30Path} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.4" vectorEffect="non-scaling-stroke"
                        strokeDasharray="500" strokeDashoffset="0" className="burn-draw-in"/>
                    )}
                    {scrubDay !== null && (
                      <line x1={xForPast(scrubDay)} y1="0" x2={xForPast(scrubDay)} y2="100"
                        stroke="hsl(var(--foreground))" strokeWidth="0.4" strokeOpacity="0.3" vectorEffect="non-scaling-stroke"/>
                    )}
                  </svg>

                  {/* Marker dots + tooltips; HTML overlay positioned by percentage
                      so they stay perfectly round instead of being stretched into
                      ellipses by the chart's non-uniform SVG scaling. */}
                  {rolling30.map((d,i) => {
                    if (d.txns.length === 0) return null;
                    const key = `p${i}`;
                    const left = xForPast(i), top = (yForPast(d.cum)/CH)*100;
                    const hovered = hoveredDot===key;
                    const content = (
                      <>
                        <div className="text-[11px] text-muted-foreground">{new Date(d.date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                        {d.txns.map((t,ti) => (
                          <div key={ti} className="text-[11.5px] font-medium text-foreground flex items-center justify-between gap-2">
                            <span className="truncate">{t.merchant}</span>
                            <span className="tabular shrink-0">{fmtUSD(t.amount)}</span>
                          </div>
                        ))}
                      </>
                    );
                    return (
                      <div key={key} className="absolute -translate-x-1/2 -translate-y-1/2 z-10" style={{left:`${left}%`,top:`${top}%`}}
                        onMouseEnter={e=>showDotTooltip(key,e,content)} onMouseLeave={()=>hideDotTooltip(key)}>
                        <div className={cn("rounded-full bg-[hsl(var(--primary))] ring-2 ring-card transition-all cursor-pointer",
                          hovered ? "h-2.5 w-2.5" : "h-1.5 w-1.5")}/>
                      </div>
                    );
                  })}
                </div>
                {/* Date axis; day 1 through the last day of the selected month */}
                <div className="relative h-4 mt-1">
                  {past30Ticks.map(d => (
                    <span key={d} className="absolute -translate-x-1/2 text-[11px] text-muted-foreground/60 tabular"
                      style={{left:`${xForPast(d-1)}%`}}>
                      {d}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-4 mt-1 text-[11px] text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded-full bg-[hsl(var(--primary))] inline-block"/>Cumulative spend</span>
                  {past30BudgetY !== null && <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded-full bg-negative/60 inline-block"/>Budget ceiling</span>}
                  <span className="ml-auto">Swipe or tap dot to see next 15 days →</span>
                </div>
              </div>

              {/* ── Card 2: next 15 days ── */}
              <div className="w-full shrink-0">
                <div className="relative h-32 w-full">
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
                    <defs>
                      <linearGradient id="futureFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.25"/>
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0"/>
                      </linearGradient>
                    </defs>
                    {future15Path && (
                      <path d={future15Path} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.2" strokeDasharray="1.5,1.5" strokeOpacity="0.85" vectorEffect="non-scaling-stroke"/>
                    )}
                  </svg>
                  {future15.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center text-[12.5px] text-muted-foreground">
                      No recurring charges detected in the next {PROJECTION_DAYS} days
                    </div>
                  )}
                  {future15.map((f,i) => {
                    const key = `f${i}`;
                    const days = daysFromToday(f.nextDate);
                    const left = (xForFuture(days)/CW)*100, top = (yForFuture(f.cum)/CH)*100;
                    const hovered = hoveredDot===key;
                    const content = (
                      <>
                        <div className="text-[11px] text-muted-foreground">{new Date(f.nextDate+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})} · {f.frequency}{f.insufficient?" · insufficient funds":""}</div>
                        <div className={cn("text-[11.5px] font-medium flex items-center justify-between gap-2", f.insufficient?"text-negative":"text-foreground")}>
                          <span className="truncate">{f.merchant}</span>
                          <span className="tabular shrink-0">{fmtUSD(f.avgAmount)}</span>
                        </div>
                        {f.balanceAfter !== null && (
                          <div className={cn("text-[11px] tabular", f.insufficient?"text-negative":"text-muted-foreground")}>{fmtUSD(f.balanceAfter)} left in {f.accountName}</div>
                        )}
                      </>
                    );
                    return (
                      <div key={key} className="absolute -translate-x-1/2 -translate-y-1/2 z-10" style={{left:`${left}%`,top:`${top}%`}}
                        onMouseEnter={e=>showDotTooltip(key,e,content)} onMouseLeave={()=>hideDotTooltip(key)}>
                        <div className={cn("rounded-full ring-2 ring-card transition-all cursor-pointer",
                          f.insufficient ? "bg-[hsl(var(--negative))]" : "bg-[hsl(var(--primary))]",
                          hovered ? "h-2.5 w-2.5" : "h-1.5 w-1.5")}/>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-4 mt-2 text-[11px] text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded-full bg-[hsl(var(--primary)/0.6)] inline-block" style={{backgroundImage:"repeating-linear-gradient(90deg, hsl(var(--primary)) 0 2px, transparent 2px 4px)"}}/>Anticipated spend</span>
                  <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-negative inline-block"/>Low balance risk</span>
                  <span className="ml-auto">← Swipe back for last 30 days</span>
                </div>

                {/* Upcoming charges; compact horizontal rail (also shown as
                    markers on the graph above) */}
                {upcomingCharges.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border/15">
                    <div className="text-[11.5px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Upcoming charges</div>
                    <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
                      {upcomingCharges.map(r => {
                        const days = daysBetweenISO(todayStr, r.nextDate);
                        return (
                          <div key={r.merchant} className={cn("shrink-0 w-[150px] rounded-xl border p-3",
                            r.insufficient ? "border-negative/40 bg-negative/5" : "border-border/40 bg-muted/20")}>
                            <div className="text-[12.5px] font-semibold text-foreground truncate">{r.merchant}</div>
                            <div className="text-[11px] text-muted-foreground truncate mt-0.5">{r.accountName} · {r.frequency}</div>
                            <div className="text-[14px] font-bold text-foreground tabular mt-1">{fmtUSD(r.avgAmount)}</div>
                            <div className="text-[11px] text-[hsl(var(--primary))] font-medium mt-0.5">
                              {new Date(r.nextDate+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})} · in {Math.max(days,0)}d
                            </div>
                            {r.insufficient ? (
                              <div className="text-[11px] font-bold text-negative mt-1">Insufficient funds</div>
                            ) : r.balanceAfter !== null && (
                              <div className="text-[11px] text-muted-foreground mt-1 tabular">{fmtUSD(r.balanceAfter)} after</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        )}
        </div>
        )}

        {/* ═══ 4. Categories + transactions ═══════════════════════════════ */}
        <section className="flex flex-col gap-3 min-w-0 pt-2" aria-label="Transactions">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-[16px] font-semibold text-foreground">Transactions</h2>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                {activeRange.label} · totals include pending charges · confirmed transfers are hidden
              </p>
            </div>
            <button onClick={()=>setBudgetDialogOpen(true)}
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[hsl(var(--primary))] hover:opacity-80">
              <Wallet className="h-3.5 w-3.5"/> Manage budgets
            </button>
          </div>

          {/* Mobile: category filter as a horizontal pill row instead of the
              taller vertical box below; tap a pill to filter the list,
              same catSel state the desktop sidebar and table use. */}
          {(expenseCatRows.length > 0 || incomeCatRows.length > 0 || ignoredCatRows.length > 0) && (
            <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap shrink-0">
              {CAT_TABS.map(tab => (
                <button key={tab.key} onClick={()=>setCatTab(tab.key)} title={tab.title}
                  className={cn("shrink-0 px-2.5 py-1.5 rounded-full text-[11px] font-semibold transition-colors",
                    catTab === tab.key ? "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))]" : "bg-muted/50 text-muted-foreground")}>
                  {tab.label}
                </button>
              ))}
              <button onClick={()=>setCatSel(null)}
                className={cn("shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors",
                  !catSel ? "bg-foreground text-background" : "bg-muted/50 text-muted-foreground")}>
                All
              </button>
              {activeCatTabRows.map(c => {
                const active = catSel === c.cat;
                const col = catColor(c.cat);
                return (
                  <button key={c.cat} onClick={()=>setCatSel(active ? null : c.cat)}
                    style={active ? { backgroundColor: col, color: "white" } : { backgroundColor: withAlpha(col, 0.14), color: vivid(col) }}
                    className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors">
                    {formatCat(c.cat)}
                  </button>
                );
              })}
            </div>
          )}

          {/* Categories; colorful cards, vertically scrollable. Each card
              shows its budget progress if one's set, or a "Set budget" pill
              if not; both routes into the same Manage Budgets dialog. */}
          {SHOW_CATEGORY_SIDEBAR && (expenseCatRows.length > 0 || incomeCatRows.length > 0 || ignoredCatRows.length > 0) && (
            <div className="hidden md:flex surface-card overflow-hidden flex-col max-h-[240px] lg:max-h-none lg:h-full lg:w-[260px] lg:shrink-0">
              <div className="px-3 py-2 border-b border-border/20 flex items-center justify-between shrink-0 gap-2">
                <div className="flex items-center gap-0.5 rounded-full bg-muted/50 p-0.5 shrink-0">
                  {CAT_TABS.map(tab => (
                    <button key={tab.key} onClick={()=>setCatTab(tab.key)} title={tab.title}
                      className={cn("px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors",
                        catTab === tab.key ? "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))]" : "text-muted-foreground hover:text-foreground")}>
                      {tab.label}
                    </button>
                  ))}
                </div>
                <button onClick={()=>setBudgetDialogOpen(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[hsl(var(--primary))] hover:opacity-80 transition-opacity shrink-0">
                  <Wallet className="h-2.5 w-2.5"/> Budget
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none p-1.5 space-y-1">
                {catTab === "ignored" ? ignoredCatRows.map((c,i) => {
                  const col = catColor(c.cat);
                  const active = catSel === c.cat;
                  return (
                    <div key={c.cat} role="button" tabIndex={0}
                      onClick={()=>setCatSel(active?null:c.cat)}
                      onKeyDown={(e)=>{ if (e.key==="Enter"||e.key===" ") { e.preventDefault(); setCatSel(active?null:c.cat); } }}
                      style={{
                        animationDelay:`${i*25}ms`,
                        backgroundColor: active ? `${col}26` : `${col}10`,
                        borderLeft: `3px solid ${col}`,
                      }}
                      className="bento-rise cursor-pointer rounded-md px-2 py-1.5 transition-colors">
                      <span className="text-[11px] font-semibold text-foreground truncate block">{formatCat(c.cat)}</span>
                      <span className="text-[12px] font-bold text-foreground tabular">{fmtUSD(c.spend)}</span>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{c.count} txn{c.count!==1?"s":""} · excluded from spend</div>
                    </div>
                  );
                }) : (catTab === "income" ? incomeCatRows : expenseCatRows).map((c,i) => {
                  const col = catColor(c.cat);
                  const b = budgets[c.cat];
                  const over = b != null && c.spend > b;
                  const actualPct = b ? Math.min((c.spend/b)*100,100) : (b === 0 && c.spend > 0 ? 100 : 0);
                  const active = catSel === c.cat;
                  const isObligation = OBLIGATION_LIKE_CATS.has(c.cat);
                  // Income isn't something you budget *against*; no "+ budget"
                  // prompt, no progress bar, and its month-over-month arrow is
                  // the mirror of an expense category's: more income is good
                  // (green), less is bad (red), the opposite of more spend
                  // being bad.
                  const isIncome = incomeCategories.includes(c.cat);
                  // Obligation categories show "Met" (the payment posted this
                  // period, full stop; comparing it to a "budget" doesn't
                  // make sense for a fixed bill). Budgeted expense categories
                  // show "Over" once spend passes the budget, otherwise show
                  // the budget amount itself, the total set aside for it,
                  // rather than the fluctuating actual spend number.
                  const mainText = isObligation ? "Met" : isIncome ? fmtUSD(c.spend) : over ? "Over" : b != null ? fmtUSD(b) : fmtUSD(c.spend);
                  const mainColor = isObligation || isIncome ? "text-positive" : over ? "text-negative" : "text-foreground";
                  const momUp = c.mom != null && c.mom > 0;
                  const momColor = isIncome ? (momUp ? "text-positive" : "text-negative") : (momUp ? "text-negative" : "text-positive");
                  return (
                    // A plain div (not a <button>) because it needs to contain
                    // its own nested "Set budget" button; real <button>s can't nest.
                    <div key={c.cat} role="button" tabIndex={0}
                      onClick={()=>setCatSel(active?null:c.cat)}
                      onKeyDown={(e)=>{ if (e.key==="Enter"||e.key===" ") { e.preventDefault(); setCatSel(active?null:c.cat); } }}
                      style={{
                        animationDelay:`${i*25}ms`,
                        backgroundColor: active ? `${col}26` : `${col}10`,
                        borderLeft: `3px solid ${col}`,
                      }}
                      className="group/catlistrow bento-rise cursor-pointer rounded-md px-2 py-1.5 transition-colors">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[11px] font-semibold text-foreground truncate flex-1 min-w-0">{formatCat(c.cat)}</span>
                        <button onClick={(e)=>{ e.stopPropagation(); setDetailsCat(c.cat); }}
                          aria-label={`View ${formatCat(c.cat)} details`}
                          // Always visible below the md breakpoint; a
                          // hover-only reveal is undiscoverable on touch
                          // devices, which have no hover state at all, so
                          // this would otherwise be an invisible dead zone
                          // on mobile even though tapping it still works.
                          className="opacity-100 md:opacity-0 md:group-hover/catlistrow:opacity-100 focus:opacity-100 shrink-0 h-4 w-4 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground transition-all">
                          <Pencil className="h-2.5 w-2.5"/>
                        </button>
                        {c.mom !== null && (
                          <span className={cn("text-[11px] font-semibold shrink-0", momColor)}>{c.mom>0?"+":""}{c.mom}%</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={cn("text-[12px] font-bold tabular", mainColor)}>{mainText}</span>
                        {!isObligation && !isIncome && b != null && (
                          <div className="flex-1 h-1 rounded-full bg-black/10 dark:bg-white/10 relative overflow-hidden min-w-[24px]">
                            <div className="absolute inset-y-0 left-0 rounded-full transition-all" style={{width:`${actualPct}%`,background:over?"hsl(var(--negative))":col}}/>
                          </div>
                        )}
                      </div>
                      {isObligation ? (
                        <div className="text-[11px] text-muted-foreground mt-0.5">{fmtUSD(c.spend)} paid this period</div>
                      ) : !isIncome && b != null && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {fmtUSD(c.spend)} spent{over && <span className="text-negative font-semibold"> · {fmtUSD(c.spend-b)} over</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Transaction feed. Fixed-height card with its own internal scroll
              (header stays put, list scrolls beneath it) instead of growing
              the whole page. */}
          <div className="surface-card min-w-0 flex flex-col md:overflow-hidden md:h-[640px]">
            {/* Phones: one scroll (the page). The toolbar sticks to the top of
                the scroll area and the date headings stick right below it,
                instead of a 480px box scrolling inside a scrolling page. */}
            <div ref={toolbarRef} className="px-4 py-3 border-b border-border/20 shrink-0 bg-card/95 max-md:bg-card backdrop-blur-sm space-y-2 max-md:sticky max-md:top-0 max-md:z-20 max-md:rounded-t-[var(--radius)]">
              {selectedIds.size > 0 ? (
                <div className="flex flex-wrap items-center gap-2 [&_button]:max-md:h-10">
                  <span className="text-[12.5px] font-semibold text-foreground shrink-0">{selectedIds.size} selected</span>
                  <button ref={bulkMenu.btnRef} onClick={bulkMenu.toggle}
                    className="h-8 px-3 rounded-lg border border-border/60 bg-muted/40 text-[12px] font-medium text-foreground hover:bg-muted/60 transition-colors shrink-0">
                    Change category
                  </button>
                  {showBulkTagInput ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <input autoFocus value={bulkTagDraft} onChange={e=>setBulkTagDraft(e.target.value)}
                        onKeyDown={e=>{
                          if (e.key==="Enter" && bulkTagDraft.trim() && onAddTag) { selectedIds.forEach(id=>onAddTag(id,bulkTagDraft.trim())); setBulkTagDraft(""); setShowBulkTagInput(false); }
                          if (e.key==="Escape") setShowBulkTagInput(false);
                        }}
                        placeholder="Tag name" className="h-8 w-28 px-2 rounded-lg bg-muted/40 border border-border/60 text-[12px] text-foreground outline-none"/>
                      <button onClick={()=>{ if (bulkTagDraft.trim() && onAddTag) { selectedIds.forEach(id=>onAddTag(id,bulkTagDraft.trim())); setBulkTagDraft(""); setShowBulkTagInput(false); } }}
                        className="h-8 w-8 grid place-items-center rounded-lg bg-gold"><Check className="h-3.5 w-3.5"/></button>
                    </div>
                  ) : (
                    <button onClick={()=>setShowBulkTagInput(true)} disabled={!onAddTag}
                      className="h-8 px-3 rounded-lg border border-border/60 bg-muted/40 text-[12px] font-medium text-foreground hover:bg-muted/60 transition-colors shrink-0 disabled:opacity-40">
                      + Tag
                    </button>
                  )}
                  <button onClick={clearSelection}
                    className="ml-auto h-8 px-3 rounded-lg text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors shrink-0">
                    Clear selection
                  </button>
                  {bulkMenu.open && (
                    <CategoryPickerPopover pos={bulkMenu.pos} current=""
                      expenseCategories={expenseCategories} incomeCategories={incomeCategories} ignoredCategories={ignoredCategories}
                      customCategories={customCategories} categoryIcon={categoryIcon} catColor={catColor} formatCat={formatCat}
                      onSelect={(newCat) => {
                        const idSet = selectedIds;
                        txns.filter(t => idSet.has(t.id)).forEach(t => onSelectCategory(t, newCat));
                      }}
                      onAddCategory={onAddCategory} onRemoveCategory={onRemoveCategory} onRenameCategory={onRenameCategory}
                      onClose={bulkMenu.close}/>
                  )}
                </div>
              ) : (
              <>
              {/* Mobile: three icon buttons instead of the full desktop
                  toolbar; search slides open inline, filter/sort reuse the
                  exact same popovers the desktop buttons open. */}
              <div className="md:hidden flex items-center gap-1.5">
                <button onClick={()=>setMobileSearchOpen(v=>!v)} aria-label="Search" aria-expanded={mobileSearchOpen}
                  className={cn("h-11 w-11 grid place-items-center rounded-xl border shrink-0",
                    mobileSearchOpen || activeSearchTerms.length>0 ? "border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.08)] text-foreground" : "border-border/60 bg-muted/40 text-muted-foreground")}>
                  <Search className="h-4 w-4"/>
                </button>
                {mobileSearchOpen && (
                  <div className="relative flex-1 min-w-0">
                    <input autoFocus type="search" enterKeyHint="search" value={searchDraft} onChange={e=>setSearchDraft(e.target.value)}
                      onKeyDown={e=>{ if (e.key==="Enter") { e.preventDefault(); commitSearchDraft(); } if (e.key==="Escape") { setSearchDraft(""); setMobileSearchOpen(false); } }}
                      placeholder="Search transactions" aria-label="Search transactions"
                      className="w-full h-11 pl-3 pr-10 rounded-xl bg-muted/40 border border-border/60 text-[15px] text-foreground outline-none focus:border-[hsl(var(--primary)/0.5)] [&::-webkit-search-cancel-button]:hidden"/>
                    <button onClick={()=>{ if (searchDraft) { setSearchDraft(""); setLiveSearch(""); } else setMobileSearchOpen(false); }}
                      aria-label={searchDraft ? "Clear search" : "Close search"}
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4"/>
                    </button>
                  </div>
                )}
                <div className={cn("flex items-center gap-1.5 ml-auto", mobileSearchOpen && "hidden")}>
                  <button ref={sortMenu.btnRef} onClick={sortMenu.toggle} aria-label="Sort"
                    className={cn("h-11 w-11 grid place-items-center rounded-xl border shrink-0",
                      hasActiveSort ? "border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.08)] text-foreground" : "border-border/60 bg-muted/40 text-muted-foreground")}>
                    <ArrowUpDown className="h-4 w-4"/>
                  </button>
                  <button ref={filtersMenu.btnRef} onClick={filtersMenu.toggle} aria-label="Filter"
                    className={cn("h-11 w-11 grid place-items-center rounded-xl border shrink-0",
                      hasActiveFilters ? "border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.08)] text-foreground" : "border-border/60 bg-muted/40 text-muted-foreground")}>
                    <Filter className="h-4 w-4"/>
                  </button>
                </div>
              </div>

              <div className="hidden md:flex items-center gap-1.5 flex-wrap">
                <div className="relative w-56 shrink-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none"/>
                  <input type="search" value={searchDraft} onChange={e=>setSearchDraft(e.target.value)}
                    onKeyDown={e=>{ if (e.key==="Enter") { e.preventDefault(); commitSearchDraft(); } if (e.key==="Escape") setSearchDraft(""); }}
                    placeholder="Search transactions" aria-label="Search transactions" title="Filters as you type; press Enter to pin the term"
                    className="w-full h-8 pl-8 pr-8 rounded-xl bg-muted/40 border border-border/60 text-[13px] text-foreground outline-none focus:border-[hsl(var(--primary)/0.5)] [&::-webkit-search-cancel-button]:hidden"/>
                  {searchDraft && (
                    <button onClick={()=>{ setSearchDraft(""); setLiveSearch(""); }} aria-label="Clear search"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center rounded-md text-muted-foreground hover:text-foreground">
                      <X className="h-3.5 w-3.5"/>
                    </button>
                  )}
                </div>

                <button ref={accountsMenu.btnRef} onClick={accountsMenu.toggle}
                  className={cn("h-7 pl-2.5 pr-2 rounded-lg border text-[11.5px] font-medium flex items-center gap-1.5 transition-colors shrink-0 max-w-[170px]",
                    accountFilters.length>0 ? "border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.08)] text-foreground" : "border-border/60 bg-muted/40 text-foreground hover:bg-muted/60")}>
                  <Landmark className="h-3 w-3 shrink-0"/>
                  <span className="truncate">
                    {accountFilters.length===0
                      ? "All accounts"
                      : accountFilters.length===1
                        ? (accountsInPeriod.find(a=>a.account_id===accountFilters[0])?.name ?? "1 account")
                        : `${accountFilters.length} accounts`}
                  </span>
                </button>

                <button ref={groupMenu.btnRef} onClick={groupMenu.toggle}
                  className={cn("h-7 px-2.5 rounded-lg border text-[11.5px] font-medium flex items-center gap-1.5 transition-colors shrink-0",
                    groupBy!=="none" ? "border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.08)] text-foreground" : "border-border/60 bg-muted/40 text-foreground hover:bg-muted/60")}>
                  <Layers className="h-3 w-3"/> Group
                </button>
                {groupBy!=="none" && (
                  <button onClick={allGroupsCollapsed ? expandAllGroups : collapseAllGroups}
                    title={allGroupsCollapsed ? "Expand all groups" : "Collapse all groups"}
                    className="h-7 w-7 grid place-items-center rounded-lg border border-border/60 bg-muted/40 text-foreground hover:bg-muted/60 transition-colors shrink-0">
                    {allGroupsCollapsed ? <ChevronsUpDown className="h-3.5 w-3.5"/> : <ChevronsDownUp className="h-3.5 w-3.5"/>}
                  </button>
                )}

                <button ref={filtersMenu.btnRef} onClick={filtersMenu.toggle}
                  className={cn("h-7 px-2.5 rounded-lg border text-[11.5px] font-medium flex items-center gap-1.5 transition-colors shrink-0",
                    hasActiveFilters ? "border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.08)] text-foreground" : "border-border/60 bg-muted/40 text-foreground hover:bg-muted/60")}>
                  <Search className="h-3 w-3"/> Filter by
                </button>
                <button ref={sortMenu.btnRef} onClick={sortMenu.toggle}
                  className={cn("h-7 px-2.5 rounded-lg border text-[11.5px] font-medium flex items-center gap-1.5 transition-colors shrink-0",
                    hasActiveSort ? "border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.08)] text-foreground" : "border-border/60 bg-muted/40 text-foreground hover:bg-muted/60")}>
                  <ArrowUpDown className="h-3 w-3"/> Sort
                </button>
                {/* Secondary tools (Columns / Rules / Import) live behind one
                    "More" button instead of three unlabeled icon buttons. The
                    Columns picker anchors to this same button. */}
                <button ref={colsMenu.btnRef} onClick={moreMenu.toggle} aria-label="More list options" aria-haspopup="menu" aria-expanded={moreMenu.open} title="More"
                  className={cn("h-7 w-7 grid place-items-center rounded-lg border transition-colors shrink-0",
                    moreMenu.open || colsMenu.open ? "border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.08)] text-foreground" : "border-border/60 bg-muted/40 text-foreground hover:bg-muted/60")}>
                  <MoreHorizontal className="h-3.5 w-3.5"/>
                </button>
                {moreMenu.open && moreMenu.pos && createPortal(
                  <>
                    <div className="fixed inset-0 z-[998]" onClick={moreMenu.close}/>
                    <div role="menu" className="spending-v2 fixed z-[999] w-56 rounded-xl border border-border/60 bg-card shadow-2xl p-1"
                      style={{ top: moreMenu.pos.top, bottom: moreMenu.pos.bottom, right: moreMenu.pos.right }}>
                      {([
                        { label: "Columns…", hint: "Show, hide or reset columns", Icon: Settings, run: () => colsMenu.toggle() },
                        ...(onOpenRules ? [{ label: "Rules", hint: "View and run transaction rules", Icon: Wand2, run: onOpenRules }] : []),
                        ...(onOpenImport ? [{ label: "Import statement", hint: "Import a bank statement PDF", Icon: Upload, run: onOpenImport }] : []),
                      ]).map(({ label, hint, Icon, run }) => (
                        <button key={label} role="menuitem" onClick={() => { moreMenu.close(); run(); }}
                          className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-muted/60">
                          <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0"/>
                          <span className="min-w-0">
                            <span className="block text-[12.5px] font-medium text-foreground">{label}</span>
                            <span className="block text-[11px] text-muted-foreground">{hint}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </>,
                  document.body
                )}
              </div>

              {/* Active filter/sort/group chips; their own row below the
                  search/toolbar row so the search box and buttons above never
                  resize or wrap as chips are added or removed. Each is
                  individually removable. */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {groupBy!=="none" && (
                  <span className="inline-flex items-center gap-1 h-6 pl-2.5 pr-1.5 rounded-full bg-[hsl(var(--primary)/0.12)] border border-[hsl(var(--primary)/0.3)] text-[11.5px] font-medium text-[hsl(var(--primary))] shrink-0">
                    Group: {GROUP_OPTIONS.find(g=>g.key===groupBy)?.label}
                    <button onClick={()=>setGroupBy("none")} aria-label="Clear grouping" className="h-3.5 w-3.5 rounded-full grid place-items-center hover:bg-[hsl(var(--primary)/0.25)]"><X className="h-2.5 w-2.5"/></button>
                  </span>
                )}
                {hasActiveSort && (
                  <span className="inline-flex items-center gap-1 h-6 pl-2.5 pr-1.5 rounded-full bg-[hsl(var(--primary)/0.12)] border border-[hsl(var(--primary)/0.3)] text-[11.5px] font-medium text-[hsl(var(--primary))] shrink-0">
                    Sort: {SORT_LABELS[sortBy]} {sortDesc ? "↓" : "↑"}
                    <button onClick={clearSort} aria-label="Clear sort" className="h-3.5 w-3.5 rounded-full grid place-items-center hover:bg-[hsl(var(--primary)/0.25)]"><X className="h-2.5 w-2.5"/></button>
                  </span>
                )}
                {searchTerms.map(term => (
                  <span key={term} className="inline-flex items-center gap-1 h-6 pl-2.5 pr-1.5 rounded-full bg-muted/60 border border-border/60 text-[11.5px] font-medium text-foreground shrink-0">
                    "{term}"
                    <button onClick={()=>removeSearchTerm(term)} aria-label={`Clear search filter ${term}`} className="h-3.5 w-3.5 rounded-full grid place-items-center hover:bg-muted"><X className="h-2.5 w-2.5"/></button>
                  </span>
                ))}
                {accountFilters.length > 0 && (
                  <span className="inline-flex items-center gap-1 h-6 pl-2.5 pr-1.5 rounded-full bg-muted/60 border border-border/60 text-[11.5px] font-medium text-foreground shrink-0">
                    {accountFilters.length === 1 ? (accountsInPeriod.find(a=>a.account_id===accountFilters[0])?.name ?? "Account") : `${accountFilters.length} accounts`}
                    <button onClick={()=>setAccountFilters([])} aria-label="Clear account filter" className="h-3.5 w-3.5 rounded-full grid place-items-center hover:bg-muted"><X className="h-2.5 w-2.5"/></button>
                  </span>
                )}
                {amountMode==="range" ? (minAmount || maxAmount) && (
                  <span className="inline-flex items-center gap-1 h-6 pl-2.5 pr-1.5 rounded-full bg-muted/60 border border-border/60 text-[11.5px] font-medium text-foreground shrink-0">
                    ${minAmount||"0"} – ${maxAmount||"∞"}
                    <button onClick={()=>{setMinAmount("");setMaxAmount("");}} aria-label="Clear amount filter" className="h-3.5 w-3.5 rounded-full grid place-items-center hover:bg-muted"><X className="h-2.5 w-2.5"/></button>
                  </span>
                ) : fixedAmount && (
                  <span className="inline-flex items-center gap-1 h-6 pl-2.5 pr-1.5 rounded-full bg-muted/60 border border-border/60 text-[11.5px] font-medium text-foreground shrink-0">
                    = ${fixedAmount}
                    <button onClick={()=>setFixedAmount("")} aria-label="Clear amount filter" className="h-3.5 w-3.5 rounded-full grid place-items-center hover:bg-muted"><X className="h-2.5 w-2.5"/></button>
                  </span>
                )}
                {typeFilter!=="all" && (
                  <span className="inline-flex items-center gap-1 h-6 pl-2.5 pr-1.5 rounded-full bg-muted/60 border border-border/60 text-[11.5px] font-medium text-foreground shrink-0">
                    {typeFilter==="in" ? "Incoming" : "Outgoing"}
                    <button onClick={()=>setTypeFilter("all")} aria-label="Clear type filter" className="h-3.5 w-3.5 rounded-full grid place-items-center hover:bg-muted"><X className="h-2.5 w-2.5"/></button>
                  </span>
                )}
                {tagFilter.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 h-6 pl-2.5 pr-1.5 rounded-full bg-muted/60 border border-border/60 text-[11.5px] font-medium text-foreground shrink-0">
                    #{tag}
                    <button onClick={()=>toggleTagFilter(tag)} aria-label={`Clear tag ${tag}`} className="h-3.5 w-3.5 rounded-full grid place-items-center hover:bg-muted"><X className="h-2.5 w-2.5"/></button>
                  </span>
                ))}
                {dateMode!=="none" && (
                  <span className="inline-flex items-center gap-1 h-6 pl-2.5 pr-1.5 rounded-full bg-muted/60 border border-border/60 text-[11.5px] font-medium text-foreground shrink-0">
                    {dateMode==="range" ? `${dateFrom||"…"} – ${dateTo||"…"}` : dateMode==="lastN" ? `Last ${lastNDays}d` : (filterYear ? `Year ${filterYear}` : "All years")}
                    <button onClick={()=>setDateMode("none")} aria-label="Clear date filter" className="h-3.5 w-3.5 rounded-full grid place-items-center hover:bg-muted"><X className="h-2.5 w-2.5"/></button>
                  </span>
                )}
                {granularity==="year" && (
                  <span className="inline-flex items-center gap-1 h-6 pl-2.5 pr-1.5 rounded-full bg-muted/60 border border-border/60 text-[11.5px] font-medium text-foreground shrink-0">
                    Year: {yearBuckets[selYearIdx]?.label}
                    <button onClick={()=>{ setGranularity("all"); setYearOffset(0); }} aria-label="Clear year view" className="h-3.5 w-3.5 rounded-full grid place-items-center hover:bg-muted"><X className="h-2.5 w-2.5"/></button>
                  </span>
                )}

                {(hasActiveFilters || catSel) && (
                  <button onClick={()=>{ clearFilters(); setCatSel(null); }}
                    className="ml-auto flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-negative/10 border border-negative/30 text-[11.5px] text-negative font-semibold hover:bg-negative/15 transition-colors shrink-0">
                    <X className="h-3 w-3"/> Clear all filters
                  </button>
                )}
              </div>
              </>
              )}

              {filtersMenu.open && filtersMenu.pos && createPortal(
                <>
                  <div className="fixed inset-0 z-[998] max-md:bg-black/40 max-md:animate-in max-md:fade-in-0" onClick={filtersMenu.close}/>
                  {/* Desktop: popover under the button. Phones: a bottom sheet
                      (full width, thumb-reachable, clear of the home indicator). */}
                  <div role="dialog" aria-label="Filters"
                    className="spending-v2 fixed z-[999] w-80 max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border border-border/60 bg-card shadow-2xl p-3 space-y-3
                      max-md:!top-auto max-md:!bottom-0 max-md:!left-0 max-md:!right-0 max-md:w-full max-md:max-w-none max-md:!max-h-[85dvh] max-md:rounded-b-none max-md:rounded-t-2xl max-md:px-4 max-md:pt-2 max-md:pb-0
                      max-md:animate-in max-md:slide-in-from-bottom-full max-md:duration-200"
                    style={{top:filtersMenu.pos.top, bottom:filtersMenu.pos.bottom, right:filtersMenu.pos.right, maxHeight:filtersMenu.pos.maxHeight}} onClick={e=>e.stopPropagation()}>
                    <div className="md:hidden flex flex-col items-center gap-2 pb-1">
                      <span className="h-1 w-10 rounded-full bg-border" aria-hidden/>
                      <div className="w-full flex items-center justify-between">
                        <span className="text-[15px] font-semibold text-foreground">Filters</span>
                        {hasActiveFilters && <button onClick={clearFilters} className="h-9 px-2 text-[13px] font-medium text-[hsl(var(--primary))]">Clear all</button>}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-1">Category</div>
                      <select value={catSel ?? ""} onChange={e=>setCatSel(e.target.value || null)}
                        className="w-full h-8 px-2 rounded-lg bg-muted/40 border border-border/60 text-[12px] text-foreground outline-none">
                        <option value="">All categories</option>
                        {categoriesInPeriod.map(c => <option key={c} value={c}>{formatCat(c)}</option>)}
                      </select>
                    </div>

                    {tagsInPeriod.length > 0 && (
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-1">Tags</div>
                        <div className="flex flex-wrap gap-1">
                          {tagsInPeriod.map(tag => (
                            <button key={tag} onClick={()=>toggleTagFilter(tag)}
                              className={cn("h-6 px-2 rounded-full border text-[11px] font-medium transition-colors",
                                tagFilter.includes(tag) ? "border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]" : "border-border/60 text-muted-foreground hover:text-foreground")}>
                              {tag}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-1">Date</div>
                      <div className="flex gap-1 mb-1.5">
                        {([["none","Period"],["range","Range"],["lastN","Last N days"],["year","Year"]] as const).map(([k,l]) => (
                          <button key={k} onClick={()=>setDateMode(k)}
                            className={cn("flex-1 h-7 rounded-lg text-[11px] font-medium border transition-colors",
                              dateMode===k ? "bg-foreground text-background border-foreground" : "border-border/50 text-muted-foreground")}>
                            {l}
                          </button>
                        ))}
                      </div>
                      {dateMode==="range" && (
                        <div className="flex items-center gap-1.5">
                          <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className="flex-1 h-8 px-1.5 rounded-lg bg-muted/40 border border-border/60 text-[11px] text-foreground outline-none"/>
                          <span className="text-muted-foreground/40 text-[11px]">to</span>
                          <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} className="flex-1 h-8 px-1.5 rounded-lg bg-muted/40 border border-border/60 text-[11px] text-foreground outline-none"/>
                        </div>
                      )}
                      {dateMode==="lastN" && (
                        <div className="flex items-center gap-1.5">
                          <input type="number" min={1} value={lastNDays} onChange={e=>setLastNDays(e.target.value)} className="w-16 h-8 px-2 rounded-lg bg-muted/40 border border-border/60 text-[12px] text-foreground outline-none"/>
                          <span className="text-[11.5px] text-muted-foreground">days</span>
                        </div>
                      )}
                      {dateMode==="year" && (
                        <div className="flex items-center gap-2">
                          <input type="number" value={filterYear} disabled={filterYear===""} onChange={e=>setFilterYear(e.target.value)}
                            className="w-24 h-8 px-2 rounded-lg bg-muted/40 border border-border/60 text-[12px] text-foreground outline-none disabled:opacity-40"/>
                          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
                            <input type="checkbox" checked={filterYear===""}
                              onChange={e=>setFilterYear(e.target.checked ? "" : String(new Date().getFullYear()))}/>
                            All years
                          </label>
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-1">Money in / out</div>
                      <div className="flex gap-1">
                        {([["all","All"],["in","Incoming"],["out","Outgoing"]] as const).map(([k,l]) => (
                          <button key={k} onClick={()=>setTypeFilter(k)}
                            className={cn("flex-1 h-7 rounded-lg text-[11px] font-medium border transition-colors",
                              typeFilter===k ? "bg-foreground text-background border-foreground" : "border-border/50 text-muted-foreground")}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-1">Amount</div>
                      <div className="flex gap-1 mb-1.5">
                        {([["range","Range"],["fixed","Exact"]] as const).map(([k,l]) => (
                          <button key={k} onClick={()=>setAmountMode(k)}
                            className={cn("flex-1 h-7 rounded-lg text-[11px] font-medium border transition-colors",
                              amountMode===k ? "bg-foreground text-background border-foreground" : "border-border/50 text-muted-foreground")}>
                            {l}
                          </button>
                        ))}
                      </div>
                      {amountMode==="range" ? (
                        <div className="flex items-center gap-1 h-8 px-2 rounded-lg bg-muted/40 border border-border/60">
                          <span className="text-[11px] text-muted-foreground">$</span>
                          <input type="number" inputMode="decimal" min={0} placeholder="Min" value={minAmount} onChange={e=>setMinAmount(e.target.value)}
                            className="w-full bg-transparent text-[11.5px] text-foreground outline-none placeholder:text-muted-foreground/60"/>
                          <span className="text-muted-foreground/40">–</span>
                          <input type="number" inputMode="decimal" min={0} placeholder="Max" value={maxAmount} onChange={e=>setMaxAmount(e.target.value)}
                            className="w-full bg-transparent text-[11.5px] text-foreground outline-none placeholder:text-muted-foreground/60"/>
                        </div>
                      ) : (
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">$</span>
                          <input type="number" inputMode="decimal" min={0} placeholder="Exact amount" value={fixedAmount} onChange={e=>setFixedAmount(e.target.value)}
                            className="w-full h-8 pl-5 pr-2 rounded-lg bg-muted/40 border border-border/60 text-[12px] text-foreground outline-none"/>
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-1">Ignored</div>
                      <div className="flex gap-1">
                        {([["no","No"],["yes","Yes"]] as const).map(([k,l]) => (
                          <button key={k} onClick={()=>toggleIgnoredFilter(k)}
                            className={cn("flex-1 h-7 rounded-lg text-[11px] font-medium border transition-colors",
                              ignoredFilter===k ? "bg-foreground text-background border-foreground" : "border-border/50 text-muted-foreground")}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="md:hidden sticky bottom-0 -mx-4 px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-card border-t border-border/20">
                      <button onClick={filtersMenu.close}
                        className="w-full h-11 rounded-xl bg-[hsl(var(--primary))] text-primary-foreground text-[14px] font-semibold">
                        Show {visibleTxns.length.toLocaleString()} {visibleTxns.length === 1 ? "transaction" : "transactions"}
                      </button>
                    </div>
                  </div>
                </>,
                document.body
              )}

              {sortMenu.open && sortMenu.pos && createPortal(
                <>
                  <div className="fixed inset-0 z-[998]" onClick={sortMenu.close}/>
                  <div role="menu" aria-label="Sort transactions" className="spending-v2 fixed z-[999] w-48 rounded-xl border border-border/60 bg-card shadow-2xl p-1.5"
                    style={{top:sortMenu.pos.top, bottom:sortMenu.pos.bottom, right:sortMenu.pos.right}} onClick={e=>e.stopPropagation()}>
                    {(["date","amount"] as const).map(key => (
                      <button key={key} onClick={()=>{ handleSort(key); }}
                        className={cn("w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[12.5px] transition-colors",
                          sortBy===key ? "bg-muted/50 text-foreground font-medium" : "text-muted-foreground hover:bg-muted/30")}>
                        {SORT_LABELS[key]}
                        {sortBy===key && (sortDesc ? <ArrowDown className="h-3 w-3"/> : <ArrowUp className="h-3 w-3"/>)}
                      </button>
                    ))}
                  </div>
                </>,
                document.body
              )}

            </div>
            {/* The desktop table is fitted to this container (tableCols drops
                low-priority columns that don't fit), so it normally never
                scrolls sideways; overflow-x-auto is only a safety net so a
                column can never be silently clipped. */}
            <div ref={tableWrapRef} className="md:overflow-y-auto md:overflow-x-auto scrollbar-none flex-1">
              {visibleTxns.length === 0 ? (
                <div className="py-14 px-6 text-center space-y-3">
                  {(hasActiveFilters || catSel) ? (
                    <>
                      <div className="text-[14px] font-semibold text-foreground">No transactions match these filters</div>
                      <div className="text-[12.5px] text-muted-foreground">Try removing a filter or search term.</div>
                      <button onClick={()=>{ clearFilters(); setCatSel(null); }}
                        className="h-9 px-4 rounded-lg border border-border/60 bg-muted/40 text-[13px] font-medium text-foreground hover:bg-muted/60 transition-colors">
                        Clear filters
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="text-[14px] font-semibold text-foreground">
                        No {catTab === "income" ? "income" : catTab === "ignored" ? "ignored transactions" : "spending"} {granularity === "all" ? "on record" : `in ${activeRange.label.toLowerCase() === "this month" ? "this month" : activeRange.label}`}
                      </div>
                      <div className="text-[12.5px] text-muted-foreground">
                        {granularity === "all" ? "Transactions appear here once your accounts sync." : "Pick another period, or view everything."}
                      </div>
                      {granularity !== "all" && (
                        <button onClick={()=>setGranularity("all")}
                          className="h-9 px-4 rounded-lg border border-border/60 bg-muted/40 text-[13px] font-medium text-foreground hover:bg-muted/60 transition-colors">
                          View all time
                        </button>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <>
                  {/* Desktop/tablet: real table with resizable, sortable columns. */}
                  <table className="hidden md:table w-full text-left border-collapse table-fixed">
                    <colgroup>
                      <col style={{width: 32}}/>
                      <col/>
                      {tableCols.has("date") && <col style={{width: colWidths.date}}/>}
                      {tableCols.has("amount") && <col style={{width: colWidths.amount}}/>}
                      {tableCols.has("statement") && <col style={{width: colWidths.statement}}/>}
                      {tableCols.has("category") && <col style={{width: colWidths.category}}/>}
                      {tableCols.has("status") && <col style={{width: colWidths.status}}/>}
                      {tableCols.has("account") && <col style={{width: colWidths.account}}/>}
                    </colgroup>
                    <thead className="sticky top-0 z-[5] bg-card">
                      <tr className="border-b border-border/20">
                        <th className="px-2 py-2">
                          <input type="checkbox" aria-label="Select all visible transactions"
                            checked={renderedTableTxns.length>0 && renderedTableTxns.every(t=>selectedIds.has(t.id))}
                            onChange={e=>{
                              if (e.target.checked) setSelectedIds(new Set(renderedTableTxns.map(t=>t.id)));
                              else clearSelection();
                            }}
                            className="h-3.5 w-3.5 rounded accent-[hsl(var(--primary))]"/>
                        </th>
                        <SortableTh label="Vendor" active={sortBy==="name"} desc={sortDesc} onClick={()=>handleSort("name")} />
                        {tableCols.has("date") && <SortableTh label="Date" active={sortBy==="date"} desc={sortDesc} onClick={()=>handleSort("date")} onResizeStart={startColResize("date")} />}
                        {tableCols.has("amount") && <SortableTh label="Amount" align="right" active={sortBy==="amount"} desc={sortDesc} onClick={()=>handleSort("amount")} onResizeStart={startColResize("amount")} />}
                        {tableCols.has("statement") && <SortableTh label="Statement Desc." active={sortBy==="statement"} desc={sortDesc} onClick={()=>handleSort("statement")} onResizeStart={startColResize("statement")} />}
                        {tableCols.has("category") && <SortableTh label="Category" active={sortBy==="category"} desc={sortDesc} onClick={()=>handleSort("category")} onResizeStart={startColResize("category")} />}
                        {tableCols.has("status") && <SortableTh label="Status" active={sortBy==="status"} desc={sortDesc} onClick={()=>handleSort("status")} onResizeStart={startColResize("status")} />}
                        {tableCols.has("account") && <SortableTh label="Account" active={sortBy==="account"} desc={sortDesc} onClick={()=>handleSort("account")} onResizeStart={startColResize("account")} isLast/>}
                      </tr>
                    </thead>
                    {groupedTxns ? desktopPage.groups.map(g => {
                      const isCollapsed = collapsedGroups.has(g.key);
                      return (
                      <tbody key={g.key}>
                        <tr className="bg-muted/30 cursor-pointer hover:bg-muted/50" onClick={()=>toggleGroupCollapsed(g.key)}>
                          <td colSpan={colSpan} className="px-4 py-2 border-b border-border/15">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform", isCollapsed && "-rotate-90")}/>
                                <span className="text-[12px] font-semibold text-foreground truncate">{groupHeading(g.key)}</span>
                                <span className="shrink-0 text-[11px] font-medium text-muted-foreground bg-border/30 rounded-full px-1.5 py-0.5">
                                  {g.items.length} {g.items.length===1?"txn":"txns"}
                                </span>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-[11px] text-muted-foreground uppercase tracking-wide leading-none">Subtotal</div>
                                <div className={cn("text-[13px] font-bold tabular leading-tight mt-0.5", txnAmountClass(g.total))}>{fmtTxnAmount(g.total)}</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                        {!isCollapsed && g.shown.map(t => (
                          <TxnRow key={t.id} t={t} visibleCols={tableCols} getEffectiveCategory={getEffectiveCategory} catColor={catColor} formatCat={formatCat}
                            nameOverrides={nameOverrides} accounts={accounts} onOpenDetail={onOpenDetail} recurringKeys={recurringMerchantKeys}
                            categoryIcon={categoryIcon} expenseCategories={expenseCategories} incomeCategories={incomeCategories}
                            ignoredCategories={ignoredCategories} customCategories={customCategories}
                            onSelectCategory={onSelectCategory} onAddCategory={onAddCategory} onRemoveCategory={onRemoveCategory} onRenameCategory={onRenameCategory}
                            selected={selectedIds.has(t.id)} onToggleSelect={toggleSelect} flag={txnFlags.get(t.id)}
                            txnType={flowOf(t)} edited={isTypeEdited(t)} onChangeType={changeTxnType}/>
                        ))}
                      </tbody>
                      );
                    }) : (
                      <tbody>
                        {renderedTableTxns.map(t => (
                          <TxnRow key={t.id} t={t} visibleCols={tableCols} getEffectiveCategory={getEffectiveCategory} catColor={catColor} formatCat={formatCat}
                            nameOverrides={nameOverrides} accounts={accounts} onOpenDetail={onOpenDetail} recurringKeys={recurringMerchantKeys}
                            categoryIcon={categoryIcon} expenseCategories={expenseCategories} incomeCategories={incomeCategories}
                            ignoredCategories={ignoredCategories} customCategories={customCategories}
                            onSelectCategory={onSelectCategory} onAddCategory={onAddCategory} onRemoveCategory={onRemoveCategory} onRenameCategory={onRenameCategory}
                            selected={selectedIds.has(t.id)} onToggleSelect={toggleSelect} flag={txnFlags.get(t.id)}
                            txnType={flowOf(t)} edited={isTypeEdited(t)} onChangeType={changeTxnType}/>
                        ))}
                      </tbody>
                    )}
                  </table>
                  {desktopPage.more && (
                    <div className="hidden md:flex justify-center py-3 border-t border-border/15">
                      <button onClick={()=>setRowLimit(l=>l+ROW_PAGE)}
                        className="h-8 px-4 rounded-lg border border-border/60 bg-muted/40 text-[12.5px] font-medium text-foreground hover:bg-muted/70">
                        Show {Math.min(ROW_PAGE, desktopPage.hidden) || ""} more{desktopPage.hidden > ROW_PAGE ? ` (${desktopPage.hidden.toLocaleString()} left)` : ""}
                      </button>
                    </div>
                  )}

                  {/* Mobile: no table; a date-grouped, fixed-row-height feed
                      instead, always grouped by date (see mobileGroups above)
                      regardless of the desktop Group-by control, with each
                      date section independently collapsible. */}
                  <div className="md:hidden">
                    {mobilePage.groups.map(g => {
                      const isCollapsed = g.key !== MOBILE_FLAT_KEY && collapsedGroups.has(g.key);
                      return (
                      <div key={g.key}>
                        {g.key !== MOBILE_FLAT_KEY && (
                        <div className="sticky z-10 bg-card border-b border-border/15 px-4 py-2 flex items-center justify-between gap-3 cursor-pointer active:bg-muted/50"
                          style={{ top: toolbarH }} onClick={()=>toggleGroupCollapsed(g.key)}>
                          <div className="flex items-center gap-2 min-w-0">
                            <ChevronDown className={cn("h-3 w-3 text-muted-foreground shrink-0 transition-transform", isCollapsed && "-rotate-90")}/>
                            <span className="text-[11px] font-semibold text-muted-foreground">{mobileGroupHeading(g.key)}</span>
                          </div>
                          <span className={cn("text-[11px] tabular shrink-0", g.total < 0 ? "text-positive" : "text-muted-foreground")}>{fmtTxnAmount(g.total)}</span>
                        </div>
                        )}
                        {!isCollapsed && (
                        <div className="divide-y divide-border/10">
                          {g.shown.map(t => (
                            <MobileTxnRow key={t.id} t={t} visibleCols={visibleCols} showDate={g.key === MOBILE_FLAT_KEY} selectionMode={selectedIds.size > 0} getEffectiveCategory={getEffectiveCategory} catColor={catColor} formatCat={formatCat}
                              nameOverrides={nameOverrides} accounts={accounts} onOpenDetail={onOpenDetail} recurringKeys={recurringMerchantKeys}
                            categoryIcon={categoryIcon} expenseCategories={expenseCategories} incomeCategories={incomeCategories}
                            ignoredCategories={ignoredCategories} customCategories={customCategories}
                            onSelectCategory={onSelectCategory} onAddCategory={onAddCategory} onRemoveCategory={onRemoveCategory} onRenameCategory={onRenameCategory}
                            selected={selectedIds.has(t.id)} onToggleSelect={toggleSelect} flag={txnFlags.get(t.id)}
                            txnType={flowOf(t)} edited={isTypeEdited(t)} onChangeType={changeTxnType}/>
                          ))}
                        </div>
                        )}
                      </div>
                      );
                    })}
                    {mobilePage.more && (
                      <div className="flex justify-center px-4 py-4 border-t border-border/15">
                        <button onClick={()=>setRowLimit(l=>l+ROW_PAGE)}
                          className="h-11 w-full rounded-xl border border-border/60 bg-muted/40 text-[14px] font-medium text-foreground active:bg-muted/70">
                          Show more{mobilePage.hidden ? ` (${mobilePage.hidden.toLocaleString()} left)` : ""}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Burn-chart dot tooltip; portaled to <body> so it's never clipped by
          the chart cards' overflow-hidden (needed to hide the swipeable
          carousel's off-screen panel). Positioned from the dot's real
          on-screen coordinates, captured on hover. */}
      {dotTooltip && createPortal(
        <div className="spending-v2 fixed z-[400] w-max max-w-[190px] rounded-lg bg-popover border border-border shadow-xl px-2.5 py-1.5 pointer-events-none"
          style={{
            left: dotTooltip.x, top: dotTooltip.above ? dotTooltip.y - 8 : dotTooltip.y + 8,
            transform: `translate(-50%, ${dotTooltip.above ? "-100%" : "0"})`,
          }}>
          {dotTooltip.content}
        </div>,
        document.body
      )}

      {/* Columns picker; portaled to <body> and positioned from the button's
          real screen coordinates so it always renders above the table's
          sticky header instead of getting clipped/overlapped by it. */}
      {colsMenu.open && colsMenu.pos && createPortal(
        <>
          <div className="fixed inset-0 z-[998]" onClick={colsMenu.close}/>
          <div className="spending-v2 fixed z-[999] w-48 surface-elevated rounded-xl shadow-2xl overflow-y-auto py-1"
            style={{ top: colsMenu.pos.top, bottom: colsMenu.pos.bottom, right: colsMenu.pos.right, maxHeight: colsMenu.pos.maxHeight, border: "1px solid var(--gold-border)" }}>
            <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Show columns</div>
            {COLUMN_DEFS.map(c => {
              const checked = visibleCols.has(c.key);
              return (
                <button key={c.key} onClick={()=>toggleCol(c.key)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-secondary/50 transition-colors text-[13px] text-foreground">
                  <div className={cn("h-4 w-4 rounded border grid place-items-center shrink-0 transition-colors",
                    checked ? "bg-[hsl(var(--primary))] border-[hsl(var(--primary))]" : "border-border-strong")}>
                    {checked && <Check className="h-3 w-3 text-primary-foreground"/>}
                  </div>
                  <span className="flex-1">{c.label}</span>
                  {checked && !tableCols.has(c.key) && (
                    <span className="hidden md:inline text-[11px] text-muted-foreground" title="Not enough room at this window width">hidden</span>
                  )}
                </button>
              );
            })}
            {/* Column widths only apply to the desktop table (mobile renders
                a stacked card list instead), so this reset is desktop-only too. */}
            <div className="hidden md:block border-t border-border/40 mt-1 pt-1">
              <button onClick={()=>{ setColWidths(DEFAULT_COL_WIDTHS); colsMenu.close(); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-secondary/50 transition-colors text-[13px] text-foreground">
                <Maximize2 className="h-3.5 w-3.5 text-muted-foreground"/> Autofit columns
              </button>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Group-by picker; same portal pattern as Columns above. */}
      {groupMenu.open && groupMenu.pos && createPortal(
        <>
          <div className="fixed inset-0 z-[998]" onClick={groupMenu.close}/>
          <div className="spending-v2 fixed z-[999] w-44 surface-elevated rounded-xl shadow-2xl overflow-y-auto py-1"
            style={{ top: groupMenu.pos.top, bottom: groupMenu.pos.bottom, right: groupMenu.pos.right, maxHeight: groupMenu.pos.maxHeight, border: "1px solid var(--gold-border)" }}>
            <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Group by</div>
            {GROUP_OPTIONS.map(g => (
              <button key={g.key} onClick={()=>{ setGroupBy(g.key); groupMenu.close(); }}
                className={cn("w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-secondary/50 transition-colors text-[13px]",
                  groupBy===g.key ? "text-[hsl(var(--primary))] font-semibold" : "text-foreground")}>
                {g.label}
                {groupBy===g.key && <Check className="h-3.5 w-3.5"/>}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}

      {/* Accounts filter; checkbox multi-select grouped the same way the
          Accounts tab groups accounts (Checking/Savings/Credit Cards/...),
          with a group-level checkbox so "every credit card" is one click
          instead of ticking each card. Replaces the old single-account
          <select> so more than one account can be filtered to at once. */}
      {accountsMenu.open && accountsMenu.pos && createPortal(
        <>
          <div className="fixed inset-0 z-[998]" onClick={accountsMenu.close}/>
          <div className="spending-v2 fixed z-[999] w-64 surface-elevated rounded-xl shadow-2xl overflow-y-auto py-1"
            style={{ top: accountsMenu.pos.top, bottom: accountsMenu.pos.bottom, right: accountsMenu.pos.right, maxHeight: accountsMenu.pos.maxHeight, border: "1px solid var(--gold-border)" }}>
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Accounts</span>
              {accountFilters.length > 0 && (
                <button onClick={()=>setAccountFilters([])} className="text-[10.5px] text-muted-foreground hover:text-foreground">Clear</button>
              )}
            </div>
            {accountGroups.length === 0 && (
              <div className="px-3 py-2 text-[12px] text-muted-foreground">No accounts in this period</div>
            )}
            {accountGroups.map(g => {
              const ids = g.accounts.map(a => a.account_id);
              const allSelected = ids.every(id => accountFilters.includes(id));
              return (
                <div key={g.key} className="border-t border-border/20 first:border-t-0 py-0.5">
                  <button onClick={()=>toggleAccountGroup(ids)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-secondary/50 transition-colors">
                    <span className="text-[11.5px] font-semibold text-foreground">{g.label}</span>
                    <span className={cn("h-4 w-4 rounded border grid place-items-center shrink-0",
                      allSelected ? "bg-[hsl(var(--primary))] border-[hsl(var(--primary))]" : "border-border/60")}>
                      {allSelected && <Check className="h-3 w-3 text-background"/>}
                    </span>
                  </button>
                  {g.accounts.map(a => {
                    const checked = accountFilters.includes(a.account_id);
                    return (
                      <label key={a.account_id} className="w-full flex items-center gap-2 pl-5 pr-3 py-1.5 cursor-pointer hover:bg-secondary/50 transition-colors">
                        <input type="checkbox" checked={checked} onChange={()=>toggleAccountFilter(a.account_id)} className="shrink-0"/>
                        <span className="text-[12.5px] text-foreground truncate">{a.name ?? a.official_name ?? "Account"}{a.mask ? ` ••${a.mask}` : ""}</span>
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>,
        document.body
      )}

      {/* Manage Budgets; shows what's already budgeted (right) next to what
          you've spent in but haven't budgeted yet (left), so both actions
          (adjust an existing limit / set a new one) live in one place. */}
      <BudgetManagerDialog
        open={budgetDialogOpen} onClose={()=>setBudgetDialogOpen(false)}
        needsBudget={budgetNeeds} defined={budgetDefined}
        setBudget={setBudget} removeBudget={removeBudget}
        catColor={catColor} formatCat={formatCat}
      />

      {/* Category details; opened from the small pencil affordance on a
          Categories-list row (not the row click itself, which still just
          filters). Shows this period's stats plus a budget editor, and a
          rename box gated to custom categories only. */}
      <CategoryDetailsDialog
        open={!!detailsCat} onClose={()=>setDetailsCat(null)} cat={detailsCat}
        formatCat={formatCat} catColor={catColor} categoryIcon={categoryIcon}
        spend={detailsCatStats?.spend ?? 0} mom={detailsCatStats?.mom ?? null} txnCount={detailsCatStats?.count ?? 0}
        budget={detailsCat != null ? budgets[detailsCat] : undefined}
        isObligation={detailsCat != null && OBLIGATION_LIKE_CATS.has(detailsCat)}
        isCustom={detailsCat != null && customCategories.some(cc => cc.name === detailsCat)}
        onRename={onRenameCategory} setBudget={setBudget} removeBudget={removeBudget}
      />
    </div>
  );
}

// ── Category details dialog ──────────────────────────────────────────────────
// Opened by clicking the pencil that appears on hover over a Categories-list
// row. Shows the category's current-period stats and a budget editor inline,
// plus a rename box; but renaming is only offered for custom categories
// (see the matching guard/comment on CategoryPickerPopoverProps.onRenameCategory
// below: renaming a built-in silently breaks its Plaid-category auto-mapping).
const CategoryDetailsDialog = ({
  open, onClose, cat, formatCat, catColor, categoryIcon, spend, mom, txnCount, budget,
  isObligation, isCustom, onRename, setBudget, removeBudget,
}: {
  open: boolean; onClose: () => void; cat: string | null;
  formatCat: (c: string) => string; catColor: (c: string) => string; categoryIcon: (c: string) => React.ElementType;
  spend: number; mom: number | null; txnCount: number; budget?: number;
  isObligation: boolean; isCustom: boolean;
  onRename?: (oldName: string, newName: string) => void;
  setBudget: (cat: string, amount: number) => void; removeBudget?: (cat: string) => void;
}) => {
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [budgetDraft, setBudgetDraft] = useState("");

  useEffect(() => {
    setRenaming(false);
    setBudgetDraft(budget != null ? String(budget) : "");
  }, [cat, budget]);

  if (!cat) return null;
  const Icon = categoryIcon(cat);
  const col = catColor(cat);

  const submitRename = () => {
    const trimmed = renameDraft.trim();
    if (trimmed && trimmed !== cat && onRename) onRename(cat, trimmed);
    setRenaming(false);
    onClose();
  };
  const submitBudget = () => {
    const n = parseFloat(budgetDraft);
    if (!isNaN(n) && n >= 0) setBudget(cat, n);
  };

  return (
    <Dialog open={open} onOpenChange={(o)=>{ if (!o) onClose(); }}>
      <DialogContent className="spending-v2 max-w-sm p-0 overflow-hidden gap-0">
        <div className="px-5 pt-5 pb-4 border-b border-border/20 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg grid place-items-center shrink-0" style={{backgroundColor:`${col}22`, color:col}}>
            <Icon className="h-4 w-4"/>
          </div>
          <div className="min-w-0 flex-1">
            {renaming ? (
              <div className="flex items-center gap-1.5">
                <input autoFocus value={renameDraft} onChange={e=>setRenameDraft(e.target.value)}
                  onKeyDown={e=>{ if (e.key==="Enter") submitRename(); if (e.key==="Escape") setRenaming(false); }}
                  className="flex-1 min-w-0 h-8 px-2 rounded-md bg-muted/40 border border-[hsl(var(--primary)/0.4)] text-[14px] font-semibold text-foreground outline-none"/>
                <button onClick={submitRename} aria-label="Save name" className="h-8 w-8 grid place-items-center rounded-md bg-gold shrink-0"><Check className="h-3.5 w-3.5"/></button>
                <button onClick={()=>setRenaming(false)} aria-label="Cancel rename" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground shrink-0"><X className="h-3.5 w-3.5"/></button>
              </div>
            ) : (
              <DialogTitle className="text-[15px] font-display font-semibold truncate flex items-center gap-1.5">
                {formatCat(cat)}
                {isCustom && onRename && (
                  <button onClick={()=>{ setRenaming(true); setRenameDraft(cat); }} aria-label={`Rename ${formatCat(cat)}`}
                    className="h-5 w-5 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground transition-colors shrink-0">
                    <Pencil className="h-3 w-3"/>
                  </button>
                )}
              </DialogTitle>
            )}
            <DialogDescription className="text-[11.5px] text-muted-foreground mt-0.5">
              {isObligation ? "Obligation" : isCustom ? "Custom category" : "Built-in category"}
            </DialogDescription>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-muted-foreground">{isObligation ? "Paid this period" : "Spent this period"}</span>
            <span className="font-semibold text-foreground tabular">{fmtUSD(spend)}</span>
          </div>
          {mom !== null && (
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-muted-foreground">Vs. last month</span>
              <span className={cn("font-semibold tabular", mom>0?"text-negative":"text-positive")}>{mom>0?"+":""}{mom}%</span>
            </div>
          )}
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-muted-foreground">Transactions</span>
            <span className="font-semibold text-foreground tabular">{txnCount}</span>
          </div>

          {!isObligation && (
            <div className="pt-2 border-t border-border/15">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-1.5">Monthly budget</div>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">$</span>
                  <input type="number" min={0} step={10} value={budgetDraft} placeholder="No budget set"
                    onChange={e=>setBudgetDraft(e.target.value)}
                    onKeyDown={e=>{ if (e.key==="Enter") submitBudget(); }}
                    className="w-full h-8 pl-5 pr-2 rounded-md bg-muted/40 border border-border/60 text-[12.5px] text-foreground outline-none focus:border-[hsl(var(--primary)/0.4)]"/>
                </div>
                <button onClick={submitBudget} className="h-8 px-2.5 rounded-md bg-gold text-[12px] font-semibold shrink-0">Save</button>
                {budget != null && removeBudget && (
                  <button onClick={()=>{ removeBudget(cat); setBudgetDraft(""); }} aria-label="Remove budget"
                    className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-negative shrink-0"><Trash2 className="h-3.5 w-3.5"/></button>
                )}
              </div>
            </div>
          )}

          {!isCustom && (
            <div className="text-[11px] text-muted-foreground/70 pt-1">
              Built-in categories can't be renamed here. It would break automatic categorization for future transactions. Create a custom category instead if you need a different name.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── Manage Budgets dialog ────────────────────────────────────────────────────
const BudgetManagerDialog = ({ open, onClose, needsBudget, defined, setBudget, removeBudget, catColor, formatCat }: {
  open: boolean; onClose: () => void;
  needsBudget: { cat: string; spend: number }[];
  defined: { cat: string; budget: number; spend: number }[];
  setBudget: (cat: string, amount: number) => void;
  removeBudget?: (cat: string) => void;
  catColor: (cat: string) => string; formatCat: (cat: string) => string;
}) => {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const setDraft = (cat: string, v: string) => setDrafts(d => ({ ...d, [cat]: v }));

  return (
    <Dialog open={open} onOpenChange={(o)=>{ if (!o) { onClose(); setEditingCat(null); } }}>
      <DialogContent className="spending-v2 max-w-2xl p-0 overflow-hidden gap-0">
        <div className="px-5 pt-5 pb-3 border-b border-border/20">
          <DialogTitle className="text-[17px] font-display font-semibold">Manage budgets</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted-foreground mt-0.5">
            Set a monthly limit for anything you've spent in, or adjust one you've already set.
          </DialogDescription>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/15">
          {/* Left: categories with usage but no budget yet */}
          <div className="flex flex-col min-h-0 max-h-[55vh]">
            <div className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
              Not budgeted yet · {needsBudget.length}
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-none divide-y divide-border/10">
              {needsBudget.length === 0 ? (
                <div className="text-center text-[12.5px] text-muted-foreground py-10 px-4">
                  Every category you've spent in this period already has a budget.
                </div>
              ) : needsBudget.map(({cat, spend}) => {
                const col = catColor(cat);
                const draft = drafts[cat] ?? "";
                const submit = () => {
                  const n = parseFloat(draft);
                  if (!isNaN(n) && n > 0) { setBudget(cat, n); setDraft(cat, ""); }
                };
                return (
                  <div key={cat} className="px-4 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-2 w-2 rounded-full shrink-0" style={{background:col}}/>
                      <span className="text-[13px] font-medium text-foreground truncate flex-1 min-w-0">{formatCat(cat)}</span>
                      <span className="text-[12px] text-muted-foreground tabular shrink-0">{fmtUSD(spend)} spent</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <div className="relative flex-1">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">$</span>
                        <input type="number" min={0} step={10} value={draft} placeholder="Monthly limit"
                          onChange={e=>setDraft(cat, e.target.value)}
                          onKeyDown={e=>{ if (e.key==="Enter") submit(); }}
                          className="w-full h-8 pl-5 pr-2 rounded-md bg-muted/40 border border-border/60 text-[12.5px] text-foreground outline-none focus:border-[hsl(var(--primary)/0.4)]"/>
                      </div>
                      <button onClick={submit}
                        className="h-8 px-2.5 rounded-md bg-gold text-[12px] font-semibold shrink-0">Set</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: categories that already have a budget */}
          <div className="flex flex-col min-h-0 max-h-[55vh]">
            <div className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
              Budgeted · {defined.length}
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-none divide-y divide-border/10">
              {defined.length === 0 ? (
                <div className="text-center text-[12.5px] text-muted-foreground py-10 px-4">
                  No budgets set yet. Add one on the left.
                </div>
              ) : defined.map(({cat, budget, spend}) => {
                const col = catColor(cat);
                const over = spend > budget;
                const pct = budget > 0 ? Math.min((spend/budget)*100, 100) : 0;
                const isEditing = editingCat === cat;
                const draft = drafts[cat] ?? String(budget);
                const save = () => {
                  const n = parseFloat(draft);
                  if (!isNaN(n) && n >= 0) setBudget(cat, n);
                  setEditingCat(null);
                };
                return (
                  <div key={cat} className="px-4 py-2.5">
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <div className="h-2 w-2 rounded-full shrink-0" style={{background:col}}/>
                        <span className="text-[13px] font-medium text-foreground flex-1 truncate min-w-0">{formatCat(cat)}</span>
                        <div className="relative shrink-0">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11.5px] text-muted-foreground">$</span>
                          <input autoFocus type="number" min={0} step={10} value={draft}
                            onChange={e=>setDraft(cat, e.target.value)}
                            onKeyDown={e=>{ if (e.key==="Enter") save(); if (e.key==="Escape") setEditingCat(null); }}
                            className="w-20 h-7 pl-4 pr-1 rounded-md bg-muted/40 border border-[hsl(var(--primary)/0.4)] text-[12px] text-foreground outline-none"/>
                        </div>
                        <button onClick={save} className="h-7 px-2 rounded-md bg-gold text-[11.5px] font-semibold shrink-0">Save</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="h-2 w-2 rounded-full shrink-0" style={{background:col}}/>
                        <span className="text-[13px] font-medium text-foreground truncate flex-1 min-w-0">{formatCat(cat)}</span>
                        <span className={cn("text-[12px] tabular shrink-0", over?"text-negative font-semibold":"text-foreground")}>
                          {fmtUSD(spend)} <span className="text-muted-foreground font-normal">/ {fmtUSD(budget)}</span>
                        </span>
                        <button onClick={()=>{ setEditingCat(cat); setDraft(cat, String(budget)); }}
                          aria-label={`Edit ${formatCat(cat)} budget`}
                          className="h-6 w-6 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground shrink-0"><Pencil className="h-3 w-3"/></button>
                        {removeBudget && (
                          <button onClick={()=>removeBudget(cat)}
                            aria-label={`Remove ${formatCat(cat)} budget`}
                            className="h-6 w-6 grid place-items-center rounded text-muted-foreground/60 hover:text-negative shrink-0"><Trash2 className="h-3 w-3"/></button>
                        )}
                      </div>
                    )}
                    {!isEditing && (
                      <div className="h-1.5 rounded-full bg-border/20 overflow-hidden mt-1.5">
                        <div className="h-full rounded-full transition-all" style={{width:`${pct}%`, background: over?"hsl(var(--negative))":col}}/>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── Sortable column header; click to sort by that attribute; click again to flip direction ──
const SortableTh = ({ label, active, desc, onClick, align="left", onResizeStart, isLast }: {
  label: string; active: boolean; desc: boolean; onClick: () => void; align?: "left"|"right";
  onResizeStart?: (e: React.PointerEvent) => void; isLast?: boolean;
}) => (
  <th onClick={onClick}
    className={cn("relative px-4 py-2 text-[11px] font-semibold uppercase tracking-wide cursor-pointer select-none transition-colors whitespace-nowrap overflow-hidden",
      active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      align==="right" && "text-right")}>
    <span className={cn("inline-flex items-center gap-1", align==="right" && "flex-row-reverse")}>
      {label}
      {active
        ? (desc ? <ArrowDown className="h-3 w-3"/> : <ArrowUp className="h-3 w-3"/>)
        : <ArrowUpDown className="h-2.5 w-2.5 opacity-30"/>}
    </span>
    {/* Drag handle; resizes this column; widths are proportional weights on a
        fixed-layout table, so this can never push the table into overflow. */}
    {onResizeStart && !isLast && (
      <div onClick={(e)=>e.stopPropagation()} onPointerDown={onResizeStart}
        className="absolute top-0 right-0 h-full w-2 cursor-col-resize select-none z-10 group/resize"
        title="Drag to resize column">
        <div className="absolute top-1/2 right-0 -translate-y-1/2 h-4 w-0.5 rounded-full bg-border group-hover/resize:bg-[hsl(var(--primary))] transition-colors"/>
      </div>
    )}
  </th>
);

// ── Category picker popover ──────────────────────────────────────────────────
// Portaled dropdown (same positioning pattern as useFloatingMenu's other
// panels) shown when clicking a transaction's category cell. "+ Add Custom
// Category" is pinned at the top, then three grouped sections: Expenses (every
// expense category, each with a small colorful icon), Income (a short curated
// list), and Ignored (Credit Card Payment / Internal Transfer); categories
// that exist for bookkeeping but shouldn't be mistaken for real spend.
export interface CategoryPickerPopoverProps {
  pos: { top?: number; bottom?: number; right: number; maxHeight?: number } | null;
  current: string;
  // Signed amount of the transaction being categorized, when known; a debit
  // (positive) puts the Expenses section first, a credit (negative) puts
  // Income first. Neither section is hidden: a refund is a negative-amount
  // transaction that still belongs under an expense category, so the picker
  // only reorders for convenience, never filters by sign.
  amount?: number;
  expenseCategories: string[];
  incomeCategories: string[];
  ignoredCategories: string[];
  customCategories: { name: string; type: "income"|"expense" }[];
  categoryIcon: (cat: string) => React.ElementType;
  catColor: (cat: string) => string;
  formatCat: (cat: string) => string;
  onSelect: (cat: string) => void;
  onAddCategory: (name: string, type: "income"|"expense") => void;
  onRemoveCategory?: (name: string) => void;
  // Custom categories only; renaming a built-in would silently break its
  // auto-categorization since Plaid-category mapping matches on the literal
  // string, so this is only ever offered next to a custom entry.
  onRenameCategory?: (oldName: string, newName: string) => void;
  onClose: () => void;
}

export function CategoryPickerPopover({
  pos, current, amount, expenseCategories, incomeCategories, ignoredCategories, customCategories,
  categoryIcon, catColor, formatCat, onSelect, onAddCategory, onRemoveCategory, onRenameCategory, onClose,
}: CategoryPickerPopoverProps) {
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftType, setDraftType] = useState<"expense"|"income">("expense");
  const [search, setSearch] = useState("");
  const [renamingCat, setRenamingCat] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  if (!pos) return null;

  const submitRename = () => {
    const trimmed = renameDraft.trim();
    if (trimmed && renamingCat && trimmed !== renamingCat && onRenameCategory) {
      onRenameCategory(renamingCat, trimmed);
    }
    setRenamingCat(null);
  };

  const customExpense = customCategories.filter(c => c.type === "expense").map(c => c.name);
  const customIncome = customCategories.filter(c => c.type === "income").map(c => c.name);
  const q = search.trim().toLowerCase();
  const filterList = (list: string[]) => q ? list.filter(c => c.toLowerCase().includes(q)) : list;

  const submitAdd = () => {
    const name = draftName.trim();
    if (!name) return;
    onAddCategory(name, draftType);
    onSelect(name);
    setAdding(false); setDraftName("");
  };

  const Row = ({ cat, removable }: { cat: string; removable?: boolean }) => {
    const Icon = categoryIcon(cat);
    const color = catColor(cat);
    const active = cat === current;

    if (renamingCat === cat) {
      return (
        <div className="flex items-center gap-1 px-2 py-1">
          <input autoFocus value={renameDraft} onChange={e=>setRenameDraft(e.target.value)}
            onClick={e=>e.stopPropagation()}
            onKeyDown={e=>{ if (e.key==="Enter") submitRename(); if (e.key==="Escape") setRenamingCat(null); }}
            className="flex-1 min-w-0 h-7 px-2 rounded-md bg-muted/40 border border-[hsl(var(--primary)/0.4)] text-[12px] text-foreground outline-none"/>
          <button onClick={submitRename} aria-label="Save name" className="h-7 w-7 grid place-items-center rounded-md bg-gold shrink-0"><Check className="h-3 w-3"/></button>
          <button onClick={()=>setRenamingCat(null)} aria-label="Cancel rename" className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground shrink-0"><X className="h-3 w-3"/></button>
        </div>
      );
    }

    return (
      <div className="group/catrow flex items-center">
        <button onClick={() => { onSelect(cat); onClose(); }}
          className={cn("flex-1 flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors rounded-md min-w-0", active && "bg-muted/50")}>
          <div className="h-5 w-5 rounded grid place-items-center shrink-0" style={{backgroundColor:`${color}22`, color}}>
            <Icon className="h-3 w-3"/>
          </div>
          <span className="text-[12.5px] text-foreground flex-1 truncate">{formatCat(cat)}</span>
          {active && <Check className="h-3 w-3 text-positive shrink-0"/>}
        </button>
        {removable && onRenameCategory && (
          <button onClick={(e)=>{ e.stopPropagation(); setRenamingCat(cat); setRenameDraft(cat); }} aria-label={`Rename ${cat}`}
            className="px-1 opacity-0 group-hover/catrow:opacity-100 text-muted-foreground hover:text-foreground transition-all shrink-0">
            <Pencil className="h-3 w-3"/>
          </button>
        )}
        {removable && onRemoveCategory && (
          <button onClick={()=>onRemoveCategory(cat)} aria-label={`Remove ${cat}`}
            className="px-1.5 opacity-0 group-hover/catrow:opacity-100 text-muted-foreground hover:text-negative transition-all shrink-0">
            <Trash2 className="h-3 w-3"/>
          </button>
        )}
      </div>
    );
  };

  const Section = ({ label, cats, customCats }: { label: string; cats: string[]; customCats?: string[] }) => {
    const shown = filterList(cats);
    const shownCustom = customCats ? filterList(customCats) : [];
    if (shown.length === 0 && shownCustom.length === 0) return null;
    return (
      <div className="py-1.5">
        <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</div>
        {shown.map(cat => <Row key={cat} cat={cat} />)}
        {shownCustom.map(cat => <Row key={cat} cat={cat} removable />)}
      </div>
    );
  };

  // Whichever section matches the transaction's own direction (debit →
  // Expenses, credit → Income) renders first since that's almost always
  // where the right category actually is; but both stay fully visible and
  // scrollable below, since sign alone doesn't determine category (a refund
  // is a negative-amount transaction that still belongs under an expense
  // category).
  const expensesSection = <Section key="expenses" label="Expenses" cats={expenseCategories} customCats={customExpense} />;
  const incomeSection = <Section key="income" label="Income" cats={incomeCategories} customCats={customIncome} />;
  const orderedSections = amount != null && amount < 0
    ? [incomeSection, expensesSection]
    : [expensesSection, incomeSection];

  return createPortal(
    <>
      <div className="fixed inset-0 z-[998]" onClick={onClose} />
      <div className="spending-v2 fixed z-[999] w-64 max-w-[calc(100vw-16px)] flex flex-col rounded-xl border border-border/60 bg-card shadow-2xl overflow-hidden"
        style={{ top: pos.top, bottom: pos.bottom, right: pos.right, maxHeight: pos.maxHeight ?? 360 }} onClick={e=>e.stopPropagation()}>
        <div className="p-2 border-b border-border/30 shrink-0">
          {adding ? (
            <div className="space-y-1.5 p-1">
              <input autoFocus value={draftName} onChange={e=>setDraftName(e.target.value)} placeholder="Category name"
                onKeyDown={e=>{ if(e.key==="Enter") submitAdd(); if(e.key==="Escape") setAdding(false); }}
                className="w-full h-8 px-2.5 rounded-lg bg-muted/40 border border-border/60 text-[12.5px] text-foreground outline-none focus:border-[hsl(var(--primary)/0.5)]"/>
              <div className="flex items-center gap-1.5">
                <select value={draftType} onChange={e=>setDraftType(e.target.value as "expense"|"income")}
                  className="h-8 flex-1 px-2 rounded-lg bg-muted/40 border border-border/60 text-[12px] text-foreground outline-none">
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
                <button onClick={submitAdd} className="h-8 px-3 rounded-lg bg-gold text-[12px] font-semibold shrink-0">Add</button>
                <button onClick={()=>setAdding(false)} aria-label="Cancel" className="h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground shrink-0"><X className="h-3.5 w-3.5"/></button>
              </div>
            </div>
          ) : (
            <button onClick={()=>setAdding(true)}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-[12.5px] font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.08)] transition-colors">
              <Plus className="h-3.5 w-3.5"/> Add Custom Category
            </button>
          )}
        </div>
        <div className="px-2 pt-1.5 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50 pointer-events-none"/>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search categories..."
              className="w-full h-7 pl-7 pr-2 rounded-lg bg-muted/40 border border-border/60 text-[11.5px] text-foreground outline-none focus:border-[hsl(var(--primary)/0.5)]"/>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-1 pb-1.5 min-h-0">
          {orderedSections}
          <Section label="Ignored" cats={ignoredCategories} />
        </div>
      </div>
    </>,
    document.body
  );
}

// ── Transaction row (table) ─────────────────────────────────────────────────
const TxnRow = ({
  t, visibleCols, getEffectiveCategory, catColor, formatCat, nameOverrides, accounts, onOpenDetail, recurringKeys,
  categoryIcon, expenseCategories, incomeCategories, ignoredCategories, customCategories, onSelectCategory, onAddCategory, onRemoveCategory, onRenameCategory,
  selected, onToggleSelect, flag, txnType, edited, onChangeType,
}: {
  t: PTxn; visibleCols: Set<ColKey>;
  getEffectiveCategory: (t:PTxn)=>string; catColor:(s:string)=>string; formatCat:(s:string)=>string;
  nameOverrides: Record<string,string>; accounts: PAccount[]; onOpenDetail:(t:PTxn, info?:{ recurringFrequency: string|null })=>void; recurringKeys: Map<string,string>;
  categoryIcon:(cat:string)=>React.ElementType; expenseCategories:string[]; incomeCategories:string[]; ignoredCategories:string[];
  customCategories:{name:string;type:"income"|"expense"}[];
  onSelectCategory:(t:PTxn,cat:string)=>void; onAddCategory:(name:string,type:"income"|"expense")=>void; onRemoveCategory?:(name:string)=>void; onRenameCategory?:(oldName:string,newName:string)=>void;
  selected: boolean; onToggleSelect: (id:string)=>void; flag?: TxnFlag;
  txnType: TxnClass; edited: boolean; onChangeType: (t:PTxn, type:TxnClass)=>void;
}) => {
  const cat = getEffectiveCategory(t) ?? "Other";
  const col = catColor(cat);
  const CatIcon = categoryIcon(cat);
  const nm = nameOverrides[t.id] ?? t.merchant_name ?? t.name ?? "";
  const acc = accounts.find(a => a.account_id === t.account_id);
  const recurringFreq = recurringKeys.get(nm.trim().toLowerCase());
  const catMenu = useFloatingMenu(256);
  return (
    <tr onClick={() => onOpenDetail(t, { recurringFrequency: recurringFreq ?? null })} className={cn("group/row cursor-pointer hover:bg-muted/30 transition-colors border-b border-border/10 last:border-0", selected && "bg-[hsl(var(--primary)/0.06)]", t.pending && "bg-warning/[0.03]")}>
      <td className="px-2 py-2.5" onClick={e=>e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={()=>onToggleSelect(t.id)} aria-label={`Select ${nm}`}
          className="h-3.5 w-3.5 rounded accent-[hsl(var(--primary))]"/>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-full shrink-0 grid place-items-center text-[12px] font-bold text-white" style={{background:col}}>
            {(nm[0]??"?").toUpperCase()}
          </div>
          {/* Vendor name is the thing people actually read; instead of hard
              ellipsis-truncating it to fit a narrow column, let it wrap to a
              second line so the full name stays visible. */}
          <div className="min-w-0">
            <span className="text-[13px] font-medium text-foreground line-clamp-2 leading-snug" title={nm}>{nm}</span>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5" onClick={e=>e.stopPropagation()}>
              <TypeControl t={t} txnType={txnType} edited={edited} onChangeType={onChangeType}/>
              {flag && <FlagChip flag={flag}/>}
              {recurringFreq && (
                <span title={`Recurring: ${recurringFreq}`} className="shrink-0 flex items-center gap-0.5 text-[11px] text-muted-foreground/70">
                  <RefreshCw className="h-2.5 w-2.5" /> {recurringFreq}
                </span>
              )}
            </div>
          </div>
        </div>
      </td>
      {visibleCols.has("date") && (
        <td className="px-4 py-2.5 text-[12.5px] text-muted-foreground truncate tabular" title={fmtDayHeading(t.date)}>{fmtShortDate(t.date)}</td>
      )}
      {visibleCols.has("amount") && (
        <td className={cn("px-4 py-2.5 text-right text-[13.5px] font-bold tabular truncate", t.pending ? "text-muted-foreground" : txnAmountClass(t.amount))}
          title={t.pending ? "Pending: amount may change before it posts" : undefined}>{fmtTxnAmount(t.amount)}</td>
      )}
      {visibleCols.has("statement") && (
        <td className="px-4 py-2.5" title={t.name ?? undefined}>
          <span className="block text-[11.5px] text-muted-foreground/80 font-mono truncate">{t.name ?? "-"}</span>
        </td>
      )}
      {visibleCols.has("category") && (
        <td className="px-4 py-2.5" onClick={e=>e.stopPropagation()}>
          <button ref={catMenu.btnRef} onClick={catMenu.toggle}
            className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 -mx-1.5 -my-1 hover:bg-muted/40 transition-colors max-w-full">
            <span className="h-4 w-4 rounded grid place-items-center shrink-0" style={{backgroundColor:`${col}22`, color:col}}>
              <CatIcon className="h-2.5 w-2.5"/>
            </span>
            <span className="text-[12px] font-semibold truncate" style={{color:col}}>{formatCat(cat)}</span>
            <ChevronDown className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0"/>
          </button>
          {catMenu.open && (
            <CategoryPickerPopover pos={catMenu.pos} current={cat} amount={Number(t.amount)}
              expenseCategories={expenseCategories} incomeCategories={incomeCategories} ignoredCategories={ignoredCategories}
              customCategories={customCategories} categoryIcon={categoryIcon} catColor={catColor} formatCat={formatCat}
              onSelect={(newCat)=>onSelectCategory(t,newCat)} onAddCategory={onAddCategory} onRemoveCategory={onRemoveCategory} onRenameCategory={onRenameCategory}
              onClose={catMenu.close}/>
          )}
        </td>
      )}
      {visibleCols.has("status") && (
        <td className="px-4 py-2.5 truncate">
          {t.pending
            ? <PendingChip/>
            : <span className="text-[11px] font-medium text-muted-foreground">Posted</span>}
        </td>
      )}
      {visibleCols.has("account") && (
        <td className="px-4 py-2.5" title={[acc?.name, acc?.mask ? `••${acc.mask}` : null].filter(Boolean).join(" ") || undefined}>
          <span className="block text-[12.5px] text-muted-foreground truncate">{acc?.name ?? "-"}</span>
        </td>
      )}
    </tr>
  );
};

// ── Incremental rendering ("Show more") ─────────────────────────────────────
// Rendering every transaction of "All time" at once (thousands of rows, each
// with popovers) made the tab sluggish. Lists render ROW_PAGE rows at a time;
// group headings/subtotals still reflect the FULL group.
const ROW_PAGE = 100;
function limitGroups<G extends { key: string; items: PTxn[] }>(groups: G[], limit: number, isCollapsed: (key: string) => boolean) {
  let left = limit;
  let hidden = 0;
  let more = false;
  const out: (G & { shown: PTxn[] })[] = [];
  for (const g of groups) {
    if (left <= 0) { more = true; hidden += isCollapsed(g.key) ? 0 : g.items.length; continue; }
    if (isCollapsed(g.key)) { out.push({ ...g, shown: [] }); continue; }
    const shown = g.items.slice(0, left);
    left -= shown.length;
    if (shown.length < g.items.length) { more = true; hidden += g.items.length - shown.length; }
    out.push({ ...g, shown });
  }
  return { groups: out, hidden, more };
}

// ── Transaction row (mobile card list) ──────────────────────────────────────
// Below md there's no table; each transaction is one full-width tap target
// (≥64px tall): avatar, vendor + chips, amount on the first line; type chip,
// category and account on the second. Tap opens the detail sheet; long-press
// (or tap while something is already selected) toggles selection, so there
// are no tiny per-row checkboxes or category pickers to mis-tap. The date is
// omitted while the feed is grouped under date headings (it would repeat the
// heading) and shown when the feed is a flat, non-date-sorted list.
const LONG_PRESS_MS = 450;
const MobileTxnRow = ({
  t, visibleCols, getEffectiveCategory, catColor, formatCat, nameOverrides, accounts, onOpenDetail, recurringKeys,
  selected, onToggleSelect, flag, txnType, edited, onChangeType, showDate = false, selectionMode = false,
}: {
  t: PTxn; visibleCols: Set<ColKey>;
  getEffectiveCategory: (t:PTxn)=>string; catColor:(s:string)=>string; formatCat:(s:string)=>string;
  nameOverrides: Record<string,string>; accounts: PAccount[]; onOpenDetail:(t:PTxn, info?:{ recurringFrequency: string|null })=>void; recurringKeys: Map<string,string>;
  categoryIcon?:(cat:string)=>React.ElementType; expenseCategories?:string[]; incomeCategories?:string[]; ignoredCategories?:string[];
  customCategories?:{name:string;type:"income"|"expense"}[];
  onSelectCategory?:(t:PTxn,cat:string)=>void; onAddCategory?:(name:string,type:"income"|"expense")=>void; onRemoveCategory?:(name:string)=>void; onRenameCategory?:(oldName:string,newName:string)=>void;
  selected: boolean; onToggleSelect: (id:string)=>void; flag?: TxnFlag;
  txnType: TxnClass; edited: boolean; onChangeType: (t:PTxn, type:TxnClass)=>void;
  showDate?: boolean; selectionMode?: boolean;
}) => {
  const cat = getEffectiveCategory(t) ?? "Other";
  const col = catColor(cat);
  const nm = nameOverrides[t.id] ?? t.merchant_name ?? t.name ?? "";
  const acc = accounts.find(a => a.account_id === t.account_id);
  const recurringFreq = recurringKeys.get(nm.trim().toLowerCase());
  const pressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressed = useRef(false);
  const cancelPress = () => { if (pressTimer.current) window.clearTimeout(pressTimer.current); pressTimer.current = null; };
  const onPointerDown = (e: React.PointerEvent) => {
    longPressed.current = false;
    pressStart.current = { x: e.clientX, y: e.clientY };
    cancelPress();
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      onToggleSelect(t.id);
      try { navigator.vibrate?.(10); } catch { /* unsupported */ }
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = pressStart.current;
    if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancelPress(); // it's a scroll, not a press
  };
  const activate = () => {
    if (longPressed.current) { longPressed.current = false; return; }
    if (selectionMode) onToggleSelect(t.id);
    else onOpenDetail(t, { recurringFrequency: recurringFreq ?? null });
  };
  const accLabel = acc ? `${acc.name ?? acc.official_name ?? "Account"}${acc.mask ? ` ••${acc.mask}` : ""}` : null;
  return (
    <div role="button" tabIndex={0} data-txn-row aria-pressed={selectionMode ? selected : undefined}
      aria-label={`${nm}, ${fmtTxnAmount(t.amount)}${t.pending ? ", pending" : ""}`}
      onClick={activate}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); } }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={cancelPress} onPointerLeave={cancelPress} onPointerCancel={cancelPress}
      onContextMenu={e => e.preventDefault()}
      className={cn("w-full min-h-[64px] px-4 py-3 flex items-center gap-3 text-left select-none active:bg-muted/30 transition-colors outline-none focus-visible:bg-muted/30",
        selected && "bg-[hsl(var(--primary)/0.08)]", t.pending && !selected && "bg-warning/[0.03]")}>
      <div className="relative h-10 w-10 rounded-full shrink-0 grid place-items-center text-[14px] font-bold text-white" style={{background:col}} aria-hidden>
        {selected ? <Check className="h-5 w-5"/> : (nm[0]??"?").toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[14px] font-medium text-foreground truncate min-w-0" title={t.name ?? nm}>{nm}</span>
          {t.pending && <span className="shrink-0"><PendingChip/></span>}
          {flag && <span className="shrink-0"><FlagChip flag={flag} compact/></span>}
          {recurringFreq && !flag && !t.pending && (
            <span title={`Recurring: ${recurringFreq}`} className="shrink-0 flex items-center gap-0.5 text-[11px] text-muted-foreground/70">
              <RefreshCw className="h-3 w-3" /> {recurringFreq}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground mt-1 min-w-0">
          {/* The global touch rule gives every button a 40px min-height;
              the type chip is a secondary control inside a 64px row, so it's
              capped at 28px to keep rows compact. */}
          <span onClick={e=>e.stopPropagation()} onPointerDown={e=>e.stopPropagation()} className="shrink-0 [&_button]:!min-h-[28px]">
            <TypeControl t={t} txnType={txnType} edited={edited} onChangeType={onChangeType} compact/>
          </span>
          {/* Category keeps priority; the account name gives way first. */}
          <span className="truncate min-w-[3rem] shrink" style={{ color: vivid(col) }}>{formatCat(cat)}</span>
          {visibleCols.has("account") && accLabel && (
            <>
              <span aria-hidden className="shrink-0 text-muted-foreground/50">·</span>
              <span className="truncate min-w-0 shrink-[4]" title={accLabel}>{accLabel}</span>
            </>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right">
        {visibleCols.has("amount") && (
          <div className={cn("text-[15px] font-bold tabular", t.pending ? "text-muted-foreground" : txnAmountClass(t.amount))}>{fmtTxnAmount(t.amount)}</div>
        )}
        {showDate && <div className="text-[11.5px] text-muted-foreground tabular mt-0.5">{fmtShortDate(t.date)}</div>}
      </div>
    </div>
  );
};

// ── "Change type" control (row chip + menu) ─────────────────────────────────
// Lets the user override how any transaction is treated (spending, bill,
// income, card payment, savings, transfer to/from someone, internal) with a
// small "Edited" mark once they've overridden the automatic classification.
const typeTone = (c: TxnClass): string =>
  c.startsWith("income_") || c === "savings_contribution" || c === "transfer_in" ? "text-positive bg-[hsl(var(--positive)/0.12)]"
  : c === "credit_card_payment" ? "text-[hsl(215_40%_72%)] bg-[hsl(215_40%_60%/0.14)]"
  : c === "transfer_out" ? "text-[hsl(30_60%_68%)] bg-[hsl(30_60%_60%/0.12)]"
  : c === "transfer_internal" ? "text-muted-foreground/80 bg-muted/40"
  : "text-muted-foreground bg-muted/60";
function TypeControl({ t, txnType, edited, onChangeType, compact = false }: {
  t: PTxn; txnType: TxnClass; edited: boolean; onChangeType: (t:PTxn, type:TxnClass)=>void; compact?: boolean;
}) {
  const menu = useFloatingMenu();
  // Left-anchored to the chip (it sits at the left edge of the row), unlike
  // the right-anchored category picker.
  const [left, setLeft] = useState(8);
  const def = txnTypeOption(txnType);
  return (
    <>
      <button ref={menu.btnRef} type="button" onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setLeft(Math.max(8, Math.min(r.left, window.innerWidth - 264))); menu.toggle(); }}
        title={`Type: ${def.label}${edited ? " (edited by you)" : ""}. Click to change.`}
        aria-label={`Change type, currently ${def.label}`}
        className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap transition-colors hover:ring-1 hover:ring-[hsl(var(--primary)/0.5)]", typeTone(txnType))}>
        {def.short}
        {edited && <span className="inline-flex items-center gap-0.5 text-[hsl(var(--primary))] no-underline"><Pencil className="h-2 w-2"/>{!compact && "Edited"}</span>}
        <ChevronDown className="h-2.5 w-2.5 opacity-60"/>
      </button>
      {menu.open && menu.pos && createPortal(
        <>
          <div className="fixed inset-0 z-[998]" onClick={e => { e.stopPropagation(); menu.close(); }} />
          <div role="menu" className="spending-v2 fixed z-[999] w-64 rounded-xl border border-border/60 bg-card shadow-2xl p-1.5 overflow-y-auto"
            style={{ top: menu.pos.top, bottom: menu.pos.bottom, left, maxHeight: menu.pos.maxHeight }}
            onClick={e => e.stopPropagation()}>
            <div className="px-2 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Treat this transaction as</div>
            {TXN_TYPES.map(o => (
              <button key={o.key} role="menuitemradio" aria-checked={o.key === def.key}
                onClick={() => { if (o.key !== def.key) onChangeType(t, o.key); menu.close(); }}
                className={cn("w-full flex items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted/50 transition-colors", o.key === def.key && "bg-[hsl(var(--primary)/0.08)]")}>
                <span className="h-4 w-4 mt-0.5 grid place-items-center shrink-0">{o.key === def.key && <Check className="h-3.5 w-3.5 text-[hsl(var(--primary))]"/>}</span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium text-foreground">{o.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{o.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </>
  );
}
