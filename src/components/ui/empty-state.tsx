import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Primary / secondary buttons. */
  action?: React.ReactNode;
  /** Smaller padding for use inside a card or list. */
  compact?: boolean;
}

/** One empty state: tinted icon tile, 15px title, 13px muted copy, optional action. */
export function EmptyState({ icon, title, description, action, compact, className, ...props }: EmptyStateProps) {
  return (
    <div data-ui="empty-state" role="status"
      className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-1.5 px-4 py-8" : "gap-2 px-6 py-12", className)} {...props}>
      {icon && (
        <span aria-hidden="true" className="mb-1 grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary [&_svg]:h-5 [&_svg]:w-5">{icon}</span>
      )}
      <p className="text-[15px] font-semibold text-foreground">{title}</p>
      {description && <p className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
