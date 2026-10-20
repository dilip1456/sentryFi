import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

/**
 * Modal confirmation for destructive actions (disconnect a bank, reset data,
 * delete the account). Uses a plain button rather than AlertDialogAction so
 * async work can finish (and show a spinner) before the dialog closes.
 */
export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel, onConfirm,
  busy = false, confirmDisabled = false, destructive = true, children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
  confirmDisabled?: boolean;
  destructive?: boolean;
  children?: ReactNode;
}) {
  return (
    <AlertDialog open={open} onOpenChange={o => { if (!busy) onOpenChange(o); }}>
      <AlertDialogContent className="max-w-sm surface-elevated">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-base">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-[13px] leading-relaxed">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <button type="button" onClick={() => { void onConfirm(); }} disabled={busy || confirmDisabled}
            className={cn("inline-flex h-10 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40",
              destructive ? "bg-negative text-white" : "bg-foreground text-background")}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
