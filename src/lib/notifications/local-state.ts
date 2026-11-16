/**
 * Read / dismiss state for inbox items that do not live in alert_log
 * (product notices, demo rows, home action items, history hint).
 * Per-user localStorage; no migration.
 */
const readKey = (userId: string) => `sentryfi_inbox_read_${userId}`;
const goneKey = (userId: string) => `sentryfi_inbox_dismissed_${userId}`;

const store = (): Storage | null => {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
};

function readSet(key: string): Set<string> {
  try { return new Set<string>(JSON.parse(store()?.getItem(key) ?? "[]")); } catch { return new Set(); }
}
function writeSet(key: string, ids: Set<string>): void {
  try { store()?.setItem(key, JSON.stringify([...ids])); } catch { /* private mode */ }
}

export function inboxReadIds(userId: string): Set<string> {
  return readSet(readKey(userId));
}
export function inboxDismissedIds(userId: string): Set<string> {
  return readSet(goneKey(userId));
}

export function markInboxRead(userId: string, ids: string[]): void {
  if (!userId || !ids.length) return;
  const next = inboxReadIds(userId);
  ids.forEach(id => next.add(id));
  writeSet(readKey(userId), next);
  emitInboxLocal();
}

export function dismissInboxItems(userId: string, ids: string[]): void {
  if (!userId || !ids.length) return;
  const gone = inboxDismissedIds(userId);
  const read = inboxReadIds(userId);
  ids.forEach(id => { gone.add(id); read.add(id); });
  writeSet(goneKey(userId), gone);
  writeSet(readKey(userId), read);
  emitInboxLocal();
}

export function applyLocalState<T extends { id: string; read?: boolean; gone?: boolean }>(userId: string, items: T[]): T[] {
  const read = inboxReadIds(userId);
  const gone = inboxDismissedIds(userId);
  return items
    .filter(i => !gone.has(i.id) && !i.gone)
    .map(i => ({ ...i, read: !!(i.read || read.has(i.id)), gone: false }));
}

/** Existing product-banner keys, kept so dismissing from the inbox stays dismissed. */
export const APK_BANNER_KEY = "sentryfi_apk_banner_dismissed";
export const APP_BANNER_KEY = "sentryfi_app_banner_dismissed";
export const DEMO_NOTICE_KEY = "sentryfi_demo_notice_dismissed";

export function isKeySet(key: string): boolean {
  try { return !!store()?.getItem(key); } catch { return false; }
}
export function setKey(key: string): void {
  try { store()?.setItem(key, "1"); } catch { /* private mode */ }
  emitInboxLocal();
}

export const INBOX_LOCAL_EVENT = "sentryfi:inbox-local";
export function emitInboxLocal(): void {
  try { window.dispatchEvent(new Event(INBOX_LOCAL_EVENT)); } catch { /* ss r */ }
  try { window.dispatchEvent(new Event("sentryfi:alerts-read")); } catch { /* ss r */ }
}
