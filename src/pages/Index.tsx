import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LinkAccountDialog } from "@/components/finance/LinkAccountDialog";
import { AdminUsersSection } from "@/components/finance/AdminUsersSection";
import { GiftCardsSection } from "@/components/finance/GiftCardsSection";
import { EmptyDashboard } from "@/components/finance/EmptyDashboard";
import { LivePlaidDashboard } from "@/components/finance/LivePlaidDashboard";
import { NotificationPreferences } from "@/components/NotificationPreferences";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useDemo } from "@/contexts/DemoContext";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { supabase } from "@/integrations/supabase/client";
import { isNative } from "@/lib/capacitor-oauth";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, CalendarClock, Sparkles, PieChart, Users, Loader2,
  RefreshCw, Plus, Gift, Wallet, Download, X, MoreHorizontal, Compass,
  LogOut, Settings, ChevronsUpDown, Bell,
  type LucideIcon,
} from "lucide-react";

type View = "overall" | "monthly" | "benefits" | "spending" | "budget" | "moneymap" | "giftcards" | "admin";

const BASE_TABS: { k: View; label: string; icon: LucideIcon }[] = [
  { k: "overall",   label: "Home",       icon: LayoutDashboard },
  { k: "moneymap",  label: "Money Map",  icon: Compass         },
  { k: "spending",  label: "Spending",   icon: PieChart        },
  { k: "budget",    label: "Budget",     icon: Wallet          },
  { k: "giftcards", label: "Gift Cards", icon: Gift            },
  { k: "benefits",  label: "Benefits",   icon: Sparkles        },
  { k: "monthly",   label: "Cash Flow",  icon: CalendarClock   },
];

const MOBILE_PRIMARY: View[] = ["overall", "moneymap", "spending", "budget"];

