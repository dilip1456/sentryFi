/**
 * Recurring series & obligations detection (plan Phase 3, §3.4).
 *
 *   transactions ─▶ classifier (+ user overrides win) ─▶ drop internal transfers
 *     ─▶ group by (direction, merchant key) ─▶ fit cadence schedule
 *     ─▶ amount model ─▶ occurrences (paid / late / skipped / expected)
 *     ─▶ next expected date + amount ─▶ must-pay default
 *
 * Pure function of its inputs; "today" is the user's LOCAL calendar date.
 */
import { amountMatches, amountModel, type AmountModel } from "./amount";
import {
  withOverrides,
  type ClassifierAccount,
  type ClassifierTxn,
  type TransactionClassifier,
  type TxnClassification,
  type TxnType,
  type TxnTypeOverride,
} from "./classifier";
import { addDays, diffDays, nearestIrsEstimatedDue, parseDate, todayLocal, DEFAULT_TIME_ZONE, type ISODate, type ShiftPolicy } from "./dates";
import { billSubtype, displayName, loanSubtype, merchantKey, taxSubtype, YEARLY_HINT_RE } from "./patterns";
import {
  fitSchedule,
  matchTolerance,
  nextScheduled,
  scheduleDates,
  yearlyFromSingle,
  type Cadence,
  type Schedule,
  type ScheduledDate,
} from "./schedule";
import { createSharedClassifier } from "./shared-classifier";

export type SeriesDirection = "inflow" | "outflow";
export type SeriesKind =
  | "salary"
  | "income"
  | "interest"
  | "bill"
  | "subscription"
  | "loan"
  | "tax"
  | "savings"
  | "card_payment"
  | "transfer";
export type OccurrenceStatus = "expected" | "paid" | "late" | "skipped";

export interface Occurrence {
  /** Stable period key: nominal date (`2026-10-15`) or `2026-Q2` for estimated taxes. */
  period: string;
  label?: string;
  expectedDate: ISODate;
  expectedAmount: number;
  status: OccurrenceStatus;
  transactionId: string | null;
  actualDate: ISODate | null;
  actualAmount: number | null;
  /** Days past the grace window when paid late (0 = on time). */
  daysLate: number | null;
  /** True when the status came from the user, not detection. */
  userSet?: boolean;
}

export interface LoanDetail {
  account_id: string;
  kind: string; // mortgage | student | auto | personal
  next_payment_due_date?: ISODate | null;
  next_monthly_payment?: number | null;
  minimum_payment_amount?: number | null;
}

export interface OccurrenceOverride {
  seriesKey: string;
  period: string;
  status: "paid" | "skipped";
}

export interface RecurringSeries {
  seriesKey: string;
  merchantKey: string;
  displayName: string;
  direction: SeriesDirection;
  txnType: TxnType;
  subtype: string | null;
  kind: SeriesKind;
  category: string | null;
  cadence: Cadence;
  schedule: Schedule;
  accountId: string | null;
  counterpartAccountId: string | null;
  amount: AmountModel;
  nextExpectedDate: ISODate | null;
  nextExpectedAmount: number | null;
  firstSeen: ISODate;
  lastSeen: ISODate;
  occurrenceCount: number;
  /** False when the last two expected periods were missed (cancelled / ended). */
  active: boolean;
  mustPay: boolean;
  confidence: number;
  transactionIds: string[];
  occurrences: Occurrence[];
  reason: string;
}

export interface DetectOptions {
  /** Local calendar date to treat as today; defaults to now in `timeZone`. */
  today?: ISODate;
  timeZone?: string;
  /** Classifier; defaults to the shared classifier (src/lib/classify) via `createSharedClassifier()`. */
  classifier?: TransactionClassifier;
  /** Per-transaction user type overrides. These win over the classifier. */
  overrides?: TxnTypeOverride[];
  /** Credit card payments have their own due-date flow; excluded by default. */
  includeCardPayments?: boolean;
  /** History window (default ~25 months so a yearly item is seen twice). */
  lookbackDays?: number;
  loanDetails?: LoanDetail[];
  occurrenceOverrides?: OccurrenceOverride[];
}

