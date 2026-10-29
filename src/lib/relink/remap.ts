/**
 * Re-link carry-over: rewrite the user's own data from old ids to new ids.
 * Pure: returns the new values / the row changes to write; callers persist.
 *
 * App settings (user_settings) key per-transaction edits by the
 * plaid_transactions ROW id and per-account settings by Plaid account_id.
 * Tables (txn_overrides, inferences evidence) use Plaid transaction_id.
 */
import type { UserSettings } from "@/hooks/useUserSettings";
import type { InferenceRow } from "@/lib/infer/types";

export interface IdMaps {
  /** old account_id → new account_id */
  accounts: Record<string, string>;
  /** old plaid_transactions.id → new id */
  rows: Record<string, string>;
  /** old transaction_id → new transaction_id */
  txns: Record<string, string>;
}

/** Settings fields keyed (or valued) by a transaction row id. */
export const TXN_KEYED_SETTINGS = ["catOverrides", "nameOverrides", "txnTags", "txnNotes", "recurringOverrides", "txnSplits"] as const;
export const TXN_LIST_SETTINGS = ["manualInternal", "manualExternal"] as const;
/** Settings fields keyed by account_id. */
export const ACCOUNT_KEYED_SETTINGS = ["accountRoles", "accountMeta", "cardAutopayFrom"] as const;

type TxnKeyed = (typeof TXN_KEYED_SETTINGS)[number];
type TxnList = (typeof TXN_LIST_SETTINGS)[number];

/** Everything the settings hold for one transaction row id (to keep for a later retry). */
export interface TxnSettingsSnapshot {
  maps: Partial<Record<TxnKeyed, unknown>>;
  lists: TxnList[];
  groups: string[];
}

const moveKeys = <T,>(rec: Record<string, T> | undefined, m: Record<string, string>): Record<string, T> => {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(rec ?? {})) out[m[k] ?? k] = v;
  return out;
};
const acct = (m: Record<string, string>, id: string | null | undefined) => (id ? m[id] ?? id : id);

/**
 * Settings with old ids replaced. Per-transaction edits for rows in `drop`
 * (unmatched, kept in a snapshot for retry) are removed so stale keys don't pile up.
 */
export function remapSettings(s: UserSettings, maps: IdMaps, drop: Set<string> = new Set()): UserSettings {
  const a = maps.accounts;
  const r = maps.rows;
  const next: UserSettings = { ...s };
  for (const f of ACCOUNT_KEYED_SETTINGS) (next as unknown as Record<string, unknown>)[f] = moveKeys(s[f] as Record<string, unknown>, a);
  next.cardAutopayFrom = Object.fromEntries(Object.entries(next.cardAutopayFrom ?? {}).map(([k, v]) => [k, acct(a, v) as string]));
  next.overageFundingPrefs = Object.fromEntries(Object.entries(s.overageFundingPrefs ?? {}).map(([k, v]) => [k, acct(a, v) as string]));
  next.plannedTransfers = (s.plannedTransfers ?? []).map(p => ({ ...p, fromAccountId: acct(a, p.fromAccountId) as string }));
  next.savingsGoals = (s.savingsGoals ?? []).map(g => (g.accountId ? { ...g, accountId: acct(a, g.accountId) as string } : g));
  next.manualIncome = (s.manualIncome ?? []).map(m => (m.accountId ? { ...m, accountId: acct(a, m.accountId) as string } : m));

  for (const f of TXN_KEYED_SETTINGS) {
    const src = (s[f] ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (drop.has(k)) continue;
      out[r[k] ?? k] = v;
    }
    (next as unknown as Record<string, unknown>)[f] = out;
  }
  for (const f of TXN_LIST_SETTINGS) next[f] = (s[f] ?? []).filter(id => !drop.has(id)).map(id => r[id] ?? id);
  next.recurringGroups = (s.recurringGroups ?? []).map(g => ({
    ...g,
    accountId: g.accountId ? (acct(a, g.accountId) as string) : g.accountId,
    txnIds: g.txnIds.filter(id => !drop.has(id)).map(id => r[id] ?? id),
  }));
  return next;
}

/** Row ids that carry any per-transaction edit in settings. */
export function editedRowIds(s: UserSettings): Set<string> {
  const ids = new Set<string>();
  for (const f of TXN_KEYED_SETTINGS) for (const k of Object.keys((s[f] ?? {}) as object)) ids.add(k);
  for (const f of TXN_LIST_SETTINGS) for (const id of s[f] ?? []) ids.add(id);
  for (const g of s.recurringGroups ?? []) for (const id of g.txnIds) ids.add(id);
  return ids;
}

