/**
 * One sheet component, two presentations (RATIONALE §3 "Details"):
 *  - phone (< 768px): vaul bottom sheet (drawer.tsx): grab handle, 44px X,
 *    swipe-down, max 90dvh;
 *  - desktop: 440px right-side sheet (sheet.tsx): Esc, backdrop click, focus
 *    moves into it.
 * Android / browser Back closes it through useHistoryLayer. An inner pushed
 * screen (details → edit) takes its own history entry, so Back pops to the
 * screen underneath first.
 */
import type { ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useHistoryLayer } from "@/hooks/useHistoryLayer";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Shows a ← button that calls this (pushed screen). */
  onBack?: () => void;
  children: ReactNode;
  testId?: string;
  footer?: ReactNode;
}

export function AccountsSheet({ open, onClose, title, subtitle, onBack, children, testId, footer }: Props) {
  const mobile = useIsMobile();
  useHistoryLayer(open, onClose);

  const header = (
    <div className={cn("ac-sh", mobile && "pr-14")}>
      {onBack && (
        <button type="button" className="ac-ib tap-44" aria-label="Back" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
      )}
      <div className="ttl">
        {mobile
          ? <DrawerTitle asChild><h2>{title}</h2></DrawerTitle>
          : <SheetTitle asChild><h2>{title}</h2></SheetTitle>}
        {mobile
          ? <DrawerDescription asChild><p>{subtitle ?? ""}</p></DrawerDescription>
          : <SheetDescription asChild><p>{subtitle ?? ""}</p></SheetDescription>}
      </div>
      {!mobile && (
        <button type="button" className="ac-ib x tap-44" aria-label="Close" onClick={onClose} data-ac-close>
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );

  if (mobile) {
    return (
      <Drawer open={open} onOpenChange={o => { if (!o) onClose(); }} shouldScaleBackground={false}>
        <DrawerContent closeLabel="Close" className="ac max-h-[90dvh] bg-card [background-image:var(--gradient-surface)] border-[var(--gold-border)]" data-testid={testId}>
          {header}
          <div className="ac-sb">{children}</div>
          {footer}
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        data-testid={testId}
        onOpenAutoFocus={e => {
          // Focus the X (RATIONALE: "focus moves to X"), not the first field.
          const root = e.currentTarget as HTMLElement | null;
          const x = root?.querySelector<HTMLElement>("[data-ac-close]");
          if (x) { e.preventDefault(); x.focus(); }
        }}
        className={cn("ac w-[440px] max-w-[100vw] sm:max-w-[440px] p-0 gap-0 flex flex-col border-l border-border-strong bg-card [background-image:var(--gradient-surface)]",
          "[&>button:last-child]:hidden")}
      >
        {header}
        <div className="ac-sb flex-1 overflow-y-auto">{children}</div>
        {footer}
      </SheetContent>
    </Sheet>
  );
}
