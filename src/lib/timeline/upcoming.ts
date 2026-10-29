/**
 * Upcoming (projected) items for the Timeline: the next 14 days by default,
 * "Show further ahead" = 5 weeks. Built from recurring streams (stored
 * recurring_streams rows merged with what src/lib/recurring detects), card
 * statement due dates (credit_statements) and tax milestones. Covered-by
 * comes from obligations.funding_account_id, then the stream's autopay
 * account.
 */
import type { TxnType } from "@/lib/classify";
import { addDays, diffDays } from "@/lib/recurring/dates";
import { matchTolerance, scheduleDates, type Schedule } from "@/lib/recurring/schedule";
import { streamCountsAsAutopay } from "@/lib/infer/apply";
import type { RecurringStreamRow } from "@/lib/recurring/rows";
import { categoryForType, isInternalType } from "./categories";
import { compareEventsDesc } from "./cursor";
import { matchesUpcoming } from "./filters";
import type { TimelineEvent, TimelineFilters } from "./types";

export const UPCOMING_DAYS = 14;
export const UPCOMING_DAYS_EXTENDED = 35;

export interface UpcomingStream {
  id?: string | null;
  series_key: string;
  display_name: string;
  direction: string;
  txn_type: string;
  kind: string;
  cadence: string;
  category?: string | null;
  schedule: Record<string, unknown> | Schedule | null;
  account_id: string | null;
  counterpart_account_id?: string | null;
  amount_median: number | null;
  amount_cv: number | null;
  is_fixed: boolean | null;
  next_expected_date: string | null;
  next_expected_amount: number | null;
  last_seen: string | null;
  active: boolean | null;
  status: string;
  must_pay: boolean | null;
  obligation_id?: string | null;
  autopay?: RecurringStreamRow["autopay"] | null;
  autopay_source?: RecurringStreamRow["autopay_source"] | null;
  pay_from_account_id?: string | null;
}

export interface UpcomingObligation { id: string; stream_id: string | null; funding_account_id: string | null; active?: boolean | null }
export interface UpcomingStatement {
  account_id: string; statement_issue_date: string; due_date: string | null;
  statement_balance: number | null; minimum_payment_amount: number | null;
}
export interface UpcomingMilestone { id: string; title: string; due_date: string; amount: number | null; status: string; kind?: string | null; note?: string | null }
export interface UpcomingAccount { account_id: string; name: string | null; mask?: string | null; type?: string | null; subtype?: string | null; current_balance?: number | null }

export interface UpcomingInput {
  today: string;
  through: string;
  streams: UpcomingStream[];
  obligations?: UpcomingObligation[];
  statements?: UpcomingStatement[];
  milestones?: UpcomingMilestone[];
  accounts?: UpcomingAccount[];
}

/** Amounts vary more than this (coefficient of variation) → labelled "est." */
export const EST_CV = 0.05;

const ORD = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export function isSchedule(x: unknown): x is Schedule {
  if (!x || typeof x !== "object") return false;
  const k = (x as { kind?: unknown }).kind;
  if (k === "interval") return typeof (x as { phaseDay?: unknown }).phaseDay === "string" && Number((x as { intervalDays?: unknown }).intervalDays) > 0;
  if (k === "semimonthly") return Array.isArray((x as { anchorDays?: unknown }).anchorDays);
  if (k === "day-of-month") return Number((x as { anchorDay?: unknown }).anchorDay) > 0 && Number((x as { monthStep?: unknown }).monthStep) > 0;
  return k === "irs-estimated";
}

