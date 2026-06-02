import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ShieldCheck, Lock, Building2, Sparkles, ArrowRight, Landmark, CreditCard, TrendingUp, Home } from "lucide-react";
import { useDemo } from "@/contexts/DemoContext";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

const SUPPORTED = [
  { icon: Landmark,   label: "Checking & Savings", note: "Chase, BofA, Wells Fargo, Ally, Marcus, 12,000+ more" },
  { icon: CreditCard, label: "Credit Cards",       note: "Amex, Chase, Citi, Apple Card, Capital One" },
  { icon: Home,       label: "Mortgages & Loans",  note: "Rocket, Nelnet, SoFi, auto & student lenders" },
  { icon: TrendingUp, label: "Brokerage & Retirement", note: "Fidelity, Vanguard, Schwab, 401(k), HSA" },
];

export const LinkAccountDialog = ({ open, onOpenChange }: Props) => {
  const { setDemo } = useDemo();

  const connect = () => {
    toast.info("Plaid integration requires API keys", {
      description: "Ask Lovable to enable real Plaid linking — you'll need a Plaid client_id and secret.",
      duration: 5000,
    });
  };

  const tryDemo = () => {
    setDemo(true);
    onOpenChange(false);
    toast.success("Demo mode enabled — showing sample portfolio");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md surface-elevated p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">Link a new account</DialogTitle>
        <DialogDescription className="sr-only">Connect a bank, credit card, brokerage, or loan servicer via Plaid.</DialogDescription>

        {/* Hero */}
        <div className="px-6 pt-6 pb-5 border-b border-border/40 text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-gold grid place-items-center shadow-[var(--shadow-glow)]">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="mt-3 font-display text-lg text-foreground">Link your accounts</div>
          <div className="mt-1 text-[11.5px] text-muted-foreground">
            Securely connect via <span className="text-gold font-medium">Plaid</span> — read-only access.
          </div>
        </div>

        {/* Supported categories */}
        <div className="p-4 space-y-1.5">
          {SUPPORTED.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="flex items-center gap-3 px-2 py-1.5 rounded-md">
                <div className="h-7 w-7 rounded-md bg-secondary/60 border border-border/50 grid place-items-center text-gold shrink-0">
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] text-foreground">{s.label}</div>
                  <div className="text-[10.5px] text-muted-foreground truncate">{s.note}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Trust strip */}
        <div className="mx-4 mb-4 px-3 py-2 rounded-md bg-surface/40 border border-border/40 flex items-start gap-2">
          <Lock className="h-3 w-3 mt-0.5 shrink-0 text-gold" />
          <span className="text-[10.5px] text-muted-foreground">
            Plaid encrypts your credentials end-to-end. Atlas only receives read-only balances and transactions — never your password.
          </span>
        </div>

        {/* Actions */}
        <div className="p-4 pt-0 space-y-2">
          <button
            onClick={connect}
            className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-md bg-gold text-[13px] font-medium hover:opacity-90 transition-opacity"
          >
            <ShieldCheck className="h-4 w-4" /> Connect with Plaid <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={tryDemo}
            className="w-full inline-flex items-center justify-center gap-2 h-9 rounded-md border border-border-strong text-[12px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Sparkles className="h-3.5 w-3.5" /> Or explore with demo data
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
