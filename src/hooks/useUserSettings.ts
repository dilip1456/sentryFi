/**
 * useUserSettings — single source of truth for all user preferences.
 *
 * Replaces 8+ individual localStorage hooks. Loads from Supabase on mount,
 * writes back debounced so we don't hammer the DB on every keystroke.
 * Falls back to localStorage values on first load for zero-friction migration.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { CategoryRule } from "./useCategoryRules";
import type { SmartRule } from "@/lib/txn-rules";

export interface AccountRoleInfo {
  role: "spending" | "buffer" | "reserve" | "savings_goal" | "investment" | "debt" | "unassigned";
  label?: string;
}

export interface ManualIncomeItem { id: string; label: string; amount: number; }
export interface CustomCategory { name: string; type: "income" | "expense"; }
export interface RecurringDismissal {
  merchant: string;          // normalized merchant key
  category?: string;         // plaid category (lowercased) at dismissal time
  reason: string;            // why the user removed it
  suppressCategory?: boolean; // also hide the whole category going forward
  at: string;
}

export interface UserSettings {
  budgets: Record<string, number>;
  accountRoles: Record<string, AccountRoleInfo>;
  catOverrides: Record<string, string>;
  catRules: CategoryRule[];
  smartRules: SmartRule[];
  customCats: CustomCategory[];
  nameOverrides: Record<string, string>;
  nameRules: Record<string, string>;
  manualIncome: ManualIncomeItem[];
  manualInternal: string[];
  manualExternal: string[];
  dismissedInsights: string[];
  dismissedActions: string[];
  dismissedRecurring: string[];
  recurringDismissals: RecurringDismissal[];
  panelOrder: string[];
  accountMeta: Record<string, { apr?: number; nickname?: string }>;
  benefitsUsed: Record<string, boolean>;
  moneyMapFeedback: Record<string, { feedback: string; at: string }>;
}

const DEFAULTS: UserSettings = {
  budgets: {}, accountRoles: {}, catOverrides: {}, catRules: [], smartRules: [],
  customCats: [], nameOverrides: {}, nameRules: {},
  manualIncome: [], manualInternal: [], manualExternal: [],
  dismissedInsights: [], dismissedActions: [], dismissedRecurring: [], recurringDismissals: [],
  panelOrder: [], accountMeta: {}, benefitsUsed: {}, moneyMapFeedback: {},
};

// Migrate existing localStorage data on first load (one-time)
const migrateFromLocalStorage = (): Partial<UserSettings> => {
  const get = (key: string, fallback: any) => {
    try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; }
    catch { return fallback; }
  };
  return {
    budgets: get("sentryfi_budgets", {}),
    accountRoles: get("sentryfi_account_roles", {}),
    catOverrides: get("sentryfi_cat_overrides", {}),
    catRules: get("sentryfi_cat_rules", []),
    customCats: get("sentryfi_custom_categories", []),
    nameOverrides: get("sentryfi_name_overrides", {}),
    nameRules: get("sentryfi_name_rules", {}),
    manualIncome: get("sentryfi_manual_income", []),
    manualInternal: get("sentryfi_manual_internal", []),
    manualExternal: get("sentryfi_manual_external", []),
    dismissedInsights: get("sentryfi_dismissed_insights", []),
    dismissedActions: get("sentryfi_dismissed_actions", []),
    dismissedRecurring: get("sentryfi_dismissed_recurring", []),
    panelOrder: get("sentryfi_panel_order", []),
    accountMeta: get("sentryfi_account_meta", {}),
    benefitsUsed: get("sentryfi_benefits_used", {}),
    moneyMapFeedback: get("sentryfi_money_map_feedback", {}),
  };
};

const dbToSettings = (row: any): UserSettings => ({
  budgets:            row.budgets           ?? {},
  accountRoles:       row.account_roles     ?? {},
  catOverrides:       row.cat_overrides     ?? {},
  catRules:           row.cat_rules         ?? [],
  smartRules:         row.smart_rules       ?? [],
  customCats:         row.custom_cats       ?? [],
  nameOverrides:      row.name_overrides    ?? {},
  nameRules:          row.name_rules        ?? {},
  manualIncome:       row.manual_income     ?? [],
  manualInternal:     row.manual_internal   ?? [],
  manualExternal:     row.manual_external   ?? [],
  dismissedInsights:  row.dismissed_insights  ?? [],
  dismissedActions:   row.dismissed_actions   ?? [],
  dismissedRecurring: row.dismissed_recurring ?? [],
  recurringDismissals: row.recurring_dismissals ?? [],
  panelOrder:         row.panel_order       ?? [],
  accountMeta:        row.account_meta      ?? {},
  benefitsUsed:       row.benefits_used     ?? {},
  moneyMapFeedback:   row.money_map_feedback ?? {},
});

const settingsToDb = (s: UserSettings) => ({
  budgets:             s.budgets,
  account_roles:       s.accountRoles,
  cat_overrides:       s.catOverrides,
  cat_rules:           s.catRules,
  smart_rules:         s.smartRules,
  custom_cats:         s.customCats,
  name_overrides:      s.nameOverrides,
  name_rules:          s.nameRules,
  manual_income:       s.manualIncome,
  manual_internal:     s.manualInternal,
  manual_external:     s.manualExternal,
  dismissed_insights:  s.dismissedInsights,
  dismissed_actions:   s.dismissedActions,
  dismissed_recurring: s.dismissedRecurring,
  recurring_dismissals: s.recurringDismissals,
  panel_order:         s.panelOrder,
  account_meta:        s.accountMeta,
  benefits_used:       s.benefitsUsed,
  money_map_feedback:  s.moneyMapFeedback,
});

export const useUserSettings = (userId: string | undefined) => {
  const [settings, setSettingsState] = useState<UserSettings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSettings = useRef<UserSettings>(DEFAULTS);

  // Load from Supabase on mount
  useEffect(() => {
    if (!userId) { setLoaded(true); return; }  // demo/guest — use defaults immediately
    (async () => {
      const { data, error } = await supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) { console.warn("[settings] load error:", error.message); }

      if (data) {
        // DB row exists — use it (authoritative)
        const s = dbToSettings(data);
        latestSettings.current = s;
        setSettingsState(s);
      } else {
        // First time: migrate from localStorage only if this looks like a returning
        // user (has account roles or budgets set). Brand-new users get clean defaults.
        const ls = migrateFromLocalStorage();
        const hasExistingData = Object.keys(ls.accountRoles ?? {}).length > 0
          || Object.keys(ls.budgets ?? {}).length > 0;
        const migrated = hasExistingData ? { ...DEFAULTS, ...ls } : DEFAULTS;
        latestSettings.current = migrated;
        setSettingsState(migrated);
        await supabase.from("user_settings").insert({
          user_id: userId,
          ...settingsToDb(migrated),
        });
        // Clear localStorage keys so next user on this device starts clean
        [
          "sentryfi_budgets","sentryfi_account_roles","sentryfi_cat_overrides",
          "sentryfi_cat_rules","sentryfi_custom_categories","sentryfi_name_overrides",
          "sentryfi_name_rules","sentryfi_manual_income","sentryfi_manual_internal",
          "sentryfi_manual_external","sentryfi_dismissed_insights","sentryfi_dismissed_actions",
          "sentryfi_dismissed_recurring","sentryfi_panel_order","sentryfi_account_meta",
          "sentryfi_benefits_used","sentryfi_money_map_feedback",
        ].forEach(k => localStorage.removeItem(k));
      }
      setLoaded(true);
    })();
  }, [userId]);

  // Debounced save — batches rapid changes (typing a budget amount) into one write
  const persist = useCallback((next: UserSettings) => {
    latestSettings.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!userId) return;
      await supabase.from("user_settings").upsert({
        user_id: userId,
        ...settingsToDb(latestSettings.current),
      }, { onConflict: "user_id" });
    }, 600);
  }, [userId]);

  const update = useCallback((patch: Partial<UserSettings>) => {
    setSettingsState(prev => {
      const next = { ...prev, ...patch };
      persist(next);
      return next;
    });
  }, [persist]);

  // Convenience updaters matching the old hook signatures
  const setBudget = (cat: string, amount: number) =>
    update({ budgets: { ...latestSettings.current.budgets, [cat]: amount } });
  const removeBudget = (cat: string) => {
    const next = { ...latestSettings.current.budgets };
    delete next[cat];
    update({ budgets: next });
  };

  const setAccountRole = (accountId: string, info: AccountRoleInfo) =>
    update({ accountRoles: { ...latestSettings.current.accountRoles, [accountId]: info } });

  const setCatOverride = (txnId: string, cat: string) =>
    update({ catOverrides: { ...latestSettings.current.catOverrides, [txnId]: cat } });
  const bulkSetCatOverride = (ids: string[], cat: string) => {
    const next = { ...latestSettings.current.catOverrides };
    ids.forEach(id => { next[id] = cat; });
    update({ catOverrides: next });
  };
  const bulkSetCatOverrideMap = (map: Record<string, string>) =>
    update({ catOverrides: { ...latestSettings.current.catOverrides, ...map } });

  const addCatRule = (pattern: string, category: string, matchType: "contains" | "exact" | "starts_with" = "contains") => {
    const rules = latestSettings.current.catRules.filter(
      r => !(r.pattern.toLowerCase() === pattern.toLowerCase() && r.matchType === matchType)
    );
    update({ catRules: [...rules, { id: `rule_${Date.now()}`, pattern, matchType, category, source: "user" as const, enabled: true, createdAt: new Date().toISOString() }] });
  };
  const updateCatRule = (id: string, patch: Partial<CategoryRule>) =>
    update({ catRules: latestSettings.current.catRules.map(r => r.id === id ? { ...r, ...patch } : r) });
  const removeCatRule = (id: string) =>
    update({ catRules: latestSettings.current.catRules.filter(r => r.id !== id) });
  const toggleCatRule = (id: string) =>
    update({ catRules: latestSettings.current.catRules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r) });

  // ── Smart rules (generic multi-condition rules) ──
  const addSmartRule = (rule: SmartRule) =>
    update({ smartRules: [...latestSettings.current.smartRules, rule] });
  const updateSmartRule = (id: string, patch: Partial<SmartRule>) =>
    update({ smartRules: latestSettings.current.smartRules.map(r => r.id === id ? { ...r, ...patch } : r) });
  const removeSmartRule = (id: string) =>
    update({ smartRules: latestSettings.current.smartRules.filter(r => r.id !== id) });
  const toggleSmartRule = (id: string) =>
    update({ smartRules: latestSettings.current.smartRules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r) });

  const addCustomCat = (name: string, type: "income" | "expense") =>
    update({ customCats: [...latestSettings.current.customCats.filter(c => c.name !== name), { name, type }] });
  const removeCustomCat = (name: string) =>
    update({ customCats: latestSettings.current.customCats.filter(c => c.name !== name) });

  const setNameOverride = (txnId: string, name: string) =>
    update({ nameOverrides: { ...latestSettings.current.nameOverrides, [txnId]: name } });
  const bulkSetNameOverride = (ids: string[], name: string) => {
    const next = { ...latestSettings.current.nameOverrides };
    ids.forEach(id => { next[id] = name; });
    update({ nameOverrides: next });
  };
  const saveNameRule = (merchant: string, name: string) =>
    update({ nameRules: { ...latestSettings.current.nameRules, [merchant]: name } });

  const addManualIncome = (item: ManualIncomeItem) =>
    update({ manualIncome: [...latestSettings.current.manualIncome, item] });
  const removeManualIncome = (id: string) =>
    update({ manualIncome: latestSettings.current.manualIncome.filter(m => m.id !== id) });

  const toggleManualInternal = (txnId: string) => {
    const set = new Set(latestSettings.current.manualInternal);
    const extSet = new Set(latestSettings.current.manualExternal);
    if (extSet.has(txnId)) { extSet.delete(txnId); update({ manualExternal: [...extSet] }); return; }
    if (set.has(txnId)) { set.delete(txnId); } else { set.add(txnId); }
    update({ manualInternal: [...set] });
  };

  const dismissInsight = (id: string) =>
    update({ dismissedInsights: [...new Set([...latestSettings.current.dismissedInsights, id])] });
  const dismissAction = (id: string) =>
    update({ dismissedActions: [...new Set([...latestSettings.current.dismissedActions, id])] });
  const dismissRecurring = (merchant: string) =>
    update({ dismissedRecurring: [...new Set([...latestSettings.current.dismissedRecurring, merchant.toLowerCase()])] });

  const dismissRecurringWithReason = (entry: RecurringDismissal) =>
    update({
      dismissedRecurring: [...new Set([...latestSettings.current.dismissedRecurring, entry.merchant.toLowerCase()])],
      recurringDismissals: [
        ...latestSettings.current.recurringDismissals.filter(d => d.merchant !== entry.merchant),
        entry,
      ],
    });

  const clearRecurringDismissals = () =>
    update({ dismissedRecurring: [], recurringDismissals: [] });

  const setPanelOrder = (order: string[]) => update({ panelOrder: order });

  const setAccountMeta = (accountId: string, meta: { apr?: number; nickname?: string }) =>
    update({ accountMeta: { ...latestSettings.current.accountMeta, [accountId]: { ...latestSettings.current.accountMeta[accountId], ...meta } } });

  const setBenefitUsed = (key: string, used: boolean) =>
    update({ benefitsUsed: { ...latestSettings.current.benefitsUsed, [key]: used } });

  const recordFeedback = (suggestionId: string, fb: "accepted" | "dismissed") =>
    update({ moneyMapFeedback: { ...latestSettings.current.moneyMapFeedback, [suggestionId]: { feedback: fb, at: new Date().toISOString() } } });

  return {
    settings, loaded,
    // Raw updater for anything not covered
    update,
    // Typed convenience methods
    setBudget, removeBudget,
    setAccountRole,
    setCatOverride, bulkSetCatOverride, bulkSetCatOverrideMap,
    addCatRule, updateCatRule, removeCatRule, toggleCatRule,
    addSmartRule, updateSmartRule, removeSmartRule, toggleSmartRule,
    addCustomCat, removeCustomCat,
    setNameOverride, bulkSetNameOverride, saveNameRule,
    addManualIncome, removeManualIncome,
    toggleManualInternal,
    dismissInsight, dismissAction, dismissRecurring, dismissRecurringWithReason, clearRecurringDismissals,
    setPanelOrder,
    setAccountMeta,
    setBenefitUsed,
    recordFeedback,
  };
};
