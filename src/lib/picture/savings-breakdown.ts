/**
 * Savings Breakdown: account balances split into three tiers by how soon the
 * money can be used (prototype: "Use any time" / "Long term" / "Retirement").
 *   now  — checking, savings, money market, cash management
 *   long — HSA, CD, 529 / education, brokerage and other investment accounts
 *   ret  — 401(k), 403(b), 457(b), IRA, Roth, pension, TSP, SEP/SIMPLE…
 * Credit and loan accounts are never savings; zero/negative balances skip.
 */
export type SavingsTier = "now" | "long" | "ret";

export interface TierAccount {
  account_id: string;
  name?: string | null;
  official_name?: string | null;
  type?: string | null;
  subtype?: string | null;
  current_balance?: number | string | null;
  mask?: string | null;
}

const RET_RE = /^(401k|401a|403b|457b|ira|roth|roth 401k|roth ira|sep ira|simple ira|keogh|pension|retirement|tsp|thrift savings plan|lif|lira|rrsp|sarsep|profit sharing plan|stock plan|non-taxable brokerage account)$/i;
const LONG_DEPOSITORY_RE = /^(hsa|cd)$/i;
const EDU_RE = /^(529|education savings account|coverdell)$/i;

export function tierOf(a: TierAccount): SavingsTier | null {
  const type = (a.type ?? "").toLowerCase();
  const sub = (a.subtype ?? "").toLowerCase().trim();
  if (type === "credit" || type === "loan") return null;
  if (RET_RE.test(sub)) return "ret";
  if (LONG_DEPOSITORY_RE.test(sub) || EDU_RE.test(sub)) return "long";
  if (type === "investment" || type === "brokerage") return "long";
  if (type === "depository" || type === "cash" || type === "") return "now";
  return null;
}

export interface SavingsBreakdown {
  total: number;
  tiers: Record<SavingsTier, number>;
  accounts: Record<SavingsTier, { account: TierAccount; balance: number }[]>;
  /** Share of the total in "use any time" cash, 0–100. */
  cashPct: number;
}

export function savingsBreakdown(accounts: TierAccount[]): SavingsBreakdown {
  const tiers: Record<SavingsTier, number> = { now: 0, long: 0, ret: 0 };
  const lists: SavingsBreakdown["accounts"] = { now: [], long: [], ret: [] };
  for (const a of accounts) {
    const bal = Number(a.current_balance) || 0;
    if (bal <= 0) continue;
    const t = tierOf(a);
    if (!t) continue;
    tiers[t] += bal;
    lists[t].push({ account: a, balance: bal });
  }
  for (const k of Object.keys(lists) as SavingsTier[]) lists[k].sort((x, y) => y.balance - x.balance);
  const total = tiers.now + tiers.long + tiers.ret;
  return { total, tiers, accounts: lists, cashPct: total > 0 ? Math.round((tiers.now / total) * 100) : 0 };
}
