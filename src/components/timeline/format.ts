import {
  ArrowLeftRight, Banknote, CalendarClock, CircleAlert, CircleCheck, Clock, CreditCard, Info, Landmark,
  PiggyBank, Receipt, ShoppingBag, TriangleAlert, type LucideIcon,
} from "lucide-react";
import { STATUS_TONE, type TimelineCategory, type TimelineChip, type TimelineEvent, type TimelineStatus, type UpcomingAccount } from "@/lib/timeline";

export const CAT_ICON: Record<TimelineCategory, LucideIcon> = {
  income: Banknote, bills: Receipt, cards: CreditCard, savings: PiggyBank, taxes: Landmark,
  alerts: TriangleAlert, spending: ShoppingBag, transfer: ArrowLeftRight,
};
export const CHIP_LABEL: Record<TimelineChip, string> = {
  income: "Income", bills: "Bills", cards: "Cards", savings: "Savings", taxes: "Taxes",
  alerts: "Alerts", spending: "Spending", upcoming: "Upcoming",
};
export const CHIP_ICON: Record<TimelineChip, LucideIcon> = {
  income: Banknote, bills: Receipt, cards: CreditCard, savings: PiggyBank, taxes: Landmark,
  alerts: TriangleAlert, spending: ShoppingBag, upcoming: CalendarClock,
};

export const STATUS_ICON: Record<TimelineStatus, LucideIcon> = {
  received: CircleCheck, paid: CircleCheck, posted: CircleCheck, moved: CircleCheck, done: CircleCheck,
  pending: Clock, expected: Clock, seen: CircleCheck,
  review: CircleAlert, flag: CircleAlert, not_covered: CircleAlert, late: CircleAlert, info: Info,
};
export const toneClass = (s: TimelineStatus) => ({
  positive: "text-positive", muted: "text-muted-foreground", negative: "text-negative", info: "text-info",
}[STATUS_TONE[s]]);

/* ── formatting (local calendar days; YYYY-MM-DD never goes through UTC) ── */
const MO = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const parseDay = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd); };
export const usd = (n: number) => "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: Math.abs(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
export const fmtAmount = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + usd(n);
export const dfmt = (d: string) => { const x = parseDay(d); return `${DW[x.getDay()]}, ${MO[x.getMonth()].slice(0, 3)} ${x.getDate()}`; };
export const dlong = (d: string) => `${dfmt(d)}, ${d.slice(0, 4)}`;
export const monthLabel = (m: string) => `${MO[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const monthShort = (d: string) => MO[Number(d.slice(5, 7)) - 1].slice(0, 3);
export const tfmt = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
/** Date-only sources are stored at 12:00 UTC: no meaningful time of day. */
export const hasTime = (e: TimelineEvent) => (e.source === "alert" && !e.meta?.computed) || e.source === "inference";

export function eventCat(e: TimelineEvent): TimelineCategory { return e.is_internal ? "transfer" : e.category; }


export const streamKeyOf = (e: TimelineEvent) => e.stream_id ?? (typeof e.meta?.series_key === "string" ? e.meta.series_key : null);

export function accountLabel(id: string | null, accounts: UpcomingAccount[] | undefined): string {
  if (!id) return "—";
  const a = accounts?.find(x => x.account_id === id);
  if (!a) return "—";
  return a.mask ? `${a.name ?? "Account"} ··${a.mask}` : (a.name ?? "Account");
}

const TYPE_SHORT: Record<string, string> = {
  spend: "Purchase", refund: "Refund", income_salary: "Paycheck", income_interest: "Interest",
  income_other: "Income", transfer_internal: "Between your accounts", transfer_in: "Transfer in",
  transfer_out: "Transfer out", credit_card_payment: "Card payment", savings_contribution: "Savings",
  obligation_loan: "Loan payment", obligation_tax: "Tax payment", obligation_bill: "Bill",
};

/** Card subtitle: transactions read "Purchase · Amex Gold" (the raw bank descriptor moves to the detail view). */
export function subtitleOf(e: TimelineEvent, accounts: UpcomingAccount[] | undefined): string | null {
  if (e.upcoming || (e.source !== "transaction" && e.source !== "occurrence")) return e.subtitle;
  const acct = accounts?.find(a => a.account_id === e.account_id)?.name;
  const kind = (e.txn_type && TYPE_SHORT[e.txn_type]) || null;
  const parts = [kind, acct].filter(Boolean);
  return parts.length ? parts.join(" · ") : e.subtitle;
}
