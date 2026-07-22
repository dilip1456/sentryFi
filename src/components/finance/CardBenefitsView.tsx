import { useState, useEffect } from "react";
import { SupabaseClient } from "@supabase/supabase-js";
import {
  Sparkles, CheckCircle, RotateCcw, Loader2, RefreshCw, CreditCard,
  ChevronDown, ChevronRight, Zap, TrendingUp, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtUSD } from "@/lib/format";
import { toast } from "sonner";

interface Benefit {
  key: string;
  title: string;
  description: string;
  value: string;
  period: string;
  action_type: string | null;
  action_label: string | null;
  cashback_category: string | null;
  cashback_rate: number | null;
  priority: number;
  used_at?: string | null;
}

interface CardData {
  account_id: string;
  name: string;
  official_name: string;
  benefits: Benefit[];
}

interface SpendCategory {
  category: string;
  monthly_avg: number;
  current_card: string | null;
  current_card_name: string | null;
  current_rate: number | null;
  best_card: string | null;
  best_card_name: string | null;
  best_rate: number | null;
  annual_gain: number;
}

interface Props {
  accounts: { account_id: string; name: string; official_name?: string | null; type: string }[];
  supabase: SupabaseClient;
  user: { id: string } | null;
  txns?: { account_id: string; amount: number; date: string; category: string[] | null }[];
}

const ACTION_ICON: Record<string, string> = {
  register: "🔑",
  activate: "⚡",
  use_credit: "💳",
  subscribe: "📱",
  link: "🔗",
  none: "✓",
};

const ACTION_COLOR: Record<string, string> = {
  register: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  activate: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  use_credit: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  subscribe: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  link: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  none: "bg-muted/40 text-muted-foreground border-border/30",
};

