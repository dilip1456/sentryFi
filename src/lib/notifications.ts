/**
 * Pure helpers for the notification inbox (dedupe, stale "payment due"
 * alerts, display text). No React/Supabase so they're unit-tested.
 */
import { toLocalDate, fmtShortDate } from "./format-date";

export interface AlertLike {
  id: string;
  alert_type: string;
  title: string;
  body: string;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

export type InboxAlert<T extends AlertLike = AlertLike> = T & {
  /** Older identical alerts folded into this one (same type, title and body). */
  duplicates: T[];
  /** A due-date alert whose due date has passed. */
  stale: boolean;
};

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Days from today until the alert's due date (negative once past). */
export function daysUntilDue(a: AlertLike, now: Date = new Date()): number | null {
  const due = toLocalDate((a.payload?.due_date as string | undefined) ?? null);
  if (!due) return null;
  return Math.round((dayStart(due) - dayStart(now)) / 86400000);
}

export function isStaleDue(a: AlertLike, now: Date = new Date()): boolean {
  if (a.alert_type !== "payment_due") return false;
  const d = daysUntilDue(a, now);
  return d != null && d < 0;
}

/** "Due today" / "Due tomorrow" / "Due in 3 days" / "Was due Oct 15". */
export function dueLabel(a: AlertLike, now: Date = new Date()): string | null {
  const d = daysUntilDue(a, now);
  if (d == null) return null;
  if (d < 0) return `Was due ${fmtShortDate(a.payload?.due_date as string, now)}`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due in ${d} days`;
}

const dedupeKey = (a: AlertLike) => {
  // Payment-due titles bake in "in 3d", so key those by account + due date.
  if (a.alert_type === "payment_due") return `due|${a.payload?.account_id ?? ""}|${a.payload?.due_date ?? a.title}`;
  if (a.alert_type === "low_balance") return `low|${a.payload?.account_id ?? a.title}`;
  return `${a.alert_type}|${a.title.trim().toLowerCase()}|${a.body.trim().toLowerCase()}`;
};

/**
 * Newest first; identical alerts collapse into the newest one (older copies
 * listed in `duplicates`); stale due alerts sink below current ones.
 */
export function prepareInbox<T extends AlertLike>(alerts: T[], now: Date = new Date()): InboxAlert<T>[] {
  const sorted = [...alerts].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const byKey = new Map<string, InboxAlert<T>>();
  const out: InboxAlert<T>[] = [];
  for (const a of sorted) {
    const k = dedupeKey(a);
    const head = byKey.get(k);
    if (head) { head.duplicates.push(a); continue; }
    const item = { ...a, duplicates: [] as T[], stale: isStaleDue(a, now) } as InboxAlert<T>;
    byKey.set(k, item);
    out.push(item);
  }
  return [...out.filter(a => !a.stale), ...out.filter(a => a.stale)];
}

/** Unread = the alert or any folded duplicate is unread, and it isn't stale. */
export const isUnread = (a: InboxAlert) => !a.stale && (!a.read_at || a.duplicates.some(d => !d.read_at));

/** Every row id behind an inbox item (for marking read). */
export const allIds = (a: InboxAlert) => [a.id, ...a.duplicates.map(d => d.id)];
