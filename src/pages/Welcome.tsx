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
    desc: "Overspent on travel this month? SentryFi finds your Travel savings account and suggests moving the exact amount over to cover it.",
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
    desc: "Connect any US bank, credit card, loan, or investment account securely. Read-only access. SentryFi can never move or touch your money.",
  },
];

const HOW = [
  { step: "01", title: "Connect your accounts", body: "Link your banks, cards, and investments in under 2 minutes through Plaid's secure flow. Read-only: we can see, never touch." },
  { step: "02", title: "Tag your accounts", body: "Tell SentryFi what each account is for: Spending, Emergency Buffer, Reserve, or Investment. Takes 30 seconds." },
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
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "hsl(var(--background))", color: "hsl(var(--foreground))", minHeight: "100vh" }}>

      {/* ── Nav ── */}
      <nav style={{ position: "sticky", top: 0, zIndex: 50, borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--background) / 0.92)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 20px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src="/logo.png" alt="SentryFi" style={{ height: 36, width: 36, borderRadius: 8 }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>SentryFi</div>
              <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: -2 }}>Personal finance intelligence</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={tryDemo} style={{ padding: "7px 14px", borderRadius: 20, border: "1px solid hsl(var(--border-strong))", background: "transparent", color: "hsl(var(--foreground))", fontSize: 13, cursor: "pointer" }}>
              Try demo
            </button>
            <Link to="/auth" style={{ padding: "7px 18px", borderRadius: 20, background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
              Sign in
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{ maxWidth: 780, margin: "0 auto", padding: "80px 24px 64px", textAlign: "center" }}>
        {/* Shield with glow */}
        <div className="shield-glow-wrap" style={{ width: 96, height: 96, margin: "0 auto 32px" }}>
          <img src="/logo.png" alt="SentryFi" className="shield-glow-img" style={{ width: 80, height: 80, borderRadius: 18 }} />
        </div>

        <div style={{ display: "inline-block", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", color: "hsl(var(--primary))", textTransform: "uppercase", marginBottom: 18, padding: "4px 12px", border: "1px solid hsl(var(--primary) / 0.35)", borderRadius: 20 }}>
          Personal Finance Intelligence
        </div>

        <h1 style={{ fontSize: "clamp(36px, 7vw, 62px)", fontWeight: 800, lineHeight: 1.08, letterSpacing: "-0.03em", margin: "0 0 20px" }}>
          Know exactly what{" "}
          <span style={{ color: "hsl(var(--primary))" }}>you can spend.</span>
        </h1>

        <p style={{ fontSize: "clamp(15px, 2.2vw, 18px)", color: "hsl(var(--muted-foreground))", lineHeight: 1.65, maxWidth: 560, margin: "0 auto 36px" }}>
          Your bank shows you a balance. SentryFi shows you what that balance{" "}
          <em>actually means</em>: after your emergency fund, reserved savings, and upcoming expenses are accounted for.
        </p>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
          <Link to="/auth" style={{ padding: "13px 28px", borderRadius: 12, background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", fontSize: 15, fontWeight: 700, textDecoration: "none", letterSpacing: "-0.01em" }}>
            Get started free
          </Link>
          <button onClick={tryDemo} style={{ padding: "13px 28px", borderRadius: 12, border: "1px solid hsl(var(--border-strong))", background: "hsl(var(--secondary) / 0.7)", color: "hsl(var(--foreground))", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            Try the demo
          </button>
          {isAndroid && (
            <a href={APK_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" style={{ padding: "13px 28px", borderRadius: 12, background: "hsl(var(--primary) / 0.1)", border: "1px solid hsl(var(--primary) / 0.3)", color: "hsl(var(--primary))", fontSize: 15, fontWeight: 600, textDecoration: "none" }}>
              ↓ Download Android app
            </a>
          )}
        </div>

        <p style={{ marginTop: 20, fontSize: 12, color: "hsl(var(--muted-foreground) / 0.7)" }}>Free to use · Bank-level security via Plaid · Read-only access</p>
      </section>

      {/* ── The problem ── */}
      <section style={{ background: "hsl(var(--surface) / 0.6)", borderTop: "1px solid hsl(var(--border))", borderBottom: "1px solid hsl(var(--border))" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "64px 24px", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 40 }}>
          <div>
            <div style={{ fontSize: 11, color: "hsl(var(--primary))", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14 }}>What banks show you</div>
            <div style={{ fontSize: 38, fontWeight: 800, color: "hsl(var(--primary-foreground))", letterSpacing: "-0.02em", marginBottom: 10 }}>$12,480</div>
            <p style={{ fontSize: 14, color: "hsl(var(--muted-foreground))", lineHeight: 1.6 }}>
              Your combined account balances, including your $8,000 emergency fund, $2,000 earmarked for next month's rent, and $500 in a travel savings account.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, color: "hsl(var(--muted-foreground) / 0.7)" }}>→</div>
          <div>
            <div style={{ fontSize: 11, color: "hsl(var(--primary))", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14 }}>What SentryFi shows you</div>
            <div style={{ fontSize: 38, fontWeight: 800, color: "hsl(var(--primary))", letterSpacing: "-0.02em", marginBottom: 10 }}>$1,980</div>
            <p style={{ fontSize: 14, color: "hsl(var(--muted-foreground))", lineHeight: 1.6 }}>
              Your True Available balance: what's actually in your Spending accounts, with buffers and reserves excluded on purpose. This is what you can actually use.
            </p>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "80px 24px" }}>
        <div style={{ textAlign: "center", marginBottom: 52 }}>
          <div style={{ fontSize: 11, color: "hsl(var(--primary))", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 14 }}>Everything in one place</div>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 800, letterSpacing: "-0.025em", margin: 0 }}>Built for the way you actually think about money</h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 20 }}>
          {FEATURES.map(f => {
            const Icon = f.icon;
            return (
              <div key={f.title} style={{ background: "hsl(var(--surface) / 0.8)", border: "1px solid hsl(var(--border))", borderRadius: 16, padding: "24px 24px 22px" }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center", background: "hsl(var(--primary)/0.12)", border: "1px solid hsl(var(--primary)/0.25)", marginBottom: 16 }}>
                  <Icon size={20} color="hsl(var(--primary))" strokeWidth={2} />
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px", letterSpacing: "-0.01em" }}>{f.title}</h3>
                <p style={{ fontSize: 13.5, color: "hsl(var(--muted-foreground))", lineHeight: 1.65, margin: 0 }}>{f.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── How it works ── */}
      <section style={{ background: "hsl(var(--surface) / 0.4)", borderTop: "1px solid hsl(var(--border))", borderBottom: "1px solid hsl(var(--border))" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "72px 24px" }}>
          <div style={{ textAlign: "center", marginBottom: 52 }}>
            <div style={{ fontSize: 11, color: "hsl(var(--primary))", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 14 }}>Getting started</div>
            <h2 style={{ fontSize: "clamp(26px, 3.5vw, 38px)", fontWeight: 800, letterSpacing: "-0.025em", margin: 0 }}>Up and running in under 5 minutes</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 32 }}>
            {HOW.map(h => (
              <div key={h.step}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "hsl(var(--primary))", letterSpacing: "0.06em", marginBottom: 16, fontVariantNumeric: "tabular-nums" }}>{h.step}</div>
                <h3 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 10px", letterSpacing: "-0.01em" }}>{h.title}</h3>
                <p style={{ fontSize: 14, color: "hsl(var(--muted-foreground))", lineHeight: 1.65, margin: 0 }}>{h.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Security ── */}
      <section style={{ maxWidth: 700, margin: "0 auto", padding: "72px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 20 }}>🔒</div>
        <h2 style={{ fontSize: "clamp(24px, 3.5vw, 36px)", fontWeight: 800, letterSpacing: "-0.025em", margin: "0 0 16px" }}>Your data stays yours</h2>
        <p style={{ fontSize: 15, color: "hsl(var(--muted-foreground))", lineHeight: 1.7, marginBottom: 36 }}>
          Bank connections are powered by Plaid, the same infrastructure used by Venmo, Robinhood, and thousands of financial apps. Access is strictly read-only: SentryFi can see your transactions and balances but cannot initiate transfers, payments, or any account changes. Your credentials never touch our servers.
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 28, flexWrap: "wrap" }}>
          {["Read-only access", "Encrypted in transit", "No credential storage", "Powered by Plaid"].map(t => (
            <div key={t} style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "hsl(var(--primary))" }}>✓</span> {t}
            </div>
          ))}
        </div>
      </section>

      {/* ── Download CTA ── */}
      <section style={{ background: "linear-gradient(135deg, hsl(var(--surface-elevated)) 0%, hsl(var(--background)) 100%)", borderTop: "1px solid hsl(var(--primary) / 0.2)" }}>
        <div style={{ maxWidth: 700, margin: "0 auto", padding: "72px 24px", textAlign: "center" }}>
          <div className="shield-glow-wrap" style={{ width: 72, height: 72, margin: "0 auto 28px" }}>
            <img src="/logo.png" alt="SentryFi" className="shield-glow-img" style={{ width: 60, height: 60, borderRadius: 14 }} />
          </div>
          <h2 style={{ fontSize: "clamp(26px, 4vw, 42px)", fontWeight: 800, letterSpacing: "-0.025em", margin: "0 0 16px" }}>
            Start knowing your real number.
          </h2>
          <p style={{ fontSize: 15, color: "hsl(var(--muted-foreground))", lineHeight: 1.65, marginBottom: 36 }}>
            Free to use. No credit card required. Connect your accounts in minutes.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
            <Link to="/auth" style={{ padding: "14px 32px", borderRadius: 12, background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", fontSize: 15, fontWeight: 700, textDecoration: "none" }}>
              Create a free account
            </Link>
            <button onClick={tryDemo} style={{ padding: "14px 32px", borderRadius: 12, border: "1px solid hsl(var(--border-strong))", background: "transparent", color: "hsl(var(--foreground))", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
              Try demo first
            </button>
          </div>
          {isAndroid && (
            <div style={{ marginTop: 24 }}>
              <a href={APK_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "hsl(var(--primary))", textDecoration: "none", borderBottom: "1px solid hsl(var(--primary) / 0.4)", paddingBottom: 2 }}>
                ↓ Download the Android app instead
              </a>
            </div>
          )}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ borderTop: "1px solid hsl(var(--border))", padding: "28px 24px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ fontSize: 13, color: "hsl(var(--muted-foreground) / 0.7)" }}>© 2026 Sentry Finance · v{APP_VERSION}</div>
          <div style={{ display: "flex", gap: 20 }}>
            <Link to="/auth" style={{ fontSize: 13, color: "hsl(var(--muted-foreground) / 0.7)", textDecoration: "none" }}>Sign in</Link>
            <Link to="/pricing" style={{ fontSize: 13, color: "hsl(var(--muted-foreground) / 0.7)", textDecoration: "none" }}>Pricing</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
