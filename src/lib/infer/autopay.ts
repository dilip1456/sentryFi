/**
 * Autopay detection for bills and credit cards (INFERENCES.md §2.1, §2.2, §2.4).
 *
 * Pure TS over PR #6's recurring series (src/lib/recurring) and the shared
 * classifier (src/lib/classify, via createSharedClassifier). Results are
 * SUGGESTIONS: nothing here changes totals; only a confirmed `inferences` row
 * does (see decisions.ts / apply.ts).
 *
 * Privacy (§5): health / medical, donations / religion and legal payees are
 * never inferred, nor are person-to-person payments. Payloads carry the
 * series display name, amounts, dates and account ids, never raw descriptors.
 */
import type { ClassifierAccount, ClassifierTxn, TransactionClassifier } from "../recurring/classifier";
import { createSharedClassifier } from "../recurring/shared-classifier";
import type { RecurringSeries } from "../recurring/detect";
import type { PayMethod, StreamAutopay } from "../recurring/rows";
import { P2P_RE } from "../classify/patterns";
import { addDays, addMonths, diffDays, isBusinessDay, parseDate, type ISODate } from "../recurring/dates";
import { clamp01, confidenceTier, HIGH_CONFIDENCE, INFER_DETECTOR_VERSION, round3, type ConfidenceTier, type EvidenceItem, type Finding } from "./types";

// ── Signals ──────────────────────────────────────────────────────────────────

/** Descriptor words banks put on merchant-initiated (autopay) debits. */
export const AUTOPAY_DESCRIPTOR_RE = /\bauto\s?pay\b|\bautomatic\b|\brecurring\b|\bach\s+debit\b|\bppd\b|\bweb\s+id\b/i;
/** Descriptor words of user-initiated payments (bank bill pay, one-off online payments, Zelle). */
export const MANUAL_PAY_DESCRIPTOR_RE = /\bbill\s?pay\b|\bbillpay\b|\bonline\s+(pmt|payment)\b|\bzelle\b/i;
/** Payees we never infer anything about (§5 privacy). */
export const SENSITIVE_RE =
  /medical|health|hospital|clinic|doctor|physician|dental|dentist|orthodont|pharmac|\bcvs\b|walgreens|therap|counsel|psychiatr|vision\s+care|optometr|donation|charit|church|tithe|mosque|synagogue|temple|ministr|diocese|religio|legal|attorney|lawyer|law\s+(firm|office)|\besq\b|court|bail/i;
const SENSITIVE_PFC_PRIMARY = new Set(["MEDICAL"]);
const SENSITIVE_PFC_DETAILED_RE = /DONATION|LEGAL|MEDICAL|HEALTH/;

const descriptorOf = (t: Pick<ClassifierTxn, "name" | "merchant_name">) => `${t.merchant_name ?? ""} ${t.name ?? ""}`.trim();

const isCredit = (a?: ClassifierAccount) => (a?.type ?? "").toLowerCase() === "credit";

/** True when nothing should be inferred about this series (§5). */
export function isSensitiveSeries(s: Pick<RecurringSeries, "displayName" | "category" | "subtype" | "transactionIds">, txnsById: Map<string, ClassifierTxn>): boolean {
  if (s.subtype === "p2p") return true;
  if (SENSITIVE_RE.test(`${s.displayName} ${s.category ?? ""}`)) return true;
  for (const id of s.transactionIds) {
    const t = txnsById.get(id);
    if (!t) continue;
    if (t.pfc_primary && SENSITIVE_PFC_PRIMARY.has(t.pfc_primary)) return true;
    if (t.pfc_detailed && SENSITIVE_PFC_DETAILED_RE.test(t.pfc_detailed)) return true;
    const d = descriptorOf(t);
    if (P2P_RE.test(d) || SENSITIVE_RE.test(d)) return true;
  }
  return false;
}

/** Business days d with a < d <= b (negative when b < a). */
export function businessDaysBetween(a: ISODate, b: ISODate): number {
  if (a === b) return 0;
  const [lo, hi, sign] = a < b ? [a, b, 1] : [b, a, -1];
  let n = 0;
  for (let d = addDays(lo, 1); d <= hi; d = addDays(d, 1)) if (isBusinessDay(d)) n++;
  return n * sign;
}

