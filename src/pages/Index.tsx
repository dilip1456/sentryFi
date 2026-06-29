import { useCallback, useEffect, useMemo, useState } from "react";
import { TopBar } from "@/components/finance/TopBar";
import { LinkAccountDialog } from "@/components/finance/LinkAccountDialog";
import { AdminUsersSection } from "@/components/finance/AdminUsersSection";
import { GiftCardsSection } from "@/components/finance/GiftCardsSection";
import { EmptyDashboard } from "@/components/finance/EmptyDashboard";
import { LivePlaidDashboard } from "@/components/finance/LivePlaidDashboard";
import { useAuth } from "@/contexts/AuthContext";
import { useDemo } from "@/contexts/DemoContext";
import { supabase } from "@/integrations/supabase/client";
import { isNative } from "@/lib/capacitor-oauth";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, CalendarClock, Sparkles, PieChart, Users, Loader2,
  RefreshCw, Plus, Gift, Wallet, Download, X, MoreHorizontal,
  type LucideIcon,
} from "lucide-react";

type View = "overall" | "monthly" | "benefits" | "spending" | "budget" | "giftcards" | "admin";
const BASE_TABS: { k: View; label: string; icon: LucideIcon; sub: string }[] = [
  { k: "overall",   label: "Home",               icon: LayoutDashboard, sub: "What needs attention today" },
  { k: "spending",  label: "Spending",           icon: PieChart,        sub: "Transactions & breakdowns" },
  { k: "budget",    label: "Budget",             icon: Wallet,          sub: "Monthly limits by category" },
  { k: "monthly",   label: "Monthly",             icon: CalendarClock,   sub: "Cash flow by period" },
  { k: "benefits",  label: "Benefits",            icon: Sparkles,        sub: "Card perks & refinancing" },
  { k: "giftcards", label: "Gift Cards",          icon: Gift,            sub: "Track balances across brands" },
];

