/**
 * ObligationsView — Zero-based income allocation
 *
 * Four buckets:
 *   fixed    — mortgage, car payment, credit card minimums (same every month)
 *   flex     — utilities, phone, groceries (vary; set a monthly max)
 *   envelope — dining, entertainment, shopping (discretionary spending categories)
 *   goal     — savings allocations (vacation, emergency fund, down payment)
 *
 * Key insight: income auto-detected from transactions.
 * Everything flows from: Income − (Fixed + Flex + Envelopes + Goals) = Free
 * Exceeded items surface with "How to cover?" options.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fmtUSD } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Lock, Zap, ShoppingBag, Target, Plus, X, ChevronRight,
  AlertTriangle, CheckCircle2, TrendingDown, Shuffle, Wallet,
  Pencil, Check, ArrowRight, Info
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

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
  amount: number;
  name: string;
  merchant_name?: string;
  date: string;
  category?: string;
  pending?: boolean;
}

interface Props {
  txns: PTxn[];
  month: string; // "YYYY-MM"
  formatCat: (s: string) => string;
  catColor: (s: string) => string;
}

// ─── Bucket metadata ────────────────────────────────────────────────────────

const BUCKETS = [
  {
    type: "fixed" as const,
    label: "Fixed Commitments",
    sublabel: "Same every month",
    icon: Lock,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
  },
  {
    type: "flex" as const,
    label: "Flex Bills",
    sublabel: "Vary monthly — max threshold set",
    icon: Zap,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  {
    type: "envelope" as const,
    label: "Spending Envelopes",
    sublabel: "Discretionary — track against limit",
    icon: ShoppingBag,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/20",
  },
  {
    type: "goal" as const,
    label: "Savings Goals",
    sublabel: "Monthly allocation toward targets",
    icon: Target,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function detectIncome(txns: PTxn[]): number {
  // Sum positive amounts (deposits/payroll) — filter out obvious refunds < $50
  return txns
    .filter(t => t.amount > 50 && !t.pending)
    .reduce((s, t) => s + t.amount, 0);
}

function spentForObligation(ob: Obligation, txns: PTxn[]): number {
  // Match transactions to this obligation by category or merchant hint
  return txns
    .filter(t => {
      if (t.amount >= 0) return false; // only expenses (negative in Plaid)
      const amt = Math.abs(t.amount);
      if (amt < 0.01) return false;
      const name = (t.merchant_name || t.name || "").toLowerCase();
      const cat  = (t.category || "").toLowerCase();
      if (ob.merchant_hint && name.includes(ob.merchant_hint.toLowerCase())) return true;
      if (ob.category && cat.includes(ob.category.toLowerCase())) return true;
      return false;
    })
    .reduce((s, t) => s + Math.abs(t.amount), 0);
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
  const [step, setStep]     = useState<"pick" | "done">("pick");
  const [actions, setActions] = useState<{ type: string; from: string; amount: number; note: string }[]>([]);

  const totalOver = exceeded.reduce((s, e) => s + e.over, 0);

  const absorb = async () => {
    // Log as "one-time absorb"
    for (const e of exceeded) {
      await supabase.from("cover_actions").insert({
        user_id: userId,
        month,
        to_id: e.ob.id,
        amount: e.over,
        action_type: "absorb",
        note: "One-time overage absorbed",
      });
    }
    setStep("done");
  };

  const shiftFrom = async (fromId: string, fromName: string) => {
    for (const e of exceeded) {
      await supabase.from("cover_actions").insert({
        user_id: userId,
        month,
        from_id: fromId,
        to_id: e.ob.id,
        amount: e.over,
        action_type: "shift",
        note: `Shifted from ${fromName}`,
      });
    }
    setStep("done");
  };

  if (step === "done") return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card rounded-2xl p-8 mx-4 text-center max-w-sm w-full" onClick={e => e.stopPropagation()}>
        <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto mb-3" />
        <p className="font-semibold text-lg">Got it</p>
        <p className="text-muted-foreground text-sm mt-1">Logged how you covered {fmtUSD(totalOver)} this month</p>
        <button onClick={onClose} className="mt-6 w-full bg-primary text-primary-foreground py-2.5 rounded-xl font-medium text-sm">Done</button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl w-full max-w-md mx-0 sm:mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
          <div>
            <p className="font-semibold">How to cover {fmtUSD(totalOver)}?</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {exceeded.map(e => e.ob.name).join(", ")} {exceeded.length === 1 ? "is" : "are"} over
            </p>
          </div>
          <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-2 max-h-[70vh] overflow-y-auto">
          {/* Exceeded breakdown */}
          <div className="bg-destructive/10 rounded-xl p-3 mb-4">
            {exceeded.map(e => (
              <div key={e.ob.id} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{e.ob.name}</span>
                <span className="text-destructive font-medium">+{fmtUSD(e.over)}</span>
              </div>
            ))}
          </div>

          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider pb-1">Your options</p>

          {/* Option 1: shift from another envelope */}
          {envelopes.filter(e => !exceeded.find(x => x.ob.id === e.id)).map(env => (
            <button
              key={env.id}
              onClick={() => shiftFrom(env.id, env.name)}
              className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-border hover:bg-muted/50 transition-colors text-left"
            >
              <div className="h-8 w-8 rounded-full bg-violet-500/15 flex items-center justify-center shrink-0">
                <Shuffle className="h-3.5 w-3.5 text-violet-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Shift from {env.name}</p>
                <p className="text-xs text-muted-foreground">{fmtUSD(env.amount)} allocated this month</p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          ))}

          {/* Option 2: borrow from a goal */}
          {goals.slice(0, 2).map(g => (
            <button
              key={g.id}
              onClick={() => shiftFrom(g.id, g.name)}
              className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-border hover:bg-muted/50 transition-colors text-left"
            >
              <div className="h-8 w-8 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
                <Target className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Pause {g.name} this month</p>
                <p className="text-xs text-muted-foreground">Borrow {fmtUSD(totalOver)} from your {g.name} goal</p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          ))}

          {/* Option 3: absorb */}
          <button
            onClick={absorb}
            className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-border hover:bg-muted/50 transition-colors text-left"
          >
            <div className="h-8 w-8 rounded-full bg-orange-500/15 flex items-center justify-center shrink-0">
              <Wallet className="h-3.5 w-3.5 text-orange-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">It's a one-time thing — absorb it</p>
              <p className="text-xs text-muted-foreground">Log {fmtUSD(totalOver)} as an exception this month</p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add / Edit obligation modal ─────────────────────────────────────────────

