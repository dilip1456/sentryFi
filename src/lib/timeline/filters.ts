import type { TimelineCategory, TimelineChip, TimelineEvent, TimelineFilters } from "./types";

export const DEFAULT_FILTERS: TimelineFilters = { chips: [], includeInternal: false, at: null };

/** Past-event categories selected by the chips ([] = all). */
export function historyCategories(f: Pick<TimelineFilters, "chips">): TimelineCategory[] {
  return f.chips.filter((c): c is Exclude<TimelineChip, "upcoming"> => c !== "upcoming");
}

/** Upcoming shows when not jumped to a date and All or the Upcoming chip is on. */
export const showUpcoming = (f: TimelineFilters) => !f.at && (f.chips.length === 0 || f.chips.includes("upcoming"));

/** History hides only when Upcoming is the sole chip. */
export const showHistory = (f: TimelineFilters) => !(f.chips.length === 1 && f.chips[0] === "upcoming");

/**
 * Does an event pass the filters? Same rule as timeline_page(): internal
 * transfers only with the toggle on (and then regardless of chips).
 */
export function matchesFilters(e: Pick<TimelineEvent, "category" | "is_internal">, cats: TimelineCategory[], includeInternal: boolean): boolean {
  if (e.is_internal && !includeInternal) return false;
  if (!cats.length) return true;
  return cats.includes(e.category) || (includeInternal && e.is_internal);
}

/** Upcoming items: chip categories other than "upcoming" narrow them too. */
export function matchesUpcoming(e: Pick<TimelineEvent, "category" | "is_internal">, f: TimelineFilters): boolean {
  return matchesFilters(e, historyCategories(f), f.includeInternal);
}

/** Toggle a chip ("all" clears). */
export function toggleChip(chips: TimelineChip[], c: TimelineChip | "all"): TimelineChip[] {
  if (c === "all") return [];
  return chips.includes(c) ? chips.filter(x => x !== c) : [...chips, c];
}

/** Badge count on the Filters button. */
export const activeFilterCount = (f: TimelineFilters) => f.chips.length + (f.includeInternal ? 1 : 0);

/** Stable react-query key part. */
export const filtersKey = (f: TimelineFilters) => ({
  types: [...historyCategories(f)].sort(),
  includeInternal: f.includeInternal,
  at: f.at,
});
