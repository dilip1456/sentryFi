/**
 * plaid_accounts rows from /accounts/get, shared by plaid-exchange-token,
 * plaid-sync-transactions and plaid-relink.
 *
 * persistent_account_id (20261029000100) lets "Extend history" carry
 * settings across a re-link. If that migration isn't applied yet the upsert
 * is retried without the column, so account sync never breaks because of
 * it. Logs only the DB error code / message, never row data.
 */

// deno-lint-ignore no-explicit-any
type Admin = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

// deno-lint-ignore no-explicit-any
export function plaidAccountRows(userId: string, itemRowId: string, accounts: any[] | null | undefined) {  // eslint-disable-line @typescript-eslint/no-explicit-any
  return (accounts ?? []).filter(a => a?.account_id).map(a => ({
    user_id: userId,
    item_id: itemRowId,
    account_id: a.account_id,
    name: a.name,
    official_name: a.official_name,
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    current_balance: a.balances?.current,
    available_balance: a.balances?.available,
    iso_currency_code: a.balances?.iso_currency_code,
    persistent_account_id: a.persistent_account_id ?? null,
  }));
}

const missingColumn = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST204' || e.code === '42703') && /persistent_account_id/.test(e.message ?? '');

/** Upsert on account_id; returns the number of rows written. Never throws. */
export async function upsertPlaidAccounts(admin: Admin, rows: ReturnType<typeof plaidAccountRows>): Promise<number> {
  if (!rows.length) return 0;
  try {
    let { error } = await admin.from('plaid_accounts').upsert(rows, { onConflict: 'account_id' });
    if (missingColumn(error)) {
      const legacy = rows.map(({ persistent_account_id: _p, ...r }) => r);
      ({ error } = await admin.from('plaid_accounts').upsert(legacy, { onConflict: 'account_id' }));
    }
    if (error) { console.warn('plaid_accounts upsert failed:', error.code ?? '', error.message ?? ''); return 0; }
    return rows.length;
  } catch (e) {
    console.warn('upsertPlaidAccounts failed:', e instanceof Error ? e.message : String(e));
    return 0;
  }
}
