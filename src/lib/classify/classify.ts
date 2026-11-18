/**
 * The classification pipeline. First decisive stage wins:
 *
 *   1 user overrides (type, then category) → 2 user rules → 3 internal-pair
 *   matcher → 4 card-payment detector → 5 Plaid PFC detailed → 6 pattern
 *   library → 7 recurring context → 8 stored category, then sign fallback.
 */
import type { Classification, ClassifierAccount, ClassifierContext, ClassifierTxn, TxnType } from "./types.ts";
import { typeForCategory } from "./categories.ts";
import { mapPfc, pfcTrusted } from "./pfc.ts";
import { matchInternalTransfers, type PairLink } from "./pairs.ts";
import {
  BROKERAGE_RE, CARD_ISSUER_PAYMENT_RE, CARD_RECEIVED_PAYMENT_RE, DIVIDEND_RE, INTEREST_RE, LOAN_RE,
  PAYROLL_RE, SAVINGS_SWEEP_RE, TAX_RE, TAX_REFUND_RE, descriptor, isPersonToPerson, namesSelf,
} from "./patterns.ts";

const SAVINGS_ROLES = new Set(["buffer", "reserve", "savings_goal", "investment"]);
const SAVINGS_SUBTYPES = /^(savings|money market|cd|hsa|brokerage|ira|roth|401k|401a|403b|529|cash management)$/i;

/** Is this account a savings / investment destination? */
export const isSavingsDestination = (a?: ClassifierAccount) =>
  !!a && (a.type === "investment" || (!!a.role && SAVINGS_ROLES.has(a.role)) || SAVINGS_SUBTYPES.test(a.subtype ?? ""));

const signed = (t: ClassifierTxn) => Number(t.amount) || 0;

function fromCategory(cat: string | null | undefined, t: ClassifierTxn, ctx: ClassifierContext, source: Classification["source"], why: string): Classification | null {
  const type = typeForCategory(cat, signed(t), ctx.customCategories);
  return type ? { type, source, reason: `${why} "${cat}"` } : null;
}

