/**
 * Re-link carry-over: edits whose transaction wasn't found in the new Item
 * yet. The bank sends the 2-year history in the background, so an edit on an
 * older transaction usually matches on a later sync. They're kept in
 * public.relink_carryovers and retried after each load; after 60 days any
 * left are dropped and reported.
 */
import type { UserSettings } from "@/hooks/useUserSettings";
import { matchTransactions, type RelinkTxn } from "./txns";
import { restoreTxnSettings, type TxnOverrideRow, type TxnSettingsSnapshot } from "./remap";

export const PENDING_RETRY_DAYS = 60;

export interface PendingEdit {
  /** old identifiers */
  oldRowId: string | null;
  oldTransactionId: string;
  /** NEW account_id the transaction should appear on */
  accountId: string;
  date: string;
  amount: number;
  name: string | null;
  merchant_name: string | null;
  settings: TxnSettingsSnapshot | null;
  override: Omit<TxnOverrideRow, "transaction_id"> | null;
}

export interface ResolveResult {
  settings: UserSettings;
  overrides: TxnOverrideRow[];
  remaining: PendingEdit[];
  resolved: number;
}

/** Try to place pending edits on transactions that have arrived since. */
export function resolvePending(pending: PendingEdit[], settings: UserSettings, newTxns: RelinkTxn[]): ResolveResult {
  if (!pending.length) return { settings, overrides: [], remaining: [], resolved: 0 };
  const asTxns: RelinkTxn[] = pending.map(p => ({
    id: p.oldRowId, transaction_id: p.oldTransactionId, account_id: p.accountId, date: p.date, amount: p.amount, name: p.name, merchant_name: p.merchant_name,
  }));
  const identity = Object.fromEntries(pending.map(p => [p.accountId, p.accountId]));
  const m = matchTransactions(asTxns, newTxns, identity);
  const rowOf = new Map(newTxns.map(t => [t.transaction_id, t.id ?? null] as const));
  let s = settings;
  const overrides: TxnOverrideRow[] = [];
  const remaining: PendingEdit[] = [];
  for (const p of pending) {
    const newTxnId = m.map[p.oldTransactionId];
    if (!newTxnId) { remaining.push(p); continue; }
    const newRow = rowOf.get(newTxnId);
    if (p.settings && newRow) s = restoreTxnSettings(s, newRow, p.settings);
    else if (p.settings && !newRow) { remaining.push(p); continue; }
    if (p.override) overrides.push({ ...p.override, transaction_id: newTxnId } as TxnOverrideRow);
  }
  return { settings: s, overrides, remaining, resolved: pending.length - remaining.length };
}

export function isExpired(createdAt: string, now: Date): boolean {
  return now.getTime() - new Date(createdAt).getTime() > PENDING_RETRY_DAYS * 86_400_000;
}
