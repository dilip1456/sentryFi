/**
 * Alerts the app works out on the device (paycheck anomalies) rather than the
 * send-alerts function: they need the client-side classifier, and alert_log
 * is written only by the service role. LivePlaidDashboard publishes them after
 * each load; the notification inbox lists them beside alert_log rows and the
 * bell counts them. They are never pushed.
 *
 * Read state is per user in localStorage. Ids carry the month, so next
 * month's anomaly is a new unread alert.
 */
import { useSyncExternalStore } from "react";
import type { AlertLike } from "./notifications";

export type DerivedAlert = Omit<AlertLike, "read_at" | "payload"> & { payload: Record<string, unknown> };

let current: DerivedAlert[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

const same = (a: DerivedAlert[], b: DerivedAlert[]) =>
  a.length === b.length && a.every((x, i) => x.id === b[i].id && x.body === b[i].body);

export function setDerivedAlerts(list: DerivedAlert[]): void {
  if (same(current, list)) return;
  current = list;
  emit();
}
export const getDerivedAlerts = () => current;

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useDerivedAlerts = () => useSyncExternalStore(subscribe, getDerivedAlerts, getDerivedAlerts);

const readKey = (userId: string) => `sentryfi_derived_read_${userId}`;
const store = (): Storage | null => { try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; } };

export function derivedReadIds(userId: string): Set<string> {
  try { return new Set<string>(JSON.parse(store()?.getItem(readKey(userId)) ?? "[]")); } catch { return new Set(); }
}

/** Keeps only ids still published (plus the new ones) so the list can't grow forever. */
export function markDerivedRead(userId: string, ids: string[]): void {
  if (!userId || !ids.length) return;
  const live = new Set(current.map(a => a.id));
  const next = [...new Set([...derivedReadIds(userId), ...ids])].filter(id => live.has(id) || ids.includes(id));
  try { store()?.setItem(readKey(userId), JSON.stringify(next)); } catch { /* private mode */ }
  current = [...current]; // new snapshot so subscribers re-read the read state
  emit();
}

export const isDerivedId = (id: string) => id.startsWith("derived:");

/** Inbox rows: the derived alerts with their read state. */
export function derivedInboxRows(userId: string, list: DerivedAlert[] = current, readAt = "1970-01-01T00:00:00.000Z"): AlertLike[] {
  const read = derivedReadIds(userId);
  return list.map(a => ({ ...a, read_at: read.has(a.id) ? readAt : null }));
}

export const derivedUnreadCount = (userId: string, list: DerivedAlert[] = current) => {
  const read = derivedReadIds(userId);
  return list.filter(a => !read.has(a.id)).length;
};
