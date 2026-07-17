import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ManualAccountDialog } from "@/components/finance/ManualAccountDialog";
import { type ManualAccountInput } from "@/hooks/useManualAccounts";
import {
  Link2, Home, Building2, TrendingUp, Sparkles,
  ChevronRight, CheckCircle2, Plus, ArrowRight,
} from "lucide-react";

type Step = "welcome" | "connect" | "manual" | "done";

interface Props {
  onLinkPlaid: () => void;
  onSaveManual: (input: ManualAccountInput) => Promise<boolean>;
  onFinish: () => void;
  displayName?: string | null;
}

const QUICK_OPTIONS = [
  { icon: <Link2 className="h-5 w-5" />, label: "Link a bank or credit card", sub: "Live sync via Plaid (recommended)", action: "plaid" as const },
  { icon: <Home className="h-5 w-5" />, label: "Add a mortgage", sub: "Provident Funding, Wells Fargo, any servicer", action: "mortgage" as const },
  { icon: <Building2 className="h-5 w-5" />, label: "Add a loan", sub: "Auto, student, or personal", action: "loan" as const },
  { icon: <TrendingUp className="h-5 w-5" />, label: "Add an investment", sub: "401k, IRA, brokerage, HSA", action: "investment" as const },
];

export const Onboarding = ({ onLinkPlaid, onSaveManual, onFinish, displayName }: Props) => {
  const [step, setStep] = useState<Step>("welcome");
  const [addedCount, setAddedCount] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualType, setManualType] = useState<string>("mortgage");
  const navigate = useNavigate();

  const firstName = displayName?.split(" ")[0] ?? null;

  const handleQuickOption = (action: "plaid" | "mortgage" | "loan" | "investment") => {
    if (action === "plaid") {
      onLinkPlaid();
      setStep("done");
    } else {
      setManualType(action === "mortgage" ? "mortgage" : action === "loan" ? "auto_loan" : "investment");
      setManualOpen(true);
    }
  };

  const handleManualSave = async (input: ManualAccountInput) => {
    const ok = await onSaveManual(input);
    if (ok) {
      setAddedCount(c => c + 1);
      setManualOpen(false);
      setStep("connect");
    }
    return ok;
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="w-full max-w-md animate-fade-up">

          {/* STEP: WELCOME */}
          {step === "welcome" && (
            <div className="text-center space-y-5">
              <div className="mx-auto h-16 w-16 rounded-2xl bg-gold grid place-items-center shadow-[var(--shadow-glow)]">
                <img src="/logo.png" alt="SentryFi" className="h-10 w-10 object-contain" />
              </div>
              <div>
                <h1 className="font-display text-2xl text-foreground">
                  Welcome{firstName ? `, ${firstName}` : ""}!
                </h1>
                <p className="mt-2 text-[15px] text-muted-foreground leading-relaxed">
                  SentryFi shows you what you can actually spend, not just your bank balance.
                  Let's get your accounts set up in 2 minutes.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  { n: "01", t: "Connect accounts", s: "Bank, mortgage, investments" },
                  { n: "02", t: "Tag each account", s: "Spending, savings, debt" },
                  { n: "03", t: "See your real number", s: "True available balance" },
                ].map(i => (
                  <div key={i.n} className="surface-card p-3 rounded-xl">
                    <div className="text-[12.5px] font-bold text-gold mb-1.5">{i.n}</div>
                    <div className="text-[13px] font-semibold text-foreground">{i.t}</div>
                    <div className="text-[12px] text-muted-foreground mt-0.5">{i.s}</div>
                  </div>
                ))}
              </div>

              <button onClick={() => setStep("connect")}
                className="w-full h-11 rounded-xl bg-gold text-background font-semibold text-[15px] flex items-center justify-center gap-2">
                Get started <ArrowRight className="h-4 w-4" />
              </button>
              <button onClick={onFinish} className="text-[13px] text-muted-foreground hover:text-foreground transition-colors">
                Skip for now
              </button>
            </div>
          )}

          {/* STEP: CONNECT */}
          {step === "connect" && (
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-xl text-foreground">Add your accounts</h2>
                <p className="mt-1 text-[14px] text-muted-foreground">
                  Connect what you have. You can always add more later.
                </p>
                {addedCount > 0 && (
                  <div className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-gold font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {addedCount} account{addedCount !== 1 ? "s" : ""} added
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {QUICK_OPTIONS.map(o => (
                  <button key={o.action} onClick={() => handleQuickOption(o.action)}
                    className="w-full surface-card hover:border-border-strong p-4 rounded-xl flex items-center gap-3 text-left transition-all group">
                    <div className="h-10 w-10 rounded-xl bg-gold/10 border border-gold/20 grid place-items-center text-gold shrink-0">
                      {o.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold text-foreground">{o.label}</div>
                      <div className="text-[13px] text-muted-foreground">{o.sub}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground shrink-0" />
                  </button>
                ))}

                <button onClick={() => { setManualType("other"); setManualOpen(true); }}
                  className="w-full border border-dashed border-border hover:border-border-strong p-3.5 rounded-xl flex items-center gap-2 text-muted-foreground hover:text-foreground transition-all text-[14px]">
                  <Plus className="h-4 w-4" /> Add other account type
                </button>
              </div>

              <div className="pt-2 flex items-center gap-3">
                <button onClick={onFinish}
                  className="flex-1 h-10 rounded-xl border border-border text-[14px] text-muted-foreground hover:text-foreground transition-colors">
                  {addedCount > 0 ? "I'm done adding" : "Skip for now"}
                </button>
                {addedCount > 0 && (
                  <button onClick={() => setStep("done")}
                    className="flex-1 h-10 rounded-xl bg-gold text-background text-[14px] font-semibold flex items-center justify-center gap-1.5">
                    Continue <ArrowRight className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* STEP: DONE */}
          {step === "done" && (
            <div className="text-center space-y-5">
              <div className="mx-auto h-16 w-16 rounded-full bg-gold/10 border border-gold/30 grid place-items-center">
                <CheckCircle2 className="h-8 w-8 text-gold" />
              </div>
              <div>
                <h2 className="font-display text-2xl text-foreground">You're all set!</h2>
                <p className="mt-2 text-[14px] text-muted-foreground leading-relaxed">
                  Head to Money Map to tag each account and unlock your True Available balance.
                </p>
              </div>

              <div className="surface-card p-4 rounded-xl text-left space-y-2">
                <div className="text-[12.5px] font-semibold text-muted-foreground uppercase tracking-wide">Quick tip</div>
                <div className="flex items-start gap-2.5">
                  <Sparkles className="h-4 w-4 text-gold shrink-0 mt-0.5" />
                  <p className="text-[14px] text-foreground leading-relaxed">
                    Tag your checking account as "Everyday Expenses" and your emergency fund as "Emergency Fund" to see your real spendable balance.
                  </p>
                </div>
              </div>

              <button onClick={onFinish}
                className="w-full h-11 rounded-xl bg-gold text-background font-semibold text-[15px] flex items-center justify-center gap-2">
                Go to dashboard <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      <ManualAccountDialog
        open={manualOpen}
        onOpenChange={o => { if (!o) setManualOpen(false); }}
        onSave={handleManualSave}
        editing={null}
      />
    </>
  );
};
