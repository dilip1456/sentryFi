import type { TimelineEvent } from "./types";

/**
 * Flatten upcoming items + loaded history pages into display rows:
 *
 *   [upcoming header] [upcoming items… furthest first] [today marker]
 *   [month header] [day header] [event]…
 *
 * Upcoming sits ABOVE the Today marker; history below. When the user jumped
 * to a date there is no Upcoming and no Today marker (a "Showing from" bar
 * replaces them).
 */
export type TimelineRow =
  | { kind: "upcoming-header"; key: string; count: number }
  | { kind: "upcoming-empty"; key: string }
  | { kind: "today"; key: string; date: string }
  | { kind: "month"; key: string; month: string }
  | { kind: "day"; key: string; date: string }
  | { kind: "event"; key: string; event: TimelineEvent; ghost: boolean };

export const monthKey = (d: string) => d.slice(0, 7);

export function buildTimelineRows(opts: {
  today: string;
  upcoming: TimelineEvent[] | null;
  history: TimelineEvent[];
  showToday: boolean;
}): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const { today, upcoming, history, showToday } = opts;
  if (upcoming) {
    rows.push({ kind: "upcoming-header", key: "up-h", count: upcoming.length });
    if (!upcoming.length) rows.push({ kind: "upcoming-empty", key: "up-empty" });
    // furthest first so the soonest item sits right above Today
    const sorted = [...upcoming].sort((a, b) => (a.occurred_on === b.occurred_on ? (a.id < b.id ? 1 : -1) : a.occurred_on < b.occurred_on ? 1 : -1));
    for (const e of sorted) rows.push({ kind: "event", key: e.id, event: e, ghost: true });
  }
  if (showToday) rows.push({ kind: "today", key: "today", date: today });
  let month = "", day = "";
  const seen = new Set<string>();
  for (const e of history) {
    if (seen.has(e.id)) continue; // a realtime prepend can overlap a page boundary
    seen.add(e.id);
    const m = monthKey(e.occurred_on);
    if (m !== month) { month = m; day = ""; rows.push({ kind: "month", key: `m-${m}`, month: m }); }
    if (e.occurred_on !== day) { day = e.occurred_on; rows.push({ kind: "day", key: `d-${day}`, date: day }); }
    rows.push({ kind: "event", key: e.id, event: e, ghost: false });
  }
  return rows;
}
