import { useState, useMemo, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { fmtUSD } from "@/lib/format";
import { ChevronLeft, ChevronRight, Filter, X, Check, ChevronDown } from "lucide-react";

// ─── Inline types (no external file needed) ───────────────────────────────────
interface PTxn { id:string; account_id:string; item_id:string|null; transaction_id:string|null; amount:number|string; date:string; name:string|null; merchant_name:string|null; category:string[]|null; pending:boolean; [k:string]:any; }
interface PAccount { id:string; account_id:string; name:string|null; official_name:string|null; mask:string|null; type:string|null; subtype:string|null; current_balance:number|null; [k:string]:any; }

export interface SpendingBudgetViewProps {
  txns: PTxn[]; accounts: PAccount[]; budgets: Record<string,number>;
  nameOverrides: Record<string,string>; setBudget:(c:string,n:number)=>void;
  getEffectiveCategory:(t:PTxn)=>string; formatCat:(s:string)=>string;
  catColor:(s:string)=>string; onOpenDetail:(t:PTxn)=>void; internalTxnIds:Set<string>;
}

interface Filters { categories:Set<string>; accounts:Set<string>; type:"all"|"expense"|"income"; pending:"all"|"pending"|"posted"; amountMin:string; amountMax:string; }
const EMPTY:Filters={categories:new Set(),accounts:new Set(),type:"all",pending:"all",amountMin:"",amountMax:""};
const isActive=(f:Filters)=>f.categories.size>0||f.accounts.size>0||f.type!=="all"||f.pending!=="all"||!!f.amountMin||!!f.amountMax;

function relDate(s:string){const d=new Date(s+"T00:00:00"),t=new Date();t.setHours(0,0,0,0);const y=new Date(t);y.setDate(t.getDate()-1);if(+d===+t)return"Today";if(+d===+y)return"Yesterday";return d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});}

function getPeriod(offset:number){const now=new Date();const s=new Date(now.getFullYear(),now.getMonth()+offset,1);const e=new Date(now.getFullYear(),now.getMonth()+offset+1,0);return{start:s.toISOString().slice(0,10),end:e.toISOString().slice(0,10),label:s.toLocaleDateString("en-US",{month:"long",year:"numeric"}),days:e.getDate(),day:offset===0?now.getDate():e.getDate()};}

function fmtc(n:number){const v=Math.abs(n);return v>=1000?`$${(v/1000).toFixed(0)}k`:"$"+v.toFixed(v%1<0.005?0:2).replace(/\B(?=(\d{3})+(?!\d))/g,",");}

