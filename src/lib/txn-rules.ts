/**
 * Shared transaction condition + rule engine.
 *
 * One condition model powers both the transaction filter and the Smart Rules.
 * A condition tests a single field with an operator; a ConditionSet combines
 * several with all/any (AND/OR). A SmartRule pairs a ConditionSet with a set of
 * actions (set category, rename, mark internal) that run against every
 * transaction, so newly synced transactions are handled automatically.
 */

export type TxnField =
  | "amount" | "merchant" | "category" | "account" | "account_type"
  | "date" | "flow" | "pending";

export type TxnOp =
  // numeric (amount)
  | "gt" | "lt" | "gte" | "lte" | "eq" | "neq" | "between"
  // text (merchant, category)
  | "contains" | "not_contains" | "starts_with" | "ends_with" | "is" | "is_not" | "fuzzy"
  // date
  | "before" | "after" | "on";

export interface Condition {
  id: string;
  field: TxnField;
  op: TxnOp;
  value: string;
  value2?: string; // upper bound for "between"
}

export interface ConditionSet {
  match: "all" | "any";
  conditions: Condition[];
}

export type RuleAction =
  | { type: "set_category"; value: string }
  | { type: "rename"; value: string }
  | { type: "mark_internal" };

export interface SmartRule {
  id: string;
  name: string;
  enabled: boolean;
  match: "all" | "any";
  conditions: Condition[];
  actions: RuleAction[];
  createdAt: string;
}

/** Normalized view of a transaction the evaluator reads from. */
export interface EvalTxn {
  amount: number;      // signed: expenses positive, income negative (Plaid convention)
  absAmount: number;
  merchant: string;
  category: string;    // formatted / human category
  accountId: string;
  accountName: string;
  accountType: string;
  date: string;        // YYYY-MM-DD
  flow: "expense" | "income";
  pending: boolean;
}

// ── Field metadata (drives the UI dropdowns) ──────────────────────────
export const FIELD_META: Record<TxnField, { label: string; kind: "number" | "text" | "select" | "date"; ops: TxnOp[] }> = {
  amount:       { label: "Amount",        kind: "number", ops: ["gt", "lt", "gte", "lte", "eq", "neq", "between"] },
  merchant:     { label: "Name",          kind: "text",   ops: ["contains", "not_contains", "starts_with", "ends_with", "is", "is_not", "fuzzy"] },
  category:     { label: "Category",      kind: "text",   ops: ["is", "is_not", "contains", "not_contains"] },
  account:      { label: "Account",       kind: "select", ops: ["is", "is_not"] },
  account_type: { label: "Account type",  kind: "select", ops: ["is", "is_not"] },
  date:         { label: "Date",          kind: "date",   ops: ["on", "before", "after", "between"] },
  flow:         { label: "Type",          kind: "select", ops: ["is", "is_not"] },
  pending:      { label: "Pending",       kind: "select", ops: ["is"] },
};

export const OP_LABEL: Record<TxnOp, string> = {
  gt: "greater than", lt: "less than", gte: "at least", lte: "at most",
  eq: "equals", neq: "not equal to", between: "between",
  contains: "contains", not_contains: "does not contain",
  starts_with: "starts with", ends_with: "ends with",
  is: "is", is_not: "is not", fuzzy: "sounds like",
  before: "before", after: "after", on: "on",
};

// ── Fuzzy matching (lightweight Levenshtein ratio) ────────────────────
const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      cur.push(Math.min(prev[j + 1] + 1, cur[j] + 1, prev[j] + cost));
    }
    prev = cur;
  }
  return prev[b.length];
};

/** 0..1 similarity. Also treats substring containment as a strong match. */
export const fuzzyRatio = (a: string, b: string): number => {
  a = a.toLowerCase().trim(); b = b.toLowerCase().trim();
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) return 0.95;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
};

const FUZZY_THRESHOLD = 0.7;

// ── Evaluation ────────────────────────────────────────────────────────
export const evaluateCondition = (c: Condition, t: EvalTxn): boolean => {
  const raw = (c.value ?? "").trim();
  const v = raw.toLowerCase();

  switch (c.field) {
    case "amount": {
      const amt = t.absAmount;
      const n = parseFloat(raw);
      if (c.op === "between") {
        const lo = parseFloat(raw); const hi = parseFloat(c.value2 ?? "");
        if (isNaN(lo) || isNaN(hi)) return true;
        return amt >= Math.min(lo, hi) && amt <= Math.max(lo, hi);
      }
      if (isNaN(n)) return true;
      switch (c.op) {
        case "gt": return amt > n;
        case "lt": return amt < n;
        case "gte": return amt >= n;
        case "lte": return amt <= n;
        case "eq": return Math.abs(amt - n) < 0.01;
        case "neq": return Math.abs(amt - n) >= 0.01;
        default: return true;
      }
    }
    case "merchant": {
      const m = t.merchant.toLowerCase();
      switch (c.op) {
        case "contains": return m.includes(v);
        case "not_contains": return !m.includes(v);
        case "starts_with": return m.startsWith(v);
        case "ends_with": return m.endsWith(v);
        case "is": return m === v;
        case "is_not": return m !== v;
        case "fuzzy": return fuzzyRatio(m, v) >= FUZZY_THRESHOLD;
        default: return true;
      }
    }
    case "category": {
      const cat = t.category.toLowerCase();
      switch (c.op) {
        case "is": return cat === v;
        case "is_not": return cat !== v;
        case "contains": return cat.includes(v);
        case "not_contains": return !cat.includes(v);
        default: return true;
      }
    }
    case "account": {
      // value is the account id
      return c.op === "is_not" ? t.accountId !== raw : t.accountId === raw;
    }
    case "account_type": {
      const at = t.accountType.toLowerCase();
      return c.op === "is_not" ? at !== v : at === v;
    }
    case "flow": {
      return c.op === "is_not" ? t.flow !== v : t.flow === v;
    }
    case "pending": {
      const want = v === "true" || v === "yes" || v === "pending";
      return t.pending === want;
    }
    case "date": {
      const d = t.date;
      switch (c.op) {
        case "on": return d === raw;
        case "before": return d < raw;
        case "after": return d > raw;
        case "between": {
          const lo = raw; const hi = c.value2 ?? "";
          if (!lo || !hi) return true;
          return d >= (lo < hi ? lo : hi) && d <= (lo < hi ? hi : lo);
        }
        default: return true;
      }
    }
    default: return true;
  }
};

export const evaluateSet = (set: ConditionSet, t: EvalTxn): boolean => {
  const active = set.conditions.filter(c => (c.value ?? "").trim() !== "" || c.field === "pending");
  if (active.length === 0) return true;
  return set.match === "all"
    ? active.every(c => evaluateCondition(c, t))
    : active.some(c => evaluateCondition(c, t));
};

export const ruleMatches = (rule: SmartRule, t: EvalTxn): boolean =>
  rule.enabled && evaluateSet({ match: rule.match, conditions: rule.conditions }, t);

export const emptyCondition = (): Condition => ({
  id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  field: "merchant", op: "contains", value: "",
});

export const emptyRule = (): SmartRule => ({
  id: `sr_${Date.now()}`,
  name: "",
  enabled: true,
  match: "all",
  conditions: [emptyCondition()],
  actions: [{ type: "set_category", value: "" }],
  createdAt: new Date().toISOString(),
});