export function addBusinessDays(d: ISODate, n: number): ISODate {
  let cur = d;
  let left = n;
  while (left > 0) {
    cur = addDays(cur, 1);
    if (isBusinessDay(cur)) left--;
  }
  return cur;
}

/** Distance between two days of month, wrapping at month end (31 ↔ 1 is 1 day apart). */
function domDistance(a: number, b: number, monthLen = 31): number {
  const d = Math.abs(a - b);
  return Math.min(d, monthLen - d);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Bank timing slack: an on-time debit lands on the due date, or the next
 * business day when the due date is a weekend / holiday.
 */
function timingDeviation(actual: ISODate, expected: ISODate): number {
  const raw = diffDays(actual, expected); // + = after due
  if (raw > 0 && businessDaysBetween(expected, actual) <= (isBusinessDay(expected) ? 0 : 1)) return 0;
  return Math.abs(raw);
}

// ── §2.1 Bills ───────────────────────────────────────────────────────────────

const BILL_KINDS = new Set(["bill", "loan", "subscription"]);

export interface BillAutopayOptions {
  accounts: ClassifierAccount[];
  /** Recent payday dates (income_salary series). Bills paid 0-1 days after payday are the manual-payer trap. */
  paydays?: ISODate[];
  /** Cycles to look back over (default 12). */
  maxCycles?: number;
}

export interface BillCycle {
  transactionId: string;
  expectedDate: ISODate;
  date: ISODate;
  amount: number;
  accountId: string | null;
}

export interface BillAutopayResult {
  seriesKey: string;
  displayName: string;
  autopay: StreamAutopay;
  payMethod: PayMethod | null;
  payFromAccountId: string | null;
  payDay: number | null;
  amount: number;
  cadence: string;
  confidence: number;
  tier: ConfidenceTier;
  cycles: number;
  evidence: EvidenceItem[];
  /** Short machine reasons ("same_account", "autopay_descriptor", "billpay_descriptor", ...). */
  signals: string[];
}

/** Trailing run of consecutive paid cycles (a late or skipped cycle breaks it). */
function paidRun(s: RecurringSeries, max: number): BillCycle[] {
  const past = s.occurrences.filter(o => o.status !== "expected").sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  const run: BillCycle[] = [];
  for (let i = past.length - 1; i >= 0 && run.length < max; i--) {
    const o = past[i];
    if (o.status !== "paid" || !o.transactionId || !o.actualDate || o.userSet) break;
    run.unshift({ transactionId: o.transactionId, expectedDate: o.expectedDate, date: o.actualDate, amount: o.actualAmount ?? o.expectedAmount, accountId: null });
  }
  return run;
}

const isMonthlyish = (cadence: string) => /month|quarter|semi_?annual|annual|year/i.test(cadence);

export function detectBillAutopay(series: RecurringSeries, txnsById: Map<string, ClassifierTxn>, opts: BillAutopayOptions): BillAutopayResult | null {
  if (!BILL_KINDS.has(series.kind) || series.direction !== "outflow" || !series.active) return null;
  if (isSensitiveSeries(series, txnsById)) return null;
  const cycles = paidRun(series, opts.maxCycles ?? 12);
  for (const c of cycles) c.accountId = txnsById.get(c.transactionId)?.account_id ?? series.accountId;
  const n = cycles.length;
  if (n < 2) return null;

  const accountsById = new Map(opts.accounts.map(a => [a.account_id, a] as const));
  const signals: string[] = [];

  // Rule 2: same account every cycle (one exception allowed when N >= 5).
  const counts = new Map<string, number>();
  for (const c of cycles) counts.set(c.accountId ?? "", (counts.get(c.accountId ?? "") ?? 0) + 1);
  const [payFrom, sameCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const mismatches = n - sameCount;
  const sameAccount = mismatches === 0 || (n >= 5 && mismatches <= 1);
  // A switch among the latest cycles is a strong manual signal.
  const recentSwitch = cycles.slice(-3).some(c => (c.accountId ?? "") !== payFrom);
  if (sameAccount) signals.push("same_account");

  // Rule 3: on schedule (±3 days of the expected date, bank-day shift allowed) or same day of month ±2.
  const devs = cycles.map(c => timingDeviation(c.date, c.expectedDate));
  const onSchedule = devs.every(d => d <= 3);
  const monthly = isMonthlyish(series.cadence);
  const doms = cycles.map(c => parseDate(c.date).d);
  const medDom = Math.round(median(doms));
  const domSpread = monthly ? Math.max(...doms.map(d => domDistance(d, medDom))) * 2 : 0;
  const sameDom = monthly && doms.every(d => domDistance(d, medDom) <= 2);
  const timed = onSchedule || sameDom;
  if (timed) signals.push("on_schedule");

  const card = isCredit(accountsById.get(payFrom));
  const txns = cycles.map(c => txnsById.get(c.transactionId)).filter((t): t is ClassifierTxn => !!t);
  const autopayWords = txns.filter(t => AUTOPAY_DESCRIPTOR_RE.test(descriptorOf(t))).length;
  const manualWords = txns.filter(t => MANUAL_PAY_DESCRIPTOR_RE.test(descriptorOf(t))).length;

  // Manual-payer trap: always paid 0-1 days after a payday, not on the bill's own date.
  const paydays = opts.paydays ?? [];
  const paydayAligned =
    n >= 3 && paydays.length > 0 && cycles.every(c => paydays.some(p => { const d = diffDays(c.date, p); return d >= 0 && d <= 1; }));

  const amount = round2(median(cycles.map(c => c.amount)));
  const payDay = monthly ? medDom : null;
  const evidence: EvidenceItem[] = cycles.map(c => ({ transactionId: c.transactionId, date: c.date, amount: c.amount, accountId: c.accountId }));
  const base = { seriesKey: series.seriesKey, displayName: series.displayName, payDay, amount, cadence: series.cadence, cycles: n, evidence, signals };

  if (sameAccount && timed) {
    let conf = n >= 3 ? (card ? 0.9 : 0.85) : 0.65;
    let boost = 0;
    if (autopayWords > 0 && autopayWords >= n / 2) { boost += 0.1; signals.push("autopay_descriptor"); }
    if (txns.length === n && txns.every(t => (t.payment_channel ?? "") === "online" && !t.authorized_date)) { boost += 0.1; signals.push("no_authorization"); }
    if (devs.every(d => d <= 1)) { boost += 0.1; signals.push("exact_timing"); }
    conf += Math.min(boost, 0.2);
    if (monthly && domSpread > 5) { conf -= 0.3; signals.push("day_drift"); }
    if (manualWords > 0) { conf -= 0.3; signals.push("billpay_descriptor"); }
    // Rule 7: only a switch among the RECENT cycles costs -0.5; the one older
    // exception rule 2 allows at N >= 5 is not penalised.
    if (recentSwitch) { conf -= 0.5; signals.push("account_switch"); }
    if (paydayAligned && autopayWords === 0) { conf -= 0.3; signals.push("payday_aligned"); }
    // Rule 5: N = 2 is Medium (ask to confirm) however strong the boosters are.
    if (n < 3) conf = Math.min(conf, HIGH_CONFIDENCE - 0.01);
    conf = round3(clamp01(Math.min(conf, 0.98)));
    const tier = confidenceTier(conf);
    if (tier !== "low") return { ...base, autopay: "auto", payMethod: card ? "card" : "bank", payFromAccountId: payFrom || null, confidence: conf, tier };
    // Regular, but the evidence says a person pays it (bill-pay wording / right after payday): fall through to manual.
    if (card || (manualWords === 0 && !paydayAligned)) {
      return { ...base, autopay: "unknown", payMethod: null, payFromAccountId: payFrom || null, confidence: conf, tier };
    }
  }

  // Not autopay-shaped. With bill-pay wording or 3+ irregular cycles from a bank account, it's paid by hand.
  if (!card && (manualWords > 0 || paydayAligned || (n >= 3 && !timed) || recentSwitch)) {
    if (manualWords > 0) signals.push("billpay_descriptor");
    if (!timed) signals.push("irregular_timing");
    if (!sameAccount) signals.push("account_switch");
    const conf = round3(Math.min(0.9, (n >= 3 ? 0.7 : 0.6) + (manualWords > 0 ? 0.1 : 0)));
    return { ...base, autopay: "manual", payMethod: "manual", payFromAccountId: payFrom || null, confidence: conf, tier: confidenceTier(conf) };
  }
  return { ...base, autopay: "unknown", payMethod: null, payFromAccountId: payFrom || null, confidence: 0.4, tier: "low" };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Payday dates from salary series, for the manual-payer trap. */
export function paydaysFrom(series: RecurringSeries[]): ISODate[] {
  return series
    .filter(s => s.kind === "salary")
    .flatMap(s => s.occurrences.map(o => o.actualDate).filter((d): d is ISODate => !!d));
}

export function detectBillAutopays(series: RecurringSeries[], txns: ClassifierTxn[], opts: BillAutopayOptions): BillAutopayResult[] {
  const byId = new Map(txns.map(t => [t.transaction_id, t] as const));
  const paydays = opts.paydays ?? paydaysFrom(series);
  return series.map(s => detectBillAutopay(s, byId, { ...opts, paydays })).filter((r): r is BillAutopayResult => !!r);
}

// ── §2.2 Credit cards ────────────────────────────────────────────────────────

export interface CardStatement {
  statement_issue_date: ISODate;
  statement_balance: number | null;
  minimum_payment_amount: number | null;
  due_date: ISODate | null;
}

/** The latest Plaid liabilities snapshot (plaid_credit_details). */
export interface CardCreditDetails {
  last_statement_issue_date?: ISODate | null;
  last_statement_balance?: number | null;
  minimum_payment_amount?: number | null;
  next_payment_due_date?: ISODate | null;
}

export interface CardInput {
  account: ClassifierAccount;
  details?: CardCreditDetails | null;
  /** credit_statements history (any order). */
  statements?: CardStatement[];
  /** The user's own setting (user_settings.cardAutopayFrom[cardId]); always wins. */
  userAutopayFrom?: string | null;
}

/** A payment that landed on a linked card. */
export interface CardPayment {
  cardAccountId: string;
  transactionId: string;
  date: ISODate;
  amount: number;
  /** The paying account when the bank leg is linked and matched. */
  fromAccountId: string | null;
  autopayWords: boolean;
}

/** Card payments from the shared classifier's `credit_card_payment` legs (card side; bank side resolves the payer). */
export function cardPaymentsFrom(txns: ClassifierTxn[], accounts: ClassifierAccount[], classifier: TransactionClassifier = createSharedClassifier()): CardPayment[] {
  const byAcct = new Map(accounts.map(a => [a.account_id, a] as const));
  const cls = classifier.classifyAll(txns, { accounts });
  const out: CardPayment[] = [];
  for (const t of txns) {
    if (t.pending || !(t.amount < 0) || !isCredit(byAcct.get(t.account_id))) continue;
    const c = cls.get(t.transaction_id);
    if (c?.txnType !== "credit_card_payment") continue;
    const from = c.counterpartAccountId && !isCredit(byAcct.get(c.counterpartAccountId)) ? c.counterpartAccountId : null;
    out.push({
      cardAccountId: t.account_id,
      transactionId: t.transaction_id,
      date: t.date,
      amount: round2(-t.amount),
      fromAccountId: from,
      autopayWords: AUTOPAY_DESCRIPTOR_RE.test(descriptorOf(t)),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export type CardAutopayMode = "full" | "minimum" | "fixed" | "manual" | "unknown";

export interface CardCycle {
  dueDate: ISODate;
  statement: CardStatement | null;
  payments: CardPayment[];
  /** One payment 0-3 business days before (or on) the due date. */
  timed: boolean;
  match: "full" | "minimum" | "other" | null;
}

export interface CardAutopayResult {
  cardAccountId: string;
  /** auto = looks like autopay; manual = paid by hand; unknown = not enough to say. */
  autopay: StreamAutopay;
  mode: CardAutopayMode;
  /** Fixed-mode amount, else the latest payment. */
  amount: number | null;
  fromAccountId: string | null;
  fromSource: "user" | "detected" | null;
  /** Detected payer when it disagrees with the user's setting in the last 2+ cycles. */
  disagreeingFromAccountId: string | null;
  payDay: number | null;
  dueDay: number | null;
  /** Statement minus the latest payment, when positive (carried balance → interest, §3.11). */
  carriedBalance: number | null;
  cycles: number;
  confidence: number;
  tier: ConfidenceTier;
  evidence: EvidenceItem[];
  signals: string[];
}

const FULL_ABS = 1;
const FULL_PCT = 0.005;

function matchStatement(amount: number, st: CardStatement | null): CardCycle["match"] {
  if (!st) return null;
  const bal = st.statement_balance;
  if (bal != null && Math.abs(amount - bal) <= Math.max(FULL_ABS, FULL_PCT * Math.abs(bal))) return "full";
  if (st.minimum_payment_amount != null && Math.abs(amount - st.minimum_payment_amount) <= 1) return "minimum";
  return "other";
}

/** Known statements plus the live snapshot, deduped by due date. */
function statementsFor(card: CardInput): CardStatement[] {
  const byDue = new Map<string, CardStatement>();
  for (const s of card.statements ?? []) if (s.due_date) byDue.set(s.due_date, s);
  const d = card.details;
  if (d?.next_payment_due_date && !byDue.has(d.next_payment_due_date) && d.last_statement_balance != null) {
    byDue.set(d.next_payment_due_date, {
      statement_issue_date: d.last_statement_issue_date ?? addDays(d.next_payment_due_date, -25),
      statement_balance: d.last_statement_balance,
      minimum_payment_amount: d.minimum_payment_amount ?? null,
      due_date: d.next_payment_due_date,
    });
  }
  return [...byDue.values()].sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
}

/**
 * Detect how a card gets paid. With statement history (credit_statements) every
 * cycle is classified; before that only the latest cycle has a statement, so
 * the result is capped at Medium (§2.2).
 */
export function detectCardAutopay(card: CardInput, payments: CardPayment[], opts: { today: ISODate; maxCycles?: number }): CardAutopayResult | null {
  const cardId = card.account.account_id;
  const mine = payments.filter(p => p.cardAccountId === cardId);
  const statements = statementsFor(card);
  const latestDue = statements.length ? statements[statements.length - 1].due_date! : null;
  if (!latestDue) return null;

  // Due dates: known statements, plus monthly dates back from the latest one for cycles without a statement.
  const dueDay = parseDate(latestDue).d;
  const dues = new Set<string>(statements.map(s => s.due_date!));
  // Fill months without a known statement (a known due date within 10 days wins).
  const known = [...dues];
  for (let k = 1; k <= (opts.maxCycles ?? 12); k++) {
    const d = addMonths(latestDue, -k, dueDay);
    if (!known.some(x => Math.abs(diffDays(x, d)) <= 10)) dues.add(d);
  }
  const stByDue = new Map(statements.map(s => [s.due_date!, s] as const));
  const sortedDues = [...dues].sort();

  const cycles: CardCycle[] = [];
  for (let i = 0; i < sortedDues.length; i++) {
    const due = sortedDues[i];
    const prev = i > 0 ? sortedDues[i - 1] : addDays(due, -31);
    // Payments for this due date: after the previous due (+1 business-day grace), up to one bank day after.
    const winEnd = isBusinessDay(due) ? due : addBusinessDays(due, 1);
    const winStart = i > 0 ? addBusinessDays(prev, 1) : prev;
    const ps = mine.filter(p => p.date > winStart && p.date <= winEnd);
    if (due > opts.today && ps.length === 0) continue; // not due yet
    if (cycles.length === 0 && ps.length === 0) continue; // before the first payment we can see
    const st = stByDue.get(due) ?? null;
    const single = ps.length === 1 ? ps[0] : null;
    const lead = single ? businessDaysBetween(single.date, due) : null;
    const timed = !!single && lead !== null && lead >= 0 && lead <= 3;
    cycles.push({ dueDate: due, statement: st, payments: ps, timed, match: single ? matchStatement(single.amount, st) : null });
  }
  if (cycles.length === 0) return null;

  const latestPaid = [...cycles].reverse().find(c => c.payments.length > 0) ?? null;
  const signals: string[] = [];

  // Trailing run of timed single payments from one account.
  const run: CardCycle[] = [];
  for (let i = cycles.length - 1; i >= 0; i--) {
    const c = cycles[i];
    if (!c.timed) {
      if (i === cycles.length - 1 && c.dueDate >= opts.today && c.payments.length === 0) continue; // current cycle still open
      break;
    }
    if (run.length && (run[0].payments[0].fromAccountId ?? "") !== (c.payments[0].fromAccountId ?? "")) break;
    run.unshift(c);
  }

  const lastPayment = latestPaid?.payments[latestPaid.payments.length - 1] ?? null;
  const lastSt = latestPaid?.statement ?? null;
  const carriedBalance =
    lastPayment && lastSt?.statement_balance != null && latestPaid!.match !== "full" && lastSt.statement_balance - lastPayment.amount > 1
      ? round2(lastSt.statement_balance - lastPayment.amount)
      : null;

  const evidenceOf = (cs: CardCycle[]) =>
    cs.flatMap(c => c.payments.map(p => ({ transactionId: p.transactionId, date: p.date, amount: p.amount, accountId: p.fromAccountId ?? p.cardAccountId })));

  // User setting wins; a disagreement in the last 2+ cycles is its own finding.
  const recentFroms = cycles.filter(c => c.payments.length === 1).slice(-2).map(c => c.payments[0].fromAccountId);
  const user = card.userAutopayFrom ?? null;
  const disagreeing =
    user && recentFroms.length >= 2 && recentFroms.every(f => f && f !== user && f === recentFroms[0]) ? (recentFroms[0] as string) : null;

  const base = {
    cardAccountId: cardId,
    dueDay,
    carriedBalance,
    disagreeingFromAccountId: disagreeing,
    signals,
  };

  if (run.length >= 2) {
    const withSt = run.filter(c => c.match !== null);
    const amounts = run.map(c => c.payments[0].amount);
    const allFull = withSt.length > 0 && withSt.every(c => c.match === "full");
    const allMin = withSt.length > 0 && withSt.every(c => c.match === "minimum");
    const sameAmount = amounts.every(a => Math.abs(a - amounts[0]) <= 1);
    const belowStatement = withSt.every(c => c.match === "other" && c.payments[0].amount < (c.statement?.statement_balance ?? Infinity));
    let mode: CardAutopayMode = "unknown";
    // Cycles whose mode is backed by a statement. A same-amount run with no
    // statements yet still reads as "fixed", but stays Medium (§2.2) until
    // statement history shows it's below the balance.
    let verified = 0;
    if (allFull) { mode = "full"; verified = withSt.length; }
    else if (allMin) { mode = "minimum"; verified = withSt.length; }
    else if (sameAmount && belowStatement) { mode = "fixed"; verified = withSt.length; }
    if (mode !== "unknown") signals.push(`mode_${mode}`);

    let conf = run.length >= 3 && verified >= 3 ? 0.88 : 0.7; // Medium until 3 verified cycles
    if (mode === "unknown") conf = 0.62;
    if (run.some(c => c.payments[0].autopayWords)) { conf += 0.07; signals.push("autopay_descriptor"); }
    conf = round3(Math.min(conf, 0.95));
    const detectedFrom = run[run.length - 1].payments[0].fromAccountId;
    const pays = run.map(c => parseDate(c.payments[0].date).d);
    return {
      ...base,
      autopay: "auto",
      mode,
      amount: mode === "fixed" ? round2(median(amounts)) : amounts[amounts.length - 1],
      fromAccountId: user ?? detectedFrom,
      fromSource: user ? "user" : detectedFrom ? "detected" : null,
      payDay: Math.round(median(pays)),
      cycles: run.length,
      confidence: conf,
      tier: confidenceTier(conf),
      evidence: evidenceOf(run),
    };
  }

  // Manual: multiple payments per cycle, or payments well before / after the due date, in 2+ recent cycles.
  const recent = cycles.slice(-3).filter(c => c.payments.length > 0);
  const irregular = recent.filter(c => !c.timed);
  if (irregular.length >= 2) {
    signals.push(recent.some(c => c.payments.length > 1) ? "multiple_payments" : "irregular_timing");
    const conf = irregular.length >= 3 ? 0.8 : 0.7;
    return {
      ...base,
      autopay: "manual",
      mode: "manual",
      amount: lastPayment?.amount ?? null,
      fromAccountId: user ?? lastPayment?.fromAccountId ?? null,
      fromSource: user ? "user" : lastPayment?.fromAccountId ? "detected" : null,
      payDay: null,
      cycles: irregular.length,
      confidence: conf,
      tier: confidenceTier(conf),
      evidence: evidenceOf(irregular),
    };
  }

  // One timed cycle: classify the latest only, Medium at best (§2.2 "until history accumulates").
  if (run.length === 1 && run[0].match && run[0].match !== "other") {
    const p = run[0].payments[0];
    signals.push(`mode_${run[0].match}`, "single_cycle");
    const conf = 0.6;
    return {
      ...base,
      autopay: "auto",
      mode: run[0].match,
      amount: p.amount,
      fromAccountId: user ?? p.fromAccountId,
      fromSource: user ? "user" : p.fromAccountId ? "detected" : null,
      payDay: parseDate(p.date).d,
      cycles: 1,
      confidence: conf,
      tier: confidenceTier(conf),
      evidence: evidenceOf(run),
    };
  }
  return {
    ...base,
    autopay: "unknown",
    mode: "unknown",
    amount: lastPayment?.amount ?? null,
    fromAccountId: user,
    fromSource: user ? "user" : null,
    payDay: null,
    cycles: 0,
    confidence: 0.3,
    tier: "low",
    evidence: [],
  };
}

// ── §2.4 Missed autopay ──────────────────────────────────────────────────────

export type ManualPayReason = "billpay_descriptor" | "different_account" | "different_day";

export interface ManualPayment {
  transactionId: string;
  date: ISODate;
  amount: number;
  accountId: string | null;
  reasons: ManualPayReason[];
}

export interface AutopayMissedResult {
  seriesKey: string;
  displayName: string;
  /** Expected dates with no payment by due + 3 business days, newest last. */
  missedDates: ISODate[];
  /** Two misses in a row: the autopay state should drop back to "unknown". */
  downgrade: boolean;
  /** The latest payment looks hand-made (§2.4): suggest Manual, pending confirm. */
  manualPayment: ManualPayment | null;
  /** What confirming this finding changes the bill to (see apply.ts). */
  downgradeTo: "unknown" | "manual" | null;
  expectedAmount: number;
  payFromAccountId: string | null;
}

/** Day-of-month difference beyond which an on-time-ish payment isn't the autopay's (§2.4). */
export const MANUAL_DAY_DIFF = 5;

/**
 * For a CONFIRMED autopay bill (§2.4):
 *  - a miss is no matching payment by due + 3 business days; two in a row
 *    downgrade to Unknown;
 *  - if the latest payment was made by hand (bill-pay wording, a different
 *    account than the confirmed one, or a day of month more than 5 off the
 *    autopay day), suggest Manual, pending confirm.
 * `confirmed.since` (the confirm date) keeps payments from before the
 * confirmation from counting; `txnsById` supplies descriptors and accounts.
 */
export function detectAutopayMissed(
  series: RecurringSeries,
  confirmed: { payFromAccountId: string | null; payDay?: number | null; since?: ISODate | null },
  today: ISODate,
  txnsById?: Map<string, ClassifierTxn>,
): AutopayMissedResult | null {
  const past = series.occurrences
    .filter(o => addBusinessDays(o.expectedDate, 3) < today || (o.status === "paid" && !!o.actualDate && o.actualDate <= today))
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  const missed: ISODate[] = [];
  for (let i = past.length - 1; i >= 0; i--) {
    const o = past[i];
    if (o.status === "paid" || o.status === "skipped") break;
    if (addBusinessDays(o.expectedDate, 3) < today) missed.unshift(o.expectedDate);
  }

  let manualPayment: ManualPayment | null = null;
  const latest = past[past.length - 1];
  if (missed.length === 0 && latest?.status === "paid" && latest.transactionId && latest.actualDate && !latest.userSet &&
      (!confirmed.since || latest.actualDate >= confirmed.since)) {
    const t = txnsById?.get(latest.transactionId);
    const accountId = t?.account_id ?? null;
    const reasons: ManualPayReason[] = [];
    if (t && MANUAL_PAY_DESCRIPTOR_RE.test(descriptorOf(t))) reasons.push("billpay_descriptor");
    if (accountId && confirmed.payFromAccountId && accountId !== confirmed.payFromAccountId) reasons.push("different_account");
    if (confirmed.payDay != null && isMonthlyish(series.cadence) && domDistance(parseDate(latest.actualDate).d, confirmed.payDay) > MANUAL_DAY_DIFF) {
      reasons.push("different_day");
    }
    if (reasons.length) {
      manualPayment = { transactionId: latest.transactionId, date: latest.actualDate, amount: latest.actualAmount ?? latest.expectedAmount, accountId, reasons };
    }
  }
  if (missed.length === 0 && !manualPayment) return null;
  const downgrade = missed.length >= 2;
  return {
    seriesKey: series.seriesKey,
    displayName: series.displayName,
    missedDates: missed,
    downgrade,
    manualPayment,
    downgradeTo: downgrade ? "unknown" : manualPayment ? "manual" : null,
    expectedAmount: series.nextExpectedAmount ?? series.amount.median,
    payFromAccountId: confirmed.payFromAccountId,
  };
}

// ── Findings ─────────────────────────────────────────────────────────────────

/** A bill autopay suggestion worth showing (auto, Medium or High). */
export function billAutopayFinding(r: BillAutopayResult): Finding | null {
  if (r.autopay !== "auto" || r.tier === "low") return null;
  return {
    kind: "bill_autopay",
    subjectType: "stream",
    subjectRef: r.seriesKey,
    payload: {
      displayName: r.displayName,
      autopay: r.autopay,
      payMethod: r.payMethod,
      payFromAccountId: r.payFromAccountId,
      payDay: r.payDay,
      amount: r.amount,
      cadence: r.cadence,
      cycles: r.cycles,
      signals: r.signals,
    },
    confidence: r.confidence,
    evidence: r.evidence,
    detectorVersion: INFER_DETECTOR_VERSION,
  };
}

export function cardAutopayFindings(r: CardAutopayResult): Finding[] {
  const out: Finding[] = [];
  if (r.autopay === "auto" && r.tier !== "low") {
    out.push({
      kind: "card_autopay",
      subjectType: "account",
      subjectRef: r.cardAccountId,
      payload: {
        mode: r.mode,
        amount: r.amount,
        fromAccountId: r.fromAccountId,
        fromSource: r.fromSource,
        payDay: r.payDay,
        dueDay: r.dueDay,
        cycles: r.cycles,
        signals: r.signals,
      },
      confidence: r.confidence,
      evidence: r.evidence,
      detectorVersion: INFER_DETECTOR_VERSION,
    });
  }
  if (r.disagreeingFromAccountId) {
    out.push({
      kind: "card_autopay_source",
      subjectType: "account",
      subjectRef: r.cardAccountId,
      payload: { fromAccountId: r.disagreeingFromAccountId, currentFromAccountId: r.fromAccountId },
      confidence: 0.8,
      evidence: r.evidence.slice(-2),
      detectorVersion: INFER_DETECTOR_VERSION,
    });
  }
  return out;
}

export function autopayMissedFinding(r: AutopayMissedResult): Finding {
  const m = r.manualPayment;
  return {
    kind: "autopay_missed",
    subjectType: "stream",
    // one finding per series; a newer miss (`lastMissed`) or a newer hand-made
    // payment (`manualTransactionId`) asks again even after "Not right"
    subjectRef: r.seriesKey,
    payload: {
      displayName: r.displayName,
      missedDates: r.missedDates,
      lastMissed: r.missedDates.length ? r.missedDates[r.missedDates.length - 1] : null,
      downgrade: r.downgrade,
      downgradeTo: r.downgradeTo,
      manualTransactionId: m?.transactionId ?? null,
      manualReasons: m?.reasons ?? [],
      manualAccountId: m?.accountId ?? null,
      expectedAmount: r.expectedAmount,
      payFromAccountId: r.payFromAccountId,
    },
    // a hand-made payment is a Medium "pending confirm" (§2.4)
    confidence: r.downgrade ? 0.9 : r.missedDates.length ? 0.75 : 0.7,
    evidence: m ? [{ transactionId: m.transactionId, date: m.date, amount: m.amount, accountId: m.accountId }] : [],
    detectorVersion: INFER_DETECTOR_VERSION,
  };
}
