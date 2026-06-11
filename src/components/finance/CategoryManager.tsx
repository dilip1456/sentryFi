import { useState, useMemo } from "react";
import {
  X, Plus, Trash2, Check, ChevronRight, Sparkles, Loader2,
  ArrowDownLeft, ShoppingBag, Utensils, Car, Zap, Plane, Film,
  Heart, Coffee, Wallet, PiggyBank, CreditCard, Landmark, TrendingUp,
  AlertCircle, Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtUSD } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Budgets } from "@/hooks/useBudgets";
import type { CategoryOverrides } from "@/hooks/useCategoryOverrides";
import type { CategoryRule } from "@/hooks/useCategoryRules";
import { UNASSIGNED } from "@/hooks/useCategoryOverrides";

// ── Types ──────────────────────────────────────────────────────
type PTxn = {
  id: string; amount: number; date: string;
  name: string | null; merchant_name: string | null; category: string[] | null;
};

type CustomCat = { name: string; type: "income" | "expense" };

interface Props {
  open: boolean;
  onClose: () => void;
  txns: PTxn[];
  overrides: CategoryOverrides;
  rules: CategoryRule[];
  budgets: Budgets;
  customCategories: CustomCat[];
  builtInExpense: string[];
  builtInIncome: string[];
  getEffectiveCategory: (t: PTxn) => string | null;
  onSetOverride: (id: string, cat: string) => void;
  onBulkSetOverride: (ids: string[], cat: string) => void;
  onReassignCategory: (from: string, to?: string) => void;
  onSetBudget: (cat: string, limit: number) => void;
  onRemoveBudget: (cat: string) => void;
  onAddCategory: (name: string, type: "income" | "expense") => void;
  onRemoveCategory: (name: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────
const catIcon = (cat: string | null) => {
  if (!cat) return ShoppingBag;
  const c = cat.toLowerCase();
  if (c.includes("food") || c.includes("drink") || c.includes("dining")) return Utensils;
  if (c.includes("groceries")) return ShoppingBag;
  if (c.includes("travel") || c.includes("airline")) return Plane;
  if (c.includes("transport") || c.includes("car") || c.includes("gas")) return Car;
  if (c.includes("coffee") || c.includes("cafe")) return Coffee;
  if (c.includes("util") || c.includes("bills") || c.includes("electric")) return Zap;
  if (c.includes("entertain") || c.includes("stream")) return Film;
  if (c.includes("health") || c.includes("medical")) return Heart;
  if (c.includes("wallet") || c.includes("check")) return Wallet;
  if (c.includes("savings") || c.includes("piggy")) return PiggyBank;
  if (c.includes("credit")) return CreditCard;
  if (c.includes("invest") || c.includes("dividend")) return TrendingUp;
  if (c.includes("salary") || c.includes("income") || c.includes("freelance")) return Landmark;
  if (c.includes("transfer")) return ArrowDownLeft;
  if (c.includes("unassigned")) return AlertCircle;
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
  if (c.includes("invest") || c.includes("dividend")) return "hsl(210 80% 60%)";
  if (c.includes("unassigned")) return "hsl(var(--warning))";
  return "hsl(var(--primary))";
};

// ── Budget editor inline ───────────────────────────────────────
const BudgetCell = ({ category, budget, onSave, onRemove }: {
  category: string; budget?: number;
  onSave: (v: number) => void; onRemove: () => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(budget ?? ""));

  if (editing) return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] text-muted-foreground">$</span>
      <input autoFocus type="number" min={0} step={10} value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") { const n = parseFloat(val); if (n > 0) { onSave(n); setEditing(false); } }
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-20 bg-secondary/40 border border-border/60 rounded px-1.5 py-0.5 text-[11px] text-foreground outline-none focus:border-[hsl(var(--primary)/0.5)]"
      />
      <button onClick={() => { const n = parseFloat(val); if (n > 0) { onSave(n); setEditing(false); } }}
        className="text-positive hover:opacity-80"><Check className="h-3 w-3" /></button>
      <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
    </div>
  );

  return (
    <button onClick={() => { setVal(String(budget ?? "")); setEditing(true); }}
      className="text-[11px] text-muted-foreground hover:text-foreground transition-colors text-right">
      {budget ? fmtUSD(budget) + "/mo" : <span className="text-[10px]">Set limit</span>}
    </button>
  );
};

