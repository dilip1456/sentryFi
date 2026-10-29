/**
 * Re-link carry-over: match a bank's accounts across two Plaid Items.
 *
 * "Extend history" links the same bank again as a NEW Item (730 days of
 * history only apply to a new Item, docs/PLAID_HISTORY.md). Plaid gives the
 * new Item new account_ids, so per-account settings are moved over by
 * matching:
 *   1. persistent_account_id (Plaid's stable id at institutions that use
 *      tokenized account numbers), when both sides have it;
 *   2. otherwise mask + type + subtype within the same bank, only when that
 *      combination is unique on both sides (two "Checking ••0042" → no guess).
 * Anything not matched is reported, never guessed.
 *
 * Dependency-free on purpose: supabase/functions/_shared/relink-match.ts is a
 * byte-for-byte copy used by the plaid-relink edge function (a test checks
 * they're identical).
 */

export interface RelinkAccount {
  account_id: string;
  persistent_account_id?: string | null;
  mask?: string | null;
  type?: string | null;
  subtype?: string | null;
  name?: string | null;
}

export type AccountMatchMethod = "persistent" | "mask";

export interface AccountMatch {
  /** old account_id → new account_id */
  map: Record<string, string>;
  method: Record<string, AccountMatchMethod>;
  unmatchedOld: string[];
  unmatchedNew: string[];
}

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
const maskKey = (a: RelinkAccount) => (a.mask ? `${norm(a.type)}|${norm(a.subtype)}|${norm(a.mask)}` : "");

export function matchAccounts(oldAccounts: RelinkAccount[], newAccounts: RelinkAccount[]): AccountMatch {
  const map: Record<string, string> = {};
  const method: Record<string, AccountMatchMethod> = {};
  const usedNew = new Set<string>();

  // 1. persistent_account_id
  const newByPersistent = new Map<string, RelinkAccount[]>();
  for (const n of newAccounts) {
    const p = norm(n.persistent_account_id);
    if (p) newByPersistent.set(p, [...(newByPersistent.get(p) ?? []), n]);
  }
  for (const o of oldAccounts) {
    const p = norm(o.persistent_account_id);
    const hits = p ? newByPersistent.get(p) ?? [] : [];
    if (hits.length === 1 && !usedNew.has(hits[0].account_id)) {
      map[o.account_id] = hits[0].account_id;
      method[o.account_id] = "persistent";
      usedNew.add(hits[0].account_id);
    }
  }

  // 2. mask + type + subtype, unique on both sides
  const count = (list: RelinkAccount[]) => {
    const c = new Map<string, number>();
    for (const a of list) { const k = maskKey(a); if (k) c.set(k, (c.get(k) ?? 0) + 1); }
    return c;
  };
  const oldCounts = count(oldAccounts);
  const newCounts = count(newAccounts);
  for (const o of oldAccounts) {
    if (map[o.account_id]) continue;
    const k = maskKey(o);
    if (!k || oldCounts.get(k) !== 1 || newCounts.get(k) !== 1) continue;
    const n = newAccounts.find(x => maskKey(x) === k);
    if (!n || usedNew.has(n.account_id)) continue;
    map[o.account_id] = n.account_id;
    method[o.account_id] = "mask";
    usedNew.add(n.account_id);
  }

  return {
    map,
    method,
    unmatchedOld: oldAccounts.filter(o => !map[o.account_id]).map(o => o.account_id),
    unmatchedNew: newAccounts.filter(n => !usedNew.has(n.account_id)).map(n => n.account_id),
  };
}
