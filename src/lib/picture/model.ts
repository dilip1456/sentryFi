/**
 * My Financial Picture: the data model behind "Your Data".
 *
 * Pure TS (no React). Built from the app's own transactions and settings:
 *  - classification comes from the caller's classOf (the shared classifier in
 *    src/lib/classify, already merged with the person's overrides), re-bucketed
 *    by category the same way the previous page did (a "Bills & Utilities"
 *    spend is a fixed bill, an "Investments" spend is savings);
 *  - cadence, monthly-equivalent amount and next due date come from
 *    src/lib/recurring (detectRecurringSeries, fed that same classification);
 *  - autopay comes from src/lib/infer (detectBillAutopays).
 * Every number stays editable: overrides and "Covered by" picks live in
 * settings.financialPicture and always win over detection.
 */
import { detectRecurringSeries, merchantKey, displayName, type RecurringSeries, type TransactionClassifier, type TxnClassification, type ClassifierTxn, type Cadence } from "@/lib/recurring";
import { detectBillAutopays, detectedAsAutopay } from "@/lib/infer";
import type { TxnType } from "@/lib/classify";
import type { FinancialPictureData, ManualIncomeItem, SavingsGoal } from "@/hooks/useUserSettings";
import { FP_UNASSIGNED } from "./keys";
import { grossUpFromNet } from "@/lib/tax-calc";

// ─── Input shapes (what LivePlaidDashboard already has) ─────────────────────

export interface PTxn {
  id: string; account_id: string; amount: number | string; date: string;
  name: string | null; merchant_name: string | null; category?: string[] | null;
  pending?: boolean | null; payment_channel?: string | null; [k: string]: unknown;
}
export interface PAccount {
  id: string; account_id: string; name: string | null; official_name: string | null;
  type: string | null; subtype: string | null; mask?: string | null;
  current_balance?: number | string | null; [k: string]: unknown;
}
export interface PClass { type: TxnType; subtype?: string; pairId?: string; reason?: string }

export interface PictureInputs {
  txns: PTxn[];
  accounts: PAccount[];
  classOf: (t: PTxn) => PClass | undefined;
  getEffectiveCategory: (t: PTxn) => string;
  formatCat?: (c: string) => string;
  manualIncome?: ManualIncomeItem[];
  budgets: Record<string, number>;
  cardAutopayFrom: Record<string, string>;
  savingsGoals: SavingsGoal[];
  fp: FinancialPictureData;
  today: Date;
}

// ─── Output shapes ──────────────────────────────────────────────────────────

export type PictureGroup = "income" | "deductions" | "obligations" | "fixed" | "taxes" | "budgets" | "cards" | "savings";
export type AcctKind = "bank" | "save" | "card" | "invest" | "loan";

export interface AcctInfo {
  id: string;
  name: string;
  /** "Name ••1234" */
  label: string;
  mask: string | null;
  type: string;
  subtype: string;
  balance: number;
  kind: AcctKind;
  /** Chip style when this account covers something. */
  chip: "bank" | "save" | "card";
}

export interface PictureRow {
  group: PictureGroup;
  id: string;
  label: string;
  sub?: string;
  /** Effective monthly amount (override wins). */
  monthly: number;
  /** What detection found (0 when nothing was found). */
  detected: number;
  /** Key in financialPicture.overrides for amount edits (budgets/savings edit their own stores). */
  overrideKey?: string;
  edited?: boolean;
  /** Key in financialPicture.fundingAccounts for "Covered by". */
  fundingKey?: string;
  coverId: string | null;
  coverSource: "user" | "detected" | "none";
  /** Why it's unassigned when we know (e.g. "paid by Zelle"). */
  unassignedReason?: string;
  /** A monthly transfer into a savings account that pays this bill. */
  setAside?: { goalId: string; accountId: string; monthly: number };
  dueDay?: number | null;
  dueText?: string;
  nextDate?: string | null;
  cadence?: Cadence | null;
  perPayment?: number;
  autopay?: "auto" | "manual" | "unknown";
  /** Detector thinks this bill is on autopay (unconfirmed). */
  autopayDetected?: boolean;
  tags?: ("pre" | "post" | "det")[];
  why?: string;
  txns: PTxn[];
  manualId?: string;
  // budgets
  category?: string;
  spent?: number;
  // savings
  goalId?: string;
  toId?: string | null;
  fromId?: string | null;
  target?: number;
  have?: number;
  by?: string;
  detectedOnly?: boolean;
}

export interface CardInfo {
  id: string;
  label: string;
  name: string;
  mask: string | null;
  payoffId: string | null;
  payoffSource: "user" | "detected" | "none";
  dueDay: number | null;
  lastPayment: PTxn | null;
  /** Payments into this card over the last ~6 months. */
  payments: PTxn[];
}

