/**
 * Accounts page model: one view per account (linked or manual), the By type /
 * By bank groupings, and the single "fact" each row shows. Pure, so the
 * grouping and row rules are unit-tested (src/test/accounts-grouping.test.ts).
 */
import { isDebtType } from "./totals";
import {
  manualKey, type AccountMetaMap, type CreditDetailLike, type InstitutionItem, type ItemHealth,
  type LinkedAccount, type LoanDetailLike, type ManualAccountLike,
} from "./types";

/** The five groups from the spec, plus "other" for manual assets (a car, property) when there are any. */
export type TypeGroupKey = "checking" | "savings" | "credit" | "loan" | "investment" | "other";
export const TYPE_GROUP_ORDER: TypeGroupKey[] = ["checking", "savings", "credit", "loan", "investment", "other"];
export const TYPE_GROUP_LABEL: Record<TypeGroupKey, string> = {
  checking: "Checking", savings: "Savings", credit: "Credit cards", loan: "Loans", investment: "Investments", other: "Other",
};

/** Plaid errors that mean the bank needs the user to sign in again. */
export const BROKEN_ERROR_CODES = new Set(["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION", "PENDING_DISCONNECT"]);
export const STALE_DAYS = 3;
export const MANUAL_BANK = "Added by you";

export interface AccountView {
  /** account_meta key: plaid_accounts.id, or manual:<id>. */
  key: string;
  kind: "linked" | "manual";
  /** Display name (nickname first). */
  name: string;
  /** The bank's own name for the account (rename placeholder). */
  bankAccountName: string;
  bankName: string;
  mask: string | null;
  group: TypeGroupKey;
  /** Signed: debts are negative. */
  balance: number;
  debt: boolean;
  itemId: string | null;
  hidden: boolean;
  countsInNetWorth: boolean;
  linked?: LinkedAccount;
  manual?: ManualAccountLike;
  /** Credit cards: limit from Plaid (or balance + available), when known. */
  limit: number | null;
  /** Credit cards: share of the limit used, 0–1. */
  utilization: number | null;
  /** Next payment due (cards: plaid_credit_details, loans: plaid_loan_details). */
  dueDate: string | null;
  needsSignIn: boolean;
  /** Last good sync for linked rows, ISO. */
  asOf: string | null;
  /** APY label for savings (typed APR or estimated from interest). */
  apy: number | null;
}

const num = (v: unknown) => Number(v) || 0;
const SAVINGS_SUB = /^(savings|money market|hsa|cd)$/;

export function linkedTypeGroup(a: Pick<LinkedAccount, "type" | "subtype">): TypeGroupKey {
  if (a.type === "credit") return "credit";
  if (a.type === "loan") return "loan";
  if (a.type === "investment") return "investment";
  return SAVINGS_SUB.test((a.subtype ?? "").toLowerCase()) ? "savings" : "checking";
}

export function manualTypeGroup(m: Pick<ManualAccountLike, "type" | "role">): TypeGroupKey {
  if (m.role === "debt") return /card|credit/i.test(m.type) ? "credit" : "loan";
  if (/mortgage|loan/.test(m.type)) return "loan";
  if (m.type === "savings") return "savings";
  if (m.type === "investment" || m.role === "investment") return "investment";
  return "other";
}

/** Card limit: Plaid's balances.limit when stored, else balance + available (as before). */
export function creditLimitOf(a: Pick<LinkedAccount, "type" | "current_balance" | "available_balance" | "credit_limit">): number | null {
  if (a.type !== "credit") return null;
  const stored = a.credit_limit == null ? NaN : Number(a.credit_limit);
  if (Number.isFinite(stored) && stored > 0) return stored;
  if (a.available_balance == null) return null;
  const avail = Number(a.available_balance);
  if (!Number.isFinite(avail) || avail < 0) return null;
  const lim = Math.abs(num(a.current_balance)) + avail;
  return lim > 0 ? lim : null;
}

