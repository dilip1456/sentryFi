/**
 * ObligationsView — Zero-based income allocation, fully auto-detected
 *
 * On first load with no obligations, auto-analyzes 3 months of transactions:
 *   Fixed     — same merchant 2+ months, amount stable (<10% variance)
 *   Flex      — utility/telecom/insurance categories, variable amount
 *   Envelope  — discretionary Plaid categories, limit = 3mo average
 *   Goal      — suggests emergency fund based on income
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fmtUSD } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Lock, Zap, ShoppingBag, Target, Plus, X,
  AlertTriangle, CheckCircle2, Shuffle, Wallet,
  Pencil, ArrowRight, Sparkles, ChevronRight, Info, Loader2
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Obligation {
  id: string;
  name: string;
  type: "fixed" | "flex" | "envelope" | "goal";
  amount: number;
  category?: string;
  merchant_hint?: string;
  goal_target?: number;
  goal_deadline?: string;
  sort_order: number;
}

interface PTxn {
  id: string;
  amount: number | string;
  name: string | null;
  merchant_name?: string | null;
  date: string;
  category?: string[] | null;
  pending?: boolean;
  [k: string]: any;
}

interface Props {
  txns: PTxn[];
  month: string;
  formatCat: (s: string) => string;
  catColor: (s: string) => string;
  getEffectiveCategory: (t: PTxn) => string;
}

// ─── Bucket metadata ────────────────────────────────────────────────────────

const BUCKETS = [
  { type: "fixed" as const,    label: "Fixed",    full: "Fixed Commitments", sublabel: "Same every month",           icon: Lock,        colorClass: "text-blue-400",   bg: "bg-blue-500/10",   border: "border-blue-500/20",   bar: "bg-blue-500" },
  { type: "flex" as const,     label: "Flex",     full: "Flex Bills",         sublabel: "Variable — max threshold",   icon: Zap,         colorClass: "text-amber-400",  bg: "bg-amber-500/10",  border: "border-amber-500/20",  bar: "bg-amber-500" },
  { type: "envelope" as const, label: "Envelope", full: "Spending Envelopes", sublabel: "Discretionary limits",       icon: ShoppingBag, colorClass: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/20", bar: "bg-violet-500" },
  { type: "goal" as const,     label: "Goal",     full: "Savings Goals",      sublabel: "Monthly allocation",          icon: Target,      colorClass: "text-emerald-400",bg: "bg-emerald-500/10",border: "border-emerald-500/20",bar: "bg-emerald-500" },
] as const;

// ─── Category classification ─────────────────────────────────────────────────

const FLEX_KEYWORDS = [
  "utilities","electric","gas","water","internet","cable","phone","telecom",
  "insurance","rent","subscription","streaming","spotify","netflix","hulu","apple",
  "amazon prime","gym","fitness"
];
const FLEX_CATS = [
  "rent_and_utilities","utilities","home_improvement","personal_care",
  "general_services","subscription","insurance"
];
const INCOME_CATS = ["income","payroll","deposit","transfer_in","wages"];

function isIncomeAmount(amount: number, cat: string): boolean {
  return amount > 0 && INCOME_CATS.some(k => cat.toLowerCase().includes(k));
}

function classifyCategory(cat: string, name: string): "fixed" | "flex" | "envelope" | null {
  const c = cat.toLowerCase();
  const n = name.toLowerCase();
  if (FLEX_CATS.some(k => c.includes(k))) return "flex";
  if (FLEX_KEYWORDS.some(k => n.includes(k) || c.includes(k))) return "flex";
  if (["loan","mortgage","payment","car_payment","credit_card"].some(k => c.includes(k) || n.includes(k))) return "fixed";
  if (["food","dining","restaurant","entertainment","shopping","travel","transport",
       "personal","health","education","recreation"].some(k => c.includes(k))) return "envelope";
  return null;
}

// ─── Auto-detection ──────────────────────────────────────────────────────────

interface Detected {
  name: string;
  type: "fixed" | "flex" | "envelope" | "goal";
  amount: number;
  category?: string;
  merchant_hint?: string;
  goal_target?: number;
  selected: boolean;
  confidence: "high" | "medium";
}

function autoDetect(allTxns: PTxn[], getEffCat: (t: PTxn) => string): Detected[] {
  const now = new Date();
  const results: Detected[] = [];

  // Build 3 months of expense transactions
  const months: string[] = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const expenseTxns = allTxns.filter(t => {
    const amt = Number(t.amount);
    const cat = getEffCat(t).toLowerCase();
    return amt < 0 && !isIncomeAmount(amt, cat) && !t.pending;
  });

  const incomeTxns = allTxns.filter(t => {
    const amt = Number(t.amount);
    const cat = getEffCat(t).toLowerCase();
    return isIncomeAmount(amt, cat) && !t.pending;
  });

  // Monthly income avg
  const monthlyIncome = months.reduce((s, m) => {
    const monthInc = incomeTxns
      .filter(t => t.date?.startsWith(m))
      .reduce((a, t) => a + Number(t.amount), 0);
    return s + monthInc;
  }, 0) / 3;

  // ── FIXED & FLEX: group by merchant, check recurrence ──────────────────

  const byMerchant: Record<string, { txns: PTxn[]; byMonth: Record<string, number[]> }> = {};
  for (const t of expenseTxns) {
    const key = (t.merchant_name || t.name || "Unknown").trim();
    if (!byMerchant[key]) byMerchant[key] = { txns: [], byMonth: {} };
    byMerchant[key].txns.push(t);
    const m = t.date?.slice(0, 7) ?? "";
    if (months.includes(m)) {
      if (!byMerchant[key].byMonth[m]) byMerchant[key].byMonth[m] = [];
      byMerchant[key].byMonth[m].push(Math.abs(Number(t.amount)));
    }
  }

  const usedMerchants = new Set<string>();

  for (const [merchant, data] of Object.entries(byMerchant)) {
    const monthsPresent = Object.keys(data.byMonth).filter(m => months.includes(m));
    if (monthsPresent.length < 2) continue; // needs to appear in 2+ months

    const allAmounts = Object.values(data.byMonth).flat();
    const avg = allAmounts.reduce((a, b) => a + b, 0) / allAmounts.length;
    const variance = allAmounts.map(a => Math.abs(a - avg) / avg);
    const maxVariance = Math.max(...variance);
    const cat = getEffCat(data.txns[0]);
    const guessedType = classifyCategory(cat, merchant);

    if (avg < 2) continue; // skip tiny amounts

    if (maxVariance < 0.08) {
      // Very stable amount → Fixed
      results.push({
        name: merchant,
        type: "fixed",
        amount: Math.round(avg * 100) / 100,
        merchant_hint: merchant.split(" ")[0],
        category: cat,
        selected: true,
        confidence: monthsPresent.length === 3 ? "high" : "medium",
      });
      usedMerchants.add(merchant);
    } else if (guessedType === "flex" || maxVariance < 0.4) {
      // Variable but recurring → Flex (max = avg + 20%)
      results.push({
        name: merchant,
        type: "flex",
        amount: Math.round(avg * 1.2 * 100) / 100,
        merchant_hint: merchant.split(" ")[0],
        category: cat,
        selected: true,
        confidence: "medium",
      });
      usedMerchants.add(merchant);
    }
  }

  // ── ENVELOPES: group remaining by category ──────────────────────────────

  const catSpend: Record<string, number[]> = {};
  for (const t of expenseTxns) {
    const m = t.date?.slice(0, 7) ?? "";
    if (!months.includes(m)) continue;
    const merchant = (t.merchant_name || t.name || "").trim();
    if (usedMerchants.has(merchant)) continue; // already in fixed/flex
    const cat = getEffCat(t);
    if (INCOME_CATS.some(k => cat.toLowerCase().includes(k))) continue;
    if (!catSpend[cat]) catSpend[cat] = [0, 0, 0];
    const idx = months.indexOf(m);
    catSpend[cat][idx] += Math.abs(Number(t.amount));
  }

  const SKIP_CATS = new Set(["transfer","payment","credit_card","internal","other_income","payroll"]);

  for (const [cat, amounts] of Object.entries(catSpend)) {
    if (SKIP_CATS.has(cat.toLowerCase())) continue;
    const nonZero = amounts.filter(a => a > 0);
    if (nonZero.length < 2) continue;
    const avg = amounts.reduce((a, b) => a + b, 0) / 3;
    if (avg < 10) continue;

    results.push({
      name: cat.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      type: "envelope",
      amount: Math.round(avg * 1.1 * 100) / 100, // 10% buffer
      category: cat,
      selected: true,
      confidence: nonZero.length === 3 ? "high" : "medium",
    });
  }

  // ── GOAL: Emergency fund suggestion ────────────────────────────────────

  if (monthlyIncome > 0) {
    const totalExpenses = results.filter(r => r.type !== "goal").reduce((s, r) => s + r.amount, 0);
    const suggested = Math.round(Math.min(monthlyIncome * 0.1, 500));
    results.push({
      name: "Emergency Fund",
      type: "goal",
      amount: suggested,
      goal_target: totalExpenses * 3,
      selected: false, // opt-in for goals
      confidence: "medium",
    });
  }

  return results;
}

// ─── Setup wizard modal ──────────────────────────────────────────────────────

interface SetupWizardProps {
  detected: Detected[];
  userId: string;
  onDone: () => void;
  onSkip: () => void;
}

function SetupWizard({ detected, userId, onDone, onSkip }: SetupWizardProps) {
  const [items, setItems] = useState<Detected[]>(detected);
  const [saving, setSaving] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const toggle = (i: number) => setItems(prev => prev.map((x, idx) => idx === i ? { ...x, selected: !x.selected } : x));
  const updateAmt = (i: number, val: string) => setItems(prev => prev.map((x, idx) => idx === i ? { ...x, amount: parseFloat(val) || 0 } : x));

  const byType = (type: string) => items.map((x, i) => ({ ...x, _idx: i })).filter(x => x.type === type);
  const selectedCount = items.filter(x => x.selected).length;

  const save = async () => {
    setSaving(true);
    const toCreate = items.filter(x => x.selected).map((x, i) => ({
      user_id: userId,
      name: x.name,
      type: x.type,
      amount: x.amount,
      category: x.category ?? null,
      merchant_hint: x.merchant_hint ?? null,
      goal_target: x.goal_target ?? null,
      sort_order: i,
    }));
    if (toCreate.length > 0) {
      await supabase.from("obligations").insert(toCreate);
    }
    setSaving(false);
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="px-5 pt-safe pt-5 pb-4 border-b border-border flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <p className="font-bold text-lg">Smart Setup</p>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Detected {detected.length} obligations from your last 3 months
          </p>
        </div>
        <button onClick={onSkip} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-muted transition-colors">
          Skip
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {BUCKETS.map(bucket => {
          const bItems = byType(bucket.type);
          if (bItems.length === 0) return null;
          const Icon = bucket.icon;

          return (
            <div key={bucket.type}>
              <div className="flex items-center gap-2 mb-2">
                <div className={cn("h-6 w-6 rounded-md flex items-center justify-center", bucket.bg)}>
                  <Icon className={cn("h-3.5 w-3.5", bucket.colorClass)} />
                </div>
                <span className="text-sm font-semibold">{bucket.full}</span>
                <span className="text-xs text-muted-foreground">{bucket.sublabel}</span>
              </div>

              <div className="space-y-1.5">
                {bItems.map((item) => {
                  const i = item._idx;
                  const isEditing = editIdx === i;
                  return (
                    <div key={i}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors",
                        item.selected ? `${bucket.border} ${bucket.bg}` : "border-border bg-card/30 opacity-50"
                      )}
                    >
                      {/* Checkbox */}
                      <button onClick={() => toggle(i)}
                        className={cn("h-5 w-5 rounded-md border-2 shrink-0 flex items-center justify-center transition-colors",
                          item.selected ? `${bucket.bar.replace("bg-","border-")} ${bucket.bar}` : "border-border"
                        )}
                      >
                        {item.selected && <CheckCircle2 className="h-3 w-3 text-white" />}
                      </button>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        {item.confidence === "medium" && (
                          <p className="text-[10px] text-muted-foreground/70">Estimated — adjust if needed</p>
                        )}
                      </div>

                      {/* Amount */}
                      {isEditing ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-xs text-muted-foreground">$</span>
                          <input
                            autoFocus
                            type="text" inputMode="decimal"
                            defaultValue={item.amount.toFixed(0)}
                            onBlur={e => { updateAmt(i, e.target.value); setEditIdx(null); }}
                            onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") { updateAmt(i, (e.target as HTMLInputElement).value); setEditIdx(null); }}}
                            className="w-20 bg-transparent border-b border-primary outline-none text-right text-sm font-bold py-0.5"
                          />
                        </div>
                      ) : (
                        <button onClick={() => setEditIdx(i)} className="flex items-center gap-1 shrink-0 group">
                          <span className="text-sm font-bold">{fmtUSD(item.amount)}</span>
                          <Pencil className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                        </button>
                      )}
                      {bucket.type === "flex" && (
                        <span className="text-[10px] text-muted-foreground shrink-0">max</span>
                      )}
                      {bucket.type === "goal" && item.goal_target && (
                        <span className="text-[10px] text-muted-foreground shrink-0">of {fmtUSD(item.goal_target)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 pb-safe pb-6 pt-3 border-t border-border">
        <p className="text-xs text-center text-muted-foreground mb-3">
          {selectedCount} selected · tap amount to adjust · uncheck to skip
        </p>
        <button
          onClick={save}
          disabled={saving || selectedCount === 0}
          className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {saving ? "Setting up…" : `Set up ${selectedCount} obligation${selectedCount !== 1 ? "s" : ""}`}
        </button>
      </div>
    </div>
  );
}

// ─── Edit modal ──────────────────────────────────────────────────────────────

interface EditModalProps {
  initial?: Partial<Obligation>;
  defaultType?: Obligation["type"];
  userId: string;
  onSave: () => void;
  onClose: () => void;
}

function EditModal({ initial, defaultType = "fixed", userId, onSave, onClose }: EditModalProps) {
  const [name, setName]      = useState(initial?.name ?? "");
  const [type, setType]      = useState<Obligation["type"]>(initial?.type ?? defaultType);
  const [amount, setAmount]  = useState(String(initial?.amount ?? ""));
  const [category, setCat]   = useState(initial?.category ?? "");
  const [merchant, setMerch] = useState(initial?.merchant_hint ?? "");
  const [goalT, setGoalT]    = useState(String(initial?.goal_target ?? ""));
  const [saving, setSaving]  = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !amount) return;
    setSaving(true);
    const payload = { user_id: userId, name: name.trim(), type, amount: parseFloat(amount),
      category: category || null, merchant_hint: merchant || null,
      goal_target: type === "goal" && goalT ? parseFloat(goalT) : null };
    if (initial?.id) await supabase.from("obligations").update(payload).eq("id", initial.id);
    else await supabase.from("obligations").insert(payload);
    setSaving(false);
    onSave();
  };

  const handleDelete = async () => {
    if (!initial?.id) return;
    await supabase.from("obligations").delete().eq("id", initial.id);
    onSave();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl w-full max-w-md mx-0 sm:mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
          <p className="font-semibold">{initial?.id ? "Edit" : "Add"} obligation</p>
          <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <div className="flex gap-1.5 flex-wrap">
            {BUCKETS.map(b => (
              <button key={b.type} onClick={() => setType(b.type)}
                className={cn("px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                  type === b.type ? `${b.bg} ${b.colorClass} ${b.border}` : "bg-muted/40 text-muted-foreground border-transparent")}>
                {b.label}
              </button>
            ))}
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder={type === "fixed" ? "Mortgage" : type === "flex" ? "Electricity" : type === "envelope" ? "Dining out" : "Emergency fund"}
              className="w-full bg-muted/40 border border-border rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-primary/50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">
              {type === "fixed" ? "Monthly amount" : type === "flex" ? "Monthly max" : type === "goal" ? "Monthly contribution" : "Monthly limit"}
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00" type="text" inputMode="decimal"
                className="w-full bg-muted/40 border border-border rounded-xl pl-7 pr-3.5 py-2.5 text-sm outline-none focus:border-primary/50" />
            </div>
          </div>
          {type === "goal" && (
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Target total</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <input value={goalT} onChange={e => setGoalT(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="10,000" type="text" inputMode="decimal"
                  className="w-full bg-muted/40 border border-border rounded-xl pl-7 pr-3.5 py-2.5 text-sm outline-none focus:border-primary/50" />
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            {initial?.id && (
              <button onClick={handleDelete} className="flex-1 py-2.5 rounded-xl border border-destructive/40 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors">Delete</button>
            )}
            <button onClick={handleSave} disabled={saving || !name.trim() || !amount}
              className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Cover modal ─────────────────────────────────────────────────────────────

interface CoverModalProps {
  exceeded: { ob: Obligation; over: number }[];
  envelopes: Obligation[];
  goals: Obligation[];
  month: string;
  userId: string;
  onClose: () => void;
}

function CoverModal({ exceeded, envelopes, goals, month, userId, onClose }: CoverModalProps) {
  const [done, setDone] = useState(false);
  const totalOver = exceeded.reduce((s, e) => s + e.over, 0);

  const act = async (fromId: string | null, type: string, note: string) => {
    for (const e of exceeded) {
      await supabase.from("cover_actions").insert({
        user_id: userId, month, from_id: fromId, to_id: e.ob.id,
        amount: e.over, action_type: type, note,
      });
    }
    setDone(true);
  };

  if (done) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card rounded-2xl p-8 mx-4 text-center max-w-sm w-full" onClick={e => e.stopPropagation()}>
        <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto mb-3" />
        <p className="font-semibold text-lg">Logged</p>
        <p className="text-muted-foreground text-sm mt-1">Covered {fmtUSD(totalOver)} this month</p>
        <button onClick={onClose} className="mt-5 w-full bg-primary text-primary-foreground py-2.5 rounded-xl font-medium text-sm">Done</button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl w-full max-w-md mx-0 sm:mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
          <div>
            <p className="font-semibold">How to cover {fmtUSD(totalOver)}?</p>
            <p className="text-xs text-muted-foreground mt-0.5">{exceeded.map(e => e.ob.name).join(", ")} over</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-2 max-h-[70vh] overflow-y-auto">
          <div className="bg-destructive/10 rounded-xl p-3 mb-3 space-y-1">
            {exceeded.map(e => (
              <div key={e.ob.id} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{e.ob.name}</span>
                <span className="text-destructive font-medium">+{fmtUSD(e.over)}</span>
              </div>
            ))}
          </div>
          {envelopes.filter(e => !exceeded.find(x => x.ob.id === e.id)).map(env => (
            <button key={env.id} onClick={() => act(env.id, "shift", `Shifted from ${env.name}`)}
              className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-border hover:bg-muted/50 transition-colors text-left">
              <div className="h-8 w-8 rounded-full bg-violet-500/15 flex items-center justify-center shrink-0"><Shuffle className="h-3.5 w-3.5 text-violet-400" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Shift from {env.name}</p>
                <p className="text-xs text-muted-foreground">{fmtUSD(env.amount)} budgeted</p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          ))}
          {goals.slice(0, 2).map(g => (
            <button key={g.id} onClick={() => act(g.id, "goal_borrow", `Borrowed from ${g.name}`)}
              className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-border hover:bg-muted/50 transition-colors text-left">
              <div className="h-8 w-8 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0"><Target className="h-3.5 w-3.5 text-emerald-400" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Pause {g.name} this month</p>
                <p className="text-xs text-muted-foreground">Borrow from your savings goal</p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          ))}
          <button onClick={() => act(null, "absorb", "One-time exception")}
            className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-border hover:bg-muted/50 transition-colors text-left">
            <div className="h-8 w-8 rounded-full bg-orange-500/15 flex items-center justify-center shrink-0"><Wallet className="h-3.5 w-3.5 text-orange-400" /></div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">It's a one-time thing — absorb it</p>
              <p className="text-xs text-muted-foreground">Log as an exception this month</p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

function detectIncome(txns: PTxn[], getEffCat: (t: PTxn) => string): number {
  return txns
    .filter(t => {
      const amt = Number(t.amount);
      const cat = getEffCat(t).toLowerCase();
      return amt > 0 && INCOME_CATS.some(k => cat.includes(k)) && !t.pending;
    })
    .reduce((s, t) => s + Number(t.amount), 0);
}

function spentForObligation(ob: Obligation, txns: PTxn[], getEffCat: (t: PTxn) => string): number {
  return txns.filter(t => {
    const amt = Number(t.amount);
    if (amt >= 0) return false;
    const name = (t.merchant_name || t.name || "").toLowerCase();
    const cat  = getEffCat(t).toLowerCase();
    if (ob.merchant_hint && name.includes(ob.merchant_hint.toLowerCase())) return true;
    if (ob.category && cat.includes(ob.category.toLowerCase())) return true;
    return false;
  }).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
}

export function ObligationsView({ txns, month, formatCat, catColor, getEffectiveCategory }: Props) {
  const [obligations, setObs]   = useState<Obligation[]>([]);
  const [loading, setLoading]   = useState(true);
  const [userId, setUserId]     = useState<string | null>(null);
  const [detected, setDetected] = useState<Detected[] | null>(null);
  const [editing, setEditing]   = useState<Partial<Obligation> | null>(null);
  const [addType, setAddType]   = useState<Obligation["type"] | null>(null);
  const [coverModal, setCover]  = useState(false);

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)); }, []);

  const loadObs = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.from("obligations").select("*").eq("user_id", userId).eq("active", true).order("sort_order");
    const obs = (data ?? []) as Obligation[];
    setObs(obs);

    // Auto-detect if empty
    if (obs.length === 0 && txns.length > 0) {
      const d = autoDetect(txns, getEffectiveCategory);
      setDetected(d);
    }
    setLoading(false);
  }, [userId, txns, getEffectiveCategory]);

  useEffect(() => { loadObs(); }, [loadObs]);

  // ── Numbers ───────────────────────────────────────────────────────────────

  const monthTxns = useMemo(() => txns.filter(t => t.date?.startsWith(month)), [txns, month]);
  const income    = useMemo(() => detectIncome(monthTxns, getEffectiveCategory), [monthTxns, getEffectiveCategory]);

  const spentMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const ob of obligations) m[ob.id] = spentForObligation(ob, monthTxns, getEffectiveCategory);
    return m;
  }, [obligations, monthTxns, getEffectiveCategory]);

  const bucketTotals = useMemo(() => {
    const t: Record<string, number> = { fixed: 0, flex: 0, envelope: 0, goal: 0 };
    for (const ob of obligations) t[ob.type] += ob.amount;
    return t;
  }, [obligations]);

  const totalAllocated = Object.values(bucketTotals).reduce((a, b) => a + b, 0);
  const freeAmount     = income - totalAllocated;

  const exceeded = useMemo(() =>
    obligations.filter(ob => ob.type !== "goal" && spentMap[ob.id] > ob.amount)
               .map(ob => ({ ob, over: spentMap[ob.id] - ob.amount })),
    [obligations, spentMap]
  );

  const byType = (type: Obligation["type"]) => obligations.filter(o => o.type === type);

  // ── Setup wizard ──────────────────────────────────────────────────────────

  if (!loading && detected !== null) {
    return (
      <SetupWizard
        detected={detected}
        userId={userId!}
        onDone={() => { setDetected(null); loadObs(); }}
        onSkip={() => setDetected(null)}
      />
    );
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center py-24">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <div className="flex flex-col min-h-full">

      {/* ── Income allocation bar ──────────────────────────────────────────── */}
      <div className="px-4 md:px-8 pt-5 pb-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Monthly Income</p>
            <p className="text-2xl font-bold tracking-tight">{income > 0 ? fmtUSD(income) : "—"}</p>
            {income === 0 && <p className="text-[11px] text-muted-foreground/60 mt-0.5 flex items-center gap-1"><Info className="h-3 w-3"/>Auto-detected from transactions</p>}
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground mb-0.5">{freeAmount >= 0 ? "Free" : "Over allocated"}</p>
            <p className={cn("text-xl font-bold", freeAmount >= 0 ? "text-emerald-400" : "text-destructive")}>{fmtUSD(Math.abs(freeAmount))}</p>
          </div>
        </div>

        {income > 0 && totalAllocated > 0 && (
          <>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden flex gap-px">
              {BUCKETS.map(b => {
                const pct = Math.min((bucketTotals[b.type] / income) * 100, 100);
                if (pct < 0.5) return null;
                return <div key={b.type} style={{ width: `${pct}%` }} className={cn("h-full", b.bar)} />;
              })}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {BUCKETS.map(b => {
                if (!bucketTotals[b.type]) return null;
                const pct = Math.round((bucketTotals[b.type] / income) * 100);
                return (
                  <div key={b.type} className="flex items-center gap-1.5">
                    <div className={cn("h-2 w-2 rounded-full", b.bar)} />
                    <span className="text-[11px] text-muted-foreground">{b.label} {fmtUSD(bucketTotals[b.type])} ({pct}%)</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Exceeded alert ────────────────────────────────────────────────── */}
      {exceeded.length > 0 && (
        <div className="mx-4 md:mx-8 mb-4 rounded-xl bg-destructive/10 border border-destructive/25 p-3.5 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {exceeded.length === 1
                ? `${exceeded[0].ob.name} over by ${fmtUSD(exceeded[0].over)}`
                : `${exceeded.length} over · ${fmtUSD(exceeded.reduce((s,e) => s+e.over, 0))} total`}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{exceeded.map(e => e.ob.name).join(", ")}</p>
          </div>
          <button onClick={() => setCover(true)} className="shrink-0 px-3 py-1.5 bg-destructive text-destructive-foreground rounded-lg text-xs font-medium">
            How to cover
          </button>
        </div>
      )}

      {/* ── Buckets ───────────────────────────────────────────────────────── */}
      <div className="px-4 md:px-8 pb-10 space-y-6">
        {BUCKETS.map(bucket => {
          const items  = byType(bucket.type);
          const Icon   = bucket.icon;
          const isGoal = bucket.type === "goal";

          return (
            <div key={bucket.type}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={cn("h-6 w-6 rounded-md flex items-center justify-center", bucket.bg)}>
                    <Icon className={cn("h-3.5 w-3.5", bucket.colorClass)} />
                  </div>
                  <span className="text-sm font-semibold">{bucket.full}</span>
                  <span className="text-xs text-muted-foreground hidden sm:inline">{bucket.sublabel}</span>
                </div>
                <button onClick={() => setAddType(bucket.type)}
                  className="h-7 w-7 flex items-center justify-center rounded-lg bg-muted/60 hover:bg-muted transition-colors">
                  <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>

              {items.length === 0 ? (
                <button onClick={() => setAddType(bucket.type)}
                  className="w-full py-4 rounded-xl border border-dashed border-border text-xs text-muted-foreground/60 hover:border-primary/30 hover:text-muted-foreground transition-colors">
                  + Add {bucket.full.toLowerCase()}
                </button>
              ) : (
                <div className="space-y-1.5">
                  {items.map(ob => {
                    const spent  = spentMap[ob.id] ?? 0;
                    const pct    = ob.amount > 0 ? Math.min((spent / ob.amount) * 100, 100) : 0;
                    const isOver = !isGoal && spent > ob.amount;
                    const goalPct = isGoal && ob.goal_target ? Math.min((spent / ob.goal_target) * 100, 100) : 0;

                    return (
                      <div key={ob.id}
                        className={cn("rounded-xl border p-3.5", isOver ? "border-destructive/30 bg-destructive/5" : "border-border bg-card/50")}>
                        <div className="flex items-center gap-3">
                          <div className={cn("h-2 w-2 rounded-full shrink-0",
                            isOver ? "bg-destructive" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500")} />
                          <p className="text-sm font-medium flex-1 truncate">{ob.name}</p>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {isOver && <span className="text-xs text-destructive font-semibold">+{fmtUSD(spent - ob.amount)}</span>}
                            <span className={cn("text-sm font-bold", isOver && "text-destructive")}>{fmtUSD(isGoal ? ob.amount : spent)}</span>
                            <span className="text-xs text-muted-foreground">{isGoal ? "/mo" : `/ ${fmtUSD(ob.amount)}`}</span>
                            <button onClick={() => setEditing(ob)}
                              className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-muted transition-colors ml-1">
                              <Pencil className="h-3 w-3 text-muted-foreground/50" />
                            </button>
                          </div>
                        </div>
                        {!isGoal && ob.amount > 0 && (
                          <div className="mt-2 ml-5 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className={cn("h-full rounded-full transition-all",
                              isOver ? "bg-destructive" : pct >= 80 ? "bg-amber-500" : bucket.bar)}
                              style={{ width: `${pct}%` }} />
                          </div>
                        )}
                        {isGoal && ob.goal_target && (
                          <div className="mt-2 ml-5">
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${goalPct}%` }} />
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1">
                              {fmtUSD(spent)} saved of {fmtUSD(ob.goal_target)}
                              {ob.goal_deadline && ` · ${Math.max(1, Math.ceil((new Date(ob.goal_deadline).getTime()-Date.now())/(1000*60*60*24*30)))}mo left`}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Re-run detection */}
        {obligations.length > 0 && (
          <button
            onClick={() => { const d = autoDetect(txns, getEffectiveCategory); setDetected(d); }}
            className="w-full py-3 rounded-xl border border-dashed border-primary/30 text-xs text-primary/70 hover:text-primary hover:border-primary/60 transition-colors flex items-center justify-center gap-2"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Re-run auto-detection
          </button>
        )}
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      {(editing || addType) && userId && (
        <EditModal initial={editing ?? { type: addType ?? "fixed" }} defaultType={addType ?? editing?.type ?? "fixed"}
          userId={userId} onSave={() => { setEditing(null); setAddType(null); loadObs(); }} onClose={() => { setEditing(null); setAddType(null); }} />
      )}
      {coverModal && userId && (
        <CoverModal exceeded={exceeded} envelopes={byType("envelope")} goals={byType("goal")}
          month={month} userId={userId} onClose={() => setCover(false)} />
      )}
    </div>
  );
}
