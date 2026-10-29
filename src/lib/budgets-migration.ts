/**
 * One-time, backward-compatible upload of legacy localStorage budgets
 * (`sentryfi_budgets`, written by the old useBudgets hook) into
 * user_settings.budgets on the server.
 *
 * Rules:
 *  - Server wins: a category that already has a server budget is never
 *    overwritten by the local copy.
 *  - Only categories the server lacks are uploaded; nothing is deleted.
 *  - The local copy stays as a fallback until a read-back confirms the
 *    server has every uploaded category; only then is it cleared and a
 *    per-user "migrated" marker set, so it never runs twice for that user.
 *  - If the settings load fails, the local copy is what the UI shows.
 */
export const LOCAL_BUDGETS_KEY = "sentryfi_budgets";
export const budgetsMigratedKey = (userId: string) => `sentryfi_budgets_migrated:${userId}`;

export type BudgetMap = Record<string, number>;

/** Parse whatever is in localStorage into a clean category → positive amount map. */
export function parseLocalBudgets(raw: string | null | undefined): BudgetMap {
  if (!raw) return {};
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return {}; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: BudgetMap = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    const amt = typeof n === "number" ? n : Number(n);
    if (k.trim() && Number.isFinite(amt) && amt > 0) out[k] = amt;
  }
  return out;
}

export interface BudgetMigrationPlan {
  /** What the app should use right now (server values + any local-only categories). */
  merged: BudgetMap;
  /** Local-only categories that need uploading. */
  toUpload: BudgetMap;
  needsUpload: boolean;
}

export function planBudgetMigration(local: BudgetMap, server: BudgetMap | null | undefined, alreadyMigrated: boolean): BudgetMigrationPlan {
  const srv = server ?? {};
  if (alreadyMigrated) return { merged: { ...srv }, toUpload: {}, needsUpload: false };
  const toUpload: BudgetMap = {};
  for (const [cat, amt] of Object.entries(local)) if (!(cat in srv)) toUpload[cat] = amt;
  return { merged: { ...toUpload, ...srv }, toUpload, needsUpload: Object.keys(toUpload).length > 0 };
}

/** True when the server copy (read back after the upload) holds every uploaded category. */
export function isMigrationConfirmed(uploaded: BudgetMap, serverAfter: BudgetMap | null | undefined): boolean {
  const srv = serverAfter ?? {};
  return Object.keys(uploaded).every(cat => cat in srv);
}

interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/** Mark done and drop the local copy. Call only after isMigrationConfirmed(). */
export function finishBudgetMigration(storage: StorageLike, userId: string) {
  try {
    storage.setItem(budgetsMigratedKey(userId), new Date().toISOString());
    storage.removeItem(LOCAL_BUDGETS_KEY);
  } catch { /* storage unavailable: harmless, the merge is idempotent */ }
}

export function readMigrationState(storage: StorageLike | undefined, userId: string): { local: BudgetMap; migrated: boolean } {
  if (!storage) return { local: {}, migrated: true };
  try {
    return { local: parseLocalBudgets(storage.getItem(LOCAL_BUDGETS_KEY)), migrated: !!storage.getItem(budgetsMigratedKey(userId)) };
  } catch {
    return { local: {}, migrated: true };
  }
}
