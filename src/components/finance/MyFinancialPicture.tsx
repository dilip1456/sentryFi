/**
 * My Financial Picture — a transaction-analysis-driven view of income,
 * obligations, expenses, and savings, organized by topic (Paycheck & Taxes,
 * Spending, Savings) rather than a blanket "Your Data vs. Insights" split —
 * each topic pairs its editable detected figures with the insight that
 * depends on them. A single "Needs attention" list under the hero collects
 * everything that needs a human decision (unassigned funding, a possibly
 * missing paycheck, overspending) instead of scattering that across four
 * different alert surfaces.
 *
 * Every figure starts as an APPROXIMATION inferred from the person's own
 * linked-account transaction history (via the shared src/lib/classify
 * pipeline) — nothing is hand-entered by default. A few things genuinely
 * can't be derived from bank transactions at all (ESPP/RSU payroll
 * withholding never posts anywhere; risk tolerance isn't a transaction),
 * so those start blank and are always editable. Everything else can be
 * corrected the same way, in Monthly view only — Full Picture is a pure
 * 12-month rollup of real detected data, not editable, since a monthly
 * correction doesn't have one unambiguous way to extrapolate into a year.
 *
 * Every number is still a disclosure trigger outside edit mode: clicking it
 * opens the literal transactions behind it, each of which opens the app's
 * real transaction editor (onOpenTxnDetail).
 */
