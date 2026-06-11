import { Sparkles, Link2, ShieldCheck, TrendingUp, Wallet, CreditCard } from "lucide-react";
import { useDemo } from "@/contexts/DemoContext";
import { toast } from "sonner";

interface Props { onLink: () => void }

export const EmptyDashboard = ({ onLink }: Props) => {
  const { setDemo } = useDemo();

  return (
    <div className="min-h-[60vh] grid place-items-center px-4 animate-fade-up">
      <div className="max-w-2xl w-full text-center">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-gold grid place-items-center shadow-[var(--shadow-glow)]">
          <Wallet className="h-6 w-6" />
        </div>

        <h1 className="mt-6 font-display text-3xl md:text-4xl text-foreground">
          Welcome to <span className="text-gold">SentriFi</span>
        </h1>
        <p className="mt-3 text-sm md:text-[15px] text-muted-foreground max-w-md mx-auto">
          Your accounts, loans, cards, and investments — in one intelligent dashboard.
          Get started by linking real accounts, or explore with demo data.
        </p>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-3 text-left">
          <button
            onClick={onLink}
            className="surface-elevated p-5 hover:border-[hsl(var(--primary)/0.4)] transition-all group text-left"
          >
            <div className="h-9 w-9 rounded-lg bg-gold grid place-items-center">
              <Link2 className="h-4 w-4" />
            </div>
            <div className="mt-4 text-[14px] font-medium text-foreground">Link real accounts</div>
            <div className="mt-1 text-[12px] text-muted-foreground">
              Connect banks, credit cards, loans, and brokerages securely via Plaid.
            </div>
            <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-gold group-hover:gap-2 transition-all">
              Connect via Plaid →
            </div>
          </button>

          <button
            onClick={() => { setDemo(true); toast.success("Demo mode enabled"); }}
            className="surface-card p-5 hover:border-border-strong transition-all text-left group"
          >
            <div className="h-9 w-9 rounded-lg bg-surface-hover border border-border grid place-items-center text-muted-foreground">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="mt-4 text-[14px] font-medium text-foreground">Try demo mode</div>
            <div className="mt-1 text-[12px] text-muted-foreground">
              Explore SentriFi with a realistic sample portfolio — no accounts needed.
            </div>
            <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground group-hover:text-foreground group-hover:gap-2 transition-all">
              Load demo data →
            </div>
          </button>
        </div>

        <div className="mt-8 flex items-center justify-center gap-5 text-[10.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3 w-3 text-gold" /> Bank-level security</span>
          <span className="inline-flex items-center gap-1.5"><CreditCard className="h-3 w-3 text-gold" /> Read-only access</span>
          <span className="inline-flex items-center gap-1.5"><TrendingUp className="h-3 w-3 text-gold" /> Real-time sync</span>
        </div>
      </div>
    </div>
  );
};
