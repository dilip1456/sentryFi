import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { fmtUSD } from "@/lib/format";
import { useCountUp } from "@/hooks/useCountUp";
import {
  ChevronLeft, ChevronRight, Search, ArrowUpDown, ArrowUp, ArrowDown, RefreshCw, TrendingUp, TrendingDown,
  X, Landmark, Columns3, Check, Layers, Maximize2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PTxn { id:string; account_id:string; item_id:string|null; transaction_id:string|null; amount:number|string; date:string; name:string|null; merchant_name:string|null; category:string[]|null; pending:boolean; [k:string]:any; }
interface PAccount { id:string; account_id:string; name:string|null; official_name:string|null; mask:string|null; type:string|null; subtype:string|null; current_balance:number|null; [k:string]:any; }

export interface SpendingBudgetViewProps {
  txns:PTxn[]; accounts:PAccount[]; budgets:Record<string,number>;
  nameOverrides:Record<string,string>; setBudget:(c:string,n:number)=>void;
  getEffectiveCategory:(t:PTxn)=>string; formatCat:(s:string)=>string;
  catColor:(s:string)=>string; onOpenDetail:(t:PTxn)=>void; internalTxnIds:Set<string>;
  initialSearch?:string;
  // Classifies a transaction as income/expense by its assigned category
  // (falling back to the amount's sign only for unclassified categories) so
  // a refund into an expense category doesn't get counted as income.
  isIncomeCategory:(cat:string, amount:number)=>boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isTransferLikeCategory = (cat: string) => /transfer|credit card payment|loan payment/i.test(cat);
const fc2 = (n:number) => { const v=Math.abs(n); if(v>=1000) return "$"+(v/1000).toFixed(v>=10000?0:1).replace(/\.0$/,"")+"k"; return "$"+v.toFixed(v%1<0.005?0:2).replace(/\B(?=(\d{3})+(?!\d))/g,","); };
const rDate = (s:string) => {
  const d=new Date(s+"T00:00:00"), t=new Date(); t.setHours(0,0,0,0);
  const y=new Date(t); y.setDate(t.getDate()-1);
  if(+d===+t) return "Today";
  if(+d===+y) return "Yesterday";
  return d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
};
const isoDay = (s:string) => Number(s.slice(8,10));

// ── Transaction table columns — toggleable via the "Columns" picker.
// "Description" (avatar + merchant name) is always shown and isn't in this
// list since it's the row's primary identity, not an optional attribute.
type ColKey = "date" | "category" | "status" | "account" | "amount";
type SortKey = "name" | ColKey;
const COLUMN_DEFS: { key: ColKey; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "category", label: "Category" },
  { key: "status", label: "Status" },
  { key: "account", label: "Account" },
  { key: "amount", label: "Amount" },
];
const DEFAULT_COLS: ColKey[] = ["date", "category", "status", "account", "amount"];
const COLS_STORAGE_KEY = "sentryfi_spending_txn_columns";

// Human label for every sortable key (COLUMN_DEFS + the always-on "name"/Description column).
const SORT_LABELS: Record<SortKey, string> = {
  name: "Description", date: "Date", category: "Category", status: "Status", account: "Account", amount: "Amount",
};

// ── Resizable column widths, persisted across sessions. These are used as
// proportional weights on a table-layout:fixed table whose own width is
// pinned to 100% of its container — dragging a handle changes a column's
// share of that fixed width (and shrinks its neighbors), so the table can
// never grow wider than the view and trigger horizontal scroll. ───────────
type WidthKey = "name" | ColKey;
// Description gets the largest share since merchant names are the thing
// people actually need to read; date/status are short fixed-format values
// and get the least. Category/account can still run long, so their cells
// wrap to two lines instead of being squeezed and ellipsized.
const DEFAULT_COL_WIDTHS: Record<WidthKey, number> = {
  name: 300, date: 84, category: 112, status: 84, account: 112, amount: 100,
};
const COL_WIDTHS_STORAGE_KEY = "sentryfi_spending_txn_col_widths";
const MIN_COL_WIDTH = 60;

// ── Group-by options for the transaction table ──────────────────────────────
type GroupKey = "none" | "account" | "date" | "category" | "status";
const GROUP_OPTIONS: { key: GroupKey; label: string }[] = [
  { key: "none", label: "No grouping" },
  { key: "date", label: "Day" },
  { key: "account", label: "Account" },
  { key: "category", label: "Category" },
  { key: "status", label: "Status" },
];

// ── Small floating-menu helper — portals its panel to <body> and positions it
// from the trigger button's real screen coordinates, so it's never clipped or
// stacked behind a sibling's overflow-hidden/sticky element (the bug that had
// the Columns menu rendering underneath the table's sticky header). ─────────
function useFloatingMenu() {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen(o => !o);
  };
  const close = () => setOpen(false);
  return { btnRef, open, pos, toggle, close };
}

