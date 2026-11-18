import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useHistoryLayer } from "@/hooks/useHistoryLayer";
import { menuSurface } from "@/components/ui/menu-styles";
import { cn } from "@/lib/utils";

/**
 * The phone header (gear) menu. Hand-rolled portaled panel, so it wires its own
 * a11y: focus moves to the first row on open and back to the opener on close,
 * Tab is kept inside, Escape closes (unless an inner control already handled it,
 * i.e. `defaultPrevented`), as do X, backdrop tap and browser/Android Back.
 */
export function HeaderMenu({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useHistoryLayer(open, onClose);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>("button, a[href]") ?? []);
    // first real row (skip the X in the title bar)
    (focusables()[1] ?? focusables()[0])?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); return; }
      if (e.key === "Tab" && panel) {
        const els = focusables(); if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const el = opener.current;
      if (el?.isConnected && (document.activeElement === document.body || panel?.contains(document.activeElement) || !document.activeElement)) el.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" data-testid="header-menu-backdrop" onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Menu" data-state="open" data-header-menu
        style={{ top: "calc(3.5rem + env(safe-area-inset-top))" }}
        className={cn(menuSurface, "fixed right-2 z-[9999] w-60 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-4.5rem-env(safe-area-inset-top))] overflow-y-auto overscroll-contain shadow-2xl")}>
        <div className="flex items-center justify-between pl-2.5 -mr-0.5 -mt-0.5 min-h-11 border-b border-border/50 mb-1">
          <span className="text-[11.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">Menu</span>
          <button type="button" aria-label="Close" onClick={onClose}
            className="h-11 w-11 grid place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-surface-hover">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </>,
    document.body,
  );
}
