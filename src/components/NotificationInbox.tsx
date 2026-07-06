import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Settings, Bell, Loader2, AlertCircle, TrendingDown, CreditCard, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

interface Notification {
  id: string;
  type: "budget_alert" | "low_balance" | "payment_due" | "weekly_summary" | "info";
  title: string;
  body: string;
  created_at: string;
  read: boolean;
}

interface Props {
  onClose: () => void;
  onOpenSettings: () => void;
}

const TYPE_ICON: Record<Notification["type"], React.ElementType> = {
  budget_alert: TrendingDown,
  low_balance: AlertCircle,
  payment_due: Calendar,
  weekly_summary: Bell,
  info: Bell,
};

export const NotificationInbox = ({ onClose, onOpenSettings }: Props) => {
  const { user } = useAuth();
  const [items, setItems] = useState<Notification[] | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("notifications" as any)
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data, error }) => {
        if (error) {
          // Table might not exist yet; show empty state
          setItems([]);
        } else {
          setItems((data ?? []) as Notification[]);
        }
      });
  }, [user]);

  const markRead = async (id: string) => {
    setItems(prev => prev?.map(n => n.id === id ? { ...n, read: true } : n) ?? prev);
    await supabase.from("notifications" as any).update({ read: true }).eq("id", id);
  };

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <div className="flex flex-col min-h-0">
      {items === null ? (
        <div className="p-10 grid place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="p-8 flex flex-col items-center gap-3 text-center">
          <div className="h-12 w-12 rounded-full bg-[hsl(var(--primary)/0.08)] grid place-items-center">
            <Bell className="h-5 w-5 text-[hsl(var(--primary)/0.5)]" />
          </div>
          <div>
            <div className="text-[13.5px] font-semibold text-foreground">You're all caught up</div>
            <div className="text-[12px] text-muted-foreground mt-1">Alerts for budget limits, low balances, and upcoming payments will appear here.</div>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border/20">
          {items.map(n => {
            const Icon = TYPE_ICON[n.type] ?? Bell;
            return (
              <button key={n.id} onClick={() => markRead(n.id)}
                className={cn("w-full text-left px-4 py-3.5 flex gap-3 hover:bg-white/5 transition-colors", !n.read && "bg-[hsl(var(--primary)/0.04)]")}>
                <div className={cn("h-8 w-8 rounded-full grid place-items-center shrink-0 mt-0.5",
                  n.type === "budget_alert" ? "bg-orange-500/10" :
                  n.type === "low_balance" ? "bg-red-500/10" :
                  n.type === "payment_due" ? "bg-yellow-500/10" : "bg-[hsl(var(--primary)/0.08)]"
                )}>
                  <Icon className={cn("h-4 w-4",
                    n.type === "budget_alert" ? "text-orange-400" :
                    n.type === "low_balance" ? "text-red-400" :
                    n.type === "payment_due" ? "text-yellow-400" : "text-[hsl(var(--primary))]"
                  )} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("text-[13px] font-medium leading-snug", n.read ? "text-foreground/70" : "text-foreground")}>{n.title}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(n.created_at)}</span>
                  </div>
                  <div className="text-[12px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">{n.body}</div>
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
