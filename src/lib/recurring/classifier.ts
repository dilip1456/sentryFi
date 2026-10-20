/**
 * Classifier contract consumed by recurring detection.
 *
 * The shared classifier is being built on `fix/data-consistency` in
 * `src/lib/classify/`. Until that lands, recurring detection depends ONLY on
 * this interface, so swapping the stub for the real classifier is a one-line
 * adapter change (see `createRecurringClassifier`). The `TxnType` names below
 * are the agreed taxonomy and must stay byte-for-byte identical to the shared
 * module's.
 *
 * Pure TS: no React, no Supabase imports (importable from edge functions).
 */

export const TXN_TYPES = [
  "spend",
  "refund",
  "income-salary",
  "income-interest",
  "income-other",
  "transfer-internal",
  "transfer-in",
  "transfer-out",
  "credit-card-payment",
  "savings-contribution",
  "obligation-loan",
  "obligation-tax",
  "obligation-bill",
] as const;

export type TxnType = (typeof TXN_TYPES)[number];

export function isTxnType(v: unknown): v is TxnType {
  return typeof v === "string" && (TXN_TYPES as readonly string[]).includes(v);
}

export type ClassificationSource =
  | "user"
  | "rule"
  | "pair"
  | "pfc"
  | "pattern"
  | "stream"
  | "fallback";

/** Minimal transaction shape (mirrors `plaid_transactions` columns). */
export interface ClassifierTxn {
  transaction_id: string;
  account_id: string;
  /** Plaid sign convention: positive = money OUT, negative = money IN. */
  amount: number;
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  name?: string | null;
  merchant_name?: string | null;
  category?: string[] | null;
  pfc_primary?: string | null;
  pfc_detailed?: string | null;
  pending?: boolean | null;
}

export interface ClassifierAccount {
  account_id: string;
  type?: string | null; // depository | credit | loan | investment
  subtype?: string | null; // checking | savings | mortgage | student | auto ...
  name?: string | null;
  mask?: string | null;
  role?: string | null;
}

export interface ClassifierContext {
  /** Every linked account. All belong to the same user (Dilip). */
  accounts: ClassifierAccount[];
}

export interface TxnClassification {
  txnType: TxnType;
  subtype?: string | null;
  category?: string | null;
  confidence: number;
  source: ClassificationSource;
  /** Set when the txn is one leg of a matched pair between the user's own accounts. */
  pairId?: string | null;
  /** For a matched pair: the account on the other leg (e.g. the mortgage account). */
  counterpartAccountId?: string | null;
  reason?: string;
}

/** What recurring detection needs from the shared classifier. */
export interface TransactionClassifier {
  classifyAll(txns: ClassifierTxn[], ctx: ClassifierContext): Map<string, TxnClassification>;
}

/** A per-transaction user override (row in `txn_overrides` / user_settings JSON). */
export interface TxnTypeOverride {
  transaction_id: string;
  txn_type: TxnType;
  subtype?: string | null;
  category?: string | null;
}

/**
 * Wrap any classifier so user overrides always win. Overridden rows get
 * confidence 1 and source "user"; a user flipping an internal leg to e.g.
 * income drops the pair link so it is no longer treated as internal.
 */
export function withOverrides(
  base: TransactionClassifier,
  overrides: TxnTypeOverride[] | Map<string, TxnTypeOverride> | undefined,
): TransactionClassifier {
  const map =
    overrides instanceof Map
      ? overrides
      : new Map((overrides ?? []).map(o => [o.transaction_id, o] as const));
  if (!map.size) return base;
  return {
    classifyAll(txns, ctx) {
      const out = base.classifyAll(txns, ctx);
      for (const t of txns) {
        const o = map.get(t.transaction_id);
        if (!o || !isTxnType(o.txn_type)) continue;
        const prev = out.get(t.transaction_id);
        out.set(t.transaction_id, {
          txnType: o.txn_type,
          subtype: o.subtype ?? (prev?.txnType === o.txn_type ? prev?.subtype : null) ?? null,
          category: o.category ?? prev?.category ?? null,
          confidence: 1,
          source: "user",
          pairId: o.txn_type === "transfer-internal" ? prev?.pairId ?? null : null,
          counterpartAccountId: prev?.counterpartAccountId ?? null,
          reason: "Set by you",
        });
      }
      return out;
    },
  };
}
