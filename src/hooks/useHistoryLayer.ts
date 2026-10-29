import { useEffect, useId, useRef } from "react";

/**
 * Back-button support for overlays (the Android hardware back button in the
 * Capacitor WebView, and the browser back button).
 *
 * While `open`, the overlay owns one history entry. Browser/hardware Back pops
 * it and closes the TOP overlay only. Closing from the UI (X, Escape, swipe,
 * backdrop) removes the entry with history.back(); that popstate is swallowed
 * so the overlay underneath stays open.
 */
type Layer = { id: string; close: () => void };
const layers: Layer[] = [];
let ignorePops = 0;
let listening = false;
let pendingBack = 0;

/**
 * Several overlays can close in one task (panel + its sheet): one history.go(-n).
 * A macrotask, not a microtask: React's follow-up sync render (e.g. a lazily
 * mounted panel opened by a menu item that also closes the menu) runs in a
 * microtask, and its layer must be able to take over the closing entry first.
 */
function scheduleBack() {
  pendingBack++;
  if (pendingBack > 1) return;
  setTimeout(() => {
    const n = pendingBack;
    pendingBack = 0;
    if (n <= 0) return; // a new layer took over the entry (see useHistoryLayer)
    ignorePops++;
    window.history.go(-n);
  }, 0);
}

function ensureListener() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("popstate", () => {
    if (ignorePops > 0) { ignorePops--; return; }
    const top = layers.pop();
    if (top) top.close();
  });
}

export function useHistoryLayer(open: boolean, onClose: () => void, enabled = true) {
  const id = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open || !enabled || typeof window === "undefined") return;
    ensureListener();
    const layer: Layer = { id, close: () => closeRef.current() };
    layers.push(layer);
    if (pendingBack > 0) {
      // one overlay closed and another opened in the same commit (e.g. a menu
      // item that opens the Timeline): reuse the closing layer's entry
      // instead of pushing and then immediately going back over it
      pendingBack--;
      window.history.replaceState({ ...(window.history.state ?? {}), sfLayer: layers.length }, "");
    } else {
      window.history.pushState({ ...(window.history.state ?? {}), sfLayer: layers.length }, "");
    }
    return () => {
      const i = layers.indexOf(layer);
      if (i === -1) return; // already popped by Back
      layers.splice(i, 1);
      scheduleBack();
    };
  }, [open, enabled, id]);
}

/** Test/debug helper: how many overlays currently own a history entry. */
export const historyLayerDepth = () => layers.length;
