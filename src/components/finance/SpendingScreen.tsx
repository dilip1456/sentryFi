/**
 * SpendingScreen — complete spending & budget management.
 * Sub-tabs: Overview | Budgets | Rules | Categories
 */
import { useState, useMemo, useRef } from "react";
import {
  Plus, Trash2, Check, X, Pencil, Search, Tag,
  ArrowRight, ArrowDownLeft, TrendingUp, TrendingDown,
  Sparkles, AlertCircle, ChevronDown, ChevronRight,
  ShoppingBag, Utensils, Car, Zap, Plane, Film, Heart,
  Coffee, Wallet, PiggyBank, CreditCard, Landmark,
  MoreHorizontal, BookOpen,
} from "lucide-react";
import { fmtUSD } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Legend,
} from "recharts";
import type { Budgets } from "@/hooks/useBudgets";
import type { CategoryOverrides } from "@/hooks/useCategoryOverrides";
import type { CategoryRule } from "@/hooks/useCategoryRules";
import type { CustomCategory } from "@/hooks/useCustomCategories";
import { UNASSIGNED } from "@/hooks/useCategoryOverrides";

// ── Types ──────────────────────────────────────────────────────
type PTxn = {
  id: string; account_id: string; amount: number; date: string;
  name: string | null; merchant_name: string | null;
  category: string[] | null; pending: boolean | null;
  payment_channel: string | null;
};

type SpendPeriod = "thisMonth" | "lastMonth" | "3M" | "6M" | "year";

const PERIOD_LABELS: Record<SpendPeriod, string> = {
  thisMonth: "This Month", lastMonth: "Last Month",
  "3M": "3 Months", "6M": "6 Months", year: "This Year",
};

interface DateRange { start: Date; end: Date; prevStart: Date; prevEnd: Date; label: string }

