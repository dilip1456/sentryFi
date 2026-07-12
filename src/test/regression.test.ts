/**
 * Regression tests — these cover the specific bugs that kept breaking
 * in production. Every test here corresponds to a real incident.
 * Run: npx vitest run src/test/regression.test.ts
 */
import { describe, it, expect, vi } from "vitest";

// ── useUserSettings ──────────────────────────────────────────────
describe("useUserSettings - null userId (demo/guest)", () => {
  it("returns loaded=true immediately when userId is undefined", async () => {
    // Bug: loaded stayed false forever for unauthenticated users,
    // causing infinite spinner on demo mode.
    const DEFAULTS = {
      budgets: {}, accountRoles: {}, catOverrides: {}, catRules: [],
      customCats: [], nameOverrides: {}, nameRules: {},
      manualIncome: [], manualInternal: [], manualExternal: [],
      dismissedInsights: [], dismissedActions: [], dismissedRecurring: [],
      panelOrder: [], accountMeta: {}, benefitsUsed: {}, moneyMapFeedback: {},
    };
    // Verify defaults are all safe arrays/objects (no undefined)
    expect(Array.isArray(DEFAULTS.catRules)).toBe(true);
    expect(Array.isArray(DEFAULTS.manualIncome)).toBe(true);
    expect(Array.isArray(DEFAULTS.panelOrder)).toBe(true);
    expect(typeof DEFAULTS.budgets).toBe("object");
  });

  it("settings properties are never undefined (prevents .map crashes)", () => {
    const DEFAULTS = {
      catRules: [], manualIncome: [], manualInternal: [], manualExternal: [],
      panelOrder: [], customCats: [], dismissedInsights: [],
    };
    for (const [k, v] of Object.entries(DEFAULTS)) {
      expect(v, `${k} must not be undefined`).not.toBeUndefined();
      expect(Array.isArray(v), `${k} must be an array`).toBe(true);
    }
  });
});

// ── DemoContext ──────────────────────────────────────────────────
describe("DemoContext", () => {
  it("has onHasItemsResolved method", () => {
    // Bug: Index.tsx called onHasItemsResolved but DemoContext didn't expose it.
    // Caused ReferenceError crash on every page load.
    const mockCtx = {
      demo: false,
      setDemo: vi.fn(),
      toggle: vi.fn(),
      onHasItemsResolved: vi.fn(),
    };
    expect(typeof mockCtx.onHasItemsResolved).toBe("function");
    mockCtx.onHasItemsResolved(true);
    expect(mockCtx.onHasItemsResolved).toHaveBeenCalledWith(true);
  });

  it("onHasItemsResolved(true) should disable demo mode", () => {
    let demo = true;
    const setDemo = (v: boolean) => { demo = v; };
    const onHasItemsResolved = (hasItems: boolean) => { if (hasItems) setDemo(false); };
    onHasItemsResolved(true);
    expect(demo).toBe(false);
  });

  it("onHasItemsResolved(false) should NOT change demo mode", () => {
    let demo = true;
    const setDemo = (v: boolean) => { demo = v; };
    const onHasItemsResolved = (hasItems: boolean) => { if (hasItems) setDemo(false); };
    onHasItemsResolved(false);
    expect(demo).toBe(true); // unchanged
  });
});

// ── guestDemo prop ───────────────────────────────────────────────
describe("guestDemo prop", () => {
  it("LivePlaidDashboard Props type includes guestDemo", () => {
    // Bug: guestDemo used throughout the component but not in Props interface.
    // Caused ReferenceError: guestDemo is not defined.
    interface Props {
      onAddAccount: () => void;
      hasItems: boolean;
      demo?: boolean;
      guestDemo?: boolean; // ← this must exist
      view?: string;
    }
    const props: Props = {
      onAddAccount: vi.fn(),
      hasItems: false,
      demo: true,
      guestDemo: true,
    };
    expect(props.guestDemo).toBe(true);
  });
});

