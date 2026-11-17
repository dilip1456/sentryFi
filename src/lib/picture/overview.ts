/**
 * One Financial Picture: the "everything" summary on top of the plan model.
 * Pure (no React, no network): net worth by account, savings rate, the next
 * 30 days of money in and out with a cash-flow rundown, gift cards and card
 * perks. Only data the app already has; nothing here invents a source.
 */
import { addDays, addMonths, diffDays, parseDate, type ISODate } from "@/lib/recurring/dates";
import type { ReviewItem } from "@/lib/recurring/review";
import { nextOccurrence } from "./obligations";
import { acctKind, toAcctInfo, type AcctKind, type PAccount } from "./model";

// ── Net worth ───────────────────────────────────────────────────────────────

export type NetWorthGroupKey = "cash" | "credit" | "loans" | "investments";
export interface NetWorthAccount { id: string; name: string; label: string; sub: string; balance: number; manual?: boolean }
export interface NetWorthGroup { key: NetWorthGroupKey; total: number; accounts: NetWorthAccount[] }
export interface NetWorth {
  assets: number;
  liabilities: number;
  netWorth: number;
  groups: Record<NetWorthGroupKey, NetWorthGroup>;
}

/** The fields of a manual account (useManualAccounts) the net worth needs. */
export interface ManualAccountLike {
  id: string; name: string; type: string; role: string; institution_name?: string | null;
  current_balance: number | string | null; property_value?: number | string | null;
}

const num = (v: unknown) => { const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? n : 0; };
const MORTGAGE = new Set(["mortgage", "home_loan"]);
const KIND_GROUP: Record<AcctKind, NetWorthGroupKey> = { bank: "cash", save: "cash", card: "credit", loan: "loans", invest: "investments" };
const SUB_LABEL: Record<string, string> = { checking: "Checking", savings: "Savings", hsa: "HSA", cd: "CD", "money market": "Money market", "credit card": "Credit card", mortgage: "Mortgage", student: "Student loan", auto: "Auto loan", "401k": "401(k)", ira: "IRA", roth: "Roth IRA", brokerage: "Brokerage" };
const title = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

/**
 * Same totals as Home's net worth (LivePlaidDashboard): linked credit and loan
 * balances are owed; manual debts count as owed; a manual mortgage with a
 * property value counts as equity (value − balance).
 */
export function netWorthBreakdown(accounts: readonly PAccount[], manual: readonly ManualAccountLike[] = []): NetWorth {
  const groups: Record<NetWorthGroupKey, NetWorthGroup> = {
    cash: { key: "cash", total: 0, accounts: [] }, credit: { key: "credit", total: 0, accounts: [] },
    loans: { key: "loans", total: 0, accounts: [] }, investments: { key: "investments", total: 0, accounts: [] },
  };
  let assets = 0, liabilities = 0;
  for (const a of accounts) {
    const info = toAcctInfo(a);
    const g = KIND_GROUP[acctKind(a)];
    const bal = num(a.current_balance);
    groups[g].accounts.push({ id: info.id, name: info.name, label: info.label, sub: SUB_LABEL[info.subtype] ?? (info.subtype ? title(info.subtype) : title(info.type || "account")), balance: bal });
    groups[g].total += bal;
    if (g === "credit" || g === "loans") liabilities += bal; else assets += bal;
  }
  for (const m of manual) {
    const bal = num(m.current_balance);
    const sub = m.institution_name ? `${title(m.type)} · ${m.institution_name}` : `${title(m.type)} · added by you`;
    if (MORTGAGE.has(m.type)) {
      const equity = num(m.property_value) ? num(m.property_value) - Math.abs(bal) : null;
      groups.loans.accounts.push({ id: `manual-${m.id}`, name: m.name, label: m.name, sub: equity == null ? sub : `${sub} · equity ${Math.round(equity).toLocaleString("en-US")}`, balance: Math.abs(bal), manual: true });
      groups.loans.total += Math.abs(bal);
      if (equity != null) { if (equity >= 0) assets += equity; else liabilities += -equity; }
      continue;
    }
    const debt = m.role === "debt";
    const g: NetWorthGroupKey = debt ? (/(card|credit)/i.test(m.type) ? "credit" : "loans") : /(invest|brokerage|401|ira|retire|stock|crypto)/i.test(m.type) ? "investments" : "cash";
    groups[g].accounts.push({ id: `manual-${m.id}`, name: m.name, label: m.name, sub, balance: bal, manual: true });
    groups[g].total += bal;
    if (debt) liabilities += bal; else assets += bal;
  }
  for (const g of Object.values(groups)) g.accounts.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  return { assets, liabilities, netWorth: assets - liabilities, groups };
}

// ── Savings rate ────────────────────────────────────────────────────────────

export interface SavingsRate { pct: number | null; monthly: number; basis: "gross" | "take-home" | null }

/**
 * Share of pay that goes to savings: transfers to your own goals plus payroll
 * 401(k)/HSA/ESPP contributions, over gross pay when we know it (both sides
 * then include payroll), else transfers over take-home.
 */