function monthBucketsList(count: number) {
  const now = new Date();
  const out: { key:string; label:string; start:string; end:string; year:number; monthIdx:number }[] = [];
  for (let i = count-1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const end = new Date(d.getFullYear(), d.getMonth()+1, 0);
    out.push({
      key: d.toISOString().slice(0,7),
      label: d.toLocaleDateString("en-US",{month:"short"}),
      start: d.toISOString().slice(0,10),
      end: end.toISOString().slice(0,10),
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
    const iso = d.toISOString().slice(0,10);
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
      key: monday.toISOString().slice(0,10),
      label: monday.toLocaleDateString("en-US",{month:"short",day:"numeric"}),
      start: monday.toISOString().slice(0,10),
      end: sunday.toISOString().slice(0,10),
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

// Shared bar-scrubber used by the month/week/year granularities in the header —
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
            <span className={cn("text-[9px] font-medium truncate w-full text-center", isSel?"text-[hsl(var(--primary))] font-bold":"text-muted-foreground/60")}>{b.label}</span>
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

export function SpendingBudgetView({txns,accounts,budgets,nameOverrides,setBudget,getEffectiveCategory,formatCat,catColor,onOpenDetail,internalTxnIds,initialSearch,isIncomeCategory}:SpendingBudgetViewProps) {

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

  // ── Granularity toggle (day/week/month/year) — each granularity keeps its
  // own independent offset so switching back and forth doesn't lose your place. ──
  const [granularity, setGranularity] = useState<"day"|"week"|"month"|"year">("month");
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

  // The actual date range driving transactions/categories/totals below — month
  // mode reuses the existing 12-month-scrubber machinery above; the other
  // granularities compute a simple rolling window relative to today.
  const activeRange = useMemo(() => {
    const base = new Date(); base.setHours(0,0,0,0);
    if (granularity==="day") {
      const d = new Date(base); d.setDate(d.getDate()+dayOffset);
      const iso = d.toISOString().slice(0,10);
      return { start: iso, end: iso, isCurrent: dayOffset===0,
        label: d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"}) };
    }
    if (granularity==="week") {
      const dow = base.getDay();
      const diffToMonday = dow===0 ? -6 : 1-dow;
      const monday = new Date(base); monday.setDate(base.getDate()+diffToMonday+weekOffset*7);
      const sunday = new Date(monday); sunday.setDate(monday.getDate()+6);
      return { start: monday.toISOString().slice(0,10), end: sunday.toISOString().slice(0,10), isCurrent: weekOffset===0,
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
  const [search, setSearch] = useState(initialSearch ?? "");
  const [sortDesc, setSortDesc] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>("date");
  const handleSort = (key: SortKey) => {
    if (sortBy === key) { setSortDesc(d => !d); return; }
    setSortBy(key);
    setSortDesc(key === "date" || key === "amount" || key === "status"); // dates/amounts start newest/largest first; text columns start A→Z
  };
  const [accountFilter, setAccountFilter] = useState<string>("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");

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
  const colsMenu = useFloatingMenu();
  const toggleCol = (k: ColKey) => setVisibleCols(prev => {
    const n = new Set(prev);
    if (n.has(k)) { if (n.size > 1) n.delete(k); } // always leave at least one attribute column visible
    else n.add(k);
    return n;
  });

  // ── Resizable column widths, persisted across sessions. Dragging a handle
  // updates one column's weight; because the table below is table-layout:fixed
  // with a 100%-width container, the browser rescales every column's share of
  // that fixed width automatically — there's no way for the total to exceed
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
  const resizingCol = useRef<{ key: WidthKey; startX: number; startWidth: number } | null>(null);
  const startColResize = (key: WidthKey) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    resizingCol.current = { key, startX: e.clientX, startWidth: colWidths[key] };
    const onMove = (ev: PointerEvent) => {
      if (!resizingCol.current) return;
      const { key: k, startX, startWidth } = resizingCol.current;
      const next = Math.max(MIN_COL_WIDTH, Math.round(startWidth + (ev.clientX - startX)));
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
  const groupMenu = useFloatingMenu();
  const [scrubDay, setScrubDay] = useState<number|null>(null);
  const [hoveredDot, setHoveredDot] = useState<string|null>(null);
  // Tooltip content is portaled to document.body and positioned from the
  // dot's real screen coordinates — the chart cards use overflow-hidden (to
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

  useEffect(() => { if (initialSearch !== undefined) setSearch(initialSearch); }, [initialSearch]);

  const isExpenseTxn = useCallback((t: PTxn) => {
    const cat = getEffectiveCategory(t) ?? "Other";
    return !isIncomeCategory(cat, Number(t.amount)) && !isTransferLikeCategory(cat);
  }, [getEffectiveCategory, isIncomeCategory]);

  // ── Transactions within the active range (respecting the category filter).
  // Defined early since totals for the day/week/year granularities are derived
  // directly from this list rather than from the month-bucket machinery below. ──
  const periodTxns = useMemo(() => txns.filter(t =>
    !internalTxnIds.has(t.id) && isExpenseTxn(t) && t.date >= activeRange.start && t.date <= activeRange.end &&
    (!catSel || (getEffectiveCategory(t) ?? "Other") === catSel)
  ), [txns, internalTxnIds, isExpenseTxn, activeRange, catSel, getEffectiveCategory]);

  // Same as periodTxns but ignoring the category filter — used to build the
  // Categories list itself, so clicking a category doesn't make every other
  // category disappear from its own picker (periodTxns above is intentionally
  // narrowed to catSel for the transaction table/chips, not for this).
  const periodTxnsAllCats = useMemo(() => txns.filter(t =>
    !internalTxnIds.has(t.id) && isExpenseTxn(t) && t.date >= activeRange.start && t.date <= activeRange.end
  ), [txns, internalTxnIds, isExpenseTxn, activeRange]);

  // ── Per-month, per-category totals across the whole 12-month window ──────
  const catMonthlyTotals = useMemo(() => {
    const out: Record<string, number[]> = {};
    for (const t of txns) {
      if (internalTxnIds.has(t.id)) continue;
      if (t.date < monthBuckets[0].start || t.date > monthBuckets[lastIdx].end) continue;
      if (!isExpenseTxn(t)) continue;
      const bi = monthBuckets.findIndex(b => t.date >= b.start && t.date <= b.end);
      if (bi === -1) continue;
      const cat = getEffectiveCategory(t) ?? "Other";
      if (!out[cat]) out[cat] = new Array(monthBuckets.length).fill(0);
      out[cat][bi] += Number(t.amount);
    }
    return out;
  }, [txns, internalTxnIds, monthBuckets, lastIdx, isExpenseTxn, getEffectiveCategory]);

  const overallMonthly = useMemo(() => {
    const out = new Array(monthBuckets.length).fill(0);
    for (const arr of Object.values(catMonthlyTotals)) arr.forEach((v,i) => out[i]+=v);
    return out;
  }, [catMonthlyTotals, monthBuckets.length]);

  // Total spend per bucket for the day/week/year bar-scrubbers — simple totals
  // (no per-category breakdown needed, unlike the month buckets above).
  const overallDaily = useMemo(() => {
    const out = new Array(dayBuckets.length).fill(0);
    const byDate: Record<string, number> = {};
    for (const b of dayBuckets) byDate[b.start] = 0;
    for (const t of txns) {
      if (internalTxnIds.has(t.id) || !isExpenseTxn(t)) continue;
      if (t.date in byDate) byDate[t.date] += Number(t.amount);
    }
    dayBuckets.forEach((b,i) => out[i] = byDate[b.start]);
    return out;
  }, [txns, internalTxnIds, isExpenseTxn, dayBuckets]);

  const overallWeekly = useMemo(() => {
    const out = new Array(weekBuckets.length).fill(0);
    for (const t of txns) {
      if (internalTxnIds.has(t.id) || !isExpenseTxn(t)) continue;
      const bi = weekBuckets.findIndex(b => t.date >= b.start && t.date <= b.end);
      if (bi !== -1) out[bi] += Number(t.amount);
    }
    return out;
  }, [txns, internalTxnIds, isExpenseTxn, weekBuckets]);

  const overallYearly = useMemo(() => {
    const out = new Array(yearBuckets.length).fill(0);
    for (const t of txns) {
      if (internalTxnIds.has(t.id) || !isExpenseTxn(t)) continue;
      const bi = yearBuckets.findIndex(b => t.date >= b.start && t.date <= b.end);
      if (bi !== -1) out[bi] += Number(t.amount);
    }
    return out;
  }, [txns, internalTxnIds, isExpenseTxn, yearBuckets]);

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
  const totalSpent = granularity==="month" ? monthTotalSpent : periodTxns.reduce((s,t)=>s+Number(t.amount),0);

  // Total income for the active period (ignores the category filter — earnings
  // aren't spend-category-scoped — shown alongside Total Spent in the header's
  // right-hand summary for every granularity).
  const totalEarned = useMemo(() => {
    let total = 0;
    for (const t of txns) {
      if (internalTxnIds.has(t.id)) continue;
      if (t.date < activeRange.start || t.date > activeRange.end) continue;
      const cat = getEffectiveCategory(t) ?? "Other";
      if (isIncomeCategory(cat, Number(t.amount))) total += Math.abs(Number(t.amount));
    }
    return total;
  }, [txns, internalTxnIds, activeRange, getEffectiveCategory, isIncomeCategory]);

  const totalBudget = Object.values(budgets).reduce((s,v) => s+v, 0);
  const now = new Date();
  const daysInSelMonth = new Date(sel.year, sel.monthIdx+1, 0).getDate();
  const dayOfMonth = isCurrentMonth ? now.getDate() : daysInSelMonth;
  const daysLeft = isCurrentMonth ? Math.max(daysInSelMonth - dayOfMonth, 0) : 0;
  const pacePct = (dayOfMonth / daysInSelMonth) * 100;
  // These are always month-budget pacing math — deliberately keyed off
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

  // ── Recurring charge detection — roughly-monthly merchants over the last 4 months ──
  const recurring = useMemo(() => {
    const byMerchant: Record<string, { dates:string[]; amounts:number[]; cat:string; label:string; accountId:string }> = {};
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth()-4);
    const cutoffStr = cutoff.toISOString().slice(0,10);
    for (const t of txns) {
      if (internalTxnIds.has(t.id)) continue;
      if (!isExpenseTxn(t)) continue;
      if (t.date < cutoffStr) continue;
      const label = (nameOverrides[t.id] ?? t.merchant_name ?? t.name ?? "").trim();
      const key = label.toLowerCase();
      if (!key) continue;
      if (!byMerchant[key]) byMerchant[key] = { dates:[], amounts:[], cat: getEffectiveCategory(t) ?? "Other", label, accountId: t.account_id };
      byMerchant[key].dates.push(t.date);
      byMerchant[key].amounts.push(Number(t.amount));
      byMerchant[key].accountId = t.account_id; // keep the most recent occurrence's account
    }
    const out: { merchant:string; category:string; avgAmount:number; nextDate:string; intervalDays:number; accountId:string }[] = [];
    for (const d of Object.values(byMerchant)) {
      if (d.dates.length < 2) continue;
      const sorted = [...d.dates].sort();
      const gaps: number[] = [];
      for (let i=1;i<sorted.length;i++) gaps.push((new Date(sorted[i]+"T00:00:00").getTime()-new Date(sorted[i-1]+"T00:00:00").getTime())/86400000);
      const avgGap = gaps.reduce((s,v)=>s+v,0)/gaps.length;
      if (avgGap < 20 || avgGap > 40) continue; // keep to roughly-monthly cadences
      const lastDate = sorted[sorted.length-1];
      const nextDate = new Date(new Date(lastDate+"T00:00:00").getTime() + avgGap*86400000).toISOString().slice(0,10);
      const avgAmount = d.amounts.reduce((s,v)=>s+v,0)/d.amounts.length;
      out.push({ merchant: d.label, category: d.cat, avgAmount, nextDate, intervalDays: Math.round(avgGap), accountId: d.accountId });
    }
    return out.sort((a,b) => a.nextDate.localeCompare(b.nextDate));
  }, [txns, internalTxnIds, isExpenseTxn, nameOverrides, getEffectiveCategory]);

  const recurringMerchantKeys = useMemo(() => new Set(recurring.map(r => r.merchant.toLowerCase())), [recurring]);

  const todayStr = now.toISOString().slice(0,10);
  const in30 = new Date(now.getTime() + 30*86400000).toISOString().slice(0,10);
  const next30Recurring = recurring.filter(r => r.nextDate >= todayStr && r.nextDate <= in30);
  const committedNext30 = next30Recurring.reduce((s,r)=>s+r.avgAmount,0);

  // Walk the upcoming recurring charges in date order, per account, subtracting
  // each from that account's current balance so we can flag the first point
  // where a charge would overdraw the account — not just list amounts blind.
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
  // 12-month scrubber above (day 1 through the last day of that month —
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
      const days = Math.round((new Date(r.nextDate+"T00:00:00").getTime()-now.getTime())/86400000);
      return days >= 0 && days <= PROJECTION_DAYS;
    });
    let cum = 0;
    return items.map(r => { cum += r.avgAmount; return { ...r, cum }; });
  }, [upcomingCharges]);

  // ── Category rows for the active period. Month mode reuses the 12-month
  // bucket data (so it keeps its month-over-month % and sparkline); the other
  // granularities aggregate directly from periodTxns since there's no
  // pre-computed bucket data for arbitrary days/weeks/years. ────────────────
  const catRows = useMemo(() => {
    if (granularity === "month") {
      return Object.entries(catMonthlyTotals)
        .map(([cat,arr]) => {
          const spend = arr[selIdx] ?? 0;
          const prevSpend = arr[selIdx-1] ?? 0;
          const mom = prevSpend > 0 ? Math.round(((spend-prevSpend)/prevSpend)*100) : null;
          const sparkline = arr.slice(Math.max(0,selIdx-5), selIdx+1);
          return { cat, spend, mom, sparkline };
        })
        .filter(c => c.spend > 0)
        .sort((a,b) => b.spend-a.spend);
    }
    const map: Record<string, number> = {};
    for (const t of periodTxnsAllCats) {
      const cat = getEffectiveCategory(t) ?? "Other";
      map[cat] = (map[cat] ?? 0) + Number(t.amount);
    }
    return Object.entries(map)
      .map(([cat,spend]) => ({ cat, spend, mom: null as number|null, sparkline: [] as number[] }))
      .sort((a,b) => b.spend-a.spend);
  }, [granularity, catMonthlyTotals, selIdx, periodTxnsAllCats, getEffectiveCategory]);

  // Resolves the value a given column sorts by, for any transaction.
  const sortValueFor = useCallback((x: PTxn, key: SortKey): string | number => {
    switch (key) {
      case "name": return (nameOverrides[x.id] ?? x.merchant_name ?? x.name ?? "").toLowerCase();
      case "category": return (getEffectiveCategory(x) ?? "Other").toLowerCase();
      case "status": return x.pending ? 1 : 0;
      case "account": return (accounts.find(a => a.account_id === x.account_id)?.name ?? "").toLowerCase();
      case "amount": return Math.abs(Number(x.amount));
      case "date": default: return x.date;
    }
  }, [nameOverrides, getEffectiveCategory, accounts]);

  const visibleTxns = useMemo(() => {
    let t = [...periodTxns];
    if (accountFilter) t = t.filter(x => x.account_id === accountFilter);
    const min = parseFloat(minAmount), max = parseFloat(maxAmount);
    if (!isNaN(min)) t = t.filter(x => Math.abs(Number(x.amount)) >= min);
    if (!isNaN(max)) t = t.filter(x => Math.abs(Number(x.amount)) <= max);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      t = t.filter(x => (nameOverrides[x.id]??x.merchant_name??x.name??"").toLowerCase().includes(q) || (getEffectiveCategory(x)??"").toLowerCase().includes(q));
    }
    t.sort((a,b) => {
      const va = sortValueFor(a, sortBy), vb = sortValueFor(b, sortBy);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sortDesc ? -cmp : cmp;
    });
    return t;
  }, [periodTxns, search, sortBy, sortDesc, sortValueFor, nameOverrides, getEffectiveCategory, accountFilter, minAmount, maxAmount]);

  // Accounts that actually appear in this period's transactions, sorted for the filter dropdown.
  const accountsInPeriod = useMemo(() => {
    const ids = new Set(periodTxns.map(t => t.account_id));
    return accounts.filter(a => ids.has(a.account_id)).sort((a,b) => (a.name??"").localeCompare(b.name??""));
  }, [accounts, periodTxns]);

  const hasActiveFilters = !!(search || accountFilter || minAmount || maxAmount);
  const clearFilters = () => { setSearch(""); setAccountFilter(""); setMinAmount(""); setMaxAmount(""); };
  // "date" desc (newest first) is the default sort — anything else counts as
  // an explicit choice worth surfacing its own quick-clear chip for.
  const hasActiveSort = !(sortBy === "date" && sortDesc);
  const clearSort = () => { setSortBy("date"); setSortDesc(true); };

  // Resolves the group label for a transaction under the current groupBy mode.
  const groupLabelFor = useCallback((t: PTxn): string => {
    switch (groupBy) {
      case "account": return accounts.find(a => a.account_id === t.account_id)?.name ?? "Unknown account";
      case "date": return t.date;
      case "category": return formatCat(getEffectiveCategory(t) ?? "Other");
      case "status": return t.pending ? "Pending" : "Posted";
      default: return "";
    }
  }, [groupBy, accounts, formatCat, getEffectiveCategory]);

  // Human-friendly heading for a group key — dates get calendar formatting,
  // account/category/status groups just show the label as-is.
  const groupHeading = useCallback((key: string): string => {
    if (groupBy === "date") return rDate(key);
    return key || "Uncategorized";
  }, [groupBy]);

  // Buckets visibleTxns into ordered groups (order follows visibleTxns' own
  // sort, so grouping composes with whichever column you've sorted by).
  // Sort applies first, grouping second: visibleTxns is already fully sorted
  // by whatever column/direction is active, and we only bucket that sorted
  // list into groups here — we never re-sort within or across buckets. Both
  // the row order inside each group AND the order the groups themselves
  // appear in come from each row's position in the already-sorted list (a
  // group surfaces at the index of its first member), so switching the sort
  // column reorders the whole table, groups included, exactly like sorting a
  // flat list would — grouping just adds the visual dividers on top.
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

  // 1 "Description" column + however many optional attribute columns are visible.
  const colSpan = 1 + visibleCols.size;


  const animatedTotal = useCountUp(totalSpent, 900);

  // ── Burn runway SVG geometry ──────────────────────────────────────────────
  // x is addressed by day-offset (0-based from the selected month's start) so
  // Card 1 geometry — one point per day of the selected month (28-31 points).
  const CW = 100, CH = 100; // viewBox units — scaled by the SVG's own width/height
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

  // Card 2 geometry — x axis is days-from-today (0..PROJECTION_DAYS).
  const future15Scale = Math.max(...future15.map(f=>f.cum), 1);
  const xForFuture = (days:number) => (days/PROJECTION_DAYS)*CW;
  const yForFuture = (v:number) => CH - (v/future15Scale)*CH;
  const daysFromToday = (dateStr:string) => Math.round((new Date(dateStr+"T00:00:00").getTime()-now.getTime())/86400000);
  const future15Path = future15.length
    ? [`M0,${CH.toFixed(2)}`, ...future15.map(f => `L${xForFuture(daysFromToday(f.nextDate)).toFixed(2)},${yForFuture(f.cum).toFixed(2)}`)].join(" ")
    : "";

  return (
    <div className="flex flex-col bg-background spending-v2 lg:h-full lg:overflow-hidden">

      {/* ═══ 1. Header — on desktop the whole screen is a fixed-height flex
          column (nothing scrolls past this), so it no longer needs to be sticky ═══ */}
      <div className="shrink-0 bg-card/95 backdrop-blur-sm border-b border-border/60">
        <div className="w-full px-4 md:px-6 pt-3 pb-2.5">
          <h1 className="font-display text-[19px] md:text-[21px] font-semibold text-foreground tracking-tight">Spending</h1>
        </div>
      </div>

      <div className="w-full px-4 md:px-6 py-3.5 space-y-3.5 flex flex-col lg:flex-1 lg:min-h-0">

        {/* ═══ 2. Spend Pulse — single row: duration picker + bar spikes on the
            left, "This <period>" summary on the right, fully driven by the
            selected granularity/offset so it updates as the range changes ═══ */}
        <div className="surface-card p-4 md:p-5 shrink-0">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-5 lg:gap-7 items-stretch">

            {/* Left: duration toggle + spend bar spikes */}
            <div className="min-w-0">
              <div className="flex bg-muted/50 rounded-lg p-0.5 gap-0.5 w-fit mb-3">
                {(["day","week","month","year"] as const).map(g => (
                  <button key={g} onClick={() => setGranularity(g)}
                    className={cn("px-2.5 py-1 rounded-md text-[11px] font-semibold capitalize transition-all",
                      granularity===g ? "bg-[hsl(var(--primary))] text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                    {g}
                  </button>
                ))}
              </div>

              {granularity==="day" ? (
                /* 14-day scrubber — same bar format as the other granularities
                   so the header never changes height when switching tabs. */
                <div>
                  <div className="text-[9.5px] font-semibold text-muted-foreground/70 mb-1">{dayCtxLabel}</div>
                  <PeriodBars buckets={dayBuckets} totals={overallDaily} selIdx={selDayIdx}
                    onSelect={(i) => setDayOffset(i-(DAY_COUNT-1))} maxWidth={560}/>
                </div>
              ) : granularity==="week" ? (
                /* 12-week scrubber, same bar format as months */
                <div>
                  <div className="text-[9.5px] font-semibold text-muted-foreground/70 mb-1">{weekYearLabel}</div>
                  <PeriodBars buckets={weekBuckets} totals={overallWeekly} selIdx={selWeekIdx}
                    onSelect={(i) => setWeekOffset(i-(WEEK_COUNT-1))} maxWidth={640}/>
                </div>
              ) : granularity==="year" ? (
                /* 6-year scrubber — each bar is one calendar year */
                <div>
                  <div className="text-[9.5px] font-semibold text-muted-foreground/70 mb-1">&nbsp;</div>
                  <PeriodBars buckets={yearBuckets} totals={overallYearly} selIdx={selYearIdx}
                    onSelect={(i) => setYearOffset(i-(YEAR_COUNT-1))} maxWidth={400}/>
                </div>
              ) : (
                /* 12-month scrubber — capped width so bars stay a sensible size on wide screens.
                   Year label above clarifies which calendar year(s) the months belong to. */
                <div>
                  <div className="text-[9.5px] font-semibold text-muted-foreground/70 mb-1">{monthYearLabel}</div>
                  <PeriodBars buckets={monthBuckets} totals={overallMonthly} selIdx={selIdx}
                    onSelect={(i) => setMonthOffset(i-lastIdx)} maxWidth={560}/>
                </div>
              )}
            </div>

            {/* Right: period summary — always just Total earned / Total spent
                for the selected range, so the panel's height and shape never
                change across day/week/month/year (no month-only budget block). */}
            <div className="w-full lg:w-[240px] shrink-0 lg:border-l lg:border-border/50 lg:pl-6 pt-3 lg:pt-0 border-t lg:border-t-0 border-border/50">
              <div className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {activeRange.label}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-muted-foreground">Total earned</span>
                  <span className="text-[15px] font-semibold tabular text-positive">{fmtUSD(totalEarned)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-muted-foreground">Total spent</span>
                  <span className="text-[15px] font-semibold tabular text-foreground">{fmtUSD(animatedTotal)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Stat tiles (Safe to spend / Committed next 30 days) now live in the
            fixed Insights panel to the right, alongside Top spending categories. */}

        {/* ═══ 3. Burn runway — swipeable: last 30 days ⇄ next 15 days ═════════ */}
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
                  <div className="text-[10.5px] text-muted-foreground">{new Date(rolling30[scrubDay].date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                </div>
              )}
              <button onClick={()=>setRunwayIdx(0)} className={cn("h-1.5 w-1.5 rounded-full transition-all", runwayIdx===0?"bg-[hsl(var(--primary))] w-4":"bg-border")}/>
              <button onClick={()=>setRunwayIdx(1)} className={cn("h-1.5 w-1.5 rounded-full transition-all", runwayIdx===1?"bg-[hsl(var(--primary))] w-4":"bg-border")}/>
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

                  {/* Marker dots + tooltips — HTML overlay positioned by percentage
                      so they stay perfectly round instead of being stretched into
                      ellipses by the chart's non-uniform SVG scaling. */}
                  {rolling30.map((d,i) => {
                    if (d.txns.length === 0) return null;
                    const key = `p${i}`;
                    const left = xForPast(i), top = (yForPast(d.cum)/CH)*100;
                    const hovered = hoveredDot===key;
                    const content = (
                      <>
                        <div className="text-[10px] text-muted-foreground">{new Date(d.date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
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
                {/* Date axis — day 1 through the last day of the selected month */}
                <div className="relative h-4 mt-1">
                  {past30Ticks.map(d => (
                    <span key={d} className="absolute -translate-x-1/2 text-[9.5px] text-muted-foreground/60 tabular"
                      style={{left:`${xForPast(d-1)}%`}}>
                      {d}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-4 mt-1 text-[10.5px] text-muted-foreground flex-wrap">
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
                        <div className="text-[10px] text-muted-foreground">{new Date(f.nextDate+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}{f.insufficient?" · insufficient funds":""}</div>
                        <div className={cn("text-[11.5px] font-medium flex items-center justify-between gap-2", f.insufficient?"text-negative":"text-foreground")}>
                          <span className="truncate">{f.merchant}</span>
                          <span className="tabular shrink-0">{fmtUSD(f.avgAmount)}</span>
                        </div>
                        {f.balanceAfter !== null && (
                          <div className={cn("text-[10.5px] tabular", f.insufficient?"text-negative":"text-muted-foreground")}>{fmtUSD(f.balanceAfter)} left in {f.accountName}</div>
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
                <div className="flex items-center gap-4 mt-2 text-[10.5px] text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded-full bg-[hsl(var(--primary)/0.6)] inline-block" style={{backgroundImage:"repeating-linear-gradient(90deg, hsl(var(--primary)) 0 2px, transparent 2px 4px)"}}/>Anticipated spend</span>
                  <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-negative inline-block"/>Low balance risk</span>
                  <span className="ml-auto">← Swipe back for last 30 days</span>
                </div>

                {/* Upcoming charges — compact horizontal rail (also shown as
                    markers on the graph above) */}
                {upcomingCharges.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border/15">
                    <div className="text-[11.5px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Upcoming charges</div>
                    <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
                      {upcomingCharges.map(r => {
                        const days = Math.round((new Date(r.nextDate+"T00:00:00").getTime()-now.getTime())/86400000);
                        return (
                          <div key={r.merchant} className={cn("shrink-0 w-[150px] rounded-xl border p-3",
                            r.insufficient ? "border-negative/40 bg-negative/5" : "border-border/40 bg-muted/20")}>
                            <div className="text-[12.5px] font-semibold text-foreground truncate">{r.merchant}</div>
                            <div className="text-[11px] text-muted-foreground truncate mt-0.5">{r.accountName}</div>
                            <div className="text-[14px] font-bold text-foreground tabular mt-1">{fmtUSD(r.avgAmount)}</div>
                            <div className="text-[11px] text-[hsl(var(--primary))] font-medium mt-0.5">
                              {new Date(r.nextDate+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})} · in {Math.max(days,0)}d
                            </div>
                            {r.insufficient ? (
                              <div className="text-[10px] font-bold text-negative mt-1">Insufficient funds</div>
                            ) : r.balanceAfter !== null && (
                              <div className="text-[10px] text-muted-foreground mt-1 tabular">{fmtUSD(r.balanceAfter)} after</div>
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

        {/* ═══ 4. Categories + transactions (center) alongside a fixed,
            non-scrolling Insights panel (right) ═══════════════════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 lg:flex-1 lg:min-h-0">

          {/* Center: categories (narrow) + transaction feed, each scrolling independently */}
          <div className="flex flex-col lg:flex-row gap-4 min-w-0 lg:min-h-0">

          {/* Categories — small rows, vertically scrollable */}
          {catRows.length > 0 && (
            <div className="surface-card overflow-hidden flex flex-col max-h-[240px] lg:max-h-none lg:h-full lg:w-[320px] lg:shrink-0">
              <div className="px-3.5 py-2.5 border-b border-border/20 text-[12px] font-semibold text-foreground shrink-0">Categories</div>
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none divide-y divide-border/10">
                {catRows.map((c,i) => {
                  const col = catColor(c.cat);
                  const b = budgets[c.cat];
                  const over = !!b && c.spend > b;
                  const scale = Math.max(b??0, c.spend, 1);
                  const trackPct = b ? Math.min((b/scale)*100,100) : 100;
                  const actualPct = Math.min((c.spend/scale)*100,100);
                  const active = catSel === c.cat;
                  return (
                    <button key={c.cat} onClick={()=>setCatSel(active?null:c.cat)}
                      style={{animationDelay:`${i*25}ms`}}
                      className={cn("bento-rise block w-full text-left px-3.5 py-2.5 transition-colors",
                        active ? "bg-[hsl(var(--primary)/0.08)]" : "hover:bg-muted/20")}>
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{background:col}}/>
                        <span className="text-[12px] font-medium text-foreground truncate flex-1 min-w-0">{formatCat(c.cat)}</span>
                        {c.mom !== null && (
                          <span className={cn("text-[9.5px] font-semibold shrink-0", c.mom>0?"text-negative":"text-positive")}>{c.mom>0?"+":""}{c.mom}%</span>
                        )}
                      </div>
                      <div className="text-[13px] font-bold text-foreground tabular mt-0.5">{fmtUSD(c.spend)}</div>
                      {b != null && (
                        <div className="h-1 rounded-full bg-border/20 relative mt-1.5">
                          <div className="absolute inset-y-0 left-0 rounded-full" style={{width:`${trackPct}%`,background:`${col}30`}}/>
                          <div className="absolute inset-y-0 left-0 rounded-full transition-all" style={{width:`${actualPct}%`,background:over?"hsl(var(--negative))":col}}/>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Transaction feed. Fixed-height card with its own internal scroll
              (header stays put, list scrolls beneath it) instead of growing
              the whole page. */}
          <div className="surface-card overflow-hidden min-w-0 flex flex-col flex-1 max-h-[480px] lg:max-h-none lg:h-full">
            <div className="px-4 py-3 border-b border-border/20 shrink-0 bg-card/95 backdrop-blur-sm space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 relative min-w-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none"/>
                  <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by description..."
                    className="w-full h-9 pl-8 pr-3 rounded-xl bg-muted/40 border border-border/60 text-[13px] text-foreground outline-none focus:border-[hsl(var(--primary)/0.5)]"/>
                </div>
                <button ref={groupMenu.btnRef} onClick={groupMenu.toggle}
                  className={cn("h-9 px-3 rounded-xl border text-[12px] font-medium flex items-center gap-1.5 transition-colors shrink-0",
                    groupBy!=="none" ? "border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.08)] text-foreground" : "border-border/60 bg-muted/40 text-foreground hover:bg-muted/60")}>
                  <Layers className="h-3.5 w-3.5"/> {groupBy==="none" ? "Group" : GROUP_OPTIONS.find(g=>g.key===groupBy)?.label}
                </button>
                <button ref={colsMenu.btnRef} onClick={colsMenu.toggle}
                  className={cn("h-9 px-3 rounded-xl border text-[12px] font-medium flex items-center gap-1.5 transition-colors shrink-0",
                    colsMenu.open ? "border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.08)] text-foreground" : "border-border/60 bg-muted/40 text-foreground hover:bg-muted/60")}>
                  <Columns3 className="h-3.5 w-3.5"/> Columns
                </button>
              </div>

              {/* Account + amount-range filters */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <div className="relative shrink-0">
                  <Landmark className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50 pointer-events-none"/>
                  <select value={accountFilter} onChange={e=>setAccountFilter(e.target.value)}
                    className="h-7 pl-6 pr-6 rounded-lg bg-muted/40 border border-border/60 text-[11.5px] font-medium text-foreground outline-none focus:border-[hsl(var(--primary)/0.5)] appearance-none max-w-[150px]">
                    <option value="">All accounts</option>
                    {accountsInPeriod.map(a => (
                      <option key={a.account_id} value={a.account_id}>
                        {a.name ?? a.official_name ?? "Account"}{a.mask ? ` ••${a.mask}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1 h-7 px-2 rounded-lg bg-muted/40 border border-border/60 shrink-0">
                  <span className="text-[10.5px] text-muted-foreground">$</span>
                  <input type="number" inputMode="decimal" min={0} placeholder="Min" value={minAmount}
                    onChange={e=>setMinAmount(e.target.value)}
                    className="w-11 bg-transparent text-[11.5px] text-foreground outline-none placeholder:text-muted-foreground/60"/>
                  <span className="text-muted-foreground/40">–</span>
                  <input type="number" inputMode="decimal" min={0} placeholder="Max" value={maxAmount}
                    onChange={e=>setMaxAmount(e.target.value)}
                    className="w-11 bg-transparent text-[11.5px] text-foreground outline-none placeholder:text-muted-foreground/60"/>
                </div>
                {(hasActiveFilters || catSel) && (
                  <button onClick={()=>{ clearFilters(); setCatSel(null); }}
                    className="ml-auto flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-negative/10 border border-negative/30 text-[11.5px] text-negative font-semibold hover:bg-negative/15 transition-colors shrink-0">
                    <X className="h-3 w-3"/> Clear all filters
                  </button>
                )}
              </div>

              {/* Active-filter chips — one per applied filter, individually removable.
                  A separate "Sort" chip shows up whenever sorting has been changed
                  from the default, with its own quick-clear back to newest-first. */}
              {(catSel || accountFilter || minAmount || maxAmount || search || hasActiveSort) && (
                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                  {hasActiveSort && (
                    <span className="inline-flex items-center gap-1 h-6 pl-2.5 pr-1.5 rounded-full bg-[hsl(var(--primary)/0.12)] border border-[hsl(var(--primary)/0.3)] text-[11.5px] font-medium text-[hsl(var(--primary))]">
                      Sort: {SORT_LABELS[sortBy]} {sortDesc ? "↓" : "↑"}
                      <button onClick={clearSort} className="h-3.5 w-3.5 rounded-full grid place-items-center hover:bg-[hsl(var(--primary)/0.25)]"><X className="h-2.5 w-2.5"/></button>
                    </span>
                  )}
                  {catSel && (
                    <span className="inline-flex items-center gap-1 h-6 pl-2.5 pr-1.5 rounded-full bg-[hsl(var(--primary)/0.12)] border border-[hsl(var(--primary)/0.3)] text-[11.5px] font-medium text-[hsl(var(--primary))]">
                      Category: {formatCat(catSel)}
                      <button onClick={()=>setCatSel(null)} className="h-3.5 w-3.5 rounded-full grid place-items-center hover:bg-[hsl(var(--primary)/0.25)]"><X className="h-2.5 w-2.5"/></button>
                    </span>
                  )}
                  {search && (
                    <span className="inline-flex items-center gap-1 h-6 pl-2.5 pr-1.5 rounded-full bg-muted/60 border border-border/60 text-[11.5px] font-medium text-foreground">
                      "{search}"
                      <button onClick={()=>setSearch("")} className="h-3.5 w-3.5 rounded-full grid place-items-center hover:bg-muted"><X className="h-2.5 w-2.5"/></button>
                    </span>
                  )}
                  {accountFilter && (
                    <span className="inline-flex items-center gap-1 h-6 pl-2.5 pr-1.5 rounded-full bg-muted/60 border border-border/60 text-[11.5px] font-medium text-foreground">
                      {accountsInPeriod.find(a=>a.account_id===accountFilter)?.name ?? "Account"}
                      <button onClick={()=>setAccountFilter("")} className="h-3.5 w-3.5 rounded-full grid place-items-center hover:bg-muted"><X className="h-2.5 w-2.5"/></button>
                    </span>
                  )}
                  {(minAmount || maxAmount) && (
                    <span className="inline-flex items-center gap-1 h-6 pl-2.5 pr-1.5 rounded-full bg-muted/60 border border-border/60 text-[11.5px] font-medium text-foreground">
                      ${minAmount||"0"} – ${maxAmount||"∞"}
                      <button onClick={()=>{setMinAmount("");setMaxAmount("");}} className="h-3.5 w-3.5 rounded-full grid place-items-center hover:bg-muted"><X className="h-2.5 w-2.5"/></button>
                    </span>
                  )}
                </div>
              )}
            </div>
            {/* overflow-x-hidden (not auto) is deliberate: the desktop table
                below is table-layout:fixed with resizable columns whose
                widths are proportional weights, not absolute pixels, so it
                always fits the container exactly and never needs a
                horizontal scrollbar. */}
            <div className="overflow-y-auto overflow-x-hidden scrollbar-none flex-1">
              {visibleTxns.length === 0 ? (
                <div className="py-14 text-center text-[13px] text-muted-foreground">
                  No transactions match{hasActiveFilters ? " these filters" : ""}.
                </div>
              ) : (
                <>
                  {/* Desktop/tablet: real table with resizable, sortable columns. */}
                  <table className="hidden md:table w-full text-left border-collapse table-fixed">
                    <colgroup>
                      <col style={{width: colWidths.name}}/>
                      {visibleCols.has("date") && <col style={{width: colWidths.date}}/>}
                      {visibleCols.has("category") && <col style={{width: colWidths.category}}/>}
                      {visibleCols.has("status") && <col style={{width: colWidths.status}}/>}
                      {visibleCols.has("account") && <col style={{width: colWidths.account}}/>}
                      {visibleCols.has("amount") && <col style={{width: colWidths.amount}}/>}
                    </colgroup>
                    <thead className="sticky top-0 z-[5] bg-card">
                      <tr className="border-b border-border/20">
                        <SortableTh label="Description" active={sortBy==="name"} desc={sortDesc} onClick={()=>handleSort("name")} onResizeStart={startColResize("name")} />
                        {visibleCols.has("date") && <SortableTh label="Date" active={sortBy==="date"} desc={sortDesc} onClick={()=>handleSort("date")} onResizeStart={startColResize("date")} />}
                        {visibleCols.has("category") && <SortableTh label="Category" active={sortBy==="category"} desc={sortDesc} onClick={()=>handleSort("category")} onResizeStart={startColResize("category")} />}
                        {visibleCols.has("status") && <SortableTh label="Status" active={sortBy==="status"} desc={sortDesc} onClick={()=>handleSort("status")} onResizeStart={startColResize("status")} />}
                        {visibleCols.has("account") && <SortableTh label="Account" active={sortBy==="account"} desc={sortDesc} onClick={()=>handleSort("account")} onResizeStart={startColResize("account")} />}
                        {visibleCols.has("amount") && <SortableTh label="Amount" align="right" active={sortBy==="amount"} desc={sortDesc} onClick={()=>handleSort("amount")} onResizeStart={startColResize("amount")} isLast/>}
                      </tr>
                    </thead>
                    {groupedTxns ? groupedTxns.map(g => (
                      <tbody key={g.key}>
                        <tr className="bg-muted/30">
                          <td colSpan={colSpan} className="px-4 py-2 border-b border-border/15">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-[12px] font-semibold text-foreground truncate">{groupHeading(g.key)}</span>
                                <span className="shrink-0 text-[10px] font-medium text-muted-foreground bg-border/30 rounded-full px-1.5 py-0.5">
                                  {g.items.length} {g.items.length===1?"txn":"txns"}
                                </span>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-[9px] text-muted-foreground uppercase tracking-wide leading-none">Subtotal</div>
                                <div className="text-[13px] font-bold text-foreground tabular leading-tight mt-0.5">{fmtUSD(g.total)}</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                        {g.items.map(t => (
                          <TxnRow key={t.id} t={t} visibleCols={visibleCols} getEffectiveCategory={getEffectiveCategory} catColor={catColor} formatCat={formatCat}
                            nameOverrides={nameOverrides} accounts={accounts} onOpenDetail={onOpenDetail} recurringKeys={recurringMerchantKeys}/>
                        ))}
                      </tbody>
                    )) : (
                      <tbody>
                        {visibleTxns.map(t => (
                          <TxnRow key={t.id} t={t} visibleCols={visibleCols} getEffectiveCategory={getEffectiveCategory} catColor={catColor} formatCat={formatCat}
                            nameOverrides={nameOverrides} accounts={accounts} onOpenDetail={onOpenDetail} recurringKeys={recurringMerchantKeys}/>
                        ))}
                      </tbody>
                    )}
                  </table>

                  {/* Mobile: no table, no column resizing — a plain stacked
                      card list instead, using the same sort/group/filter
                      state and the same visibleCols toggles to pick which
                      attributes show in the meta line. */}
                  <div className="md:hidden divide-y divide-border/10">
                    {groupedTxns ? groupedTxns.map(g => (
                      <div key={g.key}>
                        <div className="bg-muted/30 px-4 py-2 flex items-center justify-between gap-3 border-b border-border/15">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[12px] font-semibold text-foreground truncate">{groupHeading(g.key)}</span>
                            <span className="shrink-0 text-[10px] font-medium text-muted-foreground bg-border/30 rounded-full px-1.5 py-0.5">
                              {g.items.length}
                            </span>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[9px] text-muted-foreground uppercase tracking-wide leading-none">Subtotal</div>
                            <div className="text-[13px] font-bold text-foreground tabular leading-tight mt-0.5">{fmtUSD(g.total)}</div>
                          </div>
                        </div>
                        <div className="divide-y divide-border/10">
                          {g.items.map(t => (
                            <MobileTxnRow key={t.id} t={t} visibleCols={visibleCols} getEffectiveCategory={getEffectiveCategory} catColor={catColor} formatCat={formatCat}
                              nameOverrides={nameOverrides} accounts={accounts} onOpenDetail={onOpenDetail} recurringKeys={recurringMerchantKeys}/>
                          ))}
                        </div>
                      </div>
                    )) : (
                      <>
                        {visibleTxns.map(t => (
                          <MobileTxnRow key={t.id} t={t} visibleCols={visibleCols} getEffectiveCategory={getEffectiveCategory} catColor={catColor} formatCat={formatCat}
                            nameOverrides={nameOverrides} accounts={accounts} onOpenDetail={onOpenDetail} recurringKeys={recurringMerchantKeys}/>
                        ))}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          </div>

          {/* Insights — right. Fixed, non-scrolling panel: top spending
              categories, committed charges over the next 30 days, and
              today's safe-to-spend number. Content is deliberately capped
              (top 5 categories) so it never needs its own scrollbar. */}
          <div className="surface-card p-4 space-y-4 overflow-hidden lg:w-[280px] lg:shrink-0">
            <div>
              <div className="text-[13px] font-semibold text-foreground mb-2.5">Top spending categories</div>
              {catRows.length === 0 ? (
                <div className="text-[12.5px] text-muted-foreground py-2 text-center">No spend yet this period.</div>
              ) : (
                <div className="space-y-2">
                  {catRows.slice(0, 5).map(c => {
                    const col = catColor(c.cat);
                    const pct = Math.max((c.spend / catRows[0].spend) * 100, 4);
                    return (
                      <div key={c.cat} className="min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[12.5px] font-medium text-foreground truncate">{formatCat(c.cat)}</span>
                          <span className="text-[12px] font-bold text-foreground tabular shrink-0">{fmtUSD(c.spend)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-border/20 mt-1 overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{width:`${pct}%`,background:col}}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {isCurrentMonth && (
              <>
                <div className="pt-3.5 border-t border-border/15">
                  <div className="text-[10.5px] text-muted-foreground uppercase tracking-wide">Committed next 30 days</div>
                  <div className="text-[18px] font-display font-semibold text-foreground tabular mt-0.5">{fmtUSD(committedNext30)}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{next30Recurring.length} recurring charge{next30Recurring.length !== 1 ? "s" : ""}</div>
                </div>
                <div className="pt-3.5 border-t border-border/15">
                  <div className="text-[10.5px] text-muted-foreground uppercase tracking-wide">Safe to spend today</div>
                  <div className="text-[18px] font-display font-semibold text-foreground tabular mt-0.5">
                    {safeToSpendToday !== null ? fmtUSD(safeToSpendToday) : "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{safeToSpendToday !== null ? `${daysLeft} days left this month` : "Set a budget to see this"}</div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Month nav (compact, replaces the old chevrons — scrubber above is primary) */}
      {monthOffset !== 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 bg-card border border-border shadow-2xl rounded-full px-2 py-1.5">
          <button onClick={()=>setMonthOffset(o=>o-1)} disabled={selIdx<=0} className="h-7 w-7 rounded-full grid place-items-center text-muted-foreground hover:text-foreground disabled:opacity-30">
            <ChevronLeft className="h-4 w-4"/>
          </button>
          <span className="text-[12.5px] font-semibold text-foreground px-1">{new Date(sel.year,sel.monthIdx,1).toLocaleDateString("en-US",{month:"short",year:"numeric"})}</span>
          <button onClick={()=>setMonthOffset(o=>Math.min(0,o+1))} className="h-7 w-7 rounded-full grid place-items-center text-muted-foreground hover:text-foreground">
            <ChevronRight className="h-4 w-4"/>
          </button>
          <button onClick={()=>setMonthOffset(0)} className="text-[11.5px] text-[hsl(var(--primary))] font-medium px-1.5">Today</button>
        </div>
      )}

      {/* Burn-chart dot tooltip — portaled to <body> so it's never clipped by
          the chart cards' overflow-hidden (needed to hide the swipeable
          carousel's off-screen panel). Positioned from the dot's real
          on-screen coordinates, captured on hover. */}
      {dotTooltip && createPortal(
        <div className="fixed z-[400] w-max max-w-[190px] rounded-lg bg-popover border border-border shadow-xl px-2.5 py-1.5 pointer-events-none"
          style={{
            left: dotTooltip.x, top: dotTooltip.above ? dotTooltip.y - 8 : dotTooltip.y + 8,
            transform: `translate(-50%, ${dotTooltip.above ? "-100%" : "0"})`,
          }}>
          {dotTooltip.content}
        </div>,
        document.body
      )}

      {/* Columns picker — portaled to <body> and positioned from the button's
          real screen coordinates so it always renders above the table's
          sticky header instead of getting clipped/overlapped by it. */}
      {colsMenu.open && colsMenu.pos && createPortal(
        <>
          <div className="fixed inset-0 z-[998]" onClick={colsMenu.close}/>
          <div className="fixed z-[999] w-48 surface-elevated rounded-xl shadow-2xl overflow-hidden py-1"
            style={{ top: colsMenu.pos.top, right: colsMenu.pos.right, border: "1px solid var(--gold-border)" }}>
            <div className="px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Show columns</div>
            {COLUMN_DEFS.map(c => {
              const checked = visibleCols.has(c.key);
              return (
                <button key={c.key} onClick={()=>toggleCol(c.key)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-secondary/50 transition-colors text-[13px] text-foreground">
                  <div className={cn("h-4 w-4 rounded border grid place-items-center shrink-0 transition-colors",
                    checked ? "bg-[hsl(var(--primary))] border-[hsl(var(--primary))]" : "border-border-strong")}>
                    {checked && <Check className="h-3 w-3 text-primary-foreground"/>}
                  </div>
                  {c.label}
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

      {/* Group-by picker — same portal pattern as Columns above. */}
      {groupMenu.open && groupMenu.pos && createPortal(
        <>
          <div className="fixed inset-0 z-[998]" onClick={groupMenu.close}/>
          <div className="fixed z-[999] w-44 surface-elevated rounded-xl shadow-2xl overflow-hidden py-1"
            style={{ top: groupMenu.pos.top, right: groupMenu.pos.right, border: "1px solid var(--gold-border)" }}>
            <div className="px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Group by</div>
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
    </div>
  );
}

// ── Sortable column header — click to sort by that attribute; click again to flip direction ──
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
    {/* Drag handle — resizes this column; widths are proportional weights on a
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

// ── Transaction row (table) ─────────────────────────────────────────────────
const TxnRow = ({ t, visibleCols, getEffectiveCategory, catColor, formatCat, nameOverrides, accounts, onOpenDetail, recurringKeys }: {
  t: PTxn; visibleCols: Set<ColKey>;
  getEffectiveCategory: (t:PTxn)=>string; catColor:(s:string)=>string; formatCat:(s:string)=>string;
  nameOverrides: Record<string,string>; accounts: PAccount[]; onOpenDetail:(t:PTxn)=>void; recurringKeys: Set<string>;
}) => {
  const cat = getEffectiveCategory(t) ?? "Other";
  const col = catColor(cat);
  const nm = nameOverrides[t.id] ?? t.merchant_name ?? t.name ?? "";
  const acc = accounts.find(a => a.account_id === t.account_id);
  const isRecurring = recurringKeys.has(nm.trim().toLowerCase());
  return (
    <tr onClick={() => onOpenDetail(t)} className="cursor-pointer hover:bg-muted/20 transition-colors border-b border-border/10 last:border-0">
      <td className="px-4 py-2.5">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-full shrink-0 grid place-items-center text-[12px] font-bold text-white" style={{background:col}}>
            {(nm[0]??"?").toUpperCase()}
          </div>
          {/* Description is the thing people actually read — instead of hard
              ellipsis-truncating it to fit a narrow column, let it wrap to a
              second line so the full name stays visible. */}
          <span className="text-[13px] font-medium text-foreground line-clamp-2 leading-snug">{nm}</span>
          {isRecurring && <RefreshCw className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0 mt-1" />}
        </div>
      </td>
      {visibleCols.has("date") && (
        <td className="px-4 py-2.5 text-[12.5px] text-muted-foreground truncate">{rDate(t.date)}</td>
      )}
      {visibleCols.has("category") && (
        <td className="px-4 py-2.5">
          <span className="text-[12px] font-semibold line-clamp-2 leading-snug" style={{color:col}}>{formatCat(cat)}</span>
        </td>
      )}
      {visibleCols.has("status") && (
        <td className="px-4 py-2.5 truncate">
          {t.pending
            ? <span className="text-[10.5px] font-bold text-warning bg-warning/10 px-1.5 py-0.5 rounded-full">Pending</span>
            : <span className="text-[10.5px] font-medium text-muted-foreground">Posted</span>}
        </td>
      )}
      {visibleCols.has("account") && (
        <td className="px-4 py-2.5 text-[12.5px] text-muted-foreground line-clamp-2 leading-snug">{acc?.name ?? "—"}</td>
      )}
      {visibleCols.has("amount") && (
        <td className="px-4 py-2.5 text-right text-[13.5px] font-bold text-foreground tabular truncate">{fmtUSD(Number(t.amount))}</td>
      )}
    </tr>
  );
};

// ── Transaction row (mobile card list) ──────────────────────────────────────
// Below md there's no table at all — resizable columns don't translate to a
// phone-width screen, so instead each transaction renders as a two-line card:
// name + amount on top, then whichever attribute columns are toggled on
// (category/date/status/account) as a compact meta line underneath.
const MobileTxnRow = ({ t, visibleCols, getEffectiveCategory, catColor, formatCat, nameOverrides, accounts, onOpenDetail, recurringKeys }: {
  t: PTxn; visibleCols: Set<ColKey>;
  getEffectiveCategory: (t:PTxn)=>string; catColor:(s:string)=>string; formatCat:(s:string)=>string;
  nameOverrides: Record<string,string>; accounts: PAccount[]; onOpenDetail:(t:PTxn)=>void; recurringKeys: Set<string>;
}) => {
  const cat = getEffectiveCategory(t) ?? "Other";
  const col = catColor(cat);
  const nm = nameOverrides[t.id] ?? t.merchant_name ?? t.name ?? "";
  const acc = accounts.find(a => a.account_id === t.account_id);
  const isRecurring = recurringKeys.has(nm.trim().toLowerCase());
  const metaParts: React.ReactNode[] = [];
  if (visibleCols.has("category")) metaParts.push(<span key="cat" style={{color:col}} className="font-medium">{formatCat(cat)}</span>);
  if (visibleCols.has("date")) metaParts.push(<span key="date">{rDate(t.date)}</span>);
  if (visibleCols.has("account") && acc?.name) metaParts.push(<span key="acc" className="truncate">{acc.name}</span>);
  if (visibleCols.has("status") && t.pending) metaParts.push(<span key="status" className="font-semibold text-warning">Pending</span>);
  return (
    <button onClick={() => onOpenDetail(t)}
      className="w-full text-left px-4 py-3 flex items-start gap-3 active:bg-muted/30 transition-colors">
      <div className="h-9 w-9 rounded-full shrink-0 grid place-items-center text-[13px] font-bold text-white mt-0.5" style={{background:col}}>
        {(nm[0]??"?").toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[13.5px] font-medium text-foreground line-clamp-2 leading-snug flex items-center gap-1.5">
            {nm}
            {isRecurring && <RefreshCw className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />}
          </span>
          {visibleCols.has("amount") && (
            <span className="text-[14px] font-bold text-foreground tabular shrink-0">{fmtUSD(Number(t.amount))}</span>
          )}
        </div>
        {metaParts.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap text-[11.5px] text-muted-foreground mt-1">
            {metaParts.map((p, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-border">·</span>}
                {p}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
};
