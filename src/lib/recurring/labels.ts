/**
 * Stored labels that an older parser derived ("Credit Org Name" for a Zelle
 * credit, "Cgi Technologies Des:Payroll Id:…" for a paycheck, a truncated
 * "Provident Fundin") are re-derived from the current parser. A label is
 * only replaced when it is exactly what one of the old automatic
 * derivations produced from the item's own key or transactions, so anything
 * the person typed (or any name that came from somewhere else) is kept.
 * Pure, no I/O.
 */
import type { ClassifierTxn } from "./classifier";
import type { SeriesKind } from "./detect";
import { displayName } from "./patterns";
import { bankNameField, cleanPayee, employerLabel, isP2PText, payrollCompany } from "./payee";
import type { RecurringDecision } from "./review";

type LabelTxn = Pick<ClassifierTxn, "name" | "merchant_name"> & { date?: string };

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

/** The payee part of a review key ("inflow|credit org name|~2" → "credit org name"). */
export function keyPayee(key: string): string | null {
  const p = key.split("|")[1] ?? "";
  return p && !/^(save|pay|acct|emp):/.test(p) ? p : null;
}

/** Every name the older parsers derived automatically for this key / these transactions. */
export function autoLabelCandidates(key: string, txns: readonly LabelTxn[]): Set<string> {
  const out = new Set<string>();
  const add = (s: string | null | undefined) => { const n = norm(s); if (n) out.add(n); };
  const payee = keyPayee(key);
  if (payee) add(titleCase(payee));
  for (const t of txns) {
    add(t.name);
    add(displayName(t.name));
    add(t.merchant_name);
    add(displayName(t.merchant_name));
  }
  return out;
}

/** True when `label` is one of the old automatic derivations (not a name the person chose). */
export function isAutoLabel(label: string | null | undefined, key: string, txns: readonly LabelTxn[]): boolean {
  const n = norm(label);
  return !n || n === "recurring item" || autoLabelCandidates(key, txns).has(n);
}

/** What the current parser names this payee, from its latest transaction (null = nothing better). */
export function currentLabel(kind: SeriesKind | undefined, txns: readonly LabelTxn[]): string | null {
  const t = [...txns].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
  if (!t) return null;
  const tt = { name: t.name ?? null, merchant_name: t.merchant_name ?? null };
  let name: string | null;
  if (kind === "salary") name = payrollCompany(tt.name) ?? employerLabel(tt);
  else if (isP2PText(tt)) name = bankNameField(tt.name) ?? cleanPayee(tt);
  else name = cleanPayee(tt);
  if (!name) return null;
  if (name === name.toUpperCase() && /[A-Z]/.test(name)) name = displayName(name);
  // Still the raw descriptor: the current parser has nothing better.
  return norm(name) === norm(tt.name) || norm(name) === norm(displayName(tt.name)) ? null : name.trim();
}

/**
 * A decision whose stored label is a stale automatic one, with the label
 * re-derived (`fresh` from detection when the item is still found, else from
 * its transactions). Returns the same object when nothing should change.
 */
export function refreshDecisionLabel(dec: RecurringDecision, txnById: ReadonlyMap<string, LabelTxn>, fresh?: string | null): RecurringDecision {
  const sn = dec.snapshot;
  if (dec.name?.trim()) return dec; // the person named it: never touched
  if (!sn?.label) return dec;
  const txns = (sn.transactionIds ?? []).map(id => txnById.get(id)).filter((t): t is LabelTxn => !!t);
  const next = (fresh ?? currentLabel(sn.kind, txns))?.trim();
  if (!next || norm(next) === norm(sn.label)) return dec; // already current, or nothing better
  if (!isAutoLabel(sn.label, dec.key, txns)) return dec; // the person's own name: keep it
  return { ...dec, snapshot: { ...sn, label: next } };
}
