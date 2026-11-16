/**
 * Compact inbox item used by Option B (priority + digest).
 * Pure data — no React.
 */
export type InboxPriority = "urgent" | "soon" | "info";
export type StackFamily = "bills" | "product";

export interface CompactItem {
  id: string;
  type: string;
  priority: InboxPriority;
  title: string;
  body: string;
  amount: number | null;
  /** When true, `amount` is a balance (no +/−, shown in the negative color). */
  amountIsBalance?: boolean;
  at: string;
  account?: string | null;
  source?: string | null;
  status?: string | null;
  stack: StackFamily | null;
  read: boolean;
  gone?: boolean;
  payload?: Record<string, unknown> | null;
}

export interface DayGroup {
  label: string;
  /** Days from today (0 today, −1 yesterday, …). */
  day: number;
  items: CompactItem[];
}

export type StackRow = {
  kind: "stack";
  key: string;
  stack: StackFamily;
  items: CompactItem[];
  day: number;
};

export type ItemRow = { kind: "item"; item: CompactItem };
export type DigestRow = StackRow | ItemRow;

export interface UrgentStripSelection {
  item: CompactItem;
  /** Other unread urgent items, not including `item`. */
  more: number;
  /** All unread urgent items, `item` first. */
  all: CompactItem[];
}

export interface CompactInboxModel {
  urgent: CompactItem[];
  groups: { label: string; day: number; items: CompactItem[]; rows: DigestRow[] }[];
}
