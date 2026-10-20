/**
 * What a finding's status means for the stored facts.
 *
 * - bill_autopay → recurring_streams autopay columns. A suggestion is written
 *   with autopay_source 'detected' (shown as "Detected", never counted);
 *   Confirm writes 'confirmed'. "Not right" clears it. Fields with source
 *   'user' (set by hand) are never touched.
 * - card_autopay → prefill user_settings.cardAutopayFrom[card] on Confirm,
 *   only when the user hasn't set it.
 */
import type { RecurringStreamRow, StreamAutopaySource } from "../recurring/rows";
import { round3, type InferenceRow } from "./types";

export type StreamAutopayPatch = Pick<
  RecurringStreamRow,
  "autopay" | "autopay_source" | "autopay_confidence" | "pay_method" | "pay_from_account_id" | "pay_day" | "autopay_inference_id"
>;

const CLEARED: StreamAutopayPatch = {
  autopay: "unknown",
  autopay_source: null,
  autopay_confidence: null,
  pay_method: null,
  pay_from_account_id: null,
  pay_day: null,
  autopay_inference_id: null,
};

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 31 ? v : null);

/**
 * The recurring_streams update for a bill_autopay row, or null when the stream
 * must not change (wrong kind, or the user set autopay by hand).
 */
export function streamAutopayPatch(row: InferenceRow, current?: Pick<RecurringStreamRow, "autopay_source" | "autopay_inference_id"> | null): StreamAutopayPatch | null {
  if (row.kind !== "bill_autopay") return null;
  if (current?.autopay_source === "user") return null;
  const p = row.payload ?? {};
  const facts = (source: StreamAutopaySource): StreamAutopayPatch => ({
    autopay: p.autopay === "manual" ? "manual" : "auto",
    autopay_source: source,
    autopay_confidence: round3(row.confidence),
    pay_method: p.payMethod === "bank" || p.payMethod === "card" || p.payMethod === "manual" ? p.payMethod : null,
    pay_from_account_id: str(p.payFromAccountId),
    pay_day: int(p.payDay),
    autopay_inference_id: row.id ?? null,
  });
  switch (row.status) {
    case "confirmed":
      return facts("confirmed");
    case "suggested":
      // never downgrade a confirmed fact to a suggestion
      return current?.autopay_source === "confirmed" ? null : facts("detected");
    case "rejected":
    case "expired":
      // only undo what this inference wrote
      if (current?.autopay_source === "confirmed" && current.autopay_inference_id && current.autopay_inference_id !== row.id) return null;
      return current?.autopay_source ? CLEARED : null;
  }
}

/** Counted as autopay in totals ("N of M on autopay")? Only confirmed or user-set. */
export function streamCountsAsAutopay(s: Pick<RecurringStreamRow, "autopay" | "autopay_source">): boolean {
  return s.autopay === "auto" && (s.autopay_source === "confirmed" || s.autopay_source === "user");
}

/** On Confirm of card_autopay: the cardAutopayFrom entry to add, unless the user already chose one. */
export function cardAutopayFromPatch(row: InferenceRow, current: Record<string, string> | null | undefined): Record<string, string> | null {
  if (row.kind !== "card_autopay" && row.kind !== "card_autopay_source") return null;
  if (row.status !== "confirmed") return null;
  const from = str(row.payload?.fromAccountId);
  if (!from) return null;
  // card_autopay only prefills; card_autopay_source is the user agreeing to switch.
  if (row.kind === "card_autopay" && current?.[row.subject_ref]) return null;
  if (current?.[row.subject_ref] === from) return null;
  return { ...(current ?? {}), [row.subject_ref]: from };
}
