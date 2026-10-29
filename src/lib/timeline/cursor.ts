import type { TimelineCursor, TimelineEvent } from "./types";
import { addDays } from "@/lib/recurring/dates";

/** Newest first: occurred_on desc, occurred_at desc, id desc (same as SQL). */
export function compareEventsDesc(a: Pick<TimelineEvent, "occurred_on" | "occurred_at" | "id">, b: Pick<TimelineEvent, "occurred_on" | "occurred_at" | "id">): number {
  if (a.occurred_on !== b.occurred_on) return a.occurred_on < b.occurred_on ? 1 : -1;
  const ta = Date.parse(a.occurred_at), tb = Date.parse(b.occurred_at);
  if (ta !== tb) return ta < tb ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

/** Cursor pointing just past an event (the next page starts strictly after it). */
export const cursorAfter = (e: Pick<TimelineEvent, "occurred_on" | "occurred_at" | "id" | "at_exact">): TimelineCursor =>
  ({ on: e.occurred_on, at: e.at_exact ?? e.occurred_at, id: e.id });

/** Jump-to-date: everything on or before `at` (cursor = start of the next day). */
export const cursorForJump = (at: string): TimelineCursor => ({ on: addDays(at, 1), at: null, id: null });

/** Is the event strictly older than the cursor? (SQL: (on, at, id) < cursor.) */
export function isBeforeCursor(e: Pick<TimelineEvent, "occurred_on" | "occurred_at" | "id">, c: TimelineCursor | null): boolean {
  if (!c) return true;
  if (e.occurred_on !== c.on) return e.occurred_on < c.on;
  if (c.at == null) return false;
  const te = Date.parse(e.occurred_at), tc = Date.parse(c.at);
  if (te !== tc) return te < tc;
  return e.id < (c.id ?? "");
}

/** Opaque string form for query keys / URLs. */
export function encodeCursor(c: TimelineCursor | null): string {
  if (!c) return "";
  return [c.on, c.at ?? "", c.id ?? ""].map(encodeURIComponent).join("|");
}

export function decodeCursor(s: string | null | undefined): TimelineCursor | null {
  if (!s) return null;
  const [on, at, id] = s.split("|").map(decodeURIComponent);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on ?? "")) return null;
  return { on, at: at || null, id: id || null };
}

/**
 * Turn a fetched batch (asked for limit + 1 rows) into a page: the extra row
 * only tells us more exist.
 */
export function toPage(rows: TimelineEvent[], limit: number): { items: TimelineEvent[]; next_cursor: TimelineCursor | null } {
  const items = rows.slice(0, limit);
  const next_cursor = rows.length > limit && items.length ? cursorAfter(items[items.length - 1]) : null;
  return { items, next_cursor };
}
