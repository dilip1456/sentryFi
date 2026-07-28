import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { fmtUSD } from "@/lib/format";
import { ChevronLeft, ChevronRight, SlidersHorizontal, X, Check, ChevronDown, Plus, Pencil, TrendingDown, TrendingUp } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { ObligationsView } from "./ObligationsView";

// ── Types ─────────────────────────────────────────────────────────────────────
interface PTxn { id:string; account_id:string; item_id:string|null; transaction_id:string|null; amount:number|string; date:string; name:string|null; merchant_name:string|null; category:string[]|null; pending:boolean; [k:string]:any; }
interface PAccount { id:string; account_id:string; name:string|null; official_name:string|null; mask:string|null; type:string|null; subtype:string|null; current_balance:number|null; [k:string]:any; }

export interface SpendingBudgetViewProps {
  txns:PTxn[]; accounts:PAccount[]; budgets:Record<string,number>;
  nameOverrides:Record<string,string>; setBudget:(c:string,n:number)=>void;
  getEffectiveCategory:(t:PTxn)=>string; formatCat:(s:string)=>string;
  catColor:(s:string)=>string; onOpenDetail:(t:PTxn)=>void; internalTxnIds:Set<string>;
}

// ── Filter state ──────────────────────────────────────────────────────────────
interface Fil { cats:Set<string>; accts:Set<string>; type:"all"|"expense"|"income"; status:"all"|"posted"|"pending"; min:string; max:string; sort:"date-desc"|"date-asc"|"amount-desc"|"amount-asc"|"name-asc"|"name-desc"; }
const EF:Fil = { cats:new Set(), accts:new Set(), type:"all", status:"all", min:"", max:"", sort:"date-desc" };
const hasF = (f:Fil) => f.cats.size>0||f.accts.size>0||f.type!=="all"||f.status!=="all"||!!f.min||!!f.max;
const cntF = (f:Fil) => f.cats.size+f.accts.size+(f.type!=="all"?1:0)+(f.status!=="all"?1:0)+(f.min||f.max?1:0);

const SORT_OPTS: [Fil["sort"],string][] = [
  ["date-desc","Date: newest first"],["date-asc","Date: oldest first"],
  ["amount-desc","Amount: largest first"],["amount-asc","Amount: smallest first"],
  ["name-asc","Name: A → Z"],["name-desc","Name: Z → A"],
];

function rDate(s:string){
  const d=new Date(s+"T00:00:00"),t=new Date(); t.setHours(0,0,0,0);
  const y=new Date(t); y.setDate(t.getDate()-1);
  if(+d===+t) return "Today";
  if(+d===+y) return "Yesterday";
  return d.toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"});
}
function getPer(off:number){ const n=new Date(); const s=new Date(n.getFullYear(),n.getMonth()+off,1); const e=new Date(n.getFullYear(),n.getMonth()+off+1,0); return{start:s.toISOString().slice(0,10),end:e.toISOString().slice(0,10),label:s.toLocaleDateString("en-US",{month:"long",year:"numeric"}),days:e.getDate(),day:off===0?n.getDate():e.getDate()}; }
function fc2(n:number){ const v=Math.abs(n); if(v>=1000) return "$"+(v/1000).toFixed(0)+"k"; return "$"+v.toFixed(v%1<0.005?0:2).replace(/\B(?=(\d{3})+(?!\d))/g,","); }

