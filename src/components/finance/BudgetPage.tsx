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
  TrendingUp, TrendingDown, Plus, X, ChevronDown, ChevronLeft, PiggyBank, Target, Trash2, Wallet, CalendarClock,
  ShieldAlert, RefreshCw, Search, Pencil, Check,
} from "lucide-react";
import type { ManualIncomeItem, SavingsGoal, RecurringGroup } from "@/hooks/useUserSettings";

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
  // Recurring expenses — detected or user-flagged (recurringOverrides, set from
  // the transaction detail modal's "Is recurring?" toggle) and tracked as named
  // budget entries (recurringGroups) with explicit transaction membership.
  recurringOverrides: Record<string, boolean>;
  recurringGroups: RecurringGroup[];
  addRecurringGroup: (group: Omit<RecurringGroup, "id"|"createdAt">) => void;
  removeRecurringGroup: (id: string) => void;
  updateRecurringGroup: (id: string, patch: Partial<Omit<RecurringGroup, "id"|"createdAt">>) => void;
  addTxnToRecurringGroup: (groupId: string, txnId: string) => void;
  removeTxnFromRecurringGroup: (groupId: string, txnId: string) => void;
  // A simple merchant-name blacklist — declining a detected suggestion adds
  // it here so it doesn't keep coming back every time the page re-detects.
  dismissedRecurring: string[];
  dismissRecurring: (merchant: string) => void;
  // Wipes budgets/recurringGroups/savingsGoals so the page can be rebuilt
  // clean under a reworked model instead of mixing with stale tracked data.
  resetBudgetTracking: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SAVINGS_KW = ["transfer","savings","invest","brokerage","fidelity","vanguard","schwab","robinhood","betterment","wealthfront","ally","marcus","sofi","acorns","stash","contribution","deposit to"];
const matchKw = (m: string, kws: string[]) => { const s = m.toLowerCase(); return kws.some(k => s.includes(k)); };
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
const isTransferLikeCategory = (cat: string) => /transfer|credit card payment|loan payment/i.test(cat);

// ── Recurring-expense frequency classification, from the average gap (in
// days) between a merchant's occurrences. Anything outside these windows is
// treated as irregular, not a strict recurring cadence.
type Frequency = RecurringGroup["frequency"];
const FREQ_LABEL: Record<Frequency, string> = { weekly: "Weekly", biweekly: "Biweekly", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };
// Multiplier to normalize any cadence's amount into a monthly-equivalent
// figure, so "all recurring expenses are accounted for" as one comparable total.
const FREQ_MONTHLY_MULT: Record<Frequency, number> = { weekly: 4.345, biweekly: 2.1725, monthly: 1, quarterly: 1/3, yearly: 1/12 };
const classifyFrequency = (avgGapDays: number): Frequency | null => {
  if (avgGapDays >= 5 && avgGapDays <= 9) return "weekly";
  if (avgGapDays >= 12 && avgGapDays <= 17) return "biweekly";
  if (avgGapDays >= 25 && avgGapDays <= 36) return "monthly";
  if (avgGapDays >= 80 && avgGapDays <= 100) return "quarterly";
  if (avgGapDays >= 340 && avgGapDays <= 390) return "yearly";
  return null;
};

