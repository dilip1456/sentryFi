/**
 * Net worth, one definition for Home and the Accounts page (moved from
 * LivePlaidDashboard.tsx, where Home computed it inline):
 *
 *  - linked credit and loan balances are owed, every other linked balance is
 *    an asset;
 *  - manual accounts with role "debt" are owed, the rest are assets;
 *  - a manual mortgage / home loan counts as equity: property value minus
 *    the loan when a value is set, otherwise as a debt (−|balance|). The
 *    combined equity is an asset when positive and a debt when negative.
 *
 * Accounts the user hid AND switched "Still count it in net worth" off
 * (account_meta.excludeFromNetWorth) are left out. Hidden accounts still
 * count by default.
 */
import { manualKey, type AccountMetaMap, type LinkedAccount, type ManualAccountLike } from "./types";

export type NetWorthGroup = "checking" | "savings" | "investments" | "cards" | "loans" | "equity" | "other";
export const NET_WORTH_GROUP_ORDER: NetWorthGroup[] = ["checking", "savings", "investments", "cards", "loans", "equity", "other"];
export const NET_WORTH_GROUP_LABEL: Record<NetWorthGroup, string> = {
  checking: "Checking", savings: "Savings", investments: "Investments", cards: "Cards", loans: "Loans", equity: "Home equity", other: "Other",
};

export interface NetWorthTotals {
  assets: number;
  liabilities: number;
  netWorth: number;
  /** Signed contribution per legend group (debts negative); sums to netWorth. */
  byGroup: Record<NetWorthGroup, number>;
}

const num = (v: unknown) => Number(v) || 0;
export const isDebtType = (type: string | null | undefined) => type === "credit" || type === "loan";
const MORTGAGE = new Set(["mortgage", "home_loan"]);
const SAVINGS_SUB = /^(savings|money market|hsa|cd|cash management)$/;

/** Legend group of a linked account. */
export function linkedNetWorthGroup(a: Pick<LinkedAccount, "type" | "subtype">): NetWorthGroup {
  if (a.type === "credit") return "cards";
  if (a.type === "loan") return "loans";
  if (a.type === "investment") return "investments";
  const sub = (a.subtype ?? "").toLowerCase();
  if (SAVINGS_SUB.test(sub)) return "savings";
  return "checking";
}

/** Legend group of a manual (non-mortgage) account. */
export function manualNetWorthGroup(m: Pick<ManualAccountLike, "type" | "role">): NetWorthGroup {
  if (m.role === "debt") return /card|credit/i.test(m.type) ? "cards" : "loans";
  if (m.type === "savings") return "savings";
  if (m.type === "investment" || m.role === "investment") return "investments";
  return "other";
}

/** A manual mortgage's net-worth value: equity with a property value, else the debt. */
export function manualMortgageValue(m: Pick<ManualAccountLike, "current_balance" | "property_value" | "role">): number {
  const bal = num(m.current_balance);
  if (m.property_value) return num(m.property_value) - Math.abs(bal);
  if (m.role === "debt") return -Math.abs(bal);
  return bal;
}

export function countsInNetWorth(meta: AccountMetaMap | undefined, key: string): boolean {
  return !meta?.[key]?.excludeFromNetWorth;
}

export function netWorthTotals(
  accounts: readonly LinkedAccount[],
  manual: readonly ManualAccountLike[] = [],
  meta: AccountMetaMap = {},
): NetWorthTotals {
  const byGroup = Object.fromEntries(NET_WORTH_GROUP_ORDER.map(g => [g, 0])) as Record<NetWorthGroup, number>;
  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    if (!countsInNetWorth(meta, a.id)) continue;
    const bal = num(a.current_balance);
    const g = linkedNetWorthGroup(a);
    if (isDebtType(a.type)) { liabilities += bal; byGroup[g] -= bal; } else { assets += bal; byGroup[g] += bal; }
  }
  let mortgageEquity = 0;
  for (const m of manual) {
    if (!countsInNetWorth(meta, manualKey(m.id))) continue;
    if (MORTGAGE.has(m.type)) { mortgageEquity += manualMortgageValue(m); continue; }
    const bal = num(m.current_balance);
    const g = manualNetWorthGroup(m);
    if (m.role === "debt") { liabilities += bal; byGroup[g] -= bal; } else { assets += bal; byGroup[g] += bal; }
  }
  if (mortgageEquity > 0) { assets += mortgageEquity; byGroup.equity += mortgageEquity; }
  else if (mortgageEquity < 0) { liabilities += -mortgageEquity; byGroup.loans += mortgageEquity; }
  return { assets, liabilities, netWorth: assets - liabilities, byGroup };
}