// ── Component ─────────────────────────────────────────────────────────────────
export function SpendingBudgetView({txns,accounts,budgets,nameOverrides,setBudget,getEffectiveCategory,formatCat,catColor,onOpenDetail,internalTxnIds}:SpendingBudgetViewProps) {
  const [off, setOff]     = useState(0);
  const [tab, setTab]     = useState<"spending"|"obligations">("spending");
  const [sel, setSel]     = useState<string|null>(null);    // selected category (left panel)
  const [hov, setHov]     = useState<number|null>(null);    // donut hover index
  const [F,   setF]       = useState<Fil>(EF);              // filters incl. sort
  const [fo,  setFo]      = useState(false);                // filter panel open
  const [eCat,setECat]    = useState<string|null>(null);    // budget edit cat
  const [eDraft,setEDraft]= useState("");
  const fBtnRef = useRef<HTMLButtonElement>(null);
  const fPanelRef = useRef<HTMLDivElement>(null);

  // FIX 1: Correct outside-click handler — checks both button and panel
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

  // FIX 5: Clear category selection when changing months
  useEffect(() => { setSel(null); }, [off]);

  const per  = getPer(off);
  const isCur = off === 0;

  const pTxns = useMemo(() => txns.filter(t => t.date >= per.start && t.date <= per.end && !internalTxnIds.has(t.id)), [txns, per, internalTxnIds]);
  const expenses = useMemo(() => pTxns.filter(t => Number(t.amount) > 0), [pTxns]);
  const incomeTotal = useMemo(() => Math.abs(pTxns.filter(t=>Number(t.amount)<0).reduce((s,t)=>s+Number(t.amount),0)), [pTxns]);

  // Category totals
  const catRows = useMemo(() => {
    const m: Record<string,number> = {};
    for (const t of expenses) { const c = getEffectiveCategory(t)??"Other"; m[c]=(m[c]||0)+Number(t.amount); }
    return Object.entries(m).sort(([,a],[,b]) => b-a);
  }, [expenses, getEffectiveCategory]);

  const totalSpent   = catRows.reduce((s,[,v]) => s+v, 0);
  const totalBudget  = Object.values(budgets).reduce((s,v) => s+v, 0);
  const remaining    = totalBudget - totalSpent;
  const pacePct      = (per.day / per.days) * 100;
  const spentPct     = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;

  const donut = useMemo(() => {
    const top = catRows.slice(0,8).map(([c,v]) => ({cat:c,value:v,color:catColor(c)}));
    const other = catRows.slice(8).reduce((s,[,v]) => s+v, 0);
    if (other > 0) top.push({cat:"Other", value:other, color:"hsl(215 12% 46%)"});
    return top;
  }, [catRows, catColor]);

  const allAcctNames = useMemo(() => [...new Set(txns.map(t => { const a=accounts.find(x=>x.account_id===t.account_id); return a?.name??"Unknown"; }))], [txns, accounts]);

  // FIX 6: Sort is now part of filter state, not separate — consistent state
  const [sortKey, sortDir] = F.sort.split("-") as [string, "asc"|"desc"];

  // Filtered + sorted transactions
  const visible = useMemo(() => {
    let t = [...expenses];
    if (sel) t = t.filter(x => (getEffectiveCategory(x)??"Other") === sel);
    if (F.cats.size > 0) t = t.filter(x => F.cats.has(getEffectiveCategory(x)??"Other"));
    if (F.accts.size > 0) t = t.filter(x => { const a=accounts.find(acc=>acc.account_id===x.account_id); return F.accts.has(a?.name??"Unknown"); });
    if (F.type === "income") t = [...pTxns.filter(x=>Number(x.amount)<0)];  // income = negative amounts
    if (F.status === "pending") t = t.filter(x => x.pending);
    if (F.status === "posted")  t = t.filter(x => !x.pending);
    if (F.min) t = t.filter(x => Number(x.amount) >= parseFloat(F.min));
    if (F.max) t = t.filter(x => Number(x.amount) <= parseFloat(F.max));
    return t.sort((a,b) => {
      const [va,vb] = sortKey==="date" ? [a.date,b.date] : sortKey==="amount" ? [Number(a.amount),Number(b.amount)] : [(a.merchant_name??a.name??"").toLowerCase(),(b.merchant_name??b.name??"").toLowerCase()];
      const cmp = va<vb?-1:va>vb?1:0;
      return sortDir==="desc" ? -cmp : cmp;
    });
  }, [expenses, pTxns, sel, F, sortKey, sortDir, accounts, getEffectiveCategory]);

  const groups = useMemo(() => {
    if (sortKey !== "date") return null;
    const g: Record<string,PTxn[]> = {};
    for (const t of visible) (g[t.date]=g[t.date]||[]).push(t);
    return Object.entries(g).sort(([a],[b]) => b.localeCompare(a));
  }, [visible, sortKey]);

  const tog = (k:"cats"|"accts", v:string) => setF(f => { const s=new Set(f[k]); s.has(v)?s.delete(v):s.add(v); return {...f,[k]:s}; });
  const clr = () => { setF(EF); setSel(null); };
  const fc = cntF(F);
  const sortLabel = SORT_OPTS.find(([k])=>k===F.sort)?.[1] ?? "Sort";

  // ── Transaction row ──────────────────────────────────────────────────────────
  const Row = ({ t, showDate=false }: {t:PTxn; showDate?:boolean}) => {
    const acc = accounts.find(a => a.account_id === t.account_id);
    const cat = getEffectiveCategory(t) ?? "Other";
    const col = catColor(cat);
    const nm  = nameOverrides[t.id] ?? t.merchant_name ?? t.name ?? "";
    const isIncome = Number(t.amount) < 0;
    return (
      <div onClick={() => onOpenDetail(t)} className="flex items-center gap-3.5 px-5 py-3.5 cursor-pointer hover:bg-muted/25 transition-colors border-b border-border/20 last:border-0">
        <div className="h-10 w-10 rounded-full shrink-0 grid place-items-center text-[15px] font-bold text-white" style={{background:col}}>
          {(nm[0]??"?").toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium text-foreground truncate">{nm}</span>
            {t.pending && <span className="text-[10px] font-bold text-warning bg-warning/10 px-1.5 py-0.5 rounded-full shrink-0">Pending</span>}
          </div>
          <div className="text-[12px] text-muted-foreground mt-0.5 flex items-center gap-1.5 min-w-0">
            <span className="font-semibold shrink-0" style={{color:col}}>{formatCat(cat)}</span>
            {acc?.name && <><span className="opacity-30">·</span><span className="truncate">{acc.name}</span></>}
            {showDate && <><span className="opacity-30">·</span><span className="shrink-0 text-[11px]">{rDate(t.date)}</span></>}
          </div>
        </div>
        <span className={cn("text-[15px] font-bold shrink-0", isIncome ? "text-positive" : "text-foreground")}>
          {isIncome ? "+" : ""}{fmtUSD(Math.abs(Number(t.amount)))}
        </span>
      </div>
    );
  };

  // ── Budget sidebar content (shared between desktop sidebar and mobile view) ──
  const BudgetContent = () => (
    <>
      <div className="px-5 pt-5 pb-4">
        <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Budget overview</div>
        <div className="text-[30px] font-black leading-none tracking-tight mb-0.5" style={{color:remaining>=0?"hsl(var(--positive))":"hsl(var(--negative))"}}>
          {remaining >= 0 ? "+" : "-"}{fc2(Math.abs(remaining))}
        </div>
        <div className="text-[12px] text-muted-foreground">{remaining >= 0 ? "under planned" : "over planned"}</div>
        <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500 relative" style={{width:`${Math.min(spentPct,100)}%`,background:spentPct>100?"hsl(var(--negative))":spentPct>80?"hsl(var(--warning))":"hsl(var(--positive))"}}>
            {isCur && <div className="absolute right-0 top-0 bottom-0 w-px opacity-0"/>}
          </div>
        </div>
        {isCur && (
          <div className="relative mt-0.5 h-3">
            <div className="absolute" style={{left:`${Math.min(pacePct,100)}%`,transform:"translateX(-50%)"}}>
              <div className="w-px h-2.5 bg-muted-foreground/40"/>
            </div>
          </div>
        )}
        <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
          <span>{fmtUSD(totalSpent)} spent</span>
          <span>{isCur && `Day ${per.day}/${per.days} · `}{fmtUSD(totalBudget)} budget</span>
        </div>
      </div>

      <div className="divide-y divide-border/20 pb-6">
        {catRows.map(([cat,spent]) => {
          const col   = catColor(cat);
          const b     = budgets[cat];
          const over  = b && spent > b;
          const pct   = b ? Math.min(spent/b*100, 100) : 0;
          const isEd  = eCat === cat;
          return (
            <div key={cat} className="px-5 py-3.5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-1 rounded-full shrink-0" style={{background:col, height:32}}/>
                <span className="flex-1 text-[13.5px] font-medium text-foreground truncate">{formatCat(cat)}</span>
                {over && <span className="text-[9px] font-black text-negative bg-negative/10 px-1.5 py-0.5 rounded-full shrink-0">OVER</span>}
                <div className="text-right shrink-0">
                  <div className="text-[13.5px] font-bold" style={{color:over?"hsl(var(--negative))":"hsl(var(--foreground))"}}>{fmtUSD(spent)}</div>
                  {isEd ? (
                    <form className="flex items-center gap-1 justify-end mt-0.5" onSubmit={e => { e.preventDefault(); const n=parseFloat(eDraft); if(!isNaN(n)&&n>=0) setBudget(cat,n); setECat(null); }}>
                      <span className="text-[10px] text-muted-foreground">$</span>
                      <input autoFocus value={eDraft} onChange={e=>setEDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Escape")setECat(null);}} type="number" min="0" className="w-16 h-5 px-1 rounded-md bg-muted border border-foreground/30 text-[11px] outline-none text-foreground"/>
                      <button type="submit" className="text-[11px] text-positive font-bold">✓</button>
                      <button type="button" onClick={()=>setECat(null)} className="text-[11px] text-muted-foreground">✕</button>
                    </form>
                  ) : (
                    <button onClick={() => { setECat(cat); setEDraft(String(b||"")); }} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5 justify-end mt-0.5">
                      {b ? `planned: ${fmtUSD(b)}` : <span className="text-[hsl(var(--primary))] font-semibold">+ Set budget</span>}
                      {b && <Pencil className="h-2.5 w-2.5 ml-0.5 opacity-40"/>}
                    </button>
                  )}
                </div>
              </div>
              {b && (
                <div className="ml-4">
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{width:`${pct}%`,background:over?"hsl(var(--negative))":pct>80?"hsl(var(--warning))":col}}/>
                  </div>
                  <div className="flex justify-between mt-1 text-[11px] text-muted-foreground">
                    <span>{Math.round(pct)}%</span>
                    <span style={{color:over?"hsl(var(--negative))":"inherit"}}>{over ? `${fmtUSD(spent-b)} over` : `${fmtUSD(b-spent)} left`}</span>
                  </div>
                </div>
              )}
              {!b && (
                <button onClick={() => { setECat(cat); setEDraft(""); }} className="ml-4 text-[11px] text-[hsl(var(--primary))] hover:opacity-70 flex items-center gap-1 mt-0.5">
                  <Plus className="h-3 w-3"/>Set budget
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );

  // ── Spending sidebar content ──────────────────────────────────────────────
  const SpendingContent = () => (
    <>
      <div className="px-5 pt-5 pb-0">
        <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">{isCur ? "Spent this month" : "Total spent"}</div>
        <div className="text-[32px] font-black text-foreground tracking-tight leading-none">{fmtUSD(totalSpent)}</div>
        {incomeTotal > 0 && <div className="text-[12px] text-muted-foreground mt-1 flex items-center gap-1"><TrendingUp className="h-3 w-3 text-positive"/>{fmtUSD(incomeTotal)} income</div>}
      </div>
      {/* Donut */}
      <div className="relative px-2 mt-4" style={{height:190}}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{top:0,right:0,bottom:0,left:0}}>
            <Pie data={donut} dataKey="value" cx="50%" cy="50%"
              innerRadius={62} outerRadius={84} paddingAngle={2}
              startAngle={90} endAngle={-270} stroke="none"
              onMouseEnter={(_,i) => setHov(i)}
              onMouseLeave={() => setHov(null)}>
              {donut.map((d,i) => <Cell key={i} fill={d.color} opacity={hov===null||hov===i?1:0.2} strokeWidth={0}/>)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {/* FIX 10: pointer-events-none prevents hover getting stuck */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none select-none">
          {hov !== null && donut[hov] ? (
            <><div className="text-[11px] font-semibold text-muted-foreground">{formatCat(donut[hov].cat)}</div>
            <div className="text-[20px] font-black text-foreground">{fc2(donut[hov].value)}</div>
            <div className="text-[11px] text-muted-foreground">{Math.round(donut[hov].value/totalSpent*100)}%</div></>
          ) : (
            <><div className="text-[11px] text-muted-foreground">{catRows.length} categories</div>
            <div className="text-[20px] font-black text-foreground">{fc2(totalSpent)}</div></>
          )}
        </div>
      </div>
      {/* Category list */}
      <div className="mt-3 pb-6">
        <button onClick={() => setSel(null)} className={cn("flex items-center gap-3 w-full px-5 py-3 text-left transition-colors", !sel ? "bg-muted/50" : "hover:bg-muted/20")}>
          <div className="w-1 self-stretch rounded-full bg-foreground/15 shrink-0"/>
          <span className="flex-1 text-[13.5px] font-medium text-foreground">All categories</span>
          <span className="text-[13.5px] font-bold text-foreground">{fmtUSD(totalSpent)}</span>
        </button>
        {catRows.map(([cat,spent]) => {
          const col  = catColor(cat);
          const act  = sel === cat;
          const pct  = Math.round(spent/totalSpent*100);
          const b    = budgets[cat];
          const over = b && spent > b;
          return (
            <button key={cat} onClick={() => setSel(act ? null : cat)}
              className={cn("flex items-center gap-3 w-full px-5 py-3 text-left border-t border-border/20 transition-colors", act ? "bg-muted/50" : "hover:bg-muted/20")}>
              <div className="w-1 self-stretch rounded-full shrink-0" style={{background:col, minHeight:28}}/>
              <span className="flex-1 text-[13.5px] font-medium text-foreground truncate">{formatCat(cat)}</span>
              <div className="text-right shrink-0 ml-2">
                <div className="text-[13.5px] font-bold" style={{color:over?"hsl(var(--negative))":"hsl(var(--foreground))"}}>{fmtUSD(spent)}</div>
                <div className="text-[11px] text-muted-foreground">{pct}%{b && ` / ${fc2(b)}`}</div>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );

  return (
    <div className="flex flex-col min-h-full">

      {/* ═══ TOP BAR ════════════════════════════════════════════════════════ */}
      <div className="bg-card border-b border-border px-4 md:px-8 py-3 flex items-center gap-3">
        {/* Spending | Budgets toggle */}
        <div className="flex bg-muted/50 rounded-xl p-1 text-[13px] font-semibold shrink-0">
          {(["spending","obligations"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={cn("px-4 py-1.5 rounded-lg transition-all", tab===t ? "bg-card shadow text-foreground" : "text-muted-foreground")}>
              {t === "spending" ? "Spending" : "Obligations"}
            </button>
          ))}
        </div>

        {/* ← Month → — FIX 9 fix: centered */}
        <div className="flex items-center gap-2 mx-auto">
          <button onClick={() => setOff(o => o-1)} className="h-8 w-8 rounded-full border border-border/60 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"><ChevronLeft className="h-4 w-4"/></button>
          <span className="text-[15px] font-bold text-foreground min-w-[140px] text-center">{per.label}</span>
          <button onClick={() => setOff(o => Math.min(o+1,0))} disabled={off>=0} className="h-8 w-8 rounded-full border border-border/60 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-20"><ChevronRight className="h-4 w-4"/></button>
        </div>

        {/* Spacer to balance toggle on left */}
        <div className="shrink-0 w-[110px] md:w-[130px]"/>
      </div>

      {/* ═══ MOBILE: budget overview strip when on budget tab ══════════════ */}
      {/* Obligations tab is now fully handled by ObligationsView below */}

      {/* ═══ OBLIGATIONS TAB — new full component ══════════════════════════ */}
      {tab === "obligations" && (
        <ObligationsView
          txns={txns as any}
          month={per.key}
          formatCat={formatCat}
          catColor={catColor}
          getEffectiveCategory={getEffectiveCategory as any}
        />
      )}

      {/* ═══ SPENDING TAB CONTENT ═══════════════════════════════════════════ */}
      {tab === "spending" && <>

      {/* ═══ MOBILE: category chips when on spending tab ═══════════════════ */}
      {tab === "spending" && (
        <div className="md:hidden bg-card border-b border-border/30 overflow-x-auto scrollbar-none">
          <div className="flex gap-1.5 px-4 py-2.5 whitespace-nowrap">
            <button onClick={() => setSel(null)} className={cn("h-7 px-3 rounded-full text-[12px] font-semibold border shrink-0 transition-all", !sel ? "bg-foreground text-background border-foreground" : "border-border/60 text-muted-foreground")}>All</button>
            {catRows.map(([cat,sp]) => { const col=catColor(cat); const act=sel===cat; return (
              <button key={cat} onClick={() => setSel(act?null:cat)} className="h-7 px-3 rounded-full text-[12px] font-medium border shrink-0 flex items-center gap-1.5 transition-all"
                style={{background:act?col:"transparent",color:act?"white":"hsl(var(--muted-foreground))",borderColor:act?col:undefined}}>
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{background:act?"rgba(255,255,255,0.7)":col}}/>
                {formatCat(cat)} {fc2(sp)}
              </button>
            ); })}
          </div>
        </div>
      )}

      {/* ═══ BODY ══════════════════════════════════════════════════════════ */}
      <div className="md:flex md:items-start">

        {/* LEFT SIDEBAR (desktop only) */}
        <div className="hidden md:block w-[280px] shrink-0 border-r border-border/30 sticky top-0 self-start bg-card" style={{maxHeight:"calc(100vh - 56px)", overflowY:"auto"}}>
          <SpendingContent/>
        </div>

        {/* RIGHT: Transactions */}
        <div className="flex-1 min-w-0">

          {/* FIX 7+1: Toolbar with filter button using correct ref, proper dropdown */}
          <div className="px-4 md:px-5 py-2 border-b border-border/20 bg-card flex items-center gap-2 sticky top-0 z-20 backdrop-blur-sm">

            {/* Active filter chips */}
            <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto scrollbar-none">
              {sel && (
                <div className="flex items-center gap-1 h-6 px-2 rounded-full border border-border/60 bg-muted/50 text-[11px] font-medium text-foreground shrink-0">
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{background:catColor(sel)}}/>
                  <span className="mx-0.5">{formatCat(sel)}</span>
                  <button onClick={() => setSel(null)} className="text-muted-foreground hover:text-foreground ml-0.5"><X className="h-2.5 w-2.5"/></button>
                </div>
              )}
              {[...F.cats].map(cat => (
                <div key={cat} className="flex items-center gap-1 h-6 px-2 rounded-full bg-muted/50 border border-border/50 text-[11px] text-foreground shrink-0">
                  <div className="w-1.5 h-1.5 rounded-full" style={{background:catColor(cat)}}/><span className="mx-0.5">{formatCat(cat)}</span>
                  <button onClick={() => tog("cats",cat)} className="text-muted-foreground hover:text-foreground"><X className="h-2.5 w-2.5"/></button>
                </div>
              ))}
              {[...F.accts].map(acc => (
                <div key={acc} className="flex items-center gap-1 h-6 px-2 rounded-full bg-muted/50 border border-border/50 text-[11px] text-foreground shrink-0">
                  <span>{acc}</span><button onClick={() => tog("accts",acc)} className="ml-0.5 text-muted-foreground hover:text-foreground"><X className="h-2.5 w-2.5"/></button>
                </div>
              ))}
              {F.type !== "all" && <div className="flex items-center gap-1 h-6 px-2 rounded-full bg-muted/50 border border-border/50 text-[11px] text-foreground shrink-0 capitalize"><span>{F.type}</span><button onClick={() => setF(f => ({...f,type:"all"}))} className="ml-0.5 text-muted-foreground hover:text-foreground"><X className="h-2.5 w-2.5"/></button></div>}
              {F.status !== "all" && <div className="flex items-center gap-1 h-6 px-2 rounded-full bg-muted/50 border border-border/50 text-[11px] text-foreground shrink-0 capitalize"><span>{F.status}</span><button onClick={() => setF(f => ({...f,status:"all"}))} className="ml-0.5 text-muted-foreground hover:text-foreground"><X className="h-2.5 w-2.5"/></button></div>}
              {(hasF(F)||sel) && <button onClick={clr} className="text-[11px] text-muted-foreground hover:text-foreground shrink-0 ml-1 underline underline-offset-2">Clear</button>}
            </div>

            {/* Right side: count + dropdown button */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[12px] text-muted-foreground hidden sm:block tabular">{visible.length}</span>

              {/* FIX 1+7: Button has its own ref, panel has its own ref */}
              <button ref={fBtnRef} onClick={() => setFo(o => !o)}
                className={cn("flex items-center gap-1.5 h-8 px-3 rounded-full border text-[12.5px] font-medium transition-all",
                  fo || fc > 0 || F.sort !== "date-desc"
                    ? "bg-foreground text-background border-foreground"
                    : "border-border/60 text-muted-foreground hover:text-foreground")}>
                <SlidersHorizontal className="h-3.5 w-3.5 shrink-0"/>
                <span className="hidden sm:inline">
                  {F.sort !== "date-desc" ? sortLabel.split(":")[1]?.trim() ?? sortLabel : "Sort & Filter"}
                </span>
                {fc > 0 && <span className="h-4 min-w-[16px] px-1 rounded-full text-[9px] font-bold grid place-items-center" style={{background:"hsl(var(--primary))",color:"hsl(var(--primary-foreground))"}}>{fc}</span>}
                <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", fo && "rotate-180")}/>
              </button>
            </div>

            {/* Filter panel — portal-rendered to escape transform contexts */}
            {fo && createPortal(
              <>
                {/* Backdrop */}
                <div onClick={() => setFo(false)} className="fixed inset-0 bg-black/50 z-[299]"/>
                {/* Panel: bottom sheet on mobile, popover on desktop */}
                <div ref={fPanelRef} className="fixed bottom-0 left-0 right-0 sm:left-auto sm:right-4 sm:bottom-auto sm:top-[120px] z-[300] w-full sm:w-80 rounded-t-2xl sm:rounded-2xl border-t sm:border border-border bg-card shadow-2xl overflow-hidden">
                  {/* Mobile drag handle */}
                  <div className="sm:hidden flex justify-center pt-2.5 pb-1">
                    <div className="w-9 h-1 rounded-full bg-muted-foreground/30"/>
                  </div>
                  <div className="px-5 py-3.5 border-b border-border/30 flex items-center justify-between">
                    <span className="text-[14px] font-bold text-foreground">Sort & Filter</span>
                    {(hasF(F)||sel||F.sort!=="date-desc") && <button onClick={() => { clr(); }} className="text-[12px] text-muted-foreground hover:text-foreground font-medium">Reset all</button>}
                  </div>

                  <div className="p-4 space-y-4 max-h-[55vh] sm:max-h-[60vh] overflow-y-auto">
                    {/* Sort */}
                    <div>
                      <div className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Sort by</div>
                      <div className="flex flex-col gap-1">
                        {SORT_OPTS.map(([key, label]) => {
                          const act = F.sort === key;
                          return (
                            <button key={key} onClick={() => setF(f => ({...f,sort:key}))}
                              className={cn("h-9 px-3 rounded-xl text-[13px] font-medium border text-left flex items-center justify-between gap-2 transition-all",
                                act ? "bg-foreground text-background border-foreground" : "border-border/50 text-foreground/80 hover:border-foreground/40 hover:text-foreground")}>
                              <span>{label}</span>
                              {act && <Check className="h-3.5 w-3.5 shrink-0"/>}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Type */}
                    <div>
                      <div className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Type</div>
                      <div className="flex gap-1.5">
                        {(["all","expense","income"] as const).map(v => (
                          <button key={v} onClick={() => setF(f => ({...f,type:v}))} className={cn("flex-1 h-9 rounded-xl text-[13px] font-medium border transition-all", F.type===v ? "bg-foreground text-background border-foreground" : "border-border/50 text-foreground/80 hover:border-foreground/40")}>
                            {v==="all"?"All":v==="expense"?"Expenses":"Income"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Status */}
                    <div>
                      <div className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Status</div>
                      <div className="flex gap-1.5">
                        {(["all","posted","pending"] as const).map(v => (
                          <button key={v} onClick={() => setF(f => ({...f,status:v}))} className={cn("flex-1 h-9 rounded-xl text-[13px] font-medium border capitalize transition-all", F.status===v ? "bg-foreground text-background border-foreground" : "border-border/50 text-foreground/80 hover:border-foreground/40")}>{v}</button>
                        ))}
                      </div>
                    </div>

                    {/* Category */}
                    <div>
                      <div className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Category</div>
                      <div className="flex flex-wrap gap-1.5">
                        {catRows.map(([cat]) => { const a=F.cats.has(cat); return (
                          <button key={cat} onClick={() => tog("cats",cat)}
                            className={cn("h-8 px-3 rounded-full text-[12px] font-medium border flex items-center gap-1.5 transition-all",
                              a ? "bg-foreground text-background border-foreground" : "border-border/50 text-foreground/80 hover:border-foreground/40")}>
                            {a ? <Check className="h-3 w-3 shrink-0"/> : <div className="w-2 h-2 rounded-full shrink-0" style={{background:catColor(cat)}}/>}
                            {formatCat(cat)}
                          </button>
                        ); })}
                      </div>
                    </div>

                    {/* Account */}
                    <div>
                      <div className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Account</div>
                      <div className="flex flex-wrap gap-1.5">
                        {allAcctNames.map(acc => { const a=F.accts.has(acc); return (
                          <button key={acc} onClick={() => tog("accts",acc)}
                            className={cn("h-8 px-3 rounded-full text-[12px] font-medium border flex items-center gap-1.5 transition-all",
                              a ? "bg-foreground text-background border-foreground" : "border-border/50 text-foreground/80 hover:border-foreground/40")}>
                            {a && <Check className="h-3 w-3 shrink-0"/>}{acc}
                          </button>
                        ); })}
                      </div>
                    </div>

                    {/* Amount range */}
                    <div>
                      <div className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Amount</div>
                      <div className="flex items-center gap-2">
                        {(["min","max"] as const).map(k => (
                          <div key={k} className="flex-1 relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[13px]">$</span>
                            <input value={F[k]} onChange={e => setF(f => ({...f,[k]:e.target.value}))} placeholder={k==="min"?"Min":"Max"} type="number" min="0"
                              className="w-full h-9 pl-6 pr-3 rounded-xl bg-muted/30 border border-border/50 text-[13px] text-foreground outline-none focus:border-foreground/40"/>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="px-4 py-3 border-t border-border/30">
                    <button onClick={() => setFo(false)} className="w-full h-10 rounded-xl bg-foreground text-background text-[14px] font-bold">
                      Show {visible.length} transaction{visible.length!==1?"s":""}
                    </button>
                  </div>
                </div>
              </>,
              document.body
            )}
          </div>

          {/* FIX 9: Date headers use z-10 (lower than sticky toolbar z-20) */}
          <div className="bg-card">
            {visible.length === 0 ? (
              <div className="py-20 flex flex-col items-center text-center gap-3">
                <div className="text-[44px]">🔍</div>
                <div className="text-[15px] font-semibold text-foreground">No transactions found</div>
                <div className="text-[13px] text-muted-foreground">Try adjusting your filters or select a different month</div>
                {(hasF(F)||sel) && <button onClick={clr} className="mt-2 h-8 px-4 rounded-full border border-border/60 text-[13px] text-muted-foreground hover:text-foreground">Clear filters</button>}
              </div>
            ) : groups ? groups.map(([date,txns]) => (
              <div key={date}>
                <div className="px-5 py-2.5 bg-muted/30 border-b border-border/20 flex items-center justify-between z-10">
                  <span className="text-[13px] font-bold text-foreground">{rDate(date)}</span>
                  <span className="text-[12px] font-semibold text-muted-foreground">{fmtUSD(txns.reduce((s,t)=>s+Number(t.amount),0))}</span>
                </div>
                {txns.map(t => <Row key={t.id} t={t}/>)}
              </div>
            )) : visible.map(t => <Row key={t.id} t={t} showDate/>)}
          </div>
        </div>
      </div>

      </>} {/* end tab === "spending" */}
    </div>
  );
}
