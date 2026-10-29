/**
 * "Extend history" carry-over, run right after the bank is linked again as a
 * new Item and BEFORE the old Item is removed (so old transactions can still
 * be read and txn_overrides don't cascade away first).
 *
 *   1. plaid-relink (edge function) matches accounts and moves the
 *      service-only statement history; returns the account map.
 *   2. Transactions with the user's edits are matched to the new Item.
 *   3. Settings, txn_overrides, findings, recurring streams and obligations
 *      are re-pointed. Edits whose transaction hasn't arrived yet are kept in
 *      relink_carryovers and retried on later loads (pending.ts).
 *   4. The old Item is removed (plaid-remove-item).
 */
import type { UserSettings } from "@/hooks/useUserSettings";
import type { InferenceRow } from "@/lib/infer/types";
import { matchTransactions, type RelinkTxn } from "./txns";
import {
  editedRowIds,
  rekeyOverrides,
  remapAccountColumns,
  remapInferences,
  remapSettings,
  snapshotTxnSettings,
  type IdMaps,
  type TxnOverrideRow,
} from "./remap";
import type { PendingEdit } from "./pending";

export interface RelinkAccountInfo { account_id: string; name: string | null; mask: string | null }

export interface RelinkServerResult {
  accountMap: Record<string, string>;
  unmatchedOld: RelinkAccountInfo[];
  unmatchedNew: RelinkAccountInfo[];
}

export interface StreamAccountRow { id: string; account_id: string | null; counterpart_account_id: string | null; pay_from_account_id?: string | null }
export interface ObligationAccountRow { id: string; funding_account_id: string | null }

export interface CarryoverDeps {
  relink(oldItemId: string, newItemId: string): Promise<RelinkServerResult>;
  loadTxns(accountIds: string[]): Promise<RelinkTxn[]>;
  loadOverrides(transactionIds: string[]): Promise<TxnOverrideRow[]>;
  insertOverrides(rows: TxnOverrideRow[]): Promise<void>;
  loadInferences(): Promise<InferenceRow[]>;
  saveInferences(rows: InferenceRow[], deleteIds: string[]): Promise<void>;
  loadStreams(): Promise<StreamAccountRow[]>;
  patchStream(id: string, patch: Partial<StreamAccountRow>): Promise<void>;
  loadObligations(): Promise<ObligationAccountRow[]>;
  patchObligation(id: string, patch: Partial<ObligationAccountRow>): Promise<void>;
  getSettings(): UserSettings;
  setSettings(next: UserSettings): Promise<void>;
  savePending(oldItemId: string, newItemId: string, accountMap: Record<string, string>, pending: PendingEdit[]): Promise<void>;
  removeItem(itemId: string): Promise<void>;
}

export interface CarryoverReport {
  accountsMoved: number;
  /** old accounts that couldn't be matched: their settings and edits reset */
  accountsUnmatched: RelinkAccountInfo[];
  editsMoved: number;
  /** edits waiting for older history to arrive (retried automatically) */
  editsPending: number;
  /** edits on accounts that couldn't be matched (lost) */
  editsLost: number;
  oldItemRemoved: boolean;
}

export async function runCarryover(deps: CarryoverDeps, oldItemId: string, newItemId: string): Promise<CarryoverReport> {
  const server = await deps.relink(oldItemId, newItemId);
  const accountMap = server.accountMap;
  const oldAccountIds = [...Object.keys(accountMap), ...server.unmatchedOld.map(a => a.account_id)];
  const [oldTxns, newTxns] = await Promise.all([
    deps.loadTxns(oldAccountIds),
    deps.loadTxns(Object.values(accountMap)),
  ]);

  const settings = deps.getSettings();
  const edited = editedRowIds(settings);
  const overrides = await deps.loadOverrides(oldTxns.map(t => t.transaction_id));
  const overriddenTxnIds = new Set(overrides.map(o => o.transaction_id));
  const withEdits = oldTxns.filter(t => (t.id && edited.has(t.id)) || overriddenTxnIds.has(t.transaction_id));

  const m = matchTransactions(oldTxns, newTxns, accountMap);
  const maps: IdMaps = { accounts: accountMap, rows: m.rowMap, txns: m.map };

  // Edits that didn't match: keep for retry when on a matched account, else lost.
  const pending: PendingEdit[] = [];
  const drop = new Set<string>();
  let lost = 0;
  for (const t of withEdits) {
    if (m.map[t.transaction_id]) continue;
    if (t.id) drop.add(t.id);
    const newAccount = accountMap[t.account_id];
    if (!newAccount) { lost++; continue; }
    const ov = overrides.find(o => o.transaction_id === t.transaction_id);
    const { transaction_id: _t, id: _i, created_at: _c, updated_at: _u, ...ovRest } = (ov ?? {}) as Record<string, unknown>;
    pending.push({
      oldRowId: t.id ?? null,
      oldTransactionId: t.transaction_id,
      accountId: newAccount,
      date: t.date,
      amount: Number(t.amount),
      name: t.name ?? null,
      merchant_name: t.merchant_name ?? null,
      settings: t.id ? snapshotTxnSettings(settings, t.id) : null,
      override: ov ? (ovRest as PendingEdit["override"]) : null,
    });
  }

  await deps.setSettings(remapSettings(settings, maps, drop));
  const moved = rekeyOverrides(overrides, m.map);
  if (moved.length) await deps.insertOverrides(moved);

  const inf = remapInferences(await deps.loadInferences(), maps);
  if (inf.updates.length || inf.deletes.length) await deps.saveInferences(inf.updates, inf.deletes);
  for (const s of await deps.loadStreams()) {
    const patch = remapAccountColumns(s as unknown as Record<string, unknown>, ["account_id", "counterpart_account_id", "pay_from_account_id"], accountMap);
    if (patch) await deps.patchStream(s.id, patch as Partial<StreamAccountRow>);
  }
  for (const o of await deps.loadObligations()) {
    const patch = remapAccountColumns(o as unknown as Record<string, unknown>, ["funding_account_id"], accountMap);
    if (patch) await deps.patchObligation(o.id, patch as Partial<ObligationAccountRow>);
  }
  if (pending.length) await deps.savePending(oldItemId, newItemId, accountMap, pending);

  let oldItemRemoved = true;
  try { await deps.removeItem(oldItemId); } catch { oldItemRemoved = false; }

  return {
    accountsMoved: Object.keys(accountMap).length,
    accountsUnmatched: server.unmatchedOld,
    editsMoved: withEdits.length - pending.length - lost,
    editsPending: pending.length,
    editsLost: lost,
    oldItemRemoved,
  };
}