const INCOME_TYPES = new Set<TxnType>(["income_salary", "income_interest", "income_other", "transfer_in"]);
const OUTFLOW_TYPES = new Set<TxnType>([
  "spend",
  "obligation_bill",
  "obligation_loan",
  "obligation_tax",
  "savings_contribution",
  "transfer_out",
  "credit_card_payment",
]);
const MUST_PAY_KINDS = new Set<SeriesKind>(["loan", "tax", "bill", "card_payment"]);

interface Member {
  t: ClassifierTxn;
  c: TxnClassification;
  key: string;
  direction: SeriesDirection;
}

/** Is this classified transaction eligible for recurring detection? */
export function isRecurringEligible(
  t: ClassifierTxn,
  c: TxnClassification,
  opts: Pick<DetectOptions, "includeCardPayments"> = {},
  account?: ClassifierAccount,
): boolean {
  if (t.pending) return false;
  if (!t.amount) return false;
  // Money arriving on the user's own card or loan account is the receiving
  // leg of a payment (or a refund), never income — even when unmatched.
  const acctType = (account?.type ?? "").toLowerCase();
  if (t.amount < 0 && (acctType === "credit" || acctType === "loan") && c.source !== "user") return false;
  // All linked accounts are the user's own: money moving between them is not a bill or income.
  if (c.txnType === "transfer_internal") return false;
  if (c.txnType === "refund") return false;
  if (c.txnType === "credit_card_payment" && !opts.includeCardPayments) return false;
  // A matched pair between two of the user's own accounts is internal movement
  // (savings sweeps, card payments, account-to-account) even when the
  // classifier upgrades its type. The one exception is a payment to the user's
  // own linked LOAN account: that is still a must-pay obligation.
  if (c.pairId && c.txnType !== "obligation_loan" && !(opts.includeCardPayments && c.txnType === "credit_card_payment")) return false;
  const out = t.amount > 0;
  if (out && !OUTFLOW_TYPES.has(c.txnType)) return false;
  if (!out && !INCOME_TYPES.has(c.txnType)) return false;
  return true;
}

