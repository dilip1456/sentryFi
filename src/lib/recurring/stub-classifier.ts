/**
 * INTERIM STUB of the shared classifier (`src/lib/classify/`, being built on
 * `fix/data-consistency`). It implements `TransactionClassifier` with a small
 * subset of the planned pipeline (internal-pair matcher → card payment → PFC
 * detailed → pattern library → sign fallback) so recurring detection can be
 * built and tested now. Replace via `createRecurringClassifier` once the real
 * module is merged; nothing else in `src/lib/recurring/` should import this.
 */
import type {
  ClassifierAccount,
  ClassifierContext,
  ClassifierTxn,
  TransactionClassifier,
  TxnClassification,
  TxnType,
} from "./classifier";
import { diffDays } from "./dates";
import {
  billSubtype,
  CARD_PAYMENT_RE,
  INTEREST_RE,
  loanSubtype,
  P2P_RE,
  PAYROLL_RE,
  TRANSFER_RE,
  taxSubtype,
} from "./patterns";

const text = (t: ClassifierTxn) => `${t.name ?? ""} ${t.merchant_name ?? ""} ${(t.category ?? []).join(" ")}`;

function transferFlavored(t: ClassifierTxn): boolean {
  const pfc = t.pfc_detailed ?? "";
  return (
    TRANSFER_RE.test(text(t)) ||
    CARD_PAYMENT_RE.test(text(t)) ||
    /ACCOUNT_TRANSFER|CREDIT_CARD_PAYMENT|TRANSFER_(IN|OUT)_SAVINGS/.test(pfc) ||
    (t.category ?? []).some(c => /transfer|credit card payment/i.test(c))
  );
}

interface Pair {
  outTxn: ClassifierTxn;
  inTxn: ClassifierTxn;
}

/** Exact-amount, opposite-sign, ≤3 days, different own accounts, one leg transfer-flavored, unique. */
function matchInternalPairs(txns: ClassifierTxn[], accounts: Map<string, ClassifierAccount>): Pair[] {
  const own = txns.filter(t => !t.pending && accounts.has(t.account_id));
  const byAmt = new Map<string, ClassifierTxn[]>();
  for (const t of own) {
    const k = Math.abs(t.amount).toFixed(2);
    (byAmt.get(k) ?? byAmt.set(k, []).get(k)!).push(t);
  }
  const used = new Set<string>();
  const pairs: Pair[] = [];
  for (const group of byAmt.values()) {
    const outs = group.filter(t => t.amount > 0).sort((a, b) => a.date.localeCompare(b.date));
    const ins = group.filter(t => t.amount < 0);
    for (const o of outs) {
      const cands = ins.filter(
        i =>
          !used.has(i.transaction_id) &&
          i.account_id !== o.account_id &&
          Math.abs(diffDays(i.date, o.date)) <= 3 &&
          (transferFlavored(o) || transferFlavored(i)),
      );
      if (!cands.length) continue;
      cands.sort((a, b) => Math.abs(diffDays(a.date, o.date)) - Math.abs(diffDays(b.date, o.date)));
      const best = cands[0];
      const tie = cands[1] && Math.abs(diffDays(cands[1].date, o.date)) === Math.abs(diffDays(best.date, o.date));
      if (tie) continue; // ambiguous → leave for review
      used.add(best.transaction_id);
      used.add(o.transaction_id);
      pairs.push({ outTxn: o, inTxn: best });
    }
  }
  return pairs;
}

