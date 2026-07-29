/**
 * BudgetView — Auto-detected zero-based budget overview
 *
 * Sections (all auto-detected from last 3 months of transactions):
 *   Income         — salary, freelance, deposits
 *   Obligations    — fixed monthly: mortgage, car, loan, subscriptions
 *   Errands        — variable monthly: utilities, bills, services
 *   Saving Pools   — transfers to savings / investment accounts
 *   Expenses       — remaining discretionary spending
 *
 * Summary: income − (obligations + errands + savings + expenses) = free/over
 * + "How to cover" for excess expenses
 */

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { fmtUSD } from "@/lib/format";
import {
  TrendingUp, Lock, Zap, PiggyBank, ShoppingBag,
  ChevronDown, ChevronRight, AlertTriangle, CheckCircle2,
  Shuffle, Target, ArrowRight, Sparkles, Info
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface PTxn {
  id: string;
  amount: number | string;
  date: string;
  name: string | null;
  merchant_name: string | null;
  category?: string[] | null;
  account_id: string;
  pending?: boolean;
  [k: string]: unknown;
}

interface PAccount {
  id: string;
  account_id: string;
  name: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | null;
}

interface DetectedItem {
  merchant: string;
  avgAmount: number;
  count: number;        // times appeared in last 3mo
  variance: number;     // % variance (0 = perfectly fixed)
  lastDate: string;
  accountId?: string;
  isVerified?: boolean; // user explicitly confirmed
  isRecurring?: boolean; // appeared in ≥2 of last 3 months
  isOneOff?: boolean;    // only appeared once — not counted in budget
}

interface Section {
  key: string;
  label: string;
  sublabel: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  items: DetectedItem[];
  total: number;
}

interface Props {
  txns: PTxn[];
  accounts: PAccount[];
  month: string; // "YYYY-MM"
}

// ─── Auto-detection logic ────────────────────────────────────────────────────

const UTILITY_KEYWORDS = [
  "electric","energy","power","gas","water","sewer","utility","utilities",
  "internet","wifi","broadband","cable","comcast","xfinity","att","verizon",
  "tmobile","sprint","t-mobile","phone","wireless","cox","spectrum","directv",
  "hulu live","youtube tv","sling","trash","waste","pest"
];

const SAVINGS_KEYWORDS = [
  "transfer","savings","invest","brokerage","fidelity","vanguard","schwab",
  "robinhood","betterment","wealthfront","ally","marcus","sofi","acorns",
  "stash","contribution","deposit to"
];

const SUBSCRIPTION_KEYWORDS = [
  "netflix","spotify","apple","amazon prime","hulu","disney","hbo","paramount",
  "peacock","youtube premium","adobe","microsoft","google","dropbox","zoom",
  "slack","github","chatgpt","openai","anthropic","duolingo","calm","headspace",
  "nytimes","wsj","medium","audible","kindle"
];

const LOAN_KEYWORDS = [
  "mortgage","loan","payment","auto pay","car payment","student","sallie mae",
  "navient","lendingtree","sba","chase mortgage","wells fargo home","bank of america"
];

function isUtility(merchant: string): boolean {
  const m = merchant.toLowerCase();
  return UTILITY_KEYWORDS.some(k => m.includes(k));
}
function isSavingsTransfer(merchant: string, account: PAccount | undefined): boolean {
  const m = merchant.toLowerCase();
  if (SAVINGS_KEYWORDS.some(k => m.includes(k))) return true;
  if (account?.subtype === "savings" || account?.subtype === "money market") return true;
  return false;
}
function isLoan(merchant: string): boolean {
  const m = merchant.toLowerCase();
  return LOAN_KEYWORDS.some(k => m.includes(k));
}
function isSubscription(merchant: string): boolean {
  const m = merchant.toLowerCase();
  return SUBSCRIPTION_KEYWORDS.some(k => m.includes(k));
}

function detectSections(txns: PTxn[], accounts: PAccount[], month: string): {
  income: DetectedItem[];
  obligations: DetectedItem[];
  errands: DetectedItem[];
  savings: DetectedItem[];
  expenses: DetectedItem[];
  incomeSources: DetectedItem[];
} {
  // Use last 3 months of data for detection, then filter spent to current month
  const monthDate = new Date(month + "-01");
  const threeMonthsAgo = new Date(monthDate);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const recent = txns.filter(t => {
    const d = new Date(t.date + "T00:00:00");
    return d >= threeMonthsAgo && !t.pending;
  });

  const currentMonth = txns.filter(t => t.date?.startsWith(month) && !t.pending);

  // Group by merchant for pattern detection
  const merchantMap = new Map<string, { amounts: number[]; dates: string[]; accountId: string }>();

  for (const t of recent) {
    const amt = Number(t.amount);
    const key = (t.merchant_name || t.name || "Unknown").trim();
    if (!key || key === "Unknown") continue;
    if (!merchantMap.has(key)) merchantMap.set(key, { amounts: [], dates: [], accountId: t.account_id });
    merchantMap.get(key)!.amounts.push(Math.abs(amt));
    merchantMap.get(key)!.dates.push(t.date);
  }

  // ── Income detection ──────────────────────────────────────────────────────
  // Recurring = same merchant appeared as a credit (negative Plaid amount)
  // in at least 2 distinct calendar months out of the last 3.
  // One-off = appeared only once — displayed but NOT counted in budget total.

  const INTEREST_KEYWORDS = ["interest","dividend","yield","apy","savings reward"];

  function isInterest(merchant: string): boolean {
    const m = merchant.toLowerCase();
    return INTEREST_KEYWORDS.some(k => m.includes(k));
  }

  // Build per-merchant month sets from 3-month history
  const incomeByMerchant = new Map<string, { amounts: number[]; months: Set<string>; lastDate: string }>();
  for (const t of recent) {
    const amt = Number(t.amount);
    if (amt >= 0) continue; // only credits
    const absAmt = Math.abs(amt);
    if (absAmt < 20) continue; // skip tiny credits (refunds, etc)
    const key = (t.merchant_name || t.name || "Deposit").trim();
    const mo = t.date.slice(0, 7); // "YYYY-MM"
    if (!incomeByMerchant.has(key)) incomeByMerchant.set(key, { amounts: [], months: new Set(), lastDate: t.date });
    const entry = incomeByMerchant.get(key)!;
    entry.amounts.push(absAmt);
    entry.months.add(mo);
    if (t.date > entry.lastDate) entry.lastDate = t.date;
  }

  // Separate current-month income into recurring vs one-off
  const currentIncomeItems: DetectedItem[] = [];
  for (const t of currentMonth) {
    const amt = Number(t.amount);
    if (amt >= 0) continue;
    const absAmt = Math.abs(amt);
    if (absAmt < 20) continue;
    const key = (t.merchant_name || t.name || "Deposit").trim();
    const history = incomeByMerchant.get(key);
    // Recurring: appeared in ≥2 months in history, OR is interest/dividend
    const monthCount = history?.months.size ?? 1;
    const recurring = monthCount >= 2 || isInterest(key);
    const existing = currentIncomeItems.find(i => i.merchant === key);
    if (existing) {
      existing.avgAmount += absAmt;
      existing.count++;
    } else {
      currentIncomeItems.push({
        merchant: key,
        avgAmount: absAmt,
        count: 1,
        variance: 0,
        lastDate: t.date,
        isRecurring: recurring,
        isOneOff: !recurring,
      });
    }
  }

  // Only show recurring income — one-offs are excluded entirely from Budget view
  const incomeItems = currentIncomeItems.filter(i => !i.isOneOff);

  // Expense detection — group expenses by merchant, classify
  const obligations: DetectedItem[] = [];
  const errands: DetectedItem[] = [];
  const savings: DetectedItem[] = [];
  const expenses: DetectedItem[] = [];

  // Use current month for actual amounts, use 3-month history for classification
  const currentExpenseMap = new Map<string, { total: number; count: number; lastDate: string }>();
  for (const t of currentMonth) {
    const amt = Number(t.amount);
    if (amt <= 0) continue; // only expenses (positive in Plaid)
    const key = (t.merchant_name || t.name || "Unknown").trim();
    if (!key || key === "Unknown") continue;
    const ex = currentExpenseMap.get(key) ?? { total: 0, count: 0, lastDate: t.date };
    ex.total += amt;
    ex.count++;
    ex.lastDate = t.date;
    currentExpenseMap.set(key, ex);
  }

  for (const [merchant, { total, count, lastDate }] of currentExpenseMap) {
    const history = merchantMap.get(merchant);
    const histAmounts = history?.amounts ?? [total];
    const avg = histAmounts.reduce((s, v) => s + v, 0) / histAmounts.length;
    const variance = histAmounts.length > 1
      ? (Math.max(...histAmounts) - Math.min(...histAmounts)) / avg * 100
      : 50;
    const account = accounts.find(a => a.account_id === history?.accountId);
    const item: DetectedItem = {
      merchant,
      avgAmount: total,
      count,
      variance,
      lastDate,
      accountId: history?.accountId,
    };

    if (isSavingsTransfer(merchant, account)) {
      savings.push(item);
    } else if (isLoan(merchant) || (isSubscription(merchant) && total > 10)) {
      obligations.push(item);
    } else if (isUtility(merchant) || (history && history.amounts.length >= 2 && total > 20)) {
      errands.push(item);
    } else {
      expenses.push(item);
    }
  }

  // Sort each by amount desc
  const byAmt = (a: DetectedItem, b: DetectedItem) => b.avgAmount - a.avgAmount;

  return {
    income: incomeItems.sort(byAmt),
    obligations: obligations.sort(byAmt),
    errands: errands.sort(byAmt),
    savings: savings.sort(byAmt),
    expenses: expenses.sort(byAmt),
    incomeSources: currentIncomeItems.sort(byAmt),
  };
  // Note: incomeSources = same as income (kept for compat)
}

// ─── Section card ─────────────────────────────────────────────────────────────

function SectionCard({
  icon: Icon, label, sublabel, color, bg, items, total, accent
}: {
  icon: React.ElementType;
  label: string;
  sublabel: string;
  color: string;
  bg: string;
  items: DetectedItem[];
  total: number;
  accent: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-border/60 overflow-hidden bg-card/60">
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

      {open && items.length > 0 && (
        <div className="divide-y divide-border/20 border-t border-border/40">
          {items.map((item, i) => (
            <div key={i} className={cn("flex items-center gap-3 px-4 py-3", "opacity-100")}>
              <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0", bg, color)}>
                {item.merchant.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-foreground truncate font-medium">{item.merchant}</p>
                <p className="text-[11px] text-muted-foreground">
                  {item.isRecurring ? "recurring" : (item.count > 1 ? `${item.count}× ` : "") + (item.variance < 10 ? "fixed" : item.variance < 30 ? "~fixed" : "varies")}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className={cn("text-[13px] font-semibold tabular", item.isOneOff ? "text-muted-foreground line-through" : accent)}>
                  {fmtUSD(item.avgAmount)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && items.length === 0 && (
        <div className="px-4 py-5 text-center text-[12px] text-muted-foreground/60 border-t border-border/40">
          None detected this month
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function BudgetView({ txns, accounts, month }: Props) {
  const monthLabel = useMemo(() => {
    const d = new Date(month + "-01");
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }, [month]);

  const detected = useMemo(
    () => detectSections(txns, accounts, month),
    [txns, accounts, month]
  );

  // Only recurring deposits count toward the budget baseline
  const totalIncome = detected.incomeSources.filter(i => !i.isOneOff).reduce((s, i) => s + i.avgAmount, 0);
  const totalObligations = detected.obligations.reduce((s, i) => s + i.avgAmount, 0);
  const totalErrands     = detected.errands.reduce((s, i) => s + i.avgAmount, 0);
  const totalSavings     = detected.savings.reduce((s, i) => s + i.avgAmount, 0);
  const totalExpenses    = detected.expenses.reduce((s, i) => s + i.avgAmount, 0);
  const totalOut         = totalObligations + totalErrands + totalSavings + totalExpenses;
  const free             = totalIncome - totalOut;
  const isOver           = free < 0;

  // Excess expense items (top 3 over avg)
  const topExpenses = detected.expenses.slice(0, 5);

  const SECTIONS = [
    {
      key: "income",
      label: "Income",
      sublabel: "Recurring deposits & payroll only",
      icon: TrendingUp,
      color: "text-emerald-400",
      bg: "bg-emerald-500/12",
      accent: "text-emerald-400",
      items: detected.incomeSources,
      total: totalIncome,
    },
    {
      key: "obligations",
      label: "Monthly Obligations",
      sublabel: "Loans, mortgage, fixed subscriptions",
      icon: Lock,
      color: "text-blue-400",
      bg: "bg-blue-500/12",
      accent: "text-foreground",
      items: detected.obligations,
      total: totalObligations,
    },
    {
      key: "errands",
      label: "Monthly Errands",
      sublabel: "Utilities, bills, services",
      icon: Zap,
      color: "text-amber-400",
      bg: "bg-amber-500/12",
      accent: "text-foreground",
      items: detected.errands,
      total: totalErrands,
    },
    {
      key: "savings",
      label: "Saving Pools",
      sublabel: "Transfers to savings & investments",
      icon: PiggyBank,
      color: "text-violet-400",
      bg: "bg-violet-500/12",
      accent: "text-violet-400",
      items: detected.savings,
      total: totalSavings,
    },
    {
      key: "expenses",
      label: "Expenses",
      sublabel: "Remaining discretionary spending",
      icon: ShoppingBag,
      color: "text-rose-400",
      bg: "bg-rose-500/12",
      accent: "text-foreground",
      items: detected.expenses,
      total: totalExpenses,
    },
  ];

  return (
    <div className="flex flex-col min-h-full">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-4 md:px-8 pt-5 pb-3 border-b border-border/40">
        <div className="flex items-baseline justify-between">
          <div>
            <h2 className="text-[17px] font-bold text-foreground">Budget</h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">{monthLabel}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-[11px] text-muted-foreground">Auto-detected</span>
          </div>
        </div>

        {/* ── Allocation bar ─────────────────────────────────────────────── */}
        {totalIncome > 0 && (
          <div className="mt-4">
            <div className="h-3 rounded-full bg-muted overflow-hidden flex gap-px">
              {[
                { val: totalObligations, cls: "bg-blue-500" },
                { val: totalErrands,     cls: "bg-amber-500" },
                { val: totalSavings,     cls: "bg-violet-500" },
                { val: totalExpenses,    cls: "bg-rose-500/80" },
              ].map((seg, i) => {
                const pct = Math.min((seg.val / totalIncome) * 100, 100);
                if (pct < 0.5) return null;
                return <div key={i} style={{ width: `${pct}%` }} className={cn("h-full", seg.cls)} />;
              })}
            </div>
            <div className="flex items-center justify-between mt-2">
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {[
                  { label: "Obligations", color: "bg-blue-500", val: totalObligations },
                  { label: "Errands",     color: "bg-amber-500", val: totalErrands },
                  { label: "Savings",     color: "bg-violet-500", val: totalSavings },
                  { label: "Expenses",    color: "bg-rose-500", val: totalExpenses },
                ].filter(s => s.val > 0).map(s => (
                  <div key={s.label} className="flex items-center gap-1">
                    <div className={cn("h-1.5 w-1.5 rounded-full", s.color)} />
                    <span className="text-[10px] text-muted-foreground">{s.label} {fmtUSD(s.val)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Summary strip ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 divide-x divide-border/40 border-b border-border/40 bg-muted/20 shrink-0">
        <div className="px-4 py-3 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Income</p>
          <p className="text-[15px] font-bold text-emerald-400">{fmtUSD(totalIncome)}</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Committed</p>
          <p className="text-[15px] font-bold text-foreground">{fmtUSD(totalOut)}</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
            {isOver ? "Over by" : "Free"}
          </p>
          <p className={cn("text-[15px] font-bold", isOver ? "text-destructive" : "text-emerald-400")}>
            {isOver ? "-" : "+"}{fmtUSD(Math.abs(free))}
          </p>
        </div>
      </div>

      <div className="flex-1 px-4 md:px-8 py-4 space-y-3 overflow-y-auto">

        {/* ── Over-budget alert ───────────────────────────────────────────── */}
        {isOver && (
          <div className="rounded-2xl bg-destructive/10 border border-destructive/25 p-4">
            <div className="flex items-start gap-2.5 mb-3">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] font-semibold text-foreground">
                  {fmtUSD(Math.abs(free))} over income this month
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Here's where it could come from:
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {/* Cover from savings */}
              {totalSavings > 0 && (
                <div className="flex items-center gap-3 p-2.5 rounded-xl bg-card/60 border border-border/40">
                  <div className="h-7 w-7 rounded-full bg-violet-500/15 flex items-center justify-center shrink-0">
                    <PiggyBank className="h-3.5 w-3.5 text-violet-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium">Reduce saving pool contribution</p>
                    <p className="text-[11px] text-muted-foreground">You're putting {fmtUSD(totalSavings)} into savings</p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </div>
              )}
              {/* Cut top expense */}
              {topExpenses[0] && (
                <div className="flex items-center gap-3 p-2.5 rounded-xl bg-card/60 border border-border/40">
                  <div className="h-7 w-7 rounded-full bg-rose-500/15 flex items-center justify-center shrink-0">
                    <ShoppingBag className="h-3.5 w-3.5 text-rose-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium">Cut back on {topExpenses[0].merchant}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtUSD(topExpenses[0].avgAmount)} spent this month</p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Sections ────────────────────────────────────────────────────── */}
        {SECTIONS.map(s => (
          <SectionCard key={s.key} {...s} />
        ))}

        {/* ── Free money note ─────────────────────────────────────────────── */}
        {!isOver && free > 0 && (
          <div className="rounded-2xl bg-emerald-500/8 border border-emerald-500/20 p-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
            <div>
              <p className="text-[13px] font-semibold text-foreground">
                {fmtUSD(free)} unallocated
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Consider adding to a saving pool or paying down debt
              </p>
            </div>
          </div>
        )}

        {/* ── Detection note ───────────────────────────────────────────────── */}
        <div className="flex items-start gap-2 px-1 pb-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />
          <p className="text-[11px] text-muted-foreground/50">
            Items are auto-detected from your last 3 months of transactions. Open any transaction to manually reassign it.
          </p>
        </div>
      </div>
    </div>
  );
}
