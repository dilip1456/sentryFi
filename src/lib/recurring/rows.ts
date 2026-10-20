/**
 * Mapping between detected series and the `recurring_streams` /
 * `stream_occurrences` tables (supabase/migrations/20261020130000_*). Pure:
 * callers (client hook or edge function) do the actual upsert.
 *
 * Re-detection must never clobber user decisions, so `mergeStreamRow` keeps
 * the stored status (suggested / confirmed / dismissed), a user-chosen
 * must-pay flag and the obligation link, and `occurrenceOverridesFromRows`
 * feeds user-set occurrence statuses back into detection.
 */
import type { OccurrenceOverride, RecurringSeries } from "./detect";
import type { ISODate } from "./dates";
import { toSharedTxnType } from "./classifier";

export const DETECTOR_VERSION = 1;

export type StreamStatus = "suggested" | "confirmed" | "dismissed";

export interface RecurringStreamRow {
  id?: string;
  user_id: string;
  series_key: string;
  merchant_key: string;
  display_name: string;
  direction: string;
  txn_type: string;
  subtype: string | null;
  kind: string;
  category: string | null;
  cadence: string;
  schedule: Record<string, unknown>;
  day_anchor: number | null;
  shift_policy: string;
  account_id: string | null;
  counterpart_account_id: string | null;
  amount_median: number;
  amount_min: number;
  amount_max: number;
  amount_cv: number;
  is_fixed: boolean;
  price_changed: boolean;
  next_expected_date: ISODate | null;
  next_expected_amount: number | null;
  first_seen: ISODate;
  last_seen: ISODate;
  occurrence_count: number;
  active: boolean;
  status: StreamStatus;
  must_pay: boolean;
  must_pay_user_set: boolean;
  confidence: number;
  reason: string;
  obligation_id?: string | null;
  detector_version: number;
}

export interface StreamOccurrenceRow {
  stream_id: string;
  user_id: string;
  period: string;
  label: string | null;
  expected_date: ISODate;
  expected_amount: number;
  status: string;
  transaction_id: string | null;
  actual_date: ISODate | null;
  actual_amount: number | null;
  days_late: number | null;
  user_set: boolean;
}

function dayAnchor(s: RecurringSeries): number | null {
  const sc = s.schedule;
  if (sc.kind === "day-of-month") return sc.anchorDay;
  if (sc.kind === "semimonthly") return sc.anchorDays[0];
  return null;
}

export function toStreamRow(s: RecurringSeries, userId: string): RecurringStreamRow {
  return {
    user_id: userId,
    series_key: s.seriesKey,
    merchant_key: s.merchantKey,
    display_name: s.displayName,
    direction: s.direction,
    // Stored in the shared / database spelling (income_salary), like txn_overrides.
    txn_type: toSharedTxnType(s.txnType),
    subtype: s.subtype,
    kind: s.kind,
    category: s.category,
    cadence: s.cadence,
    schedule: { ...s.schedule },
    day_anchor: dayAnchor(s),
    shift_policy: s.schedule.shift,
    account_id: s.accountId,
    counterpart_account_id: s.counterpartAccountId,
    amount_median: s.amount.median,
    amount_min: s.amount.min,
    amount_max: s.amount.max,
    amount_cv: s.amount.cv,
    is_fixed: s.amount.isFixed,
    price_changed: s.amount.priceChanged,
    next_expected_date: s.nextExpectedDate,
    next_expected_amount: s.nextExpectedAmount,
    first_seen: s.firstSeen,
    last_seen: s.lastSeen,
    occurrence_count: s.occurrenceCount,
    active: s.active,
    status: "suggested",
    must_pay: s.mustPay,
    must_pay_user_set: false,
    confidence: s.confidence,
    reason: s.reason,
    detector_version: DETECTOR_VERSION,
  };
}

/** Combine a freshly detected row with what is stored, preserving user choices. */
export function mergeStreamRow(detected: RecurringStreamRow, stored?: Partial<RecurringStreamRow> | null): RecurringStreamRow {
  if (!stored) return detected;
  return {
    ...detected,
    id: stored.id ?? detected.id,
    status: (stored.status as StreamStatus) ?? detected.status,
    must_pay: stored.must_pay_user_set ? !!stored.must_pay : detected.must_pay,
    must_pay_user_set: !!stored.must_pay_user_set,
    obligation_id: stored.obligation_id ?? detected.obligation_id ?? null,
  };
}

export function toOccurrenceRows(s: RecurringSeries, streamId: string, userId: string): StreamOccurrenceRow[] {
  return s.occurrences.map(o => ({
    stream_id: streamId,
    user_id: userId,
    period: o.period,
    label: o.label ?? null,
    expected_date: o.expectedDate,
    expected_amount: o.expectedAmount,
    status: o.status,
    transaction_id: o.transactionId,
    actual_date: o.actualDate,
    actual_amount: o.actualAmount,
    days_late: o.daysLate,
    user_set: !!o.userSet,
  }));
}

/** User-set occurrence rows → overrides for the next detection run. */
export function occurrenceOverridesFromRows(
  rows: Pick<StreamOccurrenceRow, "stream_id" | "period" | "status" | "user_set">[],
  streams: Pick<RecurringStreamRow, "id" | "series_key">[],
): OccurrenceOverride[] {
  const keyById = new Map(streams.filter(s => s.id).map(s => [s.id!, s.series_key] as const));
  const out: OccurrenceOverride[] = [];
  for (const r of rows) {
    if (!r.user_set || (r.status !== "paid" && r.status !== "skipped")) continue;
    const seriesKey = keyById.get(r.stream_id);
    if (seriesKey) out.push({ seriesKey, period: r.period, status: r.status });
  }
  return out;
}
