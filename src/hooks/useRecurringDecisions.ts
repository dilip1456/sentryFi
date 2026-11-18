/**
 * The person's decisions on "Detected recurring" items, stored in
 * recurring_streams (source 'picture', RLS own rows). Demo / guest: kept in
 * sessionStorage only, so an acted-on item stays gone after a reload.
 *
 * Optimistic: every save/remove shows at once and is kept in a local layer
 * on top of what was loaded (overlayDecisions), so the initial load or a
 * refetch can't bring an acted-on item back. If the table can't be written
 * (e.g. the 20261104000100 migration isn't deployed yet) only that one change
 * is rolled back and the person is told it wasn't saved.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  decisionToRow, overlayDecisions, parseStoredDecisions, rowToDecision, DEMO_DECISIONS_KEY, PICTURE_KEY_PREFIX, PICTURE_SOURCE,
  type RecurringDecision,
} from "@/lib/recurring";

type Res = PromiseLike<{ data: unknown; error: { message: string } | null }>;
// recurring_streams' review columns are newer than the generated types.
type Query = Res & { select: (c: string) => Query; eq: (c: string, v: unknown) => Query; delete: () => Query; upsert: (row: Record<string, unknown>, o: { onConflict: string }) => Query };
const db = supabase as unknown as { from: (t: string) => Query };

const session = () => { try { return typeof window !== "undefined" ? window.sessionStorage : null; } catch { return null; } };
const readDemo = () => parseStoredDecisions(session()?.getItem(DEMO_DECISIONS_KEY));
const writeDemo = (list: RecurringDecision[]) => { try { session()?.setItem(DEMO_DECISIONS_KEY, JSON.stringify(list)); } catch { /* storage full / blocked */ } };

/**
 * @param reloadKey  refetch when this changes (the Picture passes its
 *   transactions, so a sync / refresh re-reads decisions made on another
 *   device). A refetch keeps what is shown until the new rows arrive.
 */
export function useRecurringDecisions(userId: string | null | undefined, demo: boolean, reloadKey?: unknown) {
  const live = !demo && !!userId;
  /** Last loaded server rows (live) or the stored demo list. */
  const [base, setBase] = useState<RecurringDecision[]>(() => (live ? [] : readDemo()));
  /** This session's changes on top of `base` (null = removed). */
  const [local, setLocal] = useState<ReadonlyMap<string, RecurringDecision | null>>(() => new Map());
  const decisions = useMemo(() => overlayDecisions(base, local), [base, local]);
  const ref = useRef(decisions);
  ref.current = decisions;

  /** False until the first server read for this user finished (ok or not). */
  const [loaded, setLoaded] = useState(!live);
  // A different person (or demo ↔ live): start from nothing.
  useEffect(() => {
    setLocal(new Map());
    setBase(live ? [] : readDemo());
    setLoaded(!live);
  }, [live, userId]);
  useEffect(() => {
    if (!live) return;
    let off = false;
    (db.from("recurring_streams").select("*").eq("user_id", userId).eq("source", PICTURE_SOURCE) as Res).then(({ data, error }) => {
      if (off) return;
      setLoaded(true);
      if (error) { console.warn("[recurring decisions]", error.message); return; }
      setBase(((data as Record<string, unknown>[]) ?? []).map(rowToDecision).filter((d): d is RecurringDecision => !!d));
    }, (e: unknown) => { if (!off) { setLoaded(true); console.warn("[recurring decisions]", e); } });
    return () => { off = true; };
  }, [live, userId, reloadKey]);

  const put = useCallback((key: string, d: RecurringDecision | null) => {
    setLocal(prev => { const next = new Map(prev); next.set(key, d); return next; });
    if (!live) writeDemo(overlayDecisions(ref.current, new Map([[key, d]])));
  }, [live]);

  /** Roll back just this key (later changes to other items stay). */
  const failed = useCallback((key: string, prev: RecurringDecision | undefined, msg: string) => {
    console.warn("[recurring decisions]", msg);
    setLocal(m => { const next = new Map(m); next.set(key, prev ?? null); return next; });
    toast.error("Couldn't save that change", { description: "It wasn't stored, so it's back in the list. Try again later." });
  }, []);

  /**
   * Store (insert or replace) one decision. `quiet`: a background fix (e.g. a
   * refreshed label) that rolls back silently instead of telling the person.
   */
  const save = useCallback(async (d: RecurringDecision, opts?: { quiet?: boolean }) => {
    const prev = ref.current.find(x => x.key === d.key);
    put(d.key, d);
    if (!live) return;
    const { error } = await (db.from("recurring_streams").upsert(decisionToRow(userId!, d), { onConflict: "user_id,series_key" }) as Res);
    if (!error) return;
    if (opts?.quiet) { console.warn("[recurring decisions]", error.message); setLocal(m => { const next = new Map(m); next.set(d.key, prev ?? null); return next; }); return; }
    failed(d.key, prev, error.message);
  }, [live, userId, put, failed]);

  /** Forget a decision (restore to "suggested"). */
  const remove = useCallback(async (key: string) => {
    const prev = ref.current.find(x => x.key === key);
    put(key, null);
    if (!live) return;
    const { error } = await (db.from("recurring_streams").delete().eq("user_id", userId).eq("series_key", PICTURE_KEY_PREFIX + key) as Res);
    if (error) failed(key, prev, error.message);
  }, [live, userId, put, failed]);

  return { decisions, save, remove, loaded };
}
