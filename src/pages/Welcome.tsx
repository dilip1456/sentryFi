import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";
import { isNative } from "@/lib/capacitor-oauth";
import { APK_DOWNLOAD_URL, APP_VERSION } from "@/lib/constants";
import {
  Compass, Wallet, Sparkles, CalendarClock, PieChart, Search, Gift, Landmark,
  type LucideIcon,
} from "lucide-react";

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: Compass,
    title: "Money Map",
    desc: "Tag every account with a purpose: Spending, Emergency Buffer, Reserve, Investment. Your emergency fund never bleeds into your spendable balance.",
  },
  {
    icon: Wallet,
    title: "True Available Funds",
    desc: "See exactly what you can actually spend: income minus planned expenses minus committed savings. Not what your bank says your balance is.",
  },
  {
    icon: Sparkles,
    title: "Smart Suggestions",
    desc: "Overspent on travel this month? Sentry Finance finds your Travel savings account and suggests moving the exact amount over to cover it.",
  },
  {
    icon: CalendarClock,
    title: "Upcoming Expense Forecasting",
    desc: "Detects recurring bills and charges from your history and warns you before they hit, so you're never caught off guard by a predictable expense.",
  },
  {
    icon: PieChart,
    title: "Budget by Category",
    desc: "Set monthly limits for any spending category. Track real-time progress with a clear over/under view: all categories on the left, budgeted on the right.",
  },
  {
    icon: Search,
    title: "Transaction Lookup",
    desc: "Search and filter every transaction by category, merchant, date, or amount. Sort by largest or latest. Everything your bank app should have but doesn't.",
  },
  {
    icon: Gift,
    title: "Gift Card Tracker",
    desc: "Track balances across every gift card you own, with brand logos, expiry alerts, card numbers and PINs stored securely. Never forget about a card again.",
  },
  {
    icon: Landmark,
    title: "Real Bank Data via Plaid",
    desc: "Connect any US bank, credit card, loan, or investment account securely. Read-only access. Sentry Finance can never move or touch your money.",
  },
];

const HOW = [
  { step: "01", title: "Connect your accounts", body: "Link your banks, cards, and investments in under 2 minutes through Plaid's secure flow. Read-only: we can see, never touch." },
  { step: "02", title: "Tag your accounts", body: "Tell Sentry Finance what each account is for: Spending, Emergency Buffer, Reserve, or Investment. Takes 30 seconds." },
  { step: "03", title: "Know your real number", body: "Your True Available balance is calculated instantly and updated every time you sync." },
];