/** Classify one transaction given precomputed pair links. */
export function classifyOne(
  t: ClassifierTxn,
  ctx: ClassifierContext,
  pairs: Map<string, PairLink> = new Map(),
  txnById?: Map<string, ClassifierTxn>,
): Classification {
  const amt = signed(t);
  const text = descriptor(t);
  const p2p = isPersonToPerson(t);
  const accounts = ctx.accounts ?? [];
  const acct = accounts.find(a => a.account_id === t.account_id);
  const notInternal = ctx.notInternalIds?.has(t.id) ?? false;

  // 1. User overrides — always win.
  const ov = ctx.typeOverrides?.[t.id];
  if (ov) return { type: ov, source: "override", reason: "You set this type" };
  const catOv = ctx.categoryOverrides?.[t.id];
  if (catOv) {
    const c = fromCategory(catOv, t, ctx, "category_override", "You categorized it as");
    if (c) return c;
    return { type: amt < 0 ? "refund" : "spend", source: "category_override", reason: `You categorized it as "${catOv}"` };
  }

  // 2. User rules.
  if (ctx.ruleInternalIds?.has(t.id) && !notInternal) return { type: "transfer_internal", source: "rule", reason: "Marked internal by a rule" };
  const ruleCat = ctx.ruleCategory?.(t);
  if (ruleCat) {
    const c = fromCategory(ruleCat, t, ctx, "rule", "A rule sets the category");
    if (c) return c;
    return { type: amt < 0 ? "refund" : "spend", source: "rule", reason: `A rule sets the category "${ruleCat}"` };
  }

  // 3. Internal-transfer pair between two linked accounts.
  const link = notInternal ? undefined : pairs.get(t.id);
  if (link) {
    const other = txnById?.get(link.pairId);
    const outLeg = link.leg === "out" ? t : other;
    const inLeg = link.leg === "in" ? t : other;
    const dst = inLeg ? accounts.find(a => a.account_id === inLeg.account_id) : undefined;
    const src = outLeg ? accounts.find(a => a.account_id === outLeg.account_id) : undefined;
    const base = { source: "pair" as const, pairId: link.pairId };
    if (dst?.type === "credit") return { ...base, type: "credit_card_payment", reason: "Payment to your linked card" };
    if (dst?.type === "loan") {
      return link.leg === "out"
        ? { ...base, type: "obligation_loan", subtype: "loan", reason: "Payment to your linked loan" }
        : { ...base, type: "transfer_internal", reason: "Loan balance reduced by your payment" };
    }
    if (isSavingsDestination(dst) && !isSavingsDestination(src)) {
      return link.leg === "out"
        ? { ...base, type: "savings_contribution", reason: "Moved to your savings/investment account" }
        : { ...base, type: "transfer_internal", reason: "Received from your own account" };
    }
    return { ...base, type: "transfer_internal", reason: "Matched transfer between your accounts" };
  }

  // 4. Card payment detector (unmatched legs, linked card or not).
  if (!notInternal) {
    if (acct?.type === "credit" && amt < 0 &&
        (/LOAN_PAYMENTS_CREDIT_CARD_PAYMENT/i.test(t.pfc_detailed ?? "") || (CARD_RECEIVED_PAYMENT_RE.test(text) && !t.merchant_name))) {
      return { type: "credit_card_payment", source: "card", reason: "Payment received on this card" };
    }
    if (acct?.type !== "credit" && amt > 0 && CARD_ISSUER_PAYMENT_RE.test(text)) {
      return { type: "credit_card_payment", source: "card", reason: "Looks like a card payment" };
    }
  }

  // The loan side of a payment ("PAYMENT" on the loan account) is the
  // balance going down, not a refund or income; the bank-side leg carries
  // the obligation.
  if (acct?.type === "loan" && amt < 0) {
    return { type: "transfer_internal", subtype: "loan", source: "card", reason: "Payment received on this loan" };
  }

  // Self-payee is as strong as a pair: "Zelle to <you>".
  if (!notInternal && namesSelf(text, ctx.selfNames)) {
    return { type: "transfer_internal", subtype: "self", source: "pattern", reason: "Payee is you" };
  }

  // Brokerage funding (Robinhood, Fidelity, …) from a bank account is the
  // user moving their own money. Checked before Plaid's category because
  // Plaid sometimes files these as merchant spend (even "gambling").
  if (!notInternal && acct?.type !== "credit" && BROKERAGE_RE.test(text)) {
    return amt > 0
      ? { type: "savings_contribution", subtype: "brokerage", source: "pattern", reason: "Deposit to your brokerage" }
      : { type: "transfer_internal", subtype: "brokerage", source: "pattern", reason: "Withdrawal from your brokerage" };
  }

  // 5. Plaid personal_finance_category (detailed).
  if (t.pfc_detailed && pfcTrusted(t.pfc_confidence)) {
    const m = mapPfc(t.pfc_primary, t.pfc_detailed);
    if (m) {
      let type: TxnType = m.type;
      if ((type === "spend" || type.startsWith("obligation_")) && amt < 0) type = "refund";
      // P2P (Venmo, Zelle, Cash App, PayPal transfers) with other people is a
      // transfer, not spending or income; only the user can say otherwise.
      // isPersonToPerson already refuses when Plaid is confident it's a
      // purchase or there's a real merchant, so Plaid wins in those cases.
      // Plaid also files P2P deposits as INCOME_SALARY ("Zelle … for Salary",
      // money from a relative); a person sending money is never payroll.
      if (p2p && (type === "spend" || type === "income_other" || type === "income_salary")) type = amt > 0 ? "transfer_out" : "transfer_in";
      // Payroll ACH that Plaid only knows as generic income is still pay.
      if (type === "income_other" && amt < 0 && !m.subtype && PAYROLL_RE.test(text)) {
        return { type: "income_salary", source: "pfc", reason: "Payroll deposit" };
      }
      if (type === "savings_contribution" && amt < 0) type = "transfer_internal";
      const isP2pTransfer = p2p && (type === "transfer_out" || type === "transfer_in");
      return { type, subtype: isP2pTransfer ? "p2p" : m.subtype, source: "pfc", reason: `Plaid: ${t.pfc_detailed.toLowerCase().replace(/_/g, " ")}` };
    }
  }

  // 6. Pattern library.
  // P2P with other people: money sent/received, not spending or income.
  // (P2P with the user themself was caught above as transfer_internal.)
  if (p2p) {
    return amt > 0
      ? { type: "transfer_out", subtype: "p2p", source: "pattern", reason: "Money sent to someone (not counted as spending)" }
      : { type: "transfer_in", subtype: "p2p", source: "pattern", reason: "Money received from someone (not counted as income)" };
  }
  if (amt < 0) {
    if (TAX_REFUND_RE.test(text)) return { type: "income_other", subtype: "tax_refund", source: "pattern", reason: "Tax refund" };
    if (PAYROLL_RE.test(text)) return { type: "income_salary", source: "pattern", reason: "Payroll deposit" };
    if (DIVIDEND_RE.test(text)) return { type: "income_interest", subtype: "dividend", source: "pattern", reason: "Dividend" };
    if (INTEREST_RE.test(text)) return { type: "income_interest", subtype: "interest", source: "pattern", reason: "Interest earned" };
  } else if (amt > 0) {
    if (TAX_RE.test(text)) return { type: "obligation_tax", subtype: "tax", source: "pattern", reason: "Tax payment" };
    if (!notInternal && SAVINGS_SWEEP_RE.test(text)) return { type: "savings_contribution", subtype: "savings", source: "pattern", reason: "Moved to savings" };
    if (LOAN_RE.test(text)) return { type: "obligation_loan", source: "pattern", reason: "Loan payment" };
  }

  // 7. Recurring-stream context.
  const rec = ctx.recurringType?.(t);
  if (rec) return { type: rec, source: "recurring", reason: "Part of a confirmed recurring series" };

  // 8. Stored category, then sign fallback.
  const stored = ctx.plaidCategory ? ctx.plaidCategory(t) : (t.category?.[0] ?? null);
  const c = fromCategory(stored, t, ctx, "category", "Category");
  if (c) return c;
  if (amt > 0) return { type: "spend", source: "fallback", reason: "Money out" };
  if (acct?.type === "credit") {
    return t.merchant_name
      ? { type: "refund", source: "fallback", reason: "Credit from a merchant" }
      : { type: "credit_card_payment", source: "fallback", reason: "Credit on your card" };
  }
  return { type: "transfer_in", source: "fallback", reason: "Money in from an unknown source — review" };
}