export type Tone = "ok" | "warn" | "bad";
/** Green < 30%, amber 30–50%, red > 50%. */
export function utilizationTone(u: number): Tone {
  if (u > 0.5) return "bad";
  if (u >= 0.3) return "warn";
  return "ok";
}

export function itemIsBroken(h: ItemHealth | undefined): boolean {
  if (!h) return false;
  if (h.error_code && BROKEN_ERROR_CODES.has(h.error_code)) return true;
  return h.status === "login_required" || h.status === "error";
}

export interface BuildInput {
  accounts: readonly LinkedAccount[];
  manual: readonly ManualAccountLike[];
  items: readonly InstitutionItem[];
  meta: AccountMetaMap;
  credit: readonly CreditDetailLike[];
  loans?: readonly LoanDetailLike[];
  health?: Record<string, ItemHealth>;
  /** Savings APY estimate by account_id (from interest credits). */
  impliedApy?: Record<string, number | null>;
}

export function buildAccountViews(inp: BuildInput): AccountView[] {
  const itemName = new Map(inp.items.map(it => [it.id, it.institution_name ?? "Bank"] as const));
  const creditBy = new Map(inp.credit.map(c => [c.account_id, c] as const));
  const loanBy = new Map((inp.loans ?? []).map(l => [l.account_id, l] as const));
  const out: AccountView[] = [];
  for (const a of inp.accounts) {
    const m = inp.meta[a.id] ?? {};
    const bal = num(a.current_balance);
    const debt = isDebtType(a.type);
    const limit = creditLimitOf(a);
    const health = a.item_id ? inp.health?.[a.item_id] : undefined;
    const group = linkedTypeGroup(a);
    const bankAccountName = a.name || a.official_name || "Account";
    const due = a.type === "credit" ? creditBy.get(a.account_id)?.next_payment_due_date ?? null
      : a.type === "loan" ? loanBy.get(a.account_id)?.next_payment_due_date ?? null : null;
    const apy = group === "savings" ? (m.apr ?? inp.impliedApy?.[a.account_id] ?? null) : null;
    out.push({
      key: a.id, kind: "linked", name: m.nickname || bankAccountName, bankAccountName,
      bankName: (a.item_id && itemName.get(a.item_id)) || "Bank", mask: a.mask, group,
      balance: debt ? -Math.abs(bal) : bal, debt, itemId: a.item_id ?? null,
      hidden: !!m.hidden, countsInNetWorth: !m.excludeFromNetWorth, linked: a,
      limit, utilization: limit ? Math.abs(bal) / limit : null, dueDate: due,
      needsSignIn: itemIsBroken(health),
      asOf: health ? (health.last_synced_at ?? null) : null,
      apy: apy != null && apy > 0 ? apy : null,
    });
  }
  for (const mAcct of inp.manual) {
    const key = manualKey(mAcct.id);
    const m = inp.meta[key] ?? {};
    const group = manualTypeGroup(mAcct);
    const debt = mAcct.role === "debt" || group === "loan" || group === "credit";
    const bal = num(mAcct.current_balance);
    out.push({
      key, kind: "manual", name: m.nickname || mAcct.name, bankAccountName: mAcct.name,
      bankName: MANUAL_BANK, mask: null, group, balance: debt ? -Math.abs(bal) : bal, debt, itemId: null,
      hidden: !!m.hidden, countsInNetWorth: !m.excludeFromNetWorth, manual: mAcct,
      limit: null, utilization: null, dueDate: null, needsSignIn: false, asOf: mAcct.updated_at ?? null,
      apy: group === "savings" && mAcct.interest_rate ? Number(mAcct.interest_rate) : null,
    });
  }
  return out;
}

export interface ViewGroup {
  key: string;
  label: string;
  /** Signed sum of the rows. */
  total: number;
  views: AccountView[];
  /** By type → credit cards only: combined limit and balance. */
  limit?: number;
  used?: number;
  /** By bank: the Plaid item behind the group. */
  itemId?: string | null;
  needsSignIn?: boolean;
}

