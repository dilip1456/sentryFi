/**
 * Adapter: the shared classifier (`src/lib/classify/`, PR #7) behind the
 * recurring `TransactionClassifier` interface.
 *
 * - ids: the shared module keys by `id`; recurring uses Plaid's stable
 *   `transaction_id`, so we pass `id = transaction_id`.
 * - type names: identical (the interface re-exports the shared TxnType).
 * - pairs: the shared result carries the other leg's txn id in `pairId`;
 *   we resolve that to `counterpartAccountId` (e.g. the linked mortgage).
 * - overrides: pass them to `withOverrides` (or `detectRecurringSeries`'s
 *   `overrides` option), which always wins. Extra shared context (rules,
 *   self names, custom categories, `notInternalIds`, …) can be forwarded.
 */
import {
  classifyAll as sharedClassifyAll,
  type ClassifierAccount as SharedAccount,
  type ClassifierContext as SharedContext,
  type ClassifierTxn as SharedTxn,
  type ClassSource,
} from "../classify";
import {
  type ClassificationSource,
  type ClassifierAccount,
  type TransactionClassifier,
  type TxnClassification,
} from "./classifier";

export type SharedClassifierExtras = Omit<SharedContext, "accounts">;

const SOURCE: Record<ClassSource, ClassificationSource> = {
  override: "user",
  category_override: "user",
  rule: "rule",
  pair: "pair",
  card: "card",
  pfc: "pfc",
  pattern: "pattern",
  recurring: "stream",
  category: "category",
  fallback: "fallback",
};

const CONFIDENCE: Record<ClassificationSource, number> = {
  user: 1,
  rule: 0.95,
  pair: 0.9,
  card: 0.85,
  pfc: 0.85,
  pattern: 0.75,
  stream: 0.8,
  category: 0.6,
  fallback: 0.4,
};

const SHARED_ROLES = new Set(["spending", "buffer", "reserve", "savings_goal", "investment", "debt", "unassigned"]);

function toSharedAccount(a: ClassifierAccount): SharedAccount {
  const role = a.role && SHARED_ROLES.has(a.role) ? (a.role as SharedAccount["role"]) : null;
  return { account_id: a.account_id, name: a.name ?? null, mask: a.mask ?? null, type: a.type ?? null, subtype: a.subtype ?? null, role };
}

export function createSharedClassifier(extras: SharedClassifierExtras = {}): TransactionClassifier {
  return {
    classifyAll(txns, ctx) {
      const shared: SharedTxn[] = txns.map(t => ({
        id: t.transaction_id,
        transaction_id: t.transaction_id,
        account_id: t.account_id,
        amount: t.amount,
        date: t.date,
        name: t.name ?? null,
        merchant_name: t.merchant_name ?? null,
        category: t.category ?? null,
        pending: t.pending ?? null,
        pfc_primary: t.pfc_primary ?? null,
        pfc_detailed: t.pfc_detailed ?? null,
        pfc_confidence: t.pfc_confidence ?? null,
      }));
      const accountOf = new Map(txns.map(t => [t.transaction_id, t.account_id] as const));
      const res = sharedClassifyAll(shared, { ...extras, accounts: ctx.accounts.map(toSharedAccount) });
      const out = new Map<string, TxnClassification>();
      for (const [id, c] of res) {
        const txnType = c.type;
        const source = SOURCE[c.source] ?? "fallback";
        out.set(id, {
          txnType,
          subtype: c.subtype ?? null,
          confidence: CONFIDENCE[source],
          source,
          reason: c.reason,
          pairId: c.pairId ?? null,
          counterpartAccountId: c.pairId ? accountOf.get(c.pairId) ?? null : null,
        });
      }
      return out;
    },
  };
}