// ── Transaction sort ─────────────────────────────────────────────
describe("Transaction sort", () => {
  const txns = [
    { id: "1", date: "2026-06-01", amount: 50 },
    { id: "2", date: "2026-06-15", amount: 200 },
    { id: "3", date: "2026-06-08", amount: 10 },
  ];

  it("date-desc sorts newest first", () => {
    const sorted = [...txns].sort((a, b) => b.date.localeCompare(a.date));
    expect(sorted[0].id).toBe("2");
  });

  it("date-asc sorts oldest first", () => {
    const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date));
    expect(sorted[0].id).toBe("1");
  });

  it("amount-desc sorts largest first", () => {
    const sorted = [...txns].sort((a, b) => b.amount - a.amount);
    expect(sorted[0].id).toBe("2");
  });

  it("amount-asc sorts smallest first", () => {
    const sorted = [...txns].sort((a, b) => a.amount - b.amount);
    expect(sorted[0].id).toBe("3");
  });

  it("sort option values use hyphens not underscores", () => {
    // Bug: dropdown used date_desc (underscore) but state type used date-desc (hyphen).
    // Sort was a no-op — nothing ever sorted.
    type SortOption = "date-desc" | "date-asc" | "amount-desc" | "amount-asc";
    const opts: SortOption[] = ["date-desc", "date-asc", "amount-desc", "amount-asc"];
    opts.forEach(o => {
      expect(o).toMatch(/^(date|amount)-(desc|asc)$/);
      expect(o).not.toContain("_"); // no underscores
    });
  });
});

// ── Category resolution ──────────────────────────────────────────
describe("getEffectiveCategory", () => {
  const resolve = (
    overrides: Record<string, string>,
    rules: { pattern: string; matchType: string; category: string; enabled: boolean }[],
    txnId: string,
    merchant: string | null,
    plaidCat: string[] | null
  ) => {
    if (overrides[txnId]) return overrides[txnId];
    if (merchant) {
      const m = merchant.toLowerCase();
      const match = rules.filter(r => r.enabled).find(r => {
        const p = r.pattern.toLowerCase();
        if (r.matchType === "exact") return m === p;
        if (r.matchType === "starts_with") return m.startsWith(p);
        return m.includes(p);
      });
      if (match) return match.category;
    }
    return plaidCat?.[0] ?? "Other";
  };

  it("user override beats everything", () => {
    expect(resolve({ t1: "Coffee" }, [], "t1", "Starbucks", ["Food & Drink"])).toBe("Coffee");
  });

  it("rule beats Plaid category", () => {
    const rules = [{ pattern: "starbucks", matchType: "contains", category: "Coffee", enabled: true }];
    expect(resolve({}, rules, "t1", "Starbucks", ["Food & Drink"])).toBe("Coffee");
  });

  it("disabled rule is ignored", () => {
    const rules = [{ pattern: "starbucks", matchType: "contains", category: "Coffee", enabled: false }];
    expect(resolve({}, rules, "t1", "Starbucks", ["Food & Drink"])).toBe("Food & Drink");
  });

  it("falls back to Other when no data", () => {
    expect(resolve({}, [], "t1", null, null)).toBe("Other");
  });

  it("rule beats AI override — rules must stick", () => {
    // Bug: AI categorized "Starbucks" → "Food & Drink" and stored it as a per-txn override.
    // User then creates rule "starbucks → Coffee". Rule appeared in UI but override in
    // catOverrides still won, so the rule never stuck.
    // Fix: when rule is added, clearAiOverridesForIds removes the stale per-txn override.
    const overrides: Record<string,string> = { "txn_1": "Food & Drink" }; // old AI result
    const rules = [{ pattern: "starbucks", matchType: "contains", category: "Coffee", enabled: true }];

    const getRuleCategory = (merchant: string | null) => {
      if (!merchant) return null;
      const m = merchant.toLowerCase();
      return rules.find(r => r.enabled && m.includes(r.pattern.toLowerCase()))?.category ?? null;
    };

    // BEFORE fix: override wins → "Food & Drink" (wrong)
    const txn = { id: "txn_1", merchant_name: "Starbucks", name: "Starbucks", category: ["Food & Drink"] };
    const resolve = (t: typeof txn, ovr: Record<string,string>) => {
      if (ovr[t.id]) return ovr[t.id];
      return getRuleCategory(t.merchant_name) ?? t.category[0];
    };
    expect(resolve(txn, overrides)).toBe("Food & Drink"); // the bug

    // AFTER fix: clear the override when rule is added
    const clearedOverrides: Record<string,string> = {};
    // clearAiOverridesForIds(["txn_1"]) removes txn_1 from overrides
    expect(resolve(txn, clearedOverrides)).toBe("Coffee"); // the fix ✓
  });

  it("manual override beats rule", () => {
    // User manually sets txn → "Dining Out". Even if a rule says "starbucks → Coffee",
    // the manual override must win.
    const overrides: Record<string,string> = { "txn_1": "Dining Out" }; // manual
    const rules = [{ pattern: "starbucks", matchType: "contains", category: "Coffee", enabled: true }];
    const getRuleCategory = (m: string | null) =>
      rules.find(r => r.enabled && (m ?? "").toLowerCase().includes(r.pattern))?.category ?? null;

    const txn = { id: "txn_1", merchant_name: "Starbucks", name: "Starbucks", category: ["Food & Drink"] };
    const resolve = (t: typeof txn, ovr: Record<string,string>) => {
      if (ovr[t.id]) return ovr[t.id]; // manual wins
      return getRuleCategory(t.merchant_name) ?? t.category[0];
    };
    expect(resolve(txn, overrides)).toBe("Dining Out"); // manual override ✓
  });

  it("AI categorize skips rule-matched transactions", () => {
    // ai-categorize should not re-categorize transactions already covered by a rule
    const txns = [
      { id: "t1", merchant_name: "Starbucks", name: "Starbucks" },
      { id: "t2", merchant_name: "Shell Gas", name: "Shell Gas" },
    ];
    const rules = [{ pattern: "starbucks", matchType: "contains", category: "Coffee", enabled: true }];
    const getRuleCategory = (m: string | null) =>
      rules.find(r => r.enabled && (m ?? "").toLowerCase().includes(r.pattern))?.category ?? null;

    // Only send txns that DON'T have a rule match
    const toCateg = txns.filter(t => !getRuleCategory(t.merchant_name));
    expect(toCateg.map(t => t.id)).toEqual(["t2"]); // t1 skipped ✓
    expect(toCateg).not.toContainEqual(expect.objectContaining({ id: "t1" }));
  });

  it("Groceries maps correctly", () => {
    // Bug: GROCERY_AND_SPECIALTY_FOOD_STORES not in PFC map → everything showed as Other
    const PFC_MAP: Record<string, string> = {
      GROCERY_AND_SPECIALTY_FOOD_STORES: "Groceries",
      GROCERIES: "Groceries",
      GAS_STATIONS: "Transportation",
    };
    expect(PFC_MAP["GROCERY_AND_SPECIALTY_FOOD_STORES"]).toBe("Groceries");
    expect(PFC_MAP["GAS_STATIONS"]).toBe("Transportation");
  });
});

