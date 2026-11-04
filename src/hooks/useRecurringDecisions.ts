/**
 * The person's decisions on "Detected recurring" items, stored in
 * recurring_streams (source 'picture', RLS own rows). Demo: in memory only.
 * If the table can't be read or written (e.g. the 20261104000100 migration
 * isn't deployed yet) the screen keeps working with what's in memory and
 * says the choice couldn't be saved.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { decisionToRow, rowToDecision, PICTURE_KEY_PREFIX, PICTURE_SOURCE, type RecurringDecision } from "@/lib/recurring";

type Res = PromiseLike<{ data: unknown; error: { message: string } | null }>;
// recurring_streams' review columns are newer than the generated types.
type Query = Res & { select: (c: string) => Query; eq: (c: string, v: unknown) => Query; delete: () => Query; upsert: (row: Record<string, unknown>, o: { onConflict: string }) => Query };
const db = supabase as unknown as { from: (t: string) => Query };

export function useRecurringDecisions(userId: string | null | undefined, demo: boolean) {
  const [decisions, setDecisions] = useState<RecurringDecision[]>([]);
  const live = !demo && !!userId;
  const ref = useRef(decisions);
  ref.current = decisions;

  useEffect(() => {
    setDecisions([]);
    if (!live) return;
    let off = false;
    (db.from("recurring_streams").select("*").eq("user_id", userId).eq("source", PICTURE_SOURCE) as Res).then(({ data, error }) => {
      if (off) return;
      if (error) { console.warn("[recurring decisions]", error.message); return; }
      setDecisions(((data as Record<string, unknown>[]) ?? []).map(rowToDecision).filter((d): d is RecurringDecision => !!d));
    });
    return () => { off = true; };
  }, [live, userId]);

  const failed = (msg: string, prev: RecurringDecision[]) => {
    console.warn("[recurring decisions]", msg);
    setDecisions(prev);
    toast.error("Couldn't save that change", { description: "Your choice is shown for now but wasn't stored. Try again later." });
  };

  /** Store (insert or replace) one decision. */
  const save = useCallback(async (d: RecurringDecision) => {
    const prev = ref.current;
    setDecisions([...prev.filter(x => x.key !== d.key), d]);
    if (!live) return;
    const { error } = await (db.from("recurring_streams").upsert(decisionToRow(userId!, d), { onConflict: "user_id,series_key" }) as Res);
    if (error) failed(error.message, prev);
  }, [live, userId]);

  /** Forget a decision (restore to "suggested"). */
  const remove = useCallback(async (key: string) => {
    const prev = ref.current;
    setDecisions(prev.filter(x => x.key !== key));
    if (!live) return;
    const { error } = await (db.from("recurring_streams").delete().eq("user_id", userId).eq("series_key", PICTURE_KEY_PREFIX + key) as Res);
    if (error) failed(error.message, prev);
  }, [live, userId]);

  return { decisions, save, remove };
}
