import { useState, useEffect, useMemo, useCallback } from "react";
import { SupabaseClient } from "@supabase/supabase-js";
import {
  Bell, X, CheckCheck, CreditCard, TrendingDown, TrendingUp,
  AlertTriangle, Wallet, Lightbulb, DollarSign, RotateCcw, ChevronRight, ArrowLeftRight,
} from "lucide-react";
import { toast } from "sonner";
import { fmtShortDate, fmtTimeAgo } from "@/lib/format-date";
import { prepareInbox, isUnread as inboxUnread, dueLabel, allIds, type InboxAlert } from "@/lib/notifications";
import { useDerivedAlerts, derivedInboxRows, markDerivedRead, isDerivedId } from "@/lib/derived-alerts";

/** Fired after alerts are marked read so the bell badge refreshes at once. */
export const ALERTS_READ_EVENT = "sentryfi:alerts-read";
import { cn } from "@/lib/utils";
import { fmtUSD } from "@/lib/format";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface Alert {
  id: string;
  alert_type: string;
  title: string;
  body: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- free-form per alert type
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
  cc_payment_posted: CheckCheck,
  transfer:         ArrowLeftRight,
  paycheck_anomaly: AlertTriangle,
};

const ALERT_COLOR: Record<string, string> = {
  budget_threshold: "text-warning bg-warning/10",
  low_balance:      "text-negative bg-negative/10",
  payment_due:      "text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)]",
  large_txn:        "text-warning bg-warning/10",
  deposit:          "text-positive bg-positive/10",
  refund:           "text-positive bg-positive/10",
  insight:          "text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)]",
  cc_payment_posted: "text-positive bg-positive/10",
  transfer:         "text-muted-foreground bg-muted",
  paycheck_anomaly: "text-warning bg-warning/10",
};

const timeAgo = (dateStr: string) => fmtTimeAgo(dateStr);
// Payment-due titles were stored with the countdown baked in ("due in 3d"),
// which goes stale; show the live countdown instead.
const displayTitle = (a: Alert) => {
  if (a.alert_type !== "payment_due") return a.title;
  const label = dueLabel(a);
  return label ? `💳 Payment ${label.charAt(0).toLowerCase()}${label.slice(1)}` : a.title;
};

