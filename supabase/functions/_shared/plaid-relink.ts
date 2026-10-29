/**
 * Server half of the "Extend history" carry-over (plaid-relink function).
 * Matching lives in relink-match.ts (a copy of src/lib/relink/match.ts).
 * Never logs account data: only DB error codes / messages.
 */
import { matchAccounts, type RelinkAccount } from './relink-match.ts';

// deno-lint-ignore no-explicit-any
type Admin = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface StoredAccount extends RelinkAccount { name?: string | null }

/**
 * Prefer the live persistent_account_id from /accounts/get (old rows were
 * stored before the column existed); fall back to what's stored.
 */
export function withPersistentIds(stored: StoredAccount[], live: { account_id: string; persistent_account_id?: string | null }[] | null): StoredAccount[] {
  const byId = new Map((live ?? []).map(a => [a.account_id, a.persistent_account_id ?? null] as const));
  return stored.map(a => ({ ...a, persistent_account_id: byId.get(a.account_id) ?? a.persistent_account_id ?? null }));
}

export function relinkMatch(oldAccounts: StoredAccount[], newAccounts: StoredAccount[]) {
  const m = matchAccounts(oldAccounts, newAccounts);
  const info = (list: StoredAccount[], ids: string[]) =>
    list.filter(a => ids.includes(a.account_id)).map(a => ({ account_id: a.account_id, name: a.name ?? null, mask: a.mask ?? null }));
  return {
    accountMap: m.map,
    method: m.method,
    unmatchedOld: info(oldAccounts, m.unmatchedOld),
    unmatchedNew: info(newAccounts, m.unmatchedNew),
  };
}

/**
 * Move credit_statements history (service-only table) to the new account ids.
 * A statement the new Item already captured wins (ignoreDuplicates). Returns
 * rows moved; never throws.
 */
export async function rekeyCreditStatements(admin: Admin, userId: string, accountMap: Record<string, string>): Promise<number> {
  let moved = 0;
  for (const [oldId, newId] of Object.entries(accountMap)) {
    try {
      const { data, error } = await admin.from('credit_statements').select('*').eq('user_id', userId).eq('account_id', oldId);
      if (error) { console.warn('credit_statements read failed:', error.code ?? '', error.message ?? ''); continue; }
      const rows = (data ?? []).map(({ created_at: _c, updated_at: _u, ...r }: Record<string, unknown>) => ({ ...r, account_id: newId }));
      if (rows.length) {
        const up = await admin.from('credit_statements').upsert(rows, { onConflict: 'user_id,account_id,statement_issue_date', ignoreDuplicates: true });
        if (up.error) { console.warn('credit_statements move failed:', up.error.code ?? '', up.error.message ?? ''); continue; }
        moved += rows.length;
      }
      const del = await admin.from('credit_statements').delete().eq('user_id', userId).eq('account_id', oldId);
      if (del.error) console.warn('credit_statements cleanup failed:', del.error.code ?? '', del.error.message ?? '');
    } catch (e) {
      console.warn('rekeyCreditStatements failed:', e instanceof Error ? e.message : String(e));
    }
  }
  return moved;
}
