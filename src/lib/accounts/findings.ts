/**
 * "Things to confirm" on the Accounts page and the "Coming due" list.
 *
 * Findings are computed on the device from data the app already loads, and
 * each has one primary action:
 *  - autopay  : a card looks auto-paid (src/lib/infer detectCardAutopay) and
 *               the user hasn't confirmed it → Confirm.
 *  - dormant  : balance under $5 and no transaction for 120+ days → Hide
 *               ("Keep" snoozes it for 180 days).
 *  - duplicate: the same bank + mask + type linked twice → hide the newer one
 *               and leave it out of net worth.
 *  - apy      : a savings account with no typed APY that earns interest →
 *               "Use 4.2%" stores it as the account's APY.
 * The kinds match the inference kinds account_dormant / account_duplicate the
 * server-side detector writes once those exist (PR B).
 */
import { cardPaymentsFrom, detectCardAutopay, detectedAsAutopay, type CardAutopayResult } from "@/lib/infer/autopay";
import type { ClassifierAccount, ClassifierTxn } from "@/lib/recurring/classifier";
import { shortDate, daysUntil, type AccountView } from "./grouping";
import type { AccountMetaMap, CreditDetailLike, LoanDetailLike } from "./types";

export const DORMANT_MAX_BALANCE = 5;
export const DORMANT_DAYS = 120;
export const KEEP_DAYS = 180;
export const APY_MIN = 0.5;

export type FindingKind = "autopay" | "dormant" | "duplicate" | "apy";
export interface AccountFinding {
  id: string;
  kind: FindingKind;
  /** account_meta key of the account it is about. */
  accountKey: string;
  title: string;
  detail: string;
  action: string;
  /** apy: the rate to store. */
  apy?: number;
  /** autopay: the paying account, when known. */
  fromAccountId?: string | null;
}

export interface FindingTxn { account_id: string; date: string }

const DAY = 86_400_000;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const snoozed = (meta: AccountMetaMap, key: string, kind: FindingKind, today: Date) => {
  const m = meta[key];
  if (!m) return false;
  const until = kind === "dormant" ? m.keepUntil : m.dismissed?.[kind];
  return !!until && until >= iso(today);
};

export function dormantFindings(views: readonly AccountView[], txns: readonly FindingTxn[], meta: AccountMetaMap, today: Date): AccountFinding[] {
  const last = new Map<string, string>();
  for (const t of txns) if ((last.get(t.account_id) ?? "") < t.date) last.set(t.account_id, t.date);
  const cutoff = iso(new Date(today.getTime() - DORMANT_DAYS * DAY));
  return views.filter(v => v.kind === "linked" && !v.hidden && !v.debt && Math.abs(v.balance) < DORMANT_MAX_BALANCE
    && (last.get(v.linked!.account_id) ?? "") < cutoff && !snoozed(meta, v.key, "dormant", today))
    .map(v => ({
      id: `dormant:${v.key}`, kind: "dormant" as const, accountKey: v.key,
      title: `${v.name} looks unused`,
      detail: `${v.balance < 0 ? "-" : ""}$${Math.abs(v.balance).toFixed(2)} and no activity for ${DORMANT_DAYS}+ days`,
      action: "Hide",
    }));
}

/** Same institution + mask + type twice (a bank linked twice). The newer item's row is the duplicate. */
export function duplicateFindings(views: readonly AccountView[], itemCreated: Record<string, string | null | undefined>, meta: AccountMetaMap, today: Date): AccountFinding[] {
  const seen = new Map<string, AccountView[]>();
  for (const v of views) {
    if (v.kind !== "linked" || v.hidden || !v.mask) continue;
    const k = `${v.bankName.toLowerCase()}|${v.mask}|${v.linked!.type}|${v.linked!.subtype ?? ""}`;
    seen.set(k, [...(seen.get(k) ?? []), v]);
  }
  const out: AccountFinding[] = [];
  for (const list of seen.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => (itemCreated[a.itemId ?? ""] ?? "").localeCompare(itemCreated[b.itemId ?? ""] ?? ""));
    for (const dup of sorted.slice(1)) {
      if (snoozed(meta, dup.key, "duplicate", today)) continue;
      out.push({
        id: `duplicate:${dup.key}`, kind: "duplicate", accountKey: dup.key,
        title: `${dup.name} is linked twice`,
        detail: `${dup.bankName} ··${dup.mask} appears ${list.length} times. Hide the copy and leave it out of net worth.`,
        action: "Hide copy",
      });
    }
  }
  return out;
}

