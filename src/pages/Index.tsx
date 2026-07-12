import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@/contexts/ThemeContext";

// Android crash logger - shows errors visibly since Android WebView has no DevTools
if (typeof window !== "undefined") {
  const origError = console.error.bind(console);
  console.error = (...args: any[]) => {
    origError(...args);
    // Store last error for display
    try {
      const msg = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
      sessionStorage.setItem("__last_error__", msg.slice(0, 500));
    } catch {}
  };
}
import { LinkAccountDialog } from "@/components/finance/LinkAccountDialog";
import { AdminUsersSection } from "@/components/finance/AdminUsersSection";
import { GiftCardsSection } from "@/components/finance/GiftCardsSection";
import { EmptyDashboard } from "@/components/finance/EmptyDashboard";
import { LivePlaidDashboard } from "@/components/finance/LivePlaidDashboard";
import { ManualAccountDialog } from "@/components/finance/ManualAccountDialog";
import { NotificationInbox } from "@/components/NotificationInbox";
import { ProfileDialog } from "@/components/finance/ProfileDialog";
import { Onboarding } from "@/components/Onboarding";
import { useManualAccounts } from "@/hooks/useManualAccounts";
import { useUnreadAlerts } from "@/hooks/useUnreadAlerts";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useDemo } from "@/contexts/DemoContext";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { supabase } from "@/integrations/supabase/client";
import { isNative } from "@/lib/capacitor-oauth";
import { cn } from "@/lib/utils";
import { APK_DOWNLOAD_URL, APP_VERSION, BUILD_DATE } from "@/lib/constants";
import {
  LayoutDashboard, Sparkles, PieChart, Users, Loader2,
  RefreshCw, Plus, Gift, Wallet, Download, X, MoreHorizontal, Compass,
  LogOut, Settings, ChevronsUpDown, Bell, Sun, Moon,
  type LucideIcon,
} from "lucide-react";

type View = "overall" | "benefits" | "spending" | "budget" | "moneymap" | "giftcards" | "admin";

// "overall" is the landing view — reached via the logo, not a nav tab.
const BASE_TABS: { k: View; label: string; icon: LucideIcon }[] = [
  { k: "moneymap",  label: "Money Map",  icon: Compass         },
  { k: "spending",  label: "Spending",   icon: PieChart        },
  { k: "budget",    label: "Budget",     icon: Wallet          },
  { k: "giftcards", label: "Gift Cards", icon: Gift            },
  { k: "benefits",  label: "Benefits",   icon: Sparkles        },
];

const MOBILE_PRIMARY: View[] = ["moneymap", "spending", "budget"];