const Index = () => {
  const [view, setView] = useState<View>("overall");
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
  // Bottom nav shows a focused set of primary tabs directly; everything else
  // (Monthly, Benefits, Admin) lives behind "More" so it never needs to
  // horizontally scroll on a phone-width screen.
  const PRIMARY_KEYS: View[] = ["overall", "spending", "budget", "giftcards"];
  const primaryTabs = TABS.filter(t => PRIMARY_KEYS.includes(t.k));
  const overflowTabs = TABS.filter(t => !PRIMARY_KEYS.includes(t.k));
  const [moreOpen, setMoreOpen] = useState(false);

  const [hasItems, setHasItems] = useState<boolean | null>(null);
  const [showAppBanner, setShowAppBanner] = useState(false);
  useEffect(() => {
    const isAndroidWeb = /Android/i.test(navigator.userAgent) && !isNative();
    const dismissed = localStorage.getItem("sentryfi_app_banner_dismissed") === "1";
    setShowAppBanner(isAndroidWeb && !dismissed);
  }, []);
  const dismissAppBanner = () => {
    localStorage.setItem("sentryfi_app_banner_dismissed", "1");
    setShowAppBanner(false);
  };
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

  // Routing: demo uses LivePlaidDashboard with no real data (same UI, sample-less)
  // Live: LivePlaidDashboard with real Plaid data
  const showLive = !demo && hasItems === true && view !== "admin" && view !== "giftcards";
  const showEmpty = !demo && hasItems === false && view !== "admin" && view !== "giftcards";

  return (
    <div className="h-screen h-[100dvh] bg-background flex flex-col overflow-hidden">
      <TopBar
        active={view}
        onChange={(v) => { setView(v as View); setSelectedCategory(null); }}
        tabs={TABS.map((t) => ({ k: t.k, label: t.label }))}
        onAddAccount={() => setLinkOpen(true)}
        onSync={() => setSyncTrigger(t => t + 1)}
        syncing={syncing}
      />
      <LinkAccountDialog open={linkOpen} onOpenChange={setLinkOpen} onLinked={checkItems} />

      {showAppBanner && (
        <div className="shrink-0 bg-[hsl(var(--primary)/0.12)] border-b border-[hsl(var(--primary)/0.25)] px-4 py-2 flex items-center gap-2.5">
          <Download className="h-4 w-4 text-[hsl(var(--primary))] shrink-0" />
          <span className="text-[12px] text-foreground flex-1 min-w-0">Get the SentryFi app for a faster, full-screen experience.</span>
          <a
            href="/downloads/SentryFi.apk"
            download
            className="text-[11.5px] font-medium px-2.5 py-1 rounded-full bg-[hsl(var(--primary))] text-background shrink-0"
          >
            Download
          </a>
          <button onClick={dismissAppBanner} aria-label="Dismiss" className="h-6 w-6 grid place-items-center rounded-md text-muted-foreground hover:text-foreground shrink-0">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}


      <main className="w-full flex-1 overflow-y-auto px-4 md:px-8 pt-5 md:pt-6 pb-6 md:pb-6 space-y-4">
        {/* Mobile action bar — Sync + Link account, hidden on md+ where TopBar shows them */}
        {showLive && (
          <div className="md:hidden flex items-center gap-2">
            <button
              onClick={() => setSyncTrigger(t => t + 1)}
              disabled={syncing}
              className="no-min-h inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-border-strong text-muted-foreground text-[11px] disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3 w-3", syncing && "animate-spin")} />
              {syncing ? "Syncing…" : "Sync"}
            </button>
            <button
              onClick={() => setLinkOpen(true)}
              className="no-min-h inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-gold text-[11px] font-medium"
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

        {demo && view !== "giftcards" && view !== "admin" && (
          <LivePlaidDashboard
            hasItems={false}
            onAddAccount={() => setLinkOpen(true)}
            view={view}
            syncTrigger={0}
            selectedCategory={selectedCategory}
            onCategorySelect={handleCategorySelect}
          />
        )}
        {view === "giftcards" && <GiftCardsSection />}
        {view === "admin" && isAdmin && <AdminUsersSection />}

        {!showEmpty && (
          <footer className="pt-6 pb-4 text-center text-[11px] text-muted-foreground">
            SentryFi · {demo ? "Demo data" : "Live data"} · {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </footer>
        )}
      </main>

      {/* Mobile bottom tab bar — fixed set of primary tabs, no horizontal scroll */}
      {hasItems !== null && (
        <nav
          className="md:hidden shrink-0 relative border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 shadow-[0_-2px_12px_-4px_rgba(0,0,0,0.12)]"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {moreOpen && (
            <>
              <button
                aria-label="Close menu"
                onClick={() => setMoreOpen(false)}
                className="fixed inset-0 z-40 bg-black/20"
              />
              <div className="absolute bottom-full right-2 mb-2 z-50 w-48 rounded-xl border border-border bg-surface-elevated shadow-lg overflow-hidden">
                {overflowTabs.map((t) => {
                  const Icon = t.icon;
                  const isActive = view === t.k;
                  return (
                    <button
                      key={t.k}
                      onClick={() => { setView(t.k); setSelectedCategory(null); setMoreOpen(false); }}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] transition-colors text-left",
                        isActive ? "bg-secondary/60 text-foreground font-medium" : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="flex items-stretch">
            {primaryTabs.map((t) => {
              const Icon = t.icon;
              const active = view === t.k;
              return (
                <button
                  key={t.k}
                  onClick={() => { setView(t.k); setSelectedCategory(null); setMoreOpen(false); }}
                  className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[10.5px] font-medium transition-colors"
                >
                  <span className={cn(
                    "h-7 w-10 rounded-full grid place-items-center transition-colors",
                    active ? "bg-[hsl(var(--primary)/0.14)]" : ""
                  )}>
                    <Icon className={cn("h-[19px] w-[19px]", active ? "text-[hsl(var(--primary))]" : "text-muted-foreground")} />
                  </span>
                  <span className={active ? "text-foreground" : "text-muted-foreground"}>{t.label}</span>
                </button>
              );
            })}
            {overflowTabs.length > 0 && (
              <button
                onClick={() => setMoreOpen(v => !v)}
                className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[10.5px] font-medium transition-colors"
              >
                <span className={cn(
                  "h-7 w-10 rounded-full grid place-items-center transition-colors",
                  moreOpen || overflowTabs.some(t => t.k === view) ? "bg-[hsl(var(--primary)/0.14)]" : ""
                )}>
                  <MoreHorizontal className={cn("h-[19px] w-[19px]", moreOpen || overflowTabs.some(t => t.k === view) ? "text-[hsl(var(--primary))]" : "text-muted-foreground")} />
                </span>
                <span className={moreOpen || overflowTabs.some(t => t.k === view) ? "text-foreground" : "text-muted-foreground"}>More</span>
              </button>
            )}
          </div>
        </nav>
      )}
    </div>
  );
};

export default Index;
