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

/** Several overlays can close in one task (panel + its sheet): one history.go(-n). */
function scheduleBack() {
  pendingBack++;
  if (pendingBack > 1) return;
  queueMicrotask(() => {
    const n = pendingBack;
    pendingBack = 0;
    ignorePops++;
    window.history.go(-n);
  });
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
    window.history.pushState({ ...(window.history.state ?? {}), sfLayer: layers.length }, "");
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
