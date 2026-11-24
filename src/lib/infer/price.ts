/**
 * Price-increase findings (INFERENCES.md §3.9): a recurring bill whose latest
 * charge moved up off its steady earlier price ("Armstrong went up $50").
 * The amount model (recurring/amount.ts) decides that the price changed;
 * this turns it into a `price_increase` Finding on the stream. Taking the
 * new price (the Picture's "Use new price") stores it as the pattern's
 * amount, which settles the finding. Pure, no I/O.
 *
 * Push / email come from send-alerts (_shared/price-change.ts), which uses
 * the same thresholds on freshly synced charges.
 */
import type { ClassifierTxn } from "../recurring/classifier";
import type { RecurringSeries } from "../recurring/detect";
import { isMaterialPriceChange } from "../recurring/amount";
import { isSensitiveSeries } from "./autopay";
import { INFER_DETECTOR_VERSION, type EvidenceItem, type Finding } from "./types";

/** Series kinds a price increase is reported for. */
export const PRICE_INCREASE_KINDS = new Set(["bill", "subscription", "loan"]);

export interface PriceIncreasePayload extends Record<string, unknown> {
  displayName: string;
  /** Typical amount before the latest charge. */
  from: number;
  /** The latest charge. */
  to: number;
  delta: number;
  date: string;
  cadence: string;
}

/** A `price_increase` finding for this series, or null (no rise / not a bill / private payee). */
export function priceIncreaseFinding(
  s: RecurringSeries,
  txnsById?: Map<string, ClassifierTxn>,
  opts: { acceptedAmount?: number | null } = {},
): Finding<PriceIncreasePayload> | null {
  if (s.direction !== "outflow" || !PRICE_INCREASE_KINDS.has(s.kind)) return null;
  const a = s.amount;
  if (!a.priceChanged || a.prevTypical == null || !(a.priceDelta > 0) || !isMaterialPriceChange(a.prevTypical, a.priceDelta)) return null;
  // The person already took the new price as the amount to expect.
  if (opts.acceptedAmount != null && Math.abs(opts.acceptedAmount - a.latest) < 0.01) return null;
  if (txnsById && isSensitiveSeries(s, txnsById)) return null;
  const last = s.occurrences.filter(o => o.transactionId && o.actualDate).slice(-1)[0];
  const evidence: EvidenceItem[] = last
    ? [{ transactionId: last.transactionId!, date: last.actualDate!, amount: last.actualAmount ?? a.latest, accountId: s.accountId }]
    : [];
  return {
    kind: "price_increase",
    subjectType: "stream",
    subjectRef: s.seriesKey,
    payload: { displayName: s.displayName, from: a.prevTypical, to: a.latest, delta: a.priceDelta, date: s.lastSeen, cadence: s.cadence },
    // A rise of more than max(15%, $10) off the earlier price is plain arithmetic.
    confidence: 0.9,
    evidence,
    detectorVersion: INFER_DETECTOR_VERSION,
  };
}

export function priceIncreaseFindings(
  series: RecurringSeries[],
  txnsById?: Map<string, ClassifierTxn>,
  acceptedAmount?: (s: RecurringSeries) => number | null | undefined,
): Finding<PriceIncreasePayload>[] {
  const out: Finding<PriceIncreasePayload>[] = [];
  for (const s of series) {
    const f = priceIncreaseFinding(s, txnsById, { acceptedAmount: acceptedAmount?.(s) });
    if (f) out.push(f);
  }
  return out;
}
