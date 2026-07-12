import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, CheckCircle, XCircle, Loader2, ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Suggestion {
  id: string;
  name: string;
  current_category: string;
  suggested_category: string;
  reason: string;
  confidence: string;
}

interface Props {
  txns: { id: string; name: string; merchant_name: string | null; category: string[] | null; amount: number }[];
  onAccept: (txnId: string, suggestedCategory: string, merchantName: string) => void;
  onDismiss: (txnId: string) => void;
  dismissedIds: Set<string>;
}

export const CategorySuggestions = ({ txns, onAccept, onDismiss, dismissedIds }: Props) => {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [ran, setRan] = useState(false);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [rejected, setRejected] = useState<Set<string>>(new Set());

  const run = async () => {
    setLoading(true);
    setSuggestions([]);
    try {
      // Only send expense transactions, skip transfers/salary, skip already dismissed
      const toReview = txns
        .filter(t => Number(t.amount) > 0)
        .filter(t => !dismissedIds.has(t.id))
        .filter(t => {
          const cat = (t.category?.[0] ?? "").toLowerCase();
          return !cat.includes("transfer") && !cat.includes("salary") && !cat.includes("payroll");
        })
        .slice(0, 50) // max 50 at a time to keep AI cost reasonable
        .map(t => ({
          id: t.id,
          name: t.name,
          merchant_name: t.merchant_name,
          plaid_category: t.category?.[0] ?? "Unknown",
          amount: Number(t.amount),
        }));

      if (!toReview.length) {
        toast("No transactions to review");
        setRan(true);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("ai-categorize", {
        body: { transactions: toReview },
      });

      if (error || data?.error) {
        // Likely a network/config issue on the server side
        setSuggestions([]);
        setRan(true);
        toast.error("AI scan unavailable", {
          description: "Add api.groq.com to Supabase Edge Function egress settings to enable this feature.",
        });
        setLoading(false);
        return;
      }
      setSuggestions((data?.suggestions ?? []).filter((s: Suggestion) =>
        !accepted.has(s.id) && !rejected.has(s.id)
      ));
      setRan(true);
    } catch (e) {
      toast.error("Could not get suggestions", { description: String(e) });
    }
    setLoading(false);
  };

  const accept = (s: Suggestion) => {
    setAccepted(prev => new Set([...prev, s.id]));
    setSuggestions(prev => prev.filter(x => x.id !== s.id));
    onAccept(s.id, s.suggested_category, s.name);
    toast.success(`Recategorized as ${s.suggested_category}`, {
      description: "A rule was created for future transactions",
    });
  };

  const reject = (s: Suggestion) => {
    setRejected(prev => new Set([...prev, s.id]));
    setSuggestions(prev => prev.filter(x => x.id !== s.id));
    onDismiss(s.id);
  };

  const pending = suggestions.length;

  return (
    <div className="surface-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2.5 border-b border-border/20">
        <div className="h-7 w-7 rounded-lg bg-[hsl(var(--primary)/0.12)] grid place-items-center shrink-0">
          <Sparkles className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-foreground">AI Category Review</div>
          <div className="text-[11px] text-muted-foreground">Spots miscategorized transactions for you to confirm</div>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gold text-[11.5px] font-semibold disabled:opacity-50 shrink-0"
        >
          {loading
            ? <><Loader2 className="h-3 w-3 animate-spin" /> Scanning…</>
            : ran
            ? <><RefreshCw className="h-3 w-3" /> Re-scan</>
            : <><Sparkles className="h-3 w-3" /> Scan</>
          }
        </button>
      </div>

      {/* Results */}
      {!ran && !loading && (
        <div className="px-4 py-5 text-center text-[12px] text-muted-foreground">
          Tap Scan to find miscategorized transactions
        </div>
      )}

      {ran && !loading && pending === 0 && (
        <div className="px-4 py-5 text-center">
          <CheckCircle className="h-8 w-8 text-positive mx-auto mb-2 opacity-60" />
          <div className="text-[12.5px] font-medium text-foreground">All categories look correct</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">No issues found in recent transactions</div>
        </div>
      )}

      {pending > 0 && (
        <div className="divide-y divide-border/10">
          <div className="px-4 py-2 text-[11px] text-muted-foreground">
            {pending} suggestion{pending !== 1 ? "s" : ""} — tap ✓ to apply, ✗ to skip
          </div>
          {suggestions.map(s => (
            <div key={s.id} className="px-4 py-3.5 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-foreground truncate">{s.name}</div>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-negative/10 text-negative line-through">{s.current_category}</span>
                  <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-positive/10 text-positive font-medium">{s.suggested_category}</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">{s.reason}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                <button onClick={() => accept(s)}
                  className="h-8 w-8 rounded-full bg-positive/10 grid place-items-center hover:bg-positive/20 transition-colors">
                  <CheckCircle className="h-4 w-4 text-positive" />
                </button>
                <button onClick={() => reject(s)}
                  className="h-8 w-8 rounded-full bg-border/40 grid place-items-center hover:bg-border/60 transition-colors">
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
