/**
 * Re-link carry-over: match transactions across two Plaid Items.
 *
 * Plaid's transaction_ids are per Item, so edits keyed by them (notes, tags,
 * splits, type overrides, "is internal" marks...) are moved by matching:
 * the mapped account + posted date + amount (to the cent) + normalized
 * merchant/name. Same-day duplicates pair up in a stable order. A second,
 * looser pass allows the date to differ by up to 2 days (banks sometimes
 * re-date a transaction) when that's the only candidate. Pending
 * transactions are never matched (they get new ids when they post anyway).
 */

export interface RelinkTxn {
  /** plaid_transactions row id (uuid); app settings key per-transaction edits by it */
  id?: string | null;
  transaction_id: string;
  account_id: string;
  date: string; // YYYY-MM-DD
  amount: number | string;
  name?: string | null;
  merchant_name?: string | null;
  pending?: boolean | null;
}

export interface TxnMatch {
  /** old transaction_id → new transaction_id */
  map: Record<string, string>;
  /** old row id → new row id (when both sides carry `id`) */
  rowMap: Record<string, string>;
  /** old ids with no match (yet: older history may still be on its way) */
  unmatched: string[];
}

export const nameKey = (t: Pick<RelinkTxn, "name" | "merchant_name">) =>
  (t.merchant_name || t.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const cents = (a: number | string) => Math.round(Number(a) * 100);
const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;

export function matchTransactions(oldTxns: RelinkTxn[], newTxns: RelinkTxn[], accountMap: Record<string, string>): TxnMatch {
  const map: Record<string, string> = {};
  const used = new Set<string>();
  const posted = (t: RelinkTxn) => !t.pending;
  const sortKey = (a: RelinkTxn, b: RelinkTxn) => a.date.localeCompare(b.date) || a.transaction_id.localeCompare(b.transaction_id);

  const exact = (t: RelinkTxn, acct: string) => `${acct}|${t.date}|${cents(t.amount)}|${nameKey(t)}`;
  const newByKey = new Map<string, RelinkTxn[]>();
  for (const n of [...newTxns].filter(posted).sort(sortKey)) {
    const k = exact(n, n.account_id);
    newByKey.set(k, [...(newByKey.get(k) ?? []), n]);
  }

  const candidates = [...oldTxns].filter(posted).filter(o => accountMap[o.account_id]).sort(sortKey);
  // Pass 1: exact key, pair in order.
  for (const o of candidates) {
    const list = newByKey.get(exact(o, accountMap[o.account_id]));
    const n = list?.find(x => !used.has(x.transaction_id));
    if (n) { map[o.transaction_id] = n.transaction_id; used.add(n.transaction_id); }
  }
  // Pass 2: ±2 days, same account / amount / name, only when unambiguous.
  const remainingNew = newTxns.filter(n => posted(n) && !used.has(n.transaction_id));
  for (const o of candidates) {
    if (map[o.transaction_id]) continue;
    const acct = accountMap[o.account_id];
    const hits = remainingNew.filter(n =>
      !used.has(n.transaction_id) && n.account_id === acct && cents(n.amount) === cents(o.amount) &&
      nameKey(n) === nameKey(o) && Math.abs(dayNum(n.date) - dayNum(o.date)) <= 2);
    if (hits.length === 1) { map[o.transaction_id] = hits[0].transaction_id; used.add(hits[0].transaction_id); }
  }
  const newById = new Map(newTxns.map(n => [n.transaction_id, n] as const));
  const rowMap: Record<string, string> = {};
  for (const o of oldTxns) {
    const n = map[o.transaction_id] ? newById.get(map[o.transaction_id]) : undefined;
    if (o.id && n?.id) rowMap[o.id] = n.id;
  }
  return { map, rowMap, unmatched: oldTxns.filter(o => !map[o.transaction_id]).map(o => o.transaction_id) };
}
