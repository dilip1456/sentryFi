// ── Duplicate transaction detection ─────────────────────────────────────────
// Runs on every transaction load so cleanup happens continuously rather than
// requiring a manual pass.
//
// The naive rule — same account + date + amount + vendor means "duplicate" —
// is NOT safe on its own: two genuinely separate purchases (two coffees at
// the same shop for the same price on the same day) match that description
// perfectly and would get silently deleted. So this only removes a row when
// there's real evidence it's an artifact of double-recording the same event,
// not just two transactions that happen to look alike:
//
//   1. Cross-source match — a PDF-imported row describing the same
//      account/date/amount/vendor as an already-synced Plaid row. This is
//      the case that matters most in practice (importing historical
//      statements that overlap a period Plaid already synced), and it's a
//      reliable signal because the two copies come from two independent
//      recording pipelines rather than two purchases the user actually made.
//      Plaid's copy always wins — the imported one is removed.
//   2. Pending/posted artifact — two Plaid-native rows for the same
//      account/date/amount/vendor where one is still pending and the other
//      has posted. That's Plaid transitioning a single real charge under two
//      different transaction_ids, not a second purchase. The pending copy is
//      removed.
//
// Anything else that merely shares account+date+amount+vendor — two native
// Plaid rows both already posted, or two rows that both came from an import —
// is left alone. There's no reliable way to tell "same event recorded twice"
// from "user bought the same thing twice" in that case, so this errs toward
// keeping real data over collapsing a possible false positive.
//
// Vendor comparison is intentionally a bit loose (see vendorsMatch) because
// the same real merchant is often spelled differently across a Plaid feed
// and a bank's PDF statement (e.g. "AMAZON.COM" vs "AMAZON.COM*1A2B3
// AMZN.COM/BILL WA") — an exact string match would miss real cross-source
// duplicates.

export const IMPORT_ID_PREFIX = "pdfimport_";

export interface DupTxnLike {
  id: string;
  account_id: string;
  date: string;
  amount: number | string;
  name: string | null;
  merchant_name: string | null;
  transaction_id: string | null;
  pending?: boolean | null;
}

const normalizeVendor = (t: DupTxnLike): string =>
  (t.merchant_name ?? t.name ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const isImported = (t: DupTxnLike): boolean =>
  t.transaction_id?.startsWith(IMPORT_ID_PREFIX) ?? false;

// Exact match, or one normalized vendor string contained inside the other
// after stripping punctuation — catches the same merchant formatted
// differently by two sources without being so loose it matches unrelated
// merchants. Requires at least 4 meaningful characters so short/blank
// fragments can't accidentally "contain" each other.
const vendorsMatch = (a: string, b: string): boolean => {
  if (!a || !b) return false;
  if (a === b) return true;
  const strip = (s: string) => s.replace(/[^a-z0-9 ]/gi, " ").replace(/\s+/g, " ").trim();
  const sa = strip(a), sb = strip(b);
  if (!sa || !sb) return false;
  const [shorter, longer] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  return shorter.length >= 4 && longer.includes(shorter);
};

// Returns the ids of rows that are confidently duplicate artifacts (see rules
// above) and safe to delete, keeping exactly one representative of each real
// event.
export function findDuplicateIds<T extends DupTxnLike>(txns: T[]): string[] {
  // Bucket by account + date + amount only — vendor is compared within the
  // bucket via vendorsMatch rather than folded into the key, since it needs
  // loose (contains-based) comparison rather than exact equality.
  const buckets = new Map<string, T[]>();
  for (const t of txns) {
    const amount = Number(t.amount);
    if (!Number.isFinite(amount)) continue;
    if (!normalizeVendor(t)) continue; // no usable vendor text — too risky to group
    const key = `${t.account_id}|${t.date}|${amount.toFixed(2)}`;
    const arr = buckets.get(key);
    if (arr) arr.push(t); else buckets.set(key, [t]);
  }

  const removeIds = new Set<string>();
  for (const rows of buckets.values()) {
    if (rows.length < 2) continue;
    const native = rows.filter(r => !isImported(r));
    const imported = rows.filter(isImported);

    // Rule 1 — cross-source: any imported row that vendor-matches a native
    // (Plaid-synced) row in the same account/date/amount bucket is a
    // re-recording of a transaction Plaid already has. Keep Plaid, drop the
    // import, regardless of how many native rows are present.
    if (native.length > 0 && imported.length > 0) {
      for (const imp of imported) {
        const impVendor = normalizeVendor(imp);
        if (native.some(n => vendorsMatch(impVendor, normalizeVendor(n)))) {
          removeIds.add(imp.id);
        }
      }
    }

    // Rule 2 — pending/posted artifact, native rows only. Two rows with the
    // *same* pending state are left untouched (indistinguishable from two
    // real back-to-back purchases); only a pending+posted pair for the same
    // vendor is treated as one charge recorded twice.
    if (imported.length === 0 && native.length > 1) {
      for (let i = 0; i < native.length; i++) {
        for (let j = i + 1; j < native.length; j++) {
          const a = native[i], b = native[j];
          if (!!a.pending === !!b.pending) continue;
          if (!vendorsMatch(normalizeVendor(a), normalizeVendor(b))) continue;
          removeIds.add(a.pending ? a.id : b.id);
        }
      }
    }
  }
  return Array.from(removeIds);
}
