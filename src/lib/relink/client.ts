/**
 * Supabase side of "Extend history" (Settings → Banks):
 *
 *   createCarryoverDeps()   the CarryoverDeps that runCarryover() needs,
 *                           talking to the tables / edge functions;
 *   retryPendingCarryovers() places edits whose transaction hadn't arrived
 *                           at re-link time (relink_carryovers), run after
 *                           each live load; rows older than 60 days are
 *                           dropped.
 *
 * Tables that aren't migrated yet (inferences, recurring_streams on an older
 * database) read as empty so the carry-over still moves everything else.
 */
import type { UserSettings } from "@/hooks/useUserSettings";
import type { InferenceRow } from "@/lib/infer/types";
import type { CarryoverDeps, ObligationAccountRow, RelinkServerResult, StreamAccountRow } from "./carryover";
import { isExpired, resolvePending, type PendingEdit } from "./pending";
import type { RelinkTxn } from "./txns";
import type { TxnOverrideRow } from "./remap";

type Res<T> = PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>;
/** The slice of the Supabase query builder used here (most tables aren't in the generated types). */
/* eslint-disable @typescript-eslint/no-explicit-any -- untyped tables, see above */
export interface RelinkDb {
  from(table: string): any;
  functions: { invoke(name: string, opts: { body: unknown }): Promise<{ data: any; error: { message: string } | null }> };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const CHUNK = 200;
const chunks = <T,>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));
/** A missing table / column (not migrated yet): treat as empty. */
const missing = (e: { code?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "42703");

async function rows<T>(q: Res<T[]>, what: string): Promise<T[]> {
  const { data, error } = await q;
  if (error) { if (missing(error)) return []; throw new Error(`${what}: ${error.message}`); }
  return data ?? [];
}
async function ok(q: Res<unknown>, what: string): Promise<void> {
  const { error } = await q;
  if (error && !missing(error)) throw new Error(`${what}: ${error.message}`);
}

const TXN_COLS = "id, transaction_id, account_id, date, amount, name, merchant_name, pending";

async function loadTxnsFor(db: RelinkDb, userId: string, accountIds: string[]): Promise<RelinkTxn[]> {
  if (!accountIds.length) return [];
  const out: RelinkTxn[] = [];
  for (const ids of chunks(accountIds)) {
    // page through: PostgREST caps a select at ~1000 rows
    for (let from = 0; ; from += 1000) {
      const page = await rows<RelinkTxn>(
        db.from("plaid_transactions").select(TXN_COLS).eq("user_id", userId).in("account_id", ids).order("date", { ascending: false }).range(from, from + 999),
        "transactions",
      );
      out.push(...page);
      if (page.length < 1000) break;
    }
  }
  return out;
}

export async function loadSettingsFresh(db: RelinkDb, userId: string, toSettings: (row: unknown) => UserSettings): Promise<UserSettings> {
  const { data, error } = await db.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`settings: ${error.message}`);
  return toSettings(data ?? {});
}

export interface CarryoverClientOpts {
  db: RelinkDb;
  userId: string;
  /** settings as of the start (read fresh from the database, not a hook's copy) */
  settings: UserSettings;
  /** persist the full settings object (awaited, not debounced) */
  saveSettings(next: UserSettings): Promise<void>;
}

