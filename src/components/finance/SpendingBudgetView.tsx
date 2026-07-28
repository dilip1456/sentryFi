import { useState, useMemo, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { fmtUSD } from "@/lib/format";
import { ChevronLeft, ChevronRight, Filter, X, Check, ChevronDown, Plus, Pencil } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

interface PTxn { id:string; account_id:string; item_id:string|null; transaction_id:string|null; amount:number|string; date:string; name:string|null; merchant_name:string|null; category:string[]|null; pending:boolean; [k:string]:any; }
interface PAccount { id:string; account_id:string; name:string|null; official_name:string|null; mask:string|null; type:string|null; subtype:string|null; current_balance:number|null; [k:string]:any; }

export interface SpendingBudgetViewProps {
  txns:PTxn[]; accounts:PAccount[]; budgets:Record<string,number>;
  nameOverrides:Record<string,string>; setBudget:(c:string,n:number)=>void;
  getEffectiveCategory:(t:PTxn)=>string; formatCat:(s:string)=>string;
  catColor:(s:string)=>string; onOpenDetail:(t:PTxn)=>void; internalTxnIds:Set<string>;
}

interface Fil { cats:Set<string>; accts:Set<string>; type:"all"|"expense"|"income"; status:"all"|"posted"|"pending"; min:string; max:string; }
const EF:Fil={cats:new Set(),accts:new Set(),type:"all",status:"all",min:"",max:""};
const hasF=(f:Fil)=>f.cats.size>0||f.accts.size>0||f.type!=="all"||f.status!=="all"||!!f.min||!!f.max;
const cntF=(f:Fil)=>f.cats.size+f.accts.size+(f.type!=="all"?1:0)+(f.status!=="all"?1:0)+(f.min||f.max?1:0);

function rDate(s:string){const d=new Date(s+"T00:00:00"),t=new Date();t.setHours(0,0,0,0);const y=new Date(t);y.setDate(t.getDate()-1);if(+d===+t)return"Today";if(+d===+y)return"Yesterday";return d.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});}
function getPer(off:number){const n=new Date();const s=new Date(n.getFullYear(),n.getMonth()+off,1);const e=new Date(n.getFullYear(),n.getMonth()+off+1,0);return{start:s.toISOString().slice(0,10),end:e.toISOString().slice(0,10),label:s.toLocaleDateString("en-US",{month:"long",year:"numeric"}),days:e.getDate(),day:off===0?n.getDate():e.getDate()};}
function fs(n:number){const v=Math.abs(n);if(v>=1000)return"$"+(v/1000).toFixed(0)+"k";return"$"+v.toFixed(v%1<0.005?0:2).replace(/\B(?=(\d{3})+(?!\d))/g,",");}