// Cleans up a raw merchant/statement string for display — strips trailing
// reference/trace numbers banks tack on and title-cases ALL-CAPS statement
// text — so a suggestion reads "Planet Fitness" instead of "PLANET FITNESS
// CLUB #4471 REF 88213". Mirrors the same cleanup used for Obligations so
// both detectors present names consistently.
function cleanMerchantName(raw: string): string {
  let name = raw
    .replace(/\s*(?:#|no\.?|ref|trace|conf|id)[:#]?\s*[a-z0-9-]{4,}\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (name === name.toUpperCase() && /[A-Z]/.test(name)) {
    name = name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  return name || raw;
}

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
  recurringOverrides, recurringGroups, addRecurringGroup, removeRecurringGroup, updateRecurringGroup, addTxnToRecurringGroup, removeTxnFromRecurringGroup,
  dismissedRecurring, dismissRecurring, resetBudgetTracking,
}: BudgetPageProps) {
  const now = new Date();
  const thisMonth = monthKey(now);
  const thisYear = now.getFullYear();
  const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // ── Obligations — fetched here too (separately from ObligationsView's own
  // fetch) so Expenses can exclude obligation-covered spend from its total
  // instead of double-counting a mortgage payment as both an "obligation"
  // and a "housing expense". ──
  const [confirmingReset, setConfirmingReset] = useState(false);
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

  // Every transaction id already tracked under a named recurring budget entry.
  const groupedTxnIdSet = useMemo(() => new Set(recurringGroups.flatMap(g => g.txnIds)), [recurringGroups]);
  const isRecurringTxn = useCallback((t: PTxn) => groupedTxnIdSet.has(t.id) || recurringOverrides[t.id] === true, [groupedTxnIdSet, recurringOverrides]);

  const isIncomeTxn = useCallback((t: PTxn) =>
    !internalTxnIds.has(t.id) && isIncomeCategory(getEffectiveCategory(t) ?? "Other", Number(t.amount)),
  [internalTxnIds, isIncomeCategory, getEffectiveCategory]);

  // Expenses = non-recurring, non-obligation, non-income spend — recurring
  // bills (tracked or user-flagged) and obligations are accounted for in
  // their own sections instead, so nothing is double-counted.
  const isExpenseTxn = useCallback((t: PTxn) => {
    if (internalTxnIds.has(t.id)) return false;
    if (isObligationTxn(t)) return false;
    if (isRecurringTxn(t)) return false;
    const cat = getEffectiveCategory(t) ?? "Other";
    return !isIncomeCategory(cat, Number(t.amount)) && !isTransferLikeCategory(cat);
  }, [internalTxnIds, isObligationTxn, isRecurringTxn, getEffectiveCategory, isIncomeCategory]);

  const monthTxns = useMemo(() => txns.filter(t => t.date.startsWith(thisMonth) && !t.pending), [txns, thisMonth]);

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

  // ── Expenses: this month's categorized spend, excluding anything already
  // covered by an Obligation. The "Monthly vs Yearly" distinction lives
  // inside this section as two sub-lists instead of a period toggle — the
  // yearly one still runs off a full year of history to detect the pattern,
  // it just isn't a separate "view" the user has to switch to. ──
  const expenseTxnsForPeriod = useMemo(() => monthTxns.filter(isExpenseTxn), [monthTxns, isExpenseTxn]);
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

  // Shared "don't suggest this again" blacklist — reused by both the yearly
  // expense detector below and the recurring-expense detector further down,
  // so dismissing a suggestion from either one sticks.
  const dismissedRecurringSet = useMemo(() => new Set(dismissedRecurring.map(m => m.toLowerCase())), [dismissedRecurring]);

  // ── Yearly / irregular expenses: same merchant seen only once or twice
  // over the last 13 months (not a monthly recurring cadence) with a
  // meaningful amount — the "insurance premium" / "annual renewal" pattern.
  const yearlyExpenseCandidates = useMemo(() => {
    const merchantTotals: Record<string, { dates: string[]; amounts: number[]; cat: string }> = {};
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth()-13);
    const cutoffStr = cutoff.toISOString().slice(0,10);
    for (const t of txns) {
      if (t.date < cutoffStr) continue;
      if (internalTxnIds.has(t.id) || isObligationTxn(t)) continue;
      const cat = getEffectiveCategory(t) ?? "Other";
      if (isIncomeCategory(cat, Number(t.amount)) || isTransferLikeCategory(cat)) continue;
      const merchant = t.merchant_name ?? t.name ?? "Unknown";
      if (dismissedRecurringSet.has(merchant.toLowerCase())) continue;
      if (!merchantTotals[merchant]) merchantTotals[merchant] = { dates: [], amounts: [], cat };
      merchantTotals[merchant].dates.push(t.date);
      merchantTotals[merchant].amounts.push(Math.abs(Number(t.amount)));
    }
    return Object.entries(merchantTotals)
      .filter(([,d]) => d.dates.length >= 1 && d.dates.length <= 2 && Math.max(...d.amounts) >= 75)
      .map(([merchant,d]) => ({
        merchant, category: d.cat, amount: Math.max(...d.amounts), lastDate: [...d.dates].sort().slice(-1)[0],
        reason: d.dates.length === 1
          ? `Seen once in the last 13 months, ${fmtUSD(Math.max(...d.amounts))} on ${[...d.dates].sort().slice(-1)[0]} — looks like an annual charge`
          : `Seen ${d.dates.length}x in the last 13 months, roughly a year apart — looks like an annual charge`,
      }))
      .filter(y => !savingsGoals.some(g => g.kind === "yearly" && g.name === y.merchant))
      .sort((a,b) => b.amount - a.amount)
      .slice(0, 8);
  }, [txns, internalTxnIds, isObligationTxn, getEffectiveCategory, isIncomeCategory, savingsGoals, dismissedRecurringSet]);

  // ── Obligations without a funding plan yet ──
  const obligationsNeedingPlan = useMemo(
    () => obligations.filter(ob => !savingsGoals.some(g => g.kind === "obligation" && g.obligationId === ob.id)),
    [obligations, savingsGoals]
  );

  // ── Recurring Expenses ──────────────────────────────────────────────────
  // Auto-detected candidates: same merchant repeating on a cadence that fits
  // one of the standard frequencies, over the last 13 months. Excludes
  // obligations and income (those are tracked elsewhere) and merchants that
  // are already fully covered by a tracked recurring group.

  const recurringCandidates = useMemo(() => {
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth()-13);
    const cutoffStr = cutoff.toISOString().slice(0,10);
    const byMerchant: Record<string, { display: string; dates: string[]; amounts: number[]; ids: string[]; cat: string }> = {};
    for (const t of txns) {
      if (t.date < cutoffStr) continue;
      if (internalTxnIds.has(t.id) || isObligationTxn(t)) continue;
      const cat = getEffectiveCategory(t) ?? "Other";
      if (isIncomeCategory(cat, Number(t.amount)) || isTransferLikeCategory(cat)) continue;
      const merchant = (t.merchant_name ?? t.name ?? "").trim();
      if (!merchant) continue;
      const key = merchant.toLowerCase();
      if (dismissedRecurringSet.has(key)) continue;
      if (!byMerchant[key]) byMerchant[key] = { display: merchant, dates: [], amounts: [], ids: [], cat };
      byMerchant[key].dates.push(t.date);
      byMerchant[key].amounts.push(Number(t.amount));
      byMerchant[key].ids.push(t.id);
    }
    const out: { key: string; merchant: string; category: string; frequency: Frequency; avgAmount: number; count: number; txnIds: string[]; reason: string }[] = [];
    for (const [key, d] of Object.entries(byMerchant)) {
      // Require at least 3 occurrences — smart, confident suggestions only.
      // 2 repeats isn't a confirmed pattern and was the main source of noisy
      // one-off charges getting suggested as "recurring."
      if (d.dates.length < 3) continue;
      if (d.ids.every(id => groupedTxnIdSet.has(id))) continue; // already fully tracked
      const sorted = [...d.dates].sort();
      const gaps: number[] = [];
      for (let i=1;i<sorted.length;i++) gaps.push((new Date(sorted[i]+"T00:00:00").getTime()-new Date(sorted[i-1]+"T00:00:00").getTime())/86400000);
      const avgGap = gaps.reduce((s,v)=>s+v,0)/gaps.length;
      const freq = classifyFrequency(avgGap);
      if (!freq) continue;
      const avgAmount = d.amounts.reduce((s,v)=>s+v,0)/d.amounts.length;
      out.push({
        key, merchant: cleanMerchantName(d.display), category: d.cat, frequency: freq, avgAmount, count: d.dates.length,
        txnIds: d.ids.filter(id => !groupedTxnIdSet.has(id)),
        reason: `${fmtUSD(avgAmount)} roughly every ${Math.round(avgGap)} days, ${d.dates.length} times over the last 13 months`,
      });
    }
    return out.sort((a,b) => b.avgAmount - a.avgAmount);
  }, [txns, internalTxnIds, isObligationTxn, getEffectiveCategory, isIncomeCategory, groupedTxnIdSet, dismissedRecurringSet]);

  // Transactions explicitly marked "Is recurring? Yes" (from the txn detail
  // modal) that don't fit a clean cadence above and aren't tracked yet —
  // surfaced so a manually-flagged one-off still shows up here as asked.
  const manualRecurringUngrouped = useMemo(() => {
    const candidateIds = new Set(recurringCandidates.flatMap(c => c.txnIds));
    return txns
      .filter(t => recurringOverrides[t.id] === true && !groupedTxnIdSet.has(t.id) && !candidateIds.has(t.id))
      .filter(t => !dismissedRecurringSet.has((t.merchant_name ?? t.name ?? "").trim().toLowerCase()))
      .sort((a,b) => b.date.localeCompare(a.date))
      .slice(0, 20);
  }, [txns, recurringOverrides, groupedTxnIdSet, recurringCandidates, dismissedRecurringSet]);

  const totalRecurringMonthly = useMemo(
    () => recurringGroups.reduce((s,g) => s + g.expectedAmount * FREQ_MONTHLY_MULT[g.frequency], 0),
    [recurringGroups]
  );

  // Which detected (not-yet-tracked) candidate has its underlying
  // transactions expanded inline for preview before deciding to Track it.
  const [expandedCandidateKey, setExpandedCandidateKey] = useState<string|null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string|null>(null);
  const selectedGroup = recurringGroups.find(g => g.id === selectedGroupId) ?? null;
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupFreq, setNewGroupFreq] = useState<Frequency>("monthly");
  const [newGroupAmount, setNewGroupAmount] = useState("");
  const submitNewGroup = () => {
    const name = newGroupName.trim();
    const amt = parseFloat(newGroupAmount);
    if (!name || isNaN(amt) || amt <= 0) return;
    addRecurringGroup({ name, frequency: newGroupFreq, expectedAmount: amt, txnIds: [] });
    setNewGroupName(""); setNewGroupAmount(""); setNewGroupFreq("monthly"); setShowNewGroup(false);
  };
  const [addTxnSearch, setAddTxnSearch] = useState("");
  const addTxnResults = useMemo(() => {
    const q = addTxnSearch.trim().toLowerCase();
    if (!q || !selectedGroup) return [];
    return txns
      .filter(t => !selectedGroup.txnIds.includes(t.id))
      .filter(t => (t.merchant_name ?? t.name ?? "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [addTxnSearch, selectedGroup, txns]);
  const [editingGroupHeader, setEditingGroupHeader] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [groupAmountDraft, setGroupAmountDraft] = useState("");

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
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-[19px] md:text-[21px] font-semibold text-foreground tracking-tight">Budget</h1>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">{monthLabel}</p>
          </div>
          {confirmingReset ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[11px] text-muted-foreground">Clear budgets, recurring & savings goals?</span>
              <button onClick={()=>{ resetBudgetTracking(); setConfirmingReset(false); }}
                className="h-7 px-2.5 rounded-lg bg-negative text-white text-[11px] font-semibold">Confirm</button>
              <button onClick={()=>setConfirmingReset(false)}
                className="h-7 px-2.5 rounded-lg text-muted-foreground hover:text-foreground text-[11px] font-medium">Cancel</button>
            </div>
          ) : (
            <button onClick={()=>setConfirmingReset(true)}
              className="shrink-0 text-[11px] text-muted-foreground/70 hover:text-negative transition-colors">
              Reset budget data
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <div className="rounded-xl bg-card/60 border border-border/50 p-3">
            <div className="text-[10.5px] text-muted-foreground uppercase tracking-wide">Income</div>
            <div className="text-[16px] font-bold tabular text-positive mt-0.5">{fmtUSD(totalMonthlyIncome)}</div>
          </div>
          <div className="rounded-xl bg-card/60 border border-border/50 p-3">
            <div className="text-[10.5px] text-muted-foreground uppercase tracking-wide">Expenses (month)</div>
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

        {/* ═══ Expenses — Monthly + Yearly, both detected & allocated ═══ */}
        <SectionShell icon={TrendingDown} label="Expenses" sublabel="Everyday categorized spend — obligations are tracked separately below"
          color="text-rose-400" bg="bg-rose-500/12" total={totalExpenses} totalLabel="this month" defaultOpen>

          <p className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Monthly expenses</p>
          <div className="divide-y divide-border/20 mt-1">
            {expenseByCat.length === 0 ? (
              <p className="px-4 py-5 text-center text-[12px] text-muted-foreground/60">No expenses this month yet.</p>
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

          {/* Yearly / irregular expenses — detected from a full 13 months of
              history (never just "this year"), each with the pattern that
              triggered it and an explicit Allocate/Dismiss choice — nothing
              here gets tracked until the user says so. */}
          {(yearlyGoals.length > 0 || yearlyExpenseCandidates.length > 0) && (
            <div className="border-t border-border/20 mt-1">
              <p className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 flex items-center gap-1">
                <CalendarClock className="h-3 w-3"/> Yearly expenses
              </p>
              <div className="px-4 py-2 space-y-1.5">
                {yearlyGoals.map(g => (
                  <div key={g.id} className="flex items-center gap-3 py-1">
                    <div className="h-6 w-6 rounded-lg bg-rose-500/12 text-rose-400 grid place-items-center shrink-0"><CalendarClock className="h-3 w-3"/></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] text-foreground font-medium truncate">{g.name}</p>
                      <p className="text-[10px] text-muted-foreground">Allocated</p>
                    </div>
                    <p className="text-[12.5px] font-semibold tabular text-rose-400 shrink-0">{fmtUSD(g.monthlyTarget)}/mo</p>
                    <button onClick={()=>removeSavingsGoal(g.id)} aria-label={`Remove ${g.name}`} className="text-muted-foreground/40 hover:text-negative shrink-0"><Trash2 className="h-3 w-3"/></button>
                  </div>
                ))}
                {yearlyExpenseCandidates.map(y => (
                  <div key={y.merchant} className="rounded-lg border border-border/30 px-3 py-2">
                    <div className="flex items-center gap-3">
                      <div className="h-6 w-6 rounded-lg bg-muted/40 text-muted-foreground grid place-items-center text-[10px] font-bold shrink-0">{y.merchant.charAt(0).toUpperCase()}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] text-foreground font-medium truncate">{y.merchant} <span className="text-[10px] text-muted-foreground font-normal">· {formatCat(y.category)}</span></p>
                      </div>
                      <p className="text-[12px] tabular text-muted-foreground shrink-0">{fmtUSD(y.amount)}</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground/80 mt-1 ml-9">{y.reason}</p>
                    <div className="flex items-center gap-1.5 mt-1.5 ml-9">
                      <button
                        onClick={()=>addSavingsGoal({ name: y.merchant, monthlyTarget: Math.round(y.amount/12), kind: "yearly" })}
                        className="flex-1 h-7 px-2 rounded-lg border border-[hsl(var(--primary)/0.4)] text-[10.5px] font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.08)] transition-colors">
                        Allocate {fmtUSD(Math.round(y.amount/12))}/mo
                      </button>
                      <button onClick={()=>dismissRecurring(y.merchant)} aria-label={`Dismiss ${y.merchant}`}
                        className="h-7 w-7 grid place-items-center rounded-lg text-muted-foreground/60 hover:text-negative transition-colors shrink-0">
                        <X className="h-3.5 w-3.5"/>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionShell>

        {/* ═══ Recurring Expenses ═══ */}
        <SectionShell icon={RefreshCw} label="Recurring Expenses" sublabel="Bills that repeat — detected, or marked recurring by you"
          color="text-amber-400" bg="bg-amber-500/12" total={totalRecurringMonthly} totalLabel="monthly-equivalent" defaultOpen>
          {selectedGroup ? (
            <div className="px-4 py-3 space-y-3">
              <button onClick={()=>{ setSelectedGroupId(null); setEditingGroupHeader(false); }} className="flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground transition-colors">
                <ChevronLeft className="h-3.5 w-3.5"/> Back to recurring expenses
              </button>

              {editingGroupHeader ? (
                <div className="flex items-center gap-1.5">
                  <input autoFocus value={groupNameDraft} onChange={e=>setGroupNameDraft(e.target.value)}
                    className="flex-1 min-w-0 h-9 px-2.5 rounded-lg bg-muted/40 border border-border/60 text-[13px] text-foreground outline-none"/>
                  <select value={selectedGroup.frequency} onChange={e=>updateRecurringGroup(selectedGroup.id, { frequency: e.target.value as Frequency })}
                    className="h-9 px-2 rounded-lg bg-muted/40 border border-border/60 text-[12px] text-foreground outline-none">
                    {(Object.keys(FREQ_LABEL) as Frequency[]).map(f => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}
                  </select>
                  <div className="relative w-24 shrink-0">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">$</span>
                    <input type="number" min={0} value={groupAmountDraft} onChange={e=>setGroupAmountDraft(e.target.value)}
                      className="w-full h-9 pl-5 pr-2 rounded-lg bg-muted/40 border border-border/60 text-[12px] text-foreground outline-none"/>
                  </div>
                  <button onClick={()=>{
                    const amt = parseFloat(groupAmountDraft);
                    updateRecurringGroup(selectedGroup.id, { name: groupNameDraft.trim() || selectedGroup.name, expectedAmount: isNaN(amt)?selectedGroup.expectedAmount:amt });
                    setEditingGroupHeader(false);
                  }} aria-label="Save" className="h-9 w-9 grid place-items-center rounded-lg bg-gold shrink-0"><Check className="h-4 w-4"/></button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[14.5px] font-semibold text-foreground truncate">{selectedGroup.name}</p>
                    <p className="text-[11.5px] text-muted-foreground">{FREQ_LABEL[selectedGroup.frequency]} · {fmtUSD(selectedGroup.expectedAmount)} · {fmtUSD(selectedGroup.expectedAmount * FREQ_MONTHLY_MULT[selectedGroup.frequency])}/mo equiv.</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={()=>{ setEditingGroupHeader(true); setGroupNameDraft(selectedGroup.name); setGroupAmountDraft(String(selectedGroup.expectedAmount)); }}
                      aria-label="Edit" className="h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5"/></button>
                    <button onClick={()=>{ removeRecurringGroup(selectedGroup.id); setSelectedGroupId(null); }}
                      aria-label="Delete entry" className="h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:text-negative"><Trash2 className="h-3.5 w-3.5"/></button>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-border/30 divide-y divide-border/20 overflow-hidden">
                {selectedGroup.txnIds.length === 0 ? (
                  <p className="px-3 py-4 text-center text-[12px] text-muted-foreground/60">No transactions in this entry yet — add one below.</p>
                ) : selectedGroup.txnIds
                  .map(id => txns.find(t => t.id === id))
                  .filter((t): t is PTxn => !!t)
                  .sort((a,b) => b.date.localeCompare(a.date))
                  .map(t => (
                    <div key={t.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] text-foreground font-medium truncate">{t.merchant_name ?? t.name ?? "Transaction"}</p>
                        <p className="text-[10.5px] text-muted-foreground">{t.date}</p>
                      </div>
                      <p className="text-[12.5px] font-semibold tabular text-foreground shrink-0">{fmtUSD(Number(t.amount))}</p>
                      <button onClick={()=>removeTxnFromRecurringGroup(selectedGroup.id, t.id)} aria-label="Remove from this entry"
                        className="text-muted-foreground/50 hover:text-negative shrink-0"><X className="h-3.5 w-3.5"/></button>
                    </div>
                  ))}
              </div>

              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50 pointer-events-none"/>
                <input value={addTxnSearch} onChange={e=>setAddTxnSearch(e.target.value)} placeholder="Search transactions to add…"
                  className="w-full h-8 pl-7 pr-2 rounded-lg bg-muted/40 border border-border/60 text-[12px] text-foreground outline-none focus:border-primary/50"/>
              </div>
              {addTxnResults.length > 0 && (
                <div className="rounded-xl border border-border/30 divide-y divide-border/20 overflow-hidden">
                  {addTxnResults.map(t => (
                    <button key={t.id} onClick={()=>{ addTxnToRecurringGroup(selectedGroup.id, t.id); setAddTxnSearch(""); }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/30 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] text-foreground font-medium truncate">{t.merchant_name ?? t.name ?? "Transaction"}</p>
                        <p className="text-[10.5px] text-muted-foreground">{t.date}</p>
                      </div>
                      <p className="text-[12.5px] font-semibold tabular text-foreground shrink-0">{fmtUSD(Number(t.amount))}</p>
                      <Plus className="h-3.5 w-3.5 text-[hsl(var(--primary))] shrink-0"/>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              {/* Two columns: what's actually tracked (left) vs. what's been
                  detected but NOT added yet (right) — detection never
                  auto-creates a tracked entry, it only surfaces a suggestion
                  here for the user to Track or Dismiss. */}
              <div className="grid grid-cols-1 md:grid-cols-2 md:divide-x divide-border/20 divide-y md:divide-y-0">
                <div className="px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-2">Tracked entries</p>
                  {recurringGroups.length === 0 ? (
                    <p className="text-[11.5px] text-muted-foreground/60 py-2">Nothing tracked yet — add a suggestion from the right, or create one manually below.</p>
                  ) : recurringGroups.map(g => (
                    <button key={g.id} onClick={()=>setSelectedGroupId(g.id)}
                      className="w-full flex items-center gap-3 py-2 text-left hover:bg-muted/20 transition-colors rounded-lg -mx-1 px-1">
                      <div className="h-7 w-7 rounded-lg bg-amber-500/12 text-amber-400 grid place-items-center shrink-0"><RefreshCw className="h-3.5 w-3.5"/></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-foreground font-medium truncate">{g.name}</p>
                        <p className="text-[10.5px] text-muted-foreground">{FREQ_LABEL[g.frequency]} · {g.txnIds.length} txn{g.txnIds.length!==1?"s":""}</p>
                      </div>
                      <p className="text-[12.5px] font-semibold tabular text-amber-400 shrink-0">{fmtUSD(g.expectedAmount)}</p>
                    </button>
                  ))}
                </div>

                <div className="px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-2">Suggestions — not added</p>
                  {recurringCandidates.length === 0 && manualRecurringUngrouped.length === 0 ? (
                    <p className="text-[11.5px] text-muted-foreground/60 py-2">Nothing new detected. A suggestion needs the same merchant to repeat on a consistent cadence at least 3 times in the last 13 months.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {recurringCandidates.map(c => {
                        const expanded = expandedCandidateKey === c.key;
                        return (
                          <div key={c.key} className="rounded-lg border border-border/30">
                            <div role="button" tabIndex={0} onClick={()=>setExpandedCandidateKey(expanded ? null : c.key)}
                              onKeyDown={e=>{ if (e.key==="Enter"||e.key===" ") { e.preventDefault(); setExpandedCandidateKey(expanded?null:c.key); } }}
                              className="flex items-center gap-2.5 px-2.5 py-2 cursor-pointer hover:bg-muted/20 transition-colors">
                              <div className="h-7 w-7 rounded-lg bg-muted/40 text-muted-foreground grid place-items-center text-[11px] font-bold shrink-0">{c.merchant.charAt(0).toUpperCase()}</div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[12.5px] text-foreground font-medium truncate">{c.merchant} <span className="text-[10px] text-muted-foreground font-normal">· {formatCat(c.category)}</span></p>
                                <p className="text-[10px] text-muted-foreground/80 leading-snug">{c.reason}</p>
                              </div>
                              <ChevronDown className={cn("h-3 w-3 text-muted-foreground/50 shrink-0 transition-transform", expanded && "rotate-180")}/>
                            </div>
                            {expanded && (
                              <div className="border-t border-border/20 divide-y divide-border/10">
                                {c.txnIds.map(id => txns.find(t=>t.id===id)).filter((t): t is PTxn => !!t)
                                  .sort((a,b)=>b.date.localeCompare(a.date))
                                  .map(t => (
                                    <div key={t.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                                      <span className="text-[11px] text-muted-foreground">{t.date}</span>
                                      <span className="text-[11px] font-medium tabular text-foreground">{fmtUSD(Number(t.amount))}</span>
                                    </div>
                                  ))}
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-t border-border/20">
                              <button
                                onClick={()=>addRecurringGroup({ name: c.merchant, frequency: c.frequency, expectedAmount: Math.round(c.avgAmount), txnIds: c.txnIds })}
                                className="flex-1 h-7 px-2 rounded-lg border border-[hsl(var(--primary)/0.4)] text-[10.5px] font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.08)] transition-colors">
                                Track — {fmtUSD(c.avgAmount)} {FREQ_LABEL[c.frequency].toLowerCase()}
                              </button>
                              <button onClick={()=>dismissRecurring(c.merchant)} aria-label={`Dismiss ${c.merchant}`}
                                className="h-7 w-7 grid place-items-center rounded-lg text-muted-foreground/60 hover:text-negative transition-colors shrink-0">
                                <X className="h-3.5 w-3.5"/>
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      {manualRecurringUngrouped.map(t => (
                        <div key={t.id} className="flex items-center gap-2.5 rounded-lg border border-border/30 px-2.5 py-2">
                          <div className="h-7 w-7 rounded-lg bg-muted/40 text-muted-foreground grid place-items-center shrink-0"><RefreshCw className="h-3 w-3"/></div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12.5px] text-foreground font-medium truncate">{t.merchant_name ?? t.name ?? "Transaction"}</p>
                            <p className="text-[10px] text-muted-foreground">Marked recurring by you · {t.date} · {fmtUSD(Number(t.amount))}</p>
                          </div>
                          <button
                            onClick={()=>addRecurringGroup({ name: t.merchant_name ?? t.name ?? "Recurring", frequency: "monthly", expectedAmount: Math.abs(Number(t.amount)), txnIds: [t.id] })}
                            className="h-7 px-2 rounded-lg border border-[hsl(var(--primary)/0.4)] text-[10.5px] font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.08)] transition-colors shrink-0">
                            + New entry
                          </button>
                          <button onClick={()=>dismissRecurring(t.merchant_name ?? t.name ?? "")} aria-label="Dismiss"
                            className="h-7 w-7 grid place-items-center rounded-lg text-muted-foreground/60 hover:text-negative transition-colors shrink-0">
                            <X className="h-3.5 w-3.5"/>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="px-4 py-3 border-t border-border/20">
                {showNewGroup ? (
                  <div className="space-y-1.5">
                    <input autoFocus value={newGroupName} onChange={e=>setNewGroupName(e.target.value)} placeholder="Name (e.g. Mortgage Payment)"
                      onKeyDown={e=>{ if(e.key==="Enter") submitNewGroup(); if(e.key==="Escape") setShowNewGroup(false); }}
                      className="w-full h-9 px-2.5 rounded-lg bg-muted/40 border border-border/60 text-[13px] text-foreground outline-none focus:border-primary/50"/>
                    <div className="flex items-center gap-1.5">
                      <select value={newGroupFreq} onChange={e=>setNewGroupFreq(e.target.value as Frequency)}
                        className="h-9 flex-1 px-2 rounded-lg bg-muted/40 border border-border/60 text-[12px] text-foreground outline-none">
                        {(Object.keys(FREQ_LABEL) as Frequency[]).map(f => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}
                      </select>
                      <div className="relative w-28 shrink-0">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">$</span>
                        <input type="number" min={0} value={newGroupAmount} onChange={e=>setNewGroupAmount(e.target.value)} placeholder="Amount"
                          className="w-full h-9 pl-5 pr-2 rounded-lg bg-muted/40 border border-border/60 text-[13px] text-foreground outline-none"/>
                      </div>
                      <button onClick={submitNewGroup} className="h-9 px-3 rounded-lg bg-gold text-[12px] font-semibold shrink-0">Add</button>
                      <button onClick={()=>setShowNewGroup(false)} aria-label="Cancel" className="h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground shrink-0"><X className="h-4 w-4"/></button>
                    </div>
                  </div>
                ) : (
                  <button onClick={()=>setShowNewGroup(true)} className="flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
                    <Plus className="h-3.5 w-3.5"/> New recurring entry
                  </button>
                )}
              </div>
            </div>
          )}
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

            {/* Yearly expenses now live in the Expenses section above,
                alongside Monthly expenses — this keeps "what am I saving
                for" as one consolidated view there instead of split
                between two sections. */}

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
