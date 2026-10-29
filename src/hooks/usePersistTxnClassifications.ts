import { useContext, useEffect, useRef } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Classification } from "@/lib/classify";
import { chunk, classificationDiff, type ClassificationRow } from "@/lib/timeline/persist";

// txn_classifications (20261029100000_timeline_events.sql) isn't in the
// generated Supabase types yet; use a narrow typed view like useTxnTypeOverrides.
type Result<T> = Promise<{ data: T | null; error: { message: string; code?: string } | null }>;
interface ClassTable {
  select: (cols: string) => { eq: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => { range: (a: number, b: number) => Result<{ transaction_id: string; txn_type: string }[]> } } };
  upsert: (rows: Record<string, unknown>[], opts: { onConflict: string }) => Result<unknown>;
}
const table = () => (supabase as unknown as { from: (t: string) => ClassTable }).from("txn_classifications");

/**
 * Persist the shared classifier's verdict per transaction so the
 * timeline_events view can hide internal transfers (transfer_internal needs
 * pair matching that only the client-side classifier does). Diff-only,
 * debounced, chunked; never runs in demo mode. If the table doesn't exist
 * yet (migration not deployed) it gives up quietly for the session.
 */
export function usePersistTxnClassifications(
  userId: string | undefined,
  txns: { id: string; transaction_id?: string | null; pending?: boolean | null }[],
  classes: Map<string, Classification>,
) {
  const stored = useRef<Map<string, string> | null>(null);
  const disabled = useRef(false);
  const busy = useRef(false);
  const qc = useContext(QueryClientContext); // optional: some tests render the dashboard without a provider

  // a different user (sign-out → sign-in) starts fresh: their own stored rows, and a
  // failure for the previous user (e.g. table missing then) no longer applies
  useEffect(() => { stored.current = null; disabled.current = false; }, [userId]);

  useEffect(() => {
    if (!userId || disabled.current || !txns.length || !classes.size) return;
    const timer = window.setTimeout(async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        if (!stored.current) {
          const m = new Map<string, string>();
          for (let from = 0; from < 50000; from += 1000) {
            const { data, error } = await table().select("transaction_id,txn_type").eq("user_id", userId)
              .order("transaction_id", { ascending: true }) // stable paging (PK suffix)
              .range(from, from + 999);
            if (error) { disabled.current = true; console.warn("[txn_classifications] unavailable:", error.message); return; }
            for (const r of data ?? []) m.set(r.transaction_id, r.txn_type);
            if (!data || data.length < 1000) break;
          }
          stored.current = m;
        }
        const diff: ClassificationRow[] = classificationDiff(txns, classes, stored.current);
        if (!diff.length) return;
        const now = new Date().toISOString();
        let wrote = 0;
        for (const part of chunk(diff, 500)) {
          const { error } = await table().upsert(part.map(r => ({ user_id: userId, ...r, classified_at: now })), { onConflict: "user_id,transaction_id" });
          if (error?.code === "23503") {
            // a transaction was deleted since load (e.g. de-duplication): skip this chunk, retry next time
            continue;
          }
          if (error) { disabled.current = true; console.warn("[txn_classifications] save failed:", error.message); break; }
          for (const r of part) stored.current.set(r.transaction_id, r.txn_type);
          wrote += part.length;
        }
        if (wrote) qc?.invalidateQueries({ queryKey: ["timeline"] });
      } finally {
        busy.current = false;
      }
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [userId, txns, classes, qc]);
}
