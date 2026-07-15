import { useState, useEffect } from "react";
import { SupabaseClient } from "@supabase/supabase-js";
import { Sparkles, CheckCircle, RotateCcw, Loader2, ChevronDown, ChevronUp, RefreshCw, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Benefit {
  key: string;
  title: string;
  description: string;
  value: string;
  period: string;
  used_at?: string | null;
  hidden_at?: string | null;
}

interface CardWithBenefits {
  account_id: string;
  name: string;
  official_name: string;
  benefits: Benefit[];
}

interface Props {
  accounts: { account_id: string; name: string; official_name?: string | null; type: string }[];
  supabase: SupabaseClient;
  user: { id: string } | null;
}

export const CardBenefitsView = ({ accounts, supabase, user }: Props) => {
  const [loading, setLoading] = useState(false);
  const [cards, setCards] = useState<CardWithBenefits[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showUsed, setShowUsed] = useState<Set<string>>(new Set());

  const creditCards = accounts.filter(a => a.type === "credit");

  const loadBenefits = async (refresh = false) => {
    if (!user) return;
    setLoading(true);
    try {
      // Load from DB first
      const { data: existing } = await supabase
        .from("card_benefits")
        .select("*")
        .eq("user_id", user.id);

      const byCard: Record<string, Benefit[]> = {};
      (existing ?? []).forEach((b: any) => {
        if (!byCard[b.account_id]) byCard[b.account_id] = [];
        byCard[b.account_id].push({
          key: b.benefit_key, title: b.title, description: b.description,
          value: b.value, period: b.period, used_at: b.used_at, hidden_at: b.hidden_at,
        });
      });

      const needsFetch = refresh || creditCards.some(c => !byCard[c.account_id]?.length);

      if (needsFetch) {
        const { data, error } = await supabase.functions.invoke("fetch-card-benefits", {
          body: { cards: creditCards.map(c => ({ account_id: c.account_id, name: c.name, official_name: c.official_name ?? c.name })) },
        });

        if (error || data?.error) {
          toast.error("Could not fetch benefits", { description: data?.error ?? error?.message });
        } else {
          const fetched: Record<string, any[]> = data.benefits ?? {};
          // Save to DB and merge
          for (const [accountId, benefits] of Object.entries(fetched)) {
            if (!Array.isArray(benefits)) continue;
            for (const b of benefits) {
              await supabase.from("card_benefits").upsert({
                user_id: user.id, account_id: accountId, benefit_key: b.key,
                title: b.title, description: b.description, value: b.value,
                period: b.period, fetched_at: new Date().toISOString(),
              }, { onConflict: "user_id,account_id,benefit_key", ignoreDuplicates: false });
            }
            if (!byCard[accountId]) byCard[accountId] = [];
            // Re-load from DB to get used_at state
            const { data: refreshed } = await supabase
              .from("card_benefits").select("*")
              .eq("user_id", user.id).eq("account_id", accountId);
            byCard[accountId] = (refreshed ?? []).map((b: any) => ({
              key: b.benefit_key, title: b.title, description: b.description,
              value: b.value, period: b.period, used_at: b.used_at, hidden_at: b.hidden_at,
            }));
          }
        }
      }

      const result = creditCards.map(c => ({
        account_id: c.account_id,
        name: c.name,
        official_name: c.official_name ?? c.name,
        benefits: byCard[c.account_id] ?? [],
      }));

      setCards(result);
      setExpanded(new Set(result.filter(c => c.benefits.length > 0).map(c => c.account_id)));
    } catch (e) {
      toast.error("Error loading benefits", { description: String(e) });
    }
    setLoading(false);
  };

  useEffect(() => { loadBenefits(); }, [user?.id]);

  const markUsed = async (accountId: string, benefitKey: string) => {
    await supabase.from("card_benefits")
      .update({ used_at: new Date().toISOString() })
      .eq("user_id", user!.id).eq("account_id", accountId).eq("benefit_key", benefitKey);
    setCards(prev => prev.map(c => c.account_id !== accountId ? c : {
      ...c,
      benefits: c.benefits.map(b => b.key !== benefitKey ? b : { ...b, used_at: new Date().toISOString() }),
    }));
    toast.success("Marked as used");
  };

  const unmarkUsed = async (accountId: string, benefitKey: string) => {
    await supabase.from("card_benefits")
      .update({ used_at: null })
      .eq("user_id", user!.id).eq("account_id", accountId).eq("benefit_key", benefitKey);
    setCards(prev => prev.map(c => c.account_id !== accountId ? c : {
      ...c,
      benefits: c.benefits.map(b => b.key !== benefitKey ? b : { ...b, used_at: null }),
    }));
  };

  const toggle = (id: string) => setExpanded(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const toggleShowUsed = (id: string) => setShowUsed(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  if (creditCards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
        <CreditCard className="h-10 w-10 text-muted-foreground/30" />
        <div className="text-[14px] font-medium text-foreground">No credit cards linked</div>
        <div className="text-[12px] text-muted-foreground">Link a credit card to see its benefits</div>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-fade-up">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl text-primary">Card Benefits</h2>
        <button onClick={() => loadBenefits(true)} disabled={loading}
          className="flex items-center gap-1.5 h-7 px-3 rounded-full border border-border text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {loading && cards.length === 0 ? (
        <div className="surface-card p-10 flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-8 w-8 text-[hsl(var(--primary))] animate-spin" />
          <div className="text-[13px] font-medium text-foreground">Looking up card benefits…</div>
          <div className="text-[11px] text-muted-foreground">This takes a few seconds</div>
        </div>
      ) : cards.map(card => {
        const active = card.benefits.filter(b => !b.used_at);
        const used = card.benefits.filter(b => b.used_at);
        const isExpanded = expanded.has(card.account_id);
        const seeUsed = showUsed.has(card.account_id);

        return (
          <div key={card.account_id} className="surface-card overflow-hidden">
            {/* Card header */}
            <button onClick={() => toggle(card.account_id)}
              className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-surface-hover/20 transition-colors">
              <div className="h-9 w-9 rounded-xl bg-[hsl(var(--primary)/0.1)] grid place-items-center shrink-0">
                <CreditCard className="h-4 w-4 text-[hsl(var(--primary))]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold text-foreground truncate">{card.official_name || card.name}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {card.benefits.length === 0 ? "No benefits found" : `${active.length} available${used.length > 0 ? ` · ${used.length} used` : ""}`}
                </div>
              </div>
              {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground/40 shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground/40 shrink-0" />}
            </button>

            {isExpanded && (
              <div className="border-t border-border/20">
                {active.length === 0 && used.length === 0 && (
                  <div className="px-5 py-6 text-center text-[12px] text-muted-foreground">No benefits data available</div>
                )}

                {/* Active benefits */}
                {active.map(b => (
                  <div key={b.key} className="flex items-start gap-3 px-5 py-3.5 border-b border-border/10 last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-medium text-foreground">{b.title}</span>
                        {b.value && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-positive/10 text-positive">
                            {b.value}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground/50">{b.period}</span>
                      </div>
                      {b.description && (
                        <div className="text-[11.5px] text-muted-foreground mt-0.5 leading-relaxed">{b.description}</div>
                      )}
                    </div>
                    <button onClick={() => markUsed(card.account_id, b.key)}
                      className="shrink-0 h-7 px-2.5 rounded-full border border-border/60 text-[10.5px] text-muted-foreground hover:bg-positive/10 hover:text-positive hover:border-positive/30 transition-colors flex items-center gap-1 mt-0.5">
                      <CheckCircle className="h-3 w-3" /> Used
                    </button>
                  </div>
                ))}

                {/* Used benefits section */}
                {used.length > 0 && (
                  <div className="border-t border-border/10">
                    <button onClick={() => toggleShowUsed(card.account_id)}
                      className="w-full flex items-center gap-2 px-5 py-2.5 text-left hover:bg-surface-hover/20">
                      <span className="text-[11px] text-muted-foreground">{used.length} used benefit{used.length !== 1 ? "s" : ""}</span>
                      <span className="text-[10px] text-[hsl(var(--primary))]">{seeUsed ? "Hide" : "Show all"}</span>
                    </button>
                    {seeUsed && used.map(b => (
                      <div key={b.key} className="flex items-start gap-3 px-5 py-3 border-t border-border/10 opacity-50">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="h-3.5 w-3.5 text-positive shrink-0" />
                            <span className="text-[12.5px] font-medium text-foreground line-through">{b.title}</span>
                            {b.value && <span className="text-[10px] text-muted-foreground">{b.value}</span>}
                          </div>
                        </div>
                        <button onClick={() => unmarkUsed(card.account_id, b.key)}
                          className="shrink-0 h-6 px-2 rounded-full border border-border/40 text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                          <RotateCcw className="h-2.5 w-2.5" /> Restore
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