const Index = ({ guestDemo = false }: { guestDemo?: boolean }) => {
  const [view, setView] = useState<View>("overall");
  const [linkOpen, setLinkOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncTrigger, setSyncTrigger] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [showAppBanner, setShowAppBanner] = useState(false);
  const [hasItems, setHasItems] = useState<boolean | null>(guestDemo ? false : null);
  const { isAdmin, user } = useAuth();
  usePushNotifications(user?.id);
  const { demo, setDemo, onHasItemsResolved } = useDemo();
  const navigate = useNavigate();

  const effectiveDemo = demo || guestDemo;

  const TABS = isAdmin && !guestDemo
    ? [...BASE_TABS, { k: "admin" as View, label: "Admin", icon: Users }]
    : BASE_TABS;
  const mobilePrimary = TABS.filter(t => MOBILE_PRIMARY.includes(t.k));
  const mobileOverflow = TABS.filter(t => !MOBILE_PRIMARY.includes(t.k));

  useEffect(() => {
    const isMobileWeb = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) && !isNative();
    const dismissed = localStorage.getItem("sentryfi_app_banner_dismissed") === "1";
    setShowAppBanner(isMobileWeb && !dismissed && !guestDemo);
  }, [guestDemo]);

  const dismissAppBanner = () => {
    localStorage.setItem("sentryfi_app_banner_dismissed", "1");
    setShowAppBanner(false);
  };

  const checkItems = useCallback(async () => {
    if (guestDemo) { setHasItems(false); return; }
    if (!user) { setHasItems(null); return; }
    // Retry up to 3 times — on mobile OAuth the session can take a moment to fully propagate
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { count, error } = await supabase
          .from("plaid_items")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("status", "active");
        if (error) throw error;
        const has = (count ?? 0) > 0;
        setHasItems(has);
        if (has) onHasItemsResolved(true);
        return;
      } catch (e) {
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    // After 3 fails, default to showing empty dashboard rather than loading forever
    setHasItems(false);
  }, [user, guestDemo, onHasItemsResolved]);

  useEffect(() => { checkItems(); }, [checkItems]);

  const handleCategorySelect = (cat: string) => {
    if (cat === "__spending__") { setView("spending"); return; }
    setSelectedCategory(cat || null);
    if (cat) setView("spending");
  };

  const go = (v: View) => {
    setView(v);
    setSelectedCategory(null);
    setMoreOpen(false);
  };

  const showLive  = !effectiveDemo && hasItems === true  && view !== "admin" && view !== "giftcards";
  const showEmpty = !effectiveDemo && hasItems === false && view !== "admin" && view !== "giftcards";

  // Sidebar nav item
  const NavItem = ({ tab }: { tab: typeof TABS[0] }) => {
    const Icon = tab.icon;
    const active = view === tab.k;
    return (
      <button
        onClick={() => go(tab.k)}
        className={cn("nav-item w-full text-left", active && "active")}
      >
        <Icon className="h-4 w-4 flex-shrink-0" />
        <span>{tab.label}</span>
      </button>
    );
  };

  return (
    <div className="h-[100dvh] bg-background flex overflow-hidden">

      {/* ── Desktop sidebar ─────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-background))]"
        style={{ WebkitOverflowScrolling: "touch" }}>

        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-[hsl(var(--sidebar-border))]">
          <div className="h-8 w-8 rounded-lg overflow-hidden flex-shrink-0 bg-[hsl(var(--primary)/0.1)] grid place-items-center">
            <img src="/logo.png" alt="Sentry Finance" className="h-6 w-6 object-contain" />
          </div>
          <div>
            <div className="text-[13.5px] font-semibold text-[hsl(var(--sidebar-accent-foreground))] leading-tight">Sentry Finance</div>
            {guestDemo && <div className="text-[10px] text-[hsl(var(--warning))] font-medium">Demo mode</div>}
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5 scrollbar-none">
          <div className="section-label">Overview</div>
          {TABS.filter(t => ["overall","moneymap"].includes(t.k)).map(t => <NavItem key={t.k} tab={t} />)}

          <div className="section-label">Money</div>
          {TABS.filter(t => ["spending","budget","monthly"].includes(t.k)).map(t => <NavItem key={t.k} tab={t} />)}

          <div className="section-label">More</div>
          {TABS.filter(t => ["giftcards","benefits"].includes(t.k)).map(t => <NavItem key={t.k} tab={t} />)}

          {isAdmin && !guestDemo && (
            <>
              <div className="section-label">Admin</div>
              {TABS.filter(t => t.k === "admin").map(t => <NavItem key={t.k} tab={t} />)}
            </>
          )}
        </nav>

        {/* Bottom actions */}
        <div className="px-2 py-3 border-t border-[hsl(var(--sidebar-border))] space-y-0.5">
          {!effectiveDemo && hasItems === true && (
            <button
              onClick={() => setSyncTrigger(t => t + 1)}
              disabled={syncing}
              className="nav-item w-full"
            >
              <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
              {syncing ? "Syncing…" : "Sync data"}
            </button>
          )}
          {!effectiveDemo && (
            <button onClick={() => setLinkOpen(true)} className="nav-item w-full">
              <Plus className="h-4 w-4" />
              Link account
            </button>
          )}
          {user && (
            <button onClick={() => setShowPrefs(true)} className="nav-item w-full">
              <Bell className="h-4 w-4" />
              Notifications
            </button>
          )}
          {guestDemo && (
            <button onClick={() => navigate("/auth")} className="nav-item w-full">
              <LogOut className="h-4 w-4" />
              Create free account
            </button>
          )}
        </div>
      </aside>

      {/* ── Content area ────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">

        {/* Mobile header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-background/95 backdrop-blur shrink-0">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="" className="h-7 w-7 object-contain" />
            <span className="text-[14px] font-semibold text-foreground">
              {effectiveDemo ? "Sentry Finance" : (TABS.find(t => t.k === view)?.label ?? "Sentry Finance")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Not logged in at all — show sign in */}
            {!user && !effectiveDemo && (
              <button onClick={() => navigate("/auth")}
                className="h-8 px-3 rounded-full bg-gold text-[11.5px] font-semibold">
                Sign in
              </button>
            )}
            {/* In demo mode — offer to sign in or exit */}
            {effectiveDemo && (
              <>
                <button onClick={() => { setDemo(false); navigate("/welcome"); }}
                  className="h-8 px-3 rounded-full border border-border text-[11px] text-muted-foreground">
                  Exit demo
                </button>
                <button onClick={() => navigate("/auth")}
                  className="h-8 px-3 rounded-full bg-gold text-[11.5px] font-semibold">
                  Sign in
                </button>
              </>
            )}
            {/* Logged in with real data */}
            {!effectiveDemo && hasItems === true && (
              <button onClick={() => setSyncTrigger(t => t + 1)} disabled={syncing}
                className="h-8 w-8 rounded-full border border-border grid place-items-center text-muted-foreground disabled:opacity-40">
                <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
              </button>
            )}
            {!effectiveDemo && user && (
              <button onClick={() => setLinkOpen(true)}
                className="h-8 px-3 rounded-full bg-gold text-[11.5px] font-semibold flex items-center gap-1">
                <Plus className="h-3 w-3" /> Link
              </button>
            )}
          </div>
        </header>

        {/* APK download banner — show on any mobile browser (not just Android detection) */}
        {showAppBanner && (
          <div className="shrink-0 bg-[hsl(var(--primary)/0.1)] border-b border-[hsl(var(--primary)/0.2)] px-4 py-2.5 flex items-center gap-2.5 md:hidden">
            <Download className="h-4 w-4 text-[hsl(var(--primary))] shrink-0" />
            <span className="text-[12.5px] text-foreground flex-1 font-medium">Download the Android app</span>
            <a href="https://github.com/dilip1456/sentryFi/releases/download/latest/SentryFi-release.apk"
              className="text-[12px] font-semibold px-3 py-1.5 rounded-full bg-gold shrink-0">
              Download
            </a>
            <button onClick={dismissAppBanner} className="h-6 w-6 grid place-items-center text-muted-foreground shrink-0">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Demo banner */}
        {effectiveDemo && (
          <div className="shrink-0 bg-[hsl(var(--warning)/0.08)] border-b border-[hsl(var(--warning)/0.15)] px-4 py-2 flex items-center gap-2.5">
            <Sparkles className="h-3.5 w-3.5 text-[hsl(var(--warning))] shrink-0" />
            <span className="text-[12px] text-foreground flex-1">You're viewing demo data.</span>
            <button onClick={() => navigate("/auth")}
              className="text-[11.5px] font-semibold px-3 py-1 rounded-full bg-gold shrink-0">
              Create account
            </button>
            <button onClick={() => { setDemo(false); navigate("/welcome"); }}
              className="text-[11px] text-muted-foreground shrink-0 underline underline-offset-2">
              Exit
            </button>
          </div>
        )}

        {/* Main scroll area */}
        <main
          className="flex-1 overflow-y-auto"
          style={{ WebkitOverflowScrolling: "touch", overscrollBehaviorY: "contain" }}
        >
          <div className="content-max px-4 md:px-8 pt-6 pb-10 space-y-5">

            {/* Page header on desktop */}
            <div className="hidden md:flex items-center justify-between">
              <div>
                <h1 className="font-display text-2xl text-foreground">
                  {TABS.find(t => t.k === view)?.label ?? "Dashboard"}
                </h1>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                </p>
              </div>
              {!effectiveDemo && guestDemo && (
                <button onClick={() => navigate("/auth")}
                  className="bg-gold h-9 px-4 rounded-lg text-[13px]">
                  Create free account
                </button>
              )}
            </div>

            {/* Loading state */}
            {!effectiveDemo && hasItems === null && (
              <div className="min-h-[50vh] grid place-items-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {showEmpty && <EmptyDashboard onLink={() => setLinkOpen(true)} />}

            {showLive && (
              <LivePlaidDashboard
                hasItems
                onAddAccount={() => setLinkOpen(true)}
                view={view}
                syncTrigger={syncTrigger}
                onSyncingChange={setSyncing}
                selectedCategory={selectedCategory}
                onCategorySelect={handleCategorySelect}
              />
            )}

            {effectiveDemo && view !== "giftcards" && view !== "admin" && (
              <LivePlaidDashboard
                demo
                guestDemo={guestDemo}
                hasItems={false}
                onAddAccount={guestDemo ? () => navigate("/auth") : () => setLinkOpen(true)}
                view={view}
                syncTrigger={0}
                selectedCategory={selectedCategory}
                onCategorySelect={handleCategorySelect}
              />
            )}

            {view === "giftcards" && !guestDemo && <GiftCardsSection />}
            {view === "admin" && isAdmin && !guestDemo && <AdminUsersSection />}

            <div className="text-center text-[10.5px] text-muted-foreground/40 pt-4">
              Sentry Finance · {effectiveDemo ? "Demo data" : "Live data"}
            </div>
          </div>
        </main>

        {/* Mobile bottom tabs */}
        <nav
          className="md:hidden shrink-0 border-t border-border bg-background/95 backdrop-blur grid"
          style={{
            gridTemplateColumns: `repeat(${mobilePrimary.length + 1}, 1fr)`,
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
          {mobilePrimary.map(t => {
            const Icon = t.icon;
            const active = view === t.k;
            return (
              <button key={t.k} onClick={() => go(t.k)}
                className="flex flex-col items-center gap-0.5 py-2 px-1 relative">
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-[hsl(var(--primary))]" />
                )}
                <Icon className={cn("h-5 w-5 transition-colors", active ? "text-[hsl(var(--primary))]" : "text-muted-foreground")} />
                <span className={cn("text-[9.5px] font-medium transition-colors", active ? "text-[hsl(var(--primary))]" : "text-muted-foreground")}>
                  {t.label}
                </span>
              </button>
            );
          })}
          {/* More button */}
          <div className="relative">
            <button onClick={() => setMoreOpen(m => !m)}
              className="w-full flex flex-col items-center gap-0.5 py-2 px-1">
              <MoreHorizontal className="h-5 w-5 text-muted-foreground" />
              <span className="text-[9.5px] font-medium text-muted-foreground">More</span>
            </button>
            {moreOpen && (
              <>
                <button className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                <div className="absolute bottom-full right-0 mb-2 z-50 w-44 rounded-xl border border-border bg-[hsl(var(--popover))] shadow-xl overflow-hidden">
                  {mobileOverflow.map(t => {
                    const Icon = t.icon;
                    return (
                      <button key={t.k} onClick={() => go(t.k)}
                        className={cn("w-full flex items-center gap-3 px-4 py-3 text-left text-[13px] hover:bg-[hsl(var(--surface-hover))] transition-colors",
                          view === t.k ? "text-[hsl(var(--primary))] font-semibold" : "text-foreground")}>
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        {t.label}
                      </button>
                    );
                  })}
                  {user && (
                    <button onClick={() => { setMoreOpen(false); setShowPrefs(true); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left text-[13px] text-foreground hover:bg-[hsl(var(--surface-hover))] border-t border-border/20">
                      <Bell className="h-4 w-4 text-muted-foreground" />
                      Notifications
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </nav>
      </div>

      {showPrefs && (
        <Dialog open onOpenChange={o => { if (!o) setShowPrefs(false); }}>
          <DialogContent className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[85dvh] flex flex-col">
            <DialogTitle className="sr-only">Notification preferences</DialogTitle>
            <DialogDescription className="sr-only">Configure alerts</DialogDescription>
            <div className="px-5 py-4 border-b border-border/30 shrink-0 flex items-center gap-2">
              <Bell className="h-4 w-4 text-[hsl(var(--primary))]" />
              <span className="font-display text-[15px] text-foreground font-semibold">Notifications & Alerts</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <NotificationPreferences onClose={() => setShowPrefs(false)} />
            </div>
          </DialogContent>
        </Dialog>
      )}
      <LinkAccountDialog open={linkOpen} onOpenChange={setLinkOpen} onLinked={checkItems} />
    </div>
  );
};

export default Index;