const OBLIGATION_TYPES = new Set<TxnType>(["obligation_loan", "obligation_bill", "obligation_tax"]);
const USER_SOURCES = new Set<Classification["source"]>(["override", "category_override", "rule"]);
/** Same payee, same account, same amount: "JPMorgan Chase Ext Trnsfr 30934777414" → "jpmorgan chase ext trnsfr". */
const seriesKey = (t: ClassifierTxn) =>
  `${t.account_id}|${Math.abs(signed(t)).toFixed(2)}|${descriptor(t).toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim()}`;

/**
 * Classify a whole set (runs the pair matcher once), then two whole-set
 * corrections a single row can't see:
 *  - a bank transfer that paid a linked loan makes the same transfer in
 *    other months (before the loan's history starts) a loan payment too;
 *  - money moved into an account that itself pays bills/loans (a "funding"
 *    or escrow savings account) is earmarked for those bills, not savings.
 */
export function classifyAll(txns: ClassifierTxn[], ctx: ClassifierContext): Map<string, Classification> {
  const pairs = matchInternalTransfers(txns, ctx.accounts ?? [], { selfNames: ctx.selfNames });
  const byId = new Map(txns.map(t => [t.id, t]));
  const out = new Map<string, Classification>();
  for (const t of txns) out.set(t.id, classifyOne(t, ctx, pairs, byId));
  const accounts = ctx.accounts ?? [];
  if (!accounts.length) return out;
  const acctById = new Map(accounts.map(a => [a.account_id, a]));

  // Loan-payment series.
  const loanKeys = new Map<string, string>();
  for (const t of txns) {
    const c = out.get(t.id);
    if (c?.source === "pair" && c.type === "obligation_loan" && signed(t) > 0) loanKeys.set(seriesKey(t), t.id);
  }
  if (loanKeys.size) {
    for (const t of txns) {
      const c = out.get(t.id);
      if (!c || signed(t) <= 0 || USER_SOURCES.has(c.source) || c.source === "pair") continue;
      if (!/^(transfer_out|transfer_internal|spend)$/.test(c.type)) continue;
      if (ctx.notInternalIds?.has(t.id)) continue;
      const pairId = loanKeys.get(seriesKey(t));
      if (pairId) out.set(t.id, { type: "obligation_loan", subtype: "loan", source: "pair", reason: "Same payment as the one to your linked loan" });
    }
  }

  // Accounts that pay obligations (2+ bill/loan/tax payments out of them).
  const obligationCount = new Map<string, number>();
  for (const t of txns) {
    const c = out.get(t.id);
    const a = acctById.get(t.account_id);
    if (!c || !a || a.type !== "depository" || signed(t) <= 0 || !OBLIGATION_TYPES.has(c.type)) continue;
    obligationCount.set(a.account_id, (obligationCount.get(a.account_id) ?? 0) + 1);
  }
  const paysBills = (id?: string) => {
    const a = id ? acctById.get(id) : undefined;
    // A savings goal / investment role the person picked still wins (a
    // buffer or reserve that pays the bills is bill money).
    return !!a && (obligationCount.get(a.account_id) ?? 0) >= 2 && a.role !== "savings_goal" && a.role !== "investment";
  };
  for (const t of txns) {
    const c = out.get(t.id);
    if (!c || c.source !== "pair" || c.type !== "savings_contribution" || !c.pairId) continue;
    const inLeg = byId.get(c.pairId);
    if (inLeg && paysBills(inLeg.account_id)) {
      out.set(t.id, { ...c, type: "transfer_internal", subtype: "bill_funding", reason: "Moved to the account that pays your bills" });
    }
  }
  return out;
}
