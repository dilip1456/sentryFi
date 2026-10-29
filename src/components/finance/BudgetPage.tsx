/**
 * BudgetPage — the "Overview" nav tab's Financial overview page.
 *
 * One consistent picture, not four different-looking widgets stapled
 * together: Income, Obligations, Expenses, Savings each render as the same
 * shape — a colored header with a total, then a flat list of entries using
 * one shared row component (EntryRow). No section gets its own bespoke
 * layout, its own two-column grid, or its own separately-styled embedded
 * component (Obligations used to mount one; it doesn't anymore — see
 * ObligationsView.tsx, which is now just a data hook).
 *
 * Every transaction lands in exactly one of those four buckets — never
 * repeated, never dropped — via a single precedence chain (isObligationTxn
 * → isSavingsTxn → isIncomeTxn → isExpenseTxn, defined below, each one
 * explicitly excluding everything above it):
 *   1. Obligations — what you owe and have to pay (mortgage, loans, etc.),
 *      matched against the user-declared obligations table.
 *   2. Savings — money moving out on purpose toward saving/investing,
 *      whether that's general savings or a pool earmarked for a specific
 *      expense category. A pool's funding transfer counts here; the actual
 *      bill it later pays still shows as its own Expense transaction —
 *      two different transactions, not one double-counted.
 *   3. Income — everything you earned. Refunds/returns are deliberately
 *      excluded (see EXPENSE_CATEGORIES/"Refund / Reimbursement" in
 *      LivePlaidDashboard.tsx) so a return never counts as income.
 *   4. Expenses — what you spent that isn't already an obligation or a
 *      savings transfer.
 *
 * There's no separate "suggestions inbox" scattered across sections either
 * — every detector (recurringIncome, obligation detection, recurringCandidates,
 * yearlyExpenseCandidates, detectedTransfers) feeds ONE running "Detected"
 * column on the right, tagged by which section it belongs to. Clicking a
 * detected row opens a review-pattern dialog showing the literal
 * transactions behind the guess, with the name/amount editable before you
 * add it — so accepting a guess always means seeing the evidence first.
 * The flag button on every detected row asks why it's wrong and remembers
 * that reason (via dismissRecurringWithReason) so the same mistake isn't
 * repeated for that merchant again, anywhere on the page.
 */

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { fmtUSD } from "@/lib/format";
import { cleanBankText, isStatementSummaryText } from "@/lib/merchant-name";
import { fmtShortDate } from "@/lib/format-date";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toast } from "sonner";
import {
  useObligations, ObligationEditModal, CoverModal, OBLIGATION_BUCKETS,
  type Obligation,
} from "@/components/finance/ObligationsView";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  TrendingUp, TrendingDown, Plus, X, ChevronDown, ChevronRight, PiggyBank, Trash2, Wallet, CalendarClock,
  ShieldAlert, RefreshCw, Search, Pencil, Check, Flag, CreditCard,
} from "lucide-react";
import type { ManualIncomeItem, SavingsGoal, RecurringGroup, AccountRoleInfo, PlannedTransfer, RecurringDismissal } from "@/hooks/useUserSettings";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PTxn { id:string; account_id:string; amount:number|string; date:string; name:string|null; merchant_name:string|null; category?:string[]|null; pending?:boolean; [k:string]:any; }
interface PAccount { id:string; account_id:string; name:string|null; official_name:string|null; type:string|null; subtype:string|null; mask?:string|null; [k:string]:any; }

interface BudgetPageProps {
  txns: PTxn[];
  accounts: PAccount[];
  internalTxnIds: Set<string>;
  getEffectiveCategory: (t: PTxn) => string;
  formatCat: (s: string) => string;
  catColor: (s: string) => string;
  isIncomeCategory: (cat: string, amount: number) => boolean;
  /** Shared classifier (src/lib/classify) — when present it decides the
   *  income/savings/expense buckets so Budget matches Home and Spending. */
  classOf?: (t: PTxn) => { type: string } | undefined;
  manualIncome: ManualIncomeItem[];
  addManualIncome: (item: { id: string; label: string; amount: number; accountId?: string }) => void;
  removeManualIncome: (id: string) => void;
  savingsGoals: SavingsGoal[];
  addSavingsGoal: (goal: { name: string; monthlyTarget: number; accountId?: string; kind?: SavingsGoal["kind"]; category?: string; obligationId?: string }) => void;
  removeSavingsGoal: (id: string) => void;
  updateSavingsGoal: (id: string, patch: Partial<Omit<SavingsGoal, "id"|"createdAt">>) => void;
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
  // Wipes the entire "don't suggest this again" blacklist — every detector
  // on the page shares it, so if it's ever grown to swallow everything
  // (e.g. leftover from testing, or a merchant name that matches too
  // broadly), this is the one button that unsticks all of them at once.
  clearRecurringDismissals: () => void;
  // Flags a detected candidate as wrong, with why — persisted so the same
  // merchant is never suggested again and the reason is kept for review.
  dismissRecurringWithReason: (entry: RecurringDismissal) => void;
  // Wipes budgets/recurringGroups/savingsGoals so the page can be rebuilt
  // clean under a reworked model instead of mixing with stale tracked data.
  resetBudgetTracking: () => void;
  // Per-category hard budget limits — editable right here (an inline control
  // on each expanded category row) as well as from the separate Spending &
  // Budget categories panel, both writing to the same settings record. When
  // a category's actual spend passes its budget, Expenses prompts "which
  // account covers it," reusing the same predicted-account infra that
  // already backs that flow elsewhere in the app.
  budgets: Record<string, number>;
  setBudget: (category: string, amount: number) => void;
  removeBudget: (category: string) => void;
  accountRoles: Record<string, AccountRoleInfo>;
  overageFundingPrefs: Record<string, string>;
  plannedTransfers: PlannedTransfer[];
  confirmOverageFunding: (t: Omit<PlannedTransfer, "id"|"createdAt"|"done">) => void;
  dismissTransfer: (id: string) => void;
  // Credit-card autopay mapping — which everyday account is set up to pay
  // each credit card's balance, the way the user already tracks it by hand.
  cardAutopayFrom: Record<string, string>;
  setCardAutopayFrom: (cardAccountId: string, fundingAccountId: string) => void;
  removeCardAutopayFrom: (cardAccountId: string) => void;
  // Opens the app's existing rich transaction-edit modal (category, name,
  // notes, tags, recurring flag, splits) — reused here rather than building
  // a second editor, so a transaction edited from the category popup behaves
  // identically to editing it from Spending.
  onOpenTxnDetail?: (t: PTxn) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SAVINGS_KW = ["transfer","savings","invest","brokerage","fidelity","vanguard","schwab","robinhood","betterment","wealthfront","ally","marcus","sofi","acorns","stash","contribution","deposit to"];
const matchKw = (m: string, kws: string[]) => { const s = m.toLowerCase(); return kws.some(k => s.includes(k)); };
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
// "N of last 12 months" must count MONTHS, not deposits (two paychecks a
// month used to read "22 of last 12 months").
const distinctMonths = (dates: string[]) => new Set(dates.map(x => x.slice(0, 7))).size;
const isTransferLikeCategory = (cat: string) => /transfer|credit card payment|loan payment/i.test(cat);
// Evidence check shared by every detector below: same merchant repeating
// isn't enough on its own — a "recurring" pattern where the amount swings
// wildly isn't a real pattern, it's a coincidence of merchant naming. Caps
// how far the largest occurrence can be from the smallest.
const amountsConsistent = (amounts: number[], maxRatio: number) => {
  const abs = amounts.map(Math.abs).filter(a => a > 0);
  if (abs.length === 0) return false;
  return Math.max(...abs) / Math.min(...abs) <= maxRatio;
};

// The most frequent value in a list, or undefined if the list is empty —
// used to guess "which account" for a detected pattern from whichever
// account its underlying transactions actually hit most often.
function mostCommon(values: string[]): string | undefined {
  if (values.length === 0) return undefined;
  const counts: Record<string, number> = {};
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
  return Object.entries(counts).sort((a,b) => b[1]-a[1])[0][0];
}

// Discretionary, spend-as-you-go categories — even if the same restaurant or
// grocery store shows up on a consistent cadence for months, that's a
// spending habit already tracked under Expenses, not a bill worth surfacing
// as a "recurring" detection. Only genuine fixed/scheduled bills should ever
// show up as detected recurring candidates.
const DISCRETIONARY_CATEGORIES = ["food & drink", "groceries", "shopping", "travel", "entertainment"];
// Gambling is adhoc by nature no matter how regular it looks, regardless of
// which category it happens to land in.
const GAMBLING_KEYWORDS = [
  "casino","sportsbook","draftkings","fanduel","betmgm","caesars","bet365",
  "lottery","lotto","poker","wager","bovada","betrivers",
];
// A real subscription/membership can be filed under a discretionary-sounding
// category (Netflix/Spotify often land under "Entertainment") but is still a
// genuine recurring bill — pull those back out of the exclusion.
const DISCRETIONARY_OVERRIDE_KEYWORDS = [
  "netflix","spotify","hulu","disney+","hbo max","paramount+","peacock",
  "amazon prime","apple tv","apple music","youtube premium","gym","fitness",
];
const isDiscretionarySpend = (cat: string, merchantName: string): boolean => {
  const c = cat.toLowerCase();
  const n = merchantName.toLowerCase();
  if (GAMBLING_KEYWORDS.some(k => n.includes(k))) return true;
  if (!DISCRETIONARY_CATEGORIES.includes(c)) return false;
  return !DISCRETIONARY_OVERRIDE_KEYWORDS.some(k => n.includes(k));
};

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
  // Shared cleanup (ACH keys, confirmation/reference numbers, card masks,
  // "PURCHASE AUTHORIZED ON" prefixes) — see src/lib/merchant-name.ts.
  return cleanBankText(raw) || raw;
}
// The pre-shared-cleanup key, so merchants a user already dismissed under
// the old normalization stay dismissed.
function legacyMerchantKey(raw: string): string {
  let name = raw
    .replace(/\s*(?:#|no\.?|ref|trace|conf|id)[:#]?\s*[a-z0-9-]{4,}\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (name === name.toUpperCase() && /[A-Z]/.test(name)) {
    name = name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  return (name || raw).toLowerCase().trim();
}

// Single-sighting charges only count as "yearly" when they look like a
// real annual bill — otherwise any one big purchase (a couch, a flight)
// was being budgeted as a monthly set-aside.
const ANNUAL_HINT_RE = /insurance|premium|renewal|annual|yearly|membership|registration|\bdmv\b|license|tax|tuition|subscription|domain|costco|sam'?s club|amazon prime|\baaa\b|\bhoa\b|property/i;
const ANNUAL_HINT_CATS = /insurance|subscription|tax|fees|education|bills/i;

// Every account reference on this page (income source, obligation funding,
// recurring bill, savings destination, card autopay) resolves through this
// one lookup, so "which account" always reads the same way — the nickname if
// set, otherwise Plaid's name, with the last-4 mask appended when present.
// This is the one piece your Excel sheet has that the app didn't: knowing
// WHERE the money actually sits, not just which category it's in.
function accountLabel(accounts: PAccount[], accountId?: string | null): string | null {
  if (!accountId) return null;
  const a = accounts.find(x => x.account_id === accountId);
  if (!a) return null;
  const name = a.name ?? a.official_name ?? "Account";
  return a.mask ? `${name} ···${a.mask}` : name;
}

// A compact inline "Account" select used anywhere an entry needs to be tied
// to a specific account — income source, recurring bill, credit card
// autopay. Renders as plain text once a choice is made isn't needed here;
// callers decide when to show the picker vs. the resolved label.
function AccountPicker({ accounts, value, onChange, placeholder = "Which account?", filter }: {
  accounts: PAccount[]; value: string; onChange: (id: string) => void; placeholder?: string;
  filter?: (a: PAccount) => boolean;
}) {
  const list = filter ? accounts.filter(filter) : accounts;
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="h-9 px-2 rounded-lg bg-muted/40 border border-border/60 text-[12px] text-foreground outline-none">
      <option value="">{placeholder}</option>
      {list.map(a => (
        <option key={a.account_id} value={a.account_id}>
          {(a.name ?? a.official_name ?? "Account") + (a.mask ? ` ···${a.mask}` : "")}
        </option>
      ))}
    </select>
  );
}

// A collapsible section shell — colored icon chip, total on the right,
// chevron to collapse. Every one of the four buckets in the main ledger
// uses this exact shell, so switching sections never means re-learning a
// new layout.
function SectionShell({ icon: Icon, label, sublabel, color, bg, total, totalLabel, totalIsCount, defaultOpen = true, children }: {
  icon: React.ElementType; label: string; sublabel: string; color: string; bg: string;
  total?: number; totalLabel?: string; totalIsCount?: boolean; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/60">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/20">
        <div className={cn("h-8 w-8 rounded-xl flex items-center justify-center shrink-0", bg)}>
          <Icon className={cn("h-4 w-4", color)} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-foreground">{label}</p>
          <p className="text-[11px] text-muted-foreground">{sublabel}</p>
        </div>
        {total !== undefined && (
          <div className="text-right shrink-0">
            <p className="text-[15px] font-bold tabular text-foreground">{totalIsCount ? total : fmtUSD(total)}</p>
            {totalLabel && <p className="text-[10px] text-muted-foreground">{totalLabel}</p>}
          </div>
        )}
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground/60 shrink-0 transition-transform ml-1", open && "rotate-180")} />
      </button>
      {open && <div className="border-t border-border/40">{children}</div>}
    </div>
  );
}

// A small uppercase label marking a subgroup inside a section (e.g.
// "Categories" / "Recurring bills" / "Yearly" under Expenses) — text only,
// no box, no second collapse toggle. The section itself is the only thing
// that collapses; subgroups just sit there as plain, always-visible lists.
function SubLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">{children}</p>;
}

