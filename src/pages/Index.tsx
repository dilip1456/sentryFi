import { useState } from "react";
import { TopBar } from "@/components/finance/TopBar";
import { NetWorthHeader } from "@/components/finance/NetWorthHeader";
import { AccountsSection } from "@/components/finance/AccountsSection";
import { PoolsSection } from "@/components/finance/PoolsSection";
import { InsightsSection } from "@/components/finance/InsightsSection";
import { SpendingSection } from "@/components/finance/SpendingSection";
import { MonthlyMaintenance } from "@/components/finance/MonthlyMaintenance";
import { accounts } from "@/lib/finance-data";
import { cn } from "@/lib/utils";
import { LayoutDashboard, CalendarClock } from "lucide-react";

type View = "overall" | "monthly";

const Index = () => {
  const [view, setView] = useState<View>("overall");

  // Net worth excludes nothing — overall picture
  const assets = accounts.filter((a) => a.balance > 0).reduce((s, a) => s + a.balance, 0);
  const liabilities = accounts.filter((a) => a.balance < 0).reduce((s, a) => s + a.balance, 0);
  const netWorth = assets + liabilities;

  return (
    <div className="min-h-screen bg-background">
      <TopBar />

      <main className="max-w-[1280px] mx-auto px-6 md:px-10 py-8 md:py-10 space-y-10">
        {/* View switcher */}
        <div className="flex items-center justify-between gap-4">
          <div className="inline-flex p-1 rounded-full border border-border bg-surface/60">
            {([
              { k: "overall", label: "Overall picture", icon: LayoutDashboard },
              { k: "monthly", label: "Monthly maintenance", icon: CalendarClock },
            ] as const).map((t) => {
              const Icon = t.icon;
              const active = view === t.k;
              return (
                <button
                  key={t.k}
                  onClick={() => setView(t.k)}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-xs font-medium inline-flex items-center gap-1.5 transition-all",
                    active
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="hidden md:block text-[11px] text-muted-foreground">
            {view === "overall" ? "Full net-worth view" : "Cash flow & recurring obligations"}
          </div>
        </div>

        {view === "overall" ? (
          <div className="space-y-12 md:space-y-16 animate-fade-up">
            <NetWorthHeader netWorth={netWorth} assets={assets} liabilities={liabilities} />
            <AccountsSection />
            <InsightsSection />
          </div>
        ) : (
          <div className="space-y-12 md:space-y-16 animate-fade-up">
            <MonthlyMaintenance />
            <PoolsSection />
            <SpendingSection />
          </div>
        )}

        <footer className="pt-8 pb-4 text-center text-xs text-muted-foreground">
          Atlas Finance · Demo data · Updated {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </footer>
      </main>
    </div>
  );
};

export default Index;
