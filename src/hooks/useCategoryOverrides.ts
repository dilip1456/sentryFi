import { useState } from "react";

const KEY = "sentrifi_cat_overrides";

export const UNASSIGNED = "Unassigned";

export type CategoryOverrides = Record<string, string>; // txnId → category

export const useCategoryOverrides = () => {
  const [overrides, setOverridesState] = useState<CategoryOverrides>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); }
    catch { return {}; }
  });

  const persist = (next: CategoryOverrides) => {
    setOverridesState(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  };

  const setOverride = (txnId: string, category: string) => {
    persist({ ...overrides, [txnId]: category });
  };

  const bulkSetOverride = (txnIds: string[], category: string) => {
    const next = { ...overrides };
    txnIds.forEach(id => { next[id] = category; });
    persist(next);
  };

  const removeOverride = (txnId: string) => {
    const next = { ...overrides };
    delete next[txnId];
    persist(next);
  };

  /** When a category is deleted, move all its transactions to Unassigned */
  const reassignCategory = (from: string, to: string = UNASSIGNED) => {
    const next = { ...overrides };
    Object.keys(next).forEach(id => {
      if (next[id] === from) next[id] = to;
    });
    persist(next);
  };

  /** Mark a batch of txn IDs as needing AI suggestion (sets to Unassigned) */
  const markUnassigned = (txnIds: string[]) => {
    bulkSetOverride(txnIds, UNASSIGNED);
  };

  return { overrides, setOverride, bulkSetOverride, removeOverride, reassignCategory, markUnassigned };
};