const Index = ({ guestDemo = false }: { guestDemo?: boolean }) => {
  // Persist the active view so a background auth-token refresh (which can remount
  // this tree when the window regains focus) doesn't bounce the user back to Home.
  const [view, setView] = useState<View>(() => {
    const saved = sessionStorage.getItem("sentryfi_view");
    return (saved as View) || "overall";
  });
  useEffect(() => { sessionStorage.setItem("sentryfi_view", view); }, [view]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncTrigger, setSyncTrigger] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [showInbox, setShowInbox] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [hasItems, setHasItems] = useState<boolean | null>(guestDemo ? false : null);
  const [manualOpen, setManualOpen] = useState(false);
  const [editingManual, setEditingManual] = useState<import("@/hooks/useManualAccounts").ManualAccount | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { isAdmin, user, signOut, profile } = useAuth();
  usePushNotifications(user?.id);
  const { demo, setDemo, onHasItemsResolved } = useDemo();
  const { theme, toggle: toggleTheme } = useTheme();
  const dark = theme === "dark";
  const { accounts: manualAccounts, save: saveManual, remove: removeManual } = useManualAccounts(guestDemo ? undefined : user?.id);
  const { unreadCount, refreshUnread } = useUnreadAlerts(guestDemo ? undefined : user?.id);
  const navigate = useNavigate();

  const effectiveDemo = demo || guestDemo;

  const TABS = isAdmin && !guestDemo
    ? [...BASE_TABS, { k: "admin" as View, label: "Admin", icon: Users }]
    : BASE_TABS;
  const mobilePrimary = TABS.filter(t => MOBILE_PRIMARY.includes(t.k));
  const mobileOverflow = TABS.filter(t => !MOBILE_PRIMARY.includes(t.k));



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

  // Show onboarding for brand-new users (no plaid items, no manual accounts, not seen before)
  useEffect(() => {
    if (guestDemo || !user || hasItems !== false) return;
    const key = `sentryfi_onboarded_${user.id}`;
    if (localStorage.getItem(key)) return;
    // Only show if account was created in last 10 minutes (fresh signup)
    const age = Date.now() - new Date(user.created_at ?? 0).getTime();
    if (age < 10 * 60 * 1000) setShowOnboarding(true);
  }, [hasItems, user, guestDemo]);

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

        {/* Logo — click to return to the landing view */}
        <button onClick={() => go("overall")}
          className="flex items-center gap-3 px-4 py-5 border-b border-[hsl(var(--sidebar-border))] w-full text-left hover:bg-[hsl(var(--surface-hover)/0.4)] transition-colors">
          <div className="h-8 w-8 rounded-lg overflow-hidden flex-shrink-0 bg-[hsl(var(--primary)/0.1)] grid place-items-center">
            <img src="/logo.png" alt="SentryFi" className="h-6 w-6 object-contain" />
          </div>
          <div>
            <div className="text-[13.5px] font-semibold text-[hsl(var(--sidebar-accent-foreground))] leading-tight">SentryFi</div>
            {guestDemo && <div className="text-[10px] text-[hsl(var(--warning))] font-medium">Demo mode</div>}
          </div>
        </button>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5 scrollbar-none">
          <div className="section-label">Overview</div>
          <button onClick={() => go("overall")} className={cn("nav-item w-full text-left", view === "overall" && "active")}>
            <LayoutDashboard className="h-4 w-4 flex-shrink-0" />
            <span>Home</span>
          </button>
          {TABS.filter(t => ["moneymap"].includes(t.k)).map(t => <NavItem key={t.k} tab={t} />)}

          <div className="section-label">Money</div>
          {TABS.filter(t => ["spending","budget"].includes(t.k)).map(t => <NavItem key={t.k} tab={t} />)}

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
          {!effectiveDemo && (
            <button onClick={() => setManualOpen(true)} className="nav-item w-full">
              <Plus className="h-4 w-4" />
              Add manually
            </button>
          )}
          {user && (
            <button onClick={() => setShowInbox(true)} className="nav-item w-full">
              <Bell className="h-4 w-4" />
              Notifications
            </button>
          )}
          {user && !guestDemo && (
            <button onClick={() => setShowProfile(true)} className="nav-item w-full">
              <Settings className="h-4 w-4" />
              Profile &amp; settings
            </button>
          )}
          <button onClick={toggleTheme} className="nav-item w-full">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {dark ? "Light mode" : "Dark mode"}
          </button>
          {demo && !guestDemo && (
            <button onClick={() => setDemo(false)} className="nav-item w-full text-warning">
              <Sparkles className="h-4 w-4" />
              Exit demo
            </button>
          )}
          {guestDemo && (
            <button onClick={() => navigate("/auth")} className="nav-item w-full">
              <LogOut className="h-4 w-4" />
              Create free account
            </button>
          )}
          {user && !guestDemo && (
            <button onClick={() => signOut().then(() => navigate("/welcome"))} className="nav-item w-full">
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          )}
          <button onClick={toggleTheme} className="nav-item w-full">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <div className="px-3 pt-2 pb-1 text-[10px] text-muted-foreground/30 select-none">
            v{APP_VERSION} · {BUILD_DATE}
          </div>
        </div>
      </aside>

      {/* ── Content area ────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">

        {/* Mobile header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-background/95 backdrop-blur shrink-0">
          <button onClick={() => go("overall")} className="flex items-center gap-2.5">
            <img src="/logo.png" alt="" className="h-7 w-7 object-contain" />
            <span className="text-[14px] font-semibold text-foreground">
              {effectiveDemo ? "Demo" : (view === "overall" ? "SentryFi" : (TABS.find(t => t.k === view)?.label ?? "SentryFi"))}
            </span>
          </button>
          <div className="flex items-center gap-1.5">
            {/* Not logged in */}
            {!user && !effectiveDemo && (
              <button onClick={() => navigate("/auth")} className="h-8 px-3 rounded-full bg-gold text-[12px] font-semibold">
                Sign in
              </button>
            )}
            {/* Notifications */}
            {user && (
              <button onClick={() => setShowInbox(true)}
                className="relative h-8 w-8 rounded-full border border-border grid place-items-center text-muted-foreground">
                <Bell className="h-3.5 w-3.5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-negative text-white text-[9px] font-bold grid place-items-center leading-none">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
            )}
            {/* Sync */}
            {!effectiveDemo && hasItems === true && (
              <button onClick={() => setSyncTrigger(t => t + 1)} disabled={syncing}
                className="h-8 w-8 rounded-full border border-border grid place-items-center text-muted-foreground">
                <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
            </button>
            )}
            {/* Theme toggle — always visible on mobile */}
            <button onClick={toggleTheme}
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              className="h-8 w-8 rounded-full border border-border grid place-items-center text-muted-foreground">
              {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
            {/* Settings gear — always visible on mobile */}
            <div className="relative">
              <button onClick={() => setHeaderMenuOpen(o => !o)}
                className="h-8 w-8 rounded-full border border-border grid place-items-center text-muted-foreground">
                <Settings className="h-3.5 w-3.5" />
              </button>
              {headerMenuOpen && createPortal(
                <>
                  <div className="fixed inset-0 z-[9998]" onClick={() => setHeaderMenuOpen(false)} />
                  <div className="fixed top-14 right-2 z-[9999] w-56 rounded-xl border border-white/10 shadow-2xl overflow-hidden"
                    style={{ background: "hsl(var(--sidebar-background))" }}>
                    {!user && (
                      <button onClick={() => { setHeaderMenuOpen(false); navigate("/auth"); }}
                        className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-[13.5px] font-semibold text-[hsl(var(--primary))] hover:bg-white/5">
                        <LogOut className="h-4 w-4" /> Sign in / Create account
                      </button>
                    )}
                    {user && !effectiveDemo && (
                      <button onClick={() => { setHeaderMenuOpen(false); setLinkOpen(true); }}
                        className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-[13px] text-white hover:bg-white/5">
                        <Plus className="h-4 w-4 opacity-60" /> Link account
                      </button>
                    )}
                    {user && (
                      <button onClick={() => { setHeaderMenuOpen(false); setShowInbox(true); }}
                        className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-[13px] text-white hover:bg-white/5">
                        <Bell className="h-4 w-4 opacity-60" /> Notifications
                      </button>
                    )}
                    {user && !guestDemo && (
                      <button onClick={() => { setHeaderMenuOpen(false); setShowProfile(true); }}
                        className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-[13px] text-white hover:bg-white/5">
                        <Settings className="h-4 w-4 opacity-60" /> Settings
                      </button>
                    )}
                    <button onClick={toggleTheme}
                      className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-[13px] text-white hover:bg-white/5 border-t border-white/10">
                      {theme === "dark" ? <Sun className="h-4 w-4 opacity-60" /> : <Moon className="h-4 w-4 opacity-60" />}
                      {theme === "dark" ? "Light mode" : "Dark mode"}
                    </button>
                    <a href={APK_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer"
                      className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-[13px] text-white hover:bg-white/5 border-t border-white/10"
                      onClick={() => setHeaderMenuOpen(false)}>
                      <Download className="h-4 w-4 opacity-60" /> Download Android app
                    </a>
                    {demo && !guestDemo && (
                      <button onClick={() => { setHeaderMenuOpen(false); setDemo(false); }}
                        className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-[13px] text-yellow-400 hover:bg-white/5 border-t border-white/10">
                        <Sparkles className="h-4 w-4" /> Exit demo
                      </button>
                    )}
                    {guestDemo && (
                      <button onClick={() => { setHeaderMenuOpen(false); navigate("/auth"); }}
                        className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-[13px] text-[hsl(var(--primary))] font-semibold hover:bg-white/5 border-t border-white/10">
                        <LogOut className="h-4 w-4" /> Create free account
                      </button>
                    )}
                    {user && !guestDemo && (
                      <button onClick={() => { setHeaderMenuOpen(false); signOut().then(() => navigate("/welcome")); }}
                        className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-[13px] text-red-400 font-medium hover:bg-white/5 border-t border-white/10">
                        <LogOut className="h-4 w-4" /> Sign out
                      </button>
                    )}
                  </div>
                </>,
                document.body
              )}
            </div>
          </div>
        </header>

        {/* APK banner — always show on mobile web, ignore dismiss state */}
        {!isNative() && (
          <div className="md:hidden shrink-0 bg-[hsl(var(--primary)/0.12)] border-b border-[hsl(var(--primary)/0.25)] px-4 py-3 flex items-center gap-3">
            <Download className="h-4 w-4 text-[hsl(var(--primary))] shrink-0" />
            <span className="text-[12.5px] text-foreground flex-1 font-medium">Get the SentryFi Android app</span>
            <a href={APK_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer"
              className="shrink-0 text-[12px] font-bold px-3 py-1.5 rounded-full bg-gold">
              Download
            </a>
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
                  {view === "overall" ? (profile?.display_name ? `Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${profile.display_name.split(" ")[0]}` : "Dashboard") : (TABS.find(t => t.k === view)?.label ?? "Dashboard")}
                </h1>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                </p>
              </div>

              {/* Top button bar */}
              <div className="flex items-center gap-2">
                {!effectiveDemo && guestDemo && (
                  <button onClick={() => navigate("/auth")}
                    className="bg-gold h-9 px-4 rounded-lg text-[13px] mr-1">
                    Create free account
                  </button>
                )}
                {!effectiveDemo && hasItems === true && (
                  <button onClick={() => setSyncTrigger(t => t + 1)} disabled={syncing}
                    title="Sync data"
                    className="h-9 w-9 rounded-full border border-border grid place-items-center text-muted-foreground hover:text-foreground hover:border-border-strong transition-colors disabled:opacity-50">
                    <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
                  </button>
                )}
                {user && (
                  <button onClick={() => setShowInbox(true)}
                    title="Notifications"
                    className="relative h-9 w-9 rounded-full border border-border grid place-items-center text-muted-foreground hover:text-foreground hover:border-border-strong transition-colors">
                    <Bell className="h-4 w-4" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-negative text-white text-[9px] font-bold grid place-items-center leading-none">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </button>
                )}
                {user && !guestDemo && (
                  <button onClick={() => signOut().then(() => navigate("/welcome"))}
                    title="Sign out"
                    className="h-9 w-9 rounded-full border border-border grid place-items-center text-muted-foreground hover:text-negative hover:border-negative/40 transition-colors">
                    <LogOut className="h-4 w-4" />
                  </button>
                )}
                {user && !guestDemo && (
                  <button onClick={() => setShowProfile(true)} title="Profile & settings"
                    className="h-9 w-9 rounded-full overflow-hidden border border-border hover:border-[hsl(var(--primary)/0.5)] transition-colors grid place-items-center bg-[hsl(var(--primary)/0.12)]">
                    {profile?.avatar_url
                      ? <img src={profile.avatar_url} alt="Profile" className="h-full w-full object-cover" />
                      : <span className="text-[13px] font-semibold text-[hsl(var(--primary))]">{(profile?.display_name ?? user.email ?? "?").trim().charAt(0).toUpperCase()}</span>}
                  </button>
                )}
              </div>
            </div>

            {/* Loading state */}
            {!effectiveDemo && hasItems === null && (
              <div className="min-h-[50vh] grid place-items-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {showEmpty && <EmptyDashboard onLink={() => setLinkOpen(true)} onAddManual={!guestDemo ? () => setManualOpen(true) : undefined} />}

            {showLive && (
              <LivePlaidDashboard
                hasItems
                onAddAccount={() => setLinkOpen(true)}
                view={view}
                syncTrigger={syncTrigger}
                onSyncingChange={setSyncing}
                selectedCategory={selectedCategory}
                onCategorySelect={handleCategorySelect}
                manualAccounts={manualAccounts}
                onEditManual={acct => { setEditingManual(acct); setManualOpen(true); }}
                onDeleteManual={removeManual}
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
              Sentry Finance v{APP_VERSION} · {effectiveDemo ? "Demo data" : "Live data"}
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
                <div className="fixed bottom-16 right-2 z-[101] w-48 rounded-xl border border-white/10 shadow-2xl overflow-hidden"
                  style={{ background: "hsl(var(--sidebar-background))" }}>
                  {mobileOverflow.map(t => {
                    const Icon = t.icon;
                    return (
                      <button key={t.k} onClick={() => go(t.k)}
                        className={cn("w-full flex items-center gap-3 px-4 py-3 text-left text-[13px] hover:bg-white/5 transition-colors",
                          view === t.k ? "text-[hsl(var(--primary))] font-semibold" : "text-white")}>
                        <Icon className="h-4 w-4 opacity-60" />
                        {t.label}
                      </button>
                    );
                  })}
                  {user && (
                    <button onClick={() => { setMoreOpen(false); setShowInbox(true); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left text-[13px] text-white hover:bg-white/5 border-t border-white/10">
                      <Bell className="h-4 w-4 opacity-60" />
                      Notifications
                    </button>
                  )}
                  <button onClick={() => { setMoreOpen(false); toggleTheme(); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-[13px] text-white hover:bg-white/5 border-t border-white/10">
                    {theme === "dark" ? <Sun className="h-4 w-4 opacity-60" /> : <Moon className="h-4 w-4 opacity-60" />}
                    {theme === "dark" ? "Light mode" : "Dark mode"}
                  </button>
                </div>
              </>
            )}
          </div>
        </nav>
      </div>

      {showInbox && (
        <Dialog open onOpenChange={o => { if (!o) { setShowInbox(false); refreshUnread(); } }}>
          <DialogContent className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[85dvh] flex flex-col">
            <DialogTitle className="sr-only">Notifications</DialogTitle>
            <DialogDescription className="sr-only">Recent alerts and activity</DialogDescription>
            <div className="px-5 py-4 border-b border-border/30 shrink-0 flex items-center gap-2">
              <Bell className="h-4 w-4 text-[hsl(var(--primary))]" />
              <span className="font-display text-[15px] text-foreground font-semibold">Notifications</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <NotificationInbox onClose={() => setShowInbox(false)} onOpenSettings={() => { setShowInbox(false); setShowProfile(true); }} />
            </div>
          </DialogContent>
        </Dialog>
      )}
      <LinkAccountDialog open={linkOpen} onOpenChange={setLinkOpen} onLinked={checkItems} />
      <ProfileDialog open={showProfile} onOpenChange={setShowProfile} />

      <ManualAccountDialog
        open={manualOpen}
        onOpenChange={o => { setManualOpen(o); if (!o) setEditingManual(null); }}
        onSave={async (input, id) => { const ok = await saveManual(input, id); if (ok) checkItems(); return ok; }}
        editing={editingManual}
      />

      {showOnboarding && user && (
        <Onboarding
          displayName={(user as { user_metadata?: { full_name?: string } }).user_metadata?.full_name ?? null}
          onLinkPlaid={() => { setShowOnboarding(false); setLinkOpen(true); localStorage.setItem(`sentryfi_onboarded_${user.id}`, "1"); }}
          onSaveManual={saveManual}
          onFinish={() => { setShowOnboarding(false); localStorage.setItem(`sentryfi_onboarded_${user.id}`, "1"); }}
        />
      )}
    </div>
  );
};

export default Index;
