import * as React from "react";
import type { VariantProps } from "class-variance-authority";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { nativeSelectVariants } from "./native-select-variants";

/** The one select look: see native-select-variants.ts and docs/ui-style.md. */
export interface NativeSelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size">,
    VariantProps<typeof nativeSelectVariants> {
  /** Classes for the wrapper (width / flex sizing go here). */
  wrapperClassName?: string;
  invalid?: boolean;
}

export const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, wrapperClassName, size, shape, invalid, children, ...props }, ref) => (
    <div data-ui="select" className={cn("relative inline-flex min-w-0", wrapperClassName)}>
      <select ref={ref} aria-invalid={invalid || undefined}
        className={cn(nativeSelectVariants({ size, shape }), className)} {...props}>
        {children}
      </select>
      <ChevronDown aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground peer-disabled:opacity-50" />
    </div>
  ),
);
NativeSelect.displayName = "NativeSelect";
