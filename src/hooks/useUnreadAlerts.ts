import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export const useUnreadAlerts = (userId: string | undefined) => {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!userId) { setCount(0); return; }
    try {
      const readRaw = localStorage.getItem(`sentryfi_read_alerts_${userId}`);
      const read = new Set<string>(readRaw ? JSON.parse(readRaw) : []);
      const { data } = await supabase
        .from("alert_log")
        .select("id")
        .eq("user_id", userId)
        .order("sent_at", { ascending: false })
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
    return () => {
      try { if (channel) supabase.removeChannel(channel); } catch {}
      window.removeEventListener("focus", onFocus);
    };
  }, [userId, refresh]);

  return { unreadCount: count, refreshUnread: refresh };
};
