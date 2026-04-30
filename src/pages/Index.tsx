import { useState } from "react";
import { TopBar } from "@/components/finance/TopBar";
import { NetWorthHeader } from "@/components/finance/NetWorthHeader";
import { AccountsSection } from "@/components/finance/AccountsSection";
import { PoolsSection } from "@/components/finance/PoolsSection";
import { InsightsSection } from "@/components/finance/InsightsSection";
import { ActionableItems } from "@/components/finance/ActionableItems";
import { UpcomingTransactions } from "@/components/finance/UpcomingTransactions";
import { SpendingSection } from "@/components/finance/SpendingSection";
import { MonthlyMaintenance } from "@/components/finance/MonthlyMaintenance";
import { BenefitsSection } from "@/components/finance/BenefitsSection";
import { DealsSection } from "@/components/finance/DealsSection";
import { CollapsibleSection } from "@/components/finance/CollapsibleSection";
import { accounts } from "@/lib/finance-data";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, CalendarClock, Sparkles, Tag, PieChart,
  type LucideIcon,
} from "lucide-react";

type View = "overall" | "monthly" | "benefits" | "deals" | "spending";

const TABS: { k: View; label: string; icon: LucideIcon; sub: string }[] = [
  { k: "overall",  label: "Home",      icon: LayoutDashboard, sub: "What needs attention today" },
  { k: "monthly",  label: "Monthly",   icon: CalendarClock,   sub: "This month's cash flow" },
  { k: "benefits", label: "Benefits",  icon: Sparkles,        sub: "Card perks & refinancing" },
  { k: "deals",    label: "Deals",     icon: Tag,             sub: "Cashback offers across cards" },
  { k: "spending", label: "Spending",  icon: PieChart,        sub: "Budgets & transactions" },
];

const Index = () => {
  const [view, setView] = useState<View>("overall");

  const assets = accounts.filter((a) => a.balance > 0).reduce((s, a) => s + a.balance, 0);
  const liabilities = accounts.filter((a) => a.balance < 0).reduce((s, a) => s + a.balance, 0);
  const netWorth = assets + liabilities;

  const activeTab = TABS.find((t) => t.k === view)!;

  return (
    <div className="min-h-screen bg-background">
      <TopBar active={view} onChange={(v) => setView(v as View)} tabs={TABS.map((t) => ({ k: t.k, label: t.label }))} />

      <main className="max-w-[1280px] mx-auto px-4 md:px-8 py-6 md:py-8 space-y-5">
        {/* Mobile chip switcher */}
        <div className="md:hidden -mx-4 px-4 overflow-x-auto">
          <div className="inline-flex p-1 rounded-full border border-border bg-surface/60 min-w-max">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = view === t.k;
              return (
                <button
                  key={t.k}
                  onClick={() => setView(t.k)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-[11px] font-medium inline-flex items-center gap-1.5 transition-all whitespace-nowrap",
                    active ? "bg-foreground text-background" : "text-muted-foreground"
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Section eyebrow */}
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{activeTab.sub}</div>
            <h1 className="font-display text-2xl md:text-3xl text-primary mt-0.5">{activeTab.label}</h1>
          </div>
          <div className="text-[10px] text-muted-foreground hidden md:block">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </div>
        </div>

        {view === "overall" && (
          <div className="space-y-5 animate-fade-up">
            {/* Two-column hero: Actionable on the LEFT, Insights on the right */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ActionableItems />
              <CollapsibleSection
                eyebrow="Insights & opportunities"
                title="Ways to optimize"
                subtitle="Pattern-based suggestions worth reviewing."
                defaultOpen
              >
                <InsightsSection compact />
              </CollapsibleSection>
            </div>

            {/* Net worth — slimmer, below the fold */}
            <NetWorthHeader netWorth={netWorth} assets={assets} liabilities={liabilities} />

            {/* Accounts — the full balance sheet as compact tables */}
            <AccountsSection />
          </div>
        )}

        {view === "monthly" && (
          <div className="space-y-5 animate-fade-up">
            <UpcomingTransactions />
            <MonthlyMaintenance />
            <CollapsibleSection
              eyebrow="Allocation"
              title="Virtual savings pools"
              subtitle="Slice one high-yield savings account into named buckets driven by salary rules."
              defaultOpen={false}
            >
              <PoolsSection />
            </CollapsibleSection>
          </div>
        )}

        {view === "benefits" && <BenefitsSection />}

        {view === "deals" && <DealsSection />}

        {view === "spending" && (
          <div className="space-y-5 animate-fade-up">
            <SpendingSection />
          </div>
        )}

        <footer className="pt-6 pb-4 text-center text-[11px] text-muted-foreground">
          Atlas Finance · Demo data · Updated {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </footer>
      </main>
    </div>
  );
};

export default Index;
