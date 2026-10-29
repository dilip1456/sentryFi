import type { Classification, TxnType } from "@/lib/classify";

export interface ClassificationRow { transaction_id: string; txn_type: TxnType }

/**
 * Which shared-classifier verdicts need writing to txn_classifications:
 * only rows whose type changed (or were never stored). Pending txns are
 * skipped (their Plaid id is replaced when they post).
 */
export function classificationDiff(
  txns: { id: string; transaction_id?: string | null; pending?: boolean | null }[],
  classes: Map<string, Classification>,
  stored: Map<string, string>,
): ClassificationRow[] {
  const out: ClassificationRow[] = [];
  const seen = new Set<string>();
  for (const t of txns) {
    const pid = t.transaction_id;
    if (!pid || t.pending || seen.has(pid)) continue;
    seen.add(pid);
    const c = classes.get(t.id);
    if (!c) continue;
    if (stored.get(pid) !== c.type) out.push({ transaction_id: pid, txn_type: c.type });
  }
  return out;
}

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
