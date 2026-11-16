import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as REPointerEvent } from "react";
import { SupabaseClient } from "@supabase/supabase-js";
import {
  Bell, X, CheckCheck, CreditCard, TrendingUp, AlertTriangle,
  Wallet, Lightbulb, DollarSign, RotateCcw, ArrowLeft, ArrowLeftRight,
  Sparkles, ChevronDown, ChevronUp, FlaskConical,
} from "lucide-react";
import { toast } from "sonner";
import { fmtShortDate } from "@/lib/format-date";
import { dueLabel } from "@/lib/notifications";
import {
  buildCompactInbox, compactAgo, compactAgoLong, formatInboxAmount, stackTitle, stackTotal,
  type CompactItem, type StackRow,
} from "@/lib/notifications/compact";
import { DEMO_INBOX_USER as DEMO_USER } from "@/lib/notifications/compact";
import { useInboxItems } from "@/hooks/useInboxItems";
import { openSettings } from "@/lib/settings-nav";
import { APK_DOWNLOAD_URL } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { fmtUSD } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Drawer, DrawerContent, DrawerTitle, DrawerDescription,
} from "@/components/ui/drawer";
import "./inbox.css";

/** Fired after alerts are marked read so the bell badge refreshes at once. */
export { ALERTS_READ_EVENT } from "@/lib/notifications/local-state";

interface Props {
  supabase: SupabaseClient | null;
  userId: string;
  open: boolean;
  onClose: () => void;
  onOpenTransaction?: (txnId: string) => void;
  demo?: boolean;
  /** Shared inbox model from the page (bell + strip). Falls back to its own hook. */
  inbox?: ReturnType<typeof useInboxItems>;
}

const ALERT_ICON: Record<string, React.ElementType> = {
  budget_threshold: Wallet,
  low_balance: AlertTriangle,
  payment_due: CreditCard,
  large_txn: DollarSign,
  deposit: TrendingUp,
  refund: RotateCcw,
  insight: Lightbulb,
  cc_payment_posted: CheckCheck,
  transfer: ArrowLeftRight,
  paycheck_anomaly: AlertTriangle,
  promo: Sparkles,
  shortfall: AlertTriangle,
};

const ALERT_COLOR: Record<string, string> = {
  budget_threshold: "fl-amber",
  low_balance: "fl-red",
  payment_due: "fl-gold",
  large_txn: "fl-amber",
  deposit: "fl-green",
  refund: "fl-green",
  insight: "fl-gold",
  cc_payment_posted: "fl-green",
  transfer: "fl-mute",
  paycheck_anomaly: "fl-amber",
  promo: "fl-info",
  shortfall: "fl-red",
};

function useNarrow() {
  const [n, setN] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const on = () => setN(mql.matches);
    on();
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, []);
  return n;
}

export const NotificationInbox = (props: Props) => {
  if (props.inbox) return <InboxUI {...props} inbox={props.inbox} />;
  return <InboxWithHook {...props} />;
};

function InboxWithHook(props: Props) {
  const uid = props.userId || (props.demo ? DEMO_USER : "");
  const inbox = useInboxItems({ userId: uid, demo: !!props.demo, supabase: props.supabase, open: props.open });
  return <InboxUI {...props} inbox={inbox} />;
}

