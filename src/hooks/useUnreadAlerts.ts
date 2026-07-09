import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Live unread-alert count for the notification bell. Reads alert_log, subtracts
 * the ids the user has already seen (tracked in localStorage by NotificationInbox),
 * and refreshes on realtime inserts.
 */
export const useUnreadAlerts = (userId: string | undefined) => {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!userId) { setCount(0); return; }
    const read = new Set<string>(JSON.parse(localStorage.getItem(`sentryfi_read_alerts_${userId}`) ?? "[]"));
    const { data } = await supabase.from("alert_log").select("id").eq("user_id", userId).order("sent_at", { ascending: false }).limit(50);
    setCount((data ?? []).filter((r: { id: string }) => !read.has(r.id)).length);
  }, [userId]);

  useEffect(() => { refresh().catch(() => {}); }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`unread_alerts_${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "alert_log", filter: `user_id=eq.${userId}` },
        () => { refresh().catch(() => {}); })
      .subscribe();
    // Re-check when the tab regains focus (covers reads made in the inbox).
    const onFocus = () => refresh().catch(() => {});
    window.addEventListener("focus", onFocus);
    return () => { supabase.removeChannel(channel); window.removeEventListener("focus", onFocus); };
  }, [userId, refresh]);

  return { unreadCount: count, refreshUnread: refresh };
};
