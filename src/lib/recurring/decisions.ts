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
    },
  };
}

/** Rows the timeline/detector should ignore (Picture decisions share the table). */
export const isPictureDecisionRow = (r: { source?: unknown; series_key?: unknown }) =>
  r.source === PICTURE_SOURCE || String(r.series_key ?? "").startsWith(PICTURE_KEY_PREFIX);