export default function Welcome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isAndroid, setIsAndroid] = useState(false);

  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    setIsAndroid(/Android/i.test(navigator.userAgent) && !isNative());
  }, []);

  const tryDemo = () => {
    navigate("/demo");
  };

  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 border-b border-border bg-[hsl(var(--background)/0.92)] [backdrop-filter:blur(12px)] [-webkit-backdrop-filter:blur(12px)]">
        <div className="max-w-[1100px] mx-auto px-5 h-[60px] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Sentry Finance" className="h-9 w-9 rounded-lg" />
            <div>
              <div className="font-bold text-[15px] tracking-[-0.01em]">Sentry Finance</div>
              <div className="text-[10px] text-muted-foreground -mt-0.5">Personal finance intelligence</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <button onClick={tryDemo} className="px-3.5 py-[7px] rounded-full border border-border-strong bg-transparent text-foreground text-[13px] cursor-pointer">
              Try demo
            </button>
            <Link to="/auth" className="px-[18px] py-[7px] rounded-full bg-primary text-primary-foreground text-[13px] font-semibold no-underline">
              Sign in
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="max-w-[780px] mx-auto px-6 pt-20 pb-16 text-center">
        {/* Shield with glow */}
        <div className="shield-glow-wrap h-24 w-24 mx-auto mb-8">
          <img src="/logo.png" alt="Sentry Finance" className="shield-glow-img h-20 w-20 rounded-[18px]" />
        </div>

        <div className="inline-block text-[11px] font-semibold tracking-[0.12em] text-primary uppercase mb-[18px] px-3 py-1 border border-[hsl(var(--primary)/0.35)] rounded-full">
          Personal Finance Intelligence
        </div>

        <h1 className="text-[clamp(36px,7vw,62px)] font-extrabold leading-[1.08] tracking-[-0.03em] mb-5">
          Know exactly what{" "}
          <span className="text-primary">you can spend.</span>
        </h1>

        <p className="text-[clamp(15px,2.2vw,18px)] text-muted-foreground leading-[1.65] max-w-[560px] mx-auto mb-9">
          Your bank shows you a balance. Sentry Finance shows you what that balance{" "}
          <em>actually means</em>: after your emergency fund, reserved savings, and upcoming expenses are accounted for.
        </p>

        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link to="/auth" className="px-7 py-[13px] rounded-xl bg-primary text-primary-foreground text-[15px] font-bold no-underline tracking-[-0.01em]">
            Get started free
          </Link>
          <button onClick={tryDemo} className="px-7 py-[13px] rounded-xl border border-border-strong bg-[hsl(var(--secondary)/0.7)] text-foreground text-[15px] font-semibold cursor-pointer">
            Try the demo
          </button>
          {isAndroid && (
            <a href={APK_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className="px-7 py-[13px] rounded-xl bg-[hsl(var(--primary)/0.1)] border border-[hsl(var(--primary)/0.3)] text-primary text-[15px] font-semibold no-underline">
              ↓ Download Android app
            </a>
          )}
        </div>

        <p className="mt-5 text-xs text-[hsl(var(--muted-foreground)/0.7)]">Free to use · Bank-level security via Plaid · Read-only access</p>
      </section>

      {/* ── The problem ── */}
      <section className="bg-[hsl(var(--surface)/0.6)] border-y border-border">
        <div className="max-w-[1000px] mx-auto px-6 py-16 grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-10">
          <div>
            <div className="text-[11px] text-primary font-semibold tracking-[0.1em] uppercase mb-3.5">What banks show you</div>
            <div className="text-[38px] font-extrabold text-foreground tracking-[-0.02em] mb-2.5">$12,480</div>
            <p className="text-sm text-muted-foreground leading-[1.6]">
              Your combined account balances, including your $8,000 emergency fund, $2,000 earmarked for next month's rent, and $500 in a travel savings account.
            </p>
          </div>
          <div className="flex items-center justify-center text-[32px] text-[hsl(var(--muted-foreground)/0.7)]">→</div>
          <div>
            <div className="text-[11px] text-primary font-semibold tracking-[0.1em] uppercase mb-3.5">What Sentry Finance shows you</div>
            <div className="text-[38px] font-extrabold text-primary tracking-[-0.02em] mb-2.5">$1,980</div>
            <p className="text-sm text-muted-foreground leading-[1.6]">
              Your True Available balance: what's actually in your Spending accounts, with buffers and reserves excluded on purpose. This is what you can actually use.
            </p>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="max-w-[1100px] mx-auto px-6 py-20">
        <div className="text-center mb-[52px]">
          <div className="text-[11px] text-primary font-semibold tracking-[0.12em] uppercase mb-3.5">Everything in one place</div>
          <h2 className="text-[clamp(28px,4vw,42px)] font-extrabold tracking-[-0.025em]">Built for the way you actually think about money</h2>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5">
          {FEATURES.map(f => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="bg-[hsl(var(--surface)/0.8)] border border-border rounded-2xl px-6 pt-6 pb-[22px]">
                <div className="h-11 w-11 rounded-xl grid place-items-center bg-[hsl(var(--primary)/0.12)] border border-[hsl(var(--primary)/0.25)] mb-4">
                  <Icon size={20} className="text-primary" strokeWidth={2} />
                </div>
                <h3 className="text-base font-bold mb-2 tracking-[-0.01em]">{f.title}</h3>
                <p className="text-[13.5px] text-muted-foreground leading-[1.65]">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="bg-[hsl(var(--surface)/0.4)] border-y border-border">
        <div className="max-w-[900px] mx-auto px-6 py-[72px]">
          <div className="text-center mb-[52px]">
            <div className="text-[11px] text-primary font-semibold tracking-[0.12em] uppercase mb-3.5">Getting started</div>
            <h2 className="text-[clamp(26px,3.5vw,38px)] font-extrabold tracking-[-0.025em]">Up and running in under 5 minutes</h2>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-8">
            {HOW.map(h => (
              <div key={h.step}>
                <div className="text-xs font-extrabold text-primary tracking-[0.06em] mb-4 [font-variant-numeric:tabular-nums]">{h.step}</div>
                <h3 className="text-[17px] font-bold mb-2.5 tracking-[-0.01em]">{h.title}</h3>
                <p className="text-sm text-muted-foreground leading-[1.65]">{h.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Security ── */}
      <section className="max-w-[700px] mx-auto px-6 py-[72px] text-center">
        <div className="text-4xl mb-5">🔒</div>
        <h2 className="text-[clamp(24px,3.5vw,36px)] font-extrabold tracking-[-0.025em] mb-4">Your data stays yours</h2>
        <p className="text-[15px] text-muted-foreground leading-[1.7] mb-9">
          Bank connections are powered by Plaid, the same infrastructure used by Venmo, Robinhood, and thousands of financial apps. Access is strictly read-only: Sentry Finance can see your transactions and balances but cannot initiate transfers, payments, or any account changes. Your credentials never touch our servers.
        </p>
        <div className="flex justify-center gap-7 flex-wrap">
          {["Read-only access", "Encrypted in transit", "No credential storage", "Powered by Plaid"].map(t => (
            <div key={t} className="text-[13px] text-muted-foreground flex items-center gap-1.5">
              <span className="text-primary">✓</span> {t}
            </div>
          ))}
        </div>
      </section>

      {/* ── Download CTA ── */}
      <section className="bg-gradient-to-br from-[hsl(var(--surface-elevated))] to-background border-t border-[hsl(var(--primary)/0.2)]">
        <div className="max-w-[700px] mx-auto px-6 py-[72px] text-center">
          <div className="shield-glow-wrap h-[72px] w-[72px] mx-auto mb-7">
            <img src="/logo.png" alt="Sentry Finance" className="shield-glow-img h-[60px] w-[60px] rounded-[14px]" />
          </div>
          <h2 className="text-[clamp(26px,4vw,42px)] font-extrabold tracking-[-0.025em] mb-4">
            Start knowing your real number.
          </h2>
          <p className="text-[15px] text-muted-foreground leading-[1.65] mb-9">
            Free to use. No credit card required. Connect your accounts in minutes.
          </p>
          <div className="flex justify-center gap-3 flex-wrap">
            <Link to="/auth" className="px-8 py-3.5 rounded-xl bg-primary text-primary-foreground text-[15px] font-bold no-underline">
              Create a free account
            </Link>
            <button onClick={tryDemo} className="px-8 py-3.5 rounded-xl border border-border-strong bg-transparent text-foreground text-[15px] font-semibold cursor-pointer">
              Try demo first
            </button>
          </div>
          {isAndroid && (
            <div className="mt-6">
              <a href={APK_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className="text-[13px] text-primary no-underline border-b border-[hsl(var(--primary)/0.4)] pb-0.5">
                ↓ Download the Android app instead
              </a>
            </div>
          )}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border px-6 py-7">
        <div className="max-w-[1100px] mx-auto flex items-center justify-between flex-wrap gap-3">
          <div className="text-[13px] text-[hsl(var(--muted-foreground)/0.7)]">© 2026 Sentry Finance · v{APP_VERSION}</div>
          <div className="flex gap-5">
            <Link to="/auth" className="text-[13px] text-[hsl(var(--muted-foreground)/0.7)] no-underline hover:text-foreground transition-colors">Sign in</Link>
            <Link to="/pricing" className="text-[13px] text-[hsl(var(--muted-foreground)/0.7)] no-underline hover:text-foreground transition-colors">Pricing</Link>
            <Link to="/terms" className="text-[13px] text-[hsl(var(--muted-foreground)/0.7)] no-underline hover:text-foreground transition-colors">Terms</Link>
            <Link to="/privacy" className="text-[13px] text-[hsl(var(--muted-foreground)/0.7)] no-underline hover:text-foreground transition-colors">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
