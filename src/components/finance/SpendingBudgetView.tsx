import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { fmtUSD } from "@/lib/format";
import { useCountUp } from "@/hooks/useCountUp";
import {
  ChevronLeft, ChevronRight, Search, ArrowUpDown, RefreshCw, TrendingUp, TrendingDown,
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

// ─── Component ────────────────────────────────────────────────────────────────

export function SpendingBudgetView({txns,accounts,budgets,nameOverrides,setBudget,getEffectiveCategory,formatCat,catColor,onOpenDetail,internalTxnIds,initialSearch,isIncomeCategory}:SpendingBudgetViewProps) {

  const monthBuckets = useMemo(() => monthBucketsList(12), []);
  const lastIdx = monthBuckets.length - 1;
  const [monthOffset, setMonthOffset] = useState(0); // 0 = current month, -1 = last month, ... -11
  const selIdx = lastIdx + monthOffset;
  const isCurrentMonth = monthOffset === 0;
  const sel = monthBuckets[selIdx];
  const prevSel = monthBuckets[selIdx-1];

  const [catSel, setCatSel] = useState<string|null>(null);
  const [search, setSearch] = useState(initialSearch ?? "");
  const [sortDesc, setSortDesc] = useState(true);
  const [sortBy, setSortBy] = useState<"date"|"amount">("date");
  const [scrubDay, setScrubDay] = useState<number|null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (initialSearch !== undefined) setSearch(initialSearch); }, [initialSearch]);

  const isExpenseTxn = useCallback((t: PTxn) => {
    const cat = getEffectiveCategory(t) ?? "Other";
    return !isIncomeCategory(cat, Number(t.amount)) && !isTransferLikeCategory(cat);
  }, [getEffectiveCategory, isIncomeCategory]);

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

  const totalSpent = overallMonthly[selIdx] ?? 0;
  const prevTotalSpent = overallMonthly[selIdx-1] ?? 0;
  const momPct = prevTotalSpent > 0 ? Math.round(((totalSpent - prevTotalSpent) / prevTotalSpent) * 100) : null;

  const totalBudget = Object.values(budgets).reduce((s,v) => s+v, 0);
  const now = new Date();
  const daysInSelMonth = new Date(sel.year, sel.monthIdx+1, 0).getDate();
  const dayOfMonth = isCurrentMonth ? now.getDate() : daysInSelMonth;
  const daysLeft = isCurrentMonth ? Math.max(daysInSelMonth - dayOfMonth, 0) : 0;
  const pacePct = (dayOfMonth / daysInSelMonth) * 100;
  const spentPct = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
  const projectedSpend = dayOfMonth > 0 ? (totalSpent / dayOfMonth) * daysInSelMonth : totalSpent;
  const overProjected = totalBudget > 0 && projectedSpend > totalBudget;
  const safeToSpendToday = totalBudget > 0
    ? (daysLeft > 0 ? Math.max(totalBudget - totalSpent, 0) / daysLeft : Math.max(totalBudget - totalSpent, 0))
    : null;

  // ── Recurring charge detection — roughly-monthly merchants over the last 4 months ──
  const recurring = useMemo(() => {
    const byMerchant: Record<string, { dates:string[]; amounts:number[]; cat:string; label:string }> = {};
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth()-4);
    const cutoffStr = cutoff.toISOString().slice(0,10);
    for (const t of txns) {
      if (internalTxnIds.has(t.id)) continue;
      if (!isExpenseTxn(t)) continue;
      if (t.date < cutoffStr) continue;
      const label = (nameOverrides[t.id] ?? t.merchant_name ?? t.name ?? "").trim();
      const key = label.toLowerCase();
      if (!key) continue;
      if (!byMerchant[key]) byMerchant[key] = { dates:[], amounts:[], cat: getEffectiveCategory(t) ?? "Other", label };
      byMerchant[key].dates.push(t.date);
      byMerchant[key].amounts.push(Number(t.amount));
    }
    const out: { merchant:string; category:string; avgAmount:number; nextDate:string; intervalDays:number }[] = [];
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
      out.push({ merchant: d.label, category: d.cat, avgAmount, nextDate, intervalDays: Math.round(avgGap) });
    }
    return out.sort((a,b) => a.nextDate.localeCompare(b.nextDate));
  }, [txns, internalTxnIds, isExpenseTxn, nameOverrides, getEffectiveCategory]);

  const recurringMerchantKeys = useMemo(() => new Set(recurring.map(r => r.merchant.toLowerCase())), [recurring]);

  const todayStr = now.toISOString().slice(0,10);
  const in14 = new Date(now.getTime() + 14*86400000).toISOString().slice(0,10);
  const in30 = new Date(now.getTime() + 30*86400000).toISOString().slice(0,10);
  const committedNext14 = recurring.filter(r => r.nextDate >= todayStr && r.nextDate <= in14).reduce((s,r)=>s+r.avgAmount,0);
  const upcomingCharges = recurring.filter(r => r.nextDate >= todayStr && r.nextDate <= in30);

  // ── Burn runway: cumulative daily spend this month vs last ───────────────
  const burn = useMemo(() => {
    const cumThis: number[] = []; let run = 0;
    for (let d=1; d<=daysInSelMonth; d++) {
      const dayTotal = txns.reduce((s,t) => {
        if (internalTxnIds.has(t.id) || !isExpenseTxn(t)) return s;
        if (t.date < sel.start || t.date > sel.end || isoDay(t.date) !== d) return s;
        return s + Number(t.amount);
      }, 0);
      run += dayTotal; cumThis.push(run);
    }
    let cumPrev: number[] = [];
    if (prevSel) {
      const daysInPrev = new Date(prevSel.year, prevSel.monthIdx+1, 0).getDate();
      let run2 = 0;
      for (let d=1; d<=daysInSelMonth; d++) {
        if (d > daysInPrev) { cumPrev.push(run2); continue; }
        const dayTotal = txns.reduce((s,t) => {
          if (internalTxnIds.has(t.id) || !isExpenseTxn(t)) return s;
          if (t.date < prevSel.start || t.date > prevSel.end || isoDay(t.date) !== d) return s;
          return s + Number(t.amount);
        }, 0);
        run2 += dayTotal; cumPrev.push(run2);
      }
    }
    return { cumThis, cumPrev };
  }, [txns, internalTxnIds, isExpenseTxn, sel, prevSel, daysInSelMonth]);

  // ── Category rows for the selected month ──────────────────────────────────
  const catRows = useMemo(() => {
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
  }, [catMonthlyTotals, selIdx]);

  // ── Period transactions (respecting the category filter) ─────────────────
  const periodTxns = useMemo(() => txns.filter(t =>
    !internalTxnIds.has(t.id) && isExpenseTxn(t) && t.date >= sel.start && t.date <= sel.end &&
    (!catSel || (getEffectiveCategory(t) ?? "Other") === catSel)
  ), [txns, internalTxnIds, isExpenseTxn, sel, catSel, getEffectiveCategory]);

  const topMerchantByCat = useMemo(() => {
    const m: Record<string, Record<string,number>> = {};
    for (const t of txns) {
      if (internalTxnIds.has(t.id) || !isExpenseTxn(t)) continue;
      if (t.date < sel.start || t.date > sel.end) continue;
      const cat = getEffectiveCategory(t) ?? "Other";
      const merch = nameOverrides[t.id] ?? t.merchant_name ?? t.name ?? "Unknown";
      if (!m[cat]) m[cat] = {};
      m[cat][merch] = (m[cat][merch]??0) + Number(t.amount);
    }
    const out: Record<string,string> = {};
    for (const [cat, merchants] of Object.entries(m)) {
      out[cat] = Object.entries(merchants).sort(([,a],[,b])=>b-a)[0]?.[0] ?? "";
    }
    return out;
  }, [txns, internalTxnIds, isExpenseTxn, sel, nameOverrides, getEffectiveCategory]);

  const visibleTxns = useMemo(() => {
    let t = [...periodTxns];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      t = t.filter(x => (nameOverrides[x.id]??x.merchant_name??x.name??"").toLowerCase().includes(q) || (getEffectiveCategory(x)??"").toLowerCase().includes(q));
    }
    t.sort((a,b) => {
      const cmp = sortBy==="date" ? a.date.localeCompare(b.date) : Number(a.amount)-Number(b.amount);
      return sortDesc ? -cmp : cmp;
    });
    return t;
  }, [periodTxns, search, sortBy, sortDesc, nameOverrides, getEffectiveCategory]);

  const txnGroups = useMemo(() => {
    if (sortBy !== "date") return null;
    const g: Record<string, PTxn[]> = {};
    for (const t of visibleTxns) (g[t.date]=g[t.date]||[]).push(t);
    return Object.entries(g).sort(([a],[b]) => sortDesc ? b.localeCompare(a) : a.localeCompare(b));
  }, [visibleTxns, sortBy, sortDesc]);

  const leaderboard = useMemo(() => {
    const m: Record<string, { total:number; count:number; cat:string }> = {};
    for (const t of periodTxns) {
      const merch = nameOverrides[t.id] ?? t.merchant_name ?? t.name ?? "Unknown";
      if (!m[merch]) m[merch] = { total:0, count:0, cat: getEffectiveCategory(t) ?? "Other" };
      m[merch].total += Number(t.amount);
      m[merch].count += 1;
    }
    return Object.entries(m).map(([merchant,v]) => ({ merchant, ...v })).sort((a,b) => b.total-a.total).slice(0,10);
  }, [periodTxns, nameOverrides, getEffectiveCategory]);

  const animatedTotal = useCountUp(totalSpent, 900);

  // ── Burn runway SVG geometry ──────────────────────────────────────────────
  const CW = 100, CH = 100; // viewBox units — scaled by the SVG's own width/height
  const chartScale = Math.max(...burn.cumThis, ...burn.cumPrev, totalBudget || 0, 1);
  const pathFor = (arr:number[]) => arr.map((v,i) => {
    const x = (i/(daysInSelMonth-1||1))*CW;
    const y = CH - (v/chartScale)*CH;
    return `${i===0?"M":"L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const thisPath = pathFor(burn.cumThis);
  const prevPath = burn.cumPrev.length ? pathFor(burn.cumPrev) : "";
  const areaPath = burn.cumThis.length ? `${thisPath} L${CW},${CH} L0,${CH} Z` : "";
  const budgetY = totalBudget > 0 ? CH - (totalBudget/chartScale)*CH : null;

  const onChartMove = (e: React.MouseEvent) => {
    if (!chartRef.current) return;
    const rect = chartRef.current.getBoundingClientRect();
    const pct = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    const day = Math.round(pct * (daysInSelMonth-1));
    setScrubDay(day);
  };

  return (
    <div className="flex flex-col min-h-full bg-background spending-v2">

      {/* ═══ 1. Sticky header ═══════════════════════════════════════════════ */}
      <div className="sticky top-0 z-30 bg-card/95 backdrop-blur-sm border-b border-border/60 px-4 md:px-6 pt-4 pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h1 className="font-display text-[22px] md:text-[26px] font-semibold text-foreground tracking-tight">Spending</h1>
          <div className="flex items-center gap-2">
            <div className="flex bg-muted/50 rounded-xl p-0.5 gap-0.5">
              {(["day","week","month","year"] as const).map(d => (
                <button key={d} disabled
                  className={cn("px-3 py-1.5 rounded-lg text-[12px] font-semibold capitalize transition-all opacity-40 cursor-default",
                    d==="month" && "opacity-100 bg-[hsl(var(--primary))] text-primary-foreground")}>
                  {d}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 12-month scrubber */}
        <div className="flex items-end gap-1 h-10">
          {monthBuckets.map((b,i) => {
            const spend = overallMonthly[i] ?? 0;
            const maxM = Math.max(...overallMonthly, 1);
            const pct = Math.max((spend/maxM)*100, spend>0?8:3);
            const isSel = i === selIdx;
            return (
              <button key={b.key} onClick={() => setMonthOffset(i-lastIdx)}
                title={`${b.label}: ${fmtUSD(spend)}`}
                className="flex-1 min-w-0 flex flex-col items-center gap-1 group">
                <div className="w-full flex items-end" style={{height:26}}>
                  <div className={cn("w-full rounded-sm transition-all duration-300",
                    isSel ? "bg-[hsl(var(--primary))]" : i===lastIdx ? "bg-[hsl(var(--primary)/0.4)]" : "bg-[hsl(var(--primary)/0.15)] group-hover:bg-[hsl(var(--primary)/0.3)]")}
                    style={{height:`${pct}%`}}/>
                </div>
                <span className={cn("text-[9.5px] font-medium truncate w-full text-center", isSel?"text-[hsl(var(--primary))] font-bold":"text-muted-foreground/60")}>{b.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 space-y-5">

        {/* Active category filter chip */}
        {catSel && (
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1.5 h-7 pl-3 pr-2 rounded-full bg-[hsl(var(--primary)/0.12)] border border-[hsl(var(--primary)/0.3)] text-[12.5px] font-medium text-[hsl(var(--primary))]">
              {formatCat(catSel)}
              <button onClick={()=>setCatSel(null)} className="h-4 w-4 rounded-full bg-[hsl(var(--primary)/0.2)] grid place-items-center">×</button>
            </div>
          </div>
        )}

        {/* ═══ 2. Spend Pulse hero ═══════════════════════════════════════════ */}
        <div className="surface-card p-5 md:p-6">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 items-start">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                {isCurrentMonth ? "This month" : `${new Date(sel.year,sel.monthIdx,1).toLocaleDateString("en-US",{month:"long",year:"numeric"})}`}
              </div>
              <div className="flex items-baseline gap-3 mt-1 flex-wrap">
                <div className="font-display text-[42px] md:text-[52px] font-semibold text-foreground tracking-tight leading-none tabular">
                  {fmtUSD(animatedTotal)}
                </div>
                {momPct !== null && (
                  <div className={cn("inline-flex items-center gap-1 h-6 px-2 rounded-full text-[12px] font-semibold",
                    momPct>0 ? "bg-negative/10 text-negative" : "bg-positive/10 text-positive")}>
                    {momPct>0 ? <TrendingUp className="h-3 w-3"/> : <TrendingDown className="h-3 w-3"/>}
                    {momPct>0?"+":""}{momPct}% vs last mo
                  </div>
                )}
              </div>

              {totalBudget > 0 && (
                <div className="mt-4 max-w-md">
                  <div className="flex items-baseline justify-between text-[12px] mb-1.5">
                    <span className="text-muted-foreground">Budget</span>
                    <span className="font-semibold tabular text-foreground">{fmtUSD(totalSpent)} <span className="text-muted-foreground font-normal">of {fmtUSD(totalBudget)}</span></span>
                  </div>
                  <div className="h-2.5 rounded-full bg-muted overflow-hidden relative">
                    <div className="h-full rounded-full transition-all duration-700" style={{width:`${Math.min(spentPct,100)}%`,background:spentPct>100?"hsl(var(--negative))":spentPct>80?"hsl(var(--warning))":"hsl(var(--primary))"}}/>
                    {isCurrentMonth && (
                      <div className="absolute top-0 bottom-0 w-0.5 bg-foreground/50" style={{left:`${Math.min(pacePct,100)}%`}} title="Where you should be by today"/>
                    )}
                  </div>
                  <div className="flex justify-between text-[11px] mt-1">
                    <span className="text-muted-foreground">{Math.round(spentPct)}% used, {Math.round(pacePct)}% through the month</span>
                    <span className={cn("font-medium", totalSpent>totalBudget?"text-negative":"text-positive")}>
                      {totalSpent>totalBudget ? `${fc2(totalSpent-totalBudget)} over` : `${fc2(totalBudget-totalSpent)} left`}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Pace ring */}
            {isCurrentMonth && totalBudget > 0 && (
              <div className="flex flex-col items-center gap-1 shrink-0 mx-auto lg:mx-0">
                <svg width="104" height="104" viewBox="0 0 104 104" className="-rotate-90">
                  <circle cx="52" cy="52" r="44" fill="none" stroke="hsl(var(--muted))" strokeWidth="10"/>
                  <circle cx="52" cy="52" r="44" fill="none"
                    stroke={overProjected?"hsl(var(--negative))":"hsl(var(--primary))"} strokeWidth="10" strokeLinecap="round"
                    strokeDasharray={`${2*Math.PI*44}`}
                    strokeDashoffset={`${2*Math.PI*44*(1-Math.min(projectedSpend/totalBudget,1.4)/1.4)}`}
                    style={{transition:"stroke-dashoffset 900ms ease-out"}}/>
                </svg>
                <div className="-mt-[72px] flex flex-col items-center pointer-events-none">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Projected</div>
                  <div className="text-[16px] font-bold text-foreground tabular">{fc2(projectedSpend)}</div>
                </div>
                <div className="mt-[26px] text-[11px] text-muted-foreground text-center max-w-[104px]">
                  End-of-month pace {overProjected ? <span className="text-negative font-medium">over budget</span> : <span className="text-positive font-medium">on track</span>}
                </div>
              </div>
            )}
          </div>

          {/* Stat tiles */}
          {isCurrentMonth && (
            <div className="grid grid-cols-2 gap-3 mt-5 pt-5 border-t border-border/15">
              <div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Safe to spend today</div>
                <div className="text-[20px] font-display font-semibold text-foreground tabular mt-0.5">
                  {safeToSpendToday !== null ? fmtUSD(safeToSpendToday) : "—"}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{safeToSpendToday!==null ? `${daysLeft} days left this month` : "Set a budget to see this"}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Committed next 14 days</div>
                <div className="text-[20px] font-display font-semibold text-foreground tabular mt-0.5">{fmtUSD(committedNext14)}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{recurring.filter(r=>r.nextDate>=todayStr&&r.nextDate<=in14).length} recurring charge{recurring.filter(r=>r.nextDate>=todayStr&&r.nextDate<=in14).length!==1?"s":""}</div>
              </div>
            </div>
          )}
        </div>

        {/* ═══ 3. Burn runway ═══════════════════════════════════════════════ */}
        <div className="surface-card p-5 md:p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[13px] font-semibold text-foreground">Burn runway</div>
              <div className="text-[11.5px] text-muted-foreground">Cumulative spend this month vs last</div>
            </div>
            {scrubDay !== null && burn.cumThis[scrubDay] !== undefined && (
              <div className="text-right">
                <div className="text-[13px] font-bold text-foreground tabular">{fmtUSD(burn.cumThis[scrubDay])}</div>
                <div className="text-[10.5px] text-muted-foreground">day {scrubDay+1} · last mo {fmtUSD(burn.cumPrev[scrubDay] ?? 0)}</div>
              </div>
            )}
          </div>
          <div ref={chartRef} onMouseMove={onChartMove} onMouseLeave={()=>setScrubDay(null)} className="relative h-44 w-full cursor-crosshair">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
              <defs>
                <linearGradient id="burnFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.35"/>
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0"/>
                </linearGradient>
              </defs>
              {budgetY !== null && (
                <line x1="0" y1={budgetY} x2="100" y2={budgetY} stroke="hsl(var(--negative))" strokeWidth="0.6" strokeDasharray="2,2" vectorEffect="non-scaling-stroke"/>
              )}
              {prevPath && (
                <path d={prevPath} fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" strokeDasharray="2,2" vectorEffect="non-scaling-stroke"/>
              )}
              {areaPath && <path d={areaPath} fill="url(#burnFill)" stroke="none"/>}
              {thisPath && (
                <path d={thisPath} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.4" vectorEffect="non-scaling-stroke"
                  strokeDasharray="500" strokeDashoffset="0" className="burn-draw-in"/>
              )}
              {scrubDay !== null && (
                <line x1={(scrubDay/(daysInSelMonth-1||1))*100} y1="0" x2={(scrubDay/(daysInSelMonth-1||1))*100} y2="100"
                  stroke="hsl(var(--foreground))" strokeWidth="0.4" strokeOpacity="0.3" vectorEffect="non-scaling-stroke"/>
              )}
            </svg>
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10.5px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded-full bg-[hsl(var(--primary))] inline-block"/>This month</span>
            <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded-full bg-muted-foreground/50 inline-block"/>Last month</span>
            {budgetY !== null && <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded-full bg-negative/60 inline-block"/>Budget ceiling</span>}
          </div>

          {/* Upcoming charges rail */}
          {upcomingCharges.length > 0 && (
            <div className="mt-5 pt-4 border-t border-border/15">
              <div className="text-[11.5px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Upcoming charges</div>
              <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
                {upcomingCharges.map(r => {
                  const days = Math.round((new Date(r.nextDate+"T00:00:00").getTime()-now.getTime())/86400000);
                  return (
                    <div key={r.merchant} className="shrink-0 w-[150px] rounded-xl border border-border/40 bg-muted/20 p-3">
                      <div className="text-[12.5px] font-semibold text-foreground truncate">{r.merchant}</div>
                      <div className="text-[14px] font-bold text-foreground tabular mt-1">{fmtUSD(r.avgAmount)}</div>
                      <div className="text-[11px] text-[hsl(var(--primary))] font-medium mt-0.5">in {Math.max(days,0)} day{days!==1?"s":""}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ═══ 4. Category bento ═════════════════════════════════════════════ */}
        {catRows.length > 0 && (
          <div>
            <div className="text-[13px] font-semibold text-foreground mb-2.5">Categories</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {catRows.map((c,i) => {
                const col = catColor(c.cat);
                const b = budgets[c.cat];
                const over = !!b && c.spend > b;
                const scale = Math.max(b??0, c.spend, 1);
                const trackPct = b ? Math.min((b/scale)*100,100) : 100;
                const actualPct = Math.min((c.spend/scale)*100,100);
                const spark = c.sparkline;
                const sparkMax = Math.max(...spark, 1);
                const sparkPts = spark.map((v,j) => `${(j/(Math.max(spark.length-1,1)))*100},${100-(v/sparkMax)*90}`).join(" ");
                const active = catSel === c.cat;
                return (
                  <button key={c.cat} onClick={()=>setCatSel(active?null:c.cat)}
                    style={{animationDelay:`${i*35}ms`}}
                    className={cn("bento-rise text-left rounded-2xl border p-3.5 transition-colors",
                      active ? "border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.06)]" : "border-border/40 bg-card hover:border-border-strong")}>
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-2 w-2 rounded-full shrink-0" style={{background:col}}/>
                      <span className="text-[12.5px] font-medium text-foreground truncate flex-1 min-w-0">{formatCat(c.cat)}</span>
                      {c.mom !== null && (
                        <span className={cn("text-[10px] font-semibold shrink-0", c.mom>0?"text-negative":"text-positive")}>{c.mom>0?"+":""}{c.mom}%</span>
                      )}
                    </div>
                    <div className="font-display text-[19px] font-semibold text-foreground tabular mt-1.5">{fmtUSD(c.spend)}</div>
                    {b ? (
                      <>
                        <div className="h-1.5 rounded-full bg-border/20 relative mt-2">
                          <div className="absolute inset-y-0 left-0 rounded-full" style={{width:`${trackPct}%`,background:`${col}30`}}/>
                          <div className="absolute inset-y-0 left-0 rounded-full transition-all" style={{width:`${actualPct}%`,background:over?"hsl(var(--negative))":col}}/>
                        </div>
                        <div className={cn("text-[10.5px] mt-1 font-medium", over?"text-negative":"text-positive")}>
                          {over ? `${fc2(c.spend-b)} over` : `${fc2(b-c.spend)} left`}
                        </div>
                      </>
                    ) : (
                      <div className="text-[10.5px] text-muted-foreground/60 mt-2">No budget set</div>
                    )}
                    {topMerchantByCat[c.cat] && (
                      <div className="text-[10.5px] text-muted-foreground truncate mt-1.5">{topMerchantByCat[c.cat]}</div>
                    )}
                    {spark.length > 1 && (
                      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-5 mt-1.5 opacity-70">
                        <polyline points={sparkPts} fill="none" stroke={col} strokeWidth="4" vectorEffect="non-scaling-stroke"/>
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══ 5. Bottom split: transaction feed + merchant leaderboard ══════ */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 items-start">

          {/* Transaction feed */}
          <div className="surface-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border/20 sticky top-[92px] z-10 bg-card/95 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <div className="flex-1 relative min-w-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none"/>
                  <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search transactions..."
                    className="w-full h-9 pl-8 pr-3 rounded-xl bg-muted/40 border border-border/60 text-[13px] text-foreground outline-none focus:border-[hsl(var(--primary)/0.5)]"/>
                </div>
                <button onClick={()=>setSortBy(s=>s==="date"?"amount":"date")}
                  className="h-9 px-3 rounded-xl border border-border/60 bg-muted/40 text-[12px] font-medium text-foreground flex items-center gap-1 shrink-0">
                  {sortBy==="date"?"Latest":"Largest"}
                </button>
                <button onClick={()=>setSortDesc(d=>!d)} title={sortDesc?"Descending":"Ascending"}
                  className="h-9 w-9 rounded-xl border border-border/60 bg-muted/40 grid place-items-center text-muted-foreground shrink-0">
                  <ArrowUpDown className={cn("h-3.5 w-3.5 transition-transform", !sortDesc && "rotate-180")}/>
                </button>
              </div>
            </div>
            <div>
              {visibleTxns.length === 0 ? (
                <div className="py-14 text-center text-[13px] text-muted-foreground">No transactions match.</div>
              ) : txnGroups ? txnGroups.map(([date, dTxns]) => {
                const dayTotal = dTxns.reduce((s,t)=>s+Number(t.amount),0);
                return (
                  <div key={date}>
                    <div className="px-4 py-1.5 bg-muted/20 border-b border-border/15 flex items-center justify-between sticky top-[152px] z-[5]">
                      <span className="text-[11.5px] font-semibold text-foreground">{rDate(date)}</span>
                      <span className="text-[11px] text-muted-foreground tabular">{fmtUSD(dayTotal)}</span>
                    </div>
                    {dTxns.map(t => <TxnRow key={t.id} t={t} getEffectiveCategory={getEffectiveCategory} catColor={catColor} formatCat={formatCat}
                      nameOverrides={nameOverrides} accounts={accounts} onOpenDetail={onOpenDetail} recurringKeys={recurringMerchantKeys}/>)}
                  </div>
                );
              }) : visibleTxns.map(t => <TxnRow key={t.id} t={t} getEffectiveCategory={getEffectiveCategory} catColor={catColor} formatCat={formatCat}
                nameOverrides={nameOverrides} accounts={accounts} onOpenDetail={onOpenDetail} recurringKeys={recurringMerchantKeys} showDate/>)}
            </div>
          </div>

          {/* Merchant leaderboard */}
          <div className="surface-card p-4">
            <div className="text-[13px] font-semibold text-foreground mb-3">Top merchants</div>
            {leaderboard.length === 0 ? (
              <div className="text-[12.5px] text-muted-foreground py-4 text-center">No transactions this period.</div>
            ) : (
              <div className="space-y-2.5">
                {leaderboard.map((m,i) => {
                  const maxT = leaderboard[0].total;
                  const pct = Math.max((m.total/maxT)*100, 4);
                  return (
                    <div key={m.merchant} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center">
                      <div className="min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[12.5px] font-medium text-foreground truncate">{m.merchant}</span>
                          <span className="text-[12px] font-bold text-foreground tabular shrink-0">{fmtUSD(m.total)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-border/20 mt-1 overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{width:`${pct}%`,background:catColor(m.cat)}}/>
                        </div>
                      </div>
                      <span className="text-[10.5px] text-muted-foreground shrink-0 tabular">{m.count}×</span>
                    </div>
                  );
                })}
              </div>
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
    </div>
  );
}

// ── Transaction row ───────────────────────────────────────────────────────────
const TxnRow = ({ t, showDate=false, getEffectiveCategory, catColor, formatCat, nameOverrides, accounts, onOpenDetail, recurringKeys }: {
  t: PTxn; showDate?: boolean;
  getEffectiveCategory: (t:PTxn)=>string; catColor:(s:string)=>string; formatCat:(s:string)=>string;
  nameOverrides: Record<string,string>; accounts: PAccount[]; onOpenDetail:(t:PTxn)=>void; recurringKeys: Set<string>;
}) => {
  const cat = getEffectiveCategory(t) ?? "Other";
  const col = catColor(cat);
  const nm = nameOverrides[t.id] ?? t.merchant_name ?? t.name ?? "";
  const acc = accounts.find(a => a.account_id === t.account_id);
  const isRecurring = recurringKeys.has(nm.trim().toLowerCase());
  return (
    <div onClick={() => onOpenDetail(t)} className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 items-center px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors border-b border-border/10 last:border-0">
      <div className="h-9 w-9 rounded-full shrink-0 grid place-items-center text-[13px] font-bold text-white" style={{background:col}}>
        {(nm[0]??"?").toUpperCase()}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[13px] font-medium text-foreground truncate">{nm}</span>
          {isRecurring && <RefreshCw className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />}
          {t.pending && <span className="text-[9px] font-bold text-warning bg-warning/10 px-1.5 py-0.5 rounded-full shrink-0">PENDING</span>}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
          <span className="text-[11px] font-semibold shrink-0" style={{color:col}}>{formatCat(cat)}</span>
          {acc?.name && <><span className="text-muted-foreground/30 shrink-0">·</span><span className="text-[11px] text-muted-foreground truncate">{acc.name}</span></>}
          {showDate && <><span className="text-muted-foreground/30 shrink-0">·</span><span className="text-[11px] text-muted-foreground/50 shrink-0">{rDate(t.date)}</span></>}
        </div>
      </div>
      <span className="text-[13.5px] font-bold text-foreground tabular shrink-0">{fmtUSD(Number(t.amount))}</span>
    </div>
  );
};
