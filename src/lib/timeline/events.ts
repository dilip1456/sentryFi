import type { Classification, ClassifierTxn, TxnType } from "@/lib/classify";
import { categoryForType, isInternalType, statusForTxn } from "./categories";
import type { TimelineEvent } from "./types";

/**
 * Client-side mirror of the view's transaction branch: classified
 * transactions → timeline events. Used for demo mode (no Supabase) and to
 * keep the SQL and TS semantics aligned in tests.
 */
export function eventsFromTransactions(
  txns: ClassifierTxn[],
  classes: Map<string, Classification>,
  streamByTxn?: Map<string, string>,
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const t of txns) {
    const type: TxnType = classes.get(t.id)?.type ?? (Number(t.amount) < 0 ? "refund" : "spend");
    const pid = t.transaction_id ?? t.id;
    out.push({
      id: `txn:${pid}`,
      source: "transaction",
      source_id: pid,
      occurred_on: t.date,
      occurred_at: `${t.date}T12:00:00.000Z`,
      category: categoryForType(type),
      txn_type: type,
      is_internal: isInternalType(type),
      title: (t.merchant_name && t.merchant_name.trim()) || t.name || "Transaction",
      subtitle: t.name,
      amount: -Number(t.amount),
      account_id: t.account_id,
      status: statusForTxn(type, !!t.pending),
      stream_id: streamByTxn?.get(pid) ?? null,
      pending: !!t.pending,
      meta: { type_source: classes.get(t.id)?.source ?? "fallback", reason: classes.get(t.id)?.reason ?? null },
    });
  }
  return out;
}

/** Normalise a timeline_events / timeline_page row from PostgREST. */
export function eventFromRow(r: Record<string, unknown>): TimelineEvent {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: String(r.id),
    source: r.source as TimelineEvent["source"],
    source_id: String(r.source_id ?? ""),
    occurred_on: String(r.occurred_on),
    occurred_at: new Date(String(r.occurred_at)).toISOString(),
    category: r.category as TimelineEvent["category"],
    txn_type: (r.txn_type as TxnType | null) ?? null,
    is_internal: !!r.is_internal,
    title: String(r.title ?? ""),
    subtitle: (r.subtitle as string | null) ?? null,
    amount: num(r.amount),
    account_id: (r.account_id as string | null) ?? null,
    status: r.status as TimelineEvent["status"],
    stream_id: (r.stream_id as string | null) ?? null,
    pending: !!r.pending,
    meta: (r.meta as Record<string, unknown>) ?? {},
  };
}
