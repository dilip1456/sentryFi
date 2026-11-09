/**
 * Live data → rundown inputs (pure). The live hook loads the same sources as
 * Upcoming (stored recurring_streams merged with detection, obligations,
 * card statements, tax milestones) and runs buildUpcoming over
 * [today − LOOKBACK_DAYS, today + 14]; these helpers pick the eligible
 * streams and turn the projected events into PlannedItems.
 */
import type { TimelineEvent } from "./types";
import type { UpcomingStream } from "./upcoming";
import type { PlannedItem, RundownAccount, RundownKind, RundownTxn } from "./rundown";

export const HIGH_CONFIDENCE = 0.8;

/**
 * Streams the rundown trusts: confirmed by the user, or detected with high
 * confidence. Dismissed / inactive never; Picture review decision rows
 * (source='picture', series_key 'picture:…') are decisions, not schedules.
 */
export function eligibleStreams<T extends UpcomingStream & { confidence?: number | null; source?: string | null; user_amount?: number | null }>(streams: T[]): T[] {
  return streams
    .filter(s => s.status !== "dismissed" && s.active !== false)
    .filter(s => s.source !== "picture" && !String(s.series_key).startsWith("picture:"))
    .filter(s => s.status === "confirmed" || (s.confidence ?? 0) >= HIGH_CONFIDENCE)
    // respect a user-edited amount ("this is $X") over the detector's median
    .map(s => (s.user_amount != null && s.user_amount >= 0 ? { ...s, next_expected_amount: s.user_amount, amount_median: s.user_amount, is_fixed: true } : s));
}

const UTIL = /\b(electric|power|energy|gas|water|sewer|internet|fiber|cable|comcast|xfinity|verizon|at&t|t-mobile|tmobile|phone|mobile|wireless|utility|utilities)\b/i;
const INS = /\b(insurance|geico|state farm|progressive|allstate|life|lemonade|liberty mutual|usaa)\b/i;

export function kindOf(e: TimelineEvent): RundownKind | "spending" {
  const k = String(e.meta?.kind ?? "");
  const t = e.txn_type ?? "";
  if (k === "card_statement" || k === "card_payment" || t === "credit_card_payment") return "card";
  if (k === "transfer" || t === "transfer_internal") return "transfer";
  if (k === "savings" || t === "savings_contribution") return "savings";
  if (k === "loan" || t === "obligation_loan") return "loan";
  if (k === "tax" || t === "obligation_tax" || e.source === "tax_milestone" || k === "estimated_payment" || k === "tax_milestone") return "tax";
  if ((e.amount ?? 0) > 0 && (e.category === "income" || /income|salary|interest|refund/.test(k + t))) return "income";
  if (k === "subscription") return "subscription";
  if (k === "bill" || t === "obligation_bill" || e.category === "bills") return UTIL.test(e.title) ? "utility" : INS.test(e.title) ? "insurance" : "bill";
  return "spending"; // never projected
}

export interface OccurrenceRow { stream_id: string; period: string; expected_date: string | null; expected_amount: number | null; status: string; user_set: boolean }

export function plannedFromEvents(events: TimelineEvent[], opts: {
  streams: UpcomingStream[];
  occurrences?: OccurrenceRow[];
}): PlannedItem[] {
  // card statement → the account the card payment usually comes from
  const payFrom = new Map<string, string>();
  for (const s of opts.streams) if (s.kind === "card_payment" && s.counterpart_account_id && s.account_id) payFrom.set(s.counterpart_account_id, s.account_id);
  const occ = new Map<string, OccurrenceRow>();
  for (const o of opts.occurrences ?? []) if (o.user_set) occ.set(`${o.stream_id}|${o.period}`, o);
  const confirmed = new Map(opts.streams.map(s => [s.series_key, s.status === "confirmed"] as const));
  const out: PlannedItem[] = [];
  for (const e of events) {
    if (e.amount == null) continue;
    const kind = kindOf(e);
    if (kind === "spending") continue;
    const isStatement = e.meta?.kind === "card_statement";
    const nominal = typeof e.meta?.nominal_date === "string" ? e.meta.nominal_date : e.occurred_on;
    const o = e.stream_id ? occ.get(`${e.stream_id}|${nominal}`) : undefined;
    const seriesKey = typeof e.meta?.series_key === "string" ? e.meta.series_key : null;
    out.push({
      id: e.id,
      title: e.title,
      kind,
      amount: e.amount,
      date: e.occurred_on,
      accountId: isStatement ? payFrom.get(e.account_id ?? "") ?? null : e.account_id,
      toAccountId: isStatement ? null : (e.meta?.counterpart_account_id as string | null | undefined) ?? null,
      source: e.source === "tax_milestone" || isStatement || (seriesKey && confirmed.get(seriesKey)) ? "confirmed" : "detected",
      estimated: !!e.estimated,
      repeats: e.repeats ?? null,
      shift: kind === "card" ? "none" : "next_business",
      status: o?.status === "paid" ? "paid" : o?.status === "skipped" ? "skipped" : "expected",
      override: o && o.status === "expected" && (o.expected_date !== nominal || o.expected_amount != null)
        ? { date: o.expected_date ?? undefined, amount: o.expected_amount ?? undefined } : null,
      matchName: e.title,
      streamId: e.stream_id,
      period: nominal,
    });
  }
  return out;
}

/** Plaid rows → signed transactions (Plaid: + = money out). */
export function txnsFromPlaid(rows: { transaction_id: string; account_id: string | null; amount: number | string; date: string; name?: string | null; merchant_name?: string | null; pending?: boolean | null }[]): RundownTxn[] {
  return rows.map(r => ({ id: r.transaction_id, accountId: r.account_id, amount: -Number(r.amount), date: r.date, name: r.merchant_name ?? r.name ?? null, pending: !!r.pending }));
}

export function accountsFromPlaid(rows: Record<string, unknown>[]): RundownAccount[] {
  return rows.map(a => {
    const avail = a.available_balance == null ? null : Number(a.available_balance);
    const cur = a.current_balance == null ? null : Number(a.current_balance);
    return { id: String(a.account_id), name: (a.name as string) ?? null, mask: (a.mask as string) ?? null, type: (a.type as string) ?? null, subtype: (a.subtype as string) ?? null, balance: avail ?? cur };
  });
}