export function snapshotTxnSettings(s: UserSettings, rowId: string): TxnSettingsSnapshot {
  const maps: TxnSettingsSnapshot["maps"] = {};
  for (const f of TXN_KEYED_SETTINGS) {
    const v = ((s[f] ?? {}) as Record<string, unknown>)[rowId];
    if (v !== undefined) maps[f] = v;
  }
  return {
    maps,
    lists: TXN_LIST_SETTINGS.filter(f => (s[f] ?? []).includes(rowId)),
    groups: (s.recurringGroups ?? []).filter(g => g.txnIds.includes(rowId)).map(g => g.id),
  };
}

/** Put a snapshot back under a (new) row id. */
export function restoreTxnSettings(s: UserSettings, rowId: string, snap: TxnSettingsSnapshot): UserSettings {
  const next: UserSettings = { ...s };
  for (const [f, v] of Object.entries(snap.maps)) {
    (next as unknown as Record<string, unknown>)[f] = { ...((s[f as TxnKeyed] ?? {}) as Record<string, unknown>), [rowId]: v };
  }
  for (const f of snap.lists) if (!(s[f] ?? []).includes(rowId)) next[f] = [...(s[f] ?? []), rowId];
  if (snap.groups.length) {
    next.recurringGroups = (s.recurringGroups ?? []).map(g =>
      snap.groups.includes(g.id) && !g.txnIds.includes(rowId) ? { ...g, txnIds: [...g.txnIds, rowId] } : g);
  }
  return next;
}

// ── Table rows ──────────────────────────────────────────────────────────────

/** A txn_overrides row (only the columns we copy). */
export interface TxnOverrideRow {
  user_id: string;
  transaction_id: string;
  [col: string]: unknown;
}

/** txn_overrides rows to INSERT under the new transaction_ids (the old ones cascade away with the old Item). */
export function rekeyOverrides(rows: TxnOverrideRow[], txnMap: Record<string, string>): TxnOverrideRow[] {
  return rows
    .filter(r => txnMap[r.transaction_id])
    .map(({ id: _id, created_at: _c, updated_at: _u, ...rest }) => ({ ...rest, transaction_id: txnMap[rest.transaction_id as string] }) as TxnOverrideRow);
}

const ACCOUNT_PAYLOAD_KEYS = ["fromAccountId", "payFromAccountId", "currentFromAccountId", "accountId"] as const;

/**
 * inferences: re-point account subjects, account fields in payloads, and
 * evidence. If the new subject already has a row (re-detected after the
 * link), the old row wins only when the user decided it; otherwise the old
 * one is dropped.
 */
export function remapInferences(rows: InferenceRow[], maps: IdMaps): { updates: InferenceRow[]; deletes: string[] } {
  const a = maps.accounts;
  const t = maps.txns;
  const byKey = new Map(rows.map(r => [`${r.kind}|${r.subject_ref}`, r] as const));
  const updates: InferenceRow[] = [];
  const deletes: string[] = [];
  for (const r of rows) {
    const newRef = r.subject_type === "account" ? a[r.subject_ref] ?? r.subject_ref : r.subject_type === "transaction" ? t[r.subject_ref] ?? r.subject_ref : r.subject_ref;
    const payload: Record<string, unknown> = { ...(r.payload ?? {}) };
    let changed = newRef !== r.subject_ref;
    for (const k of ACCOUNT_PAYLOAD_KEYS) {
      const v = payload[k];
      if (typeof v === "string" && a[v]) { payload[k] = a[v]; changed = true; }
    }
    if (Array.isArray(payload.evidence)) {
      payload.evidence = (payload.evidence as Record<string, unknown>[]).map(e => {
        const ne = { ...e };
        if (typeof e.transactionId === "string" && t[e.transactionId]) { ne.transactionId = t[e.transactionId]; changed = true; }
        if (typeof e.accountId === "string" && a[e.accountId]) { ne.accountId = a[e.accountId]; changed = true; }
        return ne;
      });
    }
    const evidence = (r.evidence_txn_ids ?? []).map(id => t[id] ?? id);
    if (evidence.some((id, i) => id !== r.evidence_txn_ids[i])) changed = true;
    if (!changed) continue;
    const clash = newRef !== r.subject_ref ? byKey.get(`${r.kind}|${newRef}`) : undefined;
    if (clash && clash.id !== r.id) {
      const decided = (x: InferenceRow) => x.status === "confirmed" || x.status === "rejected";
      if (decided(r) || !decided(clash)) { if (clash.id) deletes.push(clash.id); }
      else { if (r.id) deletes.push(r.id); continue; }
    }
    updates.push({ ...r, subject_ref: newRef, payload, evidence_txn_ids: evidence });
  }
  return { updates, deletes };
}

/** recurring_streams / obligations account columns. Returns only changed fields. */
export function remapAccountColumns<T extends Record<string, unknown>>(row: T, cols: (keyof T)[], accounts: Record<string, string>): Partial<T> | null {
  const patch: Partial<T> = {};
  for (const c of cols) {
    const v = row[c];
    if (typeof v === "string" && accounts[v]) patch[c] = accounts[v] as T[keyof T];
  }
  return Object.keys(patch).length ? patch : null;
}
