import { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { fmtUSD } from "@/lib/format";
import {
  ChevronLeft, ChevronRight, SlidersHorizontal, X,
  Plus, Pencil, TrendingUp, Search, ArrowUpDown, ArrowUp, ArrowDown
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

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

// ─── Duration ─────────────────────────────────────────────────────────────────

type Duration = "day" | "week" | "month" | "year";

function getBarPeriods(dur: Duration, off: number) {
  const now = new Date();
  if (dur === "month") {
    const bars = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + off - 5 + i, 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return { key: d.toISOString().slice(0, 7), label: d.toLocaleDateString("en-US", { month: "short" }), start: d.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
    });
    const anchor = new Date(now.getFullYear(), now.getMonth() + off, 1);
    return { bars, windowLabel: anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
  }
  if (dur === "year") {
    const bars = Array.from({ length: 5 }, (_, i) => {
      const yr = now.getFullYear() + off - 4 + i;
      return { key: String(yr), label: String(yr), start: `${yr}-01-01`, end: `${yr}-12-31` };
    });
    return { bars, windowLabel: String(now.getFullYear() + off) };
  }
  if (dur === "week") {
    const bars = Array.from({ length: 8 }, (_, i) => {
      const anchor = new Date(now);
      anchor.setDate(now.getDate() + off * 7 - (7 * (7 - i)));
      const dow = anchor.getDay();
      const mon = new Date(anchor); mon.setDate(anchor.getDate() - (dow === 0 ? 6 : dow - 1));
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return { key: mon.toISOString().slice(0, 10), label: mon.toLocaleDateString("en-US", { month: "short", day: "numeric" }), start: mon.toISOString().slice(0, 10), end: sun.toISOString().slice(0, 10) };
    });
    const cur = bars[bars.length - 1];
    return { bars, windowLabel: `Week of ${new Date(cur.start + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}` };
  }
  const bars = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now); d.setDate(now.getDate() + off - 13 + i);
    const iso = d.toISOString().slice(0, 10);
    return { key: iso, label: d.toLocaleDateString("en-US", { day: "numeric" }) + "/" + d.toLocaleDateString("en-US", { month: "short" }), start: iso, end: iso };
  });
  const cur = new Date(now); cur.setDate(now.getDate() + off);
  return { bars, windowLabel: cur.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) };
}

// ─── Filter state ─────────────────────────────────────────────────────────────

type SortField = "date" | "amount" | "name";
type SortDir   = "asc" | "desc";
interface Fil { cats:Set<string>; accts:Set<string>; type:"all"|"expense"|"income"; status:"all"|"posted"|"pending"; min:string; max:string; sortField:SortField; sortDir:SortDir; }
const EF: Fil = { cats:new Set(), accts:new Set(), type:"all", status:"all", min:"", max:"", sortField:"date", sortDir:"desc" };
const hasF = (f:Fil) => f.cats.size>0||f.accts.size>0||f.type!=="all"||f.status!=="all"||!!f.min||!!f.max;
const cntF = (f:Fil) => f.cats.size+f.accts.size+(f.type!=="all"?1:0)+(f.status!=="all"?1:0)+(f.min||f.max?1:0);

function rDate(s:string){
  const d=new Date(s+"T00:00:00"),t=new Date(); t.setHours(0,0,0,0);
  const y=new Date(t); y.setDate(t.getDate()-1);
  if(+d===+t) return "Today";
  if(+d===+y) return "Yesterday";
  return d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
}
function fc2(n:number){ const v=Math.abs(n); if(v>=1000) return "$"+(v/1000).toFixed(0)+"k"; return "$"+v.toFixed(v%1<0.005?0:2).replace(/\B(?=(\d{3})+(?!\d))/g,","); }

// ─── Component ────────────────────────────────────────────────────────────────

