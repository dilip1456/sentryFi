/**
 * BudgetPage — replaces the old auto-detected BudgetView at the "Budget" nav
 * tab. Four sections, each reflecting how the user actually thinks about
 * money:
 *
 * - Income: every way money comes in — detected recurring sources (6-month
 *   lookback) plus manual entries — shown both as an average and as an
 *   actual per-month history, since "average" alone hides a bad month.
 * - Expenses: everyday categorized spend that ISN'T a fixed obligation
 *   (obligations are tracked separately below so nothing double-counts).
 *   Any category without a savings plan gets a "how are we covering this?"
 *   prompt instead of just silently listing a number.
 * - Obligations: the existing ObligationsView (mortgage, loans, etc.) plus a
 *   summary of which obligations still have no funding plan.
 * - Planned Savings: everything the user is setting aside on purpose —
 *   recurring transfers, category-tallied funds (e.g. groceries), yearly/
 *   irregular expenses saved for monthly ahead of time, and obligation
 *   funding plans — each promotable from an auto-detected candidate.
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { fmtUSD } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { ObligationsView } from "@/components/finance/ObligationsView";
import {
  TrendingUp, TrendingDown, Plus, X, ChevronDown, PiggyBank, Target, Trash2, Wallet, CalendarClock, ShieldAlert,
} from "lucide-react";
import type { ManualIncomeItem, SavingsGoal } from "@/hooks/useUserSettings";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PTxn { id:string; account_id:string; amount:number|string; date:string; name:string|null; merchant_name:string|null; category?:string[]|null; pending?:boolean; [k:string]:any; }
interface PAccount { id:string; account_id:string; name:string|null; official_name:string|null; type:string|null; subtype:string|null; [k:string]:any; }
interface ObligationLite { id:string; name:string; type:string; amount:number; merchant_hint?:string; }

interface BudgetPageProps {
  txns: PTxn[];
  accounts: PAccount[];
  internalTxnIds: Set<string>;
  getEffectiveCategory: (t: PTxn) => string;
  formatCat: (s: string) => string;
  catColor: (s: string) => string;
  isIncomeCategory: (cat: string, amount: number) => boolean;
  manualIncome: ManualIncomeItem[];
  addManualIncome: (item: { id: string; label: string; amount: number }) => void;
  removeManualIncome: (id: string) => void;
  savingsGoals: SavingsGoal[];
  addSavingsGoal: (goal: { name: string; monthlyTarget: number; accountId?: string; kind?: SavingsGoal["kind"]; category?: string; obligationId?: string }) => void;
  removeSavingsGoal: (id: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SAVINGS_KW = ["transfer","savings","invest","brokerage","fidelity","vanguard","schwab","robinhood","betterment","wealthfront","ally","marcus","sofi","acorns","stash","contribution","deposit to"];
const matchKw = (m: string, kws: string[]) => { const s = m.toLowerCase(); return kws.some(k => s.includes(k)); };
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
const isTransferLikeCategory = (cat: string) => /transfer|credit card payment|loan payment/i.test(cat);

// A generic collapsible section shell matching the app's existing budget-card
// visual language (colored icon chip, total + item count on the right).
function SectionShell({ icon: Icon, label, sublabel, color, bg, total, totalLabel, defaultOpen, children }: {
  icon: React.ElementType; label: string; sublabel: string; color: string; bg: string;
  total?: number; totalLabel?: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="rounded-2xl border border-border/60 overflow-hidden bg-card/60">
      <button onClick={()=>setOpen(o=>!o)} className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-muted/20 transition-colors text-left">
        <div className={cn("h-8 w-8 rounded-xl flex items-center justify-center shrink-0", bg)}>
          <Icon className={cn("h-4 w-4", color)} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-foreground">{label}</p>
          <p className="text-[11px] text-muted-foreground">{sublabel}</p>
        </div>
        {total !== undefined && (
          <div className="text-right shrink-0">
            <p className="text-[15px] font-bold tabular text-foreground">{fmtUSD(total)}</p>
            {totalLabel && <p className="text-[10px] text-muted-foreground">{totalLabel}</p>}
          </div>
        )}
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground/60 shrink-0 transition-transform ml-1", open && "rotate-180")} />
      </button>
      {open && <div className="border-t border-border/40">{children}</div>}
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function BudgetPage({
  txns, accounts, internalTxnIds, getEffectiveCategory, formatCat, catColor, isIncomeCategory,
  manualIncome, addManualIncome, removeManualIncome,
  savingsGoals, addSavingsGoal, removeSavingsGoal,
}: BudgetPageProps) {
  const now = new Date();
  const thisMonth = monthKey(now);
  const thisYear = now.getFullYear();
  const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // ── Obligations — fetched here too (separately from ObligationsView's own
  // fetch) so Expenses can exclude obligation-covered spend from its total
  // instead of double-counting a mortgage payment as both an "obligation"
  // and a "housing expense". ──
  const [obligations, setObligations] = useState<ObligationLite[]>([]);
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: obs } = await supabase
        .from("obligations")
        .select("id,name,type,amount,merchant_hint")
        .eq("user_id", data.user.id)
        .eq("active", true);
      setObligations((obs ?? []) as ObligationLite[]);
    });
  }, []);

  const isObligationTxn = useCallback((t: PTxn) => {
    const nm = (t.merchant_name ?? t.name ?? "").toLowerCase();
    if (!nm) return false;
    return obligations.some(ob => (ob.merchant_hint ?? "").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean).some(hint => nm.includes(hint)));
  }, [obligations]);

  const isIncomeTxn = useCallback((t: PTxn) =>
    !internalTxnIds.has(t.id) && isIncomeCategory(getEffectiveCategory(t) ?? "Other", Number(t.amount)),
  [internalTxnIds, isIncomeCategory, getEffectiveCategory]);

  const isExpenseTxn = useCallback((t: PTxn) => {
    if (internalTxnIds.has(t.id)) return false;
    if (isObligationTxn(t)) return false; // obligations are tracked in their own section, not double-counted here
    const cat = getEffectiveCategory(t) ?? "Other";
    return !isIncomeCategory(cat, Number(t.amount)) && !isTransferLikeCategory(cat);
  }, [internalTxnIds, isObligationTxn, getEffectiveCategory, isIncomeCategory]);

  const monthTxns = useMemo(() => txns.filter(t => t.date.startsWith(thisMonth) && !t.pending), [txns, thisMonth]);
  const yearTxns  = useMemo(() => txns.filter(t => t.date.startsWith(String(thisYear)) && !t.pending), [txns, thisYear]);

  // ── Income: every way money comes in — recurring sources over a 6-month
  // lookback (long enough to catch quarterly/irregular income too), an actual
  // month-by-month history (not just an average — a bad month shouldn't hide
  // behind one), and manual entries. ──
  const detectedIncomeThisMonth = useMemo(() => monthTxns.filter(isIncomeTxn).reduce((s,t)=>s+Math.abs(Number(t.amount)),0), [monthTxns, isIncomeTxn]);
  const recurringIncome = useMemo(() => {
    const merchantTotals: Record<string, { dates: string[]; amounts: number[] }> = {};
    for (let i = 0; i <= 6; i++) {
      const d = new Date(); d.setMonth(d.getMonth()-i);
      const key = monthKey(d);
      for (const t of txns.filter(x => x.date.startsWith(key) && isIncomeTxn(x))) {
        const merchant = t.merchant_name ?? t.name ?? "Deposit";
        if (!merchantTotals[merchant]) merchantTotals[merchant] = { dates: [], amounts: [] };
        merchantTotals[merchant].dates.push(t.date);
        merchantTotals[merchant].amounts.push(Math.abs(Number(t.amount)));
      }
    }
    return Object.entries(merchantTotals)
      .filter(([,d]) => d.dates.length >= 2)
      .map(([merchant,d]) => ({ merchant, avgAmount: d.amounts.reduce((s,v)=>s+v,0)/d.amounts.length, count: d.dates.length }))
      .sort((a,b) => b.avgAmount-a.avgAmount);
  }, [txns, isIncomeTxn]);

  // Actual total earned per month, last 6 months — the "what did I actually
  // earn" view alongside the averages above.
  const monthlyIncomeHistory = useMemo(() => {
    const out: { key:string; label:string; total:number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth()-i);
      const key = monthKey(d);
      const total = txns.filter(t => t.date.startsWith(key) && isIncomeTxn(t)).reduce((s,t)=>s+Math.abs(Number(t.amount)),0);
      out.push({ key, label: d.toLocaleDateString("en-US",{month:"short"}), total });
    }
    return out;
  }, [txns, isIncomeTxn]);
  const avgMonthlyIncome = monthlyIncomeHistory.length
    ? monthlyIncomeHistory.reduce((s,m)=>s+m.total,0) / monthlyIncomeHistory.length
    : 0;
  const maxMonthlyIncome = Math.max(...monthlyIncomeHistory.map(m=>m.total), 1);

  const manualIncomeTotal = manualIncome.reduce((s,m)=>s+m.amount,0);
  const totalMonthlyIncome = detectedIncomeThisMonth + manualIncomeTotal;

  const [showAddIncome, setShowAddIncome] = useState(false);
  const [incomeLabel, setIncomeLabel] = useState("");
  const [incomeAmt, setIncomeAmt] = useState("");
  const submitIncome = () => {
    const amt = parseFloat(incomeAmt);
    if (!incomeLabel.trim() || isNaN(amt) || amt <= 0) return;
    addManualIncome({ id: `mi_${Date.now()}`, label: incomeLabel.trim(), amount: amt });
    setIncomeLabel(""); setIncomeAmt(""); setShowAddIncome(false);
  };

  // ── Expenses: Monthly / Yearly toggle over the same category breakdown,
  // excluding anything already covered by an Obligation. ──
  const [expensePeriod, setExpensePeriod] = useState<"month"|"year">("month");
  const expenseTxnsForPeriod = useMemo(
    () => (expensePeriod==="month" ? monthTxns : yearTxns).filter(isExpenseTxn),
    [expensePeriod, monthTxns, yearTxns, isExpenseTxn]
  );
  const totalExpenses = expenseTxnsForPeriod.reduce((s,t)=>s+Number(t.amount),0);
  const expenseByCat = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of expenseTxnsForPeriod) {
      const cat = getEffectiveCategory(t) ?? "Other";
      map[cat] = (map[cat] ?? 0) + Number(t.amount);
    }
    return Object.entries(map).map(([cat,spend]) => ({ cat, spend })).sort((a,b)=>b.spend-a.spend);
  }, [expenseTxnsForPeriod, getEffectiveCategory]);

  // Every category-tallied plan already tracked, for a quick "does cat X have
  // a plan?" lookup.
  const categoryGoalFor = useCallback((cat: string) => savingsGoals.find(g => g.kind === "category" && g.category === cat), [savingsGoals]);

  // ── Yearly / irregular expenses: same merchant seen only once or twice
  // over the last 13 months (not a monthly recurring cadence) with a
  // meaningful amount — the "insurance premium" / "annual renewal" pattern.
  const yearlyExpenseCandidates = useMemo(() => {
    const merchantTotals: Record<string, { dates: string[]; amounts: number[] }> = {};
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth()-13);
    const cutoffStr = cutoff.toISOString().slice(0,10);
    for (const t of txns) {
      if (t.date < cutoffStr) continue;
      if (internalTxnIds.has(t.id) || isObligationTxn(t)) continue;
      const cat = getEffectiveCategory(t) ?? "Other";
      if (isIncomeCategory(cat, Number(t.amount)) || isTransferLikeCategory(cat)) continue;
      const merchant = t.merchant_name ?? t.name ?? "Unknown";
      if (!merchantTotals[merchant]) merchantTotals[merchant] = { dates: [], amounts: [] };
      merchantTotals[merchant].dates.push(t.date);
      merchantTotals[merchant].amounts.push(Math.abs(Number(t.amount)));
    }
    return Object.entries(merchantTotals)
      .filter(([,d]) => d.dates.length >= 1 && d.dates.length <= 2 && Math.max(...d.amounts) >= 75)
      .map(([merchant,d]) => ({ merchant, amount: Math.max(...d.amounts), lastDate: [...d.dates].sort().slice(-1)[0] }))
      .filter(y => !savingsGoals.some(g => g.kind === "yearly" && g.name === y.merchant))
      .sort((a,b) => b.amount - a.amount)
      .slice(0, 8);
  }, [txns, internalTxnIds, isObligationTxn, getEffectiveCategory, isIncomeCategory, savingsGoals]);

  // ── Obligations without a funding plan yet ──
  const obligationsNeedingPlan = useMemo(
    () => obligations.filter(ob => !savingsGoals.some(g => g.kind === "obligation" && g.obligationId === ob.id)),
    [obligations, savingsGoals]
  );

  // ── Planned Savings: recurring transfers to savings/investment accounts (3mo lookback) ──
  const detectedTransfers = useMemo(() => {
    const merchantTotals: Record<string, { dates: string[]; amounts: number[]; accountId?: string }> = {};
    for (let i = 0; i < 3; i++) {
      const d = new Date(); d.setMonth(d.getMonth()-i);
      const key = monthKey(d);
      for (const t of txns.filter(x => x.date.startsWith(key) && !internalTxnIds.has(x.id) && Number(x.amount) > 0)) {
        const merchant = t.merchant_name ?? t.name ?? "Transfer";
        const acc = accounts.find(a => a.account_id === t.account_id);
        const savingsLike = matchKw(merchant, SAVINGS_KW) || acc?.subtype === "savings" || acc?.subtype === "money market";
        if (!savingsLike) continue;
        if (!merchantTotals[merchant]) merchantTotals[merchant] = { dates: [], amounts: [], accountId: t.account_id };
        merchantTotals[merchant].dates.push(t.date);
        merchantTotals[merchant].amounts.push(Number(t.amount));
      }
    }
    return Object.entries(merchantTotals)
      .map(([merchant,d]) => ({ merchant, avgAmount: d.amounts.reduce((s,v)=>s+v,0)/d.amounts.length, count: d.dates.length, accountId: d.accountId }))
      .filter(d => !savingsGoals.some(g => (g.kind ?? "transfer") === "transfer" && g.name === d.merchant))
      .sort((a,b) => b.avgAmount-a.avgAmount);
  }, [txns, accounts, internalTxnIds, savingsGoals]);

  const transferGoals = savingsGoals.filter(g => (g.kind ?? "transfer") === "transfer");
  const categoryGoals = savingsGoals.filter(g => g.kind === "category");
  const yearlyGoals = savingsGoals.filter(g => g.kind === "yearly");
  const obligationGoals = savingsGoals.filter(g => g.kind === "obligation");
  const totalPlannedSavings = savingsGoals.reduce((s,g)=>s+g.monthlyTarget,0);

  const freeToSpend = totalMonthlyIncome - totalExpenses - totalPlannedSavings;

  return (
    <div className="flex flex-col min-h-full bg-background">
      {/* Header + summary strip */}
      <div className="px-4 md:px-8 pt-5 pb-4 border-b border-border/40">
        <h1 className="font-display text-[19px] md:text-[21px] font-semibold text-foreground tracking-tight">Budget</h1>
        <p className="text-[12.5px] text-muted-foreground mt-0.5">{monthLabel}</p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <div className="rounded-xl bg-card/60 border border-border/50 p-3">
            <div className="text-[10.5px] text-muted-foreground uppercase tracking-wide">Income</div>
            <div className="text-[16px] font-bold tabular text-positive mt-0.5">{fmtUSD(totalMonthlyIncome)}</div>
          </div>
          <div className="rounded-xl bg-card/60 border border-border/50 p-3">
            <div className="text-[10.5px] text-muted-foreground uppercase tracking-wide">Expenses ({expensePeriod==="month"?"month":"year"})</div>
            <div className="text-[16px] font-bold tabular text-foreground mt-0.5">{fmtUSD(totalExpenses)}</div>
          </div>
          <div className="rounded-xl bg-card/60 border border-border/50 p-3">
            <div className="text-[10.5px] text-muted-foreground uppercase tracking-wide">Planned savings</div>
            <div className="text-[16px] font-bold tabular text-foreground mt-0.5">{fmtUSD(totalPlannedSavings)}</div>
          </div>
          <div className="rounded-xl bg-card/60 border border-border/50 p-3">
            <div className="text-[10.5px] text-muted-foreground uppercase tracking-wide">Free to spend</div>
            <div className={cn("text-[16px] font-bold tabular mt-0.5", freeToSpend<0?"text-negative":"text-foreground")}>{fmtUSD(freeToSpend)}</div>
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 md:px-8 py-4 space-y-3 max-w-3xl w-full mx-auto">

        {/* ═══ Income ═══ */}
        <SectionShell icon={TrendingUp} label="Income" sublabel="Every way money comes in — detected, averaged, and tracked month by month"
          color="text-emerald-400" bg="bg-emerald-500/12" total={totalMonthlyIncome} totalLabel="this month" defaultOpen>

          {/* Per-month actual history — an average alone hides a bad month */}
          <div className="px-4 pt-3 pb-1">
            <div className="flex items-end gap-1.5 h-16">
              {monthlyIncomeHistory.map(m => (
                <div key={m.key} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full rounded-t-sm bg-emerald-500/70" style={{height: `${Math.max((m.total/maxMonthlyIncome)*100, m.total>0?6:2)}%`}}/>
                  <span className="text-[9.5px] text-muted-foreground">{m.label}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Avg {fmtUSD(avgMonthlyIncome)}/mo over last {monthlyIncomeHistory.length} months
            </p>
          </div>

          <div className="divide-y divide-border/20 border-t border-border/20 mt-1">
            {recurringIncome.length === 0 && manualIncome.length === 0 ? (
              <p className="px-4 py-5 text-center text-[12px] text-muted-foreground/60">No recurring income detected yet — it'll show up here once a paycheck or deposit repeats for 2+ months.</p>
            ) : (
              <>
                {recurringIncome.map(r => (
                  <div key={r.merchant} className="flex items-center gap-3 px-4 py-3">
                    <div className="h-7 w-7 rounded-lg bg-emerald-500/12 text-emerald-400 grid place-items-center text-[11px] font-bold shrink-0">{r.merchant.charAt(0).toUpperCase()}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-foreground font-medium truncate">{r.merchant}</p>
                      <p className="text-[11px] text-muted-foreground">{r.count} of last 7 months · detected</p>
                    </div>
                    <p className="text-[13px] font-semibold tabular text-emerald-400 shrink-0">{fmtUSD(r.avgAmount)} avg</p>
                  </div>
                ))}
                {manualIncome.map(m => (
                  <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="h-7 w-7 rounded-lg bg-emerald-500/12 text-emerald-400 grid place-items-center text-[11px] font-bold shrink-0">{m.label.charAt(0).toUpperCase()}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-foreground font-medium truncate">{m.label}</p>
                      <p className="text-[11px] text-muted-foreground">Manual entry</p>
                    </div>
                    <p className="text-[13px] font-semibold tabular text-emerald-400 shrink-0">{fmtUSD(m.amount)}</p>
                    <button onClick={()=>removeManualIncome(m.id)} aria-label={`Remove ${m.label}`}
                      className="h-8 w-8 grid place-items-center text-muted-foreground/40 hover:text-negative transition-colors shrink-0"><Trash2 className="h-3.5 w-3.5"/></button>
                  </div>
                ))}
              </>
            )}
            <div className="px-4 py-3">
              {showAddIncome ? (
                <div className="flex items-center gap-2">
                  <input autoFocus value={incomeLabel} onChange={e=>setIncomeLabel(e.target.value)} placeholder="Source (e.g. Side gig)"
                    onKeyDown={e=>{ if (e.key==="Enter") submitIncome(); if (e.key==="Escape") setShowAddIncome(false); }}
                    className="flex-1 min-w-0 bg-muted/40 border border-border/60 rounded-lg px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"/>
                  <div className="relative w-28 shrink-0">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">$</span>
                    <input type="number" min={0} value={incomeAmt} onChange={e=>setIncomeAmt(e.target.value)} placeholder="Amount"
                      onKeyDown={e=>{ if (e.key==="Enter") submitIncome(); }}
                      className="w-full bg-muted/40 border border-border/60 rounded-lg pl-5 pr-2 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"/>
                  </div>
                  <button onClick={submitIncome} aria-label="Add income" className="h-9 w-9 grid place-items-center rounded-lg bg-gold shrink-0"><Plus className="h-4 w-4"/></button>
                  <button onClick={()=>setShowAddIncome(false)} aria-label="Cancel" className="h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground shrink-0"><X className="h-4 w-4"/></button>
                </div>
              ) : (
                <button onClick={()=>setShowAddIncome(true)} className="flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
                  <Plus className="h-3.5 w-3.5"/> Add income source
                </button>
              )}
            </div>
          </div>
        </SectionShell>

        {/* ═══ Expenses (Monthly / Yearly) ═══ */}
        <SectionShell icon={TrendingDown} label="Expenses" sublabel="Everyday categorized spend — obligations are tracked separately below"
          color="text-rose-400" bg="bg-rose-500/12" total={totalExpenses} totalLabel={expensePeriod==="month"?"this month":`${thisYear} to date`} defaultOpen>
          <div className="px-4 pt-3">
            <div className="inline-flex bg-muted/50 rounded-lg p-0.5 gap-0.5">
              {(["month","year"] as const).map(p => (
                <button key={p} onClick={()=>setExpensePeriod(p)}
                  className={cn("px-3 py-1 rounded-md text-[11.5px] font-semibold capitalize transition-all",
                    expensePeriod===p ? "bg-[hsl(var(--primary))] text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {p==="month" ? "Monthly" : "Yearly"}
                </button>
              ))}
            </div>
          </div>
          <div className="divide-y divide-border/20 mt-2">
            {expenseByCat.length === 0 ? (
              <p className="px-4 py-5 text-center text-[12px] text-muted-foreground/60">No expenses {expensePeriod==="month"?"this month":"this year"} yet.</p>
            ) : expenseByCat.slice(0, 12).map(c => {
              const col = catColor(c.cat);
              const pct = Math.max((c.spend/expenseByCat[0].spend)*100, 4);
              const plan = categoryGoalFor(c.cat);
              return (
                <div key={c.cat} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-medium text-foreground truncate">{formatCat(c.cat)}</span>
                    <span className="text-[12.5px] font-semibold tabular text-foreground shrink-0">{fmtUSD(c.spend)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-border/20 mt-1 overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{width:`${pct}%`, background: col}}/>
                  </div>
                  {plan ? (
                    <p className="text-[10.5px] text-muted-foreground mt-1">Covered by "{plan.name}" — {fmtUSD(plan.monthlyTarget)}/mo set aside</p>
                  ) : (
                    <button
                      onClick={()=>addSavingsGoal({ name: `${formatCat(c.cat)} fund`, monthlyTarget: Math.round(c.spend), kind: "category", category: c.cat })}
                      className="text-[10.5px] text-[hsl(var(--primary))] font-medium mt-1 hover:underline">
                      No plan yet — how are we covering this? Set aside {fmtUSD(c.spend)}/mo →
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </SectionShell>

        {/* ═══ Obligations — mounts the previously-unused ObligationsView ═══ */}
        <SectionShell icon={Wallet} label="Obligations" sublabel="Fixed things you have to pay — mortgage, loans & more"
          color="text-blue-400" bg="bg-blue-500/12" defaultOpen>
          {obligationsNeedingPlan.length > 0 && (
            <div className="px-4 py-3 border-b border-border/20 bg-warning/5 space-y-2">
              <p className="text-[11.5px] text-warning font-medium flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0"/> {obligationsNeedingPlan.length} obligation{obligationsNeedingPlan.length!==1?"s":""} with no savings plan yet
              </p>
              {obligationsNeedingPlan.map(ob => (
                <div key={ob.id} className="flex items-center justify-between gap-2 pl-5">
                  <span className="text-[12px] text-foreground truncate">{ob.name}</span>
                  <button
                    onClick={()=>addSavingsGoal({ name: `${ob.name} fund`, monthlyTarget: ob.amount, kind: "obligation", obligationId: ob.id })}
                    className="text-[11px] text-[hsl(var(--primary))] font-medium hover:underline shrink-0">
                    Plan for it →
                  </button>
                </div>
              ))}
            </div>
          )}
          <ObligationsView txns={txns} month={thisMonth} formatCat={formatCat} catColor={catColor} getEffectiveCategory={getEffectiveCategory} />
        </SectionShell>

        {/* ═══ Planned Savings ═══ */}
        <SectionShell icon={PiggyBank} label="Planned Savings" sublabel="Transfers, category funds, yearly expenses & obligation funding"
          color="text-violet-400" bg="bg-violet-500/12" total={totalPlannedSavings} totalLabel="monthly target" defaultOpen>
          <div className="divide-y divide-border/20">

            {/* Category-tallied funds — tracked against actual spend */}
            {categoryGoals.length > 0 && (
              <div className="px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-2">Category funds</p>
                {categoryGoals.map(g => {
                  const actual = monthTxns.filter(isExpenseTxn).filter(t => (getEffectiveCategory(t) ?? "Other") === g.category)
                    .reduce((s,t)=>s+Number(t.amount),0);
                  const pct = g.monthlyTarget > 0 ? Math.min((actual/g.monthlyTarget)*100, 100) : 0;
                  const over = actual > g.monthlyTarget;
                  return (
                    <div key={g.id} className="mb-2.5 last:mb-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12.5px] font-medium text-foreground truncate">{g.name}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={cn("text-[12px] tabular", over?"text-warning":"text-muted-foreground")}>{fmtUSD(actual)} / {fmtUSD(g.monthlyTarget)}</span>
                          <button onClick={()=>removeSavingsGoal(g.id)} aria-label={`Remove ${g.name}`} className="text-muted-foreground/40 hover:text-negative"><Trash2 className="h-3 w-3"/></button>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-border/20 mt-1 overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all", over?"bg-warning":"bg-violet-400")} style={{width:`${Math.max(pct,3)}%`}}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Yearly / irregular expenses */}
            {(yearlyGoals.length > 0 || yearlyExpenseCandidates.length > 0) && (
              <div className="px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-2 flex items-center gap-1"><CalendarClock className="h-3 w-3"/> Yearly expenses</p>
                {yearlyGoals.map(g => (
                  <div key={g.id} className="flex items-center gap-3 py-1.5">
                    <div className="h-6 w-6 rounded-lg bg-violet-500/12 text-violet-400 grid place-items-center shrink-0"><Target className="h-3 w-3"/></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] text-foreground font-medium truncate">{g.name}</p>
                    </div>
                    <p className="text-[12.5px] font-semibold tabular text-violet-400 shrink-0">{fmtUSD(g.monthlyTarget)}/mo</p>
                    <button onClick={()=>removeSavingsGoal(g.id)} aria-label={`Remove ${g.name}`} className="text-muted-foreground/40 hover:text-negative shrink-0"><Trash2 className="h-3 w-3"/></button>
                  </div>
                ))}
                {yearlyExpenseCandidates.map(y => (
                  <div key={y.merchant} className="flex items-center gap-3 py-1.5">
                    <div className="h-6 w-6 rounded-lg bg-muted/40 text-muted-foreground grid place-items-center text-[10px] font-bold shrink-0">{y.merchant.charAt(0).toUpperCase()}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] text-foreground font-medium truncate">{y.merchant}</p>
                      <p className="text-[10.5px] text-muted-foreground">Last seen {y.lastDate} · {fmtUSD(y.amount)} — how are we saving for it?</p>
                    </div>
                    <button
                      onClick={()=>addSavingsGoal({ name: y.merchant, monthlyTarget: Math.round(y.amount/12), kind: "yearly" })}
                      className="h-7 px-2 rounded-lg border border-[hsl(var(--primary)/0.4)] text-[10.5px] font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.08)] transition-colors shrink-0">
                      Save {fmtUSD(Math.round(y.amount/12))}/mo
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Obligation funding plans */}
            {obligationGoals.length > 0 && (
              <div className="px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-2">Obligation funding</p>
                {obligationGoals.map(g => (
                  <div key={g.id} className="flex items-center gap-3 py-1.5">
                    <div className="h-6 w-6 rounded-lg bg-blue-500/12 text-blue-400 grid place-items-center shrink-0"><Wallet className="h-3 w-3"/></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] text-foreground font-medium truncate">{g.name}</p>
                    </div>
                    <p className="text-[12.5px] font-semibold tabular text-blue-400 shrink-0">{fmtUSD(g.monthlyTarget)}/mo</p>
                    <button onClick={()=>removeSavingsGoal(g.id)} aria-label={`Remove ${g.name}`} className="text-muted-foreground/40 hover:text-negative shrink-0"><Trash2 className="h-3 w-3"/></button>
                  </div>
                ))}
              </div>
            )}

            {/* Recurring transfers to savings/investment */}
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-2">Recurring transfers</p>
              {transferGoals.length === 0 && detectedTransfers.length === 0 ? (
                <p className="text-[11.5px] text-muted-foreground/60">No recurring transfers to savings detected yet.</p>
              ) : (
                <>
                  {transferGoals.map(g => (
                    <div key={g.id} className="flex items-center gap-3 py-1.5">
                      <div className="h-6 w-6 rounded-lg bg-violet-500/12 text-violet-400 grid place-items-center shrink-0"><Target className="h-3 w-3"/></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] text-foreground font-medium truncate">{g.name}</p>
                      </div>
                      <p className="text-[12.5px] font-semibold tabular text-violet-400 shrink-0">{fmtUSD(g.monthlyTarget)}/mo</p>
                      <button onClick={()=>removeSavingsGoal(g.id)} aria-label={`Remove ${g.name}`} className="text-muted-foreground/40 hover:text-negative shrink-0"><Trash2 className="h-3 w-3"/></button>
                    </div>
                  ))}
                  {detectedTransfers.map(d => (
                    <div key={d.merchant} className="flex items-center gap-3 py-1.5">
                      <div className="h-6 w-6 rounded-lg bg-muted/40 text-muted-foreground grid place-items-center text-[10px] font-bold shrink-0">{d.merchant.charAt(0).toUpperCase()}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] text-foreground font-medium truncate">{d.merchant}</p>
                        <p className="text-[10.5px] text-muted-foreground">{d.count} of last 3 months · detected, not tracked</p>
                      </div>
                      <button
                        onClick={()=>addSavingsGoal({ name: d.merchant, monthlyTarget: Math.round(d.avgAmount), accountId: d.accountId, kind: "transfer" })}
                        className="h-7 px-2 rounded-lg border border-[hsl(var(--primary)/0.4)] text-[10.5px] font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.08)] transition-colors shrink-0">
                        Track
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </SectionShell>
      </div>
    </div>
  );
}
