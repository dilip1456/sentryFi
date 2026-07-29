/**
 * BudgetView — Auto-detected zero-based budget overview
 * Sections auto-detected from last 12 months of transactions.
 * Tap any item to see all historical txns behind the detection.
 */

import { useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { fmtUSD } from "@/lib/format";
import {
  TrendingUp, Lock, Zap, PiggyBank, ShoppingBag,
  ChevronDown, AlertTriangle, CheckCircle2,
  ArrowRight, Sparkles, Info, X, Calendar, Trash2
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PTxn {
  id: string; amount: number | string; date: string;
  name: string | null; merchant_name: string | null;
  category?: string[] | null; account_id: string; pending?: boolean;
  [k: string]: unknown;
}
interface PAccount {
  id: string; account_id: string; name: string | null;
  type: string | null; subtype: string | null; current_balance: number | null;
}
interface DetectedItem {
  merchant: string;
  avgAmount: number;     // this month's total
  count: number;         // occurrences in current month
  variance: number;      // % variance across history
  lastDate: string;
  monthsFound: number;   // how many distinct months appeared in 12mo history
  historicalTxns: PTxn[]; // all txns in 12mo window that belong to this merchant
}
interface Props { txns: PTxn[]; accounts: PAccount[]; month: string; }

// ─── Keywords ────────────────────────────────────────────────────────────────

const UTILITY_KW   = ["electric","energy","power","gas","water","sewer","utility","utilities","internet","wifi","broadband","cable","comcast","xfinity","att","verizon","tmobile","sprint","t-mobile","phone","wireless","cox","spectrum","directv","hulu live","youtube tv","sling","trash","waste","pest"];
const SAVINGS_KW   = ["transfer","savings","invest","brokerage","fidelity","vanguard","schwab","robinhood","betterment","wealthfront","ally","marcus","sofi","acorns","stash","contribution","deposit to"];
const SUBSCRIPT_KW = ["netflix","spotify","apple","amazon prime","hulu","disney","hbo","paramount","peacock","youtube premium","adobe","microsoft","google","dropbox","zoom","slack","github","chatgpt","openai","anthropic","duolingo","calm","headspace","nytimes","wsj","medium","audible","kindle"];
const LOAN_KW      = ["mortgage","loan","auto pay","car payment","student","sallie mae","navient","lendingtree","sba","chase mortgage","wells fargo home","bank of america"];
const INTEREST_KW  = ["interest","dividend","yield","apy","savings reward"];

const matchKw = (merchant: string, kws: string[]) => { const m = merchant.toLowerCase(); return kws.some(k => m.includes(k)); };

// ─── Detection ───────────────────────────────────────────────────────────────

const SUPPRESS_KEY = "budget_suppressed_v1";

function getSuppressed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SUPPRESS_KEY) ?? "[]")); } catch { return new Set(); }
}
function addSuppressed(merchant: string) {
  const s = getSuppressed(); s.add(merchant.toLowerCase().trim());
  localStorage.setItem(SUPPRESS_KEY, JSON.stringify([...s]));
}