interface EditModalProps {
  initial?: Partial<Obligation>;
  defaultType?: Obligation["type"];
  userId: string;
  onSave: () => void;
  onClose: () => void;
}

function EditModal({ initial, defaultType = "fixed", userId, onSave, onClose }: EditModalProps) {
  const [name, setName]       = useState(initial?.name ?? "");
  const [type, setType]       = useState<Obligation["type"]>(initial?.type ?? defaultType);
  const [amount, setAmount]   = useState(String(initial?.amount ?? ""));
  const [category, setCat]    = useState(initial?.category ?? "");
  const [merchant, setMerch]  = useState(initial?.merchant_hint ?? "");
  const [goalTarget, setGoalT] = useState(String(initial?.goal_target ?? ""));
  const [saving, setSaving]   = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !amount) return;
    setSaving(true);
    const payload = {
      user_id: userId,
      name: name.trim(),
      type,
      amount: parseFloat(amount),
      category: category || null,
      merchant_hint: merchant || null,
      goal_target: type === "goal" && goalTarget ? parseFloat(goalTarget) : null,
    };
    if (initial?.id) {
      await supabase.from("obligations").update(payload).eq("id", initial.id);
    } else {
      await supabase.from("obligations").insert(payload);
    }
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
          <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          {/* Type chips */}
          <div className="flex gap-1.5 flex-wrap">
            {BUCKETS.map(b => (
              <button
                key={b.type}
                onClick={() => setType(b.type)}
                className={cn("px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                  type === b.type ? `${b.bg} ${b.color} ${b.border}` : "bg-muted/40 text-muted-foreground border-transparent")}
              >
                {b.label.replace(" Commitments","").replace(" Envelopes","").replace(" Goals","")}
              </button>
            ))}
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder={type === "fixed" ? "Mortgage" : type === "flex" ? "Electricity" : type === "envelope" ? "Dining out" : "Emergency fund"}
              className="w-full bg-muted/40 border border-border rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-primary/50"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">
              {type === "fixed" ? "Monthly amount" : type === "flex" ? "Monthly max" : type === "goal" ? "Monthly contribution" : "Monthly limit"}
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00" type="text" inputMode="decimal"
                className="w-full bg-muted/40 border border-border rounded-xl pl-7 pr-3.5 py-2.5 text-sm outline-none focus:border-primary/50"
              />
            </div>
          </div>

          {type === "goal" && (
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Target amount (total)</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <input value={goalTarget} onChange={e => setGoalT(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="10,000" type="text" inputMode="decimal"
                  className="w-full bg-muted/40 border border-border rounded-xl pl-7 pr-3.5 py-2.5 text-sm outline-none focus:border-primary/50"
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">
              {type === "fixed" ? "Merchant keyword (for auto-match)" : "Category keyword"}
            </label>
            <input
              value={type === "fixed" ? merchant : category}
              onChange={e => type === "fixed" ? setMerch(e.target.value) : setCat(e.target.value)}
              placeholder={type === "fixed" ? "e.g. Chase, Rocket Mortgage" : "e.g. dining, utilities"}
              className="w-full bg-muted/40 border border-border rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-primary/50"
            />
            <p className="text-[11px] text-muted-foreground/60 mt-1">Used to auto-match transactions each month</p>
          </div>

          <div className="flex gap-2 pt-1">
            {initial?.id && (
              <button onClick={handleDelete} className="flex-1 py-2.5 rounded-xl border border-destructive/40 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors">
                Delete
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving || !name.trim() || !amount}
              className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 transition-opacity"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function ObligationsView({ txns, month, formatCat, catColor }: Props) {
  const [obligations, setObs]     = useState<Obligation[]>([]);
  const [loading, setLoading]     = useState(true);
  const [userId, setUserId]       = useState<string | null>(null);
  const [editing, setEditing]     = useState<Partial<Obligation> | null>(null);
  const [addType, setAddType]     = useState<Obligation["type"] | null>(null);
  const [coverModal, setCover]    = useState(false);

  // Load user + obligations
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const loadObs = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("obligations")
      .select("*")
      .eq("user_id", userId)
      .eq("active", true)
      .order("sort_order");
    setObs((data ?? []) as Obligation[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => { loadObs(); }, [loadObs]);

  // ── Computed numbers ──────────────────────────────────────────────────────

  const monthTxns = useMemo(() =>
    txns.filter(t => t.date?.startsWith(month)),
    [txns, month]
  );

  const income = useMemo(() => detectIncome(monthTxns), [monthTxns]);

  // Per-obligation: how much was spent this month
  const spentMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const ob of obligations) {
      m[ob.id] = spentForObligation(ob, monthTxns);
    }
    return m;
  }, [obligations, monthTxns]);

  // Bucket totals
  const bucketTotals = useMemo(() => {
    const t: Record<string, number> = { fixed: 0, flex: 0, envelope: 0, goal: 0 };
    for (const ob of obligations) t[ob.type] += ob.amount;
    return t;
  }, [obligations]);

  const totalAllocated = Object.values(bucketTotals).reduce((a, b) => a + b, 0);
  const freeAmount     = income - totalAllocated;

  // Which are exceeded
  const exceeded = useMemo(() =>
    obligations
      .filter(ob => ob.type !== "goal" && spentMap[ob.id] > ob.amount)
      .map(ob => ({ ob, over: spentMap[ob.id] - ob.amount })),
    [obligations, spentMap]
  );

  const byType = (type: Obligation["type"]) => obligations.filter(o => o.type === type);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex-1 flex items-center justify-center py-20">
      <div className="h-5 w-5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
    </div>
  );

  const isEmpty = obligations.length === 0;

  return (
    <div className="flex flex-col min-h-full">

      {/* ── Income + Allocation bar ────────────────────────────────────────── */}
      <div className="px-4 md:px-8 pt-5 pb-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Monthly Income</p>
            <p className="text-2xl font-bold tracking-tight">{fmtUSD(income)}</p>
            {income === 0 && (
              <p className="text-xs text-muted-foreground/60 mt-0.5 flex items-center gap-1">
                <Info className="h-3 w-3" /> Detected from your transactions
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground mb-0.5">
              {freeAmount >= 0 ? "Unallocated" : "Over by"}
            </p>
            <p className={cn("text-xl font-bold", freeAmount >= 0 ? "text-emerald-400" : "text-destructive")}>
              {fmtUSD(Math.abs(freeAmount))}
            </p>
          </div>
        </div>

        {/* Stacked allocation bar */}
        {income > 0 && (
          <div className="h-2.5 rounded-full bg-muted overflow-hidden flex gap-px">
            {BUCKETS.map(b => {
              const pct = Math.min((bucketTotals[b.type] / income) * 100, 100);
              if (pct < 0.5) return null;
              const colors: Record<string, string> = {
                fixed: "bg-blue-500", flex: "bg-amber-500",
                envelope: "bg-violet-500", goal: "bg-emerald-500"
              };
              return <div key={b.type} style={{ width: `${pct}%` }} className={cn("h-full", colors[b.type])} />;
            })}
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
          {BUCKETS.map(b => {
            const pct = income > 0 ? Math.round((bucketTotals[b.type] / income) * 100) : 0;
            return (
              <div key={b.type} className="flex items-center gap-1.5">
                <div className={cn("h-2 w-2 rounded-full", {
                  "bg-blue-500": b.type === "fixed",
                  "bg-amber-500": b.type === "flex",
                  "bg-violet-500": b.type === "envelope",
                  "bg-emerald-500": b.type === "goal",
                })} />
                <span className="text-[11px] text-muted-foreground">{b.label.split(" ")[0]} {fmtUSD(bucketTotals[b.type])} ({pct}%)</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Exceeded alert strip ─────────────────────────────────────────────── */}
      {exceeded.length > 0 && (
        <div className="mx-4 md:mx-8 mb-4 rounded-xl bg-destructive/10 border border-destructive/25 p-3.5 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {exceeded.length === 1
                ? `${exceeded[0].ob.name} is over by ${fmtUSD(exceeded[0].over)}`
                : `${exceeded.length} categories over by ${fmtUSD(exceeded.reduce((s, e) => s + e.over, 0))} total`}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {exceeded.map(e => e.ob.name).join(", ")}
            </p>
          </div>
          <button
            onClick={() => setCover(true)}
            className="shrink-0 px-3 py-1.5 bg-destructive text-destructive-foreground rounded-lg text-xs font-medium"
          >
            How to cover
          </button>
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────────── */}
      {isEmpty && (
        <div className="flex-1 flex flex-col items-center justify-center px-8 py-16 text-center">
          <div className="h-16 w-16 rounded-2xl bg-muted/60 flex items-center justify-center mb-4">
            <Wallet className="h-7 w-7 text-muted-foreground/60" />
          </div>
          <p className="font-semibold text-lg mb-1">No obligations set</p>
          <p className="text-muted-foreground text-sm max-w-xs">
            Add your fixed bills, flex utilities, spending limits, and savings goals to see where every dollar goes.
          </p>
          <div className="flex flex-wrap gap-2 justify-center mt-6">
            {BUCKETS.map(b => (
              <button
                key={b.type}
                onClick={() => setAddType(b.type)}
                className={cn("flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-colors", b.bg, b.color, b.border)}
              >
                <b.icon className="h-3.5 w-3.5" />
                {b.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Bucket sections ───────────────────────────────────────────────────── */}
      {!isEmpty && (
        <div className="px-4 md:px-8 pb-10 space-y-6">
          {BUCKETS.map(bucket => {
            const items = byType(bucket.type);
            const Icon  = bucket.icon;
            const isGoal = bucket.type === "goal";

            return (
              <div key={bucket.type}>
                {/* Section header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={cn("h-6 w-6 rounded-md flex items-center justify-center", bucket.bg)}>
                      <Icon className={cn("h-3.5 w-3.5", bucket.color)} />
                    </div>
                    <div>
                      <span className="text-sm font-semibold">{bucket.label}</span>
                      <span className="text-xs text-muted-foreground ml-2">{bucket.sublabel}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setAddType(bucket.type)}
                    className="h-7 w-7 flex items-center justify-center rounded-lg bg-muted/60 hover:bg-muted transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </div>

                {/* Items */}
                {items.length === 0 ? (
                  <button
                    onClick={() => setAddType(bucket.type)}
                    className="w-full py-4 rounded-xl border border-dashed border-border text-xs text-muted-foreground/60 hover:border-primary/30 hover:text-muted-foreground transition-colors"
                  >
                    + Add {bucket.label.toLowerCase()}
                  </button>
                ) : (
                  <div className="space-y-1.5">
                    {items.map(ob => {
                      const spent   = spentMap[ob.id] ?? 0;
                      const pct     = ob.amount > 0 ? Math.min((spent / ob.amount) * 100, 100) : 0;
                      const isOver  = !isGoal && spent > ob.amount;
                      const overAmt = spent - ob.amount;

                      // Goal: show progress toward goal_target
                      const goalPct = isGoal && ob.goal_target
                        ? Math.min((spent / ob.goal_target) * 100, 100)
                        : 0;

                      return (
                        <div key={ob.id}
                          className={cn(
                            "rounded-xl border p-3.5 transition-colors",
                            isOver ? "border-destructive/30 bg-destructive/5" : "border-border bg-card/50"
                          )}
                        >
                          <div className="flex items-start gap-3">
                            {/* Status dot */}
                            <div className={cn("h-2 w-2 rounded-full mt-1.5 shrink-0",
                              isOver ? "bg-destructive" :
                              pct >= 80 ? "bg-amber-500" :
                              "bg-emerald-500"
                            )} />

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium truncate">{ob.name}</p>
                                <div className="flex items-center gap-2 shrink-0">
                                  {isOver && (
                                    <span className="text-xs text-destructive font-medium">+{fmtUSD(overAmt)}</span>
                                  )}
                                  <span className={cn("text-sm font-semibold", isOver ? "text-destructive" : "")}>
                                    {fmtUSD(isGoal ? ob.amount : spent)}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {isGoal ? "/ mo" : `of ${fmtUSD(ob.amount)}`}
                                  </span>
                                  <button
                                    onClick={() => setEditing(ob)}
                                    className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-muted transition-colors ml-1"
                                  >
                                    <Pencil className="h-3 w-3 text-muted-foreground/60" />
                                  </button>
                                </div>
                              </div>

                              {/* Progress bar */}
                              {!isGoal && ob.amount > 0 && (
                                <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                                  <div
                                    className={cn("h-full rounded-full transition-all",
                                      isOver ? "bg-destructive" :
                                      pct >= 80 ? "bg-amber-500" :
                                      bucket.type === "fixed" ? "bg-blue-500" :
                                      bucket.type === "flex" ? "bg-amber-500/70" :
                                      "bg-violet-500"
                                    )}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              )}

                              {/* Goal: progress toward total target */}
                              {isGoal && ob.goal_target && (
                                <div className="mt-1.5">
                                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-emerald-500 transition-all"
                                      style={{ width: `${goalPct}%` }}
                                    />
                                  </div>
                                  <p className="text-[11px] text-muted-foreground mt-1">
                                    {fmtUSD(spent)} saved of {fmtUSD(ob.goal_target)} goal
                                    {ob.goal_deadline && (() => {
                                      const months = Math.max(1, Math.ceil(
                                        (new Date(ob.goal_deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30)
                                      ));
                                      return ` · ${months}mo to deadline`;
                                    })()}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modals ───────────────────────────────────────────────────────────── */}
      {(editing || addType) && userId && (
        <EditModal
          initial={editing ?? { type: addType ?? "fixed" }}
          defaultType={addType ?? editing?.type ?? "fixed"}
          userId={userId}
          onSave={() => { setEditing(null); setAddType(null); loadObs(); }}
          onClose={() => { setEditing(null); setAddType(null); }}
        />
      )}

      {coverModal && userId && (
        <CoverModal
          exceeded={exceeded}
          envelopes={byType("envelope")}
          goals={byType("goal")}
          month={month}
          userId={userId}
          onClose={() => setCover(false)}
        />
      )}
    </div>
  );
}
