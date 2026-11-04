import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Filter chip / toggle pill (Financial Picture `.chipbtn`): 36px, 44px on phones,
 * pressed = gold tint. Use `aria-pressed` semantics for toggles.
 */
export interface ChipButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  pressed?: boolean;
}

export const ChipButton = React.forwardRef<HTMLButtonElement, ChipButtonProps>(
  ({ pressed, className, type = "button", ...props }, ref) => (
    <button ref={ref} type={type} aria-pressed={pressed}
      className={cn(
        "inline-flex min-h-11 md:min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5",
        pressed ? "border-primary bg-primary/15 text-primary" : "border-border-strong text-foreground hover:border-primary/60",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props} />
  ),
);
ChipButton.displayName = "ChipButton";

export interface SegmentedOption<T extends string> { value: T; label: React.ReactNode; }

/** Segmented control (Financial Picture `.seg`): full-width with 44px segments on phones. */
export function SegmentedControl<T extends string>({ value, onChange, options, className, "aria-label": ariaLabel }: {
  value: T; onChange: (v: T) => void; options: SegmentedOption<T>[]; className?: string; "aria-label"?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} data-ui="segmented"
      className={cn("flex md:inline-flex rounded-xl border border-border bg-muted/50 p-[3px]", className)}>
      {options.map(o => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}
          className={cn("min-h-11 md:min-h-[38px] flex-1 md:flex-none rounded-[9px] px-4 text-[13.5px] font-semibold transition-colors",
            o.value === value ? "bg-primary text-primary-foreground shadow-[0_2px_10px_-3px_hsl(var(--primary)/0.5)]" : "text-muted-foreground hover:text-foreground")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
