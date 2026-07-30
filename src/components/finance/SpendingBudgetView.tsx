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
  const [hoveredDot, setHoveredDot] = useState<string|null>(null);
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
  const PROJECTION_DAYS = 15;
  const safeToSpendToday = totalBudget > 0
    ? (daysLeft > 0 ? Math.max(totalBudget - totalSpent, 0) / daysLeft : Math.max(totalBudget - totalSpent, 0))
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
  const in14 = new Date(now.getTime() + 14*86400000).toISOString().slice(0,10);
  const in30 = new Date(now.getTime() + 30*86400000).toISOString().slice(0,10);
  const committedNext14 = recurring.filter(r => r.nextDate >= todayStr && r.nextDate <= in14).reduce((s,r)=>s+r.avgAmount,0);

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

  // ── Burn runway card 1: rolling last-30-days cumulative spend (real pace
  // tool, not tied to the month scrubber above) — one point per day, with a
  // marker on every day that actually had a transaction. ────────────────────
  const rolling30 = useMemo(() => {
    const days: { date:string; cum:number; txns:{merchant:string;amount:number}[] }[] = [];
    let cum = 0;
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate()-i);
      const iso = d.toISOString().slice(0,10);
      const dayTxns = txns.filter(t => !internalTxnIds.has(t.id) && isExpenseTxn(t) && t.date === iso);
      cum += dayTxns.reduce((s,t)=>s+Number(t.amount),0);
      days.push({ date: iso, cum, txns: dayTxns.map(t => ({ merchant: nameOverrides[t.id] ?? t.merchant_name ?? t.name ?? "Unknown", amount: Number(t.amount) })) });
    }
    return days;
  }, [txns, internalTxnIds, isExpenseTxn, nameOverrides]);

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
  // x is addressed by day-offset (0-based from the selected month's start) so
  // Card 1 geometry — 30 fixed points, day index 0..29.
  const CW = 100, CH = 100; // viewBox units — scaled by the SVG's own width/height
  const past30Scale = Math.max(...rolling30.map(d=>d.cum), totalBudget || 0, 1);
  const xForPast = (i:number) => (i/29)*CW;
  const yForPast = (v:number) => CH - (v/past30Scale)*CH;
  const past30Path = rolling30.map((d,i) => `${i===0?"M":"L"}${xForPast(i).toFixed(2)},${yForPast(d.cum).toFixed(2)}`).join(" ");
  const past30Area = rolling30.length ? `${past30Path} L${CW},${CH} L0,${CH} Z` : "";
  const past30BudgetY = totalBudget > 0 ? yForPast(totalBudget) : null;

  const onChartMove = (e: React.MouseEvent) => {
    if (!chartRef.current) return;
    const rect = chartRef.current.getBoundingClientRect();
    const pct = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    setScrubDay(Math.round(pct * 29));
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

        {/* ═══ 3. Burn runway — swipeable: last 30 days ⇄ next 15 days ═════════ */}
        <div className="surface-card p-5 md:p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[13px] font-semibold text-foreground">Burn runway</div>
              <div className="text-[11.5px] text-muted-foreground">
                {runwayIdx===0 ? "Last 30 days, cumulative spend" : "Next 15 days, anticipated charges"}
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

          <div className="relative"
            onPointerDown={runwayOnDown} onPointerMove={runwayOnMove} onPointerUp={runwayEndDrag} onPointerCancel={runwayEndDrag}>
            <div className="flex transition-transform duration-300 ease-out"
              style={{transform:`translateX(calc(${-runwayIdx*100}% + ${runwayDragging.current?runwayDragX:0}px))`}}>

              {/* ── Card 1: last 30 days ── */}
              <div className="w-full shrink-0">
                <div ref={chartRef} onMouseMove={onChartMove} onMouseLeave={()=>setScrubDay(null)} className="relative h-44 w-full cursor-crosshair">
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
                    return (
                      <div key={key} className="absolute -translate-x-1/2 -translate-y-1/2 z-10" style={{left:`${left}%`,top:`${top}%`}}
                        onMouseEnter={()=>setHoveredDot(key)} onMouseLeave={()=>setHoveredDot(h=>h===key?null:h)}>
                        <div className={cn("rounded-full bg-[hsl(var(--primary))] ring-2 ring-card transition-all cursor-pointer",
                          hovered ? "h-2.5 w-2.5" : "h-1.5 w-1.5")}/>
                        {hovered && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-max max-w-[180px] rounded-lg bg-popover border border-border shadow-xl px-2.5 py-1.5 pointer-events-none">
                            <div className="text-[10px] text-muted-foreground">{new Date(d.date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                            {d.txns.map((t,ti) => (
                              <div key={ti} className="text-[11.5px] font-medium text-foreground flex items-center justify-between gap-2">
                                <span className="truncate">{t.merchant}</span>
                                <span className="tabular shrink-0">{fmtUSD(t.amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-4 mt-2 text-[10.5px] text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded-full bg-[hsl(var(--primary))] inline-block"/>Cumulative spend</span>
                  {past30BudgetY !== null && <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded-full bg-negative/60 inline-block"/>Budget ceiling</span>}
                  <span className="ml-auto">Swipe or tap dot to see next 15 days →</span>
                </div>
              </div>

              {/* ── Card 2: next 15 days ── */}
              <div className="w-full shrink-0">
                <div className="relative h-44 w-full">
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
                    return (
                      <div key={key} className="absolute -translate-x-1/2 -translate-y-1/2 z-10" style={{left:`${left}%`,top:`${top}%`}}
                        onMouseEnter={()=>setHoveredDot(key)} onMouseLeave={()=>setHoveredDot(h=>h===key?null:h)}>
                        <div className={cn("rounded-full ring-2 ring-card transition-all cursor-pointer",
                          f.insufficient ? "bg-[hsl(var(--negative))]" : "bg-[hsl(var(--primary))]",
                          hovered ? "h-2.5 w-2.5" : "h-1.5 w-1.5")}/>
                        {hovered && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-max max-w-[190px] rounded-lg bg-popover border border-border shadow-xl px-2.5 py-1.5 pointer-events-none">
                            <div className="text-[10px] text-muted-foreground">{new Date(f.nextDate+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}{f.insufficient?" · insufficient funds":""}</div>
                            <div className={cn("text-[11.5px] font-medium flex items-center justify-between gap-2", f.insufficient?"text-negative":"text-foreground")}>
                              <span className="truncate">{f.merchant}</span>
                              <span className="tabular shrink-0">{fmtUSD(f.avgAmount)}</span>
                            </div>
                            {f.balanceAfter !== null && (
                              <div className={cn("text-[10.5px] tabular", f.insufficient?"text-negative":"text-muted-foreground")}>{fmtUSD(f.balanceAfter)} left in {f.accountName}</div>
                            )}
                          </div>
                        )}
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

        {/* ═══ 4+5. Three-column split: categories (left, compact + scrollable) ·
            transactions (center) · top merchants (right) ══════════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_240px] gap-4 items-start">

          {/* Categories — small rows, vertically scrollable */}
          {catRows.length > 0 && (
            <div className="surface-card overflow-hidden lg:sticky lg:top-[92px]">
              <div className="px-3.5 py-2.5 border-b border-border/20 text-[12px] font-semibold text-foreground">Categories</div>
              <div className="max-h-[220px] lg:max-h-[calc(100vh-180px)] overflow-y-auto scrollbar-none divide-y divide-border/10">
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

          {/* Transaction feed — center */}
          <div className="surface-card overflow-hidden min-w-0">
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

          {/* Top spending (merchant leaderboard) — right */}
          <div className="surface-card p-4 lg:sticky lg:top-[92px]">
            <div className="text-[13px] font-semibold text-foreground mb-3">Top spending</div>
            {leaderboard.length === 0 ? (
              <div className="text-[12.5px] text-muted-foreground py-4 text-center">No transactions this period.</div>
            ) : (
              <div className="space-y-2.5 max-h-[220px] lg:max-h-[calc(100vh-220px)] overflow-y-auto scrollbar-none pr-1">
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
