import { TopBar } from "@/components/finance/TopBar";
import { NetWorthHeader } from "@/components/finance/NetWorthHeader";
import { AccountsSection } from "@/components/finance/AccountsSection";
import { PoolsSection } from "@/components/finance/PoolsSection";
import { InsightsSection } from "@/components/finance/InsightsSection";
import { SpendingSection } from "@/components/finance/SpendingSection";
import { accounts } from "@/lib/finance-data";

const Index = () => {
  const assets = accounts.filter((a) => a.balance > 0).reduce((s, a) => s + a.balance, 0);
  const liabilities = accounts.filter((a) => a.balance < 0).reduce((s, a) => s + a.balance, 0);
  const netWorth = assets + liabilities;

  return (
    <div className="min-h-screen bg-background">
      <TopBar />

      <main className="max-w-[1280px] mx-auto px-6 md:px-10 py-8 md:py-12 space-y-12 md:space-y-16">
        <NetWorthHeader netWorth={netWorth} assets={assets} liabilities={liabilities} />
        <AccountsSection />
        <PoolsSection />
        <InsightsSection />
        <SpendingSection />

        <footer className="pt-8 pb-4 text-center text-xs text-muted-foreground">
          Atlas Finance · Demo data · Updated {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </footer>
      </main>
    </div>
  );
};

export default Index;
