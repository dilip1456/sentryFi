// Shared /transactions/sync loop for plaid-sync-transactions and
// plaid-exchange-token. No Deno globals here so vitest can exercise it
// (src/test/plaid-sync.test.ts).
//
// Fixes the "latest transaction is days old even though we just synced" bug:
//  * upsert/delete errors used to be ignored while the cursor still advanced,
//    so a failed page was skipped forever;
//  * added+modified could contain the same transaction_id twice, which makes
//    Postgres reject the WHOLE batch ("ON CONFLICT DO UPDATE command cannot
//    affect row a second time");
//  * a mid-pagination failure saved a half-walked cursor instead of
//    restarting from the original one (Plaid requires a restart on
//    TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION).
// The cursor is now saved only after every page was written successfully.
import { pfcToAppCategory } from "./classify/pfc.ts";
import { TRANSACTIONS_DAYS_REQUESTED } from "./plaid-link.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-js client, untyped in Deno
type Admin = any;
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw Plaid payload
type PlaidTxn = any;

export interface SyncConfig {
  plaidBase: string;
  clientId: string | undefined;
  secret: string | undefined;
  fetchFn?: typeof fetch;
}

export interface SyncResult { ok: boolean; count: number; removed: number; cursor: string | null; error?: string }

/** Category stored on the row: legacy category if Plaid sent one, else the
 *  app category mapped from the DETAILED personal_finance_category. */
export function resolveCategory(t: PlaidTxn): string[] | null {
  if (Array.isArray(t.category) && t.category.length > 0) return t.category;
  const pfc = t.personal_finance_category;
  if (pfc?.primary || pfc?.detailed) return [pfcToAppCategory(pfc.primary, pfc.detailed) ?? "Other"];
  return null;
}

export function toRow(t: PlaidTxn, userId: string, itemRowId: string, withPfc: boolean) {
  const row: Record<string, unknown> = {
    user_id: userId,
    item_id: itemRowId,
    account_id: t.account_id,
    transaction_id: t.transaction_id,
    amount: t.amount,
    iso_currency_code: t.iso_currency_code,
    date: t.date,
    authorized_date: t.authorized_date,
    name: t.name,
    merchant_name: t.merchant_name,
    category: resolveCategory(t),
    pending: t.pending,
    payment_channel: t.payment_channel,
  };
  if (withPfc) {
    row.pfc_primary = t.personal_finance_category?.primary ?? null;
    row.pfc_detailed = t.personal_finance_category?.detailed ?? null;
    row.pfc_confidence = t.personal_finance_category?.confidence_level ?? null;
    row.merchant_entity_id = t.merchant_entity_id ?? null;
  }
  return row;
}

/** Last write wins per transaction_id (modified comes after added). */
export function dedupeByTransactionId<T extends { transaction_id: string }>(list: T[]): T[] {
  const m = new Map<string, T>();
  for (const t of list) if (t?.transaction_id) m.set(t.transaction_id, t);
  return [...m.values()];
}

// PostgREST "column not found" — the pfc migration hasn't been applied yet.
const isMissingColumn = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "PGRST204" || e.code === "42703" || /column .* (does not exist|could not find)/i.test(e.message ?? ""));

async function writeRows(admin: Admin, rows: Record<string, unknown>[], state: { withPfc: boolean }) {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    let chunk = rows.slice(i, i + CHUNK);
    let { error } = await admin.from("plaid_transactions").upsert(chunk, { onConflict: "transaction_id" });
    if (error && state.withPfc && isMissingColumn(error)) {
      state.withPfc = false;
      chunk = chunk.map(({ pfc_primary: _a, pfc_detailed: _b, pfc_confidence: _c, merchant_entity_id: _d, ...r }) => r);
      ({ error } = await admin.from("plaid_transactions").upsert(chunk, { onConflict: "transaction_id" }));
    }
    if (error) throw new Error(`upsert failed: ${error.message ?? JSON.stringify(error)}`);
  }
}

/**
 * Walk /transactions/sync from `startCursor` to the end, writing every page,
 * then persist the new cursor. On TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION
 * the walk restarts from `startCursor` (up to 3 times). On any other error
 * the stored cursor is left untouched so the next sync retries the same pages
 * (upserts are idempotent).
 */
export async function syncItemTransactions(
  admin: Admin, cfg: SyncConfig,
  opts: { itemRowId: string; userId: string; accessToken: string; cursor: string | null },
): Promise<SyncResult> {
  const doFetch = cfg.fetchFn ?? fetch;
  const state = { withPfc: true };
  let attempts = 0;
  while (true) {
    attempts++;
    let cursor = opts.cursor;
    let count = 0, removed = 0;
    try {
      let hasMore = true;
      while (hasMore) {
        const res = await doFetch(`${cfg.plaidBase}/transactions/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: cfg.clientId, secret: cfg.secret, access_token: opts.accessToken,
            cursor: cursor ?? undefined, count: 500,
            // days_requested only applies if Transactions wasn't initialised at
            // Link (ours are; see plaid-link.ts). Kept so an Item created
            // without Transactions still gets 730 days on its first sync.
            options: { include_personal_finance_category: true, days_requested: TRANSACTIONS_DAYS_REQUESTED },
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data?.error_code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && attempts < 3) throw new RestartSync();
          throw new Error(`transactions/sync ${data?.error_code ?? res.status} (request_id ${data?.request_id ?? "n/a"})`);
        }
        const changed = dedupeByTransactionId([...(data.added ?? []), ...(data.modified ?? [])]);
        if (changed.length) {
          await writeRows(admin, changed.map(t => toRow(t, opts.userId, opts.itemRowId, state.withPfc)), state);
          count += changed.length;
        }
        const ids = (data.removed ?? []).map((r: { transaction_id: string }) => r.transaction_id).filter(Boolean);
        if (ids.length) {
          const { error } = await admin.from("plaid_transactions").delete().eq("user_id", opts.userId).in("transaction_id", ids);
          if (error) throw new Error(`delete failed: ${error.message}`);
          removed += ids.length;
        }
        cursor = data.next_cursor ?? cursor;
        hasMore = !!data.has_more;
      }
      const { error } = await admin.from("plaid_items").update({ cursor }).eq("id", opts.itemRowId);
      if (error) throw new Error(`cursor save failed: ${error.message}`);
      return { ok: true, count, removed, cursor };
    } catch (e) {
      if (e instanceof RestartSync) continue;
      console.error("syncItemTransactions:", e);
      return { ok: false, count, removed, cursor: opts.cursor, error: String((e as Error)?.message ?? e) };
    }
  }
}

class RestartSync extends Error {}
