import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useHistoryLayer } from "@/hooks/useHistoryLayer";

/**
 * The phone "More" menu. Rendered in a portal on <body>: the bottom nav has
 * `backdrop-blur`, which makes it the containing block for `position: fixed`
 * children, so an in-nav `fixed inset-0` backdrop only covered the nav.
 * Closes on backdrop tap, Escape, X and browser/Android Back (own history
 * entry, like the Timeline panel); focus goes back to the More button.
 */
export function MobileMoreMenu({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useHistoryLayer(open, onClose);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const menu = menuRef.current;
    menu?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); } };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const el = opener.current;
      // only restore focus when nothing else (e.g. the Timeline panel) took it
      if (el?.isConnected && (document.activeElement === document.body || menu?.contains(document.activeElement))) el.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <>
      <button type="button" aria-label="Close menu" tabIndex={-1} data-testid="more-backdrop"
        className="fixed inset-0 z-[100] cursor-default bg-black/20 md:hidden" onClick={onClose} />
      <div ref={menuRef} role="menu" aria-label="More" data-testid="more-menu"
        style={{ bottom: "calc(4rem + env(safe-area-inset-bottom))" }}
        className="fixed right-2 z-[101] w-56 rounded-xl shadow-2xl overflow-hidden bg-[hsl(var(--popover))] border border-border md:hidden">
        <div className="flex items-center justify-between pl-4 pr-1 border-b border-border/50">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">More</span>
          <button type="button" onClick={onClose} aria-label="Close"
            className="h-11 w-11 grid place-items-center rounded-full text-muted-foreground hover:bg-muted/50">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </>,
    document.body,
  );
}
