import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";

export type FloatingMenuPos = { top?: number; bottom?: number; right: number; maxHeight: number };

/**
 * Open/close + on-screen placement for the Spending tab's portaled popovers
 * and phone bottom sheets (filters, sort, columns, bulk actions, pickers).
 *
 * - Anchors to the button that was actually clicked (two buttons can share
 *   btnRef across the mobile/desktop toolbars) and clamps horizontally so a
 *   panel of `panelWidth` never leaves the viewport.
 * - Escape closes the open menu (these panels aren't Radix dialogs, so they
 *   don't get that for free) and returns focus to the trigger.
 */
export function useFloatingMenu(panelWidth = 0) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<FloatingMenuPos | null>(null);

  const toggle = (e?: React.MouseEvent<HTMLElement>) => {
    const anchor = (e?.currentTarget as HTMLElement | undefined) ?? btnRef.current;
    if (!open && anchor) {
      anchorRef.current = anchor;
      const r = anchor.getBoundingClientRect();
      const margin = 8;
      const spaceBelow = window.innerHeight - r.bottom - margin;
      const spaceAbove = r.top - margin;
      const maxRight = Math.max(margin, window.innerWidth - Math.min(panelWidth, window.innerWidth - 2 * margin) - margin);
      const right = Math.min(Math.max(margin, window.innerWidth - r.right), maxRight);
      // Open below the trigger unless there's little room below and more
      // above; maxHeight is capped to the side it opens toward.
      if (spaceBelow < 220 && spaceAbove > spaceBelow) {
        setPos({ bottom: window.innerHeight - r.top + 6, right, maxHeight: Math.max(160, Math.min(spaceAbove - 6, 420)) });
      } else {
        setPos({ top: r.bottom + 6, right, maxHeight: Math.max(160, Math.min(spaceBelow - 6, 420)) });
      }
    }
    setOpen(o => !o);
  };
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || ev.defaultPrevented) return;
      ev.preventDefault();
      setOpen(false);
      const a = anchorRef.current;
      if (a && a.isConnected) a.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return { btnRef, open, pos, toggle, close };
}