function detectSections(txns: PTxn[], accounts: PAccount[], month: string, suppressed: Set<string>) {
  // 12 months back from start of selected month
  const monthDate     = new Date(month + "-01");
  const twelveAgo     = new Date(monthDate); twelveAgo.setMonth(twelveAgo.getMonth() - 12);
  const currentMonth  = txns.filter(t => t.date?.startsWith(month) && !t.pending);
  const history12     = txns.filter(t => { const d = new Date(t.date + "T00:00:00"); return d >= twelveAgo && !t.pending; });

  // ── INCOME: credits (negative Plaid amount) recurring in ≥2 months ──────
  const incHistMap = new Map<string, { txns: PTxn[]; months: Set<string> }>();
  for (const t of history12) {
    const amt = Number(t.amount);
    if (amt >= 0 || Math.abs(amt) < 20) continue;
    const key = (t.merchant_name || t.name || "Deposit").trim();
    if (!incHistMap.has(key)) incHistMap.set(key, { txns: [], months: new Set() });
    incHistMap.get(key)!.txns.push(t);
    incHistMap.get(key)!.months.add(t.date.slice(0, 7));
  }

  const incomeItems: DetectedItem[] = [];
  for (const t of currentMonth) {
    const amt = Number(t.amount);
    if (amt >= 0 || Math.abs(amt) < 20) continue;
    const key = (t.merchant_name || t.name || "Deposit").trim();
    const hist = incHistMap.get(key);
    const monthsFound = hist?.months.size ?? 1;
    const recurring = monthsFound >= 2 || matchKw(key, INTEREST_KW);
    if (!recurring) continue; // skip one-offs entirely
    if (suppressed.has(key.toLowerCase().trim())) continue; // user dismissed

    const existing = incomeItems.find(i => i.merchant === key);
    if (existing) { existing.avgAmount += Math.abs(amt); existing.count++; }
    else incomeItems.push({
      merchant: key, avgAmount: Math.abs(amt), count: 1,
      variance: 0, lastDate: t.date, monthsFound,
      historicalTxns: hist?.txns ?? [t],
    });
  }

  // ── EXPENSES: group current-month debits, classify with 12mo history ─────
  const expHistMap = new Map<string, { txns: PTxn[]; months: Set<string> }>();
  for (const t of history12) {
    const amt = Number(t.amount);
    if (amt <= 0) continue;
    const key = (t.merchant_name || t.name || "Unknown").trim();
    if (!key || key === "Unknown") continue;
    if (!expHistMap.has(key)) expHistMap.set(key, { txns: [], months: new Set() });
    expHistMap.get(key)!.txns.push(t);
    expHistMap.get(key)!.months.add(t.date.slice(0, 7));
  }

  const curExpMap = new Map<string, { total: number; count: number; lastDate: string }>();
  for (const t of currentMonth) {
    const amt = Number(t.amount);
    if (amt <= 0) continue;
    const key = (t.merchant_name || t.name || "Unknown").trim();
    if (!key || key === "Unknown") continue;
    const e = curExpMap.get(key) ?? { total: 0, count: 0, lastDate: t.date };
    e.total += amt; e.count++; e.lastDate = t.date;
    curExpMap.set(key, e);
  }

  const obligations: DetectedItem[] = [];
  const errands:     DetectedItem[] = [];
  const savings:     DetectedItem[] = [];
  const expenses:    DetectedItem[] = [];

  for (const [merchant, { total, count, lastDate }] of curExpMap) {
    if (suppressed.has(merchant.toLowerCase().trim())) continue; // user dismissed
    const hist = expHistMap.get(merchant);
    const histAmts = hist?.txns.map(t => Number(t.amount)) ?? [total];
    const avg = histAmts.reduce((s, v) => s + v, 0) / histAmts.length;
    const variance = histAmts.length > 1 ? (Math.max(...histAmts) - Math.min(...histAmts)) / avg * 100 : 50;
    const monthsFound = hist?.months.size ?? 1;
    const account = accounts.find(a => a.account_id === hist?.txns[0]?.account_id);

    const item: DetectedItem = {
      merchant, avgAmount: total, count, variance, lastDate,
      monthsFound, historicalTxns: hist?.txns ?? [],
    };

    if (matchKw(merchant, SAVINGS_KW) || account?.subtype === "savings" || account?.subtype === "money market") {
      savings.push(item);
    } else if (matchKw(merchant, LOAN_KW) || (matchKw(merchant, SUBSCRIPT_KW) && total > 5)) {
      obligations.push(item);
    } else if (matchKw(merchant, UTILITY_KW) || monthsFound >= 2) {
      errands.push(item);
    } else {
      expenses.push(item);
    }
  }

  const byAmt = (a: DetectedItem, b: DetectedItem) => b.avgAmount - a.avgAmount;
  return {
    income:      incomeItems .sort(byAmt),
    obligations: obligations .sort(byAmt),
    errands:     errands     .sort(byAmt),
    savings:     savings     .sort(byAmt),
    expenses:    expenses    .sort(byAmt),
  };
}

// ─── TxnHistorySheet ─────────────────────────────────────────────────────────

