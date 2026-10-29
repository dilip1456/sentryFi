import { compareEventsDesc, cursorForJump, isBeforeCursor, toPage } from "./cursor";
import { historyCategories, matchesFilters } from "./filters";
import type { TimelineCursor, TimelineEvent, TimelineFilters, TimelinePage } from "./types";
import { TIMELINE_PAGE_SIZE } from "./types";

/**
 * In-memory keyset page with the exact semantics of public.timeline_page():
 * used by the demo source and as the reference the SQL is tested against.
 */
export function paginateEvents(
  all: TimelineEvent[],
  cursor: TimelineCursor | null,
  filters: TimelineFilters,
  limit = TIMELINE_PAGE_SIZE,
): TimelinePage {
  const cats = historyCategories(filters);
  const c = cursor ?? (filters.at ? cursorForJump(filters.at) : null);
  const rows = all
    .filter(e => isBeforeCursor(e, c) && matchesFilters(e, cats, filters.includeInternal))
    .sort(compareEventsDesc)
    .slice(0, limit + 1);
  return toPage(rows, limit);
}
