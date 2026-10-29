/**
 * "Extend history" after Plaid Link succeeds for the same bank:
 *
 *   1. same-bank check on Link's metadata (nothing is created otherwise);
 *   2. plaid-exchange-token → a new Item with 730 days (its first sync runs
 *      inside the exchange);
 *   3. runCarryover(): plaid-relink + moving settings / overrides / findings /
 *      streams / obligations, pending edits saved, old Item removed.
 *
 * If the carry-over fails before anything moved (plaid-relink itself failed),
 * the NEW Item is removed again so the bank isn't shown twice, and the error
 * says nothing changed. A later failure keeps both connections and says so.
 */
import type { UserSettings } from "@/hooks/useUserSettings";
import { runCarryover, type CarryoverReport } from "./carryover";
import { createCarryoverDeps, type RelinkDb } from "./client";

export interface ExtendTarget { id: string; institution_id?: string | null; institution_name?: string | null }

export interface ExtendFlowOpts {
  db: RelinkDb;
  userId: string;
  target: ExtendTarget;
  publicToken: string;
  institution: { institution_id?: string | null; name?: string | null } | null | undefined;
  loadSettings(): Promise<UserSettings>;
  saveSettings(next: UserSettings): Promise<void>;
}

export class ExtendHistoryError extends Error {
  nothingChanged: boolean;
  constructor(message: string, nothingChanged: boolean) { super(message); this.nothingChanged = nothingChanged; }
}

export const sameBank = (target: ExtendTarget, inst: ExtendFlowOpts["institution"]) =>
  !target.institution_id || !inst?.institution_id || target.institution_id === inst.institution_id;

export async function runExtendHistory(o: ExtendFlowOpts): Promise<CarryoverReport & { newItemId: string }> {
  const bank = o.target.institution_name ?? "this bank";
  if (!sameBank(o.target, o.institution)) {
    throw new ExtendHistoryError(`That was ${o.institution?.name ?? "a different bank"}, not ${bank}. Nothing changed.`, true);
  }
  const ex = await o.db.functions.invoke("plaid-exchange-token", {
    body: { public_token: o.publicToken, institution: { institution_id: o.institution?.institution_id, name: o.institution?.name ?? o.target.institution_name } },
  });
  const newItemId: string | undefined = ex.data?.item_id;
  if (ex.error || ex.data?.error || !newItemId) {
    throw new ExtendHistoryError(`Couldn't link ${bank} again: ${ex.data?.error ?? ex.error?.message ?? "unknown error"}. Nothing changed.`, true);
  }

  const settings = await o.loadSettings();
  const deps = createCarryoverDeps({ db: o.db, userId: o.userId, settings, saveSettings: o.saveSettings });
  let serverDone = false;
  const relink = deps.relink;
  deps.relink = async (a, b) => { const r = await relink(a, b); serverDone = true; return r; };
  try {
    const report = await runCarryover(deps, o.target.id, newItemId);
    return { ...report, newItemId };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    if (!serverDone) {
      try { await deps.removeItem(newItemId); } catch { /* reported below */ }
      throw new ExtendHistoryError(`Couldn't move your settings to the new connection (${why}). Nothing changed.`, true);
    }
    throw new ExtendHistoryError(`Moving your settings stopped part-way (${why}). Both connections are kept; try Extend history again.`, false);
  }
}

/** One-paragraph summary for the result dialog. */
export function extendSummary(r: CarryoverReport, bank: string): string {
  const parts = [`${bank} is linked again with up to 2 years of history; older transactions arrive over the next few minutes.`];
  parts.push(`${r.accountsMoved} account${r.accountsMoved === 1 ? "" : "s"} and ${r.editsMoved} edit${r.editsMoved === 1 ? "" : "s"} moved over.`);
  if (r.editsPending) parts.push(`${r.editsPending} edit${r.editsPending === 1 ? " is" : "s are"} waiting for older transactions and will be placed automatically.`);
  if (r.accountsUnmatched.length) {
    const names = r.accountsUnmatched.map(a => `${a.name ?? "Account"}${a.mask ? ` ••${a.mask}` : ""}`).join(", ");
    parts.push(`Couldn't match ${names}: settings for ${r.accountsUnmatched.length === 1 ? "it were" : "them were"} reset${r.editsLost ? ` (${r.editsLost} edit${r.editsLost === 1 ? "" : "s"} lost)` : ""}.`);
  }
  if (!r.oldItemRemoved) parts.push("The old connection couldn't be removed; disconnect it below.");
  return parts.join(" ");
}
