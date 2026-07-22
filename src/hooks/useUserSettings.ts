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

export interface PlannedTransfer {
  id: string;
  category: string;
  month: string;        // "2026-07" — the budget period this covers
  amount: number;
  fromAccountId: string;
  fromAccountName: string;
  createdAt: string;
  done: boolean;
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
  overageFundingPrefs: Record<string, string>; // category -> last-used funding account id (prediction default)
  plannedTransfers: PlannedTransfer[];          // confirmed "move money" suggestions shown on Home
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
  overageFundingPrefs: {}, plannedTransfers: [],
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
  dismissedRecurring: Array.isArray(row.dismissed_recurring) ? row.dismissed_recurring : [],
  recurringDismissals: Array.isArray(row.recurring_dismissals) ? row.recurring_dismissals : [],
  overageFundingPrefs: row.overage_funding_prefs ?? {},
  plannedTransfers:   Array.isArray(row.planned_transfers) ? row.planned_transfers : [],
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
  overage_funding_prefs: s.overageFundingPrefs,
  planned_transfers:   s.plannedTransfers,
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
    if (!userId) { setLoaded(true); return; }
    let cancelled = false;

    const doLoad = async (attempt = 0) => {
      try {
        const { data, error } = await supabase
          .from("user_settings")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle();

        if (cancelled) return;

        if (error) {
          console.warn("[settings] load error:", error.message, "attempt", attempt);
          // Retry once after 1s — Android OAuth token propagation delay
          if (attempt === 0) {
            setTimeout(() => doLoad(1), 1000);
            return;
          }
          // Give up — use defaults so app still loads
          setLoaded(true);
          return;
        }

        if (data) {
          const s = dbToSettings(data);
          latestSettings.current = s;
          setSettingsState(s);
        } else {
          // First time user — start with defaults, save in background
          const ls = migrateFromLocalStorage();
          const hasExistingData = Object.keys(ls.accountRoles ?? {}).length > 0
            || Object.keys(ls.budgets ?? {}).length > 0;
          const migrated = hasExistingData ? { ...DEFAULTS, ...ls } : DEFAULTS;
          latestSettings.current = migrated;
          setSettingsState(migrated);
          // Don't await — let it fail silently if auth not ready yet
          supabase.from("user_settings").insert({
            user_id: userId,
            ...settingsToDb(migrated),
          }).catch(e => console.warn("[settings] insert failed:", e));
        }
      } catch (e) {
        console.warn("[settings] unexpected error:", e);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };

    doLoad();
    return () => { cancelled = true; };
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
    const existing = latestSettings.current.catRules.filter(
      r => !(r.pattern.toLowerCase() === pattern.toLowerCase() && r.matchType === matchType)
    );
    update({ catRules: [...existing, { id: `rule_${Date.now()}`, pattern, matchType, category, source: "user" as const, enabled: true, createdAt: new Date().toISOString() }] });
  };
  // Clear AI-generated per-txn overrides for txn IDs that are now covered by a rule.
  // Call this after adding/updating a rule with the matched transaction IDs.
  const clearAiOverridesForIds = (ids: string[]) => {
    const current = latestSettings.current.catOverrides;
    const next: Record<string,string> = {};
    // Keep only entries that were manually set (not AI-generated)
    // We track AI-generated ones separately via aiCatOverrides
    for (const [k,v] of Object.entries(current)) {
      if (!ids.includes(k)) next[k] = v;
    }
    update({ catOverrides: next });
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

  // ── Overage funding: remember which account covered a category last time,
  // so future overages in that category default (predict) to the same
  // account while the user can still pick a different one. ──
  const setOverageFundingPref = (category: string, accountId: string) =>
    update({ overageFundingPrefs: { ...latestSettings.current.overageFundingPrefs, [category]: accountId } });

  // Confirm a funding choice: records the preference and adds a "you still need
  // to make this transfer" item shown on Home until marked done or dismissed.
  const confirmOverageFunding = (t: Omit<PlannedTransfer, "id" | "createdAt" | "done">) => {
    setOverageFundingPref(t.category, t.fromAccountId);
    const id = `pt_${t.category}_${t.month}`;
    update({
      plannedTransfers: [
        ...latestSettings.current.plannedTransfers.filter(p => p.id !== id),
        { ...t, id, createdAt: new Date().toISOString(), done: false },
      ],
    });
  };

  const markTransferDone = (id: string) =>
    update({ plannedTransfers: latestSettings.current.plannedTransfers.map(p => p.id === id ? { ...p, done: true } : p) });

  const dismissTransfer = (id: string) =>
    update({ plannedTransfers: latestSettings.current.plannedTransfers.filter(p => p.id !== id) });

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
    setCatOverride, bulkSetCatOverride, bulkSetCatOverrideMap, clearAiOverridesForIds,
    addCatRule, updateCatRule, removeCatRule, toggleCatRule,
    addSmartRule, updateSmartRule, removeSmartRule, toggleSmartRule,
    addCustomCat, removeCustomCat,
    setNameOverride, bulkSetNameOverride, saveNameRule,
    addManualIncome, removeManualIncome,
    toggleManualInternal,
    dismissInsight, dismissAction, dismissRecurring, dismissRecurringWithReason, clearRecurringDismissals,
    setOverageFundingPref, confirmOverageFunding, markTransferDone, dismissTransfer,
    setPanelOrder,
    setAccountMeta,
    setBenefitUsed,
    recordFeedback,
  };
};
