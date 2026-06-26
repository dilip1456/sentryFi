import { useState } from "react";

const KEY = "sentryfi_budgets";

export type Budgets = Record<string, number>; // category → monthly limit in $

export const useBudgets = () => {
  const [budgets, setBudgetsState] = useState<Budgets>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); }
    catch { return {}; }
  });

  const setBudget = (category: string, limit: number) => {
    const next = { ...budgets, [category]: limit };
    setBudgetsState(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  };

  const removeBudget = (category: string) => {
    const next = { ...budgets };
    delete next[category];
    setBudgetsState(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  };

  return { budgets, setBudget, removeBudget };
};
