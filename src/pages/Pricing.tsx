import { Link, useNavigate } from "react-router-dom";
import { Check, ArrowLeft, Loader2 } from "lucide-react";
import { PLANS } from "@/lib/plans";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useState } from "react";

const Pricing = () => {
  const { user, subscriber } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const choose = async (planKey: string) => {
    if (!user) { navigate("/auth"); return; }
    if (planKey === "free") {
      toast("You're already on a plan — downgrades take effect at period end.");
      return;
    }
    setBusy(planKey);
    // Stripe checkout hook — once Stripe is enabled, this calls the create-checkout edge function.
    try {
      toast.info("Checkout coming online — Stripe configuration in progress.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/70 border-b border-border/60">
        <div className="max-w-[1100px] mx-auto px-4 md:px-8 h-14 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-2 text-[12px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
          </Link>
          <div className="font-display text-sm text-foreground">Atlas / Plans</div>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-4 md:px-8 py-10 md:py-16">
        <div className="text-center max-w-xl mx-auto mb-10">
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-3">Pricing</div>
          <h1 className="font-display text-3xl md:text-4xl text-foreground">Pick the plan that fits your money.</h1>
          <p className="mt-3 text-[13.5px] text-muted-foreground">Start free. Upgrade when you want richer insights. Cancel any time.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLANS.map((p) => {
            const isCurrent = subscriber?.plan === p.key;
            return (
              <div
                key={p.key}
                className={cn(
                  "relative rounded-2xl border p-6 flex flex-col",
                  p.highlight
                    ? "border-foreground/30 bg-gradient-to-b from-surface to-background shadow-xl"
                    : "border-border/60 bg-surface/40"
                )}
              >
                {p.highlight && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-foreground text-background text-[10px] font-medium tracking-wide">
                    MOST POPULAR
                  </div>
                )}
                <div className="text-[12px] uppercase tracking-wider text-muted-foreground">{p.name}</div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="font-display text-4xl text-foreground">${p.price}</span>
                  <span className="text-[12px] text-muted-foreground">/mo</span>
                </div>
                <div className="mt-1 text-[12.5px] text-muted-foreground">{p.blurb}</div>

                <ul className="mt-5 space-y-2 flex-1">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[12.5px] text-foreground">
                      <Check className="h-3.5 w-3.5 text-positive mt-0.5 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <button
                  disabled={isCurrent || busy === p.key}
                  onClick={() => choose(p.key)}
                  className={cn(
                    "mt-6 w-full py-2.5 rounded-md text-[13px] font-medium inline-flex items-center justify-center gap-2 transition",
                    isCurrent
                      ? "bg-surface text-muted-foreground border border-border cursor-default"
                      : p.highlight
                        ? "bg-foreground text-background hover:opacity-90"
                        : "border border-border bg-transparent text-foreground hover:bg-surface"
                  )}
                >
                  {busy === p.key && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {isCurrent ? "Current plan" : p.price === 0 ? "Get started" : `Upgrade to ${p.name}`}
                </button>
              </div>
            );
          })}
        </div>

        <p className="mt-10 text-center text-[11px] text-muted-foreground">
          Prices in USD. Taxes calculated at checkout where applicable.
        </p>
      </main>
    </div>
  );
};

export default Pricing;
