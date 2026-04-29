import { Bell, Search, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

interface TopBarTab { k: string; label: string }
interface Props {
  active?: string;
  onChange?: (k: string) => void;
  tabs?: TopBarTab[];
}

export const TopBar = ({ active, onChange, tabs }: Props) => {
  const navItems: TopBarTab[] = tabs ?? [
    { k: "overall", label: "Overview" },
    { k: "monthly", label: "Monthly" },
    { k: "benefits", label: "Benefits" },
    { k: "deals", label: "Deals" },
    { k: "spending", label: "Spending" },
  ];

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/70 border-b border-border/60">
      <div className="max-w-[1280px] mx-auto px-4 md:px-8 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 shrink-0">
          <div className="h-8 w-8 rounded-lg bg-foreground text-background grid place-items-center font-display text-lg font-semibold">
            A
          </div>
          <div className="font-display text-base tracking-tight text-foreground hidden sm:block">
            Atlas <span className="text-muted-foreground font-normal">/ Finance</span>
          </div>
        </div>

        <nav className="hidden md:flex items-center gap-0.5 text-sm flex-1 justify-center">
          {navItems.map((item) => {
            const isActive = active === item.k;
            return (
              <button
                key={item.k}
                onClick={() => onChange?.(item.k)}
                className={cn(
                  "px-3 py-1.5 rounded-full transition-colors text-[13px]",
                  isActive ? "bg-foreground text-background font-medium" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-1 shrink-0">
          <button className="h-9 w-9 grid place-items-center rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
            <Search className="h-4 w-4" />
          </button>
          <button className="relative h-9 w-9 grid place-items-center rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
            <Bell className="h-4 w-4" />
            <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-positive" />
          </button>
          <button className="h-9 w-9 grid place-items-center rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
            <Settings className="h-4 w-4" />
          </button>
          <div className="ml-1 h-8 w-8 rounded-full bg-gradient-to-br from-positive/40 to-info/40 border border-border-strong" />
        </div>
      </div>
    </header>
  );
};
