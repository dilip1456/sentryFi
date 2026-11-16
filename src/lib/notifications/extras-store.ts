/**
 * Cross-tree inbox extras: home Action items (published by LivePlaidDashboard)
 * and the Picture history hint (published by the Picture screens).
 * Same pattern as src/lib/derived-alerts.ts.
 */
import { useSyncExternalStore } from "react";
import type { CompactItem } from "./compact";
import type { HistoryHintNotice } from "./product";

let actions: CompactItem[] = [];
let history: HistoryHintNotice | null = null;
let snapshot: { actions: CompactItem[]; history: HistoryHintNotice | null } = { actions, history };
const listeners = new Set<() => void>();
const emit = () => { snapshot = { actions, history }; listeners.forEach(l => l()); };
const sub = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

const sameItems = (a: CompactItem[], b: CompactItem[]) =>
  a.length === b.length && a.every((x, i) => x.id === b[i].id && x.title === b[i].title && x.body === b[i].body && x.priority === b[i].priority);

export function setHomeActionItems(list: CompactItem[]): void {
  if (sameItems(actions, list)) return;
  actions = list;
  emit();
}
export const getHomeActionItems = () => actions;

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