function InboxUI({
  supabase, userId, open, onClose, onOpenTransaction, demo = false, inbox,
}: Props & { inbox: NonNullable<Props["inbox"]> }) {
  const { items, loading, now, markRead, markAllRead, dismiss } = inbox;
  const [filter, setFilter] = useState<"unread" | "all">("unread");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<CompactItem | null>(null);
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const mobile = useNarrow();
  const pushed = useRef(0);
  const closingFromPop = useRef(false);
  const selectedRef = useRef<CompactItem | null>(null);
  selectedRef.current = selected;

  const model = useMemo(
    () => buildCompactInbox(items, { filter, now, expanded, pinIds: pinned }),
    [items, filter, now, expanded, pinned],
  );
  const anyUnread = items.some(i => !i.read && !i.gone);

  const pushHist = (tag: string) => {
    try {
      window.history.pushState({ ...(window.history.state ?? {}), nc: tag }, "");
      pushed.current += 1;
    } catch { /* sandboxed */ }
  };
  const consumeHist = () => {
    if (pushed.current <= 0) return;
    const n = pushed.current;
    pushed.current = 0;
    closingFromPop.current = true;
    try { window.history.go(-n); } catch { /* ignore */ }
  };

  useEffect(() => {
    const onPop = () => {
      if (closingFromPop.current) { closingFromPop.current = false; return; }
      if (pushed.current <= 0) return;
      if (selectedRef.current) {
        closeDetail();
        // The inbox entry was the one that popped; put it back so another
        // Back still closes the panel. Don't bump `pushed` — we replaced it.
        try { window.history.pushState({ ...(window.history.state ?? {}), nc: "inbox" }, ""); } catch { /* sandboxed */ }
        return;
      }
      pushed.current = 0;
      onClose();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [selected, onClose]);

  useEffect(() => {
    if (open) pushHist("inbox");
    else if (pushed.current > 0 && !closingFromPop.current) {
      const n = pushed.current; pushed.current = 0; window.history.go(-n);
    }
    if (!open) { setSelected(null); setExpanded(new Set()); setPinned(new Set()); }
  }, [open]);

  useEffect(() => () => {
    if (pushed.current > 0) { const n = pushed.current; pushed.current = 0; window.history.go(-n); }
  }, []);

  const closePanel = () => {
    if (selected) { closeDetail(); return; }
    consumeHist();
    onClose();
  };

  const openItem = async (item: CompactItem) => {
    setSelected(item);
    setPinned(s => { const n = new Set(s); n.add(item.id); return n; });
    if (!item.read) await markRead([item.id]);
  };

  const closeDetail = () => {
    if (!selectedRef.current) return;
    selectedRef.current = null;
    setSelected(null);
  };


  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (selectedRef.current) {
      closeDetail();
      e.preventDefault();
      e.stopImmediatePropagation();
    } else if (open) {
      closePanel();
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onKey]);

  const toggleStack = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const list = (
    <InboxList
      loading={loading}
      filter={filter}
      model={model}
      expanded={expanded}
      now={now}
      onOpen={openItem}
      onToggle={toggleStack}
      onRead={id => { void markRead([id]); }}
      onDismiss={id => { void dismiss([id]); toast("Notification dismissed"); }}
    />
  );

  const tools = (
    <div className="nc-tools">
      <div className="nc-seg" role="group" aria-label="Filter">
        <button type="button" className="tap-44" data-nc-filter="unread" aria-pressed={filter === "unread"} onClick={() => setFilter("unread")}>Unread</button>
        <button type="button" className="tap-44" data-nc-filter="all" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
      </div>
      <button type="button" className="nc-mark tap-44 min-h-11" data-nc-all onClick={() => { void markAllRead(); }} disabled={!anyUnread}>
        <CheckCheck className="h-4 w-4" aria-hidden="true" /> Mark all read
      </button>
    </div>
  );

  const header = (opts: { closeLabel: string; closeIcon: "back" | "x" }) => (
    <div className="nc-head">
      {opts.closeIcon === "back" && (
        <button type="button" className="nc-ib tap-44 h-11 w-11" onClick={closePanel} aria-label={opts.closeLabel} data-nc-close>
          <ArrowLeft className="h-5 w-5" />
        </button>
      )}
      <h2 id="nc-title">Notifications</h2>
      {demo && <span className="nc-example" data-testid="example-data-inbox"><FlaskConical className="h-3 w-3" aria-hidden="true" />Example data</span>}
      {opts.closeIcon === "x" && (
        <button type="button" className="nc-ib tap-44 h-11 w-11 hidden md:grid" onClick={closePanel} aria-label={opts.closeLabel} data-nc-close>
          <X className="h-5 w-5" />
        </button>
      )}
    </div>
  );

  const detail = selected ? (
    <DetailSheet
      item={selected}
      now={now}
      mobile={mobile}
      onClose={closeDetail}
      onDone={() => { void markRead([selected.id]); closeDetail(); toast("Marked done"); }}
      onDismiss={() => { void dismiss([selected.id]); closeDetail(); toast("Notification dismissed"); }}
      onOpenTransaction={onOpenTransaction}
    />
  ) : null;

  if (mobile) {
    return (
      <>
        <Drawer open={open} onOpenChange={o => { if (!o) closePanel(); }} dismissible={!selected} shouldScaleBackground={false}>
          <DrawerContent
            showClose
            closeLabel="Close notifications"
            className="h-[96dvh] max-h-[96dvh] rounded-t-[20px] bg-background p-0"
            data-testid="inbox-panel"
          >
            <DrawerTitle className="sr-only">Notifications</DrawerTitle>
            <DrawerDescription className="sr-only">Your financial alerts and notifications</DrawerDescription>
            {header({ closeLabel: "Back", closeIcon: "back" })}
            {tools}
            {list}
          </DrawerContent>
        </Drawer>
        {detail}
      </>
    );
  }

  return (
    <>
      <div className={cn("nc-bd", open && "on")} onClick={closePanel} aria-hidden={!open} />
      <aside
        id="nc-panel"
        className={cn("nc-panel", open && "on")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nc-title"
        data-testid="inbox-panel"
        aria-hidden={!open}
      >
        {header({ closeLabel: "Close", closeIcon: "x" })}
        {tools}
        {list}
      </aside>
      {detail}
    </>
  );
};

function InboxList({
  loading, filter, model, expanded, now, onOpen, onToggle, onRead, onDismiss,
}: {
  loading: boolean;
  filter: "unread" | "all";
  model: ReturnType<typeof buildCompactInbox>;
  expanded: Set<string>;
  now: Date;
  onOpen: (item: CompactItem) => void;
  onToggle: (key: string) => void;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="nc-body p-5 space-y-4" role="status" aria-label="Loading notifications">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-7 w-7 rounded-lg" />
            <Skeleton className="h-3.5 flex-1" />
          </div>
        ))}
      </div>
    );
  }
  const empty = model.urgent.length === 0 && model.groups.length === 0;
  if (empty) {
    return (
      <div className="nc-body">
        <EmptyState className="py-10" icon={<Bell />}
          title={filter === "unread" ? "No unread notifications" : "No notifications yet"}
          description={filter === "unread"
            ? "Switch to All to see earlier notifications."
            : "Alerts for balances, bills and paychecks will appear here."} />
      </div>
    );
  }
  return (
    <div className="nc-body" data-testid="inbox-list">
      {model.urgent.length > 0 && (
        <>
          <div className="nc-day">Needs attention</div>
          {model.urgent.map(it => (
            <InboxRow key={it.id} item={it} now={now} onOpen={() => onOpen(it)} onRead={() => onRead(it.id)} onDismiss={() => onDismiss(it.id)} />
          ))}
        </>
      )}
      {model.groups.map(g => (
        <article key={g.label} className="nc-digest" data-testid="inbox-digest">
          <h3>{g.label}<span className="ml-auto text-[12px] font-medium text-muted-foreground">{g.items.length} item{g.items.length === 1 ? "" : "s"}</span></h3>
          {g.rows.map(row => row.kind === "stack"
            ? <StackBlock key={row.key} row={row} open={expanded.has(row.key)} now={now} onToggle={() => onToggle(row.key)} onOpen={onOpen} onRead={onRead} onDismiss={onDismiss} />
            : <InboxRow key={row.item.id} item={row.item} now={now} onOpen={() => onOpen(row.item)} onRead={() => onRead(row.item.id)} onDismiss={() => onDismiss(row.item.id)} />)}
        </article>
      ))}
    </div>
  );
}

