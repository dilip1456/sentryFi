import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  trailing?: ReactNode;     // small right-side metric
  children: ReactNode;
  dense?: boolean;
}

export const CollapsibleSection = ({
  eyebrow, title, subtitle, defaultOpen = true, trailing, children, dense,
}: Props) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="surface-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 hover:bg-surface-hover/40 transition-colors text-left"
      >
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {eyebrow}
            </div>
          )}
          <div className="flex items-center gap-2 mt-0.5">
            <h2 className="font-display text-lg md:text-xl text-primary truncate">{title}</h2>
          </div>
          {subtitle && (
            <p className="text-[11.5px] text-muted-foreground mt-0.5 truncate">{subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {trailing}
          <div className={cn(
            "h-7 w-7 rounded-md grid place-items-center border border-border/60 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}>
            <ChevronDown className="h-3.5 w-3.5" />
          </div>
        </div>
      </button>

      {open && (
        <div className={cn("border-t border-border/40 animate-fade-up", dense ? "p-3 md:p-4" : "p-4 md:p-5")}>
          {children}
        </div>
      )}
    </section>
  );
};
