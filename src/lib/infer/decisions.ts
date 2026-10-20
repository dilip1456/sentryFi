/**
 * Confirm / reject / expire mechanics for findings (INFERENCES.md §1, §5).
 * Pure: callers read and write `public.inferences`.
 *
 *  - Only CONFIRMED findings count toward totals or change statuses.
 *  - "Not right" keeps the reason and suppresses the same kind + subject for
 *    180 days, or until the evidence materially changes (amount ±20%, a
 *    different account, a different cadence / mode).
 *  - Suggestions nobody answers expire after 60 days; a suggestion whose
 *    evidence disappeared expires on the next run.
 *  - The overview surfaces at most 3 new findings per week; the rest wait in
 *    the Findings list.
 */
import {
  INFER_DETECTOR_VERSION,
  round3,
  type Finding,
  type InferenceRow,
} from "./types";

export const SUPPRESS_DAYS = 180;
export const EXPIRE_DAYS = 60;
export const MAX_NEW_PER_WEEK = 3;
export const MATERIAL_AMOUNT_CHANGE = 0.2;

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString(); // timestamptz columns, not calendar dates
const plusDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);

/** Payload fields whose change makes a rejected/expired finding worth asking again. */
const MATERIAL_KEYS = ["fromAccountId", "payFromAccountId", "accountId", "cadence", "mode", "payMethod", "lastMissed"] as const;
const AMOUNT_KEYS = ["amount", "monthlyAmount", "expectedAmount"] as const;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** True when `next` differs enough from `prev` that the user should be asked again. */
export function materiallyChanged(prev: Record<string, unknown> | null | undefined, next: Record<string, unknown>): boolean {
  if (!prev) return true;
  for (const k of MATERIAL_KEYS) {
    if (k in prev || k in next) {
      if ((prev[k] ?? null) !== (next[k] ?? null)) return true;
    }
  }
  for (const k of AMOUNT_KEYS) {
    const a = num(prev[k]);
    const b = num(next[k]);
    if (a === null && b === null) continue;
    if (a === null || b === null) return true;
    const base = Math.max(Math.abs(a), 0.01);
    if (Math.abs(b - a) / base > MATERIAL_AMOUNT_CHANGE) return true;
  }
  return false;
}

/** Stable summary of the material evidence (stored for audit / dedupe; logic uses materiallyChanged). */
export function fingerprintOf(f: Pick<Finding, "kind" | "subjectRef" | "payload">): string {
  const p = f.payload;
  const parts: string[] = [f.kind, f.subjectRef];
  for (const k of MATERIAL_KEYS) if (p[k] != null) parts.push(`${k}=${String(p[k])}`);
  for (const k of AMOUNT_KEYS) {
    const v = num(p[k]);
    // log-bucketed so ±small noise keeps the same fingerprint
    if (v !== null && v > 0) parts.push(`${k}~${Math.round(Math.log(v) / Math.log(1 + MATERIAL_AMOUNT_CHANGE))}`);
  }
  return parts.join("|");
}

export function toInferenceRow(f: Finding, userId: string, now: Date): InferenceRow {
  return {
    user_id: userId,
    kind: f.kind,
    subject_type: f.subjectType,
    subject_ref: f.subjectRef,
    payload: { ...f.payload, evidence: f.evidence },
    confidence: round3(f.confidence),
    evidence_txn_ids: f.evidence.map(e => e.transactionId),
    fingerprint: fingerprintOf(f),
    status: "suggested",
    reason: null,
    suppressed_until: null,
    expires_at: iso(plusDays(now, EXPIRE_DAYS)),
    detector_version: f.detectorVersion ?? INFER_DETECTOR_VERSION,
    last_detected_at: iso(now),
    decided_at: null,
  };
}

const key = (r: { kind: string; subject_ref: string }) => `${r.kind}\u0000${r.subject_ref}`;
const stripEvidence = (p: Record<string, unknown>) => {
  const { evidence: _e, ...rest } = p;
  return rest;
};

/**
 * Merge this run's findings with the stored rows. Returns only the rows that
 * changed (to upsert on user_id,kind,subject_ref). Confirmed and rejected
 * rows are never silently reverted.
 */