export function SpendingBudgetView({txns,accounts,budgets,nameOverrides,setBudget,getEffectiveCategory,formatCat,catColor,onOpenDetail,internalTxnIds}:SpendingBudgetViewProps){
  const [off,setOff]=useState(0);
  const [selCat,setSelCat]=useState<string|null>(null);
  const [sortBy,setSortBy]=useState<"date"|"amount"|"name">("date");
  const [sortDir,setSortDir]=useState<"desc"|"asc">("desc");
  const [filters,setFilters]=useState<Filters>(EMPTY);
  const [filterOpen,setFilterOpen]=useState(false);
  const [editCat,setEditCat]=useState<string|null>(null);
  const [draft,setDraft]=useState("");
  const filterRef=useRef<HTMLDivElement>(null);

  useEffect(()=>{if(!filterOpen)return;const h=(e:MouseEvent)=>{if(filterRef.current&&!filterRef.current.contains(e.target as Node))setFilterOpen(false);};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[filterOpen]);

  const p=getPeriod(off);
  const isCur=off===0;
  const periodTxns=useMemo(()=>txns.filter(t=>t.date>=p.start&&t.date<=p.end&&!internalTxnIds.has(t.id)),[txns,p,internalTxnIds]);
  const expenses=useMemo(()=>periodTxns.filter(t=>Number(t.amount)>0),[periodTxns]);

  const catTotals=useMemo(()=>{const m:Record<string,number>={};for(const t of expenses){const c=getEffectiveCategory(t)??"Other";m[c]=(m[c]||0)+Number(t.amount);}return Object.entries(m).sort(([,a],[,b])=>b-a);},[expenses,getEffectiveCategory]);

  const totalSpent=catTotals.reduce((s,[,v])=>s+v,0);
  const totalBudget=Object.values(budgets).reduce((s,v)=>s+v,0);
  const remaining=totalBudget-totalSpent;
  const pacePct=(p.day/p.days)*100;
  const spentPct=totalBudget>0?(totalSpent/totalBudget)*100:0;
  const maxVal=Math.max(totalBudget,totalSpent,1);

  const acctNames=useMemo(()=>[...new Set(txns.map(t=>{const a=accounts.find(x=>x.account_id===t.account_id);return a?.name??"Unknown";}))],[txns,accounts]);

  const visible=useMemo(()=>{
    let t=[...expenses];
    if(selCat)t=t.filter(x=>(getEffectiveCategory(x)??"Other")===selCat);
    if(filters.categories.size>0)t=t.filter(x=>filters.categories.has(getEffectiveCategory(x)??"Other"));
    if(filters.accounts.size>0)t=t.filter(x=>{const a=accounts.find(acc=>acc.account_id===x.account_id);return filters.accounts.has(a?.name??"Unknown");});
    if(filters.pending==="pending")t=t.filter(x=>x.pending);
    if(filters.pending==="posted")t=t.filter(x=>!x.pending);
    if(filters.amountMin)t=t.filter(x=>Number(x.amount)>=parseFloat(filters.amountMin));
    if(filters.amountMax)t=t.filter(x=>Number(x.amount)<=parseFloat(filters.amountMax));
    return t.sort((a,b)=>{
      const[va,vb]=sortBy==="date"?[a.date,b.date]:sortBy==="amount"?[Number(a.amount),Number(b.amount)]:[(a.merchant_name??a.name??"").toLowerCase(),(b.merchant_name??b.name??"").toLowerCase()];
      const c=va<vb?-1:va>vb?1:0;return sortDir==="desc"?-c:c;
    });
  },[expenses,selCat,filters,sortBy,sortDir,accounts,getEffectiveCategory]);

  const groups=useMemo(()=>{if(sortBy!=="date")return null;const g:Record<string,PTxn[]>={};for(const t of visible)(g[t.date]=g[t.date]||[]).push(t);return Object.entries(g).sort(([a],[b])=>b.localeCompare(a));},[visible,sortBy]);

  const handleSort=(col:"date"|"amount"|"name")=>{if(sortBy===col)setSortDir(d=>d==="desc"?"asc":"desc");else{setSortBy(col);setSortDir("desc");}};
  const toggle=(key:"categories"|"accounts",val:string)=>setFilters(f=>{const s=new Set(f[key]);s.has(val)?s.delete(val):s.add(val);return{...f,[key]:s};});
  const clearAll=()=>{setFilters(EMPTY);setSelCat(null);};
  const activeCount=(filters.categories.size+filters.accounts.size)+(filters.type!=="all"?1:0)+(filters.pending!=="all"?1:0)+(filters.amountMin||filters.amountMax?1:0);
  const barBg=spentPct>100?"bg-negative":spentPct>80?"bg-warning":"bg-positive";

  const SA=({col}:{col:string})=>sortBy!==col?<span className="text-[9px] text-muted-foreground/40 ml-0.5">↕</span>:<span className="text-[10px] text-[hsl(var(--primary))] ml-0.5">{sortDir==="desc"?"↓":"↑"}</span>;

  const Row=({t,showDate=false}:{t:PTxn;showDate?:boolean})=>{
    const acc=accounts.find(a=>a.account_id===t.account_id);
    const cat=getEffectiveCategory(t)??"Other";
    const col=catColor(cat);
    const nm=nameOverrides[t.id]??t.merchant_name??t.name??"";
    return(
      <button onClick={()=>onOpenDetail(t)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/25 transition-colors border-b border-border/15 last:border-0">
        <div className="h-9 w-9 rounded-xl shrink-0 grid place-items-center text-base font-semibold" style={{background:`${col}18`,border:`1px solid ${col}22`,color:col}}>{(cat[0]||"?").toUpperCase()}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[13.5px] font-medium text-foreground truncate">{nm}</span>
            {t.pending&&<span className="text-[9.5px] font-bold text-warning bg-warning/10 px-1.5 py-0.5 rounded-full shrink-0">Pending</span>}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10.5px] font-medium text-white px-1.5 py-0 rounded-full shrink-0" style={{background:col}}>{formatCat(cat)}</span>
            <span className="text-[11px] text-muted-foreground truncate">{acc?.name}</span>
            {showDate&&<><span className="text-muted-foreground/30 text-[10px]">·</span><span className="text-[11px] text-muted-foreground shrink-0">{relDate(t.date)}</span></>}
          </div>
        </div>
        <span className="text-[14px] font-bold text-foreground shrink-0">{fmtUSD(Number(t.amount))}</span>
      </button>
    );
  };

  return(
<div className="flex flex-col h-full">
  {/* PERIOD NAV */}
  <div className="shrink-0 surface-card px-4 py-2.5 border-b border-border/30 flex items-center gap-3 flex-wrap">
    <div className="flex items-center gap-1 shrink-0">
      <button onClick={()=>setOff(o=>o-1)} className="h-7 w-7 rounded-lg border border-border/60 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"><ChevronLeft className="h-3.5 w-3.5"/></button>
      <div className="text-center min-w-[128px] px-1">
        <div className="text-[14px] font-bold text-foreground">{p.label}</div>
        {!isCur&&<div className="text-[10px] text-muted-foreground">Past month</div>}
      </div>
      <button onClick={()=>setOff(o=>Math.min(o+1,0))} disabled={off>=0} className="h-7 w-7 rounded-lg border border-border/60 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-20"><ChevronRight className="h-3.5 w-3.5"/></button>
    </div>
    <div className="hidden sm:flex items-center gap-5">
      {([["Spent",fmtUSD(totalSpent),"text-foreground"],["Budget",fmtUSD(totalBudget),"text-muted-foreground"],["Left",fmtUSD(Math.abs(remaining)),remaining>=0?"text-positive":"text-negative"]]as const).map(([l,v,c])=>(
        <div key={l}><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{l}</div><div className={`text-[15px] font-bold ${c}`}>{v}</div></div>
      ))}
    </div>
    <div className="hidden sm:block flex-1">
      <div className="relative h-1.5 rounded-full bg-border/30 overflow-hidden">
        <div className={cn("h-full rounded-full transition-all",barBg)} style={{width:`${Math.min(spentPct,100)}%`}}/>
        {isCur&&<div className="absolute top-0 bottom-0 w-px bg-foreground/20" style={{left:`${pacePct}%`}}/>}
      </div>
      <div className="flex justify-between mt-1"><span className="text-[10px] text-muted-foreground">{Math.round(spentPct)}% used</span>{isCur&&<span className="text-[10px] text-muted-foreground">Day {p.day}/{p.days}</span>}</div>
    </div>
  </div>

  {/* MOBILE CATEGORY CHIPS */}
  <div className="lg:hidden border-b border-border/20 bg-background overflow-x-auto scrollbar-none shrink-0">
    <div className="flex gap-1.5 px-3 py-2.5 whitespace-nowrap">
      <button onClick={()=>setSelCat(null)} className={cn("h-7 px-3 rounded-full text-[11.5px] font-medium border shrink-0 transition-all",!selCat?"bg-foreground text-background border-foreground":"border-border/50 text-muted-foreground")}>All · {fmtc(totalSpent)}</button>
      {catTotals.map(([cat,spent])=>{const col=catColor(cat);const over=budgets[cat]&&spent>budgets[cat];const act=selCat===cat;return(
        <button key={cat} onClick={()=>setSelCat(act?null:cat)} className="h-7 px-3 rounded-full text-[11.5px] font-medium border shrink-0 flex items-center gap-1 transition-all" style={{background:act?col:"transparent",color:act?"white":"hsl(var(--muted-foreground))",borderColor:act?col:"hsl(var(--border)/0.5)"}}>
          {over&&<span className="w-1.5 h-1.5 rounded-full bg-negative inline-block"/>}{formatCat(cat)} {fmtc(spent)}
        </button>
      );})}
    </div>
  </div>

  {/* THREE PANEL */}
  <div className="flex-1 min-h-0 grid lg:grid-cols-[220px_1fr_168px] overflow-hidden">

    {/* LEFT: Category list (desktop) */}
    <div className="hidden lg:flex flex-col border-r border-border/30 overflow-y-auto bg-background/50">
      <div className="px-4 pt-3 pb-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Categories</div>
      <button onClick={()=>setSelCat(null)} className={cn("flex items-center gap-2.5 w-full px-4 py-2.5 text-left border-l-2 transition-all",!selCat?"bg-muted/40 border-foreground":"border-transparent hover:bg-muted/20")}>
        <div className="w-2 h-2 rounded-full bg-[hsl(var(--primary))] shrink-0"/><span className="flex-1 text-[13px] font-medium">All spending</span><span className="text-[12px] font-bold">{fmtc(totalSpent)}</span>
      </button>
      {catTotals.map(([cat,spent])=>{
        const col=catColor(cat);const budget=budgets[cat];const over=budget&&spent>budget;const pct=budget?Math.min(spent/budget*100,100):null;const act=selCat===cat;const ed=editCat===cat;
        return(
          <div key={cat} className={cn("border-l-2 transition-all",act?"bg-muted/40":"hover:bg-muted/20 border-transparent")} style={{borderLeftColor:act?col:"transparent"}}>
            <button onClick={()=>setSelCat(act?null:cat)} className="flex items-start gap-2.5 w-full px-4 py-2.5 text-left">
              <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{background:col}}/>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1"><span className="text-[12.5px] font-medium text-foreground flex-1 truncate">{formatCat(cat)}</span>{over&&<span className="text-[9px] font-bold text-negative">OVER</span>}<span className="text-[12px] font-bold" style={{color:over?"hsl(var(--negative))":"hsl(var(--foreground))"}}>{fmtc(spent)}</span></div>
                {pct!==null&&<div className="h-1 rounded-full bg-border/30 mt-1.5 overflow-hidden"><div className="h-full rounded-full" style={{width:`${pct}%`,background:over?"hsl(var(--negative))":pct>80?"hsl(var(--warning))":col}}/></div>}
                {budget?<div className="text-[10px] text-muted-foreground mt-0.5">{fmtc(budget)} budget · {Math.round(pct!==null?pct:0)}%</div>:
                  <button onClick={e=>{e.stopPropagation();setEditCat(cat);setDraft("");}} className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground mt-0.5">+ set budget</button>}
              </div>
            </button>
            {budget&&(ed?(
              <form className="flex items-center gap-1.5 px-4 pb-2" onSubmit={e=>{e.preventDefault();const n=parseFloat(draft);if(!isNaN(n)&&n>=0)setBudget(cat,n);setEditCat(null);}}>
                <span className="text-[11px] text-muted-foreground">$</span>
                <input autoFocus value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Escape")setEditCat(null);}} type="number" min="0" placeholder={String(budget)} className="flex-1 h-6 px-1.5 rounded bg-muted/50 border border-foreground/30 text-[11px] outline-none text-foreground"/>
                <button type="submit" className="text-[11px] text-positive font-bold">✓</button>
                <button type="button" onClick={()=>setEditCat(null)} className="text-[11px] text-muted-foreground">✕</button>
              </form>
            ):(
              <button onClick={()=>{setEditCat(cat);setDraft(String(budget));}} className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground px-4 pb-2 block transition-colors">✎ edit budget</button>
            ))}
          </div>
        );
      })}
    </div>

    {/* CENTER: Transactions */}
    <div className="flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-border/20 bg-background flex items-center gap-2 shrink-0 flex-wrap">
        {selCat&&<div className="flex items-center gap-1 h-7 px-2.5 rounded-full border border-border/50 bg-muted/30 text-[12px] font-medium shrink-0">{formatCat(selCat)}<button onClick={()=>setSelCat(null)} className="ml-1 text-muted-foreground hover:text-foreground"><X className="h-3 w-3"/></button></div>}
        <div className="flex bg-muted/40 rounded-full p-0.5">
          {(["date","amount","name"]as const).map(k=><button key={k} onClick={()=>handleSort(k)} className={cn("px-2.5 py-1 rounded-full text-[11px] font-medium transition-all capitalize",sortBy===k?"bg-background shadow-sm text-foreground":"text-muted-foreground")}>{k}<SA col={k}/></button>)}
        </div>
        <div className="relative ml-auto" ref={filterRef}>
          <button onClick={()=>setFilterOpen(o=>!o)} className={cn("flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[11.5px] font-medium transition-all",activeCount>0||filterOpen?"bg-foreground text-background border-foreground":"border-border/50 text-muted-foreground hover:text-foreground")}>
            <Filter className="h-3 w-3"/>Filters{activeCount>0&&<span className="h-4 w-4 rounded-full bg-background text-foreground text-[9px] font-bold grid place-items-center">{activeCount}</span>}<ChevronDown className={cn("h-3 w-3 transition-transform",filterOpen&&"rotate-180")}/>
          </button>
          {filterOpen&&(
            <div className="absolute right-0 top-[calc(100%+6px)] z-[200] w-72 rounded-2xl border border-border bg-popover shadow-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border/20 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-foreground">Filter transactions</span>
                {isActive(filters)&&<button onClick={clearAll} className="text-[11px] text-muted-foreground hover:text-foreground">Clear all</button>}
              </div>
              <div className="p-4 space-y-4 max-h-[65vh] overflow-y-auto">
                {/* Type */}
                <div><div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Type</div>
                  <div className="flex gap-1.5">{(["all","expense","income"]as const).map(v=><button key={v} onClick={()=>setFilters(f=>({...f,type:v}))} className={cn("flex-1 h-7 rounded-full text-[11.5px] font-medium border transition-all",filters.type===v?"bg-foreground text-background border-foreground":"border-border/50 text-muted-foreground")}>{v==="all"?"All":v==="expense"?"Expenses":"Income"}</button>)}</div>
                </div>
                {/* Status */}
                <div><div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Status</div>
                  <div className="flex gap-1.5">{(["all","posted","pending"]as const).map(v=><button key={v} onClick={()=>setFilters(f=>({...f,pending:v}))} className={cn("flex-1 h-7 rounded-full text-[11.5px] font-medium border capitalize transition-all",filters.pending===v?"bg-foreground text-background border-foreground":"border-border/50 text-muted-foreground")}>{v}</button>)}</div>
                </div>
                {/* Categories */}
                <div><div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Category</div>
                  <div className="flex flex-wrap gap-1.5">{catTotals.map(([cat])=>{const a=filters.categories.has(cat);return(<button key={cat} onClick={()=>toggle("categories",cat)} className={cn("h-7 px-2.5 rounded-full text-[11px] font-medium border transition-all flex items-center gap-1",a?"bg-foreground text-background border-foreground":"border-border/50 text-muted-foreground")}>{a&&<Check className="h-2.5 w-2.5"/>}{formatCat(cat)}</button>);})}</div>
                </div>
                {/* Accounts */}
                <div><div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Account</div>
                  <div className="flex flex-wrap gap-1.5">{acctNames.map(acc=>{const a=filters.accounts.has(acc);return(<button key={acc} onClick={()=>toggle("accounts",acc)} className={cn("h-7 px-2.5 rounded-full text-[11px] font-medium border transition-all flex items-center gap-1",a?"bg-foreground text-background border-foreground":"border-border/50 text-muted-foreground")}>{a&&<Check className="h-2.5 w-2.5"/>}{acc}</button>);})}</div>
                </div>
                {/* Amount */}
                <div><div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Amount range</div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 relative"><span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-[12px]">$</span><input value={filters.amountMin} onChange={e=>setFilters(f=>({...f,amountMin:e.target.value}))} placeholder="Min" type="number" min="0" className="w-full h-8 pl-5 pr-2 rounded-lg bg-muted/30 border border-border/50 text-[12px] text-foreground outline-none focus:border-foreground/40"/></div>
                    <span className="text-muted-foreground text-[12px] shrink-0">–</span>
                    <div className="flex-1 relative"><span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-[12px]">$</span><input value={filters.amountMax} onChange={e=>setFilters(f=>({...f,amountMax:e.target.value}))} placeholder="Max" type="number" min="0" className="w-full h-8 pl-5 pr-2 rounded-lg bg-muted/30 border border-border/50 text-[12px] text-foreground outline-none focus:border-foreground/40"/></div>
                  </div>
                </div>
              </div>
              <div className="p-3 border-t border-border/20">
                <button onClick={()=>setFilterOpen(false)} className="w-full h-9 rounded-xl bg-foreground text-background text-[13px] font-semibold">Show {visible.length} results</button>
              </div>
            </div>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0">{visible.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {visible.length===0?<div className="p-12 text-center text-[13px] text-muted-foreground">No transactions match</div>
        :groups?groups.map(([date,txns])=>(
          <div key={date}>
            <div className="sticky top-0 z-10 px-4 py-1.5 bg-muted/70 backdrop-blur-sm border-b border-border/15 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{relDate(date)}</span>
              <span className="text-[11px] text-muted-foreground">{fmtUSD(txns.reduce((s,t)=>s+Number(t.amount),0))}</span>
            </div>
            {txns.map(t=><Row key={t.id} t={t}/>)}
          </div>
        )):visible.map(t=><Row key={t.id} t={t} showDate/>)}
      </div>
    </div>

    {/* RIGHT: Budget bar (desktop) */}
    <div className="hidden lg:flex flex-col border-l border-border/30 overflow-y-auto">
      <div className="px-3 pt-3 pb-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Budget vs Actual</div>
      {/* Bars */}
      <div className="px-3 pb-2 flex gap-2 items-end" style={{height:200}}>
        {([["Spent",catTotals,1,totalSpent],["Budget",catTotals.filter(([c])=>budgets[c]),0.38,totalBudget]]as[string,[string,number][],number,number][]).map(([label,cats,opacity,total])=>(
          <div key={label} className="flex-1 flex flex-col h-full">
            <div className="text-[9px] text-muted-foreground text-center mb-1">{label}</div>
            <div className="flex-1 flex flex-col justify-end rounded-t overflow-hidden border border-border/20">
              {cats.map(([cat,spent])=>{const col=catColor(cat);const h=(opacity===1?spent:(budgets[cat]||0))/maxVal*100;return(<button key={cat} onClick={()=>setSelCat(selCat===cat?null:cat)} title={`${formatCat(cat)}: ${fmtUSD(opacity===1?spent:budgets[cat]||0)}`} style={{height:`${h}%`,background:col,minHeight:2,borderTop:"1px solid rgba(255,255,255,0.08)",opacity:selCat&&selCat!==cat?0.2:opacity,transition:"opacity 0.15s"}}/>);})}
            </div>
            <div className="text-[10px] font-bold text-center mt-1 text-foreground">{fmtc(total)}</div>
          </div>
        ))}
      </div>
      {/* Legend */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/10">
        {catTotals.map(([cat,spent])=>{
          const col=catColor(cat);const budget=budgets[cat];const over=budget&&spent>budget;const pct=budget?Math.min(spent/budget*100,100):null;const act=selCat===cat;const ed=editCat===cat;
          return(
            <div key={cat} className={cn("px-3 py-2.5 cursor-pointer",act&&"bg-muted/40")} onClick={()=>setSelCat(act?null:cat)}>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full shrink-0" style={{background:col}}/>
                <span className="text-[11.5px] font-medium text-foreground flex-1 truncate">{formatCat(cat)}</span>
                {over&&<span className="text-[9px] font-bold text-negative">OVER</span>}
                <span className="text-[11.5px] font-semibold" style={{color:over?"hsl(var(--negative))":"hsl(var(--foreground))"}}>{fmtc(spent)}</span>
              </div>
              {pct!==null&&<div className="mt-1 ml-4"><div className="h-1.5 rounded-full bg-border/30 overflow-hidden"><div className="h-full rounded-full transition-all" style={{width:`${pct}%`,background:over?"hsl(var(--negative))":pct>80?"hsl(var(--warning))":col}}/></div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-[10px] text-muted-foreground">{Math.round(pct)}%</span>
                  {ed?(
                    <form className="flex items-center gap-1" onClick={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();const n=parseFloat(draft);if(!isNaN(n)&&n>=0)setBudget(cat,n);setEditCat(null);}}>
                      <span className="text-[9px] text-muted-foreground">$</span>
                      <input autoFocus value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Escape")setEditCat(null);}} type="number" min="0" className="w-12 h-5 px-1 rounded bg-muted border border-foreground/30 text-[10px] outline-none text-foreground"/>
                      <button type="submit" className="text-[10px] text-positive font-bold">✓</button>
                    </form>
                  ):(
                    <button onClick={e=>{e.stopPropagation();setEditCat(cat);setDraft(String(budget));}} className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors">{fmtc(budget)} ✎</button>
                  )}
                </div>
              </div>}
              {pct===null&&<button onClick={e=>{e.stopPropagation();setEditCat(cat);setDraft("");}} className="mt-0.5 ml-4 text-[10px] text-muted-foreground/40 hover:text-muted-foreground block">+ set budget</button>}
            </div>
          );
        })}
      </div>
    </div>

  </div>
</div>
  );
}