function StackBlock({
  row, open, now, onToggle, onOpen, onRead, onDismiss,
}: {
  row: StackRow; open: boolean; now: Date;
  onToggle: () => void;
  onOpen: (item: CompactItem) => void;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const total = stackTotal(row.items);
  return (
    <>
      <button type="button" className="nc-stack tap-44" data-testid="inbox-stack" data-nc-stack={row.key} aria-expanded={open} onClick={onToggle}>
        <div className="stack-ics">
          {row.items.slice(0, 3).map(i => {
            const Icon = ALERT_ICON[i.type] ?? Bell;
            return <div key={i.id} className={cn("ic", ALERT_COLOR[i.type] ?? "fl-mute")}><Icon className="h-3 w-3" /></div>;
          })}
        </div>
        <div className="t">{stackTitle(row)}</div>
        {total != null && <span className="amt">{formatInboxAmount(total)}</span>}
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="nc-stack-kids">
          {row.items.map(it => (
            <InboxRow key={it.id} item={it} now={now} onOpen={() => onOpen(it)} onRead={() => onRead(it.id)} onDismiss={() => onDismiss(it.id)} />
          ))}
        </div>
      )}
    </>
  );
}

function InboxRow({
  item, now, onOpen, onRead, onDismiss,
}: {
  item: CompactItem; now: Date;
  onOpen: () => void; onRead: () => void; onDismiss: () => void;
}) {
  const Icon = ALERT_ICON[item.type] ?? Bell;
  const color = ALERT_COLOR[item.type] ?? "fl-mute";
  const amt = formatInboxAmount(item.amount, item.amountIsBalance);
  const [dx, setDx] = useState(0);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const axis = useRef<"h" | "v" | null>(null);

  const reset = () => { setDx(0); startX.current = null; startY.current = null; axis.current = null; };
  const onDown = (e: REPointerEvent<HTMLButtonElement>) => {
    startX.current = e.clientX; startY.current = e.clientY; axis.current = null;
    (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: REPointerEvent<HTMLButtonElement>) => {
    if (startX.current == null || startY.current == null) return;
    const x = e.clientX - startX.current;
    const y = e.clientY - startY.current;
    if (!axis.current && Math.abs(x) + Math.abs(y) > 8) axis.current = Math.abs(x) > Math.abs(y) ? "h" : "v";
    if (axis.current === "h") setDx(x);
  };
  const onUp = () => {
    if (axis.current === "h") {
      if (dx > 72) onRead();
      else if (dx < -72) onDismiss();
    }
    reset();
  };

  return (
    <div className="relative">
      {dx !== 0 && (
        <div className={cn("nc-swipe-bg", dx < 0 ? "left" : "right")} aria-hidden="true">
          {dx < 0 ? "Dismiss" : "Mark read"}
        </div>
      )}
      <button
        type="button"
        className={cn("nc-row tap-44", item.read ? "read" : "unread", dx !== 0 && "swiping")}
        data-testid="inbox-row"
        data-nc-item={item.id}
        onClick={() => { if (axis.current === "h") return; onOpen(); }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={reset}
        onKeyDown={e => { if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onDismiss(); } }}
        style={dx !== 0 ? { transform: `translateX(${dx}px)` } : undefined}
      >
        <div className={cn("ic", color)}><Icon className="h-3.5 w-3.5" /></div>
        <div className="t">
          {item.priority === "urgent" && !item.read && <span className="chip chip-negative !py-0 !px-1.5 !text-[10px]">Urgent</span>}
          <span>{item.title}</span>
        </div>
        {amt && <span className={cn("amt", item.amountIsBalance || (item.amount ?? 0) < 0 ? "text-negative" : item.amount && item.amount > 0 ? "text-positive" : "")}>{amt}</span>}
        <span className="when">{compactAgo(item.at, now)}</span>
        {!item.read && <span className="dot" aria-hidden="true" />}
        <span className="sr-only">Swipe left or press Delete to dismiss</span>
      </button>
    </div>
  );
}

function DetailSheet({
  item, now, mobile, onClose, onDone, onDismiss, onOpenTransaction,
}: {
  item: CompactItem; now: Date; mobile: boolean;
  onClose: () => void; onDone: () => void; onDismiss: () => void;
  onOpenTransaction?: (txnId: string) => void;
}) {
  const Icon = ALERT_ICON[item.type] ?? Bell;
  const color = ALERT_COLOR[item.type] ?? "fl-mute";
  const p = (item.payload ?? {}) as Record<string, unknown>;
  const amt = formatInboxAmount(item.amount, item.amountIsBalance);

  const body = (
    <div className="px-5 pb-2">
      <div className={cn("h-11 w-11 rounded-xl grid place-items-center mb-3", color)}>
        <Icon className="h-5 w-5" />
      </div>
      {amt && <div className={cn("font-display text-[28px] font-semibold tabular leading-tight", item.amountIsBalance || (item.amount ?? 0) < 0 ? "text-negative" : "text-foreground")}>{amt}</div>}
      <p className="text-[14px] text-muted-foreground mt-2 leading-relaxed">{item.body}</p>
      <div className="nc-kv">
        {item.status && <><div>Expected</div><div>{String(item.status)}</div></>}
        {item.source && <><div>Source</div><div>{item.source}</div></>}
        {item.account && <><div>Account</div><div>{item.account}</div></>}
        <div>Priority</div><div className="capitalize">{item.priority}</div>
        <div>When</div><div>{compactAgoLong(item.at, now)}</div>
        {item.type === "budget_threshold" && p.budget != null && (
          <>
            <div>Category</div><div>{String(p.category ?? "—")}</div>
            <div>Budget</div><div>{fmtUSD(Number(p.budget))}</div>
            <div>Spent</div><div>{fmtUSD(Number(p.spent ?? 0))}</div>
          </>
        )}
        {item.type === "low_balance" && (
          <><div>Available</div><div>{fmtUSD(Number(p.available ?? p.balance ?? item.amount ?? 0))}</div></>
        )}
        {item.type === "payment_due" && (
          <>
            <div>Status</div><div>{dueLabel({ id: item.id, alert_type: "payment_due", title: item.title, body: item.body, payload: item.payload ?? {}, read_at: item.read ? item.at : null, created_at: item.at }, now) ?? item.status ?? "—"}</div>
            {(p.min_payment != null || p.minimum != null) && <><div>Minimum</div><div>{fmtUSD(Number(p.min_payment ?? p.minimum), { cents: true })}</div></>}
            {p.due_date != null && <><div>Due date</div><div>{fmtShortDate(String(p.due_date))}</div></>}
          </>
        )}
        {item.type === "paycheck_anomaly" && (
          <>
            {p.kind === "missing" && <><div>Paychecks this month</div><div>{String(p.found ?? "—")}</div><div>Usually</div><div>{p.typical != null ? `~${p.typical}` : "—"}</div></>}
            {p.kind === "misclassified" && <><div>Other income this month</div><div>{fmtUSD(Number(p.amount ?? 0), { cents: true })}</div></>}
          </>
        )}
      </div>
      {item.type === "promo" && item.id === "promo:apk" && (
        <a href={APK_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer"
          className="mt-4 flex items-center justify-center min-h-11 rounded-xl bg-gold text-[14px] font-semibold">
          Download the Android app
        </a>
      )}
      {item.type === "promo" && item.id === "promo:history" && (
        <button type="button" className="mt-4 w-full min-h-11 rounded-xl bg-gold text-[14px] font-semibold"
          onClick={() => { onClose(); openSettings("banks"); }}>
          Extend history
        </button>
      )}
      {item.type === "promo" && item.id === "promo:demo" && (
        <button type="button" className="mt-4 w-full min-h-11 rounded-xl bg-gold text-[14px] font-semibold"
          onClick={() => { onClose(); window.location.assign("/auth"); }}>
          Create free account
        </button>
      )}
      {onOpenTransaction && p.transaction_id && (
        <button type="button" className="mt-4 w-full min-h-11 rounded-xl bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))] text-[13px] font-semibold"
          onClick={() => { onClose(); onOpenTransaction(String(p.transaction_id)); }}>
          View transaction
        </button>
      )}
      <div className="nc-sheet-actions">
        <button type="button" className="primary tap-44" onClick={onDone}><CheckCheck className="h-4 w-4" /> Mark done</button>
        <button type="button" className="ghost tap-44" onClick={onDismiss}><X className="h-4 w-4" /> Dismiss</button>
      </div>
    </div>
  );

  if (mobile) {
    return (
      <Drawer open onOpenChange={o => { if (!o) onClose(); }} shouldScaleBackground={false}>
        <DrawerContent showClose closeLabel="Close" className="max-h-[88dvh] rounded-t-[20px] bg-background p-0" data-testid="inbox-detail">
          <div className="flex items-start gap-2 px-2 pt-1 pb-2">
            <DrawerTitle className="font-display text-[20px] font-semibold leading-snug flex-1 px-3 pt-2">{item.title}</DrawerTitle>
          </div>
          <DrawerDescription className="sr-only">{item.body}</DrawerDescription>
          {body}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Drawer open onOpenChange={o => { if (!o) onClose(); }} shouldScaleBackground={false}>
      <DrawerContent showClose closeLabel="Close" className="md:left-auto md:right-[420px] md:bottom-auto md:top-1/2 md:w-[min(420px,calc(100vw-500px))] md:max-h-[min(760px,86dvh)] md:rounded-[18px] md:translate-y-[-50%] p-0" data-testid="inbox-detail">
        <div className="flex items-start gap-2 px-2 pt-3 pb-2">
          <DrawerTitle className="font-display text-[20px] font-semibold leading-snug flex-1 px-3">{item.title}</DrawerTitle>
        </div>
        <DrawerDescription className="sr-only">{item.body}</DrawerDescription>
        {body}
      </DrawerContent>
    </Drawer>
  );
}