export interface PictureModel {
  accounts: AcctInfo[];
  acct: Map<string, AcctInfo>;
  rows: Record<Exclude<PictureGroup, "cards" | "taxes">, PictureRow[]> & { taxes: PictureRow[] };
  cards: CardInfo[];
  /** Pay frequency label + paychecks per month (from the salary series). */
  pay: { cadence: Cadence | null; perMonth: number; perPaycheck: number; employer: string | null };
  gross: { annual: number; estimated: boolean };
  filing: "single" | "married_joint";
  /** Monthly payroll amounts used by the tax math. */
  payroll: { hsa: number; k401: number; espp: number; rsu: number; hsaEmployer: number };
  /** For "Due in <next month>". */
  nextMonthLabel: string;
  nextMonthKey: string;
  series: RecurringSeries[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (today: Date, n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return ymd(d); };
const num = (v: unknown) => { const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? n : 0; };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (iso: string) => { const [, m, d] = iso.split("-").map(Number); return `${MONTHS[m - 1]} ${d}`; };

export const ORDINAL = (n: number) => {
  if (n % 10 === 1 && n % 100 !== 11) return `${n}st`;
  if (n % 10 === 2 && n % 100 !== 12) return `${n}nd`;
  if (n % 10 === 3 && n % 100 !== 13) return `${n}rd`;
  return `${n}th`;
};

export const PER_YEAR: Record<Cadence, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, quarterly: 4, semiannual: 2, yearly: 1 };

// Category-aware re-bucketing, kept from the previous My Financial Picture:
// the shared classifier's fallback is plain "spend", so a mortgage or a gym
// that Plaid filed under a text category would otherwise land in budgets.
const OBLIGATION_LOAN_RE = /mortgage|auto loan|student loan|\bloan\b/i;
const OBLIGATION_TAX_RE = /\btax(es)?\b/i;
const OBLIGATION_BILL_RE = /\brent\b|insurance|bills? ?& ?utilities|bill payment|utilit(y|ies)|\bgym\b|membership|subscription|\bphone\b|\bcable\b|\binternet\b/i;
const SAVINGS_CATEGORY_RE = /invest|saving|retirement|brokerage|\b401k\b|\bira\b|\bhsa\b/i;
export const BONUS_RE = /\bbonus\b/i;
const P2P_RE = /\bzelle\b|\bvenmo\b|\bcash ?app\b|\bpaypal\b/i;
const P2P_APP_NAME_RE = /^(zelle|venmo|cash\s?app|square\s+cash|paypal|apple\s+cash)$/i;

/** For recurring P2P inflows, require the same identifiable sender each time. */
function p2pCounterparty(t: PTxn): string | null {
  const merchant = (t.merchant_name ?? "").trim();
  if (merchant && !P2P_APP_NAME_RE.test(merchant)) return merchant.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const match = (t.name ?? "").match(/\bfrom\s+(.+?)(?:\s+(?:conf(?:irmation)?|ref|trace|id)\b.*)?$/i);
  return match?.[1]?.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim() || null;
}

export type Bucket = "income" | "obligation_loan" | "obligation_tax" | "obligation_bill" | "credit_card_payment" | "expense" | "savings" | "p2p_out" | null;

export function resolveBucket(c: PClass | undefined, category: string): Bucket {
  if (!c) return null;
  switch (c.type) {
    case "income_salary": case "income_interest": case "income_other": return "income";
    case "obligation_loan": return "obligation_loan";
    case "obligation_tax": return "obligation_tax";
    case "obligation_bill": return "obligation_bill";
    case "credit_card_payment": return "credit_card_payment";
    case "savings_contribution": return "savings";
    case "transfer_out": return c.subtype === "p2p" ? "p2p_out" : null;
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

const BUCKET_TYPE: Partial<Record<NonNullable<Bucket>, TxnType>> = {
  obligation_loan: "obligation_loan", obligation_tax: "obligation_tax", obligation_bill: "obligation_bill", savings: "savings_contribution",
};

/** Strip a repeated mask / trailing "Card" from a bank's marketing name. */
export function cleanAccountName(name: string, mask: string | null | undefined): string {
  let n = name.trim();
  if (mask) n = n.replace(new RegExp(`[-–]?\\s*${mask.replace(/[^0-9a-z]/gi, "")}\\s*$`), "").trim();
  const trailingCard = n.match(/^(.*)\s+card$/i);
  if (trailingCard && /card/i.test(trailingCard[1])) n = trailingCard[1].trim();
  return n || name.trim();
}

export function acctKind(a: Pick<PAccount, "type" | "subtype">): AcctKind {
  const type = (a.type ?? "").toLowerCase(), sub = (a.subtype ?? "").toLowerCase();
  if (type === "credit") return "card";
  if (type === "loan") return "loan";
  if (type === "investment" || type === "brokerage") return "invest";
  if (/savings|hsa|cd|money market/.test(sub)) return "save";
  return "bank";
}

export function toAcctInfo(a: PAccount): AcctInfo {
  const name = cleanAccountName(a.name ?? a.official_name ?? "Account", a.mask);
  const kind = acctKind(a);
  return {
    id: a.account_id, name, label: a.mask ? `${name} ••${a.mask}` : name, mask: a.mask ?? null,
    type: (a.type ?? "").toLowerCase(), subtype: (a.subtype ?? "").toLowerCase(), balance: num(a.current_balance),
    kind, chip: kind === "card" ? "card" : kind === "bank" ? "bank" : "save",
  };
}

/** The account most of these payments came from, if ≥ 60% of them did. */
export function majorityAccount(txns: PTxn[], min = 0.6): string | null {
  if (!txns.length) return null;
  const counts = new Map<string, number>();
  for (const t of txns) counts.set(t.account_id, (counts.get(t.account_id) ?? 0) + 1);
  const [id, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return n / txns.length >= min ? id : null;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";

function nextMonth(today: Date) {
  const d = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return { label: d.toLocaleDateString("en-US", { month: "long" }), key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}` };
}

function dueTextFor(s: RecurringSeries | undefined, fallbackDate: string | null): { dueDay: number | null; dueText: string | undefined; nextDate: string | null } {
  if (s?.schedule) {
    const sc = s.schedule;
    if (sc.kind === "day-of-month") {
      const day = sc.anchorDay === 31 ? null : sc.anchorDay;
      if (sc.monthStep === 1) return { dueDay: day, dueText: day ? ORDINAL(day) : "Last day", nextDate: s.nextExpectedDate };
      return { dueDay: day, dueText: s.nextExpectedDate ? `Next ${shortDate(s.nextExpectedDate)}` : undefined, nextDate: s.nextExpectedDate };
    }
    if (sc.kind === "semimonthly") return { dueDay: sc.anchorDays[0], dueText: `${ORDINAL(sc.anchorDays[0])} & ${ORDINAL(sc.anchorDays[1])}`, nextDate: s.nextExpectedDate };
    return { dueDay: null, dueText: sc.cadence === "weekly" ? "Weekly" : "Every 2 weeks", nextDate: s.nextExpectedDate };
  }
  if (fallbackDate) { const d = Number(fallbackDate.slice(8, 10)); return { dueDay: d, dueText: `~${ORDINAL(d)}`, nextDate: null }; }
  return { dueDay: null, dueText: undefined, nextDate: null };
}

const CADENCE_WORD: Record<Cadence, string> = {
  weekly: "every week", biweekly: "every 2 weeks", semimonthly: "twice a month", monthly: "a month",
  quarterly: "every 3 months", semiannual: "every 6 months", yearly: "a year",
};

/**
 * Gross pay from take-home: what's deposited plus after-tax payroll (ESPP),
 * grossed up through federal tax + FICA with pre-tax HSA/401(k) taken out
 * first. The person can type their real gross on the Salary row.
 */
export function estimateGross(income: PictureRow[], deductions: PictureRow[], filing: "single" | "married_joint"): number {
  const m = (rows: PictureRow[], id: string) => rows.find(r => r.id === id)?.monthly ?? 0;
  const net = (m(income, "salary") + m(income, "bonus") + m(deductions, "espp")) * 12;
  if (net <= 0) return 0;
  const pre = (m(deductions, "hsa") + m(deductions, "k401")) * 12;
  return Math.round(grossUpFromNet(net, pre, filing).estimatedGrossAnnual);
}

// ─── Build ──────────────────────────────────────────────────────────────────

export function buildPictureModel(inp: PictureInputs): PictureModel {
  const { txns, accounts, classOf, getEffectiveCategory, fp, today } = inp;
  const fmtCat = inp.formatCat ?? ((c: string) => c);
  const overrides = fp.overrides ?? {};
  const funding = fp.fundingAccounts ?? {};
  const todayStr = ymd(today);
  const acctList = accounts.map(toAcctInfo);
  const acct = new Map(acctList.map(a => [a.id, a]));
  const posted = txns.filter(t => !t.pending && t.date <= todayStr);
  const byId = new Map(posted.map(t => [t.id, t]));

  // Bucket every transaction once.
  const bucketOf = new Map<string, Bucket>();
  for (const t of posted) bucketOf.set(t.id, resolveBucket(classOf(t), getEffectiveCategory(t) || ""));

  // ── Recurring series, fed the same (re-bucketed) classification ──
  const ctxns: ClassifierTxn[] = posted.map(t => ({
    transaction_id: t.id, account_id: t.account_id, amount: num(t.amount), date: t.date,
    name: t.name, merchant_name: t.merchant_name, category: t.category ?? null, pending: false,
    payment_channel: (t.payment_channel as string | null | undefined) ?? null,
  }));
  const classifier: TransactionClassifier = {
    classifyAll(list) {
      const out = new Map<string, TxnClassification>();
      for (const ct of list) {
        const t = byId.get(ct.transaction_id);
        const c = t ? classOf(t) : undefined;
        if (!t || !c) continue;
        const b = bucketOf.get(t.id);
        const txnType = (b && BUCKET_TYPE[b]) || c.type;
        out.set(ct.transaction_id, { txnType, subtype: c.subtype ?? null, confidence: 0.9, source: "rule", pairId: c.pairId ?? null });
      }
      return out;
    },
  };
  const classAccounts = accounts.map(a => ({ account_id: a.account_id, type: a.type, subtype: a.subtype, name: a.name, mask: a.mask ?? null }));
  let series: RecurringSeries[] = [];
  try { series = detectRecurringSeries(ctxns, classAccounts, { today: todayStr, classifier }); } catch { series = []; }
  const seriesByMerchant = new Map<string, RecurringSeries>();
  for (const s of series) {
    const k = `${s.txnType}|${s.merchantKey}`;
    const prev = seriesByMerchant.get(k);
    if (!prev || (s.active && !prev.active) || s.occurrenceCount > prev.occurrenceCount) seriesByMerchant.set(k, s);
  }
  let autopays: ReturnType<typeof detectBillAutopays> = [];
  try { autopays = detectBillAutopays(series, ctxns, { accounts: classAccounts }); } catch { autopays = []; }
  const autopayBySeries = new Map(autopays.map(a => [a.seriesKey, a]));

  // ── Income ──
  const since365 = daysAgo(today, 365), since90 = daysAgo(today, 90);
  // Only project pay when the recurring detector found a real, active cadence.
  // A single recent deposit is not enough evidence to turn it into monthly income.
  const salarySeries = series.filter(s => s.kind === "salary" && s.direction === "inflow" && s.active && s.occurrenceCount >= 2 && s.confidence >= 0.7 && !BONUS_RE.test(s.displayName)).sort((a, b) => b.amount.median * PER_YEAR[b.cadence] - a.amount.median * PER_YEAR[a.cadence]);
  const salaryTxns: PTxn[] = [], bonusTxns: PTxn[] = [], otherTxns: PTxn[] = [];
  for (const t of posted) {
    if (t.date < since365) continue;
    const c = classOf(t);
    if (!c || bucketOf.get(t.id) !== "income" || num(t.amount) >= 0) continue;
    const desc = `${t.merchant_name ?? ""} ${t.name ?? ""}`;
    if (c.type === "income_salary") (BONUS_RE.test(desc) ? bonusTxns : salaryTxns).push(t);
  }
  const newestFirst = (a: PTxn, b: PTxn) => b.date.localeCompare(a.date);
  salaryTxns.sort(newestFirst); bonusTxns.sort(newestFirst); otherTxns.sort(newestFirst);
  let salaryMonthly = 0, payCadence: Cadence | null = null, perPaycheck = 0;
  if (salarySeries.length) {
    for (const s of salarySeries) salaryMonthly += (s.amount.median * PER_YEAR[s.cadence]) / 12;
    payCadence = salarySeries[0].cadence; perPaycheck = salarySeries[0].amount.median;
  }
  const bonusMonthly = bonusTxns.reduce((s, t) => s - num(t.amount), 0) / 12;

  // Recurring, non-payroll inflows are income too (for example pension, side
  // work, or a regular contribution from another person). Keep them out of the
  // monthly projection until the detector has enough evidence for an active
  // pattern. Never count known account transfers, investment withdrawals, or
  // borrowed funds as new income.
  const INTERNAL_INFLOW_SUBTYPES = new Set(["account_transfer", "from_savings", "from_investments", "loan_proceeds"]);
  const INTERNAL_INFLOW_RE = /\b(internal|account)\s+(transfer|xfer)\b|\bonline\s+(transfer|xfer)\b|\btransfer\s+between\s+accounts\b|\bfrom\s+(checking|chk|savings|sav|brokerage|investment)\b|\b(cash\s+advance|loan\s+proceeds)\b/i;
  const recurringIncomeSeries = series.filter(s => {
    if (s.direction !== "inflow" || !s.active || s.occurrenceCount < 2 || s.confidence < 0.7) return false;
    if (s.txnType === "income_salary") return false; // already counted above
    if (s.kind !== "income" && s.kind !== "interest") return false;
    if (s.txnType !== "transfer_in") return s.txnType === "income_other" || s.txnType === "income_interest";
    if (s.subtype && INTERNAL_INFLOW_SUBTYPES.has(s.subtype)) return false;
    // P2P deposits from someone else can be genuine recurring income. Require
    // a stable sender so unrelated Zelle/Venmo payments cannot form a pattern.
    if (s.subtype === "p2p") {
      const senders = s.transactionIds.map(id => {
        const t = byId.get(id);
        return t ? p2pCounterparty(t) : null;
      });
      return senders.length >= 2 && senders.every(Boolean) && new Set(senders).size === 1;
    }
    return !INTERNAL_INFLOW_RE.test(s.displayName);
  });
  const recurringIncomeTxnIds = new Set(recurringIncomeSeries.flatMap(s => s.transactionIds));
  for (const id of recurringIncomeTxnIds) {
    const t = byId.get(id);
    if (t && t.date >= since365) otherTxns.push(t);
  }
  otherTxns.sort(newestFirst);
  const otherDetectedMonthly = recurringIncomeSeries.reduce((sum, s) => sum + (s.amount.median * PER_YEAR[s.cadence]) / 12, 0);
  const otherMonthly = otherDetectedMonthly;
  const perMonth = payCadence ? PER_YEAR[payCadence] / 12 : 0;
  const employer = salarySeries[0]?.displayName ?? (salaryTxns[0] ? displayName(salaryTxns[0].merchant_name || salaryTxns[0].name) : null);
  const primaryDeposit = majorityAccount(salaryTxns.slice(0, 12), 0.5);

  const eff = (key: string, detected: number) => (key in overrides ? Math.max(0, num(overrides[key])) : detected);
  const income: PictureRow[] = [];
  const payWord = payCadence ? { weekly: "4–5 paychecks a month", biweekly: "every 2 weeks", semimonthly: "2 paychecks a month", monthly: "1 paycheck a month", quarterly: "quarterly", semiannual: "twice a year", yearly: "once a year" }[payCadence] : null;
  income.push({
    group: "income", id: "salary", label: "Salary", sub: payWord ? `Take-home · ${payWord}` : salaryTxns.length ? "Payroll found · pay schedule not confirmed" : "No recurring pay pattern detected",
    monthly: eff("income.salary", salaryMonthly), detected: salaryMonthly, overrideKey: "income.salary", edited: "income.salary" in overrides,
    coverId: primaryDeposit, coverSource: primaryDeposit ? "detected" : "none", txns: salaryTxns.slice(0, 6),
  });
  if (bonusMonthly > 0 || "income.bonus" in overrides) {
    const total = bonusTxns.reduce((s, t) => s - num(t.amount), 0);
    const months = [...new Set(bonusTxns.map(t => MONTHS[Number(t.date.slice(5, 7)) - 1]))];
    income.push({
      group: "income", id: "bonus", label: "Bonus", sub: total > 0 ? `$${Math.round(total).toLocaleString("en-US")} paid in ${months.join(" & ")}, averaged` : "Averaged over the year",
      monthly: eff("income.bonus", bonusMonthly), detected: bonusMonthly, overrideKey: "income.bonus", edited: "income.bonus" in overrides,
      coverId: majorityAccount(bonusTxns, 0.5), coverSource: "detected", txns: bonusTxns.slice(0, 6),
    });
  }
  if (otherMonthly > 0 || "income.other" in overrides) {
    income.push({
      group: "income", id: "other", label: "Other recurring income", sub: recurringIncomeSeries.length ? `${recurringIncomeSeries.length} recurring deposit pattern${recurringIncomeSeries.length === 1 ? "" : "s"} · one-time deposits excluded` : "User adjustment",
      monthly: eff("income.other", otherMonthly), detected: otherMonthly, overrideKey: "income.other", edited: "income.other" in overrides,
      coverId: majorityAccount(otherTxns, 0.5), coverSource: otherTxns.length ? "detected" : "none", txns: otherTxns.slice(0, 6),
    });
  }
  for (const m of inp.manualIncome ?? []) {
    income.push({ group: "income", id: `manual-${m.id}`, label: m.label, sub: "Added by you", monthly: m.amount, detected: 0, coverId: m.accountId ?? null, coverSource: m.accountId ? "user" : "none", txns: [], manualId: m.id });
  }

  // ── Paycheck deductions ──
  // Payroll HSA/401(k) never post to a bank; what we can see is money landing
  // in (or sent to) HSA / retirement accounts. Last 90 days, averaged.
  const savingsTxns = posted.filter(t => bucketOf.get(t.id) === "savings" && t.date >= since90 && num(t.amount) > 0);
  const destKind = (t: PTxn): "hsa" | "ret" | "brk" | "save" => {
    const c = classOf(t);
    const cat = getEffectiveCategory(t) || "";
    const other = c?.pairId ? byId.get(c.pairId) : undefined;
    const a = other ? acct.get(other.account_id) : undefined;
    const sub = a?.subtype ?? (cat.match(/hsa|401k|401a|403b|ira|roth|brokerage/i)?.[0] ?? "").toLowerCase();
    if (/^hsa$/.test(sub)) return "hsa";
    if (/^(401k|401a|403b|457b|ira|roth|roth 401k)$/.test(sub)) return "ret";
    if (c?.subtype === "brokerage" || /brokerage|invest/i.test(sub) || a?.kind === "invest") return "brk";
    return "save";
  };
  const hsaTx = savingsTxns.filter(t => destKind(t) === "hsa");
  const retTx = savingsTxns.filter(t => destKind(t) === "ret");
  const hsaDet = hsaTx.reduce((s, t) => s + num(t.amount), 0) / 3;
  const retDet = retTx.reduce((s, t) => s + num(t.amount), 0) / 3;
  const conf = fp.confirmations ?? {};
  const hsaAcct = acctList.find(a => a.subtype === "hsa")?.id ?? null;
  const retAcct = acctList.find(a => /^(401k|403b|401a|457b)$/.test(a.subtype))?.id ?? null;
  const brkAcct = acctList.find(a => a.subtype === "brokerage" || a.subtype === "stock plan")?.id ?? null;
  const dedRow = (id: string, label: string, key: string, detected: number, tag: "pre" | "post", to: string | null, why: string, txs: PTxn[]): PictureRow => {
    const isDet = detected > 0 && !(key in overrides) && !conf[`deduction:${id}`];
    const rejected = conf[`deduction:${id}`] === "no";
    const det = rejected ? 0 : detected;
    return {
      group: "deductions", id, label, monthly: eff(key, det), detected: det, overrideKey: key, edited: key in overrides,
      tags: isDet && !rejected ? [tag, "det"] : [tag], why, toId: to, coverId: to, coverSource: to ? "detected" : "none", txns: txs.slice(0, 6),
    };
  };
  const deductions: PictureRow[] = [
    dedRow("hsa", "HSA", "deduction.hsa", hsaDet, "pre", hsaAcct, "Comes out before income tax and Social Security/Medicare.", hsaTx),
    dedRow("k401", "401(k)", "deduction.401k", retDet, "pre", retAcct, "Comes out before income tax (still pays Social Security/Medicare).", retTx),
    dedRow("espp", "Employee stock (ESPP)", "deduction.espp", 0, "post", brkAcct, "Buys company stock at a discount from after-tax pay. Payroll never shows up in a bank account, so enter it from your pay stub.", []),
    dedRow("rsu", "RSU shares withheld", "deduction.rsu", 0, "post", brkAcct, "Shares your employer keeps to cover tax when RSUs vest. Enter it from your pay stub.", []),
  ];

  // ── Obligations, fixed expenses and tax bills ──
  const since400 = daysAgo(today, 400), since45 = daysAgo(today, 45);
  type G = { bucket: Bucket; key: string; txns: PTxn[]; cat: string };
  const groups = new Map<string, G>();
  for (const t of posted) {
    const b = bucketOf.get(t.id);
    if (t.date < since400 || num(t.amount) <= 0) continue;
    if (b !== "obligation_loan" && b !== "obligation_bill" && b !== "obligation_tax" && b !== "p2p_out") continue;
    const mk = merchantKey(t.name, t.merchant_name);
    const gk = `${b}|${mk}`;
    const g = groups.get(gk) ?? { bucket: b, key: mk, txns: [], cat: getEffectiveCategory(t) || "" };
    g.txns.push(t); groups.set(gk, g);
  }
  // A category key maps to one row only when exactly one row has that category (legacy overrides).
  const catCount = new Map<string, number>();
  for (const g of groups.values()) catCount.set(`${g.bucket}|${g.cat}`, (catCount.get(`${g.bucket}|${g.cat}`) ?? 0) + 1);

  const goals = inp.savingsGoals ?? [];
  const obligations: PictureRow[] = [], fixed: PictureRow[] = [], taxBills: PictureRow[] = [];
  for (const g of groups.values()) {
    g.txns.sort(newestFirst);
    const type: TxnType = g.bucket === "p2p_out" ? "transfer_out" : (BUCKET_TYPE[g.bucket!] as TxnType);
    const s = seriesByMerchant.get(`${type}|${g.key}`);
    let monthly = 0, cadence: Cadence | null = null, perPayment = 0, sub: string | undefined;
    if (s) {
      if (!s.active) continue;
      if (g.bucket === "p2p_out" && !(PER_YEAR[s.cadence] <= 12 && s.occurrenceCount >= 3)) continue;
      cadence = s.cadence; perPayment = s.amount.expected || s.amount.median;
      monthly = (perPayment * PER_YEAR[s.cadence]) / 12;
      if (s.cadence !== "monthly") sub = `$${Math.round(perPayment).toLocaleString("en-US")} ${CADENCE_WORD[s.cadence]}`;
    } else {
      if (g.bucket === "p2p_out") continue; // a one-off Zelle isn't a bill
      const latest = g.txns[0];
      if (!latest || latest.date < since45) continue;
      monthly = num(latest.amount); perPayment = monthly; sub = "Seen once · assumed monthly";
    }
    const group: "obligations" | "fixed" | "taxes" = g.bucket === "obligation_loan" ? "obligations" : g.bucket === "obligation_tax" ? "taxes" : "fixed";
    const id = slug(g.key);
    const ovPrefix = group === "obligations" ? "obligation" : group === "taxes" ? "tax" : "expense";
    const overrideKey = `${ovPrefix}:${id}`;
    const legacyKey = `${ovPrefix}:${g.cat}`;
    const legacyOk = catCount.get(`${g.bucket}|${g.cat}`) === 1;
    const ovKey = overrideKey in overrides ? overrideKey : legacyOk && legacyKey in overrides ? legacyKey : overrideKey;
    const fundingKey = `funding:${overrideKey}`;
    const legacyFunding = `funding:${legacyKey}`;
    const userCover = funding[fundingKey] ?? (legacyOk ? funding[legacyFunding] : undefined);
    const label = s?.displayName ?? displayName(g.txns[0].merchant_name || g.txns[0].name);
    const isP2P = g.bucket === "p2p_out" || g.txns.some(t => P2P_RE.test(`${t.name ?? ""} ${t.merchant_name ?? ""}`));
    const goal = goals.find(x => x.kind === "obligation" && x.obligationId === id && x.accountId);
    let coverId: string | null = null, coverSource: PictureRow["coverSource"] = "none", unassignedReason: string | undefined;
    if (userCover) { coverId = userCover === FP_UNASSIGNED ? null : userCover; coverSource = "user"; if (!coverId) unassignedReason = "You left this unassigned."; }
    else if (goal?.accountId) { coverId = goal.accountId; coverSource = "detected"; }
    else if (isP2P) { unassignedReason = `${label} is paid by ${(g.txns.map(t => `${t.name} ${t.merchant_name}`).join(" ").match(P2P_RE)?.[0] ?? "Zelle").replace(/^./, c => c.toUpperCase())}, so we can't tell which account it should come from. Pick one so it counts in your plan.`; }
    else {
      coverId = majorityAccount(g.txns.slice(0, 6));
      coverSource = coverId ? "detected" : "none";
      if (!coverId) unassignedReason = `${label} is paid from different accounts, so we can't tell which one covers it. Pick one so it counts in your plan.`;
    }
    const due = dueTextFor(s, g.txns[0]?.date ?? null);
    const ap = s ? autopayBySeries.get(s.seriesKey) : undefined;
    const row: PictureRow = {
      group, id, label, sub, monthly: eff(ovKey, monthly), detected: monthly, overrideKey: ovKey, edited: ovKey in overrides,
      fundingKey, coverId, coverSource, unassignedReason, cadence, perPayment, ...due,
      autopay: ap?.autopay ?? "unknown", autopayDetected: detectedAsAutopay(ap), txns: g.txns.slice(0, 6), category: g.cat,
      setAside: goal?.accountId && coverId === goal.accountId ? { goalId: goal.id, accountId: goal.accountId, monthly: goal.monthlyTarget } : undefined,
    };
    (group === "obligations" ? obligations : group === "taxes" ? taxBills : fixed).push(row);
  }
  for (const m of fp.manualItems ?? []) {
    const id = `m-${m.id}`;
    const fundingKey = `funding:${m.group === "obligations" ? "obligation" : "expense"}:${id}`;
    const userCover = funding[fundingKey];
    const coverId = userCover && userCover !== FP_UNASSIGNED ? userCover : null;
    const row: PictureRow = {
      group: m.group, id, label: m.label, sub: "Added by you", monthly: m.monthly, detected: 0, fundingKey,
      coverId, coverSource: coverId ? "user" : "none", unassignedReason: coverId ? undefined : `Pick the account that pays ${m.label} so it counts in your plan.`,
      dueDay: m.dueDay ?? null, dueText: m.dueDay ? ORDINAL(m.dueDay) : undefined, txns: [], manualId: m.id,
    };
    (m.group === "obligations" ? obligations : fixed).push(row);
  }
  const byAmount = (a: PictureRow, b: PictureRow) => b.monthly - a.monthly;
  obligations.sort(byAmount); fixed.sort(byAmount); taxBills.sort(byAmount);

  // ── Budgeted categories ──
  const monthStart = `${todayStr.slice(0, 7)}-01`;
  const since90b = since90;
  const budgets: PictureRow[] = [];
  for (const [cat, amt] of Object.entries(inp.budgets ?? {})) {
    if (!(amt > 0)) continue;
    // A budget on a bill/loan/savings category ("Bills & Utilities") is already
    // in Obligations / Fixed / Savings; listing it here would count it twice.
    if (resolveBucket({ type: "spend" }, cat) !== "expense") continue;
    const catTx = posted.filter(t => bucketOf.get(t.id) === "expense" && (getEffectiveCategory(t) || "") === cat);
    const spent = catTx.filter(t => t.date >= monthStart).reduce((s, t) => s + num(t.amount), 0);
    const recent = catTx.filter(t => t.date >= since90b && num(t.amount) > 0).sort(newestFirst);
    const fundingKey = `funding:budget:${cat}`;
    const userCover = funding[fundingKey];
    let coverId: string | null = null, coverSource: PictureRow["coverSource"] = "none";
    if (userCover) { coverId = userCover === FP_UNASSIGNED ? null : userCover; coverSource = "user"; }
    else { coverId = majorityAccount(recent, 0.5); coverSource = coverId ? "detected" : "none"; }
    budgets.push({
      group: "budgets", id: slug(cat), label: fmtCat(cat), category: cat, monthly: amt, detected: amt, spent: Math.max(0, spent),
      fundingKey, coverId, coverSource, txns: recent.slice(0, 6),
    });
  }
  budgets.sort(byAmount);

  // ── Cards & payoff accounts ──
  const since180 = daysAgo(today, 180);
  const cards: CardInfo[] = acctList.filter(a => a.kind === "card").map(a => {
    const payments = posted.filter(t => t.account_id === a.id && t.date >= since180 && classOf(t)?.type === "credit_card_payment" && num(t.amount) < 0).sort(newestFirst);
    const userPayoff = inp.cardAutopayFrom?.[a.id] ?? null;
    // Detected payer: the bank leg of matched payments (>= 60% from one account).
    const payers = new Map<string, number>();
    for (const t of payments) {
      const pid = classOf(t)?.pairId; const other = pid ? byId.get(pid) : undefined;
      if (other && acct.get(other.account_id)?.kind !== "card") payers.set(other.account_id, (payers.get(other.account_id) ?? 0) + 1);
    }
    let detectedPayoff: string | null = null;
    for (const [id, n] of payers) if (n / Math.max(1, payments.length) >= 0.6) detectedPayoff = id;
    const payoff = userPayoff ?? detectedPayoff;
    const last = payments[0] ?? null;
    return {
      id: a.id, label: a.label, name: a.name, mask: a.mask, payoffId: payoff, payoffSource: userPayoff ? "user" : detectedPayoff ? "detected" : "none",
      dueDay: last ? Number(last.date.slice(8, 10)) : null, lastPayment: last, payments,
    } as CardInfo;
  });

  // ── Savings goals (own transfers) ──
  const savings: PictureRow[] = [];
  const goalAccounts = new Set<string>();
  for (const g of goals) {
    if (g.kind === "category") continue;
    const to = g.accountId ?? null;
    if (to) goalAccounts.add(to);
    savings.push({
      group: "savings", id: g.id, goalId: g.id, label: g.name, monthly: Math.max(0, num(g.monthlyTarget)), detected: 0,
      toId: to, fromId: g.fromAccountId ?? null, coverId: g.fromAccountId ?? to, coverSource: "user",
      target: g.targetAmount, have: to ? acct.get(to)?.balance : undefined, by: g.targetDate, txns: [],
    });
  }
  // Detected transfers to your own savings accounts that no goal covers yet.
  const detByDest = new Map<string, PTxn[]>();
  for (const t of savingsTxns) {
    const c = classOf(t);
    const other = c?.pairId ? byId.get(c.pairId) : undefined;
    // The other leg when it's linked; otherwise an account whose last 4 is in the description.
    const desc = `${t.name ?? ""} ${t.merchant_name ?? ""}`;
    const dest = other?.account_id ?? acctList.find(a => a.id !== t.account_id && a.mask && a.mask.length >= 4 && desc.includes(a.mask))?.id;
    const key = dest ?? `sub:${c?.subtype ?? "savings"}`;
    if (dest && goalAccounts.has(dest)) continue;
    const a = dest ? acct.get(dest) : undefined;
    if (a && (a.subtype === "hsa" || /^(401k|403b|401a|457b)$/.test(a.subtype))) continue; // shown as deductions
    detByDest.set(key, [...(detByDest.get(key) ?? []), t]);
  }
  for (const [key, list] of detByDest) {
    const sub0 = key.startsWith("sub:") ? key.slice(4) : "";
    // One brokerage account and an unlinked "to brokerage" transfer: that's where it went.
    const brokerages = acctList.filter(x => x.kind === "invest" && !/^(401k|403b|401a|457b|ira|roth)$/.test(x.subtype));
    const a = acct.get(key) ?? (sub0 === "brokerage" && brokerages.length === 1 ? brokerages[0] : undefined);
    const m = list.reduce((s, t) => s + num(t.amount), 0) / 3;
    if (m < 1) continue;
    const sub = key.startsWith("sub:") ? key.slice(4) : "";
    const label = a ? `Transfers to ${a.name}` : sub === "brokerage" ? "Investing transfers" : "Transfers to savings";
    savings.push({
      group: "savings", id: `det-${slug(key)}`, label, monthly: m, detected: m, toId: a?.id ?? null,
      fromId: majorityAccount(list, 0.5), coverId: majorityAccount(list, 0.5), coverSource: "detected", have: a?.balance,
      tags: ["det"], detectedOnly: true, txns: list.sort(newestFirst).slice(0, 6),
    });
  }

  // ── Gross pay & payroll ──
  const nm = nextMonth(today);
  const filing = overrides["filingStatusCode"] === 1 ? "married_joint" : "single";
  const grossOverride = overrides["income.grossSalaryAnnual"];
  return {
    accounts: acctList, acct,
    rows: { income, deductions, obligations, fixed, taxes: taxBills, budgets, savings },
    cards,
    pay: { cadence: payCadence, perMonth, perPaycheck, employer },
    gross: grossOverride && grossOverride > 0
      ? { annual: grossOverride, estimated: false }
      : { annual: estimateGross(income, deductions, filing), estimated: true },
    filing,
    payroll: {
      hsa: deductions[0].monthly, k401: deductions[1].monthly, espp: deductions[2].monthly, rsu: deductions[3].monthly,
      hsaEmployer: Math.max(0, num(overrides["benefit.hsaEmployer"])),
    },
    nextMonthLabel: nm.label, nextMonthKey: nm.key,
    series,
  };
}
