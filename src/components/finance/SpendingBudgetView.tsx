import { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { fmtUSD } from "@/lib/format";
import {
  ChevronLeft, ChevronRight, SlidersHorizontal, X,
  ChevronDown, Plus, Pencil, TrendingUp, Search
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, Tooltip, XAxis, ResponsiveContainer as RC2 } from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PTxn { id:string; account_id:string; item_id:string|null; transaction_id:string|null; amount:number|string; date:string; name:string|null; merchant_name:string|null; category:string[]|null; pending:boolean; [k:string]:any; }
interface PAccount { id:string; account_id:string; name:string|null; official_name:string|null; mask:string|null; type:string|null; subtype:string|null; current_balance:number|null; [k:string]:any; }

export interface SpendingBudgetViewProps {
  txns:PTxn[]; accounts:PAccount[]; budgets:Record<string,number>;
  nameOverrides:Record<string,string>; setBudget:(c:string,n:number)=>void;
  getEffectiveCategory:(t:PTxn)=>string; formatCat:(s:string)=>string;
  catColor:(s:string)=>string; onOpenDetail:(t:PTxn)=>void; internalTxnIds:Set<string>;
  initialSearch?:string;
}

// ─── Duration types ───────────────────────────────────────────────────────────

type Duration = "day" | "week" | "month" | "year";

interface Period {
  start: string;
  end: string;
  label: string;
  // for day mode: used for pace display
  day?: number;
  days?: number;
}

function getBarPeriods(dur: Duration, off: number): { bars: { key: string; label: string; start: string; end: string }[]; windowLabel: string } {
  const now = new Date();
  if (dur === "month") {
    // Show 6 months ending at off
    const bars = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + off - 5 + i, 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return {
        key: d.toISOString().slice(0, 7),
        label: d.toLocaleDateString("en-US", { month: "short" }),
        start: d.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
      };
    });
    const anchor = new Date(now.getFullYear(), now.getMonth() + off, 1);
    return { bars, windowLabel: anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
  }
  if (dur === "year") {
    // Show up to 5 years
    const bars = Array.from({ length: 5 }, (_, i) => {
      const yr = now.getFullYear() + off - 4 + i;
      return {
        key: String(yr),
        label: String(yr),
        start: `${yr}-01-01`,
        end: `${yr}-12-31`,
      };
    });
    return { bars, windowLabel: String(now.getFullYear() + off) };
  }
  if (dur === "week") {
    // Show 8 weeks ending at off
    const bars = Array.from({ length: 8 }, (_, i) => {
      const anchor = new Date(now);
      anchor.setDate(now.getDate() + off * 7 - (7 - 7 + 0) - (7 - 7) - (7 * (7 - i)));
      const dow = anchor.getDay();
      const mon = new Date(anchor); mon.setDate(anchor.getDate() - (dow === 0 ? 6 : dow - 1));
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return {
        key: mon.toISOString().slice(0, 10),
        label: mon.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        start: mon.toISOString().slice(0, 10),
        end: sun.toISOString().slice(0, 10),
      };
    });
    const cur = bars[bars.length - 1];
    return { bars, windowLabel: `Week of ${new Date(cur.start + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}` };
  }
  // day: show 14 days ending at off
  const bars = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + off - 13 + i);
    const iso = d.toISOString().slice(0, 10);
    return {
      key: iso, label: d.toLocaleDateString("en-US", { weekday: "short" }),
      start: iso, end: iso,
    };
  });
  const cur = new Date(now); cur.setDate(now.getDate() + off);
  return { bars, windowLabel: cur.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) };
}

// ─── Filter state ─────────────────────────────────────────────────────────────

interface Fil { cats:Set<string>; accts:Set<string>; type:"all"|"expense"|"income"; status:"all"|"posted"|"pending"; min:string; max:string; sort:"date-desc"|"date-asc"|"amount-desc"|"amount-asc"|"name-asc"|"name-desc"; }
const EF:Fil = { cats:new Set(), accts:new Set(), type:"all", status:"all", min:"", max:"", sort:"date-desc" };
const hasF = (f:Fil) => f.cats.size>0||f.accts.size>0||f.type!=="all"||f.status!=="all"||!!f.min||!!f.max;
const cntF = (f:Fil) => f.cats.size+f.accts.size+(f.type!=="all"?1:0)+(f.status!=="all"?1:0)+(f.min||f.max?1:0);