// ── Main component ─────────────────────────────────────────────
export const CategoryManager = ({
  open, onClose, txns, overrides, rules, budgets, customCategories,
  builtInExpense, builtInIncome,
  getEffectiveCategory,
  onSetOverride, onBulkSetOverride, onReassignCategory,
  onSetBudget, onRemoveBudget,
  onAddCategory, onRemoveCategory,
}: Props) => {
  const [tab, setTab] = useState<"categories" | "unassigned">("categories");
  const [newCatName, setNewCatName] = useState("");
  const [newCatType, setNewCatType] = useState<"income" | "expense">("expense");
  const [showNewCat, setShowNewCat] = useState(false);

  // Unassigned tab state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, { category: string; confidence: string }>>({});

  // Compute unassigned transactions
  const unassigned = useMemo(() => txns.filter(t => {
    const eff = getEffectiveCategory(t);
    return !eff || eff === "Other" || eff === UNASSIGNED || eff === "other";
  }), [txns, overrides, getEffectiveCategory]);

  const allCategories = [
    ...builtInExpense.map(n => ({ name: n, type: "expense" as const, custom: false })),
    ...builtInIncome.map(n => ({ name: n, type: "income" as const, custom: false })),
    ...customCategories.map(c => ({ ...c, custom: true })),
  ];

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const selectAll = () => {
    if (selected.size === unassigned.length) setSelected(new Set());
    else setSelected(new Set(unassigned.map(t => t.id)));
  };

  const applyBulk = () => {
    if (!bulkCat || selected.size === 0) return;
    onBulkSetOverride([...selected], bulkCat);
    toast.success(`Assigned ${selected.size} transaction${selected.size > 1 ? "s" : ""} to ${bulkCat}`);
    setSelected(new Set());
    setBulkCat("");
  };

  const runAI = async () => {
    if (unassigned.length === 0) return;
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-categorize", {
        body: {
          transactions: unassigned.map(t => ({
            id: t.id, name: t.name, merchant_name: t.merchant_name,
            amount: t.amount, category: t.category,
          })),
          rules: rules.map(r => ({ merchantPattern: r.merchantPattern, category: r.category })),
          // Pass recent manual overrides as few-shot examples for learning
          userExamples: Object.entries(overrides)
            .slice(-30)
            .map(([id, category]) => {
              const txn = txns.find(t => t.id === id);
              return txn ? { name: txn.merchant_name ?? txn.name ?? "", category } : null;
            })
            .filter(Boolean) as { name: string; category: string }[],
        },
      });
      if (error || !data?.results) throw new Error(error?.message ?? "No results");
      const map: Record<string, { category: string; confidence: string }> = {};
      (data.results as { id: string; category: string; confidence: string }[]).forEach(r => {
        map[r.id] = { category: r.category, confidence: r.confidence };
      });
      setAiSuggestions(map);
      toast.success(`AI suggested categories for ${Object.keys(map).length} transactions`);
    } catch (e) {
      toast.error("AI categorization failed", { description: String(e) });
    } finally {
      setAiLoading(false);
    }
  };

  const acceptSuggestion = (txnId: string) => {
    const s = aiSuggestions[txnId];
    if (!s) return;
    onSetOverride(txnId, s.category);
    const next = { ...aiSuggestions };
    delete next[txnId];
    setAiSuggestions(next);
  };

  const acceptAllSuggestions = () => {
    const ids = Object.keys(aiSuggestions);
    ids.forEach(id => onSetOverride(id, aiSuggestions[id].category));
    toast.success(`Applied ${ids.length} AI suggestions`);
    setAiSuggestions({});
  };

  const deleteCategory = (name: string) => {
    onReassignCategory(name, UNASSIGNED);
    onRemoveCategory(name);
    toast.success(`"${name}" deleted — affected transactions moved to Unassigned`);
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-background/50 backdrop-blur-sm" onClick={onClose} />
      <div className={cn(
        "fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] flex flex-col bg-card",
        "border-l shadow-2xl",
      )} style={{ borderColor: "var(--gold-border)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--gold-border)" }}>
          <h2 className="font-display text-lg text-foreground">Manage Categories</h2>
          <button onClick={onClose} className="h-8 w-8 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b" style={{ borderColor: "var(--gold-border)" }}>
          <button onClick={() => setTab("categories")}
            className={cn("flex-1 py-2.5 text-[12px] font-medium transition-colors",
              tab === "categories" ? "text-foreground border-b-2 border-[hsl(var(--primary))]" : "text-muted-foreground hover:text-foreground")}>
            Categories
          </button>
          <button onClick={() => setTab("unassigned")}
            className={cn("flex-1 py-2.5 text-[12px] font-medium transition-colors flex items-center justify-center gap-1.5",
              tab === "unassigned" ? "text-foreground border-b-2 border-[hsl(var(--primary))]" : "text-muted-foreground hover:text-foreground")}>
            Unassigned
            {unassigned.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-warning/20 text-warning text-[10px] tabular">{unassigned.length}</span>
            )}
          </button>
        </div>

        {/* ── CATEGORIES TAB ── */}
        {tab === "categories" && (
          <div className="flex-1 overflow-y-auto">
            {/* Add category */}
            <div className="px-5 py-3 border-b border-border/30">
              {showNewCat ? (
                <div className="flex items-center gap-2">
                  <input autoFocus value={newCatName} onChange={e => setNewCatName(e.target.value)}
                    placeholder="Category name…"
                    onKeyDown={e => { if (e.key === "Enter" && newCatName.trim()) { onAddCategory(newCatName.trim(), newCatType); setNewCatName(""); setShowNewCat(false); toast.success(`Category "${newCatName.trim()}" created`); } if (e.key === "Escape") setShowNewCat(false); }}
                    className="flex-1 bg-secondary/40 border border-border/60 rounded-md px-3 py-1.5 text-[12px] text-foreground outline-none focus:border-[hsl(var(--primary)/0.5)]" />
                  <select value={newCatType} onChange={e => setNewCatType(e.target.value as "income"|"expense")}
                    className="bg-secondary/40 border border-border/60 rounded-md px-2 py-1.5 text-[12px] text-foreground outline-none">
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                  <button onClick={() => { if (newCatName.trim()) { onAddCategory(newCatName.trim(), newCatType); setNewCatName(""); setShowNewCat(false); toast.success(`Created "${newCatName.trim()}"`); } }}
                    className="h-7 w-7 rounded-md bg-gold grid place-items-center hover:opacity-90">
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setShowNewCat(false)} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                </div>
              ) : (
                <button onClick={() => setShowNewCat(true)}
                  className="flex items-center gap-2 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
                  <Plus className="h-3.5 w-3.5" /> Add custom category
                </button>
              )}
            </div>

            {/* Expense categories */}
            <div className="px-5 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground py-2">Expense</div>
              {[...builtInExpense, ...customCategories.filter(c => c.type === "expense").map(c => c.name)].map(name => {
                const Icon = catIcon(name); const color = catColor(name);
                const isCustom = customCategories.some(c => c.name === name);
                const txnCount = txns.filter(t => getEffectiveCategory(t) === name).length;
                return (
                  <div key={name} className="group flex items-center gap-3 py-2 border-b border-border/20 last:border-0">
                    <div className="h-7 w-7 rounded-md grid place-items-center shrink-0" style={{ backgroundColor: `${color}1f`, color }}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12.5px] text-foreground">{name}</span>
                        {isCustom && <span className="text-[9px] px-1 py-0.5 rounded bg-secondary text-muted-foreground">custom</span>}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{txnCount} transaction{txnCount !== 1 ? "s" : ""}</div>
                    </div>
                    <BudgetCell category={name} budget={budgets[name]}
                      onSave={v => onSetBudget(name, v)} onRemove={() => onRemoveBudget(name)} />
                    {isCustom && (
                      <button onClick={() => deleteCategory(name)}
                        className="opacity-0 group-hover:opacity-100 h-6 w-6 grid place-items-center text-muted-foreground hover:text-negative transition-all">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Income categories */}
            <div className="px-5 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground py-2">Income</div>
              {[...builtInIncome, ...customCategories.filter(c => c.type === "income").map(c => c.name)].map(name => {
                const Icon = catIcon(name); const color = catColor(name);
                const isCustom = customCategories.some(c => c.name === name);
                const txnCount = txns.filter(t => getEffectiveCategory(t) === name).length;
                return (
                  <div key={name} className="group flex items-center gap-3 py-2 border-b border-border/20 last:border-0">
                    <div className="h-7 w-7 rounded-md grid place-items-center shrink-0" style={{ backgroundColor: `${color}1f`, color }}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12.5px] text-foreground">{name}</span>
                        {isCustom && <span className="text-[9px] px-1 py-0.5 rounded bg-secondary text-muted-foreground">custom</span>}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{txnCount} transaction{txnCount !== 1 ? "s" : ""}</div>
                    </div>
                    {isCustom && (
                      <button onClick={() => deleteCategory(name)}
                        className="opacity-0 group-hover:opacity-100 h-6 w-6 grid place-items-center text-muted-foreground hover:text-negative transition-all">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── UNASSIGNED TAB ── */}
        {tab === "unassigned" && (
          <>
            {/* Toolbar */}
            <div className="px-4 py-3 border-b border-border/30 space-y-2">
              {/* AI + Accept all */}
              <div className="flex items-center gap-2">
                <button onClick={runAI} disabled={aiLoading || unassigned.length === 0}
                  className="flex-1 h-8 rounded-lg bg-gold text-[12px] font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1.5">
                  {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {aiLoading ? "Analyzing…" : "AI Suggest All"}
                </button>
                {Object.keys(aiSuggestions).length > 0 && (
                  <button onClick={acceptAllSuggestions}
                    className="h-8 px-3 rounded-lg border border-positive/40 bg-positive/10 text-positive text-[12px] font-medium hover:bg-positive/20 transition-colors flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5" /> Accept all ({Object.keys(aiSuggestions).length})
                  </button>
                )}
              </div>

              {/* Bulk assign */}
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox"
                    checked={selected.size > 0 && selected.size === unassigned.length}
                    onChange={selectAll}
                    className="accent-[hsl(var(--primary))] h-3.5 w-3.5" />
                  <span className="text-[11px] text-muted-foreground">
                    {selected.size > 0 ? `${selected.size} selected` : "Select all"}
                  </span>
                </label>
                {selected.size > 0 && (
                  <>
                    <select value={bulkCat} onChange={e => setBulkCat(e.target.value)}
                      className="flex-1 bg-secondary/40 border border-border/60 rounded-md px-2 py-1 text-[11px] text-foreground outline-none focus:border-[hsl(var(--primary)/0.5)]">
                      <option value="">Assign to…</option>
                      <optgroup label="Expense">
                        {builtInExpense.map(c => <option key={c} value={c}>{c}</option>)}
                        {customCategories.filter(c => c.type === "expense").map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </optgroup>
                      <optgroup label="Income">
                        {builtInIncome.map(c => <option key={c} value={c}>{c}</option>)}
                        {customCategories.filter(c => c.type === "income").map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </optgroup>
                    </select>
                    <button onClick={applyBulk} disabled={!bulkCat}
                      className="h-7 px-3 rounded-md bg-gold text-[11px] font-medium hover:opacity-90 disabled:opacity-50">
                      Apply
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Unassigned list */}
            <div className="flex-1 overflow-y-auto">
              {unassigned.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
                  <Check className="h-10 w-10 text-positive" />
                  <div className="font-display text-base text-foreground">All categorized</div>
                  <div className="text-[12px] text-muted-foreground">Every transaction has a category. Nice work!</div>
                </div>
              ) : (
                unassigned.map((t, i) => {
                  const isIncome = Number(t.amount) < 0;
                  const suggestion = aiSuggestions[t.id];
                  const confColor = suggestion?.confidence === "high" ? "text-positive" : suggestion?.confidence === "medium" ? "text-warning" : "text-muted-foreground";
                  return (
                    <div key={t.id}
                      className={cn("flex items-center gap-3 px-4 py-2.5 border-b border-border/20 transition-colors",
                        selected.has(t.id) ? "bg-secondary/30" : "hover:bg-secondary/20")}>
                      <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)}
                        className="accent-[hsl(var(--primary))] h-3.5 w-3.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] text-foreground truncate">
                          {t.merchant_name ?? t.name ?? "Transaction"}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {new Date(t.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          {suggestion && (
                            <span className={cn("ml-2 font-medium", confColor)}>
                              AI: {suggestion.category}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className={cn("text-[12px] tabular font-medium shrink-0", isIncome ? "text-positive" : "text-foreground")}>
                        {isIncome ? "+" : "−"}{fmtUSD(Math.abs(Number(t.amount)), { cents: true })}
                      </div>
                      {suggestion && (
                        <button onClick={() => acceptSuggestion(t.id)}
                          className="shrink-0 h-6 px-2 rounded bg-positive/15 text-positive text-[10px] font-medium hover:bg-positive/25 transition-colors flex items-center gap-1">
                          <Check className="h-3 w-3" /> Apply
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
};
