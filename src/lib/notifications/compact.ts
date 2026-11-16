/**
 * Option B inbox: classify priority, pick the urgent strip, group by local
 * day, and collapse same-family stacks. Pure functions, unit-tested.
 */
import { daysUntilDue, type AlertLike } from "../notifications";
import type {
  CompactInboxModel, CompactItem, DayGroup, DigestRow, InboxPriority,
  StackFamily, StackRow, UrgentStripSelection,
} from "./types";

export type { CompactInboxModel, CompactItem, DayGroup, DigestRow, InboxPriority, StackFamily, StackRow, UrgentStripSelection };

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Local calendar-day difference from today (0 today, −1 yesterday). */
export function dayOffset(iso: string, now: Date = new Date()): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.round((dayStart(d) - dayStart(now)) / 86400000);
}

/** "Today" / "Yesterday" / "This week" / "Earlier". */
export function dayLabel(offset: number): string {
  if (offset === 0) return "Today";
  if (offset === -1) return "Yesterday";
  if (offset >= -6 && offset <= 0) return "This week";
  if (offset > 0) return "Upcoming";
  return "Earlier";
}

/** Compact relative time for a one-line row ("2h", "1d", "now"). */
export function compactAgo(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const h = Math.round((now.getTime() - t) / 3600000);
  if (h < 1) return "now";
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

/** "2h ago" for the detail sheet. */
export function compactAgoLong(iso: string, now: Date = new Date()): string {
  const short = compactAgo(iso, now);
  if (short === "now") return "Just now";
  if (short.endsWith("h")) return `${short} ago`;
  if (short.endsWith("d")) return `${short} ago`;
  return short;
}

/** Format an inbox amount. Uses a unicode minus to match the mockups. */
export function formatInboxAmount(n: number | null | undefined, isBalance = false): string {
  if (n == null || Number.isNaN(Number(n))) return "";
  const v = Number(n);
  if (isBalance) return `$${v.toLocaleString("en-US")}`;
  const sign = v < 0 ? "−$" : "+$";
  const abs = Math.abs(v);
  const frac = abs % 1 !== 0;
  return sign + abs.toLocaleString("en-US", { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 });
}

const BUFFER_DEFAULT = 500;

/**
 * Decide urgency when the source didn't already set it.
 *
 * Urgent (strip + Needs attention):
 *   shortfall; missed/overdue payment; payment due today or tomorrow;
 *   paycheck anomaly; available balance below $0 or the buffer;
 *   a "possible duplicate" insight.
 * Soon: due in 2–7 days; budget exceeded; history hint; large txn.
 * Info: deposits, payments posted, product notices, other insights.
 */
export function classifyPriority(item: {
  type: string;
  title?: string;
  payload?: Record<string, unknown> | null;
  amount?: number | null;
  priority?: InboxPriority | null;
}, now: Date = new Date()): InboxPriority {
  if (item.priority === "urgent" || item.priority === "soon" || item.priority === "info") {
    return item.priority;
  }
  const type = item.type;
  if (type === "shortfall" || type === "paycheck_anomaly") return "urgent";
  if (type === "payment_due") {
    const due = daysUntilDue({
      id: "", alert_type: "payment_due", title: item.title ?? "", body: "",
      payload: item.payload ?? {}, read_at: null, created_at: "",
    }, now);
    if (due != null && due <= 1) return "urgent";
    if (due != null && due <= 7) return "soon";
    return "info";
  }
  if (type === "low_balance") {
    const bal = Number(item.payload?.available ?? item.payload?.balance ?? item.amount ?? 0);
    const buffer = Number(item.payload?.buffer ?? item.payload?.threshold ?? BUFFER_DEFAULT);
    if (bal < 0) return "urgent";
    if (Number.isFinite(buffer) && bal < buffer) return "urgent";
    return "soon";
  }
  if (type === "budget_threshold" || type === "large_txn") return "soon";
  if (type === "insight" && /duplicate/i.test(item.title ?? "")) return "urgent";
  if (type === "promo" && /history/i.test(item.title ?? "")) return "soon";
  return "info";
}

/** Default stack family from the alert type (non-urgent bills / product nags). */
export function inferStack(item: { type: string; stack?: StackFamily | null; priority?: InboxPriority }): StackFamily | null {
  if (item.stack) return item.stack;
  if (item.priority === "urgent") return null;
  if (item.type === "payment_due") return "bills";
  if (item.type === "promo") return "product";
  return null;
}

/**
 * An unread urgent item may appear on the slim top-of-page strip.
 * Types that qualify (per RATIONALE + Option B mockup): shortfall, missing
 * paycheck, payment due today/tomorrow or missed, low balance, and other
 * items already classified urgent (e.g. a possible duplicate).
 */
export function isStripWorthy(item: CompactItem): boolean {
  return !item.read && !item.gone && item.priority === "urgent";
}

/**
 * Pick the single line for the urgent strip: the highest-ranked unread
 * urgent item, plus how many other urgent items are waiting ("+N more").
 */
export function selectUrgentStrip(items: CompactItem[], now: Date = new Date()): UrgentStripSelection | null {
  // Newest first (matches the Option B mockup: the most recently raised
  // urgent item leads the strip). Rank is only a tie-breaker.
  const all = [...items].filter(isStripWorthy).sort((a, b) =>
    new Date(b.at).getTime() - new Date(a.at).getTime() || stripRank(a, now) - stripRank(b, now));
  if (!all.length) return null;
  return { item: all[0], more: all.length - 1, all };
}

/** Lower is more urgent. */
export function stripRank(item: CompactItem, now: Date = new Date()): number {
  if (item.type === "shortfall") return 0;
  if (item.type === "payment_due") {
    const due = daysUntilDue({
      id: item.id, alert_type: "payment_due", title: item.title, body: item.body,
      payload: item.payload ?? {}, read_at: item.read ? item.at : null, created_at: item.at,
    }, now);
    if (due != null && due < 0) return 1;
    if (due === 0) return 2;
    if (due === 1) return 3;
    return 6;
  }
  if (item.type === "paycheck_anomaly") return 4;
  if (item.type === "low_balance") {
    const bal = Number(item.payload?.available ?? item.payload?.balance ?? item.amount ?? 0);
    if (bal < 0) return 2;
    return 5;
  }
  return 7;
}

export function groupByDay(items: CompactItem[], now: Date = new Date()): DayGroup[] {
  const days: DayGroup[] = [];
  const map = new Map<string, DayGroup>();
  const sorted = [...items].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  for (const it of sorted) {
    const day = dayOffset(it.at, now);
    const label = dayLabel(day);
    let g = map.get(label);
    if (!g) {
      g = { label, day, items: [] };
      map.set(label, g);
      days.push(g);
    }
    g.items.push(it);
  }
  return days;
}

/**
 * Collapse 2+ same-day, same-family, non-urgent items into a stack.
 * Urgent items are never folded. Stacks expand in place when `expanded` has
 * their key (`bills@Today`, `product@Today`, …).
 */
export function stackItems(items: CompactItem[], _expanded: ReadonlySet<string> = new Set()): DigestRow[] {
  const out: DigestRow[] = [];
  const used = new Set<string>();
  for (const it of items) {
    if (used.has(it.id)) continue;
    if (it.stack && it.priority !== "urgent") {
      const pack = items.filter(x => x.stack === it.stack && x.priority !== "urgent");
      if (pack.length >= 2) {
        pack.forEach(x => used.add(x.id));
        // key is rewritten by buildCompactInbox, which knows the day label
        out.push({ kind: "stack", key: it.stack, items: pack, stack: it.stack, day: 0 });
        continue;
      }
    }
    used.add(it.id);
    out.push({ kind: "item", item: it });
  }
  return out;
}

export function stackKey(stack: StackFamily, label: string): string {
  return `${stack}@${label}`;
}

export function stackTitle(row: { stack: StackFamily; items: CompactItem[] }): string {
  const n = row.items.length;
  if (row.stack === "bills") return `${n} bill reminder${n === 1 ? "" : "s"}`;
  if (row.stack === "product") return `${n} product update${n === 1 ? "" : "s"}`;
  return `${n} notification${n === 1 ? "" : "s"}`;
}

export function stackTotal(items: CompactItem[]): number | null {
  const nums = items.map(i => i.amount).filter((n): n is number => n != null);
  if (!nums.length) return null;
  return nums.reduce((s, n) => s + n, 0);
}

/**
 * Option B model: unread urgent items stay as a "Needs attention" list
 * (never stacked). Everything else is grouped by day; 2+ same-family items
 * collapse into a stack inside that day.
 */
export function buildCompactInbox(
  items: CompactItem[],
  opts: { filter?: "unread" | "all"; now?: Date; expanded?: ReadonlySet<string> } = {},
): CompactInboxModel {
  const now = opts.now ?? new Date();
  const filter = opts.filter ?? "unread";
  let list = items.filter(i => !i.gone);
  if (filter === "unread") list = list.filter(i => !i.read);
  const urgent = list.filter(i => i.priority === "urgent")
    .sort((a, b) => stripRank(a, now) - stripRank(b, now) || new Date(b.at).getTime() - new Date(a.at).getTime());
  const rest = list.filter(i => i.priority !== "urgent");
  const groups = groupByDay(rest, now).map(g => {
    const rows = stackItems(g.items).map(row => {
      if (row.kind !== "stack") return row;
      return { ...row, key: stackKey(row.stack, g.label), day: g.day };
    });
    return { label: g.label, day: g.day, items: g.items, rows };
  });
  return { urgent, groups };
}

/** Build a CompactItem from an alert_log / derived row. */
export function fromAlertLike(a: AlertLike, now: Date = new Date(), extras: Partial<CompactItem> = {}): CompactItem {
  const type = a.alert_type;
  const payload = (a.payload ?? {}) as Record<string, unknown>;
  const amount = amountFromPayload(type, payload);
  const draft: CompactItem = {
    id: a.id,
    type,
    priority: "info",
    title: a.title,
    body: a.body,
    amount,
    amountIsBalance: type === "low_balance",
    at: a.created_at,
    account: (payload.account_name as string | undefined) ?? (payload.account as string | undefined) ?? null,
    source: (payload.source as string | undefined) ?? null,
    status: (payload.status as string | undefined) ?? null,
    stack: null,
    read: !!a.read_at,
    gone: false,
    payload,
    ...extras,
  };
  draft.priority = classifyPriority(draft, now);
  draft.stack = inferStack(draft);
  return draft;
}

function amountFromPayload(type: string, payload: Record<string, unknown>): number | null {
  const keys = type === "low_balance"
    ? ["available", "balance", "amount"]
    : ["amount", "spent", "value"];
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

export const DEMO_INBOX_USER = "demo";
