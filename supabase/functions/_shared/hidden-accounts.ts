/**
 * Hidden accounts (user_settings.account_meta[<plaid_accounts.id>].hidden),
 * for send-alerts. Copy of src/lib/accounts/hidden.ts (the app); the test
 * src/test/accounts-hidden.test.ts keeps the two identical below this header.
 *
 * Hidden = out of lists, Spending totals and filters, and alerts. Net worth
 * is separate: a hidden account still counts unless excludeFromNetWorth.
 * No Deno globals so vitest can import it.
 */
export interface HiddenMetaEntry { hidden?: boolean; excludeFromNetWorth?: boolean }
export interface HiddenAccountRow { id: string; account_id: string }
const entry = (meta: Readonly<Record<string, unknown>>, id: string) => meta[id] as HiddenMetaEntry | null | undefined;

/** Plaid account_ids of hidden linked accounts. */
export function hiddenAccountIds(accounts: readonly HiddenAccountRow[] | null | undefined, meta: Readonly<Record<string, unknown>> | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!meta) return out;
  for (const a of accounts ?? []) if (a?.id && entry(meta, a.id)?.hidden) out.add(a.account_id);
  return out;
}

/** Plaid account_ids left out of net worth (hidden and excludeFromNetWorth). */
export function netWorthExcludedIds(accounts: readonly HiddenAccountRow[] | null | undefined, meta: Readonly<Record<string, unknown>> | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!meta) return out;
  for (const a of accounts ?? []) { const m = a?.id ? entry(meta, a.id) : undefined; if (m?.hidden && m.excludeFromNetWorth) out.add(a.account_id); }
  return out;
}

/** Rows (transactions or accounts) whose account_id is not in `ids`. Same array when nothing is hidden. */
export function withoutAccounts<T extends { account_id?: string | null }>(rows: T[], ids: ReadonlySet<string>): T[] {
  if (!ids.size) return rows;
  return rows.filter(r => !r.account_id || !ids.has(r.account_id));
}