export function reconcileFindings(detected: Finding[], stored: InferenceRow[], opts: { userId: string; now: Date }): InferenceRow[] {
  const { userId, now } = opts;
  const out: InferenceRow[] = [];
  const byKey = new Map(stored.map(r => [key(r), r] as const));
  const seen = new Set<string>();

  for (const f of detected) {
    const fresh = toInferenceRow(f, userId, now);
    const k = key(fresh);
    seen.add(k);
    const prev = byKey.get(k);
    if (!prev) {
      out.push(fresh);
      continue;
    }
    const changed = materiallyChanged(stripEvidence(prev.payload ?? {}), stripEvidence(fresh.payload));
    switch (prev.status) {
      case "suggested": {
        const expired = prev.expires_at != null && new Date(prev.expires_at).getTime() <= now.getTime();
        if (expired && !changed) {
          out.push({ ...prev, status: "expired", last_detected_at: fresh.last_detected_at });
        } else {
          // refresh the evidence; a material change restarts the 60-day clock
          out.push({ ...prev, ...pickDetection(fresh), expires_at: changed ? fresh.expires_at : prev.expires_at });
        }
        break;
      }
      case "confirmed":
        // The confirmed payload is the user's fact. Only note that we saw it again;
        // divergence is reported by dedicated kinds (autopay_missed, card_autopay_source).
        out.push({ ...prev, last_detected_at: fresh.last_detected_at, detector_version: fresh.detector_version });
        break;
      case "rejected": {
        const suppressed = prev.suppressed_until != null && new Date(prev.suppressed_until).getTime() > now.getTime();
        if (suppressed && !changed) break; // stay quiet; nothing to write
        out.push({ ...prev, ...pickDetection(fresh), status: "suggested", suppressed_until: null, decided_at: null, expires_at: fresh.expires_at });
        break;
      }
      case "expired":
        if (changed) out.push({ ...prev, ...pickDetection(fresh), status: "suggested", decided_at: null, expires_at: fresh.expires_at });
        break;
    }
  }

  // Suggestions whose evidence disappeared (or that ran past their deadline) expire.
  for (const r of stored) {
    if (r.status !== "suggested" || seen.has(key(r))) continue;
    out.push({ ...r, status: "expired" });
  }
  return out;
}

function pickDetection(r: InferenceRow) {
  return {
    payload: r.payload,
    confidence: r.confidence,
    evidence_txn_ids: r.evidence_txn_ids,
    fingerprint: r.fingerprint,
    detector_version: r.detector_version,
    last_detected_at: r.last_detected_at,
  };
}

export type Decision = { action: "confirm" } | { action: "reject"; reason?: string | null } | { action: "undo" };

/** Apply the user's tap. Mirrors the DB trigger (decided_at / suppressed_until) so the UI can update optimistically. */
export function decide(row: InferenceRow, d: Decision, now: Date): InferenceRow {
  switch (d.action) {
    case "confirm":
      return { ...row, status: "confirmed", decided_at: iso(now), reason: null, suppressed_until: null };
    case "reject": {
      const reason = d.reason?.trim() ? d.reason.trim().slice(0, 500) : null;
      return { ...row, status: "rejected", decided_at: iso(now), reason, suppressed_until: iso(plusDays(now, SUPPRESS_DAYS)) };
    }
    case "undo":
      return { ...row, status: "suggested", decided_at: null, reason: null, suppressed_until: null, expires_at: iso(plusDays(now, EXPIRE_DAYS)) };
  }
}

/** Dilip's rule: detected facts only count toward totals once he taps Confirm. */
export function countsTowardTotals(row: Pick<InferenceRow, "status"> | null | undefined): boolean {
  return row?.status === "confirmed";
}

/** Open findings for the Findings page, highest confidence first. */
export function openFindings(rows: InferenceRow[]): InferenceRow[] {
  return rows.filter(r => r.status === "suggested").sort((a, b) => b.confidence - a.confidence || (a.created_at ?? "").localeCompare(b.created_at ?? ""));
}

/**
 * The overview's "We found N new things" entry point: at most 3 findings first
 * suggested in the last 7 days; older and extra ones wait in the list.
 */
export function overviewFindings(rows: InferenceRow[], now: Date): InferenceRow[] {
  const weekAgo = now.getTime() - 7 * DAY_MS;
  return openFindings(rows)
    .filter(r => !r.created_at || new Date(r.created_at).getTime() >= weekAgo)
    .slice(0, MAX_NEW_PER_WEEK);
}