import { useMemo, useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { fmtUSD as fmtUSDRaw } from "@/lib/format";
// This page shows whole-dollar figures only — every amount here is rounded
// before formatting so nothing ever renders with cents.
const fmtUSD = (n: number, opts?: Parameters<typeof fmtUSDRaw>[1]) => fmtUSDRaw(Math.round(n), opts);
import { fmtShortDate } from "@/lib/format-date";
import {
  TrendingUp, Landmark, PiggyBank, Receipt, Info, Pencil,
  ShieldCheck, ShieldAlert, CreditCard, Target, Wallet, RotateCcw, ChevronDown,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { ManualIncomeItem, FinancialPictureData, RiskProfile } from "@/hooks/useUserSettings";
import type { TxnType } from "@/lib/classify";
import {
  grossUpFromNet, estimatePreTaxSavings, federalTaxOwed, ficaOwed, type FilingStatus,
  HSA_LIMIT_2026, K401_LIMIT_2026, FEDERAL_BRACKETS_2026, STANDARD_DEDUCTION,
} from "@/lib/tax-calc";

// ─── Types ──────────────────────────────────────────────────────────────────

interface PTxn {
  id: string; account_id: string; amount: number | string; date: string;
  name: string | null; merchant_name: string | null; category?: string[] | null;
  pending?: boolean; [k: string]: unknown;
}
interface PAccount {
  id: string; account_id: string; name: string | null; official_name: string | null;
  type: string | null; subtype: string | null; mask?: string | null;
  current_balance?: number | string | null; [k: string]: unknown;
}
interface Classification { type: TxnType; subtype?: string; pairId?: string; reason?: string }

interface MyFinancialPictureProps {
  txns: PTxn[];
  accounts: PAccount[];
  getEffectiveCategory: (t: PTxn) => string;
  formatCat: (s: string) => string;
  catColor: (s: string) => string;
  classOf?: (t: PTxn) => Classification | undefined;
  manualIncome?: ManualIncomeItem[];
  onOpenTxnDetail?: (t: PTxn) => void;
  // Reuses the app-wide category budget targets (same ones Spending uses) —
  // Budgeted Categories edits write straight into these, not a parallel copy.
  budgets: Record<string, number>;
  onSetBudget: (cat: string, amount: number) => void;
  onRemoveBudget: (cat: string) => void;
  // Reuses the app-wide credit-card autopay map (same one the old Budget
  // page used) for the Cards & Payoff Accounts section and Coverage Health.
  cardAutopayFrom: Record<string, string>;
  onSetCardAutopayFrom: (cardAccountId: string, fundingAccountId: string) => void;
  onRemoveCardAutopayFrom: (cardAccountId: string) => void;
  // This page's own editable-overrides / funding-account-tags / risk profile.
  financialPicture: FinancialPictureData;
  onSetOverride: (key: string, amount: number) => void;
  onClearOverride: (key: string) => void;
  onSetFundingAccount: (key: string, accountId: string) => void;
  onClearFundingAccount: (key: string) => void;
  onSetRiskProfile: (profile: RiskProfile) => void;
}

type Period = "monthly" | "yearly";
type SavingsKind = "hsa" | "retirement" | "brokerage" | "general";

// ─── Date ranges ────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function currentMonthRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: ymd(start), end: ymd(end), label: now.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
}


// ─── Category-aware reclassification ───────────────────────────────────────
// The shared classifier's final fallback is deliberately conservative: any
// outflow it doesn't recognize becomes generic "spend". That's correct for
// Spending, but it means a mortgage or an HSA transfer that Plaid filed
// under a plain-text category (rather than its own PFC taxonomy) lands in
// Expenses instead of Obligations/Savings. Here — only here — the already-
// assigned category label is used as a second signal to re-bucket those.
const OBLIGATION_LOAN_RE = /mortgage|auto loan|student loan|\bloan\b/i;
const OBLIGATION_TAX_RE = /\btax(es)?\b/i;
// Broadened beyond the original "rent/insurance/utilities" set to also catch
// the small fixed recurring bills My Financial Picture now breaks out on
// their own (gym membership, phone/cable/internet, streaming subscriptions)
// rather than leaving them mixed into ordinary discretionary Expenses.
const OBLIGATION_BILL_RE = /\brent\b|insurance|bills? ?& ?utilities|bill payment|utilit(y|ies)|\bgym\b|membership|subscription|\bphone\b|\bcable\b|\binternet\b/i;
const SAVINGS_CATEGORY_RE = /invest|saving|retirement|brokerage|\b401k\b|\bira\b|\bhsa\b/i;

type Bucket = "income" | "obligation_loan" | "obligation_tax" | "obligation_bill" | "credit_card_payment" | "expense" | "savings" | null;

function resolveBucket(c: Classification, category: string): Bucket {
  switch (c.type) {
    case "income_salary": case "income_interest": case "income_other": return "income";
    case "obligation_loan": return "obligation_loan";
    case "obligation_tax": return "obligation_tax";
    case "obligation_bill": return "obligation_bill";
    case "credit_card_payment": return "credit_card_payment";
    case "savings_contribution": return "savings";
    case "spend": case "refund": {
      if (OBLIGATION_LOAN_RE.test(category)) return "obligation_loan";
      if (OBLIGATION_TAX_RE.test(category)) return "obligation_tax";
      if (OBLIGATION_BILL_RE.test(category)) return "obligation_bill";
      if (SAVINGS_CATEGORY_RE.test(category)) return "savings";
      return "expense";
    }
    default: return null;
  }
}

const HSA_RE = /^hsa$/i;
const RETIREMENT_RE = /^(401k|401a|403b|ira|roth)$/i;
const BROKERAGE_RE = /^(brokerage|cash management)$/i;

function kindFromSubtype(subtype: string | null | undefined): SavingsKind {
  const s = (subtype ?? "").toLowerCase();
  if (HSA_RE.test(s)) return "hsa";
  if (RETIREMENT_RE.test(s)) return "retirement";
  if (BROKERAGE_RE.test(s)) return "brokerage";
  return "general";
}

const SAVINGS_KIND_LABEL: Record<SavingsKind, string> = {
  hsa: "HSA",
  retirement: "Retirement (401k/403b/IRA)",
  brokerage: "Brokerage / investing",
  general: "General savings",
};

const BONUS_RE = /\bbonus\b/i;

// ─── Aggregation ────────────────────────────────────────────────────────────

interface Entry { label: string; amount: number; txns: PTxn[] }

interface PictureData {
  income: { salary: Entry; bonus: Entry; interest: Entry; other: Entry; manual: number; total: number };
  obligLoanByCat: Entry[];
  tax: Entry;
  billByCat: Entry[];
  cardPayments: Entry;
  expenseByCat: Entry[];
  savings: { byKind: Record<SavingsKind, Entry>; total: number };
  obligTotal: number;
  net: number;
}

/**
 * Proactive anomaly check so a missing/miscategorized paycheck surfaces on
 * its own instead of requiring the user to open the Salary tile to notice.
 * Looks at trailing history (excluding the current, possibly-incomplete
 * month) to establish a typical monthly paycheck count, then flags the
 * current month only once enough of it has elapsed that the shortfall is
 * actually meaningful rather than just "not paid yet this week."
 */
/** How many paychecks have landed this month vs. the typical count, based on
 * the trailing 6 months' history. Returns null when there isn't enough
 * history yet to say what "typical" even means. Shared by the passive
 * anomaly note below and the "Estimated · N of M paychecks found" confidence
 * marker next to Safe to spend — the same signal, two different uses. */
function paycheckStats(
  allTxns: PTxn[],
  classOf: ((t: PTxn) => Classification | undefined) | undefined,
  now: Date,
): { found: number; typical: number } | null {
  const since = new Date(now);
  since.setDate(since.getDate() - 180);
  const sinceStr = ymd(since);
  const curMonthKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

  const salaryTxns = allTxns.filter(t => {
    if (t.pending || t.date < sinceStr) return false;
    return classOf?.(t)?.type === "income_salary";
  });
  const priorTxns = salaryTxns.filter(t => t.date.slice(0, 7) !== curMonthKey);
  if (priorTxns.length < 3) return null; // not enough history for a reliable pattern

  const byMonth = new Map<string, number>();
  for (const t of priorTxns) byMonth.set(t.date.slice(0, 7), (byMonth.get(t.date.slice(0, 7)) ?? 0) + 1);
  const counts = [...byMonth.values()];
  const typical = Math.round(counts.reduce((a, b) => a + b, 0) / counts.length);
  if (typical < 2) return null; // once-a-month earners: nothing reliable to compare against mid-month

  const found = salaryTxns.filter(t => t.date.slice(0, 7) === curMonthKey).length;
  return { found, typical };
}

function detectIncomeAnomaly(
  allTxns: PTxn[],
  classOf: ((t: PTxn) => Classification | undefined) | undefined,
  now: Date,
): string | null {
  if (now.getDate() < 20) return null; // too early in the month to call it a shortfall
  const stats = paycheckStats(allTxns, classOf, now);
  if (!stats || stats.found >= stats.typical) return null;
  return `Usually ~${stats.typical} paychecks land per month based on recent history — only ${stats.found} found so far this month. Worth checking for a missing or miscategorized deposit.`;
}

/**
 * Catches the specific, very common case a passive anomaly note doesn't fix
 * on its own: a second paycheck that landed under "other income" instead of
 * "salary" (different merchant description, Plaid PFC mismatch, etc). If the
 * detected "other income" total is within shouting distance of what a single
 * paycheck looks like, it's almost certainly the missing paycheck itself.
 */
function detectMisclassifiedPaycheck(income: PictureData["income"]): { amount: number } | null {
  if (income.other.amount <= 0 || income.salary.txns.length === 0) return null;
  const avgPaycheck = income.salary.amount / income.salary.txns.length;
  if (avgPaycheck <= 0) return null;
  const ratio = income.other.amount / avgPaycheck;
  if (ratio > 0.8 && ratio < 1.25) return { amount: income.other.amount };
  return null;
}

const ORDINAL = (n: number) => {
  if (n % 10 === 1 && n % 100 !== 11) return `${n}st`;
  if (n % 10 === 2 && n % 100 !== 12) return `${n}nd`;
  if (n % 10 === 3 && n % 100 !== 13) return `${n}rd`;
  return `${n}th`;
};

/** The merchant/description name that shows up most often across a set of
 * transactions — used to say WHO the detected pattern is coming from. */
function mostCommonDesc(txns: PTxn[]): string | null {
  const counts = new Map<string, number>();
  for (const t of txns) {
    const d = (t.merchant_name || t.name || "").trim();
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Infers how often a set of transactions recurs from the actual gaps
 * between their dates — this is the same signal a "why is this Detected"
 * explanation should show: not just a total, but the pattern that produced
 * it (e.g. "lands every 14 days" → Biweekly).
 */
function detectCadence(txns: PTxn[]): { label: string; desc: string } | null {
  const dates = [...new Set(txns.map(t => t.date))].filter(Boolean).sort();
  if (dates.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    gaps.push(Math.round((new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86400000));
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  const daysOfMonth = dates.map(d => Number(d.slice(8, 10)));
  const consistentDay = daysOfMonth.every(d => Math.abs(d - daysOfMonth[0]) <= 2);

  if (median >= 6 && median <= 8) return { label: "Weekly", desc: `about every ${median} days` };
  if (median >= 12 && median <= 16) return { label: "Biweekly", desc: `about every ${median} days` };
  if (median >= 27 && median <= 32) {
    return { label: "Monthly", desc: consistentDay ? `around the ${ORDINAL(daysOfMonth[0])} of each month` : "about once a month" };
  }
  if (median >= 350) return { label: "Yearly", desc: "about once a year" };
  return { label: "Irregular", desc: `roughly every ${median} days` };
}

function sortedEntries(m: Map<string, Entry>): Entry[] {
  return [...m.values()].filter(e => Math.abs(e.amount) > 0.004).sort((a, b) => b.amount - a.amount);
}

function bump(m: Map<string, Entry>, key: string, amount: number, t: PTxn) {
  const e = m.get(key) ?? { label: key, amount: 0, txns: [] };
  e.amount += amount; e.txns.push(t);
  m.set(key, e);
}

function buildPicture(
  periodTxns: PTxn[],
  allTxns: PTxn[],
  accounts: PAccount[],
  classOf: ((t: PTxn) => Classification | undefined) | undefined,
  getEffectiveCategory: (t: PTxn) => string,
  manualIncome: ManualIncomeItem[],
  monthsInPeriod: number,
): PictureData {
  const accountsById = new Map(accounts.map(a => [a.account_id, a]));
  const txnById = new Map(allTxns.map(t => [t.id, t]));

  const salary: Entry = { label: "Salary", amount: 0, txns: [] };
  const bonus: Entry = { label: "Bonus", amount: 0, txns: [] };
  const interest: Entry = { label: "Interest / dividends", amount: 0, txns: [] };
  const other: Entry = { label: "Other income", amount: 0, txns: [] };

  const obligLoanByCat = new Map<string, Entry>();
  const tax: Entry = { label: "Taxes paid", amount: 0, txns: [] };
  const billByCat = new Map<string, Entry>();
  const cardPayments: Entry = { label: "Card payments", amount: 0, txns: [] };

  const expenseByCat = new Map<string, Entry>();

  const byKind: Record<SavingsKind, Entry> = {
    hsa: { label: SAVINGS_KIND_LABEL.hsa, amount: 0, txns: [] },
    retirement: { label: SAVINGS_KIND_LABEL.retirement, amount: 0, txns: [] },
    brokerage: { label: SAVINGS_KIND_LABEL.brokerage, amount: 0, txns: [] },
    general: { label: SAVINGS_KIND_LABEL.general, amount: 0, txns: [] },
  };

  for (const t of periodTxns) {
    if (t.pending) continue;
    const c = classOf?.(t);
    if (!c) continue;
    const amt = Number(t.amount) || 0;
    const cat = getEffectiveCategory(t) || "Other";
    const bucket = resolveBucket(c, cat);

    switch (bucket) {
      case "income": {
        const v = -amt;
        const desc = `${t.merchant_name ?? ""} ${t.name ?? ""}`;
        if (c.type === "income_salary") {
          if (BONUS_RE.test(desc)) { bonus.amount += v; bonus.txns.push(t); }
          else { salary.amount += v; salary.txns.push(t); }
        }
        else if (c.type === "income_interest") { interest.amount += v; interest.txns.push(t); }
        else { other.amount += v; other.txns.push(t); }
        break;
      }
      case "obligation_loan": if (amt > 0) bump(obligLoanByCat, cat, amt, t); break;
      case "obligation_tax": if (amt > 0) { tax.amount += amt; tax.txns.push(t); } break;
      case "obligation_bill": if (amt > 0) bump(billByCat, cat, amt, t); break;
      case "credit_card_payment": {
        // A card payment is money moving from checking to settle debt from
        // purchases that already happened — and if that card is itself a
        // linked account, those purchases are ALREADY counted individually
        // in expenseByCat. Counting the payment too would double the same
        // spending (buy $100 of groceries on the card, then "spend" another
        // $100 paying the bill). Only count the payment itself when the card
        // isn't linked, since then the payment is the only signal of that
        // spending we have at all.
        if (amt > 0) {
          const otherLeg = c.pairId ? txnById.get(c.pairId) : undefined;
          const cardAcct = otherLeg ? accountsById.get(otherLeg.account_id) : undefined;
          const cardIsLinked = cardAcct?.type === "credit";
          if (!cardIsLinked) { cardPayments.amount += amt; cardPayments.txns.push(t); }
        }
        break;
      }
      case "expense": bump(expenseByCat, cat, amt, t); break;
      case "savings": {
        if (amt <= 0) break;
        let kind: SavingsKind = "general";
        if (c.subtype === "brokerage") kind = "brokerage";
        else if (SAVINGS_CATEGORY_RE.test(cat)) kind = kindFromSubtype(cat.match(/hsa|401k|401a|403b|ira|roth|brokerage/i)?.[0]);
        else if (c.pairId) {
          const otherLeg = txnById.get(c.pairId);
          const acct = otherLeg ? accountsById.get(otherLeg.account_id) : undefined;
          kind = kindFromSubtype(acct?.subtype);
        }
        byKind[kind].amount += amt; byKind[kind].txns.push(t);
        break;
      }
      default: break;
    }
  }

  const manualTotal = manualIncome.reduce((sum, m) => sum + m.amount * monthsInPeriod, 0);

  const incomeTotal = salary.amount + bonus.amount + interest.amount + other.amount + manualTotal;
  const obligLoanTotal = [...obligLoanByCat.values()].reduce((s, e) => s + e.amount, 0);
  const billTotal = [...billByCat.values()].reduce((s, e) => s + e.amount, 0);
  const obligTotal = obligLoanTotal + tax.amount + billTotal + cardPayments.amount;
  const expenseTotal = [...expenseByCat.values()].reduce((s, e) => s + e.amount, 0);
  const savingsTotal = Object.values(byKind).reduce((s, e) => s + e.amount, 0);

  return {
    income: { salary, bonus, interest, other, manual: manualTotal, total: incomeTotal },
    obligLoanByCat: sortedEntries(obligLoanByCat),
    tax,
    billByCat: sortedEntries(billByCat),
    cardPayments,
    expenseByCat: sortedEntries(expenseByCat),
    savings: { byKind, total: savingsTotal },
    obligTotal,
    net: incomeTotal - obligTotal - expenseTotal - savingsTotal,
  };
}

// ─── Funding-account inference ─────────────────────────────────────────────
// "Which account pays this?" starts as a guess from the transactions
// themselves (the account most of them actually posted to) and is promoted
// to a confirmed answer the moment the user picks one explicitly — at which
// point it's trusted even if a future month's transactions disagree (prices
// change, a bill gets re-shopped to a new card, etc).
// Strip redundant words a bank's own marketing name tends to repeat — the
// last 4 digits spelled out in the name AND appended again as a mask ("US
// Bank Cash+ Card - 3415" + "••3415"), or a trailing "Card" when the product
// name already implies one ("Unlimited Cash Rewards World Mastercard Card")
// — so the label reads once, cleanly, without losing real product names that
// happen to end in "Card" on their own ("Chase Sapphire Card" stays as-is).
function cleanAccountName(name: string, mask: string | null | undefined): string {
  let n = name.trim();
  if (mask) n = n.replace(new RegExp(`[-–]?\\s*${mask}\\s*$`), "").trim();
  const trailingCard = n.match(/^(.*)\s+card$/i);
  if (trailingCard && /card/i.test(trailingCard[1])) n = trailingCard[1].trim();
  return n || name.trim();
}

// The person's own account nickname is always the real identity — a long
// bank marketing name just gets to truncate-with-tooltip (handled by the
// caller), never get replaced with a generic "Checking"/"Savings" label,
// which would make every account of the same subtype look identical (and
// once did: an escrow sub-account rendered as indistinguishable "Savings").
function acctLabel(acc: PAccount | undefined | null): string {
  if (!acc) return "Account";
  const name = cleanAccountName(acc.name ?? acc.official_name ?? "Account", acc.mask);
  return acc.mask ? `${name} ••${acc.mask}` : name;
}

function resolveFunding(
  entry: Entry, override: string | undefined, accountsById: Map<string, PAccount>,
): { accountId: string | null; label: string | null; confirmed: boolean } {
  if (override) {
    return { accountId: override, label: acctLabel(accountsById.get(override)), confirmed: true };
  }
  if (entry.txns.length === 0) return { accountId: null, label: null, confirmed: false };
  const counts = new Map<string, number>();
  for (const t of entry.txns) counts.set(t.account_id, (counts.get(t.account_id) ?? 0) + 1);
  const [topId, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topCount / entry.txns.length < 0.6) return { accountId: null, label: null, confirmed: false };
  return { accountId: topId, label: acctLabel(accountsById.get(topId)), confirmed: false };
}

// ─── Small presentational pieces ───────────────────────────────────────────

function SectionCard({
  icon: Icon, title, subtitle, accent, children,
}: { icon: typeof TrendingUp; title: string; subtitle?: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="surface-card overflow-hidden flex flex-col">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/20 min-w-0">
        <div className="h-8 w-8 rounded-lg grid place-items-center shrink-0" style={{ backgroundColor: `${accent}1f`, color: accent }}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <span className="font-semibold text-foreground text-[13.5px] truncate block">{title}</span>
          {subtitle && <span className="text-[10.5px] text-muted-foreground truncate block">{subtitle}</span>}
        </div>
      </div>
      <div className="px-4 pt-1 pb-2 flex-1 divide-y divide-border/40 [&>*]:py-2.5">{children}</div>
    </div>
  );
}

/**
 * One list item within a SectionCard. Usually wraps a single DataRow, but can
 * hold a primary row plus its subordinate "detail" row (e.g. an employer
 * HSA/401(k) contribution under its own HSA/401(k) row) tightly spaced with
 * no divider between them, and/or a tiny uppercase sub-label ("Loans" vs
 * "Bills") — so a flat list of equally-weighted rows instead reads as a
 * handful of organized groups.
 */
function RowGroup({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div>
      {label && <div className="text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground/70 pb-1">{label}</div>}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <p className="text-[12px] text-muted-foreground italic py-1">{text}</p>;
}

/** Small "Detected" / "Edited" / "Manual" status pill shown next to a field. */
function StatusPill({ status }: { status: "detected" | "edited" | "manual" }) {
  // "Manual" status means "nothing detected and nothing entered yet" — never
  // a real value someone typed in (once they do, it becomes "edited"). Badging
  // a $0 field the user never touched as "Manual" reads as if they'd entered
  // it; "Not set" says what's actually true.
  const label = status === "edited" ? "Edited" : status === "detected" ? "Detected" : "Not set";
  const cls = status === "edited"
    ? "bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))]"
    : status === "detected"
      ? "bg-positive/10 text-positive"
      : "bg-muted/60 text-muted-foreground";
  return <span className={cn("inline-flex items-center h-4.5 px-1.5 rounded text-[9.5px] font-semibold uppercase tracking-wide shrink-0", cls)}>{label}</span>;
}

/**
 * A native-select "paid by" tag — doubles as the funding-account picker.
 * Red/"Unassigned" is the only status color here (it means "needs a real
 * answer"); once an account is assigned, the tag is a single neutral tone
 * for every account. A per-account hash-of-the-name color used to be applied
 * instead, which read as a meaningful status signal (why is this one purple
 * and that one orange?) when it was really just decoration with no
 * information behind it. A small chevron marks it as a dropdown (vs. the
 * plain read-only pill).
 */
function FundingTag({ accountId, label, accounts, onChange, onClear, readOnly }: {
  accountId: string | null; label: string | null; accounts: PAccount[];
  onChange?: (id: string) => void; onClear?: () => void; readOnly?: boolean;
}) {
  if (!accountId || !label) {
    if (readOnly) return null;
    return (
      <div className="relative shrink-0">
        <select value="" onChange={e => e.target.value && onChange?.(e.target.value)} title="Set funding account"
          className="h-6 w-[110px] rounded-full border border-negative/30 bg-negative/10 text-negative text-[11px] font-medium pl-2 pr-4 outline-none truncate appearance-none">
          <option value="">Unassigned</option>
          {accounts.map(a => (
            <option key={a.account_id} value={a.account_id}>{acctLabel(a)}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-negative" />
      </div>
    );
  }
  if (readOnly) {
    return <span title={label} className="inline-flex items-center h-6 px-2.5 rounded-full text-[11px] font-medium truncate max-w-[130px] shrink-0 bg-muted/60 text-foreground">{label}</span>;
  }
  return (
    <div className="relative shrink-0" title={label}>
      <select value={accountId} onChange={e => e.target.value ? onChange?.(e.target.value) : onClear?.()}
        className="h-6 w-[130px] rounded-full text-[11px] font-medium pl-2.5 pr-4 outline-none truncate border-0 appearance-none bg-muted/60 text-foreground">
        <option value="">Unassigned</option>
        {accounts.map(a => (
          <option key={a.account_id} value={a.account_id}>{acctLabel(a)}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-muted-foreground" />
    </div>
  );
}

/**
 * A single "Your Data" row. The amount reads as plain text by default — click
 * it to see the transactions behind it (the page's standing promise), click
 * the pencil (editable rows only) to correct it inline. No badge for the
 * ordinary case (detected); a badge only appears for the exceptions (edited,
 * manual-entry). Every optional slot (pencil, badge, funding tag, reset) is a
 * fixed-width placeholder — present or not, rows in the same section still
 * line up column-for-column.
 */
function DataRow({
  label, amount, txns, fieldKey, status, funding, onCommit, onReset, onSelect, editable, detail, warning, percentBasis,
}: {
  label: string; amount: number; txns: PTxn[]; fieldKey: string;
  status?: "detected" | "edited" | "manual";
  funding?: React.ReactNode;
  onCommit?: (v: number) => void;
  onReset?: () => void;
  onSelect: (entry: Entry) => void;
  editable?: boolean;
  // Marks this as a subordinate "detail" line under a primary row above it
  // (e.g. an employer HSA/401(k) contribution under its own account row) —
  // indented, smaller and muted, so the pair reads as one unit.
  detail?: boolean;
  // A subtle "this number is rougher than it looks" flag — a small info
  // icon next to the label with the caveat on hover, distinct from the
  // edited/detected status pill system (which is about provenance, not
  // accuracy).
  warning?: string;
  // Monthly salary basis to convert against when this field is entered as a
  // percentage (401k/ESPP elections are usually described as "X% of pay")
  // instead of a dollar amount. Stored value is always a dollar amount —
  // this only changes what the edit input accepts.
  percentBasis?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [pctMode, setPctMode] = useState(false);
  const hasTxns = txns.length > 0;
  const canEdit = !!(editable && onCommit);
  const canPercent = canEdit && !!percentBasis && percentBasis > 0;
  const showPill = status && status !== "detected";
  const showReset = status === "edited" && !!onReset;
  return (
    <div className={cn("flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 group -mx-4 px-4 hover:bg-muted/30 transition-colors",
      detail && "pl-4")}>
      <span className={cn("truncate sm:min-w-0 sm:flex-1 inline-flex items-center gap-1.5", detail ? "text-[11.5px] text-muted-foreground" : "text-[12.5px] text-foreground")}>
        {label}
        {warning && (
          <span title={warning} className="inline-flex shrink-0 cursor-help">
            <Info aria-label={warning} className="h-3 w-3 text-muted-foreground/60" />
          </span>
        )}
      </span>
      {/* Everything here hugs the amount, which is always the rightmost
          element — no reserved dead-space slots. A row with no funding tag
          and no pill no longer leaves a ~120px gap before the amount; it
          just sits flush against the row's right edge like every other row. */}
      <div className="flex items-center justify-end gap-1.5 flex-wrap sm:flex-nowrap sm:shrink-0">
        {funding}
        {showPill && <StatusPill status={status!} />}
        {showReset && (
          <button type="button" onClick={onReset} aria-label={`Reset ${label} to detected value`} title="Reset to detected value"
            className="h-6 w-6 shrink-0 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} aria-label={`Edit ${label}`} title="Edit this value"
            className="h-6 w-6 shrink-0 grid place-items-center rounded-md text-muted-foreground opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 hover:!text-foreground hover:bg-muted/50 transition-colors">
            <Pencil className="h-3 w-3" />
          </button>
        )}
        {editing ? (
          <span className="inline-flex items-center gap-1 shrink-0">
            {canPercent && (
              <span className="inline-flex rounded-md border border-border/50 overflow-hidden shrink-0">
                {(["$", "%"] as const).map(m => (
                  <button key={m} type="button" onClick={() => setPctMode(m === "%")}
                    className={cn("h-7 w-6 text-[11px] font-semibold", (m === "%") === pctMode ? "bg-muted text-foreground" : "text-muted-foreground")}>
                    {m}
                  </button>
                ))}
              </span>
            )}
            <span className="relative inline-flex items-center w-24 shrink-0">
              <span className="absolute left-2 text-[11.5px] text-muted-foreground pointer-events-none">{pctMode ? "%" : "$"}</span>
              <input
                key={`${fieldKey}:${amount}:${pctMode}`}
                type="number"
                autoFocus
                defaultValue={pctMode ? (percentBasis ? +((amount / percentBasis) * 100).toFixed(1) : 0) : Math.round(amount)}
                onBlur={e => {
                  const n = parseFloat(e.target.value);
                  if (!isNaN(n)) onCommit?.(pctMode && percentBasis ? (n / 100) * percentBasis : n);
                  setEditing(false);
                }}
                onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
                className="w-full h-7 rounded-md border border-[hsl(var(--primary)/0.5)] bg-card pl-5 pr-1.5 text-[12.5px] font-semibold tabular text-right outline-none"
              />
            </span>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => hasTxns && onSelect({ label, amount, txns })}
            disabled={!hasTxns}
            aria-label={hasTxns ? `${label}: ${fmtUSD(amount)}, view transactions` : `${label}: ${fmtUSD(amount)}`}
            title={hasTxns ? "View transactions" : undefined}
            className={cn("shrink-0 text-[12.5px] font-semibold tabular text-right truncate bg-transparent rounded px-1 -mx-1 min-w-[60px]",
              hasTxns ? "text-foreground hover:text-[hsl(var(--primary))] cursor-pointer" : "text-muted-foreground cursor-default")}>
            {fmtUSD(amount)}
          </button>
        )}
      </div>
    </div>
  );
}

/** Shared popup showing the literal transactions behind any clicked number. */
function BreakdownDialog({ entry, formatCat, accountsById, onClose, onOpenTxn }: {
  entry: Entry | null; formatCat: (s: string) => string; accountsById: Map<string, PAccount>; onClose: () => void; onOpenTxn: (t: PTxn) => void;
}) {
  // "Calculated" shouldn't be a black box — show the actual pattern behind
  // the number: who it's from, which account it lands in, and how often,
  // not just the total and a transaction list.
  const cadence = entry ? detectCadence(entry.txns) : null;
  const desc = entry ? mostCommonDesc(entry.txns) : null;
  const firstAcctId = entry?.txns[0]?.account_id;
  const acctName = firstAcctId ? acctLabel(accountsById.get(firstAcctId)) : null;
  const isInflow = entry ? entry.txns.filter(t => Number(t.amount) < 0).length > entry.txns.length / 2 : false;
  return (
    <Dialog open={!!entry} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        {entry && (
          <>
            <DialogHeader>
              <DialogTitle className="font-display">{formatCat(entry.label)}</DialogTitle>
              <DialogDescription>{fmtUSD(entry.amount)} across {entry.txns.length} transaction{entry.txns.length === 1 ? "" : "s"}</DialogDescription>
            </DialogHeader>
            {cadence && desc && (
              <div className="rounded-lg bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground leading-snug">
                <span className="font-semibold text-foreground">Calculated based on pattern detected: </span>
                {desc} {isInflow ? "deposits" : "charges"}{acctName ? ` in ${acctName}` : ""} land {cadence.desc} — inferring <strong className="text-foreground">{cadence.label.toLowerCase()} {formatCat(entry.label).toLowerCase()}</strong>.
              </div>
            )}
            <div className="max-h-80 overflow-y-auto -mx-6 px-2">
              {entry.txns.map(t => (
                <button key={t.id} onClick={() => { onClose(); onOpenTxn(t); }}
                  className="w-full grid grid-cols-[1fr_52px_72px] items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 rounded-lg">
                  <span className="text-[13px] text-foreground truncate">{t.merchant_name || t.name || "Transaction"}</span>
                  <span className="text-[11px] text-muted-foreground text-right shrink-0 tabular">{t.date ? fmtShortDate(t.date) : ""}</span>
                  <span className="text-[13px] font-semibold tabular text-right shrink-0">{fmtUSD(Math.abs(Number(t.amount) || entry.amount))}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">Tap a transaction to edit its category or type.</p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface BasicInfo {
  grossSalary: number; filingStatus: FilingStatus; matchPct: number;
  hsaEmployer: number; espp: number; rsu: number; payFrequency: number;
}
const PAY_FREQUENCIES = ["Weekly", "Biweekly", "Semimonthly", "Monthly"];

/**
 * A short, optional form for the handful of facts that aren't derivable
 * from transactions at all (gross pay, filing status, employer benefits)
 * but drive most of the tax and paycheck math on this page. Reachable from
 * a small dismissible banner rather than a blocking first-run wizard —
 * nothing here is required to use the rest of the page.
 */
function OnboardingDialog({ open, initial, onClose, onSave }: {
  open: boolean; initial: BasicInfo; onClose: () => void; onSave: (v: BasicInfo) => void;
}) {
  const [form, setForm] = useState<BasicInfo>(initial);
  useEffect(() => { if (open) setForm(initial); }, [open, initial]);

  // Short one-line tooltip next to a label, for terms like ESPP/RSU that
  // aren't universally known — a native `title` tooltip stays a one-liner
  // on hover instead of adding permanent on-screen paragraph text.
  const fieldLabel = (label: string, hint?: string) => (
    <span className="inline-flex items-center gap-1 text-[12px] text-foreground min-w-0 truncate">
      <span className="truncate">{label}</span>
      {hint && (
        <span title={hint} className="inline-flex shrink-0 items-center cursor-help translate-y-[0.5px]">
          <Info aria-label={hint} className="h-3 w-3 text-muted-foreground/60" />
        </span>
      )}
    </span>
  );

  // Every row shares this grid so the label column and the control column
  // line up at the same x position across all rows, regardless of the
  // control type (input / select / button group) - a real two-column table
  // rather than independently-sized flex rows.
  const row = (label: React.ReactNode, control: React.ReactNode) => (
    <div className="grid grid-cols-[1fr_104px] items-center gap-3">
      {label}
      <div className="flex justify-end">{control}</div>
    </div>
  );

  const numberField = (label: string, key: "grossSalary" | "matchPct" | "hsaEmployer" | "espp" | "rsu", suffix: string, hint?: string) =>
    row(fieldLabel(label, hint), (
      <span className="relative inline-flex items-center w-full">
        <input type="number" value={form[key] || ""} placeholder="0"
          onChange={e => setForm(f => ({ ...f, [key]: parseFloat(e.target.value) || 0 }))}
          className="w-full h-8 rounded-md border border-border/60 bg-card pl-2 pr-7 text-[12.5px] font-semibold tabular text-right outline-none" />
        <span className="absolute right-2 text-[10.5px] text-muted-foreground pointer-events-none">{suffix}</span>
      </span>
    ));

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display">Basic info</DialogTitle>
          <DialogDescription className="text-[11px]">All fields optional — improves accuracy.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <RowGroup label="Pay">
            {numberField("Gross annual salary", "grossSalary", "$/yr")}
            {row(fieldLabel("Filing status"), (
              <div className="flex w-full rounded-lg border border-border/50 p-0.5 bg-muted/20">
                {(["single", "married_joint"] as const).map(fs => (
                  <button key={fs} type="button" onClick={() => setForm(f => ({ ...f, filingStatus: fs }))}
                    className={cn("flex-1 px-1 py-1 rounded-md text-[11px] font-medium whitespace-nowrap", form.filingStatus === fs ? "bg-card shadow text-foreground" : "text-muted-foreground")}>
                    {fs === "single" ? "Single" : "Married"}
                  </button>
                ))}
              </div>
            ))}
            {row(fieldLabel("Pay frequency"), (
              <select value={form.payFrequency} onChange={e => setForm(f => ({ ...f, payFrequency: Number(e.target.value) }))}
                className="w-full h-8 rounded-md border border-border/60 bg-card px-2 text-[12px] outline-none">
                {PAY_FREQUENCIES.map((p, i) => <option key={p} value={i}>{p}</option>)}
              </select>
            ))}
          </RowGroup>
          <RowGroup label="Employer benefits">
            {numberField("401(k) match", "matchPct", "%", "% of salary your employer adds to your retirement account")}
            {numberField("HSA contribution", "hsaEmployer", "$/mo", "Money your employer adds to your HSA each month")}
            {numberField("ESPP", "espp", "$/mo", "Employee Stock Purchase Plan: payroll money used to buy company stock")}
            {numberField("RSU withheld", "rsu", "$/mo", "Taxes withheld when your company stock (RSUs) vests")}
          </RowGroup>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="h-8 px-3 rounded-md text-[12px] font-medium text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={() => { onSave(form); onClose(); }} className="h-8 px-3 rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-[12px] font-semibold">Save</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const RISK_PROFILES: { key: RiskProfile; label: string; blurb: string; color: string }[] = [
  { key: "conservative", label: "Conservative", blurb: "You prefer stability and protecting what you have over growth.", color: "hsl(var(--positive))" },
  { key: "moderate", label: "Moderate", blurb: "You balance growth and stability, with a moderate tolerance for risk.", color: "hsl(var(--primary))" },
  { key: "aggressive", label: "Aggressive", blurb: "You're comfortable with volatility in exchange for higher growth potential.", color: "#f59e0b" },
];

/** A half-circle speedometer — click a third of the arc to set that risk level. */
function RiskGauge({ value, onPick }: { value: RiskProfile | undefined; onPick: (p: RiskProfile) => void }) {
  const idx = value ? RISK_PROFILES.findIndex(r => r.key === value) : -1;
  const w = 168, h = 92, cx = w / 2, cy = h - 6, r = 70;
  const polar = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx - r * Math.cos(rad), y: cy - r * Math.sin(rad) };
  };
  const arcPath = (a: number, b: number) => {
    const p1 = polar(a), p2 = polar(b);
    return `M ${p1.x} ${p1.y} A ${r} ${r} 0 0 1 ${p2.x} ${p2.y}`;
  };
  const segments: [number, number, RiskProfile][] = [[180, 120, "conservative"], [120, 60, "moderate"], [60, 0, "aggressive"]];
  const angle = idx >= 0 ? [150, 90, 30][idx] : 90;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="shrink-0">
      {segments.map(([a, b, key]) => (
        <path key={key} d={arcPath(a, b)} stroke={RISK_PROFILES.find(r => r.key === key)!.color} strokeWidth={11} fill="none"
          strokeLinecap="round" opacity={value === key ? 1 : value ? 0.25 : 0.45}
          className="cursor-pointer" onClick={() => onPick(key)} />
      ))}
      {value && (
        <g transform={`rotate(${90 - angle} ${cx} ${cy})`} style={{ transition: "transform 300ms ease" }}>
          <line x1={cx} y1={cy} x2={cx} y2={cy - r + 16} stroke="hsl(var(--foreground))" strokeWidth={2.5} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={4.5} fill="hsl(var(--foreground))" />
        </g>
      )}
    </svg>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function MyFinancialPicture({
  txns, accounts, getEffectiveCategory, formatCat, catColor, classOf, manualIncome = [], onOpenTxnDetail,
  budgets, onSetBudget, onRemoveBudget, cardAutopayFrom, onSetCardAutopayFrom, onRemoveCardAutopayFrom,
  financialPicture, onSetOverride, onClearOverride, onSetFundingAccount, onClearFundingAccount, onSetRiskProfile,
}: MyFinancialPictureProps) {
  const [period, setPeriod] = useState<Period>("monthly");
  // Persisted via a numeric override (0=single, 1=married_joint) rather than
  // local-only state, which used to reset to "Single" on every reload.
  const [filingStatus, setFilingStatusState] = useState<FilingStatus>(
    () => (financialPicture.overrides["filingStatusCode"] === 1 ? "married_joint" : "single"),
  );
  const setFilingStatus = (fs: FilingStatus) => {
    setFilingStatusState(fs);
    onSetOverride("filingStatusCode", fs === "married_joint" ? 1 : 0);
  };
  const now = useMemo(() => new Date(), []);
  const currentCalendarYear = now.getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentCalendarYear);
  const isCurrentYear = selectedYear === currentCalendarYear;

  // Every year that actually has transaction history, newest first, plus
  // the current year even if it's empty — this is what the Yearly tab's
  // year picker offers.
  const availableYears = useMemo(() => {
    const years = new Set<number>([currentCalendarYear]);
    for (const t of txns) { const y = Number(t.date.slice(0, 4)); if (y) years.add(y); }
    return [...years].sort((a, b) => b - a);
  }, [txns, currentCalendarYear]);

  // For the current year this is "so far" (Jan 1 - today, real detected
  // data only); for a past year it's the whole thing. Either way the range
  // itself is never projected — projectionMultiplier is applied separately
  // (via `scale` below) so it's clear what's real vs. extrapolated.
  const yearRange = useMemo(() => {
    const start = new Date(selectedYear, 0, 1);
    const end = isCurrentYear ? now : new Date(selectedYear, 11, 31);
    const daysInYear = Math.round((new Date(selectedYear, 11, 31).getTime() - start.getTime()) / 86400000) + 1;
    const daysElapsed = isCurrentYear ? Math.max(1, Math.round((now.getTime() - start.getTime()) / 86400000) + 1) : daysInYear;
    return {
      start: ymd(start), end: ymd(end),
      label: isCurrentYear ? `${selectedYear} (so far, projected to year end)` : String(selectedYear),
      monthsElapsed: isCurrentYear ? now.getMonth() + 1 : 12,
      projectionMultiplier: isCurrentYear ? daysInYear / daysElapsed : 1,
    };
  }, [selectedYear, isCurrentYear, now]);

  const range = period === "monthly" ? currentMonthRange(now) : yearRange;
  const monthsInPeriod = period === "monthly" ? 1 : yearRange.monthsElapsed;
  const canEdit = period === "monthly"; // overrides are monthly figures; Yearly is a pure, non-editable rollup
  // Applied to every detected figure when NOT editable: 1x for Monthly and
  // for a complete past year, >1x only for the current year's "so far"
  // numbers, so Yearly reads as a real projection instead of an understated
  // partial total.
  const scale = canEdit ? 1 : yearRange.projectionMultiplier;

  const periodTxns = useMemo(
    () => txns.filter(t => t.date >= range.start && t.date <= range.end),
    [txns, range.start, range.end],
  );

  const data = useMemo(
    () => buildPicture(periodTxns, txns, accounts, classOf, getEffectiveCategory, manualIncome, monthsInPeriod),
    [periodTxns, txns, accounts, classOf, getEffectiveCategory, manualIncome, monthsInPeriod],
  );

  // Always the current calendar month, regardless of which tab is selected —
  // used only as a stable base for the gross-salary ×12 default below, so
  // switching tabs doesn't change what that estimate is built from.
  const curMonthRangeRef = useMemo(() => currentMonthRange(now), [now]);
  const curMonthTxns = useMemo(
    () => txns.filter(t => t.date >= curMonthRangeRef.start && t.date <= curMonthRangeRef.end),
    [txns, curMonthRangeRef.start, curMonthRangeRef.end],
  );
  const currentMonthData = useMemo(
    () => buildPicture(curMonthTxns, txns, accounts, classOf, getEffectiveCategory, manualIncome, 1),
    [curMonthTxns, txns, accounts, classOf, getEffectiveCategory, manualIncome],
  );

  // Tax Savers and Tax Bracket are inherently annual concepts, so they
  // always follow the SELECTED YEAR (projected if it's the current year)
  // regardless of whether the Monthly or Yearly tab is active — switching
  // to Monthly to correct a transaction shouldn't also reset what year the
  // tax cards are talking about.
  const yearPeriodTxns = useMemo(
    () => txns.filter(t => t.date >= yearRange.start && t.date <= yearRange.end),
    [txns, yearRange.start, yearRange.end],
  );
  const yearData = useMemo(
    () => buildPicture(yearPeriodTxns, txns, accounts, classOf, getEffectiveCategory, manualIncome, yearRange.monthsElapsed),
    [yearPeriodTxns, txns, accounts, classOf, getEffectiveCategory, manualIncome, yearRange.monthsElapsed],
  );

  const incomeAnomaly = useMemo(
    () => (period === "monthly" ? detectIncomeAnomaly(txns, classOf, new Date()) : null),
    [period, txns, classOf],
  );

  const overrides = financialPicture.overrides;
  const fundingAccounts = financialPicture.fundingAccounts;
  const accountsById = useMemo(() => new Map(accounts.map(a => [a.account_id, a])), [accounts]);
  // Funding-account pickers are for "which account do you pay this bill
  // from" — that's always a checking or savings account in practice, never a
  // retirement account, a brokerage, or the credit card itself.
  const payableAccounts = useMemo(
    () => accounts.filter(a => a.type === "depository" && (a.subtype === "checking" || a.subtype === "savings")),
    [accounts],
  );
  // Budgeted Categories is a different question — "which account does this
  // spending actually happen on" — and for discretionary spend that's very
  // often a credit card (daily purchases for rewards), not a checking
  // account paying a bill. Restricting this picker to checking/savings made
  // the dropdown's selected value fall outside its own option list whenever
  // the detected account was a card: the browser then renders the first
  // option's text ("Unassigned") while the real value script still held the
  // card's id, so the chip looked colored/assigned but read "Unassigned."
  const spendSourceAccounts = useMemo(
    () => accounts.filter(a => a.type === "depository" || a.type === "credit"),
    [accounts],
  );

  // Effective value for an editable field: in Monthly view, the user's
  // override wins if set; in Yearly view overrides never apply — it's
  // always the real detected total for the selected year, scaled up to a
  // full-year projection when that year is still in progress.
  const eff = (key: string, detected: number) => (canEdit ? overrides[key] ?? detected : detected * scale);
  const status = (key: string, detected: number): "detected" | "edited" | "manual" =>
    canEdit && key in overrides ? "edited" : detected > 0 ? "detected" : "manual";

  const salaryMonthly = data.income.salary.amount;
  const bonusMonthly = data.income.bonus.amount;
  const hsaMonthly = data.savings.byKind.hsa.amount;
  const k401Monthly = data.savings.byKind.retirement.amount;

  const salaryEff = eff("income.salary", salaryMonthly);
  const bonusEff = eff("income.bonus", bonusMonthly);
  const otherEff = eff("income.other", data.income.other.amount);
  // Gross annual salary has no detected counterpart at all (banks only ever
  // see the net deposit) — it exists purely so "Your Paycheck" below can
  // compute a real gross-to-net breakdown instead of estimating gross from
  // net. Not period-scaled like the other Income rows since it's always an
  // annual figure regardless of the Monthly/Full Picture tab. When nothing's
  // been entered, default to an estimate built from the real pay PATTERN —
  // not just whatever happened to land in the current calendar month, which
  // can hold 2 or 3 paychecks for a biweekly earner depending on the
  // calendar and so over/undercounts by a wide margin. Instead: look back up
  // to a year of Salary-classified deposits, detect how often they actually
  // recur (the same cadence detector used for the "Calculated based on
  // pattern detected" note elsewhere), and annualize the typical paycheck at
  // the right number of pay periods a year. It's deliberately NOT a tax
  // gross-up (that would be a second, fuzzier estimate on top of a first);
  // the DataRow for this field flags it as an estimate so it's never
  // mistaken for a real number.
  const salaryHistoryCutoff = useMemo(() => ymd(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())), [now]);
  const salaryHistoryTxns = useMemo(() => {
    const rows: PTxn[] = [];
    for (const t of txns) {
      if (t.pending || t.date < salaryHistoryCutoff) continue;
      if (classOf?.(t)?.type !== "income_salary") continue;
      if (BONUS_RE.test(`${t.merchant_name ?? ""} ${t.name ?? ""}`)) continue;
      rows.push(t);
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }, [txns, classOf, salaryHistoryCutoff]);
  const bonusTrailingYearTotal = useMemo(() => {
    let total = 0;
    for (const t of txns) {
      if (t.pending || t.date < salaryHistoryCutoff) continue;
      if (classOf?.(t)?.type !== "income_salary") continue;
      if (!BONUS_RE.test(`${t.merchant_name ?? ""} ${t.name ?? ""}`)) continue;
      total += -(Number(t.amount) || 0);
    }
    return total;
  }, [txns, classOf, salaryHistoryCutoff]);
  const salaryCadence = useMemo(() => detectCadence(salaryHistoryTxns), [salaryHistoryTxns]);
  const PAY_PERIODS_PER_YEAR: Record<string, number> = { Weekly: 52, Biweekly: 26, Monthly: 12, Yearly: 1 };
  const salaryCadencePeriods = salaryCadence ? PAY_PERIODS_PER_YEAR[salaryCadence.label] : undefined;
  // Pattern detected and there's enough history to trust it (2+ paychecks) —
  // annualize the median paycheck at the detected cadence, plus whatever
  // bonuses actually landed over the trailing year (summed as-is, never
  // multiplied — a bonus isn't a recurring monthly amount). Otherwise fall
  // back to the simplest estimate: this month's detected net deposit × 12.
  const grossSalaryUsedCadence = !!salaryCadencePeriods && salaryHistoryTxns.length >= 2;
  const grossSalaryDefault = useMemo(() => {
    if (grossSalaryUsedCadence) {
      const amounts = salaryHistoryTxns.map(t => -(Number(t.amount) || 0)).sort((a, b) => a - b);
      const median = amounts[Math.floor(amounts.length / 2)];
      return median * salaryCadencePeriods! + bonusTrailingYearTotal;
    }
    return (currentMonthData.income.salary.amount + currentMonthData.income.bonus.amount) * 12;
  }, [grossSalaryUsedCadence, salaryHistoryTxns, salaryCadencePeriods, bonusTrailingYearTotal, currentMonthData]);
  const grossSalaryIsEstimated = !("income.grossSalaryAnnual" in overrides);
  const grossSalaryEff = overrides["income.grossSalaryAnnual"] ?? grossSalaryDefault;
  const misclassifiedPaycheck = useMemo(
    // Once the user has acted on this (or otherwise corrected "other income"
    // themselves), stop nagging with the stale detected figure — the row
    // itself already reflects their correction.
    () => (period === "monthly" && !("income.other" in overrides) ? detectMisclassifiedPaycheck(data.income) : null),
    [period, data.income, overrides],
  );
  const esppEff = eff("deduction.espp", 0);
  const rsuEff = eff("deduction.rsu", 0);
  const hsaEff = eff("deduction.hsa", hsaMonthly);
  const k401Eff = eff("deduction.401k", k401Monthly);
  // Employer HSA contributions never post to a linked account either — same
  // "not derivable, always editable" treatment as ESPP/RSU below.
  const hsaEmployerEff = eff("benefit.hsaEmployer", 0);

  // Real detected totals for the selected year, projected to a full year
  // when that year is still in progress — see note above.
  const annualSalary = (yearData.income.salary.amount + yearData.income.bonus.amount) * yearRange.projectionMultiplier;
  const annualHsa = yearData.savings.byKind.hsa.amount * yearRange.projectionMultiplier;
  const annual401k = yearData.savings.byKind.retirement.amount * yearRange.projectionMultiplier;
  // Employer HSA dollars count against the same $4,400 IRS cap as the
  // employee's own contributions, so "room left to max out" has to account
  // for both — but the *tax savings* from adding more only applies to money
  // the employee personally diverts from their own paycheck, so that stays
  // employee-only (annualHsa) everywhere else. Read straight from the raw
  // override (not eff()) since this is a flat per-month benefit fact, not a
  // period-scoped correction — it shouldn't vanish just because Full Picture
  // is selected.
  const hsaEmployerAnnual = (overrides["benefit.hsaEmployer"] ?? 0) * 12;
  const hsaCombinedAnnual = annualHsa + hsaEmployerAnnual;
  const taxEstimate = useMemo(() => {
    if (annualSalary <= 0) return null;
    const preTaxAnnual = annualHsa + annual401k;
    const gross = grossUpFromNet(annualSalary, preTaxAnnual, filingStatus);
    const savings = estimatePreTaxSavings({ hsaAnnual: annualHsa, retirementAnnual: annual401k, marginalRate: gross.marginalRate });
    return { gross, savings };
  }, [annualSalary, annualHsa, annual401k, filingStatus]);

  const maxOutExtra = useMemo(() => {
    if (!taxEstimate) return 0;
    const hsaRoom = Math.max(0, HSA_LIMIT_2026 - hsaCombinedAnnual);
    const k401Room = Math.max(0, K401_LIMIT_2026 - annual401k);
    if (hsaRoom <= 0 && k401Room <= 0) return 0;
    return estimatePreTaxSavings({ hsaAnnual: hsaRoom, retirementAnnual: k401Room, marginalRate: taxEstimate.gross.marginalRate }).totalSavings;
  }, [taxEstimate, hsaCombinedAnnual, annual401k]);

  // "Your Paycheck" — a real gross-to-net breakdown, like a pay stub, built
  // from an actually-entered gross salary rather than estimated backwards
  // from net (grossUpFromNet above is a fallback for when gross isn't known;
  // here it IS known, so compute forward and reconcile against what the bank
  // actually shows). Uses the current MONTHLY deduction rate × 12, not the
  // trailing-12-month actual — this is deliberately "if my paycheck stays
  // like this," not a historical report. ESPP/RSU are payroll deductions
  // taken from already-taxed pay (ESPP buys stock after tax; RSU withholding
  // covers tax already due on vesting), so they come out of net, not before it.
  const paycheckBreakdown = useMemo(() => {
    if (grossSalaryEff <= 0) return null;
    const hsaAnnualCur = hsaEff * 12;
    const k401AnnualCur = k401Eff * 12;
    const postTaxAnnual = esppEff * 12 + rsuEff * 12;
    const preTaxAnnual = hsaAnnualCur + k401AnnualCur;
    const taxableAnnual = Math.max(0, grossSalaryEff - preTaxAnnual - STANDARD_DEDUCTION[filingStatus]);
    const federalTaxAnnual = federalTaxOwed(taxableAnnual, filingStatus);
    const ficaAnnual = ficaOwed(Math.max(0, grossSalaryEff - preTaxAnnual));
    const netAnnual = grossSalaryEff - federalTaxAnnual - ficaAnnual - preTaxAnnual - postTaxAnnual;
    const netMonthly = netAnnual / 12;
    const detectedNetMonthly = salaryEff + bonusEff;
    return {
      grossAnnual: grossSalaryEff, federalTaxAnnual, ficaAnnual, hsaAnnualCur, k401AnnualCur, postTaxAnnual,
      netAnnual, netMonthly, detectedNetMonthly, diffMonthly: netMonthly - detectedNetMonthly,
    };
  }, [grossSalaryEff, hsaEff, k401Eff, esppEff, rsuEff, filingStatus, salaryEff, bonusEff]);

  // Employer 401(k) match — a flat percentage setting, not a period-scaled
  // dollar amount, so it lives outside the Monthly/Full Picture eff() gating
  // (it doesn't change when you switch tabs) and isn't derivable from
  // transactions at all (employer contributions never post to a linked account).
  const employerMatchPct = overrides["employerMatchPct"] ?? 0;
  const [editingMatch, setEditingMatch] = useState(false);

  const [breakdownEntry, setBreakdownEntry] = useState<Entry | null>(null);
  const openTxn = (t: PTxn) => { if (t.date) onOpenTxnDetail?.(t); };

  const savingsKinds = (["hsa", "retirement", "brokerage", "general"] as const).filter(k => data.savings.byKind[k].amount > 0);

  // ── Obligations & Fixed Expenses rows, each with a resolved funding account ──
  const obligationRows = data.obligLoanByCat.map(e => {
    const key = `obligation:${e.label}`;
    return { key, entry: e, amount: eff(key, e.amount), funding: resolveFunding(e, fundingAccounts[`funding:${key}`], accountsById) };
  });
  const fixedExpenseRows = data.billByCat.map(e => {
    const key = `expense:${e.label}`;
    return { key, entry: e, amount: eff(key, e.amount), funding: resolveFunding(e, fundingAccounts[`funding:${key}`], accountsById) };
  });

  // ── Budgeted Categories: categories with either a budget target already
  // set, or meaningful detected spend this period — capped so this stays a
  // short, curated list rather than duplicating the full Spending breakdown. ──
  const budgetedCategoryRows = useMemo(() => {
    const byCat = new Map(data.expenseByCat.map(e => [e.label, e]));
    for (const cat of Object.keys(budgets)) {
      if (!byCat.has(cat)) byCat.set(cat, { label: cat, amount: 0, txns: [] });
    }
    return [...byCat.values()]
      .filter(e => budgets[e.label] != null || e.amount > 0)
      .sort((a, b) => (budgets[b.label] ?? b.amount) - (budgets[a.label] ?? a.amount))
      .slice(0, 8)
      .map(e => ({ entry: e, funding: resolveFunding(e, undefined, accountsById) }));
  }, [data.expenseByCat, budgets, accountsById]);

  // ── Safe to spend: the headline number the page's own tagline promises but
  // never actually answered. This is deliberately the SAME figure as "Net" —
  // income minus obligations, fixed bills, all spending, and savings — just
  // shown as a waterfall so it's obvious where the money goes, not just the
  // leftover. Earlier this used a second, independent formula (and wrongly
  // subtracted pre-tax payroll deductions a second time, even though salary
  // as detected from the bank is already NET of those deductions — they never
  // touch the checking account at all) which is why it used to disagree with
  // "Net" and go deeply negative in Full Picture. Budgeted Categories only
  // ever showed its top 8 for display, but the underlying total here counts
  // every detected expense category so nothing quietly falls out of the sum. ──
  const effObligations = obligationRows.reduce((s, r) => s + r.amount, 0) + data.tax.amount * scale + data.cardPayments.amount * scale;
  const effFixed = fixedExpenseRows.reduce((s, r) => s + r.amount, 0);
  const effAllSpending = data.expenseByCat.reduce((s, e) => s + Math.max(0, budgets[e.label] ?? e.amount), 0);
  const effSavings = data.savings.total * scale;
  const effIncome = Math.max(0, salaryEff) + Math.max(0, bonusEff) + data.income.interest.amount + Math.max(0, otherEff) + data.income.manual;
  // Still computed — "needs attention" flags an overspend off this number —
  // just no longer shown as its own hero band on the page.
  const safeToSpend = effIncome - effObligations - effFixed - effAllSpending - effSavings;

  // ── Coverage Health flags jump to + briefly highlight the row they're about ──
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [showAllFlags, setShowAllFlags] = useState(false);

  // Basic info banner: a small, dismissible nudge rather than a blocking
  // wizard. "Complete" only checks the two fields nothing else can work
  // around (gross salary, filing status) — match %/HSA employer/ESPP/RSU are
  // genuinely optional and don't gate the banner.
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const basicInfoComplete = "income.grossSalaryAnnual" in overrides && "filingStatusCode" in overrides;
  const saveBasicInfo = (v: BasicInfo) => {
    onSetOverride("income.grossSalaryAnnual", v.grossSalary);
    setFilingStatus(v.filingStatus);
    onSetOverride("employerMatchPct", v.matchPct);
    onSetOverride("benefit.hsaEmployer", v.hsaEmployer);
    onSetOverride("deduction.espp", v.espp);
    onSetOverride("deduction.rsu", v.rsu);
    onSetOverride("payFrequencyCode", v.payFrequency);
  };
  const jumpToRow = (key: string) => {
    const el = document.getElementById(`row-${key}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightKey(key);
    window.setTimeout(() => setHighlightKey(k => (k === key ? null : k)), 1800);
  };

  // ── Credit cards & payoff accounts ──
  const creditCards = useMemo(() => accounts.filter(a => a.type === "credit"), [accounts]);

  // Auto-detect which account pays off each card from the SAME
  // transfer-pairing the classifier already does for credit_card_payment
  // transactions (src/lib/classify/pairs.ts) — a card's own payment-received
  // transactions are paired to the checking/savings transaction that paid
  // them, so which account "autopays" a card is almost always already
  // derivable from history without asking. Looks at ALL transaction history,
  // not just the active period, since a card's payoff account rarely changes
  // and one period may not contain a payment at all.
  const cardDetectedFunding = useMemo(() => {
    const txnById = new Map(txns.map(t => [t.id, t]));
    const out: Record<string, string> = {};
    for (const card of creditCards) {
      const counts = new Map<string, number>();
      for (const t of txns) {
        if (t.account_id !== card.account_id) continue;
        const c = classOf?.(t);
        if (c?.type !== "credit_card_payment" || !c.pairId) continue;
        const other = txnById.get(c.pairId);
        if (other) counts.set(other.account_id, (counts.get(other.account_id) ?? 0) + 1);
      }
      if (counts.size === 0) continue;
      const total = [...counts.values()].reduce((s, n) => s + n, 0);
      const [topId, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (topCount / total >= 0.6) out[card.account_id] = topId;
    }
    return out;
  }, [creditCards, txns, classOf]);

  // Once detected with confidence, write it into the same cardAutopayFrom
  // map the rest of the app (BudgetPage, Money Map) already reads — so
  // detecting it here means every other screen picks it up too, and the
  // user only ever needs to correct it, never enter it from scratch.
  const autoAssignedCards = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const [cardId, accountId] of Object.entries(cardDetectedFunding)) {
      if (cardAutopayFrom[cardId] || autoAssignedCards.current.has(cardId)) continue;
      autoAssignedCards.current.add(cardId);
      onSetCardAutopayFrom(cardId, accountId);
    }
  }, [cardDetectedFunding, cardAutopayFrom, onSetCardAutopayFrom]);

  // ── Coverage Health ──
  const coverage = useMemo(() => {
    const items: { key: string; ok: boolean; flag: string }[] = [
      ...obligationRows.map(r => ({ key: r.key, ok: !!r.funding.accountId, flag: `${formatCat(r.entry.label)} unassigned` })),
      ...fixedExpenseRows.map(r => ({ key: r.key, ok: !!r.funding.accountId, flag: `${formatCat(r.entry.label)} unassigned` })),
      ...creditCards.map(c => ({ key: `card:${c.account_id}`, ok: !!(cardAutopayFrom[c.account_id] ?? cardDetectedFunding[c.account_id]), flag: `${c.name ?? "Card"} has no payoff account` })),
      ...budgetedCategoryRows.map(({ entry, funding }) => {
        const key = `budget:${entry.label}`;
        const resolved = fundingAccounts[`funding:${key}`] ?? funding.accountId;
        return { key, ok: !!resolved, flag: `${formatCat(entry.label)} has no spending account on file` };
      }),
    ];
    if (items.length === 0) return null;
    const okCount = items.filter(i => i.ok).length;
    return { pct: Math.round((okCount / items.length) * 100), flags: items.filter(i => !i.ok).map(i => ({ key: i.key, flag: i.flag })) };
  }, [obligationRows, fixedExpenseRows, creditCards, cardAutopayFrom, cardDetectedFunding, budgetedCategoryRows, fundingAccounts, formatCat]);

  // ── Needs attention: one list instead of four separate alert surfaces.
  // Before this, the same category of thing ("something here needs a human
  // decision") was scattered across the hero, the Income card, the Coverage
  // Health donut's own flag list, and the Cards table's status column — each
  // with its own visual language. Collecting them here means there's exactly
  // one place to scan, and every item that has a specific row behind it can
  // jump straight there via the existing highlight mechanism. ──
  const needsAttention = useMemo(() => {
    const items: { key: string; text: string; jumpKey?: string; action?: { label: string; onClick: () => void } }[] = [];
    if (misclassifiedPaycheck) {
      items.push({
        key: "misclassified-paycheck",
        text: `Other income (${fmtUSD(misclassifiedPaycheck.amount)}) is close to a typical paycheck — this might be a second paycheck filed under the wrong category.`,
        action: {
          label: "Treat as a paycheck",
          onClick: () => { onSetOverride("income.salary", salaryEff + misclassifiedPaycheck.amount); onSetOverride("income.other", 0); },
        },
      });
    } else if (incomeAnomaly) {
      items.push({ key: "income-anomaly", text: incomeAnomaly });
    }
    if (safeToSpend < 0) {
      items.push({ key: "overspend", text: `You're on pace to spend ${fmtUSD(Math.abs(safeToSpend))} more than you're bringing in ${period === "monthly" ? "this month" : "this period"}.` });
    }
    for (const f of coverage?.flags ?? []) {
      items.push({ key: f.key, text: f.flag, jumpKey: f.key });
    }
    return items;
  }, [misclassifiedPaycheck, incomeAnomaly, safeToSpend, period, coverage, onSetOverride, salaryEff]);

  // ── Savings breakdown by ACCOUNT BALANCE (not monthly flow) ──
  const savingsBreakdown = useMemo(() => {
    let availableNow = 0, longTerm = 0, retirementLocked = 0;
    for (const a of accounts) {
      const bal = Number(a.current_balance) || 0;
      if (bal <= 0) continue;
      const sub = (a.subtype ?? "").toLowerCase();
      if (RETIREMENT_RE.test(sub)) retirementLocked += bal;
      else if (a.type === "investment" || sub === "hsa" || sub === "cd") longTerm += bal;
      else if (a.type === "depository") availableNow += bal;
    }
    return { availableNow, longTerm, retirementLocked };
  }, [accounts]);

  // ── Tax bracket ladder, with cumulative lower bounds for display ──
  // A single proportional bar reads faster than a 7-row ladder for a value
  // that's really just "one number plus how close you are to the next one."
  const bracketBar = useMemo(() => {
    if (!taxEstimate) return null;
    const list = FEDERAL_BRACKETS_2026[filingStatus];
    const taxable = taxEstimate.gross.taxableIncome;
    const idx = Math.max(0, list.findIndex(b => taxable <= b.upTo));
    const next = list[idx + 1];
    const scaleMax = next ? next.upTo : taxable * 1.15;
    const segments = list.slice(0, idx + 1).map((b, i) => {
      const lower = i === 0 ? 0 : list[i - 1].upTo;
      return { rate: b.rate, widthPct: ((Math.min(b.upTo, scaleMax) - lower) / scaleMax) * 100 };
    });
    return {
      segments,
      markerPct: Math.min(100, (taxable / scaleMax) * 100),
      // The distance to the next bracket is how much more taxable income fits
      // in the CURRENT bracket (its own upper bound, which is the next
      // bracket's lower bound) — not the next bracket's upper bound, which
      // overshoots by that entire bracket's width.
      toNext: next ? list[idx].upTo - taxable : null,
      nextRatePct: next ? Math.round(next.rate * 100) : null,
    };
  }, [taxEstimate, filingStatus]);

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto px-4 py-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-[18px] font-semibold text-foreground">My Financial Picture</h1>
          <p className="text-[12px] text-muted-foreground">{range.label} · inferred from your linked accounts — click any number to see why, click the pencil to correct it</p>
        </div>
        <div className="flex items-center gap-2">
          {period === "yearly" && (
            <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}
              className="h-8 rounded-lg border border-border/60 bg-card px-2 text-[12.5px] font-semibold text-foreground outline-none">
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
          <div className="flex rounded-xl border border-border/60 p-0.5 bg-muted/30">
            {(["monthly", "yearly"] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={cn("px-3.5 py-1.5 rounded-lg text-[12.5px] font-semibold transition-all",
                  period === p ? "bg-card shadow text-foreground" : "text-muted-foreground")}>
                {p === "monthly" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!basicInfoComplete && !bannerDismissed && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
          <span className="text-[11.5px] text-muted-foreground">Add basic pay info for more accurate numbers — optional.</span>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setShowOnboarding(true)} className="text-[11.5px] font-semibold text-[hsl(var(--primary))] hover:underline">Complete basic info</button>
            <button onClick={() => setBannerDismissed(true)} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground text-[13px] leading-none">×</button>
          </div>
        </div>
      )}

      {/* Two columns, always: left is what's detected/editable ("Your Data"),
          right is everything derived from it ("Insights"). Keep this split —
          don't regroup cards by topic across the two columns. */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <div className="space-y-4">
          <div>
            <h2 className="font-display text-[15px] font-semibold text-foreground">Your Data</h2>
            <p className="text-[11.5px] text-muted-foreground">
              {canEdit ? "Click the pencil next to any value to correct it." : isCurrentYear ? `${selectedYear} detected so far, projected to year end — switch to Monthly to edit.` : `${selectedYear} detected totals — switch to Monthly to edit.`}
            </p>
          </div>
          {/* Income */}
          <SectionCard icon={TrendingUp} title="Income" accent="hsl(var(--positive))">
            <RowGroup>
              <DataRow label="Salary" amount={salaryEff} txns={data.income.salary.txns} editable={canEdit} fieldKey="income.salary"
                status={status("income.salary", salaryMonthly)} onCommit={v => onSetOverride("income.salary", v)}
                onReset={() => onClearOverride("income.salary")} onSelect={setBreakdownEntry} />
            </RowGroup>
            <RowGroup>
              <DataRow label="Bonus" amount={bonusEff} txns={data.income.bonus.txns} editable={canEdit} fieldKey="income.bonus"
                status={status("income.bonus", bonusMonthly)} onCommit={v => onSetOverride("income.bonus", v)}
                onReset={() => onClearOverride("income.bonus")} onSelect={setBreakdownEntry} />
            </RowGroup>
            {data.income.interest.amount > 0 && (
              <RowGroup>
                <DataRow label="Interest / dividends" amount={data.income.interest.amount} txns={data.income.interest.txns} fieldKey="income.interest" onSelect={setBreakdownEntry} />
              </RowGroup>
            )}
            {(data.income.other.txns.length > 0 || "income.other" in overrides) && (
              <RowGroup>
                <DataRow label="Other income" amount={otherEff} txns={data.income.other.txns} editable={canEdit} fieldKey="income.other"
                  status={status("income.other", data.income.other.amount)} onCommit={v => onSetOverride("income.other", v)}
                  onReset={() => onClearOverride("income.other")} onSelect={setBreakdownEntry} />
              </RowGroup>
            )}
            <RowGroup label="For the paycheck calculator">
              <DataRow label="Gross annual salary" amount={grossSalaryEff} txns={[]} editable fieldKey="income.grossSalaryAnnual"
                status={grossSalaryIsEstimated ? "detected" : "edited"} onCommit={v => onSetOverride("income.grossSalaryAnnual", v)}
                onReset={() => onClearOverride("income.grossSalaryAnnual")} onSelect={setBreakdownEntry}
                warning={grossSalaryIsEstimated ? (grossSalaryUsedCadence
                  ? `Estimated from your detected ${salaryCadence!.label.toLowerCase()} pay, before tax. Complete basic info for an accurate number.`
                  : "Rough estimate: net pay × 12, before tax. Complete basic info for an accurate number.") : undefined} />
            </RowGroup>
            {/* A misclassified or missing paycheck used to get its own banner
                right here; it's now one entry in "Needs attention" above,
                alongside every other thing that needs a human decision. */}
          </SectionCard>

          {/* Paycheck Deductions */}
          <SectionCard icon={Landmark} title="Paycheck Deductions" subtitle={`Pre-tax & payroll contributions · per ${period === "monthly" ? "month" : "year"}`} accent="#6366f1">
            <RowGroup>
              <DataRow label="HSA" amount={hsaEff} txns={data.savings.byKind.hsa.txns} editable={canEdit} fieldKey="deduction.hsa"
                status={status("deduction.hsa", hsaMonthly)} onCommit={v => onSetOverride("deduction.hsa", v)}
                onReset={() => onClearOverride("deduction.hsa")} onSelect={setBreakdownEntry} percentBasis={grossSalaryEff / 12} />
              <DataRow label="Employer HSA contribution" amount={hsaEmployerEff} txns={[]} editable={canEdit} fieldKey="benefit.hsaEmployer" detail
                status={status("benefit.hsaEmployer", 0)} onCommit={v => onSetOverride("benefit.hsaEmployer", v)}
                onReset={() => onClearOverride("benefit.hsaEmployer")} onSelect={setBreakdownEntry} />
            </RowGroup>
            <RowGroup>
              <DataRow label="401(k)" amount={k401Eff} txns={data.savings.byKind.retirement.txns} editable={canEdit} fieldKey="deduction.401k"
                status={status("deduction.401k", k401Monthly)} onCommit={v => onSetOverride("deduction.401k", v)}
                onReset={() => onClearOverride("deduction.401k")} onSelect={setBreakdownEntry} percentBasis={grossSalaryEff / 12} />
              <div className="flex items-center justify-between gap-2 pl-4">
                <span className="text-[11.5px] text-muted-foreground truncate">Employer match</span>
                {editingMatch ? (
                  <input type="number" autoFocus defaultValue={employerMatchPct}
                    onBlur={e => { const n = parseFloat(e.target.value); if (!isNaN(n)) onSetOverride("employerMatchPct", n); setEditingMatch(false); }}
                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    className="w-16 h-7 rounded-md border border-[hsl(var(--primary)/0.5)] bg-card px-1.5 text-[12px] font-semibold tabular text-right outline-none" />
                ) : (
                  <button onClick={() => setEditingMatch(true)} title="Click to edit"
                    className="text-[12px] font-semibold tabular text-muted-foreground hover:text-[hsl(var(--primary))]">
                    {Math.round(employerMatchPct)}%
                  </button>
                )}
              </div>
            </RowGroup>
            <RowGroup label="Not detectable from transactions">
              <DataRow label="Employee Stock Purchase (ESPP)" amount={esppEff} txns={[]} editable={canEdit} fieldKey="deduction.espp"
                status={status("deduction.espp", 0)} onCommit={v => onSetOverride("deduction.espp", v)}
                onReset={() => onClearOverride("deduction.espp")} onSelect={setBreakdownEntry} percentBasis={grossSalaryEff / 12} />
              <DataRow label="RSU shares withheld" amount={rsuEff} txns={[]} editable={canEdit} fieldKey="deduction.rsu"
                status={status("deduction.rsu", 0)} onCommit={v => onSetOverride("deduction.rsu", v)}
                onReset={() => onClearOverride("deduction.rsu")} onSelect={setBreakdownEntry} percentBasis={grossSalaryEff / 12} />
            </RowGroup>
          </SectionCard>

          {/* Fixed Expenses — loans, recurring bills, and taxes paid: the things
              that happen every period regardless of how much you choose to
              spend, as opposed to Flexible Expenses below. */}
          <SectionCard icon={Landmark} title="Fixed Expenses" subtitle="Loans, bills, and taxes" accent="#f59e0b">
            {obligationRows.length === 0 && fixedExpenseRows.length === 0 && data.tax.amount === 0 ? (
              <EmptyNote text="No loans, bills, or taxes detected this period." />
            ) : (
              <>
                {obligationRows.length > 0 && (
                  <RowGroup label={fixedExpenseRows.length > 0 || data.tax.amount > 0 ? "Loans" : undefined}>
                    {obligationRows.map(r => (
                      <div key={r.key} id={`row-${r.key}`} className={cn("rounded-lg scroll-mt-20 transition-colors duration-500", highlightKey === r.key && "bg-[hsl(var(--primary)/0.18)] ring-2 ring-[hsl(var(--primary)/0.4)]")}>
                        <DataRow label={formatCat(r.entry.label)} amount={r.amount} txns={r.entry.txns} editable={canEdit} fieldKey={r.key}
                          status={status(r.key, r.entry.amount)}
                          funding={<FundingTag accountId={r.funding.accountId} label={r.funding.label} accounts={payableAccounts}
                            onChange={id => onSetFundingAccount(`funding:${r.key}`, id)} onClear={() => onClearFundingAccount(`funding:${r.key}`)} />}
                          onCommit={v => onSetOverride(r.key, v)} onReset={() => onClearOverride(r.key)} onSelect={setBreakdownEntry} />
                      </div>
                    ))}
                  </RowGroup>
                )}
                {fixedExpenseRows.length > 0 && (
                  <RowGroup label={obligationRows.length > 0 || data.tax.amount > 0 ? "Bills" : undefined}>
                    {fixedExpenseRows.map(r => (
                      <div key={r.key} id={`row-${r.key}`} className={cn("rounded-lg scroll-mt-20 transition-colors duration-500", highlightKey === r.key && "bg-[hsl(var(--primary)/0.18)] ring-2 ring-[hsl(var(--primary)/0.4)]")}>
                        <DataRow label={formatCat(r.entry.label)} amount={r.amount} txns={r.entry.txns} editable={canEdit} fieldKey={r.key}
                          status={status(r.key, r.entry.amount)}
                          funding={<FundingTag accountId={r.funding.accountId} label={r.funding.label} accounts={payableAccounts}
                            onChange={id => onSetFundingAccount(`funding:${r.key}`, id)} onClear={() => onClearFundingAccount(`funding:${r.key}`)} />}
                          onCommit={v => onSetOverride(r.key, v)} onReset={() => onClearOverride(r.key)} onSelect={setBreakdownEntry} />
                      </div>
                    ))}
                  </RowGroup>
                )}
                {data.tax.amount > 0 && (
                  <RowGroup label={obligationRows.length > 0 || fixedExpenseRows.length > 0 ? "Taxes" : undefined}>
                    <DataRow label="Taxes paid" amount={data.tax.amount * scale} txns={data.tax.txns} fieldKey="tax" onSelect={setBreakdownEntry} />
                  </RowGroup>
                )}
              </>
            )}
          </SectionCard>

          {/* Flexible Expenses — discretionary, budgetable spend: the part
              that's actually up to you from month to month. */}
          <SectionCard icon={Receipt} title="Flexible Expenses" accent={catColor("Groceries")}>
            {budgetedCategoryRows.length === 0 ? (
              <EmptyNote text="No discretionary spending detected this period." />
            ) : budgetedCategoryRows.map(({ entry, funding }) => {
              const fundingKey = `budget:${entry.label}`;
              const rowKey = `budget:${entry.label}`;
              const resolvedAccountId = fundingAccounts[`funding:${fundingKey}`] ?? funding.accountId;
              const resolvedLabel = fundingAccounts[`funding:${fundingKey}`] ? acctLabel(accountsById.get(fundingAccounts[`funding:${fundingKey}`])) : funding.label;
              return (
                <div key={entry.label} id={`row-${rowKey}`} className={cn("rounded-lg scroll-mt-20 transition-colors duration-500", highlightKey === rowKey && "bg-[hsl(var(--primary)/0.18)] ring-2 ring-[hsl(var(--primary)/0.4)]")}>
                  <DataRow label={formatCat(entry.label)} amount={(budgets[entry.label] ?? entry.amount) * scale} txns={entry.txns}
                    editable={canEdit} fieldKey={fundingKey}
                    status={canEdit && budgets[entry.label] != null ? "edited" : "detected"}
                    funding={<FundingTag accountId={resolvedAccountId} label={resolvedLabel} accounts={spendSourceAccounts}
                      onChange={id => onSetFundingAccount(`funding:${fundingKey}`, id)} onClear={() => onClearFundingAccount(`funding:${fundingKey}`)} />}
                    onCommit={v => onSetBudget(entry.label, v)}
                    onReset={budgets[entry.label] != null ? () => onRemoveBudget(entry.label) : undefined}
                    onSelect={setBreakdownEntry} />
                </div>
              );
            })}
          </SectionCard>

          {/* Cards & Payoff Accounts — a compact row list here (not a table)
              since this column is half-width now; the funding tag itself
              already turns red and says "Unassigned" when there's no payoff
              account, so there's no separate status column to repeat that. */}
          <SectionCard icon={CreditCard} title="Cards & Payoff Accounts" accent="hsl(var(--primary))">
            {creditCards.length === 0 ? (
              <EmptyNote text="No credit card accounts linked." />
            ) : creditCards.map(c => {
              const confirmed = cardAutopayFrom[c.account_id];
              const paidBy = confirmed ?? cardDetectedFunding[c.account_id];
              const rowKey = `card:${c.account_id}`;
              const cardName = cleanAccountName(c.name ?? c.official_name ?? "Card", c.mask);
              return (
                <div key={c.account_id} id={`row-${rowKey}`} className={cn("flex items-center justify-between gap-2 scroll-mt-20 transition-colors duration-500", highlightKey === rowKey && "bg-[hsl(var(--primary)/0.18)] ring-2 ring-[hsl(var(--primary)/0.4)] rounded-lg")}>
                  <div className="min-w-0">
                    <span className="text-[12.5px] text-foreground truncate block" title={cardName}>{cardName}</span>
                    <span className="text-[10.5px] text-muted-foreground tabular">{c.mask ? `••${c.mask}` : "—"}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <FundingTag accountId={paidBy ?? null} label={paidBy ? acctLabel(accountsById.get(paidBy)) : null}
                      accounts={payableAccounts} onChange={id => onSetCardAutopayFrom(c.account_id, id)} onClear={() => onRemoveCardAutopayFrom(c.account_id)} />
                    {paidBy && <StatusPill status={confirmed ? "edited" : "detected"} />}
                  </div>
                </div>
              );
            })}
          </SectionCard>
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="font-display text-[15px] font-semibold text-foreground">Insights</h2>
            <p className="text-[11.5px] text-muted-foreground">A snapshot of your financial health this {period === "monthly" ? "month" : "period"}.</p>
          </div>

          {/* Needs attention — compact like Coverage Health used to be: a
              headline plus a short, capped list, not a full-width band. One
              list still covers everything (unassigned funding, a possibly
              missing paycheck, overspending) instead of four separate alert
              surfaces, it's just sized to fit this column now. */}
          {needsAttention.length > 0 ? (
            <SectionCard icon={ShieldAlert} title="Needs attention" subtitle={`${needsAttention.length} item${needsAttention.length === 1 ? "" : "s"}`} accent="#f59e0b">
              <ul className="space-y-1.5">
                {(showAllFlags ? needsAttention : needsAttention.slice(0, 3)).map(item => (
                  <li key={item.key} className="flex items-start justify-between gap-3 flex-wrap">
                    {item.jumpKey ? (
                      <button onClick={() => jumpToRow(item.jumpKey!)} className="text-[11.5px] text-foreground text-left underline decoration-dotted decoration-muted-foreground/50 hover:text-[hsl(var(--primary))]">
                        • {item.text}
                      </button>
                    ) : (
                      <p className="text-[11.5px] text-foreground leading-snug">• {item.text}</p>
                    )}
                    {item.action && (
                      <button onClick={item.action.onClick} className="text-[11px] font-semibold text-[hsl(var(--primary))] hover:underline shrink-0 whitespace-nowrap">
                        {item.action.label} →
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {needsAttention.length > 3 && (
                <button onClick={() => setShowAllFlags(v => !v)} className="text-[11px] font-medium text-muted-foreground hover:text-foreground mt-1.5">
                  {showAllFlags ? "Show less" : `+${needsAttention.length - 3} more`}
                </button>
              )}
            </SectionCard>
          ) : coverage && (
            <SectionCard icon={ShieldCheck} title="Needs attention" accent="hsl(var(--positive))">
              <p className="text-[12.5px] text-foreground">Nothing needs your attention — everything's covered and categorized.</p>
            </SectionCard>
          )}

          {/* Your Paycheck — a real gross-to-net breakdown, like a pay stub */}
          <SectionCard icon={Landmark} title="Your Paycheck" subtitle="Gross-to-net, like a pay stub" accent="#6366f1">
            {!paycheckBreakdown ? (
              <p className="text-[11.5px] text-muted-foreground leading-snug">
                Enter your gross annual salary under Income to see federal tax, FICA, and your deductions broken down step by step down to your actual take-home pay.
              </p>
            ) : (
              <>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="text-foreground">Gross pay</span>
                    <span className="font-semibold tabular text-foreground">{fmtUSD(paycheckBreakdown.grossAnnual)}/yr</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-muted-foreground">− Federal tax</span>
                    <span className="tabular text-foreground">−{fmtUSD(paycheckBreakdown.federalTaxAnnual)}/yr</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-muted-foreground">− FICA (Social Security + Medicare)</span>
                    <span className="tabular text-foreground">−{fmtUSD(paycheckBreakdown.ficaAnnual)}/yr</span>
                  </div>
                  {paycheckBreakdown.hsaAnnualCur > 0 && (
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-muted-foreground">− HSA</span>
                      <span className="tabular text-foreground">−{fmtUSD(paycheckBreakdown.hsaAnnualCur)}/yr</span>
                    </div>
                  )}
                  {paycheckBreakdown.k401AnnualCur > 0 && (
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-muted-foreground">− 401(k)</span>
                      <span className="tabular text-foreground">−{fmtUSD(paycheckBreakdown.k401AnnualCur)}/yr</span>
                    </div>
                  )}
                  {paycheckBreakdown.postTaxAnnual > 0 && (
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-muted-foreground">− ESPP / RSU (post-tax)</span>
                      <span className="tabular text-foreground">−{fmtUSD(paycheckBreakdown.postTaxAnnual)}/yr</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-[13px] pt-1.5 mt-1 border-t border-border/30">
                    <span className="font-semibold text-foreground">Take-home pay</span>
                    <span className="font-bold tabular text-positive">{fmtUSD(paycheckBreakdown.netMonthly)}/mo</span>
                  </div>
                </div>
                <p className="text-[10.5px] text-muted-foreground leading-snug pt-2">
                  {Math.abs(paycheckBreakdown.diffMonthly) < 50
                    ? <>Matches what your bank shows deposited this month ({fmtUSD(paycheckBreakdown.detectedNetMonthly)}) — within {fmtUSD(Math.abs(paycheckBreakdown.diffMonthly))}.</>
                    : <>Your bank shows {fmtUSD(paycheckBreakdown.detectedNetMonthly)}/mo deposited — {fmtUSD(Math.abs(paycheckBreakdown.diffMonthly))} {paycheckBreakdown.diffMonthly > 0 ? "less than" : "more than"} this estimate. Other benefits, bonuses, or withholding elections not captured above could explain the gap.</>}
                </p>
              </>
            )}
          </SectionCard>

          {/* Tax Savers */}
          {taxEstimate && (
            <SectionCard icon={TrendingUp} title="Tax Savers" subtitle="Annual contributions vs. 2026 limits" accent="#6366f1">
              <p className="text-[13px] text-foreground leading-snug">
                You save <strong>{fmtUSD(taxEstimate.savings.totalSavings)}</strong> in taxes this year
                {maxOutExtra > 1 && <>, max out to save <strong className="text-positive">+{fmtUSD(maxOutExtra)}</strong> more.</>}
              </p>
              <div className="space-y-2.5 pt-1.5">
                {[
                  { label: "HSA", amount: hsaCombinedAnnual, max: HSA_LIMIT_2026, note: hsaEmployerAnnual > 0 ? `incl. ${fmtUSD(hsaEmployerAnnual)}/yr from employer` : undefined },
                  { label: "401(k)", amount: annual401k, max: K401_LIMIT_2026, note: undefined as string | undefined },
                ].map(row => (
                  <div key={row.label} className="flex items-center gap-3">
                    <span className="text-[11.5px] text-foreground w-14 shrink-0">{row.label}</span>
                    <span className="w-[72px] shrink-0 text-right text-[12px] font-semibold tabular text-foreground">
                      {fmtUSD(row.amount)}<span className="text-muted-foreground font-normal">/yr</span>
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-muted-foreground mb-1">Max {fmtUSD(row.max)}/yr{row.note ? ` · ${row.note}` : ""}</div>
                      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                        <div className="h-full rounded-full bg-[hsl(var(--primary))]" style={{ width: `${Math.min(100, (row.amount / row.max) * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-3">
                  <span className="text-[11.5px] text-foreground w-14 shrink-0">Match</span>
                  <span className="w-[72px] shrink-0 text-right text-[12px] font-semibold tabular text-foreground">{Math.round(employerMatchPct)}%</span>
                  <div className="flex-1 min-w-0">
                    {employerMatchPct <= 0 ? (
                      <p className="text-[11px] text-muted-foreground">Set your employer's 401(k) match under Paycheck Deductions to see if you're getting the full benefit.</p>
                    ) : employerMatchPct >= 100 ? (
                      <>
                        <p className="text-[11px] font-semibold text-positive mb-1">You're getting the full match!</p>
                        <div className="h-1.5 rounded-full bg-positive" />
                      </>
                    ) : (
                      <>
                        <p className="text-[11px] text-muted-foreground mb-1">{Math.round(100 - employerMatchPct)}% of the match still available</p>
                        <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                          <div className="h-full rounded-full bg-[hsl(var(--primary))]" style={{ width: `${employerMatchPct}%` }} />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <p className="text-[10.5px] text-muted-foreground leading-snug pt-1.5">
                Federal-only estimate from detected salary and HSA/401(k) transfers, 2026 contribution limits (self-only HSA coverage assumed). Not tax advice.
              </p>
            </SectionCard>
          )}

          {/* Tax Bracket */}
          {taxEstimate && bracketBar && (
            <SectionCard icon={Target} title="Tax Bracket" accent="hsl(var(--primary))">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[30px] leading-tight font-bold tabular text-[hsl(var(--primary))]">{Math.round(taxEstimate.gross.marginalRate * 100)}%</div>
                  <div className="text-[10.5px] text-muted-foreground leading-snug">
                    Based on {fmtUSD(annualSalary)}/yr {isCurrentYear ? "projected" : "detected"} salary for {selectedYear}, regardless of the tab above.
                  </div>
                </div>
                <div className="flex rounded-lg border border-border/50 p-0.5 bg-muted/20 w-fit shrink-0">
                  {(["single", "married_joint"] as const).map(fs => (
                    <button key={fs} onClick={() => setFilingStatus(fs)}
                      className={cn("px-2 py-0.5 rounded-md text-[10.5px] font-medium transition-all",
                        filingStatus === fs ? "bg-card shadow text-foreground" : "text-muted-foreground")}>
                      {fs === "single" ? "Single" : "Married"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pt-2 space-y-1.5">
                <div className="relative h-3 rounded-full bg-muted/30 overflow-hidden flex">
                  {bracketBar.segments.map((s, i) => (
                    <div key={s.rate} style={{ width: `${s.widthPct}%`, backgroundColor: "hsl(var(--primary))", opacity: 0.3 + (i * 0.55) / bracketBar.segments.length }} />
                  ))}
                  <div className="absolute top-0 bottom-0 w-[2px] bg-foreground" style={{ left: `${bracketBar.markerPct}%` }} />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {bracketBar.toNext != null
                    ? <>You're <strong className="text-foreground">{fmtUSD(bracketBar.toNext)}</strong> of taxable income away from the <strong className="text-foreground">{bracketBar.nextRatePct}%</strong> bracket.</>
                    : "You're in the top federal bracket."}
                </p>
              </div>
            </SectionCard>
          )}

          {/* Savings Breakdown — one stacked bar instead of three separate
              ones (one of which used to sit at a disabled-looking 30%
              opacity): one bar divided into segments reads as "one pool,
              three tiers of access" instead of three unrelated metrics. */}
          {(savingsBreakdown.availableNow > 0 || savingsBreakdown.longTerm > 0 || savingsBreakdown.retirementLocked > 0) && (() => {
            const total = savingsBreakdown.availableNow + savingsBreakdown.longTerm + savingsBreakdown.retirementLocked || 1;
            const segs = [
              { label: "Available now", amount: savingsBreakdown.availableNow, color: "hsl(var(--primary))" },
              { label: "Long term", amount: savingsBreakdown.longTerm, color: "217 70% 55%" },
              { label: "Retirement locked", amount: savingsBreakdown.retirementLocked, color: "280 55% 55%" },
            ];
            return (
              <SectionCard icon={PiggyBank} title="Savings Breakdown" accent="hsl(var(--primary))">
                <div className="h-4 rounded-full overflow-hidden bg-muted/30 flex">
                  {segs.map(s => s.amount > 0 && (
                    <div key={s.label} title={`${s.label}: ${fmtUSD(s.amount)}`} style={{ width: `${(s.amount / total) * 100}%`, backgroundColor: s.color.startsWith("hsl(") ? s.color : `hsl(${s.color})` }} />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                  {segs.map(s => s.amount > 0 && (
                    <span key={s.label} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color.startsWith("hsl(") ? s.color : `hsl(${s.color})` }} />
                      {s.label} · <span className="font-semibold text-foreground tabular">{fmtUSD(s.amount)}</span>
                    </span>
                  ))}
                </div>
                <p className="text-[10.5px] text-muted-foreground pt-1.5">Current balances across your linked accounts, grouped by how accessible the money is.</p>
              </SectionCard>
            );
          })()}

          {/* Risk Profile — a self-reported preference, not data inferred
              from transactions, so it stays here rather than with computed
              insights elsewhere; it's intentionally not moving to Settings. */}
          <SectionCard icon={Wallet} title="Risk Profile" accent="#f59e0b">
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="flex flex-col items-center shrink-0">
                <RiskGauge value={financialPicture.riskProfile} onPick={onSetRiskProfile} />
                <span className="text-[13px] font-bold text-foreground -mt-1">
                  {financialPicture.riskProfile ? RISK_PROFILES.find(r => r.key === financialPicture.riskProfile)?.label : "Not set"}
                </span>
              </div>
              <div className="min-w-0 w-full text-center sm:text-left">
                <p className="text-[11.5px] text-foreground leading-snug">
                  {financialPicture.riskProfile
                    ? RISK_PROFILES.find(r => r.key === financialPicture.riskProfile)?.blurb
                    : "Used to tailor the advice elsewhere in the app — not derivable from your transactions."}
                </p>
                {!financialPicture.riskProfile && (
                  <button onClick={() => onSetRiskProfile("moderate")}
                    className="mt-1.5 h-7 px-3 rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-[11.5px] font-semibold whitespace-nowrap">
                    Set your risk profile
                  </button>
                )}
              </div>
            </div>
          </SectionCard>
        </div>
      </div>

      <BreakdownDialog entry={breakdownEntry} formatCat={formatCat} accountsById={accountsById} onClose={() => setBreakdownEntry(null)} onOpenTxn={openTxn} />
      <OnboardingDialog
        open={showOnboarding}
        initial={{
          grossSalary: overrides["income.grossSalaryAnnual"] ?? grossSalaryDefault,
          filingStatus,
          matchPct: overrides["employerMatchPct"] ?? 0,
          hsaEmployer: overrides["benefit.hsaEmployer"] ?? 0,
          espp: overrides["deduction.espp"] ?? 0,
          rsu: overrides["deduction.rsu"] ?? 0,
          payFrequency: overrides["payFrequencyCode"] ?? 1,
        }}
        onClose={() => setShowOnboarding(false)}
        onSave={saveBasicInfo}
      />
    </div>
  );
}
