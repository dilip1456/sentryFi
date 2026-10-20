import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { TXN_TYPES, type TxnType } from "@/lib/classify/index.ts";

// txn_overrides isn't in the generated Supabase types yet (see
// supabase/migrations/20261020121000_txn_overrides.sql), so talk to it
// through a narrow, explicitly-typed view of the query builder.
type Row = { transaction_id: string; txn_type: string };
type Result<T> = Promise<{ data: T | null; error: { message: string; code?: string } | null }>;
interface OverridesTable {
  select: (cols: string) => { eq: (c: string, v: string) => Result<Row[]> };
  upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => Result<unknown>;
  delete: () => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Result<unknown> } };
}
const table = () => (supabase as unknown as { from: (t: string) => OverridesTable }).from("txn_overrides");

/**
 * Per-transaction classification overrides, keyed by Plaid transaction_id.
 * The user's pick always wins over the auto-classifier.
 */
export function useTxnTypeOverrides(userId: string | undefined) {
  const [overrides, setOverrides] = useState<Record<string, TxnType>>({});

  useEffect(() => {
    if (!userId) { setOverrides({}); return; }
    let cancelled = false;
    table().select("transaction_id,txn_type").eq("user_id", userId).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { console.warn("[txn_overrides] load failed:", error.message); return; }
      const next: Record<string, TxnType> = {};
      for (const r of data ?? []) if ((TXN_TYPES as string[]).includes(r.txn_type)) next[r.transaction_id] = r.txn_type as TxnType;
      setOverrides(next);
    });
    return () => { cancelled = true; };
  }, [userId]);

  /** Set (or clear with null) the override for one Plaid transaction_id. */
  const setOverride = useCallback(async (transactionId: string, type: TxnType | null) => {
    if (!userId || !transactionId) return;
    let previous: TxnType | undefined;
    setOverrides(prev => {
      previous = prev[transactionId];
      const next = { ...prev };
      if (type) next[transactionId] = type; else delete next[transactionId];
      return next;
    });
    const { error } = type
      ? await table().upsert({ user_id: userId, transaction_id: transactionId, txn_type: type }, { onConflict: "user_id,transaction_id" })
      : await table().delete().eq("user_id", userId).eq("transaction_id", transactionId);
    if (error) {
      console.error("[txn_overrides] save failed:", error.message);
      toast.error("Couldn't save this change", { description: error.message });
      setOverrides(prev => {
        const next = { ...prev };
        if (previous) next[transactionId] = previous; else delete next[transactionId];
        return next;
      });
    }
  }, [userId]);

  return { overrides, setOverride };
}
