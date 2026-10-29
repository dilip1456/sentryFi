/**
 * How much transaction history each connected bank has, for the "Extend
 * history" hint (Financial Picture) and the per-bank line in Settings → Banks.
 *
 * History = days from the bank's oldest transaction to today. Banks linked
 * before the 730-day change only have Plaid's default ~90 days; the only way
 * to get 2 years is a re-link (docs/PLAID_HISTORY.md, src/lib/relink).
 *
 *  - A bank linked with 730 days rarely has a transaction ON day 730, so a
 *    bank counts as short only below 730 − 30 days (HISTORY_SLACK_DAYS).
 *  - A bank linked in the last 2 days is still receiving its history from
 *    Plaid ("settling"): never flagged.
 *  - A bank with no transactions yet: unknown, never flagged.
 * Pure (no React / Supabase) so it's unit-tested.
 */

export const HISTORY_TARGET_DAYS = 730;
export const HISTORY_SLACK_DAYS = 30;
export const HISTORY_SETTLING_DAYS = 2;

export interface HistoryItem { id: string; institution_name?: string | null; created_at?: string | null }
export interface HistoryAccount { account_id: string; item_id?: string | null }
export interface HistoryTxn { account_id: string; date: string; pending?: boolean | null }

export interface BankHistory {
  itemId: string;
  institution: string;
  /** days since the oldest transaction; null = no transactions yet */
  days: number | null;
  oldest: string | null;
  /** linked in the last HISTORY_SETTLING_DAYS days: history still arriving */
  settling: boolean;
  /** less than ~730 days: re-linking would add history */
  short: boolean;
}

const DAY = 86400000;
const dayNum = (ymd: string) => {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1) / DAY;
};
const todayNum = (today: Date) => Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / DAY;

export function bankHistory(items: HistoryItem[], accounts: HistoryAccount[], txns: HistoryTxn[], today: Date): BankHistory[] {
  const itemOfAccount = new Map<string, string>();
  for (const a of accounts) if (a.item_id) itemOfAccount.set(a.account_id, a.item_id);
  const oldest = new Map<string, string>();
  for (const t of txns) {
    if (!t.date) continue;
    const item = itemOfAccount.get(t.account_id);
    if (!item) continue;
    const cur = oldest.get(item);
    if (!cur || t.date < cur) oldest.set(item, t.date.slice(0, 10));
  }
  const now = todayNum(today);
  return items.map(it => {
    const o = oldest.get(it.id) ?? null;
    const days = o ? Math.max(0, Math.round(now - dayNum(o))) : null;
    const created = it.created_at ? Date.parse(it.created_at) : NaN;
    const settling = Number.isFinite(created) && today.getTime() - created < HISTORY_SETTLING_DAYS * DAY;
    return {
      itemId: it.id,
      institution: it.institution_name?.trim() || "Connected bank",
      days, oldest: o, settling,
      short: !settling && days != null && days < HISTORY_TARGET_DAYS - HISTORY_SLACK_DAYS,
    };
  });
}

/** user_settings.dismissedInsights key for one bank's history hint. */
export const historyHintKey = (itemId: string) => `fp-history:${itemId}`;

/** Banks the hint should mention: short and not dismissed. A bank linked
 *  later (or a new short one) shows the hint again. */
export function historyHintBanks(list: BankHistory[], dismissed: readonly string[]): BankHistory[] {
  const gone = new Set(dismissed);
  return list.filter(b => b.short && !gone.has(historyHintKey(b.itemId)));
}

/** "About 3 months", "About 1 year", "2 years". */
export function historyLabel(days: number | null): string {
  if (days == null) return "No transactions yet";
  if (days >= HISTORY_TARGET_DAYS - HISTORY_SLACK_DAYS) return "2 years of history";
  if (days < 45) return `${days} day${days === 1 ? "" : "s"} of history`;
  const months = Math.round(days / 30.4);
  if (months < 12) return `About ${months} months of history`;
  const years = Math.round((days / 365) * 2) / 2;
  return `About ${years} year${years === 1 ? "" : "s"} of history`;
}
