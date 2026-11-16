/**
 * Assembles the compact inbox from every source: alert_log, on-device
 * derived alerts, Home action items, product notices, and (in /demo) the
 * curated example list. Also exposes the unread count and urgent-strip
 * selection so the bell and strip can render while the panel is closed.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareInbox, type AlertLike } from "@/lib/notifications";
import { useDerivedAlerts, derivedInboxRows, markDerivedRead, isDerivedId } from "@/lib/derived-alerts";
import {
  fromAlertLike, selectUrgentStrip, type CompactItem,
} from "@/lib/notifications/compact";
import { demoInboxItems } from "@/lib/notifications/demo";
import { productNotices } from "@/lib/notifications/product";
import { useInboxExtras, getHomeActionItems, getHistoryHintNotice } from "@/lib/notifications/extras-store";
import {
  applyLocalState, markInboxRead, dismissInboxItems, emitInboxLocal,
  APK_BANNER_KEY, DEMO_NOTICE_KEY, setKey, INBOX_LOCAL_EVENT, ALERTS_READ_EVENT,
} from "@/lib/notifications/local-state";
import { PRODUCT_APK_ID, PRODUCT_DEMO_ID, PRODUCT_HISTORY_ID } from "@/lib/notifications/product";

interface AlertRow extends AlertLike {
  payload: Record<string, unknown>;
}

export interface UseInboxItemsOpts {
  userId: string;
  demo: boolean;
  supabase: SupabaseClient | null;
  /** When true, refetch alert_log. The hook also fetches on mount for the badge. */
  open?: boolean;
}

function isNativeClient(): boolean {
  try {
    const c = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return !!c?.isNativePlatform?.();
  } catch { return false; }
}

function mergeUnique(batches: CompactItem[][]): CompactItem[] {
  const seen = new Set<string>();
  const out: CompactItem[] = [];
  for (const batch of batches) {
    for (const it of batch) {
      if (seen.has(it.id)) continue;
      const key = `${it.type}|${it.title.trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(it.id);
      seen.add(key);
      out.push(it);
    }
  }
  return out;
}

export function useInboxItems({ userId, demo, supabase, open = false }: UseInboxItemsOpts) {
  const [dbRows, setDbRows] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [localTick, setLocalTick] = useState(0);
  const derived = useDerivedAlerts();
  const extras = useInboxExtras();

  const bumpLocal = useCallback(() => setLocalTick(t => t + 1), []);

  useEffect(() => {
    const on = () => bumpLocal();
    window.addEventListener(INBOX_LOCAL_EVENT, on);
    window.addEventListener(ALERTS_READ_EVENT, on);
    return () => {
      window.removeEventListener(INBOX_LOCAL_EVENT, on);
      window.removeEventListener(ALERTS_READ_EVENT, on);
    };
  }, [bumpLocal]);

  const loadDb = useCallback(async () => {
    if (demo || !supabase || !userId) { setDbRows([]); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("alert_log")
      .select("id, alert_type, title, body, payload, read_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) console.error("[inbox]", error.message);
    setDbRows((data ?? []) as AlertRow[]);
    setLoading(false);
  }, [demo, supabase, userId]);

  useEffect(() => { loadDb().catch(() => {}); }, [loadDb, open]);

  const now = useMemo(() => new Date(), [localTick, dbRows, derived, extras, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const items: CompactItem[] = useMemo(() => {
    const history = extras.history ?? getHistoryHintNotice();
    const product = productNotices({ demo, history, now, native: isNativeClient() });
    if (demo) {
      return applyLocalState(userId || "demo", mergeUnique([demoInboxItems(now), product]));
    }
    const derivedRows = userId ? derivedInboxRows(userId, derived) : [];
    const fromDb = prepareInbox([...dbRows, ...(derivedRows as AlertRow[])], now).map(a => fromAlertLike(a, now));
    const actions = applyLocalState(userId, extras.actions.length ? extras.actions : getHomeActionItems());
    return applyLocalState(userId, mergeUnique([fromDb, product, actions]));
    // localTick forces a re-read of localStorage-backed state
  }, [demo, userId, dbRows, derived, extras, now, localTick]);

  const unreadCount = items.filter(i => !i.read && !i.gone).length;
  const strip = selectUrgentStrip(items, now);

  const notifyRead = () => {
    try { window.dispatchEvent(new Event(ALERTS_READ_EVENT)); } catch { /* ignore */ }
  };

  const markRead = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const local = ids.filter(id => isDerivedId(id) || id.startsWith("demo:") || id.startsWith("promo:") || id.startsWith("action:"));
    const db = ids.filter(id => !local.includes(id));
    if (local.length) {
      if (userId) {
        const derivedIds = local.filter(isDerivedId);
        if (derivedIds.length) markDerivedRead(userId, derivedIds);
        markInboxRead(userId, local);
      }
    }
    if (db.length && supabase && userId) {
      const at = new Date().toISOString();
      setDbRows(prev => prev.map(a => db.includes(a.id) && !a.read_at ? { ...a, read_at: at } : a));
      const { error } = await supabase.from("alert_log").update({ read_at: at }).eq("user_id", userId).in("id", db);
      if (error) {
        setDbRows(prev => prev.map(a => db.includes(a.id) ? { ...a, read_at: null } : a));
        console.error("[markRead]", error.message);
        return;
      }
    }
    notifyRead();
  }, [supabase, userId]);

  const markAllRead = useCallback(async () => {
    const unread = items.filter(i => !i.read && !i.gone).map(i => i.id);
    await markRead(unread);
    if (!demo && supabase && userId) {
      const at = new Date().toISOString();
      const { error } = await supabase.from("alert_log").update({ read_at: at }).eq("user_id", userId).is("read_at", null);
      if (error) console.error("[markAllRead]", error.message);
    }
    notifyRead();
  }, [items, markRead, demo, supabase, userId]);

  const dismiss = useCallback(async (ids: string[]) => {
    if (!ids.length || !userId) return;
    dismissInboxItems(userId, ids);
    if (ids.includes(PRODUCT_APK_ID)) setKey(APK_BANNER_KEY);
    if (ids.includes(PRODUCT_DEMO_ID)) setKey(DEMO_NOTICE_KEY);
    if (ids.includes(PRODUCT_HISTORY_ID)) {
      try { window.dispatchEvent(new Event("sentryfi:history-hint-dismiss")); } catch { /* ignore */ }
    }
    // Derived / db rows are hidden locally; also mark them read so the badge stays clear.
    await markRead(ids);
    emitInboxLocal();
  }, [userId, markRead]);

  return { items, unreadCount, strip, loading, now, markRead, markAllRead, dismiss, reload: loadDb };
}
