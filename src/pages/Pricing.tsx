import { Link, useNavigate } from "react-router-dom";
import { Check, ArrowLeft } from "lucide-react";
import { PLANS } from "@/lib/plans";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const Pricing = () => {
  const { user, subscriber } = useAuth();
  const navigate = useNavigate();

  const choose = (planKey: string) => {
    if (!user) { navigate("/auth"); return; }
    if (planKey === "free") {
      toast("You're already on a plan. Downgrades take effect at period end.");
      return;
    }
    // Paid plans aren't live yet — the buttons for them are disabled below so this
    // shouldn't be reachable, but guard anyway rather than pretend to start checkout.
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/70 border-b border-border/60">
        <div className="max-w-[1100px] mx-auto px-4 md:px-8 h-14 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
          </Link>
          <div className="font-display text-sm text-foreground">Sentry Finance / Plans</div>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-4 md:px-8 py-10 md:py-16">
        <div className="text-center max-w-xl mx-auto mb-10">
          <div className="text-[12.5px] uppercase tracking-[0.2em] text-muted-foreground mb-3">Pricing</div>
          <h1 className="font-display text-3xl md:text-4xl text-foreground">Pick the plan that fits your money.</h1>
          <p className="mt-3 text-[14px] text-muted-foreground">Start free. Upgrade when you want richer insights. Cancel any time.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLANS.map((p) => {
            const isCurrent = subscriber?.plan === p.key;
            const isPaidAndUnavailable = p.price > 0; // Stripe checkout isn't wired up yet — don't pretend it is.
            return (
              <div
                key={p.key}
                className={cn(
                  "relative rounded-2xl border p-6 flex flex-col",
                  p.highlight
                    ? "border-foreground/30 bg-gradient-to-b from-surface to-background shadow-xl"
                    : "border-border/60 bg-surface/40",
                  isPaidAndUnavailable && "opacity-80"
                )}
              >
                {p.highlight && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-foreground text-background text-[12px] font-medium tracking-wide">
                    MOST POPULAR
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[13px] uppercase tracking-wider text-muted-foreground">{p.name}</div>
                  {isPaidAndUnavailable && (
                    <span className="px-2 py-0.5 rounded-full bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))] text-[11px] font-medium tracking-wide">
                      Coming soon
                    </span>
                  )}
                </div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="font-display text-4xl text-foreground">${p.price}</span>
                  <span className="text-[13px] text-muted-foreground">/mo</span>
                </div>
                <div className="mt-1 text-[13.5px] text-muted-foreground">{p.blurb}</div>

                <ul className="mt-5 space-y-2 flex-1">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[13.5px] text-foreground">
                      <Check className="h-3.5 w-3.5 text-positive mt-0.5 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <button
                  disabled={isCurrent || isPaidAndUnavailable}
                  onClick={() => choose(p.key)}
                  title={isPaidAndUnavailable ? "Paid plans aren't available yet" : undefined}
                  className={cn(
                    "mt-6 w-full py-2.5 rounded-md text-[14px] font-medium inline-flex items-center justify-center gap-2 transition",
                    isCurrent || isPaidAndUnavailable
                      ? "bg-surface text-muted-foreground border border-border cursor-not-allowed"
                      : p.highlight
                        ? "bg-foreground text-background hover:opacity-90"
                        : "border border-border bg-transparent text-foreground hover:bg-surface"
                  )}
                >
                  {isCurrent ? "Current plan" : isPaidAndUnavailable ? "Coming soon" : "Get started"}
                </button>
              </div>
            );
          })}
        </div>

        <p className="mt-10 text-center text-[12.5px] text-muted-foreground">
          Prices in USD. Taxes calculated at checkout where applicable.
        </p>
      </main>
    </div>
  );
};

export default Pricing;