export function SpendingBudgetView({txns,accounts,budgets,nameOverrides,setBudget,getEffectiveCategory,formatCat,catColor,onOpenDetail,internalTxnIds}:SpendingBudgetViewProps){
  const [off,setOff]=useState(0);
  const [tab,setTab]=useState<"spending"|"budgets">("spending");
  const [sel,setSel]=useState<string|null>(null);
  const [hov,setHov]=useState<number|null>(null);
  const [sort,setSort]=useState<"date"|"amount"|"name">("date");
  const [sortD,setSortD]=useState<"desc"|"asc">("desc");
  const [F,setF]=useState<Fil>(EF);
  const [fo,setFo]=useState(false);
  const [eCat,setECat]=useState<string|null>(null);
  const [eDraft,setEDraft]=useState("");
  const fRef=useRef<HTMLDivElement>(null);

  useEffect(()=>{if(!fo)return;const h=(e:MouseEvent)=>{if(fRef.current&&!fRef.current.contains(e.target as Node))setFo(false);};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[fo]);

  const per=getPer(off);
  const isCur=off===0;
  const pTxns=useMemo(()=>txns.filter(t=>t.date>=per.start&&t.date<=per.end&&!internalTxnIds.has(t.id)),[txns,per,internalTxnIds]);
  const exp=useMemo(()=>pTxns.filter(t=>Number(t.amount)>0),[pTxns]);
  const cats=useMemo(()=>{const m:Record<string,number>={};for(const t of exp){const c=getEffectiveCategory(t)??"Other";m[c]=(m[c]||0)+Number(t.amount);}return Object.entries(m).sort(([,a],[,b])=>b-a);},[exp,getEffectiveCategory]);
  const tot=cats.reduce((s,[,v])=>s+v,0);
  const totB=Object.values(budgets).reduce((s,v)=>s+v,0);
  const rem=totB-tot;
  const donut=cats.slice(0,8).map(([c,v])=>({cat:c,value:v,color:catColor(c)}));
  if(cats.slice(8).length>0)donut.push({cat:"Other",value:cats.slice(8).reduce((s,[,v])=>s+v,0),color:"hsl(215 12% 46%)"});
  const acctNms=useMemo(()=>[...new Set(txns.map(t=>{const a=accounts.find(x=>x.account_id===t.account_id);return a?.name??"Unknown";}))],[txns,accounts]);

  const vis=useMemo(()=>{
    let t=[...exp];
    if(sel)t=t.filter(x=>(getEffectiveCategory(x)??"Other")===sel);
    if(F.cats.size>0)t=t.filter(x=>F.cats.has(getEffectiveCategory(x)??"Other"));
    if(F.accts.size>0)t=t.filter(x=>{const a=accounts.find(acc=>acc.account_id===x.account_id);return F.accts.has(a?.name??"Unknown");});
    if(F.status==="pending")t=t.filter(x=>x.pending);
    if(F.status==="posted")t=t.filter(x=>!x.pending);
    if(F.min)t=t.filter(x=>Number(x.amount)>=parseFloat(F.min));
    if(F.max)t=t.filter(x=>Number(x.amount)<=parseFloat(F.max));
    return t.sort((a,b)=>{const[va,vb]=sort==="date"?[a.date,b.date]:sort==="amount"?[Number(a.amount),Number(b.amount)]:[(a.merchant_name??a.name??"").toLowerCase(),(b.merchant_name??b.name??"").toLowerCase()];const c=va<vb?-1:va>vb?1:0;return sortD==="desc"?-c:c;});
  },[exp,sel,F,sort,sortD,accounts,getEffectiveCategory]);

  const grps=useMemo(()=>{if(sort!=="date")return null;const g:Record<string,PTxn[]>={};for(const t of vis)(g[t.date]=g[t.date]||[]).push(t);return Object.entries(g).sort(([a],[b])=>b.localeCompare(a));},[vis,sort]);
  const hs=(col:"date"|"amount"|"name")=>{if(sort===col)setSortD(d=>d==="desc"?"asc":"desc");else{setSort(col);setSortD("desc");}};
  const tog=(k:"cats"|"accts",v:string)=>setF(f=>{const s=new Set(f[k]);s.has(v)?s.delete(v):s.add(v);return{...f,[k]:s};});
  const clr=()=>{setF(EF);setSel(null);};
  const fc=cntF(F);

  const Row=({t,sd=false}:{t:PTxn;sd?:boolean})=>{
    const acc=accounts.find(a=>a.account_id===t.account_id);
    const cat=getEffectiveCategory(t)??"Other";
    const col=catColor(cat);
    const nm=nameOverrides[t.id]??t.merchant_name??t.name??"";
    return(
      <div onClick={()=>onOpenDetail(t)} className="flex items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-muted/30 transition-colors border-b border-border/30 last:border-0">
        <div className="h-10 w-10 rounded-full shrink-0 grid place-items-center text-[15px] font-bold text-white" style={{background:col}}>{(nm[0]??"?").toUpperCase()}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium text-foreground truncate">{nm}</span>
            {t.pending&&<span className="text-[10px] font-bold text-warning bg-warning/10 px-1.5 py-0.5 rounded-full shrink-0">Pending</span>}
          </div>
          <div className="text-[12px] text-muted-foreground mt-0.5 flex items-center gap-1.5 min-w-0">
            <span className="font-semibold shrink-0" style={{color:col}}>{formatCat(cat)}</span>
            {acc?.name&&<><span className="opacity-30">·</span><span className="truncate">{acc.name}</span></>}
            {sd&&<><span className="opacity-30">·</span><span className="shrink-0">{rDate(t.date)}</span></>}
          </div>
        </div>
        <span className="text-[15px] font-bold text-foreground shrink-0">{fmtUSD(Number(t.amount))}</span>
      </div>
    );
  };

  return(
    <div className="-mx-4 md:-mx-8 -mt-6">

      {/* ═══ TOP BAR ══════════════════════════════════════════════════════ */}
      <div className="bg-card border-b border-border px-4 md:px-8 py-3 flex items-center gap-4">
        <div className="flex bg-muted/50 rounded-xl p-1 text-[13px] font-semibold shrink-0">
          {(["spending","budgets"]as const).map(t=>(
            <button key={t} onClick={()=>setTab(t)} className={cn("px-5 py-1.5 rounded-lg transition-all capitalize",tab===t?"bg-card shadow text-foreground":"text-muted-foreground")}>
              {t.charAt(0).toUpperCase()+t.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 mx-auto">
          <button onClick={()=>setOff(o=>o-1)} className="h-8 w-8 rounded-full border border-border/60 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"><ChevronLeft className="h-4 w-4"/></button>
          <span className="text-[16px] font-bold text-foreground min-w-[160px] text-center">{per.label}</span>
          <button onClick={()=>setOff(o=>Math.min(o+1,0))} disabled={off>=0} className="h-8 w-8 rounded-full border border-border/60 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-20"><ChevronRight className="h-4 w-4"/></button>
        </div>
        <div className="relative shrink-0" ref={fRef}>
          <button onClick={()=>setFo(o=>!o)} className={cn("flex items-center gap-2 h-8 px-4 rounded-full border text-[13px] font-medium transition-all opacity-0 pointer-events-none",fo||fc>0?"bg-foreground text-background border-foreground":"border-border/60 text-muted-foreground")}/>
        </div>
      </div>

      {/* ═══ MOBILE: category chips ════════════════════════════════════════ */}
      <div className="md:hidden bg-card border-b border-border/30 overflow-x-auto scrollbar-none">
        <div className="flex gap-2 px-4 py-3 whitespace-nowrap">
          <button onClick={()=>setSel(null)} className={cn("h-7 px-3 rounded-full text-[12px] font-semibold border shrink-0 transition-all",!sel?"bg-foreground text-background border-foreground":"border-border/60 text-muted-foreground")}>All</button>
          {cats.map(([cat,sp])=>{const col=catColor(cat);const act=sel===cat;return(<button key={cat} onClick={()=>setSel(act?null:cat)} className="h-7 px-3 rounded-full text-[12px] font-semibold border shrink-0 flex items-center gap-1.5 transition-all" style={{background:act?col:"transparent",color:act?"white":"hsl(var(--muted-foreground))",borderColor:act?col:undefined}}><div className="w-1.5 h-1.5 rounded-full shrink-0" style={{background:act?"rgba(255,255,255,0.7)":col}}/>{formatCat(cat)} {fs(sp)}</button>);})}
        </div>
      </div>

      {/* ═══ BODY: sidebar + transactions ═════════════════════════════════ */}
      <div className="md:flex md:items-start md:gap-0">

        {/* LEFT SIDEBAR — sticky on desktop */}
        <div className="hidden md:block w-[290px] shrink-0 border-r border-border/30 sticky top-0 self-start" style={{maxHeight:"calc(100vh - 120px)",overflowY:"auto"}}>
          {tab==="spending"?(
            <>
              <div className="px-6 pt-6 pb-0">
                <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">{isCur?"Spent this month":"Total spent"}</div>
                <div className="text-[34px] font-black text-foreground tracking-tight leading-none mb-5">{fmtUSD(tot)}</div>
              </div>
              {/* Donut */}
              <div className="relative px-2" style={{height:200}}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart margin={{top:0,right:0,bottom:0,left:0}}>
                    <Pie data={donut} dataKey="value" cx="50%" cy="50%" innerRadius={64} outerRadius={86} paddingAngle={2} startAngle={90} endAngle={-270} onMouseEnter={(_,i)=>setHov(i)} onMouseLeave={()=>setHov(null)} stroke="none">
                      {donut.map((d,i)=><Cell key={i} fill={d.color} opacity={hov===null||hov===i?1:0.25} strokeWidth={0}/>)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
                  {hov!==null&&donut[hov]?(
                    <><div className="text-[11px] font-semibold text-muted-foreground">{formatCat(donut[hov].cat)}</div><div className="text-[22px] font-black text-foreground">{fs(donut[hov].value)}</div><div className="text-[11px] text-muted-foreground">{Math.round(donut[hov].value/tot*100)}%</div></>
                  ):(
                    <><div className="text-[11px] text-muted-foreground">{cats.length} categories</div><div className="text-[20px] font-black text-foreground">{fs(tot)}</div></>
                  )}
                </div>
              </div>
              {/* Category list */}
              <div className="mt-2 pb-6">
                <button onClick={()=>setSel(null)} className={cn("flex items-center gap-3 w-full px-6 py-3 text-left transition-colors",!sel?"bg-muted/40":"hover:bg-muted/20")}>
                  <div className="w-1 self-stretch rounded-full bg-foreground/15 shrink-0"/>
                  <span className="flex-1 text-[13.5px] font-medium text-foreground">All categories</span>
                  <span className="text-[13.5px] font-bold text-foreground">{fmtUSD(tot)}</span>
                </button>
                {cats.map(([cat,sp])=>{
                  const col=catColor(cat);const act=sel===cat;const pct=Math.round(sp/tot*100);
                  return(
                    <button key={cat} onClick={()=>setSel(act?null:cat)} className={cn("flex items-center gap-3 w-full px-6 py-3 text-left border-t border-border/20 transition-colors",act?"bg-muted/40":"hover:bg-muted/20")}>
                      <div className="w-1 self-stretch rounded-full shrink-0" style={{background:col,minHeight:28}}/>
                      <span className="flex-1 text-[13.5px] font-medium text-foreground truncate">{formatCat(cat)}</span>
                      <div className="text-right shrink-0 ml-2">
                        <div className="text-[13.5px] font-bold text-foreground">{fmtUSD(sp)}</div>
                        <div className="text-[11px] text-muted-foreground">{pct}%</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          ):(
            /* BUDGETS sidebar */
            <>
              <div className="px-6 pt-6 pb-4">
                <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Budget overview</div>
                <div className="text-[34px] font-black leading-none tracking-tight" style={{color:rem>=0?"hsl(var(--positive))":"hsl(var(--negative))"}}>{rem>=0?"+":"-"}{fs(Math.abs(rem))}</div>
                <div className="text-[12px] text-muted-foreground mt-1">{rem>=0?"under budget this month":"over budget this month"}</div>
                <div className="mt-4 h-2.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{width:`${Math.min(tot/Math.max(totB,1)*100,100)}%`,background:tot>totB?"hsl(var(--negative))":tot/totB>0.8?"hsl(var(--warning))":"hsl(var(--positive))"}}/>
                </div>
                <div className="flex justify-between mt-1.5 text-[11px] text-muted-foreground">
                  <span>{fmtUSD(tot)} spent</span><span>{fmtUSD(totB)} budgeted</span>
                </div>
              </div>
              <div className="divide-y divide-border/30 pb-6">
                {cats.map(([cat,sp])=>{
                  const col=catColor(cat);const b=budgets[cat];const over=b&&sp>b;const pct=b?Math.min(sp/b*100,100):0;const isE=eCat===cat;
                  return(
                    <div key={cat} className="px-6 py-4">
                      <div className="flex items-center gap-3 mb-2.5">
                        <div className="w-1 shrink-0 rounded-full" style={{background:col,height:32}}/>
                        <span className="flex-1 text-[13.5px] font-medium text-foreground truncate">{formatCat(cat)}</span>
                        {over&&<span className="text-[10px] font-black text-negative bg-negative/10 px-1.5 py-0.5 rounded-full shrink-0">OVER</span>}
                        <div className="text-right shrink-0">
                          <div className="text-[13.5px] font-bold" style={{color:over?"hsl(var(--negative))":"hsl(var(--foreground))"}}>{fmtUSD(sp)}</div>
                          {isE?(
                            <form className="flex items-center gap-1 justify-end" onSubmit={e=>{e.preventDefault();const n=parseFloat(eDraft);if(!isNaN(n)&&n>=0)setBudget(cat,n);setECat(null);}}>
                              <span className="text-[10px] text-muted-foreground">$</span>
                              <input autoFocus value={eDraft} onChange={e=>setEDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Escape")setECat(null);}} type="number" min="0" className="w-16 h-5 px-1 rounded bg-muted border border-foreground/30 text-[11px] outline-none text-foreground"/>
                              <button type="submit" className="text-[11px] text-positive font-bold">✓</button>
                            </form>
                          ):(
                            <button onClick={()=>{setECat(cat);setEDraft(String(b||""));}} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5 justify-end">
                              {b?`of ${fmtUSD(b)}`:"+ set budget"}<Pencil className="h-2.5 w-2.5 ml-0.5 opacity-40"/>
                            </button>
                          )}
                        </div>
                      </div>
                      {b&&<div className="ml-4"><div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full transition-all" style={{width:`${pct}%`,background:over?"hsl(var(--negative))":pct>80?"hsl(var(--warning))":col}}/></div><div className="flex justify-between mt-1 text-[11px] text-muted-foreground"><span>{Math.round(pct)}%</span><span style={{color:over?"hsl(var(--negative))":"inherit"}}>{over?`${fmtUSD(sp-b)} over`:`${fmtUSD(b-sp)} left`}</span></div></div>}
                      {!b&&<button onClick={()=>{setECat(cat);setEDraft("");}} className="ml-4 text-[11px] text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1"><Plus className="h-3 w-3"/>Set budget</button>}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* RIGHT: Transactions */}
        <div className="flex-1 min-w-0">
          {/* Txn toolbar — single Sort & Filter dropdown */}
          <div className="px-4 md:px-6 py-2.5 border-b border-border/30 bg-card flex items-center gap-2 sticky top-0 z-20 backdrop-blur-sm">
            {/* Active filter chips — scrollable */}
            <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto scrollbar-none">
              {sel&&<div className="flex items-center gap-1 h-6 px-2.5 rounded-full border border-border/60 bg-muted/40 text-[11px] font-medium text-foreground shrink-0"><div className="w-1.5 h-1.5 rounded-full" style={{background:catColor(sel)}}/><span className="mx-1">{formatCat(sel)}</span><button onClick={()=>setSel(null)} className="text-muted-foreground hover:text-foreground"><X className="h-2.5 w-2.5"/></button></div>}
              {[...F.cats].map(cat=><div key={cat} className="flex items-center gap-1 h-6 px-2.5 rounded-full bg-muted/40 border border-border/50 text-[11px] text-foreground shrink-0"><div className="w-1.5 h-1.5 rounded-full" style={{background:catColor(cat)}}/><span className="mx-1">{formatCat(cat)}</span><button onClick={()=>tog("cats",cat)} className="text-muted-foreground hover:text-foreground"><X className="h-2.5 w-2.5"/></button></div>)}
              {[...F.accts].map(acc=><div key={acc} className="flex items-center gap-1 h-6 px-2.5 rounded-full bg-muted/40 border border-border/50 text-[11px] text-foreground shrink-0"><span>{acc}</span><button onClick={()=>tog("accts",acc)} className="ml-1 text-muted-foreground hover:text-foreground"><X className="h-2.5 w-2.5"/></button></div>)}
              {F.type!=="all"&&<div className="flex items-center gap-1 h-6 px-2.5 rounded-full bg-muted/40 border border-border/50 text-[11px] text-foreground shrink-0 capitalize"><span>{F.type}</span><button onClick={()=>setF(f=>({...f,type:"all"}))} className="ml-1 text-muted-foreground hover:text-foreground"><X className="h-2.5 w-2.5"/></button></div>}
              {F.status!=="all"&&<div className="flex items-center gap-1 h-6 px-2.5 rounded-full bg-muted/40 border border-border/50 text-[11px] text-foreground shrink-0 capitalize"><span>{F.status}</span><button onClick={()=>setF(f=>({...f,status:"all"}))} className="ml-1 text-muted-foreground hover:text-foreground"><X className="h-2.5 w-2.5"/></button></div>}
              {(hasF(F)||sel)&&<button onClick={clr} className="text-[11px] text-muted-foreground hover:text-foreground shrink-0 ml-1 underline underline-offset-2">Clear</button>}
            </div>

            <div className="flex items-center gap-3 shrink-0 ml-2">
              <span className="text-[12px] text-muted-foreground hidden sm:block">{vis.length} txns</span>
              {/* Single Sort & Filter dropdown */}
              <div className="relative" ref={fRef}>
                <button onClick={()=>setFo(o=>!o)} className={cn("flex items-center gap-1.5 h-8 px-3.5 rounded-full border text-[13px] font-medium transition-all",fo||fc>0||sort!=="date"||sortD!=="desc"?"bg-foreground text-background border-foreground":"border-border/60 text-muted-foreground hover:text-foreground")}>
                  <Filter className="h-3.5 w-3.5 shrink-0"/>
                  <span className="hidden sm:inline">{sort!=="date"?<span className="capitalize">{sort}{sortD==="desc"?" ↓":" ↑"}</span>:"Sort & Filter"}</span>
                  {fc>0&&<span className="h-4 min-w-[16px] px-1 rounded-full text-[9px] font-bold grid place-items-center" style={{background:"hsl(var(--primary))",color:"hsl(var(--primary-foreground))"}}>{fc}</span>}
                  <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform",fo&&"rotate-180")}/>
                </button>

                {fo&&(<>
                  <div onClick={()=>setFo(false)} className="sm:hidden fixed inset-0 bg-black/40 z-[299]"/>
                  <div className="fixed sm:absolute bottom-0 sm:bottom-auto left-0 sm:left-auto right-0 sm:right-0 top-auto sm:top-[calc(100%+6px)] z-[300] sm:w-72 rounded-t-2xl sm:rounded-2xl border border-border bg-popover shadow-2xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
                      <span className="text-[14px] font-bold text-foreground">Sort & Filter</span>
                      {(hasF(F)||sel||sort!=="date"||sortD!=="desc")&&<button onClick={()=>{clr();setSort("date");setSortD("desc");}} className="text-[12px] text-muted-foreground hover:text-foreground font-medium">Reset all</button>}
                    </div>
                    <div className="p-3 sm:p-4 space-y-3 sm:space-y-4 max-h-[60vh] overflow-y-auto">

                      {/* Sort */}
                      <div>
                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Sort by</div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {([["date","Date: newest","desc"],["date","Date: oldest","asc"],["amount","Largest amount","desc"],["amount","Smallest amount","asc"],["name","Name: A → Z","asc"],["name","Name: Z → A","desc"]]as[typeof sort,string,typeof sortD][]).map(([col,label,dir])=>{
                            const act=sort===col&&sortD===dir;
                            return(<button key={col+dir} onClick={()=>{setSort(col);setSortD(dir);}} className={cn("h-7 px-2.5 rounded-lg text-[11.5px] font-medium border text-left flex items-center justify-between gap-1 transition-all",act?"bg-foreground text-background border-foreground":"border-border/50 text-foreground/70 hover:text-foreground hover:border-foreground/30")}><span>{label}</span>{act&&<Check className="h-3 w-3 shrink-0"/>}</button>);
                          })}
                        </div>
                      </div>

                      {/* Type */}
                      <div>
                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Type</div>
                        <div className="flex gap-1.5">
                          {(["all","expense","income"]as const).map(v=><button key={v} onClick={()=>setF(f=>({...f,type:v}))} className={cn("flex-1 h-7 rounded-lg text-[12px] font-medium border transition-all",F.type===v?"bg-foreground text-background border-foreground":"border-border/50 text-foreground/70 hover:text-foreground hover:border-foreground/30")}>{v==="all"?"All":v==="expense"?"Expenses":"Income"}</button>)}
                        </div>
                      </div>

                      {/* Status */}
                      <div>
                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Status</div>
                        <div className="flex gap-1.5">
                          {(["all","posted","pending"]as const).map(v=><button key={v} onClick={()=>setF(f=>({...f,status:v}))} className={cn("flex-1 h-8 rounded-lg text-[12.5px] font-medium border capitalize transition-all",F.status===v?"bg-foreground text-background border-foreground":"border-border/50 text-foreground/70 hover:text-foreground hover:border-foreground/30")}>{v}</button>)}
                        </div>
                      </div>

                      {/* Category */}
                      <div>
                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Category</div>
                        <div className="flex flex-wrap gap-1.5">
                          {cats.map(([cat])=>{const a=F.cats.has(cat);return(<button key={cat} onClick={()=>tog("cats",cat)} className={cn("h-6.5 px-2 rounded-lg text-[11px] font-medium border flex items-center gap-1 transition-all",a?"bg-foreground text-background border-foreground":"border-border/50 text-foreground/70 hover:text-foreground hover:border-foreground/30")}>{a?<Check className="h-3 w-3 shrink-0"/>:<div className="w-2 h-2 rounded-full shrink-0" style={{background:catColor(cat)}}/>}{formatCat(cat)}</button>);})}
                        </div>
                      </div>

                      {/* Account */}
                      <div>
                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Account</div>
                        <div className="flex flex-wrap gap-1.5">
                          {acctNms.map(acc=>{const a=F.accts.has(acc);return(<button key={acc} onClick={()=>tog("accts",acc)} className={cn("h-6.5 px-2 rounded-lg text-[11px] font-medium border flex items-center gap-1 transition-all",a?"bg-foreground text-background border-foreground":"border-border/50 text-foreground/70 hover:text-foreground hover:border-foreground/30")}>{a&&<Check className="h-3 w-3 shrink-0"/>}{acc}</button>);})}
                        </div>
                      </div>

                      {/* Amount */}
                      <div>
                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Amount</div>
                        <div className="flex items-center gap-2">
                          {(["min","max"]as const).map(k=><div key={k} className="flex-1 relative"><span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-[12px]">$</span><input value={F[k]} onChange={e=>setF(f=>({...f,[k]:e.target.value}))} placeholder={k==="min"?"Min":"Max"} type="number" min="0" className="w-full h-8 pl-6 pr-2 rounded-lg bg-muted/30 border border-border/50 text-[12.5px] text-foreground outline-none focus:border-foreground/40"/></div>)}
                        </div>
                      </div>
                    </div>
                    <div className="px-3 py-2.5 border-t border-border/30">
                      <button onClick={()=>setFo(false)} className="w-full h-8 rounded-xl bg-foreground text-background text-[13px] font-bold">Show {vis.length} results</button>
                    </div>
                  </div>
                </>
                )}
              </div>
            </div>
          </div>

          {/* Transactions */}
          <div className="bg-card">
            {vis.length===0?(
              <div className="py-20 flex flex-col items-center text-center gap-3">
                <div className="text-[44px]">🔍</div>
                <div className="text-[15px] font-semibold text-foreground">No transactions found</div>
                <div className="text-[13px] text-muted-foreground">Try adjusting your filters</div>
                {(hasF(F)||sel)&&<button onClick={clr} className="mt-2 h-8 px-4 rounded-full border border-border/60 text-[13px] text-muted-foreground hover:text-foreground">Clear filters</button>}
              </div>
            ):grps?grps.map(([date,txns])=>(
              <div key={date}>
                <div className="px-5 py-3 bg-muted/40 border-b border-border/30 border-t border-t-border/20 flex items-center justify-between">
                  <span className="text-[13px] font-bold text-foreground">{rDate(date)}</span>
                  <span className="text-[12px] font-semibold text-muted-foreground">{fmtUSD(txns.reduce((s,t)=>s+Number(t.amount),0))}</span>
                </div>
                {txns.map(t=><Row key={t.id} t={t}/>)}
              </div>
            )):vis.map(t=><Row key={t.id} t={t} sd/>)}
          </div>
        </div>
      </div>
    </div>
  );
}
