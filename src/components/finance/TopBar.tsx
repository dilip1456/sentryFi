import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, Search, Settings, Plus, Check, User, LogOut, CreditCard, ShieldCheck, Moon, Sun, HelpCircle, Trash2, Sparkles, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useDemo } from "@/contexts/DemoContext";
import { ProfileDialog } from "./ProfileDialog";

interface TopBarTab { k: string; label: string }
interface Props {
  active?: string;
  onChange?: (k: string) => void;
  tabs?: TopBarTab[];
  onAddAccount?: () => void;
  onSync?: () => void;
  syncing?: boolean;
}

interface Notif { id: string; title: string; body: string; time: string; unread: boolean; tone: "positive" | "warning" | "info" }

const initialNotifs: Notif[] = [
  { id: "n1", title: "HSA balance low",   body: "Funding needed before 6/3 auto-drafts.", time: "2h", unread: true,  tone: "warning" },
  { id: "n2", title: "Amex Gold statement", body: "$1,284.20 due 6/10. Autopay set.",     time: "5h", unread: true,  tone: "info" },
  { id: "n3", title: "Cashback unlocked",  body: "$42 from Whole Foods posted to Sapphire.", time: "1d", unread: true, tone: "positive" },
  { id: "n4", title: "Refi opportunity",   body: "30y rates dropped to 6.10% — review.",  time: "2d", unread: false, tone: "info" },
];

const toneClass: Record<Notif["tone"], string> = {
  positive: "bg-positive",
  warning:  "bg-warning",
  info:     "bg-info",
};