function pfcType(t: ClassifierTxn): { type: TxnType; subtype?: string } | null {
  const d = (t.pfc_detailed ?? "").toUpperCase();
  if (!d) return null;
  if (d === "INCOME_WAGES") return { type: "income-salary" };
  if (d === "INCOME_INTEREST_EARNED" || d === "INCOME_DIVIDENDS") return { type: "income-interest" };
  if (d.startsWith("INCOME_")) return { type: "income-other" };
  if (d === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") return { type: "credit-card-payment" };
  if (d === "LOAN_PAYMENTS_MORTGAGE_PAYMENT") return { type: "obligation-loan", subtype: "mortgage" };
  if (d === "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT") return { type: "obligation-loan", subtype: "student" };
  if (d === "LOAN_PAYMENTS_CAR_PAYMENT") return { type: "obligation-loan", subtype: "auto" };
  if (d.startsWith("LOAN_PAYMENTS_")) return { type: "obligation-loan", subtype: "personal" };
  if (d === "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT") return { type: "obligation-tax" };
  if (d.startsWith("RENT_AND_UTILITIES_")) return { type: "obligation-bill", subtype: d.includes("RENT") ? "rent" : "utility" };
  if (d === "TRANSFER_OUT_SAVINGS" || d === "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS") return { type: "savings-contribution" };
  if (d.startsWith("TRANSFER_IN_")) return { type: "transfer-in" };
  if (d.startsWith("TRANSFER_OUT_")) return { type: "transfer-out" };
  return null;
}

function classifyOne(t: ClassifierTxn, acct: ClassifierAccount | undefined): TxnClassification {
  const s = text(t);
  const out = t.amount > 0;
  const mk = (txnType: TxnType, source: TxnClassification["source"], reason: string, subtype?: string | null): TxnClassification => ({
    txnType,
    subtype: subtype ?? null,
    confidence: source === "fallback" ? 0.4 : 0.8,
    source,
    reason,
  });

  if (CARD_PAYMENT_RE.test(s)) return mk("credit-card-payment", "pattern", "Card payment descriptor");

  const pfc = pfcType(t);
  if (pfc) {
    let sub = pfc.subtype ?? null;
    if (pfc.type === "obligation-tax") sub = taxSubtype(s) ?? "irs_federal";
    if (pfc.type === "obligation-loan" && sub === "personal") sub = loanSubtype(s) ?? sub;
    return mk(pfc.type, "pfc", `Plaid category ${t.pfc_detailed}`, sub);
  }

  if (!out) {
    if (PAYROLL_RE.test(s)) return mk("income-salary", "pattern", "Payroll descriptor");
    if (INTEREST_RE.test(s)) return mk("income-interest", "pattern", "Interest descriptor");
    if (/\b(irs|tax\s*ref)/i.test(s)) return mk("income-other", "pattern", "Tax refund", "tax_refund");
    if (acct?.type === "credit") return mk("refund", "fallback", "Credit on a card");
    if (P2P_RE.test(s)) return mk("income-other", "pattern", "P2P received", "p2p");
    return mk("transfer-in", "fallback", "Unmatched incoming money");
  }

  const tax = taxSubtype(s);
  if (tax) return mk("obligation-tax", "pattern", "Tax payment descriptor", tax);
  const loan = loanSubtype(s);
  if (loan) return mk("obligation-loan", "pattern", "Loan payment descriptor", loan);
  const bill = billSubtype(s);
  if (bill) return mk("obligation-bill", "pattern", "Bill descriptor", bill);
  if (P2P_RE.test(s) || TRANSFER_RE.test(s)) return mk("transfer-out", "pattern", "Outgoing transfer");
  return mk("spend", "fallback", "Purchase");
}

export function createStubClassifier(): TransactionClassifier {
  return {
    classifyAll(txns: ClassifierTxn[], ctx: ClassifierContext) {
      const accounts = new Map(ctx.accounts.map(a => [a.account_id, a] as const));
      const out = new Map<string, TxnClassification>();
      for (const p of matchInternalPairs(txns, accounts)) {
        const pairId = `pair:${p.outTxn.transaction_id}:${p.inTxn.transaction_id}`;
        const dest = accounts.get(p.inTxn.account_id);
        const role = (dest?.role ?? "").toLowerCase();
        const destType = (dest?.type ?? "").toLowerCase();
        const destSub = (dest?.subtype ?? "").toLowerCase();
        let outType: TxnType = "transfer-internal";
        let inType: TxnType = "transfer-internal";
        let outSub: string | null = null;
        if (destType === "credit") {
          outType = inType = "credit-card-payment";
        } else if (destType === "loan") {
          outType = "obligation-loan";
          outSub = ["mortgage", "student", "auto"].includes(destSub) ? destSub : loanSubtype(text(p.outTxn)) ?? "personal";
        } else if (destType === "investment" || destSub === "savings" || ["savings", "savings_goal", "investment", "buffer", "reserve"].includes(role)) {
          outType = "savings-contribution";
        }
        const base = { confidence: 0.9, source: "pair" as const, pairId };
        const reason = "Matched transfer between your accounts";
        out.set(p.outTxn.transaction_id, { ...base, txnType: outType, subtype: outSub, reason, counterpartAccountId: p.inTxn.account_id });
        out.set(p.inTxn.transaction_id, { ...base, txnType: inType, reason, counterpartAccountId: p.outTxn.account_id });
      }
      for (const t of txns) {
        if (!out.has(t.transaction_id)) out.set(t.transaction_id, classifyOne(t, accounts.get(t.account_id)));
      }
      return out;
    },
  };
}
