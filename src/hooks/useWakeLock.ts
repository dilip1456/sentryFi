import { useEffect, useState } from "react";

type WakeLockSentinelLike = { release: () => Promise<void>; released?: boolean };
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } };

/** Keeps the screen on while `active` via the Screen Wake Lock API (web).
 *  No-op where the API is missing (e.g. Android WebView) — no native plugin. */
export const useWakeLock = (active: boolean): boolean => {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const nav = (typeof navigator !== "undefined" ? navigator : undefined) as WakeLockNavigator | undefined;
    if (!active || !nav?.wakeLock) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const s = await nav.wakeLock!.request("screen");
        if (cancelled) { void s.release(); return; }
        sentinel = s; setHeld(true);
      } catch { setHeld(false); }
    };
    // The browser drops the lock when the tab is hidden; take it back on return.
    const onVis = () => { if (document.visibilityState === "visible" && (!sentinel || sentinel.released)) void acquire(); };
    void acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      if (sentinel) void sentinel.release().catch(() => {});
      setHeld(false);
    };
  }, [active]);
  return held;
};