export function savingsRate(i: { savingsMonthly: number; payrollSavingsMonthly: number; grossMonthly: number; takeHomeMonthly: number }): SavingsRate {
  if (i.grossMonthly > 0) {
    const monthly = i.savingsMonthly + i.payrollSavingsMonthly;
    return { pct: Math.round((monthly / i.grossMonthly) * 1000) / 10, monthly, basis: "gross" };
  }
  if (i.takeHomeMonthly > 0) return { pct: Math.round((i.savingsMonthly / i.takeHomeMonthly) * 1000) / 10, monthly: i.savingsMonthly, basis: "take-home" };
  return { pct: null, monthly: i.savingsMonthly, basis: null };
}

// ── Next 30 days ────────────────────────────────────────────────────────────

export interface UpcomingEvent {
  key: string;
  date: ISODate;
  label: string;
  /** Positive amount; `direction` says which way. */
  amount: number;
  direction: "inflow" | "outflow";
  /** Still a suggestion (not confirmed by the person). */
  detected: boolean;
  reviewKey?: string;
}
export interface UpcomingWindow {
  events: UpcomingEvent[];
  inflow: number;
  outflow: number;
  startCash: number;
  endCash: number;
  low: { date: ISODate; balance: number };
  /** First day the running balance goes below zero, if it does. */
  shortfallOn: ISODate | null;
}

/**
 * Expected money in and out over the next `days` (default 30) from the
 * recurring items (suggested and confirmed; dismissed ones are already gone)
 * and the person's own bills with a due day, run against the cash in
 * checking/savings today.
 */
export function upcomingWindow(opts: {
  today: ISODate;
  items: readonly ReviewItem[];
  manualItems?: readonly { id: string; label: string; monthly: number; dueDay?: number }[];
  startCash: number;
  days?: number;
}): UpcomingWindow {
  const days = opts.days ?? 30;
  const end = addDays(opts.today, days);
  const events: UpcomingEvent[] = [];
  for (const it of opts.items) {
    if (!it.nextDue || it.status === "dismissed" || !(it.amount > 0)) continue;
    let d = it.nextDue;
    const anchor = parseDate(d).d;
    // A payment a few days late still counts as coming (shown as due today);
    // older ones are "missed" (shown in risks), so skip ahead to the next one.
    let late = false;
    if (d < opts.today) {
      if (diffDays(opts.today, d) <= 7) late = true;
      else { let guard = 0; while (d < opts.today && guard++ < 60) d = nextOccurrence(d, it.cadence, anchor)!; }
    }
    let n = 0;
    while (n++ < 10) {
      const on = late && n === 1 ? opts.today : d;
      if (on > end) break;
      events.push({ key: `${it.key}@${on}`, date: on, label: it.label, amount: it.amount, direction: it.direction, detected: it.status === "suggested", reviewKey: it.key });
      d = nextOccurrence(d, it.cadence, anchor)!;
      if (d <= opts.today) d = nextOccurrence(d, it.cadence, anchor)!;
    }
  }
  for (const m of opts.manualItems ?? []) {
    if (!m.dueDay || !(m.monthly > 0)) continue;
    const { y, m: mo, d: td } = parseDate(opts.today);
    let d = `${y}-${String(mo).padStart(2, "0")}-01`;
    d = addMonths(d, td > m.dueDay ? 1 : 0, m.dueDay);
    while (d <= end) { events.push({ key: `manual:${m.id}@${d}`, date: d, label: m.label, amount: m.monthly, direction: "outflow", detected: false }); d = addMonths(d, 1, m.dueDay); }
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.direction === b.direction ? b.amount - a.amount : a.direction === "inflow" ? -1 : 1));
  let bal = opts.startCash, inflow = 0, outflow = 0;
  let low = { date: opts.today, balance: bal };
  let shortfallOn: ISODate | null = null;
  for (const e of events) {
    if (e.direction === "inflow") { bal += e.amount; inflow += e.amount; } else { bal -= e.amount; outflow += e.amount; }
    if (bal < low.balance) low = { date: e.date, balance: bal };
    if (bal < 0 && !shortfallOn) shortfallOn = e.date;
  }
  return { events, inflow, outflow, startCash: opts.startCash, endCash: bal, low, shortfallOn };
}

// ── Gift cards ──────────────────────────────────────────────────────────────

export interface GiftCardLike { id: string; brand_name?: string | null; balance?: number | string | null; expiry_date?: string | null; deleted_at?: string | null; archived_at?: string | null }
export interface GiftCardSummary { total: number; count: number; expiringSoon: number; expired: number; issuers: { name: string; total: number; count: number }[] }

/** Active cards only (not removed, not archived/used up), total value and the biggest issuers. */
export function giftCardSummary(rows: readonly GiftCardLike[], today: ISODate, soonDays = 30): GiftCardSummary {
  const active = rows.filter(r => !r.deleted_at && !r.archived_at && num(r.balance) > 0);
  const by = new Map<string, { name: string; total: number; count: number }>();
  let expiringSoon = 0, expired = 0;
  for (const r of active) {
    const name = (r.brand_name ?? "").trim() || "Gift card";
    const k = name.toLowerCase();
    const e = by.get(k) ?? { name, total: 0, count: 0 };
    e.total += num(r.balance); e.count += 1; by.set(k, e);
    if (r.expiry_date) { const left = diffDays(r.expiry_date.slice(0, 10), today); if (left < 0) expired += 1; else if (left <= soonDays) expiringSoon += 1; }
  }
  const issuers = [...by.values()].sort((a, b) => b.total - a.total);
  return { total: Math.round(active.reduce((s, r) => s + num(r.balance), 0) * 100) / 100, count: active.length, expiringSoon, expired, issuers };
}