// Which of the four buckets a detected candidate lands in. The detector's
// guess is only a default — every candidate can be redirected to any bucket
// before it's added, since a detector can be confident about "this repeats"
// while still being wrong about "this is an obligation" vs "this is just a
// savings transfer."
type Section = "income" | "obligations" | "expenses" | "savings";

// Colors/labels for each bucket, reused both for the small tag on every
// detected row and for the bucket-switch control inside its Add dialog.
const SECTION_TAG: Record<Section, { label: string; className: string }> = {
  income:      { label: "Income",      className: "bg-emerald-500/15 text-emerald-400" },
  obligations: { label: "Obligation",  className: "bg-blue-500/15 text-blue-400" },
  expenses:    { label: "Expense",     className: "bg-rose-500/15 text-rose-400" },
  savings:     { label: "Savings",     className: "bg-violet-500/15 text-violet-400" },
};

// Quick-pick reasons for why a detected candidate is wrong — covers the
// common cases without forcing free text every time; "Other" reveals a note.
const FLAG_REASONS = ["Not recurring", "Wrong category", "Not mine", "One-time purchase", "Other"];

// Every detected-but-unconfirmed row (income, obligation, recurring bill,
// yearly expense, savings transfer) gets one of these instead of a plain
// dismiss — capturing why turns "ignore this" into "stop guessing this
// way," since the reason is what gets remembered, not just the merchant name.
function FlagIncorrectButton({ itemName, onSubmit }: { itemName: string; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState(FLAG_REASONS[0]);
  const [note, setNote] = useState("");
  return (
    <AlertDialog onOpenChange={(o) => { if (o) { setReason(FLAG_REASONS[0]); setNote(""); } }}>
      <AlertDialogTrigger asChild>
        <button aria-label={`Ignore ${itemName}`}
          className="h-7 px-2 rounded-lg text-[10.5px] font-medium text-muted-foreground/60 hover:text-negative transition-colors shrink-0 flex items-center gap-1">
          <Flag className="h-3 w-3" /> Ignore
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ignore "{itemName}"?</AlertDialogTitle>
          <AlertDialogDescription>Say why, so the detector won't make this mistake for it again.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-wrap gap-1.5 py-1">
          {FLAG_REASONS.map(r => (
            <button key={r} type="button" onClick={()=>setReason(r)}
              className={cn("h-7 px-2.5 rounded-lg border text-[11.5px] font-medium transition-colors",
                reason===r ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]" : "border-border/60 text-muted-foreground hover:text-foreground")}>
              {r}
            </button>
          ))}
        </div>
        {reason === "Other" && (
          <textarea autoFocus value={note} onChange={e=>setNote(e.target.value)} placeholder="What happened?"
            className="w-full h-16 px-2.5 py-2 rounded-lg bg-muted/40 border border-border/60 text-[12.5px] text-foreground outline-none resize-none"/>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={()=>onSubmit(reason === "Other" ? (note.trim() || "Other") : reason)}>Ignore</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// One detected-but-unconfirmed row. Every candidate on the page — no matter
// which section it belongs to — renders through this same component in the
// single "Detected" column, with a small colored tag marking the detector's
// guess at its destination. The row itself (and the Add button) opens a
// dialog showing the literal transactions that triggered the detection,
// with editable name/amount AND a bucket switcher — a detector can be
// right that something repeats while still guessing wrong about which of
// the four buckets it belongs in, so that's always changeable before
// adding. "Ignore" (not a bare icon) asks why and remembers it.
function DetectedRow({ name, note, detail, amount, txns, section, onAccept, onFlag }: {
  name: string; note?: string; detail: string; amount: number;
  txns?: { date: string; amount: number }[];
  section: Section;
  onAccept: (editedName: string, editedAmount: number, section: Section) => void; onFlag: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editName, setEditName] = useState(name);
  const [editAmt, setEditAmt] = useState(String(Math.round(amount)));
  const [editSection, setEditSection] = useState<Section>(section);
  const openReview = () => { setEditName(name); setEditAmt(String(Math.round(amount))); setEditSection(section); setOpen(true); };
  const confirm = () => {
    const amt = parseFloat(editAmt);
    onAccept(editName.trim() || name, isNaN(amt) || amt <= 0 ? amount : amt, editSection);
    setOpen(false);
  };
  const tag = SECTION_TAG[section];
  return (
    <>
      <div className="flex flex-col gap-1 px-3 py-2.5">
        <button onClick={openReview} className="w-full text-left">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            <span className={cn("text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0", tag.className)}>{tag.label}</span>
            <p className="text-[12.5px] text-foreground font-medium leading-snug break-words">{name} {note && <span className="text-[10px] text-muted-foreground font-normal">· {note}</span>}</p>
          </div>
          <p className="text-[10.5px] text-muted-foreground leading-snug break-words">{detail}</p>
        </button>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className="text-[12.5px] font-semibold tabular text-foreground">{fmtUSD(amount)}</p>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={openReview}
              className="h-7 px-3 rounded-lg border border-[hsl(var(--primary)/0.4)] text-[10.5px] font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.08)] transition-colors whitespace-nowrap">
              Add
            </button>
            <FlagIncorrectButton itemName={name} onSubmit={onFlag} />
          </div>
        </div>
      </div>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{name}</AlertDialogTitle>
            <AlertDialogDescription>Why this looks like a pattern:</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-[13px] text-foreground -mt-2">{detail}</p>
          {txns && txns.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-1.5">
                Transactions behind this pattern ({txns.length})
              </p>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border/40 divide-y divide-border/20">
                {txns.slice().sort((a,b)=>b.date.localeCompare(a.date)).map((t,i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-1.5 text-[12px]">
                    <span className="text-muted-foreground">{fmtShortDate(t.date)}</span>
                    <span className="font-medium tabular text-foreground">{fmtUSD(Math.abs(t.amount))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-1.5">Add as</p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(SECTION_TAG) as Section[]).map(s => (
                <button key={s} type="button" onClick={()=>setEditSection(s)}
                  className={cn("h-7 px-2.5 rounded-lg border text-[11.5px] font-medium transition-colors",
                    editSection===s ? cn(SECTION_TAG[s].className, "border-transparent") : "border-border/60 text-muted-foreground hover:text-foreground")}>
                  {SECTION_TAG[s].label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input autoFocus value={editName} onChange={e=>setEditName(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter") confirm(); }}
              className="flex-1 min-w-0 h-9 px-2.5 rounded-lg bg-muted/40 border border-border/60 text-[13px] text-foreground outline-none"/>
            <div className="relative w-28 shrink-0">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">$</span>
              <input type="number" min={0} value={editAmt} onChange={e=>setEditAmt(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter") confirm(); }}
                className="w-full h-9 pl-5 pr-2 rounded-lg bg-muted/40 border border-border/60 text-[13px] text-foreground outline-none"/>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirm}>Add</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// The one row shape every confirmed/tracked entry uses across all four
// sections — label, optional mini indicator, amount, chevron. Detail
// (delete button, progress, links) lives behind the chevron instead of
// cluttering the row.
function EntryRow({ label, sublabel, indicator, amount, accentClass, expanded, onToggle, children }: {
  label: string;
  // A small second line under the label — used across every section for
  // "which account" (Paid from Citi Checking ···1234), so that fact never
  // has to be hidden behind the expand chevron the way it used to be.
  sublabel?: React.ReactNode;
  indicator?: React.ReactNode; amount: number; accentClass?: string;
  expanded: boolean; onToggle: () => void; children?: React.ReactNode;
}) {
  return (
    <div>
      <button onClick={onToggle} className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-muted/10 transition-colors">
        <span className="flex-1 min-w-0 text-left">
          <span className="block text-[12.5px] font-medium text-foreground truncate">{label}</span>
          {sublabel && <span className="block text-[10px] text-muted-foreground/70 truncate">{sublabel}</span>}
        </span>
        {indicator}
        <span className={cn("text-[12.5px] font-semibold tabular shrink-0 text-right", accentClass ?? "text-foreground")}>{fmtUSD(amount)}</span>
        <ChevronDown className={cn("h-3 w-3 text-muted-foreground/40 shrink-0 transition-transform", expanded && "rotate-180")}/>
      </button>
      {expanded && <div className="px-4 pb-2.5">{children}</div>}
    </div>
  );
}

// A shared confirm-before-remove control for every "Trash2" delete button in
// this page (savings goals, manual income, recurring entries, obligations).
// These are budgeting metadata, not irreversible account actions, so one
// lightweight AlertDialog is enough — no typed confirmation needed.
function ConfirmDeleteButton({ label, itemName, onConfirm, className, iconClassName }: {
  label: string; itemName: string; onConfirm: () => void; className?: string; iconClassName?: string;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button aria-label={label} className={className}><Trash2 className={iconClassName ?? "h-3 w-3"} /></button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove "{itemName}"?</AlertDialogTitle>
          <AlertDialogDescription>This removes it from your budget tracking. You can add it again later if you change your mind.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// A small "Link to category →" affordance for any Planned Savings pool that
// isn't tied to an expense category yet — turning a plain recurring transfer
// or obligation funding plan into something that can also pay for a category,
// with the carry-over balance tracking that comes with a link.
function LinkToCategoryControl({ goal, categories, formatCat, onLink }: {
  goal: SavingsGoal; categories: string[]; formatCat: (s: string) => string;
  onLink: (id: string, patch: Partial<Omit<SavingsGoal, "id"|"createdAt">>) => void;
}) {
  const [open, setOpen] = useState(false);
  if (goal.category) return null;
  return open ? (
    <select autoFocus defaultValue="" onChange={e => { if (e.target.value) onLink(goal.id, { category: e.target.value }); setOpen(false); }}
      onBlur={() => setOpen(false)}
      className="h-7 max-w-[140px] rounded-lg bg-muted/40 border border-border/60 text-[10.5px] text-foreground outline-none shrink-0">
      <option value="" disabled>Pick a category…</option>
      {categories.map(c => <option key={c} value={c}>{formatCat(c)}</option>)}
    </select>
  ) : (
    <button onClick={() => setOpen(true)} className="text-[10px] text-[hsl(var(--primary))] font-medium hover:underline shrink-0 whitespace-nowrap">
      Link to category
    </button>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function BudgetPage({
  txns, accounts, internalTxnIds, getEffectiveCategory, formatCat, catColor, isIncomeCategory, classOf,
  manualIncome, addManualIncome, removeManualIncome,
  savingsGoals, addSavingsGoal, removeSavingsGoal, updateSavingsGoal,
  recurringOverrides, recurringGroups, addRecurringGroup, removeRecurringGroup, updateRecurringGroup, addTxnToRecurringGroup, removeTxnFromRecurringGroup,
  dismissedRecurring, dismissRecurring, dismissRecurringWithReason, clearRecurringDismissals, resetBudgetTracking,
  budgets, setBudget, removeBudget, accountRoles, overageFundingPrefs, plannedTransfers, confirmOverageFunding, dismissTransfer,
  cardAutopayFrom, setCardAutopayFrom, removeCardAutopayFrom, onOpenTxnDetail,
}: BudgetPageProps) {
  const now = new Date();
  const thisMonth = monthKey(now);

  const [confirmingReset, setConfirmingReset] = useState(false);

  // Shared "don't suggest this again" blacklist — reused by every detector
  // on the page, including obligations, so flagging a merchant wrong
  // anywhere sticks everywhere.
  const dismissedRecurringSet = useMemo(() => new Set(dismissedRecurring.map(m => m.toLowerCase())), [dismissedRecurring]);
  const isDismissedMerchant = useCallback((raw: string) =>
    dismissedRecurringSet.has(cleanMerchantName(raw).toLowerCase().trim()) ||
    dismissedRecurringSet.has(legacyMerchantKey(raw)) ||
    dismissedRecurringSet.has(raw.toLowerCase().trim()), [dismissedRecurringSet]);
  // Only real spend can be a bill or recurring expense — never a transfer
  // between your own accounts (e.g. "Zelle to <you>"), a card payment or a
  // savings move. Uses the shared classifier when available.
  const isSpendLike = useCallback((t: PTxn) => {
    const c = classOf?.(t);
    return !c || c.type === "spend" || c.type.startsWith("obligation_");
  }, [classOf]);

  // ── Obligations data — see ObligationsView.tsx. Fetched here (not inside
  // a separate mounted component) so its rows can render with the exact
  // same EntryRow/DetectedRow the rest of the page uses, and so Expenses
  // can exclude obligation-covered spend from its own total instead of
  // double-counting a mortgage payment as both an "obligation" and a
  // "housing expense". ──
  const {
    obligations, spentMap: obligationSpentMap, exceeded: obligationsExceeded, detected: obligationsDetected,
    addObligation, updateObligation, removeObligation, userId: obligationsUserId,
  } = useObligations(txns, getEffectiveCategory, thisMonth, dismissedRecurringSet, classOf);

  // Removing an obligation — whether it was auto-added (high-confidence
  // Fixed detection) or added by hand — also blacklists its merchant, same
  // as every other "remove" on this page. Without this, an auto-added
  // obligation would just get re-detected and re-added right back on the
  // next render, making "remove" a no-op for exactly the entries that
  // arrived without the user asking for them.
  const removeObligationAndDismiss = useCallback((ob: { id: string; name: string; merchant_hint?: string | null }) => {
    removeObligation(ob.id);
    dismissRecurring(ob.merchant_hint || ob.name);
  }, [removeObligation, dismissRecurring]);

  const isObligationTxn = useCallback((t: PTxn) => {
    const nm = (t.merchant_name ?? t.name ?? "").toLowerCase();
    if (!nm) return false;
    return obligations.some(ob => (ob.merchant_hint ?? "").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean).some(hint => nm.includes(hint)));
  }, [obligations]);

  // Every transaction id already tracked under a named recurring budget entry.
  const groupedTxnIdSet = useMemo(() => new Set(recurringGroups.flatMap(g => g.txnIds)), [recurringGroups]);

  // ── Single source of truth for the four buckets ────────────────────────
  // Every transaction is EXACTLY one of: Obligation, Savings, Income, or
  // Expense — never more than one, never none (aside from internal
  // transfers between the user's own accounts, which aren't real economic
  // activity and are excluded from all four). Precedence matters: each
  // predicate below explicitly excludes everything higher up the list
  // before applying its own test, so calling any one of them in isolation
  // is always safe and never double-counts against the others.
  //   1. Obligation  — matches a user-declared bill/debt (merchant hint)
  //   2. Savings     — money moving out toward savings/investing (keyword
  //                    or destination-account heuristic; a "linked pool"
  //                    transfer lands here, while the later spend it funds
  //                    still shows as its own Expense transaction — two
  //                    different transactions, not one double-counted)
  //   3. Income      — category-assigned income (refunds/returns are
  //                    classified as an expense-side category, see
  //                    EXPENSE_CATEGORIES in LivePlaidDashboard.tsx, so
  //                    they can never reach this bucket)
  //   4. Expense     — everything else
  const isSavingsTxn = useCallback((t: PTxn) => {
    if (internalTxnIds.has(t.id)) return false;
    if (isObligationTxn(t)) return false;
    // Only an outflow (money leaving this account) counts as "setting
    // money aside" — an incoming transfer/deposit is handled by the
    // Income bucket instead.
    if (Number(t.amount) <= 0) return false;
    // The shared classifier judges savings by the DESTINATION account of a
    // matched transfer (the old check below looked at the source account).
    if (classOf) { const c = classOf(t); if (c) return c.type === "savings_contribution"; }
    const merchant = t.merchant_name ?? t.name ?? "";
    const cat = getEffectiveCategory(t) ?? "Other";
    const acc = accounts.find(a => a.account_id === t.account_id);
    const toSavingsAccount = acc?.subtype === "savings" || acc?.subtype === "money market";
    // "transfer" alone is too generic a word (catches Venmo/Zelle
    // person-to-person expenses) — only trust it when the category itself
    // also looks transfer-like. The named-institution keywords are
    // specific enough to trust on their own.
    const strongKwMatch = matchKw(merchant, SAVINGS_KW.filter(k => k !== "transfer"));
    const weakTransferMatch = matchKw(merchant, ["transfer"]) && isTransferLikeCategory(cat);
    return strongKwMatch || weakTransferMatch || toSavingsAccount;
  }, [internalTxnIds, isObligationTxn, getEffectiveCategory, accounts, classOf]);

  const isIncomeTxn = useCallback((t: PTxn) => {
    if (internalTxnIds.has(t.id)) return false;
    if (isObligationTxn(t)) return false;
    if (isSavingsTxn(t)) return false;
    if (classOf) { const c = classOf(t); if (c) return c.type.startsWith("income_"); }
    return isIncomeCategory(getEffectiveCategory(t) ?? "Other", Number(t.amount));
  }, [internalTxnIds, isObligationTxn, isSavingsTxn, isIncomeCategory, getEffectiveCategory, classOf]);

  // Expenses = non-obligation, non-income spend. Recurring bills used to be
  // excluded here and given their own top-level section — but a Netflix
  // charge is still Entertainment spend, and splitting it out made every
  // category total look incomplete. Recurring-ness is now shown as an
  // annotation on the category row (via recurringGroupsByCategory below)
  // instead of forking the money into a second, redundant section.
  const isExpenseTxn = useCallback((t: PTxn) => {
    if (internalTxnIds.has(t.id)) return false;
    if (isObligationTxn(t)) return false;
    if (isSavingsTxn(t)) return false;
    if (classOf) {
      const c = classOf(t);
      if (c) return c.type === "spend" || c.type === "refund" || c.type.startsWith("obligation_");
    }
    const cat = getEffectiveCategory(t) ?? "Other";
    return !isIncomeCategory(cat, Number(t.amount)) && !isTransferLikeCategory(cat);
  }, [internalTxnIds, isObligationTxn, isSavingsTxn, getEffectiveCategory, isIncomeCategory, classOf]);

  // Pending rows count, same as Home and Spending (they're real spend that
  // just hasn't posted yet).
  const monthTxns = useMemo(() => txns.filter(t => t.date.startsWith(thisMonth)), [txns, thisMonth]);
  // Income actually received this month (shared definition) — shown next to
  // the planned income from tracked sources so the two aren't confused.
  const receivedThisMonth = useMemo(
    () => monthTxns.filter(isIncomeTxn).reduce((s, t) => s - Number(t.amount), 0),
    [monthTxns, isIncomeTxn],
  );

  // Records why a detected candidate was wrong, then dismisses it the same
  // way a plain dismiss would (same blacklist, so it's never suggested
  // again) — the only difference is the reason gets kept.
  const flagIncorrect = useCallback((merchant: string, category: string | undefined, reason: string) => {
    dismissRecurringWithReason({ merchant, category, reason, at: new Date().toISOString() });
  }, [dismissRecurringWithReason]);

  // ── Income ───────────────────────────────────────────────────────────────
  // This page shows patterns and what's been set up, not a live mirror of
  // every raw transaction — a one-off deposit that hasn't repeated enough
  // to be a real pattern doesn't get a line item here. It'll show up in
  // the Detected column once it does (recurringIncome below), or you can
  // just add it as a source. The total only ever reflects what's actually
  // listed: tracked/confirmed sources.
  // Recurring sources over a 6-month lookback (long enough to catch
  // quarterly/irregular income too).
  // Groups by a NORMALIZED merchant key (lowercased, trailing reference/trace
  // numbers stripped) — the raw literal string was the bug that made this
  // detector find almost nothing. Payroll/ACH deposits routinely carry a
  // different batch or trace number every pay period ("ACH PAYROLL DEP
  // 88213" vs "...88214"), so grouping by the literal string kept every
  // single deposit in its own bucket of one and never reached the "seen
  // twice" threshold. A full 12-month lookback (was 7) so a monthly or even
  // irregular/quarterly income source has enough history to prove itself.
  const recurringIncome = useMemo(() => {
    const merchantTotals: Record<string, { display: string; dates: string[]; amounts: number[]; ids: string[]; accountIds: string[] }> = {};
    for (let i = 0; i <= 11; i++) {
      // Day 1 of each month: stepping "today" back on the 31st skips months (Oct 31 − 1 mo = "Sep 31" = Oct 1).
      const now = new Date(); const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const key = monthKey(d);
      for (const t of txns.filter(x => x.date.startsWith(key) && isIncomeTxn(x))) {
        const raw = t.merchant_name ?? t.name ?? "Deposit";
        if (isStatementSummaryText(raw)) continue;
        const cleaned = cleanMerchantName(raw);
        const mkey = cleaned.toLowerCase().trim();
        if (isDismissedMerchant(raw)) continue;
        if (!merchantTotals[mkey]) merchantTotals[mkey] = { display: cleaned, dates: [], amounts: [], ids: [], accountIds: [] };
        merchantTotals[mkey].dates.push(t.date);
        merchantTotals[mkey].amounts.push(Math.abs(Number(t.amount)));
        merchantTotals[mkey].ids.push(t.id);
        if (t.account_id) merchantTotals[mkey].accountIds.push(t.account_id);
      }
    }
    return Object.entries(merchantTotals)
      // Evidence: at least 2 deposits, and not wildly different amounts —
      // two same-named deposits of $50 and $4,000 aren't the same pattern.
      // Two deposits in the same month are a one-off, not a monthly source.
      .filter(([,d]) => d.dates.length >= 2 && distinctMonths(d.dates) >= 2 && amountsConsistent(d.amounts, 2.5))
      .map(([,d]) => {
        const perDeposit = d.amounts.reduce((s,v)=>s+v,0)/d.amounts.length;
        // Cadence decides the monthly figure: a biweekly paycheck is ~2.17
        // deposits a month, not one. Irregular sources average over the span.
        const sorted = [...d.dates].sort();
        const gaps = sorted.slice(1).map((x, i) => (Date.parse(x) - Date.parse(sorted[i])) / 86400000);
        const freq = gaps.length ? classifyFrequency(gaps.reduce((a,b)=>a+b,0)/gaps.length) : null;
        const months = distinctMonths(d.dates);
        if (!freq && months < 3) return null;
        const first = new Date(sorted[0] + "T00:00:00"), nowD = new Date();
        const spanMonths = Math.max(1, (nowD.getFullYear() - first.getFullYear()) * 12 + nowD.getMonth() - first.getMonth() + 1);
        const avgAmount = freq ? perDeposit * FREQ_MONTHLY_MULT[freq] : d.amounts.reduce((s,v)=>s+v,0) / spanMonths;
        // Most common destination account across the matched deposits — the
        // account this income actually lands in, not just a category guess.
        const accountId = mostCommon(d.accountIds);
        return {
          merchant: d.display, avgAmount, count: d.dates.length, txnIds: d.ids, accountId,
          txns: d.dates.map((date,i) => ({ date, amount: d.amounts[i] })),
          reason: freq
            ? `${FREQ_LABEL[freq]}, ${fmtUSD(perDeposit)} each ≈ ${fmtUSD(avgAmount)}/mo · ${months} of last 12 months`
            : `Irregular, ≈ ${fmtUSD(avgAmount)}/mo · ${months} of last 12 months`,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a,b) => b.avgAmount-a.avgAmount);
  }, [txns, isIncomeTxn, isDismissedMerchant]);

  const manualIncomeTotal = manualIncome.reduce((s,m)=>s+m.amount,0);
  const totalMonthlyIncome = manualIncomeTotal;

  const [showAddIncome, setShowAddIncome] = useState(false);
  const [incomeLabel, setIncomeLabel] = useState("");
  const [incomeAmt, setIncomeAmt] = useState("");
  const [incomeAccountId, setIncomeAccountId] = useState("");
  const submitIncome = () => {
    const amt = parseFloat(incomeAmt);
    if (!incomeLabel.trim() || isNaN(amt) || amt <= 0) return;
    addManualIncome({ id: `mi_${Date.now()}`, label: incomeLabel.trim(), amount: amt, accountId: incomeAccountId || undefined });
    setIncomeLabel(""); setIncomeAmt(""); setIncomeAccountId(""); setShowAddIncome(false);
  };
  const [expandedIncomeId, setExpandedIncomeId] = useState<string|null>(null);

  // New linked pool, created from scratch (not promoted from a detected
  // candidate) — a pool set aside on purpose to pay a chosen category.
  const [showNewPool, setShowNewPool] = useState(false);
  const [newPoolName, setNewPoolName] = useState("");
  const [newPoolAmt, setNewPoolAmt] = useState("");
  const [newPoolCat, setNewPoolCat] = useState("");
  const [newPoolAccount, setNewPoolAccount] = useState("");
  const submitNewPool = () => {
    const amt = parseFloat(newPoolAmt);
    if (!newPoolName.trim() || !newPoolCat || isNaN(amt) || amt <= 0) return;
    addSavingsGoal({ name: newPoolName.trim(), monthlyTarget: amt, kind: "category", category: newPoolCat, accountId: newPoolAccount || undefined });
    setNewPoolName(""); setNewPoolAmt(""); setNewPoolCat(""); setNewPoolAccount(""); setShowNewPool(false);
  };

  // ── Expenses: this month's categorized spend, excluding anything already
  // covered by an Obligation. ──
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

  // Which category a tracked recurring bill "belongs to," so its category
  // row can note "includes this recurring bill" instead of the bill living
  // in an entirely separate section.
  const recurringGroupCategory = useCallback((g: RecurringGroup) => {
    const cats = g.txnIds
      .map(id => txns.find(t => t.id === id))
      .filter((t): t is PTxn => !!t)
      .map(t => getEffectiveCategory(t) ?? "Other");
    if (cats.length === 0) return null;
    const counts: Record<string, number> = {};
    for (const c of cats) counts[c] = (counts[c] ?? 0) + 1;
    return Object.entries(counts).sort((a,b) => b[1]-a[1])[0][0];
  }, [txns, getEffectiveCategory]);
  const recurringGroupsByCategory = useMemo(() => {
    const map: Record<string, RecurringGroup[]> = {};
    for (const g of recurringGroups) {
      const cat = recurringGroupCategory(g) ?? "Other";
      (map[cat] ??= []).push(g);
    }
    return map;
  }, [recurringGroups, recurringGroupCategory]);

  // ── Cover overages: eligible funding accounts are everyday spending
  // accounts only — long-term savings/investment/debt accounts are excluded
  // on purpose so a "cover this" suggestion never quietly drains a goal. ──
  const fundingAccounts = useMemo(() => accounts.filter(a => {
    const explicit = accountRoles[a.account_id]?.role;
    const role = explicit ?? (a.type === "credit" || a.type === "loan" ? "debt" : a.type === "investment" ? "investment" : a.subtype === "checking" ? "spending" : "unassigned");
    return role !== "reserve" && role !== "savings_goal" && role !== "investment" && role !== "debt";
  }), [accounts, accountRoles]);
  const [fundAllocations, setFundAllocations] = useState<Record<string,string>>({});
  // A category row now opens a popup instead of expanding in place — the
  // inline expand made a simple list uneven and buried the actual
  // transactions behind a click. categoryPopup names which category's
  // dialog is open; catTxnSearch/catAccountFilter reset whenever a new one opens.
  const [categoryPopup, setCategoryPopup] = useState<string|null>(null);
  const [catTxnSearch, setCatTxnSearch] = useState("");
  const [catAccountFilter, setCatAccountFilter] = useState("");
  const openCategoryPopup = (cat: string) => { setCategoryPopup(cat); setCatTxnSearch(""); setCatAccountFilter(""); };
  // ── Credit cards — same "which account actually pays this" concept as
  // Obligations' funding_account_id, but for cards rather than bills. Mirrors
  // the "Credit Cards / Autopay from" block users already keep by hand.
  const creditCardAccounts = useMemo(() => accounts.filter(a => a.type === "credit"), [accounts]);
  const [expandedCardId, setExpandedCardId] = useState<string|null>(null);
  const [showAllCats, setShowAllCats] = useState(false);
  const [editingBudgetCat, setEditingBudgetCat] = useState<string|null>(null);
  const [budgetDraft, setBudgetDraft] = useState("");
  const openBudgetEditor = (cat: string, current?: number) => {
    setEditingBudgetCat(cat);
    setBudgetDraft(current != null ? String(current) : "");
  };
  const saveBudgetDraft = () => {
    if (!editingBudgetCat) return;
    const amt = parseFloat(budgetDraft);
    if (!isNaN(amt) && amt > 0) setBudget(editingBudgetCat, Math.round(amt));
    setEditingBudgetCat(null);
  };
  const [expandedYearlyId, setExpandedYearlyId] = useState<string|null>(null);
  const [expandedPoolId, setExpandedPoolId] = useState<string|null>(null);
  const [expandedObligationGoalId, setExpandedObligationGoalId] = useState<string|null>(null);
  const [expandedTransferGoalId, setExpandedTransferGoalId] = useState<string|null>(null);
  const [expandedObligationId, setExpandedObligationId] = useState<string|null>(null);

  // Every category-tallied plan already tracked, for a quick "does cat X have
  // a plan?" lookup.
  const categoryGoalFor = useCallback((cat: string) => savingsGoals.find(g => g.category === cat), [savingsGoals]);

  // A linked pool's running balance — what's been set aside for it since it
  // was created, minus what's actually been spent in the linked category
  // since then.
  const poolBalanceFor = useCallback((goal: SavingsGoal) => {
    if (!goal.category) return null;
    const created = goal.createdAt ? new Date(goal.createdAt) : new Date();
    const nowD = new Date();
    const monthsElapsed = Math.max(1, (nowD.getFullYear() - created.getFullYear()) * 12 + (nowD.getMonth() - created.getMonth()) + 1);
    const contributed = goal.monthlyTarget * monthsElapsed;
    const cutoff = created.toISOString().slice(0, 10);
    const spent = txns
      .filter(t => !t.pending && t.date >= cutoff && isExpenseTxn(t) && (getEffectiveCategory(t) ?? "Other") === goal.category)
      .reduce((s, t) => s + Number(t.amount), 0);
    return { contributed, spent, balance: contributed - spent };
  }, [txns, isExpenseTxn, getEffectiveCategory]);

  // ── Yearly / irregular expenses: same merchant seen only once or twice
  // over the last 13 months (not a monthly recurring cadence) with a
  // meaningful amount — the "insurance premium" / "annual renewal" pattern.
  const yearlyExpenseCandidates = useMemo(() => {
    const merchantTotals: Record<string, { display: string; dates: string[]; amounts: number[]; cat: string }> = {};
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth()-13);
    const cutoffStr = cutoff.toISOString().slice(0,10);
    for (const t of txns) {
      if (t.date < cutoffStr) continue;
      if (internalTxnIds.has(t.id) || isObligationTxn(t) || isSavingsTxn(t)) continue;
      const cat = getEffectiveCategory(t) ?? "Other";
      if (isIncomeCategory(cat, Number(t.amount)) || isTransferLikeCategory(cat)) continue;
      if (Number(t.amount) <= 0 || !isSpendLike(t)) continue;
      const raw = t.merchant_name ?? t.name ?? "Unknown";
      if (isStatementSummaryText(raw)) continue;
      if (isDiscretionarySpend(cat, raw)) continue;
      const cleaned = cleanMerchantName(raw);
      const mkey = cleaned.toLowerCase().trim();
      if (isDismissedMerchant(raw)) continue;
      if (!merchantTotals[mkey]) merchantTotals[mkey] = { display: cleaned, dates: [], amounts: [], cat };
      merchantTotals[mkey].dates.push(t.date);
      merchantTotals[mkey].amounts.push(Math.abs(Number(t.amount)));
    }
    return Object.entries(merchantTotals)
      // Evidence: a single sighting needs to be a meaningfully large charge
      // to be worth flagging as "annual." Two sightings need to actually be
      // roughly a year apart with a similar amount.
      .filter(([,d]) => {
        if (d.dates.length === 1) return Math.max(...d.amounts) >= 150 && (ANNUAL_HINT_RE.test(d.display) || ANNUAL_HINT_CATS.test(d.cat));
        if (d.dates.length === 2) {
          const sorted = [...d.dates].sort();
          const gapDays = (new Date(sorted[1]+"T00:00:00").getTime()-new Date(sorted[0]+"T00:00:00").getTime())/86400000;
          return Math.max(...d.amounts) >= 75 && gapDays >= 300 && gapDays <= 400 && amountsConsistent(d.amounts, 1.6);
        }
        return false;
      })
      .map(([,d]) => ({
        merchant: d.display, category: d.cat, amount: Math.max(...d.amounts), lastDate: [...d.dates].sort().slice(-1)[0],
        txns: d.dates.map((date,i) => ({ date, amount: d.amounts[i] })),
        reason: d.dates.length === 1
          ? `${fmtUSD(Math.max(...d.amounts))} once, on ${fmtShortDate([...d.dates].sort().slice(-1)[0])} · set aside ≈ ${fmtUSD(Math.max(...d.amounts)/12)}/mo`
          : `${fmtUSD(Math.max(...d.amounts))}, ~yearly · set aside ≈ ${fmtUSD(Math.max(...d.amounts)/12)}/mo`,
      }))
      .filter(y => !savingsGoals.some(g => g.kind === "yearly" && g.name === y.merchant))
      .sort((a,b) => b.amount - a.amount)
      .slice(0, 8);
  }, [txns, internalTxnIds, isObligationTxn, isSavingsTxn, getEffectiveCategory, isIncomeCategory, savingsGoals, isDismissedMerchant, isSpendLike]);

  // ── Obligations without a funding plan yet ──
  const obligationsNeedingPlan = useMemo(
    () => obligations.filter(ob => !savingsGoals.some(g => g.kind === "obligation" && g.obligationId === ob.id)),
    [obligations, savingsGoals]
  );
  const obligationsNeedingFundingAccount = useMemo(
    () => obligations.filter(ob => !ob.funding_account_id),
    [obligations]
  );

  // ── Recurring Expenses ──────────────────────────────────────────────────
  const recurringCandidates = useMemo(() => {
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth()-13);
    const cutoffStr = cutoff.toISOString().slice(0,10);
    const byMerchant: Record<string, { display: string; dates: string[]; amounts: number[]; ids: string[]; cat: string; accountIds: string[] }> = {};
    for (const t of txns) {
      if (t.date < cutoffStr) continue;
      if (internalTxnIds.has(t.id) || isObligationTxn(t) || isSavingsTxn(t)) continue;
      const cat = getEffectiveCategory(t) ?? "Other";
      if (isIncomeCategory(cat, Number(t.amount)) || isTransferLikeCategory(cat)) continue;
      const merchant = (t.merchant_name ?? t.name ?? "").trim();
      if (!merchant) continue;
      if (Number(t.amount) <= 0 || !isSpendLike(t) || isStatementSummaryText(merchant)) continue;
      if (isDiscretionarySpend(cat, merchant)) continue;
      // Normalized key (trailing reference/trace numbers stripped, not just
      // lowercased) — the same per-charge-varies-slightly problem that hid
      // recurring income also fragments recurring bills into singletons.
      const key = cleanMerchantName(merchant).toLowerCase();
      if (isDismissedMerchant(merchant)) continue;
      if (!byMerchant[key]) byMerchant[key] = { display: merchant, dates: [], amounts: [], ids: [], cat, accountIds: [] };
      byMerchant[key].dates.push(t.date);
      byMerchant[key].amounts.push(Number(t.amount));
      byMerchant[key].ids.push(t.id);
      if (t.account_id) byMerchant[key].accountIds.push(t.account_id);
    }
    const out: { key: string; merchant: string; category: string; frequency: Frequency; avgAmount: number; count: number; txnIds: string[]; txns: { date: string; amount: number }[]; reason: string; accountId?: string }[] = [];
    for (const [key, d] of Object.entries(byMerchant)) {
      // Evidence bar: at least 3 occurrences, a cadence that fits a real
      // frequency, and amounts that don't swing too far apart.
      if (d.dates.length < 3) continue;
      if (!amountsConsistent(d.amounts, 2.2)) continue;
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
        txns: d.dates.map((date,i) => ({ date, amount: d.amounts[i] })),
        reason: `${FREQ_LABEL[freq]}, ${fmtUSD(avgAmount)} every ${Math.round(avgGap)} days, seen ${d.dates.length}x`,
        accountId: mostCommon(d.accountIds),
      });
    }
    return out.sort((a,b) => b.avgAmount - a.avgAmount);
  }, [txns, internalTxnIds, isObligationTxn, isSavingsTxn, getEffectiveCategory, isIncomeCategory, groupedTxnIdSet, isDismissedMerchant, isSpendLike]);

  // ── Budget breakdown: what a category's budget is actually made up of ──
  // Detected recurring/yearly candidates already carry a `.category`, so
  // grouping them by that lets each category row show its own evidence
  // (which bills make up the number) instead of the number just floating
  // in isolation with no explanation behind it.
  const recurringCandidatesByCategory = useMemo(() => {
    const map: Record<string, typeof recurringCandidates> = {};
    for (const c of recurringCandidates) (map[c.category] ??= []).push(c);
    return map;
  }, [recurringCandidates]);
  // Yearly candidates are deliberately kept separate from the monthly list
  // above — a once-a-year premium won't show up in "this month's spend" at
  // all most months, so a budget built only from monthly data would miss it
  // entirely and then get blindsided the one month it actually posts.
  const yearlyCandidatesByCategory = useMemo(() => {
    const map: Record<string, typeof yearlyExpenseCandidates> = {};
    for (const y of yearlyExpenseCandidates) (map[y.category] ??= []).push(y);
    return map;
  }, [yearlyExpenseCandidates]);

  // Transactions explicitly marked "Is recurring? Yes" that don't fit a
  // clean cadence above and aren't tracked yet.
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

  // Recurring-bill management lives behind each entry's own expand chevron
  // (same interaction as every other section) instead of a separate
  // drill-in page that replaces the list.
  const [expandedRecurringId, setExpandedRecurringId] = useState<string|null>(null);
  const [editingRecurringHeader, setEditingRecurringHeader] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [groupFreqDraft, setGroupFreqDraft] = useState<Frequency>("monthly");
  const [groupAmountDraft, setGroupAmountDraft] = useState("");
  const [groupAccountDraft, setGroupAccountDraft] = useState("");
  const [addTxnSearch, setAddTxnSearch] = useState("");
  const expandedRecurringGroup = recurringGroups.find(g => g.id === expandedRecurringId) ?? null;
  const addTxnResults = useMemo(() => {
    const q = addTxnSearch.trim().toLowerCase();
    if (!q || !expandedRecurringGroup) return [];
    return txns
      .filter(t => !expandedRecurringGroup.txnIds.includes(t.id))
      .filter(t => (t.merchant_name ?? t.name ?? "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [addTxnSearch, expandedRecurringGroup, txns]);

  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupFreq, setNewGroupFreq] = useState<Frequency>("monthly");
  const [newGroupAmount, setNewGroupAmount] = useState("");
  const [newGroupAccount, setNewGroupAccount] = useState("");
  const submitNewGroup = () => {
    const name = newGroupName.trim();
    const amt = parseFloat(newGroupAmount);
    if (!name || isNaN(amt) || amt <= 0) return;
    addRecurringGroup({ name, frequency: newGroupFreq, expectedAmount: amt, txnIds: [], accountId: newGroupAccount || undefined });
    setNewGroupName(""); setNewGroupAmount(""); setNewGroupFreq("monthly"); setNewGroupAccount(""); setShowNewGroup(false);
  };

  // ── Planned Savings: recurring transfers to savings/investment accounts
  // (3mo lookback) — built on the same isSavingsTxn predicate that decides
  // the Savings bucket everywhere else. ──
  // Same normalized-key fix as recurringIncome, plus a full 12-month
  // lookback (was 3) — a quarterly or irregular transfer needs more than a
  // 3-month window to ever prove itself twice.
  const detectedTransfers = useMemo(() => {
    const merchantTotals: Record<string, { display: string; dates: string[]; amounts: number[]; accountId?: string }> = {};
    for (let i = 0; i < 12; i++) {
      // Day 1 of each month: stepping "today" back on the 31st skips months (Oct 31 − 1 mo = "Sep 31" = Oct 1).
      const now = new Date(); const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const key = monthKey(d);
      for (const t of txns.filter(x => x.date.startsWith(key) && isSavingsTxn(x))) {
        const raw = t.merchant_name ?? t.name ?? "Transfer";
        if (isStatementSummaryText(raw)) continue;
        const cleaned = cleanMerchantName(raw);
        const mkey = cleaned.toLowerCase().trim();
        if (!merchantTotals[mkey]) merchantTotals[mkey] = { display: cleaned, dates: [], amounts: [], accountId: t.account_id };
        merchantTotals[mkey].dates.push(t.date);
        merchantTotals[mkey].amounts.push(Number(t.amount));
      }
    }
    return Object.entries(merchantTotals)
      .filter(([,d]) => d.dates.length >= 2 && distinctMonths(d.dates) >= 2 && amountsConsistent(d.amounts, 2.2))
      .map(([,d]) => ({
        merchant: d.display, avgAmount: d.amounts.reduce((s,v)=>s+v,0)/d.amounts.length, count: d.dates.length, accountId: d.accountId,
        txns: d.dates.map((date,i) => ({ date, amount: d.amounts[i] })),
      }))
      .filter(d => !savingsGoals.some(g => (g.kind ?? "transfer") === "transfer" && g.name === d.merchant))
      .filter(d => !isDismissedMerchant(d.merchant))
      .sort((a,b) => b.avgAmount-a.avgAmount);
  }, [txns, isSavingsTxn, savingsGoals, isDismissedMerchant]);

  // ── Auto-add when confident ──────────────────────────────────────────────
  // Extends the pattern ObligationsView already uses for Fixed bills (see
  // its own useEffect) to the other three detectors on this page. Showing up
  // in the Detected column means "this looks like a pattern, please
  // confirm" — auto-add instead requires evidence tight enough that
  // confirming would almost always just mean clicking Add anyway, so that
  // step is skipped and the entry is created directly. Anything less certain
  // — a subscription whose amount moves around, a single-sighting "annual"
  // charge, a savings transfer seen only twice — stays in Detected for a
  // human call. The bar is deliberately tighter than what gets something
  // surfaced for review in the first place (see each detector's own
  // evidence threshold above).
  // Guarded by a ref rather than trusting the memos alone, since this effect
  // can re-fire before manualIncome/recurringGroups/savingsGoals reflect the
  // add that just happened.
  const pendingAutoAdd = useRef<Set<string>>(new Set());
  useEffect(() => {
    const claim = (key: string) => {
      if (pendingAutoAdd.current.has(key)) return false;
      pendingAutoAdd.current.add(key);
      return true;
    };

    // Income: 3+ of the last 12 months, amounts within 20% of each other —
    // payroll routinely wobbles a little (overtime, withholding changes)
    // even when it's genuinely the same recurring source.
    for (const r of recurringIncome) {
      if (r.count < 3 || !amountsConsistent(r.txns.map(t => t.amount), 1.2)) continue;
      if (!claim(`income:${r.merchant.toLowerCase()}`)) continue;
      addManualIncome({ id: `mi_${Date.now()}`, label: r.merchant, amount: r.avgAmount, accountId: r.accountId });
      dismissRecurring(r.merchant);
    }

    // Recurring bills: only the monthly cadence (the cleanest "bill" shape)
    // with amounts within 15% of each other — weekly/biweekly/quarterly
    // patterns stay manual, since those are more often ordinary recurring
    // spend than a fixed bill.
    for (const c of recurringCandidates) {
      if (c.frequency !== "monthly" || !amountsConsistent(c.txns.map(t => t.amount), 1.15)) continue;
      if (!claim(`recurring:${c.key}`)) continue;
      addRecurringGroup({ name: c.merchant, frequency: c.frequency, expectedAmount: Math.round(c.avgAmount), txnIds: c.txnIds, accountId: c.accountId });
      dismissRecurring(c.merchant);
    }

    // Yearly: only the two-sighting case — a single sighting is
    // definitionally unconfirmed — with amounts within 30% of each other,
    // tighter than the 60% bar that just gets it surfaced for review.
    for (const y of yearlyExpenseCandidates) {
      if (y.txns.length !== 2 || !amountsConsistent(y.txns.map(t => t.amount), 1.3)) continue;
      if (!claim(`yearly:${y.merchant.toLowerCase()}`)) continue;
      addSavingsGoal({ name: y.merchant, monthlyTarget: Math.round(y.amount), kind: "yearly" });
      dismissRecurring(y.merchant);
    }

    // Savings transfers: 3+ occurrences (tighter than the 2 needed to
    // surface it) at a near-fixed amount — the classic "same amount, same
    // schedule" auto-transfer, as opposed to ad hoc top-ups of varying size.
    for (const d of detectedTransfers) {
      if (d.count < 3 || !amountsConsistent(d.txns.map(t => t.amount), 1.15)) continue;
      if (!claim(`savings:${d.merchant.toLowerCase()}`)) continue;
      addSavingsGoal({ name: d.merchant, monthlyTarget: Math.round(d.avgAmount), accountId: d.accountId, kind: "transfer" });
      dismissRecurring(d.merchant);
    }
  }, [recurringIncome, recurringCandidates, yearlyExpenseCandidates, detectedTransfers, addManualIncome, addRecurringGroup, addSavingsGoal, dismissRecurring]);

  // Any pool linked to an expense category — regardless of what kind it
  // started life as — gets the carry-over balance treatment in its own
  // subsection. The kind-based lists below exclude linked ones so nothing
  // renders twice.
  const linkedPoolGoals = savingsGoals.filter(g => !!g.category);
  const transferGoals = savingsGoals.filter(g => (g.kind ?? "transfer") === "transfer" && !g.category);
  const yearlyGoals = savingsGoals.filter(g => g.kind === "yearly");
  const obligationGoals = savingsGoals.filter(g => g.kind === "obligation" && !g.category);
  const totalPlannedSavings = savingsGoals.reduce((s,g)=>s+g.monthlyTarget,0);

  // What you owe every month — the declared amount on each active
  // obligation, not a sum of matched transactions (obligations are
  // excluded from Expenses on purpose, so their real dollar impact has to
  // come from here or "Free to spend" would silently ignore them).
  const totalObligationsMonthly = useMemo(() => obligations.reduce((s,ob)=>s+Number(ob.amount||0), 0), [obligations]);

  const freeToSpend = totalMonthlyIncome - totalExpenses - totalObligationsMonthly - totalPlannedSavings;

  // ── One-line generated read of the picture above — the equivalent of
  // glancing at the bottom-right "Final Balance" cell in a spreadsheet and
  // knowing immediately whether the month works or not. Deterministic, not
  // a model call — built from the same totals already on screen, just
  // picking out whichever fact is most urgent to say first. Same idea as
  // the detectors: state the evidence, don't just show a number.
  const summaryLine = useMemo(() => {
    if (obligationsExceeded.length > 0) {
      const total = obligationsExceeded.reduce((s,e)=>s+e.over,0);
      return obligationsExceeded.length === 1
        ? `${obligationsExceeded[0].ob.name} is over budget by ${fmtUSD(obligationsExceeded[0].over)}. See Obligations.`
        : `${obligationsExceeded.length} obligations are over budget by ${fmtUSD(total)} total. See Obligations.`;
    }
    if (obligationsNeedingFundingAccount.length > 0) {
      return `${obligationsNeedingFundingAccount.length} obligation${obligationsNeedingFundingAccount.length!==1?"s":""} ${obligationsNeedingFundingAccount.length!==1?"have":"has"} no funding account tagged yet.`;
    }
    if (totalMonthlyIncome === 0) {
      return "No income tracked yet. Add a source or confirm a detected deposit to see your full picture.";
    }
    if (freeToSpend < 0) {
      const drivers: { label: string; amt: number }[] = [
        { label: "obligations", amt: totalObligationsMonthly },
        { label: "expenses", amt: totalExpenses },
        { label: "savings", amt: totalPlannedSavings },
      ].sort((a,b) => b.amt - a.amt);
      return `You're ${fmtUSD(Math.abs(freeToSpend))} short this cycle, mostly from ${drivers[0].label} (${fmtUSD(drivers[0].amt)}).`;
    }
    return `${fmtUSD(freeToSpend)} left over after obligations, expenses, and savings.`;
  }, [obligationsExceeded, obligationsNeedingFundingAccount, totalMonthlyIncome, freeToSpend, totalObligationsMonthly, totalExpenses, totalPlannedSavings]);

  // ── Obligation add/edit + cover-overage modals ──
  const [obligationModal, setObligationModal] = useState<{ initial?: Partial<Obligation>; defaultType?: Obligation["type"] } | null>(null);
  const [showCoverModal, setShowCoverModal] = useState(false);

  // ── One running "Detected" column for the whole page — every candidate
  // from every section, tagged by destination, reviewed and added (or
  // flagged wrong) through the exact same DetectedRow interaction. ──
  // A detector's guess at WHICH of the four buckets a candidate belongs in
  // is only ever a default — the row's own bucket switcher can redirect it
  // anywhere before it's added. This is the one place that actually knows
  // how to create each kind of tracked entry, given whatever metadata the
  // originating detector was able to carry (merchant for the blacklist,
  // category/frequency/txnIds/accountId where relevant — missing ones just
  // fall back to a sensible default for that bucket).
  const addDetected = useCallback((meta: {
    merchant: string; category?: string; frequency?: Frequency; txnIds?: string[]; accountId?: string; obligationType?: Obligation["type"];
  }, section: Section, name: string, amount: number) => {
    switch (section) {
      case "income":
        addManualIncome({ id: `mi_${Date.now()}`, label: name, amount, accountId: meta.accountId });
        break;
      case "obligations":
        addObligation({ name, type: meta.obligationType ?? "fixed", amount, category: meta.category ?? null, merchant_hint: meta.merchant.split(" ")[0] || null, funding_account_id: meta.accountId ?? null });
        break;
      case "expenses":
        if (meta.frequency === "yearly") {
          addSavingsGoal({ name, monthlyTarget: Math.round(amount), kind: "yearly" });
        } else {
          addRecurringGroup({ name, frequency: meta.frequency ?? "monthly", expectedAmount: Math.round(amount), txnIds: meta.txnIds ?? [], accountId: meta.accountId });
        }
        break;
      case "savings":
        addSavingsGoal({ name, monthlyTarget: Math.round(amount), accountId: meta.accountId, kind: "transfer" });
        break;
    }
    // Whichever bucket it landed in, the raw candidate shouldn't keep
    // reappearing under its original detector — recurringIncome in
    // particular doesn't self-exclude tracked merchants the way the
    // other detectors do, so this blacklist entry is what actually stops
    // it from resurfacing next render.
    if (meta.merchant) dismissRecurring(meta.merchant);
  }, [addManualIncome, addObligation, addRecurringGroup, addSavingsGoal, dismissRecurring]);

  const detectedEntries = useMemo(() => {
    type Entry = { id: string; section: Section; name: string; note?: string; detail: string; amount: number; txns?: {date:string;amount:number}[]; onAccept: (name:string, amt:number, section:Section)=>void; onFlag: (reason:string)=>void };
    const out: Entry[] = [];

    for (const r of recurringIncome) out.push({
      id: `inc_${r.merchant}`, section: "income",
      name: r.merchant, detail: r.accountId ? `${r.reason} · into ${accountLabel(accounts, r.accountId)}` : r.reason, amount: r.avgAmount, txns: r.txns,
      onAccept: (name, amt, section) => addDetected({ merchant: r.merchant, accountId: r.accountId }, section, name, amt),
      onFlag: (reason) => flagIncorrect(r.merchant, undefined, reason),
    });

    for (const d of obligationsDetected) out.push({
      id: `ob_${d.merchant}`, section: "obligations", name: d.name, note: d.type === "fixed" ? "Fixed" : "Flex",
      detail: d.accountId ? `${d.reason} · from ${accountLabel(accounts, d.accountId)}` : d.reason, amount: d.amount, txns: d.txns,
      onAccept: (name, amt, section) => addDetected({ merchant: d.merchant, category: d.category, obligationType: d.type, accountId: d.accountId }, section, name, amt),
      onFlag: (reason) => flagIncorrect(d.merchant, d.category, reason),
    });

    for (const c of recurringCandidates) out.push({
      id: `rec_${c.key}`, section: "expenses", name: c.merchant, note: formatCat(c.category),
      detail: c.accountId ? `${c.reason} · from ${accountLabel(accounts, c.accountId)}` : c.reason, amount: c.avgAmount, txns: c.txns,
      onAccept: (name, amt, section) => addDetected({ merchant: c.merchant, category: c.category, frequency: c.frequency, txnIds: c.txnIds, accountId: c.accountId }, section, name, amt),
      onFlag: (reason) => flagIncorrect(c.merchant, c.category, reason),
    });

    for (const t of manualRecurringUngrouped) out.push({
      id: `man_${t.id}`, section: "expenses", name: cleanMerchantName(t.merchant_name ?? t.name ?? "Transaction"), detail: `marked recurring by you · ${fmtShortDate(t.date)}`, amount: Math.abs(Number(t.amount)), txns: [{ date: t.date, amount: Number(t.amount) }],
      onAccept: (name, amt, section) => addDetected({ merchant: t.merchant_name ?? t.name ?? "", frequency: "monthly", txnIds: [t.id] }, section, name, amt),
      onFlag: (reason) => flagIncorrect(t.merchant_name ?? t.name ?? "", undefined, reason),
    });

    for (const y of yearlyExpenseCandidates) out.push({
      id: `yr_${y.merchant}`, section: "expenses", name: y.merchant, note: formatCat(y.category), detail: y.reason, amount: Math.round(y.amount/12), txns: y.txns,
      onAccept: (name, amt, section) => addDetected({ merchant: y.merchant, category: y.category, frequency: "yearly" }, section, name, amt),
      onFlag: (reason) => flagIncorrect(y.merchant, y.category, reason),
    });

    for (const d of detectedTransfers) out.push({
      id: `tr_${d.merchant}`, section: "savings", name: d.merchant,
      detail: d.accountId ? `${distinctMonths(d.txns.map(x => x.date))} of last 12 months · from ${accountLabel(accounts, d.accountId)}` : `${distinctMonths(d.txns.map(x => x.date))} of last 12 months`,
      amount: d.avgAmount, txns: d.txns,
      onAccept: (name, amt, section) => addDetected({ merchant: d.merchant, accountId: d.accountId }, section, name, amt),
      onFlag: (reason) => flagIncorrect(d.merchant, undefined, reason),
    });

    return out;
  }, [
    recurringIncome, obligationsDetected, recurringCandidates, manualRecurringUngrouped, yearlyExpenseCandidates, detectedTransfers,
    addDetected, flagIncorrect, formatCat, accounts,
  ]);

  return (
    <div className="flex flex-col min-h-full bg-background">
      {/* Header + summary strip */}
      <div className="px-4 md:px-8 pt-5 pb-4 border-b border-border/40">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-[19px] md:text-[21px] font-semibold text-foreground tracking-tight">Financial overview</h1>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">Based on detected patterns and what you've set up, not a single month</p>
            <p className={cn("text-[12.5px] font-medium mt-1.5", freeToSpend < 0 || obligationsExceeded.length > 0 ? "text-negative" : obligationsNeedingFundingAccount.length > 0 ? "text-warning" : "text-foreground")}>
              {summaryLine}
            </p>
          </div>
          <button onClick={()=>setConfirmingReset(true)}
            className="shrink-0 text-[11px] text-muted-foreground/70 hover:text-negative transition-colors whitespace-nowrap">
            Reset budget data
          </button>
          <ConfirmDialog
            open={confirmingReset}
            onOpenChange={setConfirmingReset}
            title="Reset budget data?"
            description="This clears your category budgets, recurring items and savings goals on this page. Your transactions and linked accounts aren't affected."
            confirmLabel="Reset"
            onConfirm={() => { resetBudgetTracking(); setConfirmingReset(false); toast.success("Budget data reset"); }} />
        </div>

        {/* Two bars, one picture: income on top, and directly below it — at
            the exact same scale — a single bar showing how that income got
            split across obligations, expenses & savings, with whatever's
            left over as the remaining sliver. */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11.5px] font-medium text-foreground">Planned income</span>
            <span className="text-[13px] font-bold tabular text-foreground"
              title="Monthly total of the income sources you've tracked below — not what has landed so far.">{fmtUSD(totalMonthlyIncome)}<span className="text-[11px] font-normal text-muted-foreground">/mo</span></span>
          </div>
          <div className="text-[11px] text-muted-foreground tabular mb-1">Received so far this month: {fmtUSD(receivedThisMonth)}</div>
          <div className="h-7 rounded-lg bg-positive/70" />

          <div className="flex items-center justify-between mb-1 mt-3">
            <span className="text-[11.5px] font-medium text-foreground">How it's being spent</span>
            <span className={cn("text-[12px] tabular", freeToSpend<0?"text-negative":"text-muted-foreground")}>
              {freeToSpend<0 ? `${fmtUSD(Math.abs(freeToSpend))} over` : `${fmtUSD(freeToSpend)} left over`}
            </span>
          </div>
          {totalMonthlyIncome > 0 ? (
            <div className="flex h-7 rounded-lg overflow-hidden bg-border/20">
              <div className="bg-blue-400" style={{ width: `${Math.max(Math.min((totalObligationsMonthly/totalMonthlyIncome)*100, 100), totalObligationsMonthly>0?1:0)}%` }} />
              <div className="bg-rose-400" style={{ width: `${Math.max(Math.min((totalExpenses/totalMonthlyIncome)*100, 100), totalExpenses>0?1:0)}%` }} />
              <div className="bg-violet-400" style={{ width: `${Math.max(Math.min((totalPlannedSavings/totalMonthlyIncome)*100, 100), totalPlannedSavings>0?1:0)}%` }} />
            </div>
          ) : (
            <div className="h-7 rounded-lg bg-border/20" />
          )}
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="h-2 w-2 rounded-[2px] bg-blue-400 shrink-0"/>Obligations {fmtUSD(totalObligationsMonthly)}</span>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="h-2 w-2 rounded-[2px] bg-rose-400 shrink-0"/>Expenses {fmtUSD(totalExpenses)}</span>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="h-2 w-2 rounded-[2px] bg-violet-400 shrink-0"/>Savings {fmtUSD(totalPlannedSavings)}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 md:px-8 py-4 max-w-6xl w-full mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 items-start">

          {/* ═══ Main ledger — Income, Obligations, Expenses, Savings ═══ */}
          <div className="space-y-3 min-w-0">

            {/* ── Income ── */}
            <SectionShell icon={TrendingUp} label="Income" sublabel="Recurring sources you've tracked"
              color="text-emerald-400" bg="bg-emerald-500/12" total={totalMonthlyIncome} totalLabel="per month">
              <div className="divide-y divide-border/15">
                {manualIncome.length === 0 ? (
                  <p className="px-4 py-5 text-center text-[12px] text-muted-foreground/60">No income tracked yet. Add a source, or check the Detected column for a repeating deposit to confirm.</p>
                ) : (
                  manualIncome.map(m => (
                    <EntryRow key={m.id} label={m.label} amount={m.amount} accentClass="text-emerald-400"
                      indicator={m.accountId ? <span className="text-[10px] text-muted-foreground shrink-0 truncate max-w-[110px]">{accountLabel(accounts, m.accountId)}</span> : undefined}
                      expanded={expandedIncomeId === m.id} onToggle={()=>setExpandedIncomeId(expandedIncomeId===m.id?null:m.id)}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10.5px] text-muted-foreground truncate">
                          {m.accountId ? `Deposits into ${accountLabel(accounts, m.accountId)}` : "Manual entry, no account set"}
                        </p>
                        <ConfirmDeleteButton label={`Remove ${m.label}`} itemName={m.label} onConfirm={()=>removeManualIncome(m.id)}
                          className="text-muted-foreground/40 hover:text-negative shrink-0" />
                      </div>
                    </EntryRow>
                  ))
                )}
              </div>
              <div className="px-4 py-2.5">
                {showAddIncome ? (
                  <div className="space-y-1.5">
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
                    <AccountPicker accounts={accounts} value={incomeAccountId} onChange={setIncomeAccountId} placeholder="Deposits into which account? (optional)" />
                  </div>
                ) : (
                  <button onClick={()=>setShowAddIncome(true)} className="flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
                    <Plus className="h-3.5 w-3.5"/> Add income source
                  </button>
                )}
              </div>
            </SectionShell>

            {/* ── Obligations ── */}
            <SectionShell icon={Wallet} label="Obligations" sublabel="What you owe and have to pay"
              color="text-blue-400" bg="bg-blue-500/12" total={totalObligationsMonthly} totalLabel="per month">
              {obligationsNeedingFundingAccount.length > 0 && (
                <div className="px-4 py-3 border-b border-border/20 bg-negative/5 space-y-1">
                  <p className="text-[11.5px] text-negative font-medium flex items-center gap-1.5">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0"/> {obligationsNeedingFundingAccount.length} obligation{obligationsNeedingFundingAccount.length!==1?"s":""} with no funding account tagged
                  </p>
                </div>
              )}
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
              {obligationsExceeded.length > 0 && (
                <div className="mx-4 mt-3 rounded-xl bg-destructive/10 border border-destructive/25 p-3 flex items-start gap-3">
                  <ShieldAlert className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0"/>
                  <p className="text-[11.5px] font-medium flex-1">
                    {obligationsExceeded.length === 1
                      ? `${obligationsExceeded[0].ob.name} over by ${fmtUSD(obligationsExceeded[0].over)}`
                      : `${obligationsExceeded.length} over · ${fmtUSD(obligationsExceeded.reduce((s,e)=>s+e.over,0))} total`}
                  </p>
                  <button onClick={()=>setShowCoverModal(true)} className="shrink-0 px-2.5 py-1 bg-destructive text-destructive-foreground rounded-lg text-[10.5px] font-medium">
                    How to cover
                  </button>
                </div>
              )}
              <div className="divide-y divide-border/15">
                {obligations.length === 0 ? (
                  <p className="px-4 py-5 text-center text-[12px] text-muted-foreground/60">No obligations tracked yet.</p>
                ) : obligations.map(ob => {
                  const spent = obligationSpentMap[ob.id] ?? 0;
                  const isOver = spent > ob.amount;
                  const bucket = OBLIGATION_BUCKETS.find(b => b.type === ob.type);
                  const fundingLabel = accountLabel(accounts, ob.funding_account_id);
                  return (
                    <EntryRow key={ob.id} label={ob.name} amount={spent} accentClass={isOver?"text-negative":"text-blue-400"}
                      sublabel={fundingLabel ? <span>Paid from {fundingLabel}</span> : <span className="text-warning/80">No funding account tagged</span>}
                      indicator={<span className="text-[10px] text-muted-foreground shrink-0">{bucket?.label} · / {fmtUSD(ob.amount)}</span>}
                      expanded={expandedObligationId === ob.id} onToggle={()=>setExpandedObligationId(expandedObligationId===ob.id?null:ob.id)}>
                      <div className="flex items-center justify-between">
                        <p className="text-[10.5px] text-muted-foreground">{ob.category ? formatCat(ob.category) : "No category set"}</p>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={()=>setObligationModal({ initial: ob })} aria-label={`Edit ${ob.name}`}
                            className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground/50 hover:text-foreground"><Pencil className="h-3 w-3"/></button>
                          <ConfirmDeleteButton label={`Remove ${ob.name}`} itemName={ob.name} onConfirm={()=>removeObligationAndDismiss(ob)}
                            className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground/50 hover:text-negative" iconClassName="h-3 w-3" />
                        </div>
                      </div>
                    </EntryRow>
                  );
                })}
              </div>
              <div className="px-4 py-2.5">
                <button onClick={()=>setObligationModal({})} className="flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
                  <Plus className="h-3.5 w-3.5"/> Add obligation
                </button>
              </div>
            </SectionShell>

            {/* ── Credit Cards ── */}
            {creditCardAccounts.length > 0 && (
              <SectionShell icon={CreditCard} label="Credit Cards" sublabel="Which account autopays each card"
                color="text-amber-400" bg="bg-amber-500/12" total={creditCardAccounts.length} totalIsCount totalLabel="tracked">
                <div className="divide-y divide-border/15">
                  {creditCardAccounts.map(card => {
                    const autopayId = cardAutopayFrom[card.account_id];
                    const autopayLabel = accountLabel(accounts, autopayId);
                    const balance = Math.abs(Number(card.current_balance ?? 0));
                    const cardName = (card.name ?? card.official_name ?? "Card") + (card.mask ? ` ···${card.mask}` : "");
                    return (
                      <EntryRow key={card.account_id} label={cardName} amount={balance}
                        sublabel={autopayLabel ? <span>Autopay from {autopayLabel}</span> : <span className="text-warning/80">No autopay account set</span>}
                        expanded={expandedCardId === card.account_id} onToggle={()=>setExpandedCardId(expandedCardId===card.account_id?null:card.account_id)}>
                        <div className="flex items-center gap-2">
                          <AccountPicker accounts={fundingAccounts} value={autopayId ?? ""}
                            onChange={id => id ? setCardAutopayFrom(card.account_id, id) : removeCardAutopayFrom(card.account_id)}
                            placeholder="Autopay from which account?" />
                          {autopayId && (
                            <button onClick={()=>removeCardAutopayFrom(card.account_id)} className="text-[10.5px] text-muted-foreground/60 hover:text-negative shrink-0">Clear</button>
                          )}
                        </div>
                      </EntryRow>
                    );
                  })}
                </div>
              </SectionShell>
            )}

            {/* ── Expenses ── */}
            <SectionShell icon={TrendingDown} label="Expenses" sublabel="What you spent this month, by category"
              color="text-rose-400" bg="bg-rose-500/12" total={totalExpenses} totalLabel="this month">

              <SubLabel>Categories</SubLabel>
              <div className="divide-y divide-border/20">
                {expenseByCat.length === 0 ? (
                  <p className="px-4 py-5 text-center text-[12px] text-muted-foreground/60">No expenses this month yet.</p>
                ) : (
                  <>
                    {(showAllCats ? expenseByCat : expenseByCat.slice(0, 6)).map(c => {
                      const col = catColor(c.cat);
                      const pct = Math.max((c.spend/expenseByCat[0].spend)*100, 4);
                      const plan = categoryGoalFor(c.cat);
                      const budget = budgets[c.cat];
                      const over = budget != null && c.spend > budget;
                      const overAmt = over ? c.spend - budget : 0;
                      const predictedId = overageFundingPrefs[c.cat];
                      const chosenId = fundAllocations[c.cat] ?? predictedId ?? "";
                      const chosen = fundingAccounts.find(a => a.account_id === chosenId);
                      const transferId = `pt_${c.cat}_${thisMonth}`;
                      const confirmed = plannedTransfers.find(p => p.id === transferId && !p.done);
                      const catRecurring = recurringGroupsByCategory[c.cat] ?? [];
                      const detectedRecurringForCat = recurringCandidatesByCategory[c.cat] ?? [];
                      const detectedYearlyForCat = yearlyCandidatesByCategory[c.cat] ?? [];
                      const needsAttention = over || (!plan && budget == null);
                      const editingBudget = editingBudgetCat === c.cat;
                      const catTxns = expenseTxnsForPeriod.filter(t => (getEffectiveCategory(t) ?? "Other") === c.cat);
                      const catAccountsInvolved = Array.from(new Set(catTxns.map(t => t.account_id)))
                        .map(id => accounts.find(a => a.account_id === id)).filter((a): a is PAccount => !!a);
                      const q = catTxnSearch.trim().toLowerCase();
                      const filteredCatTxns = catTxns
                        .filter(t => !catAccountFilter || t.account_id === catAccountFilter)
                        .filter(t => !q || (t.merchant_name ?? t.name ?? "").toLowerCase().includes(q))
                        .sort((a,b) => b.date.localeCompare(a.date));
                      return (
                        <div key={c.cat}>
                          {/* No more expand-in-place — a plain click opens the
                              popup below with the transactions, budget, and
                              breakdown, so the row list itself always looks
                              the same regardless of which category you last
                              looked at. */}
                          <button onClick={()=>openCategoryPopup(c.cat)}
                            className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-muted/10 transition-colors">
                            <span className="text-[12.5px] font-medium text-foreground truncate flex-1 min-w-0">{formatCat(c.cat)}</span>
                            <div className="w-14 h-1.5 rounded-full bg-border/20 overflow-hidden shrink-0">
                              <div className={cn("h-full rounded-full", over && "bg-negative")} style={{width:`${pct}%`, background: over ? undefined : col}}/>
                            </div>
                            <span className={cn("text-[12.5px] font-semibold tabular shrink-0 w-16 text-right", over ? "text-negative" : "text-foreground")}>{fmtUSD(c.spend)}</span>
                            {needsAttention && <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", over ? "bg-negative" : "bg-warning")}/>}
                            <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0"/>
                          </button>

                          <Dialog open={categoryPopup === c.cat} onOpenChange={o => { if (!o) { setCategoryPopup(null); setEditingBudgetCat(null); } }}>
                            <DialogContent className="max-w-md p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col">
                              <DialogHeader className="pl-5 pr-12 pt-5 pb-3 border-b border-border/40 space-y-1 shrink-0 text-left">
                                <DialogTitle className="font-display text-[15px]">{formatCat(c.cat)}</DialogTitle>
                                <DialogDescription className="text-[12px]">
                                  {fmtUSD(c.spend)} this month{budget != null ? ` of ${fmtUSD(budget)} budgeted` : ""} · {catTxns.length} transaction{catTxns.length!==1?"s":""}
                                </DialogDescription>
                              </DialogHeader>
                              <div className="overflow-y-auto px-5 py-3.5 space-y-3">
                              {/* Budget — editable right here instead of only from the
                                  separate Spending tab, so setting a limit and seeing
                                  what backs it up happen in the same place. */}
                              <div className="flex items-center gap-1.5">
                                {editingBudget ? (
                                  <>
                                    <span className="text-[10.5px] text-muted-foreground shrink-0">Budget $</span>
                                    <input type="number" autoFocus value={budgetDraft} onChange={e=>setBudgetDraft(e.target.value)}
                                      onKeyDown={e=>{ if(e.key==="Enter") saveBudgetDraft(); if(e.key==="Escape") setEditingBudgetCat(null); }}
                                      className="h-6 w-20 rounded-md bg-muted/40 border border-border/60 text-[11px] text-foreground px-1.5 outline-none"/>
                                    <span className="text-[10px] text-muted-foreground/70">/mo</span>
                                    <button onClick={saveBudgetDraft} className="text-[10.5px] font-medium text-[hsl(var(--primary))] hover:underline">Save</button>
                                    <button onClick={()=>setEditingBudgetCat(null)} className="text-[10.5px] text-muted-foreground hover:text-foreground">Cancel</button>
                                    {budget != null && (
                                      <button onClick={()=>{ removeBudget(c.cat); setEditingBudgetCat(null); }} className="text-[10.5px] text-muted-foreground/60 hover:text-negative ml-auto">Remove</button>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <span className="text-[10.5px] text-muted-foreground">
                                      {budget != null ? `Budget ${fmtUSD(budget)}/mo` : "No budget set"}
                                    </span>
                                    <button onClick={()=>openBudgetEditor(c.cat, budget)} aria-label={`Edit ${formatCat(c.cat)} budget`}
                                      className="h-5 w-5 grid place-items-center rounded text-muted-foreground/50 hover:text-foreground"><Pencil className="h-2.5 w-2.5"/></button>
                                  </>
                                )}
                              </div>

                              {catRecurring.length > 0 && (
                                <p className="text-[10px] text-muted-foreground/80 flex items-center gap-1">
                                  <RefreshCw className="h-2.5 w-2.5 shrink-0"/> Includes recurring: {catRecurring.map(g=>g.name).join(", ")}, manage below
                                </p>
                              )}

                              {/* Breakdown — the actual recurring transactions behind this
                                  category, so a budget number isn't just floating with no
                                  evidence for how it was arrived at. Yearly items are shown
                                  in their own group since they won't show up in most months'
                                  spend at all, and a budget built only off monthly totals
                                  would miss them completely until the month they hit. */}
                              {(catRecurring.length > 0 || detectedRecurringForCat.length > 0 || detectedYearlyForCat.length > 0) && (
                                <div className="rounded-lg bg-muted/10 border border-border/20 p-2 space-y-1">
                                  <p className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground/60">What makes up this category</p>
                                  {catRecurring.map(g => (
                                    <div key={g.id} className="flex items-center justify-between gap-2">
                                      <span className="text-[11px] text-foreground truncate">{g.name}</span>
                                      <span className="text-[10.5px] tabular text-muted-foreground shrink-0">{fmtUSD(g.expectedAmount * FREQ_MONTHLY_MULT[g.frequency])}/mo · {FREQ_LABEL[g.frequency]}</span>
                                    </div>
                                  ))}
                                  {detectedRecurringForCat.map(rc => (
                                    <div key={rc.key} className="flex items-center justify-between gap-2">
                                      <span className="text-[11px] text-foreground truncate">{rc.merchant} <span className="text-muted-foreground/60 font-normal">· {FREQ_LABEL[rc.frequency]}, detected</span></span>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <span className="text-[10.5px] tabular text-muted-foreground">{fmtUSD(rc.avgAmount)}/mo</span>
                                        <button onClick={()=>addDetected({ merchant: rc.merchant, category: rc.category, frequency: rc.frequency, txnIds: rc.txnIds }, "expenses", rc.merchant, rc.avgAmount)}
                                          className="text-[10px] font-semibold text-[hsl(var(--primary))] hover:underline">Add</button>
                                      </div>
                                    </div>
                                  ))}
                                  {detectedYearlyForCat.length > 0 && (
                                    <p className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground/60 pt-1">Yearly, won't show most months</p>
                                  )}
                                  {detectedYearlyForCat.map(y => (
                                    <div key={y.merchant} className="flex items-center justify-between gap-2">
                                      <span className="text-[11px] text-foreground truncate">{y.merchant}</span>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <span className="text-[10.5px] tabular text-muted-foreground">{fmtUSD(y.amount)} once/yr ≈ {fmtUSD(y.amount/12)}/mo</span>
                                        <button onClick={()=>addDetected({ merchant: y.merchant, category: y.category, frequency: "yearly" }, "expenses", y.merchant, Math.round(y.amount/12))}
                                          className="text-[10px] font-semibold text-[hsl(var(--primary))] hover:underline">Add</button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {over ? (
                                <div>
                                  <p className="text-[10.5px] text-negative font-medium">{fmtUSD(overAmt)} over budget. Which account covers it?</p>
                                  {confirmed ? (
                                    <p className="text-[10.5px] text-positive mt-1 flex items-center gap-1">
                                      <Check className="h-3 w-3"/> Added to Home as a suggested transfer.
                                      <button onClick={()=>dismissTransfer(confirmed.id)} className="text-muted-foreground/60 hover:text-foreground underline ml-1">Undo</button>
                                    </p>
                                  ) : fundingAccounts.length === 0 ? (
                                    <p className="text-[10.5px] text-muted-foreground mt-1">No eligible spending account tagged yet.</p>
                                  ) : (
                                    <div className="flex items-center gap-1.5 mt-1">
                                      <select value={chosenId} onChange={e=>setFundAllocations(p=>({...p, [c.cat]: e.target.value}))}
                                        className="h-7 flex-1 min-w-0 rounded-lg bg-muted/40 border border-border/60 text-[11px] text-foreground px-1.5 outline-none">
                                        <option value="">Cover from…</option>
                                        {fundingAccounts.map(a => <option key={a.account_id} value={a.account_id}>{a.name ?? a.official_name ?? "Account"}</option>)}
                                      </select>
                                      {chosen && (
                                        <button
                                          onClick={()=>confirmOverageFunding({ category: c.cat, month: thisMonth, amount: overAmt, fromAccountId: chosen.account_id, fromAccountName: chosen.name ?? chosen.official_name ?? "Account" })}
                                          className="h-7 px-2 rounded-lg bg-gold text-[10.5px] font-semibold shrink-0 whitespace-nowrap">
                                          Suggest transfer
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ) : plan ? (
                                <p className="text-[10.5px] text-muted-foreground">Covered by "{plan.name}", {fmtUSD(plan.monthlyTarget)}/mo set aside</p>
                              ) : budget != null ? (
                                <p className="text-[10.5px] text-muted-foreground">{fmtUSD(budget - c.spend)} left of budget this month</p>
                              ) : (
                                <button
                                  onClick={()=>addSavingsGoal({ name: `${formatCat(c.cat)} fund`, monthlyTarget: Math.round(c.spend), kind: "category", category: c.cat })}
                                  className="text-[10.5px] text-[hsl(var(--primary))] font-medium hover:underline">
                                  No plan yet. How are we covering this? Set aside {fmtUSD(c.spend)}/mo →
                                </button>
                              )}

                              {/* Transactions — the actual receipts behind the number
                                  above, searchable and filterable by account, each one
                                  opening the app's real edit modal instead of a second,
                                  separate editor built just for this popup. */}
                              <div className="pt-1">
                                <p className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground/60 mb-1.5">
                                  Transactions ({filteredCatTxns.length}{filteredCatTxns.length!==catTxns.length ? ` of ${catTxns.length}` : ""})
                                </p>
                                <div className="flex items-center gap-1.5 mb-1.5">
                                  <div className="relative flex-1 min-w-0">
                                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50 pointer-events-none"/>
                                    <input value={catTxnSearch} onChange={e=>setCatTxnSearch(e.target.value)} placeholder="Search transactions…"
                                      className="w-full h-7 pl-6 pr-2 rounded-lg bg-muted/40 border border-border/60 text-[11px] text-foreground outline-none focus:border-primary/50"/>
                                  </div>
                                  {catAccountsInvolved.length > 1 && (
                                    <select value={catAccountFilter} onChange={e=>setCatAccountFilter(e.target.value)}
                                      className="h-7 shrink-0 max-w-[110px] rounded-lg bg-muted/40 border border-border/60 text-[10.5px] text-foreground px-1.5 outline-none">
                                      <option value="">All accounts</option>
                                      {catAccountsInvolved.map(a => <option key={a.account_id} value={a.account_id}>{a.name ?? a.official_name ?? "Account"}</option>)}
                                    </select>
                                  )}
                                </div>
                                {filteredCatTxns.length === 0 ? (
                                  <p className="px-2 py-4 text-center text-[11px] text-muted-foreground/60">
                                    {catTxns.length === 0 ? "No transactions this month." : "No matches."}
                                  </p>
                                ) : (
                                  <div className="rounded-lg border border-border/25 divide-y divide-border/15 overflow-hidden max-h-56 overflow-y-auto">
                                    {filteredCatTxns.map(t => (
                                      <button key={t.id} onClick={()=>onOpenTxnDetail?.(t)}
                                        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-muted/20 transition-colors">
                                        <div className="flex-1 min-w-0">
                                          <p className="text-[11.5px] text-foreground truncate">{t.merchant_name ?? t.name ?? "Transaction"}</p>
                                          <p className="text-[10px] text-muted-foreground truncate">{fmtShortDate(t.date)}{accountLabel(accounts, t.account_id) ? ` · ${accountLabel(accounts, t.account_id)}` : ""}</p>
                                        </div>
                                        <span className="text-[11.5px] font-medium tabular text-foreground shrink-0">{fmtUSD(Number(t.amount))}</span>
                                        <ChevronRight className="h-3 w-3 text-muted-foreground/30 shrink-0"/>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              </div>
                            </DialogContent>
                          </Dialog>
                        </div>
                      );
                    })}
                    {!showAllCats && expenseByCat.length > 6 && (
                      <button onClick={()=>setShowAllCats(true)}
                        className="w-full px-4 py-2 text-[11.5px] text-muted-foreground hover:text-foreground text-center transition-colors">
                        Show {expenseByCat.length - 6} more categories
                      </button>
                    )}
                  </>
                )}
              </div>

              <SubLabel>Recurring bills · {fmtUSD(totalRecurringMonthly)}/mo</SubLabel>
              <div className="divide-y divide-border/15">
                {recurringGroups.length === 0 ? (
                  <p className="px-4 py-4 text-center text-[12px] text-muted-foreground/60">Nothing tracked yet.</p>
                ) : recurringGroups.map(g => (
                  <EntryRow key={g.id} label={g.name} amount={g.expectedAmount} accentClass="text-amber-400"
                    sublabel={accountLabel(accounts, g.accountId) ? `Paid from ${accountLabel(accounts, g.accountId)}` : undefined}
                    indicator={<span className="text-[10px] text-muted-foreground shrink-0">{FREQ_LABEL[g.frequency]}</span>}
                    expanded={expandedRecurringId === g.id}
                    onToggle={()=>{ setExpandedRecurringId(expandedRecurringId===g.id?null:g.id); setEditingRecurringHeader(false); setAddTxnSearch(""); }}>
                    {editingRecurringHeader ? (
                      <div className="space-y-1.5 mb-2">
                        <div className="flex items-center gap-1.5">
                          <input autoFocus value={groupNameDraft} onChange={e=>setGroupNameDraft(e.target.value)}
                            className="flex-1 min-w-0 h-8 px-2 rounded-lg bg-muted/40 border border-border/60 text-[12.5px] text-foreground outline-none"/>
                          <select value={groupFreqDraft} onChange={e=>setGroupFreqDraft(e.target.value as Frequency)}
                            className="h-8 px-1.5 rounded-lg bg-muted/40 border border-border/60 text-[11px] text-foreground outline-none">
                            {(Object.keys(FREQ_LABEL) as Frequency[]).map(f => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}
                          </select>
                          <div className="relative w-20 shrink-0">
                            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span>
                            <input type="number" min={0} value={groupAmountDraft} onChange={e=>setGroupAmountDraft(e.target.value)}
                              className="w-full h-8 pl-4 pr-1 rounded-lg bg-muted/40 border border-border/60 text-[11px] text-foreground outline-none"/>
                          </div>
                          <button onClick={()=>{
                            const amt = parseFloat(groupAmountDraft);
                            updateRecurringGroup(g.id, { name: groupNameDraft.trim() || g.name, frequency: groupFreqDraft, expectedAmount: isNaN(amt)?g.expectedAmount:amt, accountId: groupAccountDraft || undefined });
                            setEditingRecurringHeader(false);
                          }} aria-label="Save" className="h-8 w-8 grid place-items-center rounded-lg bg-gold shrink-0"><Check className="h-3.5 w-3.5"/></button>
                        </div>
                        <AccountPicker accounts={accounts} value={groupAccountDraft} onChange={setGroupAccountDraft} placeholder="Paid from which account?" />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10.5px] text-muted-foreground">{fmtUSD(g.expectedAmount * FREQ_MONTHLY_MULT[g.frequency])}/mo equiv.</p>
                        <div className="flex items-center gap-1">
                          <button onClick={()=>{ setEditingRecurringHeader(true); setGroupNameDraft(g.name); setGroupFreqDraft(g.frequency); setGroupAmountDraft(String(g.expectedAmount)); setGroupAccountDraft(g.accountId ?? ""); }}
                            aria-label="Edit" className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground/50 hover:text-foreground"><Pencil className="h-3 w-3"/></button>
                          <ConfirmDeleteButton label="Delete entry" itemName={g.name} onConfirm={()=>removeRecurringGroup(g.id)}
                            className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground/50 hover:text-negative" iconClassName="h-3 w-3" />
                        </div>
                      </div>
                    )}
                    <div className="rounded-lg border border-border/25 divide-y divide-border/15 overflow-hidden">
                      {g.txnIds.length === 0 ? (
                        <p className="px-2.5 py-3 text-center text-[11px] text-muted-foreground/60">No transactions in this entry yet.</p>
                      ) : g.txnIds
                        .map(id => txns.find(t => t.id === id))
                        .filter((t): t is PTxn => !!t)
                        .sort((a,b) => b.date.localeCompare(a.date))
                        .map(t => (
                          <div key={t.id} className="flex items-center gap-2 px-2.5 py-1.5">
                            <span className="text-[11.5px] text-foreground truncate flex-1 min-w-0">{t.merchant_name ?? t.name ?? "Transaction"}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">{fmtShortDate(t.date)}</span>
                            <span className="text-[11.5px] font-medium tabular text-foreground shrink-0">{fmtUSD(Number(t.amount))}</span>
                            <button onClick={()=>removeTxnFromRecurringGroup(g.id, t.id)} aria-label="Remove from this entry"
                              className="text-muted-foreground/50 hover:text-negative shrink-0"><X className="h-3 w-3"/></button>
                          </div>
                        ))}
                    </div>
                    <div className="relative mt-1.5">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50 pointer-events-none"/>
                      <input value={addTxnSearch} onChange={e=>setAddTxnSearch(e.target.value)} placeholder="Search transactions to add…"
                        className="w-full h-7 pl-6 pr-2 rounded-lg bg-muted/40 border border-border/60 text-[11px] text-foreground outline-none focus:border-primary/50"/>
                    </div>
                    {addTxnResults.length > 0 && (
                      <div className="rounded-lg border border-border/25 divide-y divide-border/15 overflow-hidden mt-1">
                        {addTxnResults.map(t => (
                          <button key={t.id} onClick={()=>{ addTxnToRecurringGroup(g.id, t.id); setAddTxnSearch(""); }}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/30 transition-colors">
                            <span className="text-[11.5px] text-foreground truncate flex-1 min-w-0">{t.merchant_name ?? t.name ?? "Transaction"}</span>
                            <span className="text-[11.5px] font-medium tabular text-foreground shrink-0">{fmtUSD(Number(t.amount))}</span>
                            <Plus className="h-3 w-3 text-[hsl(var(--primary))] shrink-0"/>
                          </button>
                        ))}
                      </div>
                    )}
                  </EntryRow>
                ))}
              </div>
              <div className="px-4 py-2.5">
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
                    <AccountPicker accounts={accounts} value={newGroupAccount} onChange={setNewGroupAccount} placeholder="Paid from which account? (optional)" />
                  </div>
                ) : (
                  <button onClick={()=>setShowNewGroup(true)} className="flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
                    <Plus className="h-3.5 w-3.5"/> New recurring entry
                  </button>
                )}
              </div>

              <SubLabel><span className="flex items-center gap-1"><CalendarClock className="h-3 w-3"/> Yearly</span></SubLabel>
              <div className="divide-y divide-border/15">
                {yearlyGoals.length === 0 ? (
                  <p className="px-4 py-4 text-center text-[12px] text-muted-foreground/60">Nothing tracked yet.</p>
                ) : yearlyGoals.map(g => (
                  <EntryRow key={g.id} label={g.name} amount={g.monthlyTarget} accentClass="text-rose-400"
                    expanded={expandedYearlyId === g.id} onToggle={()=>setExpandedYearlyId(expandedYearlyId===g.id?null:g.id)}>
                    <div className="flex items-center justify-between">
                      <p className="text-[10.5px] text-muted-foreground">Allocated /mo</p>
                      <ConfirmDeleteButton label={`Remove ${g.name}`} itemName={g.name} onConfirm={()=>removeSavingsGoal(g.id)}
                        className="text-muted-foreground/40 hover:text-negative shrink-0" />
                    </div>
                  </EntryRow>
                ))}
              </div>
            </SectionShell>

            {/* ── Savings ── */}
            <SectionShell icon={PiggyBank} label="Savings" sublabel="What you're setting aside on purpose"
              color="text-violet-400" bg="bg-violet-500/12" total={totalPlannedSavings} totalLabel="monthly target">

              <SubLabel>Linked pools, pay for a category, unspent carries over</SubLabel>
              <div className="divide-y divide-border/15">
                {linkedPoolGoals.length === 0 && (
                  <p className="px-4 py-4 text-center text-[12px] text-muted-foreground/60">No pools linked to a category yet.</p>
                )}
                {linkedPoolGoals.map(g => {
                  const actual = monthTxns.filter(isExpenseTxn).filter(t => (getEffectiveCategory(t) ?? "Other") === g.category)
                    .reduce((s,t)=>s+Number(t.amount),0);
                  const pct = g.monthlyTarget > 0 ? Math.min((actual/g.monthlyTarget)*100, 100) : 0;
                  const over = actual > g.monthlyTarget;
                  const pool = poolBalanceFor(g);
                  return (
                    <EntryRow key={g.id} label={g.name} amount={actual} accentClass={over?"text-warning":"text-violet-400"}
                      sublabel={accountLabel(accounts, g.accountId) ? `Held in ${accountLabel(accounts, g.accountId)}` : undefined}
                      indicator={<span className="text-[10px] text-muted-foreground shrink-0">/ {fmtUSD(g.monthlyTarget)}</span>}
                      expanded={expandedPoolId === g.id} onToggle={()=>setExpandedPoolId(expandedPoolId===g.id?null:g.id)}>
                      <p className="text-[10px] text-muted-foreground mb-1.5">→ {formatCat(g.category!)}</p>
                      <div className="h-1.5 rounded-full bg-border/20 overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all", over?"bg-warning":"bg-violet-400")} style={{width:`${Math.max(pct,3)}%`}}/>
                      </div>
                      {pool && (
                        <p className={cn("text-[10.5px] mt-1.5", pool.balance < 0 ? "text-negative" : "text-positive")}>
                          {pool.balance < 0
                            ? `${fmtUSD(Math.abs(pool.balance))} over what's set aside`
                            : `${fmtUSD(pool.balance)} available, carried over`}
                        </p>
                      )}
                      <div className="flex items-center justify-between mt-1.5">
                        <button onClick={()=>updateSavingsGoal(g.id, { category: undefined })} className="text-[10px] text-muted-foreground/50 hover:text-foreground">Unlink</button>
                        <ConfirmDeleteButton label={`Remove ${g.name}`} itemName={g.name} onConfirm={()=>removeSavingsGoal(g.id)}
                          className="text-muted-foreground/40 hover:text-negative" />
                      </div>
                    </EntryRow>
                  );
                })}
              </div>
              <div className="px-4 py-2.5">
                {showNewPool ? (
                  <div className="space-y-1.5">
                    <input autoFocus value={newPoolName} onChange={e=>setNewPoolName(e.target.value)} placeholder="Pool name (e.g. Groceries fund)"
                      onKeyDown={e=>{ if(e.key==="Escape") setShowNewPool(false); }}
                      className="w-full h-9 px-2.5 rounded-lg bg-muted/40 border border-border/60 text-[13px] text-foreground outline-none focus:border-primary/50"/>
                    <div className="flex items-center gap-1.5">
                      <select value={newPoolCat} onChange={e=>setNewPoolCat(e.target.value)}
                        className="h-9 flex-1 min-w-0 px-2 rounded-lg bg-muted/40 border border-border/60 text-[12px] text-foreground outline-none">
                        <option value="">Pay for which category?</option>
                        {expenseByCat.map(c => <option key={c.cat} value={c.cat}>{formatCat(c.cat)}</option>)}
                      </select>
                      <div className="relative w-24 shrink-0">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">$</span>
                        <input type="number" min={0} value={newPoolAmt} onChange={e=>setNewPoolAmt(e.target.value)} placeholder="/mo"
                          className="w-full h-9 pl-5 pr-2 rounded-lg bg-muted/40 border border-border/60 text-[13px] text-foreground outline-none"/>
                      </div>
                      <button onClick={submitNewPool} className="h-9 px-3 rounded-lg bg-gold text-[12px] font-semibold shrink-0">Add</button>
                      <button onClick={()=>setShowNewPool(false)} aria-label="Cancel" className="h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground shrink-0"><X className="h-4 w-4"/></button>
                    </div>
                    <AccountPicker accounts={accounts} value={newPoolAccount} onChange={setNewPoolAccount} placeholder="Held in which account? (optional)" />
                  </div>
                ) : (
                  <button onClick={()=>setShowNewPool(true)} className="flex items-center gap-2 text-[12.5px] text-muted-foreground hover:text-foreground transition-colors">
                    <Plus className="h-3.5 w-3.5"/> New linked pool
                  </button>
                )}
              </div>

              {obligationGoals.length > 0 && (
                <>
                  <SubLabel>Obligation funding</SubLabel>
                  <div className="divide-y divide-border/15">
                    {obligationGoals.map(g => (
                      <EntryRow key={g.id} label={g.name} amount={g.monthlyTarget} accentClass="text-blue-400"
                        sublabel={accountLabel(accounts, g.accountId) ? `Held in ${accountLabel(accounts, g.accountId)}` : undefined}
                        expanded={expandedObligationGoalId === g.id} onToggle={()=>setExpandedObligationGoalId(expandedObligationGoalId===g.id?null:g.id)}>
                        <div className="flex items-center justify-between">
                          <LinkToCategoryControl goal={g} categories={expenseByCat.map(c=>c.cat)} formatCat={formatCat} onLink={updateSavingsGoal} />
                          <ConfirmDeleteButton label={`Remove ${g.name}`} itemName={g.name} onConfirm={()=>removeSavingsGoal(g.id)}
                            className="text-muted-foreground/40 hover:text-negative shrink-0" />
                        </div>
                      </EntryRow>
                    ))}
                  </div>
                </>
              )}

              <SubLabel>Recurring transfers</SubLabel>
              <div className="divide-y divide-border/15">
                {transferGoals.length === 0 ? (
                  <p className="px-4 py-4 text-center text-[12px] text-muted-foreground/60">Nothing tracked yet.</p>
                ) : transferGoals.map(g => (
                  <EntryRow key={g.id} label={g.name} amount={g.monthlyTarget} accentClass="text-violet-400"
                    sublabel={accountLabel(accounts, g.accountId) ? `Held in ${accountLabel(accounts, g.accountId)}` : undefined}
                    expanded={expandedTransferGoalId === g.id} onToggle={()=>setExpandedTransferGoalId(expandedTransferGoalId===g.id?null:g.id)}>
                    <div className="flex items-center justify-between">
                      <LinkToCategoryControl goal={g} categories={expenseByCat.map(c=>c.cat)} formatCat={formatCat} onLink={updateSavingsGoal} />
                      <ConfirmDeleteButton label={`Remove ${g.name}`} itemName={g.name} onConfirm={()=>removeSavingsGoal(g.id)}
                        className="text-muted-foreground/40 hover:text-negative shrink-0" />
                    </div>
                  </EntryRow>
                ))}
              </div>
            </SectionShell>
          </div>

          {/* ═══ One running "Detected" column for the whole page ═══ */}
          <div className="lg:sticky lg:top-4">
            <div className="rounded-2xl border border-border/60 bg-card/60 overflow-hidden">
              <div className="px-4 py-3.5 border-b border-border/40">
                <p className="text-[13px] font-semibold text-foreground">Detected</p>
                <p className="text-[11px] text-muted-foreground">Review the evidence, add it if it looks right</p>
              </div>
              <div className="divide-y divide-border/15 max-h-[calc(100vh-180px)] overflow-y-auto">
                {detectedEntries.length === 0 ? (
                  <div className="px-4 py-8 text-center space-y-2">
                    <p className="text-[12px] text-muted-foreground/60">Nothing detected right now.</p>
                    {dismissedRecurring.length > 0 && (
                      <p className="text-[11px] text-muted-foreground/50">
                        {dismissedRecurring.length} merchant{dismissedRecurring.length!==1?"s":""} previously ignored.{" "}
                        <button onClick={clearRecurringDismissals} className="text-[hsl(var(--primary))] font-medium hover:underline">
                          Restore them
                        </button>
                        {" "}if something's missing that shouldn't be.
                      </p>
                    )}
                  </div>
                ) : detectedEntries.map(item => (
                  <DetectedRow key={item.id} name={item.name} note={item.note} detail={item.detail} amount={item.amount}
                    txns={item.txns} section={item.section}
                    onAccept={item.onAccept} onFlag={item.onFlag} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      {obligationModal && (
        <ObligationEditModal
          initial={obligationModal.initial}
          defaultType={obligationModal.defaultType}
          accounts={accounts}
          onSubmit={(payload) => obligationModal.initial?.id ? updateObligation(obligationModal.initial.id, payload) : addObligation(payload)}
          onDelete={obligationModal.initial?.id ? () => removeObligationAndDismiss(obligationModal.initial as { id: string; name: string; merchant_hint?: string | null }) : undefined}
          onClose={()=>setObligationModal(null)}
        />
      )}
      {showCoverModal && obligationsUserId && (
        <CoverModal exceeded={obligationsExceeded} month={thisMonth} userId={obligationsUserId}
          onRaiseLimit={(ob, amt)=>updateObligation(ob.id, { amount: amt })} onClose={()=>setShowCoverModal(false)} />
      )}
    </div>
  );
}
