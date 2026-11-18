/**
 * recurring_streams rows (source = 'picture') ↔ RecurringDecision.
 * One row per decision; "restore" deletes the row. Pure, no I/O.
 */
import type { SeriesKind } from "./detect";
import { CADENCES, type Cadence } from "./schedule";
import { REVIEW_GROUPS, type RecurringDecision, type ReviewGroup, type ReviewStatus } from "./review";

export const PICTURE_SOURCE = "picture";
export const PICTURE_KEY_PREFIX = "picture:";

const TXN_TYPE: Record<SeriesKind, string> = {
  salary: "income_salary", income: "income_other", interest: "income_interest", bill: "obligation_bill",
  subscription: "obligation_bill", loan: "obligation_loan", tax: "obligation_tax", savings: "savings_contribution",
  card_payment: "credit_card_payment", transfer: "transfer_out",
};
const STATUSES: ReviewStatus[] = ["suggested", "confirmed", "dismissed"];
const asCadence = (v: unknown): Cadence | null => (CADENCES.includes(v as Cadence) ? (v as Cadence) : null);
const asGroup = (v: unknown): ReviewGroup | null => (REVIEW_GROUPS.includes(v as ReviewGroup) ? (v as ReviewGroup) : null);
const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export type DecisionRow = Record<string, unknown>;

export function decisionToRow(userId: string, d: RecurringDecision): DecisionRow {
  const sn = d.snapshot ?? {};
  const kind = (sn.kind ?? "bill") as SeriesKind;
  const direction = sn.direction ?? (kind === "salary" || kind === "income" || kind === "interest" ? "inflow" : "outflow");
  const payee = d.key.split("|")[1] ?? d.key;
  return {
    user_id: userId,
    series_key: PICTURE_KEY_PREFIX + d.key,
    source: PICTURE_SOURCE,
    merchant_key: payee,
    display_name: sn.label ?? payee,
    direction,
    txn_type: kind === "transfer" && direction === "inflow" ? "transfer_in" : TXN_TYPE[kind] ?? "obligation_bill",
    kind,
    cadence: asCadence(sn.cadence) ?? "monthly",
    status: d.status,
    review_group: asGroup(sn.group),
    pattern_label: sn.pattern ?? null,
    account_id: sn.accountId ?? null,
    amount_median: num(sn.amount),
    last_seen: sn.lastSeen ?? null,
    next_expected_date: sn.nextDue ?? null,
    // Amount model (stored so send-alerts and the timeline read the same facts).
    // The person's amount is what they expect next.
    is_fixed: sn.isFixed ?? false,
    price_changed: !!sn.priceChanged,
    next_expected_amount: d.amount != null && d.amount >= 0 ? d.amount : num(sn.nextAmount) ?? num(sn.amount),
    matched_transaction_ids: sn.transactionIds ?? [],
    user_cadence: d.cadence ?? null,
    user_amount: d.amount ?? null,
    user_group: d.group ?? null,
    user_cover_account_id: d.coverAccountId ?? null,
    decided_at: d.decidedAt ?? new Date().toISOString(),
  };
}

export function rowToDecision(r: DecisionRow): RecurringDecision | null {
  const sk = String(r.series_key ?? "");
  if (r.source !== PICTURE_SOURCE || !sk.startsWith(PICTURE_KEY_PREFIX)) return null;
  const status = STATUSES.includes(r.status as ReviewStatus) ? (r.status as ReviewStatus) : null;
  if (!status) return null;
  return {
    key: sk.slice(PICTURE_KEY_PREFIX.length),
    status,
    cadence: asCadence(r.user_cadence),
    amount: num(r.user_amount),
    group: asGroup(r.user_group),
    coverAccountId: (r.user_cover_account_id as string) ?? null,
    decidedAt: (r.decided_at as string) ?? null,
    snapshot: {
      label: (r.display_name as string) ?? undefined,
      group: asGroup(r.review_group) ?? undefined,
      kind: (r.kind as SeriesKind) ?? undefined,
      cadence: asCadence(r.cadence) ?? undefined,
      amount: num(r.amount_median) ?? undefined,
      lastSeen: (r.last_seen as string) ?? undefined,
      nextDue: (r.next_expected_date as string) ?? undefined,
      transactionIds: Array.isArray(r.matched_transaction_ids) ? (r.matched_transaction_ids as string[]) : [],
      pattern: (r.pattern_label as string) ?? undefined,
      accountId: (r.account_id as string) ?? undefined,
      direction: r.direction === "inflow" ? "inflow" : "outflow",
      isFixed: typeof r.is_fixed === "boolean" ? r.is_fixed : undefined,
      priceChanged: typeof r.price_changed === "boolean" ? r.price_changed : undefined,
      nextAmount: num(r.next_expected_amount),
    },
  };
}

