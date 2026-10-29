import { CHECK_INTERVAL_MS } from "./config";

/** True if an automatic check is due. A last-check time in the future (clock change) counts as due. */
export const shouldAutoCheck = (now: number, lastCheck: number | null, intervalMs: number = CHECK_INTERVAL_MS): boolean => {
  if (lastCheck === null || !Number.isFinite(lastCheck)) return true;
  if (lastCheck > now) return true;
  return now - lastCheck >= intervalMs;
};

export const readTimestamp = (storage: Pick<Storage, "getItem">, key: string): number | null => {
  try {
    const v = storage.getItem(key);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
};
