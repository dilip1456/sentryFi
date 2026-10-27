import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

// alert_log isn't in the generated Supabase types; describe just what we use.
type CountResult = Promise<{ count: number | null; error: { message: string } | null }>;
type RowsResult = Promise<{ data: { id: string }[] | null; error: { message: string } | null }>;
interface AlertLogTable {
  select(cols: "id", opts: { count: "exact"; head: true }): { eq(c: "user_id", v: string): { is(c: "read_at", v: null): CountResult } };
  select(cols: "id"): { eq(c: "user_id", v: string): { limit(n: number): RowsResult } };
}
const alertLog = () => (supabase as unknown as { from: (t: "alert_log") => AlertLogTable }).from("alert_log");

export const useUnreadAlerts = (userId: string | undefined) => {
  const [count, setCount] = useState(0);

  // Unread = alert_log.read_at IS NULL (server-side, the same flag the
  // inbox sets), so "Mark all read" clears the badge on every device. Falls
  // back to the old localStorage list if the column isn't there yet.
  const refresh = useCallback(async () => {
    if (!userId) { setCount(0); return; }
    try {
      const { count: unread, error } = await alertLog()
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("read_at", null);
      if (!error) { setCount(unread ?? 0); return; }
      const readRaw = localStorage.getItem(`sentryfi_read_alerts_${userId}`);
      const read = new Set<string>(readRaw ? JSON.parse(readRaw) : []);
      const { data } = await alertLog()
        .select("id")
        .eq("user_id", userId)
        .limit(50);
      setCount((data ?? []).filter((r: { id: string }) => !read.has(r.id)).length);
    } catch {
      // Never crash the app over notification counts
      setCount(0);
    }
  }, [userId]);

  useEffect(() => { refresh().catch(() => {}); }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`unread_alerts_${userId}`)
        .on("postgres_changes", {
          event: "INSERT", schema: "public",
          table: "alert_log", filter: `user_id=eq.${userId}`
        }, () => { refresh().catch(() => {}); })
        .subscribe();
    } catch {
      // Realtime not available (Android WebView sometimes blocks WebSockets)
    }
    const onFocus = () => refresh().catch(() => {});
    window.addEventListener("focus", onFocus);
    // NotificationInbox fires this after marking alerts read.
    window.addEventListener("sentryfi:alerts-read", onFocus);
    return () => {
      try { if (channel) supabase.removeChannel(channel); } catch { /* already gone */ }
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("sentryfi:alerts-read", onFocus);
    };
  }, [userId, refresh]);

  return { unreadCount: count, refreshUnread: refresh };
};
