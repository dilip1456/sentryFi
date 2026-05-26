import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  X, Search, ShieldCheck, Lock, Check, Loader2, Building2, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Step = "pick" | "auth" | "loading" | "done";

interface Inst {
  id: string;
  name: string;
  type: "Bank" | "Credit card" | "Brokerage" | "Loan servicer";
  logo: string; // initial
  color: string;
}

const INSTITUTIONS: Inst[] = [
  { id: "chase",       name: "Chase",            type: "Bank",          logo: "C", color: "hsl(220 80% 60%)" },
  { id: "bofa",        name: "Bank of America",  type: "Bank",          logo: "B", color: "hsl(0 75% 55%)" },
  { id: "wells",       name: "Wells Fargo",      type: "Bank",          logo: "W", color: "hsl(0 70% 50%)" },
  { id: "marcus",      name: "Marcus by Goldman", type: "Bank",         logo: "M", color: "hsl(40 80% 60%)" },
  { id: "ally",        name: "Ally Bank",        type: "Bank",          logo: "A", color: "hsl(280 60% 60%)" },
  { id: "amex",        name: "American Express", type: "Credit card",   logo: "X", color: "hsl(200 80% 55%)" },
  { id: "citi",        name: "Citi",             type: "Credit card",   logo: "C", color: "hsl(210 75% 50%)" },
  { id: "apple",       name: "Apple Card",       type: "Credit card",   logo: "", color: "hsl(0 0% 90%)" },
  { id: "fidelity",    name: "Fidelity",         type: "Brokerage",     logo: "F", color: "hsl(156 60% 45%)" },
  { id: "vanguard",    name: "Vanguard",         type: "Brokerage",     logo: "V", color: "hsl(0 70% 45%)" },
  { id: "schwab",      name: "Charles Schwab",   type: "Brokerage",     logo: "S", color: "hsl(195 80% 50%)" },
  { id: "rocket",      name: "Rocket Mortgage",  type: "Loan servicer", logo: "R", color: "hsl(15 85% 55%)" },
  { id: "nelnet",      name: "Nelnet",           type: "Loan servicer", logo: "N", color: "hsl(210 60% 55%)" },
];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export const LinkAccountDialog = ({ open, onOpenChange }: Props) => {
  const [step, setStep] = useState<Step>("pick");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Inst | null>(null);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");

  const reset = () => {
    setStep("pick"); setPicked(null); setUser(""); setPass(""); setQuery("");
  };

  const close = () => { onOpenChange(false); setTimeout(reset, 200); };

  const filtered = INSTITUTIONS.filter((i) =>
    !query || i.name.toLowerCase().includes(query.toLowerCase()),
  );

  const submit = () => {
    setStep("loading");
    setTimeout(() => setStep("done"), 1400);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-md surface-elevated p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-md bg-positive/15 border border-positive/30 text-positive grid place-items-center">
              <ShieldCheck className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-[13px] font-medium text-foreground leading-none">Link a new account</div>
              <div className="text-[10.5px] text-muted-foreground mt-1">Secured by Plaid · read-only access</div>
            </div>
          </div>
          <button onClick={close} className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover">
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === "pick" && (
          <>
            <div className="p-4 border-b border-border/40">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search 12,000+ institutions"
                  className="w-full bg-surface/60 border border-border rounded-md pl-8 pr-3 py-2 text-[12.5px] text-foreground placeholder:text-muted-foreground outline-none focus:border-border-strong"
                />
              </div>
            </div>
            <div className="max-h-[340px] overflow-auto divide-y divide-border/30">
              {filtered.map((i) => (
                <button
                  key={i.id}
                  onClick={() => { setPicked(i); setStep("auth"); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover/40 text-left transition-colors"
                >
                  <div
                    className="h-8 w-8 rounded-md grid place-items-center text-[12px] font-semibold shrink-0"
                    style={{ background: `${i.color}24`, color: i.color }}
                  >
                    {i.logo || <Building2 className="h-3.5 w-3.5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-foreground truncate">{i.name}</div>
                    <div className="text-[10.5px] text-muted-foreground">{i.type}</div>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                  No institution matches "{query}".
                </div>
              )}
            </div>
          </>
        )}

        {step === "auth" && picked && (
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div
                className="h-10 w-10 rounded-lg grid place-items-center text-sm font-semibold"
                style={{ background: `${picked.color}24`, color: picked.color }}
              >
                {picked.logo || <Building2 className="h-4 w-4" />}
              </div>
              <div>
                <div className="text-[13px] text-foreground font-medium">{picked.name}</div>
                <div className="text-[10.5px] text-muted-foreground">{picked.type} · sign in to continue</div>
              </div>
            </div>

            <div className="space-y-2">
              <input
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="Username"
                className="w-full bg-surface/60 border border-border rounded-md px-3 py-2 text-[12.5px] outline-none focus:border-border-strong"
              />
              <input
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                type="password"
                placeholder="Password"
                className="w-full bg-surface/60 border border-border rounded-md px-3 py-2 text-[12.5px] outline-none focus:border-border-strong"
              />
            </div>

            <div className="flex items-start gap-2 text-[10.5px] text-muted-foreground bg-surface/40 rounded-md px-3 py-2 border border-border/40">
              <Lock className="h-3 w-3 mt-0.5 shrink-0 text-positive" />
              <span>Credentials are encrypted by Plaid and never stored on our servers. Atlas only sees read-only balances and transactions.</span>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setStep("pick")}
                className="px-3 py-2 rounded-md border border-border-strong text-[12px] text-muted-foreground hover:text-foreground"
              >
                Back
              </button>
              <button
                onClick={submit}
                disabled={!user || !pass}
                className="flex-1 px-3 py-2 rounded-md bg-foreground text-background text-[12px] font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Securely connect
              </button>
            </div>
          </div>
        )}

        {step === "loading" && (
          <div className="p-10 grid place-items-center">
            <Loader2 className="h-6 w-6 text-positive animate-spin" />
            <div className="mt-3 text-[12.5px] text-foreground">Linking {picked?.name}…</div>
            <div className="mt-1 text-[10.5px] text-muted-foreground">Fetching balances and recent transactions</div>
          </div>
        )}

        {step === "done" && picked && (
          <div className="p-6 text-center">
            <div className="h-10 w-10 mx-auto rounded-full bg-positive/15 border border-positive/30 grid place-items-center text-positive">
              <Check className="h-5 w-5" />
            </div>
            <div className="mt-3 font-display text-lg text-foreground">{picked.name} linked</div>
            <div className="text-[11.5px] text-muted-foreground mt-1">
              We found 2 accounts. They'll appear in your dashboard shortly.
            </div>
            <div className="mt-4 flex gap-2 justify-center">
              <button
                onClick={reset}
                className="px-3 py-2 rounded-md border border-border-strong text-[12px] text-muted-foreground hover:text-foreground"
              >
                Link another
              </button>
              <button
                onClick={close}
                className="px-4 py-2 rounded-md bg-foreground text-background text-[12px] font-medium hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