export function createCarryoverDeps({ db, userId, settings, saveSettings }: CarryoverClientOpts): CarryoverDeps {
  let current = settings;
  return {
    async relink(oldItemId, newItemId) {
      const { data, error } = await db.functions.invoke("plaid-relink", { body: { oldItemId, newItemId } });
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "Carry-over failed");
      return { accountMap: data.accountMap ?? {}, unmatchedOld: data.unmatchedOld ?? [], unmatchedNew: data.unmatchedNew ?? [] } as RelinkServerResult;
    },
    loadTxns: ids => loadTxnsFor(db, userId, ids),
    async loadOverrides(txnIds) {
      const out: TxnOverrideRow[] = [];
      for (const ids of chunks(txnIds)) out.push(...await rows<TxnOverrideRow>(db.from("txn_overrides").select("*").eq("user_id", userId).in("transaction_id", ids), "overrides"));
      return out;
    },
    async insertOverrides(list) {
      for (const part of chunks(list)) await ok(db.from("txn_overrides").upsert(part, { onConflict: "user_id,transaction_id" }), "overrides");
    },
    loadInferences: () => rows<InferenceRow>(db.from("inferences").select("*").eq("user_id", userId), "findings"),
    async saveInferences(updates, deleteIds) {
      // deletes first: an update can take a subject a dropped row still holds
      if (deleteIds.length) await ok(db.from("inferences").delete().eq("user_id", userId).in("id", deleteIds), "findings");
      for (const r of updates) {
        const { id, ...rest } = r;
        if (id) await ok(db.from("inferences").update(rest).eq("id", id).eq("user_id", userId), "findings");
      }
    },
    loadStreams: () => rows<StreamAccountRow>(db.from("recurring_streams").select("id, account_id, counterpart_account_id, pay_from_account_id").eq("user_id", userId), "recurring"),
    patchStream: (id, patch) => ok(db.from("recurring_streams").update(patch).eq("id", id).eq("user_id", userId), "recurring"),
    loadObligations: () => rows<ObligationAccountRow>(db.from("obligations").select("id, funding_account_id").eq("user_id", userId), "obligations"),
    patchObligation: (id, patch) => ok(db.from("obligations").update(patch).eq("id", id).eq("user_id", userId), "obligations"),
    getSettings: () => current,
    async setSettings(next) { current = next; await saveSettings(next); },
    savePending: (oldItemId, newItemId, accountMap, pending) =>
      ok(db.from("relink_carryovers").upsert(
        { user_id: userId, old_item_id: oldItemId, new_item_id: newItemId, account_map: accountMap, pending },
        { onConflict: "user_id,old_item_id,new_item_id" },
      ), "pending edits"),
    async removeItem(itemId) {
      const { data, error } = await db.functions.invoke("plaid-remove-item", { body: { itemId } });
      if (error || data?.error) throw new Error(data?.error ?? error?.message ?? "Couldn't remove the old connection");
    },
  };
}

interface CarryoverRow { id: string; created_at: string; pending: PendingEdit[] }

export interface RetryResult { resolved: number; remaining: number; expired: number }

/**
 * Place pending edits on transactions that have arrived since the re-link.
 * `apply` receives the updated settings only when something was placed.
 */
export async function retryPendingCarryovers(
  db: RelinkDb, userId: string, settings: UserSettings, apply: (next: UserSettings) => void | Promise<void>, now: Date = new Date(),
): Promise<RetryResult> {
  const list = await rows<CarryoverRow>(db.from("relink_carryovers").select("id, created_at, pending").eq("user_id", userId), "pending edits");
  let s = settings, resolved = 0, remaining = 0, expired = 0;
  for (const row of list) {
    const pending = Array.isArray(row.pending) ? row.pending : [];
    if (!pending.length || isExpired(row.created_at, now)) {
      expired += pending.length;
      await ok(db.from("relink_carryovers").delete().eq("id", row.id).eq("user_id", userId), "pending edits");
      continue;
    }
    const txns = await loadTxnsFor(db, userId, [...new Set(pending.map(p => p.accountId))]);
    const r = resolvePending(pending, s, txns);
    if (!r.resolved) { remaining += pending.length; continue; }
    s = r.settings;
    resolved += r.resolved;
    remaining += r.remaining.length;
    if (r.overrides.length) {
      const withUser = r.overrides.map(o => ({ ...o, user_id: userId }));
      await ok(db.from("txn_overrides").upsert(withUser, { onConflict: "user_id,transaction_id" }), "overrides");
    }
    await ok(r.remaining.length
      ? db.from("relink_carryovers").update({ pending: r.remaining }).eq("id", row.id).eq("user_id", userId)
      : db.from("relink_carryovers").delete().eq("id", row.id).eq("user_id", userId), "pending edits");
  }
  if (resolved) await apply(s);
  return { resolved, remaining, expired };
}