export const CardBenefitsView = ({ accounts, supabase, user, txns = [] }: Props) => {
  const [loading, setLoading] = useState(false);
  const [cards, setCards] = useState<CardData[]>([]);
  const [spendOpt, setSpendOpt] = useState<SpendCategory[]>([]);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"actions" | "optimize" | "all">("actions");

  const creditCards = accounts.filter(a => a.type === "credit");

  const loadBenefits = async (refresh = false) => {
    if (!user || !creditCards.length) return;
    setLoading(true);
    try {
      // Load from DB
      const { data: existing } = await supabase
        .from("card_benefits")
        .select("*")
        .eq("user_id", user.id)
        .order("priority", { ascending: true });

      const byCard: Record<string, Benefit[]> = {};
      for (const b of existing ?? []) {
        if (!byCard[b.account_id]) byCard[b.account_id] = [];
        byCard[b.account_id].push({
          key: b.benefit_key, title: b.title, description: b.description,
          value: b.value, period: b.period,
          action_type: b.action_type, action_label: b.action_label,
          cashback_category: b.cashback_category, cashback_rate: b.cashback_rate,
          priority: b.priority ?? 5,
          used_at: b.used_at,
        });
      }

      const needsFetch = refresh || creditCards.some(c => !byCard[c.account_id]?.length);

      if (needsFetch) {
        const { data, error } = await supabase.functions.invoke("fetch-card-benefits", {
          body: { cards: creditCards.map(c => ({ account_id: c.account_id, name: c.name, official_name: c.official_name ?? c.name })) },
        });

        if (error || data?.error) {
          toast.error("Could not fetch benefits", { description: data?.error ?? error?.message });
        } else {
          const fetched: Record<string, any[]> = data.benefits ?? {};
          for (const [accountId, benefits] of Object.entries(fetched)) {
            if (!Array.isArray(benefits)) continue;
            for (const b of benefits) {
              await supabase.from("card_benefits").upsert({
                user_id: user.id,
                account_id: accountId,
                benefit_key: b.key,
                title: b.title,
                description: b.description,
                value: b.value,
                period: b.period,
                action_type: b.action_type ?? null,
                action_label: b.action_label ?? null,
                cashback_category: b.cashback_category ?? null,
                cashback_rate: b.cashback_rate ?? null,
                priority: b.priority ?? 5,
                fetched_at: new Date().toISOString(),
              }, { onConflict: "user_id,account_id,benefit_key" });
            }
            // Reload
            const { data: refreshed } = await supabase.from("card_benefits").select("*")
              .eq("user_id", user.id).eq("account_id", accountId).order("priority");
            byCard[accountId] = (refreshed ?? []).map((b: any) => ({
              key: b.benefit_key, title: b.title, description: b.description,
              value: b.value, period: b.period,
              action_type: b.action_type, action_label: b.action_label,
              cashback_category: b.cashback_category, cashback_rate: b.cashback_rate,
              priority: b.priority ?? 5, used_at: b.used_at,
            }));
          }
        }
      }

      const result = creditCards.map(c => ({
        account_id: c.account_id,
        name: c.name,
        official_name: c.official_name ?? c.name,
        benefits: (byCard[c.account_id] ?? []).sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5)),
      }));
      setCards(result);
      setExpandedCards(new Set(result.filter(c => c.benefits.length > 0).map(c => c.account_id)));

      // Build spend optimizer
      buildSpendOptimizer(result, txns);
    } catch (e) {
      toast.error("Error loading benefits", { description: String(e) });
    }
    setLoading(false);
  };

  const buildSpendOptimizer = (cards: CardData[], txns: Props["txns"]) => {
    if (!txns?.length) return;

    // Get 90-day spending by category
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const recentTxns = txns.filter(t => t.amount > 0 && t.date >= cutoff);
    const byCategory: Record<string, { total: number; account_id: string | null }> = {};

    for (const t of recentTxns) {
      const cat = t.category?.[0] ?? "Other";
      if (!byCategory[cat]) byCategory[cat] = { total: 0, account_id: t.account_id };
      byCategory[cat].total += Number(t.amount);
      // Track most-used account for this category
      if (byCategory[cat].account_id !== t.account_id) {
        byCategory[cat].account_id = null; // mixed
      }
    }

    // Build cashback rate map: category → [{ account_id, rate, card_name }]
    const rateMap: Record<string, { account_id: string; rate: number; card_name: string }[]> = {};
    for (const card of cards) {
      for (const b of card.benefits) {
        if (!b.cashback_rate || !b.cashback_category) continue;
        if (!rateMap[b.cashback_category]) rateMap[b.cashback_category] = [];
        rateMap[b.cashback_category].push({
          account_id: card.account_id,
          rate: b.cashback_rate,
          card_name: card.official_name || card.name,
        });
      }
    }

    const suggestions: SpendCategory[] = [];

    for (const [category, { total, account_id: currentAccountId }] of Object.entries(byCategory)) {
      const monthly = total / 3;
      if (monthly < 20) continue; // skip tiny categories

      const options = rateMap[category] ?? rateMap["Other"] ?? [];
      if (options.length === 0) continue;

      const best = options.reduce((a, b) => a.rate > b.rate ? a : b);
      const current = currentAccountId ? options.find(o => o.account_id === currentAccountId) : null;
      const currentRate = current?.rate ?? null;

      // Only show if there's a better option
      if (currentRate !== null && best.rate <= currentRate) continue;

      const annualGain = monthly * 12 * ((best.rate - (currentRate ?? 1)) / 100);
      if (annualGain < 10) continue; // not worth showing tiny gains

      suggestions.push({
        category,
        monthly_avg: monthly,
        current_card: currentAccountId ?? null,
        current_card_name: current?.card_name ?? null,
        current_rate: currentRate,
        best_card: best.account_id,
        best_card_name: best.card_name,
        best_rate: best.rate,
        annual_gain: annualGain,
      });
    }

    setSpendOpt(suggestions.sort((a, b) => b.annual_gain - a.annual_gain));
  };

  useEffect(() => { loadBenefits(); }, [user?.id]);

  const markUsed = async (accountId: string, key: string) => {
    await supabase.from("card_benefits")
      .update({ used_at: new Date().toISOString() })
      .eq("user_id", user!.id).eq("account_id", accountId).eq("benefit_key", key);
    setCards(prev => prev.map(c => c.account_id !== accountId ? c : {
      ...c, benefits: c.benefits.map(b => b.key !== key ? b : { ...b, used_at: new Date().toISOString() }),
    }));
    toast.success("Marked as done");
  };

  const restore = async (accountId: string, key: string) => {
    await supabase.from("card_benefits")
      .update({ used_at: null })
      .eq("user_id", user!.id).eq("account_id", accountId).eq("benefit_key", key);
    setCards(prev => prev.map(c => c.account_id !== accountId ? c : {
      ...c, benefits: c.benefits.map(b => b.key !== key ? b : { ...b, used_at: null }),
    }));
  };

  // All actionable benefits across all cards, sorted by priority
  const allActions = cards.flatMap(c =>
    c.benefits
      .filter(b => !b.used_at && b.action_type && b.action_type !== "none")
      .map(b => ({ ...b, card_name: c.official_name || c.name, account_id: c.account_id }))
  ).sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5));

  const doneActions = cards.flatMap(c =>
    c.benefits.filter(b => !!b.used_at).map(b => ({ ...b, card_name: c.official_name || c.name, account_id: c.account_id }))
  );

  const tabs = [
    { k: "actions" as const, label: `Take action${allActions.length > 0 ? ` (${allActions.length})` : ""}` },
    { k: "optimize" as const, label: `Spend smarter${spendOpt.length > 0 ? ` (${spendOpt.length})` : ""}` },
    { k: "all" as const, label: "All perks" },
  ];

  return (
    <div className="space-y-3 animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl text-primary">Card Benefits</h2>
        <button onClick={() => loadBenefits(true)} disabled={loading}
          className="flex items-center gap-1.5 h-7 px-3 rounded-full border border-border text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Tab switcher */}
      <div className="flex bg-muted/30 rounded-xl p-1 gap-0.5">
        {tabs.map(t => (
          <button key={t.k} onClick={() => setActiveTab(t.k)}
            className={cn("flex-1 h-8 rounded-lg text-[12px] font-medium transition-all",
              activeTab === t.k ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>

      {loading && !cards.length ? (
        <div className="surface-card p-12 flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-8 w-8 text-[hsl(var(--primary))] animate-spin" />
          <div className="text-[13px] text-muted-foreground">Analyzing your cards…</div>
        </div>
      ) : (

        /* ── TAKE ACTION tab ── */
        activeTab === "actions" ? (
          <div className="space-y-2">
            {allActions.length === 0 && !loading ? (
              <div className="surface-card p-10 text-center">
                <CheckCircle className="h-8 w-8 text-positive mx-auto mb-2 opacity-60" />
                <div className="text-[13px] font-medium text-foreground">All done!</div>
                <div className="text-[11.5px] text-muted-foreground mt-1">No pending actions. Check "All perks" to see everything.</div>
              </div>
            ) : allActions.map(b => {
              const color = ACTION_COLOR[b.action_type ?? "none"];
              const icon = ACTION_ICON[b.action_type ?? "none"];
              return (
                <div key={`${b.account_id}-${b.key}`} className="surface-card p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="text-lg leading-none mt-0.5">{icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2 flex-wrap">
                        <span className="text-[14px] font-semibold text-foreground flex-1">{b.title}</span>
                        {b.value && b.value !== "$0/year" && (
                          <span className={cn("text-[10.5px] font-bold px-2 py-0.5 rounded-full border shrink-0", color)}>
                            {b.value}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{b.card_name}</div>
                      <div className="text-[12.5px] text-foreground/80 mt-1.5 leading-relaxed">{b.description}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => markUsed(b.account_id, b.key)}
                      className={cn("flex-1 h-9 rounded-xl text-[13px] font-semibold border transition-colors", color)}>
                      {b.action_label ?? "Done"}
                    </button>
                    <button onClick={() => markUsed(b.account_id, b.key)}
                      className="h-9 px-3 rounded-xl border border-border/40 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
                      Skip
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Done items */}
            {doneActions.length > 0 && (
              <div className="surface-card overflow-hidden">
                <div className="px-4 py-2.5 flex items-center justify-between">
                  <span className="text-[12px] text-muted-foreground">{doneActions.length} completed</span>
                </div>
                <div className="divide-y divide-border/10">
                  {doneActions.map(b => (
                    <div key={`${b.account_id}-${b.key}`} className="flex items-center gap-3 px-4 py-3 opacity-50">
                      <CheckCircle className="h-4 w-4 text-positive shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] font-medium text-foreground line-through">{b.title}</div>
                        <div className="text-[11px] text-muted-foreground">{b.card_name}</div>
                      </div>
                      <button onClick={() => restore(b.account_id, b.key)}
                        className="h-6 px-2 rounded-full border border-border/40 text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                        <RotateCcw className="h-2.5 w-2.5" /> Undo
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        /* ── SPEND SMARTER tab ── */
        ) : activeTab === "optimize" ? (
          <div className="space-y-2">
            {spendOpt.length === 0 ? (
              <div className="surface-card p-10 text-center">
                <TrendingUp className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                <div className="text-[13px] font-medium text-foreground">Refresh to analyze your spending</div>
                <div className="text-[11.5px] text-muted-foreground mt-1">Compares your cashback rates against actual spending</div>
                <button onClick={() => loadBenefits(true)} disabled={loading}
                  className="mt-3 h-8 px-4 rounded-full bg-foreground text-background text-[12px] font-medium">
                  Analyze now
                </button>
              </div>
            ) : (
              <>
                <div className="px-1 text-[12px] text-muted-foreground">
                  Based on your last 90 days of spending
                </div>
                {spendOpt.map(s => {
                  const gain = s.annual_gain;
                  return (
                    <div key={s.category} className="surface-card p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[14px] font-semibold text-foreground">{s.category}</div>
                          <div className="text-[11.5px] text-muted-foreground mt-0.5">
                            {fmtUSD(s.monthly_avg)}/mo avg
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[13px] font-bold text-positive">+{fmtUSD(gain)}/yr</div>
                          <div className="text-[10.5px] text-muted-foreground">potential savings</div>
                        </div>
                      </div>

                      {/* Current vs better */}
                      <div className="flex items-center gap-2">
                        {/* Current */}
                        <div className="flex-1 rounded-xl bg-muted/30 p-2.5">
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Currently using</div>
                          <div className="text-[12px] font-semibold text-foreground truncate">
                            {s.current_card_name ?? "Unknown card"}
                          </div>
                          <div className="text-[12px] text-muted-foreground">
                            {s.current_rate != null ? `${s.current_rate}% back` : "Unknown rate"}
                          </div>
                        </div>

                        <ChevronRight className="h-4 w-4 text-positive shrink-0" />

                        {/* Better */}
                        <div className="flex-1 rounded-xl bg-positive/8 border border-positive/20 p-2.5">
                          <div className="text-[10px] text-positive uppercase tracking-wide mb-1 font-semibold">Switch to</div>
                          <div className="text-[12px] font-semibold text-foreground truncate">{s.best_card_name}</div>
                          <div className="text-[12px] text-positive font-semibold">{s.best_rate}% back</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>

        /* ── ALL PERKS tab ── */
        ) : (
          <div className="space-y-3">
            {cards.filter(c => c.benefits.length > 0).map(card => {
              const isExpanded = expandedCards.has(card.account_id);
              const active = card.benefits.filter(b => !b.used_at);
              const used = card.benefits.filter(b => b.used_at);
              return (
                <div key={card.account_id} className="surface-card overflow-hidden">
                  <button onClick={() => setExpandedCards(prev => {
                    const n = new Set(prev);
                    n.has(card.account_id) ? n.delete(card.account_id) : n.add(card.account_id);
                    return n;
                  })} className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-muted/20">
                    <CreditCard className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-semibold text-foreground truncate">
                        {card.official_name || card.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {active.length} perks · {used.length} completed
                      </div>
                    </div>
                    <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground/40 transition-transform", isExpanded && "rotate-180")} />
                  </button>
                  {isExpanded && (
                    <div className="border-t border-border/20 divide-y divide-border/10">
                      {card.benefits.map(b => (
                        <div key={b.key} className={cn("flex items-start gap-3 px-5 py-3.5", b.used_at && "opacity-50")}>
                          <div className="mt-0.5 text-[14px]">{ACTION_ICON[b.action_type ?? "none"]}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={cn("text-[13px] font-medium", b.used_at ? "text-muted-foreground line-through" : "text-foreground")}>
                                {b.title}
                              </span>
                              {b.value && b.value !== "$0/year" && (
                                <span className="text-[10px] text-muted-foreground">· {b.value}</span>
                              )}
                            </div>
                            <div className="text-[11.5px] text-muted-foreground mt-0.5 leading-relaxed">{b.description}</div>
                          </div>
                          {b.used_at ? (
                            <button onClick={() => restore(card.account_id, b.key)}
                              className="h-6 px-2 rounded-full border border-border/40 text-[10px] text-muted-foreground shrink-0">
                              Undo
                            </button>
                          ) : b.action_type && b.action_type !== "none" ? (
                            <button onClick={() => markUsed(card.account_id, b.key)}
                              className="h-6 px-2 rounded-full bg-foreground text-background text-[10px] font-medium shrink-0">
                              Done
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
};