function majority<T>(xs: T[]): T {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function kindFor(type: TxnType, subtype: string | null, text: string): SeriesKind {
  switch (type) {
    case "income_salary": return "salary";
    case "income_interest": return "interest";
    case "income_other":
    case "transfer_in": return "income";
    case "obligation_loan": return "loan";
    case "obligation_tax": return "tax";
    case "obligation_bill": return "bill";
    case "savings_contribution": return "savings";
    case "credit_card_payment": return "card_payment";
    case "transfer_out": return billSubtype(text) === "rent" ? "bill" : "transfer";
    default:
      if (billSubtype(text)) return "bill";
      // Money sent to a person (Zelle/Venmo) is "spend/p2p" in the shared taxonomy.
      return subtype === "p2p" ? "transfer" : "subscription";
  }
}

const LOAN_SUBTYPES = new Set(["mortgage", "student", "auto", "personal"]);
const TAX_SUBTYPES = new Set(["irs_estimated", "irs_federal", "state", "property"]);

/**
 * The shared classifier's subtypes are coarse for obligations ("tax",
 * "loan"); refine them from the descriptor so the IRS calendar, loan
 * servicer matching and must-pay labels work.
 */
export function refineSubtype(type: TxnType, subtype: string | null, text: string): string | null {
  if (type === "obligation_tax") return (subtype && TAX_SUBTYPES.has(subtype) ? subtype : null) ?? taxSubtype(text) ?? subtype;
  if (type === "obligation_loan") return (subtype && LOAN_SUBTYPES.has(subtype) ? subtype : null) ?? loanSubtype(text) ?? subtype;
  if (type === "obligation_bill" || type === "spend") return billSubtype(text) ?? subtype;
  return subtype;
}

/** Split a merchant group into amount clusters (±15% of the running cluster median). */
function amountClusters(ms: Member[]): Member[][] {
  const sorted = [...ms].sort((a, b) => Math.abs(a.t.amount) - Math.abs(b.t.amount));
  const clusters: Member[][] = [];
  for (const m of sorted) {
    const cur = clusters[clusters.length - 1];
    const a = Math.abs(m.t.amount);
    if (cur) {
      const base = Math.abs(cur[Math.floor(cur.length / 2)].t.amount);
      if (Math.abs(a - base) / base <= 0.15) {
        cur.push(m);
        continue;
      }
    }
    clusters.push([m]);
  }
  return clusters.map(c => c.sort((a, b) => a.t.date.localeCompare(b.t.date)));
}

/**
 * Days after the expected date before an unpaid period counts as late.
 * Paychecks are punctual (2 days); bills get 5 (plan §3.4: ±5 days).
 */
export function graceDays(s: Schedule, direction: SeriesDirection = "outflow"): number {
  if (direction === "inflow") return 2;
  return s.kind === "interval" && s.intervalDays === 7 ? 2 : 5;
}

/**
 * Lay the schedule over [first, today] (+ the next upcoming period) and match
 * members to periods. Unmatched past-grace periods are `skipped` when a later
 * period was paid (the series carried on) and `late` otherwise.
 */
export function buildOccurrences(
  schedule: Schedule,
  members: { id: string; date: ISODate; amount: number }[],
  model: AmountModel,
  today: ISODate,
  direction: SeriesDirection = "outflow",
): { occurrences: Occurrence[]; active: boolean; next: ScheduledDate | null } {
  const tol = matchTolerance(schedule);
  const grace = graceDays(schedule, direction);
  const first = members[0].date;
  const upcoming = nextScheduled(schedule, addDays(today, 1));
  const slots = scheduleDates(schedule, addDays(first, -tol), upcoming.expected);
  const used = new Set<string>();
  const occ: Occurrence[] = slots.map((sd, i) => {
    const windowStart = addDays(sd.expected, -tol);
    const nextSlot = slots[i + 1];
    const windowEnd = nextSlot ? addDays(nextSlot.expected, -tol - 1) : addDays(sd.expected, tol);
    let best: { id: string; date: ISODate; amount: number } | null = null;
    for (const m of members) {
      if (used.has(m.id) || m.date < windowStart || m.date > windowEnd || m.date > today) continue;
      if (!amountMatches(model, m.amount)) continue;
      if (!best || Math.abs(diffDays(m.date, sd.expected)) < Math.abs(diffDays(best.date, sd.expected))) best = m;
    }
    if (best) {
      used.add(best.id);
      const late = diffDays(best.date, sd.expected) - grace;
      return {
        period: sd.period,
        label: sd.label,
        expectedDate: sd.expected,
        expectedAmount: model.expected,
        status: "paid",
        transactionId: best.id,
        actualDate: best.date,
        actualAmount: Math.abs(best.amount),
        daysLate: late > 0 ? late : 0,
      };
    }
    return {
      period: sd.period,
      label: sd.label,
      expectedDate: sd.expected,
      expectedAmount: model.expected,
      status: "expected",
      transactionId: null,
      actualDate: null,
      actualAmount: null,
      daysLate: null,
    };
  });

  // Resolve unpaid past periods, newest first, so we know whether a later one was paid.
  let laterPaid = false;
  for (let i = occ.length - 1; i >= 0; i--) {
    const o = occ[i];
    if (o.status === "paid") {
      laterPaid = true;
      continue;
    }
    if (diffDays(today, o.expectedDate) > grace) {
      o.status = laterPaid ? "skipped" : "late";
      if (!laterPaid) o.daysLate = diffDays(today, o.expectedDate) - grace;
    }
  }
  // Count trailing missed periods (still-in-grace periods are not misses yet).
  const resolved = occ.filter(o => o.expectedDate <= today && o.status !== "expected").reverse();
  const firstNonLate = resolved.findIndex(o => o.status !== "late");
  const missedInARow = firstNonLate === -1 ? resolved.length : firstNonLate;
  const active = missedInARow < 2;
  // Drop the upcoming slot for an ended series; otherwise next = first unpaid future slot.
  const result = active ? occ : occ.filter(o => o.expectedDate <= today);
  const nextOcc = active ? result.find(o => o.expectedDate > today && o.status === "expected") ?? null : null;
  const next = nextOcc ? slots.find(s => s.period === nextOcc.period) ?? null : null;
  return { occurrences: result, active, next };
}

function confidenceFor(count: number, fitScore: number): number {
  return Math.round(Math.min(1, fitScore * Math.min(1, 0.55 + 0.08 * count)) * 100) / 100;
}

export function detectRecurringSeries(
  txns: ClassifierTxn[],
  accounts: ClassifierAccount[],
  opts: DetectOptions = {},
): RecurringSeries[] {
  const today = opts.today ?? todayLocal(opts.timeZone ?? DEFAULT_TIME_ZONE);
  const since = addDays(today, -(opts.lookbackDays ?? 760));
  const pool = txns.filter(t => !t.pending && t.date >= since && t.date <= today);
  const classifier = withOverrides(opts.classifier ?? createSharedClassifier(), opts.overrides);
  const classes = classifier.classifyAll(pool, { accounts });
  const accountById = new Map(accounts.map(a => [a.account_id, a] as const));

  const groups = new Map<string, Member[]>();
  for (const t of pool) {
    const c = classes.get(t.transaction_id);
    if (!c || !isRecurringEligible(t, c, opts, accountById.get(t.account_id))) continue;
    const direction: SeriesDirection = t.amount > 0 ? "outflow" : "inflow";
    const key = `${direction}|${merchantKey(t.name, t.merchant_name)}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push({ t, c, key, direction });
  }

  const series: RecurringSeries[] = [];
  const occOverrides = new Map((opts.occurrenceOverrides ?? []).map(o => [`${o.seriesKey}#${o.period}`, o.status] as const));

  for (const [key, all] of groups) {
    all.sort((a, b) => a.t.date.localeCompare(b.t.date));
    const found: { members: Member[]; key: string; schedule: Schedule; score: number; single: boolean }[] = [];

    const tryFit = (members: Member[], k: string): boolean => {
      const type = majority(members.map(m => m.c.txnType));
      const text = `${members[0].t.name ?? ""} ${members[0].t.merchant_name ?? ""}`;
      const subtype = refineSubtype(type, members.map(m => m.c.subtype).find(Boolean) ?? null, text);
      const dates = members.map(m => m.t.date);
      const defaultShift: ShiftPolicy = members[0].direction === "inflow" ? "before" : "after";
      const fit = fitSchedule(dates, { allowIrs: type === "obligation_tax", defaultShift });
      if (fit) {
        found.push({ members, key: k, schedule: fit.schedule, score: fit.matched * fit.coverage, single: false });
        return true;
      }
      // One-off evidence that still implies a schedule.
      const lastM = members[members.length - 1];
      if (diffDays(today, lastM.t.date) > 400) return false;
      const taxSub = type === "obligation_tax" ? subtype : null;
      if (taxSub === "irs_estimated" && nearestIrsEstimatedDue(lastM.t.date).distance <= 10) {
        found.push({ members: [lastM], key: k, schedule: { cadence: "quarterly", kind: "irs-estimated", shift: "after" }, score: 0.5, single: true });
        return true;
      }
      if (members.length <= 2 && (YEARLY_HINT_RE.test(text) || taxSub === "property" || taxSub === "irs_federal")) {
        const p = parseDate(lastM.t.date);
        const schedule: Schedule =
          taxSub === "irs_federal" && p.m === 4
            ? { cadence: "yearly", kind: "day-of-month", anchorDay: 15, monthStep: 12, anchorMonth: 4, shift: "after" }
            : yearlyFromSingle(lastM.t.date, defaultShift);
        found.push({ members: [lastM], key: k, schedule, score: 0.5, single: true });
        return true;
      }
      return false;
    };

    // Wildly mixed amounts (a subscription among one-off purchases at the same
    // merchant) are split into amount clusters before fitting.
    const cv = amountModel(all.map(m => m.t.amount)).cv;
    if ((cv > 0.6 || !tryFit(all, key)) && all.length >= 2) {
      for (const cl of amountClusters(all)) {
          const med = Math.round(Math.abs(cl[Math.floor(cl.length / 2)].t.amount));
        tryFit(cl, `${key}|~${med}`);
      }
    }

    for (const f of found) {
      const members = f.members;
      const type = majority(members.map(m => m.c.txnType));
      const subtypes = members.map(m => m.c.subtype).filter(Boolean) as string[];
      const text = `${members[0].t.name ?? ""} ${members[0].t.merchant_name ?? ""}`;
      const rawSubtype = subtypes.length ? majority(subtypes) : null;
      const kind = kindFor(type, rawSubtype, text);
      const refined = refineSubtype(type, rawSubtype, text);
      const finalSubtype = f.schedule.kind === "irs-estimated" ? "irs_estimated" : refined;
      const model = amountModel(members.map(m => m.t.amount));
      const { occurrences, active, next } = buildOccurrences(
        f.schedule,
        members.map(m => ({ id: m.t.transaction_id, date: m.t.date, amount: m.t.amount })),
        model,
        today,
        members[0].direction,
      );
      for (const o of occurrences) {
        const ov = occOverrides.get(`${f.key}#${o.period}`);
        if (ov) {
          o.status = ov;
          o.userSet = true;
          if (ov === "skipped") o.daysLate = null;
        }
      }
      const counterpart = members.map(m => m.c.counterpartAccountId).filter(Boolean) as string[];
      const s: RecurringSeries = {
        seriesKey: f.key,
        merchantKey: f.key.split("|")[1],
        displayName: displayName(members[members.length - 1].t.merchant_name || members[members.length - 1].t.name),
        direction: members[0].direction,
        txnType: type,
        subtype: finalSubtype ?? null,
        kind,
        category: members.map(m => m.c.category).find(Boolean) ?? null,
        cadence: f.schedule.cadence,
        schedule: f.schedule,
        accountId: majority(members.map(m => m.t.account_id)),
        counterpartAccountId: counterpart.length ? majority(counterpart) : null,
        amount: model,
        nextExpectedDate: next?.expected ?? null,
        nextExpectedAmount: next ? model.expected : null,
        firstSeen: members[0].t.date,
        lastSeen: members[members.length - 1].t.date,
        occurrenceCount: members.length,
        active,
        mustPay: MUST_PAY_KINDS.has(kind),
        confidence: f.single ? 0.4 : confidenceFor(members.length, f.score),
        transactionIds: members.map(m => m.t.transaction_id),
        occurrences,
        reason: f.single
          ? `One ${kind} payment on a known ${f.schedule.kind === "irs-estimated" ? "IRS estimated-tax" : "yearly"} schedule`
          : `${members.length} payments on a ${f.schedule.cadence} schedule`,
      };
      applyLoanDetails(s, opts.loanDetails ?? [], today);
      series.push(s);
    }
  }

  return series.sort((a, b) => (a.nextExpectedDate ?? "9999").localeCompare(b.nextExpectedDate ?? "9999") || a.seriesKey.localeCompare(b.seriesKey));
}

/**
 * Plaid /liabilities knows the servicer's real due date and amount for
 * mortgages / student loans. Prefer it for the next prediction.
 */
export function applyLoanDetails(s: RecurringSeries, loans: LoanDetail[], today: ISODate): void {
  if (s.kind !== "loan" || !loans.length) return;
  let loan = s.counterpartAccountId ? loans.find(l => l.account_id === s.counterpartAccountId) : undefined;
  if (!loan && s.subtype) {
    const sameKind = loans.filter(l => l.kind === s.subtype);
    if (sameKind.length === 1) loan = sameKind[0];
  }
  if (!loan) return;
  s.counterpartAccountId = loan.account_id;
  const amt = loan.next_monthly_payment ?? loan.minimum_payment_amount ?? null;
  const due = loan.next_payment_due_date && loan.next_payment_due_date >= today ? loan.next_payment_due_date : null;
  if (due) s.nextExpectedDate = due;
  if (amt != null && amt > 0) s.nextExpectedAmount = Math.round(amt * 100) / 100;
  const upcoming = s.occurrences.find(o => o.status === "expected" && o.expectedDate > today);
  if (upcoming) {
    if (due) upcoming.expectedDate = due;
    if (amt != null && amt > 0) upcoming.expectedAmount = s.nextExpectedAmount!;
  }
  s.reason += " · due date from your loan servicer";
}
