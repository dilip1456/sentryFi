import { useState } from "react";

const KEY = "sentryfi_account_roles";

export type AccountRole = "spending" | "buffer" | "reserve" | "savings_goal" | "investment" | "debt" | "unassigned";

export interface AccountRoleInfo {
  role: AccountRole;
  /** Free-text label for reserve/savings_goal accounts, e.g. "Travel", "Insurance Escrow", "New Car".
   *  Used to match overspend categories to the right account in suggestions. */
  label?: string;
}

export type AccountRoles = Record<string, AccountRoleInfo>; // account_id -> role info

export const ROLE_META: Record<AccountRole, { name: string; description: string; short: string }> = {
  spending:      { name: "Everyday Expenses",    short: "Expenses",    description: "Checking or debit accounts you pay from day-to-day" },
  buffer:        { name: "Emergency Fund",       short: "Emergency",   description: "3–6 month safety net — never counted as spendable" },
  reserve:       { name: "Short-Term Savings",   short: "Near-Term",   description: "Earmarked for specific upcoming needs (escrow, a trip, a bill)" },
  savings_goal:  { name: "Long-Term Savings",    short: "Long-Term",   description: "Working toward a target that is months or years away" },
  investment:    { name: "Investments",          short: "Invest",      description: "Brokerage, 401k, IRA — tracked but not liquid spending money" },
  debt:          { name: "Debt & Credit",        short: "Debt",        description: "Credit cards and loans — balances tracked, not available funds" },
  unassigned:    { name: "Unassigned",           short: "?",           description: "Not yet categorized — tag this account to unlock insights" },
};

export const useAccountRoles = () => {
  const [roles, setRolesState] = useState<AccountRoles>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); }
    catch { return {}; }
  });

  const setRole = (accountId: string, info: AccountRoleInfo) => {
    const next = { ...roles, [accountId]: info };
    setRolesState(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  };

  const removeRole = (accountId: string) => {
    const next = { ...roles };
    delete next[accountId];
    setRolesState(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  };

  const getRole = (accountId: string, accountType?: string | null, accountSubtype?: string | null): AccountRoleInfo => {
    if (roles[accountId]) return roles[accountId];
    // Sensible defaults so the feature is useful before any manual tagging:
    // credit/loan accounts are debt, investment-type accounts are investment,
    // checking defaults to spending, savings defaults to unassigned (since
    // savings could be a buffer, a goal, or just spillover — worth asking).
    if (accountType === "credit" || accountType === "loan") return { role: "debt" };
    if (accountType === "investment") return { role: "investment" };
    if (accountSubtype === "checking") return { role: "spending" };
    return { role: "unassigned" };
  };

  return { roles, setRole, removeRole, getRole };
};
