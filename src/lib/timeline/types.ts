/**
 * Timeline sidebar types. Pure TS (no React / Supabase) so the logic here is
 * unit-tested and shared by the live (Supabase) and demo sources.
 */
import type { TxnType } from "@/lib/classify";

/** Filter chip a past event belongs to ("transfer" is shown under All only). */
export type TimelineCategory =
  | "income" | "bills" | "cards" | "savings" | "taxes" | "alerts" | "spending" | "transfer";

/** A chip the user can toggle. "upcoming" controls the projected section. */
export type TimelineChip = Exclude<TimelineCategory, "transfer"> | "upcoming";

export const TIMELINE_CHIPS: TimelineChip[] = [
  "income", "bills", "cards", "savings", "taxes", "alerts", "spending", "upcoming",
];

export type TimelineStatus =
  | "received" | "paid" | "posted" | "moved" | "pending" | "review" | "flag"
  | "seen" | "done" | "info" | "late" | "expected" | "not_covered";

export type TimelineSource = "transaction" | "occurrence" | "alert" | "inference" | "tax_milestone" | "upcoming";

/** One row of public.timeline_events (or a projected upcoming item). */
export interface TimelineEvent {
  /** Source-prefixed id: txn:…, occ:…, alert:…, inf:…, tax:…, up:… */
  id: string;
  source: TimelineSource;
  source_id: string;
  /** Local calendar day the event belongs to (YYYY-MM-DD). */
  occurred_on: string;
  /** ISO timestamp (date-only rows are 12:00 UTC on that day). */
  occurred_at: string;
  category: TimelineCategory;
  txn_type: TxnType | null;
  is_internal: boolean;
  title: string;
  subtitle: string | null;
  /** Signed from the user's view: + money in, − money out. */
  amount: number | null;
  account_id: string | null;
  status: TimelineStatus;
  stream_id: string | null;
  pending: boolean;
  meta: Record<string, unknown>;
  /** Projected (Upcoming) items only. */
  upcoming?: boolean;
  estimated?: boolean;
  covered_by?: string | null;
  repeats?: string | null;
}

/** Keyset cursor: rows strictly older than (on, at, id). at=null → before the whole day. */
export interface TimelineCursor {
  on: string;
  at: string | null;
  id: string | null;
}

export interface TimelineFilters {
  /** Selected chips; empty = All. */
  chips: TimelineChip[];
  includeInternal: boolean;
  /** Jump-to-date (YYYY-MM-DD): show history from this day back; hides Upcoming. */
  at: string | null;
}

export interface TimelinePage {
  items: TimelineEvent[];
  next_cursor: TimelineCursor | null;
}

export const TIMELINE_PAGE_SIZE = 25;
