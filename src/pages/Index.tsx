import { useCallback, useEffect, useMemo, useState } from "react";
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
import { LinkAccountDialog } from "@/components/finance/LinkAccountDialog";
import { AdminUsersSection } from "@/components/finance/AdminUsersSection";
import { EmptyDashboard } from "@/components/finance/EmptyDashboard";
import { LivePlaidDashboard } from "@/components/finance/LivePlaidDashboard";
import { accounts } from "@/lib/finance-data";
import { useAuth } from "@/contexts/AuthContext";
import { useDemo } from "@/contexts/DemoContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, CalendarClock, Sparkles, Tag, PieChart, Users,
  type LucideIcon,
} from "lucide-react";

type View = "overall" | "monthly" | "benefits" | "deals" | "spending" | "admin";

const BASE_TABS: { k: View; label: string; icon: LucideIcon; sub: string }[] = [
  { k: "overall",  label: "Home",      icon: LayoutDashboard, sub: "What needs attention today" },
  { k: "monthly",  label: "Monthly",   icon: CalendarClock,   sub: "This month's cash flow" },
  { k: "benefits", label: "Benefits",  icon: Sparkles,        sub: "Card perks & refinancing" },
  { k: "deals",    label: "Deals",     icon: Tag,             sub: "Cashback offers across cards" },
  { k: "spending", label: "Spending",  icon: PieChart,        sub: "Budgets & transactions" },
];

const Index = () => {
  const [view, setView] = useState<View>("overall");
  const [linkOpen, setLinkOpen] = useState(false);
  const { isAdmin, user } = useAuth();
  const { demo } = useDemo();
  const TABS = useMemo(
    () => isAdmin ? [...BASE_TABS, { k: "admin" as View, label: "Admin", icon: Users, sub: "User management" }] : BASE_TABS,
    [isAdmin]
  );

  const [hasItems, setHasItems] = useState<boolean | null>(null);
  const checkItems = useCallback(async () => {
    if (!user) { setHasItems(false); return; }
    const { count } = await supabase
      .from("plaid_items")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");
    setHasItems((count ?? 0) > 0);
  }, [user]);
  useEffect(() => { checkItems(); }, [checkItems]);

  const assets = accounts.filter((a) => a.balance > 0).reduce((s, a) => s + a.balance, 0);
  const liabilities = accounts.filter((a) => a.balance < 0).reduce((s, a) => s + a.balance, 0);
  const netWorth = assets + liabilities;

  // Routing:
  //  - demo on → show demo dashboards (existing sections)
  //  - demo off + hasItems → show live Plaid dashboard
  //  - demo off + no items → show empty/onboarding state
  // Admin tab is always available to admins regardless.
  const showLive = !demo && hasItems === true && view !== "admin";
  const showEmpty = !demo && hasItems === false && view !== "admin";

  return (
    <div className="min-h-screen bg-background">
      <TopBar
        active={view}
        onChange={(v) => setView(v as View)}
        tabs={TABS.map((t) => ({ k: t.k, label: t.label }))}
        onAddAccount={() => setLinkOpen(true)}
      />
      <LinkAccountDialog open={linkOpen} onOpenChange={setLinkOpen} />

      <main className="max-w-[1280px] mx-auto px-4 md:px-8 py-5 md:py-6 space-y-4">
        {!showEmpty && (
          /* Mobile chip switcher */
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
        )}

        {showEmpty && <EmptyDashboard onLink={() => setLinkOpen(true)} />}

        {!showEmpty && view === "overall" && (
          <div className="space-y-4 animate-fade-up">
            <NetWorthHeader netWorth={netWorth} assets={assets} liabilities={liabilities} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ActionableItems />
              <InsightsSection compact />
            </div>
            <AccountsSection onAddAccount={() => setLinkOpen(true)} />
          </div>
        )}

        {!showEmpty && view === "monthly" && (
          <div className="space-y-4 animate-fade-up">
            <UpcomingTransactions />
            <MonthlyMaintenance />
            <CollapsibleSection
              title="Virtual savings pools"
              subtitle="One HYSA, sliced into named buckets by payday rules."
              defaultOpen={false}
            >
              <PoolsSection embedded />
            </CollapsibleSection>
          </div>
        )}

        {!showEmpty && view === "benefits" && <BenefitsSection />}
        {!showEmpty && view === "deals" && <DealsSection />}
        {!showEmpty && view === "spending" && <SpendingSection />}
        {view === "admin" && isAdmin && <AdminUsersSection />}

        {!showEmpty && (
          <footer className="pt-6 pb-4 text-center text-[11px] text-muted-foreground">
            Atlas · {demo ? "Demo data" : "Live data"} · {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </footer>
        )}
      </main>
    </div>
  );
};

export default Index;
