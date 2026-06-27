import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { CollapsibleSection } from "@/components/finance/CollapsibleSection";
import { LinkAccountDialog } from "@/components/finance/LinkAccountDialog";
import { AdminUsersSection } from "@/components/finance/AdminUsersSection";
import { GiftCardsSection } from "@/components/finance/GiftCardsSection";
import { EmptyDashboard } from "@/components/finance/EmptyDashboard";
import { LivePlaidDashboard } from "@/components/finance/LivePlaidDashboard";
import { accounts } from "@/lib/finance-data";
import { useAuth } from "@/contexts/AuthContext";
import { useDemo } from "@/contexts/DemoContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, CalendarClock, Sparkles, PieChart, Users, Loader2,
  RefreshCw, Plus, Gift,
  type LucideIcon,
} from "lucide-react";

type View = "overall" | "monthly" | "benefits" | "spending" | "giftcards" | "admin";
const BASE_TABS: { k: View; label: string; icon: LucideIcon; sub: string }[] = [
  { k: "overall",   label: "Home",               icon: LayoutDashboard, sub: "What needs attention today" },
  { k: "spending",  label: "Spending & Budget",   icon: PieChart,        sub: "Budgets & transactions" },
  { k: "monthly",   label: "Monthly",             icon: CalendarClock,   sub: "Cash flow by period" },
  { k: "benefits",  label: "Benefits",            icon: Sparkles,        sub: "Card perks & refinancing" },
  { k: "giftcards", label: "Gift Cards",          icon: Gift,            sub: "Track balances across brands" },
];

const Index = () => {
  const [view, setView] = useState<View>("overall");
  const bottomNavRef = useRef<HTMLElement>(null);

  // iOS/Android browsers sometimes fail to paint a `position: fixed` bottom bar
  // in its correct spot until the next scroll/resize event recalculates the
  // visual viewport (a long-standing mobile rendering quirk, not React-specific).
  // Forcing a one-frame reflow whenever the tab changes or the visual viewport
  // resizes/scrolls reliably fixes it.
  useEffect(() => {
    const forceReflow = () => {
      const el = bottomNavRef.current;
      if (!el) return;
      el.style.display = "none";
      requestAnimationFrame(() => {
        if (el) el.style.display = "";
      });
    };
    forceReflow();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", forceReflow);
    vv?.addEventListener("scroll", forceReflow);
    window.addEventListener("orientationchange", forceReflow);
    return () => {
      vv?.removeEventListener("resize", forceReflow);
      vv?.removeEventListener("scroll", forceReflow);
      window.removeEventListener("orientationchange", forceReflow);
    };
  }, [view]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncTrigger, setSyncTrigger] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const { isAdmin, user } = useAuth();

  const handleCategorySelect = (cat: string) => {
    setSelectedCategory(cat);
    setView("spending");
  };
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
      .eq("user_id", user.id)
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
  const showLive = !demo && hasItems === true && view !== "admin" && view !== "giftcards";
  const showEmpty = !demo && hasItems === false && view !== "admin" && view !== "giftcards";

  return (
    <div className="min-h-screen min-h-[100dvh] bg-background">
      <TopBar
        active={view}
        onChange={(v) => { setView(v as View); setSelectedCategory(null); }}
        tabs={TABS.map((t) => ({ k: t.k, label: t.label }))}
        onAddAccount={() => setLinkOpen(true)}
        onSync={() => setSyncTrigger(t => t + 1)}
        syncing={syncing}
      />
      <LinkAccountDialog open={linkOpen} onOpenChange={setLinkOpen} onLinked={checkItems} />

      <main className="w-full px-4 md:px-8 pt-5 md:pt-6 pb-24 md:pb-6 space-y-4">
        {/* Mobile action bar — Sync + Link account, hidden on md+ where TopBar shows them */}
        {showLive && (
          <div className="md:hidden flex items-center gap-2">
            <button
              onClick={() => setSyncTrigger(t => t + 1)}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-border-strong text-muted-foreground text-[11px] disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3 w-3", syncing && "animate-spin")} />
              {syncing ? "Syncing…" : "Sync"}
            </button>
            <button
              onClick={() => setLinkOpen(true)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-gold text-[11px] font-medium"
            >
              <Plus className="h-3 w-3" />
              Link account
            </button>
          </div>
        )}

        {!demo && hasItems === null && (
          <div className="min-h-[40vh] grid place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {showEmpty && (
          <EmptyDashboard onLink={() => { setLinkOpen(true); }} />
        )}

        {showLive && (
          <LivePlaidDashboard
            hasItems={hasItems === true}
            onAddAccount={() => setLinkOpen(true)}
            view={view}
            syncTrigger={syncTrigger}
            onSyncingChange={setSyncing}
            selectedCategory={selectedCategory}
            onCategorySelect={handleCategorySelect}
          />
        )}

        {demo && view === "overall" && (
          <div className="space-y-4 animate-fade-up">
            <NetWorthHeader netWorth={netWorth} assets={assets} liabilities={liabilities} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ActionableItems />
              <InsightsSection compact />
            </div>
            <AccountsSection onAddAccount={() => setLinkOpen(true)} />
          </div>
        )}

        {demo && view === "monthly" && (
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

        {demo && view === "benefits" && <BenefitsSection />}
        {demo && view === "spending" && <SpendingSection />}
        {view === "giftcards" && <GiftCardsSection />}
        {view === "admin" && isAdmin && <AdminUsersSection />}

        {!showEmpty && (
          <footer className="pt-6 pb-4 text-center text-[11px] text-muted-foreground">
            SentryFi · {demo ? "Demo data" : "Live data"} · {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </footer>
        )}
      </main>

      {/* Mobile bottom tab bar — replaces top chip switcher on small screens */}
      {hasItems !== null && (
        <nav
          ref={bottomNavRef}
          className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
          style={{ paddingBottom: "env(safe-area-inset-bottom)", transform: "translateZ(0)", WebkitTransform: "translateZ(0)" }}
        >
          <div className="flex items-stretch overflow-x-auto">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = view === t.k;
              return (
                <button
                  key={t.k}
                  onClick={() => { setView(t.k); setSelectedCategory(null); }}
                  className={cn(
                    "flex-1 min-w-[64px] flex flex-col items-center justify-center gap-0.5 py-2 px-1 text-[10px] font-medium transition-colors",
                    active ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  <Icon className={cn("h-5 w-5", active && "text-gold")} />
                  <span className="truncate max-w-[72px]">{t.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
};

export default Index;
