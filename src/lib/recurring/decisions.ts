/**
 * recurring_streams rows (source = 'picture') ↔ RecurringDecision.
 * One row per decision; "restore" deletes the row. Pure, no I/O.
 *
 * Storage shape of the person's own values (no extra columns; keyed by
 * series_key = 'picture:<review key>'):
 *   user_amount   numeric  decision.expectedAmount (the expected amount per
 *                          occurrence; the planning amount and alert baseline)
 *   user_cadence  text     decision.cadence
 *   schedule      jsonb    { "user_name": "<the person's name>" } when renamed,
 *                          else {} (picture rows never carry a real schedule)
 *   display_name  text     user_name when renamed, else the detected label
 * Plaid transactions are never touched.
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
    display_name: d.name?.trim() || sn.label || payee,
    schedule: d.name?.trim() ? { user_name: d.name.trim(), detected_name: sn.label ?? null } : {},
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
    matched_transaction_ids: sn.transactionIds ?? [],
    user_cadence: d.cadence ?? null,
    user_amount: d.expectedAmount ?? null,
    user_group: d.group ?? null,
    user_cover_account_id: d.coverAccountId ?? null,
    decided_at: d.decidedAt ?? new Date().toISOString(),
  };
}

const scheduleOf = (r: DecisionRow): Record<string, unknown> => (r.schedule && typeof r.schedule === "object" ? (r.schedule as Record<string, unknown>) : {});
/** The person's own name for a stored pattern (picture rows: schedule.user_name), else null. */
export function userNameOf(r: DecisionRow): string | null {
  const n = scheduleOf(r).user_name;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}
const detectedNameOf = (r: DecisionRow): string | undefined => {
  const n = scheduleOf(r).detected_name;
  return typeof n === "string" && n ? n : undefined;
};

export function rowToDecision(r: DecisionRow): RecurringDecision | null {
  const sk = String(r.series_key ?? "");
  if (r.source !== PICTURE_SOURCE || !sk.startsWith(PICTURE_KEY_PREFIX)) return null;
  const status = STATUSES.includes(r.status as ReviewStatus) ? (r.status as ReviewStatus) : null;
  if (!status) return null;
  return {
    key: sk.slice(PICTURE_KEY_PREFIX.length),
    status,
    cadence: asCadence(r.user_cadence),
    expectedAmount: num(r.user_amount),
    name: userNameOf(r),
    group: asGroup(r.user_group),
    coverAccountId: (r.user_cover_account_id as string) ?? null,
    decidedAt: (r.decided_at as string) ?? null,
    snapshot: {
      label: (userNameOf(r) ? detectedNameOf(r) : (r.display_name as string)) ?? undefined,
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
    return list
      .filter((d): d is RecurringDecision & { amount?: number | null } =>
        !!d && typeof d === "object" && typeof d.key === "string" && STATUSES.includes(d.status as ReviewStatus))
      // Stored before the field was named expectedAmount.
      .map(({ amount, ...d }) => (d.expectedAmount === undefined && amount != null ? { ...d, expectedAmount: amount } : d));
  } catch { return []; }
}

// ── The person's values on Timeline streams ───────────────────────────────

/** The baseline a price-change alert compares against: the person's expected amount, else the detected typical amount. */
export function expectedBaseline(x: { expectedAmount?: number | null; user_amount?: number | null; detectedAmount?: number | null; amount_median?: number | null }): number | null {
  const user = x.expectedAmount ?? x.user_amount;
  if (user != null && Number.isFinite(Number(user)) && Number(user) >= 0) return Number(user);
  const det = x.detectedAmount ?? x.amount_median;
  return det != null && Number.isFinite(Number(det)) ? Number(det) : null;
}

type StreamLike = { series_key: string; source?: string | null; merchant_key?: string | null; direction?: string | null; display_name: string; user_amount?: number | null; matched_transaction_ids?: string[] | null; status?: string | null };

/**
 * Carry the person's name and expected amount from Picture decision rows onto
 * the matching detector streams (same direction and payee key, or 2+ shared
 * transactions), so the Timeline, rundown and anything reading streams show
 * them. Streams already carrying their own user_amount keep it.
 */
export function applyPatternOverrides<T extends StreamLike>(streams: readonly T[], rows: readonly DecisionRow[]): T[] {
  const picks = rows.filter(r => isPictureDecisionRow(r) && r.status !== "dismissed" && (userNameOf(r) || num(r.user_amount) != null));
  if (!picks.length) return [...streams];
  return streams.map(s => {
    if (isPictureDecisionRow(s)) return s;
    const ids = new Set(s.matched_transaction_ids ?? []);
    const p = picks.find(r => (r.direction ?? "outflow") === (s.direction ?? "outflow")
      && ((r.merchant_key && r.merchant_key === s.merchant_key)
        || (ids.size > 0 && ((r.matched_transaction_ids as string[] | undefined) ?? []).filter(id => ids.has(id)).length >= 2)));
    if (!p) return s;
    const name = userNameOf(p);
    const amt = num(p.user_amount);
    return { ...s, display_name: name ?? s.display_name, user_amount: s.user_amount ?? amt ?? null };
  });
}