/** "Monthly on the 10th", "Every other week", … */
export function repeatsLabel(s: UpcomingStream): string | null {
  const sc = isSchedule(s.schedule) ? s.schedule : null;
  if (sc?.kind === "irs-estimated") return "IRS estimated-tax dates";
  if (sc?.kind === "semimonthly") return `Twice a month (${ORD(sc.anchorDays[0])} & ${ORD(sc.anchorDays[1])})`;
  if (sc?.kind === "day-of-month") {
    const day = sc.anchorDay >= 31 ? "last day" : `the ${ORD(sc.anchorDay)}`;
    const every = sc.monthStep === 1 ? "Monthly" : sc.monthStep === 3 ? "Every 3 months" : sc.monthStep === 6 ? "Every 6 months" : "Yearly";
    return `${every} on ${day}`;
  }
  switch (s.cadence) {
    case "weekly": return "Every week";
    case "biweekly": return "Every other week";
    case "semimonthly": return "Twice a month";
    case "monthly": return "Monthly";
    case "quarterly": return "Every 3 months";
    case "semiannual": return "Every 6 months";
    case "yearly": return "Yearly";
    default: return null;
  }
}

const accountLabel = (accounts: Map<string, UpcomingAccount>, id: string | null | undefined) => {
  if (!id) return null;
  const a = accounts.get(id);
  if (!a) return null;
  return a.mask ? `${a.name ?? "Account"} ••${a.mask}` : a.name ?? "Account";
};

const MUST_COVER = new Set(["bills", "taxes"]);

function streamDates(s: UpcomingStream, from: string, to: string): string[] {
  if (isSchedule(s.schedule)) {
    try { return scheduleDates(s.schedule, from, to).map(d => d.expected); } catch { /* fall through */ }
  }
  return s.next_expected_date && s.next_expected_date >= from && s.next_expected_date <= to ? [s.next_expected_date] : [];
}

/** Every projected item in [today, through], newest (furthest) first. */
export function buildUpcoming(input: UpcomingInput): TimelineEvent[] {
  const { today, through } = input;
  const accounts = new Map((input.accounts ?? []).map(a => [a.account_id, a] as const));
  const fundingByStream = new Map<string, string>();
  const fundingByObligation = new Map<string, string>();
  for (const o of input.obligations ?? []) {
    if (o.active === false || !o.funding_account_id) continue;
    fundingByObligation.set(o.id, o.funding_account_id);
    if (o.stream_id) fundingByStream.set(o.stream_id, o.funding_account_id);
  }
  const cardsWithStatement = new Set<string>();
  const out: TimelineEvent[] = [];

  // card statements: latest statement per card with a due date in the window
  const latest = new Map<string, UpcomingStatement>();
  for (const st of input.statements ?? []) {
    const cur = latest.get(st.account_id);
    if (!cur || st.statement_issue_date > cur.statement_issue_date) latest.set(st.account_id, st);
  }
  for (const st of latest.values()) {
    cardsWithStatement.add(st.account_id);
    if (!st.due_date || st.due_date < today || st.due_date > through) continue;
    const bal = st.statement_balance ?? accounts.get(st.account_id)?.current_balance ?? null;
    if (bal != null && bal <= 0) continue;
    const name = accountLabel(accounts, st.account_id) ?? "Card";
    out.push(item({
      id: `up:card:${st.account_id}:${st.due_date}`, date: st.due_date, title: `${name.replace(/ ••\w+$/, "")} payment due`,
      subtitle: st.minimum_payment_amount ? `Statement balance · minimum $${st.minimum_payment_amount.toFixed(2)}` : "Statement balance",
      amount: bal == null ? null : -bal, estimated: st.statement_balance == null, txnType: "credit_card_payment",
      account_id: st.account_id, status: "expected", covered_by: null, repeats: "Monthly", source_id: st.account_id,
      meta: { kind: "card_statement", minimum: st.minimum_payment_amount },
    }));
  }

  for (const s of input.streams) {
    if (s.status === "dismissed" || s.active === false) continue;
    if (s.kind === "card_payment" && s.counterpart_account_id && cardsWithStatement.has(s.counterpart_account_id)) continue;
    const tol = isSchedule(s.schedule) ? matchTolerance(s.schedule) : 3;
    const amt = s.next_expected_amount ?? s.amount_median;
    const estimated = !s.is_fixed || (s.amount_cv ?? 0) > EST_CV;
    const category = categoryForType(s.txn_type);
    const funding = (s.id && fundingByStream.get(s.id)) || (s.obligation_id && fundingByObligation.get(s.obligation_id))
      || (streamCountsAsAutopay({ autopay: s.autopay ?? null, autopay_source: s.autopay_source ?? null }) ? s.pay_from_account_id : null) || null;
    const outflow = s.direction !== "inflow";
    const covered = outflow ? accountLabel(accounts, funding) ?? (funding ? "Linked account" : null) : null;
    const status = outflow && !covered && (MUST_COVER.has(category) || s.must_pay) && category !== "cards" ? "not_covered" : "expected";
    for (const d of streamDates(s, today, through)) {
      // already posted for this period?
      if (s.last_seen && s.last_seen <= today && Math.abs(diffDays(d, s.last_seen)) <= tol) continue;
      out.push(item({
        id: `up:${s.series_key}:${d}`, date: d, title: s.display_name,
        subtitle: [s.category, accountLabel(accounts, s.account_id)].filter(Boolean).join(" · ") || null,
        amount: amt == null ? null : (outflow ? -1 : 1) * Math.abs(amt), estimated, txnType: s.txn_type as TxnType,
        account_id: s.account_id, status, covered_by: covered, repeats: repeatsLabel(s), source_id: s.id ?? s.series_key,
        stream_id: s.id ?? null, meta: { kind: s.kind, series_key: s.series_key, stream_status: s.status },
      }));
    }
  }

  for (const m of input.milestones ?? []) {
    if (m.status !== "upcoming" || m.due_date < today || m.due_date > through) continue;
    out.push(item({
      id: `up:tax:${m.id}`, date: m.due_date, title: m.title, subtitle: m.note ?? null,
      amount: m.amount == null ? null : -Math.abs(m.amount), estimated: true, txnType: "obligation_tax",
      account_id: null, status: "expected", covered_by: null, repeats: null, source_id: m.id, meta: { kind: m.kind ?? "tax_milestone" },
    }));
  }
  return out.sort(compareEventsDesc);
}

