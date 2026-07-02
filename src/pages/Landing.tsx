import { useNavigate } from "react-router-dom";
import { ShieldCheck, TrendingUp, CreditCard, Zap, Lock, BarChart3, ArrowRight } from "lucide-react";

const FEATURES = [
  { icon: BarChart3,  title: "Full spending visibility",      body: "See exactly where every dollar goes across all accounts and cards, categorized automatically." },
  { icon: TrendingUp, title: "Net worth at a glance",         body: "Track checking, savings, investments, and debt in one unified dashboard." },
  { icon: Zap,        title: "Budget that actually works",    body: "Set limits by category, get warned before you overspend, and see trends over time." },
  { icon: CreditCard, title: "Card rewards intelligence",     body: "Know which card to use for every purchase to maximize rewards and track annual credits." },
  { icon: Lock,       title: "Read-only bank connection",     body: "SentryFi never touches your money. Plaid gives us read-only access, nothing else." },
  { icon: ShieldCheck, title: "Your data, private always",    body: "No selling, no ads. Your financial data is yours. We just help you understand it." },
];

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Nav */}
      <header className="w-full px-6 md:px-12 h-14 flex items-center justify-between border-b border-border/40 shrink-0">
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="SentryFi" className="h-8 w-8 drop-shadow-[0_2px_8px_hsl(var(--primary)/0.4)]" />
          <span className="font-display text-[15px] text-foreground tracking-tight">SentryFi</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/auth")}
            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
          >
            Sign in
          </button>
          <button
            onClick={() => navigate("/demo")}
            className="text-[13px] font-medium px-4 py-1.5 rounded-full bg-[hsl(var(--primary))] text-background hover:opacity-90 transition-opacity"
          >
            Try demo
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-6 py-20">
        <div className="relative mb-6">
          <div className="absolute inset-[-30%] rounded-full bg-[radial-gradient(circle,hsl(var(--primary)/0.2)_0%,transparent_70%)] blur-[24px]" />
          <img src="/logo.png" alt="SentryFi" className="relative h-20 w-20 drop-shadow-[0_4px_20px_hsl(var(--primary)/0.5)]" />
        </div>

        <h1 className="font-display text-4xl md:text-5xl lg:text-6xl text-foreground max-w-3xl leading-tight">
          Your money,<br />
          <span className="text-[hsl(var(--primary))]">finally in focus</span>
        </h1>
        <p className="mt-5 text-[15px] md:text-[17px] text-muted-foreground max-w-xl leading-relaxed">
          SentryFi connects all your accounts, cards, and investments in one secure place, so you always know where you stand.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center gap-3">
          <button
            onClick={() => navigate("/demo")}
            className="inline-flex items-center gap-2 px-7 py-3 rounded-full bg-[hsl(var(--primary))] text-background text-[14px] font-semibold hover:opacity-90 transition-opacity shadow-[0_4px_20px_hsl(var(--primary)/0.35)]"
          >
            Try it free, no account needed
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => navigate("/auth")}
            className="inline-flex items-center gap-2 px-7 py-3 rounded-full border border-border text-[14px] text-foreground hover:bg-secondary/50 transition-colors"
          >
            Create a free account
          </button>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">No credit card needed. Demo uses sample data only.</p>
      </section>

      {/* Features */}
      <section className="px-6 md:px-12 pb-20 max-w-5xl mx-auto w-full">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="surface-card p-5 space-y-2.5">
              <div className="h-9 w-9 rounded-lg bg-[hsl(var(--primary)/0.12)] grid place-items-center">
                <Icon className="h-[18px] w-[18px] text-[hsl(var(--primary))]" />
              </div>
              <div className="text-[13px] font-semibold text-foreground">{title}</div>
              <div className="text-[12px] text-muted-foreground leading-relaxed">{body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-border/40 px-6 py-12 text-center">
        <p className="text-[13px] text-muted-foreground mb-4">Ready to see your real finances?</p>
        <button
          onClick={() => navigate("/auth")}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-[hsl(var(--primary))] text-background text-[13px] font-medium hover:opacity-90 transition-opacity"
        >
          Get started free <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <p className="mt-6 text-[11px] text-muted-foreground">
          SentryFi · Personal Finance Intelligence ·{" "}
          <button onClick={() => navigate("/pricing")} className="underline hover:text-foreground transition-colors">Pricing</button>
        </p>
      </section>
    </div>
  );
}
