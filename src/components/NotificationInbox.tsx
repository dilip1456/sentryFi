import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Settings, Bell, Loader2, AlertCircle, TrendingDown, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface AlertRow { id: string; alert_type: string; alert_key: string; sent_at: string; }

interface Note {
  id: string;
  type: "low_balance" | "budget_threshold" | "payment_due" | "info";
  title: string;
  body: string;
  at: string;
  read: boolean;
}

interface Props {
  onClose: () => void;
  onOpenSettings: () => void;
}

const TYPE_ICON: Record<Note["type"], React.ElementType> = {
  low_balance: AlertCircle,
  budget_threshold: TrendingDown,
  payment_due: Bell,
  info: Bell,
};

const readKey = (uid: string) => `sentryfi_read_alerts_${uid}`;

export const NotificationInbox = ({ onClose, onOpenSettings }: Props) => {
  const { user } = useAuth();
  const [items, setItems] = useState<Note[] | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "unread">("unread");

  const parse = useCallback((rows: AlertRow[], acctNames: Record<string, string>, read: Set<string>): Note[] => {
    return rows.map(r => {
      const parts = r.alert_key.split(":");
      if (r.alert_type === "low_balance") {
        const acctId = parts[1] ?? "";
        const name = acctNames[acctId] ?? "An account";
        return { id: r.id, type: "low_balance" as const, title: "Low balance",
          body: `${name} dropped below your alert threshold.`, at: r.sent_at, read: read.has(r.id) };
      }
      if (r.alert_type === "budget_threshold") {
        const cat = parts[1] ?? "a category";
        return { id: r.id, type: "budget_threshold" as const, title: "Budget alert",
          body: `You're close to your ${cat} budget this month.`, at: r.sent_at, read: read.has(r.id) };
      }
      if (r.alert_type === "payment_due") {
        return { id: r.id, type: "payment_due" as const, title: "Payment due soon",
          body: "An upcoming payment is due.", at: r.sent_at, read: read.has(r.id) };
      }
      return { id: r.id, type: "info" as const, title: r.alert_type.replace(/_/g, " "),
        body: "", at: r.sent_at, read: read.has(r.id) };
    });
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    const read = new Set<string>(JSON.parse(localStorage.getItem(readKey(user.id)) ?? "[]"));
    setReadIds(read);
    const [alertsRes, acctsRes] = await Promise.all([
      supabase.from("alert_log").select("id, alert_type, alert_key, sent_at").eq("user_id", user.id).order("sent_at", { ascending: false }).limit(40),
      supabase.from("plaid_accounts").select("account_id, name").eq("user_id", user.id),
    ]);
    const names: Record<string, string> = {};
    for (const a of (acctsRes.data ?? []) as { account_id: string; name: string | null }[]) names[a.account_id] = a.name ?? "Account";
    setItems(parse((alertsRes.data ?? []) as AlertRow[], names, read));
  }, [user, parse]);

  useEffect(() => { load().catch(() => setItems([])); }, [load]);

  // Live updates: refresh when a new alert lands for this user.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`alert_log_${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "alert_log", filter: `user_id=eq.${user.id}` },
        () => { load().catch(() => {}); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, load]);

  const persistRead = (next: Set<string>) => {
    if (user) localStorage.setItem(readKey(user.id), JSON.stringify([...next]));
    setReadIds(next);
    setItems(prev => prev?.map(n => ({ ...n, read: next.has(n.id) })) ?? prev);
  };
  const markRead = (id: string) => { const next = new Set(readIds); next.add(id); persistRead(next); };
  const markAllRead = () => { const next = new Set(items?.map(n => n.id) ?? []); persistRead(next); };

  const unread = items?.filter(n => !n.read).length ?? 0;

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const shown = (items ?? []).filter(n => filter === "all" || !n.read);

  return (
    <div className="flex flex-col min-h-0">
      {items && items.length > 0 && (
        <div className="px-4 py-2 border-b border-border/20 flex items-center justify-between gap-2">
          <div className="flex rounded-lg border border-border/50 overflow-hidden">
            {(["all", "unread"] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn("px-3 py-1 text-[11px] font-medium capitalize transition-colors",
                  filter === f ? "bg-[hsl(var(--primary))] text-background" : "text-muted-foreground hover:text-foreground")}>
                {f}{f === "unread" && unread > 0 ? ` (${unread})` : ""}
              </button>
            ))}
          </div>
          {unread > 0 && (
            <button onClick={markAllRead} className="text-[11px] text-[hsl(var(--primary))] font-medium inline-flex items-center gap-1 hover:opacity-80 shrink-0">
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          )}
        </div>
      )}

      {items === null ? (
        <div className="p-10 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : shown.length === 0 ? (
        <div className="p-8 flex flex-col items-center gap-3 text-center">
          <div className="h-12 w-12 rounded-full bg-[hsl(var(--primary)/0.08)] grid place-items-center">
            <Bell className="h-5 w-5 text-[hsl(var(--primary)/0.5)]" />
          </div>
          <div>
            <div className="text-[13.5px] font-semibold text-foreground">{filter === "unread" && (items?.length ?? 0) > 0 ? "No unread notifications" : "You're all caught up"}</div>
            <div className="text-[12px] text-muted-foreground mt-1">
              {filter === "unread" && (items?.length ?? 0) > 0
                ? "Switch to All to see earlier notifications."
                : "Alerts for low balances, budget limits, and upcoming payments will appear here."}
            </div>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border/20">
          {shown.map(n => {
            const Icon = TYPE_ICON[n.type] ?? Bell;
            return (
              <button key={n.id} onClick={() => markRead(n.id)}
                className={cn("w-full text-left px-4 py-3.5 flex gap-3 hover:bg-white/5 transition-colors", !n.read && "bg-[hsl(var(--primary)/0.04)]")}>
                <div className={cn("h-8 w-8 rounded-full grid place-items-center shrink-0 mt-0.5",
                  n.type === "low_balance" ? "bg-red-500/10" :
                  n.type === "budget_threshold" ? "bg-orange-500/10" :
                  n.type === "payment_due" ? "bg-yellow-500/10" : "bg-[hsl(var(--primary)/0.08)]")}>
                  <Icon className={cn("h-4 w-4",
                    n.type === "low_balance" ? "text-red-400" :
                    n.type === "budget_threshold" ? "text-orange-400" :
                    n.type === "payment_due" ? "text-yellow-400" : "text-[hsl(var(--primary))]")} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("text-[13px] font-medium leading-snug capitalize", n.read ? "text-foreground/70" : "text-foreground")}>{n.title}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(n.at)}</span>
                  </div>
                  {n.body && <div className="text-[12px] text-muted-foreground mt-0.5 leading-snug">{n.body}</div>}
                </div>
                {!n.read && <div className="h-2 w-2 rounded-full bg-[hsl(var(--primary))] shrink-0 mt-1.5" />}
              </button>
            );
          })}
        </div>
      )}

      <div className="p-4 border-t border-border/20 shrink-0">
        <button onClick={onOpenSettings}
          className="w-full flex items-center justify-center gap-2 h-9 rounded-lg border border-border text-[12.5px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
          <Settings className="h-3.5 w-3.5" />
          Notification settings
        </button>
      </div>
    </div>
  );
};
