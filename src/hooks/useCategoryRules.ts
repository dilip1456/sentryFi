import { useState } from "react";

const KEY = "sentrifi_cat_rules";

export type CategoryRule = {
  merchantPattern: string;
  category: string;
  createdAt: string;
};

export const useCategoryRules = () => {
  const [rules, setRulesState] = useState<CategoryRule[]>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); }
    catch { return []; }
  });

  const persist = (next: CategoryRule[]) => {
    setRulesState(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  };

  const addRule = (merchantPattern: string, category: string) => {
    const next = [
      ...rules.filter(r => r.merchantPattern.toLowerCase() !== merchantPattern.toLowerCase()),
      { merchantPattern, category, createdAt: new Date().toISOString() },
    ];
    persist(next);
  };

  const updateRule = (merchantPattern: string, newCategory: string) => {
    persist(rules.map(r =>
      r.merchantPattern.toLowerCase() === merchantPattern.toLowerCase()
        ? { ...r, category: newCategory }
        : r
    ));
  };

  const removeRule = (merchantPattern: string) => {
    persist(rules.filter(r => r.merchantPattern.toLowerCase() !== merchantPattern.toLowerCase()));
  };

  const getRuleCategory = (merchantName: string | null): string | null => {
    if (!merchantName) return null;
    const m = merchantName.toLowerCase();
    const rule = rules.find(r =>
      m.includes(r.merchantPattern.toLowerCase()) ||
      r.merchantPattern.toLowerCase().includes(m)
    );
    return rule?.category ?? null;
  };

  return { rules, addRule, updateRule, removeRule, getRuleCategory };
};