const byBalance = (a: AccountView, b: AccountView) => Math.abs(b.balance) - Math.abs(a.balance);

/** Type groups in a fixed order, empty ones dropped, hidden rows left out. */
export function groupByType(views: readonly AccountView[]): ViewGroup[] {
  const shown = views.filter(v => !v.hidden);
  return TYPE_GROUP_ORDER.map(k => {
    const list = shown.filter(v => v.group === k).sort(byBalance);
    const g: ViewGroup = { key: k, label: TYPE_GROUP_LABEL[k], total: list.reduce((s, v) => s + v.balance, 0), views: list };
    if (k === "credit") {
      const withLimit = list.filter(v => v.limit);
      if (withLimit.length) {
        g.limit = withLimit.reduce((s, v) => s + (v.limit ?? 0), 0);
        g.used = withLimit.reduce((s, v) => s + Math.abs(v.balance), 0);
      }
    }
    return g;
  }).filter(g => g.views.length > 0);
}

/** One group per bank (more accounts first, then A–Z); manual accounts last. */
export function groupByBank(views: readonly AccountView[]): ViewGroup[] {
  const shown = views.filter(v => !v.hidden);
  const map = new Map<string, ViewGroup>();
  for (const v of shown) {
    const key = v.kind === "manual" ? "__manual" : (v.itemId ?? v.bankName);
    let g = map.get(key);
    if (!g) { g = { key, label: v.bankName, total: 0, views: [], itemId: v.itemId, needsSignIn: false }; map.set(key, g); }
    g.views.push(v);
    g.total += v.balance;
    if (v.needsSignIn) g.needsSignIn = true;
  }
  const groups = [...map.values()];
  for (const g of groups) g.views.sort((a, b) => TYPE_GROUP_ORDER.indexOf(a.group) - TYPE_GROUP_ORDER.indexOf(b.group) || byBalance(a, b));
  return groups.sort((a, b) => {
    if (a.key === "__manual") return 1;
    if (b.key === "__manual") return -1;
    return b.views.length - a.views.length || a.label.localeCompare(b.label);
  });
}

export type RowFact =
  | { kind: "signin"; text: string }
  | { kind: "manual"; text: string }
  | { kind: "due"; text: string; soon: boolean }
  | { kind: "apy"; text: string }
  | null;

const DAY = 86_400_000;
const atNoon = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);
export const daysUntil = (iso: string, today: Date) => {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  return Math.round((atNoon(iso).getTime() - t.getTime()) / DAY);
};
export const shortDate = (iso: string) => atNoon(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Needs sign-in > Manual > card due date > APY > nothing. */
export function rowFact(v: AccountView, today: Date): RowFact {
  if (v.needsSignIn) return { kind: "signin", text: v.asOf ? `Needs sign-in · as of ${shortDate(v.asOf)}` : "Needs sign-in" };
  if (v.kind === "manual") return { kind: "manual", text: v.asOf ? `Manual · Updated ${shortDate(v.asOf)}` : "Manual" };
  if (v.group === "credit" && v.dueDate && daysUntil(v.dueDate, today) >= 0) {
    return { kind: "due", text: `Due ${shortDate(v.dueDate)}`, soon: daysUntil(v.dueDate, today) <= 7 };
  }
  if (v.apy != null) return { kind: "apy", text: `${v.apy.toFixed(1)}% APY` };
  return null;
}

/** "Chase ··9921" — the identifier span, allowed to ellipsize. */
export const identifierOf = (v: Pick<AccountView, "bankName" | "mask" | "kind">) =>
  v.kind === "manual" ? MANUAL_BANK : v.mask ? `${v.bankName} ··${v.mask}` : v.bankName;

/** "2h ago" style label for a sync time. */
export const agoLabel = (iso: string | null, now: Date) => {
  if (!iso) return null;
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};
