import { useState, useCallback } from "react";

const KEY = "sentryfi_cat_rules";

export type RuleSource = "user" | "system";
export type RuleMatchType = "exact" | "contains" | "starts_with";

export interface CategoryRule {
  id: string;
  pattern: string;
  matchType: RuleMatchType;
  category: string;
  source: RuleSource;
  enabled: boolean;
  createdAt: string;
  // legacy compat
  merchantPattern?: string;
}

const migrate = (raw: unknown[]): CategoryRule[] =>
  raw.map((r: any, i) => ({
    id: r.id ?? `rule_${i}`,
    pattern: r.pattern ?? r.merchantPattern ?? "",
    matchType: (r.matchType as RuleMatchType) ?? "contains",
    category: r.category ?? "Other",
    source: (r.source as RuleSource) ?? "user",
    enabled: r.enabled ?? true,
    createdAt: r.createdAt ?? new Date().toISOString(),
  }));

export const useCategoryRules = () => {
  const [rules, setRulesState] = useState<CategoryRule[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      return migrate(Array.isArray(raw) ? raw : []);
    } catch { return []; }
  });

  const persist = (next: CategoryRule[]) => {
    setRulesState(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  };

  const addRule = (pattern: string, category: string, matchType: RuleMatchType = "contains", source: RuleSource = "user") => {
    const id = `rule_${Date.now()}`;
    // remove any existing rule with the same pattern+matchType
    const filtered = rules.filter(r => !(r.pattern.toLowerCase() === pattern.toLowerCase() && r.matchType === matchType));
    persist([...filtered, { id, pattern, matchType, category, source, enabled: true, createdAt: new Date().toISOString() }]);
  };

  const updateRule = (id: string, updates: Partial<Pick<CategoryRule, "pattern" | "category" | "matchType" | "enabled">>) => {
    persist(rules.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  const removeRule = (id: string) => {
    persist(rules.filter(r => r.id !== id));
  };

  const toggleRule = (id: string) => {
    persist(rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  };

  const getRuleCategory = useCallback((merchantName: string | null): string | null => {
    if (!merchantName) return null;
    const m = merchantName.toLowerCase();
    // User rules first (higher priority), then system, skip disabled
    const ordered = [...rules.filter(r => r.source === "user"), ...rules.filter(r => r.source === "system")];
    const match = ordered.find(r => {
      if (!r.enabled) return false;
      const p = r.pattern.toLowerCase();
      if (p.length < 2) return false;
      switch (r.matchType) {
        case "exact": return m === p;
        case "starts_with": return m.startsWith(p);
        case "contains": default: return m.includes(p);
      }
    });
    return match?.category ?? null;
  }, [rules]);

  const getMatchCount = (rule: CategoryRule, txns: { merchant_name: string | null; name: string | null }[]): number => {
    const p = rule.pattern.toLowerCase();
    return txns.filter(t => {
      const m = (t.merchant_name ?? t.name ?? "").toLowerCase();
      switch (rule.matchType) {
        case "exact": return m === p;
        case "starts_with": return m.startsWith(p);
        case "contains": default: return m.includes(p);
      }
    }).length;
  };

  return { rules, addRule, updateRule, removeRule, toggleRule, getRuleCategory, getMatchCount };
};
