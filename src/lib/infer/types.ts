/**
 * My Money inferences ("Findings"): shared types.
 * Spec: review/insights/v2/INFERENCES.md §1 (confidence tiers, confirm/reject)
 * and §5 (privacy / false-positive guardrails). Table: public.inferences
 * (supabase/migrations/20261020210000_inferences.sql).
 */
import type { ISODate } from "../recurring/dates";

/** Every finding kind. `inferences.kind` is checked against exactly this list. */
export const INFERENCE_KINDS = [
  "bill_autopay", // §2.1 a bill looks like it's on autopay
  "card_autopay", // §2.2 a card looks auto-paid (full / minimum / fixed)
  "card_autopay_source", // §2.2 card payments now come from a different account than the user set
  "autopay_missed", // §2.4 a confirmed autopay didn't run
  "paycheck", // §3.1
  "salary_change", // §3.2
  "yearly_bill", // §3.3
  "set_aside_funding", // §2.3 / §3.6
  "set_aside_status", // §3.7
  "low_balance", // §3.14
  "price_increase", // §3.9
  "card_interest", // §3.11
  "interest_earned", // §3.20
] as const;
export type InferenceKind = (typeof INFERENCE_KINDS)[number];

export const SUBJECT_TYPES = ["stream", "account", "transaction", "fund", "user"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const INFERENCE_STATUSES = ["suggested", "confirmed", "rejected", "expired"] as const;
export type InferenceStatus = (typeof INFERENCE_STATUSES)[number];

/** §1: High is shown inline with a "Detected" tag, Medium only as a Finding, Low not at all. */
export type ConfidenceTier = "high" | "medium" | "low";
export const HIGH_CONFIDENCE = 0.85;
export const MEDIUM_CONFIDENCE = 0.6;

export function confidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= HIGH_CONFIDENCE) return "high";
  if (confidence >= MEDIUM_CONFIDENCE) return "medium";
  return "low";
}

export const INFER_DETECTOR_VERSION = 1;

/** One transaction behind a finding ("Why we think this" chips). */
export interface EvidenceItem {
  transactionId: string;
  date: ISODate;
  amount: number;
  accountId: string | null;
}

/** What a detector returns. Not persisted as-is: see toInferenceRow / reconcileFindings. */
export interface Finding<P extends Record<string, unknown> = Record<string, unknown>> {
  kind: InferenceKind;
  subjectType: SubjectType;
  subjectRef: string;
  payload: P;
  confidence: number;
  evidence: EvidenceItem[];
  detectorVersion: number;
}

/** A `public.inferences` row. */
export interface InferenceRow {
  id?: string;
  user_id: string;
  kind: InferenceKind;
  subject_type: SubjectType;
  subject_ref: string;
  payload: Record<string, unknown>;
  confidence: number;
  evidence_txn_ids: string[];
  fingerprint: string | null;
  status: InferenceStatus;
  reason: string | null;
  suppressed_until: string | null;
  expires_at: string | null;
  detector_version: number;
  last_detected_at: string;
  created_at?: string;
  decided_at?: string | null;
}

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const round3 = (x: number) => Math.round(x * 1000) / 1000;
