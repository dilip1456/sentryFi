/**
 * Cross-tree inbox extras: home Action items (published by LivePlaidDashboard)
 * and the Picture history hint (published by the Picture screens).
 * Same pattern as src/lib/derived-alerts.ts.
 *
 * Emits are idempotent: unchanged values must not notify listeners. A useEffect
 * that cleared the store on every cleanup, then re-published a freshly-allocated
 * list, looped (React #185) on live Home — demo never published actions, so it
 * didn't crash.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { CompactItem } from "./compact";
import type { HistoryHintNotice } from "./product";

let actions: CompactItem[] = [];
let history: HistoryHintNotice | null = null;
let snapshot: { actions: CompactItem[]; history: HistoryHintNotice | null } = { actions, history };
const listeners = new Set<() => void>();
const emit = () => { snapshot = { actions, history }; listeners.forEach(l => l()); };
const sub = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

const sameItems = (a: CompactItem[], b: CompactItem[]) =>
  a.length === b.length && a.every((x, i) =>
    x.id === b[i].id && x.title === b[i].title && x.body === b[i].body && x.priority === b[i].priority
    && x.type === b[i].type && x.status === b[i].status);

/** Keep a stable `at` for an id that's already in the store so remapping doesn't look like a change. */
function withStableAt(list: CompactItem[]): CompactItem[] {
  return list.map(item => {
    const prev = actions.find(a => a.id === item.id);
    return prev ? { ...item, at: prev.at } : item;
  });
}

export function setHomeActionItems(list: CompactItem[]): void {
  const next = withStableAt(list);
  if (sameItems(actions, next)) return;
  actions = next;
  emit();
}
export const getHomeActionItems = () => actions;

/**
 * Publish Home action items into the inbox store. Re-renders that pass a new
 * array of the same items do not emit. The store is cleared on unmount or when
 * `active` is false (demo) — not on every effect re-run, which caused #185.
 */
export function usePublishHomeActionItems(items: CompactItem[], active: boolean) {
  useEffect(() => {
    if (!active) {
      setHomeActionItems([]);
      return;
    }
    setHomeActionItems(items);
  }, [active, items]);

  useEffect(() => () => { setHomeActionItems([]); }, []);
}

export function setHistoryHintNotice(next: HistoryHintNotice | null): void {
  const same = (history == null && next == null)
    || (!!history && !!next && history.text === next.text && history.banks.join() === next.banks.join());
  if (same) return;
  history = next;
  emit();
}
export const getHistoryHintNotice = () => history;

export function useInboxExtras() {
  return useSyncExternalStore(sub, () => snapshot, () => snapshot);
}

/** Test-only: drop published extras so cases don't leak into one another. */
export function resetInboxExtrasForTests() {
  actions = [];
  history = null;
  snapshot = { actions, history };
}
