import { useState, useEffect } from "react";
import { SupabaseClient } from "@supabase/supabase-js";
import {
  Bell, X, CheckCheck, CreditCard, TrendingDown, TrendingUp,
  AlertTriangle, Wallet, Lightbulb, DollarSign, RotateCcw, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtUSD } from "@/lib/format";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface Alert {
  id: string;
  alert_type: string;
  title: string;
  body: string;
  payload: Record<string, any>;
  read_at: string | null;
  created_at: string;
}

interface Props {
  supabase: SupabaseClient;
  userId: string;
  open: boolean;
  onClose: () => void;
  onOpenTransaction?: (txnId: string) => void;
}

const ALERT_ICON: Record<string, React.ElementType> = {
  budget_threshold: Wallet,
  low_balance:      AlertTriangle,
  payment_due:      CreditCard,
  large_txn:        DollarSign,
  deposit:          TrendingUp,
  refund:           RotateCcw,
  insight:          Lightbulb,
};

const ALERT_COLOR: Record<string, string> = {
  budget_threshold: "text-warning bg-warning/10",
  low_balance:      "text-negative bg-negative/10",
  payment_due:      "text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)]",
  large_txn:        "text-warning bg-warning/10",
  deposit:          "text-positive bg-positive/10",
  refund:           "text-positive bg-positive/10",
  insight:          "text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)]",
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const NotificationInbox = ({ supabase, userId, open, onClose, onOpenTransaction }: Props) => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selected, setSelected] = useState<Alert | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    loadAlerts();
  }, [open, userId]);

  const loadAlerts = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("alert_log")
      .select("id, alert_type, title, body, payload, read_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    setAlerts((data ?? []) as Alert[]);
    setLoading(false);
  };

  const markRead = async (alert: Alert) => {
    if (alert.read_at) return;
    await supabase.from("alert_log")
      .update({ read_at: new Date().toISOString() })
      .eq("id", alert.id);
    setAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, read_at: new Date().toISOString() } : a));
  };

  const markAllRead = async () => {
    const unreadIds = alerts.filter(a => !a.read_at).map(a => a.id);
    if (!unreadIds.length) return;
    await supabase.from("alert_log")
      .update({ read_at: new Date().toISOString() })
      .in("id", unreadIds);
    setAlerts(prev => prev.map(a => ({ ...a, read_at: a.read_at ?? new Date().toISOString() })));
  };

  const openAlert = async (alert: Alert) => {
    setSelected(alert);
    await markRead(alert);
  };

  const closeDetail = () => setSelected(null);

  const unreadCount = alerts.filter(a => !a.read_at).length;

  return (
    <>
      {/* Inbox panel */}
      <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
        <DialogContent className="max-w-md p-0 gap-0 max-h-[85dvh] flex flex-col surface-elevated border-border">
          <DialogTitle className="sr-only">Notifications</DialogTitle>
          <DialogDescription className="sr-only">Your financial alerts and notifications</DialogDescription>

          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border/30 shrink-0">
            <Bell className="h-4 w-4 text-[hsl(var(--primary))]" />
            <span className="text-[15px] font-semibold text-foreground flex-1">Notifications</span>
            {unreadCount > 0 && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[hsl(var(--primary))] text-background">
                {unreadCount} new
              </span>
            )}
            {unreadCount > 0 && (
              <button onClick={markAllRead}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                <CheckCheck className="h-3.5 w-3.5" /> All read
              </button>
            )}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-10 text-center text-[12px] text-muted-foreground">Loading…</div>
            ) : alerts.length === 0 ? (
              <div className="p-10 text-center">
                <Bell className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
                <div className="text-[13px] font-medium text-foreground">No notifications yet</div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  Alerts for budgets, payments, deposits and insights will appear here
                </div>
              </div>
            ) : alerts.map(alert => {
              const Icon = ALERT_ICON[alert.alert_type] ?? Bell;
              const color = ALERT_COLOR[alert.alert_type] ?? "text-muted-foreground bg-muted";
              const isUnread = !alert.read_at;
              return (
                <button key={alert.id} onClick={() => openAlert(alert)}
                  className={cn(
                    "w-full flex items-start gap-3 px-5 py-4 text-left border-b border-border/10 hover:bg-surface-hover/30 transition-colors",
                    isUnread && "bg-[hsl(var(--primary)/0.03)]"
                  )}>
                  <div className={cn("h-8 w-8 rounded-lg grid place-items-center shrink-0 mt-0.5", color)}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2">
                      <span className={cn("text-[13px] flex-1 leading-snug", isUnread ? "font-semibold text-foreground" : "font-medium text-foreground/80")}>
                        {alert.title}
                      </span>
                      {isUnread && <span className="h-2 w-2 rounded-full bg-[hsl(var(--primary))] shrink-0 mt-1.5" />}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground mt-0.5 line-clamp-2">{alert.body}</div>
                    <div className="text-[10px] text-muted-foreground/50 mt-1">{timeAgo(alert.created_at)}</div>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0 mt-1" />
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail modal */}
      {selected && (
        <Dialog open onOpenChange={o => { if (!o) closeDetail(); }}>
          <DialogContent className="max-w-sm p-0 gap-0 surface-elevated border-border overflow-hidden">
            <DialogTitle className="sr-only">{selected.title}</DialogTitle>
            <DialogDescription className="sr-only">{selected.body}</DialogDescription>

            {/* Detail header */}
            {(() => {
              const Icon = ALERT_ICON[selected.alert_type] ?? Bell;
              const color = ALERT_COLOR[selected.alert_type] ?? "text-muted-foreground bg-muted";
              const p = selected.payload ?? {};

              return (
                <>
                  <div className="px-5 py-5 border-b border-border/30">
                    <div className={cn("h-11 w-11 rounded-xl grid place-items-center mb-3", color)}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="text-[16px] font-bold text-foreground leading-snug">{selected.title}</div>
                    <div className="text-[12.5px] text-muted-foreground mt-1">{selected.body}</div>
                    <div className="text-[10px] text-muted-foreground/40 mt-2">{timeAgo(selected.created_at)}</div>
                  </div>

                  {/* Detail body per type */}
                  <div className="px-5 py-4 space-y-3">

                    {/* Budget */}
                    {selected.alert_type === "budget_threshold" && p.budget && (
                      <>
                        <Row label="Category" value={p.category} />
                        <Row label="Budget" value={fmtUSD(p.budget)} />
                        <Row label="Spent" value={fmtUSD(p.spent)} highlight={p.spent > p.budget ? "negative" : "warning"} />
                        <Row label="Remaining" value={fmtUSD(Math.max(0, p.budget - p.spent))} />
                        <div className="h-2 rounded-full bg-border/30 overflow-hidden">
                          <div className="h-full rounded-full bg-[hsl(var(--primary))]"
                            style={{ width: `${Math.min((p.spent / p.budget) * 100, 100)}%`, backgroundColor: p.spent > p.budget ? "hsl(var(--negative))" : undefined }} />
                        </div>
                      </>
                    )}

                    {/* Low balance */}
                    {selected.alert_type === "low_balance" && (
                      <Row label="Available balance" value={fmtUSD(p.balance ?? 0)} highlight="negative" />
                    )}

                    {/* Payment due */}
                    {selected.alert_type === "payment_due" && (
                      <>
                        {p.days_until === 0
                          ? <Row label="Due" value="Today" highlight="negative" />
                          : <Row label="Due in" value={`${p.days_until} days`} highlight="warning" />}
                        <Row label="Minimum payment" value={fmtUSD(p.min_payment ?? 0)} />
                        <Row label="Due date" value={p.due_date} />
                      </>
                    )}

                    {/* Large txn / deposit / refund */}
                    {["large_txn", "deposit", "refund"].includes(selected.alert_type) && (
                      <>
                        <Row label="Merchant" value={p.merchant} />
                        <Row label="Amount" value={fmtUSD(p.amount ?? 0)}
                          highlight={selected.alert_type === "large_txn" ? "warning" : "positive"} />
                        <Row label="Date" value={p.date} />
                        {p.category && <Row label="Category" value={p.category} />}
                        {onOpenTransaction && p.transaction_id && (
                          <button onClick={() => { closeDetail(); onOpenTransaction(p.transaction_id); }}
                            className="w-full flex items-center justify-center gap-2 h-9 rounded-lg bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))] text-[12.5px] font-medium mt-2">
                            View transaction <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </>
                    )}

                    {/* Insight */}
                    {selected.alert_type === "insight" && Array.isArray(p.insights) && p.insights.map((ins: any, i: number) => (
                      <div key={i} className="rounded-xl bg-[hsl(var(--primary)/0.06)] border border-[hsl(var(--primary)/0.15)] p-3.5 space-y-1.5">
                        <div className="text-[12.5px] font-semibold text-foreground">{ins.title}</div>
                        {ins.what && <div className="text-[11.5px] text-muted-foreground leading-relaxed">{ins.what}</div>}
                        {ins.action && (
                          <div className="text-[11px] font-medium text-[hsl(var(--primary))] mt-1">
                            → {ins.action}
                          </div>
                        )}
                        {ins.impact && (
                          <div className="text-[10.5px] text-muted-foreground/60">{ins.impact}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};

const Row = ({ label, value, highlight }: { label: string; value: any; highlight?: "positive" | "negative" | "warning" }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-[11.5px] text-muted-foreground">{label}</span>
    <span className={cn("text-[12.5px] font-semibold tabular",
      highlight === "positive" ? "text-positive" :
      highlight === "negative" ? "text-negative" :
      highlight === "warning" ? "text-warning" :
      "text-foreground")}>
      {value ?? "—"}
    </span>
  </div>
);