// ── Period helpers ─────────────────────────────────────────────
const getDateRange = (period: SpendPeriod): DateRange => {
  const now = new Date();
  const y = now.getFullYear(); const m = now.getMonth();

  switch (period) {
    case "thisMonth": {
      const start = new Date(y, m, 1);
      return { start, end: now, prevStart: new Date(y, m - 1, 1), prevEnd: start, label: start.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
    }
    case "lastMonth": {
      const start = new Date(y, m - 1, 1); const end = new Date(y, m, 0);
      return { start, end, prevStart: new Date(y, m - 2, 1), prevEnd: start, label: start.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
    }
    case "3M": {
      const start = new Date(y, m - 3, 1);
      return { start, end: now, prevStart: new Date(y, m - 6, 1), prevEnd: start, label: "Last 3 months" };
    }
    case "6M": {
      const start = new Date(y, m - 6, 1);
      return { start, end: now, prevStart: new Date(y, m - 12, 1), prevEnd: start, label: "Last 6 months" };
    }
    case "year": {
      const start = new Date(y, 0, 1);
      return { start, end: now, prevStart: new Date(y - 1, 0, 1), prevEnd: start, label: `${y}` };
    }
  }
};

const inRange = (dateStr: string, start: Date, end: Date) => {
  const d = new Date(dateStr + "T00:00:00");
  return d >= start && d <= end;
};

// ── Category helpers ───────────────────────────────────────────
const SKIP_CATS = new Set(["transfer in", "incoming transfer", "transfer out", "outgoing transfer"]);

const catIcon = (cat: string | null) => {
  if (!cat) return ShoppingBag;
  const c = cat.toLowerCase();
  if (c.includes("food") || c.includes("drink") || c.includes("dining") || c.includes("restaurant")) return Utensils;
  if (c.includes("groceries")) return ShoppingBag;
  if (c.includes("travel") || c.includes("airline")) return Plane;
  if (c.includes("transport") || c.includes("car") || c.includes("auto") || c.includes("gas")) return Car;
  if (c.includes("coffee") || c.includes("cafe")) return Coffee;
  if (c.includes("util") || c.includes("bills") || c.includes("electric") || c.includes("internet")) return Zap;
  if (c.includes("entertain") || c.includes("stream")) return Film;
  if (c.includes("health") || c.includes("medical")) return Heart;
  if (c.includes("invest") || c.includes("dividend")) return TrendingUp;
  if (c.includes("salary") || c.includes("income") || c.includes("freelance")) return Landmark;
  if (c.includes("wallet") || c.includes("checking")) return Wallet;
  if (c.includes("savings")) return PiggyBank;
  if (c.includes("credit")) return CreditCard;
  if (c.includes("transfer")) return ArrowDownLeft;
  if (c.includes("unassigned")) return AlertCircle;
  if (c.includes("education")) return BookOpen;
  if (c.includes("shopping")) return ShoppingBag;
  return Tag;
};

const catColor = (cat: string | null): string => {
  if (!cat) return "hsl(var(--muted-foreground))";
  const c = cat.toLowerCase();
  if (c.includes("food") || c.includes("dining")) return "hsl(38 92% 60%)";
  if (c.includes("groceries")) return "hsl(156 72% 55%)";
  if (c.includes("travel")) return "hsl(210 90% 65%)";
  if (c.includes("transport")) return "hsl(280 70% 65%)";
  if (c.includes("util") || c.includes("bills")) return "hsl(50 90% 60%)";
  if (c.includes("entertain")) return "hsl(330 70% 65%)";
  if (c.includes("health")) return "hsl(152 60% 50%)";
  if (c.includes("shopping")) return "hsl(4 78% 64%)";
  if (c.includes("salary") || c.includes("income")) return "hsl(152 55% 52%)";
  if (c.includes("invest")) return "hsl(210 80% 60%)";
  if (c.includes("unassigned")) return "hsl(var(--warning))";
  return "hsl(var(--primary))";
};

const fmtCat = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

const humanizeTxnCat = (cat: string | null, amount: number): string => {
  if (!cat) return "Other";
  const c = cat.toLowerCase();
  if (c.includes("transfer")) return amount < 0 ? "Incoming Transfer" : "Outgoing Transfer";
  return fmtCat(cat);
};

// ── Props ──────────────────────────────────────────────────────
interface Props {
  txns: PTxn[];
  overrides: CategoryOverrides;
  rules: CategoryRule[];
  budgets: Budgets;
  customCategories: CustomCategory[];
  builtInExpense: string[];
  builtInIncome: string[];
  selectedCategory: string | null;
  getEffectiveCat: (t: PTxn) => string | null;
  onSetOverride: (id: string, cat: string) => void;
  onBulkSetOverride: (ids: string[], cat: string) => void;
  onReassignCategory: (from: string, to?: string) => void;
  onSetBudget: (cat: string, limit: number) => void;
  onRemoveBudget: (cat: string) => void;
  onAddCategory: (name: string, type: "income" | "expense") => void;
  onRemoveCategory: (name: string) => void;
  onAddRule: (merchant: string, cat: string) => void;
  onUpdateRule: (merchant: string, cat: string) => void;
  onRemoveRule: (merchant: string) => void;
  onCategorySelect: (cat: string) => void;
}

// ── Inline editable budget row ─────────────────────────────────
const BudgetRow = ({ category, budget, spent, onSave, onRemove }: {
  category: string; budget: number; spent: number;
  onSave: (v: number) => void; onRemove: () => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(budget));
  const pct = Math.min((spent / budget) * 100, 100);
  const over = spent > budget; const near = !over && pct >= 75;
  const Icon = catIcon(category); const color = catColor(category);

  const save = () => {
    const n = parseFloat(val);
    if (n > 0) { onSave(n); setEditing(false); }
  };

  return (
    <div className="flex items-center gap-3 py-2.5 px-4 border-b border-border/20 last:border-0 group">
      <div className="h-7 w-7 rounded-md grid place-items-center shrink-0" style={{ backgroundColor: `${color}1a`, color }}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[12.5px] text-foreground">{fmtCat(category)}</span>
          <div className="flex items-center gap-2 shrink-0">
            {editing ? (
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-muted-foreground">$</span>
                <input autoFocus type="number" min={1} step={10} value={val} onChange={e => setVal(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
                  className="w-20 bg-secondary/50 border border-border/60 rounded px-1.5 py-0.5 text-[12px] text-foreground outline-none focus:border-[hsl(var(--primary)/0.5)]" />
                <button onClick={save} className="text-positive"><Check className="h-3.5 w-3.5" /></button>
                <button onClick={() => setEditing(false)} className="text-muted-foreground"><X className="h-3.5 w-3.5" /></button>
              </div>
            ) : (
              <>
                <span className={cn("text-[12px] tabular", over ? "text-negative" : near ? "text-warning" : "text-muted-foreground")}>
                  {fmtUSD(spent)} / {fmtUSD(budget)}
                </span>
                <button onClick={() => { setVal(String(budget)); setEditing(true); }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all">
                  <Pencil className="h-3 w-3" />
                </button>
                <button onClick={onRemove}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-negative transition-all">
                  <Trash2 className="h-3 w-3" />
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, backgroundColor: over ? "hsl(var(--negative))" : near ? "hsl(var(--warning))" : color }} />
          </div>
          <span className={cn("text-[9.5px] tabular shrink-0", over ? "text-negative" : near ? "text-warning" : "text-muted-foreground")}>
            {over ? `${(((spent - budget) / budget) * 100).toFixed(0)}% over` : `${(100 - pct).toFixed(0)}% left`}
          </span>
        </div>
      </div>
    </div>
  );
};

// ── Transaction row (minimal, with inline recat) ───────────────
const TxnRow = ({ t, i, effCat, onRecat }: {
  t: PTxn; i: number; effCat: string | null;
  onRecat: (txn: PTxn) => void;
}) => {
  const isIncome = Number(t.amount) < 0;
  const display = humanizeTxnCat(effCat, Number(t.amount));
  const Icon = isIncome ? ArrowDownLeft : catIcon(effCat);
  const color = catColor(effCat);
  return (
    <div className={cn("group grid grid-cols-[auto_1fr_auto] items-center gap-2.5 px-4 py-2 hover:bg-secondary/20 transition-colors", i > 0 && "border-t border-border/20")}>
      <div className="h-6 w-6 rounded grid place-items-center shrink-0"
        style={{ backgroundColor: `${isIncome ? "hsl(var(--positive))" : color}1a`, color: isIncome ? "hsl(var(--positive))" : color }}>
        <Icon className="h-3 w-3" />
      </div>
      <div className="min-w-0">
        <div className="text-[12px] text-foreground truncate leading-tight">{t.merchant_name ?? t.name ?? "Transaction"}</div>
        <div className="text-[10px] text-muted-foreground flex items-center gap-1">
          <span>{new Date(t.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
          {display && <>
            <span>·</span>
            <button onClick={() => onRecat(t)}
              className="hover:text-foreground hover:underline decoration-dashed underline-offset-2 transition-colors inline-flex items-center gap-0.5">
              {display}
              <Pencil className="h-2 w-2 opacity-0 group-hover:opacity-50 ml-0.5 shrink-0" />
            </button>
          </>}
        </div>
      </div>
      <div className={cn("text-[12px] tabular font-medium shrink-0", isIncome ? "text-positive" : "text-foreground")}>
        {isIncome ? "+" : "−"}{fmtUSD(Math.abs(Number(t.amount)), { cents: true })}
      </div>
    </div>
  );
};

// ── Inline category quick-picker (reused pattern) ──────────────
const QuickPicker = ({ txn, currentCat, allCats, onSelect, onClose }: {
  txn: PTxn; currentCat: string; allCats: string[];
  onSelect: (cat: string) => void; onClose: () => void;
}) => {
  const [q, setQ] = useState("");
  const filtered = q ? allCats.filter(c => c.toLowerCase().includes(q.toLowerCase())) : allCats;
  const canCreate = !!q && !allCats.some(c => c.toLowerCase() === q.toLowerCase());
  const isIncome = Number(txn.amount) < 0;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed z-50 w-60 surface-elevated rounded-xl shadow-2xl overflow-hidden"
        style={{ border: "1px solid var(--gold-border)" }}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search category…"
            className="flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground" />
        </div>
        <div className="max-h-48 overflow-y-auto">
          {filtered.map(cat => {
            const Icon = catIcon(cat); const color = catColor(cat);
            return (
              <button key={cat} onClick={() => { onSelect(cat); onClose(); }}
                className={cn("w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-secondary/50 transition-colors", cat === currentCat && "bg-secondary/30")}>
                <div className="h-5 w-5 rounded grid place-items-center shrink-0" style={{ backgroundColor: `${color}1a`, color }}>
                  <Icon className="h-3 w-3" />
                </div>
                <span className="text-[12px] text-foreground flex-1">{cat}</span>
                {cat === currentCat && <Check className="h-3 w-3 text-positive shrink-0" />}
              </button>
            );
          })}
          {canCreate && (
            <button onClick={() => { onSelect(q); onClose(); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-secondary/50 text-gold">
              <Plus className="h-3 w-3 shrink-0" />
              <span className="text-[12px]">Create "{q}"</span>
            </button>
          )}
        </div>
        <div className="border-t border-border/20 px-3 py-2">
          <div className="text-[10px] text-muted-foreground">Tip: tick "Always apply" to create a rule</div>
        </div>
      </div>
    </>
  );
};

// ── Main component ─────────────────────────────────────────────
export const SpendingScreen = ({
  txns, overrides, rules, budgets, customCategories,
  builtInExpense, builtInIncome, selectedCategory,
  getEffectiveCat, onSetOverride, onBulkSetOverride, onReassignCategory,
  onSetBudget, onRemoveBudget,
  onAddCategory, onRemoveCategory,
  onAddRule, onUpdateRule, onRemoveRule,
  onCategorySelect,
}: Props) => {
  const [period, setPeriod] = useState<SpendPeriod>("thisMonth");
  const [subTab, setSubTab] = useState<"overview" | "budgets" | "rules" | "categories">("overview");
  const [catFilter, setCatFilter] = useState(selectedCategory ?? "");
  const [search, setSearch] = useState("");
  const [pickerTxn, setPickerTxn] = useState<{ txn: PTxn; x: number; y: number } | null>(null);
  const [newRuleMerchant, setNewRuleMerchant] = useState("");
  const [newRuleCat, setNewRuleCat] = useState("");
  const [editRuleMerchant, setEditRuleMerchant] = useState<string | null>(null);
  const [editRuleCat, setEditRuleCat] = useState("");
  const [newCatName, setNewCatName] = useState("");
  const [newCatType, setNewCatType] = useState<"income" | "expense">("expense");
  const [selectedBulk, setSelectedBulk] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState("");

  const range = useMemo(() => getDateRange(period), [period]);

  // Filtered transactions for the period
  const periodTxns = useMemo(() =>
    txns.filter(t => inRange(t.date, range.start, range.end)),
    [txns, range]
  );
  const prevPeriodTxns = useMemo(() =>
    txns.filter(t => inRange(t.date, range.prevStart, range.prevEnd)),
    [txns, range]
  );

  // Income = negative amounts (credit); Expense = positive (debit), exclude transfers
  const income  = periodTxns.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const expense = periodTxns.filter(t => {
    if (Number(t.amount) <= 0) return false;
    const cat = (getEffectiveCat(t) ?? "").toLowerCase();
    return !SKIP_CATS.has(cat);
  }).reduce((s, t) => s + Number(t.amount), 0);
  const net = income - expense;

  const prevExpense = prevPeriodTxns.filter(t => {
    if (Number(t.amount) <= 0) return false;
    const cat = (getEffectiveCat(t) ?? "").toLowerCase();
    return !SKIP_CATS.has(cat);
  }).reduce((s, t) => s + Number(t.amount), 0);
  const expenseChange = prevExpense > 0 ? ((expense - prevExpense) / prevExpense) * 100 : null;

  // Category breakdown for the period
  const catBreakdown = useMemo(() => {
    const map: Record<string, { total: number; count: number }> = {};
    periodTxns.forEach(t => {
      if (Number(t.amount) <= 0) return;
      const cat = getEffectiveCat(t) ?? "Other";
      const display = humanizeTxnCat(cat, Number(t.amount));
      if (SKIP_CATS.has(display.toLowerCase())) return;
      if (!map[cat]) map[cat] = { total: 0, count: 0 };
      map[cat].total += Number(t.amount);
      map[cat].count += 1;
    });
    return Object.entries(map)
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [periodTxns, overrides]);

  // Chart data: weekly buckets for ≤2 months, monthly for longer
  const chartData = useMemo(() => {
    const diffDays = (range.end.getTime() - range.start.getTime()) / 86400000;
    const useWeekly = diffDays <= 65;
    const top5cats = catBreakdown.slice(0, 5).map(c => c.category);

    if (useWeekly) {
      // Weekly buckets
      const weeks: { label: string; start: Date; end: Date }[] = [];
      let cur = new Date(range.start);
      while (cur <= range.end) {
        const wEnd = new Date(cur); wEnd.setDate(wEnd.getDate() + 6);
        if (wEnd > range.end) wEnd.setTime(range.end.getTime());
        weeks.push({
          label: cur.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          start: new Date(cur), end: wEnd,
        });
        cur.setDate(cur.getDate() + 7);
      }
      return weeks.map(w => {
        const row: Record<string, number | string> = { label: w.label };
        top5cats.forEach(cat => {
          row[cat] = periodTxns.filter(t =>
            Number(t.amount) > 0 &&
            inRange(t.date, w.start, w.end) &&
            (getEffectiveCat(t) ?? "Other") === cat
          ).reduce((s, t) => s + Number(t.amount), 0);
        });
        return row;
      });
    } else {
      // Monthly buckets
      const months: { label: string; y: number; m: number }[] = [];
      let cur = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
      while (cur <= range.end) {
        months.push({ label: cur.toLocaleDateString("en-US", { month: "short", year: "2-digit" }), y: cur.getFullYear(), m: cur.getMonth() });
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }
      return months.map(mo => {
        const row: Record<string, number | string> = { label: mo.label };
        top5cats.forEach(cat => {
          row[cat] = periodTxns.filter(t => {
            if (Number(t.amount) <= 0) return false;
            const d = new Date(t.date + "T00:00:00");
            return d.getFullYear() === mo.y && d.getMonth() === mo.m && (getEffectiveCat(t) ?? "Other") === cat;
          }).reduce((s, t) => s + Number(t.amount), 0);
        });
        return row;
      });
    }
  }, [periodTxns, catBreakdown, range, overrides]);

  // Filtered transaction list
  const displayTxns = useMemo(() => {
    let list = periodTxns;
    if (catFilter) list = list.filter(t => (getEffectiveCat(t) ?? "Other") === catFilter);
    if (search) list = list.filter(t =>
      (t.merchant_name ?? t.name ?? "").toLowerCase().includes(search.toLowerCase())
    );
    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [periodTxns, catFilter, search, overrides]);

  // Unassigned count
  const unassignedCount = periodTxns.filter(t => {
    const c = getEffectiveCat(t) ?? "";
    return !c || c === "Other" || c === UNASSIGNED;
  }).length;

  const allCatNames = [...builtInExpense, ...builtInIncome, ...customCategories.map(c => c.name)];

  const openPicker = (t: PTxn, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(rect.left, window.innerWidth - 248);
    const y = rect.bottom + 260 > window.innerHeight ? rect.top - 270 : rect.bottom + 4;
    setPickerTxn({ txn: t, x, y });
  };

  const applyBulk = () => {
    if (!bulkCat || selectedBulk.size === 0) return;
    onBulkSetOverride([...selectedBulk], bulkCat);
    toast.success(`Assigned ${selectedBulk.size} transaction${selectedBulk.size > 1 ? "s" : ""} to ${fmtCat(bulkCat)}`);
    setSelectedBulk(new Set()); setBulkCat("");
  };

  return (
    <div className="space-y-3 animate-fade-up">
      {/* Period selector */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 p-0.5 rounded-full bg-secondary/40 border border-border/30">
          {(Object.keys(PERIOD_LABELS) as SpendPeriod[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={cn("px-3 py-1 rounded-full text-[11.5px] font-medium transition-all",
                period === p ? "bg-gold shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-muted-foreground">{range.label}</div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-2">
        <div className="surface-card p-3">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Income</div>
          <div className="font-display text-lg tabular text-positive mt-0.5">{fmtUSD(income)}</div>
        </div>
        <div className="surface-card p-3">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Spent</div>
          <div className="font-display text-lg tabular text-foreground mt-0.5">{fmtUSD(expense)}</div>
          {expenseChange !== null && (
            <div className={cn("text-[9.5px] tabular mt-0.5", expenseChange > 0 ? "text-negative" : "text-positive")}>
              {expenseChange > 0 ? "+" : ""}{expenseChange.toFixed(0)}% vs prev
            </div>
          )}
        </div>
        <div className="surface-card p-3">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Net</div>
          <div className={cn("font-display text-lg tabular mt-0.5", net >= 0 ? "text-positive" : "text-negative")}>
            {net >= 0 ? "+" : ""}{fmtUSD(Math.abs(net))}
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-0 border-b border-border/30">
        {(["overview", "budgets", "rules", "categories"] as const).map(t => (
          <button key={t} onClick={() => setSubTab(t)}
            className={cn("px-4 py-2 text-[12px] font-medium capitalize transition-colors relative",
              subTab === t ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {t === "categories" ? "Categories" : t === "rules" ? "Rules" : t === "budgets" ? "Budgets" : "Overview"}
            {t === "overview" && unassignedCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-warning/20 text-warning text-[9px]">{unassignedCount}</span>
            )}
            {subTab === t && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gold rounded-full" />}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {subTab === "overview" && (
        <div className="space-y-3">
          {/* Spending chart */}
          {chartData.length > 0 && catBreakdown.length > 0 && (
            <div className="surface-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Spending by category</div>
                <div className="flex items-center gap-3 flex-wrap justify-end">
                  {catBreakdown.slice(0, 5).map(c => (
                    <button key={c.category} onClick={() => setCatFilter(catFilter === c.category ? "" : c.category)}
                      className={cn("flex items-center gap-1 text-[10px] transition-opacity", catFilter && catFilter !== c.category && "opacity-40")}>
                      <div className="h-2 w-2 rounded-full" style={{ backgroundColor: catColor(c.category) }} />
                      <span className="text-muted-foreground">{fmtCat(c.category)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barSize={16}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.4)" vertical={false} />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} />
                    <YAxis hide />
                    <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid var(--gold-border)", borderRadius: "10px", fontSize: "11px" }}
                      formatter={(v: number, n: string) => [fmtUSD(v), fmtCat(n)]} />
                    {catBreakdown.slice(0, 5).map((c, i) => (
                      <Bar key={c.category} dataKey={c.category} stackId="a"
                        fill={catColor(c.category)} radius={i === Math.min(catBreakdown.length - 1, 4) ? [3, 3, 0, 0] : undefined}
                        animationDuration={800 + i * 100} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Category breakdown */}
          {catBreakdown.length > 0 && (
            <div className="surface-card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border/20 flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">By category</div>
                {catFilter && (
                  <button onClick={() => setCatFilter("")} className="text-[10px] text-gold hover:underline flex items-center gap-1">
                    Clear filter <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="divide-y divide-border/15">
                {catBreakdown.map(c => {
                  const Icon = catIcon(c.category); const color = catColor(c.category);
                  const bud = budgets[c.category]; const pct = bud ? (c.total / bud) * 100 : 0;
                  const active = catFilter === c.category;
                  return (
                    <button key={c.category} onClick={() => setCatFilter(active ? "" : c.category)}
                      className={cn("w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-secondary/20 transition-colors", active && "bg-secondary/30")}>
                      <div className="h-5 w-5 rounded grid place-items-center shrink-0" style={{ backgroundColor: `${color}1a`, color }}>
                        <Icon className="h-3 w-3" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] text-foreground">{fmtCat(c.category)}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            {bud && <span className={cn("text-[9.5px] tabular", pct > 100 ? "text-negative" : pct > 75 ? "text-warning" : "text-muted-foreground")}>{pct.toFixed(0)}%</span>}
                            <span className="text-[12px] tabular font-medium">{fmtUSD(c.total)}</span>
                          </div>
                        </div>
                        {bud && (
                          <div className="mt-1 h-1 bg-secondary rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: pct > 100 ? "hsl(var(--negative))" : pct > 75 ? "hsl(var(--warning))" : color }} />
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Transaction list */}
          <div className="surface-card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border/20 flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder={catFilter ? `Search in ${fmtCat(catFilter)}…` : "Search transactions…"}
                className="flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground" />
              {catFilter && <button onClick={() => setCatFilter("")} className="text-[10px] text-gold">×{fmtCat(catFilter)}</button>}
              {search && <button onClick={() => setSearch("")} className="text-muted-foreground"><X className="h-3 w-3" /></button>}
              <span className="text-[10px] text-muted-foreground tabular shrink-0">{displayTxns.length}</span>
            </div>
            {/* Bulk assign toolbar */}
            {selectedBulk.size > 0 && (
              <div className="px-4 py-2 bg-secondary/20 border-b border-border/20 flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">{selectedBulk.size} selected</span>
                <select value={bulkCat} onChange={e => setBulkCat(e.target.value)}
                  className="flex-1 bg-secondary/40 border border-border/40 rounded px-2 py-1 text-[11px] text-foreground outline-none">
                  <option value="">Assign to…</option>
                  <optgroup label="Expense">{builtInExpense.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                  <optgroup label="Income">{builtInIncome.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                  {customCategories.length > 0 && <optgroup label="Custom">{customCategories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}</optgroup>}
                </select>
                <button onClick={applyBulk} disabled={!bulkCat}
                  className="h-7 px-3 rounded bg-gold text-[11px] font-medium hover:opacity-90 disabled:opacity-40">Apply</button>
                <button onClick={() => setSelectedBulk(new Set())} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
              </div>
            )}
            <div className="max-h-[480px] overflow-y-auto">
              {displayTxns.length === 0 ? (
                <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                  No transactions{catFilter ? ` in ${fmtCat(catFilter)}` : ""}{search ? ` matching "${search}"` : ""} for this period.
                </div>
              ) : (
                displayTxns.map((t, i) => (
                  <div key={t.id} className="flex items-center gap-0">
                    <label className="pl-3 pr-1 py-2 flex items-center cursor-pointer">
                      <input type="checkbox" checked={selectedBulk.has(t.id)}
                        onChange={() => {
                          const n = new Set(selectedBulk);
                          if (n.has(t.id)) n.delete(t.id); else n.add(t.id);
                          setSelectedBulk(n);
                        }}
                        className="accent-[hsl(var(--primary))] h-3 w-3" />
                    </label>
                    <div className="flex-1">
                      <TxnRow t={t} i={0} effCat={getEffectiveCat(t)} onRecat={(txn) => {
                        const el = document.getElementById(`txn-${txn.id}`);
                        const rect = el?.getBoundingClientRect() ?? { left: 100, bottom: 200 };
                        const x = Math.min(rect.left + 60, window.innerWidth - 248);
                        const y = (rect as DOMRect).bottom + 260 > window.innerHeight ? (rect as DOMRect).top - 270 : (rect as DOMRect).bottom + 4;
                        setPickerTxn({ txn, x, y });
                      }} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── BUDGETS TAB ── */}
      {subTab === "budgets" && (
        <div className="space-y-3">
          {/* Budget summary */}
          {Object.keys(budgets).length > 0 && (() => {
            const totalBudgeted = Object.values(budgets).reduce((s, v) => s + v, 0);
            const totalSpent = Object.keys(budgets).reduce((s, cat) => {
              return s + catBreakdown.find(c => c.category === cat)?.total ?? 0;
            }, 0);
            const overCount = Object.keys(budgets).filter(cat => {
              const spent = catBreakdown.find(c => c.category === cat)?.total ?? 0;
              return spent > budgets[cat];
            }).length;
            return (
              <div className="surface-elevated p-4 grid grid-cols-3 gap-3">
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Total budgeted</div>
                  <div className="font-display text-lg tabular text-foreground mt-0.5">{fmtUSD(totalBudgeted)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Spent vs budget</div>
                  <div className={cn("font-display text-lg tabular mt-0.5", totalSpent > totalBudgeted ? "text-negative" : "text-positive")}>
                    {fmtUSD(totalSpent)}
                  </div>
                  <div className="mt-1 h-1 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min((totalSpent / totalBudgeted) * 100, 100)}%`, backgroundColor: totalSpent > totalBudgeted ? "hsl(var(--negative))" : "hsl(var(--positive))" }} />
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Over budget</div>
                  <div className={cn("font-display text-lg tabular mt-0.5", overCount > 0 ? "text-negative" : "text-positive")}>
                    {overCount} {overCount === 1 ? "category" : "categories"}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Active budgets */}
          {Object.keys(budgets).length > 0 && (
            <div className="surface-card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border/20 flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Active budgets</div>
                <span className="text-[10px] text-muted-foreground">{Object.keys(budgets).length}</span>
              </div>
              {Object.entries(budgets).map(([cat, limit]) => (
                <BudgetRow key={cat} category={cat} budget={limit}
                  spent={catBreakdown.find(c => c.category === cat)?.total ?? 0}
                  onSave={v => onSetBudget(cat, v)}
                  onRemove={() => { onRemoveBudget(cat); toast.success(`Removed budget for ${fmtCat(cat)}`); }} />
              ))}
            </div>
          )}

          {/* Add budget for unbudgeted categories */}
          {(() => {
            const unbudgeted = catBreakdown.filter(c => !budgets[c.category]);
            if (unbudgeted.length === 0) return null;
            return (
              <div className="surface-card overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border/20 text-[11px] uppercase tracking-wider text-muted-foreground">
                  Add budget for active categories
                </div>
                {unbudgeted.map(c => {
                  const Icon = catIcon(c.category); const color = catColor(c.category);
                  return (
                    <div key={c.category} className="group flex items-center gap-3 px-4 py-2.5 border-b border-border/15 last:border-0 hover:bg-secondary/15 transition-colors">
                      <div className="h-6 w-6 rounded grid place-items-center shrink-0" style={{ backgroundColor: `${color}1a`, color }}>
                        <Icon className="h-3 w-3" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-[12px] text-foreground">{fmtCat(c.category)}</span>
                        <span className="text-[10px] text-muted-foreground ml-2 tabular">{fmtUSD(c.total)} this period</span>
                      </div>
                      <QuickBudgetAdd category={c.category} suggested={c.total} onSave={v => { onSetBudget(c.category, v); toast.success(`Budget set for ${fmtCat(c.category)}`); }} />
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {Object.keys(budgets).length === 0 && catBreakdown.length === 0 && (
            <div className="surface-card p-8 text-center text-[12px] text-muted-foreground">
              No spending data for this period. Sync transactions to get started.
            </div>
          )}
        </div>
      )}

      {/* ── RULES TAB ── */}
      {subTab === "rules" && (
        <div className="space-y-3">
          {/* Add new rule */}
          <div className="surface-card p-4 space-y-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Add rule</div>
            <div className="flex items-center gap-2">
              <input value={newRuleMerchant} onChange={e => setNewRuleMerchant(e.target.value)}
                placeholder="Merchant name (e.g. Starbucks)"
                className="flex-1 bg-secondary/40 border border-border/40 rounded-lg px-3 py-2 text-[12px] text-foreground outline-none focus:border-[hsl(var(--primary)/0.4)]" />
              <select value={newRuleCat} onChange={e => setNewRuleCat(e.target.value)}
                className="bg-secondary/40 border border-border/40 rounded-lg px-2 py-2 text-[12px] text-foreground outline-none focus:border-[hsl(var(--primary)/0.4)]">
                <option value="">Category…</option>
                <optgroup label="Expense">{builtInExpense.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                <optgroup label="Income">{builtInIncome.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                {customCategories.length > 0 && <optgroup label="Custom">{customCategories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}</optgroup>}
              </select>
              <button onClick={() => {
                if (!newRuleMerchant.trim() || !newRuleCat) return;
                onAddRule(newRuleMerchant.trim(), newRuleCat);
                toast.success(`Rule added: "${newRuleMerchant.trim()}" → ${fmtCat(newRuleCat)}`);
                setNewRuleMerchant(""); setNewRuleCat("");
              }} disabled={!newRuleMerchant.trim() || !newRuleCat}
                className="h-9 px-3 rounded-lg bg-gold text-[12px] font-medium hover:opacity-90 disabled:opacity-40 flex items-center gap-1 shrink-0">
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
          </div>

          {/* Rules list */}
          {rules.length === 0 ? (
            <div className="surface-card p-8 text-center text-[12px] text-muted-foreground">
              No rules yet. Add a rule above or change a transaction category and tick "Always apply".
            </div>
          ) : (
            <div className="surface-card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border/20 flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Active rules</div>
                <span className="text-[10px] text-muted-foreground">{rules.length}</span>
              </div>
              {rules.map((rule, i) => {
                const Icon = catIcon(rule.category); const color = catColor(rule.category);
                const isEditing = editRuleMerchant === rule.merchantPattern;
                return (
                  <div key={rule.merchantPattern} className={cn("group flex items-center gap-3 px-4 py-2.5 border-b border-border/15 last:border-0 hover:bg-secondary/15 transition-colors")}>
                    <div className="h-6 w-6 rounded grid place-items-center shrink-0" style={{ backgroundColor: `${color}1a`, color }}>
                      <Icon className="h-3 w-3" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[12px] text-foreground font-medium">"{rule.merchantPattern}"</span>
                      <span className="text-[11px] text-muted-foreground mx-1.5">→</span>
                      {isEditing ? (
                        <select value={editRuleCat} onChange={e => setEditRuleCat(e.target.value)} autoFocus
                          className="bg-secondary/50 border border-border/50 rounded px-1.5 py-0.5 text-[11px] text-foreground outline-none">
                          <optgroup label="Expense">{builtInExpense.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                          <optgroup label="Income">{builtInIncome.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                          {customCategories.length > 0 && <optgroup label="Custom">{customCategories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}</optgroup>}
                        </select>
                      ) : (
                        <span className="text-[12px] text-foreground">{fmtCat(rule.category)}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isEditing ? (
                        <>
                          <button onClick={() => { onUpdateRule(rule.merchantPattern, editRuleCat); setEditRuleMerchant(null); toast.success("Rule updated"); }}
                            className="text-positive hover:opacity-80"><Check className="h-3.5 w-3.5" /></button>
                          <button onClick={() => setEditRuleMerchant(null)} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => { setEditRuleMerchant(rule.merchantPattern); setEditRuleCat(rule.category); }}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all">
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button onClick={() => { onRemoveRule(rule.merchantPattern); toast.success(`Rule removed for "${rule.merchantPattern}"`); }}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-negative transition-all">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── CATEGORIES TAB ── */}
      {subTab === "categories" && (
        <div className="space-y-3">
          {/* Add custom category */}
          <div className="surface-card p-4 space-y-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Add category</div>
            <div className="flex items-center gap-2">
              <input value={newCatName} onChange={e => setNewCatName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && newCatName.trim()) { onAddCategory(newCatName.trim(), newCatType); toast.success(`"${newCatName.trim()}" created`); setNewCatName(""); } }}
                placeholder="Category name…"
                className="flex-1 bg-secondary/40 border border-border/40 rounded-lg px-3 py-2 text-[12px] text-foreground outline-none focus:border-[hsl(var(--primary)/0.4)]" />
              <select value={newCatType} onChange={e => setNewCatType(e.target.value as "income" | "expense")}
                className="bg-secondary/40 border border-border/40 rounded-lg px-2 py-2 text-[12px] text-foreground outline-none">
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
              <button onClick={() => { if (!newCatName.trim()) return; onAddCategory(newCatName.trim(), newCatType); toast.success(`"${newCatName.trim()}" created`); setNewCatName(""); }}
                disabled={!newCatName.trim()}
                className="h-9 px-3 rounded-lg bg-gold text-[12px] font-medium hover:opacity-90 disabled:opacity-40 shrink-0 flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
          </div>

          {/* Category list */}
          {(["expense", "income"] as const).map(type => {
            const builtIn = type === "expense" ? builtInExpense : builtInIncome;
            const custom = customCategories.filter(c => c.type === type);
            return (
              <div key={type} className="surface-card overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border/20 text-[11px] uppercase tracking-wider text-muted-foreground capitalize">{type} categories</div>
                {[...builtIn.map(n => ({ name: n, custom: false })), ...custom.map(c => ({ name: c.name, custom: true }))].map(cat => {
                  const Icon = catIcon(cat.name); const color = catColor(cat.name);
                  const count = periodTxns.filter(t => getEffectiveCat(t) === cat.name).length;
                  const spent = catBreakdown.find(c => c.category === cat.name)?.total ?? 0;
                  return (
                    <div key={cat.name} className="group flex items-center gap-3 px-4 py-2.5 border-b border-border/15 last:border-0 hover:bg-secondary/10 transition-colors">
                      <div className="h-6 w-6 rounded grid place-items-center shrink-0" style={{ backgroundColor: `${color}1a`, color }}>
                        <Icon className="h-3 w-3" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] text-foreground">{cat.name}</span>
                          {cat.custom && <span className="text-[9px] px-1 rounded bg-secondary text-muted-foreground">custom</span>}
                        </div>
                        <span className="text-[10px] text-muted-foreground">{count} txn{count !== 1 ? "s" : ""}{spent > 0 ? ` · ${fmtUSD(spent)}` : ""} this period</span>
                      </div>
                      {budgets[cat.name] && (
                        <div className="text-[10px] text-muted-foreground tabular">{fmtUSD(budgets[cat.name])}/mo</div>
                      )}
                      {cat.custom && (
                        <button onClick={() => {
                          onReassignCategory(cat.name);
                          onRemoveCategory(cat.name);
                          toast.success(`"${cat.name}" deleted — transactions moved to Unassigned`);
                        }} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-negative transition-all">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Unassigned queue */}
          {(() => {
            const unassigned = periodTxns.filter(t => {
              const c = getEffectiveCat(t) ?? "";
              return !c || c === "Other" || c === UNASSIGNED;
            });
            if (unassigned.length === 0) return (
              <div className="surface-card px-4 py-4 flex items-center gap-2 text-[12px] text-muted-foreground">
                <Check className="h-4 w-4 text-positive shrink-0" />
                All transactions in this period are categorized.
              </div>
            );
            return (
              <div className="surface-card overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border/20 flex items-center justify-between">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Unassigned ({unassigned.length})</div>
                  <div className="text-[10px] text-muted-foreground">Click the category to assign</div>
                </div>
                {unassigned.map((t, i) => (
                  <TxnRow key={t.id} t={t} i={i} effCat={getEffectiveCat(t)} onRecat={(txn) => {
                    const el = document.querySelector(`[data-txn="${txn.id}"]`);
                    const rect = el?.getBoundingClientRect() ?? { left: 100, bottom: 200, top: 200 } as DOMRect;
                    const x = Math.min(rect.left, window.innerWidth - 248);
                    const y = rect.bottom + 260 > window.innerHeight ? rect.top - 270 : rect.bottom + 4;
                    setPickerTxn({ txn, x, y });
                  }} />
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* Floating inline picker */}
      {pickerTxn && (
        <div style={{ position: "fixed", left: pickerTxn.x, top: pickerTxn.y, zIndex: 9999 }}>
          <QuickPicker txn={pickerTxn.txn} currentCat={getEffectiveCat(pickerTxn.txn) ?? "Other"}
            allCats={allCatNames}
            onSelect={cat => { onSetOverride(pickerTxn.txn.id, cat); setPickerTxn(null); }}
            onClose={() => setPickerTxn(null)} />
        </div>
      )}
    </div>
  );
};

// ── Quick budget add row ────────────────────────────────────────
const QuickBudgetAdd = ({ category, suggested, onSave }: {
  category: string; suggested: number; onSave: (v: number) => void;
}) => {
  const [val, setVal] = useState(String(Math.ceil(suggested / 10) * 10));
  const [open, setOpen] = useState(false);

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="text-[11px] text-gold hover:underline flex items-center gap-1">
      <Plus className="h-3 w-3" /> Set budget
    </button>
  );

  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] text-muted-foreground">$</span>
      <input autoFocus type="number" min={1} step={10} value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { const n = parseFloat(val); if (n > 0) { onSave(n); setOpen(false); } } if (e.key === "Escape") setOpen(false); }}
        className="w-20 bg-secondary/50 border border-border/50 rounded px-1.5 py-0.5 text-[11px] text-foreground outline-none" />
      <button onClick={() => { const n = parseFloat(val); if (n > 0) { onSave(n); setOpen(false); } }}
        className="text-positive"><Check className="h-3.5 w-3.5" /></button>
      <button onClick={() => setOpen(false)} className="text-muted-foreground"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
};
