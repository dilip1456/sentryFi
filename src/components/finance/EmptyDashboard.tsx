import { Sparkles, Link2, ShieldCheck, TrendingUp, Wallet, CreditCard } from "lucide-react";
import { useDemo } from "@/contexts/DemoContext";
import { toast } from "sonner";

interface Props { onLink: () => void }

export const EmptyDashboard = ({ onLink }: Props) => {
  const { setDemo } = useDemo();

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-0 px-4 py-6 animate-fade-up">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto h-12 w-12 sm:h-14 sm:w-14 rounded-2xl bg-gold grid place-items-center shadow-[var(--shadow-glow)]">
          <Wallet className="h-6 w-6" />
        </div>

        <h1 className="mt-4 font-display text-2xl sm:text-3xl text-foreground">
          Welcome to <span className="text-gold">SentryFi</span>
        </h1>
        <p className="mt-2 text-[13px] sm:text-[15px] text-muted-foreground">
          Your accounts, cards, and investments in one place.
        </p>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
          <button
            onClick={onLink}
            className="surface-elevated p-4 hover:border-[hsl(var(--primary)/0.4)] transition-all group text-left"
          >
            <div className="h-9 w-9 rounded-lg bg-gold grid place-items-center">
              <Link2 className="h-4 w-4" />
            </div>
            <div className="mt-3 text-[14px] font-medium text-foreground">Link real accounts</div>
            <div className="mt-1 text-[12px] text-muted-foreground">
              Connect banks and cards securely via Plaid.
            </div>
            <div className="mt-2.5 text-[12px] text-gold group-hover:underline">
              Connect via Plaid →
            </div>
          </button>

          <button
            onClick={() => { setDemo(true); toast.success("Demo mode enabled"); }}
            className="surface-card p-4 hover:border-border-strong transition-all text-left group"
          >
            <div className="h-9 w-9 rounded-lg bg-surface-hover border border-border grid place-items-center text-muted-foreground">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="mt-3 text-[14px] font-medium text-foreground">Try demo mode</div>
            <div className="mt-1 text-[12px] text-muted-foreground">
              Explore with a realistic sample portfolio.
            </div>
            <div className="mt-2.5 text-[12px] text-muted-foreground group-hover:text-foreground">
              Load demo data →
            </div>
          </button>
        </div>

        <div className="mt-5 flex items-center justify-center gap-4 text-[11px] text-muted-foreground flex-wrap">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3 w-3 text-gold" /> Bank-level security</span>
          <span className="inline-flex items-center gap-1.5"><CreditCard className="h-3 w-3 text-gold" /> Read-only</span>
          <span className="inline-flex items-center gap-1.5"><TrendingUp className="h-3 w-3 text-gold" /> Real-time sync</span>
        </div>
      </div>
    </div>
  );
};