export function apyFindings(views: readonly AccountView[], meta: AccountMetaMap, today: Date): AccountFinding[] {
  return views.filter(v => v.kind === "linked" && !v.hidden && v.group === "savings" && meta[v.key]?.apr == null
    && v.apy != null && v.apy >= APY_MIN && !snoozed(meta, v.key, "apy", today))
    .map(v => {
      const rate = Math.round(v.apy! * 10) / 10;
      return {
        id: `apy:${v.key}`, kind: "apy" as const, accountKey: v.key,
        title: `${v.name} earns about ${rate}% APY`,
        detail: "Estimated from the interest it was paid in the last 3 months",
        action: `Use ${rate}%`, apy: rate,
      };
    });
}

export interface AutopayInput {
  txns: readonly (ClassifierTxn & { transaction_id: string })[];
  accounts: readonly ClassifierAccount[];
  credit: readonly CreditDetailLike[];
  cardAutopayFrom: Record<string, string>;
  today: Date;
}

/** Card autopay per card account_id (null when there isn't enough to say). */
export function detectCardAutopays(inp: AutopayInput): Record<string, CardAutopayResult> {
  const cards = inp.accounts.filter(a => (a.type ?? "") === "credit");
  if (!cards.length) return {};
  const payments = cardPaymentsFrom(inp.txns as ClassifierTxn[], inp.accounts as ClassifierAccount[]);
  const out: Record<string, CardAutopayResult> = {};
  for (const c of cards) {
    const details = inp.credit.find(d => d.account_id === c.account_id) ?? null;
    const r = detectCardAutopay({ account: c, details, userAutopayFrom: inp.cardAutopayFrom[c.account_id] ?? null }, payments, { today: iso(inp.today) });
    if (r) out[c.account_id] = r;
  }
  return out;
}

export type AutopayState = "on" | "detected" | "manual" | null;
export function autopayState(v: AccountView, meta: AccountMetaMap, cardAutopayFrom: Record<string, string>, detected?: CardAutopayResult): AutopayState {
  if (v.group !== "credit" || !v.linked) return null;
  if (meta[v.key]?.autopayConfirmed || cardAutopayFrom[v.linked.account_id]) return "on";
  if (detectedAsAutopay(detected)) return "detected";
  if (detected?.autopay === "manual") return "manual";
  return null;
}

export function autopayFindings(views: readonly AccountView[], meta: AccountMetaMap, cardAutopayFrom: Record<string, string>, detected: Record<string, CardAutopayResult>, today: Date): AccountFinding[] {
  return views.filter(v => !v.hidden && autopayState(v, meta, cardAutopayFrom, detected[v.linked?.account_id ?? ""]) === "detected"
    && !snoozed(meta, v.key, "autopay", today))
    .map(v => {
      const r = detected[v.linked!.account_id];
      const how = r.mode === "full" ? "statement balance" : r.mode === "minimum" ? "minimum payment" : r.mode === "fixed" && r.amount ? `$${r.amount.toFixed(0)} each month` : "each month";
      return {
        id: `autopay:${v.key}`, kind: "autopay" as const, accountKey: v.key,
        title: `${v.name} autopay detected`,
        detail: `Looks like it pays the ${how} automatically`,
        action: "Confirm", fromAccountId: r.fromAccountId,
      };
    });
}

export interface ComingDueItem {
  key: string;
  name: string;
  dueDate: string;
  dueLabel: string;
  soon: boolean;
  amount: number | null;
  amountLabel: "statement" | "payment" | "minimum";
  autopay: AutopayState;
  view: AccountView;
}

/** Cards and loans with a due date in the next `days` days, soonest first. */
export function comingDue(
  views: readonly AccountView[], credit: readonly CreditDetailLike[], loans: readonly LoanDetailLike[],
  autopay: (v: AccountView) => AutopayState, today: Date, days = 30,
): ComingDueItem[] {
  const out: ComingDueItem[] = [];
  for (const v of views) {
    if (v.hidden || !v.dueDate || !v.linked) continue;
    const d = daysUntil(v.dueDate, today);
    if (d < 0 || d > days) continue;
    const c = v.group === "credit" ? credit.find(x => x.account_id === v.linked!.account_id) : undefined;
    const l = v.group === "loan" ? loans.find(x => x.account_id === v.linked!.account_id) : undefined;
    const amount = c ? (c.last_statement_balance ?? c.minimum_payment_amount) : l ? l.next_monthly_payment : null;
    const a = autopay(v);
    out.push({
      key: v.key, name: v.name, dueDate: v.dueDate, dueLabel: shortDate(v.dueDate), soon: d <= 7,
      amount: amount == null ? null : Number(amount),
      amountLabel: c ? (c.last_statement_balance != null ? "statement" : "minimum") : "payment",
      autopay: a, view: v,
    });
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