const SORT_OPTS: [Fil["sort"],string][] = [
  ["date-desc","Newest first"],["date-asc","Oldest first"],
  ["amount-desc","Largest first"],["amount-asc","Smallest first"],
  ["name-asc","Name A-Z"],["name-desc","Name Z-A"],
];

function rDate(s:string){
  const d=new Date(s+"T00:00:00"),t=new Date(); t.setHours(0,0,0,0);
  const y=new Date(t); y.setDate(t.getDate()-1);
  if(+d===+t) return "Today";
  if(+d===+y) return "Yesterday";
  return d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
}

function fc2(n:number){ const v=Math.abs(n); if(v>=1000) return "$"+(v/1000).toFixed(0)+"k"; return "$"+v.toFixed(v%1<0.005?0:2).replace(/\B(?=(\d{3})+(?!\d))/g,","); }

// ─── Main component ───────────────────────────────────────────────────────────

export function SpendingBudgetView({txns,accounts,budgets,nameOverrides,setBudget,getEffectiveCategory,formatCat,catColor,onOpenDetail,internalTxnIds,initialSearch}:SpendingBudgetViewProps) {

  // ── State ─────────────────────────────────────────────────────────────────
  const [dur, setDur]     = useState<Duration>("month");
  const [off, setOff]     = useState(0);
  const [barSel, setBarSel] = useState<string|null>(null);   // selected bar key (filters txns to that sub-period)
  const [sel, setSel]     = useState<string|null>(null);    // selected category
  const [hov, setHov]     = useState<number|null>(null);    // donut hover
  const [search, setSearch] = useState(initialSearch ?? "");
  const [F, setF]         = useState<Fil>(EF);
  const [fo, setFo]       = useState(false);
  const [eCat, setECat]   = useState<string|null>(null);
  const [eDraft, setEDraft] = useState("");
  const fBtnRef           = useRef<HTMLButtonElement>(null);
  const fPanelRef         = useRef<HTMLDivElement>(null);

  useEffect(() => { if (initialSearch) setSearch(initialSearch); }, [initialSearch]);
  useEffect(() => { setSel(null); setBarSel(null); }, [off, dur]);
  useEffect(() => {
    if (!fo) return;
    const h = (e:MouseEvent) => {
      if (fBtnRef.current?.contains(e.target as Node)) return;
      if (fPanelRef.current?.contains(e.target as Node)) return;
      setFo(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [fo]);

  // ── Period / bar data ───────────────────────────────────────────────────
  const { bars, windowLabel } = useMemo(() => getBarPeriods(dur, off), [dur, off]);

  // The "active" period is either the selected bar or the full window
  const activePeriod = useMemo(() => {
    if (barSel) {
      const b = bars.find(b => b.key === barSel);
      if (b) return { start: b.start, end: b.end };
    }
    return { start: bars[0].start, end: bars[bars.length - 1].end };
  }, [barSel, bars]);

  const isCur = off === 0 && !barSel;

  // All non-internal txns within the full window
  const windowTxns = useMemo(() =>
    txns.filter(t => t.date >= bars[0].start && t.date <= bars[bars.length-1].end && !internalTxnIds.has(t.id)),
    [txns, bars, internalTxnIds]
  );

  // Bar chart data: spend per bar bucket
  const barData = useMemo(() => bars.map(b => ({
    key: b.key,
    label: b.label,
    spend: windowTxns.filter(t => t.date >= b.start && t.date <= b.end && Number(t.amount) > 0)
                     .reduce((s, t) => s + Number(t.amount), 0),
  })), [bars, windowTxns]);

  const maxBar = Math.max(...barData.map(b => b.spend), 1);

  // Active period txns
  const pTxns = useMemo(() =>
    windowTxns.filter(t => t.date >= activePeriod.start && t.date <= activePeriod.end),
    [windowTxns, activePeriod]
  );
  const expenses  = useMemo(() => pTxns.filter(t => Number(t.amount) > 0), [pTxns]);
  const incomeTotal = useMemo(() => Math.abs(pTxns.filter(t=>Number(t.amount)<0).reduce((s,t)=>s+Number(t.amount),0)), [pTxns]);

  // Category totals for active period
  const catRows = useMemo(() => {
    const m: Record<string,number> = {};
    for (const t of expenses) { const c = getEffectiveCategory(t)??"Other"; m[c]=(m[c]||0)+Number(t.amount); }
    return Object.entries(m).sort(([,a],[,b]) => b-a);
  }, [expenses, getEffectiveCategory]);

  const totalSpent   = catRows.reduce((s,[,v]) => s+v, 0);
  const totalBudget  = Object.values(budgets).reduce((s,v) => s+v, 0);
  const remaining    = totalBudget - totalSpent;
  const now          = new Date();
  const curDays      = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const spentPct     = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
  const pacePct      = (now.getDate() / curDays) * 100;

  const donut = useMemo(() => {
    const top = catRows.slice(0,8).map(([c,v]) => ({cat:c,value:v,color:catColor(c)}));
    const other = catRows.slice(8).reduce((s,[,v]) => s+v, 0);
    if (other > 0) top.push({cat:"Other", value:other, color:"hsl(215 12% 46%)"});
    return top;
  }, [catRows, catColor]);

  const allAcctNames = useMemo(() => [...new Set(txns.map(t => { const a=accounts.find(x=>x.account_id===t.account_id); return a?.name??"Unknown"; }))], [txns, accounts]);

  const [sortKey, sortDir] = F.sort.split("-") as [string, "asc"|"desc"];

  // ── Filtered visible txns ────────────────────────────────────────────────
  const visible = useMemo(() => {
    let t = [...expenses];
    if (sel)           t = t.filter(x => (getEffectiveCategory(x)??"Other") === sel);
    if (F.cats.size>0) t = t.filter(x => F.cats.has(getEffectiveCategory(x)??"Other"));
    if (F.accts.size>0) t = t.filter(x => { const a=accounts.find(acc=>acc.account_id===x.account_id); return F.accts.has(a?.name??"Unknown"); });
    if (F.type==="income") t = [...pTxns.filter(x=>Number(x.amount)<0)];
    if (F.status==="pending") t = t.filter(x => x.pending);
    if (F.status==="posted")  t = t.filter(x => !x.pending);
    if (F.min) t = t.filter(x => Number(x.amount) >= parseFloat(F.min));
    if (F.max) t = t.filter(x => Number(x.amount) <= parseFloat(F.max));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      t = t.filter(x => (nameOverrides[x.id]??x.merchant_name??x.name??"").toLowerCase().includes(q) || getEffectiveCategory(x).toLowerCase().includes(q));
    }
    return t.sort((a,b) => {
      const [va,vb] = sortKey==="date" ? [a.date,b.date] : sortKey==="amount" ? [Number(a.amount),Number(b.amount)] : [(a.merchant_name??a.name??"").toLowerCase(),(b.merchant_name??b.name??"").toLowerCase()];
      const cmp = va<vb?-1:va>vb?1:0;
      return sortDir==="desc" ? -cmp : cmp;
    });
  }, [expenses, pTxns, sel, F, sortKey, sortDir, accounts, getEffectiveCategory, search, nameOverrides]);

  const groups = useMemo(() => {
    if (sortKey !== "date") return null;
    const g: Record<string,PTxn[]> = {};
    for (const t of visible) (g[t.date]=g[t.date]||[]).push(t);
    return Object.entries(g).sort(([a],[b]) => b.localeCompare(a));
  }, [visible, sortKey]);

  const clr = () => { setF(EF); setSel(null); setBarSel(null); };
  const fc = cntF(F);

  // ── Row ──────────────────────────────────────────────────────────────────
  const Row = ({ t, showDate=false }: {t:PTxn; showDate?:boolean}) => {
    const cat = getEffectiveCategory(t) ?? "Other";
    const col = catColor(cat);
    const nm  = nameOverrides[t.id] ?? t.merchant_name ?? t.name ?? "";
    const isIncome = Number(t.amount) < 0;
    return (
      <div onClick={() => onOpenDetail(t)} className="flex items-center gap-3.5 px-5 py-3.5 cursor-pointer hover:bg-muted/20 active:bg-muted/40 transition-colors border-b border-border/15 last:border-0">
        <div className="h-10 w-10 rounded-full shrink-0 grid place-items-center text-[15px] font-bold text-white" style={{background:col}}>
          {(nm[0]??"?").toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium text-foreground truncate">{nm}</span>
            {t.pending && <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-full shrink-0">Pending</span>}
          </div>
          <div className="text-[12px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
            <span className="font-semibold shrink-0" style={{color:col}}>{formatCat(cat)}</span>
            {showDate && <span className="text-[11px] opacity-60">{rDate(t.date)}</span>}
          </div>
        </div>
        <span className={cn("text-[15px] font-bold shrink-0", isIncome ? "text-emerald-400" : "text-foreground")}>
          {isIncome ? "+" : ""}{fmtUSD(Math.abs(Number(t.amount)))}
        </span>
      </div>
    );
  };

  // ── Sidebar: spending overview + donut ──────────────────────────────────
  const SpendingContent = () => (
    <>
      <div className="px-5 pt-5 pb-0">
        <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
          {barSel ? "Selected period" : isCur ? "Spent this month" : "Total spent"}
        </div>
        <div className="text-[32px] font-black text-foreground tracking-tight leading-none">{fmtUSD(totalSpent)}</div>
        {incomeTotal > 0 && <div className="text-[12px] text-muted-foreground mt-1 flex items-center gap-1"><TrendingUp className="h-3 w-3 text-emerald-400"/>{fmtUSD(incomeTotal)} income</div>}
        {totalBudget > 0 && dur === "month" && !barSel && (
          <>
            <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{width:`${Math.min(spentPct,100)}%`,background:spentPct>100?"hsl(var(--negative))":spentPct>80?"hsl(var(--warning))":"hsl(var(--positive))"}}/>
            </div>
            {isCur && (
              <div className="relative mt-0.5 h-2.5">
                <div className="absolute" style={{left:`${Math.min(pacePct,100)}%`,transform:"translateX(-50%)"}}>
                  <div className="w-px h-2.5 bg-muted-foreground/40"/>
                </div>
              </div>
            )}
            <div className="flex justify-between text-[11px] text-muted-foreground mt-0.5">
              <span>{fmtUSD(totalSpent)} spent</span>
              <span className={cn(remaining<0?"text-destructive":"")}>{remaining>=0?"+"+(fc2(remaining))+" left":fc2(Math.abs(remaining))+" over"}</span>
            </div>
          </>
        )}
      </div>

      {/* Donut */}
      {donut.length > 0 && (
        <div className="relative px-2 mt-4" style={{height:180}}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{top:0,right:0,bottom:0,left:0}}>
              <Pie data={donut} dataKey="value" cx="50%" cy="50%"
                innerRadius={60} outerRadius={80} paddingAngle={2}
                startAngle={90} endAngle={-270} stroke="none"
                onMouseEnter={(_,i) => setHov(i)}
                onMouseLeave={() => setHov(null)}>
                {donut.map((d,i) => <Cell key={i} fill={d.color} opacity={hov===null||hov===i?1:0.25} strokeWidth={0}/>)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none select-none">
            {hov !== null && donut[hov] ? (
              <>
                <div className="text-[11px] font-semibold text-muted-foreground">{formatCat(donut[hov].cat)}</div>
                <div className="text-[19px] font-black text-foreground">{fc2(donut[hov].value)}</div>
                <div className="text-[11px] text-muted-foreground">{Math.round(donut[hov].value/totalSpent*100)}%</div>
              </>
            ) : (
              <>
                <div className="text-[11px] text-muted-foreground">{catRows.length} categories</div>
                <div className="text-[19px] font-black text-foreground">{fc2(totalSpent)}</div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Category list */}
      <div className="mt-2 pb-6">
        <button onClick={() => setSel(null)} className={cn("flex items-center gap-3 w-full px-5 py-2.5 text-left transition-colors", !sel ? "bg-muted/50" : "hover:bg-muted/20")}>
          <div className="w-1 self-stretch rounded-full bg-foreground/15 shrink-0"/>
          <span className="flex-1 text-[13px] font-medium text-foreground">All categories</span>
          <span className="text-[13px] font-bold text-foreground">{fmtUSD(totalSpent)}</span>
        </button>
        {catRows.map(([cat,spent]) => {
          const col = catColor(cat);
          const act = sel === cat;
          const b   = budgets[cat];
          const over = b && spent > b;
          const isEd = eCat === cat;
          return (
            <button key={cat} onClick={() => setSel(act ? null : cat)}
              className={cn("flex items-center gap-3 w-full px-5 py-2.5 text-left border-t border-border/15 transition-colors", act ? "bg-muted/50" : "hover:bg-muted/20")}>
              <div className="w-1 self-stretch rounded-full shrink-0" style={{background:col, minHeight:24}}/>
              <span className="flex-1 text-[13px] font-medium text-foreground truncate">{formatCat(cat)}</span>
              <div className="text-right shrink-0 ml-1.5">
                <div className="text-[13px] font-bold" style={{color:over?"hsl(var(--negative))":"hsl(var(--foreground))"}}>{fmtUSD(spent)}</div>
                {b && <div className="text-[11px] text-muted-foreground">{fc2(b)} budget</div>}
                {!b && !isEd && (
                  <button onClick={e=>{e.stopPropagation();setECat(cat);setEDraft("");}} className="text-[10.5px] text-primary/70 hover:text-primary">+ budget</button>
                )}
                {isEd && (
                  <form onSubmit={e=>{e.preventDefault();e.stopPropagation();const n=parseFloat(eDraft);if(!isNaN(n)&&n>=0)setBudget(cat,n);setECat(null);}} className="flex items-center gap-1 mt-0.5" onClick={e=>e.stopPropagation()}>
                    <span className="text-[10px] text-muted-foreground">$</span>
                    <input autoFocus value={eDraft} onChange={e=>setEDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Escape")setECat(null);}} type="number" min="0" className="w-14 h-5 px-1 rounded bg-muted border border-foreground/30 text-[11px] outline-none"/>
                    <button type="submit" className="text-[11px] text-emerald-500 font-bold">OK</button>
                  </form>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-full bg-background">

      {/* ── Duration + nav bar ─────────────────────────────────────────── */}
      <div className="bg-card border-b border-border/60 px-4 pt-3 pb-0">
        {/* Duration selector */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex bg-muted/50 rounded-xl p-0.5 gap-0.5">
            {(["day","week","month","year"] as Duration[]).map(d => (
              <button key={d} onClick={() => { setDur(d); setOff(0); }}
                className={cn("px-3 py-1.5 rounded-lg text-[12px] font-semibold capitalize transition-all",
                  dur===d ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {d}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setOff(o => o-1)} className="h-7 w-7 rounded-full border border-border/60 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
              <ChevronLeft className="h-3.5 w-3.5"/>
            </button>
            <button onClick={() => setOff(o => Math.min(o+1,0))} disabled={off>=0}
              className="h-7 w-7 rounded-full border border-border/60 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-25">
              <ChevronRight className="h-3.5 w-3.5"/>
            </button>
          </div>
        </div>

        {/* Bar chart — clickable period selector */}
        <div className="pb-1">
          <div className="flex items-end gap-1 h-14">
            {barData.map(b => {
              const pct = maxBar > 0 ? (b.spend / maxBar) : 0;
              const isSelected = barSel === b.key;
              const isCurrentPeriod = b.key === bars[bars.length-1].key && off === 0;
              return (
                <button
                  key={b.key}
                  onClick={() => setBarSel(prev => prev === b.key ? null : b.key)}
                  className="flex-1 flex flex-col items-center gap-0.5 group min-w-0"
                  title={`${b.label}: ${fmtUSD(b.spend)}`}
                >
                  <div className="w-full flex items-end" style={{height:44}}>
                    <div
                      className={cn(
                        "w-full rounded-t-sm transition-all duration-200",
                        isSelected ? "bg-primary" :
                        isCurrentPeriod ? "bg-primary/50" :
                        b.spend > 0 ? "bg-primary/25 group-hover:bg-primary/45" : "bg-border/30"
                      )}
                      style={{height: b.spend > 0 ? `${Math.max(pct * 100, 6)}%` : "4px"}}
                    />
                  </div>
                  <span className={cn("text-[9px] truncate w-full text-center transition-colors",
                    isSelected ? "text-primary font-bold" : "text-muted-foreground/60 group-hover:text-muted-foreground")}>
                    {b.label}
                  </span>
                </button>
              );
            })}
          </div>
          {/* Period label + total */}
          <div className="flex items-baseline justify-between pt-1 pb-2">
            <span className="text-[12px] font-semibold text-foreground">{barSel ? bars.find(b=>b.key===barSel)?.label ?? windowLabel : windowLabel}</span>
            <span className="text-[12px] text-muted-foreground">{fmtUSD(totalSpent)}{barSel && <span className="text-[10px] text-primary ml-1.5 font-medium">filtered</span>}</span>
          </div>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="md:flex md:items-start flex-1">

        {/* Left sidebar — desktop */}
        <div className="hidden md:block w-[280px] shrink-0 border-r border-border/30 sticky top-0 self-start bg-card overflow-y-auto" style={{maxHeight:"calc(100vh - 56px)"}}>
          <SpendingContent/>
        </div>

        {/* Right: transaction list */}
        <div className="flex-1 min-w-0">

          {/* Sticky toolbar */}
          <div className="px-4 md:px-5 py-2 border-b border-border/20 bg-card/95 backdrop-blur-sm flex items-center gap-2 sticky top-0 z-20">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search transactions..."
              className="flex-1 h-8 px-3 rounded-xl bg-muted/40 border border-border/60 text-[12.5px] text-foreground outline-none focus:border-primary/50 min-w-0"
            />
            {(search || barSel || hasF(F) || sel) && (
              <button onClick={clr} className="h-8 w-8 grid place-items-center rounded-xl bg-muted/40 text-muted-foreground hover:text-foreground shrink-0">
                <X className="h-3.5 w-3.5"/>
              </button>
            )}
            <span className="text-[12px] text-muted-foreground tabular shrink-0 min-w-[28px] text-right">{visible.length}</span>
            <button ref={fBtnRef} onClick={() => setFo(o => !o)}
              className={cn("flex items-center gap-1.5 h-8 px-3 rounded-xl border text-[12px] font-medium transition-all shrink-0",
                fo || fc > 0 ? "bg-primary text-primary-foreground border-primary" : "border-border/60 text-muted-foreground hover:text-foreground")}>
              <SlidersHorizontal className="h-3.5 w-3.5"/>
              {fc > 0 && <span>{fc}</span>}
            </button>
          </div>

          {/* Mobile: spending summary strip */}
          <div className="md:hidden px-5 py-3 border-b border-border/15 flex items-center justify-between bg-card/60">
            <div>
              <p className="text-[11px] text-muted-foreground">{barSel ? "Selected period" : "Total spent"}</p>
              <p className="text-[18px] font-black text-foreground leading-tight">{fmtUSD(totalSpent)}</p>
            </div>
            {catRows.length > 0 && (
              <div className="flex gap-1.5 flex-wrap justify-end">
                {catRows.slice(0,3).map(([cat,spent]) => (
                  <button key={cat} onClick={() => setSel(s => s===cat ? null : cat)}
                    className={cn("text-[11px] font-medium px-2 py-1 rounded-full transition-colors",
                      sel===cat ? "text-white" : "text-muted-foreground bg-muted/50")}
                    style={sel===cat ? {background:catColor(cat)} : {}}>
                    {formatCat(cat)} {fc2(spent)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Filter panel — bottom sheet portal */}
          {fo && createPortal(
            <>
              <div onClick={() => setFo(false)} className="fixed inset-0 bg-black/50 z-[299]"/>
              <div ref={fPanelRef} className="fixed bottom-0 left-0 right-0 sm:left-auto sm:right-4 sm:bottom-4 z-[300] w-full sm:w-80 max-h-[75vh] rounded-t-2xl sm:rounded-2xl border-t sm:border border-border bg-card shadow-2xl overflow-hidden flex flex-col">
                <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
                  <div className="w-9 h-1 rounded-full bg-muted-foreground/30"/>
                </div>
                <div className="px-5 py-3 border-b border-border/30 flex items-center justify-between shrink-0">
                  <span className="text-[14px] font-bold text-foreground">Filter</span>
                  {(hasF(F)||sel||F.sort!=="date-desc") && <button onClick={clr} className="text-[12px] text-muted-foreground hover:text-foreground font-medium">Reset all</button>}
                </div>
                <div className="p-4 space-y-3 overflow-y-auto flex-1">
                  <div className="grid grid-cols-3 gap-2">
                    {(["date-desc","amount-desc","name-asc"] as const).map((v,i) => (
                      <button key={v} onClick={() => setF(f=>({...f,sort:v}))}
                        className={cn("h-8 px-2 rounded-xl border text-[11.5px] font-medium transition-all",
                          F.sort===v ? "bg-primary text-primary-foreground border-primary" : "border-border/60 text-muted-foreground hover:text-foreground")}>
                        {["Newest","Amount","Name"][i]}
                      </button>
                    ))}
                  </div>
                  <div>
                    <label className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Sort</label>
                    <select value={F.sort} onChange={e=>setF(f=>({...f,sort:e.target.value as Fil["sort"]}))}
                      className="w-full h-9 px-2.5 rounded-xl bg-muted/40 border border-border/50 text-[12.5px] text-foreground outline-none">
                      {SORT_OPTS.map(([k,l])=><option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Type</label>
                      <select value={F.type} onChange={e=>setF(f=>({...f,type:e.target.value as Fil["type"]}))}
                        className="w-full h-9 px-2.5 rounded-xl bg-muted/40 border border-border/50 text-[12.5px] text-foreground outline-none">
                        <option value="all">All</option>
                        <option value="expense">Expenses</option>
                        <option value="income">Income</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Status</label>
                      <select value={F.status} onChange={e=>setF(f=>({...f,status:e.target.value as Fil["status"]}))}
                        className="w-full h-9 px-2.5 rounded-xl bg-muted/40 border border-border/50 text-[12.5px] text-foreground outline-none">
                        <option value="all">All</option>
                        <option value="posted">Posted</option>
                        <option value="pending">Pending</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Category</label>
                    <select value={F.cats.size===1?[...F.cats][0]:""} onChange={e=>setF(f=>({...f,cats:e.target.value?new Set([e.target.value]):new Set()}))}
                      className="w-full h-9 px-2.5 rounded-xl bg-muted/40 border border-border/50 text-[12.5px] text-foreground outline-none">
                      <option value="">All categories</option>
                      {catRows.map(([cat])=><option key={cat} value={cat}>{formatCat(cat)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Account</label>
                    <select value={F.accts.size===1?[...F.accts][0]:""} onChange={e=>setF(f=>({...f,accts:e.target.value?new Set([e.target.value]):new Set()}))}
                      className="w-full h-9 px-2.5 rounded-xl bg-muted/40 border border-border/50 text-[12.5px] text-foreground outline-none">
                      <option value="">All accounts</option>
                      {allAcctNames.map(acc=><option key={acc} value={acc}>{acc}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Amount range</label>
                    <div className="flex items-center gap-2">
                      {(["min","max"] as const).map(k=>(
                        <div key={k} className="flex-1 relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[13px]">$</span>
                          <input value={F[k]} onChange={e=>setF(f=>({...f,[k]:e.target.value}))} placeholder={k==="min"?"Min":"Max"} type="number" min="0"
                            className="w-full h-9 pl-6 pr-3 rounded-xl bg-muted/30 border border-border/50 text-[13px] text-foreground outline-none focus:border-primary/50"/>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="px-4 py-3 border-t border-border/30 shrink-0">
                  <button onClick={() => setFo(false)} className="w-full h-10 rounded-xl bg-foreground text-background text-[14px] font-bold">
                    Show {visible.length} {visible.length===1?"transaction":"transactions"}
                  </button>
                </div>
              </div>
            </>,
            document.body
          )}

          {/* Transaction list */}
          <div className="bg-card">
            {visible.length === 0 ? (
              <div className="py-20 flex flex-col items-center text-center gap-3 px-6">
                <Search className="h-10 w-10 text-muted-foreground/20 mx-auto"/>
                <div className="text-[15px] font-semibold text-foreground">No transactions found</div>
                <div className="text-[13px] text-muted-foreground">Try adjusting your filters or selecting a different period</div>
                {(hasF(F)||sel||barSel||search) && (
                  <button onClick={clr} className="mt-1 h-8 px-4 rounded-full border border-border/60 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
                    Clear filters
                  </button>
                )}
              </div>
            ) : groups ? groups.map(([date, txns]) => {
              const dayTotal = txns.reduce((s:number,t:PTxn) => s+Number(t.amount), 0);
              return (
                <div key={date}>
                  <div className="px-5 py-2 bg-muted/20 border-b border-border/15 flex items-center justify-between sticky top-[57px] z-10 backdrop-blur-sm">
                    <span className="text-[12.5px] font-semibold text-foreground">{rDate(date)}</span>
                    <span className="text-[12px] text-muted-foreground tabular">{fmtUSD(dayTotal)}</span>
                  </div>
                  {txns.map((t:PTxn) => { return <Row key={t.id} t={t}/>; })}
                </div>
              );
            }) : visible.map((txn:PTxn) => { return <Row key={txn.id} t={txn} showDate={true}/>; })}
          </div>

        </div>
      </div>
    </div>
  );
}
