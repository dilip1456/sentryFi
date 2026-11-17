/**
 * One Financial Picture: every expense you can anticipate, in one plan.
 *
 * Sources (no new data sources):
 *  - detected recurring outflows from src/lib/recurring/review.ts (suggested =
 *    "needs review", confirmed = in the plan; dismissed ones never reach here),
 *  - the person's own expenses (settings.financialPicture.manualItems; amount
 *    required, any cadence incl. a custom interval or a one-time date),
 *  - gift card expiries (value at risk, not a cost).
 *
 * Pure (no React, no network). Money only: every item has an amount.
 */
import { addDays, addMonths, diffDays, parseDate, ymd, type ISODate } from "@/lib/recurring/dates";
import type { Cadence } from "@/lib/recurring/schedule";
import { PER_YEAR_CADENCE, SUBSCRIPTION_RE, type ReviewItem } from "@/lib/recurring/review";
import type { GiftCardLike } from "./overview";

// ── Categories ──────────────────────────────────────────────────────────────

export const OBLIGATION_CATEGORIES = [
  "housing", "utilities", "insurance", "vehicle", "taxes", "debt", "subscriptions", "annual_fees", "family", "other",
] as const;
export type ObligationCategory = (typeof OBLIGATION_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<ObligationCategory, string> = {
  housing: "Rent, mortgage & HOA",
  utilities: "Utilities",
  insurance: "Insurance",
  vehicle: "Vehicle & registration",
  taxes: "Taxes",
  debt: "Loans & card payments",
  subscriptions: "Subscriptions & memberships",
  annual_fees: "Annual fees",
  family: "Childcare, school & medical",
  other: "Other expenses",
};

const RE = {
  vehicle: /\b(dmv|bmv|mvd|motor\s*vehicles?|vehicle\s*reg|registration|tag\s*renewal|smog|emissions\s*test|e-?z\s*pass|toll)\b/i,
  hoa: /\b(hoa|homeowners?\s*assoc|home\s*owners?\s*assoc|condo(minium)?\s*assoc|association\s*dues|community\s*assoc)\b/i,
  insurance: /\b(insurance|\bins\b|geico|state\s*farm|progressive|allstate|liberty\s*mutual|usaa|lemonade|nationwide|farmers|travelers|metlife|aflac|premium)\b/i,
  utilities: /\b(electric|power|energy|edison|pg&e|con\s*ed|duke\s*energy|water|sewer|trash|waste|garbage|recycl|utility|utilities|gas\s*co|natural\s*gas|comcast|xfinity|spectrum|optimum|fios|starlink|internet|verizon|at&t|t-?mobile|mint\s*mobile|cricket|phone)\b/i,
  annual: /\b(annual\s*fee|membership\s*fee|annual\s*membership|costco|sam'?s\s*club|prime\s*membership|amazon\s*prime)\b/i,
  family: /\b(tuition|school|universit|college|daycare|day\s*care|childcare|child\s*care|preschool|kindercare|bright\s*horizons|tutor|medical|hospital|clinic|dental|dentist|orthodont|pharmacy|cvs|walgreens|doctor|physician|pediatric|health\s*system|labcorp|quest\s*diag)\b/i,
};

/** Where a detected or typed-in expense belongs (descriptor text first, then the detector's kind). */
export function categorize(text: string, kind?: string | null, subtype?: string | null, cadence?: Cadence | null): ObligationCategory {
  if (kind === "tax" || subtype === "property" || subtype === "irs_estimated" || /\b(property\s*tax|irs|estimated\s*tax|1040|tax\s*collector|county\s*treas)/i.test(text)) return "taxes";
  if (RE.vehicle.test(text)) return "vehicle";
  if (RE.hoa.test(text)) return "housing";
  if (subtype === "mortgage" || subtype === "rent" || /\b(rent|mortgage|apartment|leasing)\b/i.test(text)) return "housing";
  if (subtype === "insurance" || RE.insurance.test(text)) return "insurance";
  if (kind === "loan" || kind === "card_payment") return "debt";
  if (subtype === "utility" || subtype === "phone" || subtype === "internet" || RE.utilities.test(text)) return "utilities";
  if (RE.annual.test(text) && (cadence === "yearly" || cadence == null)) return "annual_fees";
  if (RE.family.test(text)) return "family";
  if (kind === "subscription" || SUBSCRIPTION_RE.test(text)) return "subscriptions";
  return "other";
}

// ── The plan ────────────────────────────────────────────────────────────────

export type PlanCadence = Cadence | "custom" | "once";
export const PLAN_CADENCE_LABEL: Record<PlanCadence, string> = {
  weekly: "Weekly", biweekly: "Every 2 weeks", semimonthly: "Twice a month", monthly: "Monthly", quarterly: "Every 3 months",
  semiannual: "Every 6 months", yearly: "Yearly", custom: "Custom", once: "One time",
};

/** A typed-in expense (stored in settings.financialPicture.manualItems). Older items only have group/monthly/dueDay. */
export interface ManualObligationLike {
  id: string; label: string; monthly: number; dueDay?: number; group?: string;
  category?: ObligationCategory; amount?: number; amountKind?: "fixed" | "estimated";
  cadence?: PlanCadence; intervalDays?: number; nextDue?: ISODate; reminderDays?: number; notes?: string;
}

export type ObligationSource = "detected" | "confirmed" | "manual" | "giftcard";
export interface Obligation {
  id: string;
  label: string;
  category: ObligationCategory;
  source: ObligationSource;
  /** Per occurrence, positive. */
  amount: number;
  amountKind: "fixed" | "estimated";
  cadence: PlanCadence;
  intervalDays?: number;
  nextDue: ISODate | null;
  lastPaid: { date: ISODate; amount: number } | null;
  /** Paid dates we know of (detected items), newest first. */
  paidDates: ISODate[];
  monthly: number;
  annual: number;
  missed: boolean;
  daysLate: number | null;
  reminderDays?: number;
  notes?: string;
  reviewKey?: string;
  manualId?: string;
  /** Gift card expiry: value at risk, not counted as a cost. */
  noCost?: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function perYear(cadence: PlanCadence, intervalDays?: number): number {
  if (cadence === "custom") return intervalDays && intervalDays > 0 ? 365 / intervalDays : 0;
  if (cadence === "once") return 0;
  return PER_YEAR_CADENCE[cadence];
}

/** Next occurrence after `d` for a cadence (anchorDay keeps "the 31st" stable across short months). */
export function nextOccurrence(d: ISODate, c: PlanCadence, anchor: number, intervalDays?: number): ISODate | null {
  switch (c) {
    case "once": return null;
    case "custom": return intervalDays && intervalDays > 0 ? addDays(d, Math.round(intervalDays)) : null;
    case "weekly": return addDays(d, 7);
    case "biweekly": return addDays(d, 14);
    case "semimonthly": {
      const hi = anchor > 15 ? anchor : anchor + 15;
      const lo = anchor > 15 ? (anchor >= 28 ? 15 : anchor - 15) : anchor;
      return parseDate(d).d <= 15 ? addMonths(d, 0, hi >= 28 ? 31 : hi) : addMonths(d, 1, lo);
    }
    case "monthly": return addMonths(d, 1, anchor);
    case "quarterly": return addMonths(d, 3, anchor);
    case "semiannual": return addMonths(d, 6, anchor);
    default: return addMonths(d, 12, anchor);
  }
}

function fromReview(it: ReviewItem): Obligation {
  const paid = it.matched.slice().sort((a, b) => b.date.localeCompare(a.date));
  const category = categorize(`${it.label} ${it.matched.slice(0, 3).map(m => m.name).join(" ")}`, it.kind, it.subtype, it.cadence);
  return {
    id: `rcv:${it.key}`, label: it.label, category, source: it.status === "suggested" ? "detected" : "confirmed",
    amount: it.amount, amountKind: it.amountKind === "variable" ? "estimated" : "fixed", cadence: it.cadence,
    nextDue: it.nextDue, lastPaid: paid[0] ? { date: paid[0].date, amount: paid[0].amount } : it.lastSeen ? { date: it.lastSeen, amount: it.amount } : null,
    paidDates: paid.map(p => p.date), monthly: it.monthly, annual: r2(it.monthly * 12), missed: it.missed, daysLate: it.daysLate, reviewKey: it.key,
  };
}

function nextFromDueDay(today: ISODate, dueDay: number): ISODate {
  const { y, m, d } = parseDate(today);
  const first = ymd(y, m, 1);
  return addMonths(first, d > dueDay ? 1 : 0, dueDay);
}

export function fromManual(m: ManualObligationLike, today: ISODate): Obligation {
  const cadence: PlanCadence = m.cadence ?? "monthly";
  const amount = m.amount ?? m.monthly;
  const py = perYear(cadence, m.intervalDays);
  let nextDue = m.nextDue ?? (m.dueDay ? nextFromDueDay(today, m.dueDay) : null);
  // A stored date that has passed rolls on to the next one (one-time items stay put and show overdue).
  if (nextDue && cadence !== "once") {
    const anchor = parseDate(nextDue).d;
    let guard = 0;
    while (nextDue < today && guard++ < 400) { const n = nextOccurrence(nextDue, cadence, anchor, m.intervalDays); if (!n) break; nextDue = n; }
  }
  const category = m.category ?? (m.group === "obligations" ? categorize(m.label, "loan") : categorize(m.label));
  const annual = cadence === "once" ? (nextDue && diffDays(nextDue, today) <= 365 ? amount : 0) : r2(amount * py);
  return {
    id: `manual:${m.id}`, label: m.label, category, source: "manual", amount, amountKind: m.amountKind ?? "fixed", cadence, intervalDays: m.intervalDays,
    nextDue, lastPaid: null, paidDates: [], monthly: r2(annual / 12), annual,
    missed: cadence === "once" && !!nextDue && nextDue < today, daysLate: cadence === "once" && nextDue && nextDue < today ? diffDays(today, nextDue) : null,
    reminderDays: m.reminderDays, notes: m.notes, manualId: m.id,
  };
}

/** Outflows the review keeps that are expenses (not income, not moves to your own savings). */
const isExpense = (it: ReviewItem) => it.direction === "outflow" && it.status !== "dismissed" && it.kind !== "savings" && it.kind !== "transfer" && it.group !== "savings" && it.group !== "income";

export function buildObligations(opts: {
  today: ISODate;
  reviewItems: readonly ReviewItem[];
  manual?: readonly ManualObligationLike[];
  giftCards?: readonly GiftCardLike[];
}): Obligation[] {
  const out: Obligation[] = [];
  for (const it of opts.reviewItems) if (isExpense(it) && it.amount > 0) out.push(fromReview(it));
  for (const m of opts.manual ?? []) if ((m.amount ?? m.monthly) > 0) out.push(fromManual(m, opts.today));
  for (const g of opts.giftCards ?? []) {
    const bal = Number(g.balance) || 0;
    if (g.deleted_at || g.archived_at || bal <= 0 || !g.expiry_date) continue;
    const exp = g.expiry_date.slice(0, 10);
    if (diffDays(exp, opts.today) > 365) continue;
    out.push({
      id: `gift:${g.id}`, label: `${g.brand_name ?? "Gift card"} gift card expires`, category: "other", source: "giftcard", amount: bal, amountKind: "fixed",
      cadence: "once", nextDue: exp, lastPaid: null, paidDates: [], monthly: 0, annual: 0, missed: exp < opts.today, daysLate: exp < opts.today ? diffDays(opts.today, exp) : null, noCost: true,
    });
  }
  return out;
}

// ── Projection & views ──────────────────────────────────────────────────────

export interface Occurrence { ob: Obligation; date: ISODate; overdue: boolean }

/** Every expected occurrence in [from, to]; an overdue one (missed / one-time past due) shows once, on `from`. */
export function project(obs: readonly Obligation[], from: ISODate, to: ISODate): Occurrence[] {
  const out: Occurrence[] = [];
  for (const ob of obs) {
    if (!ob.nextDue) continue;
    let d = ob.nextDue;
    const anchor = parseDate(d).d;
    if (d < from) {
      if (ob.missed || ob.cadence === "once") { out.push({ ob, date: from, overdue: true }); }
      let guard = 0;
      while (d < from && guard++ < 400) { const n = nextOccurrence(d, ob.cadence, anchor, ob.intervalDays); if (!n) { d = ""; break; } d = n; }
      if (!d) continue;
    }
    let n = 0;
    while (d && d <= to && n++ < 400) {
      out.push({ ob, date: d, overdue: false });
      const nx = nextOccurrence(d, ob.cadence, anchor, ob.intervalDays);
      if (!nx) break;
      d = nx;
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.ob.amount - a.ob.amount);
}

export type PlanWindow = "week" | "month" | "quarter" | "year";
export const WINDOW_LABEL: Record<PlanWindow, string> = { week: "This week", month: "This month", quarter: "Next 3 months", year: "This year" };
export function windowEnd(w: PlanWindow, today: ISODate): ISODate {
  const { y, m } = parseDate(today);
  if (w === "week") return addDays(today, 6);
  if (w === "month") return addDays(addMonths(ymd(y, m, 1), 1), -1);
  if (w === "quarter") return addDays(today, 90);
  return ymd(y, 12, 31);
}

export type CadenceBucket = "weekly" | "monthly" | "quarterly" | "annual";
export const BUCKET_LABEL: Record<CadenceBucket, string> = { weekly: "Weekly & every 2 weeks", monthly: "Monthly", quarterly: "Quarterly", annual: "Twice a year, yearly & one-time" };
export function cadenceBucket(ob: Pick<Obligation, "cadence" | "intervalDays">): CadenceBucket {
  switch (ob.cadence) {
    case "weekly": case "biweekly": case "semimonthly": return "weekly";
    case "monthly": return "monthly";
    case "quarterly": return "quarterly";
    case "custom": { const d = ob.intervalDays ?? 0; return d <= 16 ? "weekly" : d <= 45 ? "monthly" : d <= 120 ? "quarterly" : "annual"; }
    default: return "annual";
  }
}

// ── Sinking funds ───────────────────────────────────────────────────────────

export interface SinkingFund {
  /** Steady amount to put aside each month so every occurrence is covered. */
  perMonth: number;
  /** Months until the next one is due (at least 1). */
  monthsToDue: number;
  /** If you start from zero today: per month to have the full amount by the due date. */
  toBeReady: number;
}

/** Only for things billed less often than monthly (quarterly, twice a year, yearly, long custom, one-time). */
export function sinkingFund(ob: Obligation, today: ISODate): SinkingFund | null {
  if (ob.noCost) return null;
  const b = cadenceBucket(ob);
  if (b !== "quarterly" && b !== "annual") return null;
  const monthsToDue = ob.nextDue ? Math.max(1, Math.round(diffDays(ob.nextDue, today) / 30.44)) : 12;
  const perMonth = ob.cadence === "once" ? r2(ob.amount / monthsToDue) : r2(ob.annual / 12);
  return { perMonth, monthsToDue, toBeReady: r2(ob.amount / monthsToDue) };
}

export interface CategoryTotal { category: ObligationCategory; count: number; monthly: number; annual: number; setAside: number; items: Obligation[] }

/** Monthly-equivalent, yearly and set-aside (non-monthly) totals per category, biggest first. */
export function categoryTotals(obs: readonly Obligation[], today: ISODate): CategoryTotal[] {
  const by = new Map<ObligationCategory, CategoryTotal>();
  for (const ob of obs) {
    if (ob.noCost) continue;
    const t = by.get(ob.category) ?? { category: ob.category, count: 0, monthly: 0, annual: 0, setAside: 0, items: [] };
    t.count += 1; t.monthly = r2(t.monthly + ob.monthly); t.annual = r2(t.annual + ob.annual);
    t.setAside = r2(t.setAside + (sinkingFund(ob, today)?.perMonth ?? 0));
    t.items.push(ob);
    by.set(ob.category, t);
  }
  return [...by.values()].sort((a, b) => b.annual - a.annual);
}

// ── Accounted for ───────────────────────────────────────────────────────────

export interface AccountedFor {
  /** Expected in this period (paid already or still due). */
  expected: number;
  paid: number;
  /** Due later this period and covered by the cash on hand. */
  covered: number;
  /** Expected but not seen (past due, no matching payment). */
  missing: Obligation[];
  upcomingTotal: number;
  cash: number;
  /** Due later this period but cash runs out first. */
  uncovered: Obligation[];
}

/**
 * "Is everything accounted for this month?": each expected obligation is paid
 * (a matching payment this month), covered (still due, and the cash on hand
 * covers it in due order) or missing (past due with nothing seen).
 */
export function accountedFor(obs: readonly Obligation[], today: ISODate, cash: number, graceDays = 5): AccountedFor {
  const { y, m } = parseDate(today);
  const start = ymd(y, m, 1), end = windowEnd("month", today);
  const res: AccountedFor = { expected: 0, paid: 0, covered: 0, missing: [], upcomingTotal: 0, cash, uncovered: [] };
  const due: { ob: Obligation; date: ISODate }[] = [];
  for (const ob of obs) {
    if (ob.noCost) continue;
    const paidThisMonth = ob.paidDates.some(d => d >= start && d <= today);
    const occ = project([ob], start, end).filter(o => !o.overdue);
    const upcoming = occ.filter(o => o.date > today);
    if (paidThisMonth) { res.expected += 1; res.paid += 1; }
    const pastUnpaid = !paidThisMonth && (ob.missed || occ.some(o => o.date <= addDays(today, -graceDays) && ob.source !== "manual"));
    if (pastUnpaid) { res.expected += 1; res.missing.push(ob); }
    for (const u of upcoming) { if (paidThisMonth && ob.cadence === "monthly") continue; res.expected += 1; due.push({ ob, date: u.date }); }
    // Due today / within the grace window and not seen yet: still counts as upcoming.
    if (!paidThisMonth && !pastUnpaid && occ.some(o => o.date <= today)) { res.expected += 1; due.push({ ob, date: today }); }
  }
  due.sort((a, b) => a.date.localeCompare(b.date));
  let left = cash;
  for (const d of due) {
    res.upcomingTotal = r2(res.upcomingTotal + d.ob.amount);
    left -= d.ob.amount;
    if (left >= 0) res.covered += 1; else res.uncovered.push(d.ob);
  }
  return res;
}