export const NotificationInbox = ({ supabase, userId, open, onClose, onOpenTransaction }: Props) => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selected, setSelected] = useState<InboxAlert<Alert> | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("alert_log")
      .select("id, alert_type, title, body, payload, read_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) console.error("[NotificationInbox]", error.message);
    setAlerts((data ?? []) as Alert[]);
    setLoading(false);
  }, [supabase, userId]);

  useEffect(() => {
    if (!open) return;
    loadAlerts();
  }, [open, loadAlerts]);

  // Paycheck anomalies are worked out on this device (src/lib/derived-alerts)
  // and listed beside the alert_log rows; their read state is local.
  const derived = useDerivedAlerts();
  const all = useMemo(() => [...alerts, ...(derivedInboxRows(userId, derived) as Alert[])], [alerts, derived, userId]);

  // Identical alerts collapse into one row; past-due reminders sink and
  // stop counting as unread.
  const inbox = useMemo(() => prepareInbox(all), [all]);

  const notifyRead = () => window.dispatchEvent(new Event(ALERTS_READ_EVENT));

  const setReadLocally = (ids: Set<string> | null, at: string | null) =>
    setAlerts(prev => prev.map(a => (ids === null || ids.has(a.id)) && (at === null || !a.read_at) ? { ...a, read_at: at } : a));

  const markRead = async (item: InboxAlert<Alert>) => {
    const unread = allIds(item).filter(id => !all.find(a => a.id === id)?.read_at);
    const local = unread.filter(isDerivedId);
    if (local.length) { markDerivedRead(userId, local); notifyRead(); }
    const ids = unread.filter(id => !isDerivedId(id));
    if (!ids.length) return;
    const at = new Date().toISOString();
    setReadLocally(new Set(ids), at);
    const { error } = await supabase.from("alert_log").update({ read_at: at }).eq("user_id", userId).in("id", ids);
    if (error) { setReadLocally(new Set(ids), null); console.error("[markRead]", error.message); return; }
    notifyRead();
  };

  // Marks EVERY unread alert for the user read — not just the ones loaded
  // into this list — so the bell badge actually clears.
  const markAllRead = async () => {
    const local = all.filter(a => isDerivedId(a.id) && !a.read_at).map(a => a.id);
    if (local.length) markDerivedRead(userId, local);
    const before = alerts;
    const at = new Date().toISOString();
    setReadLocally(null, at);
    const { error } = await supabase.from("alert_log").update({ read_at: at }).eq("user_id", userId).is("read_at", null);
    if (error) {
      setAlerts(before);
      toast.error("Couldn't mark notifications as read. Try again.");
      return;
    }
    notifyRead();
  };

  const openAlert = async (alert: InboxAlert<Alert>) => {
    setSelected(alert);
    await markRead(alert);
  };

  const closeDetail = () => setSelected(null);

  const unreadCount = inbox.filter(inboxUnread).length;
  const anyUnreadRows = all.some(a => !a.read_at);

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
            {anyUnreadRows && (
              <button onClick={markAllRead}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-10 text-center text-[12px] text-muted-foreground">Loading…</div>
            ) : inbox.length === 0 ? (
              <div className="p-10 text-center">
                <Bell className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
                <div className="text-[13px] font-medium text-foreground">No notifications yet</div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  Alerts for budgets, payments, deposits, paychecks and insights will appear here
                </div>
              </div>
            ) : inbox.map(alert => {
              const Icon = ALERT_ICON[alert.alert_type] ?? Bell;
              const color = ALERT_COLOR[alert.alert_type] ?? "text-muted-foreground bg-muted";
              const isUnread = inboxUnread(alert);
              return (
                <button key={alert.id} onClick={() => openAlert(alert)}
                  className={cn(
                    "w-full flex items-start gap-3 px-5 py-4 text-left border-b border-border/10 hover:bg-surface-hover/30 transition-colors",
                    isUnread && "bg-[hsl(var(--primary)/0.03)]",
                    alert.stale && "opacity-60"
                  )}>
                  <div className={cn("h-8 w-8 rounded-lg grid place-items-center shrink-0 mt-0.5", color)}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2">
                      <span className={cn("text-[13px] flex-1 leading-snug", isUnread ? "font-semibold text-foreground" : "font-medium text-foreground/80")}>
                        {displayTitle(alert)}
                      </span>
                      {isUnread && <span className="h-2 w-2 rounded-full bg-[hsl(var(--primary))] shrink-0 mt-1.5" />}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground mt-0.5 line-clamp-2">{alert.body}</div>
                    <div className="text-[10px] text-muted-foreground/50 mt-1">
                      {timeAgo(alert.created_at)}
                      {alert.duplicates.length > 0 && <> · {alert.duplicates.length + 1} times</>}
                      {alert.stale && <> · past due date</>}
                    </div>
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
                    <div className="font-display text-[16px] text-foreground leading-snug">{displayTitle(selected)}</div>
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
                        <Row label="Status" value={dueLabel(selected) ?? "-"} highlight={selected.stale ? undefined : "warning"} />
                        <Row label="Minimum payment" value={p.min_payment != null ? fmtUSD(Number(p.min_payment), { cents: true }) : "-"} />
                        <Row label="Due date" value={fmtShortDate(p.due_date)} />
                      </>
                    )}

                    {/* Large txn / deposit / refund */}
                    {["large_txn", "deposit", "refund"].includes(selected.alert_type) && (
                      <>
                        <Row label="Merchant" value={p.merchant} />
                        <Row label="Amount" value={fmtUSD(Number(p.amount ?? 0), { cents: true })}
                          highlight={selected.alert_type === "large_txn" ? "warning" : "positive"} />
                        <Row label="Date" value={fmtShortDate(p.date)} />
                        {p.category && <Row label="Category" value={p.category} />}
                        {onOpenTransaction && p.transaction_id && (
                          <button onClick={() => { closeDetail(); onOpenTransaction(p.transaction_id); }}
                            className="w-full flex items-center justify-center gap-2 h-9 rounded-lg bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))] text-[12.5px] font-medium mt-2">
                            View transaction <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </>
                    )}

                    {/* Paycheck anomaly (on-device check, no push) */}
                    {selected.alert_type === "paycheck_anomaly" && (
                      <>
                        {p.kind === "misclassified" && <Row label="Other income this month" value={fmtUSD(Number(p.amount ?? 0), { cents: true })} highlight="warning" />}
                        {p.kind === "missing" && <>
                          <Row label="Paychecks this month" value={p.found ?? "-"} highlight="warning" />
                          <Row label="Usually" value={p.typical != null ? `~${p.typical}` : "-"} />
                        </>}
                        <div className="text-[11.5px] text-muted-foreground leading-relaxed">
                          {p.kind === "misclassified"
                            ? "If it is a paycheck, open the deposit in Spending and set its type to Paycheck."
                            : "If a deposit landed under another category, open it in Spending and set its type to Paycheck."}
                        </div>
                      </>
                    )}

                    {/* Insight */}
                    {selected.alert_type === "insight" && Array.isArray(p.insights) && (p.insights as { title?: string; what?: string; action?: string; impact?: string }[]).map((ins, i: number) => (
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

const Row = ({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: "positive" | "negative" | "warning" }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-[11.5px] text-muted-foreground">{label}</span>
    <span className={cn("text-[12.5px] font-semibold tabular",
      highlight === "positive" ? "text-positive" :
      highlight === "negative" ? "text-negative" :
      highlight === "warning" ? "text-warning" :
      "text-foreground")}>
      {value ?? "-"}
    </span>
  </div>
);
