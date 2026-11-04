/**
 * Synthetic Plaid-shaped data for Financial Picture detection tests.
 * Amounts use Plaid's sign (> 0 money out, < 0 money in). Nothing here is
 * real data: names, masks and amounts are made up to mirror real patterns
 * (payer-name variants, raises, bonuses, loan-account legs, P2P...).
 */
import { classifyAll } from "@/lib/classify";
import { normalisePlaidCategory } from "@/lib/classify/plaid-categories";
import type { ClassifierTxn } from "@/lib/classify";
import { buildPictureModel, type PAccount, type PClass, type PTxn, type PictureInputs } from "@/lib/picture/model";
import type { FinancialPictureData } from "@/hooks/useUserSettings";

export const TODAY = "2026-10-29";
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
/** Move a Sat/Sun date to the Friday before (paydays) or Monday after (bills). */
const business = (s: string, dir: "before" | "after") => {
  const wd = D(s).getUTCDay();
  if (wd === 6) return addDays(s, dir === "before" ? -1 : 2);
  if (wd === 0) return addDays(s, dir === "before" ? -2 : 1);
  return s;
};
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Every `step` days from `start` while <= TODAY. */
export function everyNDays(start: string, step: number, end = TODAY): string[] {
  const out: string[] = []; for (let d = start; d <= end; d = addDays(d, step)) out.push(d); return out;
}
/** Day `day` of each month from `from` (YYYY-MM) through TODAY. 31 = last day. */
export function monthly(from: string, day: number, dir: "before" | "after" = "after", end = TODAY): string[] {
  const out: string[] = []; let [y, m] = from.split("-").map(Number);
  for (;;) {
    const d = business(`${y}-${pad(m)}-${pad(Math.min(day, lastDay(y, m)))}`, dir);
    if (d > end) break; out.push(d);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
export function semimonthly(from: string, end = TODAY): string[] {
  const out: string[] = []; let [y, m] = from.split("-").map(Number);
  for (;;) {
    const a = business(`${y}-${pad(m)}-15`, "before"), b = business(`${y}-${pad(m)}-${lastDay(y, m)}`, "before");
    if (a > end) break; out.push(a); if (b <= end) out.push(b);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export interface Fx { txns: PTxn[]; accounts: PAccount[] }
let seq = 0;
export class Builder {
  txns: PTxn[] = []; accounts: PAccount[] = [];
  acct(id: string, name: string, type: string, subtype: string, mask: string, balance = 1000, item = "item-1") {
    this.accounts.push({ id: `row-${id}`, account_id: id, name, official_name: null, type, subtype, mask, current_balance: balance, item_id: item });
    return this;
  }
  tx(account: string, date: string, amount: number, name: string, opts: Partial<PTxn> & { pfc?: string; pfcd?: string; cat?: string[] } = {}) {
    const id = `t${++seq}`;
    const { pfc, pfcd, cat, ...rest } = opts;
    const t: PTxn = {
      id, transaction_id: `plaid-${id}`, account_id: account, amount, date, name, merchant_name: null,
      category: cat ?? null, pending: false, payment_channel: "other", pfc_primary: pfc ?? null, pfc_detailed: pfcd ?? null, pfc_confidence: pfc ? "HIGH" : null, ...rest,
    };
    this.txns.push(t); return t;
  }
  series(account: string, dates: string[], amount: number | ((i: number, d: string) => number), name: string | ((i: number) => string), opts: Partial<PTxn> & { pfc?: string; pfcd?: string; cat?: string[] } = {}) {
    return dates.map((d, i) => this.tx(account, d, typeof amount === "function" ? amount(i, d) : amount, typeof name === "function" ? name(i) : name, opts));
  }
  /** A transfer between two linked accounts (out leg on `from`, in leg on `to`). */
  pair(from: string, to: string, dates: string[], amount: number | ((i: number) => number), outName: string, inName: string, outOpts: Partial<PTxn> & { pfc?: string; pfcd?: string } = {}, inOpts: Partial<PTxn> & { pfc?: string; pfcd?: string } = {}) {
    dates.forEach((d, i) => {
      const a = typeof amount === "function" ? amount(i) : amount;
      this.tx(from, d, a, outName, outOpts); this.tx(to, d, -a, inName, inOpts);
    });
  }
  fx(): Fx { return { txns: this.txns, accounts: this.accounts }; }
}

/** Run the app's own classifier + the picture model the way LivePlaidDashboard does. */
export function picture(fx: Fx, extra: Partial<PictureInputs> & { fp?: FinancialPictureData } = {}) {
  const classes = classifyAll(fx.txns as unknown as ClassifierTxn[], {
    accounts: fx.accounts.map(a => ({ account_id: a.account_id, item_id: (a.item_id as string) ?? null, name: a.name, mask: a.mask ?? null, type: a.type, subtype: a.subtype })),
    plaidCategory: t => normalisePlaidCategory(t.category, t.merchant_name, t.name),
  });
  const classOf = (t: PTxn) => classes.get(t.id) as PClass | undefined;
  const m = buildPictureModel({
    txns: fx.txns, accounts: fx.accounts, classOf,
    getEffectiveCategory: t => normalisePlaidCategory(t.category, t.merchant_name, t.name),
    budgets: {}, cardAutopayFrom: {}, savingsGoals: [], fp: extra.fp ?? { overrides: {}, fundingAccounts: {} }, today: new Date(2026, 9, 29, 12),
    ...extra,
  });
  return { m, classOf, classes };
}