export const TopBar = ({ active, onChange, tabs, onAddAccount, onSync, syncing }: Props) => {
  const navItems: TopBarTab[] = tabs ?? [
    { k: "overall", label: "Overview" },
    { k: "moneymap", label: "Money Map" },
    { k: "monthly", label: "Monthly" },
    { k: "benefits", label: "Benefits" },
    { k: "giftcards", label: "Gift Cards" },
    { k: "spending", label: "Spending" },
    { k: "budget", label: "Budget" },
  ];

  const { user, profile, subscriber, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { demo, setDemo } = useDemo();
  const dark = theme === "dark";
  // Only show hardcoded notifs in demo mode; live mode starts empty
  const [notifs, setNotifs] = useState<Notif[]>(demo ? initialNotifs : []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [alertsEmail, setAlertsEmail] = useState(() => localStorage.getItem("sentryfi.alertsEmail") !== "false");
  const [alertsPush, setAlertsPush] = useState(() => localStorage.getItem("sentryfi.alertsPush") !== "false");

  // Sync notifs when demo mode toggles
  useEffect(() => {
    setNotifs(demo ? initialNotifs : []);
  }, [demo]);

  const handleAlertsEmail = (v: boolean) => {
    setAlertsEmail(v);
    localStorage.setItem("sentryfi.alertsEmail", String(v));
  };
  const handleAlertsPush = (v: boolean) => {
    setAlertsPush(v);
    localStorage.setItem("sentryfi.alertsPush", String(v));
  };

  const displayName = profile?.display_name ?? user?.email?.split("@")[0] ?? "You";
  const initials = displayName.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  const unread = notifs.filter((n) => n.unread).length;

  const markAll = () => setNotifs((n) => n.map((x) => ({ ...x, unread: false })));
  const clearOne = (id: string) => setNotifs((n) => n.filter((x) => x.id !== id));

  const SEARCHABLE = [
    ...navItems.map((t) => ({ kind: "Tab", label: t.label, k: t.k })),
    { kind: "Action", label: "Link a new account", k: "__link" },
  ];
  const matches = SEARCHABLE.filter((s) => !query || s.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border/50 shrink-0">
      {/* Mobile: 60px tall app bar with logo + title on left, sync + avatar on right */}
      <div className="md:hidden w-full px-4 h-[60px] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="relative h-10 w-10 shrink-0">
            <div className="absolute inset-[-20%] rounded-full bg-[radial-gradient(circle,hsl(var(--primary)/0.4)_0%,transparent_70%)] blur-[6px]" style={{ animation: "shield-pulse 3.4s ease-in-out infinite" }} />
            <img src="/logo.svg" alt="SentryFi" className="relative h-10 w-10 rounded-xl" />
          </div>
          <div>
            <div className="font-display text-[16px] tracking-tight text-foreground leading-tight">SentryFi</div>
            <div className="text-[11px] text-muted-foreground leading-tight">Personal Finance</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onSync && (
            <button
              onClick={onSync}
              disabled={syncing}
              className="h-10 w-10 grid place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50 no-min-h"
            >
              <RefreshCw className={cn("h-4.5 w-4.5", syncing && "animate-spin")} />
            </button>
          )}
          {/* Notifications */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="relative h-10 w-10 grid place-items-center rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors no-min-h">
                <Bell className="h-4.5 w-4.5" />
                {unread > 0 && (
                  <span className="absolute top-1.5 right-1.5 h-4 min-w-4 px-0.5 rounded-full bg-positive text-background text-[9px] font-semibold grid place-items-center">
                    {unread}
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-1rem)] surface-elevated">
              <div className="flex items-center justify-between px-2 py-1.5">
                <DropdownMenuLabel className="p-0 text-[12px]">Notifications</DropdownMenuLabel>
                <button onClick={markAll} className="text-[11px] text-muted-foreground hover:text-foreground">Mark all read</button>
              </div>
              <DropdownMenuSeparator />
              <div className="max-h-[360px] overflow-auto">
                {notifs.length === 0 && (
                  <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">All caught up.</div>
                )}
                {notifs.map((n) => (
                  <div key={n.id} className={cn("group flex items-start gap-2.5 px-2.5 py-3 hover:bg-surface-hover/50 transition-colors", n.unread && "bg-surface/30")}>
                    <span className={cn("mt-1.5 h-2 w-2 rounded-full shrink-0", toneClass[n.tone])} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-foreground font-medium truncate">{n.title}</div>
                      <div className="text-[12px] text-muted-foreground line-clamp-2 mt-0.5">{n.body}</div>
                      <div className="text-[11px] text-muted-foreground mt-1">{n.time} ago</div>
                    </div>
                  </div>
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Avatar/profile */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ml-0.5 h-9 w-9 rounded-full bg-gradient-to-br from-positive/40 to-info/40 border border-border-strong grid place-items-center text-[11px] font-semibold text-foreground overflow-hidden no-min-h">
                {profile?.avatar_url
                  ? <img src={profile.avatar_url} alt={displayName} className="h-full w-full object-cover" />
                  : initials}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-1rem)] surface-elevated">
              <DropdownMenuLabel>
                <div className="text-[13px] font-medium text-foreground">{displayName}</div>
                <div className="text-[11px] text-muted-foreground font-normal">{user?.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-[13px] py-3" onClick={() => setProfileOpen(true)}>
                <User className="h-4 w-4 mr-2.5" /> Profile & connected banks
              </DropdownMenuItem>
              <DropdownMenuItem className="text-[13px] py-3" onClick={() => { onAddAccount?.(); }}>
                <CreditCard className="h-4 w-4 mr-2.5" /> Link a bank account
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem checked={dark} onCheckedChange={(v) => { setTheme(v ? "dark" : "light"); }} className="text-[13px] py-3">
                {dark ? <Moon className="h-4 w-4 mr-2.5" /> : <Sun className="h-4 w-4 mr-2.5" />}
                Dark theme
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-[13px] py-3 text-negative focus:text-negative"
                onClick={async () => { await signOut(); toast.success("Signed out"); navigate("/auth"); }}>
                <LogOut className="h-4 w-4 mr-2.5" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Desktop: original full-featured header */}
      <div className="hidden md:flex w-full px-8 h-14 items-center justify-between gap-3">
        <div className="flex items-center gap-3 shrink-0">
          <img src="/logo.svg" alt="SentryFi" className="h-8 w-8 rounded-lg" />
          <div className="font-display text-base tracking-tight text-foreground">
            SentryFi <span className="text-muted-foreground font-normal">/ Finance</span>
          </div>
        </div>

        <nav className="flex items-center gap-0.5 text-sm flex-1 justify-center">
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
          {onSync && (
            <button onClick={onSync} disabled={syncing}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-border-strong text-muted-foreground hover:text-foreground transition-colors text-[12px] disabled:opacity-50">
              <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
              {syncing ? "Syncing…" : "Sync"}
            </button>
          )}
          {onAddAccount && (
            <button onClick={onAddAccount}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-gold text-[12px] font-medium hover:opacity-90 transition-opacity">
              <Plus className="h-3.5 w-3.5" /> Link account
            </button>
          )}

          {/* Search */}
          <button
            onClick={() => setSearchOpen(true)}
            className="h-9 w-9 grid place-items-center rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          >
            <Search className="h-4 w-4" />
          </button>

          {/* Notifications */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="relative h-9 w-9 grid place-items-center rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
                <Bell className="h-4 w-4" />
                {unread > 0 && (
                  <span className="absolute top-1.5 right-1.5 h-4 min-w-4 px-1 rounded-full bg-positive text-background text-[9px] font-semibold grid place-items-center">
                    {unread}
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-1rem)] surface-elevated">
              <div className="flex items-center justify-between px-2 py-1.5">
                <DropdownMenuLabel className="p-0 text-[12px]">Notifications</DropdownMenuLabel>
                <button onClick={markAll} className="text-[10.5px] text-muted-foreground hover:text-foreground">Mark all read</button>
              </div>
              <DropdownMenuSeparator />
              <div className="max-h-[360px] overflow-auto">
                {notifs.length === 0 && (
                  <div className="px-3 py-8 text-center text-[11.5px] text-muted-foreground">All caught up.</div>
                )}
                {notifs.map((n) => (
                  <div key={n.id} className={cn("group flex items-start gap-2.5 px-2.5 py-2 rounded-md hover:bg-surface-hover/50 transition-colors", n.unread && "bg-surface/30")}>
                    <span className={cn("mt-1 h-1.5 w-1.5 rounded-full shrink-0", toneClass[n.tone])} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] text-foreground truncate">{n.title}</div>
                      <div className="text-[10.5px] text-muted-foreground line-clamp-2">{n.body}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{n.time} ago</div>
                    </div>
                    <button onClick={() => clearOne(n.id)} className="opacity-0 group-hover:opacity-100 h-6 w-6 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-surface-hover transition">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Settings */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-9 w-9 grid place-items-center rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
                <Settings className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-1rem)] surface-elevated">
              <DropdownMenuLabel className="text-[12px]">Preferences</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={dark} onCheckedChange={(v) => { setTheme(v ? "dark" : "light"); toast(`${v ? "Dark" : "Light"} theme enabled`); }} className="text-[12px]">
                {dark ? <Moon className="h-3.5 w-3.5 mr-2" /> : <Sun className="h-3.5 w-3.5 mr-2" />}
                Dark theme
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={demo} onCheckedChange={(v) => { setDemo(!!v); toast(`Demo mode ${v ? "on — showing sample data" : "off — showing your real accounts"}`); }} className="text-[12px]">
                <Sparkles className="h-3.5 w-3.5 mr-2" />
                Demo mode
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[11px] text-muted-foreground font-normal">Alerts</DropdownMenuLabel>
              <DropdownMenuCheckboxItem checked={alertsEmail} onCheckedChange={(v) => handleAlertsEmail(!!v)} className="text-[12px]">Email alerts</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={alertsPush} onCheckedChange={(v) => handleAlertsPush(!!v)} className="text-[12px]">Push notifications</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-[12px]" onClick={() => toast("Help center coming soon")}>
                <HelpCircle className="h-3.5 w-3.5 mr-2" /> Help & support
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Profile */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ml-1 h-8 w-8 rounded-full bg-gradient-to-br from-positive/40 to-info/40 border border-border-strong grid place-items-center text-[11px] font-semibold text-foreground overflow-hidden">
                {profile?.avatar_url
                  ? <img src={profile.avatar_url} alt={displayName} className="h-full w-full object-cover" />
                  : initials}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 max-w-[calc(100vw-1rem)] surface-elevated">
              <div className="px-2 py-2">
                <div className="text-[12.5px] text-foreground font-medium truncate">{displayName}</div>
                <div className="text-[10.5px] text-muted-foreground truncate">{user?.email}</div>
                <div className="mt-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span className="px-1.5 py-0.5 rounded bg-surface border border-border/60 text-foreground">{subscriber?.plan ?? "free"}</span>
                  {isAdmin && <span className="px-1.5 py-0.5 rounded bg-info/15 text-info">admin</span>}
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-[12px]" onClick={() => setProfileOpen(true)}>
                <User className="h-3.5 w-3.5 mr-2" /> Edit profile
              </DropdownMenuItem>
              <DropdownMenuItem className="text-[12px]" onClick={() => navigate("/pricing")}>
                <CreditCard className="h-3.5 w-3.5 mr-2" /> Plans & billing
              </DropdownMenuItem>
              <DropdownMenuItem className="text-[12px]" onClick={() => { onAddAccount?.(); }}>
                <ShieldCheck className="h-3.5 w-3.5 mr-2" /> Linked accounts
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-[12px] text-negative focus:text-negative"
                onClick={async () => { await signOut(); toast.success("Signed out"); navigate("/auth"); }}>
                <LogOut className="h-3.5 w-3.5 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {/* End desktop header */}

      {/* Search dialog */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="max-w-md surface-elevated p-0 gap-0 overflow-hidden">
          <DialogTitle className="sr-only">Search SentryFi</DialogTitle>
          <DialogDescription className="sr-only">Jump to a tab or action.</DialogDescription>
          <div className="p-3 border-b border-border/40 flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Jump to a tab or action…"
              className="flex-1 bg-transparent outline-none text-[13px] text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-[320px] overflow-auto py-1">
            {matches.length === 0 && (
              <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">No matches.</div>
            )}
            {matches.map((m) => (
              <button
                key={`${m.kind}-${m.k}`}
                onClick={() => {
                  setSearchOpen(false);
                  setQuery("");
                  if (m.k === "__link") onAddAccount?.();
                  else onChange?.(m.k);
                }}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-surface-hover/50 text-left"
              >
                <span className="text-[12.5px] text-foreground">{m.label}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.kind}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </header>
  );
};