function TxnHistorySheet({ item, onClose }: { item: DetectedItem; onClose: () => void }) {
  const sorted = [...item.historicalTxns].sort((a, b) => b.date.localeCompare(a.date));
  const isIncome = sorted[0] && Number(sorted[0].amount) < 0;

  return (
    <div className="fixed inset-0 z-[400] flex flex-col justify-end" onClick={onClose}>
      <div className="fixed inset-0 bg-black/60" />
      <div
        className="relative z-10 bg-card rounded-t-2xl max-h-[75vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-9 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border/40 shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold text-foreground truncate">{item.merchant}</p>
            <p className="text-[12px] text-muted-foreground">
              {sorted.length} transaction{sorted.length !== 1 ? "s" : ""} · {item.monthsFound} month{item.monthsFound !== 1 ? "s" : ""} · avg {fmtUSD(item.avgAmount / item.count)}
            </p>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-full bg-muted/60 grid place-items-center shrink-0">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Transaction list */}
        <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-border/20">
          {sorted.map(t => {
            const amt = Math.abs(Number(t.amount));
            const dateStr = new Date(t.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            return (
              <div key={t.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="h-8 w-8 rounded-full bg-muted/60 grid place-items-center shrink-0">
                  <Calendar className="h-4 w-4 text-muted-foreground/60" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] text-foreground font-medium">{dateStr}</p>
                  <p className="text-[11.5px] text-muted-foreground">{t.name || t.merchant_name}</p>
                </div>
                <p className={cn("text-[14px] font-semibold tabular shrink-0", isIncome ? "text-emerald-400" : "text-foreground")}>
                  {isIncome ? "+" : ""}{fmtUSD(amt)}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── SectionCard ─────────────────────────────────────────────────────────────

function SectionCard({ icon: Icon, label, sublabel, color, bg, accent, items, total, onDismiss }: {
  icon: React.ElementType; label: string; sublabel: string;
  color: string; bg: string; accent: string;
  items: DetectedItem[]; total: number;
  onDismiss: (merchant: string) => void;
}) {
  const [open, setOpen]         = useState(false);
  const [drill, setDrill]       = useState<DetectedItem | null>(null);

  return (
    <>
      <div className="rounded-2xl border border-border/60 overflow-hidden bg-card/60">
        {/* Section header */}
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-muted/20 transition-colors text-left"
        >
          <div className={cn("h-8 w-8 rounded-xl flex items-center justify-center shrink-0", bg)}>
            <Icon className={cn("h-4 w-4", color)} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-foreground">{label}</p>
            <p className="text-[11px] text-muted-foreground">{sublabel}</p>
          </div>
          <div className="text-right shrink-0">
            <p className={cn("text-[15px] font-bold tabular", accent)}>{fmtUSD(total)}</p>
            <p className="text-[10px] text-muted-foreground">{items.length} item{items.length !== 1 ? "s" : ""}</p>
          </div>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground/60 shrink-0 transition-transform ml-1", open && "rotate-180")} />
        </button>

        {/* Items */}
        {open && (
          <div className="divide-y divide-border/20 border-t border-border/40">
            {items.length === 0 ? (
              <p className="px-4 py-5 text-center text-[12px] text-muted-foreground/60">None detected this month</p>
            ) : items.map((item, i) => (
              <div key={i} className="flex items-center">
                <button
                  onClick={() => setDrill(item)}
                  className="flex-1 flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors text-left min-w-0"
                >
                  <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0", bg, color)}>
                    {item.merchant.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-foreground truncate font-medium">{item.merchant}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {item.monthsFound} of last 12 months
                      {item.variance < 10 ? " · fixed" : item.variance < 30 ? " · ~fixed" : " · varies"}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={cn("text-[13px] font-semibold tabular", accent)}>{fmtUSD(item.avgAmount)}</p>
                    {item.historicalTxns.length > 0 && (
                      <p className="text-[10px] text-muted-foreground/60">{item.historicalTxns.length} txns ›</p>
                    )}
                  </div>
                </button>
                <button
                  onClick={() => onDismiss(item.merchant)}
                  title="Remove from budget"
                  className="h-10 w-10 flex items-center justify-center text-muted-foreground/30 hover:text-negative transition-colors shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* History sheet */}
      {drill && <TxnHistorySheet item={drill} onClose={() => setDrill(null)} />}
    </>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function BudgetView({ txns, accounts, month }: Props) {
  const monthLabel = useMemo(() => new Date(month + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" }), [month]);
  const [suppressed, setSuppressed] = useState<Set<string>>(() => getSuppressed());

  const dismiss = useCallback((merchant: string) => {
    addSuppressed(merchant);
    setSuppressed(getSuppressed());
  }, []);

  const detected   = useMemo(() => detectSections(txns, accounts, month, suppressed), [txns, accounts, month, suppressed]);

  const totalIncome      = detected.income     .reduce((s, i) => s + i.avgAmount, 0);
  const totalObligations = detected.obligations.reduce((s, i) => s + i.avgAmount, 0);
  const totalErrands     = detected.errands    .reduce((s, i) => s + i.avgAmount, 0);
  const totalSavings     = detected.savings    .reduce((s, i) => s + i.avgAmount, 0);
  const totalExpenses    = detected.expenses   .reduce((s, i) => s + i.avgAmount, 0);
  const totalOut         = totalObligations + totalErrands + totalSavings + totalExpenses;
  const free             = totalIncome - totalOut;
  const isOver           = free < 0;

  const SECTIONS = [
    { key:"income",      label:"Income",             sublabel:"Recurring deposits & payroll — tap to see history", icon:TrendingUp, color:"text-emerald-400", bg:"bg-emerald-500/12", accent:"text-emerald-400", items:detected.income,      total:totalIncome      },
    { key:"obligations", label:"Monthly Obligations", sublabel:"Loans, mortgage, fixed subscriptions",             icon:Lock,       color:"text-blue-400",   bg:"bg-blue-500/12",   accent:"text-foreground",  items:detected.obligations, total:totalObligations },
    { key:"errands",     label:"Monthly Errands",     sublabel:"Utilities, bills, recurring services",             icon:Zap,        color:"text-amber-400",  bg:"bg-amber-500/12",  accent:"text-foreground",  items:detected.errands,     total:totalErrands     },
    { key:"savings",     label:"Saving Pools",        sublabel:"Transfers to savings & investments",               icon:PiggyBank,  color:"text-violet-400", bg:"bg-violet-500/12", accent:"text-violet-400",  items:detected.savings,     total:totalSavings     },
    { key:"expenses",    label:"Expenses",            sublabel:"Other discretionary spending",                     icon:ShoppingBag,color:"text-rose-400",   bg:"bg-rose-500/12",   accent:"text-foreground",  items:detected.expenses,    total:totalExpenses    },
  ];

  return (
    <div className="flex flex-col min-h-full">

      {/* Header */}
      <div className="px-4 md:px-8 pt-5 pb-3 border-b border-border/40">
        <div className="flex items-baseline justify-between">
          <div>
            <h2 className="text-[17px] font-bold text-foreground">Budget</h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">{monthLabel}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-[11px] text-muted-foreground">12-month detection</span>
          </div>
        </div>

        {totalIncome > 0 && (
          <div className="mt-4">
            <div className="h-3 rounded-full bg-muted overflow-hidden flex gap-px">
              {[
                { val: totalObligations, cls: "bg-blue-500"    },
                { val: totalErrands,     cls: "bg-amber-500"   },
                { val: totalSavings,     cls: "bg-violet-500"  },
                { val: totalExpenses,    cls: "bg-rose-500/80" },
              ].map((seg, i) => {
                const pct = Math.min((seg.val / totalIncome) * 100, 100);
                if (pct < 0.5) return null;
                return <div key={i} style={{ width: `${pct}%` }} className={cn("h-full", seg.cls)} />;
              })}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
              {[
                { label:"Obligations", color:"bg-blue-500",   val:totalObligations },
                { label:"Errands",     color:"bg-amber-500",  val:totalErrands     },
                { label:"Savings",     color:"bg-violet-500", val:totalSavings     },
                { label:"Expenses",    color:"bg-rose-500",   val:totalExpenses    },
              ].filter(s => s.val > 0).map(s => (
                <div key={s.label} className="flex items-center gap-1">
                  <div className={cn("h-1.5 w-1.5 rounded-full", s.color)} />
                  <span className="text-[10px] text-muted-foreground">{s.label} {fmtUSD(s.val)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 divide-x divide-border/40 border-b border-border/40 bg-muted/20 shrink-0">
        {[
          { label:"Income",    val:totalIncome, cls:"text-emerald-400" },
          { label:"Committed", val:totalOut,    cls:"text-foreground"  },
          { label:isOver?"Over":"Free", val:Math.abs(free), cls:isOver?"text-destructive":"text-emerald-400" },
        ].map(({ label, val, cls }) => (
          <div key={label} className="px-4 py-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
            <p className={cn("text-[15px] font-bold", cls)}>{fmtUSD(val)}</p>
          </div>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 px-4 md:px-8 py-4 space-y-3 overflow-y-auto">

        {isOver && (
          <div className="rounded-2xl bg-destructive/10 border border-destructive/25 p-4">
            <div className="flex items-start gap-2.5 mb-3">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] font-semibold text-foreground">{fmtUSD(Math.abs(free))} over income this month</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Ways to cover:</p>
              </div>
            </div>
            <div className="space-y-2">
              {totalSavings > 0 && (
                <div className="flex items-center gap-3 p-2.5 rounded-xl bg-card/60 border border-border/40">
                  <PiggyBank className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium">Reduce savings contribution</p>
                    <p className="text-[11px] text-muted-foreground">Currently {fmtUSD(totalSavings)} going to savings</p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </div>
              )}
              {detected.expenses[0] && (
                <div className="flex items-center gap-3 p-2.5 rounded-xl bg-card/60 border border-border/40">
                  <ShoppingBag className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium">Cut {detected.expenses[0].merchant}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtUSD(detected.expenses[0].avgAmount)} this month</p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </div>
              )}
            </div>
          </div>
        )}

        {SECTIONS.map(s => <SectionCard key={s.key} {...s} onDismiss={dismiss} />)}

        {!isOver && free > 0 && (
          <div className="rounded-2xl bg-emerald-500/8 border border-emerald-500/20 p-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
            <div>
              <p className="text-[13px] font-semibold text-foreground">{fmtUSD(free)} unallocated</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Consider adding to savings or paying down debt</p>
            </div>
          </div>
        )}

        <div className="flex items-start gap-2 px-1 pb-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />
          <p className="text-[11px] text-muted-foreground/50">
            Auto-detected from 12 months of transactions. Only recurring income is counted. Tap any row to see the full transaction history behind it.
          </p>
        </div>
      </div>
    </div>
  );
}
