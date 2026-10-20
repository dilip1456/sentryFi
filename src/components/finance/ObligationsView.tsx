/**
 * Obligations data layer — what you owe and have to pay, fully auto-detected.
 *
 * This used to be a standalone, separately-styled "ObligationsView" component
 * mounted inside BudgetPage's Obligations section, with its own bucket cards,
 * its own income bar, and its own bulk-review wizard. That made Obligations
 * look and behave differently from Income/Expenses/Savings on the same page.
 * Now this file only owns the data (Supabase-backed CRUD, detection, spend
 * math) via the `useObligations` hook — BudgetPage renders the actual rows
 * itself, using the exact same EntryRow/DetectedRow components as every
 * other section, and folds detected candidates into the page's single
 * shared "Detected" column instead of a separate review panel.
 *
 * Scoped to genuine must-pay bills only — Fixed commitments (same amount,
 * same merchant, every month) and Flex bills (same merchant, variable
 * amount, still a real recurring bill like a utility). Discretionary
 * spending limits and savings goals used to live here too as "Envelope"
 * and "Goal" buckets, but that duplicated BudgetPage's own Expenses and
 * Savings sections one level up — same money, tracked twice, under two
 * different names. Removed so "Obligations" means one thing.
 *
 * Detection auto-analyzes 3 months of transactions, same as every other
 * detector on the page — no manual "click to detect" step, and a
 * flagged-wrong merchant (shared blacklist with the rest of the page)
 * never resurfaces:
 *   Fixed — same merchant, same amount (<8% variance), same day of month,
 *           3 months running
 *   Flex  — same merchant, same day of month, 3 months running, amount varies
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fmtUSD } from "@/lib/format";
import { cleanBankText, isStatementSummaryText } from "@/lib/merchant-name";
import { cn } from "@/lib/utils";
import { Lock, Zap, X, ArrowRight, Wallet } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Obligation {
  id: string;
  name: string;
  type: "fixed" | "flex";
  amount: number;
  category?: string;
  merchant_hint?: string;
  sort_order: number;
  // Which account the payment actually drafts from — a "have to pay without
  // fail" obligation should say where the money comes from, not just the
  // amount. Null/undefined means it hasn't been tagged yet.
  funding_account_id?: string | null;
}

export interface PAccountLite {
  account_id: string;
  name?: string | null;
  official_name?: string | null;
  mask?: string | null;
}

interface PTxn {
  id: string;
  amount: number | string;
  name: string | null;
  merchant_name?: string | null;
  date: string;
  category?: string[] | null;
  pending?: boolean;
  [k: string]: any;
}

// ─── Bucket metadata ────────────────────────────────────────────────────────

export const OBLIGATION_BUCKETS = [
  { type: "fixed" as const, label: "Fixed", sublabel: "Same every month",         icon: Lock, colorClass: "text-blue-400",  bg: "bg-blue-500/10" },
  { type: "flex" as const,  label: "Flex",  sublabel: "Variable, max threshold", icon: Zap,  colorClass: "text-amber-400", bg: "bg-amber-500/10" },
] as const;

// ─── Category classification ─────────────────────────────────────────────────

const FLEX_KEYWORDS = [
  "utilities","electric","gas","water","internet","cable","phone","telecom",
  "insurance","rent","subscription","streaming","spotify","netflix","hulu","apple",
  "amazon prime","gym","fitness"
];
const FLEX_CATS = [
  "rent_and_utilities","utilities","home_improvement","personal_care",
  "general_services","subscription","insurance"
];
const INCOME_CATS = ["income","payroll","deposit","transfer_in","wages"];

// Discretionary, spend-as-you-go categories — even when the same restaurant
// or grocery store lands on a similar day/amount for a few months running,
// that's a spending habit, not a contractual bill, and it's already tracked
// under Expenses. Obligations should only ever surface genuine fixed and
// properly scheduled bills (rent, utilities, insurance, loan payments,
// subscriptions), never routine discretionary spend.
const DISCRETIONARY_CATEGORIES = [
  "food & drink", "groceries", "shopping", "travel", "entertainment",
];
// Gambling is adhoc by nature no matter how regular it looks — excluded by
// merchant name since it can land in Entertainment or an uncategorized
// "Other" bucket depending on how the bank/Plaid classifies it.
const GAMBLING_KEYWORDS = [
  "casino","sportsbook","draftkings","fanduel","betmgm","caesars","bet365",
  "lottery","lotto","poker","wager","bovada","betrivers",
];
// Merchant-name overrides that pull a transaction back OUT of the
// discretionary exclusion above — a real subscription/membership can be
// filed under a discretionary-sounding category (e.g. Netflix/Spotify often
// land under "Entertainment") but is still a genuine recurring bill.
const DISCRETIONARY_OVERRIDE_KEYWORDS = [
  "netflix","spotify","hulu","disney+","hbo max","paramount+","peacock",
  "amazon prime","apple tv","apple music","youtube premium","gym","fitness",
];

function isDiscretionarySpend(cat: string, merchantName: string): boolean {
  const c = cat.toLowerCase();
  const n = merchantName.toLowerCase();
  if (GAMBLING_KEYWORDS.some(k => n.includes(k))) return true;
  if (!DISCRETIONARY_CATEGORIES.includes(c)) return false;
  return !DISCRETIONARY_OVERRIDE_KEYWORDS.some(k => n.includes(k));
}

function isIncomeAmount(amount: number, cat: string): boolean {
  // Plaid convention: amount < 0 is money IN.
  return amount < 0 && INCOME_CATS.some(k => cat.toLowerCase().includes(k));
}

function classifyCategory(cat: string, name: string): "fixed" | "flex" | null {
  const c = cat.toLowerCase();
  const n = name.toLowerCase();
  if (FLEX_CATS.some(k => c.includes(k))) return "flex";
  if (FLEX_KEYWORDS.some(k => n.includes(k) || c.includes(k))) return "flex";
  if (["loan","mortgage","payment","car_payment","credit_card"].some(k => c.includes(k) || n.includes(k))) return "fixed";
  return null;
}

// Well-known bill types mapped to a clean, friendly label — so a raw bank
// statement descriptor like "WELLS FARGO HOME MTG 4471" or "NELNET STUDENT
// LN PMT" reads as "Mortgage Payment" / "Student Loan Payment" instead of
// showing up verbatim.
const NAME_PATTERNS: [RegExp, string][] = [
  [/mortgage|home\s*mtg/i, "Mortgage Payment"],
  [/\brent\b/i, "Rent"],
  [/student\s*loan|nelnet|sallie\s*mae|navient|mohela|great\s*lakes\s*ed/i, "Student Loan Payment"],
  [/auto\s*loan|car\s*loan|car\s*pmt|vehicle\s*loan/i, "Auto Loan Payment"],
  [/\binsurance\b|geico|progressive|allstate|state\s*farm|liberty\s*mutual/i, "Insurance"],
  [/electric|\bpwr\b|power\s*co|energy/i, "Electric Bill"],
  [/\bwater\b/i, "Water Bill"],
  [/internet|broadband|xfinity|comcast|spectrum/i, "Internet Bill"],
  [/verizon|at&t|t-mobile|tmobile|sprint/i, "Phone Bill"],
  [/netflix/i, "Netflix"],
  [/spotify/i, "Spotify"],
  [/hulu/i, "Hulu"],
  [/gym|fitness/i, "Gym Membership"],
];

// Cleans up a raw merchant/statement string for display: strips the
// trailing reference/trace/confirmation numbers banks often tack on, then
// either maps it to a well-known bill label above or title-cases it if it
// looks like raw ALL-CAPS statement text.
function cleanName(raw: string): string {
  let name = cleanBankText(raw) || raw;
  for (const [re, label] of NAME_PATTERNS) {
    if (re.test(name)) return label;
  }
  if (name === name.toUpperCase() && /[A-Z]/.test(name)) {
    name = name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  return name || raw;
}

const ORDINAL = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

// How tightly clustered a merchant's charge dates are around the month —
// used to gate "Fixed"/"Flex" detection on an actual same-date recurring
// pattern instead of just "this merchant showed up more than once."
function dayOfMonthSpread(dates: string[]): { typicalDay: number; spread: number } {
  const days = dates.map(d => new Date(`${d}T00:00:00`).getDate()).sort((a, b) => a - b);
  const median = days[Math.floor(days.length / 2)];
  const spread = Math.max(...days.map(d => Math.abs(d - median)));
  return { typicalDay: median, spread };
}

// ─── Auto-detection ──────────────────────────────────────────────────────────

export interface DetectedObligation {
  name: string;
  type: "fixed" | "flex";
  amount: number;
  category?: string;
  merchant_hint?: string;
  // Raw merchant string — the key used against the page's shared
  // dismissed/flagged blacklist, consistent with every other detector.
  merchant: string;
  confidence: "high" | "medium";
  // Plain-language explanation of why this was flagged, plus the literal
  // transactions behind it — shown in the review-pattern popup so "add or
  // flag it wrong" is an informed choice, not a guess about what the app saw.
  reason: string;
  txns: { date: string; amount: number }[];
  // Which account most of the matched charges actually drafted from — lets
  // "add" prefill funding_account_id instead of leaving it untagged, same as
  // every other account-attributed detector on the page.
  accountId?: string;
}

type ClassOf = (t: PTxn) => { type: string } | undefined;

function autoDetect(allTxns: PTxn[], getEffCat: (t: PTxn) => string, classOf?: ClassOf): DetectedObligation[] {
  const now = new Date();
  const results: DetectedObligation[] = [];

  // Build 3 months of expense transactions
  const months: string[] = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const expenseTxns = allTxns.filter(t => {
    const amt = Number(t.amount);
    const cat = getEffCat(t).toLowerCase();
    const merchantName = (t.merchant_name || t.name || "").trim();
    // Plaid convention: amount > 0 is money OUT. (This used to test amt < 0,
    // so recurring *deposits* — e.g. the incoming leg of a "Zelle to <you>"
    // transfer — were being suggested as bills.)
    if (amt <= 0 || t.pending || isIncomeAmount(amt, cat)) return false;
    // Shared classifier: transfers between your own accounts, card payments
    // and savings moves are never bills.
    const c = classOf?.(t);
    if (c && c.type !== "spend" && !c.type.startsWith("obligation_")) return false;
    if (isStatementSummaryText(merchantName)) return false;
    return !isDiscretionarySpend(cat, merchantName);
  });

  // ── FIXED & FLEX: group by merchant, check recurrence ──────────────────

  // Keyed by a NORMALIZED merchant string (cleaned of trailing reference/
  // trace numbers, lowercased) — grouping by the raw literal string missed
  // most real recurring bills, since banks routinely tack a different
  // trace/confirmation number onto the same merchant every single charge.
  const byMerchant: Record<string, { display: string; txns: PTxn[]; byMonth: Record<string, number[]> }> = {};
  for (const t of expenseTxns) {
    const raw = (t.merchant_name || t.name || "Unknown").trim();
    const key = cleanName(raw).toLowerCase();
    if (!byMerchant[key]) byMerchant[key] = { display: raw, txns: [], byMonth: {} };
    byMerchant[key].txns.push(t);
    const m = t.date?.slice(0, 7) ?? "";
    if (months.includes(m)) {
      if (!byMerchant[key].byMonth[m]) byMerchant[key].byMonth[m] = [];
      byMerchant[key].byMonth[m].push(Math.abs(Number(t.amount)));
    }
  }

  for (const data of Object.values(byMerchant)) {
    const merchant = data.display;
    const monthsPresent = Object.keys(data.byMonth).filter(m => months.includes(m));
    // Require the charge to show up in all 3 of the trailing months, not
    // just 2 of 3 — a single repeat isn't a confirmed recurring pattern and
    // was the main source of noisy, one-off charges getting flagged as
    // "obligations."
    if (monthsPresent.length < 3) continue;

    const relevantTxns = data.txns.filter(t => months.includes(t.date?.slice(0, 7) ?? ""));
    const { typicalDay, spread } = dayOfMonthSpread(relevantTxns.map(t => t.date));
    // Same merchant, but the charges land on wildly different days each
    // month (e.g. several unrelated one-off purchases) — not a real
    // same-date recurring bill, so don't guess.
    if (spread > 6) continue;

    const allAmounts = Object.values(data.byMonth).flat();
    const avg = allAmounts.reduce((a, b) => a + b, 0) / allAmounts.length;
    const variance = allAmounts.map(a => Math.abs(a - avg) / avg);
    const maxVariance = Math.max(...variance);
    const cat = getEffCat(data.txns[0]);
    const guessedType = classifyCategory(cat, merchant);
    const cleanedName = cleanName(merchant);
    const dayLabel = ORDINAL(typicalDay);
    const txnPattern = relevantTxns.map(t => ({ date: t.date, amount: Math.abs(Number(t.amount)) }));
    // Which account most of the matched charges actually drafted from — the
    // account this bill is really paid out of, so "add" can prefill
    // funding_account_id instead of leaving it untagged.
    const acctCounts: Record<string, number> = {};
    for (const t of relevantTxns) if (t.account_id) acctCounts[t.account_id] = (acctCounts[t.account_id] ?? 0) + 1;
    const acctEntries = Object.entries(acctCounts).sort((a,b) => b[1]-a[1]);
    const accountId = acctEntries.length > 0 ? acctEntries[0][0] : undefined;

    if (avg < 2) continue; // skip tiny amounts

    if (maxVariance < 0.08) {
      // Very stable amount, same day each month, 3 months running → Fixed
      results.push({
        name: cleanedName,
        type: "fixed",
        amount: Math.round(avg * 100) / 100,
        merchant_hint: merchant.split(" ")[0],
        merchant,
        category: cat,
        confidence: "high",
        reason: `Charged ${fmtUSD(avg)} on/around the ${dayLabel} of the month, 3 months in a row`,
        txns: txnPattern,
        accountId,
      });
    } else if (guessedType === "flex" || maxVariance < 0.4) {
      // Same day each month, 3 months running, but the amount varies → Flex
      results.push({
        name: cleanedName,
        type: "flex",
        amount: Math.round(avg * 1.2 * 100) / 100,
        merchant_hint: merchant.split(" ")[0],
        merchant,
        category: cat,
        confidence: "medium",
        reason: `Recurs around the ${dayLabel} of the month, 3 months in a row, amount varies (${fmtUSD(avg*0.8)}-${fmtUSD(avg*1.2)})`,
        txns: txnPattern,
        accountId,
      });
    }
  }

  return results;
}

// ─── Spend math ───────────────────────────────────────────────────────────────

function spentForObligation(ob: Obligation, txns: PTxn[], getEffCat: (t: PTxn) => string): number {
  return txns.filter(t => {
    const amt = Number(t.amount);
    if (amt <= 0) return false; // Plaid convention: > 0 is money out
    const name = (t.merchant_name || t.name || "").toLowerCase();
    const cat  = getEffCat(t).toLowerCase();
    if (ob.merchant_hint && name.includes(ob.merchant_hint.toLowerCase())) return true;
    if (ob.category && cat.includes(ob.category.toLowerCase())) return true;
    return false;
  }).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useObligations(
  txns: PTxn[],
  getEffectiveCategory: (t: PTxn) => string,
  month: string,
  dismissedRecurringSet: Set<string>,
  classOf?: ClassOf,
) {
  const [obligations, setObs] = useState<Obligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)); }, []);

  const loadObs = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.from("obligations").select("*").eq("user_id", userId).eq("active", true).order("sort_order");
    setObs((data ?? []) as Obligation[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => { loadObs(); }, [loadObs]);

  const monthTxns = useMemo(() => txns.filter(t => t.date?.startsWith(month)), [txns, month]);

  const spentMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const ob of obligations) m[ob.id] = spentForObligation(ob, monthTxns, getEffectiveCategory);
    return m;
  }, [obligations, monthTxns, getEffectiveCategory]);

  const exceeded = useMemo(() =>
    obligations.filter(ob => spentMap[ob.id] > ob.amount)
               .map(ob => ({ ob, over: spentMap[ob.id] - ob.amount })),
    [obligations, spentMap]
  );

  // Always-on detection, same as every other detector on the page — no
  // separate "click to detect" step. Flagged-wrong merchants (shared
  // blacklist) and merchants already tracked never resurface.
  const detected = useMemo(() => {
    if (!userId || loading) return [];
    return autoDetect(txns, getEffectiveCategory, classOf)
      .filter(d => !dismissedRecurringSet.has(d.merchant.toLowerCase()))
      .filter(d => !obligations.some(ob => ob.name.toLowerCase() === d.name.toLowerCase()));
  }, [txns, getEffectiveCategory, userId, loading, obligations, dismissedRecurringSet, classOf]);

  const addObligation = useCallback(async (payload: {
    name: string; type: Obligation["type"]; amount: number;
    category?: string | null; merchant_hint?: string | null; funding_account_id?: string | null;
  }) => {
    if (!userId) return;
    await supabase.from("obligations").insert({ user_id: userId, sort_order: obligations.length, active: true, ...payload });
    await loadObs();
  }, [userId, obligations.length, loadObs]);

  const updateObligation = useCallback(async (id: string, patch: Partial<Obligation>) => {
    await supabase.from("obligations").update(patch).eq("id", id);
    await loadObs();
  }, [loadObs]);

  const removeObligation = useCallback(async (id: string) => {
    await supabase.from("obligations").delete().eq("id", id);
    await loadObs();
  }, [loadObs]);

  // Fixed obligations are the one detection this page treats as certain
  // enough to add on its own, not just suggest — same amount, same
  // merchant, same day of month, three months running is as close to
  // "100% sure this is a real bill" as detection gets. Flex (variable
  // amount) stays a suggestion, since "recurs, but the amount moves
  // around" is closer to "probably recurring" than settled fact.
  // `pendingAutoAdd` guards against firing the insert twice for the same
  // merchant while the first insert is still in flight (this effect can
  // re-run before `obligations` reflects the just-added row).
  const pendingAutoAdd = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!userId || loading) return;
    const highConfidence = detected.filter(d => d.confidence === "high" && d.type === "fixed");
    for (const d of highConfidence) {
      const key = d.merchant.toLowerCase();
      if (pendingAutoAdd.current.has(key)) continue;
      pendingAutoAdd.current.add(key);
      addObligation({ name: d.name, type: d.type, amount: d.amount, category: d.category ?? null, merchant_hint: d.merchant_hint ?? null })
        .finally(() => pendingAutoAdd.current.delete(key));
    }
  }, [detected, userId, loading, addObligation]);

  return { obligations, loading, userId, spentMap, exceeded, detected, addObligation, updateObligation, removeObligation };
}

// ─── Add/Edit modal ────────────────────────────────────────────────────────

interface EditModalProps {
  initial?: Partial<Obligation>;
  defaultType?: Obligation["type"];
  accounts: PAccountLite[];
  onSubmit: (payload: {
    name: string; type: Obligation["type"]; amount: number;
    category?: string | null; merchant_hint?: string | null; funding_account_id?: string | null;
  }) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function ObligationEditModal({ initial, defaultType = "fixed", accounts, onSubmit, onDelete, onClose }: EditModalProps) {
  const [name, setName]      = useState(initial?.name ?? "");
  const [type, setType]      = useState<Obligation["type"]>(initial?.type ?? defaultType);
  const [amount, setAmount]  = useState(String(initial?.amount ?? ""));
  const [category, setCat]   = useState(initial?.category ?? "");
  const [merchant, setMerch] = useState(initial?.merchant_hint ?? "");
  const [fundingAcct, setFundingAcct] = useState(initial?.funding_account_id ?? "");

  const handleSave = () => {
    if (!name.trim() || !amount) return;
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return;
    onSubmit({ name: name.trim(), type, amount: amt, category: category || null, merchant_hint: merchant || null, funding_account_id: fundingAcct || null });
    onClose();
  };

  const handleDelete = () => { onDelete?.(); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl w-full max-w-md mx-0 sm:mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
          <p className="font-semibold">{initial?.id ? "Edit" : "Add"} obligation</p>
          <button onClick={onClose} aria-label="Close" className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <div className="flex gap-1.5 flex-wrap">
            {OBLIGATION_BUCKETS.map(b => (
              <button key={b.type} onClick={() => setType(b.type)}
                className={cn("px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                  type === b.type ? `${b.bg} ${b.colorClass} border-transparent` : "bg-muted/40 text-muted-foreground border-transparent")}>
                {b.label}
              </button>
            ))}
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder={type === "fixed" ? "Mortgage" : "Electricity"}
              className="w-full bg-muted/40 border border-border rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-primary/50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">
              {type === "fixed" ? "Monthly amount" : "Monthly max"}
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00" type="text" inputMode="decimal"
                className="w-full bg-muted/40 border border-border rounded-xl pl-7 pr-3.5 py-2.5 text-sm outline-none focus:border-primary/50" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Pay from account</label>
            <select value={fundingAcct} onChange={e => setFundingAcct(e.target.value)}
              className="w-full bg-muted/40 border border-border rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-primary/50 text-foreground">
              <option value="">Not tagged yet</option>
              {accounts.map(a => (
                <option key={a.account_id} value={a.account_id}>
                  {a.name ?? a.official_name ?? "Account"}{a.mask ? ` ••${a.mask}` : ""}
                </option>
              ))}
            </select>
            {!fundingAcct && (
              <p className="text-[10.5px] text-amber-400/90 mt-1">Tag where this gets paid from. A must-pay bill should never be a mystery.</p>
            )}
          </div>
          <div className="flex gap-2 pt-1">
            {initial?.id && onDelete && (
              <button onClick={handleDelete} className="flex-1 py-2.5 rounded-xl border border-destructive/40 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors">Delete</button>
            )}
            <button onClick={handleSave} disabled={!name.trim() || !amount}
              className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40">
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Cover modal ─────────────────────────────────────────────────────────────

interface CoverModalProps {
  exceeded: { ob: Obligation; over: number }[];
  month: string;
  userId: string;
  onRaiseLimit: (ob: Obligation, newAmount: number) => void;
  onClose: () => void;
}

// "How to cover this" no longer means borrowing from another bucket (there
// is no Envelope/Goal bucket anymore) — it's either a real one-time
// exception, or a sign the bill's budgeted amount is set too low and should
// just be raised to match reality going forward.
export function CoverModal({ exceeded, month, userId, onRaiseLimit, onClose }: CoverModalProps) {
  const [done, setDone] = useState(false);
  const totalOver = exceeded.reduce((s, e) => s + e.over, 0);

  const absorb = async () => {
    for (const e of exceeded) {
      await supabase.from("cover_actions").insert({
        user_id: userId, month, from_id: null, to_id: e.ob.id,
        amount: e.over, action_type: "absorb", note: "One-time exception",
      });
    }
    setDone(true);
  };

  if (done) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card rounded-2xl p-8 mx-4 text-center max-w-sm w-full" onClick={e => e.stopPropagation()}>
        <p className="font-display text-lg text-foreground">Logged</p>
        <p className="text-muted-foreground text-sm mt-1">Covered {fmtUSD(totalOver)} this month</p>
        <button onClick={onClose} className="mt-5 w-full bg-primary text-primary-foreground py-2.5 rounded-xl font-medium text-sm">Done</button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl w-full max-w-md mx-0 sm:mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
          <div>
            <p className="font-semibold">How to cover {fmtUSD(totalOver)}?</p>
            <p className="text-xs text-muted-foreground mt-0.5">{exceeded.map(e => e.ob.name).join(", ")} over</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-2 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1.5 mb-3">
            {exceeded.map(e => (
              <div key={e.ob.id} className="rounded-xl border border-destructive/25 bg-destructive/5 p-3">
                <div className="flex justify-between text-sm mb-2">
                  <span className="font-medium">{e.ob.name}</span>
                  <span className="text-destructive font-medium">+{fmtUSD(e.over)}</span>
                </div>
                <button onClick={() => { onRaiseLimit(e.ob, Math.round((e.ob.amount + e.over) * 100) / 100); onClose(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted/50 transition-colors text-left">
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs">Raise budgeted amount to {fmtUSD(e.ob.amount + e.over)}</span>
                </button>
              </div>
            ))}
          </div>
          <button onClick={absorb}
            className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-border hover:bg-muted/50 transition-colors text-left">
            <div className="h-8 w-8 rounded-full bg-orange-500/15 flex items-center justify-center shrink-0"><Wallet className="h-3.5 w-3.5 text-orange-400" /></div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">It's a one-time thing, absorb it</p>
              <p className="text-xs text-muted-foreground">Log as an exception, leave the budgeted amount as is</p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>
    </div>
  );
}
