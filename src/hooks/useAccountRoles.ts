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

export const ROLE_META: Record<AccountRole, { name: string; description: string }> = {
  spending:      { name: "Spending",       description: "Counts toward what you can actually spend right now" },
  buffer:        { name: "Emergency Buffer", description: "Untouchable safety net — never counted as available" },
  reserve:       { name: "Reserve",        description: "Earmarked for something specific (escrow, a trip, a bill)" },
  savings_goal:  { name: "Savings Goal",   description: "Saving toward a target — not available for daily spending" },
  investment:    { name: "Investment",     description: "Brokerage, 401k, etc. — tracked but not spendable" },
  debt:          { name: "Debt",           description: "Credit cards, loans — tracked separately from available funds" },
  unassigned:    { name: "Unassigned",     description: "Not yet categorized" },
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
