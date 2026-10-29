import type React from "react";
import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Drawer as DrawerPrimitive } from "vaul";
import { X } from "lucide-react";
import { useHistoryLayer } from "@/hooks/useHistoryLayer";

/**
 * The Timeline's own modal shells. They wrap the same primitives as
 * src/components/ui/dialog.tsx / drawer.tsx (Radix Dialog, vaul) but with
 * the design's sizes, a visible X, and a back-button history entry, so the
 * shared ui/ files stay untouched (the Picture PR edits dialog.tsx).
 *
 * Every shell closes by: X, Escape, backdrop tap, Back (browser/Android),
 * and, for the mobile sheet, swipe-down (vaul).
 */
interface ShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  testId?: string;
  /** Element to refocus on close (the row that opened it). */
  returnFocus?: React.RefObject<HTMLElement | null>;
}

const refocus = (ref?: React.RefObject<HTMLElement | null>) => (ev: Event) => {
  const el = ref?.current;
  if (el && document.contains(el)) { ev.preventDefault(); el.focus(); }
};

/** Desktop: centred-ish dialog that sits left of the 400px Timeline sidebar. */
export function TimelineDialog({ open, onClose, title, children, testId, returnFocus }: ShellProps) {
  useHistoryLayer(open, onClose);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="tl-ov" data-testid="tl-backdrop" />
        <DialogPrimitive.Content className="tl-dlg" aria-describedby={undefined} data-testid={testId} onCloseAutoFocus={refocus(returnFocus)}>
          <div className="ov-h">
            <DialogPrimitive.Title asChild><h3>{title}</h3></DialogPrimitive.Title>
            <DialogPrimitive.Close className="ov-x" aria-label="Close"><X className="h-5 w-5" /></DialogPrimitive.Close>
          </div>
          <div className="ov-b">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Mobile: bottom sheet (vaul) with grab handle; swipe down to dismiss. */
export function TimelineSheet({ open, onClose, title, children, testId, returnFocus }: ShellProps) {
  useHistoryLayer(open, onClose);
  return (
    <DrawerPrimitive.Root open={open} onOpenChange={o => { if (!o) onClose(); }} shouldScaleBackground={false}>
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="tl-ov" data-testid="tl-backdrop" />
        <DrawerPrimitive.Content className="tl-sheet" aria-describedby={undefined} data-testid={testId} onCloseAutoFocus={refocus(returnFocus)}>
          <div className="grab" aria-hidden data-testid="tl-grab"><span /></div>
          <div className="ov-h !pt-1">
            <DrawerPrimitive.Title asChild><h3>{title}</h3></DrawerPrimitive.Title>
            <DrawerPrimitive.Close className="ov-x" aria-label="Close"><X className="h-5 w-5" /></DrawerPrimitive.Close>
          </div>
          <div className="ov-b" style={{ paddingBottom: "calc(22px + env(safe-area-inset-bottom))" }}>{children}</div>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}