function item(x: {
  id: string; date: string; title: string; subtitle: string | null; amount: number | null; estimated: boolean;
  txnType: TxnType; account_id: string | null; status: TimelineEvent["status"]; covered_by: string | null;
  repeats: string | null; source_id: string; stream_id?: string | null; meta: Record<string, unknown>;
}): TimelineEvent {
  return {
    id: x.id, source: "upcoming", source_id: x.source_id, occurred_on: x.date, occurred_at: `${x.date}T12:00:00.000Z`,
    category: categoryForType(x.txnType), txn_type: x.txnType, is_internal: isInternalType(x.txnType),
    title: x.title, subtitle: x.subtitle, amount: x.amount, account_id: x.account_id, status: x.status,
    stream_id: x.stream_id ?? null, pending: false, meta: x.meta, upcoming: true, estimated: x.estimated,
    covered_by: x.covered_by, repeats: x.repeats,
  };
}

/** Upcoming items visible for the current filters and window. */
export function visibleUpcoming(all: TimelineEvent[], f: TimelineFilters, today: string, days: number): TimelineEvent[] {
  const through = addDays(today, days);
  return all.filter(e => e.occurred_on >= today && e.occurred_on <= through && matchesUpcoming(e, f));
}

/**
 * Merge stored recurring_streams rows with freshly detected ones: stored
 * rows win (they carry the user's confirm/dismiss and autopay choices), a
 * detected series fills in anything not stored yet.
 */
export function mergeStreams(stored: UpcomingStream[], detected: UpcomingStream[]): UpcomingStream[] {
  const byKey = new Map<string, UpcomingStream>();
  for (const d of detected) byKey.set(d.series_key, d);
  for (const s of stored) {
    const d = byKey.get(s.series_key);
    // keep the detector's fresher schedule/next date, but the stored identity & decisions
    byKey.set(s.series_key, d ? { ...d, ...pickDefined(s), schedule: isSchedule(s.schedule) ? s.schedule : d.schedule, last_seen: maxDate(s.last_seen, d.last_seen) } : s);
  }
  return [...byKey.values()];
}

const maxDate = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
function pickDefined<T extends object>(o: T): Partial<T> {
  const r: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) (r as Record<string, unknown>)[k] = v;
  return r;
}