export function SpendingBudgetView({txns,accounts,budgets,nameOverrides,setBudget,getEffectiveCategory,formatCat,catColor,onOpenDetail,internalTxnIds,initialSearch}:SpendingBudgetViewProps) {

  const [dur, setDur]     = useState<Duration>("month");
  const [off, setOff]     = useState(0);
  const [barSel, setBarSel] = useState<string|null>(null);
  const [sel, setSel]     = useState<string|null>(null);
  const [hov, setHov]     = useState<number|null>(null);
  const [search, setSearch] = useState(initialSearch ?? "");
  const [F, setF]         = useState<Fil>(EF);
  const [fo, setFo]       = useState(false);
  const [eCat, setECat]   = useState<string|null>(null);
  const [eDraft, setEDraft] = useState("");
  const fBtnRef = useRef<HTMLButtonElement>(null);
  const fPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (initialSearch !== undefined) setSearch(initialSearch); }, [initialSearch]);
  useEffect(() => { setSel(null); setBarSel(null); setSearch(""); }, [off, dur]);
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

  // ── Period data ────────────────────────────────────────────────────────
  const { bars, windowLabel } = useMemo(() => getBarPeriods(dur, off), [dur, off]);
  const activePeriod = useMemo(() => {
    if (barSel) { const b = bars.find(b => b.key === barSel); if (b) return { start: b.start, end: b.end }; }
    return { start: bars[0].start, end: bars[bars.length - 1].end };
  }, [barSel, bars]);

  const windowTxns = useMemo(() => txns.filter(t => t.date >= bars[0].start && t.date <= bars[bars.length-1].end && !internalTxnIds.has(t.id)), [txns, bars, internalTxnIds]);
  const barData = useMemo(() => bars.map(b => ({
    key: b.key, label: b.label,
    spend: windowTxns.filter(t => t.date >= b.start && t.date <= b.end && Number(t.amount) > 0).reduce((s,t) => s+Number(t.amount), 0),
  })), [bars, windowTxns]);
  const maxBar = Math.max(...barData.map(b => b.spend), 1);

  const pTxns    = useMemo(() => windowTxns.filter(t => t.date >= activePeriod.start && t.date <= activePeriod.end), [windowTxns, activePeriod]);
  const expenses = useMemo(() => pTxns.filter(t => Number(t.amount) > 0), [pTxns]);
  const incomeTotal = useMemo(() => Math.abs(pTxns.filter(t=>Number(t.amount)<0).reduce((s,t)=>s+Number(t.amount),0)), [pTxns]);

  const catRows = useMemo(() => {
    const m: Record<string,number> = {};
    for (const t of expenses) { const c = getEffectiveCategory(t)??"Other"; m[c]=(m[c]||0)+Number(t.amount); }
    return Object.entries(m).sort(([,a],[,b]) => b-a);
  }, [expenses, getEffectiveCategory]);

  const totalSpent  = catRows.reduce((s,[,v]) => s+v, 0);
  const totalBudget = Object.values(budgets).reduce((s,v) => s+v, 0);
  const remaining   = totalBudget - totalSpent;
  const isCur       = off === 0 && !barSel;
  const now         = new Date();
  const spentPct    = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
  const pacePct     = (now.getDate() / new Date(now.getFullYear(), now.getMonth()+1, 0).getDate()) * 100;

  const donut = useMemo(() => {
    const top = catRows.slice(0,8).map(([c,v]) => ({cat:c,value:v,color:catColor(c)}));
    const other = catRows.slice(8).reduce((s,[,v]) => s+v, 0);
    if (other > 0) top.push({cat:"Other",value:other,color:"hsl(215 12% 46%)"});
    return top;
  }, [catRows, catColor]);

  const allAcctNames = useMemo(() => [...new Set(txns.map(t => accounts.find(x=>x.account_id===t.account_id)?.name??"Unknown"))], [txns, accounts]);

  // ── Filtered txns ──────────────────────────────────────────────────────
  const visible = useMemo(() => {
    let t = [...expenses];
    if (sel)            t = t.filter(x => (getEffectiveCategory(x)??"Other") === sel);
    if (F.cats.size>0)  t = t.filter(x => F.cats.has(getEffectiveCategory(x)??"Other"));
    if (F.accts.size>0) t = t.filter(x => F.accts.has(accounts.find(a=>a.account_id===x.account_id)?.name??"Unknown"));
    if (F.type==="income")   t = [...pTxns.filter(x=>Number(x.amount)<0)];
    if (F.status==="pending") t = t.filter(x => x.pending);
    if (F.status==="posted")  t = t.filter(x => !x.pending);
    if (F.min) t = t.filter(x => Number(x.amount) >= parseFloat(F.min));
    if (F.max) t = t.filter(x => Number(x.amount) <= parseFloat(F.max));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      t = t.filter(x => (nameOverrides[x.id]??x.merchant_name??x.name??"").toLowerCase().includes(q) || getEffectiveCategory(x).toLowerCase().includes(q));
    }
    return t.sort((a,b) => {
      const [va,vb] = F.sortField==="date" ? [a.date,b.date] : F.sortField==="amount" ? [Number(a.amount),Number(b.amount)] : [(a.merchant_name??a.name??"").toLowerCase(),(b.merchant_name??b.name??"").toLowerCase()];
      const cmp = va<vb?-1:va>vb?1:0;
      return F.sortDir==="desc" ? -cmp : cmp;
    });
  }, [expenses, pTxns, sel, F, accounts, getEffectiveCategory, search, nameOverrides]);

  const groups = useMemo(() => {
    if (F.sortField !== "date") return null;
    const g: Record<string,PTxn[]> = {};
    for (const t of visible) (g[t.date]=g[t.date]||[]).push(t);
    return Object.entries(g).sort(([a],[b]) => b.localeCompare(a));
  }, [visible, F.sortField]);

  // Active filter pills (shown below search bar)
  const activePills = useMemo(() => {
    const pills: { key:string; label:string; clear:()=>void }[] = [];
    if (search.trim())  pills.push({ key:"search",  label:`name: ${search.trim()}`,          clear: () => setSearch("") });
    if (sel)            pills.push({ key:"cat-sel", label:`category: ${formatCat(sel)}`,      clear: () => setSel(null) });
    if (F.cats.size>0)  [...F.cats].forEach(c => pills.push({ key:`cat-${c}`, label:`category: ${formatCat(c)}`, clear: () => setF(f=>({...f,cats:new Set([...f.cats].filter(x=>x!==c))})) }));
    if (F.accts.size>0) [...F.accts].forEach(a => pills.push({ key:`acct-${a}`, label:`account: ${a}`, clear: () => setF(f=>({...f,accts:new Set([...f.accts].filter(x=>x!==a))})) }));
    if (F.type!=="all") pills.push({ key:"type",   label:`type: ${F.type}`,                  clear: () => setF(f=>({...f,type:"all"})) });
    if (F.status!=="all") pills.push({ key:"status", label:`status: ${F.status}`,             clear: () => setF(f=>({...f,status:"all"})) });
    if (F.min)          pills.push({ key:"min",    label:`min: $${F.min}`,                    clear: () => setF(f=>({...f,min:""})) });
    if (F.max)          pills.push({ key:"max",    label:`max: $${F.max}`,                    clear: () => setF(f=>({...f,max:""})) });
    if (barSel)         pills.push({ key:"period", label:`period: ${bars.find(b=>b.key===barSel)?.label ?? barSel}`, clear: () => setBarSel(null) });
    return pills;
  }, [search, sel, F, barSel, bars, formatCat]);

  const clr = () => { setF(EF); setSel(null); setBarSel(null); setSearch(""); };
  const fc  = cntF(F);

  // ── Row ────────────────────────────────────────────────────────────────
  const Row = ({ t, showDate=false }: {t:PTxn; showDate?:boolean}) => {
    const cat = getEffectiveCategory(t) ?? "Other";
    const col = catColor(cat);
    const nm  = nameOverrides[t.id] ?? t.merchant_name ?? t.name ?? "";
    const isIncome = Number(t.amount) < 0;
    return (
      <div onClick={() => onOpenDetail(t)} className="flex items-center gap-3.5 px-5 py-3.5 cursor-pointer hover:bg-muted/20 active:bg-muted/40 transition-colors border-b border-border/15 last:border-0">
        <div className="h-9 w-9 rounded-full shrink-0 grid place-items-center text-[14px] font-bold text-white" style={{background:col}}>
          {(nm[0]??"?").toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[13.5px] font-medium text-foreground truncate">{nm}</span>
            {t.pending && <span className="text-[9px] font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-full shrink-0">PENDING</span>}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[11.5px] font-semibold shrink-0" style={{color:col}}>{formatCat(cat)}</span>
            {showDate && <span className="text-[11px] text-muted-foreground/50">{rDate(t.date)}</span>}
          </div>
        </div>
        <span className={cn("text-[14.5px] font-bold shrink-0 tabular", isIncome ? "text-emerald-400" : "text-foreground")}>
          {isIncome ? "+" : ""}{fmtUSD(Math.abs(Number(t.amount)))}
        </span>
      </div>
    );
  };

  // ── Sidebar content ────────────────────────────────────────────────────
  const SpendingContent = () => (
    <>
      <div className="px-5 pt-4 pb-0">
        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{barSel ? "Selected" : isCur ? "This month" : "Total"}</div>
        <div className="flex items-baseline gap-2 mt-0.5">
          <div className="text-[28px] font-black text-foreground tracking-tight leading-none">{fmtUSD(totalSpent)}</div>
          {incomeTotal > 0 && <div className="text-[12px] text-emerald-400 flex items-center gap-0.5"><TrendingUp className="h-3 w-3"/>+{fc2(incomeTotal)}</div>}
        </div>
        {totalBudget > 0 && dur === "month" && !barSel && (
          <div className="mt-2">
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{width:`${Math.min(spentPct,100)}%`,background:spentPct>100?"hsl(var(--negative))":spentPct>80?"hsl(var(--warning))":"hsl(var(--positive))"}}/>
            </div>
            {isCur && (
              <div className="relative h-2">
                <div className="absolute" style={{left:`${Math.min(pacePct,100)}%`,transform:"translateX(-50%)"}}>
                  <div className="w-px h-2 bg-muted-foreground/40"/>
                </div>
              </div>
            )}
            <div className="flex justify-between text-[10.5px] text-muted-foreground mt-0.5">
              <span>{fmtUSD(totalSpent)} spent</span>
              <span className={cn(remaining<0?"text-destructive":"")}>{remaining>=0 ? `+${fc2(remaining)} left` : `${fc2(Math.abs(remaining))} over`}</span>
            </div>
          </div>
        )}
      </div>
      {donut.length > 0 && (
        <div className="relative px-2 mt-3" style={{height:170}}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{top:0,right:0,bottom:0,left:0}}>
              <Pie data={donut} dataKey="value" cx="50%" cy="50%" innerRadius={56} outerRadius={76} paddingAngle={2} startAngle={90} endAngle={-270} stroke="none" onMouseEnter={(_,i)=>setHov(i)} onMouseLeave={()=>setHov(null)}>
                {donut.map((d,i) => <Cell key={i} fill={d.color} opacity={hov===null||hov===i?1:0.2} strokeWidth={0}/>)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
            {hov!==null&&donut[hov] ? (
              <><div className="text-[11px] font-semibold text-muted-foreground">{formatCat(donut[hov].cat)}</div>
              <div className="text-[18px] font-black text-foreground">{fc2(donut[hov].value)}</div>
              <div className="text-[10px] text-muted-foreground">{Math.round(donut[hov].value/totalSpent*100)}%</div></>
            ) : (
              <><div className="text-[10px] text-muted-foreground">{catRows.length} categories</div>
              <div className="text-[18px] font-black text-foreground">{fc2(totalSpent)}</div></>
            )}
          </div>
        </div>
      )}
      <div className="mt-1 pb-6">
        <button onClick={() => setSel(null)} className={cn("flex items-center gap-2.5 w-full px-5 py-2 text-left transition-colors", !sel?"bg-muted/50":"hover:bg-muted/20")}>
          <div className="w-1 self-stretch rounded-full bg-foreground/15 shrink-0"/>
          <span className="flex-1 text-[12.5px] font-medium text-foreground">All</span>
          <span className="text-[12.5px] font-bold text-foreground">{fmtUSD(totalSpent)}</span>
        </button>
        {catRows.map(([cat,spent]) => {
          const col=catColor(cat), act=sel===cat, b=budgets[cat], over=b&&spent>b, isEd=eCat===cat;
          return (
            <button key={cat} onClick={() => setSel(act?null:cat)}
              className={cn("flex items-center gap-2.5 w-full px-5 py-2 text-left border-t border-border/15 transition-colors",act?"bg-muted/50":"hover:bg-muted/20")}>
              <div className="w-1 self-stretch rounded-full shrink-0" style={{background:col,minHeight:20}}/>
              <span className="flex-1 text-[12.5px] font-medium text-foreground truncate">{formatCat(cat)}</span>
              <div className="text-right shrink-0 ml-1">
                <div className="text-[12.5px] font-bold" style={{color:over?"hsl(var(--negative))":"hsl(var(--foreground))"}}>{fmtUSD(spent)}</div>
                {b && <div className="text-[10px] text-muted-foreground">{fc2(b)}</div>}
                {!b && !isEd && <button onClick={e=>{e.stopPropagation();setECat(cat);setEDraft("");}} className="text-[10px] text-primary/70">+ budget</button>}
                {isEd && (
                  <form onSubmit={e=>{e.preventDefault();e.stopPropagation();const n=parseFloat(eDraft);if(!isNaN(n)&&n>=0)setBudget(cat,n);setECat(null);}} onClick={e=>e.stopPropagation()} className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">$</span>
                    <input autoFocus value={eDraft} onChange={e=>setEDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Escape")setECat(null);}} type="number" min="0" className="w-12 h-5 px-1 rounded bg-muted border border-foreground/30 text-[10px] outline-none"/>
                    <button type="submit" className="text-[10px] text-emerald-500 font-bold">OK</button>
                  </form>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-full bg-background">

      {/* Duration + nav + bar chart */}
      <div className="bg-card border-b border-border/60 px-4 pt-3 pb-0">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex bg-muted/50 rounded-xl p-0.5 gap-0.5">
            {(["day","week","month","year"] as Duration[]).map(d => (
              <button key={d} onClick={() => { setDur(d); setOff(0); }}
                className={cn("px-3 py-1.5 rounded-lg text-[12px] font-semibold capitalize transition-all",
                  dur===d?"bg-card shadow text-foreground":"text-muted-foreground hover:text-foreground")}>
                {d}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setOff(o=>o-1)} className="h-7 w-7 rounded-full border border-border/60 grid place-items-center text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="h-3.5 w-3.5"/>
            </button>
            <button onClick={() => setOff(o=>Math.min(o+1,0))} disabled={off>=0}
              className="h-7 w-7 rounded-full border border-border/60 grid place-items-center text-muted-foreground hover:text-foreground transition-colors disabled:opacity-25">
              <ChevronRight className="h-3.5 w-3.5"/>
            </button>
          </div>
        </div>

        {/* Bar chart */}
        <div className="pb-1">
          <div className={dur==="day" ? "overflow-x-auto scrollbar-none" : ""}>
            <div className={cn("flex items-end gap-1", dur==="day"?"h-20":"h-[52px]")}
              style={dur==="day" ? {minWidth: barData.length*36} : {}}>
              {barData.map(b => {
                const pct = b.spend/maxBar;
                const isSel = barSel===b.key;
                const isCurBar = b.key===bars[bars.length-1].key && off===0;
                const [dayNum,monStr] = b.label.split("/");
                return (
                  <button key={b.key} onClick={() => setBarSel(p=>p===b.key?null:b.key)}
                    className={cn("flex flex-col items-center gap-0.5 group", dur==="day"?"w-8 shrink-0":"flex-1 min-w-0")}>
                    <div className="w-full flex items-end" style={{height: dur==="day"?52:40}}>
                      <div className={cn("w-full rounded-t transition-all duration-200",
                        isSel ? "bg-amber-400 dark:bg-amber-400" :
                        isCurBar ? "bg-primary/60" :
                        b.spend>0 ? "bg-primary/25 group-hover:bg-primary/40" : "bg-border/25")}
                        style={{height: b.spend>0 ? `${Math.max(pct*100,7)}%` : "4px"}}/>
                    </div>
                    {dur==="day" ? (
                      <div className="flex flex-col items-center leading-none gap-px">
                        <span className={cn("text-[10px] font-bold", isSel?"text-amber-500 dark:text-amber-400":"text-muted-foreground/80")}>{dayNum}</span>
                        <span className={cn("text-[8px]", isSel?"text-amber-400/70":"text-muted-foreground/40")}>{monStr}</span>
                      </div>
                    ) : (
                      <span className={cn("text-[9px] truncate w-full text-center",
                        isSel?"text-amber-500 dark:text-amber-400 font-bold":"text-muted-foreground/60 group-hover:text-muted-foreground")}>
                        {b.label}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Compact period label row */}
          <div className="flex items-center justify-between py-1.5">
            <span className="text-[11.5px] font-semibold text-foreground">
              {barSel ? bars.find(b=>b.key===barSel)?.label ?? windowLabel : windowLabel}
              {barSel && <span className="ml-1.5 text-[10px] text-amber-500 dark:text-amber-400 font-medium">selected</span>}
            </span>
            <span className="text-[11.5px] font-bold text-foreground tabular">{fc2(totalSpent)}</span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="md:flex md:items-start flex-1">

        {/* Desktop sidebar */}
        <div className="hidden md:block w-[270px] shrink-0 border-r border-border/30 sticky top-0 self-start bg-card overflow-y-auto" style={{maxHeight:"calc(100vh - 56px)"}}>
          <SpendingContent/>
        </div>

        {/* Transaction list */}
        <div className="flex-1 min-w-0">

          {/* Toolbar */}
          <div className="px-4 md:px-5 pt-2 pb-0 border-b border-border/20 bg-card/95 backdrop-blur-sm sticky top-0 z-20">
            <div className="flex items-center gap-2 pb-2">
              <div className="flex-1 relative min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none"/>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full h-8 pl-8 pr-3 rounded-xl bg-muted/40 border border-border/60 text-[12.5px] text-foreground outline-none focus:border-primary/50"
                />
              </div>
              <span className="text-[11.5px] text-muted-foreground tabular shrink-0 min-w-[24px] text-center">{visible.length}</span>
              {/* Sort: field + direction */}
              <div className="flex items-center gap-1 shrink-0">
                <select value={F.sortField} onChange={e=>setF(f=>({...f,sortField:e.target.value as SortField}))}
                  className="h-8 pl-2 pr-1 rounded-l-xl border border-r-0 border-border/60 bg-muted/40 text-[11.5px] text-foreground outline-none appearance-none">
                  <option value="date">Date</option>
                  <option value="amount">Amount</option>
                  <option value="name">Name</option>
                </select>
                <button onClick={() => setF(f=>({...f,sortDir:f.sortDir==="desc"?"asc":"desc"}))}
                  className="h-8 w-8 rounded-r-xl border border-border/60 bg-muted/40 grid place-items-center text-muted-foreground hover:text-foreground transition-colors">
                  {F.sortDir==="desc" ? <ArrowDown className="h-3.5 w-3.5"/> : <ArrowUp className="h-3.5 w-3.5"/>}
                </button>
              </div>
              <button ref={fBtnRef} onClick={() => setFo(o=>!o)}
                className={cn("flex items-center gap-1 h-8 px-2.5 rounded-xl border text-[12px] font-medium transition-all shrink-0",
                  fo||fc>0 ? "bg-primary text-primary-foreground border-primary" : "border-border/60 text-muted-foreground hover:text-foreground")}>
                <SlidersHorizontal className="h-3.5 w-3.5"/>
                {fc>0 && <span className="text-[11px]">{fc}</span>}
              </button>
            </div>

            {/* Active filter pills */}
            {activePills.length > 0 && (
              <div className="flex items-center gap-1.5 pb-2 overflow-x-auto scrollbar-none">
                {activePills.map(p => (
                  <div key={p.key} className="flex items-center gap-1 h-6 pl-2.5 pr-1 rounded-full bg-primary/10 border border-primary/20 text-[11px] text-primary font-medium shrink-0 whitespace-nowrap">
                    {p.label}
                    <button onClick={p.clear} className="h-4 w-4 rounded-full bg-primary/15 hover:bg-primary/30 grid place-items-center transition-colors ml-0.5">
                      <X className="h-2.5 w-2.5"/>
                    </button>
                  </div>
                ))}
                <button onClick={clr} className="text-[11px] text-muted-foreground hover:text-foreground shrink-0 ml-1">
                  Clear all
                </button>
              </div>
            )}
          </div>

          {/* Mobile summary — compact, no chips */}
          <div className="md:hidden px-4 py-2 border-b border-border/15 flex items-center gap-3 bg-card/60">
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{barSel?"Selected":"Spent"}</p>
              <p className="text-[16px] font-black text-foreground leading-tight">{fmtUSD(totalSpent)}</p>
            </div>
            {totalBudget>0 && dur==="month" && !barSel && (
              <div className="flex-1 min-w-0">
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full" style={{width:`${Math.min(spentPct,100)}%`,background:spentPct>100?"hsl(var(--negative))":spentPct>80?"hsl(var(--warning))":"hsl(var(--positive))"}}/>
                </div>
                <p className={cn("text-[10px] mt-0.5", remaining<0?"text-destructive":"text-muted-foreground")}>
                  {remaining>=0 ? `${fc2(remaining)} left` : `${fc2(Math.abs(remaining))} over`}
                </p>
              </div>
            )}
          </div>

          {/* Filter panel — portal bottom sheet */}
          {fo && createPortal(
            <>
              <div onClick={() => setFo(false)} className="fixed inset-0 bg-black/50 z-[299]"/>
              <div ref={fPanelRef} className="fixed bottom-0 left-0 right-0 sm:left-auto sm:right-4 sm:bottom-4 z-[300] w-full sm:w-72 max-h-[72vh] rounded-t-2xl sm:rounded-2xl border-t sm:border border-border bg-card shadow-2xl overflow-hidden flex flex-col">
                <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
                  <div className="w-9 h-1 rounded-full bg-muted-foreground/30"/>
                </div>
                <div className="px-5 py-3 border-b border-border/30 flex items-center justify-between shrink-0">
                  <span className="text-[14px] font-bold text-foreground">Filters</span>
                  {(hasF(F)||sel) && <button onClick={clr} className="text-[12px] text-muted-foreground hover:text-foreground">Reset</button>}
                </div>
                <div className="p-4 space-y-3 overflow-y-auto flex-1">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Type</label>
                      <select value={F.type} onChange={e=>setF(f=>({...f,type:e.target.value as Fil["type"]}))}
                        className="w-full h-9 px-2.5 rounded-xl bg-muted/40 border border-border/50 text-[12.5px] text-foreground outline-none">
                        <option value="all">All</option>
                        <option value="expense">Expenses</option>
                        <option value="income">Income</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Status</label>
                      <select value={F.status} onChange={e=>setF(f=>({...f,status:e.target.value as Fil["status"]}))}
                        className="w-full h-9 px-2.5 rounded-xl bg-muted/40 border border-border/50 text-[12.5px] text-foreground outline-none">
                        <option value="all">All</option>
                        <option value="posted">Posted</option>
                        <option value="pending">Pending</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Category</label>
                    <select value={F.cats.size===1?[...F.cats][0]:""} onChange={e=>setF(f=>({...f,cats:e.target.value?new Set([e.target.value]):new Set()}))}
                      className="w-full h-9 px-2.5 rounded-xl bg-muted/40 border border-border/50 text-[12.5px] text-foreground outline-none">
                      <option value="">All categories</option>
                      {catRows.map(([cat])=><option key={cat} value={cat}>{formatCat(cat)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Account</label>
                    <select value={F.accts.size===1?[...F.accts][0]:""} onChange={e=>setF(f=>({...f,accts:e.target.value?new Set([e.target.value]):new Set()}))}
                      className="w-full h-9 px-2.5 rounded-xl bg-muted/40 border border-border/50 text-[12.5px] text-foreground outline-none">
                      <option value="">All accounts</option>
                      {allAcctNames.map(a=><option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Amount range</label>
                    <div className="flex gap-2">
                      {(["min","max"] as const).map(k=>(
                        <div key={k} className="flex-1 relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-[12px]">$</span>
                          <input value={F[k]} onChange={e=>setF(f=>({...f,[k]:e.target.value}))} placeholder={k==="min"?"Min":"Max"} type="number" min="0"
                            className="w-full h-9 pl-6 pr-2 rounded-xl bg-muted/30 border border-border/50 text-[12.5px] text-foreground outline-none"/>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="px-4 py-3 border-t border-border/30 shrink-0">
                  <button onClick={() => setFo(false)} className="w-full h-10 rounded-xl bg-foreground text-background text-[13px] font-bold">
                    Show {visible.length} {visible.length===1?"result":"results"}
                  </button>
                </div>
              </div>
            </>,
            document.body
          )}

          {/* Txn list */}
          <div className="bg-card">
            {visible.length===0 ? (
              <div className="py-16 flex flex-col items-center text-center gap-2 px-6">
                <Search className="h-9 w-9 text-muted-foreground/15"/>
                <div className="text-[14px] font-semibold text-foreground mt-1">No transactions</div>
                <div className="text-[12px] text-muted-foreground">Try a different period or clear your filters</div>
                {activePills.length > 0 && (
                  <button onClick={clr} className="mt-2 h-8 px-4 rounded-full border border-border/60 text-[12px] text-muted-foreground hover:text-foreground">
                    Clear all
                  </button>
                )}
              </div>
            ) : groups ? groups.map(([date,txns]) => {
              const dayTotal = txns.reduce((s:number,t:PTxn) => s+Number(t.amount), 0);
              return (
                <div key={date}>
                  <div className="px-5 py-1.5 bg-muted/20 border-b border-border/15 flex items-center justify-between sticky top-[57px] z-10">
                    <span className="text-[12px] font-semibold text-foreground">{rDate(date)}</span>
                    <span className="text-[11.5px] text-muted-foreground tabular">{fmtUSD(dayTotal)}</span>
                  </div>
                  {txns.map((t:PTxn) => <Row key={t.id} t={t}/>)}
                </div>
              );
            }) : visible.map((t:PTxn) => <Row key={t.id} t={t} showDate={true}/>)}
          </div>

        </div>
      </div>
    </div>
  );
}