/** Rows the timeline/detector should ignore (Picture decisions share the table). */
export const isPictureDecisionRow = (r: { source?: unknown; series_key?: unknown }) =>
  r.source === PICTURE_SOURCE || String(r.series_key ?? "").startsWith(PICTURE_KEY_PREFIX);

// ── Optimistic layer (useRecurringDecisions) ──────────────────────────────

/**
 * What the screen shows: stored decisions with this session's own changes on
 * top (`null` = the person restored it). The local layer wins, so a slow
 * initial load or a refetch can't bring back an item the person just acted on.
 */
export function overlayDecisions(base: readonly RecurringDecision[], local: ReadonlyMap<string, RecurringDecision | null>): RecurringDecision[] {
  const out = base.filter(d => !local.has(d.key));
  for (const d of local.values()) if (d) out.push(d);
  return out;
}

/** Items still waiting on the person ("to review"): confirmed and dismissed ones are done. */
export const pendingReview = <T extends { status: ReviewStatus }>(items: readonly T[]): T[] => items.filter(i => i.status === "suggested");

/**
 * Detected expenses still waiting on the person: the Picture's review queue.
 * Paychecks and other income are never offered as bills to confirm or
 * dismiss; they feed Salary / income directly.
 */
export const needsReview = <T extends { status: ReviewStatus; direction?: "inflow" | "outflow"; group?: string }>(i: T): boolean =>
  i.status === "suggested" && i.direction !== "inflow" && i.group !== "income";
export const expensesToReview = <T extends { status: ReviewStatus; direction?: "inflow" | "outflow"; group?: string }>(items: readonly T[]): T[] => items.filter(needsReview);

/** Detections at least this sure join the Picture without asking. */
export const AUTO_ACCEPT_CONFIDENCE = 0.75;

/**
 * Settle detections internally instead of queueing them for review: a
 * confident suggestion is treated as confirmed (it isn't stored, so a later
 * detection run can still drop it), a weak one is quietly left out. Items the
 * person decided on (confirmed / dismissed) are untouched, and paychecks
 * always count as pay.
 */
export function settleSuggestions<T extends { status: ReviewStatus; confidence: number; kind?: string; cadence?: string; direction?: "inflow" | "outflow"; transactionIds?: readonly string[] }>(items: readonly T[]): T[] {
  const out: T[] = [];
  for (const i of items) {
    if (i.status !== "suggested") out.push(i);
    else if (isConfidentDetection(i)) out.push({ ...i, status: "confirmed" as ReviewStatus });
  }
  return out;
}

/**
 * Sure enough to count without asking. Yearly / twice-a-year / quarterly
 * bills can only show 2 payments in a normal history (the review already
 * demands those 2, or one unmistakably yearly charge), so they need less.
 */
export function isConfidentDetection(i: { confidence: number; kind?: string; cadence?: string; direction?: "inflow" | "outflow"; transactionIds?: readonly string[] }): boolean {
  if (i.kind === "salary") return true;
  if (i.confidence >= AUTO_ACCEPT_CONFIDENCE) return true;
  // A steady run (3+ matched payments) whose amount wobbles a little still counts.
  if ((i.transactionIds?.length ?? 0) >= STEADY_MIN_PAYMENTS && i.confidence >= STEADY_CONFIDENCE) return true;
  const longCycle = i.cadence === "yearly" || i.cadence === "semiannual" || i.cadence === "quarterly";
  return longCycle && i.direction !== "inflow" && i.confidence >= LONG_CYCLE_CONFIDENCE;
}
export const LONG_CYCLE_CONFIDENCE = 0.5;
export const STEADY_MIN_PAYMENTS = 3;
export const STEADY_CONFIDENCE = 0.55;

/** Demo / guest decisions live in sessionStorage so they survive a reload (never sent anywhere). */
export const DEMO_DECISIONS_KEY = "sentryfi:demo-recurring-decisions";

export function parseStoredDecisions(raw: string | null | undefined): RecurringDecision[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((d): d is RecurringDecision =>
      !!d && typeof d === "object" && typeof d.key === "string" && STATUSES.includes(d.status as ReviewStatus));
  } catch { return []; }
}