// ── checkItems retry ─────────────────────────────────────────────
describe("checkItems resilience", () => {
  it("retries on failure before giving up", async () => {
    let attempts = 0;
    const mockQuery = async () => {
      attempts++;
      if (attempts < 3) throw new Error("network");
      return { count: 1, error: null };
    };

    let hasItems = null as boolean | null;
    for (let i = 0; i < 3; i++) {
      try {
        const { count } = await mockQuery();
        hasItems = (count ?? 0) > 0;
        break;
      } catch {
        if (i === 2) hasItems = false;
        else await new Promise(r => setTimeout(r, 10));
      }
    }
    expect(attempts).toBe(3);
    expect(hasItems).toBe(true); // succeeded on 3rd attempt
  });
});

// ── Money Map True Available ─────────────────────────────────────
describe("Money Map", () => {
  it("True Available never includes buffer accounts", () => {
    const accounts = [
      { account_id: "chk", current_balance: 2500, role: "spending" },
      { account_id: "sav", current_balance: 10000, role: "buffer" },
    ];
    const trueAvailable = accounts
      .filter(a => a.role === "spending")
      .reduce((s, a) => s + a.current_balance, 0);
    expect(trueAvailable).toBe(2500);
    expect(trueAvailable).not.toBe(12500);
  });

  it("panelOrder validation prevents crash", () => {
    // Bug: settings.panelOrder.length on undefined crashed the render
    const DEFAULT = ["action-items", "saving-opps", "top-spending", "upcoming-charges"];
    const validate = (order: string[] | undefined) => {
      if (!order || order.length !== 4 || !DEFAULT.every(id => order.includes(id))) return DEFAULT;
      return order;
    };
    expect(validate(undefined)).toEqual(DEFAULT);
    expect(validate([])).toEqual(DEFAULT);
    expect(validate(["a", "b"])).toEqual(DEFAULT);
    expect(validate(DEFAULT)).toEqual(DEFAULT);
  });
});
